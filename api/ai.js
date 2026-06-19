// PollSlide — AI text features (summaries + grading)
// Vercel Serverless Function.
//
// Tasks:
//   • summarize_responses — turn open-ended answers into themes + sentiment + a blurb
//   • grade              — score free-text answers against an expected answer
//
// PROVIDER (best-for-the-job first):
//   1) Claude  (ANTHROPIC_API_KEY) — recommended; great at summarizing/grading nuance
//   2) OpenAI  (OPENAI_API_KEY)    — fallback
//
// VERCEL ENV: ANTHROPIC_API_KEY (recommended) or OPENAI_API_KEY; optional
//   ANTHROPIC_MODEL (default claude-haiku-4-5-20251001), OPENAI_TEXT_MODEL (gpt-4o-mini),
//   NEXT_PUBLIC_APP_URL (CORS).

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const OPENAI_MODEL      = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';

async function callClaude(system, user, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'x-api-key':ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages: [{ role:'user', content: user }] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return (d.content && d.content[0] && d.content[0].text) || '';
}
async function callOpenAI(system, user, maxTokens) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'authorization':'Bearer '+OPENAI_API_KEY },
    body: JSON.stringify({ model: OPENAI_MODEL, max_tokens: maxTokens, messages: [{ role:'system', content: system }, { role:'user', content: user }] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
}
async function callLLM(system, user, maxTokens) {
  if (ANTHROPIC_API_KEY) return { text: await callClaude(system, user, maxTokens), source:'claude' };
  if (OPENAI_API_KEY)    return { text: await callOpenAI(system, user, maxTokens), source:'openai' };
  throw { code:500, msg:'No AI configured. Add ANTHROPIC_API_KEY (recommended) or OPENAI_API_KEY in Vercel → Settings → Environment Variables.' };
}
function extractJSON(t) {
  if (!t) return null;
  const m = t.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const task = body.task;

    if (task === 'summarize_responses') {
      const question  = String(body.question || '').slice(0, 500);
      const responses = (Array.isArray(body.responses) ? body.responses : []).map(s => String(s||'').slice(0,500)).filter(Boolean).slice(0, 400);
      if (responses.length === 0) return res.status(400).json({ error: 'No responses to summarize.' });
      const system = 'You analyze open-ended audience responses for a presenter. Be concise, neutral, and faithful to the data. Respond with ONLY a JSON object, no prose, no code fences.';
      const user = `Question: "${question}"\n\nResponses (${responses.length}):\n- ${responses.join('\n- ')}\n\n`+
        `Return JSON exactly: {"summary":"2-3 sentence overview of what people said","themes":[{"label":"short theme name","count":<approx number of responses in this theme>}],"sentiment":{"positive":<count>,"neutral":<count>,"negative":<count>},"standout":"one short representative or notable quote"}. Use at most 6 themes. Counts should roughly add up to the total.`;
      const { text, source } = await callLLM(system, user, 900);
      const parsed = extractJSON(text);
      if (!parsed) return res.status(502).json({ error: 'AI returned an unreadable result. Try again.' });
      return res.status(200).json({ ok:true, source, ...parsed });
    }

    if (task === 'grade') {
      const question  = String(body.question || '').slice(0, 500);
      const expected  = String(body.expected || '').slice(0, 1000);
      const responses = (Array.isArray(body.responses) ? body.responses : []).slice(0, 200)
        .map(r => ({ id:String(r.id||''), answer:String(r.answer||'').slice(0,800) }));
      if (!expected)            return res.status(400).json({ error: 'Provide the expected/model answer to grade against.' });
      if (responses.length===0) return res.status(400).json({ error: 'No answers to grade.' });
      const system = 'You are a fair grader. Score each student answer against the model answer on meaning, not wording. Respond with ONLY a JSON object, no prose, no code fences.';
      const user = `Question: "${question}"\nModel answer: "${expected}"\n\nAnswers:\n`+
        responses.map(r => `[${r.id}] ${r.answer}`).join('\n')+
        `\n\nReturn JSON exactly: {"grades":[{"id":"<id>","score":<0..1>,"correct":<true|false>,"feedback":"one short sentence"}]}. score is a fraction 0-1; correct is score>=0.6.`;
      const { text, source } = await callLLM(system, user, 1500);
      const parsed = extractJSON(text);
      if (!parsed || !Array.isArray(parsed.grades)) return res.status(502).json({ error: 'AI returned an unreadable result. Try again.' });
      return res.status(200).json({ ok:true, source, grades: parsed.grades });
    }

    return res.status(400).json({ error: 'Unknown task' });
  } catch (e) {
    const code = Number.isInteger(e.code) ? e.code : 500;
    return res.status(code).json({ error: e.msg || e.message || 'AI error' });
  }
};
