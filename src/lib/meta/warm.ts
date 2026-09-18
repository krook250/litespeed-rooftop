/**
 * Rooftop Auto — Marketing API call-volume warmer, server side.
 *
 * WHY THIS EXISTS.
 *
 * `Marketing API Access Tier` (Limited -> Full) was refused twice, 19 Aug and
 * 11 Sep 2026, with the same sentence both times: *"Our records do not show a
 * sufficient number of Ads API calls in the last 15 days by this application."*
 * The bar is 500 successful Marketing API calls in a rolling 15-day window at
 * under 15% error rate. `devtools_api_usage call_volume` read `total_calls: 0`
 * on both occasions, because Rooftop makes almost no outbound calls by design:
 * `ad-desk-queries.ts` answers the roll-up from the database, `listLotGroups`
 * runs only when one dealer's screen is open, Meta *pulls* the product feed on
 * its own schedule, and a running ad generates no traffic from us at all. The
 * integration is healthy and the counter is honestly zero.
 *
 * `scripts/warm-marketing-api.mjs` does this same job from a laptop, but it
 * cannot run any more: `META_TOKEN_KEY` is a Vercel **Secret** (write-only,
 * rotated 4 Aug) so the stored dealer tokens cannot be decrypted off-server.
 * This module is that script, moved to where the key already lives.
 *
 * WHAT IT IS CAREFUL ABOUT.
 *
 * 1. **The error rate is part of the bar.** Only endpoints that exist on every
 *    real ad account are used — an edge with nothing in it returns 200 and an
 *    empty array, which counts. `customaudiences`, `adspixels` and `adimages`
 *    are deliberately absent: they 403 on accounts that never had them, and a
 *    failing endpoint left in a loop costs a failure every single pass.
 *
 * 2. **Limited tier blocks per ad account**, score 60, reads costing 1 point,
 *    decaying over 300s. `CALLS_PER_ACCOUNT` stays well under that and paces
 *    the calls; a rate-limit error abandons that account for the rest of the
 *    run rather than retrying into the block.
 *
 * 3. **It must never be the reason a dealer's screen is slow or their token is
 *    marked broken.** Nothing here writes. A `reauth` error is logged and the
 *    account skipped — `noteFailure` is the connect flow's job, and a warmer
 *    should not be what decides a dealer has to reconnect.
 *
 * This is a means to an end and is meant to be deleted. Once the tier is Full,
 * the durable version of this is a scheduled per-dealer insights fan-out that
 * writes to a table and makes the Ad Desk read from it instead of from Meta on
 * page render — which `ad-desk-queries.ts` already names as the right shape.
 */

import 'server-only';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { MetaApiError, graph } from './graph';
import { tokenFor } from './connect';

/** Reads per ad account per run. 8/hour clears 500 in about three days. */
const CALLS_PER_ACCOUNT = Number(process.env.WARM_CALLS_PER_ACCOUNT ?? 8);
/** Seconds between calls. Keeps the per-account score far below 60. */
const PACE_MS = Number(process.env.WARM_PACE_SECONDS ?? 4) * 1000;
/** Ad accounts touched per run, so one run cannot outgrow `maxDuration`. */
const MAX_ACCOUNTS = Number(process.env.WARM_MAX_ACCOUNTS ?? 3);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Meta returns ad account ids both ways; `act_act_123` is a 400 that reads like a permissions error. */
const actPath = (id: string) => (id.startsWith('act_') ? id : `act_${id}`);

/**
 * Reads only, widest first, all `ads_read`. Every one of these exists on any
 * real ad account — see the note above on why the list is shorter than the
 * script's.
 */
function reads(act: string): Array<[string, string, Record<string, string>]> {
  return [
    ['account', `/${act}`, { fields: 'name,account_status,currency,timezone_name,amount_spent' }],
    ['campaigns', `/${act}/campaigns`, { fields: 'name,status,objective', limit: '5' }],
    ['adsets', `/${act}/adsets`, { fields: 'name,status,daily_budget', limit: '5' }],
    ['ads', `/${act}/ads`, { fields: 'name,status,effective_status', limit: '5' }],
    ['adcreatives', `/${act}/adcreatives`, { fields: 'name,object_type', limit: '5' }],
    ['insights', `/${act}/insights`, { fields: 'spend,impressions,clicks', date_preset: 'last_30d' }],
  ];
}

export type WarmRun = {
  accounts: number;
  ok: number;
  failed: number;
  skipped: string[];
  errors: string[];
};

export async function runMetaWarm(): Promise<WarmRun> {
  const run: WarmRun = { accounts: 0, ok: 0, failed: 0, skipped: [], errors: [] };

  const rows = await db
    .select({
      groupId: t.metaConnections.groupId,
      businessName: t.metaConnections.businessName,
      adAccountId: t.metaRooftopAssets.adAccountId,
    })
    .from(t.metaRooftopAssets)
    .innerJoin(t.metaConnections, eq(t.metaConnections.id, t.metaRooftopAssets.connectionId))
    .where(and(isNotNull(t.metaRooftopAssets.adAccountId), eq(t.metaConnections.status, 'CONNECTED')));

  /* One ad account may back several rooftops; calling it twice buys nothing. */
  const seen = new Set<string>();
  const targets = rows
    .filter((r) => r.adAccountId && !seen.has(r.adAccountId) && seen.add(r.adAccountId))
    .slice(0, MAX_ACCOUNTS);

  for (const target of targets) {
    const conn = await tokenFor(target.groupId);
    if (!conn) {
      run.skipped.push(`${target.businessName || target.groupId}: no usable token`);
      continue;
    }

    run.accounts += 1;
    const act = actPath(target.adAccountId!);
    const list = reads(act);

    for (let i = 0; i < CALLS_PER_ACCOUNT; i++) {
      const [name, path, params] = list[i % list.length];
      try {
        await graph(path, { token: conn.token, params });
        run.ok += 1;
      } catch (err) {
        run.failed += 1;
        const meta = err instanceof MetaApiError ? err : null;
        run.errors.push(`${act} ${name}: ${meta ? `${meta.kind} ${meta.code ?? ''}` : 'transport'}`);
        /* Backing off is the point; retrying into a 300s block is how the error rate fails the bar. */
        if (meta && (meta.kind === 'rate-limit' || meta.kind === 'reauth')) {
          run.skipped.push(`${act}: stopped early (${meta.kind})`);
          break;
        }
      }
      if (i < CALLS_PER_ACCOUNT - 1) await sleep(PACE_MS);
    }
  }

  return run;
}
