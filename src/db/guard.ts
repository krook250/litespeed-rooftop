/**
 * The seed guard.
 *
 * `npm run db:seed` opens with `delete from` on every table, and `.env` now
 * points at production Neon (see §8 of `claude/auth-hosting-and-scale.md`).
 * One absent-minded `npm run db:reset` and the live dealer data is gone. So the
 * destructive scripts refuse to run against anything that is not obviously a
 * local database.
 *
 * Local means loopback, or a host that is plainly a developer's own box. It is
 * deliberately a allowlist, not a "does the host contain neon" denylist: a new
 * managed provider must not silently become seedable.
 */

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
  'db',
  'postgres',
]);

export function describeTarget(url: string) {
  try {
    const u = new URL(url);
    return { host: u.hostname, database: u.pathname.replace(/^\//, '') || '(default)' };
  } catch {
    return { host: '(unparseable DATABASE_URL)', database: '(unknown)' };
  }
}

export function isLocalDatabase(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOCAL_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** `--force` on the command line, or SEED_FORCE=1 in the environment. */
export function forceRequested(argv = process.argv.slice(2)) {
  return argv.includes('--force') || argv.includes('-f') || process.env.SEED_FORCE === '1';
}

/**
 * Call before the first destructive statement. Exits the process rather than
 * throwing, so a refusal reads as a refusal and not as a stack trace.
 */
export function assertSafeToWipe(scriptName: string) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`${scriptName}: DATABASE_URL is not set. Copy .env.example to .env first.`);
    process.exit(1);
  }

  const { host, database } = describeTarget(url);

  if (isLocalDatabase(url)) return;

  if (forceRequested()) {
    console.warn(
      `\n⚠  ${scriptName} is wiping a NON-LOCAL database: ${database} on ${host}.\n` +
        '   Running anyway because --force was passed.\n',
    );
    return;
  }

  console.error(
    `\n${scriptName} refused to run.\n\n` +
      `  DATABASE_URL points at  ${database}  on  ${host}\n` +
      '  which is not a local database, and this script deletes every row in\n' +
      '  every table before it writes anything.\n\n' +
      '  If you are certain — for example a throwaway Neon branch — re-run with:\n\n' +
      '      npm run db:seed -- --force\n' +
      '      (or set SEED_FORCE=1)\n\n' +
      '  Otherwise point .env at your local Postgres and try again.\n',
  );
  process.exit(1);
}
