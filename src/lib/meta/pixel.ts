import 'server-only';

/**
 * The dealer's Meta pixel: creating one, and finding it again for their site.
 *
 * WHY ROOFTOP CREATES IT RATHER THAN ASKING FOR ONE
 *
 * A pixel is worth nothing on its own — it has to be firing on the dealer's
 * website, and the reason most independent lots have no working retargeting is
 * not that pixels are hard to make but that nobody could get the tag onto the
 * site. Every competitor in this category emails a snippet and hopes.
 *
 * We host the storefront. So the pixel goes into the dealer's own business, gets
 * attached to their catalog, and the tag goes onto their site automatically,
 * with `content_ids` that match the `vehicle_id` column of the feed. Nobody
 * opens a tag manager and nobody pastes anything. That last part is what makes
 * dynamic retargeting work at all: the id a shopper's browser reports has to be
 * the same id the catalog knows, or Meta has a view of "some page" and no car.
 *
 * SAME ADMIN-TOKEN CONSTRAINT AS THE CATALOG. `POST /{business_id}/adspixels`
 * creates a business-owned object, and a Business Integration System User is
 * not a business admin — see `claude/meta-catalog-creation-blocker.md`, blocker
 * 1. So creation runs on the short-lived user token from the second FBLB
 * configuration and nothing else, exactly as `ensureVehicleCatalog` does.
 *
 * And it is OPTIONAL, everywhere. A lot with no pixel still runs prospecting
 * ads. Nothing in this module may take a provision down with it.
 */

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { MetaApiError, graph, graphEdge } from './graph';

export type PixelResult =
  | { ok: true; pixelId: string; source: 'ADOPTED' | 'CREATED' }
  | { ok: false; message: string; needsAdmin: boolean };

/** "You aren't an admin of this business." Same subcode the catalog create hits. */
const NOT_A_BUSINESS_ADMIN = 1690129;

/**
 * Find the business's pixel, or make one.
 *
 * Adopts before creating for the same reason everything else here does: a
 * business is limited in how many pixels it may hold, and a second one would
 * split a dealer's audience history across two objects with no way to merge
 * them afterwards. If they already have a pixel — even one they set up years
 * ago with someone else — that is the one with the data in it.
 */
export async function ensurePixel(
  token: string,
  businessId: string,
  dealerName: string,
  opts: { createToken?: string } = {},
): Promise<PixelResult> {
  try {
    const existing = await graphEdge<{ id: string; name?: string }>(
      `/${businessId}/adspixels`,
      { token, fields: 'id,name', maxPages: 2 },
    );
    if (existing.length) {
      return { ok: true, pixelId: existing[0]!.id, source: 'ADOPTED' };
    }
  } catch (err) {
    // A business we cannot read pixels on is one we certainly cannot create one
    // in. Report and move on; the caller treats this as "no pixel today".
    return {
      ok: false,
      needsAdmin: false,
      message:
        err instanceof MetaApiError
          ? err.dealerMessage
          : 'Could not check this business for an existing pixel.',
    };
  }

  const createToken = opts.createToken;
  if (!createToken) {
    return {
      ok: false,
      needsAdmin: true,
      message:
        'This business has no pixel yet. Creating one needs a one-time sign-in from a Facebook ' +
        'admin of the business.',
    };
  }

  try {
    const created = await graph<{ id: string }>(`/${businessId}/adspixels`, {
      method: 'POST',
      token: createToken,
      params: { name: `${dealerName} — Rooftop` .slice(0, 100) },
    });
    return { ok: true, pixelId: created.id, source: 'CREATED' };
  } catch (err) {
    if (err instanceof MetaApiError) {
      return {
        ok: false,
        needsAdmin: err.subcode === NOT_A_BUSINESS_ADMIN,
        message: err.dealerMessage,
      };
    }
    throw err;
  }
}

/**
 * The pixel ids to fire on one storefront's pages.
 *
 * Plural because a storefront can front several lots, and two lots in the same
 * group can legitimately carry different pixels — a dealer who bought a second
 * location keeps that location's ad history. Firing all of them is right: a
 * shopper on the shared site is a shopper for whichever lot the car is at, and
 * the event carries the vehicle id, so each pixel sees its own cars.
 *
 * Not `'use server'` and not an action — the storefront layout calls it while
 * rendering. Deduped and sorted so the rendered tag is stable between requests
 * and does not thrash the HTML cache.
 */
export async function pixelIdsForRooftops(rooftopIds: string[]): Promise<string[]> {
  if (!rooftopIds.length) return [];
  const rows = await db
    .select({ pixelId: t.metaRooftopAssets.pixelId })
    .from(t.metaRooftopAssets)
    .where(inArray(t.metaRooftopAssets.rooftopId, rooftopIds));

  return [...new Set(rows.map((r) => r.pixelId).filter((p): p is string => Boolean(p)))].sort();
}

/** One lot's pixel, for the admin screens. */
export async function pixelIdForRooftop(rooftopId: string): Promise<string | null> {
  const rows = await db
    .select({ pixelId: t.metaRooftopAssets.pixelId })
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftopId))
    .limit(1);
  return rows[0]?.pixelId ?? null;
}
