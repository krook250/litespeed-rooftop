'use client';

import { useActionState } from 'react';

export type LeadState = {
  status: 'idle' | 'ok' | 'error';
  message?: string;
  firstName?: string;
};

export type LeadAction = (prev: LeadState, formData: FormData) => Promise<LeadState>;

const INITIAL: LeadState = { status: 'idle' };

const inputClass =
  'w-full rounded-md border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900 placeholder:text-ink-400 ' +
  'focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20';

export function LeadForm({
  action,
  stockNumber,
  dealerPhone,
  defaultMessage,
}: {
  action: LeadAction;
  stockNumber: string;
  dealerPhone: string;
  defaultMessage: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (state.status === 'ok') {
    return (
      <div className="rounded-lg border border-emerald-600/30 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Got it{state.firstName ? `, ${state.firstName}` : ''} — we have your request on stock #
          {stockNumber}.
        </p>
        <p className="mt-1 text-sm text-emerald-900/80">
          A salesperson will confirm availability and get back to you. Need an answer right now?
          Call{' '}
          <a href={`tel:+1${dealerPhone.replace(/\D/g, '')}`} className="font-semibold underline">
            {dealerPhone}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <input
          name="name"
          required
          autoComplete="name"
          placeholder="Your name"
          aria-label="Your name"
          className={inputClass}
        />
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="Phone"
          aria-label="Phone"
          className={inputClass}
        />
      </div>
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="Email"
        aria-label="Email"
        className={inputClass}
      />
      <textarea
        name="message"
        rows={3}
        defaultValue={defaultMessage}
        aria-label="Message"
        className={inputClass}
      />

      {state.status === 'error' ? (
        <p className="text-xs font-medium text-red-700">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[var(--brand)] px-3.5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Check availability'}
      </button>
      <p className="text-[11px] leading-snug text-ink-500">
        We will only use this to answer your question on stock #{stockNumber}. No spam, no list.
      </p>
    </form>
  );
}
