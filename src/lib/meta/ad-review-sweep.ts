/**
 * Finds ads Facebook has rejected or flagged, and says so before Meta's email
 * does.
 *
 * Why it exists: on 15 Oct 2026 both of Malabar's ads were disapproved and the
 * first anyone heard was Meta's notification. The ad desk showed it only if
 * somebody happened to open the page.
 *
 * Per rejection, once: a red card on that dealer's feed, and an email to
 * `OPS_ALERT_EMAIL` when it is set. The dedupe key carries the creative id, so
 * the card does not repeat every run — but an ad that is fixed (Update makes a
 * fresh creative) and rejected AGAIN gets a new card, which is the one that
 * matters most.
 *
 * Reads only. Never pauses, edits or resubmits anything.
 */
import 'server-only';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { emitFeedEvent } from '@/lib/feed';
import { sendEmail } from '@/lib/email';
import { tokenFor } from './connect';
import { listLotGroups } from './campaigns';
import { adState } from './ad-status';

export type AdReviewRun = {
  lots: number;
  flagged: number;
  alerted: number;
  skipped: string[];
  errors: string[];
};

const AD_DESK = '/admin/ad-desk/ads';

export async function runAdReviewSweep(): Promise<AdReviewRun> {
  const run: AdReviewRun = { lots: 0, flagged: 0, alerted: 0, skipped: [], errors: [] };

  const rows = await db
    .select({
      rooftopId: t.metaRooftopAssets.rooftopId,
      adAccountId: t.metaRooftopAssets.adAccountId,
      groupId: t.metaConnections.groupId,
      dealerName: t.rooftops.name,
    })
    .from(t.metaRooftopAssets)
    .innerJoin(t.metaConnections, eq(t.metaConnections.id, t.metaRooftopAssets.connectionId))
    .innerJoin(t.rooftops, eq(t.rooftops.id, t.metaRooftopAssets.rooftopId))
    .where(and(isNotNull(t.metaRooftopAssets.adAccountId), eq(t.metaConnections.status, 'CONNECTED')));

  const opsEmail = process.env.OPS_ALERT_EMAIL?.trim() || null;
  const appOrigin = `https://${process.env.NEXT_PUBLIC_APP_HOST ?? 'app.rooftopauto.com'}`;

  for (const r of rows) {
    const conn = await tokenFor(r.groupId);
    if (!conn) {
      run.skipped.push(`${r.dealerName}: no usable token`);
      continue;
    }

    let groups;
    try {
      ({ groups } = await listLotGroups(conn.token, r.adAccountId!, r.dealerName));
    } catch (err) {
      run.errors.push(`${r.dealerName}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    run.lots += 1;

    for (const g of groups) {
      for (const ad of g.ads) {
        const state = adState(ad.effectiveStatus);
        if (state !== 'rejected' && state !== 'issues') continue;
        run.flagged += 1;

        const rejected = state === 'rejected';
        const reason = ad.review ?? 'Facebook did not say why. The ad desk has the details.';
        const card = await emitFeedEvent({
          rooftopId: r.rooftopId,
          kind: 'sync_error',
          actorId: null,
          title: rejected
            ? `Facebook rejected the ad "${ad.name}"`
            : `Facebook flagged a problem with the ad "${ad.name}"`,
          body:
            `${reason} It is in the group "${g.name}". Fix it in the ad desk and press ` +
            `Update on Facebook — that sends it back for review.`,
          stats: [
            { k: 'Ad', v: ad.name, bad: true },
            { k: 'Status', v: rejected ? 'Rejected' : 'Flagged', bad: true },
            { k: 'Group', v: g.name },
          ],
          dedupeKey: `ad-review:${ad.id}:${ad.creativeId ?? 'none'}:${state}`,
        });

        // Null means this exact rejection was already reported.
        if (!card) continue;
        run.alerted += 1;

        if (opsEmail) {
          const subject = `${r.dealerName}: Facebook ${rejected ? 'rejected' : 'flagged'} "${ad.name}"`;
          const text =
            `${r.dealerName} — ad "${ad.name}" in group "${g.name}".\n\n` +
            `Facebook says: ${reason}\n\n${appOrigin}${AD_DESK}`;
          await sendEmail({
            to: opsEmail,
            subject,
            text,
            html:
              `<p><strong>${esc(r.dealerName)}</strong> — ad “${esc(ad.name)}” in group “${esc(g.name)}”.</p>` +
              `<p>Facebook says: ${esc(reason)}</p>` +
              `<p><a href="${appOrigin}${AD_DESK}">Open the ad desk</a></p>`,
          });
        }
      }
    }
  }

  return run;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
