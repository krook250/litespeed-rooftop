/**
 * The trial queue.
 *
 * `/ops` answers "whose move is it" for syndication connections. This screen
 * answers the only other operator question that costs money: **who is on a trial,
 * how long have they got, and who has paid.**
 *
 * It exists because there is no billing system. `dealer_groups.plan` is the
 * authority (see `@/lib/plan`), a human sets it, and this is where. The Mark paid
 * button is the payment gate until Authorize.net lands.
 */

import Link from 'next/link';
import { requireStaff } from '@/lib/ops/guard';
import { opsAccounts, type OpsAccount } from '@/lib/ops/queries';
import { setGroupPlan } from '@/lib/ops/actions';
import { Card, CardHeader, Badge, Button, EmptyState } from '@/components/ui';
import { relativeTime } from '@/lib/domain';
import { trialDaysLeft, trialExpired, TRIAL_DAYS } from '@/lib/plan';

export const dynamic = 'force-dynamic';

/** Inside this many days the row shouts. A week is the window where a call still works. */
const SOON_DAYS = 7;

function PlanBadge({ a, now }: { a: OpsAccount; now: Date }) {
  if (a.plan === 'ACTIVE') return <Badge tone="green">paid</Badge>;
  if (a.plan !== 'TRIALING') return <Badge tone="red">{a.plan.toLowerCase().replace('_', ' ')}</Badge>;

  const left = trialDaysLeft(a, now);
  if (trialExpired(a, now)) return <Badge tone="red">trial ended</Badge>;
  if (left === null) {
    // TRIALING with no deadline is a provisioning bug, not a state to render as
    // a number. Say so rather than inventing one.
    return <Badge tone="amber">trial, no clock</Badge>;
  }
  return (
    <Badge tone={left <= SOON_DAYS ? 'amber' : 'violet'}>
      {left} day{left === 1 ? '' : 's'} left
    </Badge>
  );
}

function Row({ a, now }: { a: OpsAccount; now: Date }) {
  const paid = a.plan === 'ACTIVE';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-100 px-5 py-4 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {/* The name is the way in — the detail screen is where an operator
              answers anything more specific than "are they paying". */}
          <Link
            href={`/ops/accounts/${a.id}`}
            className="text-sm font-semibold text-ink-900 underline decoration-ink-300 underline-offset-2 hover:decoration-ink-900"
          >
            {a.name}
          </Link>
          <PlanBadge a={a} now={now} />
          {a.isDemo ? (
            <span title="Our own lot — held out of every outbound marketplace file.">
              <Badge tone="violet">demo</Badge>
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          signed up {relativeTime(a.createdAt)} · {a.vehicles} unit{a.vehicles === 1 ? '' : 's'} ·{' '}
          {a.users} user{a.users === 1 ? '' : 's'}
          {paid && a.activatedAt ? <> · paid since {relativeTime(a.activatedAt)}</> : null}
        </p>
      </div>

      {/*
        * One link per storefront, keyed on `storefronts.slug` — NOT the group
        * slug this row is named after. The two differ by construction (group
        * `malabar-truck-and-trade` owns storefront
        * `malabar-truck-and-trade-store`), so the old `/s/${a.slug}` link 404'd
        * on every account and looked exactly like the storefronts being down.
        *
        * A storefront on its own domain is linked there, because that is the
        * address a dealer's shopper actually gets and the one worth eyeballing.
        */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {a.storefronts.length === 0 ? (
          <span className="text-xs text-ink-400">no storefront</span>
        ) : (
          a.storefronts.map((sf) => (
            <a
              key={sf.slug}
              href={sf.domain ? `https://${sf.domain}` : `/s/${sf.slug}`}
              className="text-xs text-ink-500 underline hover:text-ink-800"
            >
              {a.storefronts.length === 1 ? 'storefront' : sf.name}
            </a>
          ))
        )}
      </div>

      {/*
        * Two separate one-button forms rather than a select. The destructive
        * direction — taking a paying dealer back to a trial — should never be one
        * mis-click away from the common one, and it is only ever pressed to undo
        * a mistake.
        */}
      <form action={setGroupPlan}>
        <input type="hidden" name="groupId" value={a.id} />
        <input type="hidden" name="plan" value={paid ? 'TRIALING' : 'ACTIVE'} />
        <Button type="submit" variant={paid ? 'ghost' : 'primary'}>
          {paid ? `Back to ${TRIAL_DAYS}-day trial` : 'Mark paid'}
        </Button>
      </form>
    </div>
  );
}

export default async function OpsAccountsPage() {
  await requireStaff();
  const now = new Date();
  const accounts = await opsAccounts();

  const trials = accounts.filter((a) => a.plan === 'TRIALING');
  const paid = accounts.filter((a) => a.plan === 'ACTIVE');
  const other = accounts.filter((a) => a.plan !== 'TRIALING' && a.plan !== 'ACTIVE');

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Accounts</h1>
        <p className="mt-1 text-sm text-ink-600">
          A group is paid because someone here said so. Marking one paid is what unlocks buying a
          domain on Litespeed&apos;s card — everything else in the product works on the trial.
        </p>
      </div>

      <Card>
        <CardHeader
          title="On trial"
          subtitle="Soonest to run out first. Nothing switches off automatically."
          action={<span className="tnum text-sm text-ink-500">{trials.length}</span>}
        />
        {trials.length ? (
          trials.map((a) => <Row key={a.id} a={a} now={now} />)
        ) : (
          <EmptyState title="Nobody on trial" body="Every group here has been marked paid." />
        )}
      </Card>

      <Card>
        <CardHeader title="Paid" action={<span className="tnum text-sm text-ink-500">{paid.length}</span>} />
        {paid.length ? (
          paid.map((a) => <Row key={a.id} a={a} now={now} />)
        ) : (
          <EmptyState title="No paid accounts yet" body="Mark a group paid once their subscription starts." />
        )}
      </Card>

      {other.length ? (
        <Card>
          <CardHeader title="Lapsed" subtitle="Nothing sets these yet — see the plan enum." />
          {other.map((a) => <Row key={a.id} a={a} now={now} />)}
        </Card>
      ) : null}
    </div>
  );
}
