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
  CutoverPanel,
  DomainStatusPanel,
  InstructionsView,
  InterimAddress,
} from '@/components/website-panels';
import { AboutCard } from '@/components/website/about-card';
import { FinancingCard } from '@/components/website/financing-card';
import { HoursCard } from '@/components/website/hours-card';
import { parseFacts } from '@/lib/store/about';
import { DesignCard } from '@/components/website/design-card';
import { isDefaultPalette } from '@/lib/branding/palette';
import { buildReadiness } from '@/lib/domains/readiness';
import { publicUnitCount } from '@/lib/domains/units';
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
  /*
   * Three phases, not two, and the middle one is the point of this screen.
   *
   *   none      nothing recorded — offer both paths
   *   reserved  we hold the domain and have deliberately not touched their DNS
   *   pointing  records are changing or changed; Vercel is the source of truth
   *
   * `domain` alone never meant "connected". A row can carry a domain string that
   * was never set up — seeded rows do, and so would anything written straight into
   * the database — which is what produced a status panel and a Disconnect button
   * for a connection that did not exist. `RESERVED` now models that state
   * honestly instead of inferring it from `NONE`, and legacy `domain + NONE` rows
   * are read as reserved so nothing is stranded.
   */
  const phase: 'none' | 'reserved' | 'pointing' = !sf.domain
    ? 'none'
    : sf.domainStatus === 'NONE' || sf.domainStatus === 'RESERVED'
      ? 'reserved'
      : 'pointing';

  const live = sf.domainStatus === 'LIVE';

  /*
   * Re-derive instructions server-side whenever the domain is not yet live, so a
   * dealer coming back sees the current state of *their* DNS rather than whatever
   * we cached when they first typed it in. This is the screen they return to
   * precisely because something has not happened yet.
   */
  const lookup = phase !== 'none' && !live ? await lookupDomain(sf.domain!) : null;
  const instructions = lookup ? buildInstructions(lookup, sf.domainVerification) : null;

  /*
   * The address the dealer can use today. Absolute rather than relative, because
   * the entire point is that they can copy it into a text message.
   */
  const interimUrl = `https://${host ?? 'app.rooftopauto.com'}/s/${sf.slug}`;
  const previewUrl = live && sf.domain ? `https://${sf.domain}` : `/s/${sf.slug}`;

  const readiness =
    phase === 'reserved'
      ? buildReadiness({
          logoKey: sf.logoKey,
          brandColor: sf.brandColor,
          accentColor: sf.accentColor,
          publicUnitCount: await publicUnitCount(sf.id),
          caaBlocks: lookup?.ok ? lookup.caa.blocksLetsEncrypt : false,
          mx: lookup?.ok ? lookup.mx.map((m) => m.exchange) : [],
          /*
           * Read off the instructions rather than off `lookup.registered`.
           *
           * These two are rendered one above the other, so any disagreement is
           * visible on screen — and the first version disagreed immediately: the
           * checklist applied an "RDAP unavailable means unknown, not missing"
           * fallback that `buildInstructions` does not, producing a green "the
           * domain exists" directly above a panel headed "isn't registered yet".
           *
           * Deriving both from the same decision makes that class of bug
           * impossible rather than fixed. If the registration rule needs to
           * change, it changes in `instructions.ts` and both follow.
           */
          domainRegistered: instructions?.ok ? instructions.state !== 'not-registered' : true,
        })
      : null;

  const daysSaved = sf.domainReservedAt
    ? Math.max(0, Math.round((Date.now() - new Date(sf.domainReservedAt).getTime()) / 86_400_000))
    : null;

  /*
   * Has this dealer ever actually been through the design step?
   *
   * A logo is the honest tell — colors always hold *some* value, because the
   * column has a default, so "not the default" is the only signal there and a
   * dealer who genuinely wants Rooftop blue would be walked through setup for
   * ever. With no logo and untouched colors, nothing on this storefront was
   * chosen, so we run the guided version. Once either is set, they get the
   * everything-at-once editor, which is what someone changing one color wants.
   */
  const designConfigured = Boolean(sf.logoKey) || !isDefaultPalette(sf.brandColor, sf.accentColor);

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

      {/* ------------------------------------------------ design */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Design</h2>
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <DesignCard
            storefrontId={sf.id}
            dealerName={sf.name}
            layout={sf.layout}
            theme={sf.theme}
            brandColor={sf.brandColor}
            accentColor={sf.accentColor}
            logoUrl={sf.logoKey ? `/api/logo/${sf.logoKey}` : null}
            layouts={LAYOUT_LIST}
            configured={designConfigured}
          />
        </div>
      </section>

      <p className="text-xs text-ink-400">Signed in on {host}.</p>
    </div>
  );
}
