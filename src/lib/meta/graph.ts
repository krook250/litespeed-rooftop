/**
 * Rooftop Auto — Meta Graph API transport.
 *
 * The low level only: auth, signing, versioning, error translation, paging.
 * Anything that knows what a *dealer* is lives in `./assets.ts` or `./actions.ts`.
 *
 * THREE THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. `appsecret_proof` on every authenticated call. Meta requires it for
 *    system-user tokens and recommends it everywhere else. It is an HMAC of the
 *    token under the app secret, so a token stolen without the secret is useless
 *    off our servers. Omitting it is the single most common reason a call that
 *    works in the Graph API Explorer fails from a real backend.
 *
 * 2. Turning Meta's error codes into something the *product* can act on.
 *    `code: 190` is not "an error" — it means the dealer revoked us in their
 *    Business settings, which is a normal end state we are required by Meta's
 *    Developer Policy to support, and it should put the connection into
 *    NEEDS_REAUTH and show a Reconnect button. `code: 4` is a rate limit and
 *    should back off silently. Collapsing both into "something went wrong" is
 *    how an integration becomes unsupportable.
 *
 * 3. Never letting a token or the app secret reach a log line or a dealer's
 *    screen. Same rule as `src/lib/domains/vercel.ts`: errors carry Meta's
 *    message and code, never the request.
 *
 * ON API VERSIONS: pinned, not floating. Meta ships breaking changes on a fixed
 * schedule and auto-upgrades unversioned calls, so an unpinned client breaks on
 * Meta's calendar rather than ours. Override with `META_GRAPH_VERSION` when
 * moving up, so the bump is one env change and a deploy.
 */

import 'server-only';
import { createHmac } from 'node:crypto';

const GRAPH = 'https://graph.facebook.com';

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v25.0';

/**
 * What the connect dialog asks for. Order is irrelevant to Meta but this is the
 * list `claude/meta-ad-desk-build.md` §1 justifies permission by permission, and
 * it should stay in sync with the Facebook Login for Business configuration —
 * the configuration is the source of truth at runtime, this constant is what we
 * check the *result* against.
 *
 * `catalog_management` is the one to never quietly drop: without it we can read
 * a dealer's catalog but not create one, and creating one is the whole point for
 * the large majority of lots who have never had a catalog in their lives.
 */
export const REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
  'business_management',
  'catalog_management',
  'ads_management',
  'ads_read',
] as const;

/* ------------------------------------------------------------------ errors */

/** What the caller should actually *do* about it. */
export type MetaFailureKind =
  /** Token revoked, expired, or invalidated. The dealer must reconnect. */
  | 'reauth'
  /** We asked for something this app is not approved for yet. */
  | 'permission'
  /** Backed off by Meta. Retry later; do not surface as a fault. */
  | 'rate-limit'
  /** The dealer's business is missing a prerequisite (2FA, ad account cap, verification). */
  | 'business-setup'
  /** Bad request on our side. A bug, not a dealer problem. */
  | 'request'
  /** Network, timeout, or Meta being down. */
  | 'transport'
  | 'unknown';

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly kind: MetaFailureKind,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly traceId: string | null,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  /** Safe to show a dealer: Meta's own wording, no ids, no token. */
  get dealerMessage(): string {
    switch (this.kind) {
      case 'reauth':
        return 'Your Facebook connection was disconnected. Reconnect to keep your ads running.';
      case 'permission':
        return 'Rooftop is not yet approved by Meta for this action. We are on it — nothing you need to do.';
      case 'rate-limit':
        return 'Facebook is asking us to slow down. This will retry on its own shortly.';
      case 'business-setup':
        // Meta's own sentence is accurate here but stops one step short of
        // telling the dealer what to do about it, and this particular one will
        // be the single most common blocker on the catalog step — it fires for
        // every dealer whose Facebook business we are connected to as a system
        // user rather than as one of their admins.
        if (this.subcode === 1690129) {
          return (
            `${this.message} ` +
            'Reconnect with an account that is an admin of that Facebook business, ' +
            'or ask them to make the catalog once in Commerce Manager — we will find it and take it from there.'
          );
        }
        return this.message;
      default:
        return 'Facebook could not complete that request. Try again in a moment.';
    }
  }
}

/**
 * Meta's error taxonomy, narrowed to the cases that change our behaviour.
 * Everything not listed falls through to 'unknown' on purpose — guessing at an
 * unfamiliar code is how a transient becomes a permanent disconnect.
 */
function classify(code: number | null, subcode: number | null, status: number): MetaFailureKind {
  // 190 covers expired, revoked, password-changed and app-uninstalled.
  if (code === 190 || code === 102 || code === 463 || subcode === 463 || subcode === 458) return 'reauth';
  // 4/17/32 = app & user rate limits; 613 = custom-level; 80009 = catalog-specific.
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80009) return 'rate-limit';

  // MUST be tested before the code-10 branch below, and the ordering is the
  // whole point of this line.
  //
  // Subcode 1690129 on a `code: 10` is Meta saying "you aren't an admin of this
  // business", not "this app is unapproved". It is what
  // `POST /{business_id}/owned_product_catalogs` returns to a Business
  // Integration System User: the BISU holds `catalog_management` and is scoped
  // to the assets the dealer ticked, and creating a *new* business-owned object
  // is not an operation on any of them. Meta's own Facebook Login for Business
  // page routes around it — "User access tokens should also be used if you
  // require an API that requires admin permissions on a business portfolio."
  //
  // Falling through to 'permission' cost two days on 6 Aug 2026. The dealer
  // message for 'permission' is "Rooftop is not yet approved by Meta for this
  // action. We are on it — nothing you need to do", which sent the
  // investigation into App Review, where three endpoints disagree with each
  // other and none of them had anything to do with it. 'business-setup' returns
  // Meta's own `error_user_msg` instead, which here is exactly right and
  // exactly actionable.
  //
  // The subcode is undocumented — it appears in no Meta error table — so match
  // on it narrowly and leave bare `code: 10` meaning what it has always meant.
  if (subcode === 1690129) return 'business-setup';

  if (code === 10 || code === 200 || code === 299 || (code !== null && code >= 200 && code <= 299)) {
    return 'permission';
  }
  // 415 = 2FA required on a protected business. 3979/3980 = ad account caps.
  if (code === 415 || code === 3979 || code === 3980 || code === 2310019) return 'business-setup';
  if (code === 100) return 'request';
  if (status >= 500) return 'transport';
  return 'unknown';
}

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

/* ----------------------------------------------------------------- signing */

function appId(): string {
  const v = process.env.META_APP_ID;
  if (!v) throw new MetaApiError('META_APP_ID is not set.', 'request', 500, null, null, null);
  return v;
}

function appSecret(): string {
  const v = process.env.META_APP_SECRET;
  if (!v) throw new MetaApiError('META_APP_SECRET is not set.', 'request', 500, null, null, null);
  return v;
}

/** True when the Meta feature is wired up enough to attempt a call. */
export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_LOGIN_CONFIG_ID);
}

export function loginConfigId(): string | null {
  return process.env.META_LOGIN_CONFIG_ID ?? null;
}

/** HMAC-SHA256 of the access token, keyed by the app secret. */
export function appsecretProof(token: string): string {
  return createHmac('sha256', appSecret()).update(token).digest('hex');
}

/* --------------------------------------------------------------- transport */

export type GraphInit = {
  method?: 'GET' | 'POST' | 'DELETE';
  /** Access token. Omit only for the code-exchange call, which authenticates by app secret. */
  token?: string;
  /** Query params for GET, form body for POST. Meta wants form encoding, not JSON. */
  params?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
};

function clean(params: GraphInit['params']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * One authenticated call. `path` is version-less and leading-slashed:
 * `/me`, `/{id}/owned_product_catalogs`.
 */
export async function graph<T>(path: string, init: GraphInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const params = clean(init.params);

  if (init.token) {
    params.access_token = init.token;
    params.appsecret_proof = appsecretProof(init.token);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);

  const isWrite = method !== 'GET';
  const qs = new URLSearchParams(params).toString();
  const url = `${GRAPH}/${GRAPH_VERSION}${path}${!isWrite && qs ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: isWrite ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
      body: isWrite ? qs : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (err) {
    throw new MetaApiError(
      err instanceof Error && err.name === 'AbortError'
        ? 'Facebook took too long to respond.'
        : 'Could not reach Facebook.',
      'transport',
      504,
      null,
      null,
      null,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new MetaApiError('Facebook returned a response we could not read.', 'unknown', res.status, null, null, null);
  }

  if (!res.ok) {
    const e = (json as MetaErrorBody).error ?? {};
    const code = e.code ?? null;
    const subcode = e.error_subcode ?? null;
    const kind = classify(code, subcode, res.status);

    // THE ONLY PLACE META'S REAL WORDS STILL EXIST.
    //
    // Every caller downstream collapses this into `dealerMessage`, which is
    // deliberately vague — "Rooftop is not yet approved by Meta for this
    // action" — because a dealer cannot act on a Graph subcode. That vagueness
    // is right on screen and useless in an incident: without this line the
    // actual code, subcode and Meta's own wording are discarded and nothing
    // reaches the runtime log. Log it here, once, where we still have all of it.
    //
    // `params` is NEVER logged: it carries `access_token` and
    // `appsecret_proof`. Same rule as `src/lib/domains/vercel.ts` — errors
    // carry Meta's message and code, never the request.
    console.error(
      '[meta] graph error ' +
        JSON.stringify({
          method,
          path,
          status: res.status,
          kind,
          code,
          subcode,
          type: e.type ?? null,
          message: e.message ?? null,
          userMsg: e.error_user_msg ?? null,
          trace: e.fbtrace_id ?? null,
        }),
    );

    throw new MetaApiError(
      // error_user_msg is Meta's own dealer-safe wording when it bothers to send one.
      e.error_user_msg || e.message || `Facebook returned ${res.status}.`,
      kind,
      res.status,
      code,
      subcode,
      e.fbtrace_id ?? null,
    );
  }

  return json as T;
}

/* -------------------------------------------------------------- edge paging */

type Paged<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

/**
 * Walk a Graph edge to the end.
 *
 * Capped at `maxPages` because this runs inside a request and a dealer group
 * with a pathological asset list should degrade to "we found the first 500"
 * rather than hang the connect screen. Cursor paging, not offset — offset
 * paging on Meta edges silently drops and duplicates rows under concurrent
 * writes, which for asset discovery would mean a Page that intermittently
 * vanishes from the picker.
 */
export async function graphEdge<T>(
  path: string,
  init: GraphInit & { fields?: string; limit?: number; maxPages?: number } = {},
): Promise<T[]> {
  const maxPages = init.maxPages ?? 5;
  const out: T[] = [];
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await graph<Paged<T>>(path, {
      ...init,
      params: {
        ...init.params,
        fields: init.fields,
        limit: init.limit ?? 100,
        after,
      },
    });
    out.push(...(res.data ?? []));
    after = res.paging?.cursors?.after;
    if (!after || !res.paging?.next) break;
  }
  return out;
}

/**
 * An edge that is allowed to be forbidden.
 *
 * Asset discovery asks for pages, ad accounts, catalogs and pixels in one pass,
 * and a dealer who granted only some of those — or an app not yet approved for
 * `ads_management` — will 403 on one edge while the others are fine. Treating
 * that as a failed connection would make the whole flow unusable during App
 * Review, which is exactly when we need it working. Rate limits and revoked
 * tokens still throw: those are real, and they affect every edge equally.
 */
export async function graphEdgeOptional<T>(
  path: string,
  init: GraphInit & { fields?: string; limit?: number } = {},
): Promise<{ items: T[]; blocked: MetaFailureKind | null }> {
  try {
    return { items: await graphEdge<T>(path, init), blocked: null };
  } catch (err) {
    if (err instanceof MetaApiError && (err.kind === 'permission' || err.kind === 'business-setup')) {
      return { items: [], blocked: err.kind };
    }
    throw err;
  }
}

/* --------------------------------------------------------- token lifecycle */

export type ExchangedToken = { access_token: string; token_type?: string; expires_in?: number };

/**
 * Swap the authorization `code` from Facebook Login for Business for a token.
 *
 * Authenticates by app id + secret rather than by a token, so no
 * `appsecret_proof` here — there is nothing to prove yet. The code is
 * single-use and short-lived; a retry after a network blip will fail with a
 * 100, which classifies as 'request', and the right recovery is to send the
 * dealer back through the dialog rather than to retry.
 */
export async function exchangeCode(code: string, redirectUri?: string): Promise<ExchangedToken> {
  return graph<ExchangedToken>('/oauth/access_token', {
    params: {
      client_id: appId(),
      client_secret: appSecret(),
      code,
      // Only sent when the flow used a redirect; the JS SDK popup flow omits it.
      redirect_uri: redirectUri,
    },
  });
}

export type DebugToken = {
  data?: {
    app_id?: string;
    type?: string;
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    granular_scopes?: { scope: string; target_ids?: string[] }[];
    user_id?: string;
  };
};

/**
 * Inspect a token: is it live, what did Meta actually grant, when does it die.
 *
 * Called right after exchange, because **the scopes we asked for and the scopes
 * we got are not the same list**. Facebook Login for Business is all-or-nothing
 * on the configuration, but a dealer can still land here with a narrower grant
 * than the happy path assumes, and finding that out at connect time — while
 * they are still sitting in front of the screen — is worth one extra call.
 *
 * `expires_at: 0` means never, which is what a system-user token should return
 * and is the cheapest confirmation we got the token type we wanted.
 */
export async function debugToken(token: string): Promise<DebugToken> {
  return graph<DebugToken>('/debug_token', {
    params: {
      input_token: token,
      access_token: `${appId()}|${appSecret()}`,
    },
  });
}

/**
 * Revoke our own access. Wired to the dealer-facing Disconnect button.
 *
 * Meta's Developer Policy requires that a business can disconnect a tech
 * provider, and doing it in-product rather than making them find it in Business
 * settings is both the compliant answer and the honest one. Best-effort by
 * design: if Meta refuses, we still tear down our side, because a dealer who
 * clicked Disconnect must not be left connected on our end.
 */
export async function revokePermissions(token: string): Promise<boolean> {
  try {
    await graph<{ success?: boolean }>('/me/permissions', { method: 'DELETE', token });
    return true;
  } catch {
    return false;
  }
}
