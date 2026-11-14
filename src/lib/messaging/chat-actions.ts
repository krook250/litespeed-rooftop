'use server';

import { requireSection } from '@/lib/auth-guard';
import { inbox, markRead, threadView, type Inbox, type ThreadView } from './chat';

/** The bubble's list. Polled while the app is open. */
export async function chatInboxAction(): Promise<Inbox> {
  const me = await requireSection('leads');
  return inbox(me.groupId);
}

/** One thread in the bubble. Opening it marks their replies read. */
export async function chatThreadAction(leadId: string): Promise<ThreadView | null> {
  const me = await requireSection('leads');
  const view = await threadView(me.groupId, leadId);
  if (view) await markRead(me.groupId, leadId);
  return view;
}
