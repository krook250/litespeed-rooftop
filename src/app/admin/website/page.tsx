/**
 * Website — the dealer's storefront settings: domain, layout, branding.
 *
 * One screen because they are one decision from the dealer's side ("what does my
 * website look like and what's its address"), even though underneath they are
 * three different subsystems.
 */

import { headers } from 'next/headers';
import { sessionScope } from '@/lib/queries';
import { storefrontsInScope } from '@/lib/scoped-db';
import { getGroup, getRooftops } from '@/lib/queries';
import { LAYOUT_LIST } from '@/components/store/layouts';
import { domainsConfigured } from '@/lib/domains/vercel';
import { lookupDomain } from '@/lib/domains/lookup';
import { buildInstructions } from '@/lib/domains/instructions';
import {
  BringYourOwnPanel,
  BuyDomainPanel,
  DesignPanel,
  DomainStatusPanel,
  InstructionsView,
} from '@/components/website-panels';
import { EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function WebsitePage() {
  const scope = await sessionScope();
  const storefronts = await storefrontsInScope(scope);
  const sf = storefronts[0];

  if (!sf) {
    return <EmptyState title="No storefront yet" body="Add a rooftop and we'll create your website." />;
  }

  const [group, rooftops, host] = await Promise.all([
    getGroup(),
    getRooftops(),
    headers().then((h) => h.get('host')),
  ]);
  const rooftop = rooftops[0];
  const configured = domainsConfigured();

  /*
   * If a domain is attached but not live, re-derive the instructions server-side
   * so the dealer sees the current state of *their* DNS on arrival, rather than
   * whatever we cached when they first entered it. This is the screen they come
   * back to precisely because something has not happened yet.
   */
  const live = sf.domainStatus === 'LIVE';
  const instructions =
    sf.domain && !live ? buildInstructions(await lookupDomain(sf.domain), sf.domainVerification) : null;

  const previewUrl = live && sf.domain ? `https://${sf.domain}` : `/s/${sf.slug}`;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Website</h1>
          <p className="mt-0.5 text-sm text-ink-600">
            {sf.name} — how your storefront looks and where customers find it.
          </p>
        </div>
        <a href={previewUrl} target="_blank" rel="noreferrer"
           className="rounded-md border border-ink-300 px-3 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50">
          View site →
        </a>
      </header>

      {/* ------------------------------------------------ domain */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Your address</h2>

        {!configured ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Custom domains aren&apos;t switched on yet — <code>VERCEL_API_TOKEN</code> and{' '}
            <code>VERCEL_PROJECT_ID</code> need setting in the environment. Everything else on this page works.
          </p>
        ) : null}

        {sf.domain ? (
          <div className="mt-3 space-y-4">
            <DomainStatusPanel
              storefrontId={sf.id}
              domain={sf.domain}
              status={sf.domainStatus}
              error={sf.domainError}
              checkedAt={sf.domainCheckedAt ? new Date(sf.domainCheckedAt).toLocaleString('en-US') : null}
            />
            {instructions ? (
              <div className="rounded-xl border border-ink-200 bg-white p-5">
                <InstructionsView result={instructions} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-ink-900">I already own a domain</h3>
              <p className="mt-0.5 mb-3 text-xs text-ink-500">
                Keep it where it is. You&apos;ll add two records — we never touch your email.
              </p>
              <BringYourOwnPanel storefrontId={sf.id} />
            </div>
            <div className="rounded-xl border border-ink-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-ink-900">I need a domain</h3>
              <p className="mt-0.5 mb-3 text-xs text-ink-500">
                We register it and point it at your storefront. Nothing for you to configure.
              </p>
              {configured ? (
                <BuyDomainPanel
                  storefrontId={sf.id}
                  dealerDefaults={{
                    companyName: group?.name ?? '',
                    email: rooftop?.email ?? '',
                    phone: rooftop?.phone ?? sf.phone,
                    address1: rooftop?.addressLine1 ?? '',
                    city: rooftop?.city ?? '',
                    state: rooftop?.state ?? '',
                    postalCode: rooftop?.postalCode ?? '',
                    country: 'US',
                  }}
                />
              ) : (
                <p className="text-sm text-ink-500">Available once domain support is switched on.</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ design */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Design</h2>
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <DesignPanel
            storefrontId={sf.id}
            layout={sf.layout}
            brandColor={sf.brandColor}
            accentColor={sf.accentColor}
            logoUrl={sf.logoKey ? `/api/logo/${sf.logoKey}` : null}
            layouts={LAYOUT_LIST}
          />
        </div>
      </section>

      <p className="text-xs text-ink-400">Signed in on {host}.</p>
    </div>
  );
}
