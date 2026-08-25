import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireStaff } from './guard';

/**
 * Cross-tenant reads for the operator surface.
 *
 * EVERY EXPORTED FUNCTION IN THIS FILE CALLS `requireStaff()` FIRST. That is the
 * rule the module exists to make checkable: these queries take no `Scope` and
 * filter by no `rooftopId`, so the staff check is the only thing standing between
 * a caller and every dealer's data. Keeping them together means an audit reads
 * one file rather than grepping for unscoped selects.
 *
 * If you need a new cross-tenant read, add it here. Do not widen `Scope`, and do
 * not put an unscoped select anywhere else.
 */

export type OpsConnection = Awaited<ReturnType<typeof opsConnections>>[number];

/**
 * Every rooftop, every channel, and which pairs already have a connection row.
 *
 * Signup provisions a dealer group, a rooftop and a storefront — and no channel
 * connections at all. Only `seed.ts` ever created those, so a real dealer who
 * signed up landed on an empty `/admin/syndication` with no way to ask for
 * anything. This is what the provisioning card on `/ops` reads.
 */
export async function opsRooftopChannels() {
  await requireStaff();

  const [rooftops, existing, channels] = await Promise.all([
    db
      .select({
        rooftopId: t.rooftops.id,
        rooftopName: t.rooftops.name,
        rooftopSlug: t.rooftops.slug,
        groupName: t.dealerGroups.name,
        addressLine1: t.rooftops.addressLine1,
        city: t.rooftops.city,
        state: t.rooftops.state,
        postalCode: t.rooftops.postalCode,
        phone: t.rooftops.phone,
        latitude: t.rooftops.latitude,
        longitude: t.rooftops.longitude,
      })
      .from(t.rooftops)
      .innerJoin(t.dealerGroups, eq(t.rooftops.groupId, t.dealerGroups.id))
      .orderBy(asc(t.dealerGroups.name), asc(t.rooftops.name)),
    db
      .select({ rooftopId: t.channelConnections.rooftopId, channelId: t.channelConnections.channelId })
      .from(t.channelConnections),
    db.select().from(t.channels).orderBy(asc(t.channels.sortOrder)),
  ]);

  const have = new Set(existing.map((e) => `${e.rooftopId}:${e.channelId}`));

  return rooftops.map((r) => ({
    ...r,
    missing: channels.filter((c) => !have.has(`${r.rooftopId}:${c.id}`)),
    /** What the feed builders need and signup does not collect. */
    incomplete: [
      !r.addressLine1 && 'street',
      !r.city && 'city',
      !r.state && 'state',
      !r.postalCode && 'ZIP',
      !r.phone && 'phone',
      r.latitude == null && 'latitude',
      r.longitude == null && 'longitude',
    ].filter(Boolean) as string[],
  }));
}

export async function opsConnections() {
  await requireStaff();

  return db
    .select({
      connectionId: t.channelConnections.id,
      status: t.channelConnections.status,
      providerDealerId: t.channelConnections.providerDealerId,
      leadEmail: t.channelConnections.leadEmail,
      internalNote: t.channelConnections.internalNote,
      requestedAt: t.channelConnections.requestedAt,
      dealerConfirmedAt: t.channelConnections.dealerConfirmedAt,
      submittedAt: t.channelConnections.submittedAt,
      liveAt: t.channelConnections.liveAt,
      errorMessage: t.channelConnections.errorMessage,
      channelKey: t.channels.key,
      channelName: t.channels.name,
      channelShortName: t.channels.shortName,
      rooftopId: t.rooftops.id,
      rooftopName: t.rooftops.name,
      rooftopSlug: t.rooftops.slug,
      groupName: t.dealerGroups.name,
    })
    .from(t.channelConnections)
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.rooftops, eq(t.channelConnections.rooftopId, t.rooftops.id))
    .innerJoin(t.dealerGroups, eq(t.rooftops.groupId, t.dealerGroups.id))
    .orderBy(asc(t.dealerGroups.name), asc(t.rooftops.name), asc(t.channels.sortOrder));
}
