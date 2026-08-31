import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  createLead,
  getLiveInventory,
  getStorefrontBySlug,
  getVehicleByStock,
  storefrontBasePath,
  type LiveVehicle,
} from '@/lib/queries';
import {
  autoDealerLd,
  breadcrumbLd,
  canonicalOrigin,
  vehicleLd,
  type SeoRooftop,
} from '@/lib/store/seo';
import {
  BODY_LABEL,
  DRIVETRAIN_LABEL,
  FUEL_LABEL,
  TRANSMISSION_LABEL,
  VEHICLE_STATUS_LABEL,
  activePrice,
  miles,
  priceToMarket,
  usd,
  vehicleTitle,
} from '@/lib/domain';
import { Gallery } from '@/components/store/gallery';
import { LeadForm, type LeadState } from '@/components/store/lead-form';
import { PaymentEstimator } from '@/components/store/payment-estimator';
import { VehicleCard, primaryPhoto } from '@/components/store/vehicle-card';

type Params = { params: Promise<{ slug: string; stock: string }> };

/** ARRIVED and IN_RECON units are not retail-ready and have no photo set. */
const PUBLIC_STATUSES = new Set(['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE']);

async function load(slug: string, stock: string) {
  const storefront = await getStorefrontBySlug(slug);
  if (!storefront) return null;
  const vehicle = await getVehicleByStock(stock.toUpperCase(), {
    rooftopIds: storefront.rooftopIds,
  });
  if (!vehicle) return null;
  if (!storefront.rooftopIds.includes(vehicle.rooftopId)) return null;
  if (!PUBLIC_STATUSES.has(vehicle.status)) return null;
  return { storefront, vehicle };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, stock } = await params;
  const data = await load(slug, stock);
  if (!data) return { title: 'Vehicle not found' };
  const { vehicle } = data;
  const title = `${vehicleTitle(vehicle)} — Stock #${vehicle.stockNumber}`;
  const photo = primaryPhoto(vehicle);
  const description =
    vehicle.description ||
    `${vehicleTitle(vehicle)} with ${miles(vehicle.mileage)} at ${usd(activePrice(vehicle))}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: photo
        ? [{ url: photo.url, width: 1200, height: 800, alt: photo.alt || title }]
        : undefined,
    },
  };
}

/* ------------------------------------------------------------------ parts */

function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--line)] py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[var(--text)]">{children}</dd>
    </div>
  );
}

function TrustItem({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--paper)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] ring-1 ring-inset ring-[var(--line)]">
      {children}
    </span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-emerald-600">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function relatedUnits(inventory: LiveVehicle[], v: LiveVehicle): LiveVehicle[] {
  const price = activePrice(v);
  return inventory
    .filter((u) => u.id !== v.id && PUBLIC_STATUSES.has(u.status))
    .sort((a, b) => {
      const bodyRank =
        Number(a.bodyStyle !== v.bodyStyle) - Number(b.bodyStyle !== v.bodyStyle);
      if (bodyRank !== 0) return bodyRank;
      return Math.abs(activePrice(a) - price) - Math.abs(activePrice(b) - price);
    })
    .slice(0, 3);
}

/* ------------------------------------------------------------------- page */

export default async function VehicleDetailPage({ params }: Params) {
  const { slug, stock } = await params;
  const data = await load(slug, stock);
  if (!data) notFound();
  const { storefront, vehicle } = data;

  /*
   * Was hardcoded to `/s/<slug>`, which still resolves on a dealer's own domain
   * (`proxy.ts` leaves an explicit `/s/` path alone) — and that is exactly the
   * problem: it served every vehicle at two URLs on the domain the dealer is
   * trying to rank, with our routing visible in one of them. `storefrontBasePath`
   * is what the SRP already used; the two now agree.
   */
  const host = (await headers()).get('host');
  const basePath = storefrontBasePath(storefront, host);
  const origin = canonicalOrigin(storefront, host);
  const title = vehicleTitle(vehicle);
  const price = activePrice(vehicle);
  const onSale = vehicle.salePrice != null && vehicle.salePrice < vehicle.price;
  const underMarket = vehicle.marketValue > 0 ? vehicle.marketValue - price : 0;
  const ptm = priceToMarket(vehicle);
  const rooftop = vehicle.rooftop;
  const dealerTel = `tel:+1${rooftop.phone.replace(/\D/g, '')}`;

  const inventory = await getLiveInventory({ rooftopIds: storefront.rooftopIds });
  const related = relatedUnits(inventory, vehicle);

  const storefrontId = storefront.id;
  const vehicleId = vehicle.id;
  const rooftopId = vehicle.rooftopId;

  async function submitLead(_prev: LeadState, formData: FormData): Promise<LeadState> {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();
    const message = String(formData.get('message') ?? '').trim();

    if (!name || !email) {
      return { status: 'error', message: 'Name and email are required.' };
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return { status: 'error', message: 'That email address does not look right.' };
    }

    await createLead({ vehicleId, storefrontId, rooftopId, name, email, phone, message });
    return { status: 'ok', firstName: name.split(/\s+/)[0] };
  }

  const mpg =
    vehicle.mpgCity && vehicle.mpgHwy ? `${vehicle.mpgCity} city / ${vehicle.mpgHwy} hwy` : '—';

  /* seed feature lists overlap the option list on some units — do not print twice */
  const optionSet = new Set(vehicle.options.map((o) => o.toLowerCase()));
  const extraFeatures = vehicle.features.filter((f) => !optionSet.has(f.toLowerCase()));

  /*
   * `Vehicle` + `Offer`, with `seller` pointing by `@id` at the same
   * `AutoDealer` node the lot's own page publishes. This is the highest-value
   * structured data on the site: it is what puts price, mileage and availability
   * into a result, and a used-car listing without it competes on the title tag
   * alone.
   *
   * The dealer node is emitted here too rather than only referenced. A crawler
   * that reaches a VDP from a search result may never fetch the home page, and a
   * `seller` that resolves to nothing is a dangling reference.
   */
  const seoRooftop = rooftop as unknown as SeoRooftop;
  const url = `${origin}${basePath}/${vehicle.stockNumber.toLowerCase()}`;
  const dealerNode = autoDealerLd(seoRooftop, {
    origin,
    basePath,
    brandName: storefront.name,
    logoUrl: storefront.logoKey ? `/api/logo/${storefront.logoKey}` : null,
  });
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      vehicleLd(
        { ...vehicle, photos: vehicle.photos, rooftopId: vehicle.rooftopId },
        { origin, url, sellerId: String(dealerNode['@id']), brandName: storefront.name },
      ),
      dealerNode,
      breadcrumbLd([
        { name: storefront.name, url: `${origin}${basePath || '/'}` },
        { name: vehicle.make, url: `${origin}${basePath}?make=${encodeURIComponent(vehicle.make)}` },
        { name: title, url },
      ]),
    ],
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <nav className="text-xs text-[var(--text-3)]">
        <Link href={basePath} className="hover:text-[var(--brand-text)] hover:underline">
          Inventory
        </Link>
        <span className="px-1.5 text-[var(--text-3)]">/</span>
        <Link
          href={`${basePath}?make=${encodeURIComponent(vehicle.make)}`}
          className="hover:text-[var(--brand-text)] hover:underline"
        >
          {vehicle.make}
        </Link>
        <span className="px-1.5 text-[var(--text-3)]">/</span>
        <span className="text-[var(--text-2)]">
          {vehicle.model} · Stock #{vehicle.stockNumber}
        </span>
      </nav>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-[28px]">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h1>
          <p className="mt-0.5 text-base text-[var(--text-2)]">{vehicle.trim || BODY_LABEL[vehicle.bodyStyle]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vehicle.status === 'PENDING_SALE' ? (
            <span className="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-600/30">
              {VEHICLE_STATUS_LABEL.PENDING_SALE} — deposit taken
            </span>
          ) : null}
          {/* See the note in `vehicle-card.tsx`: the photographs outrank the
              workflow state, because the buyer is looking at them. */}
          {vehicle.status === 'PHOTOS_PENDING' && vehicle.photos.length === 0 ? (
            <span className="rounded-md bg-[var(--paper-2)] px-2.5 py-1 text-xs font-semibold text-[var(--text-2)] ring-1 ring-inset ring-[var(--line)]">
              Full photo set goes up today
            </span>
          ) : null}
          {vehicle.isCertified ? (
            <span
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-[var(--on-brand)]"
              style={{ background: 'var(--brand)' }}
            >
              {vehicle.certifiedProgram ?? 'Certified'}
            </span>
          ) : null}
        </div>
      </header>

      {/* the aside stretches across both rows so its inner card can stick */}
      <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
        {/* gallery */}
        <div className="lg:col-start-1 lg:row-start-1">
          <Gallery
            photos={vehicle.photos.map((p) => ({ url: p.url, alt: p.alt, tag: p.tag }))}
            title={title}
          />
        </div>

        {/* sticky buy column */}
        <aside className="mt-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <div className="space-y-4 lg:sticky lg:top-24">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm">
              <div className="flex items-end gap-2.5">
                <span className="tnum text-3xl font-semibold tracking-tight text-[var(--text)]">
                  {usd(price)}
                </span>
                {onSale ? (
                  <span className="tnum pb-1 text-base text-[var(--text-3)] line-through">
                    {usd(vehicle.price)}
                  </span>
                ) : null}
              </div>

              {underMarket > 0 && ptm != null ? (
                <div className="mt-1.5">
                  <div className="tnum text-sm font-semibold text-emerald-700">
                    {usd(underMarket)} below market
                  </div>
                  <div className="tnum text-xs text-[var(--text-3)]">
                    Comparable retail {usd(vehicle.marketValue)} · priced at {ptm}% of market
                  </div>
                </div>
              ) : (
                <div className="tnum mt-1.5 text-xs text-[var(--text-3)]">
                  Stock #{vehicle.stockNumber} · {miles(vehicle.mileage)}
                </div>
              )}

              <div className="mt-3.5">
                <PaymentEstimator price={price} />
              </div>

              <div className="mt-4 border-t border-[var(--line)] pt-4">
                <h2 className="text-sm font-semibold text-[var(--text)]">Check availability</h2>
                <p className="mb-2.5 mt-0.5 text-xs text-[var(--text-3)]">
                  Ask about this unit and a salesperson will confirm it is still on the lot.
                </p>
                <LeadForm
                  action={submitLead}
                  stockNumber={vehicle.stockNumber}
                  dealerPhone={rooftop.phone}
                  defaultMessage={`Is the ${title} (stock #${vehicle.stockNumber}) still available?`}
                />
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm">
              <div className="text-sm font-semibold text-[var(--text)]">{rooftop.name}</div>
              <div className="mt-1 text-sm text-[var(--text-2)]">
                {rooftop.addressLine1}
                <br />
                {rooftop.city}, {rooftop.state} {rooftop.postalCode}
              </div>
              <a
                href={dealerTel}
                className="tnum mt-3 flex w-full items-center justify-center rounded-md border border-[var(--line)] px-3.5 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--paper-2)]"
              >
                Call {rooftop.phone}
              </a>
              {storefront.hoursNote ? (
                <p className="mt-2 text-center text-xs text-[var(--text-3)]">{storefront.hoursNote}</p>
              ) : null}
            </div>
          </div>
        </aside>

        {/* details */}
        <div className="lg:col-start-1 lg:row-start-2">
          <div className="mt-6 flex flex-wrap gap-2">
            {vehicle.carfaxOneOwner ? (
              <TrustItem>
                <Check /> One owner
              </TrustItem>
            ) : null}
            {vehicle.carfaxNoAccidents ? (
              <TrustItem>
                <Check /> No accidents reported
              </TrustItem>
            ) : null}
            {vehicle.titleStatus === 'CLEAN' ? (
              <TrustItem>
                <Check /> Clean title
              </TrustItem>
            ) : null}
            <TrustItem>
              <span className="tnum">{vehicle.keysCount}</span>{' '}
              {vehicle.keysCount === 1 ? 'key' : 'keys'}
            </TrustItem>
            {vehicle.carfaxUrl ? (
              <a
                href={vehicle.carfaxUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--paper)] px-2.5 py-1.5 text-xs font-semibold text-[var(--brand-text)] ring-1 ring-inset ring-[var(--line)] hover:bg-[var(--paper-2)]"
              >
                View the Carfax report
              </a>
            ) : null}
          </div>

          {vehicle.callouts.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {vehicle.callouts.map((c) => (
                <span
                  key={c}
                  className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-[var(--on-accent)]"
                  style={{ background: 'var(--accent)' }}
                >
                  {c}
                </span>
              ))}
            </div>
          ) : null}

          {vehicle.description ? (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-[var(--text)]">From the lot</h2>
              <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-[var(--text-2)]">
                {vehicle.description}
              </p>
            </section>
          ) : null}

          <section className="mt-7">
            <h2 className="text-sm font-semibold text-[var(--text)]">Specifications</h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              <SpecRow label="Mileage">
                <span className="tnum">{miles(vehicle.mileage)}</span>
              </SpecRow>
              <SpecRow label="Drivetrain">{DRIVETRAIN_LABEL[vehicle.drivetrain]}</SpecRow>
              <SpecRow label="Transmission">{TRANSMISSION_LABEL[vehicle.transmission]}</SpecRow>
              <SpecRow label="Engine">
                {vehicle.engine || '—'}
                {vehicle.cylinders ? ` · ${vehicle.cylinders} cyl` : ''}
              </SpecRow>
              <SpecRow label="Fuel">{FUEL_LABEL[vehicle.fuelType]}</SpecRow>
              <SpecRow label="EPA MPG">
                <span className="tnum">{mpg}</span>
              </SpecRow>
              <SpecRow label="Exterior">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full ring-1 ring-inset ring-[var(--line)]"
                    style={{ background: vehicle.exteriorColorHex }}
                  />
                  {vehicle.exteriorColor || '—'}
                </span>
              </SpecRow>
              <SpecRow label="Interior">{vehicle.interiorColor || '—'}</SpecRow>
              <SpecRow label="Body style">
                {BODY_LABEL[vehicle.bodyStyle]}
                <span className="tnum text-[var(--text-3)]"> · {vehicle.doors} door</span>
              </SpecRow>
              <SpecRow label="Stock number">
                <span className="tnum">{vehicle.stockNumber}</span>
              </SpecRow>
              <SpecRow label="VIN">
                <span className="font-mono text-[13px] tracking-tight">{vehicle.vin}</span>
              </SpecRow>
              <SpecRow label="Title">
                {vehicle.titleStatus.charAt(0) + vehicle.titleStatus.slice(1).toLowerCase()}
              </SpecRow>
            </dl>
          </section>

          {vehicle.options.length ? (
            <section className="mt-7">
              <h2 className="text-sm font-semibold text-[var(--text)]">Equipment</h2>
              <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {vehicle.options.map((o) => (
                  <li key={o} className="flex items-start gap-2 text-sm text-[var(--text-2)]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    {o}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {extraFeatures.length ? (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-[var(--text)]">Also included</h2>
              <p className="mt-1.5 text-sm text-[var(--text-2)]">{extraFeatures.join(' · ')}</p>
            </section>
          ) : null}
        </div>
      </div>

      {related.length ? (
        <section className="mt-12 border-t border-[var(--line)] pt-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">
              More from {storefront.name}
            </h2>
            <Link href={basePath} className="text-sm font-semibold text-[var(--brand-text)] hover:underline">
              See all inventory
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((u) => (
              <VehicleCard key={u.id} v={u} basePath={basePath} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
