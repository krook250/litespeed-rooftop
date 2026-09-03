/**
 * One dealer account, everything we hold.
 *
 * `/ops/accounts` answers "who is paying". This answers "who are these people,
 * what have they got, and is any of it broken" — the screen you open before a
 * call, or when a dealer emails asking why something is not live.
 *
 * TWO PANELS ARE DELIBERATELY ABSENT rather than stubbed: **payments** and
 * **Twilio / ad-desk stats**. Neither has a source. A Payments card fed by
 * `activatedAt` would be read as a ledger, and it is not one — it is the date a
 * human pressed a button. The Plan card says so in words instead.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/ops/guard';
import { opsAccountDetail } from '@/lib/ops/queries';
import { setGroupPlan } from '@/lib/ops/actions';
import { Card, CardHeader, Badge, Button, EmptyState } from '@/components/ui';
import { relativeTime } from '@/lib/domain';
import { ROLE_LABEL } from '@/lib/permissions';
import { trialDaysLeft, trialExpired, TRIAL_DAYS } from '@/lib/plan';

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

/** A domain's live state, in the words an operator would use on the phone. */
const DOMAIN_STATUS: Record<string, { tone: 'green' | 'amber' | 'red' | 'neutral'; say: string }> = {
  NONE: { tone: 'neutral', say: 'No custom domain — running on the Rooftop URL.' },
  RESERVED: { tone: 'amber', say: 'We hold it. The dealer has not been asked to point anything yet.' },
  BLOCKED: { tone: 'red', say: 'Claimed on another Vercel account. Needs the challenge satisfied.' },
  PENDING_DNS: { tone: 'amber', say: 'Waiting on the dealer to change their DNS.' },
  VERIFYING: { tone: 'amber', say: 'DNS seen, Vercel is checking it.' },
  SSL_ISSUING: { tone: 'amber', say: 'Verified. Certificate being issued.' },
  LIVE: { tone: 'green', say: 'Serving on the dealer’s own domain.' },
  ERROR: { tone: 'red', say: 'Failed. See the error below.' },
};

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-28 flex-1 border-l border-ink-100 px-4 py-3 first:border-l-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className="tnum mt-0.5 text-xl font-semibold text-ink-900">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-40">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm text-ink-800">{children}</div>
    </div>
  );
}

export default async function OpsAccountPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  await requireStaff();
  const { groupId } = await params;
  const data = await opsAccountDetail(groupId);
  if (!data) notFound();

  const { group, people, rooftops, storefronts, domainOrders, inventory, sales, leads } = data;
  const now = new Date();
  const paid = group.plan === 'ACTIVE';
  const left = trialDaysLeft(group, now);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link href="/ops/accounts" className="text-xs text-ink-500 hover:text-ink-800">
          &larr; Accounts
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink-900">{group.name}</h1>
          {paid ? <Badge tone="green">paid</Badge> : null}
          {group.plan === 'TRIALING' ? (
            trialExpired(group, now) ? (
              <Badge tone="red">trial ended</Badge>
            ) : (
              <Badge tone={left !== null && left <= 7 ? 'amber' : 'violet'}>
                {left === null ? 'trial, no clock' : `${left} days left`}
              </Badge>
            )
          ) : null}
          {group.plan !== 'ACTIVE' && group.plan !== 'TRIALING' ? (
            <Badge tone="red">{group.plan.toLowerCase().replace('_', ' ')}</Badge>
          ) : null}
          {group.isDemo ? <Badge tone="violet">demo</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-ink-500">
          Signed up {DATE.format(group.createdAt)} · {relativeTime(group.createdAt, now)} ·{' '}
          <span className="font-mono text-xs">{group.slug}</span>
        </p>
      </div>

      {/* ------------------------------------------------------------ numbers */}
      <Card>
        <div className="flex flex-wrap">
          <Stat label="Cars ever" value={inventory.ever} hint="sold ones included" />
          <Stat label="On the ground" value={inventory.active} />
          <Stat label="Retail ready" value={inventory.retailReady} hint="public on the storefront" />
          <Stat label="Sold" value={inventory.sold} />
          <Stat label="Wholesaled" value={inventory.wholesaled} />
          <Stat label="Leads" value={leads.n} hint={leads.last ? relativeTime(leads.last, now) : 'none yet'} />
        </div>
      </Card>

      {/* ---------------------------------------------------------------- plan */}
      <Card>
        <CardHeader
          title="Plan"
          subtitle="There is no payment processor wired in. A group is paid because somebody here pressed the button — the date below is when that happened, not a receipt."
          action={
            <form action={setGroupPlan}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="plan" value={paid ? 'TRIALING' : 'ACTIVE'} />
              <Button type="submit" variant={paid ? 'ghost' : 'primary'} size="sm">
                {paid ? `Back to ${TRIAL_DAYS}-day trial` : 'Mark paid'}
              </Button>
            </form>
          }
        />
        <div className="flex flex-wrap gap-x-8 gap-y-3 px-5 py-4">
          <Field label="Status">{group.plan.toLowerCase().replace('_', ' ')}</Field>
          <Field label="Marked paid">
            {group.activatedAt ? DATE.format(group.activatedAt) : <span className="text-ink-400">never</span>}
          </Field>
          <Field label="Trial ends">
            {group.trialEndsAt ? DATE.format(group.trialEndsAt) : <span className="text-ink-400">no clock</span>}
          </Field>
        </div>
      </Card>

      {/* -------------------------------------------------------------- people */}
      <Card>
        <CardHeader
          title={`People (${people.length})`}
          subtitle="Oldest first — the first row is whoever signed the group up, and is the OWNER unless somebody changed it."
        />
        {people.length === 0 ? (
          <EmptyState title="No users" body="A group with no users cannot be signed into." />
        ) : (
          people.map((u, i) => (
            <div
              key={u.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-ink-100 px-5 py-3 first:border-t-0"
            >
              <span className="text-sm font-medium text-ink-900">{u.name}</span>
              {i === 0 ? <Badge tone="neutral">signed up</Badge> : null}
              <a href={`mailto:${u.email}`} className="text-sm text-ink-600 underline hover:text-ink-900">
                {u.email}
              </a>
              {!u.emailVerified ? <Badge tone="amber">email unverified</Badge> : null}
              <span className="ml-auto text-xs text-ink-500">
                {ROLE_LABEL[u.role] ?? u.role} · joined {relativeTime(u.createdAt, now)}
              </span>
            </div>
          ))
        )}
      </Card>

      {/* ------------------------------------------------------------ rooftops */}
      <Card>
        <CardHeader
          title={`Lots (${rooftops.length})`}
          subtitle="A lot with no address cannot feed CarGurus or Meta — both require it on every item."
        />
        {rooftops.map((r) => {
          const hasAddress = Boolean(r.addressLine1 && r.city && r.state && r.postalCode);
          const hasGeo = r.latitude !== null && r.longitude !== null;
          return (
            <div key={r.id} className="border-t border-ink-100 px-5 py-4 first:border-t-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-ink-900">{r.name}</span>
                {!r.isActive ? <Badge tone="neutral">inactive</Badge> : null}
                <span className="ml-auto text-xs text-ink-500">{r.units} units</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
                <Field label="Address">
                  {hasAddress ? (
                    `${r.addressLine1}, ${r.city}, ${r.state} ${r.postalCode}`
                  ) : (
                    <span className="text-amber-800">not filled in</span>
                  )}
                </Field>
                <Field label="Phone">{r.phone || <span className="text-ink-400">none</span>}</Field>
                <Field label="Email">{r.email || <span className="text-ink-400">none</span>}</Field>
                <Field label="Coordinates">
                  {hasGeo ? 'set' : <span className="text-amber-800">missing — blocks Meta</span>}
                </Field>
              </div>
            </div>
          );
        })}
      </Card>

      {/* --------------------------------------------------------- storefronts */}
      <Card>
        <CardHeader title={`Website (${storefronts.length})`} subtitle="Domain state as the dealer sees it." />
        {storefronts.map((sf) => {
          const d = DOMAIN_STATUS[sf.domainStatus] ?? { tone: 'neutral' as const, say: sf.domainStatus };
          return (
            <div key={sf.id} className="border-t border-ink-100 px-5 py-4 first:border-t-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-ink-900">{sf.name}</span>
                <Badge tone={d.tone}>{sf.domainStatus.toLowerCase().replace(/_/g, ' ')}</Badge>
                {sf.domainSource ? (
                  <Badge tone={sf.domainSource === 'PURCHASED' ? 'violet' : 'neutral'}>
                    {sf.domainSource === 'PURCHASED' ? 'bought through us' : 'their own domain'}
                  </Badge>
                ) : null}
                <a
                  href={sf.domain && sf.domainStatus === 'LIVE' ? `https://${sf.domain}` : `/s/${sf.slug}`}
                  className="ml-auto text-xs text-ink-500 underline hover:text-ink-800"
                >
                  open &rarr;
                </a>
              </div>
              <p className="mt-1 text-xs text-ink-600">{d.say}</p>
              <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
                <Field label="Domain">
                  {sf.domain ?? <span className="text-ink-400">none</span>}
                </Field>
                <Field label="Rooftop URL">
                  <span className="font-mono text-xs">/s/{sf.slug}</span>
                </Field>
              </div>
              {sf.domainError ? (
                <p className="mt-2 text-xs text-red-700">{sf.domainError}</p>
              ) : null}
            </div>
          );
        })}
      </Card>

      {/* -------------------------------------------------------- domain orders */}
      {domainOrders.length > 0 ? (
        <Card>
          <CardHeader
            title={`Domain purchases (${domainOrders.length})`}
            subtitle="Registered on Litespeed's card. The dealer is the ICANN registrant from day one."
          />
          {domainOrders.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-ink-100 px-5 py-3 first:border-t-0"
            >
              <span className="text-sm font-medium text-ink-900">{o.domain}</span>
              <Badge tone={o.status === 'PURCHASED' ? 'green' : o.status === 'FAILED' || o.status === 'REJECTED_OVER_CAP' ? 'red' : 'amber'}>
                {o.status.toLowerCase().replace(/_/g, ' ')}
              </Badge>
              <span className="tnum text-sm text-ink-700">
                {usd(o.priceUsd)} · {o.years} yr{o.years === 1 ? '' : 's'}
                {o.renewalPriceUsd ? ` · renews ${usd(o.renewalPriceUsd)}` : ''}
                {o.autoRenew ? '' : ' · auto-renew off'}
              </span>
              <span className="ml-auto text-xs text-ink-500">
                {o.orderedByEmail ?? 'unknown'} · {relativeTime(o.completedAt ?? o.createdAt, now)}
              </span>
              {o.error ? <p className="w-full text-xs text-red-700">{o.error}</p> : null}
            </div>
          ))}
        </Card>
      ) : null}

      {/* --------------------------------------------------------------- sales */}
      <Card>
        <CardHeader
          title="Sales"
          subtitle="Recorded in the product. Not every dealer marks units sold, so treat a zero as unknown rather than as no sales."
        />
        <div className="flex flex-wrap">
          <Stat label="Units sold" value={sales.n} />
          <Stat label="Revenue" value={usd(sales.revenue)} />
          <Stat label="Front gross" value={usd(sales.gross)} />
          <Stat label="Avg days to sell" value={sales.avgDays || '—'} />
          <Stat
            label="Last sale"
            value={sales.lastSold ? DATE.format(new Date(sales.lastSold)) : '—'}
          />
        </div>
      </Card>

      <p className="pb-4 text-xs text-ink-400">
        Twilio numbers and ad-desk spend belong on this page and have no source yet.
      </p>
    </div>
  );
}
