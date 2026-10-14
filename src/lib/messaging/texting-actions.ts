'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { toUsE164 } from './alerts';
import { getNumber, numberChoices, setRings } from './numbers';
import { getRegistration, sendRegistration, type RegistrationInput } from './registration';
import type { FreeNumber } from './twilio';

/**
 * Settings → Texting & calls. Owner only: it buys a number and files the
 * dealership's EIN with the carriers. The group always comes from the session.
 */

async function owner() {
  const me = await requireSession();
  if (!can(me.role, 'settings')) throw new Error('Not allowed');
  return me;
}

const PATH = '/admin/settings/texting';

export type SearchState = { numbers?: FreeNumber[]; elsewhere?: boolean; error?: string; at?: number } | null;

export async function searchNumbersAction(_prev: SearchState, fd: FormData): Promise<SearchState> {
  const me = await owner();
  const area = String(fd.get('area') ?? '').replace(/\D/g, '');
  const contains = String(fd.get('contains') ?? '').replace(/\D/g, '').slice(0, 7);
  if (!/^[2-9]\d{2}$/.test(area)) return { error: 'Enter a three-digit area code.' };
  const lot = await db.query.rooftops.findFirst({ where: eq(t.rooftops.groupId, me.groupId) });
  const r = await numberChoices(area, contains, (lot?.state ?? '').toUpperCase());
  if (r.error || !r.data) return { error: r.error ?? 'Search failed. Try again.' };
  if (!r.data.numbers.length) return { error: 'Nothing free there. Try another area code, or leave the digits blank.' };
  return { ...r.data, at: Date.now() };
}

export type ActionState = { ok: boolean; error?: string; at?: number } | null;

export async function getNumberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await owner();
  const e164 = String(fd.get('number') ?? '');
  const rings = toUsE164(String(fd.get('rings') ?? ''));
  if (!/^\+1\d{10}$/.test(e164)) return { ok: false, error: 'Pick a number first.' };
  if (!rings) return { ok: false, error: 'Enter the ten-digit phone calls should ring.' };
  const group = await db.query.dealerGroups.findFirst({ where: eq(t.dealerGroups.id, me.groupId) });
  const reg = await getRegistration(me.groupId);
  const service = reg?.status === 'READY' ? reg.messagingServiceSid : null;
  const error = await getNumber(me.groupId, group?.name ?? me.groupId, e164, rings, service);
  if (error) return { ok: false, error };
  revalidatePath(PATH);
  revalidatePath('/admin/settings');
  return { ok: true, at: Date.now() };
}

export async function setRingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await owner();
  const rings = toUsE164(String(fd.get('rings') ?? ''));
  if (!rings) return { ok: false, error: 'Enter a ten-digit phone number.' };
  await setRings(me.groupId, rings);
  revalidatePath(PATH);
  return { ok: true, at: Date.now() };
}

const field = (fd: FormData, k: string, max = 120) => String(fd.get(k) ?? '').trim().slice(0, max);

export async function sendRegistrationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await owner();
  const phone = toUsE164(field(fd, 'contactPhone', 40));
  const input: RegistrationInput = {
    legalName: field(fd, 'legalName', 200),
    businessType: field(fd, 'businessType'),
    ein: field(fd, 'ein', 20),
    street: field(fd, 'street', 200),
    city: field(fd, 'city'),
    state: field(fd, 'state', 2).toUpperCase(),
    zip: field(fd, 'zip', 10).replace(/\D/g, '').slice(0, 5),
    website: field(fd, 'website', 200),
    contactFirst: field(fd, 'contactFirst'),
    contactLast: field(fd, 'contactLast'),
    contactTitle: field(fd, 'contactTitle'),
    contactPosition: field(fd, 'contactPosition'),
    contactEmail: field(fd, 'contactEmail', 200).toLowerCase(),
    contactPhone: phone ?? '',
  };
  const error = await sendRegistration(me.groupId, input);
  if (error) return { ok: false, error };
  revalidatePath(PATH);
  revalidatePath('/admin/settings');
  return { ok: true, at: Date.now() };
}
