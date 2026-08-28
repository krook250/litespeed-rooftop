import type { Vehicle, Rooftop } from '@/db/schema';
import { relativeTime } from '@/lib/domain';
import { SubmitButton } from './submit-button';

const FIELD =
  'mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink-900';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-ink-500';
/** Fields the scan filled get a quiet mark, so it is obvious what to check. */
const SCANNED = 'border-emerald-400 bg-emerald-50/40';

function Text({
  name, label, defaultValue, placeholder, className, type = 'text', scanned,
}: {
  name: string; label: string; defaultValue?: string | number | null;
  placeholder?: string; className?: string; type?: string; scanned?: boolean;
}) {
  return (
    <label className={className}>
      <span className={LABEL}>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className={scanned ? `${FIELD} ${SCANNED}` : FIELD}
      />
    </label>
  );
}

function Select({
  name, label, defaultValue, options, className, scanned,
}: {
  name: string; label: string; defaultValue?: string;
  options: Array<[string, string]>; className?: string; scanned?: boolean;
}) {
  return (
    <label className={className}>
      <span className={LABEL}>{label}</span>
      <select name={name} defaultValue={defaultValue} className={scanned ? `${FIELD} ${SCANNED}` : FIELD}>
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
const TITLE_OPTS: Array<[string, string]> = [
  ['CLEAN', 'Clean'], ['REBUILT', 'Rebuilt'], ['SALVAGE', 'Salvage'], ['BONDED', 'Bonded'],
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

/**
 * Values the document scan produced, flattened to plain scalars.
 *
 * Deliberately typed loosely rather than as a `Partial<Vehicle>`: the scan is a
 * best effort over paper and the form's job is to accept whatever came back and
 * let a person fix it. Narrowing happens on the way out, in `saveVehicle`, which
 * is where it has to happen anyway because the same route accepts hand typing.
 */
export type VehiclePrefill = Record<string, unknown>;

function str(src: VehiclePrefill, key: string): string | undefined {
  const v = src[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function numOrStr(src: VehiclePrefill, key: string): string | number | undefined {
  const v = src[key];
  return typeof v === 'number' || (typeof v === 'string' && v.trim()) ? v : undefined;
}
function lines(src: VehiclePrefill, key: string): string | undefined {
  const v = src[key];
  return Array.isArray(v) && v.length ? v.filter((x) => typeof x === 'string').join('\n') : undefined;
}

export function VehicleForm({
  vehicle,
  rooftops,
  action,
  prefill,
}: {
  vehicle?: Vehicle;
  rooftops?: Rooftop[];
  action: (formData: FormData) => void | Promise<void>;
  /** Scan output. Ignored when editing an existing unit. */
  prefill?: VehiclePrefill;
}) {
  const v = vehicle;
  const p: VehiclePrefill = v ? {} : (prefill ?? {});
  const has = (key: string) => p[key] !== undefined && p[key] !== null && p[key] !== '';

  return (
    <form action={action} className="space-y-6 px-5 py-5">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}

      {rooftops ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            name="rooftopId"
            label="Rooftop"
            defaultValue={str(p, 'rooftopId') ?? rooftops[0]?.id}
            options={rooftops.map((r) => [r.id, r.name] as [string, string])}
          />
          <Text name="acquiredDate" label="Date in" type="date" />
        </div>
      ) : null}

      <section>
        <h3 className="mb-3 text-xs font-semibold text-ink-900">Identity</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Text name="stockNumber" label="Stock #" defaultValue={v?.stockNumber ?? numOrStr(p, 'stockNumber')} scanned={has('stockNumber')} />
          <Text name="year" label="Year" defaultValue={v?.year ?? numOrStr(p, 'year')} scanned={has('year')} />
          <Text name="make" label="Make" defaultValue={v?.make ?? str(p, 'make')} scanned={has('make')} />
          <Text name="model" label="Model" defaultValue={v?.model ?? str(p, 'model')} scanned={has('model')} />
          <Text name="trim" label="Trim" defaultValue={v?.trim ?? str(p, 'trim')} className="sm:col-span-2" scanned={has('trim')} />
          {!v ? (
            <Text
              name="vin"
              label="VIN (blank to generate)"
              defaultValue={str(p, 'vin')}
              className="sm:col-span-2"
              scanned={has('vin')}
            />
          ) : null}
          <Text name="mileage" label="Mileage" defaultValue={v?.mileage ?? numOrStr(p, 'mileage')} scanned={has('mileage')} />
          <Select name="bodyStyle" label="Body" defaultValue={v?.bodyStyle ?? str(p, 'bodyStyle') ?? 'SUV'} options={BODY_OPTS} scanned={has('bodyStyle')} />
          <Select name="drivetrain" label="Drivetrain" defaultValue={v?.drivetrain ?? str(p, 'drivetrain') ?? 'AWD'} options={DRIVE_OPTS} scanned={has('drivetrain')} />
          <Select name="transmission" label="Transmission" defaultValue={v?.transmission ?? str(p, 'transmission') ?? 'AUTOMATIC'} options={TRANS_OPTS} scanned={has('transmission')} />
          <Select name="fuelType" label="Fuel" defaultValue={v?.fuelType ?? str(p, 'fuelType') ?? 'GAS'} options={FUEL_OPTS} scanned={has('fuelType')} />
          <Text name="engine" label="Engine" defaultValue={v?.engine ?? str(p, 'engine')} scanned={has('engine')} />
          <Text name="cylinders" label="Cylinders" defaultValue={v?.cylinders ?? numOrStr(p, 'cylinders')} scanned={has('cylinders')} />
          <Text name="doors" label="Doors" defaultValue={v?.doors ?? numOrStr(p, 'doors') ?? 4} scanned={has('doors')} />
          <Text name="mpgCity" label="MPG city" defaultValue={v?.mpgCity ?? numOrStr(p, 'mpgCity')} />
          <Text name="mpgHwy" label="MPG hwy" defaultValue={v?.mpgHwy ?? numOrStr(p, 'mpgHwy')} />
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
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold text-ink-900">Money</h3>
        <p className="mb-3 text-[11px] text-ink-500">
          Cost, pack and recon stay inside. Only the asking price leaves this record.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Text name="price" label="Asking price" defaultValue={v?.price ?? numOrStr(p, 'price')} scanned={has('price')} />
          <Text name="cost" label="Cost" defaultValue={v?.cost ?? numOrStr(p, 'cost')} scanned={has('cost')} />
          <Text name="pack" label="Pack" defaultValue={v?.pack} />
          <Text name="reconCost" label="Recon" defaultValue={v?.reconCost} />
          <Text name="marketValue" label="Market value" defaultValue={v?.marketValue} />
          {/* Off the window sticker. Worth keeping: "$9,400 under original MSRP"
              is a merchandising line that needs the original number to exist. */}
          <Text name="msrp" label="Original MSRP" defaultValue={v?.msrp ?? numOrStr(p, 'msrp')} scanned={has('msrp')} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold text-ink-900">Lot status</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="status" label="Status" defaultValue={v?.status ?? 'ARRIVED'} options={STATUS_OPTS} />
          {/**
            * Title brand is on the form because a scanned title is the single
            * most common intake document and the brand is the one thing on it
            * that carries legal weight. It defaults to CLEAN, which is also what
            * the column defaults to — a brand is only ever set when a brand word
            * was actually read, never inferred from its absence.
            */}
          <Select name="titleStatus" label="Title" defaultValue={v?.titleStatus ?? str(p, 'titleStatus') ?? 'CLEAN'} options={TITLE_OPTS} scanned={has('titleStatus')} />
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
              defaultValue={v ? (v.callouts ?? []).join('\n') : (lines(p, 'callouts') ?? '')}
              className={FIELD}
              placeholder={'One owner\nNew tires\nTow package'}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Options (one per line)</span>
            <textarea
              name="options"
              rows={4}
              defaultValue={v ? (v.options ?? []).join('\n') : (lines(p, 'options') ?? '')}
              className={FIELD}
            />
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-200 pt-4">
        <div className="mr-auto text-[11px] text-ink-500">
          <p>Saving queues the change out to every channel carrying this unit.</p>
          {/* The confirmation. `saveVehicle` revalidates this route, so after a
              save the server re-renders with a new `updatedAt` and this line
              reads "just now" — which is the only thing on the page that visibly
              changes, since every field keeps the value you just typed. */}
          {v ? <p className="mt-0.5 text-ink-400">Last saved {relativeTime(v.updatedAt)}</p> : null}
        </div>
        <SubmitButton pendingLabel={v ? 'Saving…' : 'Adding…'}>
          {v ? 'Save and syndicate' : 'Add vehicle'}
        </SubmitButton>
      </div>
    </form>
  );
}
