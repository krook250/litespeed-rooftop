'use client';

/**
 * Pointing the Loan Application page at the dealer's own credit application.
 *
 * ONE FIELD, AND IT TAKES A LINK — not the block of `<script>` their provider
 * emailed them. The copy says so, because a dealer who pastes a snippet and gets
 * a red error with no explanation concludes the feature is broken. Accepting
 * that snippet would be arbitrary JavaScript on a page we serve, which on the
 * shared host is every other dealer's admin origin.
 *
 * The live "we recognise this" line matters more here than elsewhere on the
 * screen: the dealer is pasting a URL with their own account id buried in it,
 * and the failure mode of a wrong one is applications submitting to another
 * dealership. Naming the provider back to them is the cheapest possible check.
 */

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui';
import { saveCreditApp } from '@/lib/store/actions';
import { CREDIT_APP_MESSAGES, CREDIT_APP_PROVIDERS, parseCreditAppUrl } from '@/lib/store/credit-app';

export function FinancingCard({
  storefrontId,
  storefrontPath,
  creditAppUrl,
}: {
  storefrontId: string;
  /** Where the page will live, so the dealer can go and look at it. */
  storefrontPath: string;
  creditAppUrl: string | null;
}) {
  const [value, setValue] = useState(creditAppUrl ?? '');
  const [state, save, saving] = useActionState(saveCreditApp, null);

  const trimmed = value.trim();
  const parsed = trimmed ? parseCreditAppUrl(trimmed) : null;
  const live = Boolean(creditAppUrl) && trimmed === (creditAppUrl ?? '');

  return (
    <form action={save} className="space-y-4">
      <input type="hidden" name="storefrontId" value={storefrontId} />

      <div>
        <h3 className="text-base font-semibold text-ink-900">Loan application</h3>
        <p className="mt-0.5 text-sm text-ink-600">
          If you already take credit applications online, paste the link here and we&apos;ll give it
          a page on your website with your branding around it. Buyers fill it in on your site and it
          goes straight to you — we never see what they type.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-800">
          Link to your credit application
        </span>
        <span className="mb-2 block text-xs text-ink-500">
          The <b>web address</b> of your application, not the block of code your provider sent. In
          DealerCenter it is under Websites &rarr; Secure Forms; most providers call it the
          &ldquo;shareable link&rdquo;.
        </span>
        <input
          name="creditAppUrl"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://dwssecuredforms.dealercenter.net/CreditApplication/index/…"
          className={`w-full rounded-md border px-2.5 py-2 font-mono text-xs ${
            trimmed && parsed && !parsed.ok ? 'border-red-400 bg-red-50' : 'border-ink-300'
          }`}
        />
      </label>

      {parsed?.ok ? (
        <p className="text-xs text-emerald-700">
          Recognised — <b>{parsed.app.provider}</b> ({parsed.app.host}). Check that this is your
          dealership&apos;s own link: the account number is inside it, and the wrong one sends
          applications to another store.
        </p>
      ) : parsed && !parsed.ok ? (
        <p className="text-xs text-red-700">{CREDIT_APP_MESSAGES[parsed.error]}</p>
      ) : (
        <p className="text-xs text-ink-500">
          We currently embed applications from{' '}
          {[...new Set(CREDIT_APP_PROVIDERS.map((p) => p.name))].slice(0, 6).join(', ')} and others.
          Using someone else? Tell us and we&apos;ll add them.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : creditAppUrl ? 'Update' : 'Add the page'}
        </Button>
        {live ? (
          <a
            href={`${storefrontPath}/loan-application`}
            target="_blank"
            rel="noopener"
            className="text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
          >
            View the page ↗
          </a>
        ) : null}
        {creditAppUrl && trimmed ? (
          <button
            type="button"
            onClick={() => setValue('')}
            className="text-sm text-ink-500 hover:text-ink-800"
          >
            Remove the page
          </button>
        ) : null}
        {state?.ok ? <span className="text-sm text-emerald-700">{state.message}</span> : null}
        {state && !state.ok ? <span className="text-sm text-red-700">{state.error}</span> : null}
      </div>

      <p className="text-xs text-ink-400">
        Applications go to your provider, not to Rooftop. We do not store, log or analyse anything
        typed into that form — it asks for a social security number, and the only safe amount of it
        for us to hold is none.
      </p>
    </form>
  );
}
