/**
 * `npm run db:real-photos` — put real photographs on the demo lots.
 *
 * WHY THIS EXISTS. Every demo vehicle ships with `generatedPhotoUrl()` tiles:
 * SVG paint swatches served from `/api/photo?…`. They look fine in the admin and
 * on a storefront, and they are worthless everywhere it counts. Meta rejected all
 * seven Battle Ground units on 6 Aug 2026 — "URL Incorrectly Formatted", item
 * not uploaded, every row — because the URL was root-relative, and `image/svg+xml`
 * is not a catalog image format either. A demo whose cars cannot reach Marketplace
 * is not demonstrating the product.
 *
 * WHAT IT DOES. Re-badges each demo vehicle onto one of the 29 hand-culled
 * Wikimedia groups and points its photos at `public/demo/veh/<group>/<n>.jpg`,
 * which ship in the repo and deploy with a push. No uploading, no Blob, no
 * per-vehicle clicking.
 *
 * WHY RE-BADGE RATHER THAN MATCH. Photo coverage cannot support an arbitrary
 * lot: there is a Honda Accord with four frames and no 4Runner, Escape,
 * Pacifica, Odyssey or Corolla at all. Same conclusion `claude/demo-photography.md`
 * reached for Cascade — build the lot *from* the photos. A lot that stocks four
 * Silverados and three Outbacks reads as an independent PNW truck lot; a lot with
 * one of everything and five cars showing paint swatches reads as a mock-up.
 *
 * Best coverage first, so the units most likely to be on camera get the most
 * frames. Meta needs one image to list and two to reach Marketplace, so a
 * four-frame group is worth more than four one-frame groups.
 *
 * COLOR AND YEAR ARE READ OFF THE PHOTO, not invented. The spec sheet
 * contradicting the gallery is the single fastest way to make a demo look fake,
 * and the VIN is regenerated because it encodes the make.
 *
 * IDEMPOTENT: re-running reassigns the same groups in the same order and
 * replaces the photo rows. Safe to run after a reseed.
 *
 * ATTRIBUTION: CC BY and CC BY-SA require visible credit wherever published.
 * `site/demo/credits.html` covers the marketing site. If these appear on
 * app.rooftopauto.com storefronts, the credit has to appear there too — see
 * `claude/demo-photography.md`.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import { buildVin } from '../lib/vin';

type BodyStyle = (typeof t.bodyStyleEnum.enumValues)[number];
type PhotoTag = (typeof t.photoTagEnum.enumValues)[number];

type Group = {
  id: string;
  make: string;
  model: string;
  body: BodyStyle;
  yr: [number, number];
  color: [string, string];
  /** [file number, photo tag] — file is `public/demo/veh/<id>/<n>.jpg`. */
  shots: [number, PhotoTag][];
};

/**
 * Mirrors `mock/photos/curated.json`, ordered by shot count descending.
 *
 * Inlined rather than read from `mock/` so the script has no dependency on the
 * marketing-demo tree, which is deployed separately and could be moved.
 */
const GROUPS: Group[] = [
  { id: 'acc-a', make: 'Honda', model: 'Accord', body: 'SEDAN', yr: [2018, 2021], color: ['Radiant Red', '#8d1c22'], shots: [[1, 'EXTERIOR_FRONT'], [2, 'EXTERIOR_FRONT'], [3, 'EXTERIOR_REAR'], [4, 'EXTERIOR_SIDE']] },
  { id: 'cro-a', make: 'Subaru', model: 'Crosstrek', body: 'SUV', yr: [2018, 2021], color: ['Ice Silver', '#b7bcc0'], shots: [[1, 'EXTERIOR_FRONT'], [2, 'EXTERIOR_SIDE'], [3, 'EXTERIOR_REAR']] },
  { id: 'ram-d', make: 'Ram', model: '1500', body: 'TRUCK', yr: [2019, 2022], color: ['Bright White', '#eceef0'], shots: [[1, 'EXTERIOR_FRONT'], [2, 'EXTERIOR_SIDE']] },
  { id: 'sil-c', make: 'Chevrolet', model: 'Silverado 1500', body: 'TRUCK', yr: [2016, 2018], color: ['Black', '#141619'], shots: [[1, 'EXTERIOR_FRONT'], [2, 'EXTERIOR_SIDE']] },
  { id: 'out-a', make: 'Subaru', model: 'Outback', body: 'WAGON', yr: [2017, 2019], color: ['Crystal White', '#eef0f1'], shots: [[1, 'EXTERIOR_FRONT'], [2, 'EXTERIOR_SIDE']] },
  { id: 'for-a', make: 'Subaru', model: 'Forester', body: 'SUV', yr: [2017, 2018], color: ['Jasper Green', '#4a5a4a'], shots: [[1, 'EXTERIOR_FRONT'], [2, 'EXTERIOR_SIDE']] },
  { id: 'ram-a', make: 'Ram', model: '1500', body: 'TRUCK', yr: [2019, 2022], color: ['Patriot Blue', '#1f2c44'], shots: [[1, 'EXTERIOR_REAR']] },
  { id: 'ram-b', make: 'Ram', model: '1500', body: 'TRUCK', yr: [2019, 2022], color: ['Billet Silver', '#9fa4a8'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'ram-c', make: 'Ram', model: '1500', body: 'TRUCK', yr: [2019, 2022], color: ['Delmonico Red', '#6d1620'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'sil-a', make: 'Chevrolet', model: 'Silverado 1500', body: 'TRUCK', yr: [2016, 2018], color: ['Summit White', '#f0f1f2'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'sil-b', make: 'Chevrolet', model: 'Silverado 1500', body: 'TRUCK', yr: [2016, 2018], color: ['Silver Ice', '#c4c8cb'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'sil-d', make: 'Chevrolet', model: 'Silverado 1500', body: 'TRUCK', yr: [2016, 2017], color: ['Victory Red', '#8b1119'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'f150-a', make: 'Ford', model: 'F-150', body: 'TRUCK', yr: [2017, 2019], color: ['Oxford White', '#f2f3f4'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'gmc-a', make: 'GMC', model: 'Sierra 1500', body: 'TRUCK', yr: [2017, 2018], color: ['Quicksilver', '#b9bdc0'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'tac-a', make: 'Toyota', model: 'Tacoma', body: 'TRUCK', yr: [2017, 2020], color: ['Cement', '#9a9c9a'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'out-b', make: 'Subaru', model: 'Outback', body: 'WAGON', yr: [2017, 2019], color: ['Ice Silver', '#b7bcc0'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'out-c', make: 'Subaru', model: 'Outback', body: 'WAGON', yr: [2017, 2019], color: ['Magnetic Gray', '#6c7175'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'for-b', make: 'Subaru', model: 'Forester', body: 'SUV', yr: [2019, 2022], color: ['Ice Silver', '#b7bcc0'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'cro-b', make: 'Subaru', model: 'Crosstrek', body: 'SUV', yr: [2018, 2021], color: ['Magnetite Gray', '#5b6064'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'crv-a', make: 'Honda', model: 'CR-V', body: 'SUV', yr: [2017, 2020], color: ['Platinum White', '#eff1f2'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'crv-b', make: 'Honda', model: 'CR-V', body: 'SUV', yr: [2017, 2020], color: ['Modern Steel', '#5d6469'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'crv-c', make: 'Honda', model: 'CR-V', body: 'SUV', yr: [2017, 2020], color: ['Crystal Black', '#131518'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'pil-a', make: 'Honda', model: 'Pilot', body: 'SUV', yr: [2016, 2018], color: ['White Diamond', '#eef0f0'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'pil-b', make: 'Honda', model: 'Pilot', body: 'SUV', yr: [2016, 2018], color: ['White Diamond', '#eef0f0'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'pil-c', make: 'Honda', model: 'Pilot', body: 'SUV', yr: [2016, 2018], color: ['Taffeta White', '#f1f2f2'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'jgc-a', make: 'Jeep', model: 'Grand Cherokee', body: 'SUV', yr: [2016, 2019], color: ['Diamond Black', '#121417'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'tel-a', make: 'Kia', model: 'Telluride', body: 'SUV', yr: [2020, 2022], color: ['Snow White Pearl', '#f0f1f1'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'rav-a', make: 'Toyota', model: 'RAV4', body: 'SUV', yr: [2018, 2018], color: ['Ruby Flare Pearl', '#7b1620'], shots: [[1, 'EXTERIOR_FRONT']] },
  { id: 'cam-a', make: 'Toyota', model: 'Camry', body: 'SEDAN', yr: [2018, 2020], color: ['Midnight Black', '#111316'], shots: [[1, 'EXTERIOR_FRONT']] },
];

/**
 * Absolute, because these URLs leave our building.
 *
 * The feed hands them to Meta, which fetches from its own infrastructure with no
 * origin to resolve a relative path against — the exact failure that rejected
 * every item on 6 Aug 2026. `feed-spec.ts` would absolutise a relative path via
 * `photoBase`, but a demo that only works when that fix is deployed is a demo
 * with a tripwire in it.
 */
const ORIGIN = (process.env.DEMO_PHOTO_ORIGIN ?? 'https://app.rooftopauto.com').replace(/\/+$/, '');

/** Trim is group-agnostic; a re-badged unit keeps a plausible one for its body. */
const TRIMS: Record<BodyStyle, string[]> = {
  SEDAN: ['LX', 'EX', 'Sport', 'Touring'],
  SUV: ['LE', 'EX-L', 'Limited', 'Premium'],
  TRUCK: ['SLE', 'Big Horn', 'LT Crew Cab', 'XLT'],
  WAGON: ['Premium', 'Limited', 'Touring'],
  COUPE: ['Base', 'Sport'],
  HATCHBACK: ['LE', 'SE'],
  VAN: ['LX', 'EX-L'],
  CONVERTIBLE: ['Base', 'Sport'],
};

async function main() {
  const vehicles = await db
    .select({
      id: t.vehicles.id,
      rooftopId: t.vehicles.rooftopId,
      stockNumber: t.vehicles.stockNumber,
      year: t.vehicles.year,
    })
    .from(t.vehicles)
    .orderBy(t.vehicles.stockNumber);

  if (!vehicles.length) {
    console.log('no vehicles — nothing to do');
    process.exit(0);
  }

  let updated = 0;
  let photoRows = 0;

  for (const [i, v] of vehicles.entries()) {
    // Round-robin so a lot larger than the group list still gets full coverage,
    // and so the four-frame Accord lands on the first unit rather than the 27th.
    const g = GROUPS[i % GROUPS.length]!;

    // Keep the existing year when the photographed generation allows it, so
    // days-on-lot ageing and price history stay coherent with what was seeded.
    const year = v.year >= g.yr[0] && v.year <= g.yr[1] ? v.year : g.yr[0];
    const trims = TRIMS[g.body];
    const trim = trims[i % trims.length]!;

    await db
      .update(t.vehicles)
      .set({
        year,
        make: g.make,
        model: g.model,
        trim,
        bodyStyle: g.body,
        exteriorColor: g.color[0],
        exteriorColorHex: g.color[1],
        // The VIN encodes the make. Leaving a Honda VIN on a re-badged Ram is
        // the kind of detail a dealer notices in the first thirty seconds.
        vin: buildVin(g.make, year, v.stockNumber),
      })
      .where(eq(t.vehicles.id, v.id));

    await db.delete(t.vehiclePhotos).where(eq(t.vehiclePhotos.vehicleId, v.id));
    await db.insert(t.vehiclePhotos).values(
      g.shots.map(([n, tag], k) => ({
        vehicleId: v.id,
        url: `${ORIGIN}/demo/veh/${g.id}/${n}.jpg`,
        sortOrder: k,
        isPrimary: k === 0,
        tag,
        alt: `${year} ${g.make} ${g.model}`,
      })),
    );

    updated += 1;
    photoRows += g.shots.length;
  }

  const marketplaceReady = vehicles.filter((_, i) => GROUPS[i % GROUPS.length]!.shots.length >= 2).length;

  console.log(`re-badged ${updated} vehicles onto ${GROUPS.length} photographed cars`);
  console.log(`wrote ${photoRows} photo rows under ${ORIGIN}/demo/veh/`);
  console.log(`${marketplaceReady} of ${updated} have 2+ images — the rest can list, not reach Marketplace`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
