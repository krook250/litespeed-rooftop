import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';

/**
 * /admin is a router, not a screen.
 *
 * Both layouts ship: Lot Walk at /admin/feed and the traditional dashboard at
 * /admin/dashboard. Which one a user lands on is their own preference,
 * defaulting to the feed — that is the bet in section 2 of
 * `claude/data-model-and-decisions.md`, and defaulting to it is how the bet
 * actually gets tested. Anyone who prefers the dashboard flips it once and
 * never thinks about it again.
 *
 * Kept as a redirect rather than rendering one of the two inline so both
 * screens keep their own URL: a link to the dashboard has to survive somebody
 * else's preference.
 */
export default async function AdminHome() {
  const { homeView } = await requireSession();
  redirect(homeView === 'DASHBOARD' ? '/admin/dashboard' : '/admin/feed');
}
