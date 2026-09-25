// One-click unsubscribe from PollSlide announcement emails.
// GET /api/unsubscribe?u=<uid>&s=<sig>
// The signature is an HMAC of the uid made with INTERNAL_API_KEY (see api/send-email.js
// unsubSig), so the link only ever works for the account it was sent to. It only turns
// announcements OFF — account, security and billing emails are unaffected.
const crypto = require('crypto');
const admin = require('firebase-admin');
const { getApp, configured } = require('../lib/quota');
const { unsubSig } = require('./send-email');

function page(title, msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f4f4fc;color:#15152a;">
<div style="max-width:460px;margin:12vh auto;background:#fff;border:1px solid #e8e8f0;border-radius:16px;padding:32px;text-align:center;">
<div style="font-size:22px;font-weight:800;color:#6c63ff;margin-bottom:14px;">PollSlide</div>
<h1 style="font-size:20px;margin:0 0 10px;">${title}</h1><p style="color:#5a5a78;line-height:1.6;margin:0;">${msg}</p>
<p style="margin:22px 0 0;"><a href="https://app.pollslide.com/presenter" style="color:#6c63ff;">Back to PollSlide</a></p></div></body></html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const uid = String((req.query && req.query.u) || '');
  const sig = String((req.query && req.query.s) || '');
  const expected = unsubSig(uid);
  const good = expected && sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!good) return res.status(400).send(page('Link not valid', 'This unsubscribe link is incomplete or has been altered. Reply to any PollSlide email and we will remove you by hand.'));
  if (!configured()) return res.status(503).send(page('Please try again', 'We could not update your preferences just now. Reply to the email and we will do it for you.'));
  try {
    await admin.database(getApp()).ref('users/' + uid + '/emailPrefs').update({ announcements: false, announcementsChangedAt: Date.now() });
    return res.status(200).send(page('You are unsubscribed', 'You will no longer receive announcement emails from PollSlide. Emails about your account, security and billing will still reach you.'));
  } catch (e) {
    return res.status(500).send(page('Please try again', 'We could not update your preferences just now. Reply to the email and we will do it for you.'));
  }
};
