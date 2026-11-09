/**
 * One lead: who they are, what they asked about, and the texts with them.
 * Opened from the Text button on Leads. See `src/lib/messaging/lead-texts.ts`
 * for every rule about who may be texted; this screen only reports them.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Card } from '@/components/ui';
import { requireSection } from '@/lib/auth-guard';
import { db } from '@/db';
import * as t from '@/db/schema';
import { blockedLine, canText, leadInGroup, threadFor } from '@/lib/messaging/lead-texts';
import { getRegistration, optInMessage, publicFace } from '@/lib/messaging/registration';
import { LeadThread } from '@/components/leads/lead-thread';

export const dynamic = 'force-dynamic';

function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `tel:+1${digits}` : `tel:${digits}`;
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireSection('leads');
  const row = await leadInGroup(me.groupId, id);
  if (!row) notFound();
  const { lead } = row;

  const [vehicle, messages, state, reg] = await Promise.all([
    lead.vehicleId ? db.query.vehicles.findFirst({ where: eq(t.vehicles.id, lead.vehicleId) }) : null,
    threadFor(lead.id),
    canText(me.groupId, lead),
    getRegistration(me.groupId),
  ]);
  const face = await publicFace(me.groupId, reg?.legalName ?? null);
  const sentBefore = messages.some((m) => m.direction === 'OUT' && !m.error);
  const title = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}` : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/admin/leads" className="text-xs text-ink-500 hover:underline">
        ← Leads
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900">{lead.name}</h1>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {lead.phone ? (
          <a href={telHref(lead.phone)} className="font-semibold text-emerald-700 hover:underline">
            {lead.phone}
          </a>
        ) : null}
        <a href={`mailto:${lead.email}`} className="text-emerald-700 hover:underline">
          {lead.email}
        </a>
      </div>
      <p className="mb-5 mt-1 text-sm text-ink-500">
        {title ? `${title} · stock #${vehicle!.stockNumber} · ` : ''}
        {lead.createdAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>

      <Card>
        <LeadThread
          leadId={lead.id}
          formMessage={lead.message}
          formAt={lead.createdAt.toISOString()}
          messages={messages.map((m) => ({
            id: m.id,
            out: m.direction === 'OUT',
            body: m.body,
            error: m.error,
            at: m.createdAt.toISOString(),
          }))}
          blocked={state.ok ? null : blockedLine(state.why)}
          firstNote={sentBefore ? null : optInMessage(face.name)}
        />
      </Card>
    </div>
  );
}
