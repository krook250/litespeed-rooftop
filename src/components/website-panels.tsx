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
import type { QuoteResult } from '@/lib/domains/vercel';
import type { DomainStatus, StorefrontLayout } from '@/db/schema';
import { cn, Button } from '@/components/ui';
import {
  attachDomain,
  detachDomain,
  previewDomain,
  purchaseDomain,
  refreshDomainStatus,
  saveStorefrontDesign,
  searchDomain,
} from '@/lib/domains/actions';

/* --------------------------------------------------------------- status */

const STATUS_COPY: Record<DomainStatus, { label: string; tone: string; help: string }> = {
  NONE:        { label: 'Not connected', tone: 'bg-ink-100 text-ink-700',            help: 'Your storefront is live on its Rooftop address.' },
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

export function BringYourOwnPanel({
  storefrontId,
  initialDomain = '',
}: { storefrontId: string; initialDomain?: string }) {
  const [preview, previewAction, previewing] = useActionState(previewDomain, null);
  const [attach, attachAction, attaching] = useActionState(attachDomain, null);
  const [domain, setDomain] = useState(initialDomain);

  const ready = preview?.ok && preview.data?.ok && preview.data.state !== 'blocked' && preview.data.state !== 'not-registered';

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
            placeholder="cascademotorswa.com"
            className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" disabled={previewing}>{previewing ? 'Looking…' : 'Look it up'}</Button>
      </form>

      <p className="text-xs text-ink-500">
        We check who runs your DNS, whether you have email on this domain, and whether anything would
        block the certificate — before you change a thing.
      </p>

      {preview && !preview.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{preview.error}</p>
      ) : null}

      {preview?.ok && preview.data ? (
        <>
          <InstructionsView result={preview.data} />
          {ready ? (
            <form action={attachAction}>
              <input type="hidden" name="storefrontId" value={storefrontId} />
              <input type="hidden" name="domain" value={domain} />
              <Button type="submit" disabled={attaching}>
                {attaching ? 'Connecting…' : "I've added the records — connect it"}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}

      {attach && !attach.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{attach.error}</p>
      ) : null}
      {attach?.ok ? <p className="text-sm text-emerald-700">{attach.message}</p> : null}
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
          <input name="term" placeholder="cascademotors"
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

/* ------------------------------------------------------------- design */

export function DesignPanel({
  storefrontId, layout, brandColor, accentColor, logoUrl, layouts,
}: {
  storefrontId: string;
  layout: StorefrontLayout;
  brandColor: string;
  accentColor: string;
  logoUrl: string | null;
  layouts: { id: string; name: string; blurb: string; bestFor: string }[];
}) {
  const [state, action, saving] = useActionState(saveStorefrontDesign, null);
  const [picked, setPicked] = useState<string>(layout);
  const [brand, setBrand] = useState(brandColor);
  const [accent, setAccent] = useState(accentColor);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="storefrontId" value={storefrontId} />

      <div>
        <p className="text-sm font-semibold text-ink-900">Layout</p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {layouts.map((l) => (
            <label
              key={l.id}
              className={cn(
                'cursor-pointer rounded-xl border-2 p-3 transition',
                picked === l.id ? 'border-[var(--pick)] bg-ink-50' : 'border-ink-200 hover:border-ink-300',
              )}
              style={{ ['--pick' as string]: brand }}
            >
              <input
                type="radio" name="layout" value={l.id} className="sr-only"
                checked={picked === l.id} onChange={() => setPicked(l.id)}
              />
              <LayoutThumb id={l.id} brand={brand} accent={accent} />
              <p className="mt-2 text-sm font-semibold text-ink-900">{l.name}</p>
              <p className="mt-0.5 text-xs text-ink-600">{l.blurb}</p>
              <p className="mt-1 text-[11px] italic text-ink-500">{l.bestFor}</p>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-sm font-medium text-ink-800">Brand colour</span>
          <div className="flex items-center gap-2">
            <input type="color" value={brand} onChange={(e) => setBrand(e.target.value)}
                   className="h-9 w-12 cursor-pointer rounded border border-ink-300" />
            <input name="brandColor" value={brand} onChange={(e) => setBrand(e.target.value)}
                   className="w-32 rounded-md border border-ink-300 px-2 py-1.5 font-mono text-sm" />
          </div>
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium text-ink-800">Accent colour</span>
          <div className="flex items-center gap-2">
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)}
                   className="h-9 w-12 cursor-pointer rounded border border-ink-300" />
            <input name="accentColor" value={accent} onChange={(e) => setAccent(e.target.value)}
                   className="w-32 rounded-md border border-ink-300 px-2 py-1.5 font-mono text-sm" />
          </div>
        </label>
      </div>

      <div>
        <p className="text-sm font-medium text-ink-800">Logo</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt="Current logo" className="h-10 w-auto max-w-[160px] object-contain" />
          ) : (
            <span className="text-sm text-ink-500">None yet — we show your initials instead.</span>
          )}
          <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="text-sm" />
          {logoUrl ? (
            <label className="flex items-center gap-1.5 text-sm text-ink-600">
              <input type="checkbox" name="removeLogo" /> Remove
            </label>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-ink-500">
          PNG, JPEG or WebP, under 512KB. A transparent PNG looks best. We can&apos;t accept SVG — an SVG
          can carry scripts, and it would be running on your own website.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save design'}</Button>
        {state?.ok ? <span className="text-sm text-emerald-700">{state.message}</span> : null}
        {state && !state.ok ? <span className="text-sm text-red-700">{state.error}</span> : null}
      </div>
    </form>
  );
}

/** A tiny wireframe so the dealer sees the shape, not just the name. */
function LayoutThumb({ id, brand, accent }: { id: string; brand: string; accent: string }) {
  return (
    <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-ink-200 bg-white p-1.5">
      <div className="mb-1 h-1.5 w-full rounded-sm" style={{ background: brand }} />
      {id === 'CLASSIC' ? (
        <div className="flex h-[calc(100%-10px)] gap-1">
          <div className="w-1/4 rounded-sm bg-ink-100" />
          <div className="grid flex-1 grid-cols-3 grid-rows-2 gap-1">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="rounded-sm bg-ink-200" />)}
          </div>
        </div>
      ) : id === 'SHOWCASE' ? (
        <div className="flex h-[calc(100%-10px)] flex-col gap-1">
          <div className="h-1/2 rounded-sm" style={{ background: accent, opacity: 0.35 }} />
          <div className="grid flex-1 grid-cols-2 gap-1">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="rounded-sm bg-ink-200" />)}
          </div>
        </div>
      ) : (
        <div className="flex h-[calc(100%-10px)] flex-col gap-1">
          <div className="h-2 rounded-sm" style={{ background: brand, opacity: 0.5 }} />
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-2 rounded-sm bg-ink-200" />)}
        </div>
      )}
    </div>
  );
}
