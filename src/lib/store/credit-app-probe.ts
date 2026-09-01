import 'server-only';

/**
 * Will this provider actually let us frame their form, from this domain?
 *
 * WHY THIS EXISTS. DealerCenter gates embedding on the **Referer header**, and
 * the two failure messages are distinguishable, which is how we know:
 *
 *   framed from an unregistered domain → "This page cannot be embedded."
 *   framed with no referrer at all     → "This page needs to have a valid referrer."
 *
 * That is not a bug and not something to work around. It is their anti-fraud
 * control on a form that collects a social security number, and a dealer
 * authorises the domains that may host it from inside their own DealerCenter
 * account. Defeating it — spoofing a Referer, proxying the form — would be
 * precisely the wrong thing to do here, and this file exists to *report* the
 * refusal, never to route around it.
 *
 * Without the probe the dealer sees a red box inside their own website and has
 * no idea whether the fault is Rooftop, DealerCenter, or the link they pasted.
 * A cross-origin frame cannot be inspected from the page, so the browser can
 * never tell them. The server can, once, at the moment they press Save.
 */

/** Response bodies are read only far enough to spot a refusal. */
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 8000;

export type EmbedVerdict =
  /** Framing looks fine from this origin. */
  | { state: 'ok' }
  /** The provider recognised the request and refused this domain. */
  | { state: 'refused'; reason: string }
  /** The provider requires a referrer we could not supply. */
  | { state: 'needs-referrer' }
  /** Headers forbid framing outright, regardless of domain. */
  | { state: 'blocked-by-headers'; header: string }
  /** Network trouble, a timeout, or a response we cannot read. Not a verdict. */
  | { state: 'unknown'; note: string };

/**
 * Refusal text seen in the wild, lowercased.
 *
 * Deliberately narrow: a false "refused" would tell a dealer their working
 * financing page is broken, which is worse than saying nothing. Anything not
 * matched here falls through to the header checks and then to `ok`.
 */
const REFUSAL_MARKERS = [
  'cannot be embedded',
  'not authorized to embed',
  'unauthorized domain',
  'invalid referrer',
];
const NEEDS_REFERRER_MARKERS = ['needs to have a valid referrer', 'referrer is required'];

/**
 * Ask the provider, as the storefront would.
 *
 * The URL is already constrained to an allowlisted provider by
 * `parseCreditAppUrl`, so this is not the open SSRF surface that
 * `src/lib/branding/site-scan.ts` guards so carefully — the host cannot be
 * chosen freely. Redirects are not followed: a provider bouncing us somewhere
 * else is a signal in itself, and following hops would reopen exactly the
 * question the allowlist just closed.
 */
export async function probeEmbed(url: string, origin: string): Promise<EmbedVerdict> {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        /* A real browser's framing request carries both, and DealerCenter reads
           the Referer specifically — the page-level URL, with a trailing slash,
           is what a top-level document sends. */
        Referer: `${origin.replace(/\/$/, '')}/`,
        Origin: origin.replace(/\/$/, ''),
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    /* Generic, and worth checking before any provider-specific string: these
       forbid framing for everybody and no amount of domain authorisation fixes
       them. Covers providers we have never seen. */
    const xfo = res.headers.get('x-frame-options');
    if (xfo && /deny|sameorigin/i.test(xfo)) {
      return { state: 'blocked-by-headers', header: `X-Frame-Options: ${xfo}` };
    }
    const csp = res.headers.get('content-security-policy') ?? '';
    const frameAncestors = csp.match(/frame-ancestors([^;]*)/i)?.[1]?.trim();
    if (frameAncestors && !/\*/.test(frameAncestors)) {
      const host = new URL(origin).host;
      if (!frameAncestors.toLowerCase().includes(host.toLowerCase())) {
        return { state: 'blocked-by-headers', header: `frame-ancestors ${frameAncestors}` };
      }
    }

    if (res.status >= 300 && res.status < 400) {
      return { state: 'unknown', note: `the provider redirected (${res.status})` };
    }
    if (!res.ok) return { state: 'unknown', note: `the provider answered ${res.status}` };

    const body = (await readCapped(res)).toLowerCase();
    if (NEEDS_REFERRER_MARKERS.some((m) => body.includes(m))) return { state: 'needs-referrer' };
    const hit = REFUSAL_MARKERS.find((m) => body.includes(m));
    if (hit) return { state: 'refused', reason: hit };

    return { state: 'ok' };
  } catch (err) {
    return {
      state: 'unknown',
      note: err instanceof Error && err.name === 'TimeoutError' ? 'the provider timed out' : 'we could not reach the provider',
    };
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const out = new Uint8Array(acc.length + c.length);
      out.set(acc);
      out.set(c, acc.length);
      return out;
    }, new Uint8Array()),
  );
}

/**
 * What to tell the dealer, in their words rather than ours.
 *
 * Every branch names who has to do what. "It didn't work" on a screen a dealer
 * reached by pasting a link they were told to paste is how a support call
 * starts; "DealerCenter has not authorised this address yet, ask them to add
 * it" is how one is avoided.
 */
export function explainEmbed(verdict: EmbedVerdict, host: string, provider: string): string {
  switch (verdict.state) {
    case 'ok':
      return `${provider} is happy to show your application on ${host}.`;
    case 'refused':
    case 'needs-referrer':
      return (
        `${provider} will not display your application on ${host} yet. They only allow it on web ` +
        `addresses registered to your account — call them and ask for ${host} to be added to the ` +
        `websites allowed to host your credit application. Until then the page still works: buyers ` +
        `get a button that opens the application in a new window.`
      );
    case 'blocked-by-headers':
      return (
        `${provider} does not allow their application to be embedded on any website ` +
        `(${verdict.header}). Your page will show a button that opens it in a new window instead, ` +
        `which is the only thing they permit.`
      );
    case 'unknown':
      return (
        `Saved. We could not check whether ${provider} will embed on ${host} — ${verdict.note}. ` +
        `Open your financing page and see; if the form does not appear, ask ${provider} to allow ` +
        `${host}.`
      );
  }
}
