import { headers } from 'next/headers';
import { sessionScope, getGroup, getRooftops } from '@/lib/queries';
import { storefrontsInScope } from '@/lib/scoped-db';
import { domainsConfigured } from '@/lib/domains/vercel';
import { lookupDomain } from '@/lib/domains/lookup';
import { buildInstructions } from '@/lib/domains/instructions';
import { buildReadiness } from '@/lib/domains/readiness';
import { publicUnitCount } from '@/lib/domains/units';
import { isDefaultPalette } from '@/lib/branding/palette';

/**
 * Everything the three Website screens share.
 *
 * The section used to be one page because from the dealer's side it is one
 * decision — "what does my site look like and where is it". It stopped being
 * one screen when it grew past a laptop's worth of scrolling, but the *data* is
 * still one load, so it lives here rather than being copied three ways.
 *
 * `withDomain` is not an optimisation flourish. The domain branch does a live
 * DNS lookup and, in the reserved phase, a units count — real latency on every
 * render. Design and Analytics have no use for either, and a colour picker that
 * waits on a DNS resolver is how a screen earns a reputation for being slow.
 */
export async function loadWebsite({ withDomain = false }: { withDomain?: boolean } = {}) {
  const scope = await sessionScope();
  const storefronts = await storefrontsInScope(scope);
  const sf = storefronts[0];
  if (!sf) return null;

  const [group, rooftops, host] = await Promise.all([
    getGroup(),
    getRooftops(),
    headers().then((h) => h.get('host')),
  ]);

  /*
   * The address the dealer can use today. Absolute rather than relative,
   * because the entire point is that they can copy it into a text message.
   */
  const interimUrl = `https://${host ?? 'app.rooftopauto.com'}/s/${sf.slug}`;
  const live = sf.domainStatus === 'LIVE';
  const previewUrl = live && sf.domain ? `https://${sf.domain}` : `/s/${sf.slug}`;

  /*
   * Has this dealer ever actually been through the design step?
   *
   * A logo is the honest tell — colors always hold *some* value, because the
   * column has a default, so "not the default" is the only signal there and a
   * dealer who genuinely wants Rooftop blue would be walked through setup for
   * ever. With no logo and untouched colors, nothing on this storefront was
   * chosen, so we run the guided version. Once either is set, they get the
   * everything-at-once editor, which is what someone changing one color wants.
   */
  const designConfigured = Boolean(sf.logoKey) || !isDefaultPalette(sf.brandColor, sf.accentColor);

  const base = {
    sf,
    group,
    rooftops,
    rooftop: rooftops[0],
    host,
    live,
    interimUrl,
    previewUrl,
    designConfigured,
    configured: domainsConfigured(),
  };

  if (!withDomain) {
    return { ...base, phase: 'none' as const, lookup: null, instructions: null, readiness: null, daysSaved: null };
  }

  /*
   * Three phases, not two, and the middle one is the point of that screen.
   *
   *   none      nothing recorded — offer both paths
   *   reserved  we hold the domain and have deliberately not touched their DNS
   *   pointing  records are changing or changed; Vercel is the source of truth
   *
   * `domain` alone never meant "connected". A row can carry a domain string
   * that was never set up — seeded rows do — which is what produced a status
   * panel and a Disconnect button for a connection that did not exist.
   */
  const phase: 'none' | 'reserved' | 'pointing' = !sf.domain
    ? 'none'
    : sf.domainStatus === 'NONE' || sf.domainStatus === 'RESERVED'
      ? 'reserved'
      : 'pointing';

  /*
   * Re-derive instructions server-side whenever the domain is not yet live, so
   * a dealer coming back sees the current state of *their* DNS rather than
   * whatever we cached when they first typed it in. This is the screen they
   * return to precisely because something has not happened yet.
   */
  const lookup = phase !== 'none' && !live ? await lookupDomain(sf.domain!) : null;
  const instructions = lookup ? buildInstructions(lookup, sf.domainVerification) : null;

  const readiness =
    phase === 'reserved'
      ? buildReadiness({
          logoKey: sf.logoKey,
          brandColor: sf.brandColor,
          accentColor: sf.accentColor,
          publicUnitCount: await publicUnitCount(sf.id),
          caaBlocks: lookup?.ok ? lookup.caa.blocksLetsEncrypt : false,
          mx: lookup?.ok ? lookup.mx.map((m) => m.exchange) : [],
          /*
           * Read off the instructions rather than off `lookup.registered`.
           * These two render one above the other, so any disagreement is
           * visible on screen — and the first version disagreed immediately.
           * Deriving both from the same decision makes that class of bug
           * impossible rather than fixed.
           */
          domainRegistered: instructions?.ok ? instructions.state !== 'not-registered' : true,
        })
      : null;

  const daysSaved = sf.domainReservedAt
    ? Math.max(0, Math.round((Date.now() - new Date(sf.domainReservedAt).getTime()) / 86_400_000))
    : null;

  return { ...base, phase, lookup, instructions, readiness, daysSaved };
}

/** The same title bar on all three screens, so the section reads as one place. */
export function WebsiteHeader({
  name,
  subtitle,
  previewUrl,
}: {
  name: string;
  subtitle: string;
  previewUrl: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{name}</h1>
        <p className="mt-0.5 text-sm text-ink-600">{subtitle}</p>
      </div>
      <a
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-ink-300 px-3 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50"
      >
        View site →
      </a>
    </header>
  );
}
