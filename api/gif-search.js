/* PollSlide — contextual GIF search, for the per-deck GIF setting.
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SERVER ENDPOINT AND NOT A BROWSER FETCH
 * Two reasons, and the second is the one that matters:
 *   1. The API key would be readable by anyone who opened dev tools.
 *   2. THE CONTENT FILTER WOULD BE EDITABLE. A client-side call means a query string
 *      the browser controls, and the safety rating is in that query string. Anyone
 *      could lower it. Here it is written by the server from a constant per provider
 *      and the caller has no way to influence it.
 *
 * WHY MORE THAN ONE PROVIDER
 * Tenor stopped issuing API keys. That is exactly the kind of thing that happens to a
 * free third-party service, and a feature that depends on one of them is a feature
 * that breaks without warning. Providers are declared below; whichever key is present
 * is used, in order. Adding a third is a new PROVIDERS entry plus a normaliser in
 * lib/gifs.js — nothing outside those two files knows a provider exists.
 *
 * Every search is logged to admin/gif_log. This is a classroom product; if something
 * inappropriate ever gets past a provider's filter, "which teacher, which deck, which
 * search" is the first question and it needs an answer that is not a guess.
 *
 * POST (signed-in) { q, limit?, deck? } → { ok, term, provider, results[], attribution }
 * Env: GIPHY_API_KEY and/or TENOR_API_KEY. Set either.
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { getApp, verifyToken } = require('../lib/quota');
const { rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');
const gifs = require('../lib/gifs');

const TIMEOUT_MS = 7000;
const MAX_LIMIT = 24;   // the manual picker asks for a full grid

/* Order matters: the first provider with a key configured wins. Giphy is first only
 * because it is the one still handing out keys — not a quality judgement.
 *
 * `rating` / `contentfilter` are set HERE, from a literal. They are never read from
 * the request. If they ever become a parameter, some caller will pass the loose value. */
const PROVIDERS = [
  {
    name: 'giphy',
    env: 'GIPHY_API_KEY',
    attribution: 'Powered by GIPHY',
    signup: 'https://developers.giphy.com/dashboard/',
    build(key, term, limit) {
      const u = new URL('https://api.giphy.com/v1/gifs/search');
      u.searchParams.set('api_key', key);
      u.searchParams.set('q', term);
      u.searchParams.set('limit', String(limit));
      u.searchParams.set('rating', 'g');            // strictest. Locked.
      u.searchParams.set('bundle', 'messaging_non_clips');
      return u;
    },
    extract: (d) => (d && d.data) || [],
  },
  {
    name: 'tenor',
    env: 'TENOR_API_KEY',
    attribution: 'Powered by Tenor',
    signup: 'https://developers.google.com/tenor/guides/quickstart',
    build(key, term, limit) {
      const u = new URL('https://tenor.googleapis.com/v2/search');
      u.searchParams.set('key', key);
      if (process.env.TENOR_CLIENT_KEY) u.searchParams.set('client_key', process.env.TENOR_CLIENT_KEY);
      u.searchParams.set('q', term);
      u.searchParams.set('limit', String(limit));
      u.searchParams.set('contentfilter', gifs.SAFE_FILTER);   // 'high'. Locked.
      u.searchParams.set('media_filter', 'tinygif,gifpreview,gif');
      u.searchParams.set('random', 'false');
      return u;
    },
    extract: (d) => (d && d.results) || [],
  },
];

const activeProvider = () => PROVIDERS.find(p => !!process.env[p.env]) || null;

/* A running count of failures per day, read by the watchdog (feature_failures check), so a
 * provider outage or an exhausted quota reaches an inbox instead of waiting for a customer. */
function noteFailure(db, code, detail) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = db.ref(`admin/feature_health/gif_search/${day}`);
    ref.child('fail').transaction(n => (n || 0) + 1).catch(() => {});
    ref.child('last').set({ at: Date.now(), code, detail: String(detail || '').slice(0, 160) }).catch(() => {});
  } catch (e) { /* never break the response over bookkeeping */ }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const provider = activeProvider();
  if (!provider) {
    // Names both options and where to get a key: this is the most likely reason it
    // does not work, and the teacher-facing UI shows this exact sentence.
    return res.status(503).json({
      error: 'GIF search is not configured. Set GIPHY_API_KEY (or TENOR_API_KEY) and redeploy.',
      signup: PROVIDERS.map(p => `${p.env} — ${p.signup}`),
    });
  }

  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'Sign in to search for GIFs.' });
  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }

  const db = admin.database(getApp());

  /* Ticking the box on a 30-question deck fires 60 searches. That is fine; someone
   * scripting it is not. Generous, because this is a build-time action. */
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

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const url = provider.build(process.env[provider.env], term, limit);
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) {
      /* The provider said no. Most often this is its hourly limit: a GIPHY *beta* key allows
       * about 100 searches an hour, and "GIFs for every question and answer" on a 30-question
       * deck is ~150 searches on its own (2026-09-26: 145 succeeded, then every search failed).
       * Never answer 502 here — the platform may put its own page in front of a 502, which
       * the browser can't read ("The string did not match the expected pattern" in Safari).
       * Say what happened in words, and record it so the watchdog notices. */
      const body = await r.text().catch(() => '');
      const quota = r.status === 429;
      console.warn(`gif-search: ${provider.name} ${r.status} for "${term}" — ${body.slice(0, 160)}`);
      noteFailure(db, quota ? 'provider_quota' : 'provider_error', `${provider.name} ${r.status}`);
      return res.status(quota ? 429 : 503).json({
        code: quota ? 'provider_quota' : 'provider_error',
        error: quota
          ? 'GIF search is taking a short break — we hit our GIF provider\'s hourly limit. Please try again in a few minutes.'
          : `GIF search is having trouble right now (${provider.name} ${r.status}). Please try again shortly.`,
      });
    }
    const data = await r.json();
    /* Normalised HERE, because only the server knows which provider answered. The
     * client receives one record shape and never learns a provider name. */
    const results = gifs.normalizeMany(provider.extract(data), provider.name);

    db.ref('admin/gif_log').push({
      at: Date.now(), by: who.email || who.uid, term,
      deck: String(req.body?.deck || '').slice(0, 64),
      provider: provider.name, returned: results.length,
    }).catch(() => {});

    return res.status(200).json({ ok: true, term, provider: provider.name, results,
                                  attribution: provider.attribution });
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    noteFailure(db, aborted ? 'timeout' : 'exception', String((e && e.message) || e).slice(0, 120));
    return res.status(503).json({ code: aborted ? 'timeout' : 'exception',
      error: aborted ? 'GIF search timed out. Please try again.' : 'GIF search failed. Please try again.' });
  } finally { clearTimeout(timer); }
};

module.exports.__test = { PROVIDERS, activeProvider };
