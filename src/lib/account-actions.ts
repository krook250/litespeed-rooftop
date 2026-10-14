'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { toUsE164 } from '@/lib/messaging/alerts';

export type AccountState = { ok: boolean; error?: string; at?: number } | null;

/**
 * Your own name and cell. Anyone signed in, for themselves only -- the id comes
 * from the session, never the form.
 *
 * The cell is what Leads reads when a manager picks you as a lead recipient,
 * so changing it here moves your lead texts with it.
 */
export async function saveAccount(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const me = await requireSession();
  const name = String(formData.get('name') ?? '').trim().slice(0, 120);
  const cellText = String(formData.get('cell') ?? '').trim().slice(0, 40);
  const cell = toUsE164(cellText);

  if (!name) return { ok: false, error: 'Your name can’t be blank.' };
  if (cellText && !cell) return { ok: false, error: 'That cell doesn’t look like a 10-digit US number.' };

  await db.update(t.users).set({ name, cell, updatedAt: new Date() }).where(eq(t.users.id, me.id));

  revalidatePath('/admin', 'layout');
  return { ok: true, at: Date.now() };
}
