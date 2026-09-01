/**
 * The dealer's loan application.
 *
 * `/loan-application`, matching the path their CarsForSale site already uses —
 * a dealer moving their domain across keeps whatever links and search presence
 * that URL has rather than starting it over on a prettier slug.
 *
 * THE PAGE EXISTS ONLY WHEN THE DEALER HAS A PROVIDER. No URL configured, no
 * route and no nav link: a dead "Financing" link is worse for a dealer than no
 * link at all, and a financing page with nothing on it is worse than both.
 *
 * WHAT WE DO AND DO NOT TOUCH. The form inside the frame is the dealer's own,
 * served by their F&I provider, submitting straight to them. It asks for date of
 * birth and a social security number. Rooftop never sees a keystroke of it and
 * must never be built to — that is the same rule as "never take a DealerCenter
 * login" in `claude/dealercenter-interop.md`, and it is what keeps this feature
 * outside GLBA Safeguards scope entirely. The page says so out loud, because a
 * buyer typing a SSN into a form on a dealership's website deserves to be told
 * whose form it is.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getStorefrontByKey, storefrontBasePath } from '@/lib/queries';
import { CreditAppFrame } from '@/components/store/credit-app-frame';
import { creditAppFor, standaloneUrl } from '@/lib/store/credit-app';
import { breadcrumbLd, canonicalOrigin, telHref } from '@/lib/store/seo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  if (!sf || !creditAppFor(sf.creditAppUrl)) return { title: 'Not found' };

  const host = (await headers()).get('host')?.toLowerCase().replace(/^www\./, '') ?? '';
  const onOwnDomain = Boolean(sf.domain) && sf.domainStatus === 'LIVE' && host === sf.domain;
  const origin = canonicalOrigin(sf, host);
  const url = `${origin}${storefrontBasePath(sf, host)}/loan-application`;

  return {
    title: 'Loan Application',
    description:
      `Apply for financing at ${sf.name}. Secure online credit application — a few minutes to ` +
      `fill in, and a salesperson will call you back with your options.`,
    ...(onOwnDomain
      ? { alternates: { canonical: url } }
      : { robots: { index: false, follow: true } }),
  };
}

export default async function LoanApplicationPage({ params }: Params) {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  if (!sf) notFound();

  /* Re-validated here rather than trusted from the column: the allowlist is the
     whole security model, and a row written before a provider was removed from
     it must stop rendering the moment it is. */
  const app = creditAppFor(sf.creditAppUrl);
  if (!app) notFound();

  const host = (await headers()).get('host');
  const basePath = storefrontBasePath(sf, host);
  const origin = canonicalOrigin(sf, host);
  const home = basePath || '/';

  const ld = breadcrumbLd([
    { name: sf.name, url: `${origin}${home}` },
    { name: 'Loan Application', url: `${origin}${basePath}/loan-application` },
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      <nav aria-label="Breadcrumb" className="text-sm text-[var(--text-3)]">
        <Link href={home} className="hover:text-[var(--brand-text)] hover:underline">
          {sf.name}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-[var(--text-2)]">Loan application</span>
      </nav>

      <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)] sm:text-3xl">
        Apply for financing
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--text-2)]">
        Fill this in and we&apos;ll get to work on your options. Most people are done in about ten
        minutes. Nothing here commits you to a car or to a loan.
      </p>

      {/* What to have to hand. Costs nothing to say and saves the half-finished
          application that gets abandoned at the employment section. */}
      <div
        className="mt-5 rounded-lg border bg-[var(--paper)] p-4"
        style={{ borderColor: 'var(--line)' }}
      >
        <h2 className="text-sm font-semibold text-[var(--text)]">Worth having ready</h2>
        <ul className="mt-2 grid gap-1.5 text-sm text-[var(--text-2)] sm:grid-cols-2">
          <li>Your driver&apos;s licence</li>
          <li>Your current address, and how long you have been there</li>
          <li>Where you work and roughly what you earn</li>
          <li>Your rent or mortgage payment</li>
        </ul>
      </div>

      {/*
        Whose form this is, said plainly and above the fold.

        A buyer is about to type a social security number into a page whose
        address bar reads the dealership's domain. Naming the company that
        actually receives it is the honest thing to do, and it is also the thing
        that makes the page look legitimate rather than like a harvesting form.
      */}
      {/*
        The button is primary and above the frame, not a footnote below it.

        Providers gate embedding on the domain: DealerCenter reads the Referer
        and refuses any address not registered to the dealer's account, so a
        storefront still on the shared host — or on a domain nobody has told the
        provider about — renders a red "cannot be embedded" box where the form
        should be. There is no way to detect that from the page, because the
        frame is cross-origin. So the path that always works is the one offered
        first, and the frame below it is the bonus when it happens to load.
      */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={standaloneUrl(app)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md px-4 py-2.5 text-sm font-bold"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          Start your application ↗
        </a>
        <span className="text-xs text-[var(--text-3)]">
          Opens {app.provider}&apos;s secure form in a new window.
        </span>
      </div>

      <p className="mt-4 text-xs text-[var(--text-3)]">
        This application is provided and secured by <b>{app.provider}</b> ({app.host}). It is
        submitted directly to {sf.name} and their lenders — {sf.name}&apos;s website does not store
        what you type here. If the form below does not load, use the button above.
      </p>

      <div className="mt-3">
        <CreditAppFrame src={app.url} provider={app.provider} />
      </div>

      <p className="mt-6 text-sm text-[var(--text-2)]">
        Stuck, or would rather do it over the phone?{' '}
        <a
          href={telHref(sf.phone)}
          className="tnum font-semibold text-[var(--brand-text)] hover:underline"
        >
          Call {sf.phone}
        </a>
        .
      </p>
    </div>
  );
}
