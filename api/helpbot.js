// PollSlide — Slidekick, the help guide (2026-10-01). Vercel Serverless Function.
//
// POST { question, lang } with the user's Firebase ID token →
//   { ok, answer, topics:[{id,title,url,kind,excerpt}], confident, source }
//
// Order (Rod, 2026-10-01): the LOCAL LLM first (your Mac, LOCAL_LLM_URL — free), then
// OpenAI (OPENAI_TEXT_MODEL) only if the local one is down, slow or returns junk, then
// plain keyword search over the help index so a user is never left with nothing.
// The model only ever CHOOSES help topics that exist and writes two sentences from them;
// the links shown come from lib/help-index.json, never from the model (lib/helpbot.js).
// Signed-in users only (Slidekick lives in the app, next to Support Chat), rate-limited.
const admin = require('firebase-admin');
const { verifyToken, tokenFrom, getApp } = require('../lib/quota');
const { rateLimit } = require('../lib/guard');
const H = require('../lib/helpbot');

const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || '';
/* gemma4 by default: measured 2026-10-01 on Rod's Mac against qwen3:14b with the real help
   index — gemma4 picked the right help topic 8/8 in 6–24 s; qwen3:14b took 33–49 s and
   invented a support address. LOCAL_HELPBOT_MODEL overrides. */
const LOCAL_MODEL = process.env.LOCAL_HELPBOT_MODEL || 'gemma4:latest';
const LOCAL_TIMEOUT_MS = parseInt(process.env.HELPBOT_LOCAL_TIMEOUT_MS, 10) || 20000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const CLOUD_TIMEOUT_MS = parseInt(process.env.HELPBOT_CLOUD_TIMEOUT_MS, 10) || 15000;
const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET } : {};

async function callChat({ baseURL, apiKey, model, messages, timeoutMs, extraHeaders = {}, local }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      // OpenAI's current model rejects `temperature` (learned in Polly) — send it only locally.
      body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, ...(local ? { temperature: 0 } : {}) }),
      signal: controller.signal,
    });
    if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status} ${d.slice(0, 160)}`); }
    const data = await r.json();
    // Local reasoning models may wrap their output in <think>…</think>.
    return String(data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } finally { clearTimeout(timer); }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tok = tokenFrom(req);
  if (!tok) return res.status(401).json({ error: 'Sign in required.' });
  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Your session expired — sign in again.' }); }

  const body = req.body || {};
  const question = String(body.question || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const lang = H.LANG_NAMES[body.lang] ? body.lang : 'en';
  if (question.length < 3) return res.status(400).json({ error: 'Type a question.' });

  let db = null;
  try { db = admin.database(getApp()); } catch (e) {}
  if (db) {
    const rl = await rateLimit(db, 'hb_' + who.uid, 30, 10 * 60000);   // 30 questions / 10 min each
    if (!rl.allowed) return res.status(429).json({ error: 'That is a lot of questions in a row — wait a few minutes, or open a ticket.' });
  }

  // Instant first look: keyword matches straight away, while the guide thinks.
  if (body.mode === 'quick') return res.status(200).json({ ok: true, quick: true, topics: H.cards(H.search(question, 3).map(t => t.id), lang) });

  const messages = H.buildMessages(question, lang);
  let out = null, source = 'search';
  const tries = [];
  if (LOCAL_LLM_URL) tries.push(['local', () => callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_MODEL, messages, timeoutMs: LOCAL_TIMEOUT_MS, extraHeaders: CF_ACCESS_HEADERS, local: true })]);
  if (OPENAI_API_KEY) tries.push(['cloud', () => callChat({ baseURL: 'https://api.openai.com/v1', apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, messages, timeoutMs: CLOUD_TIMEOUT_MS })]);
  for (const [name, run] of tries) {
    try {
      const v = H.validate(await run());
      if (v) { out = v; source = name; break; }
      console.warn('helpbot: ' + name + ' returned unusable output — trying the next option');
    } catch (e) { console.warn('helpbot: ' + name + ' failed (' + e.message + ') — trying the next option'); }
  }
  if (!out) {
    // No AI available: the best keyword matches, with the help centre's own words.
    const hits = H.search(question, 3);
    out = { topics: hits.map(t => t.id), answer: '', confident: hits.length > 0 };
  }

  // Questions Slidekick could not answer are exactly the help pages worth writing next.
  if (db && !out.confident) {
    db.ref('admin/helpbot_unanswered').push({ at: Date.now(), q: question.slice(0, 300), lang, source }).catch(() => {});
  }
  return res.status(200).json({ ok: true, answer: out.answer, confident: out.confident, topics: H.cards(out.topics, lang), source });
};
