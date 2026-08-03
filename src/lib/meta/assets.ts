/**
 * Rooftop Auto — Meta asset discovery and catalog provisioning.
 *
 * THE PRODUCT QUESTION THIS FILE ANSWERS
 *
 * "Some dealers will have catalogs, some won't. Most of these lots aren't
 * technical — do they have to create one first?" No. We create it for them.
 * `ensureVehicleCatalog` is the whole answer: adopt an existing vehicles catalog
 * if there is one, create it if there isn't, and never make the dealer open
 * Commerce Manager.
 *
 * The shape of the problem is a branch, not a happy path. A lot can arrive with
 * a Page and literally nothing else, and that is the *common* case, not the edge
 * one. So discovery reports what is missing as data rather than throwing, and
 * the connect screen reads that to decide what it still has to ask for. See
 * `claude/meta-ad-desk-build.md` §2 for the branch table.
 *
 * OWNERSHIP: everything we create is created **inside the dealer's business
 * portfolio**, not ours. `POST /{dealer_business_id}/owned_product_catalogs`.
 * The dealer holds title; we hold access. Meta's own on-behalf-of guidance is
 * explicit that the client "continues to be the owner of their business", and
 * commercially it means a dealer who leaves keeps their catalog, pixel history
 * and audiences without needing our sign-off — the exact hostage dynamic they
 * already resent about their incumbent vendors.
 */

import 'server-only';
import {
  MetaApiError,
  graph,
  graphEdge,
  graphEdgeOptional,
  type MetaFailureKind,
} from './graph';

/* --------------------------------------------------------------- the shapes */

export type MetaPage = { id: string; name: string; category?: string };
export type MetaAdAccount = { id: string; account_id?: string; name?: string; account_status?: number; currency?: string };
export type MetaCatalog = { id: string; name?: string; vertical?: string; product_count?: number };
export type MetaPixel = { id: string; name?: string };

export type Discovery = {
  businessId: string | null;
  businessName: string;
  pages: MetaPage[];
  adAccounts: MetaAdAccount[];
  /** Only `vertical: 'vehicles'` catalogs. A commerce catalog cannot run auto ads. */
  vehicleCatalogs: MetaCatalog[];
  /** Catalogs the dealer has that are the wrong vertical — surfaced so support can explain. */
  otherCatalogs: MetaCatalog[];
  pixels: MetaPixel[];
  /**
   * Edges Meta refused. Populated rather than thrown because during App Review
   * we will legitimately be missing `ads_management` while everything else
   * works, and the connect flow has to stay usable in exactly that window — it
   * is what we record the screencast against.
   */
  blocked: Partial<Record<'pages' | 'adAccounts' | 'catalogs' | 'pixels', MetaFailureKind>>;
};

/* ------------------------------------------------------------------ business */

type MeResponse = { id?: string; name?: string; client_business_id?: string };
type BusinessResponse = { id: string; name?: string };

/**
 * Find the dealer's business portfolio.
 *
 * Two paths, because there are two token shapes. A Business Integration System
 * User token — the one we want — answers `client_business_id` directly, and
 * that is authoritative. The user-token fallback has no such field, so we take
 * the first business the person administers.
 *
 * "First" is a real limitation and worth naming: a dealer principal who also
 * administers, say, their brother-in-law's restaurant portfolio could get the
 * wrong one. It is acceptable only because the connect UI shows the business
 * name back to them before anything is provisioned. Do not remove that
 * confirmation step on the assumption this function is smart.
 */
export async function resolveBusiness(token: string): Promise<{ id: string | null; name: string }> {
  const me = await graph<MeResponse>('/me', { token, params: { fields: 'id,name,client_business_id' } });

  if (me.client_business_id) {
    const biz = await graph<BusinessResponse>(`/${me.client_business_id}`, {
      token,
      params: { fields: 'id,name' },
    });
    return { id: biz.id, name: biz.name ?? '' };
  }

  const { items } = await graphEdgeOptional<BusinessResponse>('/me/businesses', {
    token,
    fields: 'id,name',
    limit: 25,
  });
  const first = items[0];
  return first ? { id: first.id, name: first.name ?? '' } : { id: null, name: '' };
}

/* ----------------------------------------------------------------- discovery */

/**
 * Everything the dealer has, in one pass.
 *
 * Both `owned_*` and `client_*` edges for each asset type, because they are
 * genuinely different sets: `owned_` is what the business holds title to,
 * `client_` is what it manages for someone else as an agency. A dealership
 * whose previous marketing vendor set up the ad account may well find it under
 * `client_`, and a flow that only checked `owned_` would tell them they have no
 * ad account while they are looking at it in Business Manager.
 */
export async function discoverAssets(token: string): Promise<Discovery> {
  const business = await resolveBusiness(token);
  const blocked: Discovery['blocked'] = {};

  if (!business.id) {
    return {
      businessId: null,
      businessName: '',
      pages: [],
      adAccounts: [],
      vehicleCatalogs: [],
      otherCatalogs: [],
      pixels: [],
      blocked,
    };
  }

  const b = business.id;
  const opt = <T>(path: string, fields: string) => graphEdgeOptional<T>(path, { token, fields });

  const [ownedPages, clientPages, ownedAcct, clientAcct, ownedCat, clientCat, ownedPx, clientPx] =
    await Promise.all([
      opt<MetaPage>(`/${b}/owned_pages`, 'id,name,category'),
      opt<MetaPage>(`/${b}/client_pages`, 'id,name,category'),
      opt<MetaAdAccount>(`/${b}/owned_ad_accounts`, 'id,account_id,name,account_status,currency'),
      opt<MetaAdAccount>(`/${b}/client_ad_accounts`, 'id,account_id,name,account_status,currency'),
      opt<MetaCatalog>(`/${b}/owned_product_catalogs`, 'id,name,vertical,product_count'),
      opt<MetaCatalog>(`/${b}/client_product_catalogs`, 'id,name,vertical,product_count'),
      opt<MetaPixel>(`/${b}/owned_pixels`, 'id,name'),
      opt<MetaPixel>(`/${b}/client_pixels`, 'id,name'),
    ]);

  if (ownedPages.blocked) blocked.pages = ownedPages.blocked;
  if (ownedAcct.blocked) blocked.adAccounts = ownedAcct.blocked;
  if (ownedCat.blocked) blocked.catalogs = ownedCat.blocked;
  if (ownedPx.blocked) blocked.pixels = ownedPx.blocked;

  const dedupe = <T extends { id: string }>(...lists: T[][]) => {
    const seen = new Map<string, T>();
    for (const list of lists) for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item);
    return [...seen.values()];
  };

  const catalogs = dedupe(ownedCat.items, clientCat.items);

  return {
    businessId: b,
    businessName: business.name,
    pages: dedupe(ownedPages.items, clientPages.items),
    adAccounts: dedupe(ownedAcct.items, clientAcct.items),
    // Case-insensitive: the field comes back lowercase today, but the enum is
    // documented uppercase in places and a silent miss here would mean silently
    // creating a duplicate catalog for a dealer who already had one.
    vehicleCatalogs: catalogs.filter((c) => (c.vertical ?? '').toLowerCase() === 'vehicles'),
    otherCatalogs: catalogs.filter((c) => (c.vertical ?? '').toLowerCase() !== 'vehicles'),
    pixels: dedupe(ownedPx.items, clientPx.items),
    blocked,
  };
}

/* ------------------------------------------------------- catalog provisioning */

export type CatalogResult =
  | { ok: true; catalogId: string; name: string; source: 'ADOPTED' | 'CREATED' }
  | { ok: false; kind: MetaFailureKind; message: string };

/**
 * Get this lot a vehicles catalog, whatever state it starts in.
 *
 * `vertical: 'vehicles'` is not optional and not guessable — the enum defaults
 * to `commerce`, and a commerce catalog is silently useless for automotive
 * inventory ads. It will accept items and it will never run.
 *
 * ADOPTION IS PREFERRED OVER CREATION, always. A dealer who already has a
 * catalog usually has ad history, product-set audiences and pixel match data
 * attached to it, none of which move to a new catalog. Creating a second one
 * because we did not look first is the kind of thing that quietly halves a
 * dealer's retargeting performance and gets blamed on us six weeks later.
 */
export async function ensureVehicleCatalog(
  token: string,
  businessId: string,
  dealerName: string,
  existing?: MetaCatalog[],
): Promise<CatalogResult> {
  try {
    const candidates =
      existing ??
      (await graphEdge<MetaCatalog>(`/${businessId}/owned_product_catalogs`, {
        token,
        fields: 'id,name,vertical',
      })).filter((c) => (c.vertical ?? '').toLowerCase() === 'vehicles');

    const adopt = candidates[0];
    if (adopt) {
      return { ok: true, catalogId: adopt.id, name: adopt.name ?? 'Vehicles', source: 'ADOPTED' };
    }

    const name = `${dealerName} Inventory`.slice(0, 90);
    const created = await graph<{ id: string }>(`/${businessId}/owned_product_catalogs`, {
      method: 'POST',
      token,
      params: { name, vertical: 'vehicles' },
    });

    return { ok: true, catalogId: created.id, name, source: 'CREATED' };
  } catch (err) {
    if (err instanceof MetaApiError) {
      return { ok: false, kind: err.kind, message: err.dealerMessage };
    }
    throw err;
  }
}

/* ---------------------------------------------------------------- feed setup */

export type FeedResult =
  | { ok: true; feedId: string }
  | { ok: false; kind: MetaFailureKind; message: string };

/**
 * Point the catalog at our hosted feed.
 *
 * TWO SCHEDULES, and the pair is the whole design:
 *
 *   `schedule`        DAILY  — full replace. Items absent from the file are deleted.
 *   `update_schedule` HOURLY — delta. Creates and updates only, never deletes.
 *
 * The daily replace is what keeps the catalog honest against the lot. The
 * hourly delta is what keeps a reprice from waiting until 3am.
 *
 * WHAT THIS DOES NOT SOLVE: scheduled fetch cannot run more often than hourly,
 * and the marketing site promises "sold at four, out of the catalog by four."
 * That gap is real and closing it needs `POST /{catalog_id}/items_batch` on the
 * sold event — the same out-of-band fast path the marketplace sync already owes
 * per `claude/marketplace-connections-and-lead-capture.md` §1.4. One trigger,
 * two consumers. Do not let the hourly delta talk anyone out of building it.
 *
 * `deletion_enabled` is deliberately left alone: it defaults on and Meta does
 * not let it be turned back off. We prefer flipping a sold unit to
 * `availability: not_available` over deleting it anyway — deletion destroys the
 * item-level delivery history Meta has accumulated for that vehicle.
 */
export async function ensureProductFeed(
  token: string,
  catalogId: string,
  feedUrl: string,
  deltaUrl: string,
  dealerName: string,
): Promise<FeedResult> {
  try {
    // Adopt a feed we already pointed at this URL rather than stacking duplicates.
    // Two feeds fetching overlapping items is how catalogs drift: one product id
    // must live in exactly one feed.
    const existing = await graphEdge<{ id: string; name?: string; schedule?: { url?: string } }>(
      `/${catalogId}/product_feeds`,
      { token, fields: 'id,name,schedule{url}' },
    );
    const mine = existing.find((f) => f.schedule?.url === feedUrl);
    if (mine) return { ok: true, feedId: mine.id };

    const created = await graph<{ id: string }>(`/${catalogId}/product_feeds`, {
      method: 'POST',
      token,
      params: {
        name: `Rooftop — ${dealerName}`.slice(0, 90),
        schedule: JSON.stringify({ interval: 'DAILY', url: feedUrl, hour: 3 }),
        update_schedule: JSON.stringify({ interval: 'HOURLY', url: deltaUrl }),
      },
    });
    return { ok: true, feedId: created.id };
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, kind: err.kind, message: err.dealerMessage };
    throw err;
  }
}

/**
 * Wire the dealer's pixel to the catalog.
 *
 * Without this association Meta cannot match a `ViewContent` on the storefront
 * to a row in the catalog, so retargeting audiences build empty and the ads
 * never leave the learning phase. It is one call and it is the single most
 * commonly skipped step in dealer catalog setups.
 *
 * The other half of that contract is ours and lives on the storefront: pixel
 * `content_ids` must match `vehicle_id` in the feed **exactly**, with
 * `content_type: 'vehicle'`. Competitors fail here because the dealer's website
 * is built by a different vendor that fires a stock number while the feed keys
 * on VIN. We own the storefront, so we can simply be correct — see
 * `claude/meta-ad-desk-build.md` §6.
 */
export async function associatePixel(
  token: string,
  catalogId: string,
  pixelId: string,
): Promise<boolean> {
  try {
    await graph(`/${catalogId}/external_event_sources`, {
      method: 'POST',
      token,
      params: { external_event_sources: JSON.stringify([pixelId]) },
    });
    return true;
  } catch {
    // Non-fatal on purpose: a catalog with no pixel still serves prospecting
    // ads, and blocking the whole connect flow on the optional half would be
    // the wrong trade.
    return false;
  }
}
