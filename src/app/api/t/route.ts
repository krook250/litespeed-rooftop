import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import {
  classifySource,
  isBot,
  isSource,
  SOURCE_COOKIE,
  VISITOR_COOKIE,
} from '@/lib/analytics/source';
import { bumpSiteStat } from '@/lib/analytics/record';

/**
 * The storefront page-view beacon.
 *
 * A public write path, so it is narrow on purpose:
 *
 *  - Always answers 204. A caller learns nothing — not whether the storefront
 *    exists, not whether the view was counted.
 *  - Bots are dropped by user agent; headless browsers mostly never get here
 *    (`navigator.webdriver` stops the client).
 *  - One row per visitor per page per 30 minutes. A refresh, a back button and a
 *    shopper flicking between two cars are one look each, not six.
 *  - Nothing identifying is stored: a random visitor id in a first-party cookie,
 *    the path, and where the visit came from. No IP, no user agent.
 *
 * Runs on the dealer's own domain — `proxy.ts` leaves `/api` alone on every
 * host — so the cookies are first-party there and survive Safari's limits on
 * script-set cookies.
 */

const RESERVED = new Set(['privacy', 'loan-application', 'visit']);
const DEDUPE_MS = 30 * 60_000;
const YEAR = 60 * 60 * 24 * 365;

export async function POST(req: NextRequest) {
  const done = new NextResponse(null, { status: 204 });

  try {
    if (isBot(req.headers.get('user-agent'))) return done;

    const raw = await req.text();
    if (raw.length > 4000) return done;
    const body = JSON.parse(raw) as { s?: unknown; p?: unknown; q?: unknown; r?: unknown };

    const storefrontId = typeof body.s === 'string' ? body.s.slice(0, 64) : '';
    let path = typeof body.p === 'string' ? body.p : '';
    if (!storefrontId || !path.startsWith('/')) return done;
    path = path.split('?')[0]!.split('#')[0]!.slice(0, 300).replace(/\/+$/, '') || '/';

    const links = await db
      .select({ rooftopId: t.storefrontRooftops.rooftopId })
      .from(t.storefrontRooftops)
      .where(eq(t.storefrontRooftops.storefrontId, storefrontId));
    if (!links.length) return done;
    const rooftopIds = links.map((l) => l.rooftopId);

    /* ---- who */
    let visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? '';
    if (!/^[0-9a-f-]{36}$/.test(visitorId)) visitorId = crypto.randomUUID();

    /* ---- where from */
    const c = classifySource({
      referrer: typeof body.r === 'string' ? body.r : null,
      search: typeof body.q === 'string' ? body.q.slice(0, 1000) : null,
      ownHost: req.headers.get('host'),
    });
    const remembered = req.cookies.get(SOURCE_COOKIE)?.value;
    const source = c.source === 'internal' ? (isSource(remembered) ? remembered : 'direct') : c.source;

    const secure = req.nextUrl.protocol === 'https:';
    done.cookies.set(VISITOR_COOKIE, visitorId, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: YEAR });
    // The visit's source, for the pages after the first and for the lead form.
    // 30 minutes from the last page, the usual length of a visit.
    done.cookies.set(SOURCE_COOKIE, source, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 30 * 60 });

    /* ---- which car, if any */
    const segs = path.split('/').filter(Boolean);
    let vehicle: { id: string; timezone: string } | undefined;
    if (segs.length === 1 && !RESERVED.has(segs[0]!)) {
      vehicle = (
        await db
          .select({ id: t.vehicles.id, timezone: t.rooftops.timezone })
          .from(t.vehicles)
          .innerJoin(t.rooftops, eq(t.rooftops.id, t.vehicles.rooftopId))
          .where(
            and(
              inArray(t.vehicles.rooftopId, rooftopIds),
              sql`lower(${t.vehicles.stockNumber}) = ${segs[0]!.toLowerCase()}`,
            ),
          )
          .limit(1)
      )[0];
    }

    /* ---- once per visitor per page per half hour */
    const recent = await db
      .select({ id: t.pageViews.id })
      .from(t.pageViews)
      .where(
        and(
          eq(t.pageViews.visitorId, visitorId),
          eq(t.pageViews.storefrontId, storefrontId),
          eq(t.pageViews.path, path),
          gte(t.pageViews.createdAt, new Date(Date.now() - DEDUPE_MS)),
        ),
      )
      .limit(1);
    if (recent.length) return done;

    await db.insert(t.pageViews).values({
      storefrontId,
      vehicleId: vehicle?.id ?? null,
      visitorId,
      path,
      source,
      referrerHost: c.source === 'internal' ? null : c.referrerHost,
      utmSource: c.utmSource,
      utmMedium: c.utmMedium,
      utmCampaign: c.utmCampaign,
    });

    if (vehicle) await bumpSiteStat(vehicle.id, vehicle.timezone, 'vdpViews');
  } catch (err) {
    console.error('[analytics] beacon failed', err);
  }

  return done;
}
