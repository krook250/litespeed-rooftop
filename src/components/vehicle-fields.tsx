/**
 * The vehicle form's field primitives and option lists.
 *
 * Extracted from `vehicle-form.tsx` so they can be shared with
 * `vehicle-identity-grid.tsx`, which has to be a client component: the grid
 * shows a different set of fields depending on the body style, and a server
 * component cannot react to a select changing.
 *
 * Deliberately NOT marked `'use client'`. Nothing here holds state or touches a
 * browser API, so it works unchanged on both sides of the boundary and the
 * server-rendered sections of the form stay server-rendered.
 */

/* Exported because the Merchandising section's textareas are built inline
 * rather than through `Text` — a textarea needs rows and a different height, and
 * three of them did not justify a fourth primitive. */
export const FIELD =
  'mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink-900';
export const LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-ink-500';
/** Fields the scan filled get a quiet mark, so it is obvious what to check. */
const SCANNED = 'border-emerald-400 bg-emerald-50/40';

export function Text({
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

export function Select({
  name, label, defaultValue, options, className, scanned, onChange,
}: {
  name: string; label: string; defaultValue?: string;
  options: Array<[string, string]>; className?: string; scanned?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <label className={className}>
      <span className={LABEL}>{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={scanned ? `${FIELD} ${SCANNED}` : FIELD}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * Body style options.
 *
 * The eight RV values live in the same enum and the same control as the car
 * ones on purpose — picking one is what sets `vehicleType`, which gates vPIC
 * precedence and feed eligibility. A second "is this an RV?" control would be a
 * second chance for the two to disagree. See `vehicleTypeForBody` in
 * `lib/domain.ts`.
 */
export const CAR_BODY_OPTS: Array<[string, string]> = [
  ['SEDAN', 'Sedan'], ['SUV', 'SUV'], ['TRUCK', 'Truck'], ['COUPE', 'Coupe'],
  ['HATCHBACK', 'Hatchback'], ['WAGON', 'Wagon'], ['VAN', 'Minivan'], ['CONVERTIBLE', 'Convertible'],
];
export const RV_BODY_OPTS: Array<[string, string]> = [
  ['TRAVEL_TRAILER', 'Travel Trailer'], ['FIFTH_WHEEL', 'Fifth Wheel'],
  ['TOY_HAULER', 'Toy Hauler'], ['POP_UP', 'Pop-Up'], ['TRUCK_CAMPER', 'Truck Camper'],
  ['CLASS_A', 'Class A'], ['CLASS_B', 'Class B'], ['CLASS_C', 'Class C'],
];
export const BODY_OPTS: Array<[string, string]> = [...CAR_BODY_OPTS, ...RV_BODY_OPTS];

export const DRIVE_OPTS: Array<[string, string]> = [['FWD', 'FWD'], ['RWD', 'RWD'], ['AWD', 'AWD'], ['FOUR_WD', '4WD']];
export const TRANS_OPTS: Array<[string, string]> = [['', 'Unknown'], ['AUTOMATIC', 'Automatic'], ['MANUAL', 'Manual'], ['CVT', 'CVT']];
export const FUEL_OPTS: Array<[string, string]> = [
  ['GAS', 'Gasoline'], ['DIESEL', 'Diesel'], ['HYBRID', 'Hybrid'],
  ['PLUGIN_HYBRID', 'Plug-in Hybrid'], ['ELECTRIC', 'Electric'], ['FLEX', 'Flex Fuel'],
];
export const TITLE_OPTS: Array<[string, string]> = [
  ['CLEAN', 'Clean'], ['REBUILT', 'Rebuilt'], ['SALVAGE', 'Salvage'], ['BONDED', 'Bonded'],
];
export const STATUS_OPTS: Array<[string, string]> = [
  ['ARRIVED', 'Arrived'], ['IN_RECON', 'In recon'], ['PHOTOS_PENDING', 'Photos pending'],
  ['FRONT_LINE_READY', 'Front-line ready'], ['PENDING_SALE', 'Pending sale'],
  ['SOLD', 'Sold'], ['WHOLESALED', 'Wholesaled'],
];
export const SOURCE_OPTS: Array<[string, string]> = [
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

export function str(src: VehiclePrefill, key: string): string | undefined {
  const v = src[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
export function numOrStr(src: VehiclePrefill, key: string): string | number | undefined {
  const v = src[key];
  return typeof v === 'number' || (typeof v === 'string' && v.trim()) ? v : undefined;
}
export function lines(src: VehiclePrefill, key: string): string | undefined {
  const v = src[key];
  return Array.isArray(v) && v.length ? v.filter((x) => typeof x === 'string').join('\n') : undefined;
}
