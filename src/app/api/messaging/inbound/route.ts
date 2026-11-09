import { ringsFor } from '@/lib/messaging/numbers';
import { sendAlertSms } from '@/lib/messaging/alerts';
import { fromTwilio, inboundUrl, prettyNumber } from '@/lib/messaging/twilio';
import { receiveLeadText } from '@/lib/messaging/lead-texts';

/**
 * A buyer texted a dealer's number. Set as the InboundRequestUrl on each
 * group's messaging service, so it only fires once texting is approved.
 *
 * A text from a lead's phone is filed on that lead's thread (and STOP / START
 * recorded there). Either way it is passed to the phone calls ring, from
 * Rooftop's alert number, so nobody has to keep the app open. Twilio answers
 * STOP and HELP on the service itself; we only record them.
 */

const appOrigin = (process.env.BETTER_AUTH_URL ?? 'https://app.rooftopauto.com').replace(/\/+$/, '');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const empty = (status = 200) =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', { status, headers: { 'Content-Type': 'text/xml' } });

export async function POST(request: Request) {
  const params: Record<string, string> = {};
  (await request.formData().catch(() => new FormData())).forEach((v, k) => {
    if (typeof v === 'string') params[k] = v;
  });
  if (!fromTwilio(inboundUrl(), params, request.headers.get('x-twilio-signature'))) return empty(403);

  const rings = params.To ? await ringsFor(params.To) : null;
  const raw = (params.Body ?? '').trim();
  const body = raw.replace(/\s+/g, ' ');
  const lead =
    params.To && params.From && raw
      ? await receiveLeadText(params.To, params.From, raw, params.MessageSid, params.OptOutType).catch((e) => {
          console.error('[inbound] could not file on a lead', e);
          return null;
        })
      : null;
  if (rings && body && !/^(stop|stopall|start|help|unstop|cancel|end|quit|unsubscribe|revoke|optout)$/i.test(body)) {
    const from = prettyNumber(params.From) || params.From || 'unknown';
    const quoted = `"${body.length > 300 ? body.slice(0, 297) + '...' : body}"`;
    await sendAlertSms(
      rings,
      lead
        ? `Text from ${lead.name} (${from}):\n${quoted}\nReply in Rooftop: ${appOrigin}/admin/leads/${lead.leadId}`
        : `Text to your Rooftop number from ${from}:\n${quoted}\nReply to them at ${from}.`,
    );
  }
  return empty();
}
