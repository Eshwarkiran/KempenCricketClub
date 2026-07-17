"use strict";
const { app } = require("@azure/functions");
const { sql, getPool } = require("../shared/db");
const { requireJwt, readJson, str, isEmail, ok, badRequest } = require("../shared/http");

app.http("unsubscribe", {
  route: "unsubscribe",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);

    if (!isEmail(body.email)) {
      return badRequest("A valid email is required.");
    }

    const email = str(body.email, 255).toLowerCase();

    try {
      const pool = await getPool();
      // Mark as unsubscribed. Only touch rows still active so we keep the
      // original unsubscribe timestamp on repeat clicks.
      await pool
        .request()
        .input("email", sql.NVarChar(255), email)
        .query(`
          UPDATE dbo.subscriber
          SET unsubscribed_at = SYSUTCDATETIME()
          WHERE LOWER(email) = @email AND unsubscribed_at IS NULL;
        `);
      // Always report success — don't reveal whether the address was on the list.
      return ok;
    } catch (err) {
      context.error("unsubscribe failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
