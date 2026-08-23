"use strict";
const { app } = require("@azure/functions");
const {
  findOrCreateAccount, findMemberByName, accountHasMembers,
  insertMember, upgradeMemberToRegular, subscribeEmail
} = require("../shared/db");
const {
  requireJwt, readJson, str, bool, isEmail, dateOrNull, langOf, normalizeCategory,
  verifyTurnstile, signMemberApproveToken, ok, badRequest, conflict, captchaFailed
} = require("../shared/http");
const { sendConfirmation, sendAdminNotification, sendApprovalLink } = require("../shared/mail");

function approveUrl(email, memberId) {
  const site = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const token = signMemberApproveToken(email, memberId);
  if (!site || !token) return null;
  return `${site}/api/verify-member?mid=${memberId}` +
    `&email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
}

app.http("register", {
  route: "register",
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
    if (!bool(body.agreeGdpr)) {
      return badRequest("GDPR consent is required.");
    }

    const email = str(body.email, 255);
    const firstName = str(body.firstName, 100);
    const lastName = str(body.lastName, 100);
    const dob = dateOrNull(body.dob);
    const lang = langOf(body);

    const fields = {
      category: normalizeCategory(body.category),
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
      previousClub: str(body.previousClub, 150),
      priorFederation: str(body.priorFederation, 150),
      studentId: str(body.studentId, 50),
      heardVia: str(body.heardVia, 100)
    };

    try {
      const accountId = await findOrCreateAccount({
        email,
        phone: str(body.phone, 50),
        address: str(body.address, 255),
        city: str(body.city, 100),
        lang,
        consent: {
          gdpr: bool(body.agreeGdpr), rules: bool(body.agreeRules),
          house: bool(body.agreeHouse), photo: bool(body.agreePhoto),
          guardian: bool(body.agreeGuardian)
        }
      });

      // Matches an existing regular row, or a trial/pending row with no dob yet.
      const existing = await findMemberByName(accountId, firstName, lastName, dob);
      if (existing && existing.member_type === "regular" && existing.status === "active") {
        return conflict("This email is already registered.");
      }

      let pending = false;
      if (existing) {
        // Same person — upgrade in place to regular + active. No approval needed
        // (they already exist and the owner controls the email).
        await upgradeMemberToRegular(existing.id, fields);
      } else if (!(await accountHasMembers(accountId))) {
        // Account holder registering fresh — active immediately.
        await insertMember({ accountId, isPrimary: true, memberType: "regular", source: "register", status: "active", ...fields });
      } else {
        // New person on an existing account — pending until the owner approves.
        pending = true;
        const memberId = await insertMember({ accountId, isPrimary: false, memberType: "regular", source: "register", status: "pending", ...fields });
        const url = approveUrl(email, memberId);
        if (url) {
          const sent = await sendApprovalLink({ to: email, name: `${firstName} ${lastName}`, url, lang });
          if (!sent) context.warn("register approval email not sent");
        } else {
          context.warn("register approval link not built (SITE_URL/JWT_SECRET missing)");
        }
      }

      if (!pending) {
        try { await subscribeEmail(email, lang); }
        catch (subErr) { context.warn("register auto-subscribe failed", subErr); }
        const sent = await sendConfirmation({ to: email, name: firstName, kind: "register", lang });
        if (!sent) context.warn("register confirmation email not sent");
      }

      await sendAdminNotification({
        kind: "register",
        details: {
          name: `${firstName} ${lastName}`, email, phone: str(body.phone, 50),
          category: fields.category, dob, city: str(body.city, 100),
          status: pending ? "pending approval" : (existing ? "active (upgraded)" : "active")
        }
      });

      return ok;
    } catch (err) {
      context.error("register failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
