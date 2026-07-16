"use strict";
const { app } = require("@azure/functions");
const { sql, getPool } = require("../shared/db");
const { requireJwt, readJson, str, isEmail, langOf, ok, badRequest } = require("../shared/http");

app.http("subscribe", {
  route: "subscribe",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);

    if (!isEmail(body.email)) {
      return badRequest("A valid email is required.");
    }

    try {
      const pool = await getPool();
      // Idempotent: re-subscribing an existing address just clears unsubscribed_at.
      await pool
        .request()
        .input("email", sql.NVarChar(255), str(body.email, 255).toLowerCase())
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
