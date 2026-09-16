'use client';

/**
 * The one button on the texting screen, and the form it opens.
 *
 * The dealer sees: a button, then a form, then a sentence telling them to go
 * away and get on with their day. They never learn that three separate
 * registrations are involved, because knowing would not help them — the server
 * decides which inquiry is next and this component renders whatever it is sent.
 *
 * The embed is loaded lazily. It drags in Persona's SDK, which is a lot of
 * JavaScript to hand every owner who opened Settings to change someone's role.
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui';

const TwilioComplianceEmbed = dynamic(
  () => import('@twilio/twilio-compliance-embed').then((m) => m.TwilioComplianceEmbed),
  { ssr: false, loading: () => <p className="p-5 text-sm text-ink-500">Loading the form…</p> },
);

type Inquiry = { inquiryId: string; inquirySessionToken: string };

export function TextingSetup({ canStart }: { canStart: boolean }) {
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/messaging/setup', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not start setup.');
        return;
      }
      if (body.kind === 'INQUIRY') {
        setInquiry({ inquiryId: body.inquiryId, inquirySessionToken: body.inquirySessionToken });
      } else {
        // Already submitted or already live. The page below says which.
        window.location.reload();
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitted() {
    // Fire and forget would lose the status on a flaky connection, and the
    // dealer would be told to wait for something we never recorded.
    await fetch('/api/messaging/submitted', { method: 'POST' });
    setDone(true);
  }

  if (done) {
    return (
      <div className="px-5 py-6">
        <p className="text-sm font-semibold text-ink-900">Sent to the carriers.</p>
        <p className="mt-1 text-sm text-ink-600">
          Nothing more for you to do. Approval usually takes a few days — the phone carriers
          review every business by hand and it cannot be rushed. We&apos;ll email you when
          texting is switched on.
        </p>
      </div>
    );
  }

  if (inquiry) {
    return (
      <div className="min-h-[32rem]">
        <TwilioComplianceEmbed
          inquiryId={inquiry.inquiryId}
          inquirySessionToken={inquiry.inquirySessionToken}
          onInquirySubmitted={submitted}
          onCancel={() => setInquiry(null)}
          onError={() =>
            setError('The form stopped responding. Nothing was lost — start again and it will pick up where you left off.')
          }
        />
      </div>
    );
  }

  return (
    <div className="px-5 py-5">
      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      <Button onClick={start} disabled={busy || !canStart}>
        {busy ? 'Starting…' : 'Set up texting'}
      </Button>
    </div>
  );
}
