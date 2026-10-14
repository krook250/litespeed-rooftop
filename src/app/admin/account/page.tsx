import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/permissions';
import { Card, CardHeader } from '@/components/ui';
import { AccountForm } from '@/components/account-form';

export const dynamic = 'force-dynamic';

/**
 * Account -- your own name and cell. Every role can open it; it only ever
 * touches the signed-in person. Read from the database rather than the session
 * so a number saved a second ago shows, not a cached one.
 */
export default async function AccountPage() {
  const me = await requireSession();
  const row = (
    await db
      .select({ name: t.users.name, email: t.users.email, cell: t.users.cell, role: t.users.role })
      .from(t.users)
      .where(eq(t.users.id, me.id))
      .limit(1)
  )[0];

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Account</h1>
      <p className="mb-5 mt-1 text-sm text-ink-500">
        {row?.email} · {ROLE_LABEL[row?.role ?? me.role] ?? me.role}
      </p>
      <Card>
        <CardHeader title="You" subtitle="Your sign-in email can’t be changed here." />
        <AccountForm name={row?.name ?? me.name} cell={row?.cell ?? null} />
      </Card>
    </div>
  );
}
