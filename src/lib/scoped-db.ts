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

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
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
