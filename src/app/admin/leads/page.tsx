/**
 * Leads — every shopper who filled out the form on a listing.
 *
 * The email to the lot is still how a lead gets delivered; this is where it can
 * be found again. Deliberately a list and not a CRM: no status, no assignment,
 * no pipeline. Dealers work leads from their phone and their inbox, and a status
 * column nobody updates is worse than none — it says "new" about a shopper who
 * bought last Tuesday.
 *
 * "New" means arrived since this person last opened this screen on this device.
 * See `MarkLeadsSeen`.
 */

import { cookies } from 'next/headers';
import { Card, EmptyState, cn } from '@/components/ui';
import { getLeads, getRooftops } from '@/lib/queries';
import { requireSection } from '@/lib/auth-guard';
import { dealerSiteBase } from '@/lib/storefront-url';
import { PUBLIC_STATUSES } from '@/lib/domains/units';
import { LEADS_SEEN_COOKIE } from '@/lib/leads-seen';
import { MarkLeadsSeen } from '@/components/leads-seen';
import { DeleteLeadButton } from '@/components/delete-lead-button';
import { SaveButton } from '@/components/submit-button';
import { saveLeadDelivery } from '@/lib/lead-actions';

export const dynamic = 'force-dynamic';

function ago(d: Date, now: number): string {
  const m = Math.max(0, Math.round((now - d.getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** +13605550142 -> (360) 555-0142, for showing back a stored cell. */
function prettyCell(e164: string | null): string {
  const d = (e164 ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
}

function DeliveryInput({
  label,
  name,
  defaultValue,
  type,
  placeholder,
  readOnly,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type: 'email' | 'tel';
  placeholder: string;
  readOnly: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        readOnly={readOnly}
        maxLength={200}
        className="w-full rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm read-only:bg-ink-50 read-only:text-ink-600"
      />
    </label>
  );
}

function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `tel:+1${digits}` : `tel:${digits}`;
}

export default async function LeadsPage() {
  const me = await requireSection('leads');
  const canEditDelivery = me.role === 'OWNER' || me.role === 'SALES_MANAGER';

  const [leads, rooftops, jar] = await Promise.all([getLeads(), getRooftops(), cookies()]);

  const seenRaw = jar.get(LEADS_SEEN_COOKIE)?.value;
  const seenAt = seenRaw ? Date.parse(decodeURIComponent(seenRaw)) : NaN;
  // First visit ever: nothing is "new". Bolding a year of history is noise.
  const isNew = (d: Date) => !Number.isNaN(seenAt) && d.getTime() > seenAt;

  const bases = new Map<string, string>();
  await Promise.all(
    [...new Set(leads.map((l) => l.rooftopId))].map(async (id) => {
      try {
        bases.set(id, await dealerSiteBase(id));
      } catch {
        /* no link is fine; the lead still shows */
      }
    }),
  );

  const multiLot = rooftops.length > 1;
  const now = Date.now();
  const newCount = leads.filter((l) => isNew(l.createdAt)).length;
  const emails = rooftops.map((r) => r.email).filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <MarkLeadsSeen />
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Leads</h1>
      <p className="mb-5 mt-1 text-sm text-ink-500">
        Shoppers who filled out the form on one of your listings.
        {leads.length ? ` ${leads.length} total` : ''}
        {newCount ? ` · ${newCount} new since you last looked` : ''}
      </p>

      {/* Where leads go. Above the list because "am I getting these?" is the
          first question anyone asks on this screen. Owner and sales manager
          can change it; everyone else sees it, so nobody has to ask. */}
      <Card className="mb-5">
        <div className="px-5 pt-4">
          <h2 className="text-sm font-semibold text-ink-900">Where new leads are sent</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Every lead goes to each address and cell below the moment it comes in. Cells only
            &mdash; a text to a landline never arrives.
          </p>
        </div>
        {rooftops.map((lot) => (
          <form key={lot.id} action={saveLeadDelivery} className="border-b border-ink-100 px-5 py-4 last:border-b-0">
            <input type="hidden" name="rooftopId" value={lot.id} />
            {multiLot ? <div className="mb-2 text-sm font-medium text-ink-800">{lot.name}</div> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <DeliveryInput label="Email" name="email" type="email" defaultValue={lot.email} placeholder="you@yourlot.com" readOnly={!canEditDelivery} />
              <DeliveryInput label="Second email (optional)" name="leadEmail2" type="email" defaultValue={lot.leadEmail2 ?? ''} placeholder="sales@yourlot.com" readOnly={!canEditDelivery} />
              <DeliveryInput label="Text to (cell)" name="leadAlertPhone" type="tel" defaultValue={prettyCell(lot.leadAlertPhone)} placeholder="(360) 555-0142" readOnly={!canEditDelivery} />
              <DeliveryInput label="Second cell (optional)" name="leadAlertPhone2" type="tel" defaultValue={prettyCell(lot.leadAlertPhone2)} placeholder="(360) 555-0199" readOnly={!canEditDelivery} />
            </div>
            {canEditDelivery ? (
              <div className="mt-3 flex justify-end">
                <SaveButton size="sm">Save</SaveButton>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-500">Only the owner or a sales manager can change these.</p>
            )}
          </form>
        ))}
      </Card>

      <Card>
        {leads.length === 0 ? (
          <EmptyState
            title="No leads yet"
            body={`When a shopper fills out the form on a listing, they show up here${
              emails.length ? ` and in your email (${emails.join(', ')})` : ''
            }.`}
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {leads.map((l) => {
              const fresh = isNew(l.createdAt);
              const title = l.vehicleId
                ? `${l.year} ${l.make} ${l.model}${l.trim ? ` ${l.trim}` : ''}`
                : null;
              const listed =
                l.vehicleStatus &&
                (PUBLIC_STATUSES as readonly string[]).includes(l.vehicleStatus);
              const base = bases.get(l.rooftopId);
              const url = listed && base && l.stockNumber ? `${base}/${l.stockNumber.toLowerCase()}` : null;

              return (
                <li key={l.id} className={cn('px-5 py-4', fresh && 'bg-emerald-50/50')}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="flex items-baseline gap-2">
                      {fresh ? (
                        <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full bg-emerald-600" aria-label="New" />
                      ) : null}
                      <span className={cn('text-[15px] text-ink-900', fresh ? 'font-bold' : 'font-semibold')}>
                        {l.name}
                      </span>
                    </div>
                    <span className="flex items-baseline gap-3">
                      <span
                        className="text-xs text-ink-500"
                        title={l.createdAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                      >
                        {ago(l.createdAt, now)}
                      </span>
                      <DeleteLeadButton leadId={l.id} />
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {l.phone ? (
                      <a href={telHref(l.phone)} className="font-semibold text-emerald-700 hover:underline">
                        {l.phone}
                      </a>
                    ) : (
                      <span className="text-ink-400">No phone</span>
                    )}
                    <a href={`mailto:${l.email}`} className="text-emerald-700 hover:underline">
                      {l.email}
                    </a>
                  </div>

                  <div className="mt-1.5 text-sm text-ink-700">
                    {title ? (
                      <>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="hover:underline">
                            {title}
                          </a>
                        ) : (
                          <span>{title}</span>
                        )}{' '}
                        <span className="text-ink-500">· stock #{l.stockNumber}</span>
                        {!listed ? <span className="text-ink-400"> (no longer listed)</span> : null}
                      </>
                    ) : (
                      <span className="text-ink-400">Vehicle no longer in inventory</span>
                    )}
                    {multiLot ? <span className="text-ink-500"> · {l.rooftopName}</span> : null}
                  </div>

                  {l.message ? (
                    <p className="mt-2 whitespace-pre-line border-l-2 border-ink-200 pl-3 text-sm text-ink-600">
                      {l.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
