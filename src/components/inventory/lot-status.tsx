'use client';

/**
 * Flipping a unit's lot status, from the top of the page.
 *
 * This is the most repeated action on the vehicle screen and it used to live in
 * a Status dropdown inside the vehicle form, below the whole vehicle record,
 * committed only by saving the entire form. A dealer standing next to the car
 * with a phone was not going to do that, which means the lot status in Rooftop
 * quietly stopped matching the lot.
 *
 * So: it is in the header, it saves on change, and it is the same control at
 * every width — a native `<select>` rather than a row of pills, because a native
 * select is the one picker that is already good on a phone and needs no
 * JavaScript to be usable.
 *
 * SOLD AND WHOLESALED ARE NOT OFFERED HERE. A sale writes a sales row and
 * computes front gross; that lives in the full form. The copy says where they
 * went, so their absence reads as a decision rather than a missing option.
 */

import { useRef, useTransition } from 'react';
import { setLotStatus } from '@/lib/actions';

const QUICK: Array<[string, string]> = [
  ['ARRIVED', 'Arrived'],
  ['IN_RECON', 'In recon'],
  ['PHOTOS_PENDING', 'Photos pending'],
  ['FRONT_LINE_READY', 'Front-line ready'],
  ['PENDING_SALE', 'Pending sale'],
];

export function LotStatusControl({
  vehicleId,
  status,
}: {
  vehicleId: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  /* A car already sold is not something to un-sell from a dropdown — show the
     state and send them to the form, which is where the sale record lives. */
  const locked = status === 'SOLD' || status === 'WHOLESALED';

  return (
    <form ref={formRef} action={setLotStatus} className="flex items-center gap-2">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <label className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
        Lot status
      </label>
      {locked ? (
        <span className="rounded-lg border border-ink-300 bg-ink-50 px-2.5 py-1.5 text-xs font-semibold text-ink-700">
          {status === 'SOLD' ? 'Sold' : 'Wholesaled'}
        </span>
      ) : (
        <select
          name="status"
          defaultValue={status}
          disabled={pending}
          onChange={(e) => {
            const form = e.currentTarget.form;
            if (form) start(() => form.requestSubmit());
          }}
          className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-60"
        >
          {QUICK.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
      {pending ? <span className="text-[11px] text-ink-500">Saving…</span> : null}
    </form>
  );
}
