'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui';

const LINKS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/inventory', label: 'Inventory' },
  { href: '/admin/inventory?view=at-risk', label: 'At-risk list', match: 'at-risk' },
  { href: '/admin/syndication', label: 'Syndication' },
  { href: '/admin/reporting', label: 'Reporting' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="px-3">
      {LINKS.map((l) => {
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
