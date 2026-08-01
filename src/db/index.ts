import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres database.',
  );
}

// Reuse the client across hot reloads in dev so we don't exhaust connections.
const globalForDb = globalThis as unknown as {
  __rooftopSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__rooftopSql ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === 'production' ? 5 : 3,
    prepare: false,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__rooftopSql = client;

export const db = drizzle(client, { schema });
export { schema };
