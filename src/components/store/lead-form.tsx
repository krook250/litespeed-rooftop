'use client';

import { useActionState } from 'react';
import { smsConsentLabel } from '@/lib/store/sms-consent';

export type LeadState = {
  status: 'idle' | 'ok' | 'error';
  message?: string;
  firstName?: string;
};

export type LeadAction = (prev: LeadState, formData: FormData) => Promise<LeadState>;

const INITIAL: LeadState = { status: 'idle' };

const inputClass =
  'w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2.5 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] ' +
  'focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20';

export function LeadForm({
  action,
  stockNumber,
  dealerPhone,
  dealerName,
  privacyHref,
  defaultMessage,
}: {
  action: LeadAction;
  stockNumber: string;
  dealerPhone: string;
  /** Named in the consent line — on the dealer's domain this is their consent, not ours. */
  dealerName: string;
  /** The storefront's own privacy policy. Must be a real, ungated link. */
  privacyHref: string;
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

      {/*
        THE OPT-IN AREA. Carrier review for A2P 10DLC reads this block, not the
        privacy policy and not the footer. Four things have to be true here and
        each of them is a documented rejection cause:

          - the checkbox is UNCHECKED by default and never `required`. Consent
            bundled into "submit this form" is not consent, and phone is optional
            on this form anyway.
          - the literal word "may" appears in both the frequency and the rates
            sentence. See `@/lib/store/sms-consent`.
          - the privacy link is here, in the opt-in area, and goes straight to
            the policy with nothing in between.
          - "Consent is not a condition of purchase" is stated.

        Do not move this below the button, do not collapse it behind a "details"
        toggle, and do not shorten the label to make the card tidier.
      */}
      <label className="flex cursor-pointer items-start gap-2 pt-0.5">
        <input
          type="checkbox"
          name="smsConsent"
          value="yes"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--line)] accent-[var(--brand)]"
        />
        <span className="text-[11px] leading-snug text-[var(--text-3)]">
          {smsConsentLabel(dealerName)}{' '}
          <a
            href={privacyHref}
            className="underline hover:text-[var(--text-2)]"
            target="_blank"
            rel="noopener"
          >
            Privacy Policy
          </a>
          .
        </span>
      </label>

      {state.status === 'error' ? (
        <p className="text-xs font-medium text-red-700">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[var(--brand)] px-3.5 py-2.5 text-sm font-semibold text-[var(--on-brand)] transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Check availability'}
      </button>
      <p className="text-[11px] leading-snug text-[var(--text-3)]">
        We will only use this to answer your question on stock #{stockNumber}. No spam, no list.
      </p>
    </form>
  );
}
