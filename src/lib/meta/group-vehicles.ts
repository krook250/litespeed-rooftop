import 'server-only';

/**
 * What a group is actually advertising, read from Facebook.
 *
 * The Ad Library cannot answer this: it keeps every version of a catalog ad
 * that ever served, so sold and deleted units stay there for good. The only
 * true answer is the product set the ad set promotes, read live. The dealer's
 * Ads Manager user usually cannot read it either — the catalog sits in the
 * dealer's business with its own people list — so Rooftop reads it with the
 * connection's own token and shows it here.
 *
 * Read-only, and only on a click: two or three GETs per press, never on page
 * load, so the list screen's call budget is untouched.
 */

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { MetaApiError, graph, graphEdge } from './graph';
import { tokenFor } from './connect';

export type GroupVehicle = {
  vehicleId: string;
  title: string;
  /** As Facebook holds it, e.g. "17499 USD". */
  price: string;
  /** Facebook's availability for the unit. */
  availability: string;
  /** What Rooftop says about the unit, or null when Rooftop no longer has it. */
  rooftop: { stockNumber: string; status: string } | null;
  /** Something the dealer should act on, in plain words. Null when it is fine. */
  problem: string | null;
};

export type GroupVehicles = {
  productSetName: string;
  /** Facebook's own count for the product set. */
  count: number;
  /** True when the product set's catalog is not the one Rooftop feeds. */
  wrongCatalog: boolean;
  vehicles: GroupVehicle[];
};

const SOLD = new Set(['SOLD', 'WHOLESALED']);

export async function readGroupVehicles(input: {
  groupId: string;
  rooftop: typeof t.rooftops.$inferSelect;
  adSetId: string;
}): Promise<{ ok: true; data: GroupVehicles } | { ok: false; error: string }> {
  const { groupId, rooftop, adSetId } = input;
  if (!/^\d+$/.test(adSetId)) return { ok: false, error: 'That group was not found.' };

  const conn = await tokenFor(groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected for this dealer.' };

  const [asset] = await db
    .select()
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftop.id))
    .limit(1);
  if (!asset?.adAccountId) return { ok: false, error: 'This lot has no ad account.' };

  try {
    const adSet = await graph<{ account_id?: string; promoted_object?: { product_set_id?: string } }>(
      `/${adSetId}`,
      { token: conn.token, params: { fields: 'account_id,promoted_object' } },
    );
    if ((adSet.account_id ?? '') !== asset.adAccountId.replace(/^act_/, '')) {
      return { ok: false, error: 'That group was not found on this lot.' };
    }
    const productSetId = adSet.promoted_object?.product_set_id;
    if (!productSetId) return { ok: false, error: 'This group has no vehicle list at Facebook.' };

    const set = await graph<{ name?: string; product_count?: number; product_catalog?: { id?: string } }>(
      `/${productSetId}`,
      { token: conn.token, params: { fields: 'name,product_count,product_catalog{id}' } },
    );

    const items = await graphEdge<{
      vehicle_id?: string;
      title?: string;
      price?: string;
      availability?: string;
    }>(`/${productSetId}/vehicles`, {
      token: conn.token,
      fields: 'vehicle_id,title,price,availability',
      limit: 100,
      maxPages: 5,
    });

    const ids = items.map((i) => i.vehicle_id).filter((id): id is string => Boolean(id));
    const known = ids.length
      ? await db
          .select({ id: t.vehicles.id, stockNumber: t.vehicles.stockNumber, status: t.vehicles.status })
          .from(t.vehicles)
          .where(inArray(t.vehicles.id, ids))
      : [];
    const byId = new Map(known.map((v) => [v.id, v]));

    const vehicles: GroupVehicle[] = items.map((i) => {
      const r = i.vehicle_id ? byId.get(i.vehicle_id) : undefined;
      const fbAvailable = (i.availability ?? '').toLowerCase() === 'available';
      let problem: string | null = null;
      if (!r) problem = 'Not in Rooftop anymore — Facebook still has it.';
      else if (SOLD.has(r.status) && fbAvailable) problem = 'Sold in Rooftop — Facebook has not caught up yet.';
      return {
        vehicleId: i.vehicle_id ?? '',
        title: i.title ?? '(no title)',
        price: i.price ?? '',
        availability: i.availability ?? '',
        rooftop: r ? { stockNumber: r.stockNumber, status: r.status } : null,
        problem,
      };
    });
    vehicles.sort((a, b) => Number(Boolean(b.problem)) - Number(Boolean(a.problem)) || a.title.localeCompare(b.title));

    return {
      ok: true,
      data: {
        productSetName: set.name ?? '',
        count: set.product_count ?? vehicles.length,
        wrongCatalog: Boolean(asset.catalogId && set.product_catalog?.id && set.product_catalog.id !== asset.catalogId),
        vehicles,
      },
    };
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }
}
