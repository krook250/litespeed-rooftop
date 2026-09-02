import { requireSection } from '@/lib/auth-guard';
import { EmptyState } from '@/components/ui';
import {
  BringYourOwnPanel,
  BuyDomainPanel,
  CutoverPanel,
  DomainStatusPanel,
  InstructionsView,
  InterimAddress,
} from '@/components/website-panels';
import { AboutCard } from '@/components/website/about-card';
import { FinancingCard } from '@/components/website/financing-card';
import { HoursCard } from '@/components/website/hours-card';
import { parseFacts } from '@/lib/store/about';
import { loadWebsite, WebsiteHeader } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * Website / Content — what the site says and where it lives.
 *
 * The address panel is here rather than on a page of its own because a dealer
 * does not experience "my domain" and "my hours" as different subsystems; they
 * experience both as "the stuff I have to fill in". Design is separate because
 * that one is a mood, not a form.
 */
export default async function WebsiteContentPage() {
  await requireSection('website');
  const data = await loadWebsite({ withDomain: true });
  if (!data) {
    return <EmptyState title="No storefront yet" body="Add a rooftop and we'll create your website." />;
  }
  const {
    sf, group, rooftops, rooftop, host, live, interimUrl, previewUrl,
    configured, phase, instructions, readiness, daysSaved,
  } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <WebsiteHeader
        name="Content"
        subtitle={`${sf.name} — your address, your story, your hours.`}
        previewUrl={previewUrl}
      />

      {/* ------------------------------------------------ domain */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Your address</h2>

        {!configured ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Custom domains aren&apos;t switched on yet — <code>VERCEL_API_TOKEN</code> and{' '}
            <code>VERCEL_PROJECT_ID</code> need setting in the environment. Everything else on this page works.
          </p>
        ) : null}

        {/*
          Shown in every phase except live-on-their-own-domain, and shown *first*.
          A dealer arriving here for the first time should learn that they already
          have a working website before they are asked anything about DNS.
        */}
        {!live ? (
          <div className="mt-3">
            <InterimAddress url={interimUrl} live={false} />
          </div>
        ) : null}

        {phase === 'pointing' ? (
          <div className="mt-3 space-y-4">
            <DomainStatusPanel
              storefrontId={sf.id}
              domain={sf.domain!}
              status={sf.domainStatus}
              error={sf.domainError}
              checkedAt={sf.domainCheckedAt ? new Date(sf.domainCheckedAt).toLocaleString('en-US') : null}
            />
            {instructions ? (
              <div className="rounded-xl border border-ink-200 bg-white p-5">
                <InstructionsView result={instructions} />
              </div>
            ) : null}
            {live ? <InterimAddress url={interimUrl} live /> : null}
          </div>
        ) : phase === 'reserved' && readiness ? (
          <div className="mt-3">
            <CutoverPanel
              storefrontId={sf.id}
              domain={sf.domain!}
              instructions={instructions}
              readiness={readiness}
              priorDns={sf.domainPriorDns ?? null}
              daysSaved={daysSaved}
            />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-ink-900">I already own a domain</h3>
              <p className="mt-0.5 mb-3 text-xs text-ink-500">
                Save it now, switch it over when your site is ready. We never touch your email.
              </p>
              <BringYourOwnPanel storefrontId={sf.id} initialDomain="" />
            </div>
            <div className="rounded-xl border border-ink-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-ink-900">I need a domain</h3>
              <p className="mt-0.5 mb-3 text-xs text-ink-500">
                On us — it&apos;s in your subscription. We register it and point it at your storefront
                the same minute. Nothing for you to configure.
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
                    zip: rooftop?.postalCode ?? '',
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
      {/* -------------------------------------------------- about */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">About</h2>
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <AboutCard
            storefrontId={sf.id}
            dealerName={sf.name}
            city={rooftop?.city ?? ''}
            about={sf.about}
            facts={parseFacts(sf.aboutFacts)}
          />
        </div>
      </section>

      {/* ---------------------------------------------- financing */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Financing</h2>
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <FinancingCard
            storefrontId={sf.id}
            storefrontPath={`/s/${sf.slug}`}
            creditAppUrl={sf.creditAppUrl}
          />
        </div>
      </section>

      {/* -------------------------------------------------- hours */}
      {rooftops.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Hours</h2>
          <p className="mb-3 text-sm text-ink-600">
            Shown on your website, used for the &ldquo;open now&rdquo; line, and sent to Google as
            structured data so your hours can appear beside your listing in search.
            {rooftops.length > 1 ? ' Each lot keeps its own.' : ''}
          </p>
          <div className="space-y-4">
            {rooftops.map((lot) => (
              <div key={lot.id} className="rounded-xl border border-ink-200 bg-white p-5">
                <HoursCard
                  rooftopId={lot.id}
                  rooftopName={lot.name}
                  timezone={lot.timezone}
                  hours={lot.hours}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <p className="text-xs text-ink-400">Signed in on {host}.</p>
    </div>
  );
}
