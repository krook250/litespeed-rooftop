import 'server-only';

/**
 * Rooftop Auto — outbound transactional email, behind a seam.
 *
 * WHY A SEAM AND NOT JUST A RESEND CALL
 * `rooftopauto.com` already runs Google Workspace with SPF, DKIM and DMARC all
 * passing, and that took work. Whatever sends password resets has to coexist
 * with it rather than replace it. Resend on a dedicated sending subdomain is the
 * default here because it leaves the root zone untouched, but Workspace SMTP and
 * SES are both reasonable alternatives — so callers deal in `sendEmail()` and the
 * provider lives in one function.
 *
 * WHAT HAPPENS WITH NO KEY SET, AND WHY IT IS NOT A THROW
 * Local dev, preview deployments and the cloud build all run without
 * `RESEND_API_KEY`. Throwing would make every password-reset request a 500 in
 * those environments and, worse, would leak whether an address exists — a
 * missing user returns cleanly while a real one explodes. So an unconfigured
 * transport logs the whole message, reset link included, and reports success.
 * The link in the server log is what makes the flow testable locally.
 *
 * That does mean a **production** deployment with no key silently sends nothing.
 * The log line is deliberately loud, and `emailConfigured()` exists so a screen
 * can say so out loud rather than leaving an operator guessing.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Who the mail comes from.
 *
 * Must be on a domain verified with the provider. Use a sending subdomain —
 * `no-reply@mail.rooftopauto.com` — rather than the root: the root's SPF and
 * DKIM belong to Google Workspace and are working, and a subdomain gets its own
 * records without anybody touching them.
 */
const FROM = process.env.EMAIL_FROM || 'Rooftop Auto <no-reply@mail.rooftopauto.com>';

/** Where a human should reply. A no-reply that swallows replies is hostile. */
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@rooftopauto.com';

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Overrides the default reply address for this one message.
   *
   * Exists for lead notifications: a dealer who hits Reply on "new lead" means
   * to reply to the shopper, not to open a support ticket with us. Everything
   * else leaves this unset and keeps REPLY_TO.
   */
  replyTo?: string;
  /** Overrides the default sender for this one message (sales outreach). */
  from?: string;
};

/**
 * Send, or log loudly. Never throws.
 *
 * Deliberately swallows provider failures. Better Auth calls this from inside
 * the password-reset endpoint, and an exception there turns a "we sent you a
 * link" into a 500 — which tells an attacker the address was real, and tells a
 * dealer their account is broken when in fact one API call timed out. A failure
 * belongs in the logs, and the user belongs on the same neutral confirmation
 * screen either way.
 */
export async function sendEmail(msg: OutboundEmail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    console.warn(
      `[email] RESEND_API_KEY is not set — nothing was sent.\n` +
        `  to:      ${msg.to}\n` +
        `  subject: ${msg.subject}\n` +
        `  ${msg.text.replace(/\n/g, '\n  ')}`,
    );
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: msg.from || FROM,
        to: [msg.to],
        reply_to: msg.replyTo || REPLY_TO,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });

    if (!res.ok) {
      // Body, not just status: Resend returns the actual reason (unverified
      // domain, bad from address) and the status alone sends you hunting.
      console.error(`[email] send failed ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send threw', err);
    return false;
  }
}

/* ------------------------------------------------------------- templates */

/**
 * Plain, and that is a decision.
 *
 * On 5 Aug 2026 Google Safe Browsing flagged this domain as a deceptive page for
 * showing a credential form with no statement of who operates it — see the
 * comment in `src/components/auth-shell.tsx`. A password-reset email is the same
 * shape of artifact: an unexpected message asking someone to click through and
 * type a password. Heavy marketing chrome, hidden link text and a giant branded
 * button are what phishing looks like, so this says who it is from, shows the
 * destination URL as text, states the expiry, and tells the reader what to do if
 * they did not ask for it.
 */
export function resetPasswordEmail(url: string, name: string): OutboundEmail {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = [
    greeting,
    '',
    'Someone asked to reset the password on your Rooftop Auto account.',
    'Open this link to choose a new one:',
    '',
    url,
    '',
    'The link works once and expires in an hour.',
    '',
    "If you didn't ask for this, you can ignore this email — nothing has changed,",
    'and your current password still works.',
    '',
    'Rooftop Auto',
  ].join('\n');

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;max-width:520px">
  <p>${greeting}</p>
  <p>Someone asked to reset the password on your <strong>Rooftop Auto</strong> account.</p>
  <p><a href="${url}" style="color:#047857">Choose a new password</a></p>
  <p style="font-size:13px;color:#6b7280">Or paste this into your browser:<br><span style="word-break:break-all">${url}</span></p>
  <p style="font-size:13px;color:#6b7280">The link works once and expires in an hour.</p>
  <p style="font-size:13px;color:#6b7280">If you didn&rsquo;t ask for this you can ignore this email &mdash; nothing has changed, and your current password still works.</p>
  <p style="font-size:13px;color:#6b7280">Rooftop Auto</p>
</div>`;

  return { to: '', subject: 'Reset your Rooftop Auto password', html, text };
}

/**
 * A shopper asked about a car.
 *
 * WHY THE PHONE NUMBER IS THE HEADLINE AND THE EMAIL IS NOT.
 *
 * The first real lead this product ever took arrived with the address
 * `…@gmail.coms` — a typo that passes the form's regex and every other
 * syntactic check, and bounces. A shopper typing on a phone gets an address
 * wrong often enough that treating email as the reachable channel is a mistake.
 * The phone is printed first, big, and the message text is quoted in full
 * because it usually names the vehicle even when nothing else survives.
 *
 * Plain HTML, same reasoning as `resetPasswordEmail`: this lands in a dealer's
 * inbox at 8pm and has to read as a notification, not a campaign.
 */
export function newLeadEmail(input: {
  to: string;
  rooftopName: string;
  vehicleTitle: string;
  stockNumber: string;
  vehicleUrl: string | null;
  name: string;
  email: string;
  phone: string;
  message: string;
}): OutboundEmail {
  const phone = input.phone.trim() || 'not given';
  const lines = [
    `${input.name} asked about the ${input.vehicleTitle} (stock #${input.stockNumber}).`,
    '',
    `Phone:  ${phone}`,
    `Email:  ${input.email}`,
    '',
    input.message ? `"${input.message}"` : '(no message)',
    '',
    input.vehicleUrl ? input.vehicleUrl : '',
    '',
    `Sent by Rooftop Auto for ${input.rooftopName}. Reply to this email to answer ${input.name}.`,
  ];

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;max-width:520px">
  <p><strong>${esc(input.name)}</strong> asked about the ${esc(input.vehicleTitle)} (stock #${esc(input.stockNumber)}).</p>
  <p style="font-size:20px;margin:18px 0 4px"><a href="tel:${esc(input.phone.replace(/[^\d+]/g, ''))}" style="color:#047857;text-decoration:none"><strong>${esc(phone)}</strong></a></p>
  <p style="margin:0 0 18px"><a href="mailto:${esc(input.email)}" style="color:#047857">${esc(input.email)}</a></p>
  ${input.message ? `<blockquote style="margin:0 0 18px;padding:10px 14px;border-left:3px solid #d1d5db;color:#374151">${esc(input.message)}</blockquote>` : '<p style="color:#6b7280">(no message)</p>'}
  ${input.vehicleUrl ? `<p><a href="${esc(input.vehicleUrl)}" style="color:#047857">See the listing</a></p>` : ''}
  <p style="font-size:13px;color:#6b7280">Sent by Rooftop Auto for ${esc(input.rooftopName)}. Reply to this email to answer ${esc(input.name)}.</p>
</div>`;

  return {
    to: input.to,
    subject: `New lead: ${input.name} — ${input.vehicleTitle} (#${input.stockNumber})`,
    html,
    text: lines.join('\n'),
    /* Reply goes to the shopper. If their address is mistyped it bounces back to
     * the dealer, which is the correct place for that bounce to land. */
    replyTo: input.email,
  };
}

/** Everything interpolated into the HTML above is visitor-supplied. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
