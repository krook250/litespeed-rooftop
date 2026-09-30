import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq, like } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { DEALERCENTER_CHANNEL_KEY, loadDealerCenterRun } from './feed';
import { guardDealerCenterFile } from './feed-spec';
import { ftpConfigured, uploadDealerCenterFile } from './transport';

/**
 * One scheduled push of the DealerCenter files, start to finish.
 *
 * The three pieces below it refuse to know about each other: `feed.ts` builds
 * bytes, `transport.ts` moves bytes, `feed-spec.ts` decides whether bytes are
 * safe. This is the only file with an opinion about the whole run, and the only
 * one that writes to `feed_uploads`.
 *
 * ONE FILE PER DEALER, unlike the CarGurus run. Each dealer gets its own upload,
 * its own guard against its own previous file, and its own `feed_uploads` row —
 * so one dealer's bad night never suppresses another's good one. The run as a
 * whole only fails if every dealer failed.
 *
 * EVERY PATH LEAVES A ROW. A run that decided not to upload is indistinguishable
 * from a scheduler that never fired unless it says so, and "the cron is broken"
 * versus "the cron refused on purpose" is a twenty-minute difference at the wrong
 * end of a call with a dealer.
 *
 * WHAT MAKES THIS DORMANT TODAY. Nothing here is switched off by a flag. The
 * gate is `DEALERCENTER_FILE_STATUSES`, which no longer contains `SUBMITTED`, so
 * a mapped-but-unapproved dealer is simply not in `loadDealerCenterRun`'s list
 * and this loop has nothing to do. Cutover is that dealer's connection moving to
 * `CONNECTED`. See the comment on that constant.
 */

export type DealerCenterFileRun = {
  rooftopId: string;
  rooftopName: string;
  dcid: string;
  filename: string;
  status: 'UPLOADED' | 'SKIPPED' | 'FAILED';
  rows: number;
  excluded: number;
  message: string | null;
  /** True when this file is byte-identical to the last one that landed. */
  unchanged: boolean;
};

export type DealerCenterRunResult = {
  /** Rooftops eligible by connection state. Zero is the normal pre-cutover state. */
  considered: number;
  uploaded: number;
  skipped: number;
  failed: number;
  files: DealerCenterFileRun[];
  warnings: string[];
};

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * The last file that actually landed for this dealer.
 *
 * Found by filename prefix rather than by a rooftop column, because
 * `feed_uploads` has no rooftop of its own — it was built for one combined
 * CarGurus file. The DCID prefix is exact here: `dcFilename` is the only thing
 * that builds these names and the transport refuses any other shape, so
 * `23548716_%` cannot match another dealer's row.
 *
 * Failed and skipped runs are deliberately not a baseline. Comparing tonight
 * against a file that never arrived would let one bad night quietly lower the
 * bar for the next.
 */
/** Looked up once per run rather than inlined as a subquery — plain and cheap. */
let channelIdCache: string | null | undefined;
async function dealerCenterChannelId(): Promise<string | null> {
  if (channelIdCache !== undefined) return channelIdCache;
  const row = (
    await db
      .select({ id: t.channels.id })
      .from(t.channels)
      .where(eq(t.channels.key, DEALERCENTER_CHANNEL_KEY))
      .limit(1)
  )[0];
  channelIdCache = row?.id ?? null;
  return channelIdCache;
}

async function lastUploadFor(dcid: string) {
  return (
    await db
      .select()
      .from(t.feedUploads)
      .where(
        and(
          eq(t.feedUploads.channelKey, DEALERCENTER_CHANNEL_KEY),
          eq(t.feedUploads.status, 'UPLOADED'),
          like(t.feedUploads.filename, `${dcid}_%`),
        ),
      )
      .orderBy(desc(t.feedUploads.startedAt))
      .limit(1)
  )[0];
}

/**
 * Build, guard, upload and record every eligible dealer's file.
 *
 * `force` skips the short-file guard and nothing else — see
 * `guardDealerCenterFile`. It is for the night a dealer genuinely wholesaled half
 * the lot. Never wire it to a retry.
 */
export async function runDealerCenterUpload(
  opts: { force?: boolean; now?: Date } = {},
): Promise<DealerCenterRunResult> {
  const now = opts.now ?? new Date();
  // Per-run, not per-process: a long-lived lambda must not cache a channel id
  // across a seed or a rename.
  channelIdCache = undefined;
  const run = await loadDealerCenterRun(now);

  const files: DealerCenterFileRun[] = [];
  const configured = ftpConfigured();

  for (const feed of run.files) {
    const startedAt = new Date();
    const contentHash = sha256(feed.csv);
    const previous = await lastUploadFor(feed.dcid);
    const unchanged = previous?.contentHash === contentHash;

    const base = {
      channelKey: DEALERCENTER_CHANNEL_KEY,
      filename: feed.filename || `no-dcid-${feed.rooftopId}`,
      startedAt,
      lotCount: 1,
      rowCount: feed.counts.sent,
      excludedCount: feed.counts.excluded,
      contentHash,
      lots: [
        {
          rooftopId: feed.rooftopId,
          rooftopName: feed.rooftopName,
          sent: feed.counts.sent,
          excluded: feed.counts.excluded,
        },
      ],
      warnings: feed.blocker ? [feed.blocker] : [],
    };

    const record = async (
      status: 'UPLOADED' | 'SKIPPED' | 'FAILED',
      message: string | null,
      bytes = 0,
    ) => {
      await db.insert(t.feedUploads).values({
        ...base,
        status,
        message,
        bytes,
        rawBytes: Buffer.byteLength(feed.csv, 'utf8'),
        finishedAt: new Date(),
      });
      files.push({
        rooftopId: feed.rooftopId,
        rooftopName: feed.rooftopName,
        dcid: feed.dcid,
        filename: base.filename,
        status,
        rows: feed.counts.sent,
        excluded: feed.counts.excluded,
        message,
        unchanged,
      });
    };

    // The loader's own refusals: no DCID, not a carrying connection, empty file.
    if (feed.blocker) {
      await record('SKIPPED', feed.blocker);
      continue;
    }

    // Checked after the blocker but before the guard: with no credentials there
    // is no upload to be unsafe, and telling somebody who has not been issued an
    // FTP account that their lot nearly got delisted is a wild goose chase.
    if (!configured) {
      await record('SKIPPED', 'DealerCenter FTP is not configured yet — nothing was sent.');
      continue;
    }

    const verdict = guardDealerCenterFile(
      { sent: feed.counts.sent },
      previous ? { sent: previous.rowCount } : null,
      { force: opts.force },
    );
    if (!verdict.ok) {
      await record('SKIPPED', verdict.reason);
      continue;
    }

    const res = await uploadDealerCenterFile(feed.csv, feed.filename);
    if (!res.ok) {
      await record('FAILED', res.error);
      continue;
    }

    /* The dealer-facing "last synced". `feed_uploads` is not reachable from a
     * tenant, so without this the dealer's own screen has nothing to show. */
    const channelId = await dealerCenterChannelId();
    if (channelId) {
      await db
        .update(t.channelConnections)
        .set({ lastSyncAt: res.finishedAt, errorMessage: null })
        .where(
          and(
            eq(t.channelConnections.rooftopId, feed.rooftopId),
            eq(t.channelConnections.channelId, channelId),
          ),
        );
    }

    await record(
      'UPLOADED',
      unchanged ? 'Identical to the previous file; sent anyway to keep the feed alive.' : null,
      res.bytes,
    );
  }

  return {
    considered: run.considered,
    uploaded: files.filter((f) => f.status === 'UPLOADED').length,
    skipped: files.filter((f) => f.status === 'SKIPPED').length,
    failed: files.filter((f) => f.status === 'FAILED').length,
    files,
    warnings: run.warnings,
  };
}
