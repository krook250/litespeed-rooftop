import Link from 'next/link';
import { ImportPanel } from '@/components/import/import-panel';
import { getRooftops } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const rooftops = await getRooftops();

  return (
    <div className="px-6 py-6 lg:px-8">
      <Link href="/admin/inventory" className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Inventory
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold tracking-tight text-ink-900">Import inventory</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-600">
        Bring a whole lot in from a spreadsheet. Most dealers already have one — whoever
        syndicates for them today exports it, and it is usually easier to ask for that file than
        to ask anybody to type twenty cars.
      </p>

      <div className="max-w-6xl">
        <ImportPanel rooftops={rooftops.map((r) => ({ id: r.id, name: r.name }))} />
      </div>
    </div>
  );
}
