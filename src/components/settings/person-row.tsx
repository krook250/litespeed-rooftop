'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { prettyCell } from '@/components/lead-recipients';
import { updatePerson } from '@/lib/settings-actions';

/**
 * One line in Settings -> People. "Edit" turns the name and cell into fields
 * in place; the role picker stays where it is, because it already saves on
 * its own. Email is shown, not editable: it is the person's sign-in.
 */
export function PersonRow({
  userId,
  name,
  email,
  cell,
  isMe,
  rolePicker,
}: {
  userId: string;
  name: string;
  email: string;
  cell: string | null;
  isMe: boolean;
  rolePicker: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  const input =
    'w-full rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm focus:border-ink-500 focus:outline-none';

  if (editing) {
    return (
      <form
        className="bg-ink-50/60 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const r = await updatePerson({
              userId,
              name: String(f.get('name') ?? ''),
              cell: String(f.get('cell') ?? ''),
            });
            if (r.ok) {
              setEditing(false);
              setSaved(true);
            } else setError(r.error);
          });
        }}
      >
        <div className="mb-2 truncate text-xs text-ink-500">{email}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Name</span>
            <input name="name" defaultValue={name} required maxLength={120} autoFocus className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Cell</span>
            <input
              name="cell"
              type="tel"
              defaultValue={prettyCell(cell)}
              maxLength={40}
              placeholder="(360) 555-0199"
              className={input}
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">
          Lead texts go here when they&rsquo;re on a lot&rsquo;s lead list. Cell only &mdash; texts to a
          landline never arrive.
        </p>
        {error ? <p className="mt-2 text-xs font-medium text-red-700">{error}</p> : null}
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-900">
          {name}
          {isMe ? <span className="ml-1.5 text-xs font-medium text-ink-400">you</span> : null}
        </div>
        <div className="truncate text-xs text-ink-500">
          {email}
          {cell ? ` · ${prettyCell(cell)}` : <span className="text-ink-400"> · no cell</span>}
        </div>
      </div>
      {saved ? (
        <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
            <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Saved
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs font-medium text-ink-600 hover:text-ink-900 hover:underline"
      >
        Edit
      </button>
      {rolePicker}
    </div>
  );
}
