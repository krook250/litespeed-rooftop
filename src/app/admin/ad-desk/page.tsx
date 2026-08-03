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
import { disconnectMetaForm, startMetaConnect } from '@/lib/meta/actions';
import { adDeskConfigured, loadConnection, tokenFor } from '@/lib/meta/connect';
import { discoverAssets, type Discovery } from '@/lib/meta/assets';

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
              <p className="text-xs text-ink-500">
                {connection.tokenKind === 'SYSTEM_USER'
                  ? 'Connected as a system user — this does not expire when staff change.'
                  : 'Connected as a user — this will need renewing periodically.'}
              </p>
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
            };
            return (
              <RooftopPanel key={r.id} row={row} pages={pages} adAccounts={adAccounts} pixels={pixels} />
            );
          })
        : null}
    </div>
  );
}
