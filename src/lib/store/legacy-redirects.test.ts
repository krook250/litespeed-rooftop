/**
 * Legacy URL redirects, tested where a wrong answer is expensive.
 *
 * A 301 is cached hard by browsers, so a rule that sends a real visitor
 * somewhere wrong is close to unfixable for anyone who hit it once. The tests
 * that matter here are therefore less about coverage than about three specific
 * ways this can do damage:
 *
 *   1. Redirecting one of our OWN paths, which loops the site.
 *   2. Redirecting a URL that was never the old site's, which hijacks a 404.
 *   3. Sending one dealer's customers to another dealer's payment form.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { legacyRedirect, paymentLinkFor } from './legacy-redirects';

const MALABAR = 'malabartruckandtrade.com';

/* ----------------------------------------------------- the loop protection */

test('our own paths are not legacy URLs', () => {
  for (const p of ['/', '/privacy', '/visit/main', '/123456', '/ABC123']) {
    assert.equal(legacyRedirect(p), null, p);
  }
});

test('/loan-application maps to itself and so returns null, not a loop', () => {
  assert.equal(legacyRedirect('/loan-application'), null);
});

test('a path that is none of our business is left alone', () => {
  for (const p of ['/some-random-page', '/blog/post-1', '/wp-admin', '/.well-known/x']) {
    assert.equal(legacyRedirect(p), null, p);
  }
});

/* --------------------------------------------------------- the fixed pages */

test('CarsForSale page names land somewhere real', () => {
  assert.equal(legacyRedirect('/about'), '/');
  assert.equal(legacyRedirect('/about-us'), '/');
  assert.equal(legacyRedirect('/contact'), '/');
  assert.equal(legacyRedirect('/contact-us'), '/');
  assert.equal(legacyRedirect('/testimonials'), '/');
  assert.equal(legacyRedirect('/reviews'), '/');
  assert.equal(legacyRedirect('/cars-for-sale'), '/');
  assert.equal(legacyRedirect('/home'), '/');
});

test('financing pages reach the application rather than the home page', () => {
  assert.equal(legacyRedirect('/financing'), '/loan-application');
  assert.equal(legacyRedirect('/apply'), '/loan-application');
  assert.equal(legacyRedirect('/credit-application'), '/loan-application');
});

test('their casing and trailing slashes are handled', () => {
  assert.equal(legacyRedirect('/TermsAndConditions'), '/');
  assert.equal(legacyRedirect('/About'), '/');
  assert.equal(legacyRedirect('/contact/'), '/');
});

/* --------------------------------------------------------------- the SRPs */

test('make pages become a filtered search', () => {
  assert.equal(legacyRedirect('/chevrolet-for-sale-c998972'), '/?make=Chevrolet');
  assert.equal(legacyRedirect('/ford-for-sale-c137146'), '/?make=Ford');
  assert.equal(legacyRedirect('/gmc-for-sale-c137363'), '/?make=GMC');
  assert.equal(legacyRedirect('/ram-for-sale-c169388'), '/?make=Ram');
});

test('make + model pages keep the model', () => {
  assert.equal(
    legacyRedirect('/chevrolet-silverado-1500-for-sale-c999082'),
    '/?make=Chevrolet&model=Silverado+1500',
  );
  assert.equal(
    legacyRedirect('/gmc-sierra-2500hd-for-sale-c137436'),
    '/?make=GMC&model=Sierra+2500hd',
  );
  assert.equal(
    legacyRedirect('/gmc-yukon-xl-for-sale-c137531'),
    '/?make=GMC&model=Yukon+Xl',
  );
});

test('an alphanumeric model keeps its hyphen', () => {
  assert.equal(
    legacyRedirect('/ford-f-350-super-duty-for-sale-c137282'),
    '/?make=Ford&model=F-350+Super+Duty',
  );
  assert.equal(
    legacyRedirect('/ford-f-250-super-duty-for-sale-c137247'),
    '/?make=Ford&model=F-250+Super+Duty',
  );
});

test('two-word makes are not split on their own hyphen', () => {
  assert.equal(legacyRedirect('/land-rover-for-sale-c1'), '/?make=Land+Rover');
  assert.equal(
    legacyRedirect('/mercedes-benz-c-class-for-sale-c2'),
    '/?make=Mercedes-Benz&model=C-Class',
  );
});

test('body style pages map onto our enum', () => {
  assert.equal(legacyRedirect('/pickup-trucks-for-sale-b100030'), '/?body=TRUCK');
  assert.equal(legacyRedirect('/suvs-for-sale-b100037'), '/?body=SUV');
  assert.equal(legacyRedirect('/chassis-for-sale-b100006'), '/?body=TRUCK');
  assert.equal(legacyRedirect('/vans-for-sale-b1'), '/?body=VAN');
});

test('an unreadable -for-sale- URL still goes home rather than 404ing', () => {
  assert.equal(legacyRedirect('/sparkleblorp-for-sale-c999'), '/');
  assert.equal(legacyRedirect('/nonsense-for-sale-b1'), '/');
});

/* ------------------------------------------------------------- the details */

test('a vehicle page becomes the closest search we can honestly describe', () => {
  assert.equal(
    legacyRedirect('/details/used-2018-chevrolet-silverado-1500/131418036'),
    '/?make=Chevrolet&model=Silverado+1500',
  );
  assert.equal(
    legacyRedirect('/details/used-2008-ford-expedition/130042456'),
    '/?make=Ford&model=Expedition',
  );
});

test('the CarsForSale inventory id never leaks into the target', () => {
  // Their id is not our stock number. Carrying it across would land a shopper on
  // whichever of our trucks happened to share the digits.
  const out = legacyRedirect('/details/used-2015-gmc-sierra-1500/129726079');
  assert.ok(!out?.includes('129726079'));
});

test('a details slug we cannot read goes home, not to a guessed make', () => {
  assert.equal(legacyRedirect('/details/mystery-vehicle/123'), '/');
});

/* ------------------------------------------------------------- the payment */

test('the payment link is absolute and belongs to the right dealer', () => {
  const url = paymentLinkFor(MALABAR);
  assert.ok(url?.startsWith('https://simplecheckout.authorize.net/'));
  assert.equal(legacyRedirect('/make-a-payment', { paymentUrl: url }), url);
});

test('a dealer with no payment link gets the home page, never another dealer’s form', () => {
  assert.equal(paymentLinkFor('someotherlot.com'), undefined);
  assert.equal(legacyRedirect('/make-a-payment', { paymentUrl: undefined }), '/');
  assert.equal(legacyRedirect('/make-a-payment'), '/');
});

test('payment link lookup is host-cased safely and ignores www', () => {
  assert.ok(paymentLinkFor('MalabarTruckAndTrade.com'));
  // www is stripped by the caller; the map holds apex only, by contract.
  assert.equal(paymentLinkFor(`www.${MALABAR}`), undefined);
});

/* --------------------------------------------------- the real sitemap, end to end */

test('every URL in Malabar’s old sitemap resolves to something', () => {
  const sitemap = [
    '/testimonials', '/loan-application', '/make-a-payment', '/about', '/contact',
    '/chassis-for-sale-b100006', '/pickup-trucks-for-sale-b100030',
    '/suvs-for-sale-b100037',
    '/chevrolet-for-sale-c998972', '/ford-for-sale-c137146',
    '/gmc-for-sale-c137363', '/ram-for-sale-c169388',
    '/chevrolet-silverado-1500-classic-for-sale-c999055',
    '/chevrolet-silverado-1500-for-sale-c999082',
    '/chevrolet-silverado-2500hd-for-sale-c999033',
    '/chevrolet-suburban-for-sale-c999099', '/chevrolet-tahoe-for-sale-c999044',
    '/ford-expedition-for-sale-c137278', '/ford-explorer-for-sale-c137205',
    '/ford-f-250-super-duty-for-sale-c137247',
    '/ford-f-350-super-duty-for-sale-c137282',
    '/gmc-sierra-1500-for-sale-c137415', '/gmc-sierra-2500hd-for-sale-c137436',
    '/gmc-sierra-3500-for-sale-c137400', '/gmc-sierra-3500hd-for-sale-c137469',
    '/gmc-yukon-for-sale-c137478', '/gmc-yukon-xl-for-sale-c137531',
  ];
  const ctx = { paymentUrl: paymentLinkFor(MALABAR) };
  for (const path of sitemap) {
    const out = legacyRedirect(path, ctx);
    // `/loan-application` is the one that maps to itself — null is correct and
    // means "render it", not "404".
    if (path === '/loan-application') {
      assert.equal(out, null, path);
      continue;
    }
    assert.ok(out, `${path} produced no redirect`);
    assert.ok(out!.startsWith('/') || out!.startsWith('https://'), `${path} → ${out}`);
  }
});
