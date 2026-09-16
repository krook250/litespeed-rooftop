/**
 * Getting one dealer group permission to text.
 *
 * The dealer sees a button and a status line. Behind it are three sequential
 * Twilio registrations — Secondary Customer Profile, Brand, Campaign — and a
 * subaccount to hold them. `beginSetup` is the whole of that sequence as far as
 * the client is concerned: call it, get back either an inquiry to render or a
 * status to display, and never encode the step order in the browser.
 *
 * THIS FILE CURRENTLY IMPLEMENTS STEP ONE ONLY, and that is a sequencing fact
 * rather than an unfinished job: a Brand cannot be registered until the profile
 * beneath it is submitted and carrier-approved, so there is nothing to write
 * against until one real profile has been through. `nextStep` is where the
 * other two arrive, and the client does not change when they do.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { dealerGroups, messagingRegistrations } from '@/db/schema';
import {
  initCustomerInquiry,
  createSubaccount,
  profileSidFrom,
  twilioConfig,
  type TwilioConfig,
} from './twilio';

export type SetupResult =
  /** Render the embed with these. The token is good for 24 hours. */
  | { kind: 'INQUIRY'; inquiryId: string; inquirySessionToken: string }
  /** Nothing for anyone to do. Show the status line and stop. */
  | { kind: 'WAITING'; status: 'SUBMITTED' | 'READY' }
  /** This deployment has no Twilio credentials. */
  | { kind: 'NOT_CONFIGURED' };

/** The row, created on first use. Texting is an addon; most groups never have one. */
async function registrationFor(groupId: string) {
  const existing = await db.query.messagingRegistrations.findFirst({
    where: eq(messagingRegistrations.groupId, groupId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(messagingRegistrations)
    .values({ groupId })
    .returning();
  return created;
}

/**
 * The dealer's own Twilio subaccount, created the first time they ask for
 * texting and never before.
 *
 * Lazy on purpose. Texting is a paid addon, so provisioning a subaccount at
 * dealer onboarding would mint an account for every dealer who never buys it —
 * clutter at best, and a per-account line item at worst.
 */
async function ensureSubaccount(
  cfg: TwilioConfig,
  reg: typeof messagingRegistrations.$inferSelect,
  groupName: string,
) {
  if (reg.subaccountSid) return reg.subaccountSid;

  const sid = await createSubaccount(cfg, groupName);
  await db
    .update(messagingRegistrations)
    .set({ subaccountSid: sid, updatedAt: new Date() })
    .where(eq(messagingRegistrations.id, reg.id));
  return sid;
}

/**
 * Start, or pick back up, the texting setup for a group.
 *
 * Idempotent by design — the dealer will click this button again. A part-way
 * inquiry resumes with its data intact; a finished one does not reopen.
 */
export async function beginSetup(groupId: string): Promise<SetupResult> {
  const cfg = twilioConfig();
  if (!cfg) return { kind: 'NOT_CONFIGURED' };

  const group = await db.query.dealerGroups.findFirst({
    where: eq(dealerGroups.id, groupId),
  });
  if (!group) throw new Error(`No such dealer group: ${groupId}`);

  const reg = await registrationFor(groupId);

  // Already through, or waiting on carriers. Either way there is no form to open.
  if (reg.status === 'READY') return { kind: 'WAITING', status: 'READY' };
  if (reg.status === 'SUBMITTED') return { kind: 'WAITING', status: 'SUBMITTED' };

  await ensureSubaccount(cfg, reg, group.name);

  return nextStep(cfg, reg.id);
}

/**
 * Which registration the dealer is owed next.
 *
 * Step one today. When Brand and Campaign land they become further branches
 * here and nothing above or outside this function changes.
 */
async function nextStep(cfg: TwilioConfig, registrationId: string): Promise<SetupResult> {
  const reg = await db.query.messagingRegistrations.findFirst({
    where: eq(messagingRegistrations.id, registrationId),
  });
  if (!reg) throw new Error(`Registration vanished: ${registrationId}`);

  // --- step 1: who this business is ---------------------------------------
  // Passing the stored id resumes; passing none opens a fresh one.
  const init = await initCustomerInquiry(cfg, { customerId: reg.customerId });

  await db
    .update(messagingRegistrations)
    .set({
      status: 'COLLECTING',
      profileInquiryId: init.inquiry_id,
      customerId: init.customer_id,
      customerProfileSid: profileSidFrom(init.customer_id) ?? reg.customerProfileSid,
      updatedAt: new Date(),
    })
    .where(eq(messagingRegistrations.id, reg.id));

  return {
    kind: 'INQUIRY',
    inquiryId: init.inquiry_id,
    inquirySessionToken: init.inquiry_session_token,
  };
}

/**
 * The dealer finished the embed. Their part is over; the carriers' part starts.
 *
 * Called from `onInquirySubmitted`. Deliberately does not trust the browser for
 * anything but "I am done" — every id it writes was already ours.
 */
export async function markSubmitted(groupId: string) {
  await db
    .update(messagingRegistrations)
    .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(messagingRegistrations.groupId, groupId));
}
