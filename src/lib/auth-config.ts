import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import * as t from '@/db/schema';

/**
 * The Better Auth instance.
 *
 * Deliberately free of `server-only` and `next/headers` so that plain Node
 * scripts (src/db/seed.ts) can import it to hash a password. The request-bound
 * helpers live in ./auth.ts, which is the file application code should import.
 *
 * Better Auth owns `users`, `sessions`, `accounts` and `verifications`. The two
 * columns that matter to us — `groupId` and `role` — are declared with
 * `input: false`, so they can never be set from a signup request body. They are
 * filled in by the database hooks below, which run server-side only.
 *
 * Signing up creates the whole tenant: a dealer group, one rooftop, and one
 * storefront. A brand-new account therefore lands on an empty lot rather than
 * someone else's inventory.
 */

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'dealer'
  );
}

/** Slugs are globally unique across tenants, so collisions get a suffix. */
async function uniqueSlug(base: string) {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const [group, rooftop, storefront] = await Promise.all([
      db.select({ id: t.dealerGroups.id }).from(t.dealerGroups).where(eq(t.dealerGroups.slug, candidate)).limit(1),
      db.select({ id: t.rooftops.id }).from(t.rooftops).where(eq(t.rooftops.slug, candidate)).limit(1),
      db.select({ id: t.storefronts.id }).from(t.storefronts).where(eq(t.storefronts.slug, candidate)).limit(1),
    ]);
    if (!group.length && !rooftop.length && !storefront.length) return candidate;
  }
  return `${root}-${crypto.randomUUID().slice(0, 8)}`;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },

  user: {
    modelName: 'users',
    additionalFields: {
      // `input: false` is the security boundary — a crafted POST to
      // /api/auth/sign-up/email cannot set these, so it cannot join an
      // existing dealer group. They are filled in by the create hook below.
      //
      // `required` must stay false: Better Auth validates required additional
      // fields against the *request body* before database hooks run, so
      // required + input:false rejects every signup with MISSING_FIELD.
      // Both columns are still NOT NULL in Postgres, which is the real guard.
      groupId: { type: 'string', required: false, input: false },
      role: { type: 'string', required: false, input: false, defaultValue: 'OWNER' },
      // Must be declared here or Better Auth simply does not select the column,
      // and `getSessionUser()` hands back a user whose homeView is undefined —
      // which silently pins everyone to the default and makes the preference
      // look like it saved and then did nothing. Unlike the two above this one
      // *is* user-settable, but through the `setHomeView` server action rather
      // than through a signup body, so `input: false` still applies.
      homeView: { type: 'string', required: false, input: false, defaultValue: 'FEED' },
    },
  },
  session: { modelName: 'sessions' },
  account: { modelName: 'accounts' },
  verification: { modelName: 'verifications' },

  databaseHooks: {
    user: {
      create: {
        /** Provision the tenant before the user row lands, so groupId is valid. */
        async before(user, ctx) {
          const raw = (ctx?.body as Record<string, unknown> | undefined) ?? {};
          const dealershipName =
            typeof raw.dealershipName === 'string' && raw.dealershipName.trim()
              ? raw.dealershipName.trim().slice(0, 120)
              : `${(user as { name?: string }).name ?? 'New'} Motors`;

          const slug = await uniqueSlug(dealershipName);
          const [group] = await db
            .insert(t.dealerGroups)
            .values({ name: dealershipName, slug })
            .returning();

          return { data: { ...user, groupId: group.id, role: 'OWNER' as const } };
        },

        /** First rooftop + storefront. Address details are filled in later. */
        async after(user) {
          const u = user as unknown as typeof t.users.$inferSelect;
          const [group] = await db
            .select()
            .from(t.dealerGroups)
            .where(eq(t.dealerGroups.id, u.groupId))
            .limit(1);
          if (!group) return;

          const rooftopSlug = await uniqueSlug(`${group.name} main`);
          const [rooftop] = await db
            .insert(t.rooftops)
            .values({
              groupId: group.id,
              name: group.name,
              slug: rooftopSlug,
              addressLine1: '',
              city: '',
              state: '',
              postalCode: '',
              phone: '',
              email: u.email,
            })
            .returning();

          const storefrontSlug = await uniqueSlug(`${group.name} store`);
          const [storefront] = await db
            .insert(t.storefronts)
            .values({
              groupId: group.id,
              name: group.name,
              slug: storefrontSlug,
              phone: '',
            })
            .returning();

          await db
            .insert(t.storefrontRooftops)
            .values({ storefrontId: storefront.id, rooftopId: rooftop.id });
        },
      },
    },
  },

  // Must stay last: lets server actions write the session cookie.
  plugins: [nextCookies()],
});
