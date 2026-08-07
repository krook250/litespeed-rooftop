/**
 * The one data contract every storefront layout renders.
 *
 * THE POINT OF THIS FILE: the route resolves a `StorefrontView` exactly once and
 * hands it to whichever layout the dealer picked. Layouts never query, never
 * touch the database, and never know about slugs or hosts. That is what makes a
 * fourth layout one new file plus one enum value — no route change, no query
 * change, nothing to keep in sync.
 */

import type { Storefront } from '@/db/schema';
import type { LiveVehicle } from '@/lib/queries';
import type { FacetOption, Filters, RawSearchParams } from '@/components/store/srp-filters';

export type StorefrontView = {
  storefront: Storefront & { rooftopIds: string[] };
  /** Everything retail-ready on the lot, before filters. */
  inventory: LiveVehicle[];
  /** What the current filters actually return, already sorted. */
  results: LiveVehicle[];
  filters: Filters;
  facets: {
    makes: FacetOption[];
    models: FacetOption[];
    bodies: FacetOption[];
    drivetrains: FacetOption[];
    years: number[];
  };
  /** '' on a custom domain, '/s/<slug>' on the shared app host. */
  basePath: string;
  searchParams: RawSearchParams;
  activeFilterCount: number;
  /** Resolved logo URL, or null when the dealer hasn't uploaded one. */
  logoUrl: string | null;
};

export type LayoutComponent = (props: { view: StorefrontView }) => React.ReactNode;

export type LayoutMeta = {
  id: string;
  name: string;
  /** Shown to the dealer on the picker. Describes the posture, not the pixels. */
  blurb: string;
  /** The honest "pick this if" line. */
  bestFor: string;
  /**
   * A real screenshot of this layout, once one exists — e.g.
   * `/layouts/classic.png` in `public/`. Until then the admin picker draws a
   * mockup in the dealer's own colors, which a screenshot cannot do. Setting
   * this switches that layout's tile to the image; the two can coexist, so
   * screenshots can land one layout at a time.
   */
  previewImage?: string;
};
