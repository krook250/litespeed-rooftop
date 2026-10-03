/**
 * Give a rooftop its DealerCenter connection, with the DCID on it.
 *
 * ## Why this is a script and not a migration or a seed
 *
 * The `dealercenter` row in `SEED_CHANNELS` only reaches a database that gets
 * seeded, and `db:seed` refuses a managed host on purpose (`assertSafeToWipe`).
 * Production has therefore never seen the channel and never will by that route.
 * And this is data, not schema, so it is not a migration either.
 *
 * Read-modify-write, idempotent, safe to run twice: the channel is inserted only
 * if its key is absent, and the connection is updated in place when one already
 * exists. Nothing is deleted and no other channel is touched.
 *
 * ## Why the status is SUBMITTED
 *
 * The enum's own doc says SUBMITTED means *we have submitted and the destination
 * has not switched the source over yet*, which is exactly where this stands:
 * the dealer approved the feed, DealerCenter has escalated, and we are waiting
 * on FTP credentials. Not CONNECTED — nothing has ever been sent. Not
 * AWAITING_DEALER — the dealer has done his part.
 *
 * SUBMITTED is inside `DEALERCENTER_FILE_STATUSES`, so the lot becomes eligible
 * for the run and its file becomes previewable. That is the point of running
 * this now, and it is safe because no transport exists yet: `loadDealerCenterRun`
 * builds and returns files, and nothing in the codebase opens an FTP connection.
 *
 * Usage:
 *   npx tsx src/db/connect-dealercenter.ts "Malabar Truck and Trade" 23548716
 */

import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import { SEED_CHANNELS } from './seed-data';

const CHANNEL_KEY = 'dealercenter';

export async function ensureDealerCenterChannel(): Promise<string> {
  const existing = await db
    .select({ id: t.channels.id })
    .from(t.channels)
    .where(eq(t.channels.key, CHANNEL_KEY))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const seed = SEED_CHANNELS.find((c) => c.key === CHANNEL_KEY);
  if (!seed) {
    throw new Error(
      `No '${CHANNEL_KEY}' entry in SEED_CHANNELS. The channel definition lives there so ` +
        'this script and a fresh seed cannot disagree about it.',
    );
  }

  const inserted = await db.insert(t.channels).values(seed).returning({ id: t.channels.id });
  return inserted[0].id;
}

export type ConnectResult = {
  action: 'created' | 'updated' | 'unchanged';
  rooftopId: string;
  rooftopName: string;
  connectionId: string;
  dcid: string;
  status: string;
};

export async function connectDealerCenter(
  rooftopName: string,
  dcid: string,
): Promise<ConnectResult> {
  if (!/^\d+$/.test(dcid)) {
    throw new Error(`DCID "${dcid}" is not all digits. DealerCenter's is numeric, e.g. 23548716.`);
  }

  /**
   * Matched by name rather than by a pasted id, deliberately: a mistyped cuid
   * finds nothing or, worse, finds a different dealership, and this writes a
   * third party's account number onto whatever it finds. A name that matches
   * two rooftops is refused below rather than resolved by picking one.
   */
  const lots = await db
    .select({ id: t.rooftops.id, name: t.rooftops.name })
    .from(t.rooftops)
    .where(eq(t.rooftops.name, rooftopName));

  if (lots.length === 0) {
    // Print the real names rather than just failing — the exact string matters
    // and guessing at it twice is worse than one extra query on the sad path.
    const all = await db
      .select({ name: t.rooftops.name })
      .from(t.rooftops)
      .orderBy(t.rooftops.name);
    throw new Error(
      `No rooftop named exactly "${rooftopName}". Rooftops on this database:\n` +
        all.map((r) => `  ${r.name}`).join('\n'),
    );
  }
  if (lots.length > 1) {
    throw new Error(
      `${lots.length} rooftops are named "${rooftopName}": ${lots.map((l) => l.id).join(', ')}. ` +
        'Refusing to guess which one gets the DCID.',
    );
  }
  const lot = lots[0];

  const channelId = await ensureDealerCenterChannel();

  const prior = (
    await db
      .select({
        id: t.channelConnections.id,
        status: t.channelConnections.status,
        providerDealerId: t.channelConnections.providerDealerId,
      })
      .from(t.channelConnections)
      .where(
        and(
          eq(t.channelConnections.rooftopId, lot.id),
          eq(t.channelConnections.channelId, channelId),
        ),
      )
      .limit(1)
  )[0];

  if (prior) {
    if (prior.providerDealerId === dcid && prior.status === 'SUBMITTED') {
      return {
        action: 'unchanged',
        rooftopId: lot.id,
        rooftopName: lot.name,
        connectionId: prior.id,
        dcid,
        status: prior.status,
      };
    }
    /* `status` is reset to SUBMITTED on purpose. If a later run of this script
     * ever needs to preserve a CONNECTED state, that is a flag to add — not a
     * default to assume, since the only way this row reaches CONNECTED today is
     * somebody setting it by hand. */
    await db
      .update(t.channelConnections)
      .set({ providerDealerId: dcid, status: 'SUBMITTED', submittedAt: new Date() })
      .where(eq(t.channelConnections.id, prior.id));
    return {
      action: 'updated',
      rooftopId: lot.id,
      rooftopName: lot.name,
      connectionId: prior.id,
      dcid,
      status: 'SUBMITTED',
    };
  }

  const created = await db
    .insert(t.channelConnections)
    .values({
      rooftopId: lot.id,
      channelId,
      status: 'SUBMITTED',
      accountLabel: `DCID ${dcid}`,
      providerDealerId: dcid,
      requestedAt: new Date(),
      submittedAt: new Date(),
      internalNote:
        'Inventory feed authorized by the dealer via DealerCenter support, Sep 2026. ' +
        'Waiting on FTP/SFTP credentials from DealerCenter before anything is sent.',
    })
    .returning({ id: t.channelConnections.id });

  return {
    action: 'created',
    rooftopId: lot.id,
    rooftopName: lot.name,
    connectionId: created[0].id,
    dcid,
    status: 'SUBMITTED',
  };
}

async function main() {
  const [name, dcid] = process.argv.slice(2);
  if (!name || !dcid) {
    console.error('usage: npx tsx src/db/connect-dealercenter.ts "<rooftop name>" <DCID>');
    process.exit(1);
  }

  const r = await connectDealerCenter(name, dcid);
  console.log(
    `${r.action}: ${r.rooftopName} (${r.rooftopId}) -> DealerCenter DCID ${r.dcid}, status ${r.status}`,
  );
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
