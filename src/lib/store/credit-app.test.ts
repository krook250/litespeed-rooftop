/**
 * Credit-application URL tests.
 *
 * This is a security boundary, not a formatting helper: whatever survives
 * `parseCreditAppUrl` gets framed on a page we serve, and until a dealer's
 * domain is live that page is on `app.rooftopauto.com` next to every other
 * tenant's admin session. So the cases below are the payloads somebody would
 * actually send, not the ones that make the code look right.
 *
 * The happy-path URL is Malabar's real one, confirmed framing correctly in
 * Chrome on 1 Sep 2026.
 *
 * No database, no network. Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDIT_APP_MESSAGES,
  creditAppFor,
  parseCreditAppUrl,
  providerFor,
  registrableDomain,
  standaloneUrl,
} from './credit-app';

const MALABAR =
  'https://dwssecuredforms.dealercenter.net/CreditApplication/index/23548716' +
  '?themecolor=8C8C8C&formtype=l&frameId=dws_frame_0&standalone=true&ls=Our%20Website';

const ok = (raw: string) => {
  const r = parseCreditAppUrl(raw);
  assert.ok(r.ok, `expected ok, got ${r.ok ? '' : r.error}`);
  return r.ok ? r.app : (undefined as never);
};
const err = (raw: string) => {
  const r = parseCreditAppUrl(raw);
  assert.equal(r.ok, false, `expected rejection for ${raw}`);
  return r.ok ? (undefined as never) : r.error;
};

describe('parseCreditAppUrl — the real one', () => {
  it('accepts the live DealerCenter link and names the provider', () => {
    const app = ok(MALABAR);
    assert.equal(app.provider, 'DealerCenter');
    assert.equal(app.host, 'dealercenter.net');
  });

  /*
   * The account id lives in the path and the theme in the query. Dropping
   * "extra" parameters would silently repoint the form at another dealership —
   * applications would submit, to somebody else. Worst possible failure here.
   */
  it('preserves the path and every query parameter exactly', () => {
    const app = ok(MALABAR);
    const u = new URL(app.url);
    assert.equal(u.pathname, '/CreditApplication/index/23548716');
    assert.equal(u.searchParams.get('themecolor'), '8C8C8C');
    assert.equal(u.searchParams.get('formtype'), 'l');
    assert.equal(u.searchParams.get('ls'), 'Our Website');
  });

  it('drops only the fragment, which never reaches the server', () => {
    const app = ok(MALABAR + '#form-top');
    assert.equal(app.url.includes('#'), false);
  });

  it('tolerates whitespace around a pasted link', () => {
    assert.equal(ok(`  ${MALABAR}\n`).url, ok(MALABAR).url);
  });
});

describe('parseCreditAppUrl — what it refuses', () => {
  it('refuses anything that is not https', () => {
    assert.equal(err(MALABAR.replace('https:', 'http:')), 'NOT_HTTPS');
    assert.equal(err('javascript:alert(document.cookie)'), 'NOT_A_URL');
    assert.equal(err('data:text/html,<script>alert(1)</script>'), 'NOT_A_URL');
  });

  /*
   * The one that matters. A framed page inherits the address bar around it, so
   * an arbitrary host under `app.rooftopauto.com` is a phishing form wearing our
   * domain — and Safe Browsing would flag the hostname every dealer shares.
   */
  it('refuses a host that is not an allowlisted provider', () => {
    assert.equal(err('https://evil.example.com/apply'), 'UNKNOWN_PROVIDER');
    assert.equal(err('https://app.rooftopauto.com/admin'), 'UNKNOWN_PROVIDER');
  });

  /* Suffix matching, not `includes`: the classic allowlist bypass. */
  it('is not fooled by a lookalike host', () => {
    assert.equal(err('https://dealercenter.net.evil.example.com/apply'), 'UNKNOWN_PROVIDER');
    assert.equal(err('https://notdealercenter.net/apply'), 'UNKNOWN_PROVIDER');
    assert.equal(err('https://evil.example.com/?x=dealercenter.net'), 'UNKNOWN_PROVIDER');
  });

  it('refuses credentials embedded in the URL', () => {
    assert.equal(err('https://user:pass@dwssecuredforms.dealercenter.net/x'), 'HAS_CREDENTIALS');
  });

  it('refuses an empty or unparseable value', () => {
    assert.equal(err(''), 'EMPTY');
    assert.equal(err('   '), 'EMPTY');
    assert.equal(err('dealercenter'), 'NOT_A_URL');
  });

  /* Dealers are sent a block of <script> by their provider and will paste it. */
  it('refuses a pasted embed snippet rather than trying to read it', () => {
    assert.equal(err('<iframe src="https://dwssecuredforms.dealercenter.net/x"></iframe>'), 'NOT_A_URL');
    assert.equal(err('<script src="https://dealercenter.net/embed.js"></script>'), 'NOT_A_URL');
  });

  it('has a message for every rejection, so nothing renders blank', () => {
    for (const code of ['EMPTY', 'NOT_A_URL', 'NOT_HTTPS', 'HAS_CREDENTIALS', 'UNKNOWN_PROVIDER'] as const) {
      assert.ok(CREDIT_APP_MESSAGES[code].length > 20, code);
    }
  });
});

describe('providerFor / registrableDomain', () => {
  it('matches a provider on any of its subdomains', () => {
    assert.equal(providerFor('dwssecuredforms.dealercenter.net')?.name, 'DealerCenter');
    assert.equal(providerFor('dealercenter.net')?.name, 'DealerCenter');
    assert.equal(providerFor('a.b.c.routeone.net')?.name, 'RouteOne');
    assert.equal(providerFor('example.com'), null);
  });

  it('is case-insensitive about the host', () => {
    assert.equal(providerFor('DWSSecuredForms.DealerCenter.NET')?.name, 'DealerCenter');
  });

  it('reduces a host to its registrable domain', () => {
    assert.equal(registrableDomain('dwssecuredforms.dealercenter.net'), 'dealercenter.net');
    assert.equal(registrableDomain('dealercenter.net'), 'dealercenter.net');
  });
});

describe('creditAppFor', () => {
  it('is null for an unset column', () => {
    assert.equal(creditAppFor(null), null);
    assert.equal(creditAppFor(''), null);
  });

  /*
   * Storage can never outrun the rules: a row written while a provider was
   * allowlisted must stop rendering the moment it is removed.
   */
  it('re-validates the stored value rather than trusting it', () => {
    assert.equal(creditAppFor('https://evil.example.com/apply'), null);
    assert.equal(creditAppFor('not a url at all'), null);
    assert.ok(creditAppFor(MALABAR));
  });
});

describe('standaloneUrl', () => {
  it('drops frameId and forces standalone for the open-in-a-window link', () => {
    const u = new URL(standaloneUrl(ok(MALABAR)));
    assert.equal(u.searchParams.get('frameId'), null);
    assert.equal(u.searchParams.get('standalone'), 'true');
  });

  it('leaves the account id and the rest of the query alone', () => {
    const u = new URL(standaloneUrl(ok(MALABAR)));
    assert.equal(u.pathname, '/CreditApplication/index/23548716');
    assert.equal(u.searchParams.get('themecolor'), '8C8C8C');
  });
});
