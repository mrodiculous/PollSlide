// PollSlide — Public system status (secret-free).
// Powers https://pollslide.com/status. Probes every subsystem the products
// depend on and returns per-product + per-platform-component health, plus
// uptime history sampled into Firebase (throttled, best-effort).
//
// Output NEVER includes keys, model names, URLs, or env details — only
// component ids, human labels, up/degraded/down, and neutral notes — so it is
// safe to hit directly and CORS is open.
//
// GET /api/status -> { ok, overall, checkedAt, components:[...], uptime:{...} }

const admin = require('firebase-admin');

const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://echonest-live-survey-default-rtdb.firebaseio.com';

const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET }
  : {};

const SAMPLE_EVERY_MS = 5 * 60 * 1000;       // write a history sample at most every 5 min
const RETAIN_MS       = 7 * 24 * 3600 * 1000; // keep 7 days of samples

// ── Probes ───────────────────────────────────────────────────────────────────
// Each probe resolves to 'up' | 'degraded' | 'down' (+ optional note). None throw.

async function httpProbe(url, { headers = {}, timeoutMs = 4500, anyResponseIsUp = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    if (anyResponseIsUp) return { ok: true };          // service answered at all (401 etc. still proves it's serving)
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// Firebase Realtime Database — live sessions, responses, everything realtime.
// A permission-denied response still proves the database frontend is up.
async function probeRealtime() {
  const r = await httpProbe(`${DB_URL}/.json?shallow=true`, { anyResponseIsUp: true });
  return r.ok ? { status: 'up' } : { status: 'down', note: 'Realtime database is unreachable.' };
}

// AI text chain (Polly question generation, translation, summaries):
// local Mac first, cloud fallback. Users only feel it if BOTH are gone.
async function probeAiText() {
  const localUrl = process.env.LOCAL_LLM_URL || '';
  const hasCloud = !!process.env.OPENAI_API_KEY;
  const local = localUrl ? await httpProbe(`${localUrl}/models`, { headers: CF_ACCESS_HEADERS }) : { ok: false };
  if (local.ok) return { status: 'up' };
  if (hasCloud) {
    const cloud = await httpProbe('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    if (cloud.ok) return { status: localUrl ? 'degraded' : 'up', note: localUrl ? 'Running on backup capacity — may respond slightly differently.' : undefined };
  }
  return { status: 'down', note: 'AI generation is temporarily unavailable.' };
}

// AI image chain: local → fal → OpenAI. Any available provider = up.
async function probeAiImages(aiTextCloudOk) {
  const localUrl = process.env.LOCAL_IMAGE_URL || '';
  const local = localUrl ? await httpProbe(`${localUrl}/models`, { headers: CF_ACCESS_HEADERS }) : { ok: false };
  if (local.ok) return { status: 'up' };
  if (process.env.FAL_KEY) return { status: localUrl ? 'degraded' : 'up' };
  if (process.env.OPENAI_API_KEY && aiTextCloudOk !== false) return { status: localUrl ? 'degraded' : 'up' };
  return { status: 'down', note: 'Image generation is temporarily unavailable.' };
}

// Email delivery (Resend) — invites, receipts, survey blasts.
async function probeEmail() {
  if (!process.env.RESEND_API_KEY) return null; // not configured → omit from public page
  const r = await httpProbe('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  return r.ok ? { status: 'up' } : { status: 'down', note: 'Emails may be delayed.' };
}

// Billing (Stripe) — checkout + customer portal.
async function probeBilling() {
  if (!process.env.STRIPE_SECRET_KEY) return null; // pre-live → omit
  const r = await httpProbe('https://api.stripe.com/v1/prices?limit=1', { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  return r.ok ? { status: 'up' } : { status: 'down', note: 'Upgrades and billing changes may fail; existing plans are unaffected.' };
}

// ── Derived product rows ─────────────────────────────────────────────────────
const RANK = { up: 0, degraded: 1, down: 2 };
function worst(...statuses) { return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'up'); }

// Every user-facing product, mapped to the platform components it rides on.
const PRODUCTS = [
  { id: 'polls',        name: 'Live Polls',            deps: ['hosting', 'realtime'] },
  { id: 'surveys',      name: 'Surveys',               deps: ['hosting', 'realtime'] },
  { id: 'quizzes',      name: 'Quizzes',               deps: ['hosting', 'realtime'] },
  { id: 'study',        name: 'Study Sets',            deps: ['hosting', 'realtime'] },
  { id: 'presentslide', name: 'PresentSlide',          deps: ['hosting'] },
  { id: 'polly',        name: 'Polly AI',              deps: ['ai_text'], soft: ['ai_images'] },
  { id: 'companion',    name: 'Mac Companion',         deps: ['realtime'] },
  { id: 'ppt',          name: 'PowerPoint Add-in',     deps: ['hosting', 'realtime'] },
  { id: 'gslides',      name: 'Google Slides Add-on',  deps: ['hosting', 'realtime'] },
];

const PLATFORM_NAMES = {
  hosting:   'Web app & API hosting',
  realtime:  'Live sessions & responses',
  ai_text:   'AI — questions & translation',
  ai_images: 'AI — images',
  email:     'Email delivery',
  billing:   'Billing',
};

// ── Uptime history (best-effort; skipped if Admin creds are missing) ─────────
function getAdminDb() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) return null;
  const app = admin.apps.length ? admin.apps[0] : admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  return admin.database(app);
}

const tsKey = t => String(t).padStart(15, '0'); // fixed width → orderByKey sorts chronologically

// ── Incident auto-log ────────────────────────────────────────────────────────
// On every component status transition, write admin/incidents/<ts> describing
// what changed and what the platform did about it automatically. Transitions
// to 'down' also email the founder (internal-key call to our own send-email).
const AUTO_ACTIONS = {
  ai_text:   { degraded: 'Auto-failover engaged: Polly and translation are being served by the cloud provider. Users unaffected.', down: 'No provider reachable — Polly and translation requests will fail until a provider returns.', up: 'Primary provider healthy again — traffic back on the normal chain.' },
  ai_images: { degraded: 'Auto-failover engaged: images served by the backup provider. Users unaffected.', down: 'No image provider reachable — question images unavailable.', up: 'Image chain healthy again.' },
  realtime:  { down: 'No automatic remedy — live sessions are down until Firebase recovers.', up: 'Realtime database reachable again — live sessions restored.' },
  hosting:   { down: 'No automatic remedy — check Vercel.', up: 'Hosting restored.' },
  email:     { down: 'Emails are queued client-side as best-effort and skipped — no automatic remedy. Check Resend.', up: 'Email delivery restored.' },
  billing:   { down: 'Checkout/portal calls will error — existing subscriptions unaffected. Check Stripe.', up: 'Billing restored.' },
};

async function recordIncidents(platform) {
  const db = getAdminDb();
  if (!db) return;
  try {
    const now = Date.now();
    const metaRef = db.ref('status_meta/last');
    const prev = (await metaRef.get()).val() || {};
    const cur = {};
    for (const [id, c] of Object.entries(platform)) cur[id] = c.status;
    const changes = Object.entries(cur).filter(([id, s]) => (prev[id] || 'up') !== s);
    if (!changes.length) return;
    await metaRef.set(cur);
    for (const [id, s] of changes) {
      const from = prev[id] || 'up';
      const auto = (AUTO_ACTIONS[id] || {})[s] || (s === 'up' ? 'Recovered.' : 'See the admin health panel for fix steps.');
      await db.ref('admin/incidents/' + tsKey(now) + '_' + id).set({ t: now, comp: id, from, to: s, auto });
      if (s === 'down' && process.env.INTERNAL_API_KEY) {
        try {
          const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
          await fetch(`${APP_URL}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY },
            body: JSON.stringify({ type: 'notify', to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com', data: {
              subject: `🔴 PollSlide status: ${id} is down`,
              heading: `${id} went down`,
              body: `Component <b>${id}</b> transitioned ${from} → ${s}.<br>${auto}<br><br>Open the admin health panel for recommended fixes.`,
              ctaUrl: APP_URL + '/admin', ctaText: 'Open health panel',
            } }),
          });
        } catch (e) { /* alert email is best-effort */ }
      }
    }
  } catch (e) { /* incidents are optional — never fail the status call */ }
}

async function recordAndLoadHistory(platform) {
  const db = getAdminDb();
  if (!db) return null;
  const now = Date.now();
  const log = db.ref('status_log');

  // Throttled sample write + pruning of anything past retention.
  try {
    const lastSnap = await log.orderByKey().limitToLast(1).get();
    let lastT = 0;
    lastSnap.forEach(s => { lastT = Number(s.key); });
    if (now - lastT >= SAMPLE_EVERY_MS) {
      // one letter per status: u=up, g=degraded, d=down
      const compact = {};
      for (const [id, c] of Object.entries(platform)) compact[id] = c.status === 'up' ? 'u' : c.status === 'degraded' ? 'g' : 'd';
      await log.child(tsKey(now)).set({ t: now, c: compact });
      const old = await log.orderByKey().endAt(tsKey(now - RETAIN_MS)).limitToFirst(200).get();
      const gone = {};
      old.forEach(s => { gone[s.key] = null; });
      if (Object.keys(gone).length) await log.update(gone);
    }
  } catch (e) { /* history is optional — never fail the status call */ }

  // Read the retained window once and summarize per component.
  try {
    const snap = await log.orderByKey().startAt(tsKey(now - RETAIN_MS)).get();
    const samples = [];
    snap.forEach(s => { const v = s.val(); if (v && v.t && v.c) samples.push(v); });
    if (!samples.length) return null;

    const score = { u: 1, g: 0.5, d: 0 };
    const uptime = {};
    for (const id of Object.keys(platform)) {
      const week = samples.filter(s => s.c[id] != null);
      const day = week.filter(s => s.t >= now - 24 * 3600 * 1000);
      const pct = arr => arr.length ? Math.round(arr.reduce((a, s) => a + score[s.c[id]], 0) / arr.length * 10000) / 100 : null;
      // 24 hourly buckets, oldest → newest; each bucket = worst sample in that hour; 'n' = no samples.
      const bars = [];
      for (let h = 23; h >= 0; h--) {
        const from = now - (h + 1) * 3600 * 1000, to = now - h * 3600 * 1000;
        const inHour = day.filter(s => s.t >= from && s.t < to);
        bars.push(inHour.length ? inHour.map(s => s.c[id]).reduce((a, b) => (score[b] < score[a] ? b : a)) : 'n');
      }
      uptime[id] = { pct24h: pct(day), pct7d: pct(week), bars };
    }
    return uptime;
  } catch (e) { return null; }
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Hosting is 'up' by definition if this function is answering.
  const [realtime, aiText, email, billing] = await Promise.all([
    probeRealtime(), probeAiText(), probeEmail(), probeBilling(),
  ]);
  const aiImages = await probeAiImages();

  const platform = { hosting: { status: 'up' }, realtime, ai_text: aiText, ai_images: aiImages };
  if (email) platform.email = email;
  if (billing) platform.billing = billing;

  const products = PRODUCTS.map(p => {
    let status = worst(...p.deps.map(d => (platform[d] || { status: 'up' }).status));
    let note = p.deps.map(d => platform[d] && platform[d].note).find(Boolean);
    // Soft deps only ever degrade, never take a product down.
    if (p.soft && status === 'up') {
      const softWorst = worst(...p.soft.map(d => (platform[d] || { status: 'up' }).status));
      if (softWorst !== 'up') { status = 'degraded'; note = note || 'Image generation is limited; everything else works.'; }
    }
    return { id: p.id, name: p.name, group: 'products', status, ...(note ? { note } : {}) };
  });

  const platformRows = Object.entries(platform).map(([id, c]) => ({
    id, name: PLATFORM_NAMES[id] || id, group: 'platform', status: c.status, ...(c.note ? { note: c.note } : {}),
  }));

  // Core (hosting/realtime) down = full outage; anything else non-up = degraded.
  const coreDown = ['hosting', 'realtime'].some(id => platform[id].status === 'down');
  const allUp = platformRows.every(r => r.status === 'up');
  const overall = coreDown ? 'down' : allUp ? 'up' : 'degraded';

  await recordIncidents(platform);
  const uptime = await recordAndLoadHistory(platform);

  // Products inherit history from their (hard) dependencies: worst bar per
  // hour bucket, most conservative uptime percentage.
  if (uptime) {
    const LETTER_RANK = { u: 0, g: 1, d: 2 };
    for (const p of PRODUCTS) {
      const deps = p.deps.map(d => uptime[d]).filter(Boolean);
      if (!deps.length) continue;
      const bars = [];
      for (let i = 0; i < 24; i++) {
        const seen = deps.map(d => d.bars[i]).filter(b => b !== 'n');
        bars.push(seen.length ? seen.reduce((a, b) => (LETTER_RANK[b] > LETTER_RANK[a] ? b : a)) : 'n');
      }
      const minPct = key => { const v = deps.map(d => d[key]).filter(x => x != null); return v.length ? Math.min(...v) : null; };
      uptime[p.id] = { pct24h: minPct('pct24h'), pct7d: minPct('pct7d'), bars };
    }
  }

  return res.status(200).json({
    ok: true,
    checkedAt: new Date().toISOString(),
    overall,
    components: [...products, ...platformRows],
    uptime,
  });
};
