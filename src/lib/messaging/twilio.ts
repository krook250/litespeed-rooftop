import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Twilio over plain REST, for dealer numbers and dealer texting registration.
 *
 * Everything lives in Litespeed's own (parent) account: numbers are bought
 * there, and each dealer group's brand and campaign are filed there under the
 * ISV primary profile. No per-dealer subaccounts — decided 14 Oct 2026, the
 * same shape just.diy runs. A per-dealer brand already keeps one dealer's
 * carrier trouble off every other dealer's texting.
 *
 * Lead alerts to dealers are a different thing on a different brand; see
 * `./alerts.ts`. Server only.
 */

const SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
/** Litespeed's ISV primary profile, which every dealer's secondary profile hangs off. */
export const PRIMARY_PROFILE = process.env.TWILIO_PRIMARY_PROFILE_SID ?? '';

/** Numbers and calls need only credentials. */
export const TWILIO_READY = Boolean(SID && TOKEN);
/** Carrier registration also needs the primary profile. */
export const REGISTRATION_READY = TWILIO_READY && Boolean(PRIMARY_PROFILE);

export const TRUSTHUB = 'https://trusthub.twilio.com/v1';
export const MESSAGING = 'https://messaging.twilio.com/v1';
export const API = `https://api.twilio.com/2010-04-01/Accounts/${SID}`;

export type Res<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

/** One Twilio call. Never throws; Twilio's wording comes back as `error` and the detail goes to the log. */
export async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  form?: Record<string, string | string[]>,
): Promise<Res<T>> {
  let body: string | undefined;
  if (form) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) for (const one of Array.isArray(v) ? v : [v]) p.append(k, one);
    body = p.toString();
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!res) return { error: "The phone company didn't answer." };
  if (res.status === 204) return { data: {} as T };
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; code?: number };
  if (!res.ok) {
    console.error('[twilio]', method, url.replace(SID, 'AC…'), res.status, json.code, json.message);
    return { error: json.message ?? `The phone company said no (${res.status}).` };
  }
  return { data: json };
}

/* ---- where Twilio calls us back ------------------------------------------- */

/**
 * Twilio signs each webhook against the exact URL it was given, so the URL set
 * on a number and the URL checked here must be built the same way. Production
 * is `https://app.rooftopauto.com`.
 */
const appOrigin = () => (process.env.BETTER_AUTH_URL ?? 'https://app.rooftopauto.com').replace(/\/+$/, '');
export const voiceUrl = () => `${appOrigin()}/api/messaging/voice`;
export const inboundUrl = () => `${appOrigin()}/api/messaging/inbound`;

/** Did Twilio really send this? An HMAC of the URL and the sorted form fields. */
export function fromTwilio(url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!TOKEN || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((s, k) => s + k + params[k], url);
  const want = createHmac('sha1', TOKEN).update(data, 'utf8').digest();
  const got = Buffer.from(signature, 'base64');
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ---- numbers ---------------------------------------------------------------- */

/** A number Twilio has free right now. */
export type FreeNumber = { e164: string; area: string; city: string; state: string };

/** Free local numbers that take calls and texts, by area code or by state. */
export async function searchNumbers(by: {
  area?: string;
  state?: string;
  contains?: string;
  size: number;
}): Promise<Res<FreeNumber[]>> {
  const q = new URLSearchParams({ SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: String(by.size) });
  if (by.area) q.set('AreaCode', by.area);
  if (by.state) q.set('InRegion', by.state);
  if (by.contains) q.set('Contains', by.contains);
  const r = await call<{
    available_phone_numbers?: { phone_number: string; locality?: string | null; region?: string | null }[];
  }>('GET', `${API}/AvailablePhoneNumbers/US/Local.json?${q}`);
  if (r.error !== undefined) return { error: r.error };
  return {
    data: (r.data.available_phone_numbers ?? []).map((n) => ({
      e164: n.phone_number,
      area: n.phone_number.slice(2, 5),
      city: n.locality ?? '',
      state: n.region ?? '',
    })),
  };
}

/** Buy it. Spends real money. Calls go to `voiceUrl`, which says where to ring. */
export async function buyNumber(e164: string, name: string): Promise<Res<{ sid: string }>> {
  const r = await call<{ sid: string }>('POST', `${API}/IncomingPhoneNumbers.json`, {
    PhoneNumber: e164,
    FriendlyName: name.slice(0, 64),
    VoiceUrl: voiceUrl(),
    VoiceMethod: 'POST',
  });
  if (r.error !== undefined) return { error: r.error };
  return { data: { sid: r.data.sid } };
}

/** Put a number on its group's approved messaging service. True if it is there. */
export async function joinService(service: string, numberSid: string): Promise<boolean> {
  const r = await call('POST', `${MESSAGING}/Services/${service}/PhoneNumbers`, { PhoneNumberSid: numberSid });
  // 21710: already on this service.
  return r.error === undefined || /already/i.test(r.error);
}

/** `+13605550142` → `(360) 555-0142`. */
export function prettyNumber(e164: string | null | undefined): string {
  const d = (e164 ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
}
