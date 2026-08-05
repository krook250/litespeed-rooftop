/**
 * Is this storefront ready to have a real domain pointed at it?
 *
 * The problem this solves is not technical. A dealer whose domain currently
 * serves the website they are leaving can, in one click, aim their actual
 * business address at a Rooftop storefront with no logo, default blue, and
 * nothing on the lot. Everything about that works — the DNS is right, the
 * certificate issues, the page returns 200 — and it is still the worst thing
 * that can happen to them during onboarding, because the failure is invisible to
 * us and obvious to their customers.
 *
 * So the cutover is gated on the site being worth arriving at. The gate is
 * **soft**: `ready` is advisory and the UI offers an explicit override, because
 * a dealer who has cleared the lot and wants the site up anyway is not wrong and
 * we are not their landlord. What the gate buys is that pointing a live domain
 * at an empty storefront becomes a decision instead of an accident.
 *
 * Pure by design, like `instructions.ts` — no database, no `next/*`, no I/O — so
 * every branch is unit-testable and the same function can render the checklist
 * and decide the button state without the two drifting apart.
 */

import { isDefaultPalette } from '@/lib/branding/palette';

export type ReadinessItem = {
  id: 'registered' | 'design' | 'inventory' | 'certificate' | 'email';
  label: string;
  done: boolean;
  /** Shown under the label. Written to be actionable when `done` is false. */
  help: string;
  /**
   * Whether failing this item actually holds the cutover. `email` never does —
   * it is on the list to be *seen*, not to be passed. See below.
   */
  gating: boolean;
};

export type Readiness = {
  ready: boolean;
  items: ReadinessItem[];
  /** Gating items still outstanding, for the button's title text. */
  blockers: ReadinessItem[];
};

export type ReadinessInput = {
  logoKey: string | null;
  brandColor: string;
  accentColor: string;
  /** Vehicles the storefront would actually show a visitor today. */
  publicUnitCount: number;
  /**
   * From `analyseCaa`. `true` means the certificate provably cannot issue, so
   * cutting over produces a browser warning on their own domain — the one
   * failure here that is genuinely ours to prevent.
   */
  caaBlocks: boolean;
  /** MX records found on the domain, if we have looked it up. */
  mx: string[];
  /**
   * Whether anyone owns the domain at all, from RDAP.
   *
   * Found in the first live render of this screen: a reserved domain that is not
   * actually registered produced an all-green checklist and an enabled "point it"
   * button sitting directly above a panel explaining that nobody owns it. The two
   * halves of the screen contradicted each other, and the button would have tried
   * to attach a domain that can never resolve.
   *
   * Defaults to `true` at the call sites that have not done a lookup, because
   * "we did not check" must not read as "it is not registered".
   */
  domainRegistered: boolean;
};

/**
 * Layout is deliberately absent.
 *
 * `storefronts.layout` is `NOT NULL DEFAULT 'CLASSIC'`, so every storefront has
 * always "chosen" one and the check could never fail. A checklist item that is
 * green for everybody teaches the dealer to skim the list, which costs us the
 * items that do mean something.
 */
export function buildReadiness(input: ReadinessInput): Readiness {
  const designed = Boolean(input.logoKey) || !isDefaultPalette(input.brandColor, input.accentColor);

  const hasLogo = Boolean(input.logoKey);
  const hasColours = !isDefaultPalette(input.brandColor, input.accentColor);

  const items: ReadinessItem[] = [
    {
      id: 'registered',
      label: 'The domain exists',
      done: input.domainRegistered,
      gating: true,
      help: input.domainRegistered
        ? 'Registered and ready to point.'
        : 'Nobody owns this domain yet, so there is nothing to point at your storefront. Register it first — you can buy it through us, it is included.',
    },
    {
      id: 'design',
      label: 'Your branding is on the site',
      done: designed,
      gating: true,
      /*
       * Named honestly rather than generically. "Your logo and colours are set"
       * on a storefront with custom colours and no logo is a small lie that the
       * dealer can see through by looking at their own site, and a checklist that
       * says something untrue once is not read carefully again.
       */
      help: !designed
        ? 'Right now your site shows Rooftop blue and your initials. Add a logo or pick your colours below — it takes a minute and it is the first thing a customer sees.'
        : hasLogo && hasColours
          ? 'Your logo and colours are set.'
          : hasLogo
            ? 'Your logo is up. Your colours are still the Rooftop defaults — fine to leave, quick to change below.'
            : 'Your colours are set. No logo yet, so the header shows your initials — worth adding below if you have one.',
    },
    {
      id: 'inventory',
      label: 'There are cars to look at',
      done: input.publicUnitCount > 0,
      gating: true,
      help:
        input.publicUnitCount > 0
          ? `${input.publicUnitCount} ${input.publicUnitCount === 1 ? 'vehicle is' : 'vehicles are'} showing.`
          : 'Your storefront has nothing on it yet. Pointing your domain now means anyone who visits your address finds an empty lot.',
    },
    {
      id: 'certificate',
      label: 'The padlock can be issued',
      done: !input.caaBlocks,
      gating: true,
      help: input.caaBlocks
        ? 'A CAA record on your domain stops the certificate being issued, so your site would load with a security warning. The exact record to add is in the steps below.'
        : 'Nothing on your domain blocks the certificate.',
    },
    /*
     * Never gating, always shown.
     *
     * This item exists to be read, not passed. The thing a small dealer is
     * actually afraid of here is losing their email, and the cheapest way to
     * answer that fear is to show them their own MX records, unchanged, next to
     * the records we are asking them to add. A dealer with no MX at all is not
     * blocked from anything — plenty run their mail on a different domain — so
     * failing this must never stop the cutover.
     */
    {
      id: 'email',
      label: 'Your email is untouched',
      done: true,
      gating: false,
      help: input.mx.length
        ? `We found ${input.mx.length} mail ${input.mx.length === 1 ? 'record' : 'records'} on this domain and we are not changing any of them. Nothing in the steps below touches your mail.`
        : 'No mail records on this domain, so there is nothing here to disturb. If your email runs on a different domain it is unaffected either way.',
    },
  ];

  const blockers = items.filter((i) => i.gating && !i.done);
  return { ready: blockers.length === 0, items, blockers };
}

/** One sentence for the disabled button's tooltip and the feed nudge. */
export function readinessSummary(r: Readiness): string {
  if (r.ready) return 'Your storefront is ready for its own address.';
  const names = r.blockers.map((b) => b.label.toLowerCase());
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Before you point your domain: ${list}.`;
}
