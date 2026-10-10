/* PollSlide — the interface language for the app's secondary pages (2026-10-07).
 * ---------------------------------------------------------------------------
 * presenter.html has its own copy of this machinery; the Present studio, reports, results,
 * recap and overlay pages had none, so they stayed English whatever the presenter chose.
 * This is the same contract, shared, and it needs ui-lang.js loaded first (the dictionary).
 *
 *   • Which language: the presenter's own choice (localStorage ps_ui_lang) if there is one,
 *     else the browser's language, else English — exactly what presenter.html does.
 *   • tr('English') → the translation, or the English unchanged when there is none.
 *     English output is the input itself, so an English page is byte-for-byte what it was.
 *   • trf('Question {n} of {m}', {n, m}) for numbers; trp(n, '{n} vote', '{n} votes') for
 *     singular/plural; trk(key, 'English') when one English word means two things.
 *   • Markup: <span data-i18n>English</span>, data-i18n-title, data-i18n-ph (placeholder).
 *   • Buttons and <option>s are translated by exact dictionary match, so a control written
 *     in a template literal needs no tag. Anything inside [data-noi18n] is never touched —
 *     that is where a deck title, a question or a player's name goes.
 * Never defines a name a page already has. */
(function () {
  'use strict';
  var LANGS = { en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', pt: 'Português', it: 'Italiano',
                nl: 'Nederlands', ja: '日本語', zh: '中文', ar: 'العربية', hi: 'हिन्दी' };
  var lang = (function () {
    try {
      var saved = localStorage.getItem('ps_ui_lang');
      if (saved && LANGS[saved]) return saved;
      var nav = (navigator.language || navigator.userLanguage || 'en').slice(0, 2).toLowerCase();
      return LANGS[nav] ? nav : 'en';
    } catch (e) { return 'en'; }
  })();
  var dict = function () { return (window.PS_UI && window.PS_UI[lang]) || null; };

  function tr(en) {
    if (lang === 'en') return en;
    var d = dict(), v = d && d[String(en).trim()];
    return v == null ? en : v;
  }
  function trk(key, en) {
    if (lang === 'en') return en;
    var d = dict(), v = d && d[key];
    return v == null ? en : v;
  }
  function trf(en, vars) {
    var s = tr(en);
    for (var k in (vars || {})) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }
  function trp(n, one, many, vars) {
    var v = { n: n }; for (var k in (vars || {})) v[k] = vars[k];
    return trf(n === 1 ? one : many, v);
  }

  var NO_TR = '[data-noi18n]';
  var GLYPH = /^([^\p{L}\p{N}]*\s*)(.*)$/u;
  function translateText(t) {
    var out = tr(t);
    if (out === t) {
      var m = GLYPH.exec(t);
      if (m && m[1] && m[2]) { var inner = tr(m[2]); if (inner !== m[2]) out = m[1] + inner; }
    }
    return out;
  }
  function apply(root) {
    if (lang === 'en') return;
    root = root || document;
    root.querySelectorAll('[data-i18n=""]').forEach(function (el) {   // keyed tags (data-i18n="more.deck") belong to a page's own system
      if (el.closest(NO_TR)) return;
      if (el._psEn === undefined || (el.textContent !== el._psOut && !el.children.length)) el._psEn = el.textContent;
      var out = tr(el._psEn);
      el._psOut = out;
      if (el.textContent !== out) el.textContent = out;
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      if (el._psTitle === undefined) el._psTitle = el.getAttribute('title') || '';
      el.setAttribute('title', tr(el._psTitle));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      if (el._psPh === undefined) el._psPh = el.getAttribute('placeholder') || '';
      el.setAttribute('placeholder', tr(el._psPh));
    });
    root.querySelectorAll('button, [role="button"], option, summary, legend, th').forEach(function (el) {
      if (el.closest(NO_TR) || el.closest('[data-i18n]')) return;
      el.childNodes.forEach(function (node) {
        if (node.nodeType !== 3 || !node.nodeValue.trim()) return;
        if (node._psEn === undefined) node._psEn = node.nodeValue;
        var raw = node._psEn, t = raw.trim(), out = translateText(t);
        if (out === t) return;
        var v = raw.replace(t, out);
        if (node.nodeValue !== v) node.nodeValue = v;
      });
      if (el.hasAttribute('title')) {
        if (el._psCtrlTitle === undefined) el._psCtrlTitle = el.getAttribute('title');
        el.setAttribute('title', tr(el._psCtrlTitle));
      }
    });
  }
  function watch() {
    if (lang === 'en' || !window.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return; pending = true;
      Promise.resolve().then(function () { pending = false; apply(document); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.PS_TR = { lang: lang, langs: LANGS, tr: tr, trf: trf, trp: trp, trk: trk, apply: apply };
  if (typeof window.tr !== 'function') window.tr = tr;
  if (typeof window.trf !== 'function') window.trf = trf;
  if (typeof window.trp !== 'function') window.trp = trp;
  if (typeof window.trk !== 'function') window.trk = trk;
  var start = function () { try { document.documentElement.lang = lang; if (window.PSLangDir) PSLangDir(lang); } catch (e) {} apply(document); watch(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
