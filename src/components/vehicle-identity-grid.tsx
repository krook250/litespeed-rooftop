'use client';

/**
 * The Identity grid — the only part of the vehicle form that changes shape.
 *
 * A client component for one reason: which fields belong on screen depends on
 * the body style, and the body style can change without a round trip. Everything
 * else in `vehicle-form.tsx` stays a server component.
 *
 * WHY HIDE FIELDS RATHER THAN LEAVE THEM BLANK. A travel trailer has no engine,
 * no drivetrain, no doors in the sense the column means, and no odometer. Left
 * on screen those fields do not sit empty — `drivetrain` defaults to FWD and
 * `doors` to 4 at the column level, so a porter who tabs past them ships a
 * front-wheel-drive fifth wheel with four doors to the storefront and the Meta
 * catalog. That is the front-wheel-drive Explorer bug arriving through the form
 * instead of through an import. A field that cannot be answered correctly should
 * not be askable.
 *
 * Motorized RVs keep fuel, engine and mileage — a Class A genuinely has all
 * three — and lose drivetrain, doors, cylinders and MPG, which are true of the
 * chassis and never advertised on the coach.
 */

import { useState } from 'react';
import type { Vehicle } from '@/db/schema';
import { hasOdometer, isRvBody } from '@/lib/domain';
import {
  LABEL, Select, Text,
  BODY_OPTS, DRIVE_OPTS, FUEL_OPTS, TRANS_OPTS,
  numOrStr, str, type VehiclePrefill,
} from './vehicle-fields';

export function VehicleIdentityGrid({
  vehicle,
  prefill,
}: {
  vehicle?: Vehicle;
  prefill: VehiclePrefill;
}) {
  const v = vehicle;
  const p = prefill;
  const has = (key: string) => p[key] !== undefined && p[key] !== null && p[key] !== '';

  const [body, setBody] = useState<string>(v?.bodyStyle ?? str(p, 'bodyStyle') ?? 'SUV');
  const rv = isRvBody(body);
  /* `hasOdometer` is false only for towables, so it doubles as the tow/drive
     split without a second export to keep in sync with the body-style map. */
  const towable = rv && !hasOdometer(body);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Text name="stockNumber" label="Stock #" defaultValue={v?.stockNumber ?? numOrStr(p, 'stockNumber')} scanned={has('stockNumber')} />
      <Text name="year" label="Year" defaultValue={v?.year ?? numOrStr(p, 'year')} scanned={has('year')} />
      <Text name="make" label="Make" defaultValue={v?.make ?? str(p, 'make')} scanned={has('make')} />
      <Text
        name="model"
        label={rv ? 'Model (e.g. Minnie)' : 'Model'}
        defaultValue={v?.model ?? str(p, 'model')}
        scanned={has('model')}
      />
      {/* On an RV the floorplan IS the trim — model "Minnie", trim "2301BHS",
          the same shape as a Camry XSE. It is also the string shoppers actually
          type, so the label says so rather than leaving it to be guessed. */}
      <Text
        name="trim"
        label={rv ? 'Floorplan (e.g. 2301BHS)' : 'Trim'}
        defaultValue={v?.trim ?? str(p, 'trim')}
        className="sm:col-span-2"
        scanned={has('trim')}
      />
      {!v ? (
        <Text
          name="vin"
          label={rv ? 'VIN (optional)' : 'VIN (blank to generate)'}
          defaultValue={str(p, 'vin')}
          className="sm:col-span-2"
          scanned={has('vin')}
        />
      ) : null}

      <Select
        name="bodyStyle"
        label={rv ? 'RV type' : 'Body'}
        defaultValue={body}
        options={BODY_OPTS}
        onChange={setBody}
        scanned={has('bodyStyle')}
      />

      {!towable ? (
        <Text name="mileage" label="Mileage" defaultValue={v?.mileage ?? numOrStr(p, 'mileage')} scanned={has('mileage')} />
      ) : null}

      {rv ? (
        <>
          <Text name="rvLengthFt" label="Length (ft)" defaultValue={v?.rvLengthFt ?? numOrStr(p, 'rvLengthFt')} />
          <Text name="rvSleeps" label="Sleeps" defaultValue={v?.rvSleeps ?? numOrStr(p, 'rvSleeps')} />
          <Text name="rvSlideouts" label="Slide-outs" defaultValue={v?.rvSlideouts ?? numOrStr(p, 'rvSlideouts')} />
          <Text name="rvGvwrLbs" label="GVWR (lbs)" defaultValue={v?.rvGvwrLbs ?? numOrStr(p, 'rvGvwrLbs')} />
          <Text name="rvDryWeightLbs" label="Dry weight (lbs)" defaultValue={v?.rvDryWeightLbs ?? numOrStr(p, 'rvDryWeightLbs')} />
          <Text name="rvAcUnits" label="A/C units" defaultValue={v?.rvAcUnits ?? numOrStr(p, 'rvAcUnits')} />
          {towable ? (
            <Text name="rvAxles" label="Axles" defaultValue={v?.rvAxles ?? numOrStr(p, 'rvAxles')} />
          ) : null}
        </>
      ) : (
        <Select name="drivetrain" label="Drivetrain" defaultValue={v?.drivetrain ?? str(p, 'drivetrain') ?? 'AWD'} options={DRIVE_OPTS} scanned={has('drivetrain')} />
      )}

      {!rv ? (
        <Select name="transmission" label="Transmission" defaultValue={v?.transmission ?? str(p, 'transmission') ?? ''} options={TRANS_OPTS} scanned={has('transmission')} />
      ) : null}
      {!towable ? (
        <Select name="fuelType" label="Fuel" defaultValue={v?.fuelType ?? str(p, 'fuelType') ?? 'GAS'} options={FUEL_OPTS} scanned={has('fuelType')} />
      ) : null}
      {!towable ? (
        <Text name="engine" label="Engine" defaultValue={v?.engine ?? str(p, 'engine')} scanned={has('engine')} />
      ) : null}
      {!rv ? (
        <>
          <Text name="cylinders" label="Cylinders" defaultValue={v?.cylinders ?? numOrStr(p, 'cylinders')} scanned={has('cylinders')} />
          <Text name="doors" label="Doors" defaultValue={v?.doors ?? numOrStr(p, 'doors') ?? 4} scanned={has('doors')} />
          <Text name="mpgCity" label="MPG city" defaultValue={v?.mpgCity ?? numOrStr(p, 'mpgCity')} />
          <Text name="mpgHwy" label="MPG hwy" defaultValue={v?.mpgHwy ?? numOrStr(p, 'mpgHwy')} />
        </>
      ) : null}

      <Text name="exteriorColor" label="Exterior color" defaultValue={v?.exteriorColor ?? str(p, 'exteriorColor')} scanned={has('exteriorColor')} />
      <label>
        <span className={LABEL}>Color swatch</span>
        <input
          name="exteriorColorHex"
          type="color"
          defaultValue={v?.exteriorColorHex ?? str(p, 'exteriorColorHex') ?? '#9ca3af'}
          className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-ink-300 bg-white px-1"
        />
      </label>
      <Text name="interiorColor" label="Interior" defaultValue={v?.interiorColor ?? str(p, 'interiorColor')} scanned={has('interiorColor')} />
      <Text name="keysCount" label="Keys" defaultValue={v?.keysCount ?? numOrStr(p, 'keysCount') ?? 2} />
    </div>
  );
}
