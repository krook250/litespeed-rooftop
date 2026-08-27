import 'server-only';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { SYNDICATABLE_STATUSES } from '@/lib/domain';

/**
 * Every vehicle on a lot needs a row against every channel that lot is
 * connected to. This is the thing that makes sure it has one.
 *
 * WHY THIS EXISTS, WRITTEN DOWN SO IT IS NOT REDISCOVERED A THIRD TIME.
 *
 * `vehicle_sync_states` is the entire basis of `/admin/syndication` — the
 * per-VIN grid, the live counts on every channel card, and everything
 * `sync-engine.ts` iterates. A vehicle with no rows is not "not listed"; it is
 * invisible. The screen renders perfectly and says zero.
 *
 * Rows were only ever created in two places, and both are the *creation* of one
 * side of the pair:
 *
 *   - `saveVehicle` opens a row per connection **when a vehicle is added**
 *   - `seed.ts` builds the whole grid for the demo lot
 *
 * Which leaves two holes, and a real dealer walks into both on day one:
 *
 *   1. **Bulk import** wrote 21 vehicles and no sync rows at all.
 *   2. **Provisioning a channel** creates the connection and no rows for the
 *      inventory already sitting on the lot — so every car a dealer owned before
 *      you connected CarGurus is missing from CarGurus forever.
 *
 * Hole 2 is the nastier one because it is silent and permanent: nothing later
 * ever revisits it. Hence a reconciler rather than a fix in one caller — call it
 * after anything that creates vehicles OR connections, and the grid is complete
 * by construction.
 *
 * Idempotent. Safe to run repeatedly, and running it is the repair for a lot
 * that is already in this state.
 */

/** Postgres caps bound parameters per statement; stay well under it. */
const CHUNK = 1000;

export async function openMissingSyncStates(rooftopId: string): Promise<number> {
  const [vehicles, connections] = await Promise.all([
    db.select({ id: t.vehicles.id }).from(t.vehicles).where(eq(t.vehicles.rooftopId, rooftopId)),
    db
      .select({ id: t.channelConnections.id })
      .from(t.channelConnections)
      .where(eq(t.channelConnections.rooftopId, rooftopId)),
  ]);
  if (!vehicles.length || !connections.length) return 0;

  const vehicleIds = vehicles.map((v) => v.id);
  const connectionIds = connections.map((c) => c.id);

  // Read what is already there rather than inserting the whole grid and letting
  // the unique index absorb it. On a 400-car lot with nine channels that is the
  // difference between writing 3,600 rows on every import and writing none.
  const existing = await db
    .select({
      vehicleId: t.vehicleSyncStates.vehicleId,
      connectionId: t.vehicleSyncStates.connectionId,
    })
    .from(t.vehicleSyncStates)
    .where(
      and(
        inArray(t.vehicleSyncStates.vehicleId, vehicleIds),
        inArray(t.vehicleSyncStates.connectionId, connectionIds),
      ),
    );
  const held = new Set(existing.map((r) => `${r.vehicleId}:${r.connectionId}`));

  const missing: { vehicleId: string; connectionId: string; status: 'NOT_LISTED' }[] = [];
  for (const vehicleId of vehicleIds) {
    for (const connectionId of connectionIds) {
      if (!held.has(`${vehicleId}:${connectionId}`)) {
        missing.push({ vehicleId, connectionId, status: 'NOT_LISTED' });
      }
    }
  }
  if (!missing.length) return 0;

  for (let i = 0; i < missing.length; i += CHUNK) {
    await db
      .insert(t.vehicleSyncStates)
      // Belt and braces against a concurrent import racing a provisioning run.
      // `vehicle_sync_states_vehicle_conn_uq` makes the loser a no-op.
      .values(missing.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }

  return missing.length;
}

/* ------------------------------------------------------------- own site */

/** `channels.key` for the dealer's own storefront. */
export const OWN_SITE_CHANNEL_KEY = 'dealer_site';

/**
 * The dealer's own website is not a marketplace, and pretending it is one is
 * why a freshly onboarded lot shows "Website — 0 live" while the storefront is
 * sitting there rendering all twenty-one cars.
 *
 * TWO THINGS ARE WRONG BY DEFAULT AND BOTH ARE FIXED HERE.
 *
 * **The connection.** `provisionChannels` opens every channel in
 * `PENDING_SETUP`, which is right for CarGurus — somebody at CarGurus has to
 * switch a source over. There is nobody to wait for on the dealer's own site.
 * It is connected the moment it exists, so this promotes it.
 *
 * **The rows.** The storefront renders straight from `vehicles`, filtered by
 * status — it never consults `vehicle_sync_states`. So for this one channel the
 * sync row is not a queue, it is a *mirror*: a unit is live on the website
 * exactly when `isSyndicatable()` says it is, with no ETA and nothing in
 * flight. Computing it is therefore honest, where computing it for CarGurus
 * would be a lie.
 *
 * Runs in both directions, so a sold unit stops claiming to be live. Leaves
 * `EXCLUDED` alone — that is the dealer deliberately pulling a car, and it is
 * not this function's business to overrule them.
 */
export async function reconcileOwnSite(rooftopId: string): Promise<number> {
  const conn = (
    await db
      .select({ id: t.channelConnections.id, status: t.channelConnections.status })
      .from(t.channelConnections)
      .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
      .where(
        and(
          eq(t.channelConnections.rooftopId, rooftopId),
          eq(t.channels.key, OWN_SITE_CHANNEL_KEY),
        ),
      )
      .limit(1)
  )[0];
  if (!conn) return 0;

  const now = new Date();

  // Nobody to wait for. DISCONNECTED is left alone — that is a deliberate act.
  if (conn.status === 'PENDING_SETUP' || conn.status === 'AWAITING_DEALER' || conn.status === 'SUBMITTED') {
    await db
      .update(t.channelConnections)
      .set({ status: 'CONNECTED', lastSyncAt: now })
      .where(eq(t.channelConnections.id, conn.id));
  }

  const publicIds = db
    .select({ id: t.vehicles.id })
    .from(t.vehicles)
    .where(
      and(
        eq(t.vehicles.rooftopId, rooftopId),
        inArray(t.vehicles.status, [...SYNDICATABLE_STATUSES]),
      ),
    );

  const hiddenIds = db
    .select({ id: t.vehicles.id })
    .from(t.vehicles)
    .where(
      and(
        eq(t.vehicles.rooftopId, rooftopId),
        notInArray(t.vehicles.status, [...SYNDICATABLE_STATUSES]),
      ),
    );

  const live = await db
    .update(t.vehicleSyncStates)
    .set({ status: 'LIVE', lastSyncedAt: now, pendingSince: null, dueAt: null, errorMessage: null })
    .where(
      and(
        eq(t.vehicleSyncStates.connectionId, conn.id),
        notInArray(t.vehicleSyncStates.status, ['LIVE', 'EXCLUDED']),
        inArray(t.vehicleSyncStates.vehicleId, publicIds),
      ),
    )
    .returning({ id: t.vehicleSyncStates.id });

  await db
    .update(t.vehicleSyncStates)
    .set({ status: 'NOT_LISTED', lastSyncedAt: null, pendingSince: null, dueAt: null })
    .where(
      and(
        eq(t.vehicleSyncStates.connectionId, conn.id),
        eq(t.vehicleSyncStates.status, 'LIVE'),
        inArray(t.vehicleSyncStates.vehicleId, hiddenIds),
      ),
    );

  return live.length;
}

/**
 * Everything that has to be true about a rooftop's syndication grid after
 * inventory or connections change. Call this, not the two halves.
 */
export async function reconcileRooftopSync(rooftopId: string) {
  const opened = await openMissingSyncStates(rooftopId);
  const ownSiteLive = await reconcileOwnSite(rooftopId);
  return { opened, ownSiteLive };
}
