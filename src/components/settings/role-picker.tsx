'use client';

import { useTransition } from 'react';
import { setUserRole } from '@/lib/settings-actions';
import { ROLE_LABEL } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';

const ROLES = Object.keys(ROLE_LABEL) as UserRole[];

/**
 * Change one person's role.
 *
 * Submits on change with no Save button, because there is one field and a Save
 * button on a one-field form is a thing people forget to press. The select is
 * disabled outright when the change is not allowed rather than failing after
 * the fact — the action re-checks anyway, but being told no *after* choosing is
 * worse than not being offered.
 */
export function RolePicker({
  userId,
  role,
  locked,
  lockedReason,
}: {
  userId: string;
  role: UserRole;
  locked?: boolean;
  lockedReason?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={role}
      disabled={locked || pending}
      title={lockedReason}
      onChange={(e) => {
        const fd = new FormData();
        fd.set('userId', userId);
        fd.set('role', e.target.value);
        startTransition(async () => {
          await setUserRole(fd);
        });
      }}
      className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-800 outline-none focus:border-ink-400 disabled:bg-ink-50 disabled:text-ink-400"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}
