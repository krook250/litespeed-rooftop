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
 *
 * `dotenv/config` is imported for a reason that has nothing to do with these
 * tests: `./vin-decode` imports `@/db`, which THROWS at module load when
 * DATABASE_URL is unset, and `src/db/index.ts` does not load dotenv itself. So
 * this hermetic file was the one failure in `npm test` — not because anything
 * here needs a database, but because the import chain could not be constructed.
 * postgres-js connects lazily, so loading the config opens no socket.
 */

import 'dotenv/config';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { vpicClass, vpicToExtraction, type VpicRow } from './vin-decode';

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

/* ------------------------------------------------------- RV: what a VIN is not

   A VIN identifies a chassis. On a car that is the vehicle; on an RV it is not,
   and vPIC answers about the chassis with the same "high confidence" it uses for
   a Camry. These rows are recorded shapes from the live API, decoded 7 Sep 2026.
   See `claude/rv-vertical-fit.md`. */

test('a motorhome chassis asserts nothing but the year', () => {
  // Real shape for WMI 1F6, MY2008 — the chassis under a Class A coach such as
  // the 2008 Gulf Stream Sun Voyager. vPIC has never heard of Gulf Stream.
  const e = vpicToExtraction(
    row({
      VehicleType: 'INCOMPLETE VEHICLE',
      ModelYear: '2008',
      Make: 'FORD',
      BodyClass: 'Incomplete - Chassis Cab',
      DriveType: 'RWD/Rear-Wheel Drive',
      FuelTypePrimary: 'Gasoline',
      Doors: '2',
      EngineCylinders: '8',
      DisplacementL: '6.8',
    }),
  );

  assert.equal(e.year?.value, 2008, 'the model year code means the same thing on any chassis');

  // The four that would each have produced a wrong listing.
  assert.equal(e.make, undefined, 'FORD is the chassis builder, not the coach');
  assert.equal(e.bodyStyle, undefined, 'BODY_RULES matches /incomplete/ and would file it as a TRUCK');
  assert.equal(e.drivetrain, undefined, 'the chassis drivetrain is not a spec anyone advertises on a coach');
  assert.equal(e.fuelType, undefined);
  assert.equal(e.model, undefined);
  assert.equal(e.doors, undefined);
  assert.equal(e.cylinders, undefined);
  assert.equal(e.engine, undefined);
});

test('a towable keeps its make and gives up its model', () => {
  // Real shape for a Forest River trailer WMI (4X4), MY2022.
  const e = vpicToExtraction(
    row({
      VehicleType: 'TRAILER',
      BodyClass: 'Trailer',
      ModelYear: '2022',
      Make: 'FOREST RIVER',
      Model: 'Wildwood Towables',
      TrailerBodyType: 'Camping or Travel Trailer',
      TrailerType: 'Ball Type Pull',
      TrailerLength: '26',
      Axles: '2',
    }),
  );

  assert.equal(e.year?.value, 2022);
  assert.equal(e.make?.value, 'Forest River', 'the trailer builder IS the make');

  /* The one that matters most. "Wildwood Towables" is the product family; the
     unit a shopper is searching for is a "2301BHS". Filing the family as the
     model produces a listing that matches nothing anyone types. */
  assert.equal(e.model, undefined, 'vPIC gives the family, never the floorplan');

  // Car-shaped fields on a box with two axles and no engine.
  assert.equal(e.bodyStyle, undefined);
  assert.equal(e.transmission, undefined);
  assert.equal(e.drivetrain, undefined);
  assert.equal(e.fuelType, undefined);
});

test('the classifier reads vPIC, not our own column', () => {
  assert.equal(vpicClass(row({ VehicleType: 'PASSENGER CAR' })), 'CAR');
  assert.equal(vpicClass(row({ VehicleType: 'TRAILER' })), 'TRAILER');
  assert.equal(vpicClass(row({ VehicleType: 'INCOMPLETE VEHICLE' })), 'INCOMPLETE');

  /* Absent VehicleType falls through to CAR rather than to a safe-looking
     nothing. Every VIN decoded before this change had no classification and was
     treated as a car; that must keep being true or the importer quietly stops
     filling drivetrain on the whole existing fleet. */
  assert.equal(vpicClass(row({})), 'CAR');
});
