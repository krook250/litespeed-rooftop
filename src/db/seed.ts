/**
 * Seeds the Rooftop Demo Motors demo dealer.
 * Idempotent: wipes and rebuilds every table. `npm run db:seed`
 */

import 'dotenv/config';
import { desc, inArray, sql } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import { SEED_CHANNELS, SEED_VEHICLES, SOLD_POOL, type SeedVehicle } from './seed-data';
import { buildVin } from '@/lib/vin';
import { carriesListings } from '@/lib/domain';
import { PHOTO_SET, generatedPhotoUrl } from '@/lib/photo-svg';
import { auth } from '@/lib/auth-config';
import { assertSafeToWipe } from './guard';
import { backfillFeed } from './backfill-feed';

/** Sign-in for the seeded demo dealership. Printed at the end of a seed run. */
export const DEMO_LOGIN = { email: 'dave@rooftopauto.com', password: 'lotwalk2026' };

/* deterministic RNG so every reseed produces the same demo */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260801);
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
const between = (lo: number, hi: number) => Math.floor(lo + rnd() * (hi - lo + 1));

const NOW = new Date('2026-08-01T17:00:00Z');
const day = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * day);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // Refuses to wipe anything that is not a local database. See src/db/guard.ts.
  assertSafeToWipe('db:seed');

  console.log('clearing…');
  await db.delete(t.feedComments);
  await db.delete(t.feedReactions);
  await db.delete(t.feedEvents);
  await db.delete(t.leads);
  await db.delete(t.vehicleDailyStats);
  await db.delete(t.syncEvents);
  await db.delete(t.vehicleSyncStates);
  await db.delete(t.vehicleChannelOverrides);
  await db.delete(t.priceChanges);
  await db.delete(t.vehiclePhotos);
  await db.delete(t.sales);
  await db.delete(t.vehicles);
  await db.delete(t.channelConnections);
  await db.delete(t.channels);
  await db.delete(t.storefrontRooftops);
  await db.delete(t.storefronts);
  await db.delete(t.sessions);
  await db.delete(t.accounts);
  await db.delete(t.users);
  await db.delete(t.rooftops);
  await db.delete(t.dealerGroups);

  /* ------------------------------------------------------------- tenancy */
  const [group] = await db
    .insert(t.dealerGroups)
    .values({ name: 'Rooftop Demo Motors Group', slug: 'rooftop-demo' })
    .returning();

  const [vanRooftop, bgRooftop] = await db
    .insert(t.rooftops)
    .values([
      {
        groupId: group!.id,
        name: 'Rooftop Demo Motors — Vancouver',
        slug: 'rooftop-demo-vancouver',
        addressLine1: '8215 NE Highway 99',
        city: 'Vancouver', state: 'WA', postalCode: '98665',
        phone: '(360) 555-0142', email: 'sales@rooftopauto.com',
        // Meta's vehicle feed marks latitude/longitude required on every item,
        // so the demo lot has to carry real ones or its whole inventory is
        // ineligible — see `src/lib/meta/feed-spec.ts`.
        latitude: 45.687_2, longitude: -122.660_3,
      },
      {
        groupId: group!.id,
        name: 'Rooftop Demo Motors — Battle Ground',
        slug: 'rooftop-demo-battle-ground',
        addressLine1: '1104 W Main St',
        city: 'Battle Ground', state: 'WA', postalCode: '98604',
        phone: '(360) 555-0177', email: 'bg@rooftopauto.com',
        latitude: 45.780_9, longitude: -122.545_1,
      },
    ])
    .returning();

  const [vanStore, bgStore] = await db
    .insert(t.storefronts)
    .values([
      {
        groupId: group!.id,
        name: 'Rooftop Demo Motors Vancouver',
        slug: 'vancouver',
        domain: 'demo.rooftopauto.com',
        tagline: 'Straight pricing on clean Northwest cars since 2009.',
        phone: '(360) 555-0142',
        addressLine: '8215 NE Highway 99, Vancouver, WA 98665',
        hoursNote: 'Mon–Sat 9a–7p · Sun 10a–5p',
        brandColor: '#166534',
        accentColor: '#ea580c',
      },
      {
        groupId: group!.id,
        name: 'Rooftop Demo Motors Battle Ground',
        slug: 'battle-ground',
        domain: 'demo-bg.rooftopauto.com',
        tagline: 'Trucks, wagons and the occasional minivan. No games.',
        phone: '(360) 555-0177',
        addressLine: '1104 W Main St, Battle Ground, WA 98604',
        hoursNote: 'Mon–Sat 9a–6p · Closed Sunday',
        brandColor: '#1e3a8a',
        accentColor: '#f59e0b',
      },
    ])
    .returning();

  await db.insert(t.storefrontRooftops).values([
    { storefrontId: vanStore!.id, rooftopId: vanRooftop!.id },
    { storefrontId: bgStore!.id, rooftopId: bgRooftop!.id },
  ]);

  // The demo owner gets real credentials so the seeded dealership can actually
  // be signed into. Hashed with Better Auth's own hasher, so it verifies on
  // login exactly like a self-service signup would.
  const [demoUser] = await db
    .insert(t.users)
    .values({
      groupId: group!.id,
      email: DEMO_LOGIN.email,
      name: 'Dave Okafor',
      role: 'OWNER',
    })
    .returning();

  const authCtx = await auth.$context;
  await db.insert(t.accounts).values({
    userId: demoUser!.id,
    accountId: demoUser!.id,
    providerId: 'credential',
    password: await authCtx.password.hash(DEMO_LOGIN.password),
  });

  // The rest of the lot. No credentials — they are staff records, not logins,
  // which is exactly what an independent's roster looks like on day one. They
  // exist so Lot Walk has humans to attribute comments to: the system is the
  // primary author, but a feed nobody replies to is a log file.
  const staff = await db
    .insert(t.users)
    .values([
      { groupId: group!.id, email: 'mike@rooftopauto.com', name: 'Mike Ruiz', role: 'SALES' as const },
      { groupId: group!.id, email: 'tina@rooftopauto.com', name: 'Tina Alvarez', role: 'SALES' as const },
      { groupId: group!.id, email: 'rob@rooftopauto.com', name: 'Rob Chen', role: 'LOT_PORTER' as const },
      { groupId: group!.id, email: 'tim@rooftopauto.com', name: 'Tim Boyd', role: 'SALES' as const },
    ])
    .returning();
  const [mike, tina, rob, tim] = staff;

  /* ------------------------------------------------------------ channels */
  const channels = await db.insert(t.channels).values(SEED_CHANNELS).returning();
  const byKey = Object.fromEntries(channels.map((c) => [c.key, c]));

  const connRows: (typeof t.channelConnections.$inferInsert)[] = [];
  const acct = (key: string, lot: 'VAN' | 'BG') => {
    const n = lot === 'VAN' ? '4821' : '7702';
    switch (key) {
      case 'dealer_site': return lot === 'VAN' ? 'demo.rooftopauto.com' : 'demo-bg.rooftopauto.com';
      case 'meta_catalog': return `Catalog #10${n}9 · Rooftop Demo Motors`;
      case 'google_vla': return `Merchant Center 5${n}31`;
      case 'fb_marketplace': return `Page: Rooftop Demo Motors ${lot === 'VAN' ? 'Vancouver' : 'Battle Ground'}`;
      case 'cargurus': return `Dealer ID CG-${n}`;
      case 'cars_com': return `Account ${n}-A`;
      case 'autotrader': return `Cox Dealer ${n}`;
      case 'craigslist': return 'portland.craigslist.org · dealer';
      default: return `Store ${n}`;
    }
  };

  for (const ch of channels) {
    for (const [rooftop, lot] of [[vanRooftop!, 'VAN'], [bgRooftop!, 'BG']] as const) {
      let status: 'CONNECTED' | 'PENDING_SETUP' | 'DISCONNECTED' | 'ERROR' = 'CONNECTED';
      let errorMessage: string | null = null;
      let lastSyncAt: Date | null = daysAgo(0);

      // Realistic account problems — a syndication tool that never shows a
      // broken connection is a syndication tool nobody believes.
      if (lot === 'VAN' && ch.key === 'cargurus') {
        status = 'ERROR';
        errorMessage = 'Feed credentials rejected (401). Listings are still live but changes have not flowed since Jul 30.';
        lastSyncAt = daysAgo(2);
      }
      if (lot === 'BG' && ch.key === 'cars_com') {
        status = 'DISCONNECTED';
        lastSyncAt = null;
      }
      if (lot === 'BG' && ch.key === 'autotrader') {
        status = 'PENDING_SETUP';
        errorMessage = 'Waiting on Cox dealer ID confirmation.';
        lastSyncAt = null;
      }

      connRows.push({
        rooftopId: rooftop.id,
        channelId: ch.id,
        status,
        accountLabel: acct(ch.key, lot),
        feedUrl:
          ch.syncMode === 'FEED_PULL'
            ? `https://feeds.rooftopauto.com/${rooftop.slug}/${ch.key}.xml`
            : null,
        lastSyncAt,
        nextSyncAt:
          ch.syncMode === 'FEED_PULL' && status === 'CONNECTED'
            ? new Date(NOW.getTime() + ch.cadenceMinutes * 60_000 * (0.2 + rnd() * 0.7))
            : null,
        errorMessage,
      });
    }
  }
  const connections = await db.insert(t.channelConnections).values(connRows).returning();
  const connFor = (rooftopId: string, channelId: string) =>
    connections.find((c) => c.rooftopId === rooftopId && c.channelId === channelId)!;

  /* ------------------------------------------------------ live inventory */
  console.log('seeding inventory…');
  const stockSeq = { VAN: 4800, BG: 7700 };

  const vehicleRows: (typeof t.vehicles.$inferInsert)[] = [];
  const stockByIndex: string[] = [];

  SEED_VEHICLES.forEach((v: SeedVehicle, i) => {
    const rooftopId = v.lot === 'VAN' ? vanRooftop!.id : bgRooftop!.id;
    const stock = `${v.lot === 'VAN' ? 'E' : 'B'}${(stockSeq[v.lot] += 3)}`;
    stockByIndex[i] = stock;
    const acquired = daysAgo(v.dis);
    vehicleRows.push({
      rooftopId,
      vin: buildVin(v.make, v.year, stock),
      stockNumber: stock,
      year: v.year, make: v.make, model: v.model, trim: v.trim,
      bodyStyle: v.body, doors: v.doors, engine: v.engine, cylinders: v.cylinders,
      transmission: v.transmission, drivetrain: v.drivetrain, fuelType: v.fuel,
      mpgCity: v.mpg[0], mpgHwy: v.mpg[1],
      exteriorColor: v.ext, exteriorColorHex: v.hex, interiorColor: v.int,
      mileage: v.mileage, titleStatus: 'CLEAN',
      price: v.price, salePrice: v.salePrice ?? null,
      cost: v.cost, pack: v.pack, reconCost: v.recon, marketValue: v.market,
      status: v.status, acquisitionSource: v.source,
      acquiredDate: acquired,
      frontLineDate: v.reconDays == null ? null : daysAgo(v.dis - v.reconDays),
      description: v.description,
      callouts: v.callouts, options: v.options,
      features: v.options.slice(0, 3),
      carfaxOneOwner: v.oneOwner, carfaxNoAccidents: v.noAccidents,
      carfaxUrl: 'https://www.carfax.com/vehicle-history-reports',
      keysCount: rnd() > 0.25 ? 2 : 1,
      createdAt: acquired,
      updatedAt: daysAgo(between(0, 3)),
    });
  });

  const vehicles = await db.insert(t.vehicles).values(vehicleRows).returning();

  /* photos */
  const photoRows: (typeof t.vehiclePhotos.$inferInsert)[] = [];
  vehicles.forEach((veh, i) => {
    const seed = SEED_VEHICLES[i]!;
    const dealerLabel = seed.lot === 'VAN' ? 'Rooftop Demo Motors' : 'Rooftop Demo Motors BG';
    // A unit that is still in recon genuinely has no photo set yet.
    const scenes = veh.status === 'IN_RECON' || veh.status === 'ARRIVED'
      ? PHOTO_SET.slice(0, 1)
      : veh.status === 'PHOTOS_PENDING'
        ? PHOTO_SET.slice(0, 3)
        : PHOTO_SET;
    scenes.forEach((scene, n) => {
      photoRows.push({
        vehicleId: veh.id,
        url: generatedPhotoUrl({
          scene,
          body: veh.bodyStyle,
          hex: veh.exteriorColorHex,
          label: dealerLabel,
          sublabel: `STK ${veh.stockNumber}`,
          mileage: veh.mileage,
        }),
        sortOrder: n,
        isPrimary: n === 0,
        tag: scene,
        alt: `${veh.year} ${veh.make} ${veh.model} ${veh.trim} — ${scene.toLowerCase().replace('_', ' ')}`,
      });
    });
  });
  await db.insert(t.vehiclePhotos).values(photoRows);

  /* price history — only for units that have actually been repriced */
  const priceRows: (typeof t.priceChanges.$inferInsert)[] = [];
  vehicles.forEach((veh, i) => {
    const seed = SEED_VEHICLES[i]!;
    if (seed.salePrice) {
      priceRows.push({
        vehicleId: veh.id,
        oldPrice: seed.price,
        newPrice: seed.salePrice,
        reason: 'Aging — price to market',
        changedBy: 'Dave Okafor',
        changedAt: daysAgo(between(1, 5)),
      });
    }
    if (seed.dis > 45) {
      priceRows.push({
        vehicleId: veh.id,
        oldPrice: seed.price + between(500, 1400),
        newPrice: seed.price,
        reason: 'Aged past 45 days',
        changedBy: 'Dave Okafor',
        changedAt: daysAgo(Math.min(seed.dis - 30, 20)),
      });
    }
  });
  if (priceRows.length) await db.insert(t.priceChanges).values(priceRows);

  /* --------------------------------------------------------- sync states */
  console.log('seeding sync states…');
  const syncRows: (typeof t.vehicleSyncStates.$inferInsert)[] = [];
  const eventRows: (typeof t.syncEvents.$inferInsert)[] = [];
  const overrideRows: (typeof t.vehicleChannelOverrides.$inferInsert)[] = [];

  vehicles.forEach((veh, i) => {
    const seed = SEED_VEHICLES[i]!;
    const waterUnit = veh.cost + veh.pack + veh.reconCost > veh.marketValue;

    for (const ch of channels) {
      const conn = connFor(veh.rooftopId, ch.id);
      let status: typeof t.syncStatusEnum.enumValues[number] = 'LIVE';
      let errorCode: string | null = null;
      let errorMessage: string | null = null;
      let lastSyncedAt: Date | null = daysAgo(0);
      let dueAt: Date | null = null;

      // Not front-line ready = not syndicated. Website shows it, nothing else.
      if (veh.status === 'IN_RECON' || veh.status === 'ARRIVED') {
        status = ch.key === 'dealer_site' ? 'LIVE' : 'NOT_LISTED';
      } else if (veh.status === 'PHOTOS_PENDING' && ch.key !== 'dealer_site') {
        // marketplaces enforce photo minimums
        status = ch.kind === 'MARKETPLACE' || ch.kind === 'CLASSIFIED' ? 'PENDING' : 'LIVE';
        if (status === 'PENDING') {
          dueAt = new Date(NOW.getTime() + between(30, 180) * 60_000);
        }
      }

      if (!carriesListings(conn.status)) {
        status = 'NOT_LISTED';
        lastSyncedAt = null;
      }

      // Water unit: owner pulled it off the paid marketplaces to stop the bleed
      if (waterUnit && (ch.key === 'cars_com' || ch.key === 'autotrader')) {
        status = 'EXCLUDED';
        overrideRows.push({ vehicleId: veh.id, channelId: ch.id, excluded: true });
      }

      // Two believable per-listing failures
      if (status === 'LIVE' && ch.key === 'cars_com' && seed.year === 2014) {
        status = 'ERROR';
        errorCode = 'TRIM_UNMAPPED';
        errorMessage = 'Rejected: trim "LT AWD" not recognized for this year/model. Map the trim to resend.';
      }
      if (status === 'LIVE' && ch.key === 'craigslist' && seed.model === 'Odyssey') {
        status = 'ERROR';
        errorCode = 'DUPLICATE_POST';
        errorMessage = 'Posting flagged: duplicate content across 2 active posts. Rewrite the Craigslist description to repost.';
      }

      // The stale CarGurus connection: listings live, changes not flowing
      if (status === 'LIVE' && conn.status === 'ERROR') {
        lastSyncedAt = daysAgo(2);
      }

      syncRows.push({
        vehicleId: veh.id,
        connectionId: conn.id,
        status,
        remoteId:
          status === 'LIVE' || status === 'ERROR'
            ? `${ch.key.toUpperCase().slice(0, 3)}-${veh.stockNumber}-${between(10000, 99999)}`
            : null,
        remoteUrl: status === 'LIVE' ? `/mock/${ch.key}/${veh.stockNumber}` : null,
        payloadHash: `${veh.price}:${veh.mileage}:${veh.status}`,
        lastSyncedAt,
        lastAttemptAt: lastSyncedAt ?? null,
        pendingSince: status === 'PENDING' ? daysAgo(0) : null,
        dueAt,
        errorCode,
        errorMessage,
      });

      if (status === 'LIVE' || status === 'ERROR') {
        eventRows.push({
          vehicleId: veh.id,
          connectionId: conn.id,
          action: 'CREATE',
          status: status === 'ERROR' ? 'ERROR' : 'LIVE',
          message: status === 'ERROR' ? errorMessage : 'Listing created',
          createdAt: daysAgo(Math.max(0, seed.dis - (seed.reconDays ?? 0))),
          completedAt: daysAgo(Math.max(0, seed.dis - (seed.reconDays ?? 0))),
        });
      }
    }

    // A couple of channel-specific merchandising overrides, because
    // Marketplace copy is not website copy.
    if (i === 2) {
      overrideRows.push({
        vehicleId: veh.id,
        channelId: byKey.fb_marketplace!.id,
        excluded: false,
        titleOverride: '2018 F-150 XLT 4x4 CREW — 5.0 V8, TOW PKG',
        descriptionOverride:
          '2018 F-150 XLT SuperCrew 4x4. 5.0L V8, factory tow package, spray-in liner. 96k miles, clean title, no accidents. Financing available OAC. Text for fastest reply.',
      });
    }
    if (i === 4) {
      overrideRows.push({
        vehicleId: veh.id,
        channelId: byKey.craigslist!.id,
        excluded: false,
        titleOverride: '2017 Toyota Tacoma SR5 Double Cab 4x4 — V6, no lift, clean',
      });
    }
  });

  await db.insert(t.vehicleSyncStates).values(syncRows);
  if (overrideRows.length) await db.insert(t.vehicleChannelOverrides).values(overrideRows);
  if (eventRows.length) await db.insert(t.syncEvents).values(eventRows);

  /* -------------------------------------------- sold history (180 days) */
  console.log('seeding sales history…');
  const soldVehicleRows: (typeof t.vehicles.$inferInsert)[] = [];
  const soldMeta: { daysToSell: number; soldDate: Date; price: number; cost: number; pack: number; recon: number; rooftopId: string }[] = [];

  let soldStock = 3000;
  for (let n = 0; n < 96; n++) {
    const [year, make, model, trim, basePrice] = pick(SOLD_POOL);
    const rooftop = rnd() < 0.68 ? vanRooftop! : bgRooftop!;
    const pack = rooftop.id === vanRooftop!.id ? 795 : 695;
    const recon = between(600, 2400);
    const daysToSell = Math.max(4, Math.round(18 + rnd() * 58 + (rnd() < 0.12 ? 40 : 0)));
    const soldAgo = between(1, 179);
    const soldDate = daysAgo(soldAgo);
    const acquired = daysAgo(soldAgo + daysToSell);
    const soldPrice = basePrice - between(0, 900);

    // Work backwards from a realistic front gross rather than forwards from a
    // guessed cost — an aged unit gives up gross, a fresh one holds it.
    const targetGross =
      daysToSell > 60 ? between(-400, 900)
        : daysToSell > 45 ? between(600, 1700)
          : between(1300, 3100);
    const baseCost = soldPrice - pack - recon - targetGross;
    const stock = `S${(soldStock += 7)}`;

    soldVehicleRows.push({
      rooftopId: rooftop.id,
      vin: buildVin(make, year, stock),
      stockNumber: stock,
      year, make, model, trim,
      bodyStyle: model.includes('F-150') || model.includes('Silverado') || model.includes('Sierra') || model.includes('Tacoma') || model.includes('1500')
        ? 'TRUCK'
        : model.includes('Odyssey') || model.includes('Pacifica')
          ? 'VAN'
          : model.includes('Camry') || model.includes('Civic') || model.includes('Corolla') || model.includes('Accord') || model.includes('Elantra')
            ? 'SEDAN'
            : model.includes('Outback')
              ? 'WAGON'
              : 'SUV',
      doors: 4, engine: '', cylinders: 4,
      transmission: 'AUTOMATIC', drivetrain: 'AWD', fuelType: 'GAS',
      exteriorColor: 'Silver', exteriorColorHex: '#b8bdc4', interiorColor: 'Gray',
      mileage: between(38000, 142000),
      price: basePrice, cost: baseCost, pack, reconCost: recon,
      marketValue: basePrice + between(-400, 700),
      status: 'SOLD',
      acquisitionSource: pick(['AUCTION', 'TRADE_IN', 'STREET_PURCHASE'] as const),
      acquiredDate: acquired,
      frontLineDate: daysAgo(soldAgo + daysToSell - between(4, 9)),
      soldDate,
      createdAt: acquired,
      updatedAt: soldDate,
    });
    soldMeta.push({ daysToSell, soldDate, price: soldPrice, cost: baseCost, pack, recon, rooftopId: rooftop.id });
  }

  const soldVehicles = await db.insert(t.vehicles).values(soldVehicleRows).returning();
  await db.insert(t.sales).values(
    soldVehicles.map((v, i) => {
      const m = soldMeta[i]!;
      return {
        vehicleId: v.id,
        rooftopId: m.rooftopId,
        soldDate: m.soldDate,
        soldPrice: m.price,
        cost: m.cost,
        pack: m.pack,
        reconCost: m.recon,
        frontGross: m.price - m.cost - m.pack - m.recon,
        daysToSell: m.daysToSell,
      };
    }),
  );

  /* ------------------------------------------------- daily stats (45 d) */
  console.log('seeding traffic stats…');
  const share: Record<string, number> = {
    dealer_site: 0.18, cargurus: 0.21, cars_com: 0.13, autotrader: 0.11,
    fb_marketplace: 0.15, meta_catalog: 0.08, google_vla: 0.06,
    craigslist: 0.05, offerup: 0.03,
  };

  const statRows: (typeof t.vehicleDailyStats.$inferInsert)[] = [];
  vehicles.forEach((veh, i) => {
    const seed = SEED_VEHICLES[i]!;
    const priceAppeal = veh.marketValue > 0 ? veh.marketValue / veh.price : 1;
    for (let d = 89; d >= 0; d--) {
      const age = seed.dis - d;
      if (age < 0) continue; // not in stock yet
      // interest decays hard after the first two weeks — the whole reason
      // the at-risk list exists
      const decay = age <= 3 ? 1.55 : age <= 14 ? 1.15 : age <= 30 ? 0.72 : age <= 45 ? 0.48 : 0.3;
      const base = 16 * decay * priceAppeal * (0.7 + rnd() * 0.6);
      for (const ch of channels) {
        const s = share[ch.key] ?? 0.02;
        const views = Math.max(0, Math.round(base * s * (0.6 + rnd() * 0.9)));
        if (views === 0 && rnd() > 0.35) continue;
        statRows.push({
          vehicleId: veh.id,
          channelId: ch.id,
          date: isoDate(daysAgo(d)),
          vdpViews: views,
          srpImpressions: Math.round(views * (7 + rnd() * 9)),
          leads: rnd() < views / 42 ? 1 : 0,
          saves: rnd() < views / 16 ? between(1, 2) : 0,
        });
      }
    }
  });

  // Sold units generated traffic while they were on the ground. Without this the
  // trailing-window comparisons look like the lot appeared out of nowhere.
  soldVehicles.forEach((veh, i) => {
    const m = soldMeta[i]!;
    const soldAgo = Math.round((NOW.getTime() - m.soldDate.getTime()) / day);
    for (let d = Math.min(89, soldAgo + m.daysToSell); d >= soldAgo; d--) {
      const age = m.daysToSell - (d - soldAgo);
      if (age < 0) continue;
      const decay = age <= 3 ? 1.5 : age <= 14 ? 1.1 : age <= 30 ? 0.7 : age <= 45 ? 0.45 : 0.28;
      const base = 15 * decay * (0.7 + rnd() * 0.6);
      for (const ch of channels) {
        const s = share[ch.key] ?? 0.02;
        const views = Math.max(0, Math.round(base * s * (0.6 + rnd() * 0.9)));
        if (views === 0 && rnd() > 0.3) continue;
        statRows.push({
          vehicleId: veh.id,
          channelId: ch.id,
          date: isoDate(daysAgo(d)),
          vdpViews: views,
          srpImpressions: Math.round(views * (7 + rnd() * 9)),
          leads: rnd() < views / 40 ? 1 : 0,
          saves: rnd() < views / 16 ? between(1, 2) : 0,
        });
      }
    }
  });

  for (let i = 0; i < statRows.length; i += 2000) {
    await db.insert(t.vehicleDailyStats).values(statRows.slice(i, i + 2000));
  }

  /* ------------------------------------------------------------ lot walk */
  // Replay the history above into the feed, so the demo dealer's home screen
  // has a month of real activity on it the first time anyone signs in.
  console.log('building the Lot Walk feed…');
  const { created } = await backfillFeed({
    rooftopIds: [vanRooftop!.id, bgRooftop!.id],
    sinceDays: 60,
  });

  // Two human posts, because "the inventory posts, humans comment" still needs
  // a human on the page. These are the only fabricated rows in the feed —
  // everything else came out of a table.
  const [timPost] = await db
    .insert(t.feedEvents)
    .values({
      rooftopId: bgRooftop!.id,
      kind: 'team',
      actorId: demoUser!.id,
      subjectUserId: tim!.id,
      title: 'Meet Tim Boyd — starting Monday at Battle Ground',
      body:
        'Tim comes over from a franchise store with ten years in. Knows trucks cold and has ' +
        'done his own desking. He is on the Battle Ground side but will float. Say hi when you see him.',
      stats: [
        { k: 'Starts', v: 'Monday' },
        { k: 'Rooftop', v: 'Battle Ground' },
        { k: 'Years in', v: '10' },
      ],
      dedupeKey: 'seed:team:tim',
      createdAt: daysAgo(0),
    })
    .returning();

  const [robPost] = await db
    .insert(t.feedEvents)
    .values({
      rooftopId: vanRooftop!.id,
      kind: 'note',
      actorId: rob!.id,
      title: 'Detail bay is down until Thursday — buffer is out for service',
      body:
        'Anything that needs paint correction, flag it on the unit and I will batch them ' +
        'Friday morning. Wash and vac are unaffected.',
      stats: [
        { k: 'Back up', v: 'Thursday' },
        { k: 'Units waiting', v: String(vehicles.filter((v) => v.status === 'IN_RECON').length) },
        { k: 'Recon target', v: '5–7d' },
      ],
      dedupeKey: 'seed:note:detail-bay',
      createdAt: daysAgo(0),
    })
    .returning();

  // Comments and reactions on the newest system cards, so the interaction
  // grammar is visible the moment the page loads.
  // Newest card of each kind, so the scripted replies land on the cards a
  // dealer will actually see rather than on whatever happened to be recent.
  const recent = await db
    .select()
    .from(t.feedEvents)
    .where(inArray(t.feedEvents.rooftopId, [vanRooftop!.id, bgRooftop!.id]))
    .orderBy(desc(t.feedEvents.createdAt));

  const firstOf = (kind: typeof t.feedEventKindEnum.enumValues[number]) =>
    recent.find((e) => e.kind === kind);

  const commentRows: (typeof t.feedComments.$inferInsert)[] = [];
  const reactionRows: (typeof t.feedReactions.$inferInsert)[] = [];
  const say = (event: typeof t.feedEvents.$inferSelect | undefined, userId: string, body: string) => {
    if (event) commentRows.push({ eventId: event.id, userId, body });
  };
  const react = (
    event: typeof t.feedEvents.$inferSelect | undefined,
    userId: string,
    kind: 'THUMB' | 'FIRE',
  ) => {
    if (event) reactionRows.push({ eventId: event.id, userId, kind });
  };

  const sold = firstOf('sold');
  say(sold, demoUser!.id, 'That is the third truck this month. Buy more trucks.');
  say(sold, tina!.id, 'Way to go 👏');
  react(sold, mike!.id, 'THUMB');
  react(sold, tina!.id, 'THUMB');
  react(sold, rob!.id, 'FIRE');

  const atRisk = firstOf('at_risk');
  say(atRisk, demoUser!.id, 'Tina — get me a price recommendation on this one before noon.');
  say(atRisk, tina!.id, 'On it. I think we are $900 over the market on it.');

  const water = firstOf('water');
  say(water, demoUser!.id, 'We are upside down. Run it through the sale Thursday, take the hit and move on.');

  const err = firstOf('sync_error');
  say(err, mike!.id, 'This is the second time this month on that channel.');

  const vdp = firstOf('vdp_milestone');
  say(vdp, tina!.id, 'Two of those leads are the same guy. He is grinding me on the trade.');
  react(vdp, demoUser!.id, 'FIRE');

  const frontLine = firstOf('front_line');
  say(frontLine, mike!.id, 'Already have someone coming to look at this Saturday.');
  react(frontLine, demoUser!.id, 'THUMB');
  react(frontLine, rob!.id, 'THUMB');

  say(timPost, mike!.id, 'Welcome aboard Tim.');
  react(timPost, mike!.id, 'THUMB');
  react(timPost, tina!.id, 'THUMB');
  react(timPost, rob!.id, 'THUMB');
  react(robPost, demoUser!.id, 'THUMB');

  if (commentRows.length) await db.insert(t.feedComments).values(commentRows);
  if (reactionRows.length) {
    await db.insert(t.feedReactions).values(reactionRows).onConflictDoNothing();
  }

  const feedTotal = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(t.feedEvents);

  console.log(
    `feed — ${created} backfilled + 2 human posts = ${feedTotal[0]?.c ?? 0} cards, ` +
    `${commentRows.length} comments, ${reactionRows.length} reactions`,
  );

  console.log(
    `done — ${vehicles.length} live units, ${soldVehicles.length} sold, ` +
    `${channels.length} channels, ${syncRows.length} sync states, ${statRows.length} stat rows`,
  );
  console.log(`\nsign in as  ${DEMO_LOGIN.email}  /  ${DEMO_LOGIN.password}`);
  console.log('or create a fresh empty dealership at /signup\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
