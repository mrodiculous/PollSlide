/* PollSlide environment switch — PRODUCTION vs SANDBOX.
 * ---------------------------------------------------------------------------
 * Loaded right after the Firebase SDK on every app page, BEFORE any page calls
 * firebase.initializeApp().
 *
 * PRODUCTION (app.pollslide.com, pollslide.com): does nothing but set
 *   window.PS_ENV = { name:'production', appOrigin:'https://app.pollslide.com' }.
 *   Every page behaves exactly as it did before this file existed.
 *
 * SANDBOX (any other host — Vercel preview URLs, staging.pollslide.com — or localhost
 *   with ?sandbox=1): every firebase.initializeApp() call is pointed at the SANDBOX
 *   Firebase project below, QR/answer links point at this same host, and a yellow
 *   SANDBOX ribbon is shown. Nothing a sandbox build does can reach live data.
 *
 * FAIL CLOSED: on a sandbox host with no sandbox project configured (or with the LIVE
 *   project pasted in by mistake), Firebase refuses to start and the page says why.
 *   A test build must never silently fall back to production.
 *
 * localhost without ?sandbox=1 behaves as production (unchanged local workflow).
 * Setup steps: docs/SANDBOX.md
 */
(function () {
  var LIVE_ORIGIN = 'https://app.pollslide.com';
  var PROD_HOSTS = ['app.pollslide.com', 'pollslide.com', 'www.pollslide.com'];
  var host = location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1';
  var wantSandbox = /[?&]sandbox=1(&|$)/.test(location.search);
  var isProd = PROD_HOSTS.indexOf(host) !== -1 || (isLocal && !wantSandbox);

  if (isProd) { window.PS_ENV = { name: 'production', appOrigin: LIVE_ORIGIN }; return; }

  // ── Paste the SANDBOX Firebase project's web config here ──────────────────
  // Firebase console → the sandbox project → Project settings → Your apps → Config.
  // It must be a DIFFERENT project from echonest-live-survey.
  var SANDBOX = {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  };

  var configured = !!(SANDBOX.apiKey && SANDBOX.databaseURL && SANDBOX.projectId) &&
                   !/echonest-live-survey/.test(SANDBOX.databaseURL + SANDBOX.projectId);
  window.PS_ENV = { name: 'sandbox', appOrigin: location.origin, configured: configured };

  function whenBody(fn) {
    if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn);
  }

  if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    var original = firebase.initializeApp.bind(firebase);
    firebase.initializeApp = function (_liveConfig, name) {
      if (!configured) throw new Error('PollSlide SANDBOX is not configured — refusing to connect to live data. See docs/SANDBOX.md.');
      var cfg = {}; for (var k in SANDBOX) cfg[k] = SANDBOX[k];
      return original(cfg, name);
    };
  }

  whenBody(function () {
    if (!configured) {
      var b = document.createElement('div');
      b.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#1a1300;color:#ffd666;display:flex;align-items:center;justify-content:center;padding:24px;font:600 16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;';
      b.textContent = 'SANDBOX not configured. This is a test build, and it is refusing to connect to live PollSlide data. Add the sandbox Firebase project to ps-env.js (see docs/SANDBOX.md).';
      document.body.appendChild(b);
      return;
    }
    var r = document.createElement('div');
    r.textContent = 'SANDBOX — test data only';
    r.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:2147483646;background:#ffd666;color:#1a1300;font:800 11px/1 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.06em;padding:6px 10px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none;';
    document.body.appendChild(r);
  });
})();
