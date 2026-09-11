/**
 * Ad Desk — connect Facebook, then set each lot up for catalog ads.
 *
 * One screen because it is one decision from the dealer's side ("get my cars
 * into Facebook ads"), even though underneath it is a business portfolio, a
 * Page, an ad account, a catalog, a scheduled feed and a pixel association.
 *
 * Asset discovery runs on every load rather than from a cache. It is four
 * round-trips to Meta, which is not free, but the alternative is showing a
 * dealer a Page list from last Tuesday — and the single most common support
 * question in this category is "why isn't my new Page showing up". Freshness
 * beats latency here.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireGroupId } from '@/lib/auth';
import { getRooftops } from '@/lib/queries';
import { Badge, Button, Card, CardHeader, EmptyState } from '@/components/ui';
import { RooftopPanel, type AssetOption, type RooftopRow } from '@/components/ad-desk-panels';
import { CampaignDemoPanel, CampaignListPanel, FeedHealthPanel } from '@/components/ad-desk-demo';
import { disconnectMetaForm, startMetaConnect } from '@/lib/meta/actions';
import { adDeskConfigured, loadConnection, tokenFor } from '@/lib/meta/connect';
import { listLotCampaigns, type LotCampaign } from '@/lib/meta/campaigns';
import { allAdCopyForRooftop } from '@/lib/meta/ad-copy';
import { defaultAdCopy } from '@/lib/meta/ad-copy-spec';
import { AdCopyPanel, type AdCopyRow } from '@/components/ad-copy-panel';
import { discoverAssets, type Discovery } from '@/lib/meta/assets';
import { previewFeed, type FeedPreview } from '@/lib/meta/feed-preview';
import { requireSection } from '@/lib/auth-guard';

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

export default async function AdDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; msg?: string; partial?: string }>;
}) {
  await requireSection('ad-desk');
  const sp = await searchParams;
  const groupId = await requireGroupId();

  if (!adDeskConfigured()) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <CardHeader title="Ad Desk" subtitle="Facebook and Instagram catalog ads" />
          <EmptyState
            title="Not configured on this deployment"
            body="META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID and META_TOKEN_KEY need to be set before the Facebook connection can be offered."
          />
        </Card>
      </div>
    );
  }

  const [connection, rooftops] = await Promise.all([loadConnection(groupId), getRooftops()]);
  const connected = Boolean(connection && connection.status !== 'DISCONNECTED');

  /*
   * Discovery is allowed to fail without taking the screen down. A revoked
   * token, a rate limit, or an App Review permission we do not have yet all end
   * up here — and in every one of those cases the dealer still needs to see
   * their existing setup and the Reconnect button.
   */
  let discovery: Discovery | null = null;
  let discoveryError: string | null = null;
  if (connected) {
    try {
      const conn = await tokenFor(groupId);
      if (conn) discovery = await discoverAssets(conn.token);
      else discoveryError = 'We could not read the stored Facebook credential. Reconnect to fix it.';
    } catch (err) {
      discoveryError = err instanceof Error ? err.message : 'Facebook could not be reached just now.';
    }
  }

  const assetRows = connection
    ? await db
        .select()
        .from(t.metaRooftopAssets)
        .where(eq(t.metaRooftopAssets.connectionId, connection.id))
    : [];
  const byRooftop = new Map(assetRows.map((a) => [a.rooftopId, a]));

  const opt = (id: string, label: string, sub?: string): AssetOption => ({ id, label, sub });
  const pages: AssetOption[] = (discovery?.pages ?? []).map((p) => opt(p.id, p.name, p.category));
  const adAccounts: AssetOption[] = (discovery?.adAccounts ?? []).map((a) =>
    opt(a.id, a.name ?? a.id, a.currency),
  );
  const pixels: AssetOption[] = (discovery?.pixels ?? []).map((p) => opt(p.id, p.name ?? p.id));

  const missing = sp.partial ? sp.partial.split(',').filter(Boolean) : [];

  /*
   * Feed health, per lot, computed from the same builder the live endpoint uses.
   * Only for lots that are actually provisioned — a lot with no catalog has no
   * feed to be healthy or unhealthy about, and showing it an eligibility report
   * would be answering a question nobody asked.
   */
  const previews = new Map<string, FeedPreview>();
  if (connected) {
    const provisioned = rooftops.filter((r) => byRooftop.get(r.id)?.catalogId);
    const results = await Promise.all(provisioned.map((r) => previewFeed(r.id)));
    results.forEach((p, i) => {
      if (p) previews.set(provisioned[i]!.id, p);
    });
  }

  /*
   * What is actually running, read from Facebook.
   *
   * A dealer can have several campaigns on one lot — one shelf each — so the
   * build form is no longer the whole story and a result block from the last
   * press is not a status screen. This is: every Rooftop campaign on the lot,
   * with its real status, its budget and what it has spent.
   *
   * Costs 1 + 2N calls per lot. Affordable here because it is one dealer's own
   * account, which is exactly the distinction `src/lib/ops/ad-desk-queries.ts`
   * draws: the all-dealer roll-up must never do this, a dealer's own screen
   * should. Failures are swallowed per lot — Facebook being slow is not a
   * reason to take the setup half of the page down with it.
   */
  /*
   * Saved ad copy per lot. A database read, not a Meta one — the words belong to
   * the dealer and Facebook only ever receives a copy of them at build time.
   * Empty means the lot has never opened the editor, and the panel pre-fills
   * with the same default the build falls back to.
   */
  const copyByRooftop = new Map<string, AdCopyRow[]>();
  if (connected) {
    const provisioned = rooftops.filter((r) => byRooftop.get(r.id)?.catalogId);
    const results = await Promise.all(provisioned.map((r) => allAdCopyForRooftop(r.id)));
    results.forEach((rows, i) => {
      copyByRooftop.set(
        provisioned[i]!.id,
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          message: r.message,
          headline: r.headline,
          description: r.description,
          callToAction: r.callToAction,
          active: r.active,
        })),
      );
    });
  }

  const campaignsByRooftop = new Map<string, LotCampaign[]>();
  if (connected) {
    const conn = await tokenFor(groupId);
    const withAccount = rooftops.filter((r) => byRooftop.get(r.id)?.adAccountId);
    if (conn && withAccount.length) {
      await Promise.all(
        withAccount.map(async (r) => {
          try {
            campaignsByRooftop.set(
              r.id,
              await listLotCampaigns(conn.token, byRooftop.get(r.id)!.adAccountId!, r.name),
            );
          } catch {
            // Leave the lot out of the map; the panel renders nothing rather
            // than an error the dealer cannot act on.
          }
        }),
      );
    }
  }

  /*
   * What Facebook is holding in each catalog we have an id for.
   *
   * `discoverAssets` already fetches `product_count` on every render — it is in
   * the `fields` list on both catalog edges — and this page used to drop it on
   * the floor while rendering a green "Catalog live" badge from two database
   * booleans. Reading it here costs nothing and is the difference between a
   * dealer being told their catalog is live and being told Facebook is holding
   * zero vehicles.
   *
   * A catalog id we hold that is NOT in this map is the worse case: the stored
   * id exists but discovery could not see it, which is the signature of a
   * catalog the system user can name but not read.
   */
  const metaCatalogCounts = new Map<string, number | null>(
    [...(discovery?.vehicleCatalogs ?? []), ...(discovery?.otherCatalogs ?? [])].map((c) => [
      c.id,
      typeof c.product_count === 'number' ? c.product_count : null,
    ]),
  );
  const discoveryOk = Boolean(discovery) && !discovery?.blocked.catalogs;

  /** Why a lot cannot build a campaign yet, in the order it has to be fixed. */
  const demoBlocker = (a: (typeof assetRows)[number] | undefined): string | null => {
    if (!a?.catalogId) return 'Set this lot up above first — the campaign needs a vehicles catalog.';
    if (!a.adAccountId) return 'Pick an ad account for this lot above. A campaign has to live in one.';
    if (!a.pageId) return 'Pick this lot’s Facebook Page above. The ad runs from it.';
    /*
     * The gate that should have existed from the start. Building against a
     * catalog Facebook holds nothing in fails with subcode 1798130 — a refusal
     * whose old copy blamed the feed and sent a real dealer hunting. Where we
     * already know the count is zero, do not offer the button at all.
     *
     * Only when we actually know. A failed discovery leaves the button up,
     * because refusing to let a dealer try on the strength of a call WE could
     * not make is worse than letting Meta refuse it.
     */
    if (discoveryOk && a.catalogId) {
      if (!metaCatalogCounts.has(a.catalogId)) {
        return 'Rooftop cannot read this lot’s catalog on Facebook. Contact us — it needs re-granting.';
      }
      if (metaCatalogCounts.get(a.catalogId) === 0) {
        return 'Facebook is holding 0 vehicles from this catalog, so there is nothing to advertise yet. See the catalog status above.';
      }
    }
    return null;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Ad Desk</h1>
        <p className="mt-1 text-sm text-ink-600">
          Put every car on the lot into a Facebook and Instagram ad, and take it back out when it sells.
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
              {/*
                The system-user sentence lived here since the connect flow shipped.
                It was written for a Meta reviewer, who needed to see that the
                credential survives staff turnover, and it read as reassurance.
                To a dealer it is a sentence about OAuth on the screen where they
                are trying to advertise cars. The reviewer has been and gone.

                The user-token case still warrants a line, because it is a thing
                that will break on them and they can act on it.
              */}
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
            const a = byRooftop.get(r.id);
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
              metaProductCount: a?.catalogId ? (metaCatalogCounts.get(a.catalogId) ?? null) : null,
              metaSawCatalog: a?.catalogId ? metaCatalogCounts.has(a.catalogId) : false,
              discoveryOk,
            };
            const preview = previews.get(r.id);
            const blocker = demoBlocker(a);
            return (
              <div key={r.id} className="space-y-5">
                <RooftopPanel row={row} pages={pages} adAccounts={adAccounts} pixels={pixels} />
                {preview ? (
                  <FeedHealthPanel
                    preview={preview}
                    metaProductCount={
                      a?.catalogId && discoveryOk ? (metaCatalogCounts.get(a.catalogId) ?? null) : null
                    }
                  />
                ) : null}
                {a?.catalogId ? (
                  <AdCopyPanel
                    rooftopId={r.id}
                    rows={copyByRooftop.get(r.id) ?? []}
                    fallback={defaultAdCopy(r.name)}
                    hasCampaigns={Boolean(campaignsByRooftop.get(r.id)?.length)}
                  />
                ) : null}
                {campaignsByRooftop.get(r.id)?.length ? (
                  <CampaignListPanel
                    rooftopId={r.id}
                    campaigns={campaignsByRooftop.get(r.id)!}
                  />
                ) : null}
                {a?.catalogId ? (
                  <CampaignDemoPanel
                    row={{ rooftopId: r.id, name: r.name, ready: blocker === null, blocker }}
                    /* Active variants only, falling back to the same default the
                       build itself falls back to — so the panel cannot promise
                       words the build will not send. */
                    copies={(() => {
                      const active = (copyByRooftop.get(r.id) ?? []).filter((c) => c.active);
                      return active.length
                        ? active.map((c) => ({
                            name: c.name,
                            message: c.message,
                            headline: c.headline,
                          }))
                        : [defaultAdCopy(r.name)].map((c) => ({
                            name: c.name,
                            message: c.message,
                            headline: c.headline,
                          }));
                    })()}
                  />
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}
