/**
 * What a brand-new dealer has to do before Rooftop is worth anything to them.
 *
 * WHY THIS EXISTS. Signup provisions a group, a rooftop and a storefront and
 * drops the dealer on an empty Lot Walk — `claude/auth-hosting-and-scale.md` §3
 * calls it "a new account lands on an empty lot", which was fine when every
 * account arrived attached to a phone call. Self-serve traffic started 4 Sep
 * 2026 and it is not fine now: we pay for the click either way, and what happens
 * in the first ten minutes is the whole difference between a trial that converts
 * and a tab that gets closed.
 *
 * MODELLED ON `src/lib/domains/readiness.ts`, deliberately, down to the shape of
 * the type. Same reasoning applies: pure — no database, no `next/*`, no I/O — so
 * every branch is unit-testable and the same function decides both what the card
 * says and whether the card appears at all. Two functions would drift.
 *
 * THE CARD DISAPPEARS ON ITS OWN. There is no dismiss button and nothing is
 * stored about having seen it, because the honest signal is the work itself: a
 * dealer with an address, cars and their branding on the site does not need the
 * card, and one who dismissed it at 9am still does. A dismissable checklist
 * measures irritation; this one measures progress.
 *
 * ORDER IS NOT ARBITRARY — it is what unblocks the most downstream. The lot's
 * address is first because it is the cheapest step and the most load-bearing:
 * the storefront footer NAP, local SEO and Meta's required latitude/longitude
 * all read it, and signup leaves it empty.
 */

export type OnboardingStep = {
  id: 'lot' | 'inventory' | 'design' | 'photos';
  label: string;
  done: boolean;
  /** Written to be actionable when `done` is false. Shown under the label. */
  help: string;
  /** Where the button goes. */
  href: string;
  /** The button's text when this step is the next one open. */
  cta: string;
  /**
   * Whether this step holds the card open. `photos` does not — see below.
   */
  gating: boolean;
};

export type Onboarding = {
  /** Every gating step passed. The card renders nothing. */
  complete: boolean;
  steps: OnboardingStep[];
  /** The first open step. What the card leads with. */
  next: OnboardingStep | null;
  doneCount: number;
};

export type OnboardingInput = {
  /** The lot's own record. Signup creates it with every one of these blank. */
  rooftop: {
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    phone: string;
  } | null;
  /** Storefront branding. */
  logoKey: string | null;
  /** True when the palette is still Rooftop's own — from `isDefaultPalette`. */
  defaultPalette: boolean;
  /** Vehicles in a live status. */
  unitCount: number;
  /** Of those, how many have at least one photo. */
  unitsWithPhotos: number;
};

/**
 * A lot needs a street, a town and a phone number to be a real place. Zip is
 * checked too because the geocoder and Meta both want it, but it is not called
 * out separately — a dealer typing their own address does not need four
 * checkboxes for it.
 */
function lotDone(r: OnboardingInput['rooftop']): boolean {
  if (!r) return false;
  return Boolean(
    r.addressLine1.trim() && r.city.trim() && r.state.trim() && r.postalCode.trim() && r.phone.trim(),
  );
}

export function buildOnboarding(input: OnboardingInput): Onboarding {
  const lot = lotDone(input.rooftop);
  const designed = Boolean(input.logoKey) || !input.defaultPalette;
  const hasUnits = input.unitCount > 0;
  const missingPhotos = Math.max(0, input.unitCount - input.unitsWithPhotos);

  const steps: OnboardingStep[] = [
    {
      id: 'lot',
      label: 'Tell us where the lot is',
      done: lot,
      gating: true,
      href: '/admin/lots',
      cta: 'Add your address',
      help: lot
        ? 'Your address and phone are set.'
        : 'Two minutes, and more depends on it than it looks: it is the address on your website, what Google matches you to locally, and Facebook will not advertise a vehicle without coordinates for the lot it sits on.',
    },
    {
      id: 'inventory',
      label: 'Get your cars in',
      done: hasUnits,
      gating: true,
      href: '/admin/inventory/import',
      cta: 'Import inventory',
      help: hasUnits
        ? `${input.unitCount} ${input.unitCount === 1 ? 'unit is' : 'units are'} on the lot.`
        : 'Bring a spreadsheet, a DMS export, or a link to the site you have now — we read all three, and we pull your photos across with them. Adding one by hand from a VIN works too.',
    },
    {
      id: 'design',
      label: 'Make it look like your store',
      done: designed,
      gating: true,
      href: '/admin/website/design',
      cta: 'Add your logo',
      /*
       * Named honestly, the same way readiness.ts names its design item: a
       * dealer can see their own site, and a checklist that claims something
       * they can disprove in one click does not get read again.
       */
      help: designed
        ? 'Your branding is on the site.'
        : 'Your storefront is Rooftop blue with your initials in the corner. A logo and your own colors take a minute and it is the first thing a customer sees.',
    },
    /*
     * NEVER GATING. Photos are the single biggest controllable difference
     * between a car that gets looked at and one that sits, and several channels
     * refuse a unit without them — so it belongs on the list. But a dealer who
     * has just imported 40 units cannot photograph them this afternoon, and a
     * card that will not go away until they have is a card that teaches them to
     * ignore cards. It is here to be seen, not passed.
     */
    {
      id: 'photos',
      label: 'Get photos on every unit',
      done: hasUnits && missingPhotos === 0,
      gating: false,
      href: '/admin/inventory',
      cta: 'See what is missing',
      help: !hasUnits
        ? 'Once your cars are in, this is where the money is. Two photos minimum per unit — several channels will not list one without them.'
        : missingPhotos === 0
          ? 'Every unit has photos. This is the thing most lots never finish.'
          : `${missingPhotos} of your ${input.unitCount} units ${missingPhotos === 1 ? 'has' : 'have'} no photos, so ${missingPhotos === 1 ? 'it is' : 'they are'} being skipped by the channels that require them.`,
    },
  ];

  const gating = steps.filter((s) => s.gating);
  return {
    complete: gating.every((s) => s.done),
    steps,
    next: steps.find((s) => !s.done) ?? null,
    doneCount: steps.filter((s) => s.done).length,
  };
}

/** One line for the card's heading. Speaks to where they actually are. */
export function onboardingSummary(o: Onboarding): string {
  if (o.complete) return 'Your lot is live.';
  const open = o.steps.filter((s) => s.gating && !s.done).length;
  return open === 1 ? 'One thing left to get your lot live' : `${open} things to get your lot live`;
}

/**
 * Adapter from the rows the home screens already have in hand.
 *
 * Deliberately takes loaded data rather than querying: `/admin/feed` and
 * `/admin/dashboard` both already fetch rooftops, storefronts and live
 * inventory in one `Promise.all`, and a `getOnboarding()` that went back to the
 * database would add three round-trips to the two most-loaded screens in the app
 * to answer a question the caller can already answer.
 *
 * Stays pure, so it lives here next to `buildOnboarding` rather than in
 * `queries.ts` — which is where `server-only` and `next/headers` are allowed and
 * this file must not import either.
 *
 * **The first rooftop and the first storefront.** Both are what signup creates,
 * and a multi-rooftop group is by definition past this checklist — nobody adds a
 * second lot before filling in the first one's address.
 */
export function onboardingFrom(args: {
  rooftops: OnboardingInput['rooftop'][];
  storefront: { logoKey: string | null; brandColor: string; accentColor: string } | undefined;
  inventory: { photos: unknown[] }[];
  /** `isDefaultPalette` from `@/lib/branding/palette`, passed in to keep this pure. */
  isDefaultPalette: (brand: string, accent: string) => boolean;
}): Onboarding {
  const sf = args.storefront;
  return buildOnboarding({
    rooftop: args.rooftops[0] ?? null,
    logoKey: sf?.logoKey ?? null,
    // No storefront at all is not "they picked the default" — but it is also
    // impossible after signup, and treating it as undesigned is the direction
    // that shows the checklist rather than hiding it.
    defaultPalette: sf ? args.isDefaultPalette(sf.brandColor, sf.accentColor) : true,
    unitCount: args.inventory.length,
    unitsWithPhotos: args.inventory.filter((v) => v.photos.length > 0).length,
  });
}
