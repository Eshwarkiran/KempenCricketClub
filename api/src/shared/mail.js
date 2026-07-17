"use strict";
const nodemailer = require("nodemailer");

let transporter;

/** Lazily build one SMTP transport. Returns null when SMTP is not configured. */
function getTransport() {
  if (transporter !== undefined) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) {
    transporter = null; // not configured → mail sending is a no-op
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587/STARTTLS
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined
  });
  return transporter;
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
    }
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
    }
  }
};

/**
 * Send a confirmation email. Never throws — returns true/false so a mail
 * failure can't break the form submission. Caller should log the result.
 */
async function sendConfirmation({ to, name, kind, lang }) {
  const t = getTransport();
  if (!t) return false; // SMTP not configured
  const copy = (COPY[lang] || COPY.en)[kind];
  if (!copy) return false;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || "Kempen Cricket Club <contact@kempencricket.be>",
      to,
      subject: copy.subject,
      text: copy.body(name)
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { sendConfirmation };
