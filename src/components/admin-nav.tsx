'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui';

const LINKS: { href: string; label: string; exact?: boolean; match?: string }[] = [
  // Label comes from the caller: the same screen is "Lot Walk" at a store that
  // runs the social view and "Activity" at one that runs the log. Naming it
  // Lot Walk in the nav of a dealership that switched away is the small tell
  // that gives away which one we think is the real product.
  { href: '/admin/feed', label: 'Lot Walk' },
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/inventory', label: 'Inventory' },
  { href: '/admin/inventory?view=at-risk', label: 'At-risk list', match: 'at-risk' },
  { href: '/admin/syndication', label: 'Syndication' },
  { href: '/admin/website', label: 'Website' },
  { href: '/admin/reporting', label: 'Reporting' },
];

export function AdminNav({ feedLabel = 'Lot Walk' }: { feedLabel?: string }) {
  const pathname = usePathname();
  return (
    <nav className="px-3">
      {LINKS.map((link) => {
        const l = link.href === '/admin/feed' ? { ...link, label: feedLabel } : link;
        const base = l.href.split('?')[0]!;
        const active = l.exact ? pathname === base : pathname.startsWith(base);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              'mb-0.5 block rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active && !l.match
                ? 'bg-ink-800 text-white'
                : 'text-ink-300 hover:bg-ink-800/60 hover:text-white',
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
