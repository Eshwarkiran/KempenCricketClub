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
  const allowed = { members: "dbo.members", subscriber: "dbo.subscriber", contact: "dbo.contact" };
  const target = allowed[table];
  if (!target) throw new Error("emailExists: unknown table " + table);
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(255), email)
    .query(`SELECT TOP 1 1 AS hit FROM ${target} WHERE LOWER(email) = LOWER(@email)`);
  return result.recordset.length > 0;
}

/**
 * Case-insensitive check for whether a member of a specific member_type exists
 * (e.g. "regular" or "trial"). Lets a trial member register as a regular member
 * with the same email, while still blocking a second regular registration.
 */
async function memberExists(email, memberType) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(255), email)
    .input("member_type", sql.VarChar(10), memberType)
    .query(
      "SELECT TOP 1 1 AS hit FROM dbo.members WHERE LOWER(email) = LOWER(@email) AND member_type = @member_type"
    );
  return result.recordset.length > 0;
}

module.exports = { sql, getPool, emailExists, memberExists };
