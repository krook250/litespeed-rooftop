import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { toUsE164 } from './alerts';
import { getRegistration, optInMessage, publicFace } from './registration';
import { API, call } from './twilio';

/**
 * Texting a lead from the lead page, and the replies that come back.
 *
 * THE RULES, ALL ENFORCED HERE AND NOT IN THE SCREEN:
 *  - Only a lead with `smsConsentAt` set. No exceptions, however a salesperson asks.
 *  - Not after they replied STOP (`smsOptedOutAt`).
 *  - Only once the group's carrier registration is READY. Before that the
 *    carriers drop the message anyway, and a send that "worked" but never
 *    arrived is worse than a disabled box.
 *  - The first text to a lead is `optInMessage`, sent automatically. The campaign
 *    filing promises the carriers exactly that confirmation.
 *
 * Sent through the group's messaging service, so Twilio picks the group's number
 * and answers STOP/HELP itself.
 */

export type LeadTextState =
  | { ok: true }
  | { ok: false; why: 'no-consent' | 'opted-out' | 'no-phone' | 'not-approved' };

/** A lead, if it belongs to this group. */
export async function leadInGroup(groupId: string, leadId: string) {
  const [row] = await db
    .select({ lead: t.leads, rooftopName: t.rooftops.name })
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

export async function canText(groupId: string, lead: typeof t.leads.$inferSelect): Promise<LeadTextState> {
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

async function sendOne(service: string, to: string, body: string) {
  const res = await call<{ sid: string }>('POST', `${API}/Messages.json`, {
    MessagingServiceSid: service,
    To: to,
    Body: body,
  });
  return res.error !== undefined ? { twilioSid: null, error: res.error } : { twilioSid: res.data.sid, error: null };
}

/** Send one text to a lead. Returns an error line for the screen, or null. */
export async function sendLeadText(groupId: string, leadId: string, userId: string, raw: string): Promise<string | null> {
  const body = raw.trim().slice(0, 1000);
  if (!body) return 'Type a message first.';
  const row = await leadInGroup(groupId, leadId);
  if (!row) return 'That lead is gone.';
  const { lead } = row;
  const state = await canText(groupId, lead);
  if (!state.ok) return blockedLine(state.why);
  const service = (await readyService(groupId))!;
  const to = toUsE164(lead.phone)!;

  const sentBefore = await db.query.leadMessages.findFirst({
    where: and(eq(t.leadMessages.leadId, leadId), eq(t.leadMessages.direction, 'OUT'), sql`${t.leadMessages.error} is null`),
  });
  if (!sentBefore) {
    const reg = await getRegistration(groupId);
    const face = await publicFace(groupId, reg?.legalName ?? null);
    const confirm = optInMessage(face.name);
    const first = await sendOne(service, to, confirm);
    await db.insert(t.leadMessages).values({ leadId, direction: 'OUT', body: confirm, ...first });
    if (first.error) return `Not sent: ${first.error}`;
  }

  const sent = await sendOne(service, to, body);
  await db.insert(t.leadMessages).values({ leadId, direction: 'OUT', body, sentBy: userId, ...sent });
  return sent.error ? `Not sent: ${sent.error}` : null;
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
    .where(
      and(
        eq(t.rooftops.groupId, groupId),
        sql`right(regexp_replace(${t.leads.phone}, '\\D', '', 'g'), 10) = ${digits}`,
      ),
    );
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
  await db.insert(t.leadMessages).values({ leadId: pick.id, direction: 'IN', body: body.slice(0, 2000), twilioSid: sid ?? null });
  return { groupId: number.groupId, leadId: pick.id, name: pick.name };
}

