import { nowIso } from '../db.js';

export const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
export const mailFrom = () => process.env.MAIL_FROM || 'Chatter <no-reply@chatter.app>';
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY);

/**
 * Sends transactional email through Resend when RESEND_API_KEY is configured.
 * Without a provider the message is logged to the server console and reported
 * as undelivered — Chatter never claims an email was sent when it was not.
 */
export async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured()) {
    console.warn(`[chatter][mail] not configured — would have sent "${subject}" to ${to}`);
    return { delivered: false, reason: 'mail_not_configured' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: mailFrom(), to: [to], subject, html, text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[chatter][mail] provider error ${response.status}: ${detail.slice(0, 300)}`);
      return { delivered: false, reason: 'mail_provider_error' };
    }
    return { delivered: true };
  } catch (error) {
    console.error('[chatter][mail] request failed:', error.message);
    return { delivered: false, reason: 'mail_provider_unreachable' };
  }
}

function layout(title, body, cta) {
  return `<!doctype html><html><body style="margin:0;background:#070d18;font-family:'Segoe UI',system-ui,sans-serif;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#111a2b;border:1px solid rgba(120,160,220,.18);border-radius:20px;padding:32px;color:#e6eefc">
    <div style="font-size:13px;letter-spacing:.28em;color:#38bdf8;font-weight:700;text-transform:uppercase">Chatter</div>
    <h1 style="font-size:22px;margin:14px 0 10px;color:#f8fbff">${title}</h1>
    <p style="line-height:1.6;color:#a9bad4;margin:0 0 24px">${body}</p>
    <a href="${cta.url}" style="display:inline-block;background:linear-gradient(135deg,#38bdf8,#22d3ee);color:#04121f;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">${cta.label}</a>
    <p style="margin:24px 0 0;font-size:12px;color:#6f819c;word-break:break-all">${cta.url}</p>
    <p style="margin:16px 0 0;font-size:12px;color:#6f819c">If you did not request this, you can safely ignore this email.</p>
  </div></body></html>`;
}

export async function sendPasswordResetEmail(user, token) {
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const result = await sendMail({
    to: user.email,
    subject: 'Reset your Chatter password',
    html: layout('Reset your password', 'Use the button below to choose a new password. This link expires in 60 minutes.', { url, label: 'Reset password' }),
    text: `Reset your Chatter password: ${url}`,
  });
  return { ...result, url };
}

export const stamp = () => nowIso();
