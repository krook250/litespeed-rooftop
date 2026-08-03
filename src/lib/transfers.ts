/**
 * Moving a unit from one of the group's lots to another.
 *
 * Why this is a table and three functions rather than one `UPDATE vehicles SET
 * rooftopId`:
 *
 *  1. **A transfer belongs to two rooftops and `feed_events.rooftopId` holds
 *     one.** The origin lot and the receiving lot are different audiences, so
 *     one move is two cards, and they are only the same move because they hang
 *     off the same `vehicle_transfers` row.
 *  2. **There is a gap between "it left" and "it's here."** A porter driving
 *     across town closes that gap in fifteen minutes; a dealer trade across the
 *     state takes two days. Without the row there is no way to express a car
 *     that is on a truck, and every unit is either fully arrived or was never
 *     moved.
 *  3. **`vehicles.rooftopId` moves on arrival, not on departure.** The unit
 *     stays on the origin lot's books and stays listed for the whole trip. See
 *     the `vehicleTransfers` comment in the schema for why.
 *
 * Every entry point takes a `Scope` it cannot be called without, and resolves
 * **both** the vehicle and the destination rooftop through it before writing —
 * a destination id off a form is exactly the untrusted input that §3 of
 * `claude/lot-walk.md` says the port had to fix everywhere else.
 *
 * Deliberately free of `server-only` and of every `next/*` import, like
 * `feed.ts` and `scoped-db.ts`: this is the module the isolation test drives
 * directly under plain tsx. The FormData/session wrapper lives in `actions.ts`.
 */

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import {
  assertRooftopInScope,
  assertTransferInScope,
  assertVehicleInScope,
  getOpenTransfer,
  type Scope,
} from '@/lib/scoped-db';
import {
  feedTransferCancelled,
  feedTransferIn,
  feedTransferInbound,
  feedTransferInboundCancelled,
  feedTransferOut,
} from '@/lib/feed';
import { shortRooftopName } from '@/lib/domain';

/**
 * Why a move was refused. Returned rather than thrown so the caller can render
 * the reason and the test can assert on it — every one of these is a real
 * thing a dealer can click into, not an exceptional condition.
 */
export type TransferRefusal =
  | 'vehicle-not-in-scope'
  | 'destination-not-in-scope'
  | 'same-rooftop'
  | 'already-in-transit'
  | 'not-transferable'
  | 'transfer-not-in-scope'
  | 'transfer-not-open';

export type TransferResult =
  | { ok: true; transfer: t.VehicleTransfer }
  | { ok: false; reason: TransferRefusal };

export const TRANSFER_REFUSAL_MESSAGE: Record<TransferRefusal, string> = {
  'vehicle-not-in-scope': 'That unit is not on one of your lots.',
  'destination-not-in-scope': 'That lot is not one of yours.',
  'same-rooftop': 'The unit is already on that lot.',
  'already-in-transit': 'That unit is already on its way somewhere.',
  'not-transferable': 'A sold or wholesaled unit cannot be moved between lots.',
  'transfer-not-in-scope': 'That move is not one of yours.',
  'transfer-not-open': 'That move has already been closed out.',
};

/** Sold and wholesaled units are gone. Everything still on the ground can move. */
const MOVEABLE: t.VehicleStatus[] = [
  'ARRIVED',
  'IN_RECON',
  'PHOTOS_PENDING',
  'FRONT_LINE_READY',
  'PENDING_SALE',
];

/**
 * Lot names for the cards. Rooftops are stored as "<Group> — <Location>" so
 * they read on their own; inside the app the group is already in the chrome,
 * so a card that says "left for Evergreen Motors — Battle Ground" is noise.
 */
async function lotNames(rooftopIds: string[]) {
  const rows = rooftopIds.length
    ? await db
        .select({ id: t.rooftops.id, name: t.rooftops.name, group: t.dealerGroups.name })
        .from(t.rooftops)
        .innerJoin(t.dealerGroups, eq(t.rooftops.groupId, t.dealerGroups.id))
        .where(inArray(t.rooftops.id, rooftopIds))
    : [];
  const byId = new Map(rows.map((r) => [r.id, shortRooftopName(r.name, r.group)] as const));
  return (id: string) => byId.get(id) ?? 'the other lot';
}

/**
 * Send a unit to another lot.
 *
 * `arriveNow` is the fifteen-minute-hop shortcut: it still writes the row and
 * still posts both cards, it just closes the row in the same call. A porter who
 * has already driven the car over should not have to open the app twice, and a
 * transfer that leaves no record because it was short is a transfer that never
 * shows up in the unit's history.
 */
export async function startTransfer(
  scope: Scope,
  input: {
    vehicleId: string;
    toRooftopId: string;
    note?: string | null;
    actorId?: string | null;
    arriveNow?: boolean;
  },
): Promise<TransferResult> {
  const vehicle = await assertVehicleInScope(scope, input.vehicleId);
  if (!vehicle) return { ok: false, reason: 'vehicle-not-in-scope' };

  const destination = await assertRooftopInScope(scope, input.toRooftopId);
  if (!destination) return { ok: false, reason: 'destination-not-in-scope' };

  if (destination.id === vehicle.rooftopId) return { ok: false, reason: 'same-rooftop' };
  if (!MOVEABLE.includes(vehicle.status)) return { ok: false, reason: 'not-transferable' };
  if (await getOpenTransfer(scope, vehicle.id)) {
    return { ok: false, reason: 'already-in-transit' };
  }

  const departedAt = new Date();
  // The partial unique index is the real guard against a double-submitted form;
  // the check above is only there to give the dealer a sentence instead of a
  // constraint violation. If we lose the race, treat it as the same answer.
  const inserted = await db
    .insert(t.vehicleTransfers)
    .values({
      vehicleId: vehicle.id,
      fromRooftopId: vehicle.rooftopId,
      toRooftopId: destination.id,
      departedAt,
      departedBy: input.actorId ?? null,
      note: input.note?.trim() ?? '',
    })
    .onConflictDoNothing()
    .returning();

  const transfer = inserted[0];
  if (!transfer) return { ok: false, reason: 'already-in-transit' };

  const nameFor = await lotNames(scope.rooftopIds);
  await feedTransferOut(vehicle, {
    transferId: transfer.id,
    toRooftopName: nameFor(destination.id),
    note: input.note,
    actorId: input.actorId,
  });

  if (input.arriveNow) {
    // No inbound card: warning the far end that a car is coming is noise when
    // the car is already parked outside. The arrival card covers it.
    return markTransferArrived(scope, { transferId: transfer.id, actorId: input.actorId });
  }

  // The receiving lot hears now, not when somebody remembers to mention it.
  await feedTransferInbound(vehicle, {
    transferId: transfer.id,
    toRooftopId: destination.id,
    fromRooftopName: nameFor(vehicle.rooftopId),
    note: input.note,
    actorId: input.actorId,
  });

  return { ok: true, transfer };
}

/**
 * The unit is on the ground at the far end.
 *
 * This is the call that actually moves `vehicles.rooftopId`, and the order
 * matters: the vehicle row is updated first so the arrival card is emitted
 * against the unit's new home rather than its old one.
 */
export async function markTransferArrived(
  scope: Scope,
  input: { transferId: string; actorId?: string | null },
): Promise<TransferResult> {
  const transfer = await assertTransferInScope(scope, input.transferId);
  if (!transfer) return { ok: false, reason: 'transfer-not-in-scope' };
  if (transfer.arrivedAt || transfer.cancelledAt) {
    return { ok: false, reason: 'transfer-not-open' };
  }

  const vehicle = await assertVehicleInScope(scope, transfer.vehicleId);
  if (!vehicle) return { ok: false, reason: 'vehicle-not-in-scope' };

  const arrivedAt = new Date();

  await db
    .update(t.vehicles)
    .set({ rooftopId: transfer.toRooftopId, updatedAt: arrivedAt })
    .where(eq(t.vehicles.id, transfer.vehicleId));

  const closed = await db
    .update(t.vehicleTransfers)
    .set({ arrivedAt, arrivedBy: input.actorId ?? null })
    .where(eq(t.vehicleTransfers.id, transfer.id))
    .returning();

  const moved = { ...vehicle, rooftopId: transfer.toRooftopId };
  const nameFor = await lotNames(scope.rooftopIds);

  await feedTransferIn(moved, {
    transferId: transfer.id,
    fromRooftopName: nameFor(transfer.fromRooftopId),
    toRooftopName: nameFor(transfer.toRooftopId),
    transitMs: arrivedAt.getTime() - new Date(transfer.departedAt).getTime(),
    actorId: input.actorId,
  });

  return { ok: true, transfer: closed[0] ?? { ...transfer, arrivedAt } };
}

/**
 * The move fell through. The unit never changes hands, so nothing about the
 * vehicle row, its listings or its channel state is touched — the only thing
 * that happens is the row closes and the origin lot's feed gets told, because
 * that is the feed the departure card is sitting in.
 */
export async function cancelTransfer(
  scope: Scope,
  input: { transferId: string; actorId?: string | null },
): Promise<TransferResult> {
  const transfer = await assertTransferInScope(scope, input.transferId);
  if (!transfer) return { ok: false, reason: 'transfer-not-in-scope' };
  if (transfer.arrivedAt || transfer.cancelledAt) {
    return { ok: false, reason: 'transfer-not-open' };
  }

  const vehicle = await assertVehicleInScope(scope, transfer.vehicleId);
  if (!vehicle) return { ok: false, reason: 'vehicle-not-in-scope' };

  const cancelledAt = new Date();
  const closed = await db
    .update(t.vehicleTransfers)
    .set({ cancelledAt })
    .where(eq(t.vehicleTransfers.id, transfer.id))
    .returning();

  const nameFor = await lotNames(scope.rooftopIds);
  await feedTransferCancelled(vehicle, {
    transferId: transfer.id,
    fromRooftopName: nameFor(transfer.fromRooftopId),
    toRooftopName: nameFor(transfer.toRooftopId),
    actorId: input.actorId,
  });

  // Both lots were told something, so both get the correction. A lot that was
  // promised a car and never told otherwise sends somebody out to look for it.
  await feedTransferInboundCancelled(vehicle, {
    transferId: transfer.id,
    toRooftopId: transfer.toRooftopId,
    fromRooftopName: nameFor(transfer.fromRooftopId),
    actorId: input.actorId,
  });

  return { ok: true, transfer: closed[0] ?? { ...transfer, cancelledAt } };
}
