'use client';

/**
 * Client panels for the Website screen.
 *
 * The whole screen is built around one idea: a dealer should never be told to
 * "check your DNS settings". Every instruction here names their actual host,
 * their actual record values, and what will break if they get it wrong.
 */

import { useActionState, useState, useTransition } from 'react';
import type { Instructions, Step, Message } from '@/lib/domains/instructions';
import type { Readiness } from '@/lib/domains/readiness';
import type { QuoteResult } from '@/lib/domains/vercel';
import type { DomainStatus, PriorDns } from '@/db/schema';
import { cn, Button } from '@/components/ui';
import {
  attachDomain,
  detachDomain,
  previewDomain,
  purchaseDomain,
  refreshDomainStatus,
  reserveDomain,
  searchDomain,
} from '@/lib/domains/actions';

/* --------------------------------------------------------------- status */

const STATUS_COPY: Record<DomainStatus, { label: string; tone: string; help: string }> = {
  NONE:        { label: 'Not connected', tone: 'bg-ink-100 text-ink-700',            help: 'Your storefront is live on its Rooftop address.' },
  RESERVED:    { label: 'Saved',         tone: 'bg-ink-100 text-ink-700',            help: 'We have your domain and we have not touched it. Your current website and email are exactly as they were.' },
  BLOCKED:     { label: 'Needs a fix',   tone: 'bg-red-50 text-red-700',             help: 'Something on the domain stops the certificate issuing. Details below.' },
  PENDING_DNS: { label: 'Waiting on DNS',tone: 'bg-amber-50 text-amber-800',         help: "We can't see the records yet. This is normal for up to 48 hours." },
  VERIFYING:   { label: 'Verifying',     tone: 'bg-amber-50 text-amber-800',         help: 'Records found. Confirming the domain is yours.' },
  SSL_ISSUING: { label: 'Issuing SSL',   tone: 'bg-blue-50 text-blue-700',           help: 'Almost there — the padlock is being set up. Usually a minute or two.' },
  LIVE:        { label: 'Live',          tone: 'bg-emerald-50 text-emerald-700',     help: 'Your website is serving on your own domain over HTTPS.' },
  ERROR:       { label: 'Error',         tone: 'bg-red-50 text-red-700',             help: 'Something went wrong. The message below is what we got back.' },
};

/** pending → verifying → SSL issuing → live, rendered as a real progress line. */
const STAGES: DomainStatus[] = ['PENDING_DNS', 'VERIFYING', 'SSL_ISSUING', 'LIVE'];

export function DomainStatusPanel({
  storefrontId, domain, status, error, checkedAt,
}: { storefrontId: string; domain: string; status: DomainStatus; error: string | null; checkedAt: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const copy = STATUS_COPY[status];
  const stageIndex = STAGES.indexOf(status);

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <a href={`https://${domain}`} target="_blank" rel="noreferrer"
               className="text-base font-semibold text-ink-900 hover:underline">
              {domain}
            </a>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider', copy.tone)}>
              {copy.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-600">{copy.help}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              const r = await refreshDomainStatus(storefrontId);
              setMsg(r.ok ? r.message ?? 'Checked.' : r.error);
            })}
          >
            {pending ? 'Checking…' : 'Check now'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => start(async () => { await detachDomain(storefrontId); })}
          >
            Disconnect
          </Button>
        </div>
      </div>

      {stageIndex >= 0 ? (
        <ol className="mt-4 grid grid-cols-4 gap-1">
          {STAGES.map((s, i) => (
            <li key={s} className="flex flex-col gap-1.5">
              <span className={cn('h-1.5 rounded-full', i <= stageIndex ? 'bg-emerald-500' : 'bg-ink-200')} />
              <span className={cn('text-[10px] font-medium uppercase tracking-wide',
                i <= stageIndex ? 'text-ink-700' : 'text-ink-400')}>
                {STATUS_COPY[s].label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {msg ? <p className="mt-3 text-sm text-ink-600">{msg}</p> : null}
      {checkedAt ? <p className="mt-2 text-xs text-ink-400">Last checked {checkedAt}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------- the interim address */

/**
 * The address the dealer can use today.
 *
 * This is the single most under-sold thing on the screen. Their website is
 * already live — real inventory, real filters, real lead forms — and a dealer who
 * has not got round to their DNS has been quietly assuming they have nothing.
 * Showing the URL, copyable, with the promise that it keeps working afterwards,
 * is what turns "I haven't set it up yet" into "I can text this to a customer
 * this afternoon".
 *
 * The promise is real and worth stating plainly: `getStorefrontByKey()` matches
 * `slug = key OR domain = key`, so after cutover both addresses resolve to the
 * same storefront. Nothing handed out in the meantime breaks.
 */
export function InterimAddress({ url, live }: { url: string; live: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-semibold text-blue-900">
        {live ? 'Your storefront also answers here' : 'Your website is already live at this address'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 break-all rounded-md border border-blue-200 bg-white px-3 py-2 font-mono text-[13px] text-blue-800 hover:underline"
        >
          {url}
        </a>
        <button
          type="button"
          className="rounded-md border border-blue-300 bg-white px-2.5 py-2 text-xs font-medium text-blue-800 hover:bg-blue-100"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-xs text-blue-900/80">
        {live
          ? 'Kept alive on purpose, so anything you shared before you switched over still works.'
          : 'Use it now — put it in a text, on a buyer’s guide, in a Facebook post. It keeps working after your own domain goes live, so nothing you share today stops working later.'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- readiness */

function ReadinessList({ readiness }: { readiness: Readiness }) {
  return (
    <ul className="space-y-2">
      {readiness.items.map((item) => (
        <li key={item.id} className="flex gap-2.5">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
              item.done ? 'bg-emerald-500' : item.gating ? 'bg-amber-500' : 'bg-ink-300',
            )}
          >
            {item.done ? '✓' : '!'}
          </span>
          <span className="min-w-0">
            <span className={cn('block text-sm font-medium', item.done ? 'text-ink-700' : 'text-ink-900')}>
              {item.label}
            </span>
            <span className="block text-xs text-ink-500">{item.help}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What their DNS looked like before we were involved.
 *
 * Two jobs, and the second one is the important one. It gives them the old A
 * record so a rollback is a value they can copy rather than a phone call, and it
 * shows their mail records sitting there untouched next to the records we are
 * asking them to change — which is the actual answer to the fear that this step
 * will take their email down.
 */
function PriorDnsBlock({ prior }: { prior: PriorDns }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        Your DNS before we touched anything
      </p>
      <p className="mt-1 text-xs text-ink-600">
        Snapshotted {new Date(prior.capturedAt).toLocaleDateString('en-US')}
        {prior.host ? ` at ${prior.host}` : ''}. Keep this — if you ever want to put things back, these
        are the values.
      </p>
      <dl className="mt-2 space-y-1 font-mono text-[12px]">
        {prior.a.length ? (
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-ink-500">A</dt>
            <dd className="min-w-0 break-all text-ink-800">{prior.a.join(', ')}</dd>
          </div>
        ) : null}
        {prior.aaaa.length ? (
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-ink-500">AAAA</dt>
            <dd className="min-w-0 break-all text-ink-800">{prior.aaaa.join(', ')}</dd>
          </div>
        ) : null}
        {prior.mx.length ? (
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-ink-500">MX</dt>
            <dd className="min-w-0 break-all text-emerald-700">{prior.mx.join(', ')} — unchanged</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------- cutover */

/**
 * The screen for a domain we hold but have not pointed.
 *
 * Everything irreversible lives behind the button at the bottom, and the button
 * is disabled until the storefront is worth arriving at. The override is
 * deliberate and deliberately quiet: a dealer who understands the trade should
 * not be trapped by our checklist, but they should have to mean it.
 */
export function CutoverPanel({
  storefrontId,
  domain,
  instructions,
  readiness,
  priorDns,
  daysSaved,
}: {
  storefrontId: string;
  domain: string;
  instructions: Instructions | null;
  readiness: Readiness;
  priorDns: PriorDns | null;
  daysSaved: number | null;
}) {
  const [attach, attachAction, attaching] = useActionState(attachDomain, null);
  const [pending, start] = useTransition();
  const [override, setOverride] = useState(false);
  const canGo = readiness.ready || override;

  return (
    <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-ink-900">{domain}</span>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink-700">
              Saved
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-600">
            We are holding this for you and we have not changed a thing. Your current website and your
            email are exactly as they were
            {daysSaved !== null && daysSaved > 0 ? `, and have been for ${daysSaved} days` : ''}.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => start(async () => { await detachDomain(storefrontId); })}
        >
          Forget it
        </Button>
      </div>

      <div className="rounded-lg border border-ink-200 p-4">
        <p className="mb-3 text-sm font-semibold text-ink-900">Before you switch over</p>
        <ReadinessList readiness={readiness} />
      </div>

      {priorDns ? <PriorDnsBlock prior={priorDns} /> : null}

      {instructions ? (
        <div className="rounded-lg border border-ink-200 p-4">
          <InstructionsView result={instructions} />
        </div>
      ) : null}

      {/*
        The TTL advice belongs here and nowhere else.
        Telling a dealer at signup to drop their TTL is useless for exactly the
        dealer this flow exists for — the slow one. It has to happen a day or two
        before the records actually change, which is now.
      */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-semibold text-amber-900">Do this a day before you switch</p>
        <p className="mt-1 text-sm text-ink-700">
          In your DNS settings, change the TTL on your existing records to <strong>300 seconds</strong>.
          It costs nothing and it is the difference between the switch taking five minutes and taking
          two days — during which some customers see the new site and some see the old one.
        </p>
      </div>

      <div className="border-t border-ink-200 pt-4">
        <form action={attachAction}>
          <input type="hidden" name="storefrontId" value={storefrontId} />
          <input type="hidden" name="domain" value={domain} />
          <Button type="submit" disabled={attaching || !canGo}>
            {attaching ? 'Switching over…' : `Point ${domain} at my storefront`}
          </Button>
        </form>

        {!readiness.ready ? (
          <p className="mt-2 text-xs text-ink-500">
            {override ? (
              <>
                Override on — you can switch over with the items above outstanding.{' '}
                <button type="button" className="underline" onClick={() => setOverride(false)}>
                  Put the check back
                </button>
              </>
            ) : (
              <>
                Finish the items above and this turns on.{' '}
                <button type="button" className="underline" onClick={() => setOverride(true)}>
                  Point it anyway
                </button>{' '}
                — it is your business, but your customers will see the site as it is right now.
              </>
            )}
          </p>
        ) : null}

        {attach && !attach.ok ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{attach.error}</p>
        ) : null}
        {attach?.ok ? <p className="mt-3 text-sm text-emerald-700">{attach.message}</p> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- instruction view */

function RecordRow({ type, name, value, ttl }: { type: string; name: string; value: string; ttl?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-[13px]">
      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">{type}</span>
      <span className="text-amber-700">{name}</span>
      <span className="min-w-0 flex-1 break-all text-emerald-700">{value}</span>
      {ttl ? <span className="text-[11px] text-ink-400">TTL {ttl}</span> : null}
      <button
        type="button"
        className="rounded border border-ink-300 bg-white px-1.5 py-0.5 text-[11px] font-sans font-medium text-ink-700 hover:bg-ink-50"
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function MessageBlock({ m }: { m: Message }) {
  const tone =
    m.severity === 'blocker' ? 'border-red-200 bg-red-50' :
    m.severity === 'warning' ? 'border-amber-200 bg-amber-50' :
    'border-ink-200 bg-ink-50';
  const title =
    m.severity === 'blocker' ? 'text-red-800' :
    m.severity === 'warning' ? 'text-amber-900' : 'text-ink-800';

  return (
    <div className={cn('rounded-lg border p-3', tone)}>
      <p className={cn('text-sm font-semibold', title)}>{m.title}</p>
      <p className="mt-1 text-sm text-ink-700">{m.body}</p>
      {m.fix ? <div className="mt-2"><RecordRow type={m.fix.type} name={m.fix.name} value={m.fix.value} /></div> : null}
      {m.evidence?.length ? (
        <p className="mt-2 font-mono text-[11px] text-ink-500">Found: {m.evidence.join('  ·  ')}</p>
      ) : null}
    </div>
  );
}

function StepBlock({ s }: { s: Step }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <p className="text-sm font-semibold text-ink-900">{s.order}. {s.label}</p>
      <div className="mt-2"><RecordRow type={s.type} name={s.name} value={s.value} ttl={s.ttl} /></div>
      <p className="mt-2 text-sm text-ink-600">{s.help}</p>
      {s.fallback ? (
        <p className="mt-1.5 text-xs text-ink-500">
          Fallback: <span className="font-mono">{s.fallback.type} {s.fallback.name} → {s.fallback.value}</span> — {s.fallback.note}
        </p>
      ) : null}
    </div>
  );
}

export function InstructionsView({ result }: { result: Instructions }) {
  if (!result.ok) return <p className="text-sm text-red-700">{result.error}</p>;
  if (result.state === 'not-registered') {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">{result.headline}</p>
        <p className="mt-1 text-sm text-ink-700">{result.body}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink-900">{result.headline}</p>
      {result.blockers.map((m) => <MessageBlock key={m.id} m={m} />)}
      {result.warnings.map((m) => <MessageBlock key={m.id} m={m} />)}
      {result.steps.length ? (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">DNS records to add</p>
          {result.steps.map((s) => <StepBlock key={`${s.type}-${s.name}`} s={s} />)}
        </div>
      ) : null}
      {result.notes.map((m) => <MessageBlock key={m.id} m={m} />)}
    </div>
  );
}

/* ------------------------------------------------------- bring your own */

/**
 * Look the domain up and **save** it. That is the whole job of this panel now.
 *
 * It used to end in "I've added the records — connect it", which asked a dealer
 * to change their live DNS on the first screen they ever saw, before their
 * storefront had a logo on it. Capture and cutover are now separate moments: this
 * takes the domain and changes nothing, and {@link CutoverPanel} does the part
 * that moves traffic, once there is something worth moving traffic to.
 */
export function BringYourOwnPanel({
  storefrontId,
  initialDomain = '',
}: { storefrontId: string; initialDomain?: string }) {
  const [preview, previewAction, previewing] = useActionState(previewDomain, null);
  const [reserve, reserveAction, reserving] = useActionState(reserveDomain, null);
  const [domain, setDomain] = useState(initialDomain);

  /*
   * `not-registered` is the one state we refuse to save — there is nothing to
   * hold. `blocked` is fine to save: a CAA record or a registrar hold is a real
   * problem, but it is a problem the dealer has weeks to fix, and refusing to
   * write the domain down until they do means they have to find this screen again
   * afterwards. The blocker still gates the cutover, which is where it matters.
   */
  const ready = preview?.ok && preview.data?.ok && preview.data.state !== 'not-registered';

  return (
    <div className="space-y-4">
      <form action={previewAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="storefrontId" value={storefrontId} />
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-sm font-medium text-ink-800">Your domain</span>
          <input
            name="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="yourdealership.com"
            className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" disabled={previewing}>{previewing ? 'Looking…' : 'Look it up'}</Button>
      </form>

      <p className="text-xs text-ink-500">
        We check who runs your DNS, whether you have email on this domain, and whether anything would
        block the certificate — before you change a thing. Looking it up changes nothing on your
        current website.
      </p>

      {preview && !preview.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{preview.error}</p>
      ) : null}

      {preview?.ok && preview.data ? (
        <>
          <InstructionsView result={preview.data} />
          {ready ? (
            <form action={reserveAction} className="rounded-lg border border-ink-200 bg-ink-50 p-3">
              <input type="hidden" name="storefrontId" value={storefrontId} />
              <input type="hidden" name="domain" value={domain} />
              <p className="mb-2 text-sm text-ink-700">
                Save it to your storefront now. <strong>Nothing moves</strong> — your website and your
                email stay exactly where they are. When your site is ready we&apos;ll show you the two
                records to change, and you can do it whenever suits you.
              </p>
              <Button type="submit" disabled={reserving}>
                {reserving ? 'Saving…' : `Save ${domain || 'this domain'} for later`}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}

      {reserve && !reserve.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{reserve.error}</p>
      ) : null}
      {reserve?.ok ? <p className="text-sm text-emerald-700">{reserve.message}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------ search and buy */

export function BuyDomainPanel({
  storefrontId, dealerDefaults,
}: { storefrontId: string; dealerDefaults: Partial<Record<string, string>> }) {
  const [search, searchAction, searching] = useActionState(searchDomain, null);
  const [buy, buyAction, buying] = useActionState(purchaseDomain, null);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form action={searchAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="storefrontId" value={storefrontId} />
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-sm font-medium text-ink-800">Find a domain</span>
          <input name="term" placeholder="yourdealership"
                 className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm" />
        </label>
        <Button type="submit" disabled={searching}>{searching ? 'Checking…' : 'Search'}</Button>
      </form>

      {search && !search.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{search.error}</p>
      ) : null}

      {search?.ok && search.data ? (
        <ul className="divide-y divide-ink-200 overflow-hidden rounded-lg border border-ink-200">
          {search.data.map((q, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-3 bg-white px-3 py-2.5">
              {q.ok ? (
                <>
                  <div>
                    <span className="font-mono text-sm font-semibold text-ink-900">{q.domain}</span>
                    <span className="tnum ml-2 text-sm text-ink-600">
                      ${q.priceUsd} first year · renews ${q.renewalPriceUsd}/yr
                    </span>
                  </div>
                  <Button type="button" onClick={() => setPicked(q.domain)}>
                    {picked === q.domain ? 'Selected' : 'Choose'}
                  </Button>
                </>
              ) : (
                <span className="text-sm text-ink-500">{q.message}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {picked ? (
        <form action={buyAction} className="rounded-xl border border-ink-200 bg-white p-4">
          <input type="hidden" name="storefrontId" value={storefrontId} />
          <input type="hidden" name="domain" value={picked} />
          <p className="text-sm font-semibold text-ink-900">Who owns {picked}?</p>
          <p className="mt-1 text-xs text-ink-500">
            ICANN requires a real contact on every domain, and this goes on the public record as the
            owner. These are <strong>your</strong> details, not ours — the domain is registered to you.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              ['firstName', 'First name'], ['lastName', 'Last name'],
              ['companyName', 'Dealership (optional)'], ['email', 'Email'],
              ['phone', 'Phone'], ['address1', 'Street address'],
              ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'], ['country', 'Country'],
            ] as const).map(([name, label]) => (
              <label key={name} className="block">
                <span className="mb-1 block text-xs font-medium text-ink-700">{label}</span>
                <input
                  name={name}
                  defaultValue={dealerDefaults[name] ?? (name === 'country' ? 'US' : '')}
                  className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
                />
              </label>
            ))}
          </div>

          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" name="autoRenew" defaultChecked className="mt-1" />
            <span className="text-sm text-ink-700">
              Renew this domain automatically each year.
              <span className="block text-xs text-ink-500">
                If you turn this off and forget, the domain lapses and your website goes down with it.
              </span>
            </span>
          </label>

          <div className="mt-4">
            <Button type="submit" disabled={buying}>
              {buying ? 'Registering…' : `Register ${picked}`}
            </Button>
          </div>

          {buy && !buy.ok ? (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{buy.error}</p>
          ) : null}
          {buy?.ok ? <p className="mt-3 text-sm text-emerald-700">{buy.message}</p> : null}
        </form>
      ) : null}
    </div>
  );
}

/*
 * The Design panel moved to `src/components/website/design-card.tsx`.
 *
 * It stopped being a panel: logo, colors and layout are now a sequence with a
 * logo importer and a live preview behind them, which is more code than the rest
 * of this file put together and shares nothing with the domain work. What is left
 * here is the domain screen, which is what this file was always about.
 */
