/**
 * Your lots — the address and coordinates every channel needs.
 *
 * This screen exists because `feed-spec.ts` has been telling dealers to "set the
 * lot's latitude and longitude in Settings" since 4 Aug and there was no
 * Settings. A dealer who signed up got a rooftop with an empty address, no
 * coordinates, and no way to fix either without someone editing Postgres.
 *
 * ON ASKING A DEALER FOR COORDINATES. It is a strange thing to put on a form and
 * the honest alternative is worse: geocoding needs a paid key or a service whose
 * terms we would have to honour, and a wrong pin silently mis-targets every ad
 * the lot runs. So the field is manual, with the one instruction that actually
 * works — right-click the lot in Google Maps and the coordinates are the first
 * item in the menu. Revisit when there is a geocoder worth depending on.
 */

import { Card, CardHeader, Badge, Button } from '@/components/ui';
import { getRooftops } from '@/lib/queries';
import { saveRooftopDetails } from '@/lib/rooftop-actions';
import { HoursCard } from '@/components/website/hours-card';
import { MapPinField } from '@/components/website/map-pin-field';
import { requireSection } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

function Field({
  label,
  name,
  defaultValue,
  hint,
  className,
  ...rest
}: {
  label: string;
  name: string;
  defaultValue?: string;
  hint?: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium text-ink-600">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm"
        {...rest}
      />
      {hint ? <span className="mt-1 block text-[11px] text-ink-500">{hint}</span> : null}
    </label>
  );
}

export default async function LotsPage() {
  await requireSection('lots');
  const rooftops = await getRooftops();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold text-ink-900">Your lots</h1>
      <p className="mb-6 text-sm text-ink-500">
        This address goes out on every listing you syndicate. CarGurus will not accept a
        feed without it, and Facebook needs the map pin on every vehicle.
      </p>

      {rooftops.map((lot) => {
        const missing = [
          !lot.addressLine1 && 'street',
          !lot.city && 'city',
          !lot.state && 'state',
          !lot.postalCode && 'ZIP',
          !lot.phone && 'phone',
          lot.latitude == null && 'map pin',
        ].filter(Boolean) as string[];

        /* Hours are not a syndication requirement, so they are not in `missing`
           above — a lot without them still feeds every channel. They are a
           website and local-search requirement, which is a different badge. */

        return (
          <Card key={lot.id} className="mb-5">
            <CardHeader
              title={lot.name}
              subtitle={lot.slug}
              action={
                missing.length ? (
                  <Badge tone="amber">Needs {missing.join(', ')}</Badge>
                ) : (
                  <Badge tone="green">Ready to syndicate</Badge>
                )
              }
            />
            <form action={saveRooftopDetails} className="px-5 py-4">
              <input type="hidden" name="rooftopId" value={lot.id} />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Lot name" name="name" defaultValue={lot.name} className="sm:col-span-2" required maxLength={120} />
                <Field label="Street address" name="addressLine1" defaultValue={lot.addressLine1} className="sm:col-span-2" maxLength={200} />
                <Field label="City" name="city" defaultValue={lot.city} maxLength={100} />
                <Field label="State" name="state" defaultValue={lot.state} maxLength={40} />
                <Field label="ZIP" name="postalCode" defaultValue={lot.postalCode} maxLength={20} />
                <Field label="Phone" name="phone" defaultValue={lot.phone} maxLength={40} />
                <Field label="Email for leads" name="email" type="email" defaultValue={lot.email} className="sm:col-span-2" maxLength={200} />
              </div>

              <div className="mt-4 border-t border-ink-100 pt-4">
                <p className="mb-2 text-xs text-ink-600">
                  <b>Map pin.</b> Facebook needs your exact coordinates on every vehicle — a
                  street address on its own is not enough, and without these your cars will
                  not run on Marketplace. Open Google Maps, right-click your lot, and the
                  first item in the menu is the pair of numbers. Click it to copy, then paste
                  it straight into the box below.
                </p>
                <MapPinField latitude={lot.latitude} longitude={lot.longitude} />
              </div>

              <div className="mt-4 flex justify-end">
                <Button type="submit">Save lot</Button>
              </div>
            </form>

            {/*
              Its own form, not part of the one above. Hours are seven rows of
              state that a dealer edits in one sitting; folding them into the
              address form would mean a typo in a ZIP loses the week's work, and
              a saved week is useful on its own.
            */}
            <div className="border-t border-ink-100 px-5 py-4">
              <HoursCard
                rooftopId={lot.id}
                rooftopName="Opening hours"
                timezone={lot.timezone}
                hours={lot.hours}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
