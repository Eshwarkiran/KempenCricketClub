"use strict";
const { app } = require("@azure/functions");
const { sql, getPool } = require("../shared/db");
const {
  requireJwt, readJson, str, isEmail, langOf,
  verifyTurnstile, ok, badRequest, conflict, captchaFailed
} = require("../shared/http");

app.http("subscribe", {
  route: "subscribe",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);

    // Cloudflare Turnstile
    const ip = request.headers.get("x-forwarded-for");
    if (!(await verifyTurnstile(body.turnstileToken, ip))) {
      return captchaFailed();
    }

    if (!isEmail(body.email)) {
      return badRequest("A valid email is required.");
    }

    const email = str(body.email, 255).toLowerCase();

    try {
      const pool = await getPool();

      // Reject an address that is already an ACTIVE subscriber. A previously
      // unsubscribed address is allowed to re-subscribe (otherwise unsubscribing
      // would be permanent), which the MERGE below reactivates.
      const existing = await pool
        .request()
        .input("email", sql.NVarChar(255), email)
        .query("SELECT TOP 1 unsubscribed_at FROM dbo.subscriber WHERE LOWER(email) = @email");
      if (existing.recordset.length && existing.recordset[0].unsubscribed_at === null) {
        return conflict("This email is already subscribed.");
      }

      await pool
        .request()
        .input("email", sql.NVarChar(255), email)
        .input("lang", sql.Char(2), langOf(body))
        .query(`
          MERGE dbo.subscriber AS t
          USING (SELECT @email AS email) AS s
          ON t.email = s.email
          WHEN MATCHED THEN
            UPDATE SET unsubscribed_at = NULL, lang = @lang
          WHEN NOT MATCHED THEN
            INSERT (email, lang) VALUES (@email, @lang);
        `);
      return ok;
    } catch (err) {
      context.error("subscribe insert failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
