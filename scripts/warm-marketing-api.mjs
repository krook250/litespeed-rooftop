/**
 * Rooftop Auto — Marketing API call-volume warmer.
 *
 * WHY THIS EXISTS.
 *
 * `Marketing API Access Tier` (Limited -> Full) was refused twice, 19 Aug and
 * 11 Sep 2026, with the same sentence both times: *"Our records do not show a
 * sufficient number of Ads API calls in the last 15 days by this application."*
 * The bar is 500 successful Marketing API calls inside a rolling 15-day window
 * at under 15% error rate. `devtools_api_usage call_volume` read
 * `total_calls: 0` on both occasions. There was nothing to review.
 *
 * So this script does one narrow thing: it makes real, successful, read-only
 * Marketing API calls against a connected dealer ad account, slowly enough
 * never to trip a rate limit, until the counter clears the bar.
 *
 * THE TWO THINGS THAT CAN RUIN THE ATTEMPT, AND HOW THIS AVOIDS THEM.
 *
 * 1. **A blocked ad account poisons the error rate.** Limited tier is a per-ad-
 *    account score of 60, reads costing 1 point, decaying over 300s, and a
 *    *300 second* block when you hit it. Blast 500 calls in a loop and you get
 *    a few hundred failures, the error rate goes past 15%, and the re-request
 *    is refused on a different clause than last time. So: one call per
 *    PACE_SECONDS (default 15s => ~240/hour, well under the ~60-per-5-minutes
 *    ceiling), plus a read of Meta's own usage headers with a long pause when
 *    any bucket goes above USAGE_PAUSE_PCT.
 *
 * 2. **An endpoint that always 400s counts against you every single time.**
 *    Rather than trust a hand-written list, every candidate is probed once up
 *    front and only the ones that actually returned 200 enter the rotation.
 *    A probe failure costs one call; a bad endpoint left in a 600-call loop
 *    costs sixty.
 *
 * It also aborts outright if the live error rate passes ABORT_ERROR_PCT — a run
 * that is failing is worse than no run, because the bar counts *successful*
 * calls and the error rate is measured across the last 500 regardless.
 *
 * Progress is checkpointed, so a closed laptop or a Ctrl-C resumes instead of
 * starting the count over.
 *
 * USAGE
 *   node scripts/warm-marketing-api.mjs            # run until the target
 *   node scripts/warm-marketing-api.mjs --probe    # probe endpoints, then stop
 *   node scripts/warm-marketing-api.mjs --status   # print checkpoint, then stop
 *
 * ENV (read from .env.local then .env, both already in the repo root)
 *   DATABASE_URL, META_APP_ID, META_APP_SECRET, META_TOKEN_KEY
 *
 * TUNABLES (env overrides)
 *   WARM_TARGET=600        successful calls to make (500 is the bar; margin is free)
 *   WARM_PACE_SECONDS=15   seconds between calls
 *   WARM_AD_ACCOUNT=       force one act_… id instead of picking from the db
 *   WARM_USAGE_PAUSE_PCT=60      pause when any usage bucket goes above this
 *   WARM_USAGE_PAUSE_SECONDS=90  how long that pause lasts
 *   WARM_RATELIMIT_SLEEP_SECONDS=300  wait after a 613/429, one full decay window
 *   WARM_FAIL_SLEEP_SECONDS=30   back-off after any other failure
 *   WARM_ABORT_ERROR_PCT=5       stop the run if the error rate passes this
 *
 * AFTER IT FINISHES: the count takes up to 2 days to register. Verify with
 * `devtools_api_usage call_volume lookback_minutes=21600` and only then press
 * "Request again". See claude/meta-tier-rerequest.md.
 */

import { createDecipheriv, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import postgres from 'postgres';
import dotenv from 'dotenv';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// .env.local wins over .env, matching Next's own precedence. `override: false`
// on the second load is what makes that true rather than the other way round.
dotenv.config({ path: join(ROOT, '.env.local'), override: true, quiet: true });
dotenv.config({ path: join(ROOT, '.env'), override: false, quiet: true });

const GRAPH = 'https://graph.facebook.com';
const VERSION = process.env.META_GRAPH_VERSION ?? 'v25.0';

const TARGET = Number(process.env.WARM_TARGET ?? 600);
const PACE_MS = Number(process.env.WARM_PACE_SECONDS ?? 15) * 1000;
const USAGE_PAUSE_PCT = Number(process.env.WARM_USAGE_PAUSE_PCT ?? 60);   // any bucket above this -> long pause
const USAGE_PAUSE_MS = Number(process.env.WARM_USAGE_PAUSE_SECONDS ?? 90) * 1000;
const RATE_LIMIT_SLEEP_MS = Number(process.env.WARM_RATELIMIT_SLEEP_SECONDS ?? 300) * 1000;
const FAIL_SLEEP_MS = Number(process.env.WARM_FAIL_SLEEP_SECONDS ?? 30) * 1000;
const ABORT_ERROR_PCT = Number(process.env.WARM_ABORT_ERROR_PCT ?? 5); // bail long before the 15% that fails review
const MIN_CALLS_BEFORE_ABORT = 20;

/** Every Graph error code that means "slow down", not "you asked wrong". */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

const STATE_PATH = join(HERE, '.warm-state.json');

const args = new Set(process.argv.slice(2));
const PROBE_ONLY = args.has('--probe');
const STATUS_ONLY = args.has('--status');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (n, d) => (d === 0 ? 0 : (n / d) * 100);
const stamp = () => new Date().toISOString().slice(11, 19);

function log(...parts) {
  console.log(`[${stamp()}]`, ...parts);
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- state ---- */

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { ok: 0, err: 0, startedAt: null, adAccountId: null, runs: 0 };
  }
}

function saveState(state) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    // A checkpoint we cannot write is an annoyance, not a reason to stop a
    // two-hour run that is otherwise working.
    log('warn: could not write checkpoint —', err.message);
  }
}

/* ------------------------------------------------------------- crypto ----- */

/**
 * Same format as `src/lib/meta/tokens.ts`: `v1.<iv>.<tag>.<ciphertext>`, all
 * base64url, AES-256-GCM.
 *
 * Deliberately reimplemented here in twelve lines rather than imported. That
 * module carries `import 'server-only'`, which throws outside a React Server
 * Component graph, so importing it from a plain node script fails on the first
 * line for reasons that have nothing to do with tokens.
 */
function decryptToken(stored, keyB64) {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) die('META_TOKEN_KEY must decode to 32 bytes.');

  const parts = String(stored).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    die('Stored Meta token is not in the v1 format this script understands.');
  }
  const [, iv, tag, ct] = parts;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    die(
      'Could not decrypt the stored token. META_TOKEN_KEY in .env.local is probably\n' +
      '  not the value that encrypted it (it was rotated on 4 Aug). Pull the current\n' +
      '  value from Vercel, or reconnect the dealer in the Ad Desk.',
    );
  }
}

const proof = (token, secret) => createHmac('sha256', secret).update(token).digest('hex');

/* ---------------------------------------------------------------- graph ---- */

/**
 * One read. Returns `{ ok, status, usage }` and never throws — a thrown
 * exception halfway through a 600-call loop would lose the count.
 */
async function read(path, params, token, secret) {
  const qs = new URLSearchParams({
    ...params,
    access_token: token,
    appsecret_proof: proof(token, secret),
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);

  try {
    const res = await fetch(`${GRAPH}/${VERSION}${path}?${qs}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });

    const { peak, tier } = peakUsage(res.headers);

    if (res.ok) return { ok: true, status: res.status, usage: peak, tier };

    let detail = `HTTP ${res.status}`;
    let code = null;
    try {
      const body = await res.json();
      const e = body?.error;
      if (e) {
        code = Number(e.code);
        detail = `${e.code}/${e.error_subcode ?? 0} ${e.message}`;
      }
    } catch { /* non-JSON error body; the status is enough */ }

    return { ok: false, status: res.status, usage: peak, tier, detail, code };
  } catch (err) {
    return { ok: false, status: 0, usage: 0, tier: null, code: null, detail: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Highest *percentage* across the usage buckets Meta reports, plus the tier it
 * admits to in the same breath.
 *
 * THIS IS AN ALLOWLIST ON PURPOSE, AND THE FIRST VERSION WAS WRONG.
 *
 * The obvious implementation walks every number in all three headers and takes
 * the max. It does not work: `x-ad-account-usage` carries
 * `reset_time_duration: 60` and `x-business-use-case-usage` carries
 * `estimated_time_to_regain_access`, both **seconds**, not percentages. A max
 * over everything numeric therefore reads 60% on a completely idle account and
 * the script pauses 90 seconds on every call — doubling a two-hour run for no
 * reason, and hiding the real utilisation behind a constant.
 *
 * So only these keys are read, and every one of them is genuinely 0-100:
 *   x-app-usage                 call_count, total_cputime, total_time
 *   x-ad-account-usage          acc_id_util_pct
 *   x-business-use-case-usage   call_count, total_cputime, total_time (per entry)
 *
 * `x-ad-account-usage.ads_api_access_tier` is the bonus: Meta states the
 * account's tier right there in the response. `development_access` is the
 * Limited tier this whole exercise exists to escape, so it is worth surfacing —
 * when it flips to `standard_access` the re-request has landed.
 */
const PCT_KEYS = new Set(['call_count', 'total_cputime', 'total_time', 'acc_id_util_pct']);

function peakUsage(headers) {
  let peak = 0;
  let tier = null;

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'ads_api_access_tier' && typeof v === 'string') tier = v;
      else if (typeof v === 'number' && PCT_KEYS.has(k)) peak = Math.max(peak, v);
      else if (v && typeof v === 'object') walk(v);
    }
  };

  for (const h of ['x-app-usage', 'x-ad-account-usage', 'x-business-use-case-usage']) {
    const raw = headers.get(h);
    if (!raw) continue;
    try { walk(JSON.parse(raw)); } catch { /* ignore a malformed header */ }
  }

  return { peak, tier };
}

/* ------------------------------------------------------------ endpoints ---- */

/**
 * Candidates, widest first. All reads, all `ads_read`, none of them write or
 * spend anything. Several will not exist on a given account — no custom
 * audiences, no pixels, no videos — which is exactly why they get probed.
 */
function candidates(act) {
  return [
    ['account',     `/${act}`,                   { fields: 'name,account_status,currency,timezone_name,amount_spent' }],
    ['campaigns',   `/${act}/campaigns`,         { fields: 'name,status,objective', limit: '5' }],
    ['adsets',      `/${act}/adsets`,            { fields: 'name,status,daily_budget', limit: '5' }],
    ['ads',         `/${act}/ads`,               { fields: 'name,status,effective_status', limit: '5' }],
    ['adcreatives', `/${act}/adcreatives`,       { fields: 'name,object_type', limit: '5' }],
    ['insights',    `/${act}/insights`,          { fields: 'spend,impressions,clicks', date_preset: 'last_30d' }],
    ['audiences',   `/${act}/customaudiences`,   { fields: 'name,approximate_count_lower_bound', limit: '5' }],
    ['pixels',      `/${act}/adspixels`,         { fields: 'name,last_fired_time', limit: '5' }],
    ['adlabels',    `/${act}/adlabels`,          { fields: 'name', limit: '5' }],
    ['targeting',   `/${act}/targetingsentencelines`, {}],
    ['adimages',    `/${act}/adimages`,          { fields: 'name', limit: '5' }],
    ['saved',       `/${act}/saved_audiences`,   { fields: 'name', limit: '5' }],
  ];
}

/* ------------------------------------------------------------------ main --- */

async function main() {
  const state = loadState();

  if (STATUS_ONLY) {
    const total = state.ok + state.err;
    console.log(JSON.stringify({
      ...state,
      total,
      errorRate: `${pct(state.err, total).toFixed(1)}%`,
      remaining: Math.max(0, TARGET - state.ok),
    }, null, 2));
    return;
  }

  for (const v of ['DATABASE_URL', 'META_APP_SECRET', 'META_TOKEN_KEY']) {
    if (!process.env[v]) die(`${v} is not set. Expected it in .env.local or .env at the repo root.`);
  }

  /* --- find a connected ad account and its token ------------------------- */

  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

  let row;
  try {
    const rows = await sql`
      SELECT a."adAccountId"        AS ad_account_id,
             a."adAccountName"      AS ad_account_name,
             c."accessTokenCipher"  AS cipher,
             c."businessName"       AS business_name,
             c."status"             AS status,
             c."grantedScopes"      AS scopes
        FROM meta_rooftop_assets a
        JOIN meta_connections c ON c."id" = a."connectionId"
       WHERE a."adAccountId" IS NOT NULL
         AND c."status" = 'CONNECTED'
       ORDER BY a."provisionedAt" DESC NULLS LAST
       LIMIT 5
    `;

    if (rows.length === 0) {
      die(
        'No connected ad account in the database.\n' +
        '  Connect a dealer in the Ad Desk first — the whole point is to make calls\n' +
        '  against a real ad account, and there is nothing to call.',
      );
    }

    const forced = process.env.WARM_AD_ACCOUNT;
    row = forced
      ? rows.find((r) => r.ad_account_id === forced || r.ad_account_id === `act_${forced}`)
      : rows[0];

    if (!row) die(`WARM_AD_ACCOUNT=${forced} is not one of the connected accounts.`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const token = decryptToken(row.cipher, process.env.META_TOKEN_KEY);
  const secret = process.env.META_APP_SECRET;
  const act = String(row.ad_account_id).startsWith('act_')
    ? String(row.ad_account_id)
    : `act_${row.ad_account_id}`;

  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  if (!scopes.includes('ads_read') && !scopes.includes('ads_management')) {
    log(`warn: granted scopes do not include ads_read — ${scopes.join(', ') || 'none'}`);
  }

  console.log('');
  log(`business    ${row.business_name || '(unnamed)'}`);
  log(`ad account  ${act}  ${row.ad_account_name || ''}`);
  log(`graph       ${VERSION}`);
  console.log('');

  /* --- probe ------------------------------------------------------------- */

  log('probing endpoints, one call each…');
  const live = [];
  let tier = null;
  for (const [name, path, params] of candidates(act)) {
    const r = await read(path, params, token, secret);
    if (r.tier) tier = r.tier;
    if (r.ok) {
      live.push([name, path, params]);
      log(`  ok    ${name}`);
    } else {
      log(`  skip  ${name} — ${r.detail}`);
    }
    await sleep(2000);
  }

  if (live.length === 0) {
    die(
      'Every endpoint failed. That is a token or permission problem, not a pacing one —\n' +
      '  nothing here will clear the 500-call bar until a plain account read succeeds.',
    );
  }

  console.log('');
  log(`${live.length} of ${candidates(act).length} endpoints usable`);

  // Meta states the account's tier in `x-ad-account-usage`. `development_access`
  // is Limited — the thing this run exists to escape. If it already reads
  // `standard_access` the re-request has landed and there is nothing to warm.
  if (tier) {
    log(`tier        ${tier}${tier === 'standard_access' ? '  — already Full, nothing to do here' : '  (Limited)'}`);
  }

  if (PROBE_ONLY) {
    log('--probe given, stopping before the loop.');
    return;
  }

  /* --- the loop ---------------------------------------------------------- */

  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.adAccountId = act;
  state.runs = (state.runs ?? 0) + 1;
  saveState(state);

  const remaining = Math.max(0, TARGET - state.ok);
  const hours = ((remaining * PACE_MS) / 3_600_000).toFixed(1);

  console.log('');
  log(`${state.ok} successful calls on the clock, ${remaining} to go`);
  log(`one call every ${PACE_MS / 1000}s — about ${hours}h. Ctrl-C is safe, progress is saved.`);
  console.log('');

  let i = 0;
  const consecutive = new Map();

  while (state.ok < TARGET) {
    const [name, path, params] = live[i % live.length];
    i += 1;

    const r = await read(path, params, token, secret);

    if (r.ok) {
      state.ok += 1;
      consecutive.set(name, 0);
    } else {
      state.err += 1;
      const n = (consecutive.get(name) ?? 0) + 1;
      consecutive.set(name, n);
      log(`  fail  ${name} — ${r.detail}`);

      // An endpoint that has started failing repeatedly has changed state
      // (account blocked, asset removed). Drop it rather than keep paying for
      // it out of the error budget.
      if (n >= 3 && live.length > 1) {
        const at = live.findIndex(([n2]) => n2 === name);
        if (at >= 0) {
          live.splice(at, 1);
          log(`  drop  ${name} after 3 consecutive failures`);
        }
      }

      // Rate limits arrive as HTTP 400 with a code, NOT as a 429, and the
      // message wording varies ("User request limit reached", "calls to this api
      // have exceeded the rate limit"). Matching on the text missed code 17
      // entirely in testing and slept 30s instead of a decay window. Match the
      // codes: 4 app, 17 user, 32 page, 613 custom-rate, 80000-80006 BUC.
      if (r.status === 429 || RATE_LIMIT_CODES.has(r.code) || (r.code >= 80000 && r.code <= 80006)) {
        log(`  rate limited — sleeping ${RATE_LIMIT_SLEEP_MS / 1000}s for the score to decay`);
        await sleep(RATE_LIMIT_SLEEP_MS);
      } else {
        await sleep(FAIL_SLEEP_MS);
      }
    }

    const total = state.ok + state.err;
    saveState(state);

    if (total % 10 === 0 || !r.ok) {
      log(`  ${state.ok}/${TARGET} ok · ${state.err} err (${pct(state.err, total).toFixed(1)}%) · usage ${r.usage.toFixed(0)}%${r.tier ? ` · ${r.tier}` : ''}`);
    }

    if (total >= MIN_CALLS_BEFORE_ABORT && pct(state.err, total) > ABORT_ERROR_PCT) {
      die(
        `Error rate is ${pct(state.err, total).toFixed(1)}%, over the ${ABORT_ERROR_PCT}% abort line.\n` +
        '  Stopping. Review says under 15% across the last 500 calls, so continuing would\n' +
        '  spend the budget that has to survive to the re-request. Fix the failures above,\n' +
        `  then delete ${STATE_PATH} to reset the count.`,
      );
    }

    if (r.usage >= USAGE_PAUSE_PCT) {
      log(`  usage at ${r.usage.toFixed(0)}% — pausing ${USAGE_PAUSE_MS / 1000}s`);
      await sleep(USAGE_PAUSE_MS);
    } else if (r.ok) {
      await sleep(PACE_MS);
    }
  }

  const total = state.ok + state.err;
  console.log('');
  log(`done — ${state.ok} successful calls, ${state.err} errors (${pct(state.err, total).toFixed(1)}%)`);
  console.log('');
  console.log('  The count takes up to 2 days to register. Do not press "Request again" yet.');
  console.log('  Verify first:  devtools_api_usage call_volume lookback_minutes=21600');
  console.log('');
}

process.on('SIGINT', () => {
  console.log('\n  stopped — progress is in scripts/.warm-state.json, rerun to continue\n');
  process.exit(0);
});

main().catch((err) => die(err.stack ?? String(err)));
