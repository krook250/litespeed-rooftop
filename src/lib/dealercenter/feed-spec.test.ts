/**
 * The DealerCenter feed, tested where it can silently lie.
 *
 * Not coverage — the specific ways this module can produce a file that looks
 * fine and writes something false into the dealer's own DMS. DealerCenter
 * matches on VIN and overwrites the record he desks deals against, so the
 * failures worth a test here are different from the marketplace feeds':
 *
 *   1. The header row. DealerCenter never told us wording is flexible, so the
 *      header must stay byte-identical to `NowcomSampleFeedWithData 4.csv`.
 *      A test pinning all 60 names is the only thing stopping a well-meant
 *      tidy-up of `Dealer ID` into `Dealer_ID`.
 *   2. The first column and the filename, which are how DealerCenter attaches
 *      the file to account 23548716 at all.
 *   3. `Type`. "New" on a used car changes how the deal is titled and taxed.
 *   4. Non-automobiles. The format has no RV vocabulary; a travel trailer must
 *      be held out rather than mapped to some make of car.
 *   5. CSV escaping. Commas live inside `Options`, `ImageList` and one of their
 *      own `Body` values.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DC_BLANK_FIELDS,
  DC_COLUMNS,
  MULTI_VALUE_SEPARATOR,
  activePrice,
  buildDealerCenterFeed,
  dcFilename,
  dealerCenterBlocker,
  evaluate,
  feedablePhotos,
  inDealerCenterFile,
  liveWindow,
  toBody,
  toCsv,
  toDcDate,
  toDisplacement,
  toMoney,
  type DcRooftop,
  type DcVehicle,
} from './feed-spec';

const PHOTO_BASE = 'https://app.rooftopauto.com';
const BLOB = 'https://abc123.public.blob.vercel-storage.com/vehicles/v1';

const LOT: DcRooftop = {
  id: 'lot_malabar',
  dcid: '23548716',
  name: 'Malabar Truck and Trade',
  addressLine1: '6185 Babcock St SE',
  city: 'Palm Bay',
  state: 'FL',
  postalCode: '32909',
  phone: '(321) 390-4793',
  leadEmail: 'leads-lot_malabar@inbound.rooftopauto.com',
};

function vehicle(over: Partial<DcVehicle> = {}): DcVehicle {
  return {
    id: 'v1',
    vin: '1GCRKSE35BZ123456',
    stockNumber: '123456',
    vehicleType: 'AUTO',
    year: 2019,
    make: 'Chevrolet',
    model: 'Silverado 1500',
    trim: 'Work Truck 4x4 4dr Crew Cab',
    bodyStyle: 'TRUCK',
    doors: 4,
    engine: 'Gas V8 5.3L/325',
    cylinders: 8,
    transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD',
    fuelType: 'GAS',
    mpgCity: 16,
    mpgHwy: 22,
    exteriorColor: 'Summit White',
    interiorColor: 'Dark Ash',
    mileage: 84210,
    price: 27995,
    salePrice: null,
    msrp: null,
    cost: 0,
    status: 'FRONT_LINE_READY',
    isCertified: false,
    description: 'One owner, service records.',
    options: ['Bluetooth', 'Backup Camera'],
    features: ['Tow Package'],
    acquiredDate: new Date('2026-02-07T00:00:00Z'),
    photos: [{ url: `${BLOB}/a.jpg`, sortOrder: 1, isPrimary: true }],
    ...over,
  };
}

/* ------------------------------------------------------------ the header */

test('the header row is the sample file, verbatim, all 60 columns', () => {
  assert.equal(DC_COLUMNS.length, 60);
  assert.deepEqual(
    [...DC_COLUMNS],
    [
      'Dealer ID', 'Type', 'Stock', 'VIN', 'Year', 'Make', 'Model', 'Body',
      'Trim', 'ModelNumber', 'Doors', 'ExteriorColor', 'InteriorColor',
      'EngineCylinders', 'EngineDisplacement', 'Transmission', 'Miles',
      'SellingPrice', 'MSRP', 'BookValue', 'Cost', 'Invoice', 'Certified',
      'DateInStock', 'Description', 'Options', 'Categorized Options',
      'Dealer Name', 'Dealer Address', 'Dealer City', 'Dealer State',
      'Dealer Zip', 'Dealer Phone', 'Dealer Fax', 'Dealer Email', 'Comment 1',
      'Comment 2', 'Comment 3', 'Comment 4', 'Comment 5', 'Style_Description',
      'Ext_Color_Generic', 'Ext_Color_Code', 'Engine_Aspiration_Type',
      'Engine_Description', 'Transmission_Speed', 'Transmission_Description',
      'Drivetrain', 'Fuel_Type', 'CityMPG', 'HighwayMPG', 'EPAClassification',
      'Internet_Price', 'Misc_Price1', 'Misc_Price2', 'Misc_Price3',
      'Factory_Codes', 'MarketClass', 'PassengerCapacity', 'ImageList',
    ],
  );
});

test('Dealer ID is first — DealerCenter reads column one to find the account', () => {
  assert.equal(DC_COLUMNS[0], 'Dealer ID');
});

test('every blank field is a real column, so the header stays complete', () => {
  for (const f of DC_BLANK_FIELDS) {
    assert.ok((DC_COLUMNS as readonly string[]).includes(f), `${f} is not a column`);
  }
});

test('a built row fills every column and invents none', () => {
  const { rows } = buildDealerCenterFeed([vehicle()], LOT, { photoBase: PHOTO_BASE });
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [...DC_COLUMNS].sort());
});

/* ----------------------------------------------------------- the filename */

test('filename is DCID_YYYYMMDD.csv, zero-padded', () => {
  assert.equal(dcFilename('23548716', new Date('2026-09-21T18:40:00Z')), '23548716_20260921.csv');
  assert.equal(dcFilename('23548716', new Date('2026-01-05T00:00:00Z')), '23548716_20260105.csv');
});

/* ------------------------------------------------------- the dangerous row */

test('every car goes out as Used — "New" would misfile how the deal is titled', () => {
  const { rows } = buildDealerCenterFeed([vehicle({ mileage: 0 })], LOT);
  assert.equal(rows[0].Type, 'Used');
});

test('the DCID goes in column one, not our rooftop id', () => {
  const { rows } = buildDealerCenterFeed([vehicle()], LOT);
  assert.equal(rows[0]['Dealer ID'], '23548716');
  assert.notEqual(rows[0]['Dealer ID'], LOT.id);
});

test('Certified is literal uppercase TRUE/FALSE', () => {
  assert.equal(buildDealerCenterFeed([vehicle()], LOT).rows[0].Certified, 'FALSE');
  const cert = buildDealerCenterFeed([vehicle({ isCertified: true })], LOT);
  assert.equal(cert.rows[0].Certified, 'TRUE');
});

test('DateInStock is unpadded M/D/YYYY in UTC, not ISO', () => {
  assert.equal(toDcDate(new Date('2026-02-07T00:00:00Z')), '2/7/2026');
  assert.equal(toDcDate(new Date('2026-12-18T23:30:00Z')), '12/18/2026');
  assert.equal(toDcDate(new Date('nope')), '');
});

test('money is a bare integer and 0 is their blank, not a free car', () => {
  assert.equal(toMoney(27995), '27995');
  assert.equal(toMoney(27995.4), '27995');
  assert.equal(toMoney(null), '0');
  assert.equal(toMoney(0), '0');
  const { rows } = buildDealerCenterFeed([vehicle({ msrp: null, cost: 0 })], LOT);
  assert.equal(rows[0].MSRP, '0');
  assert.equal(rows[0].Cost, '0');
  assert.ok(!rows[0].SellingPrice.includes('$'));
  assert.ok(!rows[0].SellingPrice.includes(','));
});

test('only SellingPrice carries the live price — Internet_Price stays 0', () => {
  const { rows } = buildDealerCenterFeed([vehicle({ price: 27995, salePrice: 25995 })], LOT);
  assert.equal(rows[0].SellingPrice, '25995');
  assert.equal(rows[0].Internet_Price, '0');
});

test('activePrice takes the sale price only when it is actually lower', () => {
  assert.equal(activePrice({ price: 20000, salePrice: 18000 }), 18000);
  assert.equal(activePrice({ price: 20000, salePrice: 22000 }), 20000);
  assert.equal(activePrice({ price: 20000, salePrice: 0 }), 20000);
  assert.equal(activePrice({ price: 20000, salePrice: null }), 20000);
});

/* ------------------------------------------------------------ value maps */

test('an unmapped enum value becomes blank, never an invented token', () => {
  const { rows } = buildDealerCenterFeed(
    [vehicle({ drivetrain: 'TRACKED', fuelType: 'STEAM', transmission: 'DCT' })],
    LOT,
  );
  assert.equal(rows[0].Drivetrain, '');
  assert.equal(rows[0].Fuel_Type, '');
  assert.equal(rows[0].Transmission, '');
});

test('a null transmission stays blank rather than asserting an automatic', () => {
  const { rows } = buildDealerCenterFeed([vehicle({ transmission: null })], LOT);
  assert.equal(rows[0].Transmission, '');
  assert.equal(rows[0].Transmission_Description, '');
});

test('drivetrain and fuel use the sample’s own spellings', () => {
  const four = buildDealerCenterFeed([vehicle({ drivetrain: 'FOUR_WD' })], LOT);
  assert.equal(four.rows[0].Drivetrain, '4WD');
  const flex = buildDealerCenterFeed([vehicle({ fuelType: 'FLEX' })], LOT);
  assert.equal(flex.rows[0].Fuel_Type, 'Flex Fuel');
  const gas = buildDealerCenterFeed([vehicle({ fuelType: 'GAS' })], LOT);
  assert.equal(gas.rows[0].Fuel_Type, 'Gasoline Fuel');
});

test('Body uses their vocabulary and Doors still says the door count', () => {
  assert.equal(toBody('SEDAN', 4), '4dr Car');
  assert.equal(toBody('SEDAN', 2), '2dr Car');
  assert.equal(toBody('SUV', 4), 'Sport Utility');
  assert.equal(toBody('TRUCK', 4), 'Crew Cab Pickup');
  assert.equal(toBody('TRUCK', 2), 'Extended Cab Pickup');
  assert.equal(toBody('WAGON', 4), 'Station Wagon');
  assert.equal(toBody('TRAVEL_TRAILER', 0), '');
});

test('displacement is pulled from free-text engine, or left blank', () => {
  assert.equal(toDisplacement('Gas V8 5.3L/325'), '5.3L');
  assert.equal(toDisplacement('2.0 L I4'), '2.0L');
  assert.equal(toDisplacement('V6'), '');
  assert.equal(toDisplacement(''), '');
});

/* ----------------------------------------------------------- eligibility */

test('an RV is held out — the format has no vocabulary for one', () => {
  const rv = vehicle({ vehicleType: 'RV_TOWABLE', bodyStyle: 'TRAVEL_TRAILER' });
  assert.ok(evaluate(rv).some((i) => i.code === 'NOT_AN_AUTOMOBILE'));
  const { rows, vehicles } = buildDealerCenterFeed([rv], LOT);
  assert.equal(rows.length, 0);
  assert.equal(vehicles[0].row, null);
});

test('no VIN is held out — DealerCenter matches every record on it', () => {
  assert.ok(evaluate(vehicle({ vin: null })).some((i) => i.code === 'NO_VIN'));
  assert.ok(evaluate(vehicle({ vin: '   ' })).some((i) => i.code === 'NO_VIN'));
});

test('a $0 car is held out rather than sent as free', () => {
  assert.ok(evaluate(vehicle({ price: 0, salePrice: null })).some((i) => i.code === 'NO_PRICE'));
});

test('a photoless unit still goes out — unlike the marketplace feeds', () => {
  const { rows } = buildDealerCenterFeed([vehicle({ status: 'PHOTOS_PENDING', photos: [] })], LOT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ImageList, '');
});

test('recon and arrived units stay out of his inventory file', () => {
  for (const status of ['ARRIVED', 'IN_RECON']) {
    assert.ok(
      evaluate(vehicle({ status })).some((i) => i.code === 'NOT_RETAIL_READY'),
      status,
    );
  }
});

test('sold and wholesaled units are dropped by liveWindow', () => {
  const kept = liveWindow([
    { status: 'FRONT_LINE_READY' },
    { status: 'SOLD' },
    { status: 'WHOLESALED' },
    { status: 'PENDING_SALE' },
  ]);
  assert.deepEqual(kept.map((v) => v.status), ['FRONT_LINE_READY', 'PENDING_SALE']);
});

test('every issue reads as something a dealer could act on', () => {
  for (const i of evaluate(vehicle({ vin: null, price: 0, status: 'IN_RECON' }))) {
    assert.ok(i.reason.length > 0, i.code);
    assert.ok(!/undefined|null|\bid\b/i.test(i.reason), i.reason);
  }
});

/* ---------------------------------------------------------------- photos */

test('photos are primary-first and generated SVG tiles never go out', () => {
  const v = vehicle({
    photos: [
      { url: `${BLOB}/c.jpg`, sortOrder: 3 },
      { url: '/api/photo?vin=1GCRKSE35BZ123456', sortOrder: 0 },
      { url: `${BLOB}/b.jpg`, sortOrder: 2, isPrimary: true },
    ],
  });
  assert.deepEqual(feedablePhotos(v, PHOTO_BASE), [`${BLOB}/b.jpg`, `${BLOB}/c.jpg`]);
});

test('a root-relative photo needs photoBase and is dropped without one', () => {
  const v = vehicle({ photos: [{ url: '/uploads/a.jpg' }] });
  assert.deepEqual(feedablePhotos(v, PHOTO_BASE), [`${PHOTO_BASE}/uploads/a.jpg`]);
  assert.deepEqual(feedablePhotos(v), []);
});

test('ImageList packs URLs with a comma, inside the quoted field', () => {
  const v = vehicle({
    photos: [
      { url: `${BLOB}/a.jpg`, isPrimary: true },
      { url: `${BLOB}/b.jpg`, sortOrder: 2 },
    ],
  });
  const { rows, columns } = buildDealerCenterFeed([v], LOT);
  assert.equal(rows[0].ImageList, `${BLOB}/a.jpg${MULTI_VALUE_SEPARATOR}${BLOB}/b.jpg`);
  const line = toCsv(columns, rows).split('\r\n')[1];
  assert.ok(line.includes(`"${BLOB}/a.jpg,${BLOB}/b.jpg"`));
});

/* ------------------------------------------------------------------- csv */

test('every field is quoted and the file is CRLF-terminated', () => {
  const csv = toCsv(['A', 'B'], [{ A: 'x', B: 'y' }]);
  assert.equal(csv, '"A","B"\r\n"x","y"\r\n');
});

test('a description full of commas and quotes survives the round trip', () => {
  const csv = toCsv(['Description'], [{ Description: 'Loaded, clean, "one owner"' }]);
  assert.equal(csv, '"Description"\r\n"Loaded, clean, ""one owner"""\r\n');
});

test('newlines inside a field are flattened, not escaped', () => {
  const csv = toCsv(['Description'], [{ Description: 'line one\r\nline two' }]);
  assert.equal(csv, '"Description"\r\n"line one line two"\r\n');
  assert.equal(csv.split('\r\n').length, 3);
});

test('a missing key renders empty rather than "undefined"', () => {
  assert.equal(toCsv(['A', 'B'], [{ A: 'x' }]), '"A","B"\r\n"x",""\r\n');
});

test('options and features are merged into one comma-packed Options field', () => {
  const { rows } = buildDealerCenterFeed(
    [vehicle({ options: ['Bluetooth', ''], features: ['Tow Package'] })],
    LOT,
  );
  assert.equal(rows[0].Options, 'Bluetooth,Tow Package');
});

/* ----------------------------------------------------------- connections */

test('only carrying connection states put a lot in the file', () => {
  assert.ok(inDealerCenterFile('CONNECTED'));
  assert.ok(inDealerCenterFile('SUBMITTED'));
  assert.ok(inDealerCenterFile('ERROR'));
  assert.ok(!inDealerCenterFile('AWAITING_DEALER'));
  assert.ok(!inDealerCenterFile(null));
  assert.ok(!inDealerCenterFile(undefined));
});

/* --------------------------------------------------------------- blockers */

test('a file with no DCID is refused — it cannot be matched to an account', () => {
  const b = dealerCenterBlocker({ dcid: '', status: 'CONNECTED', sent: 35 });
  assert.match(b ?? '', /DCID/);
});

test('an empty file is refused, because it can delist the whole lot', () => {
  const b = dealerCenterBlocker({ dcid: '23548716', status: 'CONNECTED', sent: 0 });
  assert.match(b ?? '', /delist/);
});

test('a lot with no connection, or a non-carrying one, is refused', () => {
  assert.ok(dealerCenterBlocker({ dcid: '23548716', status: null, sent: 35 }));
  assert.ok(dealerCenterBlocker({ dcid: '23548716', status: 'AWAITING_DEALER', sent: 35 }));
  assert.ok(dealerCenterBlocker({ dcid: '23548716', status: 'DISCONNECTED', sent: 35 }));
});

test('a real file with a DCID and rows is not blocked', () => {
  for (const status of ['CONNECTED', 'SUBMITTED', 'ERROR']) {
    assert.equal(dealerCenterBlocker({ dcid: '23548716', status, sent: 35 }), null, status);
  }
});

test('blocker text is written for a person, not a log', () => {
  const b = dealerCenterBlocker({ dcid: '23548716', status: 'AWAITING_DEALER', sent: 35 });
  assert.ok(!/AWAITING_DEALER/.test(b ?? ''));
});
