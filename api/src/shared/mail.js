"use strict";
const nodemailer = require("nodemailer");
const { signUnsubToken } = require("./http");

/**
 * Two auth modes, chosen with SMTP_AUTH_TYPE:
 *   "basic"  (default) — SMTP_USER / SMTP_PASSWORD. Works with Gmail, Mailgun,
 *                        Brevo, etc.
 *   "oauth2"           — Microsoft 365 XOAUTH2 via Entra client credentials.
 *                        Required because M365 is retiring Basic auth / app
 *                        passwords for SMTP AUTH. Needs MS_TENANT_ID,
 *                        MS_CLIENT_ID, MS_CLIENT_SECRET and SMTP_USER (the
 *                        sending mailbox).
 */

let basicTransport;          // cached transport for basic auth
let tokenCache = { value: null, expiresAt: 0 };

function isOAuth2() {
  return (process.env.SMTP_AUTH_TYPE || "basic").toLowerCase() === "oauth2";
}

/** Fetch (and cache) an Entra access token for Outlook SMTP. */
async function getAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://outlook.office365.com/.default"
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // Surface the AADSTS code (e.g. AADSTS7000215 = bad client secret).
    // The secret itself is never logged.
    console.error("mail: OAuth2 token request failed:", data.error, data.error_description);
    return null;
  }
  tokenCache = {
    value: data.access_token,
    // refresh a minute early
    expiresAt: Date.now() + Math.max((Number(data.expires_in) || 3600) - 60, 30) * 1000
  };
  return tokenCache.value;
}

/** Build a transport. Returns null when mail is not configured. */
async function getTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null; // not configured → mail sending is a no-op

  const common = {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true" // true for 465, false for 587/STARTTLS
  };

  if (isOAuth2()) {
    const accessToken = await getAccessToken();
    if (!accessToken) return null;
    // A fresh transport per token keeps the XOAUTH2 credential current.
    return nodemailer.createTransport({
      ...common,
      auth: { type: "OAuth2", user: process.env.SMTP_USER, accessToken }
    });
  }

  if (!basicTransport) {
    basicTransport = nodemailer.createTransport({
      ...common,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined
    });
  }
  return basicTransport;
}

// Localised confirmation copy. `kind` is "join" or "register".
const COPY = {
  en: {
    join: {
      subject: "We've received your request — Kempen Cricket Club",
      body: (name) =>
        `Hi ${name || "there"},\n\n` +
        "Thanks for signing up for your free taster sessions at Kempen Cricket Club. " +
        "We've received your request and a club volunteer will be in touch shortly to help you book your sessions and tell you what to bring.\n\n" +
        "See you on the pitch!\n\nKempen Cricket Club\ncontact@kempencricket.be"
    },
    register: {
      subject: "We've received your membership registration — Kempen Cricket Club",
      body: (name) =>
        `Hi ${name || "there"},\n\n` +
        "Thanks for registering as a member of Kempen Cricket Club. " +
        "We've received your registration and will confirm your details and the next steps, including how to pay your membership fee.\n\n" +
        "Welcome to the club!\n\nKempen Cricket Club\ncontact@kempencricket.be"
    },
    unsubLine: (url) => `\n\n---\nDon't want club emails? Unsubscribe: ${url}\n`
  },
  nl: {
    join: {
      subject: "We hebben je aanvraag ontvangen — Kempen Cricket Club",
      body: (name) =>
        `Hallo ${name || "daar"},\n\n` +
        "Bedankt voor je inschrijving voor de gratis proefsessies bij Kempen Cricket Club. " +
        "We hebben je aanvraag ontvangen en een vrijwilliger neemt binnenkort contact met je op.\n\n" +
        "Tot op het veld!\n\nKempen Cricket Club\ncontact@kempencricket.be"
    },
    register: {
      subject: "We hebben je lidmaatschapsregistratie ontvangen — Kempen Cricket Club",
      body: (name) =>
        `Hallo ${name || "daar"},\n\n` +
        "Bedankt voor je registratie als lid van Kempen Cricket Club. " +
        "We hebben je registratie ontvangen en bevestigen binnenkort je gegevens en de volgende stappen.\n\n" +
        "Welkom bij de club!\n\nKempen Cricket Club\ncontact@kempencricket.be"
    },
    unsubLine: (url) => `\n\n---\nGeen clubmails meer? Uitschrijven: ${url}\n`
  }
};

/** Build the unsubscribe URLs (page link + one-click POST endpoint). */
function unsubUrls(email, lang) {
  const site = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const token = signUnsubToken(email);
  if (!site || !token) return null;
  const q = `email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
  return {
    page: `${site}${lang === "nl" ? "/nl" : ""}/unsubscribe/?${q}`,
    oneClick: `${site}/api/unsubscribe/one-click?${q}`
  };
}

/**
 * Send a confirmation email. Never throws — returns true/false so a mail
 * failure can't break the form submission. Caller should log the result.
 */
async function sendConfirmation({ to, name, kind, lang }) {
  let t;
  try {
    t = await getTransport();
  } catch (err) {
    console.error("mail: transport creation failed:", err && err.message);
    return false;
  }
  if (!t) return false; // SMTP not configured / token unavailable

  const copy = (COPY[lang] || COPY.en)[kind];
  if (!copy) return false;

  const urls = unsubUrls(to, lang);
  const headers = urls
    ? {
        // RFC 8058 one-click unsubscribe — expected by Gmail/Yahoo bulk rules.
        "List-Unsubscribe": `<${urls.oneClick}>, <${urls.page}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      }
    : undefined;

  const text = copy.body(name) + (urls ? (COPY[lang] || COPY.en).unsubLine(urls.page) : "");

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || "Kempen Cricket Club <contact@kempencricket.be>",
      to,
      subject: copy.subject,
      text,
      headers
    });
    return true;
  } catch (err) {
    // SMTP-level reason, e.g. EAUTH "535 5.7.3 Authentication unsuccessful"
    // or "SmtpClientAuthentication is disabled for the Tenant".
    console.error("mail: sendMail failed:", err && err.code, err && err.message);
    return false;
  }
}

/**
 * Notify the club of a new signup. Sends to ADMIN_EMAIL (default membership@).
 * `kind` is join | register | added. `details` is a flat object of field -> value.
 * Best-effort — returns true/false, never throws.
 */
async function sendAdminNotification({ kind, details }) {
  let t;
  try {
    t = await getTransport();
  } catch (err) {
    console.error("mail: admin transport creation failed:", err && err.message);
    return false;
  }
  if (!t) return false;

  const to = process.env.ADMIN_EMAIL || "membership@kempencricket.be";
  const labels = { join: "trial signup (join)", register: "member registration", added: "added family member" };
  const heading = labels[kind] || kind;

  const lines = Object.entries(details || {})
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || "Kempen Cricket Club <contact@kempencricket.be>",
      to,
      subject: `New ${heading} — ${details.name || details.email || "KCC"}`,
      text: `A new ${heading} was submitted on the website.\n\n${lines}\n`
    });
    return true;
  } catch (err) {
    console.error("mail: admin sendMail failed:", err && err.code, err && err.message);
    return false;
  }
}

// Localised copy for the member-approval link (adding someone to an account).
const APPROVE_COPY = {
  en: {
    subject: "Approve a new member on your account — Kempen Cricket Club",
    body: (name, url) =>
      "Hi,\n\n" + (name ? name + " was" : "Someone was") +
      " added to your Kempen Cricket Club account. To confirm and activate this " +
      "membership, open the link below (it expires in 24 hours):\n\n" +
      url + "\n\nIf you didn't expect this, you can ignore this email — the member " +
      "stays inactive until approved.\n\nKempen Cricket Club"
  },
  nl: {
    subject: "Nieuw lid goedkeuren op je account — Kempen Cricket Club",
    body: (name, url) =>
      "Hallo,\n\n" + (name ? name + " werd" : "Er werd iemand") +
      " toegevoegd aan je Kempen Cricket Club-account. Om dit lidmaatschap te " +
      "bevestigen en te activeren, open onderstaande link (verloopt na 24 uur):\n\n" +
      url + "\n\nVerwachtte je dit niet, negeer deze e-mail dan — het lid blijft " +
      "inactief tot het is goedgekeurd.\n\nKempen Cricket Club"
  }
};

/** Email the member-approval link to the account owner. Best-effort. */
async function sendApprovalLink({ to, name, url, lang }) {
  let t;
  try { t = await getTransport(); } catch (err) {
    console.error("mail: approval-link transport failed:", err && err.message);
    return false;
  }
  if (!t) return false;
  const copy = APPROVE_COPY[lang] || APPROVE_COPY.en;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || "Kempen Cricket Club <contact@kempencricket.be>",
      to, subject: copy.subject, text: copy.body(name, url)
    });
    return true;
  } catch (err) {
    console.error("mail: approval-link sendMail failed:", err && err.code, err && err.message);
    return false;
  }
}

module.exports = { sendConfirmation, sendAdminNotification, sendApprovalLink };
