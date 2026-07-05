/* Kempen Cricket Club — cookie consent banner
   Self-contained, no dependencies. Include on every page with:
   <script src="assets/cookie-consent.js" defer></script>
   Remembers the visitor's choice and only enables analytics after opt-in.
   Public API: window.KCCCookies.reopen()  — re-show the banner (used by the Cookie Policy page).
   Analytics hook: listen for  document.addEventListener('kcc-analytics-consent', ...)  or check window.KCCCookies.analyticsAllowed(). */
(function () {
  "use strict";
  var STORAGE_KEY = "kcc-cookie-consent";
  var VERSION = 1; // bump to re-ask everyone after a material change

  function read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }
  function save(analytics) {
    var data = { v: VERSION, analytics: !!analytics, ts: new Date().toISOString() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    if (analytics) enableAnalytics();
  }
  function analyticsAllowed() {
    var c = read();
    return !!(c && c.v === VERSION && c.analytics);
  }
  function enableAnalytics() {
    // Fires once consent is given. Wire your analytics loader here (e.g. Application Insights / Plausible).
    document.dispatchEvent(new CustomEvent("kcc-analytics-consent"));
  }

  function injectStyles() {
    if (document.getElementById("kcc-cc-style")) return;
    var css = ""
      + "#kcc-cc{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:720px;margin:0 auto;"
      + "background:#fff;color:#111;border:1px solid rgba(17,17,17,.12);border-radius:14px;"
      + "box-shadow:0 12px 40px rgba(17,17,17,.18);padding:20px 22px;font-family:'Hanken Grotesk',system-ui,sans-serif;"
      + "opacity:0;transform:translateY(12px);transition:opacity .25s ease,transform .25s ease}"
      + "#kcc-cc.in{opacity:1;transform:none}"
      + "#kcc-cc h2{font-family:'Space Grotesk',system-ui,sans-serif;font-size:17px;margin:0 0 6px}"
      + "#kcc-cc p{font-size:14.5px;line-height:1.5;margin:0 0 14px;color:#333}"
      + "#kcc-cc a{color:#1F4A36;text-decoration:underline}"
      + "#kcc-cc .kcc-cc-row{display:flex;gap:10px;flex-wrap:wrap}"
      + "#kcc-cc button{font-family:inherit;font-size:14.5px;font-weight:600;border-radius:9px;padding:10px 18px;cursor:pointer;border:1px solid transparent}"
      + "#kcc-cc .kcc-accept{background:#1F4A36;color:#fff}"
      + "#kcc-cc .kcc-accept:hover{background:#173a2a}"
      + "#kcc-cc .kcc-decline{background:#fff;color:#1F4A36;border-color:rgba(31,74,54,.35)}"
      + "#kcc-cc .kcc-decline:hover{background:#f4f7f5}"
      + "#kcc-cc:focus{outline:3px solid #FCC200}"
      + "@media(max-width:520px){#kcc-cc .kcc-cc-row button{flex:1 1 100%}}";
    var s = document.createElement("style");
    s.id = "kcc-cc-style"; s.textContent = css;
    document.head.appendChild(s);
  }

  var T = {
    en: {
      label: "Cookie consent",
      h: "We value your privacy",
      p: 'We use essential cookies to make this site work. With your permission we also use privacy-friendly ' +
         'analytics to improve it. We never use advertising cookies. See our ' +
         '<a href="cookies.html">Cookie Policy</a> and <a href="privacy.html">Privacy Policy</a>.',
      accept: "Accept all",
      decline: "Decline non-essential"
    },
    nl: {
      label: "Cookietoestemming",
      h: "We respecteren je privacy",
      p: 'We gebruiken essentiële cookies om deze site te laten werken. Met jouw toestemming gebruiken we ook ' +
         'privacyvriendelijke statistieken om de site te verbeteren. We gebruiken nooit advertentiecookies. Zie ons ' +
         '<a href="cookies.html">Cookiebeleid</a> en <a href="privacy.html">Privacybeleid</a>.',
      accept: "Alles accepteren",
      decline: "Niet-essentiële weigeren"
    }
  };
  function lang() { return (document.documentElement.lang || "en").toLowerCase().indexOf("nl") === 0 ? "nl" : "en"; }

  function build() {
    injectStyles();
    var t = T[lang()];
    var el = document.createElement("div");
    el.id = "kcc-cc";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", t.label);
    el.setAttribute("tabindex", "-1");
    el.innerHTML =
      '<h2>' + t.h + '</h2>' +
      '<p>' + t.p + '</p>' +
      '<div class="kcc-cc-row">' +
      '<button class="kcc-accept" type="button">' + t.accept + '</button>' +
      '<button class="kcc-decline" type="button">' + t.decline + '</button>' +
      '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("in"); });
    el.querySelector(".kcc-accept").addEventListener("click", function () { save(true); dismiss(el); });
    el.querySelector(".kcc-decline").addEventListener("click", function () { save(false); dismiss(el); });
    setTimeout(function () { try { el.focus(); } catch (e) {} }, 300);
  }

  function dismiss(el) {
    el.classList.remove("in");
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 260);
  }

  function init() {
    var c = read();
    if (c && c.v === VERSION) { if (c.analytics) enableAnalytics(); return; }
    build();
  }

  window.KCCCookies = {
    reopen: function () { var ex = document.getElementById("kcc-cc"); if (!ex) build(); },
    analyticsAllowed: analyticsAllowed
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
