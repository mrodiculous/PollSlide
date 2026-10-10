/* PollSlide — audience text can never become markup.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-10-10)
 * Anyone in an audience can write a display name, an open-text answer, a Q&A question and
 * a team name — anonymously, and the database only checks their length. Several screens
 * drew those strings straight into the page. Proven on the stage server: a "name" of
 *   <img src=x onerror=…>
 * ran its script inside the PRESENTER'S SIGNED-IN PAGE (the answer list, the name under
 * it, the participants list). That is a stored cross-site-scripting hole, reachable by any
 * student with the QR code.
 *
 * THE FIX IS ONE CHOKEPOINT, NOT A HUNT FOR SINKS
 * There were two dozen places that read audience data and far more that draw it; escaping
 * each one leaves the next new one open. Every page reads Firebase through
 * DataSnapshot.val(), so this file patches THAT: anything read from an audience-writable
 * part of the database has its angle brackets replaced with look-alike characters
 * (‹ and ›) before any page code ever sees it. No tag can form, whatever draws it —
 * today's code or next year's.
 *
 * WHAT IT TOUCHES — only what the audience can write:
 *   sessions/<code>/responses | qa | teams | attempts | study
 *   users/<uid>/archives               (saved copies of old answers)
 *   loop_answers | loop_scores | loop_react   (LoopSlide: every byte there is a player's)
 * Presenter-authored data (questions, decks, settings) is left exactly as it is.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not touch quotes: choice answers are stored as JSON ("[0,2]") and must still
 * parse. So an audience string must never be placed inside an HTML ATTRIBUTE without
 * escAttr()/escapeHtml() — tests/audience-safe.test.js checks the pages for that.
 *
 * The phone also neutralises brackets before saving (answer.html), but a phone can be
 * bypassed; THIS is the layer that does not depend on the sender. Load it right after the
 * Firebase database script on every page that shows audience text.
 * --------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  var LT = '‹', GT = '›';            // ‹ ›

  function text(s) { return typeof s === 'string' ? s.replace(/</g, LT).replace(/>/g, GT) : s; }

  function clean(v) {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = clean(v[k]); }); return o; }
    return v;
  }

  var SUB = { responses: 1, qa: 1, teams: 1, attempts: 1, study: 1 };   // audience-writable, per session
  var LOOP = { loop_answers: 1, loop_scores: 1, loop_react: 1 };          // audience-only trees (owner can just delete)

  function cleanSession(v) {
    if (!v || typeof v !== 'object') return v;
    var o = {}; Object.keys(v).forEach(function (k) { o[k] = SUB[k] ? clean(v[k]) : v[k]; }); return o;
  }
  function cleanUser(v) {
    if (!v || typeof v !== 'object' || !v.archives) return v;
    var o = {}; Object.keys(v).forEach(function (k) { o[k] = k === 'archives' ? clean(v[k]) : v[k]; }); return o;
  }

  /* Given where a value was read from, neutralise the audience-writable parts of it. */
  function scoped(path, v) {
    if (v === null || v === undefined) return v;
    var p = String(path || '').split('?')[0].replace(/^[a-z]+:\/\/[^/]+/i, '').split('/').filter(Boolean)
      .map(function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } });
    if (LOOP[p[0]]) return clean(v);
    if (p[0] === 'sessions') {
      if (p.length >= 3) return SUB[p[2]] ? clean(v) : v;
      if (p.length === 2) return cleanSession(v);
      if (typeof v !== 'object') return v;
      var all = {}; Object.keys(v).forEach(function (k) { all[k] = cleanSession(v[k]); }); return all;
    }
    if (p[0] === 'users') {
      if (p.length >= 3) return p[2] === 'archives' ? clean(v) : v;
      if (p.length === 2) return cleanUser(v);
    }
    return v;
  }

  /* Patch DataSnapshot.val()/exportVal() once. Works on the real compat SDK and on the
     stage server's stand-in, which exposes its snapshot class under the same name. */
  function install(fb) {
    fb = fb || root.firebase;
    var D = fb && fb.database && fb.database.DataSnapshot;
    if (!D || !D.prototype) return false;
    if (D.prototype.__psSafe) return true;
    ['val', 'exportVal'].forEach(function (name) {
      var orig = D.prototype[name];
      if (typeof orig !== 'function') return;
      D.prototype[name] = function () {
        var v = orig.apply(this, arguments);
        try { return scoped(String(this.ref), v); } catch (e) { return v; }
      };
    });
    D.prototype.__psSafe = true;
    return true;
  }

  var api = { text: text, clean: clean, scoped: scoped, install: install, installed: false };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.PSSafe = api;
    try { api.installed = install(); } catch (e) {}
  }
})(typeof window !== 'undefined' ? window : null);
