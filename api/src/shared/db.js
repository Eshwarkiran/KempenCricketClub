"use strict";
const sql = require("mssql");

let poolPromise;

/** Lazily create (and reuse) one connection pool per function host. */
function getPool() {
  if (!poolPromise) {
    poolPromise = sql
      .connect({
        server: process.env.SQL_SERVER,
        database: process.env.SQL_DATABASE || "KempenCricketClub",
        user: process.env.SQL_USER || "controller",
        password: process.env.SQL_PASSWORD,
        options: { encrypt: true, trustServerCertificate: false },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
        connectionTimeout: 15000,
        requestTimeout: 15000
      })
      .catch((err) => {
        poolPromise = undefined; // allow retry on next invocation
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
