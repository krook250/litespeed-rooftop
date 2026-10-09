'use client';

import { useState, useTransition } from 'react';
import { deleteLead } from '@/lib/lead-actions';

/**
 * Two clicks, no browser dialog: "Delete" turns into "Delete for good? Yes / No".
 * A lead cannot be brought back, so one stray tap should not do it.
 */
export function DeleteLeadButton({ leadId }: { leadId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-ink-400 hover:text-red-700 hover:underline"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-ink-600">{failed ? 'Could not delete.' : 'Delete for good?'}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteLead(leadId);
            if (!r.ok) setFailed(true);
          })
        }
        className="font-semibold text-red-700 hover:underline disabled:opacity-50"
      >
        {pending ? 'Deleting…' : 'Yes'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setConfirming(false);
          setFailed(false);
        }}
        className="text-ink-500 hover:underline"
      >
        No
      </button>
    </span>
  );
}
