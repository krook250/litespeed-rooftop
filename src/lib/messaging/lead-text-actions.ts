'use server';

import { revalidatePath } from 'next/cache';
import { requireSection } from '@/lib/auth-guard';
import { sendLeadText } from './lead-texts';

/** The Send button on a lead. Anyone who can see Leads can text a lead who opted in. */
export async function sendLeadTextAction(leadId: string, body: string): Promise<{ error: string | null }> {
  const me = await requireSection('leads');
  const error = await sendLeadText(me.groupId, leadId, me.id, body);
  revalidatePath(`/admin/leads/${leadId}`);
  revalidatePath('/admin/leads');
  return { error };
}
