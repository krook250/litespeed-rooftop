'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { can } from '@/lib/permissions';

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
