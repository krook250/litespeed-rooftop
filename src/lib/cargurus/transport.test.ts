import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import {
  feedFilename,
  ftpConfig,
  ftpConfigured,
  gzipCsv,
  stagingName,
  uploadCarGurusFeed,
} from './transport';

/**
 * No network here on purpose. Everything below is the part of the transport
 * that can be wrong without an FTP server being involved: the name, the
 * compression, and reading the environment. The round trip itself is proved
 * against a real FTP daemon, not mocked — a mocked FTP client tests the mock.
 */

const KEYS = [
  'CARGURUS_FTP_HOST',
  'CARGURUS_FTP_USER',
  'CARGURUS_FTP_PASSWORD',
  'CARGURUS_FTP_SECURE',
  'CARGURUS_FTP_DIR',
  'CARGURUS_FTP_PORT',
] as const;

/** Restores whatever the surrounding process had. Other tests share this env. */
function withEnv<T>(vals: Partial<Record<(typeof KEYS)[number], string>>, fn: () => T): T {
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
  CARGURUS_FTP_HOST: 'ftp.cargurus.com',
  CARGURUS_FTP_USER: 'rooftop',
  CARGURUS_FTP_PASSWORD: 'hunter2',
};

test('filename is UTC and sortable', () => {
  const name = feedFilename(new Date('2026-08-26T07:05:00Z'));
  assert.equal(name, 'rooftopauto-20260826-0705.csv.gz');
});

test('filename does not drift with the local timezone', () => {
  // 23:30 UTC is the previous evening in Los Angeles. A local-time stamp here
  // would put two of a twice-daily schedule on the same date across a DST edge.
  const name = feedFilename(new Date('2026-11-01T23:30:00Z'));
  assert.ok(name.startsWith('rooftopauto-20261101-2330'));
});

test('filenames sort chronologically as strings', () => {
  const a = feedFilename(new Date('2026-08-26T07:05:00Z'));
  const b = feedFilename(new Date('2026-08-26T19:05:00Z'));
  const c = feedFilename(new Date('2026-09-01T01:00:00Z'));
  assert.deepEqual([c, b, a].sort(), [a, b, c]);
});

test('staging name ends in neither .csv nor .gz', () => {
  const staging = stagingName('rooftopauto-20260826-0705.csv.gz');
  assert.ok(!staging.endsWith('.gz'));
  assert.ok(!staging.endsWith('.csv'));
  // Hidden as well, so a directory listing on their side stays clean.
  assert.ok(staging.startsWith('.'));
});

test('gzip round-trips the exact bytes', async () => {
  const csv = 'VIN,Make\n1FTFW1ET5DFA12345,Ford\n';
  const packed = await gzipCsv(csv);
  assert.equal(gunzipSync(packed).toString('utf8'), csv);
});

test('gzip actually compresses a realistic file', async () => {
  const row = '1FTFW1ET5DFA12345,Ford,F-150,2019,XLT,28995,64210,Blue\n';
  const csv = 'VIN,Make,Model,Year,Trim,Price,Mileage,Color\n' + row.repeat(400);
  const packed = await gzipCsv(csv);
  assert.ok(packed.byteLength < Buffer.byteLength(csv) / 4);
});

test('config is null until all three credentials are present', () => {
  withEnv({}, () => assert.equal(ftpConfig(), null));
  withEnv({ CARGURUS_FTP_HOST: 'h' }, () => assert.equal(ftpConfig(), null));
  withEnv({ CARGURUS_FTP_HOST: 'h', CARGURUS_FTP_USER: 'u' }, () =>
    assert.equal(ftpConfig(), null),
  );
  withEnv(CREDS, () => assert.equal(ftpConfigured(), true));
});

test('TLS is on unless explicitly switched off', () => {
  withEnv(CREDS, () => assert.equal(ftpConfig()!.secure, true));
  withEnv({ ...CREDS, CARGURUS_FTP_SECURE: 'implicit' }, () =>
    assert.equal(ftpConfig()!.secure, 'implicit'),
  );
  withEnv({ ...CREDS, CARGURUS_FTP_SECURE: 'false' }, () =>
    assert.equal(ftpConfig()!.secure, false),
  );
  // Anything unrecognised stays secure rather than silently downgrading.
  withEnv({ ...CREDS, CARGURUS_FTP_SECURE: 'yes please' }, () =>
    assert.equal(ftpConfig()!.secure, true),
  );
});

test('remote directory is normalised to no leading or trailing slash', () => {
  withEnv({ ...CREDS, CARGURUS_FTP_DIR: '/inbound/' }, () =>
    assert.equal(ftpConfig()!.dir, 'inbound'),
  );
  withEnv(CREDS, () => assert.equal(ftpConfig()!.dir, ''));
});

test('port defaults to 21', () => {
  withEnv(CREDS, () => assert.equal(ftpConfig()!.port, 21));
  withEnv({ ...CREDS, CARGURUS_FTP_PORT: '2121' }, () => assert.equal(ftpConfig()!.port, 2121));
});

test('an unconfigured upload fails as a result, not an exception', async () => {
  const saved = new Map(KEYS.map((k) => [k, process.env[k]] as const));
  for (const k of KEYS) delete process.env[k];
  try {
    const res = await uploadCarGurusFeed('VIN\n', { filename: 'x.csv.gz' });
    assert.equal(res.ok, false);
    assert.match(res.ok === false ? res.error : '', /not configured/i);
  } finally {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
});

test('the failure result never contains the password', async () => {
  const saved = new Map(KEYS.map((k) => [k, process.env[k]] as const));
  Object.assign(process.env, {
    CARGURUS_FTP_HOST: '127.0.0.1',
    CARGURUS_FTP_PORT: '1',
    CARGURUS_FTP_USER: 'rooftop',
    CARGURUS_FTP_PASSWORD: 'hunter2',
    CARGURUS_FTP_SECURE: 'false',
  });
  try {
    const res = await uploadCarGurusFeed('VIN\n', { filename: 'x.csv.gz', timeoutMs: 2000 });
    assert.equal(res.ok, false);
    assert.ok(!JSON.stringify(res).includes('hunter2'));
  } finally {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
});
