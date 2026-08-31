import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getStorefrontByKey, storefrontBasePath } from '@/lib/queries';
import { storeTheme, storeThemeVars } from '@/lib/branding/palette';
import { MobileCallBar } from '@/components/store/call-bar';
import { OpenNow } from '@/components/store/location';
import { visitPath, type SeoRooftop } from '@/lib/store/seo';
import { isWeekHours } from '@/lib/store/hours';

type Params = { params: Promise<{ slug: string }> };

const telHref = (phone: string) => `tel:+1${phone.replace(/\D/g, '')}`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  if (!sf) return { title: 'Inventory' };

  /*
   * Every storefront is reachable at two addresses on purpose — its Rooftop slug
   * and, once pointed, the dealer's own domain. That is what lets a dealer use
   * their site before their DNS moves and keeps everything they shared working
   * afterwards (`getStorefrontByKey` matches `slug = key OR domain = key`).
   *
   * Two URLs serving identical content is also textbook duplicate content, and
   * left alone it splits a small dealer's search presence across a hostname they
   * own and one they don't. So exactly one address is canonical:
   *
   *   - live on their own domain  → that domain is canonical, and the slug path
   *                                 is noindex, pointing at it
   *   - not live yet              → nothing is indexed at all
   *
   * The second case is the one that matters more than it looks. A half-built
   * storefront on a shared host, with no logo and no attribution, is precisely the
   * shape Google Safe Browsing reads as deceptive — see §9 of
   * `claude/meta-screencast-recording-guide.md`, which cost three days. Keeping
   * unfinished sites out of the index is cheap insurance.
   *
   * Host-derived rather than status-derived, because the same route serves both:
   * `proxy.ts` rewrites the dealer's host into `/s/<host>`, so the incoming host
   * is the only thing that says which address the visitor actually typed.
   */
  const host = (await headers()).get('host')?.toLowerCase().replace(/^www\./, '') ?? '';
  const domainLive = Boolean(sf.domain) && sf.domainStatus === 'LIVE';
  const onOwnDomain = domainLive && host === sf.domain;

  return {
    title: { default: `${sf.name} — Used Cars, Trucks & SUVs`, template: `%s · ${sf.name}` },
    description: sf.tagline ?? `Current inventory at ${sf.name}.`,
    ...(onOwnDomain
      ? { alternates: { canonical: `https://${sf.domain}` } }
      : {
          robots: { index: false, follow: true },
          ...(domainLive ? { alternates: { canonical: `https://${sf.domain}` } } : {}),
        }),
  };
}

export default async function StorefrontLayout({
  children,
  params,
}: Params & { children: React.ReactNode }) {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  if (!sf) notFound();

  /*
   * On the dealer's own domain the storefront is the whole site, so links drop
   * the `/s/<slug>` prefix and the address bar never shows our routing.
   */
  const host = (await headers()).get('host');
  const base = storefrontBasePath(sf, host);
  const homeHref = base || '/';

  /*
   * The dealer's theme, resolved once here into flat CSS custom properties.
   *
   * Every component below reads `var(--paper)` / `var(--text)` / `var(--brand)`
   * and takes no color prop, so a fourth layout — or a fourth theme — inherits
   * the whole thing for free. The resolution itself lives in
   * `src/lib/branding/palette.ts` so that the admin preview and these pages
   * cannot disagree about what a theme looks like.
   */
  const tokens = storeTheme(sf.theme, sf.brandColor, sf.accentColor);
  const themeVars = storeThemeVars(tokens) as React.CSSProperties;

  const logoUrl = sf.logoKey ? `/api/logo/${sf.logoKey}` : null;

  /*
   * The lot the header and the mobile bar speak for.
   *
   * A single-lot storefront is the overwhelming majority and gets a Directions
   * button that goes straight there. A multi-lot storefront has no honest answer
   * to "directions to where", so the bar keeps Call — which is always right,
   * the number is the storefront's — and the header link goes to the first
   * lot's page, which lists the others.
   */
  const rooftops = sf.rooftops as unknown as SeoRooftop[];
  const primary = rooftops[0] ?? null;
  const single = rooftops.length === 1 ? primary : null;
  const liveHours = primary ? isWeekHours(primary.hours) : false;

  return (
    <div
      data-store-theme={sf.theme}
      style={themeVars}
      className="flex min-h-screen flex-col bg-[var(--page)] text-[var(--text)]"
    >
      {/*
        The root element paints the page, but overscroll and the strip below a
        short page show `body`, which the admin theme leaves light grey — a white
        flash at the bottom of a dark storefront. Custom properties only inherit
        downward, so `body` cannot read `--page`; it gets the literal value.
      */}
      <style>{`body{background:${tokens.page}}`}</style>
      {/* Null on the BRAND theme, where the header bar is the color. */}
      {tokens.headerRule ? (
        <div className="h-1 w-full" style={{ background: tokens.headerRule }} />
      ) : null}

      <header
        className="sticky top-0 z-30 border-b bg-[var(--header-bg)]"
        style={{ borderColor: 'var(--header-line)' }}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href={homeHref} className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              /* Fixed height, auto width: a dealer's logo is whatever aspect
                 ratio their sign shop gave them, and squashing it looks cheap. */
              <img
                src={logoUrl}
                alt={sf.name}
                className="h-9 w-auto max-w-[180px] shrink-0 object-contain"
              />
            ) : (
              /* The no-logo fallback. Deliberately header-fg on header-bg rather
                 than the brand color: on the BRAND theme a brand-colored tile
                 sits on a brand-colored bar and disappears. */
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-black"
                style={{ background: 'var(--header-fg)', color: 'var(--header-bg)' }}
              >
                {sf.name.replace(/[^A-Za-z ]/g, '').split(' ').slice(0, 2).map((w) => w[0]).join('')}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold leading-tight text-[var(--header-fg)]">
                {sf.name}
              </span>
              {sf.tagline ? (
                <span className="block truncate text-xs leading-tight text-[var(--header-muted)]">
                  {sf.tagline}
                </span>
              ) : null}
            </span>
          </Link>

          <nav className="ml-auto flex items-center gap-4">
            <Link
              href={homeHref}
              className="hidden text-sm font-medium text-[var(--header-fg)] opacity-80 hover:opacity-100 sm:block"
            >
              Inventory
            </Link>
            {/* Only when there is something behind it. A nav link to an empty
                About section is worse than no link. */}
            {sf.about?.trim() ? (
              <Link
                href={`${homeHref}#about`}
                className="hidden text-sm font-medium text-[var(--header-fg)] opacity-80 hover:opacity-100 sm:block"
              >
                About
              </Link>
            ) : null}
            {primary ? (
              <Link
                href={visitPath(base, primary)}
                className="hidden text-sm font-medium text-[var(--header-fg)] opacity-80 hover:opacity-100 sm:block"
              >
                {sf.rooftops.length > 1 ? 'Locations' : 'Visit'}
              </Link>
            ) : null}
            <div className="text-right">
              <a
                href={telHref(sf.phone)}
                className="tnum block text-[15px] font-semibold leading-tight text-[var(--header-link)] hover:underline"
              >
                {sf.phone}
              </a>
              {/*
                Structured hours win over the free-text line when both are set.
                `hoursNote` is a glance the dealer typed once; `OpenNow` is
                computed against the lot's own clock every request, so it is the
                one that can say "closes at 6" and be right about it.
              */}
              {liveHours ? (
                <OpenNow rooftop={primary!} className="block text-[11px] leading-tight text-[var(--header-muted)]" />
              ) : sf.hoursNote ? (
                <span className="block text-[11px] leading-tight text-[var(--header-muted)]">
                  {sf.hoursNote}
                </span>
              ) : null}
            </div>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <MobileCallBar phone={sf.phone} rooftop={single} />

      <footer
        className="mt-12 border-t bg-[var(--footer-bg)]"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--footer-text)]">{sf.name}</div>
            {/*
              The footer NAP. Prefers the lot's own address over the storefront's
              free-text line for the same reason the hours below prefer the
              structured week: two places to type the same fact is two places for
              it to be typed differently, and a footer that disagrees with the
              location card six inches above it is worse than either alone —
              inconsistent NAP is the thing local ranking punishes.
            */}
            {primary ? (
              <address className="mt-1 not-italic text-sm text-[var(--footer-muted)]">
                {primary.addressLine1}, {primary.city}, {primary.state} {primary.postalCode}
              </address>
            ) : sf.addressLine ? (
              <div className="mt-1 text-sm text-[var(--footer-muted)]">{sf.addressLine}</div>
            ) : null}
            <div className="mt-1 text-sm text-[var(--footer-muted)]">
              <a href={telHref(sf.phone)} className="hover:underline">
                {sf.phone}
              </a>
              {liveHours ? (
                <>
                  {' · '}
                  <OpenNow rooftop={primary!} className="whitespace-nowrap" />
                </>
              ) : sf.hoursNote ? (
                <span> · {sf.hoursNote}</span>
              ) : null}
            </div>
          </div>
          <div className="text-xs text-[var(--footer-muted)] md:text-right">
            <p>
              Prices exclude tax, title, license and a documentary service fee. Vehicles are subject
              to prior sale.
            </p>
            {/*
              A real link, not a text label. Storefronts run on the dealer's own
              domain, so this is the only thing on the page that says who
              operates it — and an unattributed dealership site on a
              days-old domain is part of what Google Safe Browsing reads as
              deceptive. See `claude/meta-screencast-recording-guide.md` §9.
              Do not turn this back into a plain <p>.
            */}
            <p className="mt-2">
              Powered by{' '}
              <a
                href="https://rooftopauto.com"
                target="_blank"
                rel="noopener"
                className="underline hover:text-[var(--footer-text)]"
              >
                Rooftop Auto
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
