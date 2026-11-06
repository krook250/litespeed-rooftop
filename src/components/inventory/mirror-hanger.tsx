'use client';

/**
 * Rearview-mirror price hanger, one per letter sheet.
 *
 * The dashed line and circle at the top are the cut: cut along the line into
 * the circle, cut the circle out, and it slips over the mirror stem.
 *
 * PRINTING. Same trick as the Buyers Guide: the admin chrome sits around this
 * page, so the sheet is rendered a second time, read-only, into a node on
 * <body>, and the print stylesheet hides everything else.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  year: string;
  make: string;
  model: string;
  price: string;
  miles: string;
  phone: string;
  site: string;
  qrSvg: string;
};

const digits = (v: string) => v.replace(/\D/g, '');
const commas = (v: string) => (v ? Number(v).toLocaleString('en-US') : '');

export function MirrorHanger(props: Props) {
  const [price, setPrice] = useState(props.price);
  const [miles, setMiles] = useState(props.miles);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const canPrint = Number(price) > 0;

  return (
    <div>
      <div className="mh-noprint mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Mirror Hanger</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-600">
            Prints on one letter sheet. Cut along the dashed line into the circle and hang it on the mirror.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-ink-600">
            Price
            <div className="mt-1 flex items-center rounded-lg border border-ink-300 bg-white px-2">
              <span className="text-sm text-ink-500">$</span>
              <input
                value={commas(price)}
                onChange={(e) => setPrice(digits(e.target.value))}
                inputMode="numeric"
                className="w-28 bg-transparent px-1 py-1.5 text-sm text-ink-900 outline-none"
              />
            </div>
          </label>
          <label className="text-xs font-medium text-ink-600">
            Miles
            <input
              value={commas(miles)}
              onChange={(e) => setMiles(digits(e.target.value))}
              inputMode="numeric"
              className="mt-1 block w-28 rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-sm text-ink-900 outline-none"
            />
          </label>
          <button
            type="button"
            disabled={!canPrint}
            onClick={() => window.print()}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Print
          </button>
        </div>
      </div>
      {!canPrint ? (
        <p className="mh-noprint -mt-3 mb-4 text-sm font-medium text-red-700">Enter a price to print.</p>
      ) : null}

      <div className="mh-noprint overflow-x-auto pb-4">
        <Sheet {...props} price={price} miles={miles} />
      </div>

      {mounted
        ? createPortal(
            <div className="mh-print-root">
              <Sheet {...props} price={price} miles={miles} />
            </div>,
            document.body,
          )
        : null}

      <style>{CSS}</style>
    </div>
  );
}

function Sheet({ year, make, model, price, miles, phone, site, qrSvg }: Props) {
  return (
    <div className="mh-page">
      <div className="mh-sheet">
        <svg className="mh-hook" viewBox="0 0 400 170" aria-hidden>
          <line x1="150" y1="0" x2="208" y2="70" stroke="#000" strokeWidth="2" strokeDasharray="8 6" />
          <circle cx="235" cy="100" r="42" fill="none" stroke="#000" strokeWidth="2" strokeDasharray="8 6" />
        </svg>
        <div className="mh-ymm">
          <div>{year}</div>
          <div>{make}</div>
          <div>{model}</div>
        </div>
        <div className="mh-price">{price ? `$${commas(price)}` : ' '}</div>
        {miles ? <div className="mh-miles">Miles: {commas(miles)}</div> : null}
        {phone ? <div className="mh-phone">{phone}</div> : null}
        <div className="mh-site">{site}</div>
        <div className="mh-qr">
          <div className="mh-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="mh-qr-label">Scan for photos &amp; details</div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.mh-page { background: #fff; width: 8.5in; flex: none; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.mh-sheet {
  box-sizing: border-box; width: 8.5in; height: 11in; padding: 0.4in 0.6in;
  color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif;
  display: flex; flex-direction: column; align-items: center; text-align: center;
}
.mh-hook { width: 5.5in; height: auto; flex: none; margin-top: -0.4in; }
.mh-ymm { font-size: 40pt; line-height: 1.05; margin-top: 4pt; }
.mh-price { font-size: 104pt; font-weight: 700; line-height: 1; margin-top: 16pt; letter-spacing: -2pt; white-space: nowrap; }
.mh-miles { font-size: 30pt; margin-top: 16pt; }
.mh-phone { font-size: 40pt; margin-top: 8pt; white-space: nowrap; }
.mh-site { font-size: 20pt; margin-top: 6pt; }
.mh-qr { margin-top: auto; display: flex; flex-direction: column; align-items: center; }
.mh-qr-code { width: 1.4in; height: 1.4in; }
.mh-qr-code svg { width: 100%; height: 100%; display: block; }
.mh-qr-label { font-size: 11pt; margin-top: 5pt; }
.mh-print-root { display: none; }

@media print {
  @page { size: letter; margin: 0; }
  body > *:not(.mh-print-root) { display: none !important; }
  .mh-print-root { display: block !important; }
  .mh-print-root .mh-page { box-shadow: none; }
  html, body { background: #fff !important; margin: 0 !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
