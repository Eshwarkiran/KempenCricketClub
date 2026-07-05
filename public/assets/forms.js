/* Kempen Cricket Club — form submission handler (Azure backend)
   Any <form data-endpoint="/api/xxx"> is POSTed as JSON to that Azure Functions
   endpoint. On success the visitor is sent to the (language-aware) thank-you page.
   The backend endpoints are implemented as Azure Functions in the member system
   (see KCC_Member_Management_System_Spec.md) — until they exist, submissions
   fail gracefully with a message to email the club. No third-party form service. */
(function () {
  "use strict";
  /* Basic-auth credential for the form APIs. This lives in public JS, so it is
     NOT a secret — it only blocks unauthenticated bot traffic. Must match the
     BASIC_AUTH_USER / BASIC_AUTH_PASSWORD app settings of the Functions API.
     Never put the SQL credentials here. */
  var API_AUTH = "Basic " + btoa("kccforms:CHANGE_ME_TO_MATCH_APP_SETTING");
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

      fetch(form.getAttribute("data-endpoint"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: API_AUTH },
        body: JSON.stringify(data)
      })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json().catch(function () { return {}; }); })
        .then(function () { window.location.href = thankYou; })
        .catch(function () { if (btn) { btn.disabled = false; btn.textContent = orig; } alert(T.fail); });
    });
  });
})();
