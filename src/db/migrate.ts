/**
 * Applies everything in ./drizzle to the database in DATABASE_URL.
 * `npm run db:migrate`
 *
 * Wrapped in main() rather than using top-level await: the project has no
 * "type": "module", so tsx transforms this file to CJS, where top-level await
 * is a hard error ("Top-level await is currently not supported with the 'cjs'
 * output format").
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  await sql.end();
  console.log('migrations applied');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
