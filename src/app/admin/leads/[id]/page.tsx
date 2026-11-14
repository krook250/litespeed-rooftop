/**
 * One lead: who they are, what they asked about, and the texts with them.
 * The same thread opens in the chat bubble; see `src/lib/messaging/chat.ts`.
 * Every rule about who may be texted lives in `src/lib/messaging/lead-texts.ts`.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui';
import { requireSection } from '@/lib/auth-guard';
import { markRead, threadView } from '@/lib/messaging/chat';
import { LeadThread } from '@/components/leads/lead-thread';

export const dynamic = 'force-dynamic';

function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `tel:+1${digits}` : `tel:${digits}`;
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireSection('leads');
  const v = await threadView(me.groupId, id);
  if (!v) notFound();
  await markRead(me.groupId, id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/admin/leads" className="text-xs text-ink-500 hover:underline">
        ← Leads
      </Link>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900">{v.name}</h1>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {v.phone ? (
          <a href={telHref(v.phone)} className="font-semibold text-emerald-700 hover:underline">
            {v.phone}
          </a>
        ) : null}
        <a href={`mailto:${v.email}`} className="text-emerald-700 hover:underline">
          {v.email}
        </a>
      </div>
      <p className="mb-5 mt-1 text-sm text-ink-500">
        {v.vehicle ? `${v.vehicle} · stock #${v.stockNumber} · ` : ''}
        {new Date(v.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>

      <Card>
        <LeadThread
          leadId={v.leadId}
          formMessage={v.formMessage}
          formAt={v.createdAt}
          messages={v.messages}
          blocked={v.blocked}
          firstNote={v.firstNote}
        />
      </Card>
    </div>
  );
}
