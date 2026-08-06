/**
 * Rooftop Auto — the Meta connect flow, end to end.
 *
 * Orchestration only: `graph.ts` knows how to talk to Meta, `assets.ts` knows
 * what a catalog is, and this file knows what a *dealer* is and what order
 * things have to happen in.
 *
 * WHY THE REDIRECT FLOW AND NOT THE JS SDK
 *
 * Meta documents `FB.login({ config_id, response_type: 'code' })`, which means
 * loading `connect.facebook.net` into the admin. The redirect flow gets the same
 * authorization code with no third-party script on our origin, no CSP carve-out,
 * and no dependence on the SDK surviving an ad blocker — which, on a page whose
 * whole job is advertising, is not a hypothetical. The dialog is identical to
 * the dealer either way.
 *
 * CSRF: the `state` parameter is an HMAC over the group id and a nonce, keyed by
 * the app secret, and the nonce is mirrored in an httpOnly cookie. Both have to
 * agree on return. Without this, a crafted callback link could bind an
 * attacker's Meta business to a dealer's Rooftop account — which is worth
 * spelling out because the failure is silent and the blast radius is the
 * dealer's ad spend.
 */

import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import {
  GRAPH_VERSION,
  MetaApiError,
  REQUIRED_SCOPES,
  debugToken,
  exchangeCode,
  loginConfigId,
  metaConfigured,
  provisionLoginConfigId,
  revokePermissions,
} from './graph';
import { decryptToken, encryptToken, tokenCryptoConfigured } from './tokens';
import {
  associatePixel,
  discoverAssets,
  assignCatalogToSystemUser,
  ensureProductFeed,
  ensureVehicleCatalog,
  triggerFeedUpload,
  waitForCatalogVisibility,
  type Discovery,
} from './assets';

export const STATE_COOKIE = 'rooftop_meta_state';

/* ------------------------------------------------------------------ config */

/**
 * Public origin, used for the OAuth redirect and for the feed URLs we hand
 * Meta. Must be the real hostname: Meta rejects a redirect_uri that is not in
 * the app's allowlist, and it will not fetch a feed from localhost.
 */
export const DEFAULT_APP_HOST = 'app.rooftopauto.com';

export function appOrigin(): string {
  const host = process.env.NEXT_PUBLIC_APP_HOST;
  if (host) return host.startsWith('http') ? host : `https://${host}`;
  // NEXT_PUBLIC_APP_HOST is unset. Falling back to localhost here was a live
  // production bug: Meta blocks a localhost redirect_uri and can never fetch a
  // localhost feed, and nothing looked broken because proxy.ts and
  // demo-actions.ts both default to the real host. Match them in production;
  // localhost stays the default for local dev only.
  if (process.env.NODE_ENV === 'production') return `https://${DEFAULT_APP_HOST}`;
  return 'http://localhost:3000';
}

export function redirectUri(): string {
  return `${appOrigin()}/api/meta/connect`;
}

/** Everything the feature needs before it can be offered at all. */
export function adDeskConfigured(): boolean {
  return metaConfigured() && tokenCryptoConfigured();
}

/* -------------------------------------------------------------------- state */

function sign(value: string): string {
  return createHmac('sha256', process.env.META_APP_SECRET ?? '').update(value).digest('base64url');
}

/**
 * What the round trip through Facebook has to carry.
 *
 * `mode` is the load-bearing field. The callback is one URL serving two
 * different login configurations — the everyday system-user connect, and the
 * admin user token used once to create a catalog — and it must never confuse
 * them. A `provision` code that got treated as a `connect` would overwrite a
 * dealer's non-expiring system-user credential with a 60-day user token, and
 * nothing would look wrong until it quietly expired two months later. The mode
 * is inside the signed payload precisely so it cannot be flipped in the URL.
 */
export type MetaState = {
  /** Dealer group. Checked against the signed-in session on return. */
  g: string;
  /** Nonce, mirrored in the httpOnly cookie. */
  n: string;
  mode: 'connect' | 'provision';
  /** The lot being provisioned. Present on `provision` only. */
  r?: string;
};

export function buildState(
  groupId: string,
  opts: { mode?: 'connect' | 'provision'; rooftopId?: string } = {},
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url');
  const body: MetaState = {
    g: groupId,
    n: nonce,
    mode: opts.mode ?? 'connect',
    ...(opts.rooftopId ? { r: opts.rooftopId } : {}),
  };
  // base64url of JSON rather than dot-joined fields: the payload now carries a
  // rooftop id, and an id that ever contained the delimiter would silently
  // reshape the state into something that still verified.
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return { state: `${payload}.${sign(payload)}`, nonce };
}

export function verifyState(state: string, nonce: string): MetaState | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payload, mac] = parts as [string, string];

  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let body: MetaState;
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MetaState;
  } catch {
    return null;
  }
  if (!body || typeof body.g !== 'string' || typeof body.n !== 'string') return null;
  if (body.mode !== 'connect' && body.mode !== 'provision') return null;

  // The signature proves we minted it; the cookie proves it was minted for
  // *this browser*. A replayed state from another session fails here.
  if (body.n !== nonce) return null;
  return body;
}

/**
 * The URL the Connect button points at.
 *
 * `config_id` replaces `scope` entirely — Facebook Login for Business takes the
 * permission list and the asset picker from the dashboard configuration, and
 * sending `scope` alongside it is ignored at best. If the dealer sees the wrong
 * assets in the dialog, the fix is in the App Dashboard, not here.
 */
export function authorizeUrl(state: string): string | null {
  return dialogUrl(loginConfigId(), state);
}

/**
 * The admin-grant dialog, used only to create a catalog.
 *
 * Same app, same callback, different configuration — this one is set to hand
 * back a **user** access token. Returns null when
 * `META_LOGIN_CONFIG_PROVISION_ID` is unset, which is how the whole feature
 * stays switched off until the configuration exists.
 */
export function provisionAuthorizeUrl(state: string): string | null {
  return dialogUrl(provisionLoginConfigId(), state);
}

export function catalogProvisionAvailable(): boolean {
  return Boolean(provisionLoginConfigId());
}

function dialogUrl(configId: string | null, state: string): string | null {
  const appId = process.env.META_APP_ID;
  if (!configId || !appId) return null;

  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(),
    config_id: configId,
    response_type: 'code',
    override_default_response_type: 'true',
    state,
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q.toString()}`;
}

/* --------------------------------------------------------------- the record */

export type StoredConnection = typeof t.metaConnections.$inferSelect;

export async function loadConnection(groupId: string): Promise<StoredConnection | null> {
  const rows = await db
    .select()
    .from(t.metaConnections)
    .where(eq(t.metaConnections.groupId, groupId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The decrypted token for a group, or null.
 *
 * Returns null rather than throwing on a disconnected or broken connection so
 * that read paths (a dashboard tile, a nightly sweep) degrade to "not connected"
 * instead of taking a page down. Callers that genuinely need a token check for
 * null and say so.
 */
export async function tokenFor(groupId: string): Promise<{ token: string; row: StoredConnection } | null> {
  const row = await loadConnection(groupId);
  if (!row || row.status === 'DISCONNECTED') return null;
  try {
    return { token: decryptToken(row.accessTokenCipher), row };
  } catch {
    await db
      .update(t.metaConnections)
      .set({ status: 'NEEDS_REAUTH', errorMessage: 'Stored credential could not be read.' })
      .where(eq(t.metaConnections.id, row.id));
    return null;
  }
}

/**
 * Mark a connection as needing the dealer's attention.
 *
 * Called from anywhere that catches a `reauth`-kind error. Centralised because
 * the distinction between "revoked" and "broken" is the difference between
 * showing a Reconnect button and opening a support ticket, and every call site
 * getting that judgement right independently is not a plan.
 */
export async function noteFailure(groupId: string, err: unknown): Promise<void> {
  if (!(err instanceof MetaApiError)) return;
  if (err.kind === 'rate-limit' || err.kind === 'transport') return; // transient; not the dealer's problem
  await db
    .update(t.metaConnections)
    .set({
      status: err.kind === 'reauth' ? 'NEEDS_REAUTH' : 'ERROR',
      errorMessage: err.dealerMessage,
      lastCheckedAt: new Date(),
    })
    .where(eq(t.metaConnections.groupId, groupId));
}

/* ------------------------------------------------------------- completion */

export type ConnectOutcome =
  | { ok: true; connectionId: string; discovery: Discovery; missingScopes: string[] }
  | { ok: false; error: string };

/**
 * Turn an authorization code into a stored connection.
 *
 * Order matters and is deliberate:
 *   1. exchange the code       — fails fast if the dialog was abandoned
 *   2. inspect the token       — what we *got*, not what we asked for
 *   3. discover assets         — needs a valid token, tells the UI what to ask next
 *   4. persist                 — only once all three succeeded
 *
 * Nothing is provisioned here. Creating a catalog is a separate, explicit step
 * the dealer confirms, because it writes an object into *their* business and
 * they should see the business name we matched before we do that.
 */
export async function completeConnection(args: {
  code: string;
  groupId: string;
  userId: string | null;
}): Promise<ConnectOutcome> {
  let token: string;
  let kind: 'SYSTEM_USER' | 'USER' = 'SYSTEM_USER';
  let expiresAt: Date | null = null;
  let scopes: string[] = [];
  let systemUserId: string | null = null;

  try {
    const exchanged = await exchangeCode(args.code, redirectUri());
    token = exchanged.access_token;
    if (!token) return { ok: false, error: 'Facebook did not return a usable credential. Try connecting again.' };

    const info = (await debugToken(token)).data ?? {};
    if (info.is_valid === false) {
      return { ok: false, error: 'Facebook returned a credential that is already invalid. Try connecting again.' };
    }
    // A system-user token reports expiry 0 = never. Anything else is the
    // user-token fallback and will need re-auth on a timer.
    kind = info.expires_at === 0 || info.type === 'SYSTEM_USER' ? 'SYSTEM_USER' : 'USER';
    expiresAt = info.expires_at ? new Date(info.expires_at * 1000) : null;
    scopes = info.scopes ?? (info.granular_scopes ?? []).map((g) => g.scope);
    systemUserId = kind === 'SYSTEM_USER' ? info.user_id ?? null : null;
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }

  let discovery: Discovery;
  try {
    discovery = await discoverAssets(token);
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }

  if (!discovery.businessId) {
    return {
      ok: false,
      error:
        'We connected to Facebook but could not find a business portfolio on that account. ' +
        'Sign in with the account that manages the dealership, or create a business portfolio in the Facebook dialog and try again.',
    };
  }

  const missingScopes = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));

  const values = {
    groupId: args.groupId,
    businessId: discovery.businessId,
    businessName: discovery.businessName,
    systemUserId,
    accessTokenCipher: encryptToken(token),
    tokenKind: kind,
    tokenExpiresAt: expiresAt,
    grantedScopes: scopes,
    status: 'CONNECTED' as const,
    errorMessage: null,
    connectedByUserId: args.userId,
    connectedAt: new Date(),
    lastCheckedAt: new Date(),
  };

  // Reconnecting is the normal case, not an error: a dealer who revoked us and
  // came back must land on the same row so their per-lot asset mapping survives.
  const [row] = await db
    .insert(t.metaConnections)
    .values(values)
    .onConflictDoUpdate({ target: t.metaConnections.groupId, set: values })
    .returning({ id: t.metaConnections.id });

  return { ok: true, connectionId: row!.id, discovery, missingScopes };
}

/* ----------------------------------------------------------- feed addresses */

export function feedUrls(rooftopId: string, secret: string): { full: string; delta: string } {
  const base = `${appOrigin()}/api/meta/feed/${rooftopId}/${secret}`;
  return { full: `${base}/vehicles.tsv`, delta: `${base}/vehicles-delta.tsv` };
}

/* ---------------------------------------------------------- provisioning */

export type ProvisionResult =
  | { ok: true; catalogId: string; catalogSource: 'ADOPTED' | 'CREATED'; feedId: string | null; pixelLinked: boolean }
  | {
      ok: false;
      error: string;
      /**
       * True when the only thing standing between this lot and a catalog is
       * that our system user is not an admin of the dealer's business. The UI
       * reads it to offer the admin-grant button instead of a dead red box.
       */
      needsAdminGrant?: boolean;
    };

/** Meta's undocumented subcode for "you aren't an admin of this business". */
const NOT_A_BUSINESS_ADMIN = 1690129;

/**
 * Give one lot everything it needs to run catalog ads.
 *
 * This is the step that answers the dealer's real question. They pick a Page and
 * an ad account; the catalog, the feed and the pixel wiring are ours to arrange,
 * and a dealer who has never heard the word "catalog" never has to.
 *
 * Idempotent throughout: adopt before create at every layer, so a dealer who
 * clicks the button twice, or reconnects after revoking, ends up with one
 * catalog and one feed rather than a pile of them.
 */
export async function provisionRooftop(args: {
  groupId: string;
  rooftopId: string;
  pageId: string | null;
  pageName: string | null;
  adAccountId: string | null;
  adAccountName: string | null;
  pixelId: string | null;
  dealerName: string;
  /**
   * A user access token from a business admin, when we have one. Used for the
   * catalog create and nothing else, and never persisted — see
   * `completeCatalogProvision`.
   */
  createToken?: string;
}): Promise<ProvisionResult> {
  const conn = await tokenFor(args.groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected. Connect it first.' };

  const catalog = await ensureVehicleCatalog(conn.token, conn.row.businessId, args.dealerName, {
    createToken: args.createToken,
  });
  if (!catalog.ok) {
    await noteFailure(
      args.groupId,
      new MetaApiError(catalog.message, catalog.kind, 400, null, catalog.subcode ?? null, null),
    );
    // Only offer the admin grant when it is actually the answer: the create was
    // refused for want of business-admin standing, we have a configuration to
    // send them to, and we were not already using an admin token — if we were,
    // the grant they just completed did not carry admin rights either and
    // sending them round again would be a loop.
    const needsAdminGrant =
      catalog.subcode === NOT_A_BUSINESS_ADMIN && !args.createToken && catalogProvisionAvailable();
    return { ok: false, error: catalog.message, needsAdminGrant };
  }

  /*
   * HAND THE NEW CATALOG TO THE SYSTEM USER BEFORE ANYTHING ELSE TOUCHES IT.
   *
   * Only on CREATED: an adopted catalog is one the dealer already assigned to
   * us, which is the only reason we could see it in the first place, so
   * re-granting is noise. A created one belongs to nobody but the admin whose
   * token made it, and that token is about to go out of scope forever.
   *
   * Ordering is load-bearing. `ensureProductFeed` below runs on `conn.token`
   * and is the first thing to touch the catalog by id; before this call existed
   * it came straight back with code 100 / subcode 33 — "does not exist, cannot
   * be loaded due to missing permissions" — which `classify()` files as
   * `request` and the dealer sees as "try again in a moment". It never worked
   * on a retry, because nothing about waiting grants a role.
   *
   * A failure here is fatal to the lot and reported as such rather than pressed
   * on with: continuing would produce a catalog we cannot feed, recorded as a
   * success, which is the exact shape of bug this whole investigation started
   * as.
   */
  if (catalog.source === 'CREATED' && args.createToken && conn.row.systemUserId) {
    const assigned = await assignCatalogToSystemUser(
      args.createToken,
      catalog.catalogId,
      conn.row.systemUserId,
    );
    if (!assigned.ok) {
      await noteFailure(
        args.groupId,
        new MetaApiError(assigned.message, assigned.kind, 400, null, null, null),
      );
      return {
        ok: false,
        error:
          'The catalog was created but we could not give Rooftop access to it. ' +
          'Assign it to Rooftop in Business Settings → Data sources → Catalogs, and we will pick it up from there.',
      };
    }

    /*
     * AND NOW WAIT FOR THE GRANT TO BE READABLE, which is a separate event.
     *
     * Without this the whole provision is a race we lose: the assignment
     * returns 200 and the very next call — the feed, 294ms later — comes back
     * "does not exist, cannot be loaded due to missing permissions". The lot
     * lands on CREATED with a dead feed, and the only repair is clicking the
     * button again, which succeeds by *adopting* the catalog the failed run
     * left behind. That second-pass wording is "already in your Facebook
     * business", which is both untrue of a catalog we made ninety seconds ago
     * and the exact string `meta-master-screencast.md` shot 23 says not to
     * record.
     *
     * A timeout is not an error. The catalog exists, the grant is real, and the
     * next run will find it by name — so we say so plainly rather than
     * reporting a failure the dealer cannot act on.
     */
    const visible = await waitForCatalogVisibility(conn.token, catalog.catalogId);
    if (!visible) {
      return {
        ok: false,
        error:
          'The catalog was created and handed to Rooftop, but Facebook has not finished ' +
          'applying that permission yet. Give it a minute and press Set up catalog ads again — ' +
          'nothing needs redoing on Facebook.',
      };
    }
  }

  // Stable per lot: regenerating it on every provision would break the feed URL
  // Meta already has on file and silently stop inventory updates.
  const existing = await db
    .select()
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, args.rooftopId))
    .limit(1);
  const secret = existing[0]?.feedSecret ?? randomBytes(24).toString('base64url');

  const urls = feedUrls(args.rooftopId, secret);
  const feed = await ensureProductFeed(
    conn.token,
    catalog.catalogId,
    urls.full,
    urls.delta,
    args.dealerName,
  );

  /*
   * PULL THE FEED NOW RATHER THAN AT 3AM.
   *
   * Registering a schedule does not fetch anything, and an empty catalog is not
   * a cosmetic state — `POST /{catalog_id}/product_sets` refuses outright with
   * subcode 1798130, "We disallow the creation of empty product sets". So a lot
   * connected at 9am cannot build a campaign, run a demo, or show a single
   * vehicle until the small hours, and nothing on screen explains why.
   *
   * Fired on every successful provision, not just the first. Re-running is how
   * a dealer repairs things, and "press it again and the inventory appears" is
   * the behaviour they already expect from that button.
   *
   * Deliberately not awaited into the result: the schedules are registered, so
   * the daily replace lands regardless and this only buys freshness. It logs
   * its own failure.
   */
  if (feed.ok) await triggerFeedUpload(conn.token, feed.feedId, urls.full);

  const pixelLinked = args.pixelId
    ? await associatePixel(conn.token, catalog.catalogId, args.pixelId)
    : false;

  const values = {
    connectionId: conn.row.id,
    rooftopId: args.rooftopId,
    pageId: args.pageId,
    pageName: args.pageName,
    adAccountId: args.adAccountId,
    adAccountName: args.adAccountName,
    catalogId: catalog.catalogId,
    catalogName: catalog.name,
    catalogSource: catalog.source,
    productFeedId: feed.ok ? feed.feedId : null,
    feedSecret: secret,
    pixelId: args.pixelId,
    // The feed is the one part that can fail while everything else succeeded,
    // and it is the part that matters most, so it is recorded rather than lost.
    errorMessage: feed.ok ? null : feed.message,
    provisionedAt: new Date(),
  };

  await db
    .insert(t.metaRooftopAssets)
    .values(values)
    .onConflictDoUpdate({ target: t.metaRooftopAssets.rooftopId, set: values });
/*
   * CLEAR THE CONNECTION-LEVEL FAILURE, because we just disproved it.
   *
   * `noteFailure` writes `metaConnections.errorMessage` and flips the row to
   * ERROR, and until this line the only two things that ever cleared it were
   * disconnecting and reconnecting. A dealer whose catalog step failed once and
   * then succeeded kept a red Error chip and a stale amber banner on the Ad Desk
   * for the rest of the connection's life, and the only cure we offered was the
   * full OAuth round trip — which on a business with 2FA means burning a
   * confirmation code to fix a message that was already untrue.
   *
   * Reaching this point means the credential just performed a catalog read, a
   * create-or-adopt and a feed call against Meta. Saying it is in error after
   * that is not a cautious default, it is a false statement.
   *
   * Scoped to ERROR on purpose: NEEDS_REAUTH is set by paths that inspect the
   * credential itself, and this success does not speak to a row that some other
   * lot's failure put into reauth. Per-lot failures — the feed above being the
   * one that matters — stay on `metaRooftopAssets.errorMessage`, which is where
   * a per-lot problem belongs and where the lot row already reads it from.
   */
  await db
    .update(t.metaConnections)
    .set({ status: 'CONNECTED', errorMessage: null, lastCheckedAt: new Date() })
    .where(and(eq(t.metaConnections.groupId, args.groupId), eq(t.metaConnections.status, 'ERROR')));
  return {
    ok: true,
    catalogId: catalog.catalogId,
    catalogSource: catalog.source,
    feedId: feed.ok ? feed.feedId : null,
    pixelLinked,
  };
}

/* ------------------------------------------------ admin grant, for creating */

/**
 * Finish one lot's catalog using a user access token from a business admin.
 *
 * THE WHOLE POINT: this token is used for one Graph call and then dropped.
 *
 * It is not encrypted into `meta_connections`, not returned to the caller, and
 * not reachable after this function returns. That is deliberate and it is the
 * design's main safety property. A user token expires in ~60 days and belongs
 * to a person rather than to the business, so storing it would quietly undo the
 * thing the system-user token exists to guarantee — that the integration keeps
 * working when the person who set it up leaves. The dealer's ongoing credential
 * stays the BISU; this is a one-shot key to open one door.
 *
 * It also means there is nothing here to steal later, which matters because the
 * grant carries broader rights than the BISU does.
 *
 * The existing per-lot Page and ad-account choices are read back from the row
 * rather than taken from a form: the dealer picked them before being sent to
 * Facebook, and a round trip through an external redirect is not a place to
 * carry mutable state.
 */
export async function completeCatalogProvision(args: {
  code: string;
  groupId: string;
  rooftopId: string;
}): Promise<ProvisionResult> {
  let adminToken: string;
  try {
    const exchanged = await exchangeCode(args.code, redirectUri());
    adminToken = exchanged.access_token;
    if (!adminToken) {
      return { ok: false, error: 'Facebook did not return a usable credential. Try that again.' };
    }
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }

  /*
   * Scoped to the group a second time, on purpose.
   *
   * `startCatalogProvision` already ran `assertRooftopInScope` before the id
   * went into the state, and the state is HMAC'd, so this should be
   * unreachable. It is here because the id has since made a round trip through
   * facebook.com, and the cost of being wrong is provisioning one dealer's lot
   * against another dealer's business. Belt and braces on tenant boundaries is
   * the house rule everywhere else in this codebase; no reason to drop it at
   * the one place the value left our control.
   */
  const rooftop = await db
    .select({ id: t.rooftops.id, name: t.rooftops.name })
    .from(t.rooftops)
    .where(and(eq(t.rooftops.id, args.rooftopId), eq(t.rooftops.groupId, args.groupId)))
    .limit(1);
  if (!rooftop[0]) return { ok: false, error: 'That lot was not found.' };

  const saved = await db
    .select()
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, args.rooftopId))
    .limit(1);
  const row = saved[0];

  return provisionRooftop({
    groupId: args.groupId,
    rooftopId: args.rooftopId,
    pageId: row?.pageId ?? null,
    pageName: row?.pageName ?? null,
    adAccountId: row?.adAccountId ?? null,
    adAccountName: row?.adAccountName ?? null,
    pixelId: row?.pixelId ?? null,
    dealerName: rooftop[0].name,
    createToken: adminToken,
  });
}

/* ------------------------------------------------------------- disconnect */

/**
 * Hand the dealer their assets back.
 *
 * Required by Meta's Developer Policy, and correct regardless. We revoke our own
 * permissions at Meta, then mark the connection disconnected — but we **delete
 * nothing** in their business. The catalog, the feed and the pixel are theirs
 * and they keep working; they simply stop being fed by us.
 *
 * Best-effort at Meta by design. If the revoke call fails we still tear down our
 * side, because a dealer who clicked Disconnect must never be left connected
 * here on the strength of an API timeout.
 */
export async function disconnect(groupId: string): Promise<{ revokedAtMeta: boolean }> {
  const conn = await tokenFor(groupId);
  let revokedAtMeta = false;
  if (conn) revokedAtMeta = await revokePermissions(conn.token);

  await db
    .update(t.metaConnections)
    .set({ status: 'DISCONNECTED', errorMessage: null, lastCheckedAt: new Date() })
    .where(eq(t.metaConnections.groupId, groupId));

  return { revokedAtMeta };
}
