import 'server-only';

/**
 * Everything both Ad Desk screens need, loaded once.
 *
 * The Ad Desk used to be one route that loaded the lot's Facebook assets, its
 * feed health and everything running at Meta, and rendered all three stacked in
 * a column. It is now two: `connect` (the accounts, the catalog, the feed) and
 * `ads` (the groups). They share this file the way the Website screens share
 * `website/shared.tsx`, and for the same reason — the expensive half is opt-in.
 *
 * `withDiscovery` is that opt-in. Asset discovery is four round-trips to Meta
 * and it exists to populate the Page / ad account / pixel pickers, which only
 * Connect has. The groups list has no pickers on it, so it does not pay for
 * them.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireGroupId } from '@/lib/auth';
import { getRooftops } from '@/lib/queries';
import { adDeskConfigured, loadConnection, tokenFor } from '@/lib/meta/connect';
import { discoverAssets, type Discovery } from '@/lib/meta/assets';
import { listLotGroups, type LotGroups } from '@/lib/meta/campaigns';
import type { AssetOption } from '@/components/ad-desk-panels';

export type Rooftop = Awaited<ReturnType<typeof getRooftops>>[number];
export type AssetRow = typeof t.metaRooftopAssets.$inferSelect;

export type AdDeskData = {
  configured: boolean;
  groupId: string;
  connection: Awaited<ReturnType<typeof loadConnection>> | null;
  connected: boolean;
  rooftops: Rooftop[];
  assets: Map<string, AssetRow>;
  discovery: Discovery | null;
  discoveryError: string | null;
  /** Discovery ran AND Meta did not withhold the catalog edge. */
  discoveryOk: boolean;
  pages: AssetOption[];
  adAccounts: AssetOption[];
  pixels: AssetOption[];
  /** Catalog id → what Facebook is holding in it. A missing key is worse than 0. */
  metaCatalogCounts: Map<string, number | null>;
};

export async function loadAdDesk({
  withDiscovery = false,
}: { withDiscovery?: boolean } = {}): Promise<AdDeskData> {
  const groupId = await requireGroupId();
  const configured = adDeskConfigured();

  const empty: AdDeskData = {
    configured,
    groupId,
    connection: null,
    connected: false,
    rooftops: [],
    assets: new Map(),
    discovery: null,
    discoveryError: null,
    discoveryOk: false,
    pages: [],
    adAccounts: [],
    pixels: [],
    metaCatalogCounts: new Map(),
  };
  if (!configured) return empty;

  const [connection, rooftops] = await Promise.all([loadConnection(groupId), getRooftops()]);
  const connected = Boolean(connection && connection.status !== 'DISCONNECTED');

  /*
   * Discovery is allowed to fail without taking the screen down. A revoked
   * token, a rate limit, or a permission App Review has not granted yet all end
   * up here — and in every one of those cases the dealer still needs to see
   * their existing setup and the Reconnect button.
   */
  let discovery: Discovery | null = null;
  let discoveryError: string | null = null;
  if (connected && withDiscovery) {
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

  const opt = (id: string, label: string, sub?: string): AssetOption => ({ id, label, sub });

  return {
    ...empty,
    connection,
    connected,
    rooftops,
    assets: new Map(assetRows.map((a) => [a.rooftopId, a])),
    discovery,
    discoveryError,
    discoveryOk: Boolean(discovery) && !discovery?.blocked.catalogs,
    pages: (discovery?.pages ?? []).map((p) => opt(p.id, p.name, p.category)),
    adAccounts: (discovery?.adAccounts ?? []).map((a) => opt(a.id, a.name ?? a.id, a.currency)),
    pixels: (discovery?.pixels ?? []).map((p) => opt(p.id, p.name ?? p.id)),
    metaCatalogCounts: new Map(
      [...(discovery?.vehicleCatalogs ?? []), ...(discovery?.otherCatalogs ?? [])].map((c) => [
        c.id,
        typeof c.product_count === 'number' ? c.product_count : null,
      ]),
    ),
  };
}

/**
 * What is running at Facebook, per lot.
 *
 * Costs 2 + 2N calls per lot, so it is only called by the screens that show it.
 * Failures are swallowed per lot and reported as "could not be read" rather
 * than as an empty list, because an empty list reads as "nothing is running"
 * and that is the one wrong answer.
 */
export async function loadLotGroups(
  data: AdDeskData,
  only?: string,
): Promise<{ groups: Map<string, LotGroups>; failed: Set<string> }> {
  const groups = new Map<string, LotGroups>();
  const failed = new Set<string>();
  if (!data.connected) return { groups, failed };

  const conn = await tokenFor(data.groupId);
  const withAccount = data.rooftops.filter(
    (r) => data.assets.get(r.id)?.adAccountId && (!only || r.id === only),
  );
  if (!conn || !withAccount.length) return { groups, failed };

  await Promise.all(
    withAccount.map(async (r) => {
      try {
        groups.set(r.id, await listLotGroups(conn.token, data.assets.get(r.id)!.adAccountId!, r.name));
      } catch {
        failed.add(r.id);
      }
    }),
  );
  return { groups, failed };
}

/** Why a lot cannot build a group yet, in the order it has to be fixed. */
export function blockerFor(data: AdDeskData, rooftopId: string): string | null {
  const a = data.assets.get(rooftopId);
  if (!a?.catalogId) return 'Set this lot up on Connect first — the ads need a vehicles catalog.';
  if (!a.adAccountId) return 'Pick an ad account for this lot on Connect. A campaign has to live in one.';
  if (!a.pageId) return 'Pick this lot’s Facebook Page on Connect. The ad runs from it.';
  /*
   * The gate that should have existed from the start. Building against a
   * catalog Facebook holds nothing in fails with subcode 1798130 — a refusal
   * whose old copy blamed the feed and sent a real dealer hunting.
   *
   * Only when we actually know. A failed discovery leaves the button up,
   * because refusing to let a dealer try on the strength of a call WE could not
   * make is worse than letting Meta refuse it.
   */
  if (data.discoveryOk) {
    if (!data.metaCatalogCounts.has(a.catalogId)) {
      return 'Rooftop cannot read this lot’s catalog on Facebook. Contact us — it needs re-granting.';
    }
    if (data.metaCatalogCounts.get(a.catalogId) === 0) {
      return 'Facebook is holding 0 vehicles from this catalog, so there is nothing to advertise yet. See the catalog status on Connect.';
    }
  }
  return null;
}
