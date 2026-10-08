import Link from 'next/link';
import type { FacetLink } from '@/lib/store/facets';

/**
 * One plain row of links to every make page. Mostly for crawlers — a page
 * only in the sitemap and linked from nowhere is a page Google trusts least —
 * but it is also the fastest way for a buyer who only wants a Ford to get there.
 * Plain links, no JavaScript.
 */
export function ShopByMake({ links, basePath }: { links: FacetLink[]; basePath: string }) {
  if (links.length < 2) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
      <h2 className="text-sm font-semibold text-[var(--text)]">Shop by make</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.path}>
            <Link
              href={`${basePath}${l.path}`}
              className="tnum inline-flex items-center gap-1.5 rounded-md bg-[var(--paper)] px-3 py-1.5 text-sm text-[var(--text)] ring-1 ring-inset ring-[var(--line)] hover:text-[var(--brand-text)]"
            >
              {l.label}
              <span className="text-[var(--text-3)]">{l.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
