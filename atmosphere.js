/* PollSlide — how a session FEELS while it runs.
 * ---------------------------------------------------------------------------
 * The game modes decide how points are scored. This decides how the thirty seconds
 * between launching a question and revealing it are experienced — which, until now,
 * was: nothing at all. A 13px grey pill in the corner read "Starting reveal
 * countdown…" and the room sat in silence. That dead stretch is exactly where a game
 * show puts all of its tension.
 *
 * A CHOICE, NOT A BEHAVIOUR. A Year 7 classroom and a board meeting want opposite
 * things from the same product, and neither is wrong. Ticking clocks in a hospital
 * training room are obnoxious; silence in a school hall is flat. So the presenter
 * picks, in the same dialog where they already pick a game mode, and the pick is
 * remembered per deck — your Friday quiz and your Monday board update can differ.
 *
 * THREE, NOT FOUR TOGGLES. Someone choosing this ten seconds before they present does
 * not want a mixing desk; they want to say what kind of room they are in. Each preset
 * names a real audience, and the fine-grained flags are derived from it.
 *
 * Calm is the DEFAULT deliberately. A product that starts making noises on a projector
 * in a shared building, before anyone has chosen anything, has misjudged whose room it
 * is. Loud is opt-in; quiet is the assumption.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSAtmosphere = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const ATMOSPHERES = {
    calm: {
      id: 'calm', icon: '🌿', name: 'Calm',
      blurb: 'No sound, no clock drama. The results simply appear.',
      bestFor: 'Board meetings, webinars, libraries, anywhere a noise would be rude',
      ticks: false, pops: false, bigCountdown: false, revealBuild: false,
    },
    classroom: {
      id: 'classroom', icon: '🎓', name: 'Classroom',
      blurb: 'You hear the room answering, and the last few seconds are unmissable — but nothing ticks at you.',
      bestFor: 'Lessons, training, workshops — most sessions',
      ticks: false, pops: true, bigCountdown: true, revealBuild: true,
    },
    gameshow: {
      id: 'gameshow', icon: '🎤', name: 'Game show',
      blurb: 'Ticking clock that speeds up, answers landing audibly, and a held beat before the reveal.',
      bestFor: 'Quiz nights, conferences, a finale, waking up a flat room',
      ticks: true, pops: true, bigCountdown: true, revealBuild: true,
    },
  };

  const DEFAULT = 'calm';

  /* Anything unrecognised — an old deck with no setting, a typo, a value from a newer
     version — lands on the quiet default rather than surprising a room with noise. */
  function atmosphereFor(raw) {
    const id = typeof raw === 'string' ? raw : (raw && raw.id);
    return ATMOSPHERES[id] || ATMOSPHERES[DEFAULT];
  }

  /* The tick pattern for the closing seconds. Returns null when there is nothing to
     play, so the caller never has to know the rules.
     The interval TIGHTENS and the pitch RISES as it runs out: an even tick is a metronome
     and reads as waiting, while an accelerating one reads as running out of time. The
     last three seconds get their own higher note so "nearly over" is audible without
     watching the screen. */
  function tickFor(secondsLeft, atmos) {
    const a = atmosphereFor(atmos);
    if (!a.ticks) return null;
    const s = Number(secondsLeft);
    if (!Number.isFinite(s) || s <= 0 || s > 10) return null;
    if (s <= 3) return { freq: 880 + (4 - s) * 110, dur: 0.09, gain: 0.10, type: 'square' };
    if (s <= 5) return { freq: 660, dur: 0.07, gain: 0.08, type: 'triangle' };
    return { freq: 520, dur: 0.06, gain: 0.05, type: 'triangle' };
  }

  /* How long to hold before the answer lands. Long enough to be a beat, short enough
     that nobody presenting to adults feels the product is wasting their time. */
  const revealHoldMs = (atmos) => (atmosphereFor(atmos).revealBuild ? 800 : 0);

  /* Whether the closing seconds take over the screen, and from when. */
  const bigCountdownFrom = (atmos) => (atmosphereFor(atmos).bigCountdown ? 5 : 0);

  return {
    ATMOSPHERES, DEFAULT, atmosphereFor, tickFor, revealHoldMs, bigCountdownFrom,
    list: () => Object.values(ATMOSPHERES),
  };
});
