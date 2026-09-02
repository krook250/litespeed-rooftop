import 'server-only';

import { and, eq, gt, isNull, desc } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import type { OutboundEmail } from '@/lib/email';

/**
 * Staff invitations.
 *
 * Deliberately not a Better Auth plugin. The org plugin models organisations
 * as a thing a user can belong to several of, and this app is single-tenant per
 * user by construction — `users.groupId` is NOT NULL and every scope in
 * `scoped-db.ts` derives from it. Bolting on a membership model to get an
 * invite email would mean two competing ideas of who belongs where.
 */

/** A week. Long enough to survive a weekend and a forgotten inbox, short enough to matter. */
const TTL_DAYS = 7;

export function inviteToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function inviteExpiry(): Date {
  return new Date(Date.now() + TTL_DAYS * 86_400_000);
}

/**
 * The one an accepting signup is checked against.
 *
 * Every condition is in the WHERE clause rather than fetched and then checked,
 * so there is no window where a revoked or expired invite is briefly treated as
 * valid by a caller that forgot a branch.
 */
export async function findLiveInvite(token: string) {
  if (!token || token.length !== 64) return null;
  const [row] = await db
    .select({
      id: t.invites.id,
      groupId: t.invites.groupId,
      email: t.invites.email,
      role: t.invites.role,
      expiresAt: t.invites.expiresAt,
      groupName: t.dealerGroups.name,
    })
    .from(t.invites)
    .innerJoin(t.dealerGroups, eq(t.invites.groupId, t.dealerGroups.id))
    .where(
      and(
        eq(t.invites.token, token),
        isNull(t.invites.acceptedAt),
        isNull(t.invites.revokedAt),
        gt(t.invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Everything an owner should see on the People screen, newest first. */
export async function pendingInvites(groupId: string) {
  return db
    .select({
      id: t.invites.id,
      email: t.invites.email,
      role: t.invites.role,
      createdAt: t.invites.createdAt,
      expiresAt: t.invites.expiresAt,
    })
    .from(t.invites)
    .where(
      and(
        eq(t.invites.groupId, groupId),
        isNull(t.invites.acceptedAt),
        isNull(t.invites.revokedAt),
      ),
    )
    .orderBy(desc(t.invites.createdAt));
}

export function inviteUrl(token: string, host: string | null): string {
  return `https://${host ?? 'app.rooftopauto.com'}/invite/${token}`;
}

/**
 * The email.
 *
 * Says who invited them and to which dealership, because the first question a
 * person has about an unexpected account link is "is this real". A bare "you
 * have been invited" from a name they do not recognise gets deleted.
 */
export function inviteEmail(opts: {
  to: string;
  url: string;
  dealership: string;
  inviterName: string;
  roleLabel: string;
}): OutboundEmail {
  const { to, url, dealership, inviterName, roleLabel } = opts;
  const subject = `${inviterName} added you to ${dealership} on Rooftop Auto`;
  const line = `${inviterName} set you up as ${roleLabel} at ${dealership}.`;

  return {
    to,
    subject,
    text: [
      line,
      '',
      'Set your password and you are in:',
      url,
      '',
      `This link works for seven days and only for ${to}.`,
      'If you were not expecting this, you can ignore it — nothing happens until you use the link.',
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18202c">
        <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${escapeHtml(line)}</p>
        <p style="margin:0 0 24px">
          <a href="${url}" style="display:inline-block;background:#2C6FD8;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 20px;border-radius:8px">Set your password</a>
        </p>
        <p style="font-size:13px;line-height:1.5;color:#66748c;margin:0 0 6px">
          This link works for seven days and only for ${escapeHtml(to)}.
        </p>
        <p style="font-size:13px;line-height:1.5;color:#66748c;margin:0">
          If you were not expecting this you can ignore it — nothing happens until you use the link.
        </p>
      </div>`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
