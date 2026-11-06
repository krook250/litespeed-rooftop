import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { requireSection } from '@/lib/auth-guard';
import { getVehicleById } from '@/lib/queries';
import { dealerSiteBase } from '@/lib/storefront-url';
import { activePrice } from '@/lib/domain';
import { MirrorHanger } from '@/components/inventory/mirror-hanger';

export const dynamic = 'force-dynamic';

/**
 * The rearview-mirror price hanger for one vehicle. Dealers used to print
 * these out of CarsForSale and hang them in the car.
 *
 * Price and miles come from the record and can be changed on the preview
 * before printing. Nothing is saved. The QR code goes to this car's page on
 * the dealer's own website.
 */
export default async function MirrorHangerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection('inventory');
  const { id } = await params;
  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const base = await dealerSiteBase(vehicle.rooftopId);
  const vdpUrl = `${base}/${vehicle.stockNumber.toLowerCase()}`;
  const qrSvg = await QRCode.toString(vdpUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const site = base.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const price = activePrice(vehicle);

  return (
    <div className="px-4 pb-16 pt-5 sm:px-6 sm:py-6 lg:px-8">
      <Link href={`/admin/inventory/${vehicle.id}`} className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Back to the vehicle
      </Link>
      <MirrorHanger
        year={String(vehicle.year)}
        make={vehicle.make}
        model={vehicle.model}
        price={price > 0 ? String(price) : ''}
        miles={vehicle.mileage > 0 ? String(vehicle.mileage) : ''}
        phone={vehicle.rooftop.phone}
        site={site}
        qrSvg={qrSvg}
      />
    </div>
  );
}
