import Link from 'next/link';
import { requireSection } from '@/lib/auth-guard';
import { getGroup } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui';
import { TextingSetup } from '@/components/settings/texting-setup';
import { getRegistration } from '@/lib/messaging/setup';
import { messagingConfigured } from '@/lib/messaging/twilio';

export const dynamic = 'force-dynamic';

/**
 * Texting — one status, one paragraph, one button.
 *
 * Underneath this screen a dealer is being registered with the mobile carriers
 * under their own EIN, in three sequential submissions, against a federal
 * anti-spam regime. None of that is on the page. A used-car dealer wants to
 * know whether they can text a buyer back, and the honest answers are "not
 * yet", "we're waiting on the phone companies", and "yes" — so those are the
 * only three things this says.
 *
 * Owner-only, like the rest of Settings, and for a sharper reason than usual:
 * this collects an EIN and legally binds the dealership to a carrier agreement.
 * That is not a thing a sales rep clicks through on a slow Tuesday.
 */

const COPY: Record<string, { line: string; body: string }> = {
  NOT_STARTED: {
    line: 'Not set up yet.',
    body: 'Before you start, have your EIN handy, and the business name and address exactly as they appear on your IRS letter. The carriers check them character for character against federal records, and a mismatch is the single most common reason a dealership gets rejected.',
  },
  COLLECTING: {
    line: 'Part-way through.',
    body: 'You started the form but did not finish it. Pick up where you left off — everything you already entered is still there.',
  },
  SUBMITTED: {
    line: 'Waiting on the phone carriers.',
    body: 'Your details are in. The carriers review every business by hand and it usually takes a few days; there is no way to speed it up and nothing further for you to do. We will email you the moment texting is live.',
  },
  ACTION_NEEDED: {
    line: 'Needs a correction.',
    body: 'The carriers sent it back. Reopen the form and the problem will be shown at the top of the page.',
  },
  READY: {
    line: 'Texting is on.',
    body: 'Your dealership can text buyers from the number below.',
  },
};

export default async function TextingPage() {
  const me = await requireSection('settings');
  const [group, reg] = await Promise.all([getGroup(), getRegistration(me.groupId)]);

  const status = reg?.status ?? 'NOT_STARTED';
  const copy = COPY[status] ?? COPY.NOT_STARTED;
  const configured = messagingConfigured();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <Link href="/admin/settings" className="text-xs font-medium text-ink-500 hover:text-ink-800">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900">Texting</h1>
        <p className="mt-0.5 text-sm text-ink-600">
          {group.name} — texting buyers from your own number.
        </p>
      </header>

      <Card>
        <CardHeader title={copy.line} />
        <div className="px-5 pt-4 text-sm text-ink-600">{copy.body}</div>

        {!configured ? (
          <p className="px-5 py-5 text-sm text-ink-500">
            Text messaging is not configured on this deployment.
          </p>
        ) : status === 'SUBMITTED' || status === 'READY' ? null : (
          <TextingSetup canStart />
        )}
      </Card>

      {/*
        Said plainly because it is the rule the whole product hangs off, and the
        first person to ask "can't we just text the ones who didn't tick it"
        should find the answer already written down.
      */}
      <p className="text-xs text-ink-500">
        Rooftop only ever texts a buyer who ticked the box asking to be texted. That consent is
        what the carriers are checking, and it is what keeps your number working.
      </p>
    </div>
  );
}
