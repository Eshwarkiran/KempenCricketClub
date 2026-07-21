"use strict";
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // still do a comparison to keep timing uniform
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

const JWT_ALG = "HS256";
const JWT_ISSUER = "kcc-api";
const JWT_AUDIENCE = "kcc-forms";

/** Sign a short-lived HS256 access token. Throws if JWT_SECRET is missing. */
function signToken(payload = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  const expiresIn = process.env.JWT_EXPIRES_IN || "15m";
  return jwt.sign(payload, secret, {
    algorithm: JWT_ALG,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn
  });
}

/** JWT Bearer authentication. Returns null when OK, or a 401 response object. */
function requireJwt(request) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return { status: 500, jsonBody: { error: "Auth not configured" } };
  }
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) {
    try {
      jwt.verify(match[1].trim(), secret, {
        algorithms: [JWT_ALG],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE
      });
      return null;
    } catch {
      // invalid / expired token → fall through to 401
    }
  }
  // No WWW-Authenticate header: this is a fetch()-based API, and a challenge
  // header would trigger the browser's native login dialog.
  return {
    status: 401,
    jsonBody: { error: "Unauthorized" }
  };
}

/**
 * Validate client credentials for the /token endpoint against
 * BASIC_AUTH_USER / BASIC_AUTH_PASSWORD. Returns true/false.
 */
function checkClientCredentials(username, password) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  if (username == null || password == null) return false;
  // bitwise & (not &&) so both comparisons always run — uniform timing.
  return Boolean(safeEqual(username, expectedUser) & safeEqual(password, expectedPass));
}

/** Parse JSON body; returns {} on failure. */
async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

/** Trim + truncate a string field; empty → null. */
function str(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

/** Checkbox / boolean coercion ("on" comes from FormData). */
function bool(v) {
  return v === true || v === "on" || v === "true" || v === "1" || v === "yes";
}

/** Very light email sanity check. */
function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/** "YYYY-MM-DD" → same string if a valid date, else null. */
function dateOrNull(v) {
  const s = str(v, 10);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

function langOf(body) {
  return body.lang === "nl" ? "nl" : "en";
}

/**
 * Normalise a free-text membership category (EN or NL, e.g. "Adult (17+)",
 * "Jeugd (≤16)", "Thomas More student", "Steunend lid (€25)") down to a small
 * canonical set stored in the DB: adult | junior | supporter | student.
 * Returns null for anything unrecognised.
 */
function normalizeCategory(v) {
  const s = str(v);
  if (!s) return null;
  const l = s.toLowerCase();
  if (l.includes("junior") || l.includes("jeugd")) return "junior";
  if (l.includes("student")) return "student";
  if (l.includes("support") || l.includes("steunend")) return "supporter";
  if (l.includes("adult") || l.includes("volwassene")) return "adult";
  return null;
}

/**
 * Verify a Cloudflare Turnstile token. Resolves to true when the challenge
 * passed. If TURNSTILE_SECRET is not configured (e.g. local dev / API testing)
 * verification is skipped and returns true. Turnstile is pass/fail (no score).
 */
async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // not configured → don't block (dev / Bruno)
  if (!token) return false;
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteIp) params.set("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    const data = await res.json();
    if (data.success !== true) {
      // Common codes: invalid-input-secret (wrong/mistyped secret),
      // invalid-input-response (bad, expired or wrong-hostname token),
      // timeout-or-duplicate (token already used).
      console.error("turnstile: verification failed:", JSON.stringify(data["error-codes"] || data));
    }
    return data.success === true;
  } catch (err) {
    console.error("turnstile: verifier request failed:", err && err.message);
    return false; // fail closed on verifier error
  }
}

const ok = { status: 200, jsonBody: { success: true } };

function badRequest(message) {
  return { status: 400, jsonBody: { success: false, error: message } };
}

/**
 * Sign an unsubscribe token for an email (HMAC-SHA256 over the lowercased
 * address, keyed by JWT_SECRET). Lets one-click unsubscribe links work without
 * a Bearer token, while still being unforgeable.
 */
function signUnsubToken(email) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(String(email).trim().toLowerCase())
    .digest("base64url");
}

/** Constant-time verification of an unsubscribe token. */
function verifyUnsubToken(email, token) {
  const expected = signUnsubToken(email);
  if (!expected || !token) return false;
  return safeEqual(String(token), expected);
}

/** 409 — used when an email already exists. Carries a machine-readable code. */
function conflict(message) {
  return { status: 409, jsonBody: { success: false, error: message, code: "email_exists" } };
}

/** 403 — used when captcha verification fails. */
function captchaFailed() {
  return { status: 403, jsonBody: { success: false, error: "Captcha verification failed", code: "captcha_failed" } };
}

module.exports = {
  requireJwt, signToken, checkClientCredentials, readJson,
  str, bool, isEmail, dateOrNull, langOf, normalizeCategory,
  verifyTurnstile, signUnsubToken, verifyUnsubToken,
  ok, badRequest, conflict, captchaFailed
};
