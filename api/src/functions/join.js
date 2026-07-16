"use strict";
const { app } = require("@azure/functions");
const { sql, getPool } = require("../shared/db");
const { requireJwt, readJson, str, bool, isEmail, langOf, ok, badRequest } = require("../shared/http");

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

    if (!str(body.firstName) || !str(body.lastName) || !isEmail(body.email)) {
      return badRequest("firstName, lastName and a valid email are required.");
    }

    try {
      const pool = await getPool();
      await pool
        .request()
        .input("member_type", sql.VarChar(10), "trial") // join = trial candidate
        .input("source", sql.VarChar(10), "join")
        .input("category", sql.NVarChar(50), str(body.category, 50))
        .input("first_name", sql.NVarChar(100), str(body.firstName, 100))
        .input("last_name", sql.NVarChar(100), str(body.lastName, 100))
        .input("email", sql.NVarChar(255), str(body.email, 255))
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
      return ok;
    } catch (err) {
      context.error("join insert failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
