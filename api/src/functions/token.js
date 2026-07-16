"use strict";
const { app } = require("@azure/functions");
const { signToken, checkClientCredentials, readJson } = require("../shared/http");

/**
 * POST /api/token
 * Trades client credentials for a short-lived HS256 JWT.
 * Credentials may be supplied as a JSON body { username, password }
 * or an HTTP Basic Authorization header, checked against
 * BASIC_AUTH_USER / BASIC_AUTH_PASSWORD.
 * Response: { token, token_type: "Bearer", expires_in }
 */
app.http("token", {
  route: "token",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    let username;
    let password;

    const header = request.headers.get("authorization") || "";
    const basic = /^Basic\s+(.+)$/i.exec(header);
    if (basic) {
      const decoded = Buffer.from(basic[1], "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > -1) {
        username = decoded.slice(0, idx);
        password = decoded.slice(idx + 1);
      }
    } else {
      const body = await readJson(request);
      username = body.username;
      password = body.password;
    }

    if (!checkClientCredentials(username, password)) {
      // No WWW-Authenticate header on purpose: this endpoint is called via fetch(),
      // and a "Basic"/"Bearer" challenge would make the browser pop its native
      // login dialog instead of letting the page handle the 401.
      return {
        status: 401,
        jsonBody: { success: false, error: "Invalid credentials" }
      };
    }

    try {
      const token = signToken({ sub: username, scope: "forms" });
      return {
        status: 200,
        jsonBody: {
          token,
          token_type: "Bearer",
          expires_in: process.env.JWT_EXPIRES_IN || "15m"
        }
      };
    } catch (err) {
      context.error("token issue failed", err);
      return { status: 500, jsonBody: { success: false, error: "Auth not configured" } };
    }
  }
});
