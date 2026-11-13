import { and, asc, eq, gt, inArray, isNotNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { toUsE164 } from './alerts';
import { textWindow, zoneForPhone, type TextWindow } from './lead-zone';
import { getRegistration, optInMessage, publicFace } from './registration';
import { API, call } from './twilio';

/**
 * Texting a lead, the auto-reply a new lead gets, and the replies that come back.
 * Modeled on just.diy's `lib/auto-reply.ts`, minus the booking assistant.
 *
 * THE RULES, ALL ENFORCED HERE AND NOT IN THE SCREEN:
 *  - Only a lead with `smsConsentAt` set. No exceptions, however a salesperson asks.
 *  - Not after they replied STOP (`smsOptedOutAt`).
 *  - Only once the group's carrier registration is READY.
 *  - The first text to a lead carries the opt-in confirmation the campaign
 *    filing promised (who, frequency, rates, HELP, STOP). The auto-reply does;
 *    when staff text first, `optInMessage` goes ahead of theirs.
 *  - The auto-reply waits for texting hours where the buyer is (their area
 *    code, else the lot's zone), unless the owner turned on "Reply even after hours".
 *
 * Every outcome is a row in lead_messages, so the thread can say what happened.
 */

type Msg = typeof t.leadMessages.$inferSelect;
type Lead = typeof t.leads.$inferSelect;

export type LeadTextState =
  | { ok: true }
  | { ok: false; why: 'no-consent' | 'opted-out' | 'no-phone' | 'not-approved' };

/** A lead, if it belongs to this group. */
export async function leadInGroup(groupId: string, leadId: string) {
  const [row] = await db
    .select({ lead: t.leads, rooftopName: t.rooftops.name, zone: t.rooftops.timezone, state: t.rooftops.state })
    .from(t.leads)
    .innerJoin(t.rooftops, eq(t.rooftops.id, t.leads.rooftopId))
    .where(and(eq(t.leads.id, leadId), eq(t.rooftops.groupId, groupId)))
    .limit(1);
  return row ?? null;
}

/** The messaging service to send through, or null while texting isn't approved. */
async function readyService(groupId: string): Promise<string | null> {
  const r = await getRegistration(groupId);
  return r?.status === 'READY' && r.messagingServiceSid ? r.messagingServiceSid : null;
}

export async function canText(groupId: string, lead: Lead): Promise<LeadTextState> {
  if (!lead.smsConsentAt) return { ok: false, why: 'no-consent' };
  if (lead.smsOptedOutAt) return { ok: false, why: 'opted-out' };
  if (!toUsE164(lead.phone)) return { ok: false, why: 'no-phone' };
  if (!(await readyService(groupId))) return { ok: false, why: 'not-approved' };
  return { ok: true };
}

export async function threadFor(leadId: string) {
  return db.query.leadMessages.findMany({
    where: eq(t.leadMessages.leadId, leadId),
    orderBy: asc(t.leadMessages.createdAt),
  });
}

export function blockedLine(why: Exclude<LeadTextState, { ok: true }>['why']): string {
  switch (why) {
    case 'no-consent':
      return "They didn't tick the box asking to be texted, so texting them isn't allowed. Call or email instead.";
    case 'opted-out':
      return 'They replied STOP. No more texts unless they text START.';
    case 'no-phone':
      return "Their phone number isn't a US number we can text.";
    case 'not-approved':
      return 'Texting turns on when the carriers approve you.';
  }
}

/* ---- sending ------------------------------------------------------------------ */

/**
 * Send one row that is `queued`. Claimed first (queued -> sent), so the minute
 * job and a page action never send the same text twice. Returns the reason on failure.
 */
async function sendRow(m: Msg, service: string, to: string): Promise<string | null> {
  const claimed = await db
    .update(t.leadMessages)
    .set({ status: 'sent' })
    .where(and(eq(t.leadMessages.id, m.id), eq(t.leadMessages.status, 'queued')))
    .returning({ id: t.leadMessages.id });
  if (!claimed.length) return null;

  const res = await call<{ sid: string }>('POST', `${API}/Messages.json`, { MessagingServiceSid: service, To: to, Body: m.body });
  if (res.error === undefined) {
    await db.update(t.leadMessages).set({ twilioSid: res.data.sid }).where(eq(t.leadMessages.id, m.id));
    return null;
  }
  const reason = /21610|unsubscribed/i.test(res.error)
    ? "They've replied STOP to your number before."
    : /21211|21614|not a valid|not a mobile/i.test(res.error)
      ? "Their number can't get texts."
      : "The phone company didn't take it.";
  await db.update(t.leadMessages).set({ status: 'failed', error: reason }).where(eq(t.leadMessages.id, m.id));
  return reason;
}

async function queue(leadId: string, body: string, extra: Partial<typeof t.leadMessages.$inferInsert> = {}) {
  const [m] = await db
    .insert(t.leadMessages)
    .values({ leadId, direction: 'OUT', body, status: 'queued', sendAfter: new Date(), ...extra })
    .returning();
  return m!;
}

/** Has this lead had a text from us that actually went out? */
async function confirmed(leadId: string) {
  return Boolean(
    await db.query.leadMessages.findFirst({
      where: and(eq(t.leadMessages.leadId, leadId), eq(t.leadMessages.direction, 'OUT'), eq(t.leadMessages.status, 'sent'), sql`${t.leadMessages.error} is null`),
    }),
  );
}

/** Staff pressed Send. Goes now, any hour: a person chose to send it. Returns an error line, or null. */
export async function sendLeadText(groupId: string, leadId: string, userId: string, raw: string): Promise<string | null> {
  const body = raw.trim().slice(0, 1000);
  if (!body) return 'Type a message first.';
  const row = await leadInGroup(groupId, leadId);
  if (!row) return 'That lead is gone.';
  const state = await canText(groupId, row.lead);
  if (!state.ok) return blockedLine(state.why);
  const service = (await readyService(groupId))!;
  const to = toUsE164(row.lead.phone)!;

  if (!(await confirmed(leadId))) {
    const face = await publicFace(groupId, null);
    const why = await sendRow(await queue(leadId, optInMessage(face.name), { auto: true }), service, to);
    if (why) return `Not sent: ${why}`;
  }
  const why = await sendRow(await queue(leadId, body, { sentBy: userId }), service, to);
  return why ? `Not sent: ${why}` : null;
}

/* ---- the auto-reply --------------------------------------------------------------- */

const firstName = (name: string) => {
  const f = name.trim().split(/\s+/)[0] ?? '';
  return !f || /^no$/i.test(f) ? 'there' : f.charAt(0).toUpperCase() + f.slice(1);
};

/**
 * The auto-reply. Doubles as the opt-in confirmation the campaign filing
 * promised, so it carries frequency, rates, HELP and STOP.
 */
export function autoReplyText(first: string, dealer: string, vehicle: string | null): string {
  const about = vehicle ? `asking about the ${vehicle} at ${dealer}` : `reaching out to ${dealer}`;
  return `Hi ${first}, thanks for ${about}. We'll text you back shortly. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
}

const hourIn = (at: Date, zone: string) =>
  Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(at));
const sundayIn = (at: Date, zone: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone }).format(at) === 'Sun';
const openAt = (at: Date, zone: string, w: TextWindow) => (w.sundayOpen != null && sundayIn(at, zone) ? w.sundayOpen : w.open);

/** Now if it's within texting hours there, else the next opening there. */
export function sendTime(now: Date, zone: string, w: TextWindow): Date {
  const h = hourIn(now, zone);
  if (h >= openAt(now, zone, w) && h < w.close) return now;
  const at = new Date(now);
  at.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 40; i++) {
    at.setUTCHours(at.getUTCHours() + 1);
    if (hourIn(at, zone) === openAt(at, zone, w)) return at;
  }
  return now;
}

/** The zone a buyer's texts are timed in: their area code, else the lot's. */
export const buyerZone = (phone: string, lotZone: string | null) => zoneForPhone(phone) || lotZone || 'America/New_York';

/** A lead older than this when the auto-reply is first tried isn't texted. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Once per new lead, from `createLead`. Never throws: a shopper who filled the
 * form correctly sees "thanks" whatever happens here.
 */
export async function queueAutoReply(leadId: string): Promise<void> {
  try {
    const [row] = await db
      .select({ lead: t.leads, groupId: t.rooftops.groupId, zone: t.rooftops.timezone, state: t.rooftops.state, v: t.vehicles })
      .from(t.leads)
      .innerJoin(t.rooftops, eq(t.rooftops.id, t.leads.rooftopId))
      .leftJoin(t.vehicles, eq(t.vehicles.id, t.leads.vehicleId))
      .where(eq(t.leads.id, leadId))
      .limit(1);
    if (!row) return;
    const reg = await getRegistration(row.groupId);
    // Not approved to text yet: nothing to say in the thread either.
    if (reg?.status !== 'READY' || !reg.messagingServiceSid) return;
    const already = await db.query.leadMessages.findFirst({ where: and(eq(t.leadMessages.leadId, leadId), eq(t.leadMessages.auto, true)) });
    if (already) return;

    const { lead, v } = row;
    const face = await publicFace(row.groupId, null);
    const vehicle = v ? `${v.year} ${v.make} ${v.model}` : null;
    const body = autoReplyText(firstName(lead.name), face.name, vehicle);
    const to = toUsE164(lead.phone);

    const skip = !lead.smsConsentAt
      ? "They didn't tick the box to get texts."
      : !to
        ? "Their phone number isn't one we can text."
        : !reg.autoReply
          ? 'Auto-reply was off.'
          : lead.smsOptedOutAt
            ? 'They replied STOP to your number before.'
            : Date.now() - lead.createdAt.getTime() > STALE_MS
              ? 'It came in too long ago to send now.'
              : null;
    if (skip) {
      await db.insert(t.leadMessages).values({ leadId, direction: 'OUT', body, auto: true, status: 'skipped', error: skip });
      return;
    }

    const now = new Date();
    const when = reg.autoReplyAfterHours ? now : sendTime(now, buyerZone(to!, row.zone), textWindow(to, row.state));
    const m = await queue(leadId, body, { auto: true, sendAfter: when });
    if (when.getTime() <= Date.now()) await sendRow(m, reg.messagingServiceSid, to!);
  } catch (e) {
    console.error('[auto-reply] queue', e instanceof Error ? e.message : e);
  }
}

/**
 * Every minute: auto-replies held overnight whose 8am has come. One that no
 * longer makes sense is dropped with the reason: anyone texted since, they
 * opted out, or texting was switched off.
 */
export async function sendDue(): Promise<number> {
  const due = await db
    .select({ m: t.leadMessages, lead: t.leads, groupId: t.rooftops.groupId })
    .from(t.leadMessages)
    .innerJoin(t.leads, eq(t.leads.id, t.leadMessages.leadId))
    .innerJoin(t.rooftops, eq(t.rooftops.id, t.leads.rooftopId))
    .where(and(eq(t.leadMessages.status, 'queued'), lte(t.leadMessages.sendAfter, new Date())))
    .orderBy(asc(t.leadMessages.sendAfter))
    .limit(30);

  let n = 0;
  for (const { m, lead, groupId } of due) {
    const drop = (why: string) =>
      db.update(t.leadMessages).set({ status: 'skipped', error: why }).where(and(eq(t.leadMessages.id, m.id), eq(t.leadMessages.status, 'queued')));
    const service = await readyService(groupId);
    if (!service) {
      await drop("Texting wasn't on any more when it was due.");
      continue;
    }
    if (lead.smsOptedOutAt) {
      await drop('They replied STOP before it was due.');
      continue;
    }
    if (m.auto) {
      const later = await db.query.leadMessages.findFirst({
        where: and(
          eq(t.leadMessages.leadId, lead.id),
          ne(t.leadMessages.id, m.id),
          notInArray(t.leadMessages.status, ['skipped', 'failed']),
          gt(t.leadMessages.createdAt, m.createdAt),
        ),
      });
      if (later) {
        await drop('The conversation had already started.');
        continue;
      }
    }
    const to = toUsE164(lead.phone);
    if (!to) {
      await drop("Their phone number isn't one we can text.");
      continue;
    }
    await sendRow(m, service, to);
    n++;
  }
  return n;
}

/* ---- inbound ---------------------------------------------------------------- */

const last10 = (e164: string) => e164.replace(/\D/g, '').slice(-10);

/** Every lead in the group whose phone is this number. */
async function leadsByPhone(groupId: string, from: string) {
  const digits = last10(from);
  if (digits.length !== 10) return [];
  return db
    .select({ id: t.leads.id, name: t.leads.name, consent: t.leads.smsConsentAt, createdAt: t.leads.createdAt })
    .from(t.leads)
    .innerJoin(t.rooftops, eq(t.rooftops.id, t.leads.rooftopId))
    .where(and(eq(t.rooftops.groupId, groupId), sql`right(regexp_replace(${t.leads.phone}, '\\D', '', 'g'), 10) = ${digits}`));
}

const STOP = /^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)$/i;
const START = /^(start|unstop|yes)$/i;

/**
 * A text arrived on a group's number. Files it on the newest lead it matches
 * (preferring one who opted in) and handles STOP / START. Returns the lead it
 * landed on so the caller can say so in the alert, or null for a stranger.
 */
export async function receiveLeadText(
  to: string,
  from: string,
  body: string,
  sid: string | undefined,
  optOutType: string | undefined,
): Promise<{ groupId: string; leadId: string; name: string } | null> {
  const number = await db.query.messagingNumbers.findFirst({
    where: and(eq(t.messagingNumbers.phoneNumber, to), eq(t.messagingNumbers.isActive, true)),
  });
  if (!number) return null;
  const matches = await leadsByPhone(number.groupId, from);
  if (!matches.length) return null;

  const word = body.trim();
  const ids = matches.map((m) => m.id);
  if (optOutType === 'STOP' || STOP.test(word)) {
    await db.update(t.leads).set({ smsOptedOutAt: new Date() }).where(inArray(t.leads.id, ids));
  } else if (optOutType === 'START' || START.test(word)) {
    await db.update(t.leads).set({ smsOptedOutAt: null }).where(and(inArray(t.leads.id, ids), isNotNull(t.leads.smsOptedOutAt)));
  }

  const pick = [...matches].sort(
    (a, b) => Number(Boolean(b.consent)) - Number(Boolean(a.consent)) || b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  await db.insert(t.leadMessages).values({ leadId: pick.id, direction: 'IN', body: body.slice(0, 2000), twilioSid: sid ?? null, status: 'sent' });
  return { groupId: number.groupId, leadId: pick.id, name: pick.name };
}
