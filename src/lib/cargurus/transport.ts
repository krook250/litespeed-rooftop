import 'server-only';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { Client } from 'basic-ftp';

/**
 * Rooftop Auto — putting a CarGurus upload on their FTP server.
 *
 * This file knows nothing about vehicles. It takes bytes and a name and gets
 * them onto the server, and that is the whole contract. Assembling the file is
 * `feed.ts`; deciding when to send one is the scheduler. Keeping those three
 * apart is what lets the upload be exercised against a throwaway FTP server
 * with no database in the picture.
 *
 * WHAT CARGURUS TOLD US, AND WHAT EACH LINE HERE IS DOING ABOUT IT
 *
 *   "credentials unique to you"      — one vendor account, not one per dealer.
 *                                      Hence flat env vars rather than anything
 *                                      read off a connection row.
 *   "file names do not need to be
 *    unique"                         — but ours are dated anyway. Their system
 *                                      sweeps the directory, so the only record
 *                                      that an upload happened is what we keep;
 *                                      a distinct name makes their side and our
 *                                      log line-up-able when something is wrong.
 *   "compress the file before
 *    uploading"                      — gzip, below.
 *   "Our system moves your uploaded
 *    file to a different area for
 *    processing" (within a minute)   — THIS IS THE REASON FOR THE TEMP NAME.
 *                                      A sweeper that runs every minute against
 *                                      a directory we are mid-write into will
 *                                      eventually collect a truncated file, and
 *                                      a truncated CSV is not an error on their
 *                                      side — it is a short file, which is the
 *                                      one failure mode we have decided we
 *                                      cannot risk (see OMITTED_CONTROL_FIELDS
 *                                      in feed-spec.ts). So: upload to a name
 *                                      their sweeper will not match, then
 *                                      rename. The rename is atomic; the upload
 *                                      is not.
 *
 * DEPLOYMENT CAVEAT WORTH KNOWING BEFORE THE FIRST LIVE UPLOAD
 *
 * Vercel functions have no stable outbound IP. If CarGurus turns out to
 * allowlist source addresses for FTP — plenty of file-transfer endpoints in this
 * industry do — this runs correctly and is refused at the door, and the symptom
 * will be a connect timeout rather than an auth failure. That is a question for
 * the credentials thread, not something code can solve. The fallback is Vercel
 * Secure Compute or running the upload from anywhere with a fixed address.
 */

const gzipAsync = promisify(gzip);

/** Passive FTP with explicit TLS unless told otherwise. Never default to plaintext. */
function secureSetting(): boolean | 'implicit' {
  const v = (process.env.CARGURUS_FTP_SECURE ?? 'true').toLowerCase();
  if (v === 'implicit') return 'implicit';
  return v !== 'false' && v !== '0';
}

export type CarGurusFtpConfig = {
  host: string;
  user: string;
  password: string;
  secure: boolean | 'implicit';
  /** Remote directory. Empty string means the login directory, which is the norm. */
  dir: string;
  port: number;
};

/**
 * Read the vendor credentials out of the environment.
 *
 * Returns null rather than throwing when unset, so that a screen can render
 * "not configured yet" and a scheduled run can no-op quietly instead of filling
 * the function log with stack traces on every tick before the credentials
 * arrive. The caller decides whether missing config is an error.
 */
export function ftpConfig(): CarGurusFtpConfig | null {
  const host = process.env.CARGURUS_FTP_HOST;
  const user = process.env.CARGURUS_FTP_USER;
  const password = process.env.CARGURUS_FTP_PASSWORD;
  if (!host || !user || !password) return null;
  return {
    host,
    user,
    password,
    secure: secureSetting(),
    dir: (process.env.CARGURUS_FTP_DIR ?? '').replace(/^\/+|\/+$/g, ''),
    port: Number(process.env.CARGURUS_FTP_PORT ?? 21),
  };
}

export function ftpConfigured(): boolean {
  return ftpConfig() !== null;
}

/**
 * A dated, sortable name.
 *
 * UTC on purpose — a twice-daily schedule crossing a DST boundary in local time
 * produces two files with the same name in the fall and a missing one in the
 * spring, and neither is worth debugging at 2am.
 *
 * Seconds are in the stamp because minutes are not enough. The scheduled runs
 * are twelve hours apart and would never collide, but "Run now" on `/ops` and a
 * forced retry immediately after a refusal both happen inside one minute, and a
 * collision there silently overwrites a file CarGurus may not have swept yet.
 */
export function feedFilename(now: Date = new Date(), prefix = 'rooftopauto'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${prefix}-${stamp}.csv.gz`;
}

/** The name we write under before the rename. Chosen not to end in .gz or .csv. */
export function stagingName(finalName: string): string {
  return `.${finalName}.part`;
}

export async function gzipCsv(csv: string): Promise<Buffer> {
  return gzipAsync(Buffer.from(csv, 'utf8'));
}

export type UploadResult =
  | {
      ok: true;
      filename: string;
      /** Compressed size actually written. */
      bytes: number;
      /** Uncompressed size, for the log line — compression ratios drift when a builder changes. */
      rawBytes: number;
      startedAt: Date;
      finishedAt: Date;
    }
  | {
      ok: false;
      filename: string;
      error: string;
      startedAt: Date;
      finishedAt: Date;
    };

/**
 * Compress `csv` and put it on the server.
 *
 * Does not throw. A transport failure is an expected operating condition — the
 * server is down, the credentials rotated, the network blinked — and every one
 * of those wants to be a row in a log with a message a human can read, not an
 * unhandled rejection inside a cron handler that then reports nothing about the
 * other dealers in the same run.
 *
 * The error string is deliberately built from the exception message alone.
 * basic-ftp's verbose logging echoes the control channel, which includes the
 * USER and PASS commands, so it stays off and nothing here interpolates the
 * config.
 */
export async function uploadCarGurusFeed(
  csv: string,
  opts: { filename?: string; timeoutMs?: number } = {},
): Promise<UploadResult> {
  const startedAt = new Date();
  const filename = opts.filename ?? feedFilename(startedAt);

  const cfg = ftpConfig();
  if (!cfg) {
    return {
      ok: false,
      filename,
      error: 'CarGurus FTP is not configured — CARGURUS_FTP_HOST/USER/PASSWORD are unset.',
      startedAt,
      finishedAt: new Date(),
    };
  }

  const body = await gzipCsv(csv);
  const staging = stagingName(filename);
  const client = new Client(opts.timeoutMs ?? 30_000);

  try {
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      secure: cfg.secure,
    });

    if (cfg.dir) await client.ensureDir(cfg.dir);

    // Write under a name their sweeper will not pick up, then rename into place.
    await client.uploadFrom(Readable.from(body), staging);
    await client.rename(staging, filename);

    return {
      ok: true,
      filename,
      bytes: body.byteLength,
      rawBytes: Buffer.byteLength(csv, 'utf8'),
      startedAt,
      finishedAt: new Date(),
    };
  } catch (err) {
    // Best-effort tidy-up. A stranded `.part` is invisible to their sweeper by
    // construction, but it accumulates, and a directory full of them is the
    // kind of thing that gets us a confused email.
    try {
      await client.remove(staging, true);
    } catch {
      /* the connection is probably already gone; nothing useful to do */
    }
    return {
      ok: false,
      filename,
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      finishedAt: new Date(),
    };
  } finally {
    client.close();
  }
}
