import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { CARGURUS_CHANNEL_KEY, loadCarGurusBatch } from './feed';
import { guardBatch, type CgGuardInput } from './feed-spec';
import { feedFilename, ftpConfigured, uploadCarGurusFeed } from './transport';

/**
 * One scheduled push of the CarGurus file, start to finish.
 *
 * The three pieces below it each refuse to know about the others: `feed.ts`
 * builds bytes, `transport.ts` moves bytes, `feed-spec.ts` decides whether
 * bytes are safe. This is the only file that has an opinion about the whole
 * run, and the only one that writes to `feed_uploads`.
 *
 * EVERY PATH THROUGH HERE LEAVES A ROW. A run that decided not to upload is
 * indistinguishable from a scheduler that never fired unless it says so, and
 * "the cron is broken" versus "the cron refused on purpose" is a twenty-minute
 * difference at the wrong end of a phone call with a dealer.
 */

export type CarGurusRun = {
  status: 'UPLOADED' | 'SKIPPED' | 'FAILED';
  filename: string;
  lots: number;
  rows: number;
  excluded: number;
  message: string | null;
  warnings: string[];
  /** True when the file is byte-identical to the last one that landed. */
  unchanged: boolean;
};

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** The last file that actually landed. Failed and skipped runs are not a baseline. */
async function lastUpload() {
  return (
    await db
      .select()
      .from(t.feedUploads)
      .where(
        and(
          eq(t.feedUploads.channelKey, CARGURUS_CHANNEL_KEY),
          eq(t.feedUploads.status, 'UPLOADED'),
        ),
      )
      .orderBy(desc(t.feedUploads.startedAt))
      .limit(1)
  )[0];
}

/**
 * Build, guard, upload, record.
 *
 * `force` skips the short-file guard and nothing else. It exists for the one
 * legitimate case the guard cannot distinguish from a fault: a dealer was
 * deliberately disconnected, so their cars *should* leave the file. That is an
 * intentional act, and an intentional act can afford to be confirmed by a human.
 * Never wire it to a retry.
 */
export async function runCarGurusUpload(opts: { force?: boolean } = {}): Promise<CarGurusRun> {
  const startedAt = new Date();
  const filename = feedFilename(startedAt);

  const batch = await loadCarGurusBatch();
  const contentHash = sha256(batch.csv);
  const previous = await lastUpload();
  const unchanged = previous?.contentHash === contentHash;

  const base = {
    channelKey: CARGURUS_CHANNEL_KEY,
    filename,
    startedAt,
    lotCount: batch.considered,
    rowCount: batch.totals.sent,
    excludedCount: batch.totals.excluded,
    contentHash,
    lots: batch.lots.map((l) => ({
      rooftopId: l.rooftopId,
      rooftopName: l.rooftopName,
      sent: l.sent,
      excluded: l.excluded,
    })),
    warnings: batch.warnings,
  };

  const record = async (
    status: 'UPLOADED' | 'SKIPPED' | 'FAILED',
    message: string | null,
    extra: { bytes?: number; rawBytes?: number } = {},
  ): Promise<CarGurusRun> => {
    await db.insert(t.feedUploads).values({
      ...base,
      status,
      message,
      bytes: extra.bytes ?? 0,
      rawBytes: extra.rawBytes ?? 0,
      finishedAt: new Date(),
    });
    return {
      status,
      filename,
      lots: batch.considered,
      rows: batch.totals.sent,
      excluded: batch.totals.excluded,
      message,
      warnings: batch.warnings,
      unchanged,
    };
  };

  // Checked before the guard on purpose: with no credentials there is no upload
  // to be unsafe, and reporting "would have delisted Bravo Cars" to somebody who
  // simply has not been issued an FTP account yet is a wild goose chase.
  if (!ftpConfigured()) {
    return record('SKIPPED', 'CarGurus FTP is not configured yet — nothing was sent.');
  }

  const current: CgGuardInput = { lots: batch.lots, sent: batch.totals.sent };
  const baseline: CgGuardInput | null = previous
    ? { lots: (previous.lots ?? []).map((l) => ({ ...l })), sent: previous.rowCount }
    : null;

  // Note this passes `force` INTO the guard rather than skipping it. The floor —
  // never send an empty file — is not forceable; see `guardBatch`.
  const verdict = guardBatch(current, baseline, { force: opts.force });
  if (!verdict.ok) {
    return record('SKIPPED', verdict.reason);
  }

  const res = await uploadCarGurusFeed(batch.csv, { filename });
  if (!res.ok) {
    return record('FAILED', res.error);
  }

  // Stamp the connections we actually sent for. This is the scoped, dealer-facing
  // "last synced" — `feed_uploads` is not reachable from a tenant.
  const ids = batch.lots.map((l) => l.rooftopId);
  if (ids.length) {
    const conns = await db
      .select({ id: t.channelConnections.id })
      .from(t.channelConnections)
      .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
      .where(
        and(
          eq(t.channels.key, CARGURUS_CHANNEL_KEY),
          inArray(t.channelConnections.rooftopId, ids),
        ),
      );
    if (conns.length) {
      await db
        .update(t.channelConnections)
        .set({ lastSyncAt: res.finishedAt })
        .where(inArray(t.channelConnections.id, conns.map((c) => c.id)));
    }
  }

  return record(
    'UPLOADED',
    unchanged ? 'Identical to the previous file; sent anyway to keep the feed alive.' : null,
    { bytes: res.bytes, rawBytes: res.rawBytes },
  );
}
