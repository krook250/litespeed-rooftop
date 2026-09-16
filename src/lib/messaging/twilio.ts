/**
 * Twilio REST, by hand.
 *
 * The Compliance Embeddable endpoints are **not in the Twilio Node SDK** —
 * Twilio's own guide says so outright. There is no `client.trusthub.v1
 * .complianceInquiries` to reach for; go looking for one and you will lose an
 * afternoon. So this is `fetch` with Basic auth and form encoding, which is all
 * the API ever wanted.
 *
 * Credentials never leave the server. Nothing in here may be imported from a
 * client component.
 */

const API = 'https://api.twilio.com/2010-04-01';
const TRUSTHUB = 'https://trusthub.twilio.com/v1';

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  /** The ISV primary profile every dealer's secondary profile hangs off. */
  primaryProfileSid: string;
};

/**
 * Null when this deployment has no Twilio credentials, which is the normal
 * state of a preview branch and of anyone's laptop. Callers render "not
 * configured on this deployment" rather than throwing — the same shape the Ad
 * Desk uses, for the same reason: a missing env var is a deployment fact, not
 * an error the dealer caused.
 */
export function twilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const primaryProfileSid = process.env.TWILIO_PRIMARY_PROFILE_SID;
  if (!accountSid || !authToken || !primaryProfileSid) return null;
  return { accountSid, authToken, primaryProfileSid };
}

export function messagingConfigured() {
  return twilioConfig() !== null;
}

export class TwilioError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'TwilioError';
  }
}

async function post<T>(cfg: TwilioConfig, url: string, form: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    cache: 'no-store',
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!res.ok) {
    const e = body as { message?: string; code?: number } | null;
    throw new TwilioError(res.status, e?.code ?? null, e?.message ?? text.slice(0, 400));
  }
  return body as T;
}

/**
 * One subaccount per dealer group.
 *
 * Isolation is the point: a campaign suspension takes down the account it sits
 * in, and one dealer's bad afternoon must not silence every other dealer's
 * texting. It also makes per-dealer rebilling a matter of reading one account
 * rather than apportioning a shared bill.
 */
export async function createSubaccount(cfg: TwilioConfig, friendlyName: string) {
  const r = await post<{ sid: string }>(cfg, `${API}/Accounts.json`, {
    FriendlyName: friendlyName,
  });
  return r.sid;
}

export type InquiryInit = {
  customer_id: string;
  inquiry_id: string;
  inquiry_session_token: string;
};

/**
 * Open (or resume) a Secondary Customer Profile inquiry.
 *
 * Pass `customerId` to resume: a dealer who walked away at the EIN field —
 * which is in a drawer, in a folder, in the other office — comes back to the
 * fields they already filled. Twilio keeps that data 30 days. Without the id
 * they start from the top, and nobody starts from the top twice.
 *
 * The returned `inquiry_session_token` is a Persona JWT valid 24 hours. Mint it
 * per page load. Never store it, never log it.
 */
export async function initCustomerInquiry(
  cfg: TwilioConfig,
  opts: { customerId?: string | null; notificationEmail?: string },
) {
  const url = opts.customerId
    ? `${TRUSTHUB}/ComplianceInquiries/Customers/${encodeURIComponent(opts.customerId)}/Initialize`
    : `${TRUSTHUB}/ComplianceInquiries/Customers/Initialize`;

  const form: Record<string, string> = { PrimaryProfileSid: cfg.primaryProfileSid };
  if (opts.notificationEmail) form.NotificationEmail = opts.notificationEmail;

  return post<InquiryInit>(cfg, url, form);
}

/**
 * The Secondary Customer Profile SID buried in a `customer_id`.
 *
 * Twilio hands back `tri1.us1.account.ACxxx.profile.BUxxx` and the BU is the
 * part every later call wants. Parsing a composite id is normally a smell, but
 * the alternative is a second round-trip to learn something we were already
 * told, and the shape is stable across the documented examples.
 *
 * Returns null rather than guessing if the shape ever changes.
 */
export function profileSidFrom(customerId: string): string | null {
  const m = /\.profile\.(BU[0-9a-f]{32})$/i.exec(customerId);
  return m ? m[1] : null;
}
