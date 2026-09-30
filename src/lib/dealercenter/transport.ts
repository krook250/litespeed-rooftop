import 'server-only';
import { Readable } from 'node:stream';
import { Client } from 'basic-ftp';

/**
 * Rooftop Auto — putting a DealerCenter file on Nowcom's FTP server.
 *
 * This file knows nothing about vehicles: it takes bytes and a name and gets
 * them onto the server. Assembling the file is `feed.ts`; deciding when to send
 * one is the caller.
 *
 * WHAT DEALERCENTER TOLD US, AND WHAT EACH DECISION HERE IS ABOUT
 *
 *   "We currently support FTP/SFTP only."      — Albert Rigor, 21 Sep 2026
 *   FTP Server: ftp.nowcom.com, Port 21,
 *   Username: RoofTopAuto                      — Jaimes Caoile, 23 Sep 2026
 *   "Please input the DCID of the dealer in
 *    the first column of the file and in the
 *    filename … DCID_YYYYMMDD.csv"
 *
 * ONE VENDOR ACCOUNT, MANY DEALERS. The username is ours, not the dealer's, and
 * the DCID in the filename is the only thing telling two dealers' files apart.
 * That is why the credentials are flat environment variables like CarGurus's and
 * not per-connection columns — and it is also why `dcFilename` in `feed-spec.ts`
 * refuses to build a name without a DCID. A misnamed file in a shared directory
 * is another dealer's inventory.
 *
 * NOT GZIPPED, unlike the CarGurus upload. Their convention names a `.csv` and
 * nothing in any of their mail mentions compression. A `.csv.gz` in that folder
 * is a file their importer skips or chokes on, and we would not find out for a
 * day.
 *
 * THE STAGING NAME IS THE SAME TRICK AND FOR THE SAME REASON. DealerCenter runs
 * a nightly importer against this directory. Anything that sweeps a directory we
 * are mid-write into will eventually collect a truncated file, and a truncated
 * CSV is not an error on their side — it is a short file, which on an importer
 * that updates existing records by VIN is the one failure mode we cannot risk.
 * So: upload to a name their sweep will not match, then rename. The rename is
 * atomic; the upload is not.
 *
 * DEPLOYMENT CAVEAT, SAME AS CARGURUS. Vercel functions have no stable outbound
 * IP. If Nowcom allowlists source addresses this code runs correctly and is
 * refused at the door, and the symptom is a connect timeout rather than an auth
 * failure. That is a question for DealerCenter support, not something code can
 * solve; the fallback is Vercel Secure Compute or pushing from a fixed address.
 */

/**
 * Passive FTP with explicit TLS unless told otherwise. Never default to
 * plaintext — even though port 21 and a control-channel-only setup are common in
 * this industry, defaulting to cleartext would put the vendor password on the
 * wire on the first run with nobody having decided that.
 */
function secureSetting(): boolean | 'implicit' {
  const v = (process.env.DEALERCENTER_FTP_SECURE ?? 'true').toLowerCase();
  if (v === 'implicit') return 'implicit';
  return v !== 'false' && v !== '0';
}

export type DealerCenterFtpConfig = {
  host: string;
  user: string;
  password: string;
  secure: boolean | 'implicit';
  /** Remote directory. Empty means the login directory, which is the norm. */
  dir: string;
  port: number;
};

/**
 * Read the vendor credentials out of the environment.
 *
 * Null rather than a throw when unset, so a screen can say "not configured yet"
 * and a scheduled run can no-op quietly instead of filling the function log with
 * stack traces. The caller decides whether missing config is an error.
 */
export function ftpConfig(): DealerCenterFtpConfig | null {
  const host = process.env.DEALERCENTER_FTP_HOST;
  const user = process.env.DEALERCENTER_FTP_USER;
  const password = process.env.DEALERCENTER_FTP_PASSWORD;
  if (!host || !user || !password) return null;
  return {
    host,
    user,
    password,
    secure: secureSetting(),
    dir: (process.env.DEALERCENTER_FTP_DIR ?? '').replace(/^\/+|\/+$/g, ''),
    port: Number(process.env.DEALERCENTER_FTP_PORT ?? 21),
  };
}

export function ftpConfigured(): boolean {
  return ftpConfig() !== null;
}

/**
 * The name we write under before the rename.
 *
 * Leading dot and a `.part` suffix: their importer is looking for
 * `<digits>_<date>.csv` and will match neither end of this.
 */
export function stagingName(finalName: string): string {
  return `.${finalName}.part`;
}

export type UploadResult =
  | { ok: true; filename: string; bytes: number; startedAt: Date; finishedAt: Date }
  | { ok: false; filename: string; error: string; startedAt: Date; finishedAt: Date };

/**
 * Put `csv` on the server under `filename`.
 *
 * Does not throw. A transport failure is an expected operating condition — the
 * server is down, the password rotated, the network blinked — and each of those
 * wants to be a readable log line, not an unhandled rejection inside a cron
 * handler that then says nothing about the other dealers in the same run.
 *
 * The error string is built from the exception message alone. basic-ftp's
 * verbose logging echoes the control channel, USER and PASS included, so it
 * stays off and nothing here interpolates the config.
 */
export async function uploadDealerCenterFile(
  csv: string,
  filename: string,
  opts: { timeoutMs?: number } = {},
): Promise<UploadResult> {
  const startedAt = new Date();

  if (!filename || !/^\d+_\d{8}\.csv$/.test(filename)) {
    return {
      ok: false,
      filename,
      error:
        `Refusing to upload "${filename}": DealerCenter's filename convention is ` +
        'DCID_YYYYMMDD.csv, and the DCID in the name is the only thing that attaches ' +
        'the file to an account in a shared directory.',
      startedAt,
      finishedAt: new Date(),
    };
  }

  const cfg = ftpConfig();
  if (!cfg) {
    return {
      ok: false,
      filename,
      error:
        'DealerCenter FTP is not configured — DEALERCENTER_FTP_HOST/USER/PASSWORD are unset.',
      startedAt,
      finishedAt: new Date(),
    };
  }

  const body = Buffer.from(csv, 'utf8');
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

    await client.uploadFrom(Readable.from(body), staging);
    await client.rename(staging, filename);

    return { ok: true, filename, bytes: body.byteLength, startedAt, finishedAt: new Date() };
  } catch (err) {
    // Best-effort tidy-up. A stranded `.part` is invisible to their importer by
    // construction, but it accumulates, and a directory full of them is the kind
    // of thing that earns us a confused email.
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
