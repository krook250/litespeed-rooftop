/**
 * Tenant scoping, made unforgettable.
 *
 * §4 of `claude/auth-hosting-and-scale.md` describes the rule: admin queries
 * fall back to the signed-in tenant's rooftops, so forgetting to scope fails
 * closed. That worked for anything keyed by rooftop. It did **not** cover the
 * vehicle-keyed helpers — `getSyncStatesForVehicle`, `getOverrides`,
 * `getPriceHistory`, `getSyncMatrix` — which took a bare id and trusted it.
 * They were safe only because their ids happened to come from an
 * already-scoped list. That is a convention, and conventions are one
 * copy-paste away from a leak.
 *
 * This module replaces the convention with a type. Every helper here takes a
 * `Scope` as its first argument, and a `Scope` cannot be written by hand — the
 * brand symbol is module-private. The only two ways to obtain one are:
 *
 *   sessionScope()            — the admin path, from the signed-in tenant
 *   publicScope(rooftopIds)   — the storefront path, resolved from a slug
 *
 * So an unscoped call is not "a mistake we should catch in review"; it does
 * not compile. Every query below then filters on `vehicles.rooftopId` for real
 * at the database, so passing a foreign id returns nothing rather than data.
 *
 * Deliberately free of `server-only` and `next/*` — this is the module the
 * isolation test drives directly under plain tsx.
 */

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';

/**
 * Module-private and real at runtime, not a `declare const` — a phantom brand
 * would compile and then blow up the moment `brand()` tried to use it as a key.
 * Not exported, so no other module can name it, which is what makes `Scope`
 * unconstructable from outside this file.
 */
const TENANT_SCOPE = Symbol('rooftop.tenant-scope');

/**
 * A proven set of rooftop ids. Opaque on purpose: the branding property is not
 * exported, so `{ rooftopIds: [...] } as Scope` is the only way to fake one and
 * that shows up in review as exactly what it is.
 */
export type Scope = {
  readonly rooftopIds: string[];
  readonly [TENANT_SCOPE]: true;
};

function brand(rooftopIds: string[]): Scope {
  return { rooftopIds, [TENANT_SCOPE]: true } as Scope;
}

/**
 * The public path. The storefront has no session: it resolves its own rooftops
 * from the slug in the URL and passes them in explicitly.
 */
export function publicScope(rooftopIds: string[]): Scope {
  return brand([...rooftopIds]);
}

/**
 * Build a scope from a group id. The session-aware wrapper lives in
 * `queries.ts`, which is where `next/headers` is allowed.
 */
export async function scopeForGroup(groupId: string): Promise<Scope> {
  const rows = await db
    .select({ id: t.rooftops.id })
    .from(t.rooftops)
    .where(eq(t.rooftops.groupId, groupId));
  return brand(rows.map((r) => r.id));
}

/* --------------------------------------------------------------- helpers */

/**
 * The vehicle, if it belongs to this scope. null otherwise — never a throw,
 * because callers legitimately race a deleted unit and a 404 is the right
 * answer either way.
 */
export async function assertVehicleInScope(scope: Scope, vehicleId: string) {
  if (!scope.rooftopIds.length) return null;
  const rows = await db
    .select()
    .from(t.vehicles)
    .where(and(eq(t.vehicles.id, vehicleId), inArray(t.vehicles.rooftopId, scope.rooftopIds)))
    .limit(1);
  return rows[0] ?? null;
}

/** Filter a caller-supplied id list down to the ones this scope owns. */
export async function vehicleIdsInScope(scope: Scope, vehicleIds: string[]) {
  if (!scope.rooftopIds.length || !vehicleIds.length) return [];
  const rows = await db
    .select({ id: t.vehicles.id })
    .from(t.vehicles)
    .where(and(inArray(t.vehicles.id, vehicleIds), inArray(t.vehicles.rooftopId, scope.rooftopIds)))
    .limit(vehicleIds.length);
  return rows.map((r) => r.id);
}

export async function getSyncStatesForVehicle(scope: Scope, vehicleId: string) {
  if (!scope.rooftopIds.length) return [];
  return db
    .select()
    .from(t.vehicleSyncStates)
    .innerJoin(t.channelConnections, eq(t.vehicleSyncStates.connectionId, t.channelConnections.id))
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.vehicles, eq(t.vehicleSyncStates.vehicleId, t.vehicles.id))
    .where(
      and(
        eq(t.vehicleSyncStates.vehicleId, vehicleId),
        inArray(t.vehicles.rooftopId, scope.rooftopIds),
      ),
    )
    .orderBy(asc(t.channels.sortOrder));
}

export async function getSyncMatrix(scope: Scope, vehicleIds: string[]) {
  if (!scope.rooftopIds.length || !vehicleIds.length) return [];
  return db
    .select()
    .from(t.vehicleSyncStates)
    .innerJoin(t.channelConnections, eq(t.vehicleSyncStates.connectionId, t.channelConnections.id))
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.vehicles, eq(t.vehicleSyncStates.vehicleId, t.vehicles.id))
    .where(
      and(
        inArray(t.vehicleSyncStates.vehicleId, vehicleIds),
        inArray(t.vehicles.rooftopId, scope.rooftopIds),
      ),
    );
}

export async function getOverrides(scope: Scope, vehicleId: string) {
  if (!scope.rooftopIds.length) return [];
  const rows = await db
    .select()
    .from(t.vehicleChannelOverrides)
    .innerJoin(t.vehicles, eq(t.vehicleChannelOverrides.vehicleId, t.vehicles.id))
    .where(
      and(
        eq(t.vehicleChannelOverrides.vehicleId, vehicleId),
        inArray(t.vehicles.rooftopId, scope.rooftopIds),
      ),
    );
  return rows.map((r) => r.vehicle_channel_overrides);
}

export async function getPriceHistory(scope: Scope, vehicleId: string) {
  if (!scope.rooftopIds.length) return [];
  const rows = await db
    .select()
    .from(t.priceChanges)
    .innerJoin(t.vehicles, eq(t.priceChanges.vehicleId, t.vehicles.id))
    .where(
      and(
        eq(t.priceChanges.vehicleId, vehicleId),
        inArray(t.vehicles.rooftopId, scope.rooftopIds),
      ),
    )
    .orderBy(desc(t.priceChanges.changedAt));
  return rows.map((r) => r.price_changes);
}

/**
 * The storefront, if this scope owns it.
 *
 * Storefronts are keyed by **group**, not by rooftop, so the check goes through
 * the rooftops the scope proved: a storefront is in scope when its `groupId` is
 * the group that owns those rooftops. Doing it as one subquery rather than
 * `requireGroupId()` again keeps the guarantee identical to every other helper
 * here — the caller cannot pass a group id it did not prove.
 *
 * Deliberately not routed through `storefront_rooftops`: a storefront with no
 * rooftops linked yet is still the dealer's, and must stay manageable.
 */
export async function assertStorefrontInScope(scope: Scope, storefrontId: string) {
  if (!scope.rooftopIds.length) return null;
  const rows = await db
    .select()
    .from(t.storefronts)
    .where(
      and(
        eq(t.storefronts.id, storefrontId),
        inArray(
          t.storefronts.groupId,
          db
            .selectDistinct({ groupId: t.rooftops.groupId })
            .from(t.rooftops)
            .where(inArray(t.rooftops.id, scope.rooftopIds)),
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Every storefront this scope owns. Same group check as above. */
export async function storefrontsInScope(scope: Scope) {
  if (!scope.rooftopIds.length) return [];
  return db
    .select()
    .from(t.storefronts)
    .where(
      inArray(
        t.storefronts.groupId,
        db
          .selectDistinct({ groupId: t.rooftops.groupId })
          .from(t.rooftops)
          .where(inArray(t.rooftops.id, scope.rooftopIds)),
      ),
    );
}

/* ------------------------------------------------------------- transfers */

/**
 * The rooftop, if this scope owns it.
 *
 * This is the guard that makes a lot transfer safe. `startTransfer` takes a
 * destination rooftop id straight off a form, and without this a crafted POST
 * would hand another dealer's lot one of ours — or ours one of theirs. The
 * check is the same shape as every other helper here: the id has to be inside
 * the set the scope already proved.
 */
export async function assertRooftopInScope(scope: Scope, rooftopId: string) {
  if (!scope.rooftopIds.includes(rooftopId)) return null;
  const rows = await db
    .select()
    .from(t.rooftops)
    .where(and(eq(t.rooftops.id, rooftopId), inArray(t.rooftops.id, scope.rooftopIds)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * One channel connection, with its channel and rooftop, or null.
 *
 * Scoped through `rooftopIds` like everything else here: a connection id from
 * another dealer group resolves to null rather than to a row, so the screen
 * above it can 404 without ever having to think about tenancy.
 */
export async function getConnectionInScope(scope: Scope, connectionId: string) {
  if (!scope.rooftopIds.length) return null;
  const rows = await db
    .select()
    .from(t.channelConnections)
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.rooftops, eq(t.channelConnections.rooftopId, t.rooftops.id))
    .where(
      and(
        eq(t.channelConnections.id, connectionId),
        inArray(t.channelConnections.rooftopId, scope.rooftopIds),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** In-flight: departed, not yet arrived, not called off. */
const OPEN_TRANSFER = () =>
  and(isNull(t.vehicleTransfers.arrivedAt), isNull(t.vehicleTransfers.cancelledAt));

/**
 * The open transfer for one unit, or null. Scoped through the **origin**
 * rooftop, which is where the vehicle still lives while it is on the truck.
 */
export async function getOpenTransfer(scope: Scope, vehicleId: string) {
  if (!scope.rooftopIds.length) return null;
  const rows = await db
    .select()
    .from(t.vehicleTransfers)
    .where(
      and(
        eq(t.vehicleTransfers.vehicleId, vehicleId),
        OPEN_TRANSFER(),
        inArray(t.vehicleTransfers.fromRooftopId, scope.rooftopIds),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Everything currently on a truck across this tenant, with the unit and both
 * lot names attached. This is what the "Inbound" rail renders — the receiving
 * lot needs to know a car is coming *before* it shows up, and a feed card at
 * departure would be a third card for one move.
 */
export async function getOpenTransfers(scope: Scope) {
  if (!scope.rooftopIds.length) return [];
  const from = t.rooftops;
  const rows = await db
    .select({
      transfer: t.vehicleTransfers,
      vehicle: t.vehicles,
      fromName: from.name,
    })
    .from(t.vehicleTransfers)
    .innerJoin(t.vehicles, eq(t.vehicleTransfers.vehicleId, t.vehicles.id))
    .innerJoin(from, eq(t.vehicleTransfers.fromRooftopId, from.id))
    .where(and(OPEN_TRANSFER(), inArray(t.vehicleTransfers.fromRooftopId, scope.rooftopIds)))
    .orderBy(asc(t.vehicleTransfers.departedAt));
  return rows;
}

/** Every move this unit has made, newest first. Scoped like the rest. */
export async function getTransferHistory(scope: Scope, vehicleId: string) {
  if (!scope.rooftopIds.length) return [];
  const rows = await db
    .select()
    .from(t.vehicleTransfers)
    .innerJoin(t.vehicles, eq(t.vehicleTransfers.vehicleId, t.vehicles.id))
    .where(
      and(
        eq(t.vehicleTransfers.vehicleId, vehicleId),
        inArray(t.vehicles.rooftopId, scope.rooftopIds),
      ),
    )
    .orderBy(desc(t.vehicleTransfers.departedAt));
  return rows.map((r) => r.vehicle_transfers);
}

/**
 * One transfer, if this scope owns both ends of it.
 *
 * Both ends, not either: a transfer only ever runs between two rooftops of the
 * same group, so a row where only one side is ours is a row we should not be
 * able to touch.
 */
export async function assertTransferInScope(scope: Scope, transferId: string) {
  if (!scope.rooftopIds.length) return null;
  const rows = await db
    .select()
    .from(t.vehicleTransfers)
    .where(
      and(
        eq(t.vehicleTransfers.id, transferId),
        inArray(t.vehicleTransfers.fromRooftopId, scope.rooftopIds),
        inArray(t.vehicleTransfers.toRooftopId, scope.rooftopIds),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** One feed event, if the caller's scope owns the rooftop it was posted to. */
export async function assertFeedEventInScope(scope: Scope, eventId: string) {
  if (!scope.rooftopIds.length) return null;
  const rows = await db
    .select()
    .from(t.feedEvents)
    .where(and(eq(t.feedEvents.id, eventId), inArray(t.feedEvents.rooftopId, scope.rooftopIds)))
    .limit(1);
  return rows[0] ?? null;
}
