/* PollSlide — contextual GIF search (Tenor), for the per-deck GIF setting.
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SERVER ENDPOINT AND NOT A BROWSER FETCH
 * Two reasons, and the second is the one that matters:
 *   1. The Tenor key would be readable by anyone who opened dev tools.
 *   2. THE CONTENT FILTER WOULD BE EDITABLE. A client-side call means a query string
 *      the browser controls, and `contentfilter` is in that query string. Anyone could
 *      lower it. Here it is written by the server from a constant and the caller has
 *      no way to influence it — see lib/gifs.js SAFE_FILTER.
 *
 * Every search is logged to admin/gif_log with the term, the deck and who asked. This
 * is a classroom product; if something inappropriate ever does get through Tenor's
 * filter, "which teacher, which deck, which search" is the first question, and it
 * needs an answer that is not a guess.
 *
 * POST (signed-in) { q, limit? } → { ok, term, results[] }
 * Env: TENOR_API_KEY (required), TENOR_CLIENT_KEY (optional, Tenor asks for an app id).
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { getApp, verifyToken } = require('../lib/quota');
const { rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');
const gifs = require('../lib/gifs');

const TENOR = 'https://tenor.googleapis.com/v2/search';
const TIMEOUT_MS = 7000;
const MAX_LIMIT = 12;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.TENOR_API_KEY;
  if (!key) {
    // A clear, actionable message: this is the most likely reason it does not work,
    // and the teacher-facing UI shows this text.
    return res.status(503).json({ error: 'GIF search is not configured — TENOR_API_KEY is not set in this environment.' });
  }

  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'Sign in to search for GIFs.' });
  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }

  const db = admin.database(getApp());

  /* Ticking the box on a 30-question deck fires 60 searches. That is fine; someone
   * scripting it is not. Per user, generously — this is a build-time action. */
  try {
    const perUser = await rateLimit(db, 'gif_u_' + (who.uid || who.email), 300, 3600000);
    const perIp   = await rateLimit(db, 'gif_i_' + clientIp(req), 600, 3600000);
    if (!perUser.allowed || !perIp.allowed) {
      return res.status(429).json({ error: 'Too many GIF searches. Try again in a little while.' });
    }
    sweepRateLimits(db);
  } catch (e) { /* limiter trouble must not break the feature */ }

  const term = String(req.body?.q ?? '').trim().slice(0, 80);
  if (!term) return res.status(400).json({ error: 'Nothing to search for.' });
  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(req.body?.limit, 10) || 8));

  const url = new URL(TENOR);
  url.searchParams.set('q', term);
  url.searchParams.set('key', key);
  if (process.env.TENOR_CLIENT_KEY) url.searchParams.set('client_key', process.env.TENOR_CLIENT_KEY);
  url.searchParams.set('limit', String(limit));
  // Locked. Not read from the request, not configurable per deck, not an argument.
  url.searchParams.set('contentfilter', gifs.SAFE_FILTER);
  url.searchParams.set('media_filter', 'tinygif,gifpreview,gif');
  url.searchParams.set('random', 'false');   // stable results for the same term

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(502).json({ error: 'GIF search failed (' + r.status + ')',
                                    detail: body.slice(0, 200) });
    }
    const data = await r.json();
    const results = (data.results || []).map(gifs.normalizeResult).filter(Boolean);

    // Who searched for what, on which deck. Best-effort; never fails the request.
    db.ref('admin/gif_log').push({
      at: Date.now(), by: who.email || who.uid, term,
      deck: String(req.body?.deck || '').slice(0, 64),
      returned: results.length, filter: gifs.SAFE_FILTER,
    }).catch(() => {});

    return res.status(200).json({ ok: true, term, results,
      // Tenor's terms require visible attribution wherever results are shown.
      attribution: 'Powered by Tenor' });
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return res.status(aborted ? 504 : 500).json({ error: aborted ? 'GIF search timed out.' : 'GIF search failed.' });
  } finally { clearTimeout(timer); }
};
