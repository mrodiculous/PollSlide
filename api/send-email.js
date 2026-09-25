// PollSlide Transactional Email System
// Vercel Serverless Function — uses Resend (resend.com)
//
// SETUP INSTRUCTIONS:
// 1. Create a free Resend account at https://resend.com
// 2. Get your API key from the Resend dashboard
// 3. In Vercel: Settings → Environment Variables → add RESEND_API_KEY
// 4. Add INTERNAL_API_KEY = a long random string (e.g. `openssl rand -hex 32`).
//    Server-side callers (stripe-webhook, legal-watch, team) send it back as the
//    x-internal-key header. ⚠️ Set it BEFORE deploying this version, or those
//    internal emails will be skipped (they're all best-effort/non-fatal).
// 5. (Optional) Verify your domain in Resend for custom "from" address
//    Without verification, emails send from "onboarding@resend.dev"
// 6. Deploy — the endpoint is live at app.pollslide.com/api/send-email
//
// AUTHORIZATION (this endpoint is NOT public — it can email anyone from our
// domain, so every caller must prove who they are):
//   • internal server-to-server: header  x-internal-key: <INTERNAL_API_KEY>
//     → any template, any recipient.
//   • admin browser (admin.html): Authorization: Bearer <Firebase idToken>
//     whose verified email is in lib/quota.js ADMIN_EMAILS
//     → any template, any recipient.
//   • signed-in user (presenter.html): Authorization: Bearer <Firebase idToken>
//     → USER_TYPES templates only, recipient FORCED to the token's own verified
//       email, rate-limited per uid (email_quota/<uid> in RTDB).
//   • anything else → 401/403.

const crypto = require('crypto');
const admin = require('firebase-admin');
const { verifyToken, tokenFrom, getApp, configured, ADMIN_EMAILS } = require('../lib/quota');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'PollSlide <help@pollslide.com>';
const BRAND_COLOR = '#6c63ff';
const BRAND_PINK = '#ff6584';
const BRAND_GREEN = '#43e97b';
const BRAND_AMBER = '#f7b731';

// ── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
// All templates use inline CSS for maximum email client compatibility.
// Tested with: Gmail, Outlook, Apple Mail, Yahoo, Samsung Email.

function baseLayout(title, body, ctaUrl, ctaText, lang) {
  return `<!DOCTYPE html>
<html lang="${lang || 'en'}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f4fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#15152a;line-height:1.6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4fc;padding:24px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e8f0;">

<!-- Logo header -->
<tr><td style="padding:28px 32px 0;text-align:center;">
  <div style="font-size:22px;font-weight:800;color:${BRAND_COLOR};letter-spacing:-0.02em;">
    <span style="display:inline-block;width:28px;height:28px;background:linear-gradient(135deg,${BRAND_COLOR},${BRAND_PINK});border-radius:7px;vertical-align:middle;margin-right:8px;"></span>
    PollSlide
  </div>
</td></tr>

<!-- Body -->
<tr><td style="padding:24px 32px 28px;">
  ${body}
  ${ctaUrl ? `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
  <tr><td align="center">
    <a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;background:${BRAND_COLOR};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:12px;">${ctaText || 'Open PollSlide'}</a>
  </td></tr></table>` : ''}
</td></tr>

<!-- Footer -->
<tr><td style="padding:20px 32px;background:#f9f9fc;border-top:1px solid #e8e8f0;text-align:center;font-size:12px;color:#9090b8;line-height:1.8;">
  PollSlide Technologies LLC<br>
  <a href="https://pollslide.com/privacy" style="color:#9090b8;">Privacy Policy</a> &middot;
  <a href="https://pollslide.com/terms" style="color:#9090b8;">Terms of Service</a> &middot;
  <a href="mailto:help@pollslide.com" style="color:#9090b8;">help@pollslide.com</a>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// Escape user-influenced values before interpolating into HTML.
const esc = s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/* A subject line is a mail HEADER, not HTML: escaping it would show "&amp;" in the inbox,
   and a line break in it is the one character that could do damage. So: one line, capped. */
const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);

/* The chrome of the ticket-reply email, in the language the user was using PollSlide in
   when they wrote in (tickets record UI_LANG as `lang`; the admin can override it for
   older tickets that have none). ONLY the chrome: the reply itself goes out exactly as the
   admin wrote it — a machine-translated support answer is a promise nobody reviewed.
   Register follows ui-lang.js, the anchor: du, tu, tú, tu, European Portuguese. */
const TICKET_REPLY_CHROME = {
  en: { subject: s => `PollSlide Support replied: ${s}`, heading: "We've replied to your request",
        request: 'Your request', button: 'Reply in PollSlide',
        note: 'You can answer right in PollSlide — the button below opens this conversation. Replying to this email reaches us too.' },
  es: { subject: s => `El soporte de PollSlide ha respondido: ${s}`, heading: 'Hemos respondido a tu solicitud',
        request: 'Tu solicitud', button: 'Responder en PollSlide',
        note: 'Puedes contestar directamente en PollSlide: el botón de abajo abre esta conversación. Si respondes a este correo, también nos llega.' },
  de: { subject: s => `Der PollSlide-Support hat geantwortet: ${s}`, heading: 'Wir haben auf deine Anfrage geantwortet',
        request: 'Deine Anfrage', button: 'In PollSlide antworten',
        note: 'Du kannst direkt in PollSlide antworten – der Button unten öffnet diese Unterhaltung. Eine Antwort auf diese E-Mail erreicht uns auch.' },
  fr: { subject: s => `L’assistance PollSlide t’a répondu : ${s}`, heading: 'Nous avons répondu à ta demande',
        request: 'Ta demande', button: 'Répondre dans PollSlide',
        note: 'Tu peux répondre directement dans PollSlide : le bouton ci-dessous ouvre cette conversation. Une réponse à cet e-mail nous parvient aussi.' },
  pt: { subject: s => `O apoio PollSlide respondeu: ${s}`, heading: 'Respondemos ao seu pedido',
        request: 'O seu pedido', button: 'Responder no PollSlide',
        note: 'Pode responder diretamente no PollSlide: o botão abaixo abre esta conversa. Se responder a este e-mail, a mensagem também nos chega.' },
  it: { subject: s => `Il supporto PollSlide ha risposto: ${s}`, heading: 'Abbiamo risposto alla tua richiesta',
        request: 'La tua richiesta', button: 'Rispondi in PollSlide',
        note: 'Puoi rispondere direttamente in PollSlide: il pulsante qui sotto apre questa conversazione. Anche una risposta a questa email ci arriva.' },
};

const TEMPLATES = {
  /* Sent by admin.html replyTicket when the owner answers a support ticket. Until
     2026-09-15 a reply went only to the in-app inbox, so a user who filed a ticket and
     closed the tab was never told it had been answered.
     Admin-only (NOT in USER_TYPES): its body is free text, so a user able to trigger it
     could send anything from our domain. reply_to is help@pollslide.com so hitting Reply
     in a mail app still reaches support rather than a no-reply dead end. */
  ticket_reply: (data) => {
    const lang = TICKET_REPLY_CHROME[data.lang] ? data.lang : 'en';
    const c = TICKET_REPLY_CHROME[lang];
    const subj = oneLine(data.subject) || c.request;
    const reply = esc(data.reply).replace(/\r\n|\r|\n/g, '<br>');   // <br>, not pre-wrap: Outlook ignores white-space
    const url = 'https://app.pollslide.com/presenter?support=' + encodeURIComponent(String(data.ticketId || ''));
    return {
      subject: c.subject(subj),
      replyTo: 'help@pollslide.com',
      html: baseLayout(esc(c.heading), `
        <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;color:#15152a;">${esc(c.heading)}</h1>
        <p style="font-size:12px;color:#9090b8;margin:0 0 2px;text-transform:uppercase;letter-spacing:.05em;">${esc(c.request)}</p>
        <p style="font-size:15px;font-weight:700;color:#15152a;margin:0 0 16px;">${esc(subj)}</p>
        <div style="background:#f4f4fc;border-radius:10px;padding:14px 16px;font-size:15px;color:#15152a;line-height:1.6;border-left:3px solid ${BRAND_COLOR};margin:0 0 16px;">${reply}</div>
        <p style="font-size:13px;color:#5a5a78;margin:0;">${esc(c.note)}</p>
      `, url, esc(c.button), lang),
    };
  },

  // Sent by api/team.js when an owner/admin invites someone to a workspace.
  team_invite: (data) => ({
    subject: `${esc(data.invitedBy) || 'A teammate'} invited you to ${esc(data.wsName) || 'their team'} on PollSlide`,
    html: baseLayout('Team Invitation', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#15152a;">You're invited! 🎉</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;"><strong>${esc(data.invitedBy) || 'A teammate'}</strong> invited you to join <strong>${esc(data.wsName) || 'their team'}</strong> on PollSlide${data.role === 'admin' ? ' as an <strong>admin</strong>' : ''}.</p>
      <div style="background:#f4f4fc;border-radius:10px;padding:14px 16px;font-size:14px;color:#5a5a78;margin:0 0 18px;border-left:3px solid ${BRAND_COLOR};">
        Sign in — or create a free account — using <strong>this email address</strong>, and you'll join the team automatically with its paid features unlocked. No code needed.
      </div>
      <p style="font-size:13px;color:#9090b8;margin:0;">Didn't expect this? You can simply ignore this email.</p>
    `, 'https://app.pollslide.com/presenter', 'Join the team →')
  }),

  // Admin broadcast (admin.html → "Broadcast" / "Send message"), sent alongside the in-app
  // message. ADMIN-ONLY — not in USER_TYPES — because the body is free text. The text is
  // escaped and line breaks kept; every copy carries a one-click unsubscribe (built by the
  // handler from a server-side signature, so it cannot be forged for another account).
  announcement: (data) => {
    const tone = { success: BRAND_GREEN, warning: BRAND_AMBER, danger: BRAND_PINK, info: BRAND_COLOR }[data.type] || BRAND_COLOR;
    const heading = { success: 'News from PollSlide', warning: 'Important: PollSlide notice', danger: 'Important: PollSlide notice' }[data.type] || 'A message from PollSlide';
    const text = esc(data.text).replace(/\r?\n/g, '<br>');
    const unsub = data.unsubUrl
      ? `<p style="font-size:12px;color:#9090b8;margin:18px 0 0;">You're receiving this because you have a PollSlide account. <a href="${esc(data.unsubUrl)}" style="color:#9090b8;">Unsubscribe from announcements</a>.</p>`
      : '';
    return {
      subject: oneLine(data.subject) || heading,
      replyTo: 'help@pollslide.com',
      html: baseLayout(esc(heading), `
        <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;color:#15152a;">${esc(heading)}</h1>
        <div style="background:#f4f4fc;border-radius:10px;padding:14px 16px;font-size:15px;color:#15152a;line-height:1.6;border-left:3px solid ${tone};">${text}</div>
        ${unsub}
      `, 'https://app.pollslide.com/presenter', 'Open PollSlide'),
    };
  },

  // Generic notification. Used by internal alerts (legal/compliance watchers, auto-pilot,
  // backups) AND by user-facing mail such as collaboration invites (api/share.js).
  // The admin button is for STAFF ONLY: a collaborator has no use for it, and handing
  // every recipient a link to the admin console advertises where it lives. So the default
  // button depends on who is receiving it (ctx.staff, decided in the handler from the
  // recipient address) — never on the caller remembering to override it.
  notify: (data, ctx) => {
    const staff = !!(ctx && ctx.staff);
    const wantsAdmin = !data.ctaUrl || isAdminUrl(data.ctaUrl);
    const ctaUrl  = staff ? (data.ctaUrl || 'https://app.pollslide.com/admin')
                          : (wantsAdmin ? 'https://app.pollslide.com/presenter' : data.ctaUrl);
    const ctaText = staff ? (data.ctaText || 'Open admin')
                          : (wantsAdmin ? 'Open PollSlide' : (data.ctaText || 'Open PollSlide'));
    return {
      subject: data.subject || 'PollSlide notification',
      html: baseLayout(data.subject || 'Notification',
        `<h1 style="font-size:22px;font-weight:800;margin:0 0 12px;color:#15152a;">${data.heading || 'Heads up'}</h1>
         <div style="font-size:15px;color:#5a5a78;line-height:1.6;">${data.body || ''}</div>`,
        ctaUrl, ctaText)
    };
  },
  welcome: (data) => ({
    subject: 'Welcome to PollSlide!',
    html: baseLayout('Welcome to PollSlide', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#15152a;">Welcome to PollSlide!</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">Your account is ready. Here's how to get started:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td style="padding:12px 14px;background:#f4f4fc;border-radius:10px;border-left:3px solid ${BRAND_COLOR};margin-bottom:8px;">
          <strong style="color:${BRAND_COLOR};">Step 1:</strong> Create a presentation and add your poll questions
        </td></tr>
        <tr><td style="height:8px;"></td></tr>
        <tr><td style="padding:12px 14px;background:#f4f4fc;border-radius:10px;border-left:3px solid ${BRAND_PINK};">
          <strong style="color:${BRAND_PINK};">Step 2:</strong> Copy the QR code onto your Keynote or PowerPoint slide
        </td></tr>
        <tr><td style="height:8px;"></td></tr>
        <tr><td style="padding:12px 14px;background:#f4f4fc;border-radius:10px;border-left:3px solid ${BRAND_GREEN};">
          <strong style="color:${BRAND_GREEN};">Step 3:</strong> Present — your audience scans the QR and answers live
        </td></tr>
      </table>
    `, 'https://app.pollslide.com/presenter', 'Create your first poll →')
  }),

  upgrade: (data) => {
    // Tier-aware feature list so a Team subscriber doesn't get Pro's benefits (or the
    // wrong Polly limit). planKey is the raw tier ('pro'|'team_small'|'team_large').
    const FEATS = {
      pro:        ['Unlimited participants & presentations', 'Response reports, CSV export & data history', 'Polly AI — 20 generations / month', 'Mac companion on any platform'],
      team_small: ['Everything in Pro', 'Up to 5 team members', 'Shared question & deck library', 'Team admin panel & roles', 'Polly AI — 100 generations / month'],
      team_large: ['Everything in Team Small', 'Up to 25 team members', 'Org-wide usage analytics', 'Bulk member management', 'Polly AI — 300 generations / month'],
    };
    const feats = FEATS[data.planKey] || FEATS.pro;
    const rows = feats.map((f, i) =>
      `<tr><td style="padding:10px 14px;${i < feats.length - 1 ? 'border-bottom:1px solid #f0f0f4;' : ''}"><span style="color:${BRAND_GREEN};">✓</span> ${f}</td></tr>`
    ).join('');
    return {
      subject: `You're now on PollSlide ${data.plan || 'Pro'}!`,
      html: baseLayout('Plan Confirmation', `
        <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#15152a;">You're on ${data.plan || 'Pro'}! 🎉</h1>
        <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">Your plan is active. Here's what you now have:</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      `, 'https://app.pollslide.com/presenter', 'Open PollSlide')
    };
  },

  receipt: (data) => ({
    subject: `PollSlide receipt — $${data.amount || '12.00'}`,
    html: baseLayout('Payment Receipt', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#15152a;">Payment received</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">Thanks for your payment. Here are the details:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4fc;border-radius:10px;padding:4px 0;">
        <tr><td style="padding:10px 16px;font-size:14px;color:#5a5a78;">Plan</td>
            <td style="padding:10px 16px;font-size:14px;font-weight:700;text-align:right;">${data.plan || 'Pro'}</td></tr>
        <tr><td style="padding:10px 16px;font-size:14px;color:#5a5a78;">Amount</td>
            <td style="padding:10px 16px;font-size:14px;font-weight:700;text-align:right;">$${data.amount || '12.00'}</td></tr>
        <tr><td style="padding:10px 16px;font-size:14px;color:#5a5a78;">Period</td>
            <td style="padding:10px 16px;font-size:14px;text-align:right;">${data.period || 'Monthly'}</td></tr>
        <tr><td style="padding:10px 16px;font-size:14px;color:#5a5a78;">Date</td>
            <td style="padding:10px 16px;font-size:14px;text-align:right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
      </table>
      <p style="font-size:13px;color:#9090b8;margin:18px 0 0;">Questions about billing? Reply to this email or contact <a href="mailto:help@pollslide.com" style="color:${BRAND_COLOR};">help@pollslide.com</a></p>
    `, null, null)
  }),

  payment_failed: (data) => ({
    subject: 'Action needed — your PollSlide payment failed',
    html: baseLayout('Payment Failed', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:${BRAND_PINK};">Payment failed</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">We couldn't process your last payment. Please update your payment method within 7 days to keep your ${data.plan || 'Pro'} features.</p>
      <div style="background:#fef2f4;border:1px solid #fcd5db;border-radius:10px;padding:14px 16px;font-size:14px;color:#a32d2d;margin:0 0 8px;">
        After 7 days, your account will be downgraded to the Free plan. Your presentations and data will be preserved.
      </div>
    `, 'https://app.pollslide.com/presenter', 'Update payment method')
  }),

  usage_warning: (data) => ({
    subject: `You're approaching your ${data.limit_type || 'plan'} limit`,
    html: baseLayout('Usage Limit Warning', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:${BRAND_AMBER};">Heads up — you're near your limit</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">You've used <strong>${data.used || '?'} of ${data.max || '?'}</strong> ${data.limit_type || 'items'} on your ${data.plan || 'Free'} plan this month.</p>
      <p style="font-size:15px;color:#5a5a78;">Upgrade to Pro for unlimited access — no interruptions, no caps.</p>
    `, 'https://pollslide.com/pricing', 'See plans & pricing')
  }),

  deletion_confirmed: (data) => ({
    subject: 'Your PollSlide account has been deleted',
    html: baseLayout('Account Deleted', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#15152a;">Account deleted</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">Your PollSlide account and all associated data have been permanently deleted as requested.</p>
      <p style="font-size:14px;color:#5a5a78;">This action was completed on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.</p>
      <p style="font-size:14px;color:#9090b8;margin:18px 0 0;">If you didn't request this, contact us immediately at <a href="mailto:help@pollslide.com" style="color:${BRAND_COLOR};">help@pollslide.com</a></p>
    `, null, null)
  }),

  downgrade: (data) => ({
    subject: 'Your PollSlide account has been downgraded to Free',
    html: baseLayout('Account Downgraded', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#15152a;">Moved to the Free plan</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">Your ${data.oldPlan || 'Pro'} subscription has ended and your account is now on the Free plan.</p>
      <div style="background:#f4f4fc;border-radius:10px;padding:14px 16px;font-size:14px;margin:0 0 18px;">
        <strong>Your data is safe.</strong> All your presentations and response data are preserved. Free plan limits (25 participants, 3 presentations) now apply.
      </div>
      <p style="font-size:14px;color:#5a5a78;">You can upgrade again at any time to restore full access.</p>
    `, 'https://pollslide.com/pricing', 'See plans')
  }),

  security_alert: (data) => ({
    subject: 'Security alert — unusual activity on your PollSlide account',
    html: baseLayout('Security Alert', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:${BRAND_PINK};">Security alert</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">We detected unusual activity on your PollSlide account. If this wasn't you, please reset your password immediately.</p>
      <div style="background:#fef2f4;border:1px solid #fcd5db;border-radius:10px;padding:14px 16px;font-size:14px;color:#a32d2d;">
        ${data.detail || 'Suspicious sign-in attempt detected.'}
      </div>
    `, 'https://app.pollslide.com/presenter', 'Reset my password')
  }),
};

// ── AUTHORIZATION ────────────────────────────────────────────────────────────
// Templates a signed-in (non-admin) browser user may trigger — only ever to
// their own verified address.
const USER_TYPES = ['welcome'];

/* Staff = the admin accounts plus the ops/legal alert inboxes. Only these addresses may
   ever receive a link into the admin console. Everyone else — collaborators, customers —
   gets a PollSlide link instead. */
const lc = e => String(e || '').trim().toLowerCase();
function staffSet() {
  return new Set([...ADMIN_EMAILS, process.env.LEGAL_ALERT_EMAIL, process.env.OPS_ALERT_EMAIL,
                  'help@pollslide.com'].filter(Boolean).map(lc));
}
/* One-click unsubscribe. The link carries the uid and an HMAC of it made with a server
   secret, so nobody can unsubscribe (or probe) someone else's account by editing the URL. */
function unsubSig(uid) {
  const key = process.env.INTERNAL_API_KEY || '';
  if (!key || !uid) return '';
  return crypto.createHmac('sha256', key).update('unsub:' + uid).digest('hex').slice(0, 32);
}
function unsubUrl(uid) {
  const sig = unsubSig(uid);
  return sig ? `https://app.pollslide.com/api/unsubscribe?u=${encodeURIComponent(uid)}&s=${sig}` : '';
}
function isStaffRecipient(to) { return staffSet().has(lc(to)); }
function isAdminUrl(u) { return /pollslide\.com\/admin(\.html)?(\b|[\/?#]|$)/i.test(String(u || '')); }
/* Last line of defence for non-staff mail: whatever a template or caller put in, no link
   into the admin console leaves this server addressed to a customer. */
function stripAdminLinks(html) {
  return String(html)
    .replace(/https:\/\/app\.pollslide\.com\/admin(\.html)?[^"'\s<]*/gi, 'https://app.pollslide.com/presenter')
    .replace(/>\s*Open admin\s*</gi, '>Open PollSlide<');
}
const USER_HOURLY_LIMIT = 5;

function internalKeyOk(req) {
  const expected = process.env.INTERNAL_API_KEY || '';
  const got = String(req.headers['x-internal-key'] || '');
  if (!expected || !got) return false;
  const a = Buffer.from(expected), b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Sliding hourly counter at email_quota/<uid>; the transaction aborts (returns
// undefined) once the cap is hit. Any failure counts as "not allowed".
async function rateLimitOk(uid) {
  try {
    const hour = Math.floor(Date.now() / 3600000);
    const r = await admin.database(getApp()).ref('email_quota/' + uid).transaction(v => {
      if (!v || v.h !== hour) return { h: hour, n: 1 };
      if (v.n >= USER_HOURLY_LIMIT) return;
      return { h: hour, n: v.n + 1 };
    });
    return !!r.committed;
  } catch (e) { return false; }
}

// ── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS: browser callers are the app itself (presenter.html / admin.html).
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured. Add it in Vercel Environment Variables.' });
  }

  const { type, data } = req.body || {};
  let { to } = req.body || {};

  if (!internalKeyOk(req)) {
    if (!configured()) return res.status(503).json({ error: 'Email authorization unavailable (Firebase Admin not configured).' });
    const tok = tokenFrom(req);
    if (!tok) return res.status(401).json({ error: 'Sign in required.' });
    let who;
    try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Your session expired — sign in again.' }); }
    if (!ADMIN_EMAILS.includes(who.email)) {
      if (!USER_TYPES.includes(type)) return res.status(403).json({ error: 'This email type is server-only.' });
      if (!who.email) return res.status(403).json({ error: 'Your account has no verified email.' });
      to = who.email; // users can only email themselves
      if (!(await rateLimitOk(who.uid))) return res.status(429).json({ error: 'Too many emails — try again later.' });
    }
  }

  if (!type || !to) {
    return res.status(400).json({ error: 'Missing "type" or "to" field.', available_types: Object.keys(TEMPLATES) });
  }

  const templateFn = TEMPLATES[type];
  if (!templateFn) {
    return res.status(400).json({ error: `Unknown email type "${type}".`, available_types: Object.keys(TEMPLATES) });
  }

  if (type === 'announcement') {
    const uid = data && typeof data.uid === 'string' ? data.uid : '';
    if (uid) {
      try {
        const pref = await admin.database(getApp()).ref('users/' + uid + '/emailPrefs/announcements').get();
        if (pref.exists() && pref.val() === false) return res.status(200).json({ success: true, skipped: 'unsubscribed', type, to });
      } catch (e) { /* cannot read the preference — fall through and send; the link still works */ }
      data.unsubUrl = unsubUrl(uid);
    }
  }

  const staff = isStaffRecipient(to);
  let { subject, html, replyTo } = templateFn(data || {}, { staff });
  if (!staff) html = stripAdminLinks(html);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(Object.assign({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }, replyTo ? { reply_to: replyTo } : {})),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend error:', result);
      return res.status(response.status).json({ error: 'Email send failed', detail: result });
    }

    return res.status(200).json({ success: true, id: result.id, type, to });
  } catch (err) {
    console.error('Email send error:', err);
    return res.status(500).json({ error: 'Internal error sending email' });
  }
};

// For scripts/tests/tickets.test.js — the template and the authorization list are
// asserted directly, not by reading this file as text.
module.exports.TEMPLATES = TEMPLATES;
module.exports.USER_TYPES = USER_TYPES;
module.exports.TICKET_REPLY_CHROME = TICKET_REPLY_CHROME;
module.exports.isStaffRecipient = isStaffRecipient;
module.exports.stripAdminLinks = stripAdminLinks;
module.exports.unsubSig = unsubSig;
