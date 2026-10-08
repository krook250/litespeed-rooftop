import { getStorefrontByKey } from '@/lib/queries';
import { buildRobots } from '@/lib/store/sitemap';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sf = await getStorefrontByKey(slug);
  const host = (req.headers.get('host') ?? '').split(':')[0]!.toLowerCase().replace(/^www\./, '');
  const onOwnLiveDomain = Boolean(sf?.domain) && sf?.domainStatus === 'LIVE' && host === sf?.domain;

  return new Response(buildRobots(onOwnLiveDomain ? `https://${sf!.domain}` : null), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
