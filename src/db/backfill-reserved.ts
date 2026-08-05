/**
 * Adopt "written down, never connected" storefronts into `RESERVED`.
 *
 * `domain` set with `domainStatus = 'NONE'` was never a state anything wrote on
 * purpose: it is what `db:seed` produces, and what any storefront whose domain
 * was set straight in the database looks like. `RESERVED` models it honestly.
 *
 * ## Why this is not a migration
 *
 * It was one, briefly, and it failed against a clean Postgres 16 with
 * `55P04 unsafe use of new value "RESERVED" of enum type domain_status`.
 *
 * Postgres will not let a value added by `ALTER TYPE ... ADD VALUE` be *used*
 * until the transaction that added it has committed — and `src/db/migrate.ts`
 * uses drizzle's migrator, which wraps **every pending migration file in one
 * transaction**, not one transaction per file. So splitting the ADD VALUE and the
 * UPDATE into `0008` and `0009` does not help: they still land in the same
 * transaction and it still fails. There is no ordering of migration files that
 * makes this work.
 *
 * If you are about to "fix" this by moving the UPDATE back into a migration:
 * don't. Run it here, after `db:migrate`, in its own connection.
 *
 * Idempotent — the `WHERE` clause matches nothing on a second run — so it is safe
 * against the production database, which is why it lives alongside `db:backfill`
 * rather than behind the `assertSafeToWipe` guard that protects `db:seed`.
 *
 * Nothing depends on this having run. `/admin/website` reads a legacy
 * `domain + NONE` row as reserved anyway, precisely so an un-backfilled database
 * is not a broken one. This only makes the stored state match what the screen
 * already shows.
 */

import 'dotenv/config';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';

export async function backfillReservedDomains(): Promise<number> {
  const rows = await db
    .update(t.storefronts)
    .set({
      domainStatus: 'RESERVED',
      /*
       * Backdated to `domainAddedAt` where there is one, so the stalled-domain
       * nudge treats a long-forgotten domain as long-forgotten rather than as
       * reserved today. Falling back to now() buys the rest one quiet week
       * instead of a nudge on the first sweep after deploy.
       */
      domainReservedAt: sql`coalesce(${t.storefronts.domainAddedAt}, now())`,
    })
    .where(and(isNotNull(t.storefronts.domain), eq(t.storefronts.domainStatus, 'NONE')))
    .returning({ id: t.storefronts.id });
  return rows.length;
}

async function main() {
  const n = await backfillReservedDomains();
  console.log(`moved ${n} storefront(s) from domain+NONE to RESERVED`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
