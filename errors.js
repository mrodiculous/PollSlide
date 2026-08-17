/* PollSlide — client-side error reporting.
 * ---------------------------------------------------------------------------
 * WHY: there was NO error reporting of any kind. A page could throw on load for
 * every user and nobody would know until someone emailed — which is exactly how the
 * team-play button stayed unusable. This makes broken pages surface on their own.
 *
 * Design constraints, because this runs on an audience's phone mid-session:
 *   • Never let reporting break the page. Everything is wrapped and failure-silent.
 *   • Never flood. Deduped by message+location, hard-capped per page load.
 *   • No personal data. The message, source location and page — never answer text,
 *     never who the user is.
 *   • Fire-and-forget. Nothing awaits, nothing blocks rendering.
 *   • No dependencies. Posts to /api/client-error rather than writing to Firebase,
 *     so it still works when the failure *is* that Firebase didn't load. (It also has
 *     to be this way: admin/* is admin-write-only, so a browser write would be denied.)
 *
 * Load it early — before the app's own scripts — so it catches their load errors too.
 * --------------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.__psErrorsInstalled) return;
  window.__psErrorsInstalled = true;

  var MAX_PER_PAGE = 8;         // stop after this many distinct errors in one load
  var sent = {}, count = 0;

  function hash(s) {            // small stable id so repeats collapse client-side too
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
  }

  // Noise we deliberately don't record. These are not our bugs and they would bury
  // the real ones: browser extensions injecting into the page, and the benign
  // ResizeObserver notice Chrome fires during normal layout.
  function ignorable(message, source) {
    if (/^(chrome|moz|safari|webkit)-extension:/.test(source)) return true;
    if (/ResizeObserver loop/i.test(message)) return true;
    return false;
  }

  function report(kind, message, source, line, col, stack) {
    try {
      if (count >= MAX_PER_PAGE) return;
      message = String(message == null ? 'unknown' : message).slice(0, 300);
      source  = String(source || '');
      if (ignorable(message, source)) return;
      source  = source.split('/').pop().slice(0, 120);

      var key = hash(kind + '|' + message + '|' + source + '|' + line);
      if (sent[key]) return;            // already reported this one on this page
      sent[key] = true; count++;

      var body = JSON.stringify({
        kind: kind, message: message, source: source,
        line: line || null, col: col || null,
        stack: stack ? String(stack).slice(0, 600) : null,
        page: (location.pathname || '/').slice(0, 60),
        ver: window.PS_BUILD || null,
      });

      // keepalive so a report survives the navigation that often follows a crash;
      // sendBeacon as the fallback for browsers without fetch keepalive.
      if (window.fetch) {
        fetch('/api/client-error', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: body,
        }).catch(function () {});
      } else if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-error',
          new Blob([body], { type: 'application/json' }));
      }
    } catch (e) { /* reporting must never itself throw */ }
  }

  window.addEventListener('error', function (e) {
    // Resource load failures (img/script 404) surface as error events with no message.
    if (e && e.target && e.target !== window && e.target.src) {
      report('resource', 'Failed to load: ' + e.target.src, e.target.src, 0, 0, null);
      return;
    }
    report('error', e && e.message, e && e.filename, e && e.lineno, e && e.colno,
           e && e.error && e.error.stack);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    report('promise', (r && (r.message || r)) || 'unhandled rejection', '', 0, 0, r && r.stack);
  });

  // Manual hook so app code can log a handled-but-notable problem.
  window.psReportError = function (msg, detail) { report('manual', msg, detail || '', 0, 0, null); };
})();
