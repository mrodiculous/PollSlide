/* PollSlide — shared presenting display control (full screen + wake lock).
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SHARED FILE
 * Three surfaces put content in front of a room — Presenter's present overlay,
 * Big screen (live.html) and PresentSlide (present.html) — and all three need the
 * same behaviour. present.html already had its own one-line version that called
 * requestFullscreen() unconditionally with no user choice, no prefixed fallback and
 * no wake lock. Three copies of this logic means three different bugs later, so
 * there is one implementation and the pages call into it.
 *
 * THE CONSTRAINT THAT SHAPES EVERYTHING
 * A page cannot hide the browser's tab strip, address bar or menu on its own. Only
 * the Fullscreen API does that, and browsers grant it ONLY during a genuine user
 * gesture. So enter() must be called synchronously from a click or keypress handler —
 * never after an await, a timer, or a Firebase callback, which all spend the gesture.
 *
 * Everything degrades quietly: if full screen is blocked, presenting still works in
 * a window. Losing the browser chrome is a nicety; losing the presentation is not.
 * --------------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.PSDisplay) return;

  var KEY = 'ql_present_display';        // 'fullscreen' | 'window'
  var weWentFullscreen = false;          // did WE turn it on? only then do we turn it off
  var wakeLock = null;
  var isActive = function () { return false; };   // page tells us when it's presenting

  function pref() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'window' || v === 'fullscreen') ? v : 'fullscreen';
    } catch (e) { return 'fullscreen'; }
  }
  function setPref(v) {
    try { localStorage.setItem(KEY, v === 'window' ? 'window' : 'fullscreen'); } catch (e) {}
  }

  function element() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function supported() {
    var el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  // Full screen the WHOLE document, not a single element: fullscreening one node
  // leaves anything rendered outside it (modals, toasts, overlays) invisible.
  function enter() {
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return Promise.resolve(false);
    try {
      // navigationUI:'hide' asks for the most chrome-free result where supported;
      // browsers that don't know the option ignore it rather than throwing.
      var p = fn.call(el, { navigationUI: 'hide' });
      // Safari's webkit version returns undefined instead of a promise.
      return Promise.resolve(p)
        .then(function () { weWentFullscreen = true; return true; })
        .catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function leave() {
    if (!element()) { weWentFullscreen = false; return Promise.resolve(); }
    var fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn) return Promise.resolve();
    try {
      return Promise.resolve(fn.call(document))
        .catch(function () {})
        .then(function () { weWentFullscreen = false; });
    } catch (e) { weWentFullscreen = false; return Promise.resolve(); }
  }

  /* Toggle from a user gesture. onBlocked(msg) is called if the browser refuses, so
   * each page can surface it in its own toast rather than this file guessing. */
  function toggle(onBlocked) {
    if (element()) { setPref('window'); return leave(); }
    return enter().then(function (ok) {
      if (ok) setPref('fullscreen');
      else if (onBlocked) onBlocked('Your browser blocked full screen — press F11 instead.');
      return ok;
    });
  }

  /* A display dimming mid-session is a real failure for a presenting tool. The OS
   * drops the lock whenever the tab is hidden, so it has to be re-acquired on return. */
  function acquireWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return Promise.resolve();
      return navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !wakeLock && isActive()) acquireWakeLock();
  });

  /* Keep a ⛶ button honest however full screen was entered or left — including the
   * presenter pressing F11 or Esc themselves, which we never see as a click. */
  function bindButton(id, opts) {
    opts = opts || {};
    var sync = function () {
      var b = document.getElementById(id);
      if (!b) return;
      var on = !!element();
      b.textContent = on ? (opts.onLabel || '🪟') : (opts.offLabel || '⛶');
      b.title = on ? 'Leave full screen (browser tabs and menu come back)'
                   : 'Go full screen (hides browser tabs and menu)';
    };
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      document.addEventListener(ev, function () { if (!element()) weWentFullscreen = false; sync(); });
    });
    sync();
    return sync;
  }

  /* Esc in full screen is ALWAYS consumed by the browser to restore its chrome, and
   * the keydown still reaches the page. A page that also treats Esc as "stop
   * presenting" would end a live session on one keypress. Returns true if the page
   * should swallow this Esc (i.e. we were full screen and that's what it did). */
  function escapeHandledByFullscreen() {
    if (element()) { weWentFullscreen = false; return true; }
    return false;
  }

  window.PSDisplay = {
    KEY: KEY,
    pref: pref, setPref: setPref,
    supported: supported, element: element,
    enter: enter, leave: leave, toggle: toggle,
    acquireWakeLock: acquireWakeLock, releaseWakeLock: releaseWakeLock,
    bindButton: bindButton,
    escapeHandledByFullscreen: escapeHandledByFullscreen,
    weEntered: function () { return weWentFullscreen; },
    setActiveCheck: function (fn) { if (typeof fn === 'function') isActive = fn; },
  };
})();
