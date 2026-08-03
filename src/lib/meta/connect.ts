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
import { eq } from 'drizzle-orm';
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
  revokePermissions,
} from './graph';
import { decryptToken, encryptToken, tokenCryptoConfigured } from './tokens';
import {
  associatePixel,
  discoverAssets,
  ensureProductFeed,
  ensureVehicleCatalog,
  type Discovery,
} from './assets';

export const STATE_COOKIE = 'rooftop_meta_state';

/* ------------------------------------------------------------------ config */

/**
 * Public origin, used for the OAuth redirect and for the feed URLs we hand
 * Meta. Must be the real hostname: Meta rejects a redirect_uri that is not in
 * the app's allowlist, and it will not fetch a feed from localhost.
 */
export function appOrigin(): string {
  const host = process.env.NEXT_PUBLIC_APP_HOST;
  if (!host) return 'http://localhost:3000';
  return host.startsWith('http') ? host : `https://${host}`;
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

export function buildState(groupId: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url');
  const payload = `${groupId}.${nonce}`;
  return { state: `${payload}.${sign(payload)}`, nonce };
}

export function verifyState(state: string, nonce: string): string | null {
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [groupId, gotNonce, mac] = parts as [string, string, string];

  const expected = sign(`${groupId}.${gotNonce}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // The signature proves we minted it; the cookie proves it was minted for
  // *this browser*. A replayed state from another session fails here.
  if (gotNonce !== nonce) return null;
  return groupId;
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
  const configId = loginConfigId();
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
  | { ok: false; error: string };

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
}): Promise<ProvisionResult> {
  const conn = await tokenFor(args.groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected. Connect it first.' };

  const catalog = await ensureVehicleCatalog(conn.token, conn.row.businessId, args.dealerName);
  if (!catalog.ok) {
    await noteFailure(args.groupId, new MetaApiError(catalog.message, catalog.kind, 400, null, null, null));
    return { ok: false, error: catalog.message };
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

  return {
    ok: true,
    catalogId: catalog.catalogId,
    catalogSource: catalog.source,
    feedId: feed.ok ? feed.feedId : null,
    pixelLinked,
  };
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
