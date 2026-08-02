import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getStorefrontByKey, storefrontBasePath } from '@/lib/queries';

type Params = { params: Promise<{ slug: string }> };

const telHref = (phone: string) => `tel:+1${phone.replace(/\D/g, '')}`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  if (!sf) return { title: 'Inventory' };
  return {
    title: { default: `${sf.name} — Used Cars, Trucks & SUVs`, template: `%s · ${sf.name}` },
    description: sf.tagline ?? `Current inventory at ${sf.name}.`,
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
   * Brand and accent are set once here as CSS custom properties. Every layout
   * and every primitive reads `var(--brand)` / `var(--accent)`, so no component
   * ever takes a colour prop and a fourth layout inherits theming for free.
   */
  const brandVars = {
    '--brand': sf.brandColor,
    '--accent': sf.accentColor,
  } as React.CSSProperties;

  const logoUrl = sf.logoKey ? `/api/logo/${sf.logoKey}` : null;

  return (
    <div style={brandVars} className="flex min-h-screen flex-col bg-white">
      <div className="h-1 w-full bg-[var(--brand)]" />

      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
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
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-black text-white"
                style={{ background: 'var(--brand)' }}
              >
                {sf.name.replace(/[^A-Za-z ]/g, '').split(' ').slice(0, 2).map((w) => w[0]).join('')}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold leading-tight text-ink-900">
                {sf.name}
              </span>
              {sf.tagline ? (
                <span className="block truncate text-xs leading-tight text-ink-500">{sf.tagline}</span>
              ) : null}
            </span>
          </Link>

          <nav className="ml-auto flex items-center gap-4">
            <Link
              href={homeHref}
              className="hidden text-sm font-medium text-ink-700 hover:text-[var(--brand)] sm:block"
            >
              Inventory
            </Link>
            <div className="text-right">
              <a
                href={telHref(sf.phone)}
                className="tnum block text-[15px] font-semibold leading-tight text-[var(--brand)] hover:underline"
              >
                {sf.phone}
              </a>
              {sf.hoursNote ? (
                <span className="block text-[11px] leading-tight text-ink-500">{sf.hoursNote}</span>
              ) : null}
            </div>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-12 border-t border-ink-200 bg-ink-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink-900">{sf.name}</div>
            {sf.addressLine ? <div className="mt-1 text-sm text-ink-600">{sf.addressLine}</div> : null}
            <div className="mt-1 text-sm text-ink-600">
              <a href={telHref(sf.phone)} className="hover:underline">
                {sf.phone}
              </a>
              {sf.hoursNote ? <span className="text-ink-500"> · {sf.hoursNote}</span> : null}
            </div>
          </div>
          <div className="text-xs text-ink-500 md:text-right">
            <p>
              Prices exclude tax, title, license and a documentary service fee. Vehicles are subject
              to prior sale.
            </p>
            <p className="mt-2 text-ink-400">Powered by Rooftop Auto</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
