"use strict";
const { app } = require("@azure/functions");
const {
  findOrCreateAccount, findMember, accountHasMembers, insertMember, subscribeEmail
} = require("../shared/db");
const {
  requireJwt, readJson, str, bool, isEmail, langOf, normalizeCategory,
  verifyTurnstile, signMemberApproveToken, ok, badRequest, conflict, captchaFailed
} = require("../shared/http");
const { sendConfirmation, sendAdminNotification, sendApprovalLink } = require("../shared/mail");

// Build the approval link for a pending member (points at the verify endpoint).
function approveUrl(email, memberId) {
  const site = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const token = signMemberApproveToken(email, memberId);
  if (!site || !token) return null;
  return `${site}/api/verify-member?mid=${memberId}` +
    `&email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
}

app.http("join", {
  route: "join",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);
    if (str(body.botcheck)) return ok; // honeypot

    const ip = request.headers.get("x-forwarded-for");
    if (!(await verifyTurnstile(body.turnstileToken, ip))) return captchaFailed();

    if (!str(body.firstName) || !str(body.lastName) || !isEmail(body.email)) {
      return badRequest("firstName, lastName and a valid email are required.");
    }

    const email = str(body.email, 255);
    const firstName = str(body.firstName, 100);
    const lastName = str(body.lastName, 100);
    const lang = langOf(body);
    const memberFields = {
      memberType: "trial", source: "join",
      category: normalizeCategory(body.category),
      firstName, lastName, notes: str(body.notes, 4000)
    };

    try {
      const accountId = await findOrCreateAccount({
        email, city: str(body.town, 100), lang, consent: { gdpr: bool(body.consent) }
      });

      // Join has no dob; a same-name match is the same person.
      const existing = await findMember(accountId, firstName, lastName, null);
      if (existing) {
        return conflict(existing.status === "pending"
          ? "This person is awaiting approval."
          : "This person is already registered.");
      }

      const firstMember = !(await accountHasMembers(accountId));
      if (firstMember) {
        // Account holder — active immediately, no approval needed.
        await insertMember({ accountId, isPrimary: true, status: "active", ...memberFields });
        try { await subscribeEmail(email, lang); }
        catch (subErr) { context.warn("join auto-subscribe failed", subErr); }
        const sent = await sendConfirmation({ to: email, name: firstName, kind: "join", lang });
        if (!sent) context.warn("join confirmation email not sent");
      } else {
        // Adding someone to an existing account — pending until the owner approves.
        const memberId = await insertMember({ accountId, isPrimary: false, status: "pending", ...memberFields });
        const url = approveUrl(email, memberId);
        if (url) {
          const sent = await sendApprovalLink({ to: email, name: `${firstName} ${lastName}`, url, lang });
          if (!sent) context.warn("join approval email not sent");
        } else {
          context.warn("join approval link not built (SITE_URL/JWT_SECRET missing)");
        }
      }

      await sendAdminNotification({
        kind: "join",
        details: {
          name: `${firstName} ${lastName}`, email,
          category: memberFields.category, town: str(body.town, 100),
          status: firstMember ? "active" : "pending approval"
        }
      });

      return ok;
    } catch (err) {
      context.error("join failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
