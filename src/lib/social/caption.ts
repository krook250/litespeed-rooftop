/**
 * The caption a post starts with. Always editable; this is only the first draft.
 *
 * Written the way a lot posts, not the way a brand does: what it is, the price,
 * the miles, where to see it, how to reach them. No emoji wall, no hashtags.
 */

import { activePrice, num, usd, vehicleTitle } from '@/lib/domain';

type CaptionVehicle = {
  year: number;
  make: string;
  model: string;
  trim: string;
  price: number;
  salePrice: number | null;
  mileage: number;
  callouts: string[];
};

export function vehicleCaption(v: CaptionVehicle, opts: { url: string; phone: string | null; walkaround?: boolean }) {
  const lines = [
    opts.walkaround ? `Walkaround: ${vehicleTitle(v)}` : vehicleTitle(v),
    `${usd(activePrice(v))} · ${num(v.mileage)} miles`,
  ];
  const callouts = v.callouts.filter(Boolean).slice(0, 3);
  if (callouts.length) lines.push(callouts.join(' · '));
  lines.push('', `Details and more photos: ${opts.url}`);
  if (opts.phone) lines.push(`Call or text ${opts.phone}`);
  return lines.join('\n');
}

export const CAPTION_MAX = 2200;
