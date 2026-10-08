/**
 * Rooftop Auto — catching the URLs a dealer's old website used to serve.
 *
 * ## Why this is patterns and not a list of one dealer's pages
 *
 * Built 8 Oct 2026 for Malabar Truck and Trade's cutover off CarsForSale. Their
 * sitemap had 28 URLs and a lookup table would have handled it — but 22 of the
 * 28 were not *theirs*. They were CarsForSale's URL scheme, generated the same
 * way on every dealer site that platform hosts:
 *
 *   /chevrolet-for-sale-c998972                  make
 *   /chevrolet-silverado-1500-for-sale-c999082   make + model
 *   /pickup-trucks-for-sale-b100030              body style
 *   /details/used-2018-chevrolet-silverado-1500/131418036   a vehicle
 *
 * Every dealer migrating off CarsForSale arrives carrying exactly this shape, so
 * the rules below are the asset and the dealer is the variable. The next
 * migration costs nothing.
 *
 * ## Pure, because `proxy.ts` is
 *
 * No database, no I/O, no async. The proxy runs on every request to every dealer
 * host and the build log is emphatic that it does zero database work on the
 * request path. That rules out the tempting version of this — checking whether a
 * make actually exists in *this* dealer's inventory before redirecting to it —
 * and the cost is acceptable: a filtered SRP with no matches renders an empty
 * state on the right website, which is a far better landing than a 404.
 *
 * ## 301, and what that commits us to
 *
 * Permanent, so Google moves the old page's authority to the new one rather than
 * treating the move as temporary. The commitment is real: browsers cache a 301
 * hard, so a rule that sends `/about` somewhere wrong is close to unfixable for
 * anyone who hit it once. That is why the fixed-page table below is a short list
 * of names CarsForSale actually uses rather than a clever guess, and why
 * anything unrecognised falls through to the home page instead of to a URL this
 * module invented.
 */

/* ------------------------------------------------------------------ makes */

/**
 * Makes we will recognise inside a CarsForSale slug.
 *
 * Needed because the slug `used-2018-chevrolet-silverado-1500` gives no
 * delimiter between make and model — the only way to split it is to know where
 * the make ends. Longest-first matching, so `land-rover` is not read as `land`
 * and `mercedes-benz` is not read as `mercedes`.
 *
 * Deliberately not exhaustive. A make that is missing produces a redirect to the
 * home page, which is correct behaviour for an unknown URL; a make that is wrong
 * would produce a filtered page for a car the dealer has never stocked.
 */
const MAKES = [
  'alfa-romeo', 'aston-martin', 'land-rover', 'mercedes-benz', 'rolls-royce',
  'acura', 'audi', 'bentley', 'bmw', 'buick', 'cadillac', 'chevrolet',
  'chrysler', 'dodge', 'ferrari', 'fiat', 'ford', 'genesis', 'gmc', 'honda',
  'hummer', 'hyundai', 'infiniti', 'isuzu', 'jaguar', 'jeep', 'kia',
  'lamborghini', 'lexus', 'lincoln', 'maserati', 'mazda', 'mclaren', 'mercury',
  'mini', 'mitsubishi', 'nissan', 'oldsmobile', 'plymouth', 'polestar',
  'pontiac', 'porsche', 'ram', 'rivian', 'saab', 'saturn', 'scion', 'subaru',
  'suzuki', 'tesla', 'toyota', 'volkswagen', 'volvo',
].sort((a, b) => b.length - a.length);

/**
 * How a make is spelled once it reaches the filter.
 *
 * Covers the initialisms and, more importantly, the makes whose own name
 * contains a hyphen. Title-casing `mercedes-benz` by word gives
 * "Mercedes Benz", which matches nothing in a dealer's inventory — the hyphen is
 * part of the name, not a slug separator, and there is no way to tell those two
 * apart from the slug alone.
 */
const MAKE_DISPLAY: Record<string, string> = {
  bmw: 'BMW',
  gmc: 'GMC',
  ram: 'Ram',
  mini: 'MINI',
  'mercedes-benz': 'Mercedes-Benz',
  'rolls-royce': 'Rolls-Royce',
  'alfa-romeo': 'Alfa Romeo',
  'aston-martin': 'Aston Martin',
  'land-rover': 'Land Rover',
};

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

function makeName(slug: string): string {
  return MAKE_DISPLAY[slug] ?? titleCase(slug);
}

/**
 * Model names, where the slug is ambiguous and we pick the common reading.
 *
 * CarsForSale uses one hyphen for two jobs — inside a name (`f-150`, `c-class`)
 * and between words (`super-duty`) — so `f-350-super-duty` is structurally
 * identical to a three-word model. The rule that gets the most real inventory
 * right: **a single leading letter binds to whatever follows it with a hyphen,
 * and everything after that is words.**
 *
 *   f-150              → F-150
 *   f-350-super-duty   → F-350 Super Duty
 *   c-class            → C-Class
 *   silverado-1500     → Silverado 1500
 *
 * That covers the alphanumeric trucks and the German sedans, which between them
 * are most of what gets a model-specific page on an independent lot.
 */
function modelName(slug: string): string {
  const leadingLetter = /^([a-z])-([a-z0-9]+)(?:-(.*))?$/.exec(slug);
  if (leadingLetter) {
    const [, letter, bound, rest] = leadingLetter;
    const head = `${letter!.toUpperCase()}-${/^\d+$/.test(bound!) ? bound : titleCase(bound!)}`;
    return rest ? `${head} ${titleCase(rest)}` : head;
  }
  return titleCase(slug);
}

/* ------------------------------------------------------------------ bodies */

/**
 * CarsForSale's body slugs → our `bodyStyleEnum`.
 *
 * Theirs is a merchandising vocabulary and ours is a structural one, so a couple
 * of these are judgement calls rather than translations. `chassis` is the one
 * worth naming: a cab-and-chassis is not a pickup, but every unit on a lot that
 * carries them is a truck to a shopper, and `TRUCK` is the filter that shows
 * them. Sending it to the unfiltered home page would be more literal and less
 * useful.
 */
const BODIES: Record<string, string> = {
  'pickup-trucks': 'TRUCK',
  trucks: 'TRUCK',
  chassis: 'TRUCK',
  suvs: 'SUV',
  'suvs-crossovers': 'SUV',
  crossovers: 'SUV',
  vans: 'VAN',
  minivans: 'VAN',
  cars: 'SEDAN',
  sedans: 'SEDAN',
  coupes: 'COUPE',
  convertibles: 'CONVERTIBLE',
  hatchbacks: 'HATCHBACK',
  wagons: 'WAGON',
};

/* ------------------------------------------------------------ fixed pages */

/**
 * Page names CarsForSale ships, and the Rooftop page that replaces each.
 *
 * Both spellings of the ones that vary between their themes — `/contact` and
 * `/contact-us` — because guessing wrong here costs a real visitor, not a
 * crawler. Everything that has no Rooftop equivalent goes to the home page: the
 * about text, hours and phone all live there, so it is not a dead end.
 *
 * Lowercased before lookup. `/TermsAndConditions` is CarsForSale's own casing.
 */
const FIXED: Record<string, string> = {
  '/about': '/',
  '/about-us': '/',
  '/contact': '/',
  '/contact-us': '/',
  '/testimonials': '/',
  '/reviews': '/',
  '/sitemap': '/',
  '/termsandconditions': '/',
  '/terms-and-conditions': '/',
  '/privacy-policy': '/privacy',
  '/cars-for-sale': '/',
  '/inventory': '/',
  '/used-cars': '/',
  '/home': '/',
  '/loan-application': '/loan-application',
  '/financing': '/loan-application',
  '/apply': '/loan-application',
  '/credit-application': '/loan-application',
};

/* ------------------------------------------------------------------ input */

export type LegacyContext = {
  /**
   * Where `/make-a-payment` should go, when the dealer has somewhere for it to
   * go. Malabar's is an Authorize.net Simple Checkout link.
   *
   * Per-dealer and currently supplied by the caller, not the database — see
   * `paymentLinkFor`. Absent, the path falls through to the home page rather
   * than to somebody else's payment form, which is the only acceptable default
   * for this particular URL.
   */
  paymentUrl?: string;
};

/* ------------------------------------------------------------------ rules */

function srp(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/?${qs}` : '/';
}

/**
 * Where an old URL should land, or null if this module has no opinion.
 *
 * Null means "not a legacy URL" and the caller should carry on with normal
 * routing — it is NOT the same as "redirect home". A storefront's own paths
 * (`/`, a stock number, `/privacy`) must return null here or the site redirects
 * itself in a loop.
 */
export function legacyRedirect(pathname: string, ctx: LegacyContext = {}): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return null;

  const lower = path.toLowerCase();

  // The dealer's payment link, when there is one.
  if (lower === '/make-a-payment' || lower === '/makeapayment' || lower === '/payments') {
    return ctx.paymentUrl ?? '/';
  }

  if (FIXED[lower] !== undefined) {
    const target = FIXED[lower]!;
    // `/loan-application` maps to itself. Returning it would redirect the real
    // page to itself forever.
    return target === path ? null : target;
  }

  /*
   * `/details/used-2018-chevrolet-silverado-1500/131418036`
   *
   * The trailing number is CarsForSale's inventory id and means nothing to us —
   * there is no mapping from it to a stock number, and inventing one would land
   * a shopper on the wrong truck. So a vehicle page becomes the closest filtered
   * search we can describe from the slug, which at worst is the make.
   */
  const details = /^\/details\/([^/]+)(?:\/\d+)?$/.exec(lower);
  if (details) {
    const parsed = parseVehicleSlug(details[1]!);
    if (!parsed) return '/';
    return srp(parsed.model ? { make: parsed.make, model: parsed.model } : { make: parsed.make });
  }

  /* `/pickup-trucks-for-sale-b100030` — body style. */
  const body = /^\/([a-z0-9-]+)-for-sale-b\d+$/.exec(lower);
  if (body && BODIES[body[1]!]) return srp({ body: BODIES[body[1]!]! });

  /* `/chevrolet-silverado-1500-for-sale-c999082` — make, or make + model. */
  const makeModel = /^\/([a-z0-9-]+)-for-sale-c\d+$/.exec(lower);
  if (makeModel) {
    const parsed = splitMakeModel(makeModel[1]!);
    if (!parsed) return '/';
    return srp(parsed.model ? { make: parsed.make, model: parsed.model } : { make: parsed.make });
  }

  /*
   * A `-for-sale-` URL we could not read is still unmistakably theirs, so it
   * goes home rather than 404ing. Anything else is none of our business.
   */
  if (/-for-sale-[bc]\d+$/.test(lower)) return '/';

  return null;
}

/** `used-2018-chevrolet-silverado-1500` → make and model. */
function parseVehicleSlug(slug: string): { make: string; model: string } | null {
  const withoutCondition = slug.replace(/^(used|new|certified|pre-owned)-/, '');
  const withoutYear = withoutCondition.replace(/^(19|20)\d{2}-/, '');
  return splitMakeModel(withoutYear);
}

/** `chevrolet-silverado-1500` → `{ make: 'Chevrolet', model: 'Silverado 1500' }`. */
function splitMakeModel(slug: string): { make: string; model: string } | null {
  for (const m of MAKES) {
    if (slug === m) return { make: makeName(m), model: '' };
    if (slug.startsWith(`${m}-`)) {
      return { make: makeName(m), model: modelName(slug.slice(m.length + 1)) };
    }
  }
  return null;
}

/* ----------------------------------------------------------- payment links */

/**
 * The one per-dealer value in this module, kept in one place on purpose.
 *
 * `/make-a-payment` is a real customer function, not an SEO concern — a buy-here
 * pay-here customer who cannot find where to pay does not shrug and try again
 * next month. On CarsForSale it is a POST form to Authorize.net Simple Checkout
 * carrying a `LinkId`; the same link works as a GET, which is why this is a
 * redirect and not a page we have to host.
 *
 * **This belongs on the storefront row, not here.** It is a hardcoded map today
 * because exactly one dealer has one, and the second dealer is when we will
 * learn whether the field should hold a URL, a processor plus an id, or a whole
 * payments setting. Adding a column now would be guessing at a schema from a
 * sample of one. When the second dealer arrives: add it to `storefronts`, read
 * it in `proxy.ts`, delete this map.
 *
 * Keyed by apex host, so `www.` must be stripped before lookup.
 */
const PAYMENT_LINKS: Record<string, string> = {
  'malabartruckandtrade.com':
    'https://simplecheckout.authorize.net/payment/CatalogPayment.aspx?LinkId=53fe6784-399b-4896-8803-418acb0fb2bf',
};

export function paymentLinkFor(apexHost: string): string | undefined {
  return PAYMENT_LINKS[apexHost.toLowerCase()];
}
