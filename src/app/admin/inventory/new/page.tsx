import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui';
import { VehicleForm } from '@/components/vehicle-form';
import { getRooftops } from '@/lib/queries';
import { saveVehicle } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function NewVehiclePage() {
  const rooftops = await getRooftops();
  return (
    <div className="px-6 py-6 lg:px-8">
      <Link href="/admin/inventory" className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Inventory
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold tracking-tight text-ink-900">Add a vehicle</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-600">
        Enter it once. Leave the VIN blank and we will build a structurally valid one for the demo.
        The unit will not go out to the marketplaces until you mark it front-line ready.
      </p>
      <Card className="max-w-5xl">
        <CardHeader title="New unit" />
        <VehicleForm rooftops={rooftops} action={saveVehicle} />
      </Card>
    </div>
  );
}
