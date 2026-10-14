'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveAccount, type AccountState } from '@/lib/account-actions';
import { SubmitButton } from './submit-button';
import { prettyCell } from './lead-recipients';

export function AccountForm({ name, cell }: { name: string; cell: string | null }) {
  const [state, action] = useActionState<AccountState, FormData>(saveAccount, null);
  /** The save whose "Saved" has already faded. */
  const [faded, setFaded] = useState<number | undefined>(undefined);
  const shown = !!state?.ok && state.at !== faded;

  // "Saved" only on a save that actually worked, for a few seconds.
  useEffect(() => {
    if (!state?.ok) return;
    const t = setTimeout(() => setFaded(state.at), 4000);
    return () => clearTimeout(t);
  }, [state]);

  const input =
    'w-full rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm focus:border-ink-500 focus:outline-none';

  return (
    <form action={action} className="space-y-4 px-5 py-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Name</span>
        <input name="name" defaultValue={name} required maxLength={120} autoComplete="name" className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Cell</span>
        <input
          name="cell"
          type="tel"
          defaultValue={prettyCell(cell)}
          maxLength={40}
          autoComplete="tel"
          placeholder="(360) 555-0199"
          className={input}
        />
        <span className="mt-1 block text-[11px] text-ink-500">
          If you&rsquo;re on a lot&rsquo;s lead list, new leads are texted here. Cell only &mdash;
          texts to a landline never arrive.
        </span>
      </label>
      {state && !state.ok ? <p className="text-xs font-medium text-red-700">{state.error}</p> : null}
      <div className="flex items-center justify-end gap-3">
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-1 text-sm font-medium text-emerald-700 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
            <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {shown ? 'Saved' : ''}
        </span>
        <SubmitButton size="sm">Save</SubmitButton>
      </div>
    </form>
  );
}
