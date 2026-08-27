/**
 * The onboarding queue.
 *
 * One screen, bucketed by **whose move it is**, because that is the only
 * question this surface exists to answer. `claude/syndication-onboarding-runbook.md`
 * §1: a connection sitting in `AWAITING_DEALER` is the state that will hurt us,
 * since nothing happens there unless somebody chases — so it is at the top, split
 * into the two piles that need opposite actions.
 *
 * The split is `dealerConfirmedAt`, not `status`. A dealer who has confirmed has
 * done everything they can and is waiting on us; a dealer who has not needs a
 * phone call. Both sit in `AWAITING_DEALER` and they are completely different
 * jobs.
 */

import Link from 'next/link';
import { Card, CardHeader, Badge, Button, EmptyState, cn } from '@/components/ui';
import { relativeTime, CONNECTION_STATUS_INTERNAL } from '@/lib/domain';
import {
  opsConnections,
  opsFeedUploads,
  opsRooftopChannels,
  type OpsConnection,
  type OpsFeedUpload,
} from '@/lib/ops/queries';
import {
  markSubmitted,
  markLive,
  markError,
  saveOpsFields,
  provisionChannels,
  runCarGurusNow,
} from '@/lib/ops/actions';
import { CARGURUS_CHANNEL_KEY } from '@/lib/cargurus/feed';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

/** Past this many days in a dealer-blocked state, the row says so out loud. */
const STALE_DAYS = 7;

function daysSince(d: Date | null, now: Date): number | null {
  if (!d) return null;
  return Math.floor((now.getTime() - new Date(d).getTime()) / DAY);
}

function Row({ c, now }: { c: OpsConnection; now: Date }) {
  const waiting = daysSince(c.requestedAt, now);
  const stale = waiting !== null && waiting >= STALE_DAYS && !c.dealerConfirmedAt;

  return (
    <div className="border-t border-ink-100 px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-ink-900">{c.groupName}</span>
        <span className="text-ink-300">/</span>
        <span className="text-sm text-ink-700">{c.rooftopName}</span>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-medium text-ink-800">{c.channelShortName}</span>

        <Badge tone={stale ? 'red' : 'neutral'} className="ml-auto">
          {CONNECTION_STATUS_INTERNAL[c.status] ?? c.status}
          {waiting !== null ? ` · ${waiting}d` : ''}
        </Badge>
      </div>

      {stale ? (
        <p className="mt-1.5 text-xs font-medium text-red-700">
          Asked {waiting} days ago and the dealer has not confirmed. Nothing will happen
          here until somebody calls them.
        </p>
      ) : null}

      {c.errorMessage ? (
        <p className="mt-1.5 text-xs text-red-700">{c.errorMessage}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
        <span>asked {relativeTime(c.requestedAt, now)}</span>
        <span>dealer confirmed {relativeTime(c.dealerConfirmedAt, now)}</span>
        <span>submitted {relativeTime(c.submittedAt, now)}</span>
        <span>live {relativeTime(c.liveAt, now)}</span>
      </div>

      {/* ------------------------------------------------------- our fields */}
      <form action={saveOpsFields} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="connectionId" value={c.connectionId} />
        <input
          name="providerDealerId"
          defaultValue={c.providerDealerId ?? ''}
          placeholder="provider dealer id (blank = our rooftop id)"
          className="w-64 rounded border border-ink-300 px-2 py-1 text-xs"
        />
        <input
          name="internalNote"
          defaultValue={c.internalNote}
          placeholder="internal note — incumbent feed, rep name"
          className="min-w-[18rem] flex-1 rounded border border-ink-300 px-2 py-1 text-xs"
        />
        <Button type="submit" variant="secondary" size="sm">Save</Button>
      </form>

      {/* ---------------------------------------------------- transitions */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {c.status === 'AWAITING_DEALER' && c.dealerConfirmedAt ? (
          <form action={markSubmitted}>
            <input type="hidden" name="connectionId" value={c.connectionId} />
            <Button type="submit" size="sm">Mark submitted</Button>
          </form>
        ) : null}

        {c.status === 'SUBMITTED' || c.status === 'ERROR' ? (
          <form action={markLive}>
            <input type="hidden" name="connectionId" value={c.connectionId} />
            <Button type="submit" size="sm">Mark live</Button>
          </form>
        ) : null}

        {c.status !== 'ERROR' && c.status !== 'PENDING_SETUP' ? (
          <form action={markError} className="flex items-center gap-2">
            <input type="hidden" name="connectionId" value={c.connectionId} />
            <input
              name="errorMessage"
              placeholder="what the dealer should be told"
              className="w-72 rounded border border-ink-300 px-2 py-1 text-xs"
            />
            <Button type="submit" variant="secondary" size="sm">Flag error</Button>
          </form>
        ) : null}

        {c.channelKey === CARGURUS_CHANNEL_KEY ? (
          <a
            href={`/api/cargurus/feed/${c.rooftopId}`}
            className="text-xs font-medium text-ink-700 underline hover:text-ink-900"
          >
            Download feed file
          </a>
        ) : null}

        <Link
          href={`/admin/syndication/${c.connectionId}`}
          className="ml-auto text-xs text-ink-500 hover:text-ink-800"
        >
          Dealer&rsquo;s view &rarr;
        </Link>
      </div>
    </div>
  );
}

function Bucket({
  title,
  subtitle,
  rows,
  now,
  tone,
}: {
  title: string;
  subtitle: string;
  rows: OpsConnection[];
  now: Date;
  tone?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className={`mb-5 ${tone ?? ''}`}>
      <CardHeader title={`${title} (${rows.length})`} subtitle={subtitle} />
      <div>
        {rows.map((c) => (
          <Row key={c.connectionId} c={c} now={now} />
        ))}
      </div>
    </Card>
  );
}

/**
 * Rooftops that cannot be onboarded yet, and why.
 *
 * Deliberately at the top and above the queue. A dealer with no channel rows is
 * invisible in every bucket below — they are not waiting on anybody, they simply
 * do not exist to the syndication system — so without this card a signed-up
 * dealer could sit untouched indefinitely and nothing on this page would say so.
 */
async function Provisioning() {
  const rooftops = await opsRooftopChannels();
  const needsWork = rooftops.filter((r) => r.missing.length > 0 || r.incomplete.length > 0);
  if (needsWork.length === 0) return null;

  return (
    <Card className="mb-5 ring-1 ring-blue-300">
      <CardHeader
        title={`Rooftops needing setup (${needsWork.length})`}
        subtitle="Signup creates a group, a rooftop and a storefront — not channel connections, and not an address. Both are done here."
      />
      <div>
        {needsWork.map((r) => (
          <div key={r.rooftopId} className="border-t border-ink-100 px-5 py-4 first:border-t-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold text-ink-900">{r.groupName}</span>
              <span className="text-ink-300">/</span>
              <span className="text-sm text-ink-700">{r.rooftopName}</span>
              <span className="ml-auto text-[11px] text-ink-400">{r.rooftopSlug}</span>
            </div>

            {r.incomplete.length > 0 ? (
              <p className="mt-1.5 text-xs text-amber-800">
                Missing {r.incomplete.join(', ')} — CarGurus requires the address and Meta
                requires coordinates on every item, so this lot cannot feed anything until
                the dealer fills these in on their Lots screen.
              </p>
            ) : null}

            {r.missing.length > 0 ? (
              <form action={provisionChannels} className="mt-2.5">
                <input type="hidden" name="rooftopId" value={r.rooftopId} />
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {r.missing.map((c) => (
                    <label key={c.id} className="flex items-center gap-1.5 text-xs text-ink-700">
                      <input type="checkbox" name="channelId" value={c.id} />
                      {c.shortName}
                    </label>
                  ))}
                </div>
                <Button type="submit" size="sm" className="mt-2.5">
                  Add selected channels
                </Button>
              </form>
            ) : (
              <p className="mt-1.5 text-xs text-ink-500">All channels provisioned.</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}


/**
 * The CarGurus upload log.
 *
 * Placed above the onboarding queue on purpose. A refused upload is time-
 * sensitive in a way that a connection sitting in AWAITING_DEALER is not: the
 * guard stops one push, and if nobody looks, the next scheduled run stops too,
 * and the dealer's inventory quietly goes stale rather than dark. Stale is
 * harder to notice and takes longer to explain.
 */
function UploadRow({ u, now }: { u: OpsFeedUpload; now: Date }) {
  const tone = u.status === 'UPLOADED' ? 'green' : u.status === 'SKIPPED' ? 'amber' : 'red';
  const lots = (u.lots ?? []).filter((l) => l.sent > 0 || l.excluded > 0);

  return (
    <div className="border-t border-ink-200 px-5 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{u.status}</Badge>
        <span className="text-sm font-medium text-ink-900">
          {u.rowCount} {u.rowCount === 1 ? 'vehicle' : 'vehicles'} · {u.lotCount}{' '}
          {u.lotCount === 1 ? 'lot' : 'lots'}
        </span>
        {u.excludedCount > 0 ? (
          <span className="text-xs text-ink-500">{u.excludedCount} held out</span>
        ) : null}
        <span className="ml-auto text-xs text-ink-400">
          {relativeTime(u.startedAt, now)}
        </span>
      </div>

      {u.message ? (
        <p
          className={cn(
            'mt-1.5 text-sm',
            u.status === 'FAILED' ? 'text-red-700' : 'text-amber-800',
          )}
        >
          {u.message}
        </p>
      ) : null}

      {u.status === 'UPLOADED' ? (
        <p className="mt-1 font-mono text-xs text-ink-400">
          {u.filename} · {Math.round(u.bytes / 1024)} KB
        </p>
      ) : null}

      {u.warnings && u.warnings.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {u.warnings.map((w, i) => (
            <li key={i} className="text-xs text-amber-700">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {lots.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {lots.map((l) => (
            <span
              key={l.rooftopId}
              className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-700"
              title={`${l.excluded} held out`}
            >
              {l.rooftopName}
              <span className={cn('font-medium', l.sent === 0 && 'text-red-600')}>{l.sent}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

async function FeedUploads() {
  const uploads = await opsFeedUploads();
  const now = new Date();
  const last = uploads[0];

  return (
    <Card className="mb-6">
      <CardHeader
        title="CarGurus uploads"
        subtitle="Twice daily at 2am and 2pm Pacific. A refused run is the guard working, not a fault — read the reason before forcing it."
        action={
          <div className="flex shrink-0 gap-2">
            <form action={runCarGurusNow}>
              <Button type="submit" size="sm" variant="secondary">
                Run now
              </Button>
            </form>
            <form action={runCarGurusNow}>
              <input type="hidden" name="force" value="1" />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className="text-red-600 hover:bg-red-50"
                title="Skips the short-file guard. Only for a dealer who was disconnected on purpose."
              >
                Force
              </Button>
            </form>
          </div>
        }
      />
      {uploads.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-500">
          Nothing has been pushed yet. Until CarGurus issues FTP credentials, a run records{' '}
          <span className="font-medium">SKIPPED</span> and sends nothing.
        </p>
      ) : (
        <>
          {last && last.status !== 'UPLOADED' ? (
            <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
              The most recent run did not send. Nothing was delisted — but nothing was updated
              either, and the next scheduled run will reach the same conclusion.
            </p>
          ) : null}
          {uploads.map((u) => (
            <UploadRow key={u.id} u={u} now={now} />
          ))}
        </>
      )}
    </Card>
  );
}

export default async function OpsPage() {
  const all = await opsConnections();
  const now = new Date();

  const readyToSubmit = all.filter(
    (c) => c.status === 'AWAITING_DEALER' && c.dealerConfirmedAt,
  );
  const chase = all.filter((c) => c.status === 'AWAITING_DEALER' && !c.dealerConfirmedAt);
  const waitingOnChannel = all.filter((c) => c.status === 'SUBMITTED');
  const errored = all.filter((c) => c.status === 'ERROR');
  const live = all.filter((c) => c.status === 'CONNECTED');
  const idle = all.filter(
    (c) => c.status === 'PENDING_SETUP' || c.status === 'DISCONNECTED',
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold text-ink-900">Onboarding queue</h1>
      <p className="mb-6 text-sm text-ink-500">
        {all.length} connections across every dealer group. Ordered by whose move it is.
      </p>

      <FeedUploads />

      <Provisioning />

      {all.length === 0 ? (
        <EmptyState
          title="No connections yet"
          body="Provision channels for a rooftop above and they will appear here."
        />
      ) : null}

      <Bucket
        title="Ready for us to submit"
        subtitle="The dealer has confirmed their account and emailed their rep. Add them to the outbound file, then mark submitted."
        rows={readyToSubmit}
        now={now}
        tone="ring-1 ring-emerald-300"
      />
      <Bucket
        title="Chase the dealer"
        subtitle="Requested, not confirmed. Nothing moves until somebody calls them."
        rows={chase}
        now={now}
        tone="ring-1 ring-amber-300"
      />
      <Bucket
        title="Needs attention"
        subtitle="Check whether the dealer's account is still paid before debugging the feed — there is no API that tells us."
        rows={errored}
        now={now}
        tone="ring-1 ring-red-300"
      />
      <Bucket
        title="Waiting on the channel"
        subtitle="We have submitted. A person on their side switches the source over, usually in a few days."
        rows={waitingOnChannel}
        now={now}
      />
      <Bucket title="Live" subtitle="Carrying inventory." rows={live} now={now} />
      <Bucket
        title="Not started"
        subtitle="The dealer has not asked for these."
        rows={idle}
        now={now}
      />
    </div>
  );
}
