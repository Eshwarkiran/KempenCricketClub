"use strict";
const { app } = require("@azure/functions");
const {
  findOrCreateAccount, findMember, accountHasMembers,
  insertMember, upgradeMemberToRegular, subscribeEmail
} = require("../shared/db");
const {
  requireJwt, readJson, str, bool, isEmail, dateOrNull, langOf, normalizeCategory,
  ok, badRequest, conflict
} = require("../shared/http");
const { sendConfirmation, sendAdminNotification } = require("../shared/mail");

app.http("register", {
  route: "register",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const denied = requireJwt(request);
    if (denied) return denied;

    const body = await readJson(request);

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

    // Person fields shared by the insert and the trial->regular upgrade.
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

      const existing = await findMember(accountId, firstName, lastName, dob);
      if (existing && existing.member_type === "regular") {
        return conflict("This email is already registered.");
      }

      if (existing && existing.member_type === "trial") {
        // Trial member registering as a regular member — upgrade in place.
        await upgradeMemberToRegular(existing.id, fields);
      } else {
        const isPrimary = !(await accountHasMembers(accountId));
        await insertMember({ accountId, isPrimary, memberType: "regular", source: "register", ...fields });
      }

      // Auto-subscribe (best-effort).
      try { await subscribeEmail(email, lang); }
      catch (subErr) { context.warn("register auto-subscribe failed", subErr); }

      // Confirmation to the applicant (best-effort).
      const sent = await sendConfirmation({ to: email, name: firstName, kind: "register", lang });
      if (!sent) context.warn("register confirmation email not sent (SMTP off or error)");

      // Notify the club (best-effort).
      await sendAdminNotification({
        kind: "register",
        details: {
          name: `${firstName} ${lastName}`, email, phone: str(body.phone, 50),
          category: fields.category, dob, city: str(body.city, 100),
          upgraded_from_trial: existing && existing.member_type === "trial" ? "yes" : "no"
        }
      });

      return ok;
    } catch (err) {
      context.error("register failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
