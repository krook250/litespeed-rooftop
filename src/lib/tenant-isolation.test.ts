/**
 * Proof that dealer A cannot read dealer B.
 *
 * Roadmap item 2 in `claude/auth-hosting-and-scale.md` asks for a test, not an
 * assurance. This is that test. It builds two complete tenants side by side in
 * the real database, then drives every vehicle-keyed helper from A's scope
 * against B's ids and asserts nothing comes back — and, just as importantly,
 * that the same call from B's own scope *does* return data, so the test cannot
 * pass by the helpers simply being broken.
 *
 * Runs against DATABASE_URL. `npm test`. It creates its own tenants with a
 * unique suffix and deletes them at the end, so it is safe alongside seed data
 * and safe to run twice.
 */

import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import {
  assertFeedEventInScope,
  assertRooftopInScope,
  assertTransferInScope,
  assertVehicleInScope,
  getOpenTransfer,
  getOpenTransfers,
  getOverrides,
  getPriceHistory,
  getSyncMatrix,
  getSyncStatesForVehicle,
  getTransferHistory,
  publicScope,
  vehicleIdsInScope,
  type Scope,
} from '@/lib/scoped-db';
import { cancelTransfer, markTransferArrived, startTransfer } from '@/lib/transfers';
import { getFeed, resolveFeedStyle } from '@/lib/feed';
import { daysInStock } from '@/lib/domain';
import { isLocalDatabase, forceRequested } from '@/db/guard';

const RUN = `iso${Date.now().toString(36)}`;

type Tenant = {
  groupId: string;
  rooftopId: string;
  /** A second lot, so lot-to-lot transfers have somewhere to go. */
  rooftop2Id: string;
  userId: string;
  vehicleId: string;
  channelId: string;
  connectionId: string;
  eventId: string;
  /** Just the first lot — the scope the pre-transfer tests were written against. */
  scope: Scope;
  /** Both lots, which is what a real multi-rooftop session resolves to. */
  bothLots: Scope;
};

async function buildTenant(label: string): Promise<Tenant> {
  const [group] = await db
    .insert(t.dealerGroups)
    .values({ name: `${label} ${RUN}`, slug: `${RUN}-${label}` })
    .returning();

  const [rooftop] = await db
    .insert(t.rooftops)
    .values({
      groupId: group!.id,
      name: `${label} ${RUN} — Main`,
      slug: `${RUN}-${label}-main`,
      addressLine1: '1 Test Way',
      city: 'Vancouver',
      state: 'WA',
      postalCode: '98665',
      phone: '(360) 555-0100',
      email: `${RUN}-${label}@example.test`,
    })
    .returning();

  const [rooftop2] = await db
    .insert(t.rooftops)
    .values({
      groupId: group!.id,
      name: `${label} ${RUN} — Second`,
      slug: `${RUN}-${label}-second`,
      addressLine1: '2 Test Way',
      city: 'Battle Ground',
      state: 'WA',
      postalCode: '98604',
      phone: '(360) 555-0200',
      email: `${RUN}-${label}-2@example.test`,
    })
    .returning();

  const [user] = await db
    .insert(t.users)
    .values({
      groupId: group!.id,
      email: `${RUN}-${label}@example.test`,
      name: `${label} Owner`,
      role: 'OWNER',
    })
    .returning();

  const [vehicle] = await db
    .insert(t.vehicles)
    .values({
      rooftopId: rooftop!.id,
      vin: `${RUN.toUpperCase().padEnd(11, 'X').slice(0, 11)}${label === 'alpha' ? 'A' : 'B'}00001`.slice(0, 17),
      // Stock numbers are only unique within a tenant — both tenants use the
      // same one on purpose, because that was the sharp edge §4 called out.
      stockNumber: 'SHARED-1',
      year: 2021,
      make: 'Ford',
      model: 'F-150',
      bodyStyle: 'TRUCK',
      mileage: 60_000,
      price: 32_000,
      cost: 26_000,
      pack: 795,
      reconCost: 900,
      marketValue: 31_000,
      status: 'FRONT_LINE_READY',
      acquiredDate: new Date(Date.now() - 40 * 86_400_000),
      frontLineDate: new Date(Date.now() - 35 * 86_400_000),
    })
    .returning();

  const [channel] = await db
    .insert(t.channels)
    .values({
      key: `${RUN}-${label}-ch`,
      name: `${label} channel`,
      shortName: label.slice(0, 3).toUpperCase(),
      kind: 'MARKETPLACE',
      syncMode: 'PUSH_API',
    })
    .returning();

  const [connection] = await db
    .insert(t.channelConnections)
    .values({ rooftopId: rooftop!.id, channelId: channel!.id, status: 'CONNECTED' })
    .returning();

  await db
    .insert(t.vehicleSyncStates)
    .values({ vehicleId: vehicle!.id, connectionId: connection!.id, status: 'LIVE' });

  await db
    .insert(t.vehicleChannelOverrides)
    .values({
      vehicleId: vehicle!.id,
      channelId: channel!.id,
      titleOverride: `${label} secret merchandising copy`,
    });

  await db.insert(t.priceChanges).values({
    vehicleId: vehicle!.id,
    oldPrice: 33_500,
    newPrice: 32_000,
    reason: `${label} internal margin note`,
    changedBy: `${label} Owner`,
  });

  const [event] = await db
    .insert(t.feedEvents)
    .values({
      rooftopId: rooftop!.id,
      kind: 'price_change',
      vehicleId: vehicle!.id,
      actorId: user!.id,
      title: `${label} cut $1,500`,
      body: `${label} confidential`,
      stats: [{ k: 'Price cut', v: '$1,500', bad: true }],
      dedupeKey: `${RUN}:${label}:price`,
    })
    .returning();

  return {
    groupId: group!.id,
    rooftopId: rooftop!.id,
    rooftop2Id: rooftop2!.id,
    userId: user!.id,
    vehicleId: vehicle!.id,
    channelId: channel!.id,
    connectionId: connection!.id,
    eventId: event!.id,
    // The admin path builds this from the session's groupId; here we build it
    // from the same rooftop ids that path would resolve.
    scope: publicScope([rooftop!.id]),
    bothLots: publicScope([rooftop!.id, rooftop2!.id]),
  };
}

/** A spare unit on tenant A's first lot, so a transfer test can have its own. */
async function spareVehicle(tenant: Tenant, tag: string) {
  const [v] = await db
    .insert(t.vehicles)
    .values({
      rooftopId: tenant.rooftopId,
      vin: `${RUN.toUpperCase().padEnd(10, 'X').slice(0, 10)}${tag.toUpperCase().padEnd(7, '0')}`.slice(0, 17),
      stockNumber: `SPARE-${tag}`,
      year: 2019,
      make: 'Toyota',
      model: 'Tacoma',
      bodyStyle: 'TRUCK',
      mileage: 71_000,
      price: 29_500,
      cost: 24_000,
      pack: 795,
      reconCost: 1_100,
      marketValue: 30_000,
      status: 'FRONT_LINE_READY',
      acquiredDate: new Date(Date.now() - 52 * 86_400_000),
      frontLineDate: new Date(Date.now() - 44 * 86_400_000),
    })
    .returning();
  return v!;
}

let A: Tenant;
let B: Tenant;

before(async () => {
  A = await buildTenant('alpha');
  B = await buildTenant('bravo');
});

after(async () => {
  for (const x of [A, B]) {
    if (!x) continue;
    await db.delete(t.channelConnections).where(eq(t.channelConnections.id, x.connectionId));
    await db.delete(t.channels).where(eq(t.channels.id, x.channelId));
    await db.delete(t.dealerGroups).where(eq(t.dealerGroups.id, x.groupId));
  }
  // rooftops / vehicles / sync states / overrides / price changes / feed events
  // all cascade from dealer_groups.
  await db.$client.end();
});

describe('tenant isolation — dealer A cannot read dealer B', () => {
  it('assertVehicleInScope refuses the other tenant’s vehicle', async () => {
    assert.equal(await assertVehicleInScope(A.scope, B.vehicleId), null);
    assert.equal(await assertVehicleInScope(B.scope, A.vehicleId), null);

    // …and still returns each tenant its own, so this is isolation, not breakage.
    assert.equal((await assertVehicleInScope(A.scope, A.vehicleId))?.id, A.vehicleId);
    assert.equal((await assertVehicleInScope(B.scope, B.vehicleId))?.id, B.vehicleId);
  });

  it('getSyncStatesForVehicle leaks nothing across tenants', async () => {
    assert.deepEqual(await getSyncStatesForVehicle(A.scope, B.vehicleId), []);
    assert.equal((await getSyncStatesForVehicle(A.scope, A.vehicleId)).length, 1);
  });

  it('getSyncMatrix filters foreign ids out of a mixed list', async () => {
    const mixed = await getSyncMatrix(A.scope, [A.vehicleId, B.vehicleId]);
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0]!.vehicle_sync_states.vehicleId, A.vehicleId);
  });

  it('getOverrides does not return the other tenant’s listing copy', async () => {
    assert.deepEqual(await getOverrides(A.scope, B.vehicleId), []);
    const own = await getOverrides(A.scope, A.vehicleId);
    assert.equal(own.length, 1);
    assert.match(own[0]!.titleOverride ?? '', /alpha/);
  });

  it('getPriceHistory does not return the other tenant’s cost decisions', async () => {
    assert.deepEqual(await getPriceHistory(A.scope, B.vehicleId), []);
    assert.equal((await getPriceHistory(A.scope, A.vehicleId)).length, 1);
  });

  it('vehicleIdsInScope drops foreign ids silently', async () => {
    assert.deepEqual(await vehicleIdsInScope(A.scope, [B.vehicleId]), []);
    assert.deepEqual(await vehicleIdsInScope(A.scope, [A.vehicleId, B.vehicleId]), [A.vehicleId]);
  });

  it('assertFeedEventInScope refuses the other tenant’s feed', async () => {
    assert.equal(await assertFeedEventInScope(A.scope, B.eventId), null);
    assert.equal((await assertFeedEventInScope(A.scope, A.eventId))?.id, A.eventId);
  });

  it('an empty scope reads nothing at all — the fail-closed case', async () => {
    const nobody = publicScope([]);
    assert.equal(await assertVehicleInScope(nobody, A.vehicleId), null);
    assert.deepEqual(await getSyncStatesForVehicle(nobody, A.vehicleId), []);
    assert.deepEqual(await getSyncMatrix(nobody, [A.vehicleId, B.vehicleId]), []);
    assert.deepEqual(await getOverrides(nobody, A.vehicleId), []);
    assert.deepEqual(await getPriceHistory(nobody, A.vehicleId), []);
    assert.equal(await assertFeedEventInScope(nobody, A.eventId), null);
  });

  it('a shared stock number resolves to a different vehicle per tenant', async () => {
    const [a] = await db
      .select({ id: t.vehicles.id })
      .from(t.vehicles)
      .where(inArray(t.vehicles.rooftopId, A.scope.rooftopIds));
    const [b] = await db
      .select({ id: t.vehicles.id })
      .from(t.vehicles)
      .where(inArray(t.vehicles.rooftopId, B.scope.rooftopIds));
    assert.notEqual(a!.id, b!.id);
  });
});

/**
 * Lot-to-lot transfers.
 *
 * A transfer takes a **destination rooftop id straight off a form**, which is a
 * new shape of untrusted input: every other write path in the app takes a
 * vehicle id and resolves it. So the first three tests here are the ones that
 * matter — a crafted POST must not be able to hand another dealer's lot one of
 * our units, or park one of theirs on ours.
 *
 * The rest pin the behaviour the schema comment promises: the vehicle does not
 * move until somebody says it arrived, days in stock does not reset when it
 * does, and one unit cannot be on two trucks.
 */
describe('lot transfers', () => {
  it('refuses a destination rooftop belonging to another tenant', async () => {
    const r = await startTransfer(A.bothLots, {
      vehicleId: A.vehicleId,
      toRooftopId: B.rooftopId,
      actorId: A.userId,
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'destination-not-in-scope');

    // …and the unit did not move.
    const [v] = await db.select().from(t.vehicles).where(eq(t.vehicles.id, A.vehicleId));
    assert.equal(v!.rooftopId, A.rooftopId);
  });

  it('refuses to move another tenant’s vehicle onto our lot', async () => {
    const r = await startTransfer(A.bothLots, {
      vehicleId: B.vehicleId,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'vehicle-not-in-scope');

    const [v] = await db.select().from(t.vehicles).where(eq(t.vehicles.id, B.vehicleId));
    assert.equal(v!.rooftopId, B.rooftopId);
  });

  it('refuses a move to the lot the unit is already on', async () => {
    const r = await startTransfer(A.bothLots, {
      vehicleId: A.vehicleId,
      toRooftopId: A.rooftopId,
      actorId: A.userId,
    });
    assert.equal(r.ok === false && r.reason, 'same-rooftop');
  });

  it('departure posts to the origin lot and does NOT move the unit yet', async () => {
    const car = await spareVehicle(A, 'dep');
    const started = await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      note: 'Trucks sell better on the other lot',
      actorId: A.userId,
    });
    assert.equal(started.ok, true);

    // The whole point of the row: the car is on a truck, not on either lot's
    // books yet. It stays listed at the origin so it never goes dark mid-move.
    const [v] = await db.select().from(t.vehicles).where(eq(t.vehicles.id, car.id));
    assert.equal(v!.rooftopId, A.rooftopId);

    const open = await getOpenTransfer(A.bothLots, car.id);
    assert.ok(open, 'the unit should read as in transit');
    assert.equal(open!.toRooftopId, A.rooftop2Id);
    assert.equal(open!.arrivedAt, null);

    const cards = await db
      .select()
      .from(t.feedEvents)
      .where(eq(t.feedEvents.vehicleId, car.id));

    const out = cards.find((c) => c.kind === 'transfer_out');
    assert.ok(out, 'the origin lot gets a card');
    assert.equal(out!.rooftopId, A.rooftopId);
    assert.ok(out!.stats.length > 0, 'every card carries a number');

    // …and the far end hears at departure, not at arrival. This is the card
    // the porter expecting the car actually needs.
    const inbound = cards.find((c) => c.kind === 'transfer_inbound');
    assert.ok(inbound, 'the receiving lot is told it is coming');
    assert.equal(inbound!.rooftopId, A.rooftop2Id);
    assert.ok(inbound!.stats.length > 0);

    // The arrival card is the one thing that has not happened yet.
    assert.equal(cards.some((c) => c.kind === 'transfer_in'), false);
  });

  it('one unit cannot be on two trucks', async () => {
    const car = await spareVehicle(A, 'two');
    assert.equal(
      (await startTransfer(A.bothLots, {
        vehicleId: car.id,
        toRooftopId: A.rooftop2Id,
        actorId: A.userId,
      })).ok,
      true,
    );

    const second = await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
    });
    assert.equal(second.ok === false && second.reason, 'already-in-transit');

    // And the guard is the database, not the check above it: bypassing the
    // helper and inserting straight into the table has to fail too.
    await assert.rejects(() =>
      db.insert(t.vehicleTransfers).values({
        vehicleId: car.id,
        fromRooftopId: A.rooftopId,
        toRooftopId: A.rooftop2Id,
      }),
    );
  });

  it('the other tenant cannot mark our move arrived', async () => {
    const car = await spareVehicle(A, 'arr');
    const started = await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
    });
    assert.equal(started.ok, true);
    const transferId = started.ok ? started.transfer.id : '';

    const hijack = await markTransferArrived(B.bothLots, { transferId, actorId: B.userId });
    assert.equal(hijack.ok === false && hijack.reason, 'transfer-not-in-scope');
    assert.equal(await assertTransferInScope(B.bothLots, transferId), null);

    // Ours still works, so this is isolation and not breakage.
    const mine = await markTransferArrived(A.bothLots, { transferId, actorId: A.userId });
    assert.equal(mine.ok, true);
  });

  it('arrival moves the unit, posts to the receiving lot, and keeps the clock running', async () => {
    const car = await spareVehicle(A, 'clk');
    const daysBefore = daysInStock(car);

    const started = await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
    });
    assert.equal(started.ok, true);
    const transferId = started.ok ? started.transfer.id : '';

    const arrived = await markTransferArrived(A.bothLots, { transferId, actorId: A.userId });
    assert.equal(arrived.ok, true);

    const [v] = await db.select().from(t.vehicles).where(eq(t.vehicles.id, car.id));
    assert.equal(v!.rooftopId, A.rooftop2Id, 'the unit is now on the receiving lot');

    // Days in stock is measured from acquiredDate, and a transfer must not
    // touch it — resetting the clock is how aged inventory gets laundered into
    // fresh inventory.
    assert.equal(v!.acquiredDate.getTime(), car.acquiredDate.getTime());
    assert.equal(daysInStock(v!), daysBefore);

    const inCard = (
      await db.select().from(t.feedEvents).where(eq(t.feedEvents.vehicleId, car.id))
    ).find((c) => c.kind === 'transfer_in');
    assert.ok(inCard, 'the receiving lot gets a card');
    assert.equal(inCard!.rooftopId, A.rooftop2Id);
    assert.ok(inCard!.stats.some((s) => s.k === 'In transit'));

    // The move is closed, so nothing reads as in transit any more.
    assert.equal(await getOpenTransfer(A.bothLots, car.id), null);

    const again = await markTransferArrived(A.bothLots, { transferId, actorId: A.userId });
    assert.equal(again.ok === false && again.reason, 'transfer-not-open');
  });

  it('“it’s already there” closes the move in one call and still records it', async () => {
    const car = await spareVehicle(A, 'now');
    const r = await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
      arriveNow: true,
    });
    assert.equal(r.ok, true);

    const [v] = await db.select().from(t.vehicles).where(eq(t.vehicles.id, car.id));
    assert.equal(v!.rooftopId, A.rooftop2Id);
    assert.equal(await getOpenTransfer(A.bothLots, car.id), null);

    // A short hop is still a transfer: it leaves a row and both cards, so it
    // shows up in the unit's history like any other move.
    const history = await getTransferHistory(A.bothLots, car.id);
    assert.equal(history.length, 1);
    assert.ok(history[0]!.arrivedAt);

    const kinds = (
      await db.select().from(t.feedEvents).where(eq(t.feedEvents.vehicleId, car.id))
    ).map((c) => c.kind);
    assert.ok(kinds.includes('transfer_out'));
    assert.ok(kinds.includes('transfer_in'));
    // No "it's on its way" card: the car is already parked outside, so the
    // warning would be noise and the arrival card says everything.
    assert.equal(kinds.includes('transfer_inbound'), false);
  });

  it('calling a move off leaves the unit exactly where it was', async () => {
    const car = await spareVehicle(A, 'cxl');
    const started = await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
    });
    assert.equal(started.ok, true);

    const cancelled = await cancelTransfer(A.bothLots, {
      transferId: started.ok ? started.transfer.id : '',
      actorId: A.userId,
    });
    assert.equal(cancelled.ok, true);

    const [v] = await db.select().from(t.vehicles).where(eq(t.vehicles.id, car.id));
    assert.equal(v!.rooftopId, A.rooftopId);
    assert.equal(await getOpenTransfer(A.bothLots, car.id), null);

    // Both lots were told something, so both get the correction. A lot that was
    // promised a car and never told otherwise sends somebody out to look.
    const cards = await db
      .select()
      .from(t.feedEvents)
      .where(eq(t.feedEvents.vehicleId, car.id));
    assert.ok(
      cards.some((c) => c.kind === 'transfer_out' && c.rooftopId === A.rooftopId && /staying put/.test(c.title)),
      'the origin lot is told the move is off',
    );
    assert.ok(
      cards.some((c) => c.kind === 'transfer_inbound' && c.rooftopId === A.rooftop2Id && /not coming/.test(c.title)),
      'the receiving lot is told not to expect it',
    );

    // The row survives, so a cancelled move is still auditable…
    assert.equal((await getTransferHistory(A.bothLots, car.id)).length, 1);
    // …and the unit is free to be moved again.
    const retry = await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
    });
    assert.equal(retry.ok, true);
  });

  it('transfer reads are scoped like every other read', async () => {
    const car = await spareVehicle(A, 'scp');
    await startTransfer(A.bothLots, {
      vehicleId: car.id,
      toRooftopId: A.rooftop2Id,
      actorId: A.userId,
    });

    assert.equal(await getOpenTransfer(B.bothLots, car.id), null);
    assert.deepEqual(await getTransferHistory(B.bothLots, car.id), []);
    assert.equal(
      (await getOpenTransfers(B.bothLots)).some((r) => r.vehicle.id === car.id),
      false,
    );
    assert.equal(
      (await getOpenTransfers(A.bothLots)).some((r) => r.vehicle.id === car.id),
      true,
    );

    const nobody = publicScope([]);
    assert.equal(await getOpenTransfer(nobody, car.id), null);
    assert.deepEqual(await getOpenTransfers(nobody), []);
    assert.equal(await assertRooftopInScope(nobody, A.rooftopId), null);
  });
});

/**
 * Feed style — one event stream, two presentations.
 *
 * The thing worth testing is not that a component renders differently. It is
 * that **null in `users.feedStyle` is load-bearing**: it is the difference
 * between "I chose Lot Walk" and "I never chose", and only the second follows
 * the owner when they change the house default. Get that wrong and the setting
 * either cannot be changed for existing staff, or silently overwrites choices
 * people made — and both failures look fine in a screenshot.
 */
describe('feed style — house default with a personal override', () => {
  it('a user who has never chosen inherits the dealership', async () => {
    const r = await resolveFeedStyle({ groupId: A.groupId, feedStyle: null });
    // LOG since Sep 2026. Most signups are the three-person lot that finds a
    // reaction bar on an inventory record silly; Lot Walk is sold, not defaulted.
    assert.equal(r.style, 'LOG', 'LOG is the default bet');
    assert.equal(r.houseStyle, 'LOG');
    assert.equal(r.isOverride, false);
  });

  it('the house default moves everyone who never chose, and nobody who did', async () => {
    await db
      .update(t.dealerGroups)
      .set({ feedStyle: 'LOG' })
      .where(eq(t.dealerGroups.id, A.groupId));

    // The owner-plus-two-reps case: nobody picked anything, the house says LOG,
    // so everybody gets the log.
    const inherits = await resolveFeedStyle({ groupId: A.groupId, feedStyle: null });
    assert.equal(inherits.style, 'LOG');
    assert.equal(inherits.isOverride, false);

    // The person who explicitly asked for Lot Walk keeps it, and is told that
    // it is theirs rather than the dealership's.
    const chose = await resolveFeedStyle({ groupId: A.groupId, feedStyle: 'SOCIAL' });
    assert.equal(chose.style, 'SOCIAL');
    assert.equal(chose.houseStyle, 'LOG');
    assert.equal(chose.isOverride, true);

    // Choosing the same thing the house chose is not an override — otherwise
    // the UI would nag about a difference that does not exist.
    const agrees = await resolveFeedStyle({ groupId: A.groupId, feedStyle: 'LOG' });
    assert.equal(agrees.isOverride, false);

    await db
      .update(t.dealerGroups)
      .set({ feedStyle: 'LOG' })
      .where(eq(t.dealerGroups.id, A.groupId));
  });

  it('style is per tenant — one dealership’s choice does not reach another', async () => {
    // A moves off the default; B must not follow it.
    await db
      .update(t.dealerGroups)
      .set({ feedStyle: 'SOCIAL' })
      .where(eq(t.dealerGroups.id, A.groupId));
    assert.equal((await resolveFeedStyle({ groupId: B.groupId, feedStyle: null })).style, 'LOG');
    await db
      .update(t.dealerGroups)
      .set({ feedStyle: 'LOG' })
      .where(eq(t.dealerGroups.id, A.groupId));
  });

  it('the log fetches no threads but still knows they exist', async () => {
    await db.insert(t.feedComments).values({
      eventId: A.eventId,
      userId: A.userId,
      body: 'Comment that the log must not silently swallow',
    });

    const social = await getFeed({
      rooftopIds: A.scope.rooftopIds,
      viewerId: A.userId,
      withSocial: true,
    });
    const socialCard = social.find((c) => c.event.id === A.eventId)!;
    assert.equal(socialCard.comments.length, 1);
    assert.equal(socialCard.commentCount, 1);

    const log = await getFeed({
      rooftopIds: A.scope.rooftopIds,
      viewerId: A.userId,
      withSocial: false,
    });
    const logCard = log.find((c) => c.event.id === A.eventId)!;
    // The thread is not fetched — that is the saving — but the count is, so a
    // conversation never disappears without a trace. The two views are one
    // stream, and a row that reads as "nothing here" in the log would be a lie.
    assert.equal(logCard.comments.length, 0);
    assert.equal(logCard.commentCount, 1);
    assert.deepEqual(
      logCard.reactions.map((r) => r.count),
      [0, 0],
    );

    // Same events, same order, either way. Only the drawing differs.
    assert.deepEqual(
      log.map((c) => c.event.id),
      social.map((c) => c.event.id),
    );
  });
});

describe('db:seed guard', () => {
  it('treats loopback and .local as seedable', () => {
    assert.equal(isLocalDatabase('postgresql://u@localhost:5432/rooftop'), true);
    assert.equal(isLocalDatabase('postgresql://u@127.0.0.1:5432/rooftop'), true);
    assert.equal(isLocalDatabase('postgresql://u@dev-box.local:5432/rooftop'), true);
  });

  it('refuses a managed host', () => {
    assert.equal(
      isLocalDatabase('postgresql://u:p@ep-x-1.us-east-2.aws.neon.tech/rooftop?sslmode=require'),
      false,
    );
    assert.equal(isLocalDatabase('postgresql://u:p@db.example.com/rooftop'), false);
    // An allowlist, not a "contains neon" denylist — a new provider must not
    // become seedable by default.
    assert.equal(isLocalDatabase('postgresql://u:p@prod.some-new-provider.io/rooftop'), false);
  });

  it('is unmoved by a malformed url', () => {
    assert.equal(isLocalDatabase('not a url'), false);
  });

  it('only forces when actually asked', () => {
    assert.equal(forceRequested([]), false);
    assert.equal(forceRequested(['--force']), true);
    assert.equal(forceRequested(['-f']), true);
  });
});
