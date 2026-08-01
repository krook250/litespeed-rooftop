import type { Vehicle, Rooftop } from '@/db/schema';
import { Button } from './ui';

const FIELD =
  'mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink-900';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-ink-500';

function Text({
  name, label, defaultValue, placeholder, className, type = 'text',
}: {
  name: string; label: string; defaultValue?: string | number | null;
  placeholder?: string; className?: string; type?: string;
}) {
  return (
    <label className={className}>
      <span className={LABEL}>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className={FIELD}
      />
    </label>
  );
}

function Select({
  name, label, defaultValue, options, className,
}: {
  name: string; label: string; defaultValue?: string;
  options: Array<[string, string]>; className?: string;
}) {
  return (
    <label className={className}>
      <span className={LABEL}>{label}</span>
      <select name={name} defaultValue={defaultValue} className={FIELD}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

const BODY_OPTS: Array<[string, string]> = [
  ['SEDAN', 'Sedan'], ['SUV', 'SUV'], ['TRUCK', 'Truck'], ['COUPE', 'Coupe'],
  ['HATCHBACK', 'Hatchback'], ['WAGON', 'Wagon'], ['VAN', 'Minivan'], ['CONVERTIBLE', 'Convertible'],
];
const DRIVE_OPTS: Array<[string, string]> = [['FWD', 'FWD'], ['RWD', 'RWD'], ['AWD', 'AWD'], ['FOUR_WD', '4WD']];
const TRANS_OPTS: Array<[string, string]> = [['AUTOMATIC', 'Automatic'], ['MANUAL', 'Manual'], ['CVT', 'CVT']];
const FUEL_OPTS: Array<[string, string]> = [
  ['GAS', 'Gasoline'], ['DIESEL', 'Diesel'], ['HYBRID', 'Hybrid'],
  ['PLUGIN_HYBRID', 'Plug-in Hybrid'], ['ELECTRIC', 'Electric'], ['FLEX', 'Flex Fuel'],
];
const STATUS_OPTS: Array<[string, string]> = [
  ['ARRIVED', 'Arrived'], ['IN_RECON', 'In recon'], ['PHOTOS_PENDING', 'Photos pending'],
  ['FRONT_LINE_READY', 'Front-line ready'], ['PENDING_SALE', 'Pending sale'],
  ['SOLD', 'Sold'], ['WHOLESALED', 'Wholesaled'],
];
const SOURCE_OPTS: Array<[string, string]> = [
  ['AUCTION', 'Auction'], ['TRADE_IN', 'Trade-in'], ['STREET_PURCHASE', 'Street purchase'],
  ['LEASE_RETURN', 'Lease return'], ['DEALER_TRADE', 'Dealer trade'],
];

export function VehicleForm({
  vehicle,
  rooftops,
  action,
}: {
  vehicle?: Vehicle;
  rooftops?: Rooftop[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const v = vehicle;
  return (
    <form action={action} className="space-y-6 px-5 py-5">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}

      {rooftops ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            name="rooftopId"
            label="Rooftop"
            defaultValue={rooftops[0]?.id}
            options={rooftops.map((r) => [r.id, r.name] as [string, string])}
          />
          <Text name="acquiredDate" label="Date in" type="date" />
        </div>
      ) : null}

      <section>
        <h3 className="mb-3 text-xs font-semibold text-ink-900">Identity</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Text name="stockNumber" label="Stock #" defaultValue={v?.stockNumber} />
          <Text name="year" label="Year" defaultValue={v?.year} />
          <Text name="make" label="Make" defaultValue={v?.make} />
          <Text name="model" label="Model" defaultValue={v?.model} />
          <Text name="trim" label="Trim" defaultValue={v?.trim} className="sm:col-span-2" />
          {!v ? <Text name="vin" label="VIN (blank to generate)" className="sm:col-span-2" /> : null}
          <Text name="mileage" label="Mileage" defaultValue={v?.mileage} />
          <Select name="bodyStyle" label="Body" defaultValue={v?.bodyStyle ?? 'SUV'} options={BODY_OPTS} />
          <Select name="drivetrain" label="Drivetrain" defaultValue={v?.drivetrain ?? 'AWD'} options={DRIVE_OPTS} />
          <Select name="transmission" label="Transmission" defaultValue={v?.transmission ?? 'AUTOMATIC'} options={TRANS_OPTS} />
          <Select name="fuelType" label="Fuel" defaultValue={v?.fuelType ?? 'GAS'} options={FUEL_OPTS} />
          <Text name="engine" label="Engine" defaultValue={v?.engine} />
          <Text name="cylinders" label="Cylinders" defaultValue={v?.cylinders} />
          <Text name="doors" label="Doors" defaultValue={v?.doors ?? 4} />
          <Text name="mpgCity" label="MPG city" defaultValue={v?.mpgCity} />
          <Text name="mpgHwy" label="MPG hwy" defaultValue={v?.mpgHwy} />
          <Text name="exteriorColor" label="Exterior color" defaultValue={v?.exteriorColor} />
          <label>
            <span className={LABEL}>Color swatch</span>
            <input
              name="exteriorColorHex"
              type="color"
              defaultValue={v?.exteriorColorHex ?? '#9ca3af'}
              className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-ink-300 bg-white px-1"
            />
          </label>
          <Text name="interiorColor" label="Interior" defaultValue={v?.interiorColor} />
          <Text name="keysCount" label="Keys" defaultValue={v?.keysCount ?? 2} />
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold text-ink-900">Money</h3>
        <p className="mb-3 text-[11px] text-ink-500">
          Cost, pack and recon stay inside. Only the asking price leaves this record.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Text name="price" label="Asking price" defaultValue={v?.price} />
          <Text name="cost" label="Cost" defaultValue={v?.cost} />
          <Text name="pack" label="Pack" defaultValue={v?.pack} />
          <Text name="reconCost" label="Recon" defaultValue={v?.reconCost} />
          <Text name="marketValue" label="Market value" defaultValue={v?.marketValue} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold text-ink-900">Lot status</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select name="status" label="Status" defaultValue={v?.status ?? 'ARRIVED'} options={STATUS_OPTS} />
          {!v ? (
            <Select name="acquisitionSource" label="Source" defaultValue="AUCTION" options={SOURCE_OPTS} />
          ) : null}
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input type="checkbox" name="carfaxOneOwner" defaultChecked={v?.carfaxOneOwner} className="h-4 w-4" />
              One owner
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input type="checkbox" name="carfaxNoAccidents" defaultChecked={v?.carfaxNoAccidents} className="h-4 w-4" />
              No accidents
            </label>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold text-ink-900">Merchandising</h3>
        <p className="mb-3 text-[11px] text-ink-500">
          This is the copy that goes everywhere unless a channel has its own override.
        </p>
        <label className="block">
          <span className={LABEL}>Description</span>
          <textarea
            name="description"
            rows={4}
            defaultValue={v?.description ?? ''}
            className={FIELD}
            placeholder="Two or three honest sentences. Dealers who write these themselves outsell the ones who paste the window sticker."
          />
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Callouts (one per line)</span>
            <textarea
              name="callouts"
              rows={4}
              defaultValue={(v?.callouts ?? []).join('\n')}
              className={FIELD}
              placeholder={'One owner\nNew tires\nTow package'}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Options (one per line)</span>
            <textarea
              name="options"
              rows={4}
              defaultValue={(v?.options ?? []).join('\n')}
              className={FIELD}
            />
          </label>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 border-t border-ink-200 pt-4">
        <p className="mr-auto text-[11px] text-ink-500">
          Saving queues the change out to every channel carrying this unit.
        </p>
        <Button type="submit">{v ? 'Save and syndicate' : 'Add vehicle'}</Button>
      </div>
    </form>
  );
}
