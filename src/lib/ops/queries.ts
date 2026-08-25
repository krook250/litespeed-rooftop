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
