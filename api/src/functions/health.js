"use strict";
const { app } = require("@azure/functions");
const { getPool } = require("../shared/db");

/**
 * GET /api/health
 * Lightweight liveness check that also touches the database. Handy for uptime
 * monitors and for "warming" the Azure SQL serverless database, which
 * auto-pauses after 60 minutes idle and then needs 30-60s to resume.
 * Public (no JWT): it exposes nothing beyond up/down.
 */
app.http("health", {
  route: "health",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const started = Date.now();
    try {
      const pool = await getPool();
      await pool.request().query("SELECT 1 AS ok");
      return {
        status: 200,
        jsonBody: { status: "ok", db: "up", ms: Date.now() - started }
      };
    } catch (err) {
      context.error("health check failed", err);
      return {
        status: 503,
        jsonBody: { status: "degraded", db: "down", ms: Date.now() - started }
      };
    }
  }
});
