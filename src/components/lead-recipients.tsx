'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button, cn } from './ui';
import {
  addLeadRecipient,
  removeLeadRecipient,
  saveLotLeadContact,
  updateLeadRecipient,
  type DeliveryResult,
} from '@/lib/lead-actions';

/**
 * One lot's lead list on Leads: the lot itself first, then the people.
 *
 * One row open at a time. Editing turns that single line into fields; nothing
 * else on the card changes, so the list never becomes a stack of open forms.
 * After a save the row closes and a green "Saved" sits on it for a few
 * seconds -- saves are fast enough that without it nobody can tell.
 */

export type RecipientRow = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  cell: string | null;
};

export type StaffOption = {
  id: string;
  name: string;
  email: string;
  cell: string | null;
};

/** +13605550142 -> (360) 555-0142 */
export function prettyCell(e164: string | null | undefined): string {
  const d = (e164 ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
}

const inputCls =
  'w-full rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm focus:border-ink-500 focus:outline-none';
const linkCls = 'text-xs font-medium text-ink-600 hover:text-ink-900 hover:underline';

function Saved() {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
        <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Saved
    </span>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600">{label}</span>
      <input maxLength={200} className={inputCls} {...props} />
    </label>
  );
}

function Dash() {
  return <span className="text-ink-300">&mdash;</span>;
}

/** The read-out of one recipient: name, email, cell, in columns on desktop. */
function Line({
  name,
  tag,
  email,
  cell,
  children,
}: {
  name: string;
  tag?: string;
  email: string | null;
  cell: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)_9rem_11rem]">
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <div className="truncate text-sm font-medium text-ink-900">{name}</div>
        {tag ? <div className="text-[11px] text-ink-500">{tag}</div> : null}
      </div>
      <div className="col-span-2 min-w-0 truncate text-sm text-ink-700 sm:col-span-1">{email || <Dash />}</div>
      <div className="text-sm text-ink-700">{prettyCell(cell) || <Dash />}</div>
      <div className="flex items-center justify-end gap-3">{children}</div>
    </div>
  );
}

export function LeadRecipients({
  rooftopId,
  lotEmail,
  lotCell,
  people,
  staff,
  canEdit,
}: {
  rooftopId: string;
  lotEmail: string;
  lotCell: string | null;
  people: RecipientRow[];
  staff: StaffOption[];
  canEdit: boolean;
}) {
  /** Which row is open: 'lot', 'add', or a recipient id. */
  const [open, setOpen] = useState<string | null>(null);
  /** Which row just saved; shows the green check for a few seconds. */
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  function openRow(key: string | null) {
    setOpen(key);
    setError(null);
    setConfirmRemove(null);
  }

  function run(key: string, action: () => Promise<DeliveryResult>) {
    setError(null);
    start(async () => {
      const r = await action();
      if (r.ok) {
        setOpen(null);
        setConfirmRemove(null);
        setFlash(key);
      } else {
        setError(r.error);
      }
    });
  }

  const onList = new Set(people.map((p) => p.userId).filter(Boolean));
  const pickable = staff.filter((s) => !onList.has(s.id));

  const errorLine = error ? <p className="mt-2 text-xs font-medium text-red-700">{error}</p> : null;

  const saveRow = (onCancel: () => void, label = 'Save') => (
    <div className="mt-3 flex items-center justify-end gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  );

  return (
    <div className="divide-y divide-ink-100">
      {/* ---- the lot itself: editable, never removable ---- */}
      {open === 'lot' ? (
        <form
          className="bg-ink-50/60 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run('lot', () =>
              saveLotLeadContact({
                rooftopId,
                email: String(f.get('email') ?? ''),
                cell: String(f.get('cell') ?? ''),
              }),
            );
          }}
        >
          <div className="mb-2 text-sm font-medium text-ink-900">The lot</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" name="email" type="email" defaultValue={lotEmail} placeholder="you@yourlot.com" required autoFocus />
            <Field label="Cell for lead texts (optional)" name="cell" type="tel" defaultValue={prettyCell(lotCell)} placeholder="(360) 555-0142" />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-500">Cell only. Texts to a landline never arrive.</p>
          {errorLine}
          {saveRow(() => openRow(null))}
        </form>
      ) : (
        <Line name="The lot" tag="Always gets leads" email={lotEmail} cell={lotCell}>
          {flash === 'lot' ? <Saved /> : null}
          {canEdit ? (
            <button type="button" className={linkCls} onClick={() => openRow('lot')}>
              Edit
            </button>
          ) : null}
        </Line>
      )}

      {/* ---- people ---- */}
      {people.map((p) => {
        const linked = p.userId !== null;
        if (open === p.id && !linked) {
          return (
            <form
              key={p.id}
              className="bg-ink-50/60 px-5 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(p.id, () =>
                  updateLeadRecipient({
                    id: p.id,
                    name: String(f.get('name') ?? ''),
                    email: String(f.get('email') ?? ''),
                    cell: String(f.get('cell') ?? ''),
                  }),
                );
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name" name="name" defaultValue={p.name} required autoFocus maxLength={120} />
                <Field label="Email" name="email" type="email" defaultValue={p.email ?? ''} placeholder="jake@yourlot.com" />
                <Field label="Cell" name="cell" type="tel" defaultValue={prettyCell(p.cell)} placeholder="(360) 555-0199" />
              </div>
              <p className="mt-1.5 text-[11px] text-ink-500">
                Email, cell, or both. Cell only &mdash; texts to a landline never arrive.
              </p>
              {errorLine}
              {saveRow(() => openRow(null))}
            </form>
          );
        }

        const tag = linked
          ? p.cell
            ? 'Staff · updates from their account'
            : 'Staff · no cell on file, email only'
          : undefined;

        return (
          <div key={p.id}>
            <Line name={p.name || 'Unnamed'} tag={tag} email={p.email} cell={p.cell}>
              {flash === p.id ? <Saved /> : null}
              {canEdit && confirmRemove === p.id ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <span className="text-ink-600">Remove?</span>
                  <button
                    type="button"
                    disabled={pending}
                    className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                    onClick={() => run('removed', () => removeLeadRecipient(p.id))}
                  >
                    {pending ? 'Removing…' : 'Yes'}
                  </button>
                  <button type="button" disabled={pending} className="text-ink-500 hover:underline" onClick={() => openRow(null)}>
                    No
                  </button>
                </span>
              ) : canEdit ? (
                <>
                  {linked ? null : (
                    <button type="button" className={linkCls} onClick={() => openRow(p.id)}>
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs font-medium text-ink-400 hover:text-red-700 hover:underline"
                    onClick={() => {
                      openRow(null);
                      setConfirmRemove(p.id);
                    }}
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </Line>
            {confirmRemove === p.id ? <div className="px-5 pb-2">{errorLine}</div> : null}
          </div>
        );
      })}

      {/* ---- add ---- */}
      {canEdit ? (
        open === 'add' ? (
          <AddPerson
            rooftopId={rooftopId}
            pickable={pickable}
            pending={pending}
            errorLine={errorLine}
            onCancel={() => openRow(null)}
            onSubmit={(input) => run('added', () => addLeadRecipient(input))}
          />
        ) : (
          <div className="flex items-center gap-3 px-5 py-3">
            <button
              type="button"
              className="text-sm font-medium text-ink-900 hover:underline"
              onClick={() => openRow('add')}
            >
              + Add a person
            </button>
            {flash === 'added' ? <Saved /> : null}
            {flash === 'removed' ? <span className="text-xs text-ink-500">Removed.</span> : null}
          </div>
        )
      ) : null}
    </div>
  );
}

function AddPerson({
  rooftopId,
  pickable,
  pending,
  errorLine,
  onCancel,
  onSubmit,
}: {
  rooftopId: string;
  pickable: StaffOption[];
  pending: boolean;
  errorLine: React.ReactNode;
  onCancel: () => void;
  onSubmit: (
    input:
      | { rooftopId: string; userId: string }
      | { rooftopId: string; name: string; email: string; cell: string },
  ) => void;
}) {
  // Start on the dropdown when there is anyone left to pick; typing is the fallback.
  const [mode, setMode] = useState<'pick' | 'type'>(pickable.length ? 'pick' : 'type');
  const [userId, setUserId] = useState('');
  const picked = pickable.find((s) => s.id === userId);

  const tab = (m: 'pick' | 'type', label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium',
        mode === m ? 'bg-white text-ink-900 shadow-sm ring-1 ring-ink-200' : 'text-ink-500 hover:text-ink-800',
      )}
    >
      {label}
    </button>
  );

  return (
    <form
      className="bg-ink-50/60 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'pick') {
          onSubmit({ rooftopId, userId });
        } else {
          const f = new FormData(e.currentTarget);
          onSubmit({
            rooftopId,
            name: String(f.get('name') ?? ''),
            email: String(f.get('email') ?? ''),
            cell: String(f.get('cell') ?? ''),
          });
        }
      }}
    >
      <div className="mb-3 inline-flex gap-1 rounded-lg bg-ink-100 p-1">
        {tab('pick', 'Pick an employee')}
        {tab('type', 'Type someone in')}
      </div>

      {mode === 'pick' ? (
        pickable.length ? (
          <div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600">Employee</span>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                className={cn(inputCls, 'bg-white sm:max-w-sm')}
              >
                <option value="">Choose someone…</option>
                {pickable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.cell ? '' : ' (no cell on file)'}
                  </option>
                ))}
              </select>
            </label>
            {picked ? (
              <p className="mt-2 text-xs text-ink-600">
                Leads go to {picked.email}
                {picked.cell ? ` and ${prettyCell(picked.cell)}` : ''}.
                {picked.cell ? null : (
                  <span className="mt-0.5 block font-medium text-amber-700">
                    No cell on file &mdash; email only until they add one on Account.
                  </span>
                )}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-ink-600">
            Everyone with a login is already on this list. Invite more people in Settings, or type
            someone in.
          </p>
        )
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" name="name" required autoFocus maxLength={120} placeholder="Jake Morris" />
            <Field label="Email" name="email" type="email" placeholder="jake@yourlot.com" />
            <Field label="Cell" name="cell" type="tel" placeholder="(360) 555-0199" />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-500">
            Email, cell, or both. Cell only &mdash; texts to a landline never arrive.
          </p>
        </>
      )}

      {errorLine}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending || (mode === 'pick' && !userId)}
          aria-busy={pending}
        >
          {pending ? 'Saving…' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
