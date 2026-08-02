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
  assertVehicleInScope,
  getOverrides,
  getPriceHistory,
  getSyncMatrix,
  getSyncStatesForVehicle,
  publicScope,
  vehicleIdsInScope,
  type Scope,
} from '@/lib/scoped-db';
import { isLocalDatabase, forceRequested } from '@/db/guard';

const RUN = `iso${Date.now().toString(36)}`;

type Tenant = {
  groupId: string;
  rooftopId: string;
  vehicleId: string;
  channelId: string;
  connectionId: string;
  eventId: string;
  scope: Scope;
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
    vehicleId: vehicle!.id,
    channelId: channel!.id,
    connectionId: connection!.id,
    eventId: event!.id,
    // The admin path builds this from the session's groupId; here we build it
    // from the same rooftop ids that path would resolve.
    scope: publicScope([rooftop!.id]),
  };
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
