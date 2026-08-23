"use strict";
const { app } = require("@azure/functions");
const {
  findOrCreateAccount, findMember, accountHasMembers, insertMember, subscribeEmail
} = require("../shared/db");
const {
  requireJwt, readJson, str, bool, isEmail, langOf, normalizeCategory,
  verifyTurnstile, ok, badRequest, conflict, captchaFailed
} = require("../shared/http");
const { sendConfirmation, sendAdminNotification } = require("../shared/mail");

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

    // Cloudflare Turnstile
    const ip = request.headers.get("x-forwarded-for");
    if (!(await verifyTurnstile(body.turnstileToken, ip))) {
      return captchaFailed();
    }

    if (!str(body.firstName) || !str(body.lastName) || !isEmail(body.email)) {
      return badRequest("firstName, lastName and a valid email are required.");
    }

    const email = str(body.email, 255);
    const firstName = str(body.firstName, 100);
    const lastName = str(body.lastName, 100);
    const lang = langOf(body);

    try {
      const accountId = await findOrCreateAccount({
        email,
        city: str(body.town, 100), // join collects "town"
        lang,
        consent: { gdpr: bool(body.consent) }
      });

      // Trial signup has no dob; a matching person means they've already signed up.
      if (await findMember(accountId, firstName, lastName, null)) {
        return conflict("This person is already registered.");
      }

      const isPrimary = !(await accountHasMembers(accountId));
      await insertMember({
        accountId, isPrimary, memberType: "trial", source: "join",
        category: normalizeCategory(body.category),
        firstName, lastName,
        notes: str(body.notes, 4000)
      });

      // Auto-subscribe (best-effort).
      try { await subscribeEmail(email, lang); }
      catch (subErr) { context.warn("join auto-subscribe failed", subErr); }

      // Confirmation to the applicant (best-effort).
      const sent = await sendConfirmation({ to: email, name: firstName, kind: "join", lang });
      if (!sent) context.warn("join confirmation email not sent (SMTP off or error)");

      // Notify the club (best-effort).
      await sendAdminNotification({
        kind: "join",
        details: {
          name: `${firstName} ${lastName}`, email,
          category: normalizeCategory(body.category), town: str(body.town, 100),
          notes: str(body.notes, 4000)
        }
      });

      return ok;
    } catch (err) {
      context.error("join failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
