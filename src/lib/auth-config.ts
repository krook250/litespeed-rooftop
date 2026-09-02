import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import * as t from '@/db/schema';
import { sendEmail, resetPasswordEmail } from '@/lib/email';
import { findLiveInvite } from '@/lib/invites';

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

    /**
     * One hour. Better Auth's own default, kept deliberately rather than
     * lengthened: the token is a bearer credential sitting in an inbox, and a
     * dealer who asks for a reset acts on it within minutes or asks again. A
     * day-long window buys nothing and widens the blast radius of a forwarded
     * or shoulder-read email.
     */
    resetPasswordTokenExpiresIn: 3600,

    /**
     * `url` arrives as `{baseURL}/api/auth/reset-password/{token}?callbackURL=…`
     * — a Better Auth endpoint that validates the token, then redirects to our
     * `/reset-password` page with it attached. So an expired or forged link
     * fails at their route and never reaches our form, and our page only ever
     * sees a token that was live a moment ago.
     *
     * Send failures are swallowed inside `sendEmail`. That is intentional here:
     * this callback runs inside the reset endpoint, and throwing would turn a
     * neutral "if that address exists, check your email" into a 500 for real
     * addresses only — which is an account-enumeration oracle built out of an
     * error handler.
     */
    async sendResetPassword({ user, url }) {
      const msg = resetPasswordEmail(url, (user as { name?: string }).name ?? '');
      await sendEmail({ ...msg, to: user.email });
    },
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
      // Same trap as homeView, one step worse: this column is *nullable*, and
      // null is load-bearing — it means "inherit the dealership's style". An
      // undeclared column comes back undefined, which is indistinguishable from
      // the inherit case, so the bug would hide rather than show. No
      // defaultValue for exactly that reason: null is the intended initial
      // state, not a value waiting to be filled in.
      feedStyle: { type: 'string', required: false, input: false },
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
          const email = String((user as { email?: string }).email ?? '').toLowerCase();

          /*
           * TWO WAYS TO EXIST, AND THIS IS THE FORK.
           *
           * A normal signup founds a dealership and its author is the OWNER.
           * An invited signup joins one that already exists, and must not
           * create a group — a bug here does not throw, it quietly gives the
           * new hire their own empty dealership and nobody notices until they
           * ask why the inventory is missing.
           *
           * `inviteToken` rides in the request body, the same way
           * `dealershipName` already does. That is safe *because* `groupId` and
           * `role` are `input: false` above: the body cannot set them
           * directly, so the only way into an existing group is a token this
           * hook looked up and validated.
           *
           * The email must match the address the invite was sent to. Without
           * that check a forwarded link lets anyone join under any address.
           */
          const token = typeof raw.inviteToken === 'string' ? raw.inviteToken : '';
          if (token) {
            const invite = await findLiveInvite(token);
            if (!invite || invite.email.toLowerCase() !== email) {
              throw new Error('This invitation is no longer valid.');
            }
            await db
              .update(t.invites)
              .set({ acceptedAt: new Date() })
              .where(eq(t.invites.id, invite.id));
            return { data: { ...user, groupId: invite.groupId, role: invite.role } };
          }

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

          /*
           * Only the founder provisions. An invited hire lands in a group that
           * already has a rooftop and a storefront, and running this for them
           * would give the dealership a second empty lot named after itself
           * every time somebody joined.
           *
           * Checked by asking the database rather than by passing a flag down
           * from `before`: the question "does this group already have a
           * rooftop" is the actual condition, and it stays right if a third
           * way of creating a user ever appears.
           */
          const [existingRooftop] = await db
            .select({ id: t.rooftops.id })
            .from(t.rooftops)
            .where(eq(t.rooftops.groupId, group.id))
            .limit(1);
          if (existingRooftop) return;

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
