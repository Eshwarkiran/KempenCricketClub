"use strict";
const crypto = require("crypto");

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

/** Basic authentication. Returns null when OK, or a 401 response object. */
function requireBasicAuth(request) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return { status: 500, jsonBody: { error: "Auth not configured" } };
  }
  const header = request.headers.get("authorization") || "";
  const match = /^Basic\s+(.+)$/i.exec(header);
  let ok = false;
  if (match) {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx > -1) {
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      ok = safeEqual(user, expectedUser) & safeEqual(pass, expectedPass);
    }
  }
  if (!ok) {
    return {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="kcc-api"' },
      jsonBody: { error: "Unauthorized" }
    };
  }
  return null;
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

const ok = { status: 200, jsonBody: { success: true } };

function badRequest(message) {
  return { status: 400, jsonBody: { success: false, error: message } };
}

module.exports = { requireBasicAuth, readJson, str, bool, isEmail, dateOrNull, langOf, ok, badRequest };
