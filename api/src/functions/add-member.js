"use strict";
const { app } = require("@azure/functions");
const {
  findAccountByEmail, findMember, insertMember, subscribeEmail
} = require("../shared/db");
const {
  requireJwt, readJson, str, isEmail, dateOrNull, langOf, normalizeCategory,
  verifyTurnstile, verifyMemberLinkToken, ok, badRequest, conflict, captchaFailed
} = require("../shared/http");
const { sendAdminNotification } = require("../shared/mail");

/**
 * POST /api/add-member  { email, token, firstName, lastName, dob, ..., turnstileToken }
 * Adds a family member to an existing account. Gated by the signed magic-link
 * token (proves control of the account email) plus Turnstile. The new member is
 * never primary; the account holder is.
 */
app.http("addMember", {
  route: "add-member",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);

    const ip = request.headers.get("x-forwarded-for");
    if (!(await verifyTurnstile(body.turnstileToken, ip))) return captchaFailed();

    if (!isEmail(body.email) || !verifyMemberLinkToken(str(body.email, 255), body.token)) {
      return { status: 401, jsonBody: { success: false, error: "Invalid or expired link" } };
    }
    if (!str(body.firstName) || !str(body.lastName)) {
      return badRequest("firstName and lastName are required.");
    }

    const email = str(body.email, 255);
    const firstName = str(body.firstName, 100);
    const lastName = str(body.lastName, 100);
    const dob = dateOrNull(body.dob);
    const lang = langOf(body);

    try {
      const accountId = await findAccountByEmail(email);
      if (!accountId) {
        return { status: 401, jsonBody: { success: false, error: "Invalid or expired link" } };
      }

      if (await findMember(accountId, firstName, lastName, dob)) {
        return conflict("This person is already on the account.");
      }

      await insertMember({
        accountId, isPrimary: false, memberType: "regular", source: "added",
        category: normalizeCategory(body.category) || "junior",
        firstName, lastName, dob,
        gender: str(body.gender, 30),
        nationality: str(body.nationality, 100),
        birthplace: str(body.birthplace, 100),
        nationalRegisterNo: str(body.nationalRegisterNo, 20),
        emergency: str(body.emergency, 255),
        medical: str(body.medical, 4000),
        role: str(body.role, 50),
        battingHand: str(body.battingHand, 30),
        bowlingStyle: str(body.bowlingStyle, 50),
        experience: str(body.experience, 4000),
        studentId: str(body.studentId, 50)
      });

      // Keep the account subscribed (idempotent, best-effort).
      try { await subscribeEmail(email, lang); }
      catch (subErr) { context.warn("add-member auto-subscribe failed", subErr); }

      await sendAdminNotification({
        kind: "added",
        details: {
          name: `${firstName} ${lastName}`, account_email: email,
          category: normalizeCategory(body.category) || "junior", dob
        }
      });

      return ok;
    } catch (err) {
      context.error("add-member failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
