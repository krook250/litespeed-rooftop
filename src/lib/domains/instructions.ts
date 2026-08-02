/**
 * Rooftop Auto — turn a domain lookup into what the dealer is actually told.
 *
 * The five failure modes from `claude/domains-and-syndication.md` Part 1 are
 * branches in this file rather than support tickets later:
 *
 *   1. Nameserver changes wipe MX and take a small business's email down.
 *      → never emitted as an instruction, and actively warned against whenever
 *        we can see the dealer has mail.
 *   2. A restrictive CAA silently blocks Let's Encrypt forever.
 *      → a BLOCKER, checked *before* we promise SSL, with the exact fix record.
 *   3. Apex ALIAS support varies by host.
 *      → the instruction differs, keyed off the identified DNS host.
 *   4. Propagation is 24–48h.
 *      → TTL advice, given *before* cutover where it still helps.
 *   5. TXT verification when the domain is claimed on another Vercel account.
 *      → its own branch, fed from Vercel's `verification[]`.
 *
 * Three more the real DNS data forced out, which the doc did not list:
 * a stale AAAA at the apex (IPv6 visitors keep hitting the old site), the
 * Cloudflare orange-cloud double-proxy, and a registrar hold that stops the
 * domain resolving no matter what records we add.
 *
 * Severity contract:
 *   blocker — will not work until fixed. Gates the "I've added the records" button.
 *   warning — will work, but something is at risk (their live site, their email).
 *   step    — a DNS record to add.
 *   note    — context, no action.
 *
 * Pure and synchronous: no I/O, no `server-only`. That is deliberate — it makes
 * the whole decision table unit-testable without a network.
 */

import { VERCEL_A_RECORD, VERCEL_CNAME_TARGET, type DomainLookup, type DomainLookupResult } from './lookup';
import type { DomainChallenge } from '@/db/schema';

export type DnsRecordSpec = {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  appliesTo?: string;
  note?: string;
};

export type Message = {
  id: string;
  severity: 'blocker' | 'warning' | 'note';
  title: string;
  body: string;
  fix?: DnsRecordSpec;
  evidence?: string[];
};

export type Step = {
  order: number;
  type: string;
  name: string;
  value: string;
  ttl: number;
  label: string;
  help: string;
  fallback?: DnsRecordSpec;
};

export type Instructions =
  | { ok: false; error: string }
  | {
      ok: true;
      domain: string;
      state: 'not-registered';
      headline: string;
      body: string;
      cta: { label: string; action: 'search-purchase' };
      blockers: Message[];
      warnings: Message[];
      steps: Step[];
      notes: Message[];
    }
  | {
      ok: true;
      domain: string;
      state: 'blocked' | 'ready' | 'records-in-place';
      host: string;
      panel: string;
      apexStrategy: 'alias' | 'a-record';
      headline: string;
      blockers: Message[];
      warnings: Message[];
      steps: Step[];
      notes: Message[];
    };

const CAA_FIX: DnsRecordSpec = { type: 'CAA', name: '@', value: '0 issue "letsencrypt.org"' };

/** Dealers know "Google Workspace". They do not know `aspmx.l.google.com`. */
const MAIL_PROVIDERS: { match: RegExp; name: string }[] = [
  { match: /(^|\.)google\.com$|googlemail|aspmx/i, name: 'Google Workspace' },
  { match: /outlook\.com$|protection\.outlook|mail\.protection/i, name: 'Microsoft 365' },
  { match: /zoho/i, name: 'Zoho Mail' },
  { match: /secureserver\.net$/i, name: 'GoDaddy email' },
  { match: /emailsrvr\.com$/i, name: 'Rackspace email' },
  { match: /messagingengine\.com$/i, name: 'Fastmail' },
  { match: /pphosted\.com$|proofpoint/i, name: 'Proofpoint' },
  { match: /mimecast/i, name: 'Mimecast' },
  { match: /bluehost\.com$|hostmonster/i, name: 'Bluehost email' },
  { match: /titan\.email$|hostinger/i, name: 'Titan email' },
];

function namedMailProvider(providers: string[]): string | null {
  for (const p of providers) {
    const hit = MAIL_PROVIDERS.find((m) => m.match.test(p));
    if (hit) return hit.name;
  }
  return null;
}

function panelPhrase(l: DomainLookup): string {
  if (l.dnsHost) return l.dnsHost.panel;
  if (l.registrar) return `your DNS settings at ${l.registrar}`;
  return "your DNS provider's control panel";
}

function hostLabel(l: DomainLookup): string {
  if (l.dnsHost) return l.dnsHost.name;
  if (l.nameservers.length) return l.nameservers[0]!.split('.').slice(-2).join('.');
  return 'your DNS provider';
}

/**
 * @param lookup result of `lookupDomain()`
 * @param challenges Vercel's `verification[]` from the domain-add call, when it
 *        wants a TXT record. Empty for the overwhelming majority of dealers.
 */
export function buildInstructions(
  lookup: DomainLookupResult,
  challenges: DomainChallenge[] = [],
): Instructions {
  if (!lookup.ok) return { ok: false, error: lookup.error };

  const l = lookup;
  const blockers: Message[] = [];
  const warnings: Message[] = [];
  const steps: Step[] = [];
  const notes: Message[] = [];

  const host = hostLabel(l);
  const panel = panelPhrase(l);
  const supportsAlias = l.dnsHost?.apexSupport === 'alias';

  /* 0 — does this domain exist at all? Hand straight off to the buy flow. */
  if (!l.registered) {
    return {
      ok: true,
      domain: l.domain,
      state: 'not-registered',
      headline: `${l.domain} isn't registered yet.`,
      body:
        `Nobody owns this domain. You can buy it through Rooftop and we'll point the DNS at your ` +
        `storefront automatically — no records to add by hand, and no waiting for it to propagate.`,
      cta: { label: `Check price for ${l.domain}`, action: 'search-purchase' },
      blockers: [], warnings: [], steps: [], notes: [],
    };
  }

  if (!l.nameservers.length && !l.apex.inUse) {
    blockers.push({
      id: 'no-dns',
      severity: 'blocker',
      title: 'This domain has no working DNS right now.',
      body:
        `${l.domain} is registered${l.registrar ? ` at ${l.registrar}` : ''}, but it isn't pointed at any ` +
        `nameservers, so there is nowhere for us to add records. That usually means it was registered ` +
        `very recently, or it's parked. Sort that out with your registrar and come back.`,
    });
  }

  /* 1 — registrar hold and expiry. No DNS record fixes either of these. */
  const badStatus = l.registrarStatuses.find((s) => /clienthold|serverhold|redemption|pendingdelete/i.test(s));
  if (badStatus) {
    blockers.push({
      id: 'registrar-hold',
      severity: 'blocker',
      title: 'This domain is on hold at the registrar.',
      body:
        `Your registrar has ${l.domain} in "${badStatus}" status, which stops it resolving anywhere no ` +
        `matter what records we add. This is almost always an unpaid renewal or an unverified contact ` +
        `email. Call ${l.registrar ?? 'your registrar'} and clear it first.`,
    });
  }

  if (l.expiresAt) {
    const days = Math.round((new Date(l.expiresAt).getTime() - Date.now()) / 86_400_000);
    if (days >= 0 && days <= 45) {
      warnings.push({
        id: 'expiring-soon',
        severity: 'warning',
        title: `This domain expires in ${days} day${days === 1 ? '' : 's'}.`,
        body:
          `${l.domain} is up for renewal on ` +
          `${new Date(l.expiresAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}. ` +
          `If it lapses your new site goes down with it. Renew it${l.registrar ? ` at ${l.registrar}` : ''} ` +
          `before you cut over.`,
      });
    }
  }

  /* 2 — CAA. Failure mode #2, checked before we promise SSL. */
  if (l.caa.blocksLetsEncrypt) {
    const issuerList = l.caa.issuers.length
      ? l.caa.issuers.map((i) => `"${i}"`).join(', ')
      : 'no certificate authority at all';
    blockers.push({
      id: 'caa-blocks-ssl',
      severity: 'blocker',
      title: 'A CAA record on your domain will block your SSL certificate.',
      body:
        `${l.caa.foundAt} has a CAA record that only allows ${issuerList} to issue certificates. ` +
        `Rooftop issues your certificate through Let's Encrypt, so with this record in place the request ` +
        `sits pending forever — no error, no timeout, just a padlock that never appears. Add the record ` +
        `below in ${panel}. You do not need to remove the existing CAA records: CAA is additive, and ` +
        `whoever set it up presumably still needs it.`,
      fix: { ...CAA_FIX, appliesTo: l.caa.foundAt ?? l.domain },
      evidence: l.caa.records
        .map((rec) => {
          const c = rec.critical ?? 0;
          if (rec.issue) return `${c} issue "${rec.issue}"`;
          if (rec.issuewild) return `${c} issuewild "${rec.issuewild}"`;
          if (rec.iodef) return `${c} iodef "${rec.iodef}"`;
          return null;
        })
        .filter((x): x is string => x !== null),
    });
  } else if (l.caa.status === 'permits-letsencrypt') {
    notes.push({
      id: 'caa-ok',
      severity: 'note',
      title: "CAA record checked — Let's Encrypt is allowed.",
      body:
        `${l.caa.foundAt} has a CAA record and it already permits Let's Encrypt, so your certificate ` +
        `will issue normally. Nothing to do.`,
    });
  }

  /* 3 — email safety. Failure mode #1, and the most expensive one to get wrong. */
  if (l.hasEmail) {
    const providers = [...new Set(l.mx.map((m) => m.exchange.split('.').slice(-2).join('.')))];
    const selfHosted = providers.every((p) => p === l.domain);
    const where = selfHosted ? 'your own mail server' : namedMailProvider(providers) ?? providers.join(', ');
    warnings.push({
      id: 'email-live',
      severity: 'warning',
      title: 'You have email on this domain. Do not change your nameservers.',
      body:
        `We can see mail records pointing at ${where}, so ${l.domain} is handling your email. Changing ` +
        `nameservers — which plenty of setup guides tell you to do — wipes those records and your email ` +
        `stops arriving, usually without anyone noticing for a day. Rooftop never needs that. The records ` +
        `below are all we need, and none of them touch your mail.`,
      evidence: l.mx.map((m) => `${m.priority} ${m.exchange}`),
    });
  } else {
    notes.push({
      id: 'no-email',
      severity: 'note',
      title: 'No email records found on this domain.',
      body:
        `Nothing to protect on the mail side. If you add business email later it won't conflict with ` +
        `anything we set up here.`,
    });
  }

  /* 4 — their site is live somewhere today. */
  if (l.apex.inUse && !l.apex.pointsAtVercel) {
    warnings.push({
      id: 'apex-live-elsewhere',
      severity: 'warning',
      title: `${l.domain} currently points at another website.`,
      body:
        `Right now ${l.domain} resolves to ${l.apex.a.join(', ')}${l.dnsHost ? ` and is managed at ${host}` : ''}. ` +
        `The moment you change the record below, visitors land on your Rooftop storefront instead of your ` +
        `current site. Nothing is deleted — your old site stays where it is — but make the switch on a ` +
        `quiet weekday rather than a Saturday morning.`,
    });
  }

  /* 5 — propagation. Failure mode #4, given while it can still help. */
  notes.push({
    id: 'ttl-advice',
    severity: 'note',
    title: 'Lower your TTL a day before you switch.',
    body:
      `DNS changes take 24–48 hours to reach everyone. You can shrink that to minutes: in ${panel}, set ` +
      `the TTL on your existing records to 300 seconds about a day before you make the change. Then when ` +
      `you swap them, the internet picks it up almost immediately. Put it back to 3600 once you're live.`,
  });

  /* 6 — the records. Failure mode #3: apex strategy depends on the host. */
  if (supportsAlias) {
    const flattening = l.dnsHost!.id === 'cloudflare' ? 'CNAME flattening' : 'ALIAS/ANAME records';
    steps.push({
      order: 1,
      type: 'ALIAS',
      name: '@',
      value: VERCEL_CNAME_TARGET,
      ttl: 300,
      label: `Point ${l.domain} at Rooftop`,
      help:
        `${host} supports ${flattening} at the root of your domain, which is the more resilient option — ` +
        `if our IP address ever changes, this record follows it automatically. Create it in ${panel}. ` +
        `If the record type is called ANAME or CNAME there, that's the same thing.`,
      fallback: {
        type: 'A',
        name: '@',
        value: VERCEL_A_RECORD,
        note: `If ${host} won't accept an ALIAS at the root, use this A record instead.`,
      },
    });

    if (l.dnsHost!.id === 'cloudflare') {
      warnings.push({
        id: 'cloudflare-proxy',
        severity: 'warning',
        title: 'Set the Cloudflare record to DNS only, not Proxied.',
        body:
          `In the Cloudflare dashboard the record defaults to Proxied (the orange cloud). Click it so it ` +
          `says DNS only (grey cloud). Left on Proxied your traffic runs through Cloudflare and then ` +
          `through our CDN, which double-caches your inventory pages and makes a price change take hours ` +
          `to show up. Your certificate works either way — this is about your prices being current.`,
      });
    }
  } else {
    steps.push({
      order: 1,
      type: 'A',
      name: '@',
      value: VERCEL_A_RECORD,
      ttl: 300,
      label: `Point ${l.domain} at Rooftop`,
      help:
        (l.dnsHost
          ? `${host} only supports a plain A record at the root of a domain, so that's what we use.`
          : `We couldn't identify who manages your DNS${l.nameservers.length ? ` (your nameservers are ${l.nameservers.slice(0, 2).join(', ')})` : ''}, ` +
            `so we're giving you the A record — it works everywhere.`) +
        ` Create it in ${panel}. The name field may be shown as "@", as blank, or as the domain itself ` +
        `depending on the screen — all three mean the same thing.` +
        (l.apex.a.length ? ` You'll be replacing the existing value, ${l.apex.a.join(', ')}.` : '') +
        (l.dnsHost
          ? ''
          : ` If your provider does offer an ALIAS or ANAME record at the root, that one is slightly ` +
            `better — point it at ${VERCEL_CNAME_TARGET} instead.`),
    });
  }

  steps.push({
    order: 2,
    type: 'CNAME',
    name: 'www',
    value: VERCEL_CNAME_TARGET,
    ttl: 300,
    label: `Point www.${l.domain} at Rooftop`,
    help:
      `This covers visitors who type "www" in front. We redirect www to ${l.domain} automatically, so you ` +
      `only ever have one address in Google rather than two competing with each other.` +
      (l.www.cname.length ? ` You'll be replacing the existing value, ${l.www.cname.join(', ')}.` : ''),
  });

  /* A stale AAAA is invisible until half your customers see the wrong site. */
  if (l.apex.aaaa.length) {
    warnings.push({
      id: 'stale-aaaa',
      severity: 'warning',
      title: 'Remove the IPv6 (AAAA) record at the root.',
      body:
        `${l.domain} has an AAAA record pointing at ${l.apex.aaaa.join(', ')}. Visitors on IPv6 ` +
        `connections keep hitting your old site even after the A record changes — so you'd see the new ` +
        `storefront and some of your customers wouldn't. Delete it in ${panel}.`,
    });
  }

  /* 7 — TXT verification. Failure mode #5. */
  const txtChallenges = challenges.filter((c) => c.type?.toUpperCase() === 'TXT');
  txtChallenges.forEach((c, i) => {
    steps.push({
      order: 3 + i,
      type: 'TXT',
      name: c.domain?.replace(`.${l.domain}`, '') || '_vercel',
      value: c.value,
      ttl: 300,
      label: 'Prove you own this domain',
      help:
        `This domain is already registered to another account on our hosting platform — usually because a ` +
        `previous web company set it up and never removed it. Adding this TXT record proves the domain is ` +
        `yours and releases it. It's one-time; you can delete the record once your site is live. ` +
        `Add it in ${panel}.`,
    });
  });
  if (txtChallenges.length) {
    notes.push({
      id: 'txt-why',
      severity: 'note',
      title: 'Why the extra record?',
      body:
        `Most dealers only need the two records above. The TXT record appears when someone else claimed ` +
        `this domain on our platform first, which is common if you've changed website providers before.`,
    });
  }

  const alreadyPointed = l.apex.pointsAtVercel && l.www.pointsAtVercel;
  const state = blockers.length ? 'blocked' : alreadyPointed ? 'records-in-place' : 'ready';

  return {
    ok: true,
    domain: l.domain,
    state,
    host,
    panel,
    apexStrategy: supportsAlias ? 'alias' : 'a-record',
    headline: blockers.length
      ? `A couple of minutes of setup before ${l.domain} can go live.`
      : alreadyPointed
        ? `${l.domain} is already pointed at us.`
        : `Here's exactly what to change at ${host}.`,
    blockers,
    warnings,
    steps: steps.sort((a, b) => a.order - b.order),
    notes,
  };
}

/** Flatten to plain text — used by the tests and by "email me these instructions". */
export function renderPlain(result: Instructions): string {
  if (!result.ok) return `Error: ${result.error}`;
  const L: string[] = [result.headline, ''];
  if (result.state === 'not-registered') return [result.headline, '', result.body].join('\n');

  for (const b of result.blockers) {
    L.push(`[MUST FIX] ${b.title}`, `  ${b.body}`);
    if (b.fix) L.push(`  -> Add: ${b.fix.type}  ${b.fix.name}  ${b.fix.value}`);
    if (b.evidence?.length) L.push(`  (found: ${b.evidence.join(' / ')})`);
    L.push('');
  }
  for (const w of result.warnings) {
    L.push(`[HEADS UP] ${w.title}`, `  ${w.body}`);
    if (w.evidence?.length) L.push(`  (found: ${w.evidence.join(' / ')})`);
    L.push('');
  }
  if (result.steps.length) {
    L.push('DNS RECORDS TO ADD:');
    for (const s of result.steps) {
      L.push(`  ${s.order}. ${s.label}`);
      L.push(`     ${s.type}  name: ${s.name}  value: ${s.value}  TTL: ${s.ttl}`);
      L.push(`     ${s.help}`);
      if (s.fallback) L.push(`     Fallback -> ${s.fallback.type} ${s.fallback.name} ${s.fallback.value}`);
      L.push('');
    }
  }
  for (const n of result.notes) L.push(`[NOTE] ${n.title}`, `  ${n.body}`, '');
  return L.join('\n');
}
