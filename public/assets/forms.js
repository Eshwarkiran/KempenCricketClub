/* Kempen Cricket Club — form submission handler (Azure backend)
   Any <form data-endpoint="/api/xxx"> is POSTed as JSON to that Azure Functions
   endpoint. On success the visitor is sent to the (language-aware) thank-you page.
   The backend endpoints are implemented as Azure Functions in the member system
   (see KCC_Member_Management_System_Spec.md) — until they exist, submissions
   fail gracefully with a message to email the club. No third-party form service. */
(function () {
  "use strict";
  /* Client credential for the form APIs. This lives in public JS, so it is
     NOT a secret — it only blocks unauthenticated bot traffic. Must match the
     BASIC_AUTH_USER / BASIC_AUTH_PASSWORD app settings of the Functions API.
     Never put the SQL credentials here.
     Flow: POST these to /api/token to obtain a short-lived Bearer JWT, then
     submit the form with that token. The token is cached and reused until it
     is close to expiry. */
  var CLIENT_USER = "KccFormsController";
  var CLIENT_PASS = "xzUAKKTR9X@H1H%FKVeW";
  var TOKEN_URL = "/api/token";

  var _token = null;       // cached JWT
  var _tokenExp = 0;       // epoch ms when the cached token should be refreshed

  /* Fetch (or reuse) a Bearer token. Resolves to the token string. */
  function getToken() {
    if (_token && Date.now() < _tokenExp) return Promise.resolve(_token);
    return fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: CLIENT_USER, password: CLIENT_PASS })
    })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        _token = d.token;
        // Refresh a minute before the server-side expiry (default 15m).
        var secs = parseInt(d.expires_in, 10);
        if (isNaN(secs)) secs = 900; // "15m" etc. → fall back to 15 min
        _tokenExp = Date.now() + Math.max(secs - 60, 30) * 1000;
        return _token;
      });
  }
  var lang = (document.documentElement.lang || "en").toLowerCase().indexOf("nl") === 0 ? "nl" : "en";
  var thankYou = lang === "nl" ? "/nl/thank-you" : "/thank-you";
  var T = {
    en: { sending: "Sending…", fail: "Sorry, something went wrong. Please email us at contact@kempencricket.be." },
    nl: { sending: "Versturen…", fail: "Sorry, er ging iets mis. Mail ons op contact@kempencricket.be." }
  }[lang];

  document.querySelectorAll("form[data-endpoint]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var btn = form.querySelector('button[type="submit"], button:not([type])');
      var orig = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = T.sending; }

      var data = Object.fromEntries(new FormData(form).entries());
      data.lang = lang;

      getToken()
        .then(function (token) {
          return fetch(form.getAttribute("data-endpoint"), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify(data)
          });
        })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json().catch(function () { return {}; }); })
        .then(function () { window.location.href = thankYou; })
        .catch(function () { if (btn) { btn.disabled = false; btn.textContent = orig; } alert(T.fail); });
    });
  });
})();
