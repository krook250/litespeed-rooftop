import { ringsFor } from '@/lib/messaging/numbers';
import { fromTwilio, voiceUrl } from '@/lib/messaging/twilio';

/**
 * Twilio asks this what to do when a dealer's number is called. The answer is
 * always the same: ring the phone the owner set in Settings → Texting & calls.
 * Only Twilio may ask; the signature is checked against the URL set on the number.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const xml = (body: string, status = 200) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  });

export async function POST(request: Request) {
  const params: Record<string, string> = {};
  (await request.formData().catch(() => new FormData())).forEach((v, k) => {
    if (typeof v === 'string') params[k] = v;
  });
  if (!fromTwilio(voiceUrl(), params, request.headers.get('x-twilio-signature'))) return xml('', 403);

  const to = /^\+1\d{10}$/.test(params.To ?? '') ? params.To : '';
  const rings = to ? await ringsFor(to) : null;
  if (!rings) return xml('<Say>This number is no longer in service.</Say><Hangup/>');
  // The dealer sees who is really calling, and the caller hears ringing until they pick up.
  return xml(`<Dial answerOnBridge="true" timeout="25"><Number>${rings}</Number></Dial>`);
}
