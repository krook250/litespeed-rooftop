/**
 * The lot's Facebook Page and Instagram account, as something we can post as.
 *
 * Posting uses a Page access token, minted from the group's system-user token
 * (`GET /{page}?fields=access_token`). A page token derived from a system user
 * does not expire, but it is cheap to ask for and asking every time means a
 * Page the dealer un-ticked in Business settings fails here, in words, rather
 * than half way through a carousel.
 */

import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { tokenFor } from '@/lib/meta/connect';
import { graph, MetaApiError } from '@/lib/meta/graph';

/** What posting needs from Meta, beyond what the Ad Desk already asked for. */
export const FACEBOOK_POST_SCOPES = ['pages_manage_posts'] as const;
export const INSTAGRAM_POST_SCOPES = ['instagram_basic', 'instagram_content_publish'] as const;

export type PageIdentity = {
  pageId: string;
  pageName: string;
  pageToken: string;
  igId: string | null;
  igUsername: string | null;
};

export type PageProblem = { error: string; reconnect: boolean };

/** Whether the stored grant covers posting, without calling Meta. For the screen. */
export async function postingGrant(groupId: string) {
  const rows = await db
    .select({ scopes: t.metaConnections.grantedScopes, status: t.metaConnections.status })
    .from(t.metaConnections)
    .where(eq(t.metaConnections.groupId, groupId))
    .limit(1);
  const row = rows[0];
  if (!row || row.status === 'DISCONNECTED') return { connected: false, facebook: false, instagram: false };
  const has = (s: readonly string[]) => s.every((x) => row.scopes.includes(x));
  return {
    connected: true,
    facebook: has(FACEBOOK_POST_SCOPES),
    instagram: has(FACEBOOK_POST_SCOPES) && has(INSTAGRAM_POST_SCOPES),
  };
}

/** The Page id picked for this lot on the Ad Desk, or null. */
export async function lotPageId(groupId: string, rooftopId: string): Promise<string | null> {
  const rows = await db
    .select({ pageId: t.metaRooftopAssets.pageId })
    .from(t.metaRooftopAssets)
    .innerJoin(t.metaConnections, eq(t.metaRooftopAssets.connectionId, t.metaConnections.id))
    .where(and(eq(t.metaConnections.groupId, groupId), eq(t.metaRooftopAssets.rooftopId, rooftopId)))
    .limit(1);
  return rows[0]?.pageId ?? null;
}

export async function pageIdentity(groupId: string, rooftopId: string): Promise<PageIdentity | PageProblem> {
  const conn = await tokenFor(groupId);
  if (!conn) return { error: 'Facebook isn’t connected. Connect it on the Ad Desk.', reconnect: true };
  const pageId = await lotPageId(groupId, rooftopId);
  if (!pageId) return { error: 'No Facebook Page is picked for this lot. Pick one on Ad Desk → Connect.', reconnect: false };

  try {
    const page = await graph<{
      name?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; username?: string };
    }>(`/${pageId}`, {
      token: conn.token,
      params: { fields: 'name,access_token,instagram_business_account{id,username}' },
    });
    if (!page.access_token) {
      return { error: 'Facebook won’t let us post to this Page yet. Click Connect again on the Ad Desk and allow posting.', reconnect: true };
    }
    return {
      pageId,
      pageName: page.name ?? 'your Page',
      pageToken: page.access_token,
      igId: page.instagram_business_account?.id ?? null,
      igUsername: page.instagram_business_account?.username ?? null,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      // Without instagram_basic the nested field can refuse the whole read. Try the Page alone.
      if (err.kind === 'permission') {
        try {
          const page = await graph<{ name?: string; access_token?: string }>(`/${pageId}`, {
            token: conn.token,
            params: { fields: 'name,access_token' },
          });
          if (page.access_token) {
            return { pageId, pageName: page.name ?? 'your Page', pageToken: page.access_token, igId: null, igUsername: null };
          }
        } catch {
          /* fall through */
        }
      }
      return { error: err.dealerMessage, reconnect: err.kind === 'reauth' || err.kind === 'permission' };
    }
    return { error: 'Facebook didn’t answer. Try again in a minute.', reconnect: false };
  }
}
