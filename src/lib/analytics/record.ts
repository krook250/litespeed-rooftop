import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { OWN_SITE_CHANNEL_KEY } from '@/lib/sync-states';

/**
 * Bumping `vehicle_daily_stats` for the dealer's own website.
 *
 * Until Oct 2026 nothing but the seed wrote this table, so every VDP-view figure
 * on Reporting, the scoreboard and Lot Walk was zero for a real dealer. The
 * beacon and the lead form now write the `dealer_site` channel's row; the
 * marketplaces stay zero until one of them gives us numbers.
 *
 * Never throws. A stats bump failing must not cost a shopper their lead or a
 * page view its row.
 */

let siteChannelId: string | null | undefined;

async function dealerSiteChannelId(): Promise<string | null> {
  if (siteChannelId !== undefined) return siteChannelId;
  const row = (
    await db.select({ id: t.channels.id }).from(t.channels).where(eq(t.channels.key, OWN_SITE_CHANNEL_KEY)).limit(1)
  )[0];
  siteChannelId = row?.id ?? null;
  return siteChannelId;
}

/** YYYY-MM-DD in the lot's own time zone — a 9pm view in Florida is still today. */
export function localDate(timeZone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export async function bumpSiteStat(
  vehicleId: string,
  timeZone: string,
  field: 'vdpViews' | 'leads',
): Promise<void> {
  try {
    const channelId = await dealerSiteChannelId();
    if (!channelId) return;
    const date = localDate(timeZone);
    const col = field === 'vdpViews' ? t.vehicleDailyStats.vdpViews : t.vehicleDailyStats.leads;
    await db
      .insert(t.vehicleDailyStats)
      .values({ vehicleId, channelId, date, [field]: 1 })
      .onConflictDoUpdate({
        target: [t.vehicleDailyStats.vehicleId, t.vehicleDailyStats.channelId, t.vehicleDailyStats.date],
        set: { [field]: sql`${col} + 1` },
      });
  } catch (err) {
    console.error(`[analytics] stat bump failed (${field})`, err);
  }
}
