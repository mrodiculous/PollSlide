// PollSlide — AI summary of ONE legal-watch change (2026-10-07). Vercel Serverless Function.
//
// POST { alertTs, key } with the admin's Firebase ID token →
//   { ok, triage: { relevance, summary, why, docs[], action, source, at } }
//
// Admin → Legal shows, for each change the weekly watcher found, the sentences that were
// added and removed (lib/legal-diff.js). This turns that into a plain-language summary and a
// suggested next step. It is an AID, never a decision and never legal advice:
//   • it NEVER edits a legal document and NEVER pushes a policy update — Rod decides;
//   • the page text is untrusted: fenced, declared data, answer validated to a fixed shape;
//   • local LLM first (free, LOCAL_LLM_URL), then OpenAI (OPENAI_TEXT_MODEL), like Slidekick.
// Identity comes from the verified token only (see memory: endpoint-auth-hardening).
const admin = require('firebase-admin');
const { verifyToken, tokenFrom, getApp, ADMIN_EMAILS } = require('../lib/quota');
const LD = require('../lib/legal-diff');

const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || '';
const LOCAL_MODEL = process.env.LOCAL_TRIAGE_MODEL || process.env.LOCAL_HELPBOT_MODEL || 'gemma4:latest';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET } : {};

async function callChat({ baseURL, apiKey, model, messages, timeoutMs, extraHeaders = {}, local }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, ...(local ? { temperature: 0 } : {}) }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
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
  if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Not allowed.' });

  const body = req.body || {};
  const alertTs = String(body.alertTs || '').replace(/[^0-9]/g, '');
  const key = String(body.key || '').replace(/[^a-z0-9_]/gi, '');
  if (!alertTs || !key) return res.status(400).json({ error: 'alertTs and key are required.' });

  let db;
  try { db = admin.database(getApp()); } catch (e) { return res.status(500).json({ error: 'Firebase admin not configured.' }); }
  const snap = await db.ref('admin/legal_alerts/' + alertTs).get();
  if (!snap.exists()) return res.status(404).json({ error: 'Alert not found.' });
  const change = (snap.val().changes || []).find(c => c && c.key === key);
  if (!change) return res.status(404).json({ error: 'That change is not in this alert.' });
  if (!change.diff) return res.status(400).json({ error: 'No text was captured for this change (it was detected before the watcher kept page text). Open the page to review it; the next change will have a summary.' });
  if (change.diff.noiseOnly) {
    const triage = { relevance: 'none', summary: 'Only dates, counters or formatting changed.', why: 'No wording of the rule or policy changed.', docs: [], action: 'Mark as not relevant.', source: 'rules', at: Date.now(), by: who.email };
    await db.ref(`admin/legal_alerts/${alertTs}/triage/${key}`).set(triage);
    return res.status(200).json({ ok: true, triage });
  }

  const messages = LD.triageMessages(change);
  const tries = [];
  if (LOCAL_LLM_URL) tries.push(['local', () => callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_MODEL, messages, timeoutMs: 40000, extraHeaders: CF_ACCESS_HEADERS, local: true })]);
  if (OPENAI_API_KEY) tries.push(['cloud', () => callChat({ baseURL: 'https://api.openai.com/v1', apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, messages, timeoutMs: 40000 })]);
  for (const [source, run] of tries) {
    try {
      const v = LD.validateTriage(await run());
      if (v) {
        const triage = { ...v, source, at: Date.now(), by: who.email };
        await db.ref(`admin/legal_alerts/${alertTs}/triage/${key}`).set(triage);
        return res.status(200).json({ ok: true, triage });
      }
      console.warn('compliance-triage: ' + source + ' returned unusable output');
    } catch (e) { console.warn('compliance-triage: ' + source + ' failed (' + e.message + ')'); }
  }
  return res.status(503).json({ error: 'No AI model is reachable right now. The changed sentences are still shown — review them directly.' });
};
