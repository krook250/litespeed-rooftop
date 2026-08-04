/**
 * The vehicle feed, tested where it can silently lie.
 *
 * This file is not about coverage. It is about the four failure modes that
 * produce a *valid-looking* feed which quietly does not work, because those are
 * the ones no amount of manual checking catches:
 *
 *   1. Enum spellings. Meta accepts `MILES` in `mileage.unit`, stores the row,
 *      and never serves the vehicle. There is no error to notice.
 *   2. TSV escaping. A tab inside a dealer's description shifts every column to
 *      its right by one for that row, and Meta accepts the result as data.
 *   3. Eligibility boundaries. "Over 500 miles" is strictly greater than, and a
 *      unit at exactly 500 being wrongly included means an ad set spending on a
 *      vehicle Marketplace will not show.
 *   4. Sold units falling out of the full replace, which deletes them at Meta
 *      and destroys their delivery history.
 *
 * No database. `feed-spec.ts` is pure precisely so this file can exist.
 * Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKETPLACE_MIN_MILEAGE,
  SOLD_GRACE_DAYS,
  agingLabel,
  buildFeed,
  e164ish,
  evaluate,
  fullWindow,
  stateOfVehicle,
  toTsv,
  type FeedRooftop,
  type FeedVehicle,
} from './feed-spec';

const DAY = 86_400_000;
const NOW = new Date('2026-08-04T12:00:00Z');

const LOT: FeedRooftop = {
  id: 'lot_demo',
  name: 'Rooftop Demo Motors',
  addressLine1: '550 Auto Center Dr',
  city: 'Watsonville',
  state: 'CA',
  postalCode: '95076',
  phone: '(360) 345-3333',
  latitude: 36.910231,
  longitude: -121.756894,
  pageId: '102938475601',
};

function vehicle(over: Partial<FeedVehicle> = {}): FeedVehicle {
  return {
    id: 'veh_1',
    vin: '1HGCM82633A004352',
    stockNumber: 'N8990',
    year: 2019,
    make: 'Honda',
    model: 'Accord',
    trim: 'Sport',
    bodyStyle: 'SEDAN',
    transmission: 'CVT',
    drivetrain: 'FWD',
    fuelType: 'GAS',
    exteriorColor: 'Modern Steel',
    interiorColor: 'Black',
    mileage: 42_000,
    price: 18_000,
    salePrice: null,
    status: 'FRONT_LINE_READY',
    isCertified: false,
    description: 'One owner, no accidents.',
    acquiredDate: new Date(NOW.getTime() - 20 * DAY),
    frontLineDate: new Date(NOW.getTime() - 15 * DAY),
    soldDate: null,
    photos: [
      { url: 'https://cdn.example.com/1.jpg', sortOrder: 0, isPrimary: true, tag: 'EXTERIOR_FRONT' },
      { url: 'https://cdn.example.com/2.jpg', sortOrder: 1, isPrimary: false, tag: 'INTERIOR' },
    ],
    ...over,
  };
}

const build = (vs: FeedVehicle[], lot: FeedRooftop = LOT) =>
  buildFeed(vs, lot, { siteBase: 'https://demo.rooftopauto.com', now: NOW });

/* ------------------------------------------------------------------ enums */

describe('feed enums match the AIA feed spec, not the Graph node', () => {
  it('sends MI, not MILES', () => {
    const row = build([vehicle()]).rows[0]!;
    assert.equal(row['mileage.unit'], 'MI');
  });

  it('spells drivetrain the feed way', () => {
    assert.equal(build([vehicle({ drivetrain: 'FOUR_WD' })]).rows[0]!.drivetrain, '4X4');
    assert.equal(build([vehicle({ drivetrain: 'AWD' })]).rows[0]!.drivetrain, 'AWD');
  });

  it('collapses CVT to Automatic — the feed spec has only two values', () => {
    assert.equal(build([vehicle({ transmission: 'CVT' })]).rows[0]!.transmission, 'Automatic');
  });

  it('maps a plug-in hybrid to HYBRID, since the feed enum has no PLUG_IN_HYBRID', () => {
    assert.equal(build([vehicle({ fuelType: 'PLUGIN_HYBRID' })]).rows[0]!.fuel_type, 'HYBRID');
    assert.equal(build([vehicle({ fuelType: 'GAS' })]).rows[0]!.fuel_type, 'GASOLINE');
  });

  it('calls a van a MINIVAN', () => {
    assert.equal(build([vehicle({ bodyStyle: 'VAN' })]).rows[0]!.body_style, 'MINIVAN');
  });

  it('formats price as amount, space, ISO code — not a bare integer', () => {
    const row = build([vehicle({ price: 18_000, salePrice: 16_500 })]).rows[0]!;
    assert.equal(row.price, '16500 USD');
    assert.equal(row.sale_price, '16500 USD');
  });

  it('marks a certified unit CPO and everything else Used', () => {
    assert.equal(stateOfVehicle({ isCertified: true }), 'CPO');
    assert.equal(stateOfVehicle({ isCertified: false }), 'Used');
  });

  it('puts the country code on the dealer phone', () => {
    assert.equal(e164ish('(360) 345-3333'), '+1 3603453333');
    assert.equal(e164ish('1-360-345-3333'), '+1 3603453333');
    assert.equal(e164ish(''), '');
  });

  it('sends one address format, not both', () => {
    const row = build([vehicle()]).rows[0]!;
    assert.match(row.address!, /addr1: '550 Auto Center Dr'/);
    // Meta: supplying the blob and the flattened columns together "will result
    // in an error". Nothing may leak in through the side door.
    for (const k of Object.keys(row)) assert.ok(!k.startsWith('address.'), `leaked ${k}`);
  });
});

/* -------------------------------------------------------------- escaping */

describe('TSV escaping', () => {
  it('strips a tab out of a description rather than shifting every column right', () => {
    const tsv = toTsv(['a', 'b'], [{ a: 'one\ttwo', b: 'x' }]);
    const dataLine = tsv.split('\n')[1]!;
    assert.equal(dataLine.split('\t').length, 2, 'a stray tab created a phantom column');
    assert.match(dataLine, /one two/);
  });

  it('strips newlines, which would otherwise become extra records', () => {
    const tsv = toTsv(['a'], [{ a: 'line one\nline two\r\nthree' }]);
    // header + one record + trailing newline
    assert.equal(tsv.split('\n').filter(Boolean).length, 2);
  });

  it('doubles inner quotes rather than truncating the field', () => {
    const tsv = toTsv(['a'], [{ a: 'Join our "Royal" program' }]);
    assert.match(tsv, /"Join our ""Royal"" program"/);
  });

  it('quotes every field, including the header, so autodetect cannot guess wrong', () => {
    const tsv = toTsv(['a', 'b'], [{ a: 'x', b: '' }]);
    assert.equal(tsv.split('\n')[0], '"a"\t"b"');
    assert.equal(tsv.split('\n')[1], '"x"\t""');
  });

  it('terminates the final record', () => {
    assert.ok(toTsv(['a'], [{ a: 'x' }]).endsWith('\n'));
  });
});

/* ----------------------------------------------------------- eligibility */

describe('Marketplace eligibility', () => {
  it('treats 500 miles as ineligible and 501 as eligible', () => {
    const at = evaluate(vehicle({ mileage: MARKETPLACE_MIN_MILEAGE }), LOT, NOW);
    const over = evaluate(vehicle({ mileage: MARKETPLACE_MIN_MILEAGE + 1 }), LOT, NOW);
    assert.ok(at.some((i) => i.code === 'UNDER_500_MILES'));
    assert.ok(!over.some((i) => i.code === 'UNDER_500_MILES'));
  });

  it('holds a one-photo unit off Marketplace but still sends it to the catalog', () => {
    const v = vehicle({ photos: [{ url: 'https://cdn.example.com/1.jpg', isPrimary: true }] });
    const out = build([v]);
    assert.equal(out.rows.length, 1, 'a one-photo unit must still reach the catalog');
    assert.ok(out.vehicles[0]!.issues.some((i) => i.code === 'ONE_PHOTO_ONLY'));
    assert.equal(out.rows[0]!.custom_label_1, 'mkt_hold');
  });

  it('excludes a no-photo unit entirely, with a reason', () => {
    const out = build([vehicle({ photos: [] })]);
    assert.equal(out.rows.length, 0);
    const issue = out.vehicles[0]!.issues.find((i) => i.code === 'NO_PHOTOS');
    assert.ok(issue);
    assert.equal(issue.scope, 'FEED');
    assert.ok(issue.fix.length > 0, 'a dealer-facing reason without a fix is half a reason');
  });

  it('never drops a unit without recording why', () => {
    const out = build([vehicle({ photos: [] }), vehicle({ id: 'v2', price: 0, salePrice: null })]);
    for (const v of out.vehicles) {
      if (v.row === null) assert.ok(v.issues.length > 0, `${v.vehicleId} vanished silently`);
    }
  });

  it('blocks the whole lot when the store has no coordinates — Meta requires them', () => {
    const out = build([vehicle()], { ...LOT, latitude: null, longitude: null });
    assert.equal(out.rows.length, 0);
    assert.ok(out.vehicles[0]!.issues.some((i) => i.code === 'NO_STORE_COORDINATES'));
  });

  it('flags a short VIN, which Marketplace requires in full', () => {
    const issues = evaluate(vehicle({ vin: '1HGCM826' }), LOT, NOW);
    assert.ok(issues.some((i) => i.code === 'NO_VIN' && i.scope === 'MARKETPLACE'));
  });

  it('marks a fully clean unit mkt_ok', () => {
    assert.equal(build([vehicle()]).rows[0]!.custom_label_1, 'mkt_ok');
  });
});

/* --------------------------------------------------------- full vs delta */

describe('the full replace does not delete recent history', () => {
  it('keeps a recently sold unit, marked unavailable', () => {
    const sold = vehicle({
      id: 'sold_1',
      status: 'SOLD',
      soldDate: new Date(NOW.getTime() - 3 * DAY),
    });
    const kept = fullWindow([sold], NOW);
    assert.equal(kept.length, 1);
    const row = build(kept).rows[0]!;
    assert.equal(row.availability, 'not_available');
  });

  it('lets a long-sold unit fall out once the grace window passes', () => {
    const old = vehicle({
      id: 'sold_2',
      status: 'SOLD',
      soldDate: new Date(NOW.getTime() - (SOLD_GRACE_DAYS + 1) * DAY),
    });
    assert.equal(fullWindow([old], NOW).length, 0);
  });

  it('keeps a live unit available', () => {
    assert.equal(build([vehicle()]).rows[0]!.availability, 'available');
  });
});

/* -------------------------------------------------------- aging + images */

describe('aging buckets and images', () => {
  it('labels buckets on the same boundaries as the Lot Walk', () => {
    assert.equal(agingLabel(0), 'age_0_15');
    assert.equal(agingLabel(15), 'age_0_15');
    assert.equal(agingLabel(16), 'age_16_30');
    assert.equal(agingLabel(45), 'age_31_45');
    assert.equal(agingLabel(46), 'age_46_60');
    assert.equal(agingLabel(61), 'age_61_plus');
  });

  it('carries days_on_lot and the label together, so a set can filter on either', () => {
    const row = build([vehicle()]).rows[0]!;
    assert.equal(row.days_on_lot, '20');
    assert.equal(row.custom_label_0, 'age_16_30');
    assert.equal(row.date_first_on_lot, '2026-07-15');
  });

  it('numbers image columns from zero and puts the primary first', () => {
    const v = vehicle({
      photos: [
        { url: 'https://cdn.example.com/b.jpg', sortOrder: 5, isPrimary: false },
        { url: 'https://cdn.example.com/a.jpg', sortOrder: 9, isPrimary: true },
      ],
    });
    const out = build([v]);
    assert.equal(out.rows[0]!['image[0].url'], 'https://cdn.example.com/a.jpg');
    assert.equal(out.rows[0]!['image[1].url'], 'https://cdn.example.com/b.jpg');
    assert.ok(out.columns.includes('image[1].url'));
  });

  it('caps at Meta 20-image limit', () => {
    const photos = Array.from({ length: 25 }, (_, i) => ({
      url: `https://cdn.example.com/${i}.jpg`,
      sortOrder: i,
      isPrimary: i === 0,
    }));
    const out = build([vehicle({ photos })]);
    assert.ok(!out.columns.includes('image[20].url'));
    assert.equal(out.columns.filter((c) => c.endsWith('.url')).length, 20);
  });

  it('widens the header to the widest row, so no row has orphan columns', () => {
    const one = vehicle({ id: 'a', photos: [{ url: 'https://x/1.jpg', isPrimary: true }] });
    const three = vehicle({
      id: 'b',
      photos: [
        { url: 'https://x/1.jpg', isPrimary: true },
        { url: 'https://x/2.jpg', sortOrder: 1 },
        { url: 'https://x/3.jpg', sortOrder: 2 },
      ],
    });
    const out = build([one, three]);
    assert.ok(out.columns.includes('image[2].url'));
    const tsv = toTsv(out.columns, out.rows);
    const widths = tsv.trim().split('\n').map((l) => l.split('\t').length);
    assert.equal(new Set(widths).size, 1, 'rows and header disagree on column count');
  });

  it('builds the VDP url off the stock number', () => {
    assert.equal(build([vehicle()]).rows[0]!.url, 'https://demo.rooftopauto.com/N8990');
  });
});
