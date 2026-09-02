import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSection } from '@/lib/auth-guard';
import { getGroup } from '@/lib/queries';
import { ROLE_LABEL, ROLE_BLURB, SECTIONS, can } from '@/lib/permissions';
import { Card, CardHeader } from '@/components/ui';
import { RolePicker } from '@/components/settings/role-picker';
import type { UserRole } from '@/db/schema';

export const dynamic = 'force-dynamic';

/**
 * Settings — owner only.
 *
 * People first, because it is the thing a dealer asks for on day two: "my sales
 * guys shouldn't be in the ad account." Billing will live alongside it.
 *
 * The matrix below is rendered from `src/lib/permissions.ts` rather than typed
 * out here. A permissions grid that is maintained separately from the
 * permissions is a lie waiting to happen — this one cannot drift, because it is
 * the same table the guard reads.
 */
export default async function SettingsPage() {
  const me = await requireSection('settings');
  const [group, people] = await Promise.all([
    getGroup(),
    db
      .select({ id: t.users.id, name: t.users.name, email: t.users.email, role: t.users.role })
      .from(t.users)
      .where(eq(t.users.groupId, me.groupId))
      .orderBy(asc(t.users.name)),
  ]);

  const owners = people.filter((p) => p.role === 'OWNER').length;
  const roles = Object.keys(ROLE_LABEL) as UserRole[];

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-600">{group.name} — who works here and what they can open.</p>
      </header>

      <Card>
        <CardHeader
          title="People"
          subtitle={`${people.length} ${people.length === 1 ? 'person' : 'people'} on this dealership.`}
        />
        <div className="divide-y divide-ink-100">
          {people.map((p) => {
            /*
             * The last owner cannot demote themselves. Not a nicety: the role
             * picker is inside Settings, Settings is owner-only, and a
             * dealership with no owner is a dealership nobody can ever let a
             * new person into. Enforced again in the action.
             */
            const locked = p.role === 'OWNER' && owners === 1;
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-900">
                    {p.name}
                    {p.id === me.id ? <span className="ml-1.5 text-xs font-medium text-ink-400">you</span> : null}
                  </div>
                  <div className="truncate text-xs text-ink-500">{p.email}</div>
                </div>
                <RolePicker
                  userId={p.id}
                  role={p.role}
                  locked={locked}
                  lockedReason={locked ? 'The last owner cannot change their own role.' : undefined}
                />
              </div>
            );
          })}
        </div>
        <p className="border-t border-ink-100 bg-ink-50 px-4 py-2.5 text-xs text-ink-500">
          Adding someone is not built yet — invites by email are the next piece. Until then a
          new account signs up and you set the role here.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="What each role can open"
          subtitle="Read straight off the permission table, so this grid can never disagree with the app."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50">
                <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-500">
                  Role
                </th>
                {SECTIONS.map((s) => (
                  <th
                    key={s}
                    className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-ink-500"
                  >
                    {s.replace('-', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {roles.map((r) => (
                <tr key={r}>
                  <td className="px-4 py-2">
                    <div className="text-[13px] font-semibold text-ink-900">{ROLE_LABEL[r]}</div>
                    <div className="text-[11px] text-ink-500">{ROLE_BLURB[r]}</div>
                  </td>
                  {SECTIONS.map((s) => (
                    <td key={s} className="px-2 py-2 text-center">
                      {can(r, s) ? (
                        <span className="text-emerald-600" title="Can open">
                          ●
                        </span>
                      ) : (
                        <span className="text-ink-200" title="No access">
                          ·
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-ink-100 bg-ink-50 px-4 py-2.5 text-xs text-ink-500">
          Anyone who can open a screen can see the money on it. Hiding cost and gross from the
          sales floor is a separate change — ask before you seat someone in a role on that basis.
        </p>
      </Card>
    </div>
  );
}
