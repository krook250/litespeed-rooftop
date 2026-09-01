import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getChannels,
  getOverrides,
  sessionScope,
  getStorefrontBySlug,
  getStorefronts,
  getVehicleByStock,
} from '@/lib/queries';
import {
  BODY_LABEL,
  DRIVETRAIN_LABEL,
  FUEL_LABEL,
  TRANSMISSION_LABEL,
  activePrice,
  miles,
  usd,
  vehicleTitle,
} from '@/lib/domain';

type Params = { params: Promise<{ channel: string; stock: string }> };

/** Which storefront (if any) publishes this rooftop — used for the "real VDP" link. */
async function storefrontForRooftop(rooftopId: string) {
  for (const s of await getStorefronts()) {
    const full = await getStorefrontBySlug(s.slug);
    if (full?.rooftopIds.includes(rooftopId)) return full;
  }
  return null;
}

export default async function MockListingPage({ params }: Params) {
  const { channel: channelKey, stock } = await params;

  const channel = (await getChannels()).find((c) => c.key === channelKey);
  if (!channel) notFound();

  const vehicle = await getVehicleByStock(stock.toUpperCase());
  if (!vehicle) notFound();

  const override =
    (await getOverrides(await sessionScope(), vehicle.id)).find((o) => o.channelId === channel.id) ??
    null;
  const title = override?.titleOverride || vehicleTitle(vehicle);
  const description = override?.descriptionOverride || vehicle.description;
  const price = override?.priceOverride ?? activePrice(vehicle);
  const photo = vehicle.photos.find((p) => p.isPrimary) ?? vehicle.photos[0] ?? null;
  const shownPhotos = Math.min(vehicle.photos.length, channel.maxPhotos);
  const storefront = await storefrontForRooftop(vehicle.rooftopId);

  return (
    <div className="min-h-screen bg-ink-100">
      <div className="border-b-2 border-dashed border-ink-400 bg-ink-950 px-4 py-2.5 text-center text-xs text-ink-200 sm:text-sm">
        Simulated listing. Rooftop Auto rendered this page from your own inventory record to show
        how stock #{vehicle.stockNumber} would appear on {channel.name}. It is not {channel.name} and
        nothing here was scraped from them.
        {storefront ? (
          <>
            {' '}
            <Link
              href={`/s/${storefront.slug}/${vehicle.stockNumber}`}
              className="font-semibold text-white underline"
            >
              Open the real VDP
            </Link>
          </>
        ) : null}
      </div>

      <header style={{ background: channel.brandHex }} className="px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/15 text-sm font-black text-white ring-1 ring-inset ring-white/25">
            {channel.initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-white">{channel.name}</div>
            <div className="truncate text-xs text-white/75">
              {channel.syncMode === 'PUSH_API'
                ? 'Push API listing'
                : `Feed pull every ${Math.round(channel.cadenceMinutes / 60)} hr`}{' '}
              · up to {channel.maxPhotos} photos
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {override?.excluded ? (
          <p className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/30">
            This unit is set to be excluded from {channel.shortName}. Shown here for preview only.
          </p>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-ink-300 bg-white shadow-sm">
          {photo ? (
            <img
              src={photo.url}
              alt={photo.alt || title}
              width={1200}
              height={800}
              className="aspect-[3/2] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[3/2] w-full items-center justify-center bg-ink-100 text-sm text-ink-500">
              No photos on this listing yet
            </div>
          )}

          <div className="p-5">
            <h1 className="text-xl font-semibold leading-snug text-ink-900">{title}</h1>

            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="tnum text-2xl font-semibold" style={{ color: channel.brandHex }}>
                {usd(price)}
              </span>
              <span className="tnum text-sm text-ink-600">{miles(vehicle.mileage)}</span>
              <span className="text-sm text-ink-600">
                {DRIVETRAIN_LABEL[vehicle.drivetrain]} · {BODY_LABEL[vehicle.bodyStyle]}
              </span>
            </div>

            {description ? (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-700">
                {description}
              </p>
            ) : (
              <p className="mt-4 text-sm italic text-ink-500">
                No description on this listing. {channel.shortName} would show the title only.
              </p>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-ink-200 pt-4 text-sm sm:grid-cols-3">
              {[
                ['Stock', vehicle.stockNumber],
                ['VIN', vehicle.vin],
                ['Transmission', vehicle.transmission ? TRANSMISSION_LABEL[vehicle.transmission] ?? '' : '—'],
                ['Fuel', FUEL_LABEL[vehicle.fuelType] ?? ''],
                ['Exterior', vehicle.exteriorColor],
                ['Photos', `${shownPhotos} of ${vehicle.photos.length}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                    {label}
                  </dt>
                  <dd className="tnum text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 border-t border-ink-200 pt-4 text-sm text-ink-700">
              <div className="font-semibold text-ink-900">{vehicle.rooftop.name}</div>
              <div>
                {vehicle.rooftop.city}, {vehicle.rooftop.state} · {vehicle.rooftop.phone}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-ink-500">
          Title, description and price on this page come from the {channel.shortName} override on
          stock #{vehicle.stockNumber} when one is set, and from the vehicle record when one is not.
          {override?.titleOverride || override?.descriptionOverride || override?.priceOverride
            ? ' This unit has an override.'
            : ' This unit has no override — you are seeing the default record.'}
        </p>
      </main>
    </div>
  );
}
