'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { can, ROLE_LABEL } from '@/lib/permissions';
import { sendEmail } from '@/lib/email';
import { inviteEmail, inviteExpiry, inviteToken, inviteUrl } from '@/lib/invites';

const ROLES = new Set<string>([
  'OWNER', 'SALES_MANAGER', 'SALES', 'RECEPTION', 'PARTS', 'SERVICE', 'MARKETING', 'LOT_PORTER',
]);

/**
 * Change one person's role.
 *
 * Three checks, and all three matter:
 *
 *  1. **The caller can open Settings.** `can(role, 'settings')` rather than
 *     `role === 'OWNER'`, so if the matrix ever lets a general manager in here,
 *     this follows without anybody remembering to update it.
 *  2. **The target is in the caller's own dealership.** The update is scoped by
 *     `groupId` in the WHERE clause, not checked and then written — a check
 *     followed by an unscoped write is the shape that leaks across tenants.
 *  3. **The last owner cannot be demoted.** Enforced here and not only in the
 *     UI, because the UI is a select element and the action is an HTTP endpoint.
 *     A dealership with no owner can never add anyone again.
 */
export async function setUserRole(formData: FormData) {
  const me = await requireSession();
  if (!can(me.role, 'settings')) return;

  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!userId || !ROLES.has(role)) return;

  const [target] = await db
    .select({ id: t.users.id, role: t.users.role })
    .from(t.users)
    .where(and(eq(t.users.id, userId), eq(t.users.groupId, me.groupId)))
    .limit(1);
  if (!target) return;
  if (target.role === role) return;

  if (target.role === 'OWNER' && role !== 'OWNER') {
    const others = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(
        and(
          eq(t.users.groupId, me.groupId),
          eq(t.users.role, 'OWNER'),
          ne(t.users.id, target.id),
        ),
      )
      .limit(1);
    if (!others.length) return;
  }

  await db
    .update(t.users)
    .set({ role: role as t.UserRole })
    .where(and(eq(t.users.id, userId), eq(t.users.groupId, me.groupId)));

  // The sidebar is built from the role, so it has to be rebuilt too — not just
  // the settings screen. If the person demoted is the one clicking, their own
  // nav needs to lose the links on the next paint.
  revalidatePath('/admin', 'layout');
}

/**
 * Invite someone.
 *
 * Owner-only via `can(me.role, 'settings')`, and the new person's role is
 * checked against the enum rather than trusted — the select is a select, the
 * action is an HTTP endpoint.
 *
 * Two refusals worth naming:
 *
 *  - **Already staff.** Re-inviting someone who has an account would produce a
 *    token that, if used, tries to create a second account on the same email.
 *    Better Auth would reject it and the person would see a stranger's error.
 *  - **Already invited.** A second live invite to the same address makes two
 *    working links, and revoking one leaves the other. The pending row is
 *    re-sent instead, which is what "invite them again" actually means.
 */
export async function inviteUser(formData: FormData) {
  const me = await requireSession();
  if (!can(me.role, 'settings')) return;

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? '');
  if (!email || !email.includes('@') || !ROLES.has(role)) return;

  const [existing] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.email, email))
    .limit(1);
  if (existing) return;

  /*
   * Expiry is deliberately NOT a condition here.
   *
   * It used to be, and the result was a duplicate: inviting an address whose
   * invite had lapsed found nothing, inserted a second row, and left the owner
   * looking at the same person twice in "Waiting to accept" with no way to tell
   * which link was which. An outstanding invitation to an address is one thing
   * whether or not the clock ran out on it.
   */
  const [live] = await db
    .select({ id: t.invites.id, token: t.invites.token, expiresAt: t.invites.expiresAt })
    .from(t.invites)
    .where(
      and(
        eq(t.invites.groupId, me.groupId),
        eq(t.invites.email, email),
        isNull(t.invites.acceptedAt),
        isNull(t.invites.revokedAt),
      ),
    )
    .limit(1);

  let token = live?.token;
  if (live) {
    // Re-sending pushes the expiry out and updates the role, so changing your
    // mind about what someone should be does not need a revoke-and-reinvite.
    // A lapsed invite gets a new token as well — see `resendInvite`.
    if (new Date(live.expiresAt ?? 0) <= new Date()) token = inviteToken();
    await db
      .update(t.invites)
      .set({ role: role as t.UserRole, token: token!, expiresAt: inviteExpiry() })
      .where(eq(t.invites.id, live.id));
  } else {
    token = inviteToken();
    await db.insert(t.invites).values({
      groupId: me.groupId,
      email,
      role: role as t.UserRole,
      token,
      invitedByUserId: me.id,
      expiresAt: inviteExpiry(),
    });
  }

  const [group] = await db
    .select({ name: t.dealerGroups.name })
    .from(t.dealerGroups)
    .where(eq(t.dealerGroups.id, me.groupId))
    .limit(1);

  const host = (await headers()).get('host');
  await sendEmail(
    inviteEmail({
      to: email,
      url: inviteUrl(token!, host),
      dealership: group?.name ?? 'your dealership',
      inviterName: me.name,
      roleLabel: ROLE_LABEL[role as t.UserRole],
    }),
  );

  revalidatePath('/admin/settings');
}

/**
 * Send someone's invitation again.
 *
 * **Rotates the token.** Pushing the expiry on the existing one would be
 * friendlier by a hair — the original email would start working again — but an
 * invite that has been sitting in an inbox for three weeks is exactly the one
 * that got forwarded to somebody's personal address with "can you set this up
 * for me". Resending should leave one live link, not two, and the person is
 * getting a fresh email regardless, which is the entire point of the button.
 *
 * Works on a lapsed invite as readily as a live one: that is what an owner is
 * looking at when they reach for this.
 */
export async function resendInvite(formData: FormData) {
  const me = await requireSession();
  if (!can(me.role, 'settings')) return;
  const id = String(formData.get('inviteId') ?? '');
  if (!id) return;

  // Scoped in the WHERE clause, so an id from another dealership finds nothing.
  const [invite] = await db
    .select({ id: t.invites.id, email: t.invites.email, role: t.invites.role })
    .from(t.invites)
    .where(
      and(
        eq(t.invites.id, id),
        eq(t.invites.groupId, me.groupId),
        isNull(t.invites.acceptedAt),
        isNull(t.invites.revokedAt),
      ),
    )
    .limit(1);
  if (!invite) return;

  const token = inviteToken();
  await db
    .update(t.invites)
    .set({ token, expiresAt: inviteExpiry() })
    .where(and(eq(t.invites.id, invite.id), eq(t.invites.groupId, me.groupId)));

  const [group] = await db
    .select({ name: t.dealerGroups.name })
    .from(t.dealerGroups)
    .where(eq(t.dealerGroups.id, me.groupId))
    .limit(1);

  const host = (await headers()).get('host');
  await sendEmail(
    inviteEmail({
      to: invite.email,
      url: inviteUrl(token, host),
      dealership: group?.name ?? 'your dealership',
      inviterName: me.name,
      roleLabel: ROLE_LABEL[invite.role],
    }),
  );

  revalidatePath('/admin/settings');
}

/** Kill a pending invite. Scoped in the WHERE clause, same as every other write here. */
export async function revokeInvite(formData: FormData) {
  const me = await requireSession();
  if (!can(me.role, 'settings')) return;
  const id = String(formData.get('inviteId') ?? '');
  if (!id) return;

  await db
    .update(t.invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(t.invites.id, id), eq(t.invites.groupId, me.groupId)));

  revalidatePath('/admin/settings');
}
