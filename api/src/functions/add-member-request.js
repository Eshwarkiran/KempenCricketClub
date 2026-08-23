"use strict";
const { app } = require("@azure/functions");
const { findAccountByEmail } = require("../shared/db");
const {
  requireJwt, readJson, str, isEmail, langOf,
  verifyTurnstile, signMemberLinkToken, ok, badRequest, captchaFailed
} = require("../shared/http");
const { sendMemberLink } = require("../shared/mail");

/**
 * POST /api/add-member/request-link  { email, turnstileToken, lang }
 * Emails a signed, time-limited magic link to add a family member. Always
 * returns 200 (never reveals whether the email has an account), and only sends
 * the email when an account actually exists.
 */
app.http("addMemberRequest", {
  route: "add-member/request-link",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);

    const ip = request.headers.get("x-forwarded-for");
    if (!(await verifyTurnstile(body.turnstileToken, ip))) return captchaFailed();

    if (!isEmail(body.email)) return badRequest("A valid email is required.");

    const email = str(body.email, 255);
    const lang = langOf(body);

    try {
      const accountId = await findAccountByEmail(email);
      if (accountId) {
        const token = signMemberLinkToken(email);
        const site = (process.env.SITE_URL || "").replace(/\/+$/, "");
        if (site && token) {
          const url =
            `${site}${lang === "nl" ? "/nl" : ""}/add-member/` +
            `?email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
          const sent = await sendMemberLink({ to: email, url, lang });
          if (!sent) context.warn("add-member link email not sent (SMTP off or error)");
        } else {
          context.warn("add-member link not built (SITE_URL or JWT_SECRET missing)");
        }
      }
      // Same response whether or not an account exists.
      return ok;
    } catch (err) {
      context.error("add-member request failed", err);
      return { status: 500, jsonBody: { success: false, error: "Server error" } };
    }
  }
});
