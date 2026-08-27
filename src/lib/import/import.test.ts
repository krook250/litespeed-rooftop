import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv } from './csv';
import {
  cleanDescription, deriveStockNumber, inferMapping, splitUrls, toBodyStyle,
  toCylinders, toDoors, toDrivetrain, toFuelType, toMileage, toMoney,
  toTransmission, toYear, unmappedRequired,
} from './mapping';
import { planImport } from './plan';

/**
 * Tested where an import can silently lie.
 *
 * Every case below is either something the first real file we were handed
 * actually does, or something that would have imported cleanly and wrong. A
 * bad import does not throw — it produces twenty-one plausible vehicles with
 * the wrong number of cylinders, and nobody finds out until a buyer does.
 *
 * No database, no network. Run with `npm test`.
 */

/* --------------------------------------------------------------- the parser */

describe('reading a CSV a dealer actually sent', () => {
  it('keeps a quoted field containing newlines as one field', () => {
    const t = parseCsv('a,b\n"line one\nline two",second\n');
    assert.equal(t.rows.length, 1);
    assert.equal(t.rows[0]!.a, 'line one\nline two');
    assert.equal(t.rows[0]!.b, 'second');
  });

  it('keeps a quoted field containing commas as one field', () => {
    // This is the whole reason the file is 137KB for 21 vehicles.
    const t = parseCsv('vin,images\nX,"https://a.jpg,https://b.jpg,https://c.jpg"\n');
    assert.equal(t.rows.length, 1);
    assert.equal(t.rows[0]!.images!.split(',').length, 3);
  });

  it('unescapes doubled quotes', () => {
    const t = parseCsv('a\n"He said ""runs great"" twice"\n');
    assert.equal(t.rows[0]!.a, 'He said "runs great" twice');
  });

  it('strips the BOM Excel writes, so the first column still maps', () => {
    const t = parseCsv('﻿VIN,Make\n1,Ford\n');
    assert.deepEqual(t.headers, ['VIN', 'Make']);
    assert.equal(t.rows[0]!.VIN, '1');
  });

  it('handles CRLF, LF and a file with both', () => {
    const t = parseCsv('a,b\r\n1,2\n3,4\r\n');
    assert.equal(t.rows.length, 2);
    assert.deepEqual(t.rows.map((r) => r.a), ['1', '3']);
  });

  it('reads a last row with no trailing newline', () => {
    assert.equal(parseCsv('a\n1').rows.length, 1);
  });

  it('reports ragged rows instead of throwing them away', () => {
    const t = parseCsv('a,b\n1,2,3\n4\n');
    assert.equal(t.ragged.length, 2);
    assert.equal(t.rows[1]!.b, '');
  });

  it('ignores blank lines', () => {
    assert.equal(parseCsv('a\n1\n\n2\n\n').rows.length, 2);
  });
});

/* ------------------------------------------------------------- the mapping */

describe('guessing which column is which', () => {
  it('maps the CarsForSale export end to end', () => {
    const headers = ['VIN', 'Type', 'StockNumber', 'Make', 'Model', 'ModelYear', 'Trim',
      'BodyStyle', 'Mileage', 'EngineDescription', 'Cylinders', 'FuelType', 'Transmission',
      'Price', 'ExteriorColor', 'InteriorColor', 'OptionText', 'Description', 'images'];
    const m = inferMapping(headers);
    assert.deepEqual(unmappedRequired(m), []);
    assert.equal(m.year, 'ModelYear');
    assert.equal(m.photos, 'images');
    assert.equal(m.options, 'OptionText');
    assert.equal(m.engine, 'EngineDescription');
  });

  it('never assigns one column to two fields', () => {
    const m = inferMapping(['VIN', 'Price', 'SalePrice', 'MSRP']);
    const used = Object.values(m);
    assert.equal(new Set(used).size, used.length);
  });

  it('reports a missing required column rather than guessing at one', () => {
    // No fuzzy matching: "Cost" is not a price, however much it looks like one.
    const m = inferMapping(['VIN', 'Make', 'Model', 'ModelYear', 'Mileage', 'Cost']);
    assert.deepEqual(unmappedRequired(m), ['price']);
  });
});

/* ---------------------------------------------------------- the normalisers */

describe('reading values that are not what their column is called', () => {
  it('reads cylinders out of a displacement string', () => {
    // The column is named Cylinders and contains "3.6L V6". Read as a number
    // that is a three-cylinder Silverado.
    assert.equal(toCylinders('3.6L V6'), 6);
    assert.equal(toCylinders('5.3L V8'), 8);
    assert.equal(toCylinders('6.7L V8'), 8);
    assert.equal(toCylinders('I4 2.0L'), 4);
    assert.equal(toCylinders('4 Cylinder'), 4);
    assert.equal(toCylinders('6'), 6);
  });

  it('does not take a displacement as a cylinder count', () => {
    assert.equal(toCylinders('3.6'), null);
    assert.equal(toCylinders('2.0L'), null);
  });

  it('files a chassis cab as a truck and says it approximated', () => {
    assert.deepEqual(toBodyStyle('Chassis'), { value: 'TRUCK', exact: false });
    assert.deepEqual(toBodyStyle('Pickup Truck'), { value: 'TRUCK', exact: true });
    assert.deepEqual(toBodyStyle('SUV'), { value: 'SUV', exact: true });
    assert.deepEqual(toBodyStyle('Weather Balloon'), { value: null, exact: false });
  });

  it('refuses to turn "Unspecified" into an automatic', () => {
    assert.equal(toTransmission('Unspecified'), null);
    assert.equal(toTransmission('Automatic 8-Speed'), 'AUTOMATIC');
    assert.equal(toTransmission('Manual 5-Speed'), 'MANUAL');
    assert.equal(toTransmission('CVT'), 'CVT');
  });

  it('reads plug-in hybrid before hybrid', () => {
    assert.equal(toFuelType('Plug-In Hybrid'), 'PLUGIN_HYBRID');
    assert.equal(toFuelType('Hybrid'), 'HYBRID');
    assert.equal(toFuelType('Flex Fuel'), 'FLEX');
    assert.equal(toFuelType('Gasoline'), 'GAS');
    assert.equal(toFuelType('Diesel'), 'DIESEL');
  });

  it('finds the drivetrain in the trim string, where this file keeps it', () => {
    assert.equal(toDrivetrain(undefined, 'Work Truck 4x4 4dr Crew Cab 5 ft. SB'), 'FOUR_WD');
    assert.equal(toDrivetrain(undefined, 'Premier 4dr SUV'), null);
    assert.equal(toDrivetrain('AWD'), 'AWD');
    assert.equal(toDrivetrain(undefined, 'LT 4x2'), 'RWD');
  });

  it('finds the door count in the trim string', () => {
    assert.equal(toDoors(undefined, '4dr Crew Cab'), 4);
    assert.equal(toDoors(undefined, '2dr Coupe'), 2);
    assert.equal(toDoors('4'), 4);
    assert.equal(toDoors(undefined, 'Crew Cab'), null);
  });

  it('parses money and mileage the way a spreadsheet writes them', () => {
    assert.equal(toMoney('$13,999.00'), 13999);
    assert.equal(toMoney('13999'), 13999);
    assert.equal(toMoney(''), null);
    assert.equal(toMoney('0'), null, 'a zero price is missing, not free');
    assert.equal(toMileage('177,414'), 177414);
    assert.equal(toMileage('0'), 0, 'zero miles is a real reading');
  });

  it('rejects a year that is a parse accident', () => {
    assert.equal(toYear('2022'), 2022);
    assert.equal(toYear('22'), null);
    assert.equal(toYear(''), null);
  });

  it('dedupes photo URLs and drops anything that is not one', () => {
    const urls = splitUrls('https://a.jpg,https://b.jpg,https://a.jpg, ,not-a-url');
    assert.deepEqual(urls, ['https://a.jpg', 'https://b.jpg']);
  });
});

/* --------------------------------------------------------- the description */

describe('taking the dealership out of the ad copy', () => {
  it('removes the phone number and the word in front of it', () => {
    // Stripping only the digits leaves "Phone:" in the listing, which reads as
    // a bug to whoever sees it.
    const { text, removed } = cleanDescription('**Phone: 321-390-4793** Runs great.');
    assert.ok(!text.includes('321'));
    assert.ok(!/phone/i.test(text), text);
    assert.match(removed.join(' '), /phone number/);
  });

  it('leaves no empty brackets behind', () => {
    const { text } = cleanDescription('2018 Suburban (Call: 321-390-4793) low miles');
    assert.ok(!text.includes('('), text);
    assert.match(text, /2018 Suburban\s+low miles/);
  });

  it('removes the dealership street address', () => {
    const { text, removed } = cleanDescription('Location: 6185 Babcock St., Palm Bay, FL — clean truck');
    assert.ok(!/Babcock/.test(text), text);
    assert.ok(!/Location/.test(text), text);
    assert.match(removed.join(' '), /street address/);
  });

  it('does NOT eat ordinary prose that contains a number', () => {
    // The capitalisation requirement in STREET is what makes this pass. An `i`
    // flag turns "20 years on the road" into a street address.
    for (const s of [
      'Runs great after 20 years on the road.',
      'Only 15 minutes from the highway.',
      'Serviced every 5000 miles like clockwork.',
    ]) {
      assert.equal(cleanDescription(s).text, s, s);
    }
  });

  it('flattens markdown without dropping the words', () => {
    const { text } = cleanDescription('### Title\n\n**Key Features:**\n- Ice-cold AC\n- Backup camera');
    assert.ok(!text.includes('#'));
    assert.ok(!text.includes('**'));
    assert.match(text, /Ice-cold AC/);
    assert.match(text, /Backup camera/);
  });

  it('says nothing was removed when nothing was', () => {
    assert.deepEqual(cleanDescription('Clean one-owner truck.'), {
      text: 'Clean one-owner truck.',
      removed: [],
    });
  });
});

/* ------------------------------------------------------------------- plan */

const HEADERS = ['VIN', 'StockNumber', 'Make', 'Model', 'ModelYear', 'Trim', 'BodyStyle',
  'Mileage', 'Price', 'Transmission', 'FuelType', 'images'];
const REAL_VIN = '1GCGTBEN7N1133507';
const OTHER_VIN = '1GNSCJKC3JR266906';

function row(over: Record<string, string> = {}): Record<string, string> {
  return {
    VIN: REAL_VIN, StockNumber: '', Make: 'Chevrolet', Model: 'Colorado', ModelYear: '2022',
    Trim: 'Work Truck 4x4 4dr Crew Cab', BodyStyle: 'Pickup Truck', Mileage: '177414',
    Price: '13999', Transmission: 'Automatic 8-Speed', FuelType: 'Gasoline',
    images: 'https://cdn05.carsforsale.com/a.jpg', ...over,
  };
}
const MAP = inferMapping(HEADERS);

describe('planning an import', () => {
  it('creates a vehicle from a good row', () => {
    const p = planImport([row()], MAP);
    assert.equal(p.summary.create, 1);
    assert.equal(p.rows[0]!.action, 'create');
    assert.equal(p.rows[0]!.draft!.bodyStyle, 'TRUCK');
    assert.equal(p.rows[0]!.draft!.drivetrain, 'FOUR_WD');
  });

  it('derives a stock number from the VIN, stably', () => {
    const a = planImport([row()], MAP).rows[0]!.draft!.stockNumber;
    const b = planImport([row()], MAP).rows[0]!.draft!.stockNumber;
    // A counter or a timestamp here makes tonight's re-import look like a lot
    // full of new cars.
    assert.equal(a, b);
    assert.equal(a, deriveStockNumber(REAL_VIN));
    assert.equal(a, '133507');
  });

  it('calls an existing VIN an update, not a duplicate', () => {
    const p = planImport([row()], MAP, { existingVins: [REAL_VIN] });
    assert.equal(p.rows[0]!.action, 'update');
    assert.equal(p.summary.update, 1);
  });

  it('matches an existing VIN regardless of case', () => {
    const p = planImport([row()], MAP, { existingVins: [REAL_VIN.toLowerCase()] });
    assert.equal(p.rows[0]!.action, 'update');
  });

  it('skips the second copy of a VIN in one file', () => {
    const p = planImport([row(), row()], MAP);
    assert.equal(p.rows[0]!.action, 'create');
    assert.equal(p.rows[1]!.action, 'skip');
    assert.equal(p.rows[1]!.issues[0]!.code, 'DUPLICATE_VIN_IN_FILE');
  });

  it('skips a row missing anything the schema requires', () => {
    const p = planImport([row({ Price: '' }), row({ VIN: OTHER_VIN, Mileage: '' })], MAP);
    assert.equal(p.summary.skip, 2);
    assert.match(p.rows[0]!.issues.map((i) => i.message).join(' '), /No price/);
    assert.match(p.rows[1]!.issues.map((i) => i.message).join(' '), /No mileage/);
  });

  it('skips a row rather than filing an unknown body style as a sedan', () => {
    const p = planImport([row({ BodyStyle: 'Weather Balloon' })], MAP);
    assert.equal(p.rows[0]!.action, 'skip');
    assert.equal(p.rows[0]!.issues[0]!.code, 'BODY_STYLE_UNRECOGNISED');
  });

  it('imports a VIN that fails its check digit, but says so', () => {
    // 17 legal characters with a wrong position 9. Better in the system flagged
    // than silently dropped.
    const bad = '1GCGTBEN1N1133507';
    const p = planImport([row({ VIN: bad })], MAP);
    assert.equal(p.rows[0]!.action, 'create');
    assert.ok(p.rows[0]!.issues.some((i) => i.code === 'VIN_CHECKSUM_FAILED'));
  });

  it('skips a row whose VIN is not a VIN', () => {
    const p = planImport([row({ VIN: 'ABC123' }), row({ VIN: '' })], MAP);
    assert.equal(p.rows[0]!.issues[0]!.code, 'BAD_VIN');
    assert.equal(p.rows[1]!.issues[0]!.code, 'MISSING_VIN');
    assert.equal(p.summary.skip, 2);
  });

  it('warns when a default would be wrong rather than letting it happen quietly', () => {
    const p = planImport([row({ Transmission: 'Unspecified', Trim: 'Premier 4dr' })], MAP);
    const codes = p.rows[0]!.issues.map((i) => i.code);
    // Column defaults are AUTOMATIC and FWD. On a manual, or on a truck, both
    // are wrong and neither would raise anything on its own.
    assert.ok(codes.includes('TRANSMISSION_UNKNOWN'));
    assert.ok(codes.includes('DRIVETRAIN_UNKNOWN'));
    assert.equal(p.rows[0]!.action, 'create', 'still imports');
  });

  it('every issue on an imported row is a warning, and every skip has an error', () => {
    const p = planImport([row(), row({ VIN: 'ABC123' })], MAP);
    for (const r of p.rows) {
      const hasError = r.issues.some((i) => i.severity === 'error');
      assert.equal(hasError, r.action === 'skip', `line ${r.line}`);
    }
  });

  it('counts photos across the whole plan', () => {
    const p = planImport([row({ images: 'https://a.jpg,https://b.jpg' })], MAP);
    assert.equal(p.summary.photos, 2);
    assert.ok(p.rows[0]!.issues.some((i) => i.code === 'PHOTOS_OFF_SITE'));
  });

  it('flags a row with no photos at all', () => {
    const p = planImport([row({ images: '' })], MAP);
    assert.ok(p.rows[0]!.issues.some((i) => i.code === 'NO_PHOTOS'));
    assert.equal(p.rows[0]!.action, 'create');
  });

  it('an empty file plans nothing and does not crash', () => {
    const p = planImport([], MAP);
    assert.deepEqual(p.rows, []);
    assert.equal(p.summary.total, 0);
  });
});
