/**
 * One channel connection, set up.
 *
 * THE HYBRID MODEL, ON ONE SCREEN. Onboarding a marketplace is mostly our work
 * — building the feed, getting into it, chasing the destination — and exactly
 * one step of it cannot be done by anybody but the dealer, because these
 * marketplaces will not take direction about a dealer's account from a vendor.
 * So this page has one job: say where things stand, and put the dealer's single
 * step in front of them when it is theirs to take. Every other state is
 * read-only and says who is holding it.
 *
 * What is deliberately NOT here: `internalNote`, `providerDealerId`, and the
 * transitions to SUBMITTED and CONNECTED. Those are ours. There is no Rooftop
 * staff role in this app — `userRoleEnum` is OWNER / MANAGER / SALES /
 * LOT_PORTER, all dealer-side — so there is no surface here that could show
 * them safely.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardHeader, Badge, Button, cn, EmptyState } from '@/components/ui';
import { RepEmail } from '@/components/syndication/rep-email';
import { sessionScope } from '@/lib/queries';
import { getConnectionInScope } from '@/lib/scoped-db';
import { CONNECTION_STATUS_LABEL, relativeTime } from '@/lib/domain';
import { requestConnection, confirmDealerAccount } from '@/lib/connection-actions';

export const dynamic = 'force-dynamic';

const TONE: Record<string, 'green' | 'amber' | 'blue' | 'red' | 'neutral'> = {
  CONNECTED: 'green',
  AWAITING_DEALER: 'amber',
  SUBMITTED: 'blue',
  ERROR: 'red',
  PENDING_SETUP: 'neutral',
  DISCONNECTED: 'neutral',
};

/**
 * The four timestamps, as a sentence each.
 *
 * The runbook asks for these to be reported on, and a dealer asking "why is
 * this taking two weeks" is answered far better by four dates than by a status
 * word. A step that has not happened is shown greyed rather than hidden, so the
 * length of what is left is visible.
 */
function Step({
  label,
  at,
  done,
  now,
}: {
  label: string;
  at: Date | null;
  done: boolean;
  now: Date;
}) {
  return (
    <li className="flex items-baseline gap-3">
      <span
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
          done ? 'bg-emerald-500' : 'bg-ink-200',
        )}
      />
      <span className={cn('text-sm', done ? 'text-ink-800' : 'text-ink-400')}>{label}</span>
      <span className="ml-auto shrink-0 text-xs text-ink-400">
        {at ? relativeTime(at, now) : '—'}
      </span>
    </li>
  );
}

export default async function ConnectionPage({
  params,
}: {
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = await params;
  const scope = await sessionScope();
  const row = await getConnectionInScope(scope, connectionId);
  if (!row) notFound();

  const conn = row.channel_connections;
  const channel = row.channels;
  const lot = row.rooftops;
  const now = new Date();

  const confirmed = Boolean(conn.dealerConfirmedAt);
  // AWAITING_DEALER means two different things depending on whether the dealer
  // has done their part, and telling somebody who has already acted that we are
  // "waiting on you" is the fastest way to lose their trust in the whole board.
  const yourMove = conn.status === 'AWAITING_DEALER' && !confirmed;

  const repEmail = [
    `Hi [rep],`,
    ``,
    `We've moved our inventory management to Rooftop Auto. Please switch our`,
    `inventory feed source over to them — they'll be sending our listings from`,
    `here on. Their team is at feeds@rooftopauto.com if you need anything from`,
    `their side.`,
    ``,
    `Thanks,`,
    `${lot.name}`,
  ].join('\n');

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/syndication" className="text-xs text-ink-500 hover:text-ink-800">
        ← Syndication
      </Link>

      <div className="mt-3 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{channel.name}</h1>
          <p className="mt-0.5 text-sm text-ink-500">{lot.name}</p>
        </div>
        <Badge tone={TONE[conn.status] ?? 'neutral'}>
          {CONNECTION_STATUS_LABEL[conn.status] ?? conn.status}
        </Badge>
      </div>

      {/* ------------------------------------------------- the dealer's step */}

      {conn.status === 'PENDING_SETUP' ? (
        <Card className="mb-6">
          <CardHeader
            title={`Send your inventory to ${channel.shortName}`}
            subtitle="We build the feed and handle the back-and-forth. It takes one to two weeks, most of which is on their side."
          />
          <div className="px-5 py-4">
            <p className="mb-4 text-sm text-ink-600">
              You keep your {channel.shortName} account and keep paying them directly — this
              only changes where their listings come from. Your existing feed keeps running
              until the new one is confirmed carrying, so there is no day where your cars are
              not listed.
            </p>
            <form action={requestConnection}>
              <input type="hidden" name="connectionId" value={conn.id} />
              <Button type="submit">Set up {channel.shortName}</Button>
            </form>
          </div>
        </Card>
      ) : null}

      {yourMove ? (
        <Card className="mb-6 ring-1 ring-amber-300">
          <CardHeader
            title="Your move — one email"
            subtitle={`${channel.shortName} will not take direction about your account from us, so this part is yours.`}
          />
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-ink-600">
              Email your {channel.shortName} account rep and tell them your inventory now comes
              from Rooftop Auto. That is the whole ask. Then click the button below and we take
              it from there.
            </p>

            <RepEmail body={repEmail} />

            <form action={confirmDealerAccount} className="border-t border-ink-100 pt-4">
              <input type="hidden" name="connectionId" value={conn.id} />
              <p className="mb-3 text-xs text-ink-500">
                By confirming you are telling us that your {channel.shortName} account is active
                and paid, and that you have emailed your rep. We have no way to check either —
                there is no API anywhere in this category that answers it — so we are taking
                your word for it.
              </p>
              <Button type="submit">I&rsquo;ve emailed my rep</Button>
            </form>
          </div>
        </Card>
      ) : null}

      {conn.status === 'AWAITING_DEALER' && confirmed ? (
        <Card className="mb-6">
          <CardHeader
            title="Nothing more for you to do"
            subtitle={`We are adding your inventory to the ${channel.shortName} feed.`}
          />
          <div className="px-5 py-4 text-sm text-ink-600">
            You confirmed {relativeTime(conn.dealerConfirmedAt, now)}. Next we put your lot in
            the outbound file, then {channel.shortName} switches the source over on their side.
            That last step is theirs and usually takes a few days.
          </div>
        </Card>
      ) : null}

      {conn.status === 'SUBMITTED' ? (
        <Card className="mb-6">
          <CardHeader
            title={`Waiting on ${channel.shortName}`}
            subtitle="Your inventory is in the feed. They switch the source over on their side."
          />
          <div className="px-5 py-4 text-sm text-ink-600">
            There is no button on their end either — a person does this by hand, and it
            commonly takes a few days. Your existing feed keeps running until theirs is
            confirmed carrying.
          </div>
        </Card>
      ) : null}

      {conn.status === 'ERROR' ? (
        <Card className="mb-6 ring-1 ring-red-300">
          <CardHeader title="This connection needs attention" />
          <div className="px-5 py-4 text-sm text-ink-700">
            {conn.errorMessage || 'We are looking into it.'}
            <p className="mt-2 text-xs text-ink-500">
              One thing worth checking first: if {channel.shortName} has been live and nothing
              is showing, confirm the account is still paid and current. That is the most
              common cause and the one we cannot see from here.
            </p>
          </div>
        </Card>
      ) : null}

      {conn.status === 'CONNECTED' ? (
        <Card className="mb-6">
          <CardHeader
            title="Live"
            subtitle={`${channel.shortName} is carrying your inventory.`}
          />
          <div className="px-5 py-4 text-sm text-ink-600">
            Last sync {relativeTime(conn.lastSyncAt, now)}. Sold cars come off automatically.
          </div>
        </Card>
      ) : null}

      {conn.status === 'DISCONNECTED' ? (
        <Card className="mb-6">
          <EmptyState
            title="Not connected"
            body={`We are not sending your inventory to ${channel.shortName}. Ask us if you would like to start.`}
          />
        </Card>
      ) : null}

      {/* ------------------------------------------------------------ steps */}

      <Card>
        <CardHeader title="Where this is up to" />
        <ul className="space-y-3 px-5 py-4">
          <Step label="You asked us to set this up" at={conn.requestedAt} done={Boolean(conn.requestedAt)} now={now} />
          <Step label="You emailed your rep" at={conn.dealerConfirmedAt} done={confirmed} now={now} />
          <Step label="We put your lot in the feed" at={conn.submittedAt} done={Boolean(conn.submittedAt)} now={now} />
          <Step label={`${channel.shortName} switched the source over`} at={conn.liveAt} done={Boolean(conn.liveAt)} now={now} />
        </ul>
      </Card>
    </div>
  );
}
