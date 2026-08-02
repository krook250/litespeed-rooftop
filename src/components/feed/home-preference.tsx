import { setHomeView } from '@/lib/feed-actions';
import type { HomeView } from '@/db/schema';

/**
 * "Make this my home."
 *
 * Both layouts stay. The feed is the bet and therefore the default, but a
 * dealer who wants the dashboard first gets the dashboard first — per user,
 * not per dealership, because the owner and the porter do not open this
 * software to answer the same question.
 */
export function HomePreference({
  current,
  thisView,
}: {
  current: HomeView;
  thisView: HomeView;
}) {
  const isHome = current === thisView;
  const other = thisView === 'FEED' ? 'Dashboard' : 'Lot Walk';

  if (isHome) {
    return (
      <p className="text-xs text-ink-500">
        This is your home screen.{' '}
        <span className="text-ink-400">Sign-in lands here; {other} is one click away.</span>
      </p>
    );
  }

  return (
    <form action={setHomeView}>
      <input type="hidden" name="view" value={thisView} />
      <button className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50">
        Make this my home screen
      </button>
    </form>
  );
}
