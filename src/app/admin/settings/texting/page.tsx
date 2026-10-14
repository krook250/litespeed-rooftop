import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSection } from '@/lib/auth-guard';
import { getGroup } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui';
import { NumberPicker, RegistrationForm, RingsEditor, type RegistrationDefaults } from '@/components/settings/texting';
import { numberState } from '@/lib/messaging/numbers';
import { BUSINESS_TYPES, POSITIONS, advanceIfStale, getRegistration } from '@/lib/messaging/registration';
import { REGISTRATION_READY, TWILIO_READY, prettyNumber } from '@/lib/messaging/twilio';
import { canonicalUrl } from '@/lib/store/seo';

export const dynamic = 'force-dynamic';

/**
 * Texting & calls. Top to bottom: the number (calls work the day it's bought),
 * then what's open and what isn't, then the carrier sign-up that opens texting.
 *
 * Owner only: this buys a number and files the dealership's EIN with the
 * carriers. Ported from just.diy's Settings card, Oct 2026.
 */

const longDate = (d: Date | null) =>
  d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '';

function Row({ label, on, note }: { label: string; on: boolean; note: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
      <span className={on ? 'text-ink-900' : 'text-ink-500'}>
        <span aria-hidden="true" className={`mr-2 inline-block w-4 text-center ${on ? 'text-emerald-600' : 'text-ink-300'}`}>
          {on ? '✓' : '○'}
        </span>
        {label}
      </span>
      <span className={`text-xs ${on ? 'font-medium text-emerald-700' : 'text-ink-500'}`}>{note}</span>
    </li>
  );
}

export default async function TextingPage() {
  const me = await requireSection('settings');
  await advanceIfStale(me.groupId);

  const [group, num, reg, lot, sf] = await Promise.all([
    getGroup(),
    numberState(me.groupId),
    getRegistration(me.groupId),
    db.query.rooftops.findFirst({ where: eq(t.rooftops.groupId, me.groupId), orderBy: asc(t.rooftops.createdAt) }),
    db.query.storefronts.findFirst({ where: eq(t.storefronts.groupId, me.groupId) }),
  ]);

  const sent = !!reg?.step;
  const status = sent ? reg!.status : 'NOT_STARTED';
  const ready = status === 'READY';
  const defaultRings = prettyNumber(lot?.leadAlertPhone) || prettyNumber(me.cell) || '';
  const [first = '', ...rest] = (me.name ?? '').trim().split(/\s+/);

  const d: RegistrationDefaults = {
    legalName: reg?.legalName ?? '',
    businessType: reg?.businessType ?? '',
    ein: reg?.ein ?? '',
    street: reg?.street ?? lot?.addressLine1 ?? '',
    city: reg?.city ?? lot?.city ?? '',
    state: reg?.state ?? lot?.state ?? '',
    zip: reg?.zip ?? lot?.postalCode ?? '',
    website: reg?.website ?? (sf ? canonicalUrl(sf, 'app.rooftopauto.com', '') : ''),
    contactFirst: reg?.contactFirst ?? first,
    contactLast: reg?.contactLast ?? rest.join(' '),
    contactTitle: reg?.contactTitle ?? 'Owner',
    contactPosition: reg?.contactPosition ?? 'CEO',
    contactEmail: reg?.contactEmail ?? me.email,
    contactPhone: prettyNumber(reg?.contactPhone) || prettyNumber(me.cell) || '',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <Link href="/admin/settings" className="text-xs font-medium text-ink-500 hover:text-ink-800">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900">Texting &amp; calls</h1>
        <p className="mt-0.5 text-sm text-ink-600">{group.name}: a local number buyers can call, and text once the carriers approve you.</p>
      </header>

      {!TWILIO_READY ? (
        <Card>
          <p className="px-5 py-5 text-sm text-ink-500">Phone numbers aren&rsquo;t configured on this deployment.</p>
        </Card>
      ) : !num ? (
        /* 1. No number yet */
        <Card>
          <CardHeader
            title="Get a local number"
            subtitle="Calls to it ring your phone today. Texting opens once the phone carriers approve you, usually a few days."
          />
          <NumberPicker area={(lot?.phone ?? '').replace(/\D/g, '').replace(/^1/, '').slice(0, 3)} rings={defaultRings} />
        </Card>
      ) : (
        <Card>
          <div className="mx-5 mt-5 rounded-lg bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-800">
              <span aria-hidden="true">● </span>
              <span className="tnum">{num.number}</span> is live
            </p>
            <p className="mt-1 text-sm text-emerald-900">
              Calls to it ring <span className="tnum">{num.rings}</span> now. <RingsEditor rings={num.rings} />
            </p>
          </div>

          <ul className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
            <Row label="Calls to your number" on note="On" />
            <Row
              label="Carrier approval for texting"
              on={ready}
              note={ready ? 'Approved' : status === 'SUBMITTED' ? 'Waiting on carriers' : status === 'ACTION_NEEDED' ? 'Needs a fix' : 'Not sent'}
            />
            <Row label="Buyer texts passed to your phone" on={ready} note={ready ? 'On' : 'Not open yet'} />
          </ul>

          {ready ? null : (
            <div className="border-t border-ink-200">
              <div className="px-5 pt-5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Texting your leads</h2>
                {status === 'SUBMITTED' ? (
                  <p className="mt-2 pb-5 text-sm text-ink-700">
                    Sent {longDate(reg!.submittedAt)}. Waiting on the phone carriers, usually a few days. Nothing for you to do;
                    this page updates on its own.
                  </p>
                ) : status === 'ACTION_NEEDED' ? (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{reg!.actionNeeded}</p>
                ) : (
                  <p className="mt-2 text-sm text-ink-700">
                    To text leads, the phone carriers need to approve your business once. Everything below goes to them, and they
                    check it character for character against federal records.
                  </p>
                )}
              </div>
              {status === 'SUBMITTED' ? null : !REGISTRATION_READY ? (
                <p className="px-5 py-5 text-sm text-ink-500">Texting sign-up isn&rsquo;t configured on this deployment.</p>
              ) : (
                <RegistrationForm d={d} types={[...BUSINESS_TYPES]} positions={POSITIONS} again={status === 'ACTION_NEEDED'} />
              )}
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-ink-500">
        Rooftop only ever texts a buyer who ticked the box asking to be texted. That consent is what the carriers check, and it
        is what keeps your number working.
      </p>
    </div>
  );
}
