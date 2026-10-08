import { getLiveInventory, getStorefrontByKey } from '@/lib/queries';
import { buildSitemap } from '@/lib/store/sitemap';

/* Same set the SRP and VDP render. ARRIVED and IN_RECON have no photo set. */
const PUBLIC_STATUSES = new Set(['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE']);

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  const host = (req.headers.get('host') ?? '').split(':')[0]!.toLowerCase().replace(/^www\./, '');

  // Only on the dealer's own live domain. See the note in `src/lib/store/sitemap.ts`.
  if (!sf || !sf.domain || sf.domainStatus !== 'LIVE' || host !== sf.domain) {
    return new Response('Not found', { status: 404 });
  }

  const vehicles = (await getLiveInventory({ rooftopIds: sf.rooftopIds })).filter((v) =>
    PUBLIC_STATUSES.has(v.status),
  );

  const xml = buildSitemap({
    origin: `https://${sf.domain}`,
    lotSlugs: sf.rooftops.map((r) => r.slug),
    vehicles,
  });

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
