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
  | {
      ok: false;
      kind: MetaFailureKind;
      message: string;
      /**
       * Meta's subcode, kept because the caller has to distinguish "we cannot
       * create because we are not a business admin" (1690129, fixable with an
       * admin grant) from every other refusal, and `kind` alone cannot say it.
       */
      subcode?: number | null;
    };

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
  opts: {
    existing?: MetaCatalog[];
    /**
     * Token used for the **create** call only, when it differs from `token`.
     *
     * Creating a business-owned catalog requires business-*admin* standing, and
     * a Business Integration System User never has it — it holds exactly the
     * assets the dealer ticked, and a catalog that does not exist yet is not one
     * of them. Meta returns `code: 10 / subcode: 1690129` and says so:
     * "You don't have permission to create a product catalog because you aren't
     * an admin of this business." Their own Login for Business guidance is to
     * route around it — "User access tokens should also be used if you require
     * an API that requires admin permissions on a business portfolio."
     *
     * So reads and adoption run on the long-lived system-user token, and only
     * this one call runs on a short-lived user token from someone who actually
     * administers the business. See `claude/meta-catalog-creation-blocker.md`.
     */
    createToken?: string;
  } = {},
): Promise<CatalogResult> {
  const { existing, createToken } = opts;
  try {
    const candidates =
      existing ??
      (await graphEdge<MetaCatalog>(`/${businessId}/owned_product_catalogs`, {
        token,
        fields: 'id,name,vertical',
      })).filter((c) => (c.vertical ?? '').toLowerCase() === 'vehicles');

    const name = `${dealerName} Inventory`.slice(0, 90);

    /*
     * WHICH ONE TO ADOPT — this used to be `candidates[0]` and that was a bug.
     *
     * On a business holding one vehicles catalog, first-is-right and adoption is
     * the correct call: the dealer's ad history, product-set audiences and pixel
     * match data are all attached to it. On a business holding several — an
     * agency, a multi-brand group, or anyone mid-migration — first-is-whatever-
     * Meta-returned-first, which is a coin flip we then write into their lot and
     * point our feed at. Litespeed Ai Ads holds three today, none of them ours.
     *
     * So: take one we evidently created, else take the only one there is, else
     * stop and ask. Guessing here silently retargets a dealer against a stranger's
     * inventory, and nobody finds out for six weeks.
     */
    const mine = candidates.find((c) => (c.name ?? '') === name);
    const adopt = mine ?? (candidates.length === 1 ? candidates[0] : undefined);

    if (adopt) {
      return { ok: true, catalogId: adopt.id, name: adopt.name ?? 'Vehicles', source: 'ADOPTED' };
    }

    if (candidates.length > 1) {
      return {
        ok: false,
        kind: 'business-setup',
        message:
          `This Facebook business has ${candidates.length} vehicle catalogs and none of them is ours, ` +
          'so we will not guess which one this lot should use. Tell us which, and we will connect it to your inventory.',
      };
    }

    const created = await graph<{ id: string }>(`/${businessId}/owned_product_catalogs`, {
      method: 'POST',
      token: createToken ?? token,
      params: { name, vertical: 'vehicles' },
    });

    return { ok: true, catalogId: created.id, name, source: 'CREATED' };
  } catch (err) {
    if (err instanceof MetaApiError) {
      // The transport already logged Meta's raw error; this adds the context
      // that only this function has — which business we were writing into, and
      // whether we were reading candidates or creating. Without the business id
      // a permission refusal is indistinguishable from writing into the wrong
      // portfolio, which is the first thing to rule out.
      console.error(
        '[meta] ensureVehicleCatalog failed ' +
          JSON.stringify({
            businessId,
            dealerName,
            usedPassedCandidates: existing !== undefined,
            usedSeparateCreateToken: Boolean(createToken),
            kind: err.kind,
            status: err.status,
            code: err.code,
            subcode: err.subcode,
            message: err.message,
            trace: err.traceId,
          }),
      );
      return { ok: false, kind: err.kind, message: err.dealerMessage, subcode: err.subcode };
    }
    console.error('[meta] ensureVehicleCatalog threw a non-Graph error', err);
    throw err;
  }
}

/* ------------------------------------------------------- catalog assignment */

/**
 * Give our system user standing on a catalog we just created.
 *
 * WITHOUT THIS THE CREATE IS USELESS, and it fails one step later in a way that
 * does not look related. The admin user token creates the catalog and is then
 * dropped; every subsequent call — the feed, the product sets, the item
 * batches — runs on the Business Integration System User, which is scoped to
 * exactly the assets the dealer ticked in the login dialog. A catalog that did
 * not exist when they ticked is not one of them, so the very next call comes
 * back:
 *
 *   GET /{catalog_id}/product_feeds
 *   400  code 100  subcode 33  GraphMethodException
 *   "Unsupported get request. Object with ID '…' does not exist, cannot be
 *    loaded due to missing permissions, or does not support this operation."
 *
 * Observed live on 6 Aug 2026, trace AaUw13Qhw0DZsWLainx4DNb, on the Battle
 * Ground lot seconds after a successful create. The object plainly existed; it
 * is the missing-permissions arm of that message. Note what it does NOT say:
 * there is no 1690129, no `code: 10`, nothing that reads as a permission
 * problem to `classify()`, which drops it into the generic bucket and tells the
 * dealer to try again in a moment. Retrying never helps.
 *
 * So the assignment has to happen while the admin token is still in hand — it
 * is the only credential in the process with the business-admin standing that
 * granting a role requires. `MANAGE` covers the feed and item writes;
 * `ADVERTISE` is what lets the ad account build product sets against it later.
 *
 * See `claude/meta-catalog-creation-blocker.md`.
 */
export async function assignCatalogToSystemUser(
  adminToken: string,
  catalogId: string,
  systemUserId: string,
): Promise<{ ok: true } | { ok: false; kind: MetaFailureKind; message: string }> {
  try {
    await graph(`/${catalogId}/assigned_users`, {
      method: 'POST',
      token: adminToken,
      params: { user: systemUserId, tasks: JSON.stringify(['MANAGE', 'ADVERTISE']) },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.error(
        '[meta] assignCatalogToSystemUser failed ' +
          JSON.stringify({
            catalogId,
            systemUserId,
            kind: err.kind,
            code: err.code,
            subcode: err.subcode,
            message: err.message,
            trace: err.traceId,
          }),
      );
      return { ok: false, kind: err.kind, message: err.dealerMessage };
    }
    throw err;
  }
}

/**
 * Block until the system user can actually see the catalog it was just granted.
 *
 * THE GRANT IS NOT THE SAME EVENT AS THE GRANT BEING READABLE. Business asset
 * assignment is eventually consistent, and the gap is wide enough to lose a
 * whole provision to. Observed on the Battle Ground lot, 6 Aug 2026, in one
 * function invocation:
 *
 *   POST /1551227789809689/assigned_users   1.28s   succeeded
 *   GET  /1551227789809689/product_feeds     294ms  400, code 100 subcode 33
 *
 * 294 milliseconds after a successful grant, the object still read as
 * "does not exist, cannot be loaded due to missing permissions". Clicking the
 * same button again minutes later found it immediately and adopted it — which
 * is the proof this is latency and not a wrong grant, and also why it is worth
 * waiting rather than restructuring: the permission was always correct.
 *
 * We poll the cheapest possible read. A miss here is expected and not an
 * incident, but `graph()` logs every non-2xx at the transport, so a slow
 * propagation leaves a short run of code-100 lines in the log before the
 * success. That noise is deliberate — silencing it would also hide a genuine
 * permission failure, which looks identical until the timeout.
 *
 * Returns false on timeout rather than throwing. The caller decides, and the
 * honest answer to the dealer is "not yet", not "broken": the next provision
 * run will find the catalog by name and adopt it.
 */
export async function waitForCatalogVisibility(
  token: string,
  catalogId: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 8;
  const delayMs = opts.delayMs ?? 2000;

  for (let i = 0; i < attempts; i++) {
    try {
      await graph<{ id: string }>(`/${catalogId}`, { token, params: { fields: 'id' } });
      return true;
    } catch (err) {
      // Only 100/33 is the propagation signature. Anything else — a revoked
      // token, a rate limit — is a real failure and waiting cannot fix it, so
      // stop rather than burning the whole budget on it.
      const propagating =
        err instanceof MetaApiError && err.code === 100 && err.subcode === 33;
      if (!propagating) return false;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error(
    '[meta] waitForCatalogVisibility timed out ' +
      JSON.stringify({ catalogId, attempts, delayMs }),
  );
  return false;
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
