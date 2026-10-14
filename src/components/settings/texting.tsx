'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  getNumberAction,
  searchNumbersAction,
  sendRegistrationAction,
  setRingsAction,
  type ActionState,
  type SearchState,
} from '@/lib/messaging/texting-actions';
import { SubmitButton } from '@/components/submit-button';

const input =
  'w-full rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm focus:border-ink-500 focus:outline-none disabled:bg-ink-50';
const labelCls = 'mb-1 block text-xs font-medium text-ink-600';
const hint = 'mt-1 block text-[11px] text-ink-500';

const pretty = (e164: string) => {
  const d = e164.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
};

function Err({ state }: { state: { error?: string } | null }) {
  return state?.error ? <p className="text-xs font-medium text-red-700">{state.error}</p> : null;
}

/* ---- 1. pick a number ------------------------------------------------------ */

export function NumberPicker({ area, rings }: { area: string; rings: string }) {
  const [found, search] = useActionState<SearchState, FormData>(searchNumbersAction, null);
  const [got, take] = useActionState<ActionState, FormData>(getNumberAction, null);
  const [picked, setPicked] = useState('');

  return (
    <div className="space-y-4 px-5 py-4">
      <form action={search} className="flex flex-wrap items-end gap-3">
        <label className="w-28">
          <span className={labelCls}>Area code</span>
          <input name="area" defaultValue={area} inputMode="numeric" maxLength={3} className={input} />
        </label>
        <label className="w-36">
          <span className={labelCls}>Contains (optional)</span>
          <input name="contains" inputMode="numeric" maxLength={7} placeholder="e.g. 4400" className={input} />
        </label>
        <SubmitButton variant="secondary" pendingLabel="Searching…">
          Search
        </SubmitButton>
      </form>
      <Err state={found} />

      {found?.numbers?.length ? (
        <form action={take} className="space-y-4" key={found.at}>
          {found.elsewhere ? (
            <p className="text-xs text-ink-500">Nothing free in that area code. These are elsewhere in your state.</p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {found.numbers.map((n) => (
              <label
                key={n.e164}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  picked === n.e164 ? 'border-ink-900 bg-ink-50' : 'border-ink-200 hover:border-ink-400'
                }`}
              >
                <input type="radio" name="number" value={n.e164} checked={picked === n.e164} onChange={() => setPicked(n.e164)} />
                <span className="tnum font-medium text-ink-900">{pretty(n.e164)}</span>
                <span className="truncate text-xs text-ink-500">{[n.city, n.state].filter(Boolean).join(', ')}</span>
              </label>
            ))}
          </div>
          <label className="block max-w-xs">
            <span className={labelCls}>Calls ring</span>
            <input name="rings" type="tel" defaultValue={rings} placeholder="(360) 555-0199" className={input} />
            <span className={hint}>The phone a call to this number rings. Change it any time.</span>
          </label>
          <Err state={got} />
          <SubmitButton pendingLabel="Getting it…">Get this number</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

/* ---- where calls ring --------------------------------------------------------- */

export function RingsEditor({ rings }: { rings: string }) {
  const [state, action] = useActionState<ActionState, FormData>(setRingsAction, null);
  const [open, setOpen] = useState(false);
  const [faded, setFaded] = useState<number | undefined>(undefined);
  const shown = !!state?.ok && state.at !== faded;

  useEffect(() => {
    if (!state?.ok) return;
    setOpen(false);
    const t = setTimeout(() => setFaded(state.at), 4000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-ink-700 underline underline-offset-4">
          Change
        </button>
      ) : (
        <form action={action} className="inline-flex flex-wrap items-center gap-2">
          <input name="rings" type="tel" defaultValue={rings} className={`${input} w-40`} aria-label="Calls ring" />
          <SubmitButton size="sm">Save</SubmitButton>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-500">
            Cancel
          </button>
        </form>
      )}
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1 text-xs font-medium text-emerald-700 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
          <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {shown ? 'Saved' : ''}
      </span>
      {state && !state.ok ? <span className="text-xs font-medium text-red-700">{state.error}</span> : null}
    </span>
  );
}

/* ---- 2. send for approval ------------------------------------------------------ */

export type RegistrationDefaults = {
  legalName: string;
  businessType: string;
  ein: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  contactFirst: string;
  contactLast: string;
  contactTitle: string;
  contactPosition: string;
  contactEmail: string;
  contactPhone: string;
};

export function RegistrationForm({
  d,
  types,
  positions,
  again,
}: {
  d: RegistrationDefaults;
  types: { value: string; label: string }[];
  positions: readonly string[];
  again: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(sendRegistrationAction, null);

  return (
    <form action={action} className="space-y-6 px-5 py-5">
      <fieldset className="space-y-4">
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          The business, exactly as on your IRS letter
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Legal business name</span>
            <input name="legalName" defaultValue={d.legalName} className={input} />
            <span className={hint}>Including LLC or Inc if it&rsquo;s on the paperwork.</span>
          </label>
          <label className="block">
            <span className={labelCls}>Business type</span>
            <select name="businessType" defaultValue={d.businessType} className={input}>
              <option value="">Pick one</option>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className={hint}>Sole proprietors without an EIN can&rsquo;t sign up here yet.</span>
          </label>
          <label className="block">
            <span className={labelCls}>EIN</span>
            <input name="ein" defaultValue={d.ein} inputMode="numeric" placeholder="12-3456789" className={input} />
            <span className={hint}>Nine digits, from your IRS letter.</span>
          </label>
          <label className="block">
            <span className={labelCls}>Website</span>
            <input name="website" defaultValue={d.website} className={input} />
            <span className={hint}>The carriers open it to check you&rsquo;re real.</span>
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>Street address</span>
            <input name="street" defaultValue={d.street} className={input} />
          </label>
          <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-3 sm:col-span-2">
            <label className="block">
              <span className={labelCls}>City</span>
              <input name="city" defaultValue={d.city} className={input} />
            </label>
            <label className="block">
              <span className={labelCls}>State</span>
              <input name="state" defaultValue={d.state} maxLength={2} className={`${input} uppercase`} />
            </label>
            <label className="block">
              <span className={labelCls}>ZIP</span>
              <input name="zip" defaultValue={d.zip} inputMode="numeric" maxLength={10} className={input} />
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          A person behind the business
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>First name</span>
            <input name="contactFirst" defaultValue={d.contactFirst} className={input} />
          </label>
          <label className="block">
            <span className={labelCls}>Last name</span>
            <input name="contactLast" defaultValue={d.contactLast} className={input} />
          </label>
          <label className="block">
            <span className={labelCls}>Job title</span>
            <input name="contactTitle" defaultValue={d.contactTitle} placeholder="Owner" className={input} />
          </label>
          <label className="block">
            <span className={labelCls}>Role</span>
            <select name="contactPosition" defaultValue={d.contactPosition} className={input}>
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Email</span>
            <input name="contactEmail" type="email" defaultValue={d.contactEmail} className={input} />
          </label>
          <label className="block">
            <span className={labelCls}>Phone</span>
            <input name="contactPhone" type="tel" defaultValue={d.contactPhone} placeholder="(360) 555-0100" className={input} />
          </label>
        </div>
      </fieldset>

      <Err state={state} />
      <SubmitButton pendingLabel="Sending…">{again ? 'Send again' : 'Send for approval'}</SubmitButton>
    </form>
  );
}
