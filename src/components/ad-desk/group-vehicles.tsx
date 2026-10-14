'use client';

/**
 * The cars a group is advertising, as Facebook has them right now.
 *
 * Loaded on a click, not with the page: it is a live read of the group's
 * vehicle list at Facebook, and the list screen should not pay for it on
 * every visit. Anything Facebook still shows that Rooftop has sold or no
 * longer has goes to the top in red.
 */

import { useActionState } from 'react';
import { Button } from '../ui';
import { groupVehiclesAction } from '@/lib/meta/demo-actions';

const STATUS: Record<string, string> = {
  ARRIVED: 'Arrived',
  IN_RECON: 'In recon',
  PHOTOS_PENDING: 'Photos pending',
  FRONT_LINE_READY: 'Front-line',
  PENDING_SALE: 'Pending sale',
  SOLD: 'Sold',
  WHOLESALED: 'Wholesaled',
};

/** Facebook returns "17499 USD"; show "$17,499". Anything else is shown as given. */
function price(raw: string) {
  const m = /^([\d.]+)\s*USD$/i.exec(raw.trim());
  return m ? `$${Math.round(Number(m[1])).toLocaleString()}` : raw;
}

export function GroupVehicles({ rooftopId, adSetId }: { rooftopId: string; adSetId: string }) {
  const [state, action, loading] = useActionState(groupVehiclesAction, null);
  const data = state?.ok ? state.data : undefined;
  const problems = data?.vehicles.filter((v) => v.problem).length ?? 0;

  return (
    <div className="mt-3 border-t border-ink-200 pt-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="rooftopId" value={rooftopId} />
        <input type="hidden" name="adSetId" value={adSetId} />
        <Button type="submit" variant="secondary" size="sm" disabled={loading}>
          {loading ? 'Asking Facebook…' : data ? 'Check again' : 'Show the cars this group is advertising'}
        </Button>
        {data ? (
          <span className="text-[11px] text-ink-600">
            {data.count} {data.count === 1 ? 'car' : 'cars'} in this group at Facebook, right now
            {problems ? (
              <span className="font-medium text-red-700">
                {' '}· {problems} {problems === 1 ? 'needs' : 'need'} attention
              </span>
            ) : null}
          </span>
        ) : null}
      </form>

      {state && !state.ok ? (
        <p className="mt-2 rounded bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{state.error}</p>
      ) : null}

      {data?.wrongCatalog ? (
        <p className="mt-2 rounded bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          This group is pulling from a different catalog than the one Rooftop updates. Changes to your
          inventory will not reach it.
        </p>
      ) : null}

      {data && data.vehicles.length ? (
        <table className="mt-2 w-full text-[11px] tabular-nums">
          <tbody>
            {data.vehicles.map((v) => (
              <tr key={v.vehicleId || v.title} className={v.problem ? 'text-red-700' : 'text-ink-700'}>
                <td className="py-1 pr-3">
                  <span className={v.problem ? 'font-medium' : 'font-medium text-ink-900'}>{v.title}</span>
                  {v.problem ? <span className="ml-2">{v.problem}</span> : null}
                </td>
                <td className="py-1 pr-3 text-right">{price(v.price)}</td>
                <td className="py-1 pr-3 text-right text-ink-500">
                  {v.rooftop ? `#${v.rooftop.stockNumber}` : ''}
                </td>
                <td className="py-1 text-right text-ink-500">
                  {v.rooftop ? STATUS[v.rooftop.status] ?? v.rooftop.status : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {data && data.vehicles.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-600">Facebook has no cars in this group, so it has nothing to show.</p>
      ) : null}
    </div>
  );
}
