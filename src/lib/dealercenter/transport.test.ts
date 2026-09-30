/**
 * The DealerCenter upload, tested where it can silently do damage.
 *
 * No FTP server is involved. What is worth pinning here is everything that
 * decides *what lands in a shared directory owned by somebody else*:
 *
 *   1. The filename. One Nowcom account carries every dealer we ever connect,
 *      and the DCID in the name is the only thing telling them apart. A file
 *      named wrong is another dealer's inventory, so the guard is in the
 *      transport and not only in the builder.
 *   2. The staging name, which must match neither end of their importer's
 *      pattern or the whole trick is pointless.
 *   3. TLS defaulting on. Defaulting to plaintext would put the vendor password
 *      on the wire with nobody having decided that.
 *   4. The failure path never echoing the password.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ftpConfig,
  ftpConfigured,
  stagingName,
  uploadDealerCenterFile,
} from './transport';

const KEYS = [
  'DEALERCENTER_FTP_HOST',
  'DEALERCENTER_FTP_USER',
  'DEALERCENTER_FTP_PASSWORD',
  'DEALERCENTER_FTP_PORT',
  'DEALERCENTER_FTP_DIR',
  'DEALERCENTER_FTP_SECURE',
];

function withEnv<T>(vals: Record<string, string>, fn: () => T): T {
  const saved = new Map(KEYS.map((k) => [k, process.env[k]] as const));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vals)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CREDS = {
  DEALERCENTER_FTP_HOST: 'ftp.nowcom.com',
  DEALERCENTER_FTP_USER: 'RoofTopAuto',
  DEALERCENTER_FTP_PASSWORD: 'hunter2-not-the-real-one',
};

/* ------------------------------------------------------------------ config */

test('config is null until all three credentials are present', () => {
  withEnv({}, () => assert.equal(ftpConfig(), null));
  withEnv({ DEALERCENTER_FTP_HOST: 'ftp.nowcom.com' }, () => assert.equal(ftpConfig(), null));
  withEnv({ ...CREDS, DEALERCENTER_FTP_PASSWORD: '' }, () => assert.equal(ftpConfig(), null));
  withEnv(CREDS, () => assert.notEqual(ftpConfig(), null));
  withEnv({}, () => assert.equal(ftpConfigured(), false));
  withEnv(CREDS, () => assert.equal(ftpConfigured(), true));
});

test('TLS is on unless explicitly switched off', () => {
  withEnv(CREDS, () => assert.equal(ftpConfig()!.secure, true));
  withEnv({ ...CREDS, DEALERCENTER_FTP_SECURE: 'true' }, () =>
    assert.equal(ftpConfig()!.secure, true));
  withEnv({ ...CREDS, DEALERCENTER_FTP_SECURE: 'false' }, () =>
    assert.equal(ftpConfig()!.secure, false));
  withEnv({ ...CREDS, DEALERCENTER_FTP_SECURE: '0' }, () =>
    assert.equal(ftpConfig()!.secure, false));
  withEnv({ ...CREDS, DEALERCENTER_FTP_SECURE: 'implicit' }, () =>
    assert.equal(ftpConfig()!.secure, 'implicit'));
  // Anything unrecognised stays secure. Fail closed, not open.
  withEnv({ ...CREDS, DEALERCENTER_FTP_SECURE: 'maybe' }, () =>
    assert.equal(ftpConfig()!.secure, true));
});

test('remote directory is normalised, and unset means the login directory', () => {
  withEnv(CREDS, () => assert.equal(ftpConfig()!.dir, ''));
  withEnv({ ...CREDS, DEALERCENTER_FTP_DIR: '/RoofTopAuto/' }, () =>
    assert.equal(ftpConfig()!.dir, 'RoofTopAuto'));
});

test('port defaults to 21', () => {
  withEnv(CREDS, () => assert.equal(ftpConfig()!.port, 21));
  withEnv({ ...CREDS, DEALERCENTER_FTP_PORT: '2121' }, () =>
    assert.equal(ftpConfig()!.port, 2121));
});

/* ----------------------------------------------------------- staging name */

test('the staging name matches neither end of their importer pattern', () => {
  const s = stagingName('23548716_20260930.csv');
  assert.equal(s, '.23548716_20260930.csv.part');
  assert.ok(!/^\d+_\d{8}\.csv$/.test(s));
  assert.ok(s.startsWith('.'));
  assert.ok(s.endsWith('.part'));
});

/* -------------------------------------------------------------- filenames */

test('a filename that is not DCID_YYYYMMDD.csv is refused before connecting', async () => {
  const bad = [
    'rooftopauto-20260930.csv',
    '23548716_20260930.csv.gz',
    '23548716.csv',
    '23548716_2026930.csv',
    'malabar_20260930.csv',
    '',
  ];
  for (const filename of bad) {
    const res = await withEnv(CREDS, () => uploadDealerCenterFile('a,b\n', filename));
    assert.equal(res.ok, false, filename);
    assert.match(res.ok === false ? res.error : '', /filename convention/i, filename);
  }
});

test('the real filename shape passes the name guard', async () => {
  // Reaches the config check rather than the name check, which is as far as a
  // test without an FTP server can go — and the point is that it got past it.
  const res = await withEnv({}, () => uploadDealerCenterFile('a,b\n', '23548716_20260930.csv'));
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : '', /not configured/i);
});

/* ----------------------------------------------------------------- safety */

test('an unconfigured upload fails as a result, not an exception', async () => {
  const res = await withEnv({}, () => uploadDealerCenterFile('a,b\n', '23548716_20260930.csv'));
  assert.equal(res.ok, false);
  assert.ok(res.startedAt instanceof Date);
  assert.ok(res.finishedAt instanceof Date);
});

test('the failure result never contains the password', async () => {
  const res = await withEnv(
    { ...CREDS, DEALERCENTER_FTP_HOST: '127.0.0.1', DEALERCENTER_FTP_PORT: '1' },
    () => uploadDealerCenterFile('a,b\n', '23548716_20260930.csv', { timeoutMs: 1500 }),
  );
  assert.equal(res.ok, false);
  const blob = JSON.stringify(res);
  assert.ok(!blob.includes(CREDS.DEALERCENTER_FTP_PASSWORD));
  assert.ok(!blob.includes('RoofTopAuto'));
});
