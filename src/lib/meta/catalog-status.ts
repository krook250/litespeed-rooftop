import 'server-only';

/**
 * Where each lot's Facebook catalog stands, for screens outside the Ad Desk.
 *
 * The Meta catalog is set up and fed by the Ad Desk (`meta_rooftop_assets` and
 * the feed endpoint), not by a `channel_connections` row and not by the sync
 * worker. The Syndication screen reads `channel_connections`, so on its own it
 * reports a lot with a working catalog as "Not set up". This is the bridge: one
 * database read, plus one small Graph call per catalog for the number Facebook
 * is actually holding.
 *
 * It never throws. A lot with a catalog whose count could not be read comes
 * back with `accepted: null`, which callers must show as unknown, not as 0.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireGroupId } from '@/lib/auth';
import { adDeskConfigured, tokenFor } from '@/lib/meta/connect';
import { graph } from '@/lib/meta/graph';

export type LotCatalogStatus = {
  catalogId: string;
  catalogName: string | null;
  /** Vehicles Facebook has accepted into the catalog. Null = could not be read. */
  accepted: number | null;
};

/** rooftopId → catalog status, only for lots that have a catalog. */
export async function loadCatalogStatus(): Promise<Map<string, LotCatalogStatus>> {
  const out = new Map<string, LotCatalogStatus>();
  if (!adDeskConfigured()) return out;

  try {
    const groupId = await requireGroupId();
    const conn = await tokenFor(groupId);
    if (!conn) return out;

    const rows = await db
      .select()
      .from(t.metaRooftopAssets)
      .where(
        and(
          eq(t.metaRooftopAssets.connectionId, conn.row.id),
          isNotNull(t.metaRooftopAssets.catalogId),
        ),
      );

    await Promise.all(
      rows.map(async (a) => {
        let accepted: number | null = null;
        try {
          const c = await graph<{ product_count?: number }>(`/${a.catalogId}`, {
            token: conn.token,
            params: { fields: 'product_count' },
            timeoutMs: 6_000,
          });
          accepted = typeof c.product_count === 'number' ? c.product_count : null;
        } catch {
          accepted = null;
        }
        out.set(a.rooftopId, {
          catalogId: a.catalogId!,
          catalogName: a.catalogName,
          accepted,
        });
      }),
    );
  } catch {
    // Degrade to "no catalog known" rather than take the Syndication screen down.
  }
  return out;
}
