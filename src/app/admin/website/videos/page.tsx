import { requireSection } from '@/lib/auth-guard';
import { EmptyState } from '@/components/ui';
import { VideoLibrary } from '@/components/video/video-library';
import { muxConfigured } from '@/lib/video/mux';
import { libraryVideos } from '@/lib/video/queries';
import { loadWebsite, WebsiteHeader } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * Website / Videos — the dealership's videos that aren't one car.
 *
 * Lot tours, the owner's pitch, anything else. Walkarounds are on each
 * vehicle's page instead, because that is where the person holding the phone
 * already is. One of these can be the home page intro.
 */
export default async function WebsiteVideosPage() {
  const me = await requireSection('website');
  const data = await loadWebsite();
  if (!data) {
    return <EmptyState title="No storefront yet" body="Add a rooftop and we'll create your website." />;
  }
  const { sf, previewUrl } = data;
  const videos = await libraryVideos(me.groupId);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <WebsiteHeader
        name="Videos"
        subtitle="Lot tours, your intro, anything that isn't one car. Walkarounds go on each vehicle."
        previewUrl={previewUrl}
      />
      {!muxConfigured() ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Video uploads aren&apos;t switched on yet — <code>MUX_TOKEN_ID</code> and <code>MUX_TOKEN_SECRET</code> need
          setting in the environment.
        </p>
      ) : null}
      <VideoLibrary videos={videos} introVideoId={sf.introVideoId} />
    </div>
  );
}
