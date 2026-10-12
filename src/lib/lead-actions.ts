'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
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

/**
 * Where a lot's leads go: up to two inboxes and two cells.
 *
 * Owner and sales manager only. Anyone who can change this can quietly route
 * every lead to themselves, which is not a salesperson's call.
 *
 * A cell that doesn't parse as a US number is saved as empty, so the box comes
 * back blank and it's obvious it didn't take. Same rule for an email with no @.
 */
export async function saveLeadDelivery(formData: FormData) {
  const me = await requireSection('leads');
  if (me.role !== 'OWNER' && me.role !== 'SALES_MANAGER') return;
  const groupId = await requireGroupId();

  const rooftopId = String(formData.get('rooftopId') ?? '');
  const str = (k: string) => String(formData.get(k) ?? '').trim().slice(0, 200);
  const email = (k: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(k)) ? str(k) : '');

  const email1 = email('email');
  const email2 = email('leadEmail2');
  const cell1 = toUsE164(str('leadAlertPhone'));
  const cell2 = toUsE164(str('leadAlertPhone2'));

  await db
    .update(t.rooftops)
    .set({
      // First slot empty and second filled: move it up, so "the" lead email is never blank by accident.
      email: email1 || email2,
      leadEmail2: email1 && email2 && email2 !== email1 ? email2 : null,
      leadAlertPhone: cell1 ?? cell2,
      leadAlertPhone2: cell1 && cell2 && cell2 !== cell1 ? cell2 : null,
    })
    .where(and(eq(t.rooftops.id, rooftopId), eq(t.rooftops.groupId, groupId)));

  revalidatePath('/admin/leads');
}
