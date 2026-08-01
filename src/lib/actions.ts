'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, desc, sql } from 'drizzle-orm';
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

  const vehicle = (
    await db.select().from(t.vehicles).where(eq(t.vehicles.id, vehicleId)).limit(1)
  )[0];
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
    changedBy: 'Dave Okafor',
  });

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
    // new unit
    const rooftopId = str('rooftopId');
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
    await db.insert(t.vehiclePhotos).values(
      PHOTO_SET.map((scene, n) => ({
        vehicleId: v.id,
        url: generatedPhotoUrl({
          scene,
          body: v.bodyStyle,
          hex: v.exteriorColorHex,
          label: 'Evergreen Motors',
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

    await enqueueChange(v.id, 'CREATE', {}, `New unit added — ${v.year} ${v.make} ${v.model}`);
    refreshAll(v.id);
    redirect(`/admin/inventory/${v.id}`);
  }

  const before = (
    await db.select().from(t.vehicles).where(eq(t.vehicles.id, id)).limit(1)
  )[0];
  if (!before) return;

  const goingFrontLine =
    base.status === 'FRONT_LINE_READY' && before.status !== 'FRONT_LINE_READY';

  await db
    .update(t.vehicles)
    .set({
      ...base,
      frontLineDate: goingFrontLine ? new Date() : before.frontLineDate,
    })
    .where(eq(t.vehicles.id, id));

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
      changedBy: 'Dave Okafor',
    });
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
  await db
    .update(t.vehicles)
    .set({ status: 'FRONT_LINE_READY', frontLineDate: new Date(), updatedAt: new Date() })
    .where(eq(t.vehicles.id, id));
  await enqueueChange(id, 'CREATE', { status: { from: 'recon', to: 'front line' } }, 'Marked front-line ready — listing everywhere');
  refreshAll(id);
}

/* ----------------------------------------------------------- photo mgmt */

export async function reorderPhoto(formData: FormData) {
  const photoId = String(formData.get('photoId'));
  const dir = String(formData.get('dir')) as 'up' | 'down';
  const photo = (
    await db.select().from(t.vehiclePhotos).where(eq(t.vehiclePhotos.id, photoId)).limit(1)
  )[0];
  if (!photo) return;

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
  const v = (await db.select().from(t.vehicles).where(eq(t.vehicles.id, vehicleId)).limit(1))[0];
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

  await db.insert(t.vehiclePhotos).values({
    vehicleId,
    url: generatedPhotoUrl({
      scene: scene as (typeof PHOTO_SET)[number],
      body: v.bodyStyle,
      hex: v.exteriorColorHex,
      label: 'Evergreen Motors',
      sublabel: `STK ${v.stockNumber}`,
      mileage: v.mileage,
    }),
    sortOrder: next,
    isPrimary: (count[0]?.c ?? 0) === 0,
    tag: scene as typeof t.photoTagEnum.enumValues[number],
    alt: `${v.year} ${v.make} ${v.model}`,
  });
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
  const changes = await db
    .select()
    .from(t.priceChanges)
    .where(eq(t.priceChanges.changedBy, 'Dave Okafor'))
    .orderBy(desc(t.priceChanges.changedAt));
  for (const c of changes) {
    await db
      .update(t.vehicles)
      .set({ price: c.oldPrice, salePrice: null })
      .where(eq(t.vehicles.id, c.vehicleId));
  }
  refreshAll();
}
