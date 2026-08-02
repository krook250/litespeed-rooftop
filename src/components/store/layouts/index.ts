/**
 * The layout registry.
 *
 * ADDING A FOURTH LAYOUT:
 *   1. Write `./my-layout.tsx` exporting a component taking `{ view }`.
 *   2. Add `'MY_LAYOUT'` to `storefrontLayoutEnum` in `src/db/schema.ts`.
 *   3. Add one entry below.
 *   4. `npm run db:generate`.
 * That is the whole change. The route, the queries and the admin picker all read
 * from this map, so nothing else needs touching.
 *
 * WHY THE THREE DIFFER STRUCTURALLY AND NOT JUST BY COLOUR
 * Accent colour alone is not differentiation — two dealers on one layout with
 * different accents look like the same product with a hue rotation, which
 * undercuts the exact thing a custom domain is sold on ("this is *my* website").
 * So the three differ by **sales posture**: how many units the dealer carries and
 * how they want a buyer to move. They share every primitive underneath, which is
 * what stops three layouts becoming three maintenance burdens.
 */

import type { StorefrontLayout } from '@/db/schema';
import type { LayoutComponent, LayoutMeta } from './types';
import { ClassicLayout } from './classic';
import { ShowcaseLayout } from './showcase';
import { LotListLayout } from './lot-list';

export const LAYOUTS: Record<StorefrontLayout, { component: LayoutComponent; meta: LayoutMeta }> = {
  CLASSIC: {
    component: ClassicLayout,
    meta: {
      id: 'CLASSIC',
      name: 'Classic',
      blurb: 'Filter rail on the left, dense grid of units on the right.',
      bestFor: 'Forty units or more, where buyers arrive knowing roughly what they want.',
    },
  },
  SHOWCASE: {
    component: ShowcaseLayout,
    meta: {
      id: 'SHOWCASE',
      name: 'Showcase',
      blurb: 'One featured unit up top, then larger two-across cards.',
      bestFor: 'A smaller lot with good photography, or specialty inventory worth lingering on.',
    },
  },
  LOT_LIST: {
    component: LotListLayout,
    meta: {
      id: 'LOT_LIST',
      name: 'Lot list',
      blurb: 'No hero. A dense sortable list with your phone number pinned to the top.',
      bestFor: 'High-turn lots. "Here is everything, call me" — the fastest page to scan.',
    },
  },
};

export const LAYOUT_LIST = Object.values(LAYOUTS).map((l) => l.meta);

export function layoutFor(layout: StorefrontLayout): LayoutComponent {
  return (LAYOUTS[layout] ?? LAYOUTS.CLASSIC).component;
}
