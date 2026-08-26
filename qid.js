/* PollSlide — stable question identity.
 * ---------------------------------------------------------------------------
 * THE BUG THIS FIXES
 * A question's response bucket was `q<index>_stable_<sessionCode>` — derived from the
 * question's POSITION in the array. So the moment anyone reordered or deleted a
 * question, the answers stayed with the slot instead of the question:
 *
 *   moveQ(0,1)      → question A now reads B's answers, and B reads A's
 *   deleteQ(0)      → every later question inherits its neighbour's answers
 *
 * Reports, recaps and tallies all read those same buckets, so the damage is silent
 * and permanent. It also made collaborative editing impossible: two people
 * reordering concurrently would scramble attribution unpredictably.
 *
 * THE FIX, WITH NO DATA MIGRATION
 * Every question gets a permanent `id`. For questions that already exist, the id we
 * backfill is literally `q<currentIndex>_stable` — so `id + '_' + code` produces a
 * key BYTE-IDENTICAL to the one their answers are already stored under. Nothing is
 * copied, nothing is deleted, every past session and report still resolves.
 *
 * From that moment the id travels with the question. Reordering moves the question,
 * not its answers.
 *
 * New questions get a genuinely fresh id, so they never collide with a backfilled one.
 * --------------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.PSQid) return;

  window.PSQid = {
    /* The Firebase key for one question's responses:
     *   sessions/<code>/responses/<bucket>
     * `idx` is only used for questions that predate ids — which, after backfill,
     * means questions loaded by a page that hasn't saved yet. */
    bucket: function (q, idx, code) {
      var id = (q && q.id) ? q.id : ('q' + idx + '_stable');
      return id + '_' + code;
    },

    /* Give every question an id, using its CURRENT index so the derived bucket
     * matches the legacy key exactly. Returns true if anything changed, so the
     * caller knows whether it needs to save. Idempotent. */
    backfill: function (questions) {
      var changed = false;
      (questions || []).forEach(function (q, i) {
        if (q && typeof q === 'object' && !q.id) { q.id = 'q' + i + '_stable'; changed = true; }
      });
      return changed;
    },

    /* An id for a brand-new question. Deliberately unlike the backfill format so a
     * new question can never be mistaken for, or collide with, a legacy slot. */
    fresh: function () {
      return 'qz' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    /* Was this id assigned by backfill (i.e. it encodes an original position)? */
    isLegacy: function (id) { return /^q\d+_stable$/.test(String(id || '')); },
  };
})();
