'use client';

/**
 * The FTC Buyers Guide, front and back, as the 2016 rule prints it.
 *
 * THE WORDING IS LAW. 16 C.F.R. 455.2(a): "The capitalization, punctuation and
 * wording of all items, headings, and text on the form must be exactly as
 * required by this Rule." Every string below is copied from the FTC's own form
 * (ftc.gov, buyersguide_eng_with_notes_2016-11.pdf), including its two typos on
 * the back ("leakeage", "Cracked of damaged"). Do not tidy them.
 *
 * Layout follows the FTC's spec sheet: Arial, a 504 x 684 pt box (7 x 9.5 in),
 * 100% black on white, the point sizes noted inline. One side per printed page;
 * print double-sided to get the real two-sided form.
 *
 * The dealer fills it in on the form itself — tick a box, type a percentage —
 * and prints. Nothing is saved.
 *
 * PRINTING. The admin sidebar and header sit around this page, so the sheets
 * are rendered a second time, read-only, into a node on <body>, and the print
 * stylesheet hides everything else. Same state drives both copies.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Vehicle = { make: string; model: string; year: string; vin: string };
type Dealer = { name: string; address: string; phone: string; email: string };

type State = {
  asIs: boolean;
  dealerWarranty: boolean;
  full: boolean;
  limited: boolean;
  labor: string;
  parts: string;
  systems: string;
  duration: string;
  mfrStill: boolean;
  mfrUsed: boolean;
  otherUsed: boolean;
  serviceContract: boolean;
  vehicle: Vehicle;
  dealer: Dealer;
  complaints: string;
};

export function BuyersGuide({ vehicle, dealer }: { vehicle: Vehicle; dealer: Dealer }) {
  const [s, setS] = useState<State>({
    asIs: true,
    dealerWarranty: false,
    full: false,
    limited: false,
    labor: '',
    parts: '',
    systems: '',
    duration: '',
    mfrStill: false,
    mfrUsed: false,
    otherUsed: false,
    serviceContract: false,
    vehicle,
    dealer,
    complaints: `${dealer.name}, ${dealer.phone}`,
  });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  return (
    <div>
      <div className="bg-noprint mt-3 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Buyers Guide</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-600">
            Tick the boxes on the form, then print. Print double-sided so the defects list lands on the back.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800"
        >
          Print
        </button>
      </div>

      <div className="bg-noprint flex flex-col gap-8 overflow-x-auto pb-4">
        <Front s={s} set={set} editable />
        <Back s={s} set={set} editable />
      </div>

      {mounted
        ? createPortal(
            <div className="bg-print-root">
              <Front s={s} set={set} editable={false} />
              <Back s={s} set={set} editable={false} />
            </div>,
            document.body,
          )
        : null}

      <style>{CSS}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

type SideProps = { s: State; set: (p: Partial<State>) => void; editable: boolean };

function Box({
  checked,
  onToggle,
  size,
  editable,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  size: number;
  editable: boolean;
  label: string;
}) {
  const style = { width: `${size}pt`, height: `${size}pt`, fontSize: `${size * 0.9}pt` };
  if (!editable) {
    return (
      <span className="bg-box" style={style}>
        {checked ? '✕' : ''}
      </span>
    );
  }
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onToggle} className="bg-box bg-box-btn" style={style}>
      {checked ? '✕' : ''}
    </button>
  );
}

function Blank({
  value,
  onChange,
  editable,
  width,
  align = 'left',
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
  label: string;
}) {
  if (!editable) {
    return (
      <span className="bg-blank" style={{ width, textAlign: align }}>
        {value}
      </span>
    );
  }
  return (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-blank bg-input"
      style={{ width, textAlign: align }}
    />
  );
}

function Area({ value, onChange, editable, label }: { value: string; onChange: (v: string) => void; editable: boolean; label: string }) {
  if (!editable) return <div className="bg-area">{value}</div>;
  return <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="bg-area bg-input" rows={5} />;
}

/* ------------------------------------------------------------------- front */

function Front({ s, set, editable }: SideProps) {
  const v = s.vehicle;
  const setV = (p: Partial<Vehicle>) => set({ vehicle: { ...v, ...p } });
  const warranty = s.dealerWarranty;

  return (
    <div className="bg-page">
      <div className="bg-sheet">
        <div className="bg-title">BUYERS GUIDE</div>
        <div className="bg-rule" style={{ borderTopWidth: '1pt' }} />
        <p className="bg-important">
          <b>IMPORTANT:</b>&nbsp; Spoken promises are difficult to enforce.&nbsp; Ask the dealer to put all promises in writing.&nbsp; Keep this form.
        </p>

        <div className="bg-vehicle">
          <div className="bg-vrow">
            <Blank label="Make" value={v.make} onChange={(x) => setV({ make: x })} editable={editable} width="27%" />
            <Blank label="Model" value={v.model} onChange={(x) => setV({ model: x })} editable={editable} width="21%" />
            <Blank label="Year" value={v.year} onChange={(x) => setV({ year: x })} editable={editable} width="12%" />
            <Blank label="VIN" value={v.vin} onChange={(x) => setV({ vin: x.toUpperCase() })} editable={editable} width="40%" align="right" />
          </div>
          <div className="bg-vlabels">
            <span style={{ width: '27%' }}>VEHICLE MAKE</span>
            <span style={{ width: '21%' }}>MODEL</span>
            <span style={{ width: '12%' }}>YEAR</span>
            <span style={{ width: '40%', textAlign: 'right' }}>VEHICLE IDENTIFICATION NUMBER (VIN)</span>
          </div>
        </div>

        <div className="bg-h12">WARRANTIES FOR THIS VEHICLE:</div>
        <div className="bg-rule" style={{ borderTopWidth: '2pt' }} />

        <div className="bg-big">
          <Box
            label="As Is - No Dealer Warranty"
            checked={s.asIs}
            onToggle={() => set({ asIs: !s.asIs, dealerWarranty: s.asIs ? s.dealerWarranty : false, full: s.asIs ? s.full : false, limited: s.asIs ? s.limited : false })}
            size={22}
            editable={editable}
          />
          <div>
            <div className="bg-h24">AS IS - NO DEALER WARRANTY</div>
            <div className="bg-caps85">THE DEALER DOES NOT PROVIDE A WARRANTY FOR ANY REPAIRS AFTER SALE.</div>
          </div>
        </div>
        <div className="bg-dashed" />

        <div className="bg-big">
          <Box
            label="Dealer Warranty"
            checked={warranty}
            onToggle={() => set({ dealerWarranty: !warranty, asIs: warranty ? s.asIs : false, full: warranty ? false : s.full, limited: warranty ? false : s.limited })}
            size={22}
            editable={editable}
          />
          <div className="bg-h24">DEALER WARRANTY</div>
        </div>

        <div className="bg-small">
          <Box
            label="Full warranty"
            checked={s.full}
            onToggle={() => set({ full: !s.full, limited: false, dealerWarranty: true, asIs: false })}
            size={8}
            editable={editable}
          />
          <span>FULL WARRANTY.</span>
        </div>
        <div className="bg-small">
          <Box
            label="Limited warranty"
            checked={s.limited}
            onToggle={() => set({ limited: !s.limited, full: false, dealerWarranty: true, asIs: false })}
            size={8}
            editable={editable}
          />
          <span>
            LIMITED WARRANTY.&nbsp; The dealer will pay{' '}
            <Blank label="Percent of labor" value={s.labor} onChange={(x) => set({ labor: x.replace(/[^0-9]/g, '').slice(0, 3) })} editable={editable} width="2.4em" align="center" />% of
            the labor and{' '}
            <Blank label="Percent of parts" value={s.parts} onChange={(x) => set({ parts: x.replace(/[^0-9]/g, '').slice(0, 3) })} editable={editable} width="2.4em" align="center" />% of
            the parts for the covered systems that fail during the warranty period.&nbsp; Ask the dealer for a copy of the
            warranty, and for any documents that explain warranty coverage, exclusions, and the dealer’s repair
            obligations.&nbsp; <i>Implied warranties</i> under your state’s laws may give you additional rights.
          </span>
        </div>

        <div className="bg-cols2">
          <div>
            <div className="bg-h9">SYSTEMS COVERED:</div>
            <Area label="Systems covered" value={s.systems} onChange={(x) => set({ systems: x })} editable={editable} />
          </div>
          <div>
            <div className="bg-h9">DURATION:</div>
            <Area label="Duration" value={s.duration} onChange={(x) => set({ duration: x })} editable={editable} />
          </div>
        </div>

        <div className="bg-h12">NON-DEALER WARRANTIES FOR THIS VEHICLE:</div>
        <div className="bg-rule" style={{ borderTopWidth: '2pt' }} />
        <div className="bg-small bg-tight">
          <Box label="Manufacturer's warranty still applies" checked={s.mfrStill} onToggle={() => set({ mfrStill: !s.mfrStill })} size={8} editable={editable} />
          <span>
            MANUFACTURER’S WARRANTY STILL APPLIES.&nbsp; The manufacturer’s original warranty has not expired on some
            components of the vehicle.
          </span>
        </div>
        <div className="bg-small bg-tight">
          <Box label="Manufacturer's used vehicle warranty applies" checked={s.mfrUsed} onToggle={() => set({ mfrUsed: !s.mfrUsed })} size={8} editable={editable} />
          <span>MANUFACTURER’S USED VEHICLE WARRANTY APPLIES.</span>
        </div>
        <div className="bg-small bg-tight">
          <Box label="Other used vehicle warranty applies" checked={s.otherUsed} onToggle={() => set({ otherUsed: !s.otherUsed })} size={8} editable={editable} />
          <span>OTHER USED VEHICLE WARRANTY APPLIES.</span>
        </div>
        <p className="bg-text85 bg-flush">
          Ask the dealer for a copy of the warranty document and an explanation of warranty coverage, exclusions, and
          repair obligations.
        </p>

        <div className="bg-rule" style={{ borderTopWidth: '1pt' }} />
        <div className="bg-small">
          <Box label="Service contract" checked={s.serviceContract} onToggle={() => set({ serviceContract: !s.serviceContract })} size={8} editable={editable} />
          <span>
            SERVICE CONTRACT.&nbsp; A service contract on this vehicle is available for an extra charge.&nbsp; Ask for
            details about coverage, deductible, price, and exclusions.&nbsp; If you buy a service contract within 90 days
            of your purchase of this vehicle, <i>implied warranties</i> under your state’s laws may give you additional
            rights.
          </span>
        </div>
        <div className="bg-rule" style={{ borderTopWidth: '2pt' }} />

        <div className="bg-text9">
          <p>
            <b>ASK THE DEALER IF YOUR MECHANIC CAN INSPECT THE VEHICLE ON OR OFF THE LOT.</b>
          </p>
          <p>
            <b>OBTAIN A VEHICLE HISTORY REPORT AND CHECK FOR OPEN SAFETY RECALLS.</b>&nbsp; For information on how to
            obtain a vehicle history report, visit ftc.gov/usedcars.&nbsp; To check for open safety recalls, visit
            safercar.gov.&nbsp; You will need the vehicle identification number (VIN) shown above to make the best use
            of the resources on these sites.
          </p>
          <p>
            <b>SEE OTHER SIDE for important additional information, including a list of major defects that may occur in used motor vehicles.</b>
          </p>
          <p>
            <b>Si el concesionario gestiona la venta en español, pídale una copia de la Guía del Comprador en español.</b>
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- back */

const DEFECTS: Array<Array<[string, string[]]>> = [
  [
    ['Frame & Body', ['Frame-cracks, corrective welds, or rusted through', 'Dog tracks—bent or twisted frame']],
    [
      'Engine',
      [
        'Oil leakage, excluding normal seepage',
        'Cracked block or head',
        'Belts missing or inoperable',
        'Knocks or misses related to camshaft lifters and push rods',
        'Abnormal exhaust discharge',
      ],
    ],
    [
      'Transmission & Drive Shaft',
      [
        'Improper fluid level or leakage, excluding normal seepage',
        'Cracked or damaged case which is visible',
        'Abnormal noise or vibration caused by faulty transmission or drive shaft',
        'Improper shifting or functioning in any gear',
        'Manual clutch slips or chatters',
      ],
    ],
    [
      'Differential',
      [
        'Improper fluid level or leakeage, excluding normal seepage',
        'Cracked of damaged housing which is visible',
        'Abnormal noise or vibration caused by faulty differential',
      ],
    ],
  ],
  [
    ['Cooling System', ['Leakage including radiator', 'Improperly functioning water pump']],
    ['Electrical System', ['Battery leakage', 'Improperly functioning alternator, generator, battery, or starter']],
    ['Fuel System', ['Visible leakage']],
    ['Inoperable Accessories', ['Gauges or warning devices', 'Air conditioner', 'Heater & Defroster']],
    [
      'Brake System',
      [
        'Failure warning light broken',
        'Pedal not firm under pressure (DOT spec.)',
        'Not enough pedal reserve (DOT spec.)',
        'Does not stop vehicle in straight line (DOT spec.)',
        'Hoses damaged',
        'Drum or rotor too thin (Mfgr. Specs)',
        'Lining or pad thickness less than 1/32 inch',
        'Power unit not operating or leaking',
        'Structural or mechanical parts damaged',
      ],
    ],
    ['Air Bags', []],
  ],
  [
    [
      'Steering System',
      [
        'Too much free play at steering wheel (DOT specs.)',
        'Free play in linkage more than 1/4 inch',
        'Steering gear binds or jams',
        'Front wheels aligned improperly (DOT specs.)',
        'Power unit belts cracked or slipping',
        'Power unit fluid level improper',
      ],
    ],
    [
      'Suspension System',
      [
        'Ball joint seals damaged',
        'Structural parts bent or damaged',
        'Stabilizer bar disconnected',
        'Spring broken',
        'Shock absorber mounting loose',
        'Rubber bushings damaged or missing',
        'Radius rod damaged or missing',
        'Shock absorber leaking or functioning improperly',
      ],
    ],
    ['Tires', ['Tread depth less than 2/32 inch', 'Sizes mismatched', 'Visible damage']],
    ['Wheels', ['Visible cracks, damage or repairs', 'Mounting bolts loose or missing']],
    ['Exhaust System', ['Leakage', 'Catalytic Converter']],
  ],
];

function Back({ s, set, editable }: SideProps) {
  const d = s.dealer;
  const setD = (p: Partial<Dealer>) => set({ dealer: { ...d, ...p } });

  return (
    <div className="bg-page">
      <div className="bg-sheet bg-back">
        <div className="bg-rule" style={{ borderTopWidth: '2pt', marginTop: '14pt' }} />
        <p className="bg-text7" style={{ margin: '14pt 0 10pt' }}>
          Here is a list of some major defects that may occur in used vehicles.
        </p>
        <div className="bg-defects">
          {DEFECTS.map((col, i) => (
            <div key={i}>
              {col.map(([head, items]) => (
                <div key={head}>
                  <div className="bg-dhead">{head}</div>
                  {items.map((it) => (
                    <div key={it} className="bg-ditem">
                      {it}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="bg-spacer" />

        <div className="bg-rule" style={{ borderTopWidth: '2pt' }} />
        <div className="bg-lines">
          <div className="bg-line">
            <span>DEALER NAME</span>
            <Blank label="Dealer name" value={d.name} onChange={(x) => setD({ name: x })} editable={editable} />
          </div>
          <div className="bg-line">
            <span>ADDRESS</span>
            <Blank label="Address" value={d.address} onChange={(x) => setD({ address: x })} editable={editable} />
          </div>
          <div className="bg-line bg-line2">
            <div>
              <span>TELEPHONE</span>
              <Blank label="Telephone" value={d.phone} onChange={(x) => setD({ phone: x })} editable={editable} />
            </div>
            <div>
              <span>EMAIL</span>
              <Blank label="Email" value={d.email} onChange={(x) => setD({ email: x })} editable={editable} />
            </div>
          </div>
          <div className="bg-line">
            <span>FOR COMPLAINTS AFTER SALE, CONTACT:</span>
            <Blank label="Complaints contact" value={s.complaints} onChange={(x) => set({ complaints: x })} editable={editable} />
          </div>
        </div>
        <div className="bg-rule" style={{ borderTopWidth: '2pt', marginTop: '10pt' }} />
        <p className="bg-text9 bg-footer">
          <b>IMPORTANT:</b>&nbsp; The information on this form is part of any contract to buy this vehicle.&nbsp; Removing
          this label before consumer purchase (except for purpose of test-driving) violates federal law (16 C.F.R. 455).
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- css */

const CSS = `
.bg-page { background: #fff; width: 7in; flex: none; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.bg-sheet {
  box-sizing: border-box; width: 504pt; height: 684pt; border: 1pt solid #000;
  padding: 10pt 14pt; color: #000; background: #fff;
  font-family: Arial, Helvetica, sans-serif; display: flex; flex-direction: column;
}
.bg-sheet p { margin: 0; }
.bg-sheet b { font-weight: 700; }
.bg-title { font-size: 26pt; font-weight: 700; text-align: center; letter-spacing: .5pt; margin: 6pt 0 4pt; }
.bg-rule { border-top: 1pt solid #000; height: 0; }
.bg-important { font-size: 8.5pt; margin: 3pt 0 0 !important; }
.bg-vehicle { margin-top: 10pt; }
.bg-vrow { display: flex; border-bottom: .5pt solid #000; font-size: 10pt; min-height: 13pt; }
.bg-vlabels { display: flex; font-size: 6pt; margin-top: 1pt; }
.bg-h12 { font-size: 12pt; font-weight: 700; margin-top: 8pt; }
.bg-h24 { font-size: 24pt; font-weight: 700; line-height: 1; }
.bg-h9 { font-size: 9pt; font-weight: 700; }
.bg-caps85 { font-size: 8.5pt; margin-top: 3pt; }
.bg-big { display: flex; align-items: flex-start; gap: 10pt; margin-top: 8pt; }
.bg-big .bg-box { margin-top: 1pt; }
.bg-dashed { border-top: 1pt dashed #000; margin: 4pt 0 0 32pt; width: 75%; }
.bg-small { display: flex; align-items: flex-start; gap: 8pt; margin: 5pt 0 0 10pt; font-size: 8.5pt; line-height: 10.2pt; }
.bg-tight { margin-left: 0; }
.bg-small .bg-box { margin-top: 1pt; }
.bg-text85 { font-size: 8.5pt; line-height: 10.2pt; margin-top: 6pt !important; }
.bg-text9 { font-size: 9pt; line-height: 10.8pt; margin-top: 6pt; }
.bg-text9 p { margin-bottom: 6pt; }
.bg-text7 { font-size: 7pt; }
.bg-cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; margin-top: 10pt; height: 82pt; }
.bg-box {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  border: 1pt solid #000; background: #fff; color: #000; line-height: 1; padding: 0; font-family: Arial, sans-serif;
}
.bg-box-btn { cursor: pointer; }
.bg-box-btn:hover { background: #f1f5f9; }
.bg-blank { display: inline-block; font: inherit; color: #000; background: transparent; border: 0; padding: 0; }
.bg-vrow .bg-blank { font-size: 10pt; }
.bg-small .bg-blank { border-bottom: .5pt solid #000; }
.bg-input { outline: none; }
.bg-input:focus { background: #fef9c3; }
.bg-area { display: block; width: 100%; height: 66pt; margin-top: 2pt; font: inherit; font-size: 9pt; line-height: 11pt; color: #000; border: 0; padding: 0; resize: none; white-space: pre-wrap; background: transparent; }
textarea.bg-area { background: #f8fafc; }
.bg-defects { display: grid; grid-template-columns: repeat(3, 144pt); justify-content: space-between; font-size: 7pt; line-height: 8.4pt; }
.bg-dhead { font-weight: 700; margin-top: 2pt; }
.bg-ditem { padding-left: 15pt; text-indent: -10pt; }
.bg-spacer { flex: 1; }
.bg-lines { font-size: 8pt; }
.bg-line { display: flex; align-items: flex-end; gap: 8pt; height: 25pt; border-bottom: .5pt solid #000; padding-bottom: 2pt; box-sizing: border-box; }
.bg-line > span, .bg-line2 span { flex: none; }
.bg-line .bg-blank { flex: 1; font-size: 9pt; }
.bg-line2 > div { flex: 1; display: flex; align-items: flex-end; gap: 8pt; }
.bg-footer { margin-top: 4pt !important; }
.bg-print-root { display: none; }

@media print {
  @page { size: letter; margin: 0.5in 0.75in; }
  body > *:not(.bg-print-root) { display: none !important; }
  .bg-print-root { display: block !important; }
  .bg-print-root .bg-page { box-shadow: none; break-after: page; page-break-after: always; }
  .bg-print-root .bg-page:last-child { break-after: auto; page-break-after: auto; }
  html, body { background: #fff !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
