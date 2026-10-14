'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSection } from '@/lib/auth-guard';
import { requireGroupId } from '@/lib/auth';
import { toUsE164 } from '@/lib/messaging/alerts';

/**
 * Delete one lead. Anyone who can open Leads can delete one — clearing spam is
 * the receptionist's job as much as the owner's.
 *
 * Scoped in the WHERE clause, not checked then written: the lead's rooftop must
 * belong to the caller's group, or nothing is deleted.
 */
export async function deleteLead(leadId: string): Promise<{ ok: boolean }> {
  await requireSection('leads');
  const groupId = await requireGroupId();
  if (!leadId) return { ok: false };

  const ownRooftops = db
    .select({ id: t.rooftops.id })
    .from(t.rooftops)
    .where(eq(t.rooftops.groupId, groupId));

  const gone = await db
    .delete(t.leads)
    .where(and(eq(t.leads.id, leadId), inArray(t.leads.rooftopId, ownRooftops)))
    .returning({ id: t.leads.id });

  revalidatePath('/admin/leads');
  return { ok: gone.length > 0 };
}

/* ------------------------------------------------------------ lead delivery */

export type DeliveryResult = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

/**
 * Typed email and cell, checked. Blank is fine (returns null); something typed
 * that isn't usable is an error the dealer sees, rather than a field that
 * silently comes back empty.
 */
function parseContact(rawEmail: unknown, rawCell: unknown):
  | { ok: true; email: string | null; cell: string | null }
  | { ok: false; error: string } {
  const email = clean(rawEmail);
  const cellText = clean(rawCell, 40);
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'That email address is missing something.' };
  const cell = toUsE164(cellText);
  if (cellText && !cell) return { ok: false, error: "That cell doesn't look like a 10-digit US number." };
  return { ok: true, email: email || null, cell };
}

/**
 * Owner and sales manager only, for every change below. Anyone who can change
 * the lead list can quietly route every lead to themselves, which is not a
 * salesperson's call. Returns the group, or null when the caller can't edit.
 */
async function deliveryEditorGroup(): Promise<string | null> {
  const me = await requireSection('leads');
  if (me.role !== 'OWNER' && me.role !== 'SALES_MANAGER') return null;
  return me.groupId;
}

const NOT_ALLOWED: DeliveryResult = {
  ok: false,
  error: 'Only the owner or a sales manager can change where leads go.',
};

/** True when the rooftop belongs to the group. Every write below checks this first. */
async function ownsRooftop(groupId: string, rooftopId: string): Promise<boolean> {
  if (!rooftopId) return false;
  const row = await db
    .select({ id: t.rooftops.id })
    .from(t.rooftops)
    .where(and(eq(t.rooftops.id, rooftopId), eq(t.rooftops.groupId, groupId)))
    .limit(1);
  return row.length > 0;
}

/**
 * The lot's own email and cell -- the first line on the list, which can be
 * edited but never removed, so a lot can't end up sending leads nowhere.
 * The email is required: it is also the lot's contact address everywhere else.
 */
export async function saveLotLeadContact(input: {
  rooftopId: string;
  email: string;
  cell: string;
}): Promise<DeliveryResult> {
  const groupId = await deliveryEditorGroup();
  if (!groupId) return NOT_ALLOWED;
  const c = parseContact(input.email, input.cell);
  if (!c.ok) return c;
  if (!c.email) return { ok: false, error: "The lot needs an email. Leads and the website's contact both use it." };

  const done = await db
    .update(t.rooftops)
    .set({ email: c.email, leadAlertPhone: c.cell })
    .where(and(eq(t.rooftops.id, input.rooftopId), eq(t.rooftops.groupId, groupId)))
    .returning({ id: t.rooftops.id });
  if (!done.length) return { ok: false, error: 'Could not find that lot.' };

  revalidatePath('/admin/leads');
  return { ok: true };
}

/**
 * Add someone to a lot's lead list: either a staff member picked from the
 * dropdown (`userId`) or someone typed in. A picked person's details are read
 * live from their account, so nothing else is stored for them.
 */
export async function addLeadRecipient(
  input:
    | { rooftopId: string; userId: string }
    | { rooftopId: string; name: string; email: string; cell: string },
): Promise<DeliveryResult> {
  const groupId = await deliveryEditorGroup();
  if (!groupId) return NOT_ALLOWED;
  if (!(await ownsRooftop(groupId, input.rooftopId))) return { ok: false, error: 'Could not find that lot.' };

  if ('userId' in input) {
    const person = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(and(eq(t.users.id, input.userId), eq(t.users.groupId, groupId)))
      .limit(1);
    if (!person.length) return { ok: false, error: 'Pick someone from the list.' };

    const already = await db
      .select({ id: t.leadRecipients.id })
      .from(t.leadRecipients)
      .where(
        and(eq(t.leadRecipients.rooftopId, input.rooftopId), eq(t.leadRecipients.userId, input.userId)),
      )
      .limit(1);
    if (already.length) return { ok: false, error: 'They are already on this list.' };

    await db.insert(t.leadRecipients).values({ rooftopId: input.rooftopId, userId: input.userId });
  } else {
    const name = clean(input.name, 120);
    if (!name) return { ok: false, error: 'Give them a name, so the list says who gets what.' };
    const c = parseContact(input.email, input.cell);
    if (!c.ok) return c;
    if (!c.email && !c.cell) return { ok: false, error: 'Add an email, a cell, or both.' };

    await db
      .insert(t.leadRecipients)
      .values({ rooftopId: input.rooftopId, name, email: c.email, cell: c.cell });
  }

  revalidatePath('/admin/leads');
  return { ok: true };
}

/**
 * Change a typed-in person. A picked staff member is not edited here: their
 * number is theirs, changed on Account, and leads follow it.
 */
export async function updateLeadRecipient(input: {
  id: string;
  name: string;
  email: string;
  cell: string;
}): Promise<DeliveryResult> {
  const groupId = await deliveryEditorGroup();
  if (!groupId) return NOT_ALLOWED;

  const name = clean(input.name, 120);
  if (!name) return { ok: false, error: 'Give them a name, so the list says who gets what.' };
  const c = parseContact(input.email, input.cell);
  if (!c.ok) return c;
  if (!c.email && !c.cell) return { ok: false, error: 'Add an email, a cell, or both. Or remove them.' };

  const ownRooftops = db
    .select({ id: t.rooftops.id })
    .from(t.rooftops)
    .where(eq(t.rooftops.groupId, groupId));

  const done = await db
    .update(t.leadRecipients)
    .set({ name, email: c.email, cell: c.cell })
    .where(
      and(
        eq(t.leadRecipients.id, input.id),
        isNull(t.leadRecipients.userId),
        inArray(t.leadRecipients.rooftopId, ownRooftops),
      ),
    )
    .returning({ id: t.leadRecipients.id });
  if (!done.length) return { ok: false, error: 'Could not find that person.' };

  revalidatePath('/admin/leads');
  return { ok: true };
}

/** Take someone off a lot's lead list. Their login, if they have one, is untouched. */
export async function removeLeadRecipient(id: string): Promise<DeliveryResult> {
  const groupId = await deliveryEditorGroup();
  if (!groupId) return NOT_ALLOWED;

  const ownRooftops = db
    .select({ id: t.rooftops.id })
    .from(t.rooftops)
    .where(eq(t.rooftops.groupId, groupId));

  const gone = await db
    .delete(t.leadRecipients)
    .where(and(eq(t.leadRecipients.id, id), inArray(t.leadRecipients.rooftopId, ownRooftops)))
    .returning({ id: t.leadRecipients.id });
  if (!gone.length) return { ok: false, error: 'Could not find that person.' };

  revalidatePath('/admin/leads');
  return { ok: true };
}
