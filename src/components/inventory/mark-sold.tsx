'use client';

/**
 * Selling a car, from the top of the page.
 *
 * Sold used to exist only as an option in the Status field at the bottom of the
 * vehicle form, and the lot-status dropdown in the header pointedly left it
 * out. Both decisions were defensible and together they meant a dealer could
 * not find how to sell a car on a car-selling platform.
 *
 * Two taps, not one: the first opens the price, the second commits. A sale
 * locks the unit and writes gross into reporting, so it gets a confirm — and
 * the confirm earns its keep by asking the one thing only the dealer knows,
 * which is what it actually sold for. Prefilled with the asking price.
 *
 * "Price unknown" is for units taken off the lot without a sale amount: the
 * unit counts as sold, the asking price is never booked as the sale.
 */

import { useId, useState, useTransition } from 'react';
import { markSold } from '@/lib/actions';

export function MarkSold({
  vehicleId,
  askingPrice,
  big = false,
}: {
  vehicleId: string;
  askingPrice: number;
  /** The phone's pinned bottom bar: a thumb-sized primary button. */
  big?: boolean;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          big
            ? 'h-11 shrink-0 rounded-lg bg-ink-900 px-5 text-sm font-semibold text-white hover:bg-ink-800'
            : 'rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50'
        }
      >
        Mark sold
      </button>
    );
  }

  return (
    <form
      action={(fd) => start(() => markSold(fd))}
      className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-white p-2 ring-1 ring-inset ring-ink-300 sm:w-auto"
    >
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <label htmlFor={inputId} className="text-xs font-medium text-ink-700">
        Sold for
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-400">$</span>
        <input
          id={inputId}
          name="soldPrice"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          required
          autoFocus
          defaultValue={askingPrice}
          className="tnum w-28 rounded-md border border-ink-300 py-1.5 pl-5 pr-2 text-right text-sm text-ink-900"
        />
      </div>
      <button
        disabled={pending}
        className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Confirm sale'}
      </button>
      <button
        name="priceUnknown"
        value="1"
        formNoValidate
        disabled={pending}
        title="Counts as sold. Left out of gross."
        className="rounded-md px-2 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
      >
        Sold, price unknown
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen(false)}
        className="rounded-md px-2 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100"
      >
        Cancel
      </button>
    </form>
  );
}
