import 'server-only';

/**
 * Every dealer's ad setup, in one place, for Rooftop staff.
 *
 * READ `src/lib/ops/guard.ts` FIRST. Everything here crosses tenants by design
 * and is only ever reached from a page or action that has already called
 * `requireStaff()`.
 *
 * THE EXPENSIVE THING THIS FILE REFUSES TO DO. There is no Meta call in the
 * roll-up. Not one. Campaign status and spend live at Facebook, and fetching
 * them per lot would mean 1 + 2N Graph calls every time the operator opens the
 * page — billed at the APP level, which `claude/meta-onboarding-matrix.md` §4
 * names as the ceiling that actually bites as dealer count grows, precisely
 * because it is the one limit that is not per ad account. So the roll-up answers
 * from the database, and `listLotCampaigns` runs on the per-dealer screen where
 * N is one. If a "spend across all dealers" number is ever wanted, it comes from
 * a scheduled per-dealer fan-out writing to a table, not from widening this.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { previewFeedFor, type FeedPreview } from '@/lib/meta/feed-preview';
import { tokenFor } from '@/lib/meta/connect';
import { listLotCampaigns, type LotCampaign } from '@/lib/meta/campaigns';

export type OpsAdDeskLot = {
  groupId: string;
  groupName: string;
  rooftopId: string;
  rooftopName: string;
  city: string | null;
  state: string | null;
  /** Null when the group has never connected Facebook at all. */
  connectionStatus: string | null;
  connectionBusinessName: string | null;
  connectionError: string | null;
  pageName: string | null;
  adAccountId: string | null;
  adAccountName: string | null;
  catalogId: string | null;
  catalogName: string | null;
  feedOk: boolean;
  pixelId: string | null;
  assetError: string | null;
  hasCoordinates: boolean;
  feed: FeedPreview | null;
  /** Why this lot cannot build a campaign yet, or null when it can. */
  blocker: string | null;
  /**
   * Sort weight. Lower sorts first, so whatever needs a person appears at the
   * top without the operator reading every row to find it.
   */
  attention: number;
};

/**
 * Why a lot cannot build, in the order it has to be fixed.
 *
 * Mirrors `demoBlocker` in the dealer Ad Desk plus the coordinate check that
 * `campaign-build.ts` enforces, so the operator sees the same refusal the
 * dealer would rather than discovering it after pressing the button.
 */
function blockerFor(a: {
  catalogId: string | null;
  adAccountId: string | null;
  pageId: string | null;
  hasCoordinates: boolean;
}): string | null {
  if (!a.catalogId) return 'No vehicles catalog yet — run Set up this lot.';
  if (!a.adAccountId) return 'No ad account picked for this lot.';
  if (!a.pageId) return 'No Facebook Page picked for this lot.';
  if (!a.hasCoordinates) return 'Lot has no latitude/longitude — targeting would go nationwide.';
  return null;
}

/**
 * `groupId` narrows to one dealer. Pass it whenever you have it: the feed
 * preview below is a full inventory read per lot, so filtering a whole-database
 * result in memory would do every other dealer's work for nothing.
 */
export async function opsAdDeskLots(groupId?: string): Promise<OpsAdDeskLot[]> {
  const base = db
    .select({
      rooftop: t.rooftops,
      groupName: t.dealerGroups.name,
    })
    .from(t.rooftops)
    .innerJoin(t.dealerGroups, eq(t.dealerGroups.id, t.rooftops.groupId));

  const rooftopRows = groupId ? await base.where(eq(t.rooftops.groupId, groupId)) : await base;

  if (!rooftopRows.length) return [];

  const groupIds = [...new Set(rooftopRows.map((r) => r.rooftop.groupId))];
  const connections = await db
    .select()
    .from(t.metaConnections)
    .where(inArray(t.metaConnections.groupId, groupIds));
  const connByGroup = new Map(connections.map((c) => [c.groupId, c]));

  const connectionIds = connections.map((c) => c.id);
  const assets = connectionIds.length
    ? await db
        .select()
        .from(t.metaRooftopAssets)
        .where(inArray(t.metaRooftopAssets.connectionId, connectionIds))
    : [];
  const assetByRooftop = new Map(assets.map((a) => [a.rooftopId, a]));

  /*
   * Feed previews only for lots that have a catalog. A lot with no catalog has
   * no feed to be healthy or unhealthy about, and each preview is a full
   * inventory read — running it for every lot in the database would make this
   * page slow in proportion to dealers who are not using the product.
   */
  const withCatalog = rooftopRows.filter((r) => assetByRooftop.get(r.rooftop.id)?.catalogId);
  const previews = await Promise.all(withCatalog.map((r) => previewFeedFor(r.rooftop)));
  const previewByRooftop = new Map(
    withCatalog.map((r, i) => [r.rooftop.id, previews[i] ?? null]),
  );

  const lots: OpsAdDeskLot[] = rooftopRows.map(({ rooftop, groupName }) => {
    const conn = connByGroup.get(rooftop.groupId) ?? null;
    const asset = assetByRooftop.get(rooftop.id) ?? null;
    const hasCoordinates = rooftop.latitude !== null && rooftop.longitude !== null;

    const blocker = conn
      ? blockerFor({
          catalogId: asset?.catalogId ?? null,
          adAccountId: asset?.adAccountId ?? null,
          pageId: asset?.pageId ?? null,
          hasCoordinates,
        })
      : 'Facebook is not connected for this dealer.';

    /*
     * Attention order, most urgent first. An error Meta reported outranks an
     * unfinished setup, because the second is a job somebody has not started
     * and the first is a job that broke after somebody finished it.
     */
    const attention =
      conn?.errorMessage || asset?.errorMessage
        ? 0
        : conn && blocker
          ? 1
          : conn && (previewByRooftop.get(rooftop.id)?.excluded ?? 0) > 0
            ? 2
            : conn
              ? 3
              : 4;

    return {
      groupId: rooftop.groupId,
      groupName,
      rooftopId: rooftop.id,
      rooftopName: rooftop.name,
      city: rooftop.city,
      state: rooftop.state,
      connectionStatus: conn?.status ?? null,
      connectionBusinessName: conn?.businessName ?? null,
      connectionError: conn?.errorMessage ?? null,
      pageName: asset?.pageName ?? null,
      adAccountId: asset?.adAccountId ?? null,
      adAccountName: asset?.adAccountName ?? null,
      catalogId: asset?.catalogId ?? null,
      catalogName: asset?.catalogName ?? null,
      feedOk: Boolean(asset?.productFeedId),
      pixelId: asset?.pixelId ?? null,
      assetError: asset?.errorMessage ?? null,
      hasCoordinates,
      feed: previewByRooftop.get(rooftop.id) ?? null,
      blocker,
      attention,
    };
  });

  return lots.sort((a, b) => {
    if (a.attention !== b.attention) return a.attention - b.attention;
    if (a.groupName !== b.groupName) return a.groupName.localeCompare(b.groupName);
    return a.rooftopName.localeCompare(b.rooftopName);
  });
}

/** The same shape, narrowed to one dealer group, for the account detail screen. */
export async function opsAdDeskLotsForGroup(groupId: string): Promise<OpsAdDeskLot[]> {
  return opsAdDeskLots(groupId);
}

/**
 * One rooftop and its group, for an action that was handed both off a form.
 *
 * Returns null unless the rooftop really belongs to that group. The caller has
 * already established that the *user* is staff; this establishes that the two
 * ids in front of it belong together, so a mismatched pair fails closed rather
 * than building a campaign for whichever dealer owns the rooftop id.
 */
export async function opsRooftopInGroup(groupId: string, rooftopId: string) {
  if (!groupId || !rooftopId) return null;
  const rows = await db
    .select()
    .from(t.rooftops)
    .where(and(eq(t.rooftops.id, rooftopId), eq(t.rooftops.groupId, groupId)))
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------------------------ live state, one dealer */

export type OpsLotCampaigns = {
  rooftopId: string;
  campaigns: LotCampaign[];
  /** Set when Facebook refused or could not be reached. The screen says so rather than showing zero. */
  error: string | null;
};

/**
 * What Facebook currently holds for each lot of ONE dealer.
 *
 * Only ever called from the per-dealer screen. See the note at the top of this
 * file on why the roll-up does not do this: the cost is 1 + 2N Graph calls per
 * lot, billed app-level.
 *
 * A failure here is returned, never thrown. Facebook being unreachable is not a
 * reason for the operator to lose the database half of the screen — which is the
 * half that tells them whose setup is unfinished, and is the more common reason
 * to be on this page at all.
 */
export async function opsLotCampaigns(
  groupId: string,
  lots: OpsAdDeskLot[],
): Promise<Map<string, OpsLotCampaigns>> {
  const out = new Map<string, OpsLotCampaigns>();
  const usable = lots.filter((l) => l.adAccountId);
  if (!usable.length) return out;

  const conn = await tokenFor(groupId);
  if (!conn) {
    for (const l of usable) {
      out.set(l.rooftopId, {
        rooftopId: l.rooftopId,
        campaigns: [],
        error: 'Facebook is not connected for this dealer.',
      });
    }
    return out;
  }

  await Promise.all(
    usable.map(async (l) => {
      try {
        const campaigns = await listLotCampaigns(conn.token, l.adAccountId!, l.rooftopName);
        out.set(l.rooftopId, { rooftopId: l.rooftopId, campaigns, error: null });
      } catch (err) {
        out.set(l.rooftopId, {
          rooftopId: l.rooftopId,
          campaigns: [],
          error: err instanceof Error ? err.message : 'Facebook could not be reached.',
        });
      }
    }),
  );

  return out;
}
