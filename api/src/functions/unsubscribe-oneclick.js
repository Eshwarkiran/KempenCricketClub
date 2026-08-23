"use strict";
const { app } = require("@azure/functions");
const { sql, getPool } = require("../shared/db");
const { str, isEmail, verifyUnsubToken, brandedPage } = require("../shared/http");

/**
 * One-click unsubscribe (RFC 8058) — deliberately NOT behind the Bearer JWT,
 * because mail clients call it directly from the List-Unsubscribe header.
 * Authenticity comes from the HMAC token `t`, signed with JWT_SECRET.
 *
 *   POST /api/unsubscribe/one-click?email=...&t=...   (what mail clients send)
 *   GET  /api/unsubscribe/one-click?email=...&t=...   (if a human clicks it)
 */
app.http("unsubscribeOneClick", {
  route: "unsubscribe/one-click",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const url = new URL(request.url);
    const email = str(url.searchParams.get("email"), 255);
    const token = url.searchParams.get("t");

    if (!email || !isEmail(email) || !verifyUnsubToken(email, token)) {
      // Don't reveal whether the address exists — just refuse.
      return { status: 400, jsonBody: { success: false, error: "Invalid unsubscribe link" } };
    }

    try {
      const pool = await getPool();
      await pool
        .request()
        .input("email", sql.NVarChar(255), email.toLowerCase())
        .query(`
          UPDATE dbo.subscriber
          SET unsubscribed_at = SYSUTCDATETIME()
          WHERE LOWER(email) = @email AND unsubscribed_at IS NULL;
        `);
    } catch (err) {
      context.error("one-click unsubscribe failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }

    // Mail clients POST and just need a 200. A human clicking the link gets a page.
    if (request.method === "GET") {
      return {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: brandedPage({
          eyebrow: "Newsletter",
          title: "You've been unsubscribed",
          message: "You won't receive any more newsletters from Kempen Cricket Club."
        })
      };
    }
    return { status: 200, jsonBody: { success: true } };
  }
});
