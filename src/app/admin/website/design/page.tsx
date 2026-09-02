import { requireSection } from '@/lib/auth-guard';
import { EmptyState } from '@/components/ui';
import { DesignCard } from '@/components/website/design-card';
import { LAYOUT_LIST } from '@/components/store/layouts';
import { loadWebsite, WebsiteHeader } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * Website / Design — the look.
 *
 * No domain load here on purpose: `loadWebsite` skips the DNS lookup unless
 * asked, so picking a colour does not wait on a resolver.
 */
export default async function WebsiteDesignPage() {
  await requireSection('website');
  const data = await loadWebsite();
  if (!data) {
    return <EmptyState title="No storefront yet" body="Add a rooftop and we'll create your website." />;
  }
  const { sf, previewUrl, designConfigured } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <WebsiteHeader
        name="Design"
        subtitle={`${sf.name} — logo, colours and layout.`}
        previewUrl={previewUrl}
      />

      <div className="rounded-xl border border-ink-200 bg-white p-5">
        <DesignCard
          storefrontId={sf.id}
          dealerName={sf.name}
          layout={sf.layout}
          theme={sf.theme}
          brandColor={sf.brandColor}
          accentColor={sf.accentColor}
          logoUrl={sf.logoKey ? `/api/logo/${sf.logoKey}` : null}
          layouts={LAYOUT_LIST}
          configured={designConfigured}
        />
      </div>
    </div>
  );
}
