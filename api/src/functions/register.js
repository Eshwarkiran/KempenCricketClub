"use strict";
const { app } = require("@azure/functions");
const { sql, getPool } = require("../shared/db");
const { requireJwt, readJson, str, bool, isEmail, dateOrNull, langOf, ok, badRequest } = require("../shared/http");

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

    try {
      const pool = await getPool();
      await pool
        .request()
        .input("member_type", sql.VarChar(10), "regular") // register = regular member
        .input("source", sql.VarChar(10), "register")
        .input("category", sql.NVarChar(50), str(body.category, 50))
        .input("first_name", sql.NVarChar(100), str(body.firstName, 100))
        .input("last_name", sql.NVarChar(100), str(body.lastName, 100))
        .input("email", sql.NVarChar(255), str(body.email, 255))
        .input("phone", sql.NVarChar(50), str(body.phone, 50))
        .input("address", sql.NVarChar(255), str(body.address, 255))
        .input("city", sql.NVarChar(100), str(body.city, 100))
        .input("dob", sql.Date, dateOrNull(body.dob))
        .input("gender", sql.NVarChar(30), str(body.gender, 30))
        .input("nationality", sql.NVarChar(100), str(body.nationality, 100))
        .input("birthplace", sql.NVarChar(100), str(body.birthplace, 100))
        .input("national_register_no", sql.NVarChar(20), str(body.nationalRegisterNo, 20))
        .input("emergency_contact", sql.NVarChar(255), str(body.emergency, 255))
        .input("medical_notes", sql.NVarChar(sql.MAX), str(body.medical, 4000))
        .input("playing_role", sql.NVarChar(50), str(body.role, 50))
        .input("batting_hand", sql.NVarChar(30), str(body.battingHand, 30))
        .input("bowling_style", sql.NVarChar(50), str(body.bowlingStyle, 50))
        .input("experience", sql.NVarChar(sql.MAX), str(body.experience, 4000))
        .input("previous_club", sql.NVarChar(150), str(body.previousClub, 150))
        .input("prior_federation", sql.NVarChar(150), str(body.priorFederation, 150))
        .input("guardian_name", sql.NVarChar(150), str(body.guardianName, 150))
        .input("guardian_rel", sql.NVarChar(50), str(body.guardianRel, 50))
        .input("guardian_phone", sql.NVarChar(50), str(body.guardianPhone, 50))
        .input("guardian_email", sql.NVarChar(255), str(body.guardianEmail, 255))
        .input("student_id", sql.NVarChar(50), str(body.studentId, 50))
        .input("heard_via", sql.NVarChar(100), str(body.heardVia, 100))
        .input("consent_gdpr", sql.Bit, bool(body.agreeGdpr))
        .input("agree_rules", sql.Bit, bool(body.agreeRules))
        .input("agree_house", sql.Bit, bool(body.agreeHouse))
        .input("agree_photo", sql.Bit, bool(body.agreePhoto))
        .input("agree_guardian", sql.Bit, bool(body.agreeGuardian))
        .input("lang", sql.Char(2), langOf(body))
        .query(`
          INSERT INTO dbo.members
            (member_type, source, category, first_name, last_name, email, phone,
             address, city, dob, gender, nationality, birthplace,
             national_register_no, emergency_contact, medical_notes,
             playing_role, batting_hand, bowling_style, experience,
             previous_club, prior_federation,
             guardian_name, guardian_rel, guardian_phone, guardian_email,
             student_id, heard_via,
             consent_gdpr, agree_rules, agree_house, agree_photo, agree_guardian, lang)
          VALUES
            (@member_type, @source, @category, @first_name, @last_name, @email, @phone,
             @address, @city, @dob, @gender, @nationality, @birthplace,
             @national_register_no, @emergency_contact, @medical_notes,
             @playing_role, @batting_hand, @bowling_style, @experience,
             @previous_club, @prior_federation,
             @guardian_name, @guardian_rel, @guardian_phone, @guardian_email,
             @student_id, @heard_via,
             @consent_gdpr, @agree_rules, @agree_house, @agree_photo, @agree_guardian, @lang);
        `);
      return ok;
    } catch (err) {
      context.error("register insert failed", err);
      return { status: 500, jsonBody: { success: false, error: "Database error" } };
    }
  }
});
