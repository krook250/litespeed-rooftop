import Link from 'next/link';
import { EmptyState, cn } from '@/components/ui';
import { hasCost, num, shortTitle, totalCost, usd } from '@/lib/domain';
import type { SoldUnit } from '@/lib/queries';

/**
 * Sold units. Gross is worked out from the vehicle's cost as it stands now, and
 * only when there is one: a unit imported with no cost would otherwise book
 * its whole sale price as gross. Those rows say "No cost" and link to the
 * record, where the cost can still be filled in.
 */
function grossOf(u: SoldUnit) {
  if (u.soldPrice == null || !hasCost(u)) return null;
  return u.soldPrice - totalCost(u);
}

function GrossCell({ u }: { u: SoldUnit }) {
  const g = grossOf(u);
  if (g == null) {
    return (
      <span className="text-ink-400" title={u.soldPrice == null ? 'No sale price recorded.' : 'No cost, pack or recon recorded on this unit.'}>
        {u.soldPrice == null ? 'No price' : 'No cost'}
      </span>
    );
  }
  return (
    <span className={cn('font-semibold', g < 0 ? 'text-red-600' : g < 1200 ? 'text-amber-700' : 'text-emerald-700')}>
      {usd(g)}
    </span>
  );
}

const date = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function SoldTable({ units }: { units: SoldUnit[] }) {
  if (!units.length) {
    return <EmptyState title="Nothing sold in the last 90 days" body="Units marked sold show up here." />;
  }
  return (
    <>
      <div className="md:hidden">
        {units.map((u) => (
          <Link
            key={u.id}
            href={`/admin/inventory/${u.id}`}
            className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-900">
                {shortTitle(u)} <span className="font-normal text-ink-500">{u.trim}</span>
              </div>
              <div className="tnum text-[11px] text-ink-500">
                Sold {date(u.soldAt)} · {num(u.daysToSell)} days · {u.soldPrice == null ? 'no price' : usd(u.soldPrice)}
              </div>
            </div>
            <div className="tnum shrink-0 text-sm"><GrossCell u={u} /></div>
          </Link>
        ))}
      </div>

      <div className="scroll-thin hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50/60 text-xs text-ink-600">
              <th className="px-5 py-2.5 text-left font-semibold">Sold</th>
              <th className="px-3 py-2.5 text-left font-semibold">Unit</th>
              <th className="px-3 py-2.5 text-right font-semibold">Days to sell</th>
              <th className="px-3 py-2.5 text-right font-semibold">Sold price</th>
              <th className="px-3 py-2.5 text-right font-semibold">Cost + pack + recon</th>
              <th className="px-5 py-2.5 text-right font-semibold">Gross</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-b border-ink-100 hover:bg-ink-50/60">
                <td className="tnum px-5 py-2.5 text-xs text-ink-600">{date(u.soldAt)}</td>
                <td className="px-3 py-2.5">
                  <Link href={`/admin/inventory/${u.id}`} className="block truncate text-xs font-semibold text-ink-900 hover:underline">
                    {shortTitle(u)} <span className="font-normal text-ink-500">{u.trim}</span>
                  </Link>
                  <div className="tnum truncate text-[11px] text-ink-500">
                    {u.stockNumber} · {num(u.mileage)} mi
                  </div>
                </td>
                <td className="tnum px-3 py-2.5 text-right text-ink-600">{num(u.daysToSell)}</td>
                <td className="tnum px-3 py-2.5 text-right font-semibold text-ink-900">
                  {u.soldPrice == null ? <span className="font-normal text-ink-400">—</span> : usd(u.soldPrice)}
                </td>
                <td className="tnum px-3 py-2.5 text-right text-ink-600">
                  {hasCost(u) ? usd(totalCost(u)) : <span className="text-ink-400">—</span>}
                </td>
                <td className="tnum px-5 py-2.5 text-right"><GrossCell u={u} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
