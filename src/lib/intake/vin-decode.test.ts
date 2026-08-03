/**
 * Tests for the vPIC → Rooftop mapping.
 *
 * vPIC's columns are free text with no schema behind them, so every rule in
 * `vpicToExtraction` is a judgement call about somebody else's string — and the
 * failure mode is silent. A Prius listed as a plain gas car, a Sport Utility
 * Truck filed under SUV, an Automated Manual saved as MANUAL: none of those
 * throw, they just publish something slightly wrong to every channel.
 *
 * The rows below are recorded shapes, not invented ones. Hermetic — no network,
 * no database.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { vpicToExtraction, type VpicRow } from './vin-decode';

const base: VpicRow = { ErrorCode: '0' };
const row = (r: Partial<VpicRow>): VpicRow => ({ ...base, ...r });

/* ------------------------------------------------------------- body style */

test('a sedan is a sedan', () => {
  const e = vpicToExtraction(row({ BodyClass: 'Sedan/Saloon' }));
  assert.equal(e.bodyStyle?.value, 'SEDAN');
  assert.equal(e.bodyStyle?.source, 'vin');
  assert.equal(e.bodyStyle?.confidence, 'high');
});

/**
 * Regression, and the expensive kind. This is vPIC's single most common SUV
 * value and it contains the substring "MPV". The first rule ordering here put
 * the van pattern above the SUV pattern, so every SUV decoded as a minivan —
 * no error, no warning, just wrong body style syndicated everywhere.
 */
test("vPIC's combined SUV/MPV label maps to SUV, not to a van", () => {
  const e = vpicToExtraction(
    row({ BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)' }),
  );
  assert.equal(e.bodyStyle?.value, 'SUV');
});

test('an actual minivan is still a van', () => {
  assert.equal(vpicToExtraction(row({ BodyClass: 'Minivan' })).bodyStyle?.value, 'VAN');
  assert.equal(vpicToExtraction(row({ BodyClass: 'Van' })).bodyStyle?.value, 'VAN');
});

test('a pickup is a truck', () => {
  assert.equal(vpicToExtraction(row({ BodyClass: 'Pickup' })).bodyStyle?.value, 'TRUCK');
});

/**
 * The ordering trap. "Sport Utility Truck (SUT)" contains both "Utility" and
 * "Truck"; a naive rule list files an Avalanche under SUV.
 */
test('a Sport Utility Truck is a truck, not an SUV', () => {
  assert.equal(
    vpicToExtraction(row({ BodyClass: 'Sport Utility Truck (SUT)' })).bodyStyle?.value,
    'TRUCK',
  );
});

test('a cargo van is a van', () => {
  assert.equal(vpicToExtraction(row({ BodyClass: 'Cargo Van' })).bodyStyle?.value, 'VAN');
});

test('a crossover is an SUV', () => {
  assert.equal(
    vpicToExtraction(row({ BodyClass: 'Crossover Utility Vehicle (CUV)' })).bodyStyle?.value,
    'SUV',
  );
});

test('a roadster is a convertible', () => {
  assert.equal(vpicToExtraction(row({ BodyClass: 'Roadster' })).bodyStyle?.value, 'CONVERTIBLE');
});

test('falls back to VehicleType when BodyClass is empty', () => {
  assert.equal(
    vpicToExtraction(row({ BodyClass: '', VehicleType: 'TRUCK' })).bodyStyle?.value,
    'TRUCK',
  );
});

/* ------------------------------------------------------------------- fuel */

/**
 * The one that matters most commercially. A Prius reports FuelTypePrimary
 * "Gasoline" — the hybrid-ness lives in a separate column entirely. Reading fuel
 * type alone lists every hybrid on the lot as a plain gas car.
 */
test('a hybrid is found in ElectrificationLevel, not in fuel type', () => {
  const e = vpicToExtraction(
    row({ FuelTypePrimary: 'Gasoline', ElectrificationLevel: 'Strong HEV' }),
  );
  assert.equal(e.fuelType?.value, 'HYBRID');
});

test('a plug-in hybrid outranks plain hybrid', () => {
  const e = vpicToExtraction(
    row({ FuelTypePrimary: 'Gasoline', ElectrificationLevel: 'PHEV (Plug-in Hybrid Electric Vehicle)' }),
  );
  assert.equal(e.fuelType?.value, 'PLUGIN_HYBRID');
});

test('a BEV is electric', () => {
  const e = vpicToExtraction(
    row({ FuelTypePrimary: 'Electric', ElectrificationLevel: 'BEV (Battery Electric Vehicle)' }),
  );
  assert.equal(e.fuelType?.value, 'ELECTRIC');
});

test('flex fuel is recognised from the FFV wording', () => {
  const e = vpicToExtraction(row({ FuelTypePrimary: 'Flexible Fuel Vehicle (FFV)' }));
  assert.equal(e.fuelType?.value, 'FLEX');
});

test('diesel is diesel', () => {
  assert.equal(vpicToExtraction(row({ FuelTypePrimary: 'Diesel' })).fuelType?.value, 'DIESEL');
});

test('an unknown fuel string is left blank rather than guessed as gas', () => {
  assert.equal(vpicToExtraction(row({ FuelTypePrimary: 'Compressed Natural Gas (CNG)' })).fuelType, undefined);
});

/* ----------------------------------------------------------- transmission */

test('CVT is matched before anything else', () => {
  const e = vpicToExtraction(row({ TransmissionStyle: 'Continuously Variable Transmission (CVT)' }));
  assert.equal(e.transmission?.value, 'CVT');
});

/** "Automated Manual Transmission" contains "Manual" but drives as an automatic. */
test('an automated manual is an automatic, not a manual', () => {
  const e = vpicToExtraction(row({ TransmissionStyle: 'Automated Manual Transmission (AMT)' }));
  assert.equal(e.transmission?.value, 'AUTOMATIC');
});

test('a dual-clutch is an automatic', () => {
  const e = vpicToExtraction(row({ TransmissionStyle: 'Dual-Clutch Transmission (DCT)' }));
  assert.equal(e.transmission?.value, 'AUTOMATIC');
});

test('a real manual is a manual', () => {
  assert.equal(
    vpicToExtraction(row({ TransmissionStyle: 'Manual/Standard' })).transmission?.value,
    'MANUAL',
  );
});

/* ------------------------------------------------------------- drivetrain */

test('4x4 is four-wheel drive', () => {
  assert.equal(
    vpicToExtraction(row({ DriveType: '4WD/4-Wheel Drive/4x4' })).drivetrain?.value,
    'FOUR_WD',
  );
});

test('AWD is not mistaken for 4WD', () => {
  assert.equal(vpicToExtraction(row({ DriveType: 'AWD/All-Wheel Drive' })).drivetrain?.value, 'AWD');
});

test('front-wheel drive', () => {
  assert.equal(vpicToExtraction(row({ DriveType: 'FWD/Front-Wheel Drive' })).drivetrain?.value, 'FWD');
});

/* ------------------------------------------------------------------- make */

test('vPIC shouts, we do not', () => {
  assert.equal(vpicToExtraction(row({ Make: 'TOYOTA' })).make?.value, 'Toyota');
});

test('hyphenated makes title-case correctly', () => {
  assert.equal(vpicToExtraction(row({ Make: 'MERCEDES-BENZ' })).make?.value, 'Mercedes-Benz');
});

test('initialism marques keep their spelling', () => {
  assert.equal(vpicToExtraction(row({ Make: 'BMW' })).make?.value, 'BMW');
  assert.equal(vpicToExtraction(row({ Make: 'GMC' })).make?.value, 'GMC');
  assert.equal(vpicToExtraction(row({ Make: 'MINI' })).make?.value, 'MINI');
});

/* ----------------------------------------------------------------- engine */

test('engine text is built from displacement and cylinders', () => {
  const e = vpicToExtraction(row({ DisplacementL: '2.5000000000', EngineCylinders: '4' }));
  assert.equal(e.engine?.value, '2.5L 4-Cylinder');
  assert.equal(e.cylinders?.value, 4);
});

test('a V configuration is named', () => {
  const e = vpicToExtraction(
    row({ DisplacementL: '3.5', EngineCylinders: '6', EngineConfiguration: 'V-Shaped' }),
  );
  assert.equal(e.engine?.value, '3.5L V6-Cylinder');
});

test('displacement alone still produces an engine', () => {
  assert.equal(vpicToExtraction(row({ DisplacementL: '2.0' })).engine?.value, '2.0L');
});

/* ------------------------------------------------------- absence handling */

/**
 * vPIC writes several different flavours of "nothing" and they all have to be
 * treated as nothing — "Not Applicable" in the engine field would otherwise be
 * published as the engine.
 */
test('vPIC\'s many spellings of empty are all empty', () => {
  const e = vpicToExtraction(
    row({ Make: 'Not Applicable', Model: '', Trim: 'null', Doors: '0', BodyClass: 'N/A' }),
  );
  assert.deepEqual(e, {});
});

test('trim comes from Series when Trim is empty, at lower confidence', () => {
  const e = vpicToExtraction(row({ Trim: '', Series: 'XSE' }));
  assert.equal(e.trim?.value, 'XSE');
  assert.equal(e.trim?.confidence, 'medium');
});

test('an implausible door count is dropped', () => {
  assert.equal(vpicToExtraction(row({ Doors: '99' })).doors, undefined);
});

/* -------------------------------------------------------- a whole vehicle */

test('a recorded 2019 Camry row comes out whole', () => {
  const e = vpicToExtraction(
    row({
      ModelYear: '2019',
      Make: 'TOYOTA',
      Model: 'Camry',
      Series: 'XSE',
      BodyClass: 'Sedan/Saloon',
      Doors: '4',
      DisplacementL: '2.5',
      EngineCylinders: '4',
      TransmissionStyle: 'Automatic',
      DriveType: 'FWD/Front-Wheel Drive',
      FuelTypePrimary: 'Gasoline',
    }),
  );
  assert.equal(e.year?.value, 2019);
  assert.equal(e.make?.value, 'Toyota');
  assert.equal(e.model?.value, 'Camry');
  assert.equal(e.trim?.value, 'XSE');
  assert.equal(e.bodyStyle?.value, 'SEDAN');
  assert.equal(e.doors?.value, 4);
  assert.equal(e.engine?.value, '2.5L 4-Cylinder');
  assert.equal(e.transmission?.value, 'AUTOMATIC');
  assert.equal(e.drivetrain?.value, 'FWD');
  assert.equal(e.fuelType?.value, 'GAS');

  // Everything vPIC is authoritative about is high confidence except trim.
  for (const key of ['year', 'make', 'model', 'bodyStyle', 'drivetrain', 'fuelType'] as const) {
    assert.equal(e[key]?.confidence, 'high', `${key} should be high confidence`);
    assert.equal(e[key]?.source, 'vin', `${key} should be sourced from the VIN`);
  }
});
