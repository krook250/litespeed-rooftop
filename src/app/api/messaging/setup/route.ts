/**
 * Start or resume this dealer's texting setup.
 *
 * Takes nothing. That is the security property: the group comes from the
 * session, never from the body, so there is no shape of request that starts a
 * registration against somebody else's dealership. The client's only job is to
 * render whatever comes back.
 *
 * The response may carry a Persona session token. It is short-lived and scoped
 * to one inquiry, but it is still a credential: no-store, and never logged.
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { beginSetup } from '@/lib/messaging/setup';
import { TwilioError } from '@/lib/messaging/twilio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await requireSession();

  try {
    const result = await beginSetup(user.groupId);

    if (result.kind === 'NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'Text messaging is not configured on this deployment.' },
        { status: 503 },
      );
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    if (e instanceof TwilioError) {
      // Twilio's own wording is written for developers, not for a dealer who
      // just wants to text a buyer back. Log the detail, show a sentence.
      console.error('[messaging/setup] Twilio %d/%s: %s', e.status, e.code, e.message);
      return NextResponse.json(
        { error: 'Twilio could not start the registration. Try again shortly.' },
        { status: 502 },
      );
    }
    throw e;
  }
}
