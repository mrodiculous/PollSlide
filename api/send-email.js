// PollSlide Transactional Email System
// Vercel Serverless Function — uses Resend (resend.com)
// 
// SETUP INSTRUCTIONS:
// 1. Create a free Resend account at https://resend.com
// 2. Get your API key from the Resend dashboard
// 3. In Vercel: Settings → Environment Variables → add RESEND_API_KEY
// 4. (Optional) Verify your domain in Resend for custom "from" address
//    Without verification, emails send from "onboarding@resend.dev"
// 5. Deploy — the endpoint is live at app.pollslide.com/api/send-email
//
// USAGE (from presenter.html or Stripe webhook):
//   fetch('/api/send-email', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ type: 'welcome', to: 'user@example.com', data: {} })
//   });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'PollSlide <help@pollslide.com>';
const BRAND_COLOR = '#6c63ff';
const BRAND_PINK = '#ff6584';
const BRAND_GREEN = '#43e97b';
const BRAND_AMBER = '#f7b731';

// ── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
// All templates use inline CSS for maximum email client compatibility.
// Tested with: Gmail, Outlook, Apple Mail, Yahoo, Samsung Email.

function baseLayout(title, body, ctaUrl, ctaText) {
  return `<!DOCTYPE html>
<html lang="en">
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

const TEMPLATES = {
  // Generic notification (used by the legal/compliance watcher and other internal alerts).
  notify: (data) => ({
    subject: data.subject || 'PollSlide notification',
    html: baseLayout(data.subject || 'Notification',
      `<h1 style="font-size:22px;font-weight:800;margin:0 0 12px;color:#15152a;">${data.heading || 'Heads up'}</h1>
       <div style="font-size:15px;color:#5a5a78;line-height:1.6;">${data.body || ''}</div>`,
      data.ctaUrl || 'https://app.pollslide.com/admin', data.ctaText || 'Open admin')
  }),
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

  upgrade: (data) => ({
    subject: `You're now on PollSlide ${data.plan || 'Pro'}!`,
    html: baseLayout('Upgrade Confirmation', `
      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#15152a;">You're on ${data.plan || 'Pro'}! 🎉</h1>
      <p style="font-size:16px;color:#5a5a78;margin:0 0 18px;">Your upgrade is active. Here's what you now have:</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f4;"><span style="color:${BRAND_GREEN};">✓</span> Unlimited participants</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f4;"><span style="color:${BRAND_GREEN};">✓</span> Unlimited presentations</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f4;"><span style="color:${BRAND_GREEN};">✓</span> Response reports & CSV export</td></tr>
        <tr><td style="padding:10px 14px;"><span style="color:${BRAND_GREEN};">✓</span> Polly AI question designer</td></tr>
      </table>
    `, 'https://app.pollslide.com/presenter', 'Open PollSlide')
  }),

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

// ── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured. Add it in Vercel Environment Variables.' });
  }

  const { type, to, data } = req.body || {};

  if (!type || !to) {
    return res.status(400).json({ error: 'Missing "type" or "to" field.', available_types: Object.keys(TEMPLATES) });
  }

  const templateFn = TEMPLATES[type];
  if (!templateFn) {
    return res.status(400).json({ error: `Unknown email type "${type}".`, available_types: Object.keys(TEMPLATES) });
  }

  const { subject, html } = templateFn(data || {});

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
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
