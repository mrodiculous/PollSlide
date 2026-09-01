#!/usr/bin/env node
/* The demo deck's pictures are hardcoded third-party URLs, so they can rot. These
 * assert the repair does the safe thing — especially the two ways it could quietly go
 * wrong: promoting a link that is also dead, and blanking pictures because our own
 * probe failed rather than because the image did. */
const path = require('path');
const M = require(path.resolve(__dirname, '..', '..', 'lib', 'starter-media-check.js'));

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
};

const rec = (url, alts) => ({ url, still: url + '_s', alt: 'a koala', term: 'koala',
                              source: 'giphy', id: url, alts: alts || [] });
const spare = (url) => ({ url, still: url + '_s', alt: 'another koala', id: url });

console.log('\nWhat gets checked');
{
  const media = { q0: rec('a', [spare('a2'), spare('a3')]), q0o1: rec('b') };
  const urls = M.urlsToCheck(media);
  ok('primaries and spares are all checked', urls.length === 4);
  ok('spares are included, so a repair never promotes a link that is also dead',
     urls.includes('a2') && urls.includes('a3'));
  ok('duplicates are collapsed',
     M.urlsToCheck({ x: rec('same'), y: rec('same') }).length === 1);
  ok('an empty map asks for nothing', M.urlsToCheck({}).length === 0 && M.urlsToCheck(null).length === 0);
}

console.log('\nA dead link is replaced by a vetted spare');
{
  const media = { q0: rec('dead', [spare('good'), spare('also-good')]) };
  const plan = M.planMediaRepair(media, { dead: false, good: true, 'also-good': true });
  ok('the slot is repaired, not blanked', plan.repaired.length === 1 && !plan.blanked.length);
  ok('the promoted spare becomes the url', plan.media.q0.url === 'good');
  ok('its still frame comes with it', plan.media.q0.still === 'good_s');
  ok('the promoted spare leaves the bench', !plan.media.q0.alts.some(s => s.url === 'good'));
  ok('the remaining spare stays', plan.media.q0.alts.some(s => s.url === 'also-good'));
  ok('the dead primary is not kept as a spare', !plan.media.q0.alts.some(s => s.url === 'dead'));
  ok('the search term survives the repair', plan.media.q0.term === 'koala');
}

console.log('\nA dead spare is never promoted');
{
  const media = { q0: rec('dead', [spare('also-dead'), spare('alive')]) };
  const plan = M.planMediaRepair(media, { dead: false, 'also-dead': false, alive: true });
  ok('it skips past the dead spare to a live one', plan.media.q0.url === 'alive');
  ok('and the dead spare is dropped from the bench', !plan.media.q0.alts.some(s => s.url === 'also-dead'));
}

console.log('\nOut of spares: blank it, never guess');
{
  const media = { q0: rec('dead', [spare('also-dead')]), q1: rec('fine') };
  const plan = M.planMediaRepair(media, { dead: false, 'also-dead': false, fine: true });
  ok('the slot is blanked', plan.blanked.includes('q0'));
  ok('a blanked slot is removed rather than left pointing at a dead url', !plan.media.q0);
  ok('the healthy slot is untouched', plan.media.q1.url === 'fine');
  /* Re-searching would put an image nobody reviewed in front of every new account —
     the exact thing hardcoding the list prevents. Losing one picture is the lesser harm. */
  ok('nothing is invented to fill the gap', Object.keys(plan.media).length === 1);
}

console.log('\nAn unknown URL is treated as alive, not dead');
{
  const media = { q0: rec('never-checked', [spare('s1')]) };
  const plan = M.planMediaRepair(media, {});          // probe never ran
  ok('a slot we failed to check is left alone', plan.ok.includes('q0'));
  ok('…and is certainly not blanked', !plan.blanked.length && !plan.repaired.length);
  ok('the url is unchanged', plan.media.q0.url === 'never-checked');
}

console.log('\nThe verdict the watchdog acts on');
ok('all alive is ok',
   M.evalStarterMedia({ results: [{ slot:'q0', ok:true }, { slot:'q1', ok:true }], expected: 2 }).ok === true);
ok('a dead link is not ok',
   M.evalStarterMedia({ results: [{ slot:'q0', ok:false }], expected: 1 }).ok === false);
ok('the failing slot is named, so the email is actionable',
   /q0/.test(M.evalStarterMedia({ results: [{ slot:'q0', ok:false }], expected: 1 }).detail));
/* After a blank, the dead URL is no longer in the list — without `expected` the next
   run would report "all responding" while a new user sees a gap. */
ok('a blanked slot still counts as not ok',
   M.evalStarterMedia({ results: [{ slot:'q1', ok:true }], expected: 2 }).ok === false);
ok('…and says a slot has no picture',
   /no picture/.test(M.evalStarterMedia({ results: [{ slot:'q1', ok:true }], expected: 2 }).detail));

console.log('\nWhat Rod is told');
{
  const lines = M.describeRepair({
    repaired: [{ slot: 'q0', from: 'dead', to: 'good' }],
    blanked: ['q3o2'],
  });
  ok('a promotion reads as handled', lines.some(l => /q0/.test(l) && /vetted spare/.test(l)));
  ok('a blank reads as needing him', lines.some(l => /q3o2/.test(l) && /Re-vet/.test(l)));
  ok('nothing to say when nothing happened', M.describeRepair({}).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
