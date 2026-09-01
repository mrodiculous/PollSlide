/* PollSlide — are the demo deck's pictures still there?
 * ---------------------------------------------------------------------------
 * The demo deck hardcodes 25 GIF URLs. Hardcoding is right — the same reviewed set
 * reaches every new account instead of a fresh unvetted search each time — but a
 * hardcoded third-party URL is a promise somebody else can break. Giphy media does
 * disappear: an uploader deletes a post, a rights holder files a takedown. When that
 * happens the first thing a brand-new user sees is a grid of broken images.
 *
 * So the URLs get checked on the same 15-minute cron as everything else, and repaired
 * without waiting for anyone to notice.
 *
 * THE REPAIR IS A PROMOTION, NOT A SEARCH.
 * The obvious auto-fix — re-run the slot's search term and take the top hit — would
 * quietly undo the reason the URLs are hardcoded: it puts an image nobody has looked at
 * in front of every new account, which is the exact failure the fixed list exists to
 * prevent. Instead each slot ships with SPARES that were reviewed at the same time as
 * the primary, and a repair promotes the next live one. A slot that runs out of vetted
 * spares is blanked, not guessed at: the deck loses one picture and stays a working
 * quiz, and Rod is told a slot needs re-vetting.
 *
 * Everything here is pure so the thresholds are testable without Firebase or network —
 * see scripts/tests/starter-media-check.test.js.
 */

/* Every URL the deck depends on, primaries and spares, deduplicated. The caller HEADs
 * these; spares are included so a repair never promotes a link that is also dead. */
function urlsToCheck(media) {
  const seen = new Set();
  Object.values(media || {}).forEach(rec => {
    if (!rec) return;
    if (rec.url) seen.add(rec.url);
    (rec.alts || []).forEach(a => { if (a && a.url) seen.add(a.url); });
  });
  return [...seen];
}

/* Decide what to do, given which URLs answered.
 * `alive` maps url → boolean. An URL missing from the map is treated as ALIVE: a check
 * that never ran is not evidence of a dead link, and blanking pictures because our own
 * probe timed out would be worse than the problem. */
function planMediaRepair(media, alive) {
  const a = alive || {};
  const isDead = (url) => a[url] === false;
  const ok = [], repaired = [], blanked = [], next = {};

  Object.keys(media || {}).sort().forEach(slot => {
    const rec = media[slot];
    if (!rec || !rec.url) return;

    if (!isDead(rec.url)) { ok.push(slot); next[slot] = rec; return; }

    const spare = (rec.alts || []).find(s => s && s.url && !isDead(s.url));
    if (spare) {
      repaired.push({ slot, from: rec.url, to: spare.url });
      next[slot] = {
        ...rec,
        url: spare.url,
        still: spare.still || '',
        alt: spare.alt || rec.alt || '',
        id: spare.id || '',
        // The promoted spare leaves the bench; the dead primary never returns to it.
        alts: (rec.alts || []).filter(s => s && s.url && s.url !== spare.url && !isDead(s.url)),
      };
    } else {
      // No vetted spare left. Drop the picture rather than invent one.
      blanked.push(slot);
    }
  });

  return { ok, repaired, blanked, media: next };
}

/* Pure verdict for the watchdog. `expected` is how many slots the deck wants filled;
 * without it a blanked slot would silently look like a pass, because the URL that was
 * failing is no longer in the list being checked. */
function evalStarterMedia(d) {
  const results = (d && d.results) || [];
  const expected = (d && typeof d.expected === 'number') ? d.expected : results.length;
  const dead = results.filter(r => r && r.ok === false);
  const missing = Math.max(0, expected - results.length);

  if (!dead.length && !missing) {
    return { ok: true, detail: `${results.length} demo picture(s) responding.` };
  }
  const bits = [];
  if (dead.length) bits.push(`${dead.length} dead link(s): ${dead.map(r => r.slot).join(', ')}`);
  if (missing) bits.push(`${missing} slot(s) have no picture at all`);
  return { ok: false, detail: bits.join('; ') + '.' };
}

/* What to tell Rod after a repair ran. Separate from evalStarterMedia because a repair
 * that worked and a repair that ran out of spares are different messages: one is
 * "handled", the other is "a new-user deck is now short a picture until you re-vet". */
function describeRepair(plan) {
  const p = plan || {};
  const lines = [];
  (p.repaired || []).forEach(r => lines.push(`${r.slot}: dead link replaced with a vetted spare.`));
  (p.blanked || []).forEach(s => lines.push(`${s}: dead and NO vetted spare left — the slot now shows no picture. Re-vet it.`));
  return lines;
}

module.exports = { urlsToCheck, planMediaRepair, evalStarterMedia, describeRepair };
