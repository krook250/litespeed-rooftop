/**
 * The dealer's online credit application, embedded on their storefront.
 *
 * A dealer already has a credit app — it comes with their DMS or their F&I
 * platform, it is bound to their lender relationships, and it is the one thing
 * on their website we should not try to rebuild. Rooftop's job is to give it a
 * page with their branding around it, not to collect a social security number.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * It never accepts an HTML snippet. Every F&I provider hands dealers a block of
 * `<script>` and asks them to paste it, and accepting that would be arbitrary
 * JavaScript execution on a page we host. On a dealer's own domain that is bad;
 * on the shared `app.rooftopauto.com` host — where every storefront lives until
 * its domain goes live — it is one tenant running script on the origin that
 * holds every other dealer's admin session. So: a URL, an allowlist, and an
 * iframe. Nothing else.
 */

/**
 * Hosts we will frame, and what to call them.
 *
 * An allowlist rather than "any https URL", and the reason is specific rather
 * than reflexive. A framed page inherits the address bar of whatever is around
 * it: a phishing form under `app.rooftopauto.com` reads to a buyer — and to
 * Google Safe Browsing — as ours. Being flagged on that hostname cost three days
 * once already (see §9 of `claude/meta-screencast-recording-guide.md`), and that
 * was for a half-built storefront, not a credit form asking for a SSN.
 *
 * Matching is on the registrable domain, so a provider's per-dealer subdomain
 * works without an entry each. Adding a provider is one line here.
 */
export const CREDIT_APP_PROVIDERS: readonly { domain: string; name: string }[] = [
  { domain: 'dealercenter.net', name: 'DealerCenter' },
  { domain: 'dealercenter.com', name: 'DealerCenter' },
  { domain: 'dealertrack.com', name: 'Dealertrack' },
  { domain: 'routeone.net', name: 'RouteOne' },
  { domain: '700credit.com', name: '700Credit' },
  { domain: 'autofi.com', name: 'AutoFi' },
  { domain: 'dealersocket.com', name: 'DealerSocket' },
  { domain: 'frazer.com', name: 'Frazer' },
  { domain: 'carnow.com', name: 'CarNow' },
  { domain: 'wayne-reaves.com', name: 'Wayne Reaves' },
  { domain: 'aplusdms.com', name: 'A-Plus DMS' },
  { domain: 'dealerclick.com', name: 'DealerClick' },
  { domain: 'selly.com', name: 'Selly Automotive' },
  { domain: 'creditacceptance.com', name: 'Credit Acceptance' },
  { domain: 'westlakefinancial.com', name: 'Westlake Financial' },
];

export type CreditApp = {
  /** The URL as we will put it in `src="…"` — normalised, never the raw input. */
  url: string;
  /** For "provided by …" on the page. Buyers should know whose form this is. */
  provider: string;
  /** Registrable domain, shown so the buyer can see where the data goes. */
  host: string;
};

export type CreditAppError =
  | 'EMPTY'
  | 'NOT_A_URL'
  | 'NOT_HTTPS'
  | 'HAS_CREDENTIALS'
  | 'UNKNOWN_PROVIDER';

export const CREDIT_APP_MESSAGES: Record<CreditAppError, string> = {
  EMPTY: 'Paste the link to your credit application.',
  NOT_A_URL: "That doesn't look like a web address. Paste the whole link, starting with https://",
  NOT_HTTPS:
    'That link is not secure (it starts with http://, not https://). A credit application collects a ' +
    'social security number — ask your provider for the secure version of the link.',
  HAS_CREDENTIALS:
    'That link has a username or password in it. Ask your provider for the plain application link.',
  UNKNOWN_PROVIDER:
    'We don’t recognise that provider yet. Tell us who runs your credit application and we’ll add ' +
    'them — it takes a minute. We only embed forms from providers we know, because the form sits on ' +
    'your website and asks buyers for their social security number.',
};

/** The registrable domain — `a.b.dealercenter.net` → `dealercenter.net`. */
export function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, '').split('.');
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

export function providerFor(hostname: string): { domain: string; name: string } | null {
  const host = hostname.toLowerCase();
  return (
    CREDIT_APP_PROVIDERS.find(
      (p) => host === p.domain || host.endsWith(`.${p.domain}`),
    ) ?? null
  );
}

/**
 * Validate and normalise what the dealer pasted.
 *
 * Query strings are preserved verbatim — a provider's link carries the dealer's
 * account id in it (`/CreditApplication/index/23548716`) and often a theme
 * colour and a form type as well. Stripping "extra" parameters would silently
 * point the form at the wrong dealership, which is the worst possible failure
 * here: applications would submit, to somebody else.
 */
export function parseCreditAppUrl(raw: string): { ok: true; app: CreditApp } | { ok: false; error: CreditAppError } {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'EMPTY' };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'NOT_A_URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: url.protocol === 'http:' ? 'NOT_HTTPS' : 'NOT_A_URL' };
  }
  if (url.username || url.password) return { ok: false, error: 'HAS_CREDENTIALS' };

  const provider = providerFor(url.hostname);
  if (!provider) return { ok: false, error: 'UNKNOWN_PROVIDER' };

  /* `hash` is dropped: it never reaches the server, and a fragment on a form URL
     is nearly always a leftover anchor from wherever the dealer copied it. */
  url.hash = '';

  return {
    ok: true,
    app: { url: url.toString(), provider: provider.name, host: registrableDomain(url.hostname) },
  };
}

/** Stored value → renderable, or null. Same validator, so storage can never outrun the rules. */
export function creditAppFor(stored: string | null): CreditApp | null {
  if (!stored) return null;
  const parsed = parseCreditAppUrl(stored);
  return parsed.ok ? parsed.app : null;
}

/**
 * Where the "open it directly" link should point.
 *
 * Every provider link we have seen carries `standalone` and `frameId`
 * parameters, which is how their own embed script tells the form it is inside a
 * frame. Malabar's live site links straight out with `standalone=true` on it,
 * so the flag is clearly not load-bearing for a direct visit — but `frameId` is
 * meaningless outside a frame and is dropped, because a form that thinks it is
 * framed may try to postMessage its height to a parent that is not there.
 */
export function standaloneUrl(app: CreditApp): string {
  const url = new URL(app.url);
  url.searchParams.delete('frameId');
  url.searchParams.set('standalone', 'true');
  return url.toString();
}
