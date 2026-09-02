'use client';

import { useRef, useState, useTransition } from 'react';
import { inviteUser, revokeInvite } from '@/lib/settings-actions';
import { ROLE_LABEL, ROLE_BLURB } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';

const ROLES = Object.keys(ROLE_LABEL) as UserRole[];

/**
 * Add someone.
 *
 * The role is picked here rather than after they join, because the invite email
 * tells them what they are being set up as — and a person who is told "you are
 * Reception" and then finds the ad account open is a worse outcome than either.
 *
 * Defaults to SALES: it is the most common hire and the least dangerous
 * mistake. An owner who wanted a manager will notice; an owner who accidentally
 * made a lot porter an owner might not.
 */
export function InviteForm() {
  const [role, setRole] = useState<UserRole>('SALES');
  const [pending, startTransition] = useTransition();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const email = String(fd.get('email') ?? '');
          await inviteUser(fd);
          setSentTo(email);
          formRef.current?.reset();
          setRole('SALES');
        })
      }
      className="flex flex-wrap items-end gap-3 px-4 py-3"
    >
      <label className="min-w-[220px] flex-1">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          placeholder="name@dealership.com"
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
        />
      </label>

      <label className="min-w-[170px]">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500">
          Role
        </span>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-ink-400"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send invite'}
      </button>

      <p className="w-full text-xs text-ink-500">
        {sentTo ? (
          <span className="font-medium text-emerald-700">
            Invitation sent to {sentTo}. The link works for seven days.
          </span>
        ) : (
          <>
            <span className="font-medium text-ink-600">{ROLE_LABEL[role]}</span> — {ROLE_BLURB[role]}
          </>
        )}
      </p>
    </form>
  );
}

/** Cancel a pending invite. The link stops working immediately. */
export function RevokeButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const fd = new FormData();
          fd.set('inviteId', inviteId);
          await revokeInvite(fd);
        })
      }
      className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
    >
      Cancel
    </button>
  );
}
