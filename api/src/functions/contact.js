"use strict";
const { app } = require("@azure/functions");
const { sql, getPool } = require("../shared/db");
const { requireBasicAuth, readJson, str, bool, isEmail, langOf, ok, badRequest } = require("../shared/http");

app.http("contact", {
  route: "contact",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireBasicAuth(request);
    if (denied) return denied;

    const body = await readJson(request);

    // Honeypot
    if (str(body.botcheck)) return ok;

    if (!str(body.name) || !isEmail(body.email) || !str(body.message)) {
      return badRequest("name, a valid email and message are required.");
    }

    try {
      const pool = await getPool();
      await pool
        .request()
        .input("name", sql.NVarChar(150), str(body.name, 150))
        .input("email", sql.NVarChar(255), str(body.email, 255))
        .input("topic", sql.NVarChar(100), str(body.topic, 100))
        .input("message", sql.NVarChar(sql.MAX), str(body.message, 8000))
        .input("consent", sql.Bit, bool(body.consent))
        .input("lang", sql.Char(2), langOf(body))
        .query(`
          INSERT INTO dbo.contact (name, email, topic, message, consent, lang)
          VALUES (@name, @email, @topic, @message, @consent, @lang);
        `);
      return ok;
    } catch (err) {
      context.error("contact insert failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
