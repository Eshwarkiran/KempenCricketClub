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

module.exports = { sql, getPool };
