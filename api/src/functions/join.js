"use strict";
const { app } = require("@azure/functions");
const { sql, getPool, emailExists } = require("../shared/db");
const {
  requireJwt, readJson, str, bool, isEmail, langOf, normalizeCategory,
  verifyTurnstile, ok, badRequest, conflict, captchaFailed
} = require("../shared/http");
const { sendConfirmation } = require("../shared/mail");

app.http("join", {
  route: "join",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);

    // Honeypot: bots fill this hidden field — pretend success, store nothing.
    if (str(body.botcheck)) return ok;

    // Cloudflare Turnstile
    const ip = request.headers.get("x-forwarded-for");
    if (!(await verifyTurnstile(body.turnstileToken, ip))) {
      return captchaFailed();
    }

    if (!str(body.firstName) || !str(body.lastName) || !isEmail(body.email)) {
      return badRequest("firstName, lastName and a valid email are required.");
    }

    const email = str(body.email, 255);

    try {
      // Reject duplicates (any existing member with this email).
      if (await emailExists("members", email)) {
        return conflict("This email is already registered.");
      }

      const pool = await getPool();
      await pool
        .request()
        .input("member_type", sql.VarChar(10), "trial") // join = trial candidate
        .input("source", sql.VarChar(10), "join")
        .input("category", sql.NVarChar(50), normalizeCategory(body.category))
        .input("first_name", sql.NVarChar(100), str(body.firstName, 100))
        .input("last_name", sql.NVarChar(100), str(body.lastName, 100))
        .input("email", sql.NVarChar(255), email)
        .input("town", sql.NVarChar(100), str(body.town, 100))
        .input("notes", sql.NVarChar(sql.MAX), str(body.notes, 4000))
        .input("consent_gdpr", sql.Bit, bool(body.consent))
        .input("lang", sql.Char(2), langOf(body))
        .query(`
          INSERT INTO dbo.members
            (member_type, source, category, first_name, last_name, email,
             town, notes, consent_gdpr, lang)
          VALUES
            (@member_type, @source, @category, @first_name, @last_name, @email,
             @town, @notes, @consent_gdpr, @lang);
        `);

      // Auto-subscribe to the newsletter (idempotent). Best-effort.
      try {
        await pool
          .request()
          .input("email", sql.NVarChar(255), email.toLowerCase())
          .input("lang", sql.Char(2), langOf(body))
          .query(`
            MERGE dbo.subscriber AS t
            USING (SELECT @email AS email) AS s
            ON t.email = s.email
            WHEN MATCHED THEN UPDATE SET unsubscribed_at = NULL, lang = @lang
            WHEN NOT MATCHED THEN INSERT (email, lang) VALUES (@email, @lang);
          `);
      } catch (subErr) {
        context.warn("join auto-subscribe failed", subErr);
      }

      // Confirmation email. Best-effort — never blocks the response.
      const sent = await sendConfirmation({
        to: email, name: str(body.firstName, 100), kind: "join", lang: langOf(body)
      });
      if (!sent) context.warn("join confirmation email not sent (SMTP off or error)");

      return ok;
    } catch (err) {
      context.error("join insert failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
