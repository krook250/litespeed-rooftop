/**
 * The CarGurus feed, tested where it can silently lie.
 *
 * Same principle as the Meta suite next door: not coverage, but the specific
 * ways this file can produce something that looks like a working feed and is
 * not. For CarGurus those are different failures than for Meta, because
 * CarGurus is forgiving about everything Meta is strict about and strict about
 * one thing Meta never checks:
 *
 *   1. Image format. "JPEG, PNG, and GIF" — and two of our own URL shapes are
 *      neither. A vehicle whose only photos are generated SVG tiles must be
 *      held back, not sent with an image URL CarGurus cannot fetch.
 *   2. CSV escaping. A comma is the delimiter and dealer descriptions are full
 *      of them.
 *   3. Sold units, which have no availability column to be marked with and so
 *      must leave the file entirely.
 *   4. The undocumented control fields staying out of the file.
 *
 * No database. Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARGURUS_FILE_STATUSES,
  CG_COLUMNS,
  IMAGE_URL_SEPARATOR,
  OMITTED_CONTROL_FIELDS,
  activePrice,
  buildCarGurusFeed,
  combineFeeds,
  evaluate,
  guardBatch,
  SHORT_FILE_DROP_RATIO,
  feedablePhotos,
  inCarGurusFile,
  liveWindow,
  prettyPhone,
  toCsv,
  type CgBatchPart,
  type CgBuildResult,
  type CgRooftop,
  type CgVehicle,
} from './feed-spec';

const PHOTO_BASE = 'https://app.rooftopauto.com';
const BLOB = 'https://abc123.public.blob.vercel-storage.com/vehicles/v1';

const LOT: CgRooftop = {
  id: 'lot_demo',
  dealerId: 'lot_demo',
  name: 'Evergreen Motors Vancouver',
  addressLine1: '1200 SE Mill Plain Blvd',
  city: 'Vancouver',
  state: 'WA',
  postalCode: '98684',
  phone: '(360) 345-3333',
  latitude: 45.6872,
  longitude: -122.6603,
  leadEmail: 'leads-lot_demo@inbound.rooftopauto.com',
};

function vehicle(over: Partial<CgVehicle> = {}): CgVehicle {
  return {
    id: 'veh_1',
    vin: '1HGCM82633A004352',
    stockNumber: 'E1042',
    year: 2021,
    make: 'Honda',
    model: 'Accord',
    trim: 'EX-L',
    transmission: 'AUTOMATIC',
    engine: '1.5L I4 Turbo',
    exteriorColor: 'Modern Steel Metallic',
    interiorColor: 'Black Leather',
    mileage: 41_200,
    price: 24_995,
    salePrice: null,
    msrp: 32_400,
    status: 'FRONT_LINE_READY',
    isCertified: false,
    description: 'One owner, no accidents.',
    options: ['Sunroof', 'Heated Seats'],
    features: ['Apple CarPlay'],
    photos: [{ url: `${BLOB}/aaaa.jpg`, sortOrder: 0, isPrimary: true }],
    ...over,
  };
}

/* ------------------------------------------------------------ image rules */

describe('image URLs are filtered to formats CarGurus accepts', () => {
  it('drops generated SVG tiles, which is every un-photographed unit', () => {
    const v = vehicle({ photos: [{ url: '/api/photo?s=EXTERIOR_SIDE&b=SEDAN', sortOrder: 0 }] });
    assert.deepEqual(feedablePhotos(v, PHOTO_BASE), []);
  });

  it('holds a vehicle out of the file entirely when tiles are all it has', () => {
    const v = vehicle({ photos: [{ url: '/api/photo?s=EXTERIOR_SIDE', sortOrder: 0 }] });
    const codes = evaluate(v, PHOTO_BASE).map((i) => i.code);
    assert.ok(codes.includes('NO_PHOTOS'));

    const { rows, vehicles } = buildCarGurusFeed([v], LOT, { photoBase: PHOTO_BASE });
    assert.equal(rows.length, 0);
    assert.equal(vehicles[0]!.row, null);
  });

  it('drops WebP, which the uploader accepts and CarGurus does not', () => {
    const v = vehicle({
      photos: [
        { url: `${BLOB}/bbbb.webp`, sortOrder: 0, isPrimary: true },
        { url: `${BLOB}/cccc.jpg`, sortOrder: 1 },
      ],
    });
    assert.deepEqual(feedablePhotos(v, PHOTO_BASE), [`${BLOB}/cccc.jpg`]);
  });

  it('keeps jpg, jpeg, png and gif, and tolerates a query string', () => {
    const urls = [`${BLOB}/a.jpg`, `${BLOB}/b.jpeg`, `${BLOB}/c.png`, `${BLOB}/d.gif`, `${BLOB}/e.png?v=2`];
    const v = vehicle({ photos: urls.map((url, i) => ({ url, sortOrder: i })) });
    assert.deepEqual(feedablePhotos(v, PHOTO_BASE), urls);
  });

  it('puts the lead photo first regardless of sort order', () => {
    const v = vehicle({
      photos: [
        { url: `${BLOB}/second.jpg`, sortOrder: 0 },
        { url: `${BLOB}/lead.jpg`, sortOrder: 7, isPrimary: true },
      ],
    });
    assert.deepEqual(feedablePhotos(v, PHOTO_BASE), [`${BLOB}/lead.jpg`, `${BLOB}/second.jpg`]);
  });

  it('de-duplicates, which content-addressed URLs make possible', () => {
    const v = vehicle({
      photos: [
        { url: `${BLOB}/same.jpg`, sortOrder: 0, isPrimary: true },
        { url: `${BLOB}/same.jpg`, sortOrder: 1 },
      ],
    });
    assert.deepEqual(feedablePhotos(v, PHOTO_BASE), [`${BLOB}/same.jpg`]);
  });

  it('drops a relative URL when there is no photoBase rather than emitting it broken', () => {
    const v = vehicle({ photos: [{ url: '/uploads/x.jpg', sortOrder: 0 }] });
    assert.deepEqual(feedablePhotos(v), []);
  });

  it('sends Main Image as the first of the Image URLs, not a separate choice', () => {
    const v = vehicle({
      photos: [
        { url: `${BLOB}/lead.jpg`, sortOrder: 0, isPrimary: true },
        { url: `${BLOB}/two.jpg`, sortOrder: 1 },
      ],
    });
    const row = buildCarGurusFeed([v], LOT, { photoBase: PHOTO_BASE }).rows[0]!;
    assert.equal(row['Main Image'], `${BLOB}/lead.jpg`);
    assert.equal(row['Image URLs'], `${BLOB}/lead.jpg${IMAGE_URL_SEPARATOR}${BLOB}/two.jpg`);
  });
});

/* ----------------------------------------------------------- eligibility */

describe('eligibility', () => {
  it('excludes a unit that is not front-line ready', () => {
    const codes = evaluate(vehicle({ status: 'RECON' }), PHOTO_BASE).map((i) => i.code);
    assert.ok(codes.includes('NOT_RETAIL_READY'));
  });

  it('excludes an unpriced unit', () => {
    const codes = evaluate(vehicle({ price: 0, salePrice: null }), PHOTO_BASE).map((i) => i.code);
    assert.ok(codes.includes('NO_PRICE'));
  });

  it('treats a sale price as the price', () => {
    assert.equal(activePrice(vehicle({ price: 24_995, salePrice: 22_500 })), 22_500);
    const row = buildCarGurusFeed([vehicle({ price: 24_995, salePrice: 22_500 })], LOT, {
      photoBase: PHOTO_BASE,
    }).rows[0]!;
    assert.equal(row.Price, '22500');
  });

  it('gives every issue a dealer-readable reason and a fix', () => {
    const issues = evaluate(vehicle({ status: 'RECON', price: 0, vin: '' }), PHOTO_BASE);
    assert.ok(issues.length >= 3);
    for (const i of issues) {
      assert.ok(i.reason.length > 0, `${i.code} has no reason`);
      assert.ok(i.fix.length > 0, `${i.code} has no fix`);
    }
  });

  it('reports every reason at once rather than stopping at the first', () => {
    const codes = evaluate(vehicle({ status: 'RECON', price: 0, vin: '', photos: [] }), PHOTO_BASE)
      .map((i) => i.code)
      .sort();
    assert.deepEqual(codes, ['NOT_RETAIL_READY', 'NO_PHOTOS', 'NO_PRICE', 'NO_VIN'].sort());
  });
});

/* ------------------------------------------------------------------ rows */

describe('row shape', () => {
  it('sends transmission unmapped — CarGurus accepts our spelling', () => {
    const row = buildCarGurusFeed([vehicle({ transmission: 'CVT' })], LOT, {
      photoBase: PHOTO_BASE,
    }).rows[0]!;
    assert.equal(row['Transmission Type'], 'CVT');
  });

  it('combines options and features into Installed Options', () => {
    const row = buildCarGurusFeed([vehicle()], LOT, { photoBase: PHOTO_BASE }).rows[0]!;
    assert.equal(row['Installed Options'], 'Sunroof, Heated Seats, Apple CarPlay');
  });

  it('marks everything used, so a current-model-year trade is not read as new', () => {
    const row = buildCarGurusFeed([vehicle({ year: 2026 })], LOT, {
      photoBase: PHOTO_BASE,
    }).rows[0]!;
    assert.equal(row['Is New'], 'N');
  });

  it('sends Certified as Y/N', () => {
    const rows = buildCarGurusFeed([vehicle({ isCertified: true })], LOT, {
      photoBase: PHOTO_BASE,
    }).rows;
    assert.equal(rows[0]!.Certified, 'Y');
  });

  it('carries the ADF lead address, which is what makes leads free here', () => {
    const row = buildCarGurusFeed([vehicle()], LOT, { photoBase: PHOTO_BASE }).rows[0]!;
    assert.equal(row['Dealer CRM Email'], 'leads-lot_demo@inbound.rooftopauto.com');
  });

  it('never emits the undocumented control fields', () => {
    const { columns, rows } = buildCarGurusFeed([vehicle()], LOT, { photoBase: PHOTO_BASE });
    for (const f of OMITTED_CONTROL_FIELDS) {
      assert.ok(!columns.includes(f), `${f} must not be a column`);
      assert.ok(!(f in rows[0]!), `${f} must not be in a row`);
    }
  });

  it('emits every declared column for every row, including the empty ones', () => {
    const row = buildCarGurusFeed([vehicle({ msrp: null })], LOT, {
      photoBase: PHOTO_BASE,
    }).rows[0]!;
    for (const c of CG_COLUMNS) {
      assert.ok(c in row, `${c} missing from row`);
    }
    assert.equal(row.MSRP, '');
  });
});

/* ------------------------------------------------------------------- CSV */

describe('CSV rendering', () => {
  it('survives a comma in a dealer description', () => {
    const v = vehicle({ description: 'Loaded, clean, one owner' });
    const { columns, rows } = buildCarGurusFeed([v], LOT, { photoBase: PHOTO_BASE });
    const line = toCsv(columns, rows).split('\n')[1]!;
    assert.equal(line.split('","').length, columns.length);
    assert.ok(line.includes('"Loaded, clean, one owner"'));
  });

  it('doubles an embedded quotation mark', () => {
    const v = vehicle({ description: 'Has 20" wheels' });
    const { columns, rows } = buildCarGurusFeed([v], LOT, { photoBase: PHOTO_BASE });
    assert.ok(toCsv(columns, rows).includes('Has 20"" wheels'));
  });

  it('strips newlines so a description cannot invent a row', () => {
    const v = vehicle({ description: 'Line one\nLine two\r\nLine three' });
    const { columns, rows } = buildCarGurusFeed([v], LOT, { photoBase: PHOTO_BASE });
    const csv = toCsv(columns, rows);
    assert.equal(csv.trim().split('\n').length, 2);
  });

  it('quotes the header row too, and terminates the file', () => {
    const { columns, rows } = buildCarGurusFeed([vehicle()], LOT, { photoBase: PHOTO_BASE });
    const csv = toCsv(columns, rows);
    assert.ok(csv.startsWith('"VIN","Stock Number"'));
    assert.ok(csv.endsWith('\n'));
  });
});

/* ---------------------------------------------------------------- window */

describe('the upload window', () => {
  it('drops sold units immediately — absence is the only way to delist', () => {
    const live = vehicle({ id: 'a', status: 'FRONT_LINE_READY' });
    const sold = vehicle({ id: 'b', status: 'SOLD' });
    const wholesaled = vehicle({ id: 'c', status: 'WHOLESALED' });
    assert.deepEqual(liveWindow([live, sold, wholesaled]).map((v) => v.id), ['a']);
  });
});

/* --------------------------------------------------------------- helpers */

describe('phone formatting', () => {
  it('formats ten digits for a human reader', () => {
    assert.equal(prettyPhone('3603453333'), '(360) 345-3333');
  });

  it('strips a leading country code', () => {
    assert.equal(prettyPhone('+1 360-345-3333'), '(360) 345-3333');
  });

  it('passes anything unrecognisable through rather than mangling it', () => {
    assert.equal(prettyPhone('ext 4'), 'ext 4');
  });
});

/* ------------------------------------------------------------ the batch */

describe('which rooftops go in the file', () => {
  it('includes SUBMITTED, because that is what SUBMITTED means', () => {
    assert.equal(inCarGurusFile('SUBMITTED'), true);
  });

  it('keeps an errored connection in the file rather than delisting the lot', () => {
    assert.equal(inCarGurusFile('ERROR'), true);
  });

  it('leaves out every state where the dealer has not confirmed a paid account', () => {
    for (const s of ['PENDING_SETUP', 'AWAITING_DEALER', 'DISCONNECTED']) {
      assert.equal(inCarGurusFile(s), false, s);
    }
  });

  it('treats an unknown or absent state as out', () => {
    // The positive-set property: a state added to the enum later is excluded
    // until somebody opts it in on purpose.
    assert.equal(inCarGurusFile('SOME_FUTURE_STATE'), false);
    assert.equal(inCarGurusFile(null), false);
    assert.equal(inCarGurusFile(undefined), false);
  });

  it('names exactly three states, so widening it is a visible diff', () => {
    assert.deepEqual([...CARGURUS_FILE_STATUSES].sort(), ['CONNECTED', 'ERROR', 'SUBMITTED']);
  });
});

/** A build result carrying `n` rows for one dealer, without touching a database. */
function part(rooftopId: string, rooftopName: string, vins: string[]): CgBatchPart {
  const built = buildCarGurusFeed(
    vins.map((vin, i) => vehicle({ id: `veh_${rooftopId}_${i}`, vin, stockNumber: `S${i}` })),
    { ...LOT, id: rooftopId, dealerId: rooftopId, name: rooftopName },
    { photoBase: PHOTO_BASE },
  );
  return { rooftopId, rooftopName, built };
}

describe('combining several dealers into one file', () => {
  it('emits one header row for the whole file', () => {
    const b = combineFeeds([part('lot_a', 'Alpha Auto', ['A1', 'A2']), part('lot_b', 'Bravo Cars', ['B1'])]);
    const lines = b.csv.trim().split('\n');
    assert.equal(lines.length, 4, 'header + three vehicles');
    assert.equal(lines[0], CG_COLUMNS.map((c) => `"${c}"`).join(','));
  });

  it('carries each dealer\'s own Dealer ID on their own rows', () => {
    const b = combineFeeds([part('lot_a', 'Alpha Auto', ['A1']), part('lot_b', 'Bravo Cars', ['B1'])]);
    const ids = b.rows.map((r) => r['Dealer ID']);
    assert.deepEqual(ids, ['lot_a', 'lot_b']);
  });

  it('orders lots by name, so two uploads of an unchanged file are identical', () => {
    const a = part('lot_z', 'Alpha Auto', ['A1']);
    const b = part('lot_a', 'Zulu Motors', ['Z1']);
    assert.equal(combineFeeds([a, b]).csv, combineFeeds([b, a]).csv);
    assert.deepEqual(combineFeeds([b, a]).lots.map((l) => l.rooftopName), ['Alpha Auto', 'Zulu Motors']);
  });

  it('totals rows and held-out units across every lot', () => {
    const a = part('lot_a', 'Alpha Auto', ['A1', 'A2']);
    // One unit with no usable photo is held back by the builder, not by us.
    const bBuilt = buildCarGurusFeed(
      [vehicle({ id: 'v_b1', vin: 'B1', photos: [] })],
      { ...LOT, id: 'lot_b', dealerId: 'lot_b', name: 'Bravo Cars' },
      { photoBase: PHOTO_BASE },
    );
    const b: CgBatchPart = { rooftopId: 'lot_b', rooftopName: 'Bravo Cars', built: bBuilt };
    const combined = combineFeeds([a, b]);
    assert.equal(combined.totals.lots, 2);
    assert.equal(combined.totals.sent, 2);
    assert.equal(combined.totals.excluded, 1);
  });

  it('warns, loudly and non-fatally, about a lot that contributed nothing', () => {
    const empty: CgBatchPart = {
      rooftopId: 'lot_b',
      rooftopName: 'Bravo Cars',
      built: buildCarGurusFeed([], { ...LOT, id: 'lot_b', dealerId: 'lot_b' }, {}),
    };
    const combined = combineFeeds([part('lot_a', 'Alpha Auto', ['A1']), empty]);
    assert.equal(combined.rows.length, 1, 'the other lot still ships');
    assert.match(combined.warnings.join(' '), /Bravo Cars contributed 0 rows/);
  });

  it('reports a VIN appearing under two rooftops instead of picking one', () => {
    const combined = combineFeeds([
      part('lot_a', 'Alpha Auto', ['SHARED1']),
      part('lot_b', 'Bravo Cars', ['SHARED1']),
    ]);
    assert.match(combined.warnings.join(' '), /VIN SHARED1 appears under two rooftops/);
    assert.equal(combined.rows.length, 2, 'reported, not silently dropped');
  });

  it('an empty batch is a valid header-only file, not a crash', () => {
    const combined = combineFeeds([]);
    assert.equal(combined.rows.length, 0);
    assert.equal(combined.totals.lots, 0);
    assert.deepEqual(combined.columns, [...CG_COLUMNS]);
    // Deciding not to send this is the caller's job — see loadCarGurusBatch.
    assert.equal(combined.csv.trim().split('\n').length, 1);
  });

  it('throws rather than shipping a file whose rows disagree about column three', () => {
    const good = part('lot_a', 'Alpha Auto', ['A1']);
    const bent = part('lot_b', 'Bravo Cars', ['B1']);
    const wrong: CgBuildResult = { ...bent.built, columns: ['VIN', 'Make'] };
    assert.throws(
      () => combineFeeds([good, { ...bent, built: wrong }]),
      /column mismatch on rooftop lot_b/,
    );
  });

  it('still keeps the control fields out of the combined header', () => {
    const b = combineFeeds([part('lot_a', 'Alpha Auto', ['A1'])]);
    for (const f of OMITTED_CONTROL_FIELDS) assert.ok(!b.columns.includes(f), f);
  });
});

/* ------------------------------------------------------------- the guard */

const lot = (rooftopId: string, sent: number, rooftopName = rooftopId) => ({
  rooftopId,
  rooftopName,
  sent,
});
const input = (lots: ReturnType<typeof lot>[]) => ({
  lots,
  sent: lots.reduce((n, l) => n + l.sent, 0),
});

describe('refusing to send a file that would delist somebody', () => {
  it('allows the first upload, since there is nothing live to lose', () => {
    assert.deepEqual(guardBatch(input([lot('a', 12)]), null), { ok: true });
  });

  it('allows an ordinary night', () => {
    const v = guardBatch(input([lot('a', 40), lot('b', 12)]), input([lot('a', 39), lot('b', 12)]));
    assert.equal(v.ok, true);
  });

  it('allows growth', () => {
    assert.equal(guardBatch(input([lot('a', 400)]), input([lot('a', 40)])).ok, true);
  });

  it('refuses when a carrying lot would drop to zero', () => {
    const v = guardBatch(
      input([lot('a', 40), lot('b', 0, 'Bravo Cars')]),
      input([lot('a', 40), lot('b', 12, 'Bravo Cars')]),
    );
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.reason : '', /Bravo Cars would drop from 12 vehicle\(s\) to 0/);
  });

  it('refuses when a carrying lot vanishes from the file entirely', () => {
    const v = guardBatch(input([lot('a', 40)]), input([lot('a', 40), lot('b', 12, 'Bravo Cars')]));
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.reason : '', /Bravo Cars .* no longer eligible/);
  });

  it('does not fire for a lot that was already sending nothing', () => {
    // Nothing of theirs is live, so there is nothing to delist.
    const v = guardBatch(input([lot('a', 40)]), input([lot('a', 40), lot('b', 0, 'Bravo Cars')]));
    assert.equal(v.ok, true);
  });

  it('refuses a group-wide collapse that never takes any single lot to zero', () => {
    const v = guardBatch(
      input([lot('a', 20), lot('b', 5), lot('c', 5)]),
      input([lot('a', 40), lot('b', 30), lot('c', 30)]),
    );
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.reason : '', /would drop from 100 to 30 vehicles \(70%\)/);
  });

  it('lets a drop just under the limit through', () => {
    const prev = input([lot('a', 100)]);
    const justUnder = Math.ceil(100 * (1 - SHORT_FILE_DROP_RATIO)) + 1;
    assert.equal(guardBatch(input([lot('a', justUnder)]), prev).ok, true);
  });

  it('waives the comparison under force, but only the comparison', () => {
    const prev = input([lot('a', 40), lot('b', 12, 'Bravo Cars')]);
    // The case force exists for: Bravo was disconnected on purpose.
    assert.equal(guardBatch(input([lot('a', 40)]), prev, { force: true }).ok, true);
    // The case no flag may ever permit: every dealer's lot going out empty.
    const empty = guardBatch({ lots: [], sent: 0 }, prev, { force: true });
    assert.equal(empty.ok, false);
    const nothingQualified = guardBatch(input([lot('a', 0), lot('b', 0)]), prev, { force: true });
    assert.equal(nothingQualified.ok, false);
  });

  it('never sends an empty file, previous run or not', () => {
    const none = guardBatch({ lots: [], sent: 0 }, null);
    assert.equal(none.ok, false);
    assert.match(none.ok === false ? none.reason : '', /No rooftops are eligible/);

    const noCars = guardBatch(input([lot('a', 0), lot('b', 0)]), null);
    assert.equal(noCars.ok, false);
    assert.match(noCars.ok === false ? noCars.reason : '', /No vehicles qualified across 2/);
  });
});
