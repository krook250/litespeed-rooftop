/**
 * Every dealer's ad setup, ordered by whose needs a person.
 *
 * The roll-up is a DATABASE screen — no Meta call on it at all. That is a
 * deliberate constraint explained in `src/lib/ops/ad-desk-queries.ts`: campaign
 * status and spend cost 1 + 2N Graph calls per lot against an app-level quota,
 * so they load on the account screen where N is one dealer. What this page can
 * answer without Facebook is the question an operator actually opens it with —
 * which setups are broken or unfinished.
 */

import { requireStaff } from '@/lib/ops/guard';
import { opsAdDeskLots } from '@/lib/ops/ad-desk-queries';
import { OpsLotRow } from '@/components/ops-ad-desk';
import { EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OpsAdDeskPage() {
  await requireStaff();
  const lots = await opsAdDeskLots();

  const needsSomeone = lots.filter((l) => l.attention <= 1);
  const running = lots.filter((l) => l.attention === 2 || l.attention === 3);
  const notConnected = lots.filter((l) => l.attention === 4);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Ad Desk — every dealer</h1>
        <p className="mt-1 text-sm text-ink-600">
          Facebook setup and feed health across all {lots.length} lots. Campaign spend and the
          build controls are on each account&rsquo;s own page.
        </p>
      </div>

      <Section
        title={`Needs someone (${needsSomeone.length})`}
        subtitle="An error Facebook reported, or a setup nobody finished."
        lots={needsSomeone}
        empty="Nothing broken and nothing half-finished."
        open
      />

      <Section
        title={`Running (${running.length})`}
        subtitle="Connected and able to build. Units held back are listed per lot."
        lots={running}
        empty="No lots are fully set up yet."
      />

      <Section
        title={`Facebook not connected (${notConnected.length})`}
        subtitle="These dealers have never completed the connect flow."
        lots={notConnected}
        empty="Every dealer has connected."
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  lots,
  empty,
  open = false,
}: {
  title: string;
  subtitle: string;
  lots: Awaited<ReturnType<typeof opsAdDeskLots>>;
  empty: string;
  open?: boolean;
}) {
  /*
   * Collapsed by default except the bucket that wants a decision — the same
   * treatment `/ops` got when its queue turned into 27 rows of furniture. The
   * count on the summary line is the reassurance; the rows are not.
   */
  return (
    <details open={open} className="rounded-lg">
      <summary className="cursor-pointer py-1">
        <span className="text-sm font-semibold text-ink-900">{title}</span>
        <span className="ml-2 text-xs text-ink-500">{subtitle}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {lots.length === 0 ? (
          <EmptyState title={empty} />
        ) : (
          lots.map((l) => <OpsLotRow key={l.rooftopId} lot={l} />)
        )}
      </div>
    </details>
  );
}
