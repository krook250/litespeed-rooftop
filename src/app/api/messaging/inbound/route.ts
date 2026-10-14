import { ringsFor } from '@/lib/messaging/numbers';
import { sendAlertSms } from '@/lib/messaging/alerts';
import { fromTwilio, inboundUrl, prettyNumber } from '@/lib/messaging/twilio';

/**
 * A buyer texted a dealer's number. Set as the InboundRequestUrl on each
 * group's messaging service, so it only fires once texting is approved.
 *
 * Until there is a texting thread on the lead, the text is passed to the same
 * phone calls ring, from Rooftop's alert number. STOP and HELP never get here
 * as work to do: Twilio answers those on the service itself.
 */

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
  const body = (params.Body ?? '').trim().replace(/\s+/g, ' ');
  if (rings && body && !/^(stop|start|help|unstop|cancel|end|quit|unsubscribe)$/i.test(body)) {
    const from = prettyNumber(params.From) || params.From || 'unknown';
    await sendAlertSms(
      rings,
      `Text to your Rooftop number from ${from}:\n"${body.length > 300 ? body.slice(0, 297) + '...' : body}"\nReply to them at ${from}.`,
    );
  }
  return empty();
}
