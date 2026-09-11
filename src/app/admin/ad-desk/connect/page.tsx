/**
 * Ad Desk › Connect — the Facebook side of the account.
 *
 * Everything on this screen is something a dealer does once and then leaves
 * alone: the business connection, the Page, the ad account, the catalog, the
 * pixel, and the report of which cars the feed is and is not sending. None of
 * it changes week to week, which is exactly why it should not share a screen
 * with the thing that does.
 */

import Link from 'next/link';
import { Badge, Button, Card, CardHeader, EmptyState } from '@/components/ui';
import { RooftopPanel, type RooftopRow } from '@/components/ad-desk-panels';
import { FeedHealthPanel } from '@/components/ad-desk-demo';
import { disconnectMetaForm, startMetaConnect } from '@/lib/meta/actions';
import { previewFeed, type FeedPreview } from '@/lib/meta/feed-preview';
import { requireSection } from '@/lib/auth-guard';
import { loadAdDesk } from '../shared';

export const dynamic = 'force-dynamic';

const SCOPE_LABEL: Record<string, string> = {
  ads_management: 'create and manage campaigns',
  ads_read: 'read spend and results',
  business_management: 'read your business settings',
  catalog_management: 'create and update your vehicle catalog',
  pages_show_list: 'see your Pages',
  pages_read_engagement: 'read your Page',
  pages_manage_ads: 'run ads from your Page',
};

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; msg?: string; partial?: string }>;
}) {
  await requireSection('ad-desk');
  const sp = await searchParams;
  const data = await loadAdDesk({ withDiscovery: true });

  if (!data.configured) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Card>
          <CardHeader title="Connect" subtitle="Facebook and Instagram catalog ads" />
          <EmptyState
            title="Not configured on this deployment"
            body="META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID and META_TOKEN_KEY need to be set before the Facebook connection can be offered."
          />
        </Card>
      </div>
    );
  }

  const { connection, connected, rooftops, discovery, discoveryError, discoveryOk } = data;
  const missing = sp.partial ? sp.partial.split(',').filter(Boolean) : [];

  /*
   * Feed health, per lot, from the same builder the live endpoint uses. Only
   * for lots that are provisioned — a lot with no catalog has no feed to be
   * healthy about, and an eligibility report there answers a question nobody
   * asked.
   */
  const previews = new Map<string, FeedPreview>();
  if (connected) {
    const provisioned = rooftops.filter((r) => data.assets.get(r.id)?.catalogId);
    const results = await Promise.all(provisioned.map((r) => previewFeed(r.id)));
    results.forEach((p, i) => {
      if (p) previews.set(provisioned[i]!.id, p);
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Connect</h1>
        <p className="mt-1 text-sm text-ink-600">
          The Facebook side of the account. Set it once, then leave it alone.
        </p>
      </div>

      {sp.err ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{sp.err}</p> : null}
      {sp.msg ? <p className="rounded-lg bg-ink-100 px-4 py-3 text-sm text-ink-700">{sp.msg}</p> : null}
      {sp.ok && !missing.length ? (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Facebook connected. Now pick the Page and ad account for each lot below.
        </p>
      ) : null}
      {missing.length ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Connected, but Facebook held some things back.</p>
          <p className="mt-1 text-xs">
            We were not granted permission to {missing.map((m) => SCOPE_LABEL[m] ?? m).join(', ')}.
            Catalog ads will not run until that is sorted — reconnect and accept everything in the
            dialog, or contact us and we&apos;ll walk through it.
          </p>
        </div>
      ) : null}

      {/* ------------------------------------------------------- connection */}

      <Card>
        <CardHeader
          title="Facebook business"
          subtitle={
            connected
              ? 'Your catalog, pixel and ad account stay in your own Facebook business. Rooftop only holds access.'
              : 'Connect once. We handle the rest per lot.'
          }
          action={
            connected && connection ? (
              <div className="flex items-center gap-2">
                {connection.status === 'CONNECTED' ? (
                  <Badge tone="green">Connected</Badge>
                ) : connection.status === 'NEEDS_REAUTH' ? (
                  <Badge tone="amber">Reconnect needed</Badge>
                ) : (
                  <Badge tone="red">Error</Badge>
                )}
                <form action={disconnectMetaForm}>
                  <Button variant="secondary" size="sm" type="submit">
                    Disconnect
                  </Button>
                </form>
              </div>
            ) : null
          }
        />

        <div className="px-5 py-4">
          {connected && connection ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink-500">Business</span>
                <span className="font-medium text-ink-900">
                  {connection.businessName || connection.businessId}
                </span>
              </div>
              {connection.tokenKind !== 'SYSTEM_USER' ? (
                <p className="text-xs text-ink-500">
                  This connection will need renewing every couple of months.
                </p>
              ) : null}
              {connection.errorMessage ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {connection.errorMessage}
                </p>
              ) : null}
              {discoveryError ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{discoveryError}</p>
              ) : null}
              {discovery && !discovery.pages.length ? (
                <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
                  No Facebook Pages came back for this business. If the lot&apos;s Page is owned by a
                  personal profile rather than the business, it needs adding to the business portfolio
                  first — that is the usual cause.
                </p>
              ) : null}
              <form action={startMetaConnect} className="pt-1">
                <Button variant="secondary" size="sm" type="submit">
                  Reconnect or change assets
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-600">
                You do not need a product catalog, and you do not need to have set anything up in
                Commerce Manager. If this business already has a vehicle catalog we will use it. If it
                does not — which is the usual case — we will create one and keep it fed from your
                inventory.
              </p>
              <form action={startMetaConnect}>
                <Button type="submit">Connect Facebook</Button>
              </form>
            </div>
          )}
        </div>
      </Card>

      {/* ----------------------------------------------------------- lots */}

      {connected
        ? rooftops.map((r) => {
            const a = data.assets.get(r.id);
            const row: RooftopRow = {
              rooftopId: r.id,
              name: r.name,
              city: r.city,
              state: r.state,
              pageId: a?.pageId ?? null,
              pageName: a?.pageName ?? null,
              adAccountId: a?.adAccountId ?? null,
              adAccountName: a?.adAccountName ?? null,
              catalogId: a?.catalogId ?? null,
              catalogName: a?.catalogName ?? null,
              catalogSource: a?.catalogSource ?? null,
              feedOk: Boolean(a?.productFeedId),
              pixelId: a?.pixelId ?? null,
              errorMessage: a?.errorMessage ?? null,
              metaProductCount: a?.catalogId ? (data.metaCatalogCounts.get(a.catalogId) ?? null) : null,
              metaSawCatalog: a?.catalogId ? data.metaCatalogCounts.has(a.catalogId) : false,
              discoveryOk,
            };
            const preview = previews.get(r.id);
            return (
              <div key={r.id} className="space-y-5">
                <RooftopPanel
                  row={row}
                  pages={data.pages}
                  adAccounts={data.adAccounts}
                  pixels={data.pixels}
                />
                {preview ? (
                  <FeedHealthPanel
                    preview={preview}
                    metaProductCount={
                      a?.catalogId && discoveryOk
                        ? (data.metaCatalogCounts.get(a.catalogId) ?? null)
                        : null
                    }
                  />
                ) : null}
                {a?.catalogId ? (
                  <p className="text-xs text-ink-500">
                    Ads for this lot live on{' '}
                    <Link href="/admin/ad-desk/ads" className="font-medium text-ink-700 underline underline-offset-2">
                      Ads
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}
