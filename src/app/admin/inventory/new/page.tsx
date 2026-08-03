import Link from 'next/link';
import { ScanPanel } from '@/components/intake/scan-panel';
import { getRooftops } from '@/lib/queries';
import { saveVehicle } from '@/lib/actions';
import { availableReader } from '@/lib/intake/read-document';

export const dynamic = 'force-dynamic';

export default async function NewVehiclePage() {
  const rooftops = await getRooftops();
  // Checked on the server so the page can be honest about it before anyone
  // wastes a photo — an unconfigured environment says so up front rather than
  // failing after the upload.
  const reader = availableReader();

  return (
    <div className="px-6 py-6 lg:px-8">
      <Link href="/admin/inventory" className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Inventory
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold tracking-tight text-ink-900">Add a vehicle</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-600">
        Photograph the paperwork and the form fills itself in. The VIN decides the specs, so
        the only things worth checking are the mileage, the price and the title.
      </p>

      {reader === 'none' ? (
        <p className="mb-6 max-w-2xl rounded-lg bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/20">
          Document reading is not switched on in this environment — set{' '}
          <code className="font-mono">ANTHROPIC_API_KEY</code> to enable it. VIN barcodes and typed
          VINs still work, and so does the form.
        </p>
      ) : null}

      <div className="max-w-5xl">
        <ScanPanel rooftops={rooftops} action={saveVehicle} />
      </div>
    </div>
  );
}
