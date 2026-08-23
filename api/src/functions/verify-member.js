"use strict";
const { app } = require("@azure/functions");
const { findAccountByEmail, activateMember, getMemberBrief } = require("../shared/db");
const { str, isEmail, verifyMemberApproveToken } = require("../shared/http");

function page(title, message) {
  return "<!doctype html><meta charset=utf-8><title>" + title + "</title>" +
    "<body style=\"font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px\">" +
    "<h1>" + title + "</h1><p>" + message + "</p><p><a href=\"/\">Back to the website</a></p></body>";
}

/**
 * GET/POST /api/verify-member?mid=<id>&email=<account email>&t=<token>
 * Activates a pending member. Deliberately NOT behind the Bearer JWT — it's
 * opened from an emailed link. Authenticity comes from the signed token, which
 * is bound to the account email and the member id.
 */
app.http("verifyMember", {
  route: "verify-member",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const url = new URL(request.url);
    const email = str(url.searchParams.get("email"), 255);
    const mid = parseInt(url.searchParams.get("mid"), 10);
    const token = url.searchParams.get("t");

    const htmlHeaders = { "Content-Type": "text/html; charset=utf-8" };

    if (!email || !isEmail(email) || !mid || !verifyMemberApproveToken(email, mid, token)) {
      return { status: 400, headers: htmlHeaders, body: page("Invalid link", "This approval link is invalid or has expired.") };
    }

    try {
      // Activation is scoped to the account named in the (signed) email.
      const accountId = await findAccountByEmail(email);
      if (!accountId) {
        return { status: 400, headers: htmlHeaders, body: page("Invalid link", "This approval link is invalid or has expired.") };
      }

      const activated = await activateMember(mid, accountId);
      // Idempotent: if it was already approved (a second click), still show success.
      const brief = activated || await getMemberBrief(mid);
      if (!brief || brief.account_id !== accountId) {
        return { status: 400, headers: htmlHeaders, body: page("Invalid link", "This approval link is invalid.") };
      }

      const name = `${brief.first_name} ${brief.last_name}`;
      return {
        status: 200, headers: htmlHeaders,
        body: page("Member approved", `${name} is now an active member of your Kempen Cricket Club account.`)
      };
    } catch (err) {
      context.error("verify-member failed", err);
      return { status: 500, headers: htmlHeaders, body: page("Something went wrong", "Please try again later or email contact@kempencricket.be.") };
    }
  }
});
