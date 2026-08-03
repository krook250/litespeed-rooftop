/**
 * Tests for the deterministic pass.
 *
 * These exist because this is the layer that used to be debugged by taking
 * another photo. Every case below is a real failure mode from document intake —
 * OCR turning O into 0, a model year being read as an odometer, "clean and clear
 * of all liens" branding a title CLEAN — and each one is now a second to check
 * instead of an afternoon to reproduce.
 *
 * Run with `npm test`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  expectedCheckDigit,
  findColors,
  findMileage,
  findPrices,
  findStockNumber,
  findTitleStatus,
  findVins,
  normaliseVin,
  parseText,
  resolveColor,
} from './parse';

/** Real, check-digit-valid VINs. */
const HONDA = '1HGCM82633A004352';
const ACURA = 'JH4TB2H26CC000000';
const TESLA = '5YJ3E1EA6PF384836';

/* -------------------------------------------------------------------- VIN */

test('accepts a VIN that satisfies its check digit', () => {
  const [best] = findVins(`VEHICLE IDENTIFICATION NUMBER ${HONDA}`);
  assert.equal(best?.vin, HONDA);
  assert.equal(best?.checksums, true);
});

test('repairs the three characters a VIN is not allowed to contain', () => {
  // What OCR does to 1HGCM82633A004352 on a glossy title.
  const corrupted = 'IHGCM82633AOO4352';
  const [best] = findVins(`VIN: ${corrupted}`);
  assert.equal(best?.vin, HONDA);
  assert.equal(best?.checksums, true);
  assert.equal(best?.repairedFrom, corrupted);
});

test('keeps a VIN whose check digit fails, but marks it', () => {
  // Position 9 changed from 3 to 4 — one wrong character, structurally legal.
  const wrong = '1HGCM82643A004352';
  const [best] = findVins(wrong);
  assert.equal(best?.vin, wrong);
  assert.equal(best?.checksums, false);
});

test('a checksum-clean VIN outranks a broken one on the same page', () => {
  const page = `PRIOR VIN 1HGCM82643A004352\nCURRENT VIN ${ACURA}`;
  const [best] = findVins(page);
  assert.equal(best?.vin, ACURA);
  assert.equal(best?.checksums, true);
});

test('finds a VIN split across a line wrap', () => {
  const [best] = findVins(`VIN 1HGCM826\n33A004352 END`);
  assert.equal(best?.vin, HONDA);
});

test('finds a hyphenated VIN', () => {
  const [best] = findVins('VIN: 1HG-CM826-33A004352');
  assert.equal(best?.vin, HONDA);
});

/**
 * Regression. The first implementation slid a 17-character window across the
 * whole page with the whitespace removed, so a window could begin inside one
 * word and end inside the next. The check digit is mod-11, so roughly one in
 * eleven of those accidents validates — and this exact string produced a
 * confident, clean-checksumming VIN made of the word ACCOUNT and somebody's
 * account number.
 */
test('does not invent a VIN by stitching adjacent words together', () => {
  const found = findVins('ACCOUNT 483920184839201847 PAID');
  assert.equal(found.some((c) => c.checksums), false);
});

test('a page of long numbers yields no confident VIN', () => {
  const noise = [
    'ROUTING 021000021 ACCOUNT 4839201848392018',
    'INVOICE 88401923 LOT 5591 BUYER 100238',
    'PHONE 3213344477 TAX ID 593827461',
  ].join('\n');
  assert.equal(findVins(noise).some((c) => c.checksums), false);
});

test('reports what the check digit should have been', () => {
  assert.equal(expectedCheckDigit('1HGCM82643A004352'), '3');
});

test('normaliseVin strips punctuation and repairs illegal characters', () => {
  assert.equal(normaliseVin(' 1hg-cm826 33a004352 ')?.vin, HONDA);
  assert.equal(normaliseVin('too-short'), null);
});

/* ---------------------------------------------------------------- mileage */

test('prefers the labelled odometer reading over the model year', () => {
  const text = '2019 TOYOTA CAMRY\nODOMETER: 84,213\nISSUED 03/2019';
  assert.equal(findMileage(text)?.value, 84_213);
});

test('reads a trailing unit', () => {
  assert.equal(findMileage('shows 112,405 miles at time of sale')?.value, 112_405);
});

test('flags a suspiciously small reading rather than trusting it', () => {
  const f = findMileage('ODOMETER 412 MILES');
  assert.equal(f?.value, 412);
  assert.equal(f?.confidence, 'low');
});

test('returns nothing when no reading is labelled', () => {
  assert.equal(findMileage('2019 TOYOTA CAMRY LE SEDAN 4D'), null);
});

/* ------------------------------------------------------------------ price */

test('separates MSRP from the asking price', () => {
  const text = 'MSRP $34,780\nTOTAL PRICE $28,995';
  const { price, msrp } = findPrices(text);
  assert.equal(msrp?.value, 34_780);
  assert.equal(price?.value, 28_995);
});

test('price is always low confidence, however clean the read', () => {
  const { price } = findPrices('ASKING PRICE: $18,999');
  assert.equal(price?.value, 18_999);
  assert.equal(price?.confidence, 'low');
});

/* ------------------------------------------------------------------ title */

test('does not brand a title from the word "clean" about liens', () => {
  assert.equal(findTitleStatus('This vehicle is clean and clear of all liens.'), null);
});

test('reads a salvage brand', () => {
  assert.equal(findTitleStatus('BRAND: SALVAGE — TOTAL LOSS')?.value, 'SALVAGE');
});

test('salvage outranks rebuilt when both words appear', () => {
  assert.equal(findTitleStatus('PRIOR SALVAGE / REBUILT')?.value, 'SALVAGE');
});

/* ----------------------------------------------------------------- colour */

test('expands a state title colour code', () => {
  assert.equal(resolveColor('BLK'), 'Black');
  assert.equal(resolveColor('SLV'), 'Silver');
});

test("keeps the manufacturer's colour name when there is one", () => {
  assert.equal(resolveColor('Midnight Blue Metallic'), 'Midnight Blue');
});

test('drops a colour it does not recognise rather than guessing', () => {
  assert.equal(resolveColor('ZQX'), null);
});

test('reads exterior and interior separately', () => {
  const { exterior, interior } = findColors('EXT COLOR: WHT\nINT COLOR: BLK');
  assert.equal(exterior?.value, 'White');
  assert.equal(interior?.value, 'Black');
});

/* ------------------------------------------------------------------ stock */

test('reads a stock number but refuses the VIN wearing a stock label', () => {
  assert.equal(findStockNumber('STOCK #: MM-2024-001')?.value, 'MM-2024-001');
  assert.equal(findStockNumber(`STOCK NO ${TESLA}`), null);
});

/* ------------------------------------------------------------- whole pass */

test('a plausible title page comes out whole', () => {
  const page = [
    'STATE OF FLORIDA CERTIFICATE OF TITLE',
    `VEHICLE IDENTIFICATION NUMBER ${HONDA}`,
    'YEAR 2003  MAKE HONDA  BODY 4D',
    'COLOR: SLV',
    'ODOMETER READING: 148,902 MILES',
    'TITLE BRAND: REBUILT',
  ].join('\n');

  const e = parseText(page);
  assert.equal(e.vin?.value, HONDA);
  assert.equal(e.vin?.confidence, 'high');
  assert.equal(e.mileage?.value, 148_902);
  assert.equal(e.exteriorColor?.value, 'Silver');
  assert.equal(e.titleStatus?.value, 'REBUILT');
  // Nothing else was on the page, so nothing else was invented.
  assert.equal(e.price, undefined);
});

test('an empty read produces an empty extraction, not a partial guess', () => {
  assert.deepEqual(parseText('   '), {});
});
