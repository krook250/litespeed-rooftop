import { and, desc, eq, exists, inArray, isNotNull, ne, or } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { blockedLine, buyerZone, canText, leadInGroup, threadFor } from './lead-texts';
import { getRegistration, optInMessage, publicFace } from './registration';

/**
 * What the chat bubble and the lead page read: the inbox of conversations and
 * one thread, shaped for the screen. Server only; the group always comes from
 * the caller's session.
 */

export type ThreadMsg = {
  id: string;
  out: boolean;
  body: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  auto: boolean;
  /** "Goes out Sat 8:00 AM their time", for a queued text. */
  due: string | null;
  at: string;
};

export type ThreadView = {
  leadId: string;
  name: string;
  phone: string;
  email: string;
  vehicle: string | null;
  stockNumber: string | null;
  createdAt: string;
  formMessage: string;
  messages: ThreadMsg[];
  blocked: string | null;
  firstNote: string | null;
};

export async function threadView(groupId: string, leadId: string): Promise<ThreadView | null> {
  const row = await leadInGroup(groupId, leadId);
  if (!row) return null;
  const { lead } = row;
  const [vehicle, messages, state] = await Promise.all([
    lead.vehicleId ? db.query.vehicles.findFirst({ where: eq(t.vehicles.id, lead.vehicleId) }) : null,
    threadFor(lead.id),
    canText(groupId, lead),
  ]);
  const sentBefore = messages.some((m) => m.direction === 'OUT' && m.status === 'sent' && !m.error);
  const face = sentBefore ? null : await publicFace(groupId, null);
  const zone = buyerZone(lead.phone, row.zone);
  const theirTime = (d: Date) => d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone });

  return {
    leadId: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    vehicle: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}` : null,
    stockNumber: vehicle?.stockNumber ?? null,
    createdAt: lead.createdAt.toISOString(),
    formMessage: lead.message,
    messages: messages.map((m) => ({
      id: m.id,
      out: m.direction === 'OUT',
      body: m.body,
      status: m.status as ThreadMsg['status'],
      error: m.error,
      auto: m.auto,
      due: m.status === 'queued' && m.sendAfter ? `Goes out ${theirTime(m.sendAfter)} their time` : null,
      at: m.createdAt.toISOString(),
    })),
    blocked: state.ok ? null : blockedLine(state.why),
    firstNote: face ? optInMessage(face.name) : null,
  };
}

/** Someone on staff opened this thread. */
export async function markRead(groupId: string, leadId: string) {
  if (!(await leadInGroup(groupId, leadId))) return;
  await db.update(t.leads).set({ textsReadAt: new Date() }).where(eq(t.leads.id, leadId));
}

export type Conversation = {
  leadId: string;
  name: string;
  phone: string;
  vehicle: string | null;
  last: { body: string; out: boolean; at: string } | null;
  unread: boolean;
  /** Last text, else when the lead came in. Sort key. */
  at: string;
};

export type Inbox = { enabled: boolean; unread: number; conversations: Conversation[] };

/** Every lead who can be texted or has been, newest activity first. */
export async function inbox(groupId: string): Promise<Inbox> {
  const reg = await getRegistration(groupId);
  if (reg?.status !== 'READY') return { enabled: false, unread: 0, conversations: [] };

  const leads = await db
    .select({ lead: t.leads, v: t.vehicles })
    .from(t.leads)
    .innerJoin(t.rooftops, eq(t.rooftops.id, t.leads.rooftopId))
    .leftJoin(t.vehicles, eq(t.vehicles.id, t.leads.vehicleId))
    .where(
      and(
        eq(t.rooftops.groupId, groupId),
        or(
          isNotNull(t.leads.smsConsentAt),
          exists(db.select({ x: t.leadMessages.id }).from(t.leadMessages).where(eq(t.leadMessages.leadId, t.leads.id))),
        ),
      ),
    )
    .orderBy(desc(t.leads.createdAt))
    .limit(200);
  const ids = leads.map((l) => l.lead.id);
  if (!ids.length) return { enabled: true, unread: 0, conversations: [] };

  const [lasts, lastIns] = await Promise.all([
    db
      .selectDistinctOn([t.leadMessages.leadId])
      .from(t.leadMessages)
      .where(and(inArray(t.leadMessages.leadId, ids), ne(t.leadMessages.status, 'skipped')))
      .orderBy(t.leadMessages.leadId, desc(t.leadMessages.createdAt)),
    db
      .selectDistinctOn([t.leadMessages.leadId], { leadId: t.leadMessages.leadId, at: t.leadMessages.createdAt })
      .from(t.leadMessages)
      .where(and(inArray(t.leadMessages.leadId, ids), eq(t.leadMessages.direction, 'IN')))
      .orderBy(t.leadMessages.leadId, desc(t.leadMessages.createdAt)),
  ]);
  const last = new Map(lasts.map((m) => [m.leadId, m]));
  const lastIn = new Map(lastIns.map((m) => [m.leadId, m.at]));

  const conversations = leads
    .map(({ lead, v }): Conversation => {
      const m = last.get(lead.id);
      const inAt = lastIn.get(lead.id);
      return {
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        vehicle: v ? `${v.year} ${v.make} ${v.model}` : null,
        last: m ? { body: m.body, out: m.direction === 'OUT', at: m.createdAt.toISOString() } : null,
        unread: Boolean(inAt && (!lead.textsReadAt || inAt > lead.textsReadAt)),
        at: (m?.createdAt ?? lead.createdAt).toISOString(),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return { enabled: true, unread: conversations.filter((c) => c.unread).length, conversations };
}
