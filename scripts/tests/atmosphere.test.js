#!/usr/bin/env node
/* The rules that decide whether a room hears anything. Worth asserting rather than
 * trusting, because the failure mode is a product making noise in someone's meeting. */
const path = require('path');
const A = require(path.resolve(__dirname, '..', '..', 'atmosphere.js'));

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
};

console.log('\nQuiet is the assumption');
/* A deck saved before this existed, a typo, a value from a newer build — all of them
 * must land on silence. Defaulting the other way means a product that starts ticking
 * on a projector in a shared building before anyone chose anything. */
ok('an unset atmosphere is Calm', A.atmosphereFor(undefined).id === 'calm');
ok('null is Calm', A.atmosphereFor(null).id === 'calm');
ok('an unknown id is Calm, not a crash', A.atmosphereFor('disco').id === 'calm');
ok('a stored object is accepted too', A.atmosphereFor({ id: 'gameshow' }).id === 'gameshow');
ok('Calm makes no sound at all',
   !A.ATMOSPHERES.calm.ticks && !A.ATMOSPHERES.calm.pops);
ok('the default really is calm', A.DEFAULT === 'calm');

console.log('\nThree presets, each a real room');
ok('exactly three', A.list().length === 3);
ok('every one has a name, a blurb and who it is for',
   A.list().every(a => a.name && a.blurb && a.bestFor && a.icon));
ok('every one defines all four behaviours',
   A.list().every(a => ['ticks','pops','bigCountdown','revealBuild'].every(k => typeof a[k] === 'boolean')));
/* Classroom is the middle setting and must not tick — that is the whole difference
 * between it and Game show, and the reason a teacher can leave it on all term. */
ok('Classroom hears the room but is not ticked at',
   A.ATMOSPHERES.classroom.pops && !A.ATMOSPHERES.classroom.ticks);
ok('Game show does everything', ['ticks','pops','bigCountdown','revealBuild']
   .every(k => A.ATMOSPHERES.gameshow[k] === true));

console.log('\nThe closing seconds');
ok('silent presets never return a tick', A.tickFor(3, 'calm') === null && A.tickFor(3, 'classroom') === null);
ok('nothing before the last ten seconds', A.tickFor(11, 'gameshow') === null);
ok('the tenth second ticks', !!A.tickFor(10, 'gameshow'));
ok('zero and below are silent — the reveal has its own sound',
   A.tickFor(0, 'gameshow') === null && A.tickFor(-1, 'gameshow') === null);
ok('rubbish input is silent, not NaN', A.tickFor('soon', 'gameshow') === null);
/* Rising pitch is what makes it read as running out rather than as a metronome. */
const f = (s) => A.tickFor(s, 'gameshow').freq;
ok('pitch rises as time runs out', f(10) < f(5) && f(5) < f(3) && f(3) < f(2) && f(2) < f(1));
ok('the last three seconds are their own, louder note',
   A.tickFor(3, 'gameshow').gain > A.tickFor(8, 'gameshow').gain);

console.log('\nDerived timings');
ok('no hold when the preset does not build', A.revealHoldMs('calm') === 0);
ok('a beat, not a wait', A.revealHoldMs('gameshow') > 0 && A.revealHoldMs('gameshow') <= 1200);
ok('big countdown off for Calm', A.bigCountdownFrom('calm') === 0);
ok('big countdown on for the other two',
   A.bigCountdownFrom('classroom') === 5 && A.bigCountdownFrom('gameshow') === 5);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
