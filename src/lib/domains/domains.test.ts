/**
 * Domain guardrails and DNS decision table.
 *
 * The purchase tests exist to prove one specific thing: **an over-cap domain is
 * rejected before any money-spending call is made.** They assert not just the
 * return value but that the buy endpoint was never reached — a guardrail
 * that rejects *after* the buy has already happened is not a guardrail.
 *
 * Run with `npm test`.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyseCaa, normalizeDomain, type CaaRecord } from './lookup';

/* ------------------------------------------------------------------ fetch stub */

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
let priceTable: Record<string, { new: number; renewal: number }> = {};
let availability: Record<string, boolean> = {};
const realFetch = globalThis.fetch;

function installStub() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });

    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

    /*
     * The current API puts the domain in the PATH, not a query param — the old
     * `?name=` form belonged to the v4 endpoints Vercel sunsetted on 9 Nov 2025.
     * Parsing it out of the path here is what makes this stub actually
     * representative; matching on `?name=` is how the previous version of this
     * test passed against code that could never have worked.
     */
    const m = new URL(url).pathname.match(/^\/v1\/registrar\/domains\/([^/]+)\//);
    const name = m ? decodeURIComponent(m[1]!) : '';

    if (url.includes('/availability')) {
      return json({ available: availability[name] ?? true });
    }
    if (url.includes('/price')) {
      const p = priceTable[name] ?? { new: 12, renewal: 14 };
      return json({
        years: 1,
        purchasePrice: p.new,
        renewalPrice: p.renewal,
        transferPrice: p.new,
      });
    }
    if (url.includes('/buy')) {
      return json({ orderId: 'ord_test', _links: {} });
    }
    return json({});
  }) as typeof fetch;
}

before(() => {
  process.env.VERCEL_API_TOKEN = 'test-token-not-real';
  process.env.VERCEL_PROJECT_ID = 'prj_test';
  installStub();
});
after(() => {
  globalThis.fetch = realFetch;
});

const buyCalls = () => calls.filter((c) => c.url.includes('/buy'));

/* ------------------------------------------------------------ 1. price ceiling */

describe('purchase guardrails', () => {
  it('rejects an over-cap domain BEFORE any buy call is made', async () => {
    const { quoteDomain } = await import('./vercel');
    calls.length = 0;
    priceTable = { 'premiumcars.com': { new: 4200, renewal: 4200 } };

    const q = await quoteDomain('premiumcars.com');

    assert.equal(q.ok, false);
    if (q.ok) return;
    assert.equal(q.reason, 'premium');
    assert.equal(buyCalls().length, 0, 'buy must never be called for an over-cap domain');
  });

  it('rejects a domain just over the cap as over-price-cap, still without buying', async () => {
    const { quoteDomain, DOMAIN_PRICE_CAP_USD } = await import('./vercel');
    calls.length = 0;
    priceTable = { 'edgecase.com': { new: DOMAIN_PRICE_CAP_USD + 1, renewal: 14 } };

    const q = await quoteDomain('edgecase.com');
    assert.equal(q.ok, false);
    if (q.ok) return;
    assert.equal(q.reason, 'over-price-cap');
    assert.equal(buyCalls().length, 0);
  });

  it('rejects a cheap first year with an expensive renewal', async () => {
    const { quoteDomain } = await import('./vercel');
    calls.length = 0;
    // The exact trap from the billing doc: $9 now, $60 forever after.
    priceTable = { 'cheapnow.com': { new: 9, renewal: 60 } };

    const q = await quoteDomain('cheapnow.com');
    assert.equal(q.ok, false);
    if (q.ok) return;
    assert.equal(q.reason, 'over-renewal-cap');
    assert.equal(q.renewalPriceUsd, 60);
    assert.equal(buyCalls().length, 0);
  });

  it('fails CLOSED when Vercel will not quote a renewal price', async () => {
    const { quoteDomain } = await import('./vercel');
    calls.length = 0;
    // An unknown recurring cost on Litespeed's card is the thing the cap exists
    // to prevent, so "no renewal price" must reject rather than assume cheap.
    priceTable = { 'norenewal.com': { new: 12, renewal: 0 } };

    const q = await quoteDomain('norenewal.com');
    assert.equal(q.ok, false);
    if (q.ok) return;
    assert.equal(q.reason, 'over-renewal-cap');
    assert.equal(buyCalls().length, 0);
  });

  it('rejects a TLD outside the allowlist without spending an API call', async () => {
    const { quoteDomain } = await import('./vercel');
    calls.length = 0;

    const q = await quoteDomain('cascademotors.xyz');
    assert.equal(q.ok, false);
    if (q.ok) return;
    assert.equal(q.reason, 'tld-not-allowed');
    assert.equal(calls.length, 0, 'a disallowed TLD should not reach Vercel at all');
  });

  it('rejects an unavailable domain', async () => {
    const { quoteDomain } = await import('./vercel');
    calls.length = 0;
    availability = { 'taken.com': false };

    const q = await quoteDomain('taken.com');
    assert.equal(q.ok, false);
    if (q.ok) return;
    assert.equal(q.reason, 'unavailable');
    assert.equal(buyCalls().length, 0);
    availability = {};
  });

  it('quotes a normal domain and records BOTH the first year and the renewal', async () => {
    const { quoteDomain } = await import('./vercel');
    calls.length = 0;
    priceTable = { 'cascademotorswa.com': { new: 12, renewal: 16 } };

    const q = await quoteDomain('cascademotorswa.com');
    assert.equal(q.ok, true);
    if (!q.ok) return;
    assert.equal(q.priceUsd, 12);
    assert.equal(q.renewalPriceUsd, 16, 'renewal must be recorded, not just the first year');
    assert.equal(buyCalls().length, 0, 'quoting must never buy');
  });

  it('sends expectedPrice and autoRenew on the buy, from the server quote', async () => {
    const { buyDomain } = await import('./vercel');
    calls.length = 0;
    priceTable = { 'cascademotorswa.com': { new: 12, renewal: 16 } };

    const r = await buyDomain({
      domain: 'cascademotorswa.com',
      years: 1,
      autoRenew: true,
      expectedPriceUsd: 12,
      registrant: {
        firstName: 'Ray', lastName: 'Kessler', email: 'ray@example.com', phone: '+1.3605550142',
        address1: '4100 NE Fourth Plain Blvd', city: 'Vancouver', state: 'WA',
        zip: '98661', country: 'US',
      },
    });

    assert.equal(r.ok, true);
    const buy = buyCalls()[0];
    assert.ok(buy, 'the buy call should have happened');
    assert.match(
      buy.url,
      /\/v1\/registrar\/domains\/cascademotorswa\.com\/buy/,
      'must use the current registrar endpoint, not the sunsetted /v5/domains/buy',
    );
    const body = buy.body as Record<string, unknown>;
    assert.equal(body.expectedPrice, 12, 'expectedPrice must be sent');
    assert.equal(body.autoRenew, true, 'autoRenew must be sent (Vercel requires it)');
    assert.equal(body.years, 1);

    // Contact is nested under `contactInformation`, not flat on the body.
    const contact = body.contactInformation as Record<string, unknown>;
    assert.ok(contact, 'contactInformation must be present');
    assert.equal(contact.email, 'ray@example.com', 'the DEALER is the registrant, not Litespeed');
    assert.equal(contact.zip, '98661', 'Vercel calls it zip, not postalCode');
    assert.equal(contact.phone, '+1.3605550142', 'phone must be normalised to E.164');
  });

  it('refuses to buy when the price moved since the quote — and does not buy', async () => {
    const { buyDomain } = await import('./vercel');
    calls.length = 0;
    priceTable = { 'moved.com': { new: 18, renewal: 18 } };

    const r = await buyDomain({
      domain: 'moved.com',
      years: 1,
      autoRenew: true,
      expectedPriceUsd: 12, // stale quote
      registrant: {
        firstName: 'Ray', lastName: 'Kessler', email: 'ray@example.com', phone: '+1.3605550142',
        address1: '1 Main', city: 'Vancouver', state: 'WA', zip: '98661', country: 'US',
      },
    });

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'price-changed');
    assert.equal(buyCalls().length, 0, 'a stale quote must not reach the buy endpoint');
  });
});

/* ------------------------------------------------------- 1b. phone format */

describe('E.164 phone normalisation', () => {
  it('converts what a dealer actually types', async () => {
    const { toE164 } = await import('./vercel');
    // This is the seeded rooftop phone format — it would be rejected verbatim.
    assert.equal(toE164('(360) 555-0142'), '+1.3605550142');
    assert.equal(toE164('360-555-0142'), '+1.3605550142');
    assert.equal(toE164('3605550142'), '+1.3605550142');
    assert.equal(toE164('1 360 555 0142'), '+1.3605550142');
    assert.equal(toE164('+1.3605550142'), '+1.3605550142');
  });

  it('returns null for something that is not a phone number', async () => {
    const { toE164 } = await import('./vercel');
    assert.equal(toE164(''), null);
    assert.equal(toE164('call me'), null);
    assert.equal(toE164('123'), null);
  });

  it('every output satisfies Vercel\'s documented pattern', async () => {
    const { toE164 } = await import('./vercel');
    const pattern = /^(?=(?:\D*\d){8,15}$)\+[1-9]\d{0,2}\.?\d+$/;
    for (const input of ['(360) 555-0142', '360-555-0142', '3605550142', '+13605550142']) {
      const out = toE164(input);
      assert.ok(out && pattern.test(out), `${input} -> ${out} must match Vercel's regex`);
    }
  });
});

/* ------------------------------------------------------------------ 2. CAA */

describe('CAA analysis', () => {
  const caa = (records: CaaRecord[]) => analyseCaa({ foundAt: 'example.com', records });

  it('does not block when there is no CAA record at all', () => {
    const r = analyseCaa({ foundAt: null, records: [] });
    assert.equal(r.blocksLetsEncrypt, false);
    assert.equal(r.status, 'none');
  });

  it('blocks when the issuer set excludes Let\'s Encrypt', () => {
    // Real shape, taken from apple.com.
    const r = caa([{ critical: 0, issue: 'pki.apple.com' }, { critical: 0, issuewild: 'pki.apple.com' }]);
    assert.equal(r.blocksLetsEncrypt, true);
    assert.equal(r.status, 'blocks-letsencrypt');
  });

  it('does NOT block when a CAA record exists and permits Let\'s Encrypt', () => {
    // This is the case a naive "has CAA → block" check gets wrong. Real shape,
    // taken from discourse.org.
    const r = caa([{ critical: 0, issue: 'letsencrypt.org' }, { critical: 0, issue: 'amazonaws.com' }]);
    assert.equal(r.blocksLetsEncrypt, false);
    assert.equal(r.status, 'permits-letsencrypt');
  });

  it('ignores parameters after a semicolon when matching the issuer', () => {
    // Real shape, taken from artofmanliness.com.
    const r = caa([{ critical: 0, issue: 'letsencrypt.org; cansignhttpexchanges=yes' }]);
    assert.equal(r.blocksLetsEncrypt, false);
  });

  it('treats iodef-only as permissive, not as a block', () => {
    const r = caa([{ critical: 0, iodef: 'mailto:security@example.com' }]);
    assert.equal(r.blocksLetsEncrypt, false);
    assert.equal(r.status, 'permissive');
  });

  it('blocks on the explicit "no CA may issue" form', () => {
    const r = caa([{ critical: 0, issue: ';' }]);
    assert.equal(r.blocksLetsEncrypt, true);
    assert.equal(r.status, 'blocks-all');
  });
});

/* --------------------------------------------------------- 3. normalisation */

describe('domain normalisation', () => {
  const ok = (input: string, expected: string) =>
    it(`normalises ${JSON.stringify(input)}`, () => {
      const r = normalizeDomain(input);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.domain, expected);
    });

  ok('https://www.CascadeMotorsWA.com/inventory?x=1', 'cascademotorswa.com');
  ok('  cascademotorswa.com.  ', 'cascademotorswa.com');
  ok('sales@cascademotorswa.com', 'cascademotorswa.com');
  ok('cascade motors .com', 'cascademotors.com');
  ok('HTTP://Foo.CO.UK:8080/x', 'foo.co.uk');

  it('rejects a bare word with no TLD', () => {
    const r = normalizeDomain('notadomain');
    assert.equal(r.ok, false);
  });

  it('rejects an empty value', () => {
    assert.equal(normalizeDomain('').ok, false);
    assert.equal(normalizeDomain(null).ok, false);
  });

  it('flags a subdomain but still normalises it', () => {
    const r = normalizeDomain('shop.cascademotorswa.com');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.isSubdomain, true);
  });

  it('does not mistake a multi-part TLD for a subdomain', () => {
    const r = normalizeDomain('cascademotors.co.uk');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.isSubdomain, false);
  });
});

/* ------------------------------------------- 4. the slug/domain disjointness */

describe('slug and domain key spaces', () => {
  it('a slug never contains a dot and a domain always does', () => {
    // This is the invariant `proxy.ts` depends on to route by host with no
    // database call. If it ever stops holding, host routing silently collides.
    const slugs = ['cascade-motors', 'evergreen', 'a1autos'];
    for (const s of slugs) assert.equal(s.includes('.'), false, `slug ${s} must not contain a dot`);

    const r = normalizeDomain('cascademotorswa.com');
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.domain.includes('.'), 'a normalised domain always contains a dot');
  });
});
