'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui';
import type { Section } from '@/lib/permissions';

/**
 * The console nav.
 *
 * Sections can carry children. A group with children is not itself a link — it
 * expands in place when you are inside it, and collapses when you leave. No
 * accordion state, no chevron to click: the URL already says which group you
 * are in, and a menu that needs to be opened before it can be read is a menu
 * that gets read once.
 *
 * `allowed` comes from the server, filtered through `sectionsFor(role)`. This
 * component only *hides* links — the lock is `requireSection()` on each route.
 * See the note at the top of `src/lib/permissions.ts`.
 */

type Item = {
  href: string;
  label: string;
  section: Section;
  /** Distinguishes two links that share a base path, e.g. the at-risk view. */
  match?: string;
  children?: { href: string; label: string }[];
};

const LINKS: Item[] = [
  // Label comes from the caller: the same screen is "Lot Walk" at a store that
  // runs the social view and "Activity" at one that runs the log. Naming it
  // Lot Walk in the nav of a dealership that switched away is the small tell
  // that gives away which one we think is the real product.
  { href: '/admin/feed', label: 'Lot Walk', section: 'feed' },
  { href: '/admin/dashboard', label: 'Dashboard', section: 'dashboard' },
  { href: '/admin/inventory', label: 'Inventory', section: 'inventory' },
  { href: '/admin/inventory?view=at-risk', label: 'At-risk list', section: 'at-risk', match: 'at-risk' },
  { href: '/admin/syndication', label: 'Syndication', section: 'syndication' },
  { href: '/admin/ad-desk', label: 'Ad Desk', section: 'ad-desk' },
  {
    href: '/admin/website',
    label: 'Website',
    section: 'website',
    children: [
      { href: '/admin/website/content', label: 'Content' },
      { href: '/admin/website/design', label: 'Design' },
      { href: '/admin/website/analytics', label: 'Analytics' },
    ],
  },
  { href: '/admin/lots', label: 'Lots', section: 'lots' },
  { href: '/admin/reporting', label: 'Reporting', section: 'reporting' },
  { href: '/admin/settings', label: 'Settings', section: 'settings' },
];

const ITEM =
  'mb-0.5 block rounded-md px-3 py-2 text-sm font-medium transition-colors';
const OFF = 'text-ink-300 hover:bg-ink-800/60 hover:text-white';

export function AdminNav({
  feedLabel = 'Lot Walk',
  allowed,
}: {
  feedLabel?: string;
  allowed: Section[];
}) {
  const pathname = usePathname();

  return (
    <nav className="px-3">
      {LINKS.filter((l) => allowed.includes(l.section)).map((link) => {
        const l = link.href === '/admin/feed' ? { ...link, label: feedLabel } : link;
        const base = l.href.split('?')[0]!;
        const inside = pathname.startsWith(base);

        if (l.children) {
          return (
            <div key={l.href} className="mb-0.5">
              {/*
                The group header is a link to the first child, not a toggle. A
                dealer clicking "Website" wants the website, not a disclosure
                triangle — and the first child is the one they want nine times
                out of ten.
              */}
              <Link
                href={l.children[0]!.href}
                className={cn(ITEM, 'mb-0', inside ? 'bg-ink-800/40 text-white' : OFF)}
              >
                {l.label}
              </Link>
              {inside ? (
                <div className="mb-1 ml-3 border-l border-ink-800 pl-2 pt-0.5">
                  {l.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className={cn(
                        'mb-0.5 block rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                        pathname.startsWith(c.href)
                          ? 'bg-ink-800 text-white'
                          : 'text-ink-400 hover:bg-ink-800/60 hover:text-white',
                      )}
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        const active = inside && !l.match;
        return (
          <Link key={l.href} href={l.href} className={cn(ITEM, active ? 'bg-ink-800 text-white' : OFF)}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
