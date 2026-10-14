import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { messagingNumbers } from '@/db/schema';
import { TWILIO_READY, buyNumber, joinService, prettyNumber, searchNumbers, type FreeNumber } from './twilio';

/**
 * A dealer group's phone number: bought under Litespeed's Twilio account, one
 * per group, serving every lot. Calls ring the phone in `forwardTo`. Texting
 * from it opens once the group's carrier registration is approved
 * (`./registration.ts`), which puts the number on the group's messaging service.
 *
 * Free while texting is being dialed in (Oct 2026); billing comes later.
 * Ported from just.diy's `numbers-server.ts`, minus the token wallet.
 */

export type NumberState = {
  /** As shown: (360) 555-0192. */
  number: string;
  /** Where calls ring, as shown. */
  rings: string;
};

async function active(groupId: string) {
  return (
    (await db.query.messagingNumbers.findFirst({
      where: and(eq(messagingNumbers.groupId, groupId), eq(messagingNumbers.isActive, true), isNull(messagingNumbers.rooftopId)),
    })) ?? null
  );
}

export async function activeNumber(groupId: string) {
  return active(groupId);
}

export async function numberState(groupId: string): Promise<NumberState | null> {
  const n = await active(groupId);
  if (!n) return null;
  return { number: prettyNumber(n.phoneNumber), rings: prettyNumber(n.forwardTo) };
}

export type Choices = {
  numbers: FreeNumber[];
  /** True when nothing was free in that area code and these are from elsewhere in the state. */
  elsewhere: boolean;
};

/** Up to 8 in the area code; failing that, up to 8 from the lot's state. */
export async function numberChoices(area: string, contains: string, state: string): Promise<{ error?: string; data?: Choices }> {
  if (!TWILIO_READY) return { error: "Phone numbers aren't switched on on this deployment." };
  const c = contains || undefined;
  const exact = await searchNumbers({ area, contains: c, size: 8 });
  if (exact.error !== undefined) return { error: exact.error };
  if (exact.data.length || !state) return { data: { numbers: exact.data, elsewhere: false } };
  const near = await searchNumbers({ state, contains: c, size: 8 });
  if (near.error !== undefined) return { error: near.error };
  return { data: { numbers: near.data, elsewhere: true } };
}

/**
 * Buy the number they picked. `service` is the group's approved messaging
 * service if it already has one (a number bought again after being given up),
 * so it can text straight away.
 */
export async function getNumber(
  groupId: string,
  groupName: string,
  e164: string,
  forwardTo: string,
  service: string | null,
): Promise<string | null> {
  if (!TWILIO_READY) return "Phone numbers aren't switched on on this deployment.";
  if (await active(groupId)) return 'This dealership already has a number.';

  const bought = await buyNumber(e164, `Rooftop · ${groupName}`);
  if (bought.error !== undefined) {
    if (/not available/i.test(bought.error)) return `Someone else just took ${prettyNumber(e164)}. Pick another.`;
    return bought.error;
  }
  const { sid } = bought.data;
  if (service && !(await joinService(service, sid))) {
    console.error('[numbers] did not join its approved messaging service:', e164, groupId);
  }

  try {
    await db.insert(messagingNumbers).values({ groupId, phoneNumber: e164, twilioSid: sid, forwardTo });
  } catch (e) {
    // The number is real and paid for even if our note of it didn't save. Loud, so it gets fixed by hand.
    console.error('[numbers] BOUGHT BUT NOT RECORDED', e164, sid, groupId, e);
    return 'The number was bought but did not save. Tell support before trying again.';
  }
  return null;
}

/** Change where calls ring. */
export async function setRings(groupId: string, forwardTo: string): Promise<void> {
  await db
    .update(messagingNumbers)
    .set({ forwardTo })
    .where(and(eq(messagingNumbers.groupId, groupId), eq(messagingNumbers.isActive, true)));
}

/** Where a call to one of our numbers should ring, or null if it isn't ours any more. */
export async function ringsFor(e164: string): Promise<string | null> {
  const n = await db.query.messagingNumbers.findFirst({
    where: and(eq(messagingNumbers.phoneNumber, e164), eq(messagingNumbers.isActive, true)),
  });
  return n?.forwardTo ?? null;
}
