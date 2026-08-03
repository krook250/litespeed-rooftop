'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import {
  advanceDueSyncs,
  enqueueChange,
  forceFeedRefresh,
  reconnectChannel,
  retrySync,
  setChannelExclusion,
} from '@/lib/sync-engine';
import { buildVin } from '@/lib/vin';
import { PHOTO_SET, generatedPhotoUrl } from '@/lib/photo-svg';
import { requireSession } from '@/lib/auth';
import { assertVehicleInScope, sessionScope } from '@/lib/queries';
import { daysInStock, totalCost } from '@/lib/domain';
import {
  feedAcquired,
  feedFrontLine,
  feedPhotos,
  feedPriceChange,
  feedReconIn,
  feedReconOut,
  feedSold,
} from '@/lib/feed';
import {
  cancelTransfer as cancelTransferCore,
  markTransferArrived as markTransferArrivedCore,
  startTransfer as startTransferCore,
} from '@/lib/transfers';

/** Dealership name stamped on generated placeholder photos, per tenant. */
async function dealerLabelForRooftop(rooftopId: string) {
  const rows = await db
    .select({ name: t.dealerGroups.name })
    .from(t.rooftops)
    .innerJoin(t.dealerGroups, eq(t.rooftops.groupId, t.dealerGroups.id))
    .where(eq(t.rooftops.id, rooftopId))
    .limit(1);
  return rows[0]?.name ?? 'Dealership';
}

/**
 * Load a vehicle for writing, refusing anything outside the signed-in tenant.
 *
 * Every action below took a `vehicleId` straight off a FormData and trusted it.
 * Reads were already scoped (see queries.ts); writes were not, so a crafted
 * POST could reprice the next dealer's inventory. Same rule as the read path:
 * no session, no vehicle.
 */
async function loadWritableVehicle(vehicleId: string) {
  const scope = await sessionScope();
  return assertVehicleInScope(scope, vehicleId);
}

/** Photo counts that actually mean something to a channel. */
const PHOTO_GATES = [3, 8];

async function photoCountFor(vehicleId: string) {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(t.vehiclePhotos)
    .where(eq(t.vehiclePhotos.vehicleId, vehicleId));
  return rows[0]?.c ?? 0;
}

/** How many channels this rooftop can actually push to right now. */
async function connectedChannelCount(rooftopId: string) {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(t.channelConnections)
    .where(
      and(
        eq(t.channelConnections.rooftopId, rooftopId),
        eq(t.channelConnections.status, 'CONNECTED'),
      ),
    );
  return rows[0]?.c ?? 0;
}

function refreshAll(vehicleId?: string) {
  revalidatePath('/admin', 'layout');
  revalidatePath('/s', 'layout');
  if (vehicleId) revalidatePath(`/admin/inventory/${vehicleId}`);
}

/* --------------------------------------------------------------- pricing */

export async function updatePrice(formData: FormData) {
  const vehicleId = String(formData.get('vehicleId'));
  const newPrice = Number(formData.get('price'));
  const reason = String(formData.get('reason') ?? '').trim() || null;
  const clearSale = formData.get('clearSale') === 'on';

  const me = await requireSession();
  const vehicle = await loadWritableVehicle(vehicleId);
  if (!vehicle || !Number.isFinite(newPrice) || newPrice <= 0) return;

  const oldActive = vehicle.salePrice ?? vehicle.price;
  if (newPrice === oldActive && !clearSale) return;

  // A repriced unit keeps its list price and gets a sale price, which is how
  // dealers actually reprice — the strike-through is the merchandising.
  const setSale = !clearSale && newPrice < vehicle.price;

  await db
    .update(t.vehicles)
    .set({
      price: setSale ? vehicle.price : newPrice,
      salePrice: setSale ? newPrice : null,
      updatedAt: new Date(),
    })
    .where(eq(t.vehicles.id, vehicleId));

  await db.insert(t.priceChanges).values({
    vehicleId,
    oldPrice: oldActive,
    newPrice,
    reason,
    changedBy: me.name,
  });

  await feedPriceChange(
    { ...vehicle, price: setSale ? vehicle.price : newPrice, salePrice: setSale ? newPrice : null },
    { oldPrice: oldActive, newPrice, reason, actorId: me.id },
  );

  await enqueueChange(
    vehicleId,
    'UPDATE_PRICE',
    { price: { from: oldActive, to: newPrice } },
    `Price ${newPrice < oldActive ? 'reduced' : 'raised'} from $${oldActive.toLocaleString()} to $${newPrice.toLocaleString()}`,
  );

  refreshAll(vehicleId);
}

/* ---------------------------------------------------------- vehicle edit */

const NUMERIC = ['year', 'mileage', 'price', 'cost', 'pack', 'reconCost', 'marketValue', 'doors', 'cylinders', 'mpgCity', 'mpgHwy', 'keysCount'] as const;

export async function saveVehicle(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const me = await requireSession();
  const str = (k: string) => String(formData.get(k) ?? '').trim();
  const int = (k: string) => {
    const raw = String(formData.get(k) ?? '').replace(/[^0-9-]/g, '');
    return raw === '' ? null : Number(raw);
  };
  const list = (k: string) =>
    String(formData.get(k) ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

  const base = {
    stockNumber: str('stockNumber'),
    year: int('year') ?? 2020,
    make: str('make'),
    model: str('model'),
    trim: str('trim'),
    bodyStyle: str('bodyStyle') as typeof t.bodyStyleEnum.enumValues[number],
    doors: int('doors') ?? 4,
    engine: str('engine'),
    cylinders: int('cylinders'),
    transmission: str('transmission') as typeof t.transmissionEnum.enumValues[number],
    drivetrain: str('drivetrain') as typeof t.drivetrainEnum.enumValues[number],
    fuelType: str('fuelType') as typeof t.fuelTypeEnum.enumValues[number],
    mpgCity: int('mpgCity'),
    mpgHwy: int('mpgHwy'),
    exteriorColor: str('exteriorColor'),
    exteriorColorHex: str('exteriorColorHex') || '#9ca3af',
    interiorColor: str('interiorColor'),
    mileage: int('mileage') ?? 0,
    price: int('price') ?? 0,
    cost: int('cost') ?? 0,
    pack: int('pack') ?? 0,
    reconCost: int('reconCost') ?? 0,
    marketValue: int('marketValue') ?? 0,
    status: str('status') as typeof t.vehicleStatusEnum.enumValues[number],
    description: str('description'),
    callouts: list('callouts'),
    options: list('options'),
    carfaxOneOwner: formData.get('carfaxOneOwner') === 'on',
    carfaxNoAccidents: formData.get('carfaxNoAccidents') === 'on',
    keysCount: int('keysCount') ?? 2,
    updatedAt: new Date(),
  };

  if (!id) {
    // new unit — the rooftop must be one of ours, or this is a cross-tenant insert
    const rooftopId = str('rooftopId');
    const scope = await sessionScope();
    if (!scope.rooftopIds.includes(rooftopId)) return;
    const vin = str('vin') || buildVin(base.make, base.year, base.stockNumber || String(Date.now()));
    const acquired = str('acquiredDate') ? new Date(str('acquiredDate')) : new Date();
    const inserted = await db
      .insert(t.vehicles)
      .values({
        ...base,
        rooftopId,
        vin,
        acquiredDate: acquired,
        frontLineDate: base.status === 'FRONT_LINE_READY' ? new Date() : null,
        acquisitionSource: (str('acquisitionSource') || 'AUCTION') as typeof t.acquisitionSourceEnum.enumValues[number],
      })
      .returning();

    const v = inserted[0]!;

    // give it a photo set so it is presentable the moment it is created
    const photoLabel = await dealerLabelForRooftop(v.rooftopId);
    await db.insert(t.vehiclePhotos).values(
      PHOTO_SET.map((scene, n) => ({
        vehicleId: v.id,
        url: generatedPhotoUrl({
          scene,
          body: v.bodyStyle,
          hex: v.exteriorColorHex,
          label: photoLabel,
          sublabel: `STK ${v.stockNumber}`,
          mileage: v.mileage,
        }),
        sortOrder: n,
        isPrimary: n === 0,
        tag: scene,
        alt: `${v.year} ${v.make} ${v.model}`,
      })),
    );

    // open a sync row on every connection for this rooftop
    const conns = await db
      .select()
      .from(t.channelConnections)
      .where(eq(t.channelConnections.rooftopId, rooftopId));
    if (conns.length) {
      await db.insert(t.vehicleSyncStates).values(
        conns.map((c) => ({
          vehicleId: v.id,
          connectionId: c.id,
          status: 'NOT_LISTED' as const,
        })),
      );
    }

    // The lot hears about the unit the moment it lands, not when someone
    // remembers to mention it.
    await feedAcquired(v, me.id);
    if (v.status === 'IN_RECON') await feedReconIn(v, me.id);

    await enqueueChange(v.id, 'CREATE', {}, `New unit added — ${v.year} ${v.make} ${v.model}`);
    refreshAll(v.id);
    redirect(`/admin/inventory/${v.id}`);
  }

  const before = await loadWritableVehicle(id);
  if (!before) return;

  const goingFrontLine =
    base.status === 'FRONT_LINE_READY' && before.status !== 'FRONT_LINE_READY';
  const goingSold = base.status === 'SOLD' && before.status !== 'SOLD';
  const soldAt = goingSold ? new Date() : before.soldDate;

  await db
    .update(t.vehicles)
    .set({
      ...base,
      frontLineDate: goingFrontLine ? new Date() : before.frontLineDate,
      soldDate: soldAt,
    })
    .where(eq(t.vehicles.id, id));

  const after = { ...before, ...base, frontLineDate: goingFrontLine ? new Date() : before.frontLineDate };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of ['price', 'mileage', 'status', 'description'] as const) {
    if (before[k] !== (base as Record<string, unknown>)[k]) {
      changes[k] = { from: before[k], to: (base as Record<string, unknown>)[k] };
    }
  }

  if (before.price !== base.price) {
    await db.insert(t.priceChanges).values({
      vehicleId: id,
      oldPrice: before.price,
      newPrice: base.price,
      reason: 'Edited on vehicle record',
      changedBy: me.name,
    });
    await feedPriceChange(after, {
      oldPrice: before.price,
      newPrice: base.price,
      reason: 'Edited on the vehicle record',
      actorId: me.id,
    });
  }

  /* ---- lifecycle posts. Each transition is a real event, so each posts. ---- */

  if (base.status === 'IN_RECON' && before.status !== 'IN_RECON') {
    await feedReconIn(after, me.id);
  }

  if (before.status === 'IN_RECON' && base.status !== 'IN_RECON') {
    const reconDays = Math.max(
      0,
      Math.round((Date.now() - new Date(before.acquiredDate).getTime()) / 86_400_000),
    );
    await feedReconOut(after, reconDays, me.id);
  }

  if (goingFrontLine) {
    await feedFrontLine(after, {
      reconDays: daysInStock({ ...before, soldDate: null }),
      photoCount: await photoCountFor(id),
      channelCount: await connectedChannelCount(before.rooftopId),
      actorId: me.id,
    });
  }

  if (goingSold) {
    const daysToSell = Math.max(
      0,
      Math.round((soldAt!.getTime() - new Date(before.acquiredDate).getTime()) / 86_400_000),
    );
    const soldPrice = base.price;
    const frontGross = soldPrice - totalCost(after);

    // A sale is the one lifecycle change with a second table behind it. Without
    // this row the unit vanishes from reporting instead of turning into gross.
    await db
      .insert(t.sales)
      .values({
        vehicleId: id,
        rooftopId: before.rooftopId,
        soldDate: soldAt!,
        soldPrice,
        cost: base.cost,
        pack: base.pack,
        reconCost: base.reconCost,
        frontGross,
        daysToSell,
      })
      .onConflictDoNothing({ target: t.sales.vehicleId });

    await feedSold(after, { soldPrice, frontGross, daysToSell, actorId: me.id });
  }

  if (Object.keys(changes).length) {
    await enqueueChange(
      id,
      before.price !== base.price ? 'UPDATE_PRICE' : 'UPDATE_DETAILS',
      changes,
      `Updated ${Object.keys(changes).join(', ')}`,
    );
  }

  refreshAll(id);
}

export async function markFrontLineReady(formData: FormData) {
  const id = String(formData.get('vehicleId'));
  const me = await requireSession();
  const before = await loadWritableVehicle(id);
  if (!before) return;

  const now = new Date();
  await db
    .update(t.vehicles)
    .set({ status: 'FRONT_LINE_READY', frontLineDate: now, updatedAt: now })
    .where(eq(t.vehicles.id, id));

  if (before.status === 'IN_RECON') {
    await feedReconOut(before, daysInStock({ ...before, soldDate: null }), me.id);
  }
  await feedFrontLine(
    { ...before, status: 'FRONT_LINE_READY', frontLineDate: now },
    {
      reconDays: daysInStock({ ...before, soldDate: null }),
      photoCount: await photoCountFor(id),
      channelCount: await connectedChannelCount(before.rooftopId),
      actorId: me.id,
    },
  );

  await enqueueChange(id, 'CREATE', { status: { from: 'recon', to: 'front line' } }, 'Marked front-line ready — listing everywhere');
  refreshAll(id);
}

/* ------------------------------------------------------------- transfers */

/**
 * Lot-to-lot moves. These are thin on purpose: every guard, every write and
 * both feed cards live in `src/lib/transfers.ts`, which takes a `Scope` it
 * cannot be called without and is driven directly by the isolation test. All
 * this layer does is turn a session into a scope and a FormData into arguments.
 */

/**
 * Send a unit to another lot.
 *
 * A refusal here is not an exceptional condition — it is somebody picking the
 * lot the car is already on, or double-submitting a form. Every other action in
 * this file answers that with a bare `return`, which is fine when the form is a
 * price field and the value simply does not change. It is not fine here: the
 * dealer clicks "Start the move" and the page comes back looking identical.
 * So the reason rides back on the query string and the page renders it.
 */
export async function startTransfer(formData: FormData) {
  const vehicleId = String(formData.get('vehicleId') ?? '');
  const me = await requireSession();
  const scope = await sessionScope();
  const result = await startTransferCore(scope, {
    vehicleId,
    toRooftopId: String(formData.get('toRooftopId') ?? ''),
    note: String(formData.get('note') ?? ''),
    actorId: me.id,
    // "It's already there" — the porter drove it over before opening the app.
    arriveNow: formData.get('arriveNow') === 'on',
  });

  refreshAll(vehicleId);
  if (!result.ok && vehicleId) {
    redirect(`/admin/inventory/${vehicleId}?move=${result.reason}`);
  }
}

export async function markTransferArrived(formData: FormData) {
  const me = await requireSession();
  const scope = await sessionScope();
  const result = await markTransferArrivedCore(scope, {
    transferId: String(formData.get('transferId') ?? ''),
    actorId: me.id,
  });
  if (!result.ok) return;

  // The unit's address changed, and the address is listing data. The sync rows
  // themselves still hang off the *origin* rooftop's connections — re-pointing
  // those is its own task, noted in `claude/lot-walk.md`.
  await enqueueChange(
    result.transfer.vehicleId,
    'UPDATE_DETAILS',
    { rooftopId: { from: result.transfer.fromRooftopId, to: result.transfer.toRooftopId } },
    'Unit moved to another lot — location updated on every live listing',
  );
  refreshAll(result.transfer.vehicleId);
}

export async function cancelTransfer(formData: FormData) {
  const me = await requireSession();
  const scope = await sessionScope();
  const result = await cancelTransferCore(scope, {
    transferId: String(formData.get('transferId') ?? ''),
    actorId: me.id,
  });
  if (result.ok) refreshAll(result.transfer.vehicleId);
}

/* ----------------------------------------------------------- photo mgmt */

export async function reorderPhoto(formData: FormData) {
  const photoId = String(formData.get('photoId'));
  const dir = String(formData.get('dir')) as 'up' | 'down';
  const photo = (
    await db.select().from(t.vehiclePhotos).where(eq(t.vehiclePhotos.id, photoId)).limit(1)
  )[0];
  if (!photo) return;
  if (!(await loadWritableVehicle(photo.vehicleId))) return;

  const siblings = await db
    .select()
    .from(t.vehiclePhotos)
    .where(eq(t.vehiclePhotos.vehicleId, photo.vehicleId))
    .orderBy(t.vehiclePhotos.sortOrder);

  const i = siblings.findIndex((p) => p.id === photoId);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= siblings.length) return;

  await db.update(t.vehiclePhotos).set({ sortOrder: siblings[j]!.sortOrder }).where(eq(t.vehiclePhotos.id, siblings[i]!.id));
  await db.update(t.vehiclePhotos).set({ sortOrder: siblings[i]!.sortOrder }).where(eq(t.vehiclePhotos.id, siblings[j]!.id));

  await enqueueChange(photo.vehicleId, 'UPDATE_PHOTOS', {}, 'Photo order changed');
  refreshAll(photo.vehicleId);
}

export async function setPrimaryPhoto(formData: FormData) {
  const photoId = String(formData.get('photoId'));
  const photo = (
    await db.select().from(t.vehiclePhotos).where(eq(t.vehiclePhotos.id, photoId)).limit(1)
  )[0];
  if (!photo) return;
  if (!(await loadWritableVehicle(photo.vehicleId))) return;
  await db
    .update(t.vehiclePhotos)
    .set({ isPrimary: false })
    .where(eq(t.vehiclePhotos.vehicleId, photo.vehicleId));
  await db.update(t.vehiclePhotos).set({ isPrimary: true }).where(eq(t.vehiclePhotos.id, photoId));
  await enqueueChange(photo.vehicleId, 'UPDATE_PHOTOS', {}, 'Lead photo changed');
  refreshAll(photo.vehicleId);
}

export async function deletePhoto(formData: FormData) {
  const photoId = String(formData.get('photoId'));
  const photo = (
    await db.select().from(t.vehiclePhotos).where(eq(t.vehiclePhotos.id, photoId)).limit(1)
  )[0];
  if (!photo) return;
  if (!(await loadWritableVehicle(photo.vehicleId))) return;
  await db.delete(t.vehiclePhotos).where(eq(t.vehiclePhotos.id, photoId));
  if (photo.isPrimary) {
    const next = (
      await db
        .select()
        .from(t.vehiclePhotos)
        .where(eq(t.vehiclePhotos.vehicleId, photo.vehicleId))
        .orderBy(t.vehiclePhotos.sortOrder)
        .limit(1)
    )[0];
    if (next) {
      await db.update(t.vehiclePhotos).set({ isPrimary: true }).where(eq(t.vehiclePhotos.id, next.id));
    }
  }
  await enqueueChange(photo.vehicleId, 'UPDATE_PHOTOS', {}, 'Photo removed');
  refreshAll(photo.vehicleId);
}

export async function addPhoto(formData: FormData) {
  const vehicleId = String(formData.get('vehicleId'));
  const scene = String(formData.get('scene') || 'EXTERIOR_SIDE');
  const me = await requireSession();
  const v = await loadWritableVehicle(vehicleId);
  if (!v) return;
  const maxRow = await db
    .select({ m: sql<number>`coalesce(max(${t.vehiclePhotos.sortOrder}), -1)::int` })
    .from(t.vehiclePhotos)
    .where(eq(t.vehiclePhotos.vehicleId, vehicleId));
  const next = (maxRow[0]?.m ?? -1) + 1;
  const count = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(t.vehiclePhotos)
    .where(eq(t.vehiclePhotos.vehicleId, vehicleId));

  const photoLabel = await dealerLabelForRooftop(v.rooftopId);
  await db.insert(t.vehiclePhotos).values({
    vehicleId,
    url: generatedPhotoUrl({
      scene: scene as (typeof PHOTO_SET)[number],
      body: v.bodyStyle,
      hex: v.exteriorColorHex,
      label: photoLabel,
      sublabel: `STK ${v.stockNumber}`,
      mileage: v.mileage,
    }),
    sortOrder: next,
    isPrimary: (count[0]?.c ?? 0) === 0,
    tag: scene as typeof t.photoTagEnum.enumValues[number],
    alt: `${v.year} ${v.make} ${v.model}`,
  });
  // Only the counts a channel actually cares about get a card. Every single
  // photo upload posting would be exactly the activity theater section 2 warns
  // about.
  const nowCount = (count[0]?.c ?? 0) + 1;
  if (PHOTO_GATES.includes(nowCount)) await feedPhotos(v, nowCount, me.id);

  await enqueueChange(vehicleId, 'UPDATE_PHOTOS', {}, 'Photo added');
  refreshAll(vehicleId);
}

/* --------------------------------------------------------- merchandising */

export async function saveOverride(formData: FormData) {
  const vehicleId = String(formData.get('vehicleId'));
  const channelId = String(formData.get('channelId'));
  const titleOverride = String(formData.get('titleOverride') ?? '').trim() || null;
  const descriptionOverride = String(formData.get('descriptionOverride') ?? '').trim() || null;
  const priceRaw = String(formData.get('priceOverride') ?? '').replace(/[^0-9]/g, '');
  const priceOverride = priceRaw ? Number(priceRaw) : null;
  if (!(await loadWritableVehicle(vehicleId))) return;

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
      .set({ titleOverride, descriptionOverride, priceOverride })
      .where(eq(t.vehicleChannelOverrides.id, existing.id));
  } else {
    await db
      .insert(t.vehicleChannelOverrides)
      .values({ vehicleId, channelId, titleOverride, descriptionOverride, priceOverride, excluded: false });
  }

  await enqueueChange(vehicleId, 'UPDATE_DETAILS', {}, 'Channel-specific listing copy updated');
  refreshAll(vehicleId);
}

export async function toggleChannel(formData: FormData) {
  const vehicleId = String(formData.get('vehicleId'));
  const channelId = String(formData.get('channelId'));
  const excluded = formData.get('excluded') === 'true';
  if (!(await loadWritableVehicle(vehicleId))) return;
  await setChannelExclusion(vehicleId, channelId, excluded);
  refreshAll(vehicleId);
}

/* ------------------------------------------------------------ syndication */

export async function forceRefresh(formData: FormData) {
  await forceFeedRefresh(String(formData.get('connectionId')));
  refreshAll();
}

export async function retryListing(formData: FormData) {
  await retrySync(String(formData.get('syncStateId')));
  refreshAll();
}

export async function repairConnection(formData: FormData) {
  await reconnectChannel(String(formData.get('connectionId')));
  refreshAll();
}

export async function tickSyncs() {
  const r = await advanceDueSyncs();
  if (r.landed) refreshAll();
  return r;
}

/* -------------------------------------------------------------- demo aid */

/** Resets the demo's price edits without a full reseed. */
export async function resetDemoPrices() {
  const me = await requireSession();
  const scope = await sessionScope();
  const changes = await db
    .select({
      vehicleId: t.priceChanges.vehicleId,
      oldPrice: t.priceChanges.oldPrice,
      changedAt: t.priceChanges.changedAt,
    })
    .from(t.priceChanges)
    .innerJoin(t.vehicles, eq(t.priceChanges.vehicleId, t.vehicles.id))
    .where(
      and(
        eq(t.priceChanges.changedBy, me.name),
        inArray(t.vehicles.rooftopId, scope.rooftopIds),
      ),
    )
    .orderBy(desc(t.priceChanges.changedAt));
  for (const c of changes) {
    await db
      .update(t.vehicles)
      .set({ price: c.oldPrice, salePrice: null })
      .where(eq(t.vehicles.id, c.vehicleId));
  }
  refreshAll();
}
