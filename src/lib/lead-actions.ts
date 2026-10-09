'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSection } from '@/lib/auth-guard';
import { requireGroupId } from '@/lib/auth';

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
