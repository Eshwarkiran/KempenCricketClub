/* Kempen Cricket Club — form submission handler (Azure backend)
   Any <form data-endpoint="/api/xxx"> is POSTed as JSON to that Azure Functions
   endpoint. On success the visitor is sent to the (language-aware) thank-you page.
   Auth: the client credential below is exchanged at /api/token for a short-lived
   Bearer JWT (cached and reused). Cloudflare Turnstile protects join, subscribe
   and contact. window.KCC exposes apiFetch() for other pages. */
(function () {
  "use strict";
  /* Client credential for the form APIs. This lives in public JS, so it is
     NOT a secret — it only blocks unauthenticated bot traffic. Must match the
     BASIC_AUTH_USER / BASIC_AUTH_PASSWORD app settings of the Functions API. */
  var CLIENT_USER = "KccFormsController";
  var CLIENT_PASS = "xzUAKKTR9X@H1H%FKVeW";
  var TOKEN_URL = "/api/token";

  /* Cloudflare Turnstile site key (public). Leave the placeholder to disable
     captcha in dev — the API also skips verification when TURNSTILE_SECRET is
     unset. */
  /* Cloudflare dummy test site key (always passes, works on localhost/any domain).
     Replace with your real, domain-locked site key before go-live. */
  var TURNSTILE_SITE_KEY = "1x00000000000000000000AA";

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
        var secs = parseInt(d.expires_in, 10);
        if (isNaN(secs)) secs = 900;
        _tokenExp = Date.now() + Math.max(secs - 60, 30) * 1000;
        return _token;
      });
  }

  /* POST JSON to an API endpoint with a Bearer token. Returns the fetch Response. */
  function apiFetch(endpoint, data) {
    return getToken().then(function (token) {
      return fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(data)
      });
    });
  }

  // ---- Cloudflare Turnstile (explicit render, execute on submit) ----
  var _tsReady = false;
  var _tsBlocked = false;     // script failed to load (ad blocker / Brave Shields)
  var _tsQueue = [];
  var _tsWidgets = new Map(); // form -> { id, resolve }

  function turnstileEnabled() {
    return TURNSTILE_SITE_KEY && TURNSTILE_SITE_KEY.indexOf("CHANGE_ME") !== 0;
  }

  function flushQueue() { _tsQueue.forEach(function (fn) { fn(); }); _tsQueue = []; }

  function loadTurnstile() {
    if (!turnstileEnabled()) return;
    window.__kccTsOnload = function () { _tsReady = true; flushQueue(); };
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__kccTsOnload";
    s.async = true; s.defer = true;
    // A content blocker prevents onload from ever firing — mark it blocked so
    // submissions fail with a helpful message instead of an empty token.
    s.onerror = function () { _tsBlocked = true; flushQueue(); };
    document.head.appendChild(s);
  }

  function ensureWidget(form) {
    if (_tsWidgets.has(form)) return;
    var box = document.createElement("div");
    box.className = "cf-turnstile-box";
    box.style.marginTop = "10px";
    form.appendChild(box);
    var id = window.turnstile.render(box, {
      sitekey: TURNSTILE_SITE_KEY,
      execution: "execute",         // only run when we call execute()
      appearance: "interaction-only", // show the widget only if a challenge is needed
      callback: function (token) {
        var w = _tsWidgets.get(form);
        if (w && w.resolve) { var r = w.resolve; w.resolve = null; r(token); }
      },
      "error-callback": function () {
        var w = _tsWidgets.get(form);
        if (w && w.resolve) { var r = w.resolve; w.resolve = null; r(""); }
      }
    });
    _tsWidgets.set(form, { id: id, resolve: null });
  }

  /* Resolve a Turnstile token for a form. Resolves to "" when captcha is
     disabled; REJECTS with {kind:"captcha_blocked"} when the widget can't run
     (script blocked by an ad blocker / Brave Shields, or it times out). */
  function getTurnstileToken(form) {
    if (!turnstileEnabled()) return Promise.resolve("");
    return new Promise(function (resolve, reject) {
      var settled = false;
      function ok(token) { if (!settled) { settled = true; resolve(token); } }
      function blocked() { if (!settled) { settled = true; reject({ kind: "captcha_blocked" }); } }
      function go() {
        if (settled) return;
        if (_tsBlocked || !window.turnstile) { blocked(); return; }
        try {
          ensureWidget(form);
          var w = _tsWidgets.get(form);
          w.resolve = function (token) { token ? ok(token) : blocked(); };
          window.turnstile.execute(w.id);
        } catch (e) { blocked(); }
      }
      // A blocked script never fires onload; give it a few seconds then give up.
      setTimeout(function () { if (!settled && !_tsReady) blocked(); }, 6000);
      if (_tsReady && window.turnstile) go();
      else if (_tsBlocked) blocked();
      else _tsQueue.push(go);
    });
  }

  function resetTurnstile(form) {
    var w = _tsWidgets.get(form);
    if (w && window.turnstile) { try { window.turnstile.reset(w.id); } catch (e) {} }
  }

  // Expose for other pages (e.g. the unsubscribe page).
  window.KCC = { getToken: getToken, apiFetch: apiFetch };

  var lang = (document.documentElement.lang || "en").toLowerCase().indexOf("nl") === 0 ? "nl" : "en";
  var thankYou = lang === "nl" ? "/nl/thank-you" : "/thank-you";
  var T = {
    en: {
      sending: "Sending…",
      fail: "Sorry, something went wrong. Please email us at contact@kempencricket.be.",
      exists: "This email is already registered with us.",
      captcha: "We couldn't verify you're human. Please try again.",
      blocked: "Your browser or an extension is blocking our spam protection. Please turn off your ad blocker (or Brave Shields) for this site and try again."
    },
    nl: {
      sending: "Versturen…",
      fail: "Sorry, er ging iets mis. Mail ons op contact@kempencricket.be.",
      exists: "Dit e-mailadres is al bij ons geregistreerd.",
      captcha: "We konden niet verifiëren dat je een mens bent. Probeer opnieuw.",
      blocked: "Je browser of een extensie blokkeert onze spambeveiliging. Schakel je adblocker (of Brave Shields) voor deze site uit en probeer opnieuw."
    }
  }[lang];

  // Endpoints protected by Turnstile.
  var CAPTCHA_ENDPOINTS = {
    "/api/join": true, "/api/register": true, "/api/subscribe": true, "/api/contact": true
  };

  loadTurnstile();

  document.querySelectorAll("form[data-endpoint]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var btn = form.querySelector('button[type="submit"], button:not([type])');
      var orig = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = T.sending; }

      var endpoint = form.getAttribute("data-endpoint");
      var data = Object.fromEntries(new FormData(form).entries());
      data.lang = lang;

      var prep = CAPTCHA_ENDPOINTS[endpoint] ? getTurnstileToken(form) : Promise.resolve("");

      prep
        .then(function (captcha) {
          if (captcha) data.turnstileToken = captcha;
          return apiFetch(endpoint, data);
        })
        .then(function (r) {
          if (r.status === 409) { throw { kind: "exists" }; }
          if (r.status === 403) { throw { kind: "captcha" }; }
          if (!r.ok) { throw { kind: "fail" }; }
          return r.json().catch(function () { return {}; });
        })
        .then(function () { window.location.href = thankYou; })
        .catch(function (err) {
          if (btn) { btn.disabled = false; btn.textContent = orig; }
          resetTurnstile(form);
          var kind = err && err.kind;
          alert(
            kind === "exists" ? T.exists :
            kind === "captcha_blocked" ? T.blocked :
            kind === "captcha" ? T.captcha : T.fail
          );
        });
    });
  });
})();
