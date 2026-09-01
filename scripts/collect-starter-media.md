# Collecting the demo deck's pictures

The demo deck (`starters.js`) ships the same five questions to every new account, with a
picture on the question and on all four answers — 25 in total. Those pictures are
**fixed and reviewed**, not searched at first run: a live search would give every new
user a different, unvetted set, and this deck often goes up in front of a class before
the teacher has seen the product. A G rating is a filter, not a promise.

They come from **our own `/api/gif-search`**, so the Giphy key stays in Vercel and never
reaches anyone's disk. That endpoint verifies a Firebase token, so this has to run in a
signed-in browser tab — there is no server-side shortcut.

## 1. Sign in

Open `https://app.pollslide.com/presenter` and sign in normally.

## 2. Collect

Paste into the console. It reads the terms straight from `PSStarters.mediaSlots()`, so
editing the deck changes what gets fetched — there is no second list to keep in sync.

```js
(async () => {
  const slots = PSStarters.mediaSlots();
  const tok = await auth.currentUser.getIdToken();
  const out = {}, failed = [];
  for (const s of slots) {
    try {
      const r = await fetch('/api/gif-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ q: s.term, limit: 12 }),
      });
      const d = await r.json();
      if (!r.ok) { failed.push([s.slot, s.term, d.error]); continue; }
      // Same chooser the product uses, so the demo gets what a teacher would get.
      const g = PSGifs.pickBest(d.results, { seed: s.slot });
      if (!g) { failed.push([s.slot, s.term, 'nothing usable']); continue; }
      out[s.slot] = { url: g.url, still: g.still || '', alt: g.alt || '',
                      term: s.term, source: g.source || '', id: g.id || '' };
    } catch (e) { failed.push([s.slot, s.term, String(e.message || e)]); }
    await new Promise(r => setTimeout(r, 120));   // it's 25 calls; don't hammer
  }
  console.log('failed:', failed);
  copy(JSON.stringify(out, null, 2));   // now on the clipboard
  return { got: Object.keys(out).length, of: slots.length, failed };
})()
```

## 3. Look at all 25 before they ship

This is the step that matters, and it is not optional. Same console:

```js
(() => {
  const m = JSON.parse(prompt('paste the JSON') || '{}');
  const w = window.open('', '_blank');
  w.document.write('<body style="background:#111;color:#eee;font:13px system-ui;display:flex;flex-wrap:wrap;gap:10px;padding:12px">'
    + Object.entries(m).map(([k, v]) =>
        `<figure style="margin:0;width:190px"><img src="${v.url}" style="width:190px;height:140px;object-fit:cover;border-radius:8px">
         <figcaption>${k} · ${v.term}<br><span style="color:#999">${(v.alt||'').slice(0,60)}</span></figcaption></figure>`).join('')
    + '</body>');
})()
```

Reject anything that is not plainly the thing asked for, anything with text burned into
it, and anything you would not want on a screen in front of somebody else's class. To
replace one, re-run the search for that slot with a different term and swap the entry.

## 4. Save

Paste the JSON into the returned object in `starter-media.js`, then:

```bash
node scripts/qa-assets.js --write && node scripts/qa.js
```

`qa-assets` rebuilds the `?v=` hash so returning users actually get the new file.
