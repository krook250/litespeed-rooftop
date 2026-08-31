/**
 * The blocks that turn an inventory page into a dealership website: who you are,
 * where you are, and when you are open.
 *
 * All three render below the inventory on the home page and again, in full, on
 * each lot's `/visit/<slug>` page. That repetition is the point rather than an
 * oversight — name, address and phone in visible text, identical on every page
 * they appear on, is the NAP consistency local ranking has always turned on. The
 * text and the `AutoDealer` JSON-LD are built from the same row, so they cannot
 * disagree.
 *
 * Rendered by the route, not by the layouts. All three layouts get them for
 * free and none of them can drift.
 */

import Link from 'next/link';
import {
  isWeekHours,
  openLabel,
  openState,
  summarise,
  localNow,
  type WeekHours,
} from '@/lib/store/hours';
import {
  directionsUrl,
  fullAddress,
  paragraphs,
  telHref,
  visitPath,
  type SeoRooftop,
} from '@/lib/store/seo';

export function AboutSection({ name, about }: { name: string; about: string | null }) {
  if (!about?.trim()) return null;
  return (
    <section id="about" className="scroll-mt-20">
      {/*
        `h2`, and the only other one on the page is the inventory heading. A
        dealership site with six h2s and no h1 is the shape a template generator
        produces; a real page has a hierarchy, and that is worth more than any
        keyword in it.
      */}
      <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">About {name}</h2>
      <div className="mt-3 max-w-3xl space-y-3">
        {/* Split on blank lines and rendered as text nodes. Never markdown, never
            HTML — this string is typed by a dealer into a textarea and rendered
            on their own origin. */}
        {paragraphs(about).map((p, i) => (
          <p key={i} className="text-[15px] leading-relaxed text-[var(--text-2)]">{p}</p>
        ))}
      </div>
    </section>
  );
}

export function HoursTable({ hours }: { hours: unknown }) {
  if (!isWeekHours(hours)) return null;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Opening hours</caption>
      <tbody>
        {summarise(hours as WeekHours).map((row) => (
          <tr key={row.label}>
            <th scope="row" className="py-1 pr-4 text-left font-medium text-[var(--text-2)]">
              {row.label}
            </th>
            <td className={`tnum py-1 text-right ${row.hours === 'Closed' ? 'text-[var(--text-3)]' : 'text-[var(--text)]'}`}>
              {row.hours}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * "Open now · closes 6 PM".
 *
 * Computed per request — every storefront route is `force-dynamic`, so this is
 * never a cached sentence going stale on a page somebody is reading. Renders
 * nothing at all when the hours are unset or the timezone is unrecognised;
 * "Hours not available" is a worse answer than no line.
 */
export function OpenNow({ rooftop, className }: { rooftop: SeoRooftop; className?: string }) {
  if (!isWeekHours(rooftop.hours)) return null;
  const local = localNow(rooftop.timezone);
  const state = openState(rooftop.hours as WeekHours, rooftop.timezone);
  const label = openLabel(state, local?.day);
  if (!label) return null;
  return (
    <span className={className}>
      <span
        aria-hidden
        className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
        style={{ background: state?.open ? '#16a34a' : 'var(--text-3)' }}
      />
      <span className="align-middle">{label}</span>
    </span>
  );
}

/**
 * One lot: address, phone, hours, and the two buttons.
 *
 * `<address>` is the right element and it is not just semantics — it is the
 * block a parser looks at when it is reconciling the visible NAP against the
 * structured data.
 */
export function LocationCard({
  rooftop,
  basePath,
  showLink = true,
}: {
  rooftop: SeoRooftop;
  basePath: string;
  /** Off on the lot's own page, where the link would point at itself. */
  showLink?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-[var(--paper)] p-5" style={{ borderColor: 'var(--line)' }}>
      <h3 className="text-base font-semibold text-[var(--text)]">{rooftop.name}</h3>
      <OpenNow rooftop={rooftop} className="mt-1 block text-sm text-[var(--text-2)]" />

      <address className="mt-3 not-italic text-sm leading-relaxed text-[var(--text-2)]">
        {rooftop.addressLine1}
        <br />
        {rooftop.city}, {rooftop.state} {rooftop.postalCode}
        <br />
        <a href={telHref(rooftop.phone)} className="tnum font-semibold text-[var(--brand-text)] hover:underline">
          {rooftop.phone}
        </a>
      </address>

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        <HoursTable hours={rooftop.hours} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={telHref(rooftop.phone)}
          className="rounded-md px-3.5 py-2 text-sm font-semibold"
          style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
        >
          Call this lot
        </a>
        <a
          href={directionsUrl(rooftop)}
          target="_blank"
          rel="noopener"
          className="rounded-md border px-3.5 py-2 text-sm font-medium text-[var(--text)]"
          style={{ borderColor: 'var(--line)' }}
        >
          Directions
        </a>
        {showLink ? (
          <Link
            href={visitPath(basePath, rooftop)}
            className="self-center text-sm font-semibold text-[var(--brand-text)] hover:underline"
          >
            Hours &amp; directions →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Everything under the inventory, on whichever layout the dealer picked.
 *
 * The heading changes with the count because "Visit us" reads wrong above three
 * addresses and "Our locations" reads wrong above one.
 */
export function StoreSections({
  name,
  about,
  rooftops,
  basePath,
}: {
  name: string;
  about: string | null;
  rooftops: SeoRooftop[];
  basePath: string;
}) {
  const hasAbout = Boolean(about?.trim());
  if (!hasAbout && !rooftops.length) return null;
  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-10 sm:px-6">
      <AboutSection name={name} about={about} />

      {rooftops.length ? (
        <section id="visit" className="scroll-mt-20">
          <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">
            {rooftops.length === 1 ? 'Visit us' : 'Our locations'}
          </h2>
          <div
            className={`mt-4 grid gap-4 ${rooftops.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'max-w-md'}`}
          >
            {rooftops.map((r) => (
              <LocationCard key={r.id} rooftop={r} basePath={basePath} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
