"use strict";
const sql = require("mssql");

let poolPromise;

const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE || "KempenCricketClub",
  user: process.env.SQL_USER || "controller",
  password: process.env.SQL_PASSWORD,
  options: {
    encrypt: true,
    // Set SQL_TRUST_CERT=true to skip TLS cert validation — mirrors DBeaver's
    // "Trust Server Certificate". Handy behind a TLS-inspecting proxy; keep it
    // false in production where the Azure cert chain validates normally.
    trustServerCertificate: process.env.SQL_TRUST_CERT === "true"
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  // Generous first-connect window: a serverless Azure SQL DB that has
  // auto-paused can take 30-60s to resume on the first connection.
  connectionTimeout: 45000,
  requestTimeout: 30000
};

/** Connect with a couple of retries so a cold DB resume doesn't fail outright. */
async function connectWithRetry(attempts = 3, delayMs = 3000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await sql.connect(config);
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/** Lazily create (and reuse) one connection pool per function host. */
function getPool() {
  if (!poolPromise) {
    poolPromise = connectWithRetry().catch((err) => {
      poolPromise = undefined; // allow retry on next invocation
      throw err;
    });
  }
  return poolPromise;
}

/**
 * Case-insensitive check for whether an email already exists in a given table.
 * `table` must be one of the allow-listed names below (never interpolate raw
 * user input into SQL). Returns true/false.
 */
async function emailExists(table, email) {
  const allowed = { subscriber: "dbo.subscriber", contact: "dbo.contact" };
  const target = allowed[table];
  if (!target) throw new Error("emailExists: unknown table " + table);
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(255), email)
    .query(`SELECT TOP 1 1 AS hit FROM ${target} WHERE LOWER(email) = LOWER(@email)`);
  return result.recordset.length > 0;
}

/* ==========================================================================
   Account + member helpers (see db/migrations/2026-07_account_member)
   ========================================================================== */

/**
 * Find the account for an email, or create it. Contact fields and consents from
 * the current submission are merged in (contact fields fill blanks; consents are
 * OR-ed so they can only be granted, never revoked). Returns the account id.
 * `consent` = { gdpr, rules, house, photo, guardian } booleans.
 */
async function findOrCreateAccount({ email, phone, address, city, lang, consent = {} }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(255), String(email).trim().toLowerCase())
    .input("phone", sql.NVarChar(50), phone || null)
    .input("address", sql.NVarChar(255), address || null)
    .input("city", sql.NVarChar(100), city || null)
    .input("lang", sql.Char(2), lang || null)
    .input("gdpr", sql.Bit, consent.gdpr ? 1 : 0)
    .input("rules", sql.Bit, consent.rules ? 1 : 0)
    .input("house", sql.Bit, consent.house ? 1 : 0)
    .input("photo", sql.Bit, consent.photo ? 1 : 0)
    .input("guardian", sql.Bit, consent.guardian ? 1 : 0)
    .query(`
      MERGE dbo.account AS t
      USING (SELECT @email AS email) AS s ON t.email = s.email
      WHEN MATCHED THEN UPDATE SET
        phone          = COALESCE(@phone,   t.phone),
        address        = COALESCE(@address, t.address),
        city           = COALESCE(@city,    t.city),
        lang           = COALESCE(@lang,    t.lang),
        consent_gdpr   = CASE WHEN @gdpr     = 1 THEN 1 ELSE t.consent_gdpr   END,
        agree_rules    = CASE WHEN @rules    = 1 THEN 1 ELSE t.agree_rules    END,
        agree_house    = CASE WHEN @house    = 1 THEN 1 ELSE t.agree_house    END,
        agree_photo    = CASE WHEN @photo    = 1 THEN 1 ELSE t.agree_photo    END,
        agree_guardian = CASE WHEN @guardian = 1 THEN 1 ELSE t.agree_guardian END
      WHEN NOT MATCHED THEN
        INSERT (email, phone, address, city, lang,
                consent_gdpr, agree_rules, agree_house, agree_photo, agree_guardian)
        VALUES (@email, @phone, @address, @city, @lang,
                @gdpr, @rules, @house, @photo, @guardian)
      OUTPUT inserted.id AS id;
    `);
  return result.recordset[0].id;
}

/** Look up the account id for an email (no create). Returns id or null. */
async function findAccountByEmail(email) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar(255), String(email).trim().toLowerCase())
    .query("SELECT TOP 1 id FROM dbo.account WHERE email = @email");
  return r.recordset[0] ? r.recordset[0].id : null;
}

/** Find a person within an account by name + dob. Returns {id, member_type, is_primary} or null. */
async function findMember(accountId, firstName, lastName, dob) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("account_id", sql.Int, accountId)
    .input("first_name", sql.NVarChar(100), firstName)
    .input("last_name", sql.NVarChar(100), lastName)
    .input("dob", sql.Date, dob || null)
    .query(`
      SELECT TOP 1 id, member_type, is_primary, status
      FROM dbo.members
      WHERE account_id = @account_id
        AND first_name = @first_name AND last_name = @last_name
        AND ((dob IS NULL AND @dob IS NULL) OR dob = @dob)
    `);
  return r.recordset[0] || null;
}

/**
 * Find a person for registration/upgrade. Matches the same name where the dob
 * equals the given one OR is NULL — because a trial member (from /join) has no
 * dob yet, so an exact-dob match would miss them and create a duplicate. Prefers
 * an exact dob match over a null-dob (trial) row. Returns {id, member_type, is_primary, dob} or null.
 */
async function findMemberByName(accountId, firstName, lastName, dob) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("account_id", sql.Int, accountId)
    .input("first_name", sql.NVarChar(100), firstName)
    .input("last_name", sql.NVarChar(100), lastName)
    .input("dob", sql.Date, dob || null)
    .query(`
      SELECT TOP 1 id, member_type, is_primary, dob, status
      FROM dbo.members
      WHERE account_id = @account_id
        AND first_name = @first_name AND last_name = @last_name
        AND (dob = @dob OR dob IS NULL)
      ORDER BY CASE WHEN dob = @dob THEN 0 ELSE 1 END, id
    `);
  return r.recordset[0] || null;
}

/** True if the account already has at least one member. */
async function accountHasMembers(accountId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("account_id", sql.Int, accountId)
    .query("SELECT TOP 1 1 AS hit FROM dbo.members WHERE account_id = @account_id");
  return r.recordset.length > 0;
}

// Bind every member column on a request, from a plain object (undefined -> null).
function bindMemberFields(reqBuilder, m) {
  return reqBuilder
    .input("category", sql.NVarChar(50), m.category ?? null)
    .input("first_name", sql.NVarChar(100), m.firstName)
    .input("last_name", sql.NVarChar(100), m.lastName)
    .input("dob", sql.Date, m.dob ?? null)
    .input("gender", sql.NVarChar(30), m.gender ?? null)
    .input("nationality", sql.NVarChar(100), m.nationality ?? null)
    .input("birthplace", sql.NVarChar(100), m.birthplace ?? null)
    .input("national_register_no", sql.NVarChar(20), m.nationalRegisterNo ?? null)
    .input("emergency_contact", sql.NVarChar(255), m.emergency ?? null)
    .input("medical_notes", sql.NVarChar(sql.MAX), m.medical ?? null)
    .input("playing_role", sql.NVarChar(50), m.role ?? null)
    .input("batting_hand", sql.NVarChar(30), m.battingHand ?? null)
    .input("bowling_style", sql.NVarChar(50), m.bowlingStyle ?? null)
    .input("experience", sql.NVarChar(sql.MAX), m.experience ?? null)
    .input("previous_club", sql.NVarChar(150), m.previousClub ?? null)
    .input("prior_federation", sql.NVarChar(150), m.priorFederation ?? null)
    .input("student_id", sql.NVarChar(50), m.studentId ?? null)
    .input("heard_via", sql.NVarChar(100), m.heardVia ?? null)
    .input("notes", sql.NVarChar(sql.MAX), m.notes ?? null);
}

/** Insert a new member row. `m` carries accountId, isPrimary, memberType, source + person fields. */
async function insertMember(m) {
  const pool = await getPool();
  const req = bindMemberFields(pool.request(), m)
    .input("account_id", sql.Int, m.accountId)
    .input("is_primary", sql.Bit, m.isPrimary ? 1 : 0)
    .input("member_type", sql.VarChar(10), m.memberType)
    .input("source", sql.VarChar(10), m.source)
    .input("status", sql.VarChar(10), m.status || "active");
  const r = await req.query(`
    INSERT INTO dbo.members
      (account_id, is_primary, member_type, source, status, category, first_name, last_name,
       dob, gender, nationality, birthplace, national_register_no, emergency_contact,
       medical_notes, playing_role, batting_hand, bowling_style, experience,
       previous_club, prior_federation, student_id, heard_via, notes)
    OUTPUT inserted.id AS id
    VALUES
      (@account_id, @is_primary, @member_type, @source, @status, @category, @first_name, @last_name,
       @dob, @gender, @nationality, @birthplace, @national_register_no, @emergency_contact,
       @medical_notes, @playing_role, @batting_hand, @bowling_style, @experience,
       @previous_club, @prior_federation, @student_id, @heard_via, @notes);
  `);
  return r.recordset[0].id;
}

/**
 * Activate a pending member. member_type is derived from the source form
 * (register -> regular, otherwise trial), per the requirement. Returns the
 * activated row {id, account_id, first_name, last_name} or null if not found /
 * not pending (idempotent — a second click is a no-op).
 */
async function activateMember(memberId, accountId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, memberId)
    .input("account_id", sql.Int, accountId)
    .query(`
      UPDATE dbo.members
      SET status = 'active',
          member_type = CASE WHEN source = 'register' THEN 'regular' ELSE 'trial' END
      OUTPUT inserted.id, inserted.account_id, inserted.first_name, inserted.last_name,
             inserted.member_type, inserted.category
      WHERE id = @id AND account_id = @account_id AND status = 'pending';
    `);
  return r.recordset[0] || null;
}

/** Fetch a member's account + name/status (for the approval landing message). */
async function getMemberBrief(memberId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, memberId)
    .query("SELECT TOP 1 id, account_id, first_name, last_name, status FROM dbo.members WHERE id = @id");
  return r.recordset[0] || null;
}

/** Upgrade a member to regular (trial -> regular) and refresh their details. */
async function upgradeMemberToRegular(id, m) {
  const pool = await getPool();
  await bindMemberFields(pool.request(), m)
    .input("id", sql.Int, id)
    .query(`
      UPDATE dbo.members SET
        member_type          = 'regular',
        status               = 'active',
        source               = 'register',
        category             = COALESCE(@category, category),
        dob                  = COALESCE(@dob, dob),
        gender               = COALESCE(@gender, gender),
        nationality          = COALESCE(@nationality, nationality),
        birthplace           = COALESCE(@birthplace, birthplace),
        national_register_no = COALESCE(@national_register_no, national_register_no),
        emergency_contact    = COALESCE(@emergency_contact, emergency_contact),
        medical_notes        = COALESCE(@medical_notes, medical_notes),
        playing_role         = COALESCE(@playing_role, playing_role),
        batting_hand         = COALESCE(@batting_hand, batting_hand),
        bowling_style        = COALESCE(@bowling_style, bowling_style),
        experience           = COALESCE(@experience, experience),
        previous_club        = COALESCE(@previous_club, previous_club),
        prior_federation     = COALESCE(@prior_federation, prior_federation),
        student_id           = COALESCE(@student_id, student_id),
        heard_via            = COALESCE(@heard_via, heard_via),
        notes                = COALESCE(@notes, notes)
      WHERE id = @id;
    `);
}

/** Idempotently ensure an email is subscribed to the newsletter (clears unsubscribed_at). */
async function subscribeEmail(email, lang) {
  const pool = await getPool();
  await pool
    .request()
    .input("email", sql.NVarChar(255), String(email).trim().toLowerCase())
    .input("lang", sql.Char(2), lang || null)
    .query(`
      MERGE dbo.subscriber AS t
      USING (SELECT @email AS email) AS s ON t.email = s.email
      WHEN MATCHED THEN UPDATE SET unsubscribed_at = NULL, lang = @lang
      WHEN NOT MATCHED THEN INSERT (email, lang) VALUES (@email, @lang);
    `);
}

module.exports = {
  sql, getPool, emailExists,
  findOrCreateAccount, findAccountByEmail, findMember, findMemberByName, accountHasMembers,
  insertMember, upgradeMemberToRegular, activateMember, getMemberBrief, subscribeEmail
};
