/**
 * Texts from Rooftop to dealers — lead alerts and nothing else yet.
 *
 * NOT THE ISV PATH. These go out on Litespeed's own registered brand and
 * campaign in the parent account, from one Litespeed number. Dealer-to-buyer
 * texting is the per-dealer subaccount work in `./setup.ts`; don't route a
 * consumer message through here, ever. See `claude/twilio-a2p-onboarding.md`,
 * "Toll-free: not yet".
 *
 * The recipient is the dealer's own cell, which they typed into Lots ->
 * "Cell for lead texts" themselves. That entry is the opt-in. Twilio handles
 * STOP on the sending number, so a dealer who replies STOP stops getting them
 * without anything here knowing.
 *
 * Never throws. Same contract as `sendEmail`: a provider being down must not
 * cost a shopper their "thanks, we'll be in touch".
 */

const API = 'https://api.twilio.com/2010-04-01';

/**
 * `TWILIO_ALERT_FROM` is either the Litespeed number (+1…) or the Messaging
 * Service SID (MG…) the campaign is attached to. Either works; the service is
 * better if there is one, because Twilio then picks the number and handles
 * STOP at the service level.
 */
function alertConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_ALERT_FROM?.trim();
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

/**
 * US/Canada numbers to E.164. Null for anything that isn't ten digits after an
 * optional leading 1 — a dealer's typo should clear the field, not send texts
 * into the void.
 */
export function toUsE164(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  // NANP: area code and exchange can't start with 0 or 1.
  if (/^[01]/.test(d) || /^[01]/.test(d.slice(3))) return null;
  return `+1${d}`;
}

export async function sendAlertSms(to: string, body: string): Promise<boolean> {
  const cfg = alertConfig();
  if (!cfg) {
    console.warn('[sms] TWILIO_ALERT_FROM / credentials not set; alert not sent');
    return false;
  }
  const dest = toUsE164(to);
  if (!dest) {
    console.error(`[sms] not a textable number: ${JSON.stringify(to)}`);
    return false;
  }

  const form: Record<string, string> = { To: dest, Body: body };
  if (cfg.from.startsWith('MG')) form.MessagingServiceSid = cfg.from;
  else form.From = cfg.from;

  try {
    const res = await fetch(`${API}/Accounts/${cfg.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[sms] Twilio ${res.status} sending to ${dest}: ${text.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[sms] send to ${dest} failed`, err);
    return false;
  }
}

/**
 * The lead text. Shopper's phone up front for the same reason the email leads
 * with it: half of web-form emails are typos. Plain ASCII punctuation — one em
 * dash flips the whole message to UCS-2 and halves the segment length.
 */
export function leadAlertText(input: {
  name: string;
  phone: string;
  vehicleTitle: string;
  stockNumber: string;
  message: string;
  vehicleUrl: string | null;
}): string {
  const parts = [`New lead: ${input.name} - ${input.vehicleTitle} (#${input.stockNumber})`];
  parts.push(input.phone.trim() ? input.phone.trim() : 'No phone given, check your email');
  const msg = input.message.trim().replace(/\s+/g, ' ');
  if (msg) parts.push(`"${msg.length > 120 ? msg.slice(0, 117) + '...' : msg}"`);
  if (input.vehicleUrl) parts.push(input.vehicleUrl);
  parts.push('Rooftop Auto. Reply STOP to end lead texts.');
  return parts.join('\n');
}
