import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSection } from '@/lib/auth-guard';
import { getVehicleById } from '@/lib/queries';
import { BuyersGuide } from '@/components/inventory/buyers-guide';

export const dynamic = 'force-dynamic';

/**
 * The FTC Buyers Guide (16 C.F.R. 455) for one vehicle, ready to print and
 * hang in the window. Dealers used to print this out of CarsForSale.
 *
 * Nothing here is saved: the dealer ticks the boxes on the form itself and
 * prints. The vehicle and dealer lines come from the record.
 */
export default async function BuyersGuidePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection('inventory');
  const { id } = await params;
  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const r = vehicle.rooftop;

  return (
    <div className="px-4 pb-16 pt-5 sm:px-6 sm:py-6 lg:px-8">
      <Link href={`/admin/inventory/${vehicle.id}`} className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Back to the vehicle
      </Link>
      <BuyersGuide
        vehicle={{
          make: vehicle.make,
          model: vehicle.model,
          year: String(vehicle.year),
          vin: vehicle.vin ?? '',
        }}
        dealer={{
          name: r.name,
          address: `${r.addressLine1}, ${r.city}, ${r.state} ${r.postalCode}`,
          phone: r.phone,
          email: r.email,
        }}
      />
    </div>
  );
}
