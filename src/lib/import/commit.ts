import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { hexForColor } from '@/lib/intake/parse';
import { assertRooftopInScope, type Scope } from '@/lib/scoped-db';
import { reconcileRooftopSync } from '@/lib/sync-states';
import type { ImportPlan, PlannedRow, VehicleDraft } from './plan';

/**
 * Writing an import plan to the database.
 *
 * The only file in `src/lib/import/` that touches Postgres. Everything that
 * decides *what* should happen is pure and next door; this decides nothing and
 * writes what it is handed.
 *
 * TWO RULES, AND THE SECOND ONE IS THE WHOLE DESIGN.
 *
 * **1. Scoped.** Takes a `Scope`, checks the rooftop belongs to it, and refuses
 * otherwise. An importer is an unusually attractive way to write rows into
 * somebody else's tenant, since the rooftop id arrives from a form.
 *
 * **2. An update never overwrites something a human wrote.**
 *
 * A nightly file is a snapshot of the dealer's *old* system. If it wins every
 * field every night, then every description a dealer rewrites in Rooftop, every
 * photo they reshoot, every trim they correct, is silently reverted before they
 * wake up — and they will not report it as a bug, they will just stop editing
 * anything and conclude the product does not save. So:
 *
 *   - **Price and mileage always update.** They are why the file arrives daily,
 *     and they are the two fields nobody hand-maintains.
 *   - **Everything else fills blanks only.** If our column is empty, the file
 *     supplies it. If it holds anything at all, the file is ignored.
 *   - **Photos are added only to a vehicle that has none.** Re-importing must
 *     not churn a set somebody curated, and it must not silently double it.
 *
 * The cost is that a genuine correction upstream — a price typo fixed, a trim
 * relabelled — does not propagate once we hold a value. That is the right way
 * round: a stale field is visible and fixable, an overwritten one is neither.
 */

export type CommitResult = {
  created: number;
  updated: number;
  skipped: number;
  photosAdded: number;
  /** Vehicle-times-channel rows opened so the syndication grid can see them. */
  syncStatesOpened: number;
  /** VINs that failed to write, with the reason. Never throws for one bad row. */
  failed: { vin: string; error: string }[];
};

/** The columns a file may fill in when ours is empty. */
function fillable(draft: VehicleDraft) {
  return {
    trim: draft.trim,
    engine: draft.engine,
    exteriorColor: draft.exteriorColor,
    interiorColor: draft.interiorColor,
    description: draft.description,
  };
}

function insertValues(draft: VehicleDraft, rooftopId: string, now: Date) {
  return {
    rooftopId,
    vin: draft.vin,
    stockNumber: draft.stockNumber,
    year: draft.year,
    make: draft.make,
    model: draft.model,
    trim: draft.trim,
    bodyStyle: draft.bodyStyle,
    ...(draft.doors != null ? { doors: draft.doors } : {}),
    engine: draft.engine,
    cylinders: draft.cylinders ?? null,
    ...(draft.transmission ? { transmission: draft.transmission } : {}),
    ...(draft.drivetrain ? { drivetrain: draft.drivetrain } : {}),
    ...(draft.fuelType ? { fuelType: draft.fuelType } : {}),
    exteriorColor: draft.exteriorColor,
    exteriorColorHex: hexForColor(draft.exteriorColor) ?? '#9ca3af',
    interiorColor: draft.interiorColor,
    mileage: draft.mileage,
    price: draft.price,
    salePrice: draft.salePrice ?? null,
    msrp: draft.msrp ?? null,
    description: draft.description,
    options: draft.options,
    /**
     * PHOTOS_PENDING, not ARRIVED.
     *
     * `isSyndicatable()` lets PHOTOS_PENDING, FRONT_LINE_READY and PENDING_SALE
     * out to marketplaces. An imported lot is already for sale somewhere else —
     * that is the entire reason we have the file — so landing it in ARRIVED
     * would import a live lot into a state that syndicates nothing, and the
     * dealer would have to touch all twenty-one to fix it. FRONT_LINE_READY
     * would be a claim about recon and merchandising that nobody made.
     */
    status: 'PHOTOS_PENDING' as const,
    // Nothing in a syndication export says when the dealer bought the car, and
    // inventing a date would put fake numbers on the aging report.
    acquiredDate: now,
    updatedAt: now,
  };
}

async function addPhotos(vehicleId: string, urls: string[]): Promise<number> {
  if (!urls.length) return 0;
  await db.insert(t.vehiclePhotos).values(
    urls.map((url, i) => ({
      vehicleId,
      url,
      sortOrder: i,
      isPrimary: i === 0,
      alt: '',
    })),
  );
  return urls.length;
}

export async function commitImport(
  scope: Scope,
  rooftopId: string,
  plan: ImportPlan,
): Promise<CommitResult> {
  const rooftop = await assertRooftopInScope(scope, rooftopId);
  if (!rooftop) {
    // Same shape as a missing rooftop on purpose — a caller outside the tenant
    // learns nothing about whether the id exists.
    throw new Error('Rooftop not found.');
  }

  const now = new Date();
  const result: CommitResult = {
    created: 0, updated: 0, skipped: 0, photosAdded: 0, syncStatesOpened: 0, failed: [],
  };

  const importable = plan.rows.filter((r): r is PlannedRow & { draft: VehicleDraft } =>
    r.draft !== null && r.action !== 'skip');
  result.skipped = plan.rows.length - importable.length;

  // One lookup for the whole batch rather than a query per row.
  const vins = importable.map((r) => r.draft.vin);
  const existing = vins.length
    ? await db
        .select({
          id: t.vehicles.id,
          vin: t.vehicles.vin,
          rooftopId: t.vehicles.rooftopId,
          trim: t.vehicles.trim,
          engine: t.vehicles.engine,
          exteriorColor: t.vehicles.exteriorColor,
          interiorColor: t.vehicles.interiorColor,
          description: t.vehicles.description,
        })
        .from(t.vehicles)
        .where(inArray(t.vehicles.vin, vins))
    : [];
  const byVin = new Map(existing.map((v) => [v.vin, v]));

  const withPhotos = new Set(
    existing.length
      ? (
          await db
            .select({ vehicleId: t.vehiclePhotos.vehicleId })
            .from(t.vehiclePhotos)
            .where(inArray(t.vehiclePhotos.vehicleId, existing.map((v) => v.id)))
        ).map((p) => p.vehicleId)
      : [],
  );

  for (const row of importable) {
    const draft = row.draft;
    try {
      const prior = byVin.get(draft.vin);

      if (!prior) {
        const [inserted] = await db
          .insert(t.vehicles)
          .values(insertValues(draft, rooftopId, now))
          .returning({ id: t.vehicles.id });
        if (inserted) {
          result.photosAdded += await addPhotos(inserted.id, draft.photoUrls);
          result.created += 1;
        }
        continue;
      }

      /**
       * `vehicles.vin` is unique across the whole table, not per rooftop, so a
       * VIN already held by a DIFFERENT tenant cannot be written here and must
       * not be reported as an update either. Rare and real: two dealers list the
       * same car after a wholesale trade, and one file still carries it.
       */
      if (prior.rooftopId !== rooftopId) {
        result.failed.push({
          vin: draft.vin,
          error: 'This VIN already belongs to another rooftop.',
        });
        continue;
      }

      const patch: Record<string, unknown> = {
        price: draft.price,
        mileage: draft.mileage,
        updatedAt: now,
      };
      for (const [key, value] of Object.entries(fillable(draft))) {
        const held = prior[key as keyof typeof prior];
        if (value && (held === null || held === undefined || held === '')) patch[key] = value;
      }

      await db.update(t.vehicles).set(patch).where(eq(t.vehicles.id, prior.id));
      if (!withPhotos.has(prior.id)) {
        result.photosAdded += await addPhotos(prior.id, draft.photoUrls);
      }
      result.updated += 1;
    } catch (e) {
      // One malformed row must not cost the other twenty.
      result.failed.push({ vin: draft.vin, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Open a sync row for every vehicle against every channel this lot is
   * connected to. Without this the import succeeds, the vehicles are on the
   * dealer's own storefront, and `/admin/syndication` shows zero on every
   * channel — because the grid is built from `vehicle_sync_states` and there
   * are none. See the comment on `openMissingSyncStates`.
   */
  result.syncStatesOpened = (await reconcileRooftopSync(rooftopId)).opened;

  return result;
}
