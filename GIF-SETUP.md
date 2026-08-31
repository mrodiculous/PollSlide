# GIFs — setup and the key

## What you need to do

**1. Rotate the Giphy key.** The one currently in use has been public for as long as it
has been deployed: it was hardcoded in `presenter.html`, which ships to every browser
that loads the app, and it is in the GitHub history. Anyone who opened dev tools could
read it. It has also been pasted into a chat transcript.

Rotating is two minutes at <https://developers.giphy.com/dashboard/> — delete the old
key, create a new one.

**2. Put the new key in Vercel, not in the code.**

```
Vercel → poll-slide → Settings → Environment Variables
GIPHY_API_KEY = <the new key>
```

Then **redeploy**. Environment variables do not apply to deployments that already
exist.

**3. Do not put it back in a source file.** `presenter.html` no longer contains a key
and should not again. `scripts/qa-secrets.js` fails the build if one reappears.

---

## What changed and why

The GIF picker used to call Giphy straight from the browser:

```js
const GIPHY_KEY = '…';
fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&…&rating=g`)
```

Two problems, and the second is the one that matters:

- **The key was public.** Free Giphy keys are rate-limited rather than billed, so the
  damage is someone burning your quota — but it is still a credential in public.
- **`rating=g` guaranteed nothing.** It sat in a URL the browser controlled. Anyone
  could change it. A safety setting the client can edit is not a safety setting, and
  this product is used in classrooms.

Both search paths — the manual picker and the per-deck contextual GIFs — now go
through `POST /api/gif-search`, which holds the key and writes the safety rating from
a server-side literal that no caller can reach. Every search is logged to
`admin/gif_log` with the term, the deck and who ran it.

## If Giphy goes the way of Tenor

Tenor stopped issuing API keys, which is why the endpoint is provider-pluggable.
`PROVIDERS` in `api/gif-search.js` is a list; the first one with a key set is used.
Adding a third is one entry there plus one normaliser in `gifs.js` — nothing else in
the codebase knows a provider exists. Set `TENOR_API_KEY` instead of `GIPHY_API_KEY`
and it switches over with no other change.

## The two features

| | What it is | Where |
|---|---|---|
| **Manual picker** | Search and click to insert. What you had. | The image control on a question |
| **Contextual GIFs** | Per-deck toggles: a GIF on each question, on each revealed answer, or both. Fetched when you tick the box, shown for review before anything is presented. | Deck `⋯ → 🎞 GIFs` |

The second is the one that removes the tedious part. It derives a search from the
question's own words — *"Which app do millennials blame for ruining dating?"* searches
`app millennials blame ruining`, not the sentence — and for answers that cannot be
pictured (`42`, `B`, `true`) it falls back to a reaction GIF rather than searching for
whatever that character happens to be a meme for.
