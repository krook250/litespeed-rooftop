import 'server-only';
import { and, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { isSyndicatable } from '@/lib/domain';

/**
 * Mock syndication engine.
 *
 * No real API calls happen here — but the state machine, the timing model and
 * the event log are the real ones. When the integrations land, this file gets a
 * transport; the tables and the UI do not change.
 *
 * Timing model, and it matters that we represent it honestly:
 *   PUSH_API  — we call the channel. Real world: seconds to a couple of minutes.
 *               Compressed here so a change lands inside a demo conversation.
 *   FEED_PULL — the channel fetches our feed on its own clock. Nothing we do
 *               makes it faster except regenerating the feed and waiting, or
 *               asking for an out-of-band refresh where the channel allows it.
 */

/** Seconds a push takes to land, in demo time. */
const PUSH_MIN_SECONDS = 4;
const PUSH_MAX_SECONDS = 9;
/** A forced feed refresh still has to build and be fetched. */
const FORCED_FEED_SECONDS = 6;

export type ChangeAction = typeof t.syncActionEnum.enumValues[number];

function pushEta() {
  const s = PUSH_MIN_SECONDS + Math.random() * (PUSH_MAX_SECONDS - PUSH_MIN_SECONDS);
  return new Date(Date.now() + s * 1000);
}

/** Next time a feed-pull channel is expected to fetch, on its own cadence. */
function nextPull(cadenceMinutes: number, lastSyncAt: Date | null) {
  const cadence = Math.max(15, cadenceMinutes) * 60_000;
  const base = lastSyncAt ? new Date(lastSyncAt).getTime() : Date.now();
  let next = base + cadence;
  while (next <= Date.now()) next += cadence;
  return new Date(next);
}

/**
 * Records a change on a vehicle and queues it out to every channel that is
 * actually listing it. Returns how many channels were affected.
 */
export async function enqueueChange(
  vehicleId: string,
  action: ChangeAction,
  fieldChanges: Record<string, { from: unknown; to: unknown }>,
  message: string,
) {
  const vehicle = (
    await db.select().from(t.vehicles).where(eq(t.vehicles.id, vehicleId)).limit(1)
  )[0];
  if (!vehicle) return { queued: 0, blocked: 0 };

  const states = await db
    .select()
    .from(t.vehicleSyncStates)
    .innerJoin(t.channelConnections, eq(t.vehicleSyncStates.connectionId, t.channelConnections.id))
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .where(eq(t.vehicleSyncStates.vehicleId, vehicleId));

  let queued = 0;
  let blocked = 0;

  for (const row of states) {
    const state = row.vehicle_sync_states;
    const conn = row.channel_connections;
    const channel = row.channels;

    // Excluded by the dealer, or the account is not usable — nothing to send.
    if (state.status === 'EXCLUDED') continue;
    if (conn.status === 'DISCONNECTED' || conn.status === 'PENDING_SETUP') continue;

    // A broken connection cannot carry the change. Say so instead of pretending.
    if (conn.status === 'ERROR') {
      blocked++;
      await db.insert(t.syncEvents).values({
        vehicleId,
        connectionId: conn.id,
        action,
        status: 'ERROR',
        message: `Change not sent — ${channel.name} connection needs attention.`,
        fieldChanges,
      });
      continue;
    }

    // Not retail-ready yet: only the dealer's own site carries it.
    if (!isSyndicatable(vehicle.status) && channel.key !== 'dealer_site') continue;

    const dueAt =
      channel.syncMode === 'PUSH_API'
        ? pushEta()
        : nextPull(channel.cadenceMinutes, conn.lastSyncAt);

    await db
      .update(t.vehicleSyncStates)
      .set({
        status: 'QUEUED',
        pendingSince: new Date(),
        dueAt,
        lastAttemptAt: new Date(),
        errorCode: null,
        errorMessage: null,
        payloadHash: `${vehicle.price}:${vehicle.salePrice ?? ''}:${vehicle.mileage}:${vehicle.status}`,
      })
      .where(eq(t.vehicleSyncStates.id, state.id));

    await db.insert(t.syncEvents).values({
      vehicleId,
      connectionId: conn.id,
      action,
      status: 'QUEUED',
      message,
      fieldChanges,
    });

    queued++;
  }

  return { queued, blocked };
}

/**
 * Advances anything whose ETA has passed. Called on a short interval from the
 * syndication screen; in production this is a worker, not a page poll.
 */
export async function advanceDueSyncs() {
  const now = new Date();
  const soon = new Date(now.getTime() + 2500);

  // QUEUED -> SYNCING as the ETA approaches, so the screen shows real motion.
  await db
    .update(t.vehicleSyncStates)
    .set({ status: 'SYNCING' })
    .where(and(eq(t.vehicleSyncStates.status, 'QUEUED'), lte(t.vehicleSyncStates.dueAt, soon)));

  const landing = await db
    .select()
    .from(t.vehicleSyncStates)
    .where(
      and(
        inArray(t.vehicleSyncStates.status, ['QUEUED', 'SYNCING']),
        lte(t.vehicleSyncStates.dueAt, now),
      ),
    );

  if (!landing.length) return { landed: 0 };

  await db
    .update(t.vehicleSyncStates)
    .set({
      status: 'LIVE',
      lastSyncedAt: now,
      pendingSince: null,
      dueAt: null,
    })
    .where(inArray(t.vehicleSyncStates.id, landing.map((s) => s.id)));

  // close out the open events
  for (const s of landing) {
    await db
      .update(t.syncEvents)
      .set({ status: 'LIVE', completedAt: now })
      .where(
        and(
          eq(t.syncEvents.vehicleId, s.vehicleId),
          eq(t.syncEvents.connectionId, s.connectionId),
          eq(t.syncEvents.status, 'QUEUED'),
        ),
      );
  }

  const connIds = [...new Set(landing.map((s) => s.connectionId))];
  await db
    .update(t.channelConnections)
    .set({ lastSyncAt: now })
    .where(and(inArray(t.channelConnections.id, connIds), ne(t.channelConnections.status, 'ERROR')));

  return { landed: landing.length };
}

/** How many changes are still in flight, for the header ticker. */
export async function pendingCount() {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(t.vehicleSyncStates)
    .where(inArray(t.vehicleSyncStates.status, ['QUEUED', 'SYNCING', 'PENDING']));
  return rows[0]?.c ?? 0;
}

/**
 * Ask a feed channel to refetch now instead of on its cadence. Real channels
 * vary on whether they honour this; the ones that do not are the reason the
 * cadence is shown in the first place.
 */
export async function forceFeedRefresh(connectionId: string) {
  const due = new Date(Date.now() + FORCED_FEED_SECONDS * 1000);
  await db
    .update(t.vehicleSyncStates)
    .set({ status: 'SYNCING', dueAt: due, lastAttemptAt: new Date() })
    .where(
      and(
        eq(t.vehicleSyncStates.connectionId, connectionId),
        inArray(t.vehicleSyncStates.status, ['QUEUED', 'PENDING', 'SYNCING']),
      ),
    );
  await db
    .update(t.channelConnections)
    .set({ nextSyncAt: due })
    .where(eq(t.channelConnections.id, connectionId));
}

/** Retry a single failed listing. */
export async function retrySync(syncStateId: string) {
  const row = (
    await db
      .select()
      .from(t.vehicleSyncStates)
      .innerJoin(t.channelConnections, eq(t.vehicleSyncStates.connectionId, t.channelConnections.id))
      .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
      .where(eq(t.vehicleSyncStates.id, syncStateId))
      .limit(1)
  )[0];
  if (!row) return;

  const channel = row.channels;
  const dueAt =
    channel.syncMode === 'PUSH_API'
      ? pushEta()
      : new Date(Date.now() + FORCED_FEED_SECONDS * 1000);

  await db
    .update(t.vehicleSyncStates)
    .set({
      status: 'QUEUED',
      dueAt,
      pendingSince: new Date(),
      lastAttemptAt: new Date(),
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(t.vehicleSyncStates.id, syncStateId));

  await db.insert(t.syncEvents).values({
    vehicleId: row.vehicle_sync_states.vehicleId,
    connectionId: row.channel_connections.id,
    action: 'RELIST',
    status: 'QUEUED',
    message: `Manual retry on ${channel.name}.`,
  });
}

/** Pull a unit off a channel, or put it back on. */
export async function setChannelExclusion(
  vehicleId: string,
  channelId: string,
  excluded: boolean,
) {
  const conn = (
    await db
      .select()
      .from(t.channelConnections)
      .innerJoin(t.vehicles, eq(t.vehicles.rooftopId, t.channelConnections.rooftopId))
      .where(and(eq(t.vehicles.id, vehicleId), eq(t.channelConnections.channelId, channelId)))
      .limit(1)
  )[0];
  if (!conn) return;

  const connectionId = conn.channel_connections.id;

  const existing = (
    await db
      .select()
      .from(t.vehicleChannelOverrides)
      .where(
        and(
          eq(t.vehicleChannelOverrides.vehicleId, vehicleId),
          eq(t.vehicleChannelOverrides.channelId, channelId),
        ),
      )
      .limit(1)
  )[0];

  if (existing) {
    await db
      .update(t.vehicleChannelOverrides)
      .set({ excluded })
      .where(eq(t.vehicleChannelOverrides.id, existing.id));
  } else {
    await db.insert(t.vehicleChannelOverrides).values({ vehicleId, channelId, excluded });
  }

  if (excluded) {
    await db
      .update(t.vehicleSyncStates)
      .set({ status: 'EXCLUDED', dueAt: null, pendingSince: null, remoteUrl: null })
      .where(
        and(
          eq(t.vehicleSyncStates.vehicleId, vehicleId),
          eq(t.vehicleSyncStates.connectionId, connectionId),
        ),
      );
    await db.insert(t.syncEvents).values({
      vehicleId,
      connectionId,
      action: 'REMOVE',
      status: 'REMOVED',
      message: 'Removed from channel by dealer.',
      completedAt: new Date(),
    });
  } else {
    await db
      .update(t.vehicleSyncStates)
      .set({ status: 'QUEUED', dueAt: new Date(Date.now() + 5000), pendingSince: new Date() })
      .where(
        and(
          eq(t.vehicleSyncStates.vehicleId, vehicleId),
          eq(t.vehicleSyncStates.connectionId, connectionId),
        ),
      );
    await db.insert(t.syncEvents).values({
      vehicleId,
      connectionId,
      action: 'RELIST',
      status: 'QUEUED',
      message: 'Re-listed by dealer.',
    });
  }
}

/** Repair the demo's broken CarGurus connection. */
export async function reconnectChannel(connectionId: string) {
  await db
    .update(t.channelConnections)
    .set({ status: 'CONNECTED', errorMessage: null, lastSyncAt: new Date() })
    .where(eq(t.channelConnections.id, connectionId));
}
