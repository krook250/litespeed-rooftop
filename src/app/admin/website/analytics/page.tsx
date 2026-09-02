import { requireSection } from '@/lib/auth-guard';
import { EmptyState } from '@/components/ui';
import { loadWebsite, WebsiteHeader } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * Website / Analytics.
 *
 * The shell, ahead of the tracking itself. Two sources are planned and they are
 * not alternatives:
 *
 *  - **First-party.** A beacon on the storefront writing sessions, pageviews,
 *    referrers and VDP views to our own tables. This is the one that matters:
 *    the VDP-view figures the feed, the scoreboard and reporting already print
 *    come from `vehicle_daily_stats`, which nothing currently writes outside
 *    the seed. Until this exists those numbers are furniture.
 *  - **Their tags.** A field for a GA4 measurement ID and one for a Meta pixel,
 *    injected into the storefront head. Dealers who already run these keep
 *    them, and the agency they may already be paying keeps working.
 *
 * Deliberately not started in the same pass as the nav split: a tracking
 * endpoint is a write path on a public page, and that wants its own attention
 * to rate limits, bot filtering and what we are willing to store about a
 * shopper.
 */
export default async function WebsiteAnalyticsPage() {
  await requireSection('website');
  const data = await loadWebsite();
  if (!data) {
    return <EmptyState title="No storefront yet" body="Add a rooftop and we'll create your website." />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <WebsiteHeader
        name="Analytics"
        subtitle={`${data.sf.name} — who is on your site and what they looked at.`}
        previewUrl={data.previewUrl}
      />
      <div className="rounded-xl border border-ink-200 bg-white">
        <EmptyState
          title="Traffic tracking is not live yet"
          body="This is where sessions, sources and per-unit page views will land, alongside fields for your own Google Analytics and Meta pixel IDs."
        />
      </div>
    </div>
  );
}
