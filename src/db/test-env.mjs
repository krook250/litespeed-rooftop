/**
 * Point the test suite at a database that is not production.
 *
 * WHY THIS EXISTS. 27 of the tests are not hermetic — `tenant-isolation.test.ts`
 * builds whole tenants, inserts rooftops and vehicles, and reads them back. They
 * take `DATABASE_URL` from `.env` like everything else, and `.env` points at
 * production Neon (see §8 of `claude/auth-hosting-and-scale.md`). So every
 * `npm test` was writing dealer groups, rooftops and a Ford F-150 with VIN
 * ISOMTRGJF8AA00001 into the live database. Nothing had ever gone wrong, which
 * is the only reason it survived this long.
 *
 * `db:seed` was already protected — `assertSafeToWipe` in `guard.ts` refuses a
 * managed host — but that guard only runs in the seed script, and the tests
 * never call it.
 *
 * Loaded via `--import` from the `test` script, so it runs before any test file
 * imports `@/db` and constructs a client.
 *
 * .mjs rather than .ts deliberately: Node evaluates `--import` modules itself,
 * so keeping this out of the TypeScript loader's path removes the one thing
 * that could break the runner.
 */

import 'dotenv/config';

const test = process.env.TEST_DATABASE_URL;
const prod = process.env.DATABASE_URL;

if (!test) {
  console.error(
    '\nnpm test refused to run.\n\n' +
      '  TEST_DATABASE_URL is not set, and the database-backed tests write real\n' +
      '  rows — tenants, rooftops, vehicles — into whatever DATABASE_URL points\n' +
      '  at. That is production.\n\n' +
      '  Create a Neon branch off Primary and put its connection string in .env:\n\n' +
      '      TEST_DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"\n\n' +
      '  A branch starts as a copy-on-write clone, so it already has every\n' +
      '  migration applied and nothing you do to it touches Primary.\n',
  );
  process.exit(1);
}

if (test === prod) {
  console.error(
    '\nnpm test refused to run.\n\n' +
      '  TEST_DATABASE_URL and DATABASE_URL are the same string, which means the\n' +
      '  tests would write to production. Point TEST_DATABASE_URL at a branch.\n',
  );
  process.exit(1);
}

/* Everything downstream reads DATABASE_URL — `src/db/index.ts`, and every test
 * that imports it. Overwriting the variable is what makes this work without
 * touching a single test file. */
process.env.DATABASE_URL = test;
