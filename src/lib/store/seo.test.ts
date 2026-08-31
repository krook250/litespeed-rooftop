/**
 * SEO tests.
 *
 * Structured data rots silently — nothing on the page renders differently when
 * it is wrong, and the feedback loop is Search Console weeks later. So the
 * assertions here are on the shapes Google actually validates, and on the two
 * things that have already gone wrong once each: a duplicated business name, and
 * a URL naming the hostname the dealer does not control.
 *
 * No database, no network. Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TYPICAL_HOURS } from './hours';
import {
  autoDealerLd,
  canonicalOrigin,
  dealerNodeName,
  directionsUrl,
  firstParagraph,
  fullAddress,
  paragraphs,
  storefrontLd,
  telHref,
  vehicleLd,
  visitPath,
  type SeoRooftop,
  type SeoStorefront,
} from './seo';

const ROOFTOP: SeoRooftop = {
  id: 'r1',
  slug: 'orchards',
  name: 'Orchards',
  addressLine1: '8215 NE Highway 99',
  city: 'Vancouver',
  state: 'WA',
  postalCode: '98665',
  phone: '(360) 555-0142',
  timezone: 'America/Los_Angeles',
  latitude: 45.6872,
  longitude: -122.6603,
  hours: TYPICAL_HOURS,
};

const STOREFRONT: SeoStorefront = {
  name: 'Cascade Motors',
  slug: 'cascade',
  domain: 'cascademotorswa.com',
  domainStatus: 'LIVE',
  tagline: 'Straight pricing on clean Northwest cars',
  about: 'We have sold clean Northwest cars since 2009.\n\nSecond paragraph.',
  phone: '(360) 555-0142',
};

describe('canonicalOrigin', () => {
  /*
   * A storefront answers on two addresses. Structured data naming the wrong one
   * tells Google the canonical page lives on a hostname the dealer does not own.
   */
  it('prefers the dealer domain once it is LIVE', () => {
    assert.equal(canonicalOrigin(STOREFRONT, 'app.rooftopauto.com'), 'https://cascademotorswa.com');
  });

  it('falls back to the request host while the domain is not LIVE', () => {
    const pending = { ...STOREFRONT, domainStatus: 'PENDING' };
    assert.equal(canonicalOrigin(pending, 'app.rooftopauto.com'), 'https://app.rooftopauto.com');
  });

  it('drops a port and survives no host at all', () => {
    const none = { domain: null, domainStatus: 'NONE' };
    assert.equal(canonicalOrigin(none, 'localhost:3000'), 'https://localhost');
    assert.equal(canonicalOrigin(none, null), '');
  });
});

describe('telHref', () => {
  it('strips a formatted number down to a dialable one', () => {
    assert.equal(telHref('(360) 555-0142'), 'tel:+13605550142');
    assert.equal(telHref('360.555.0142'), 'tel:+13605550142');
    assert.equal(telHref('+1 360 555 0142'), 'tel:+13605550142');
  });
});

describe('directionsUrl', () => {
  it('sends coordinates when we have them', () => {
    const u = new URL(directionsUrl(ROOFTOP));
    assert.equal(u.searchParams.get('api'), '1');
    assert.equal(u.searchParams.get('destination'), '45.6872,-122.6603');
  });

  it('falls back to the street address when the lot is not geocoded', () => {
    const u = new URL(directionsUrl({ ...ROOFTOP, latitude: null, longitude: null }));
    assert.equal(u.searchParams.get('destination'), '8215 NE Highway 99, Vancouver, WA 98665');
  });

  it('escapes the address rather than building a broken URL', () => {
    const u = directionsUrl({ ...ROOFTOP, latitude: null, longitude: null, addressLine1: '1 A & B St #2' });
    assert.equal(u.includes(' '), false);
    assert.equal(new URL(u).searchParams.get('destination'), '1 A & B St #2, Vancouver, WA 98665');
  });
});

describe('dealerNodeName', () => {
  it('joins genuinely different names', () => {
    assert.equal(dealerNodeName('Cascade Motors', 'Orchards'), 'Cascade Motors — Orchards');
  });

  /*
   * The regression. Dealers name rooftops inconsistently, and concatenating
   * unconditionally produced "Rooftop Demo Motors Vancouver — Rooftop Demo
   * Motors — Vancouver" on the first real row.
   */
  it('does not repeat a brand the rooftop name already carries', () => {
    // The same words, punctuated differently. Either spelling is correct; what
    // matters is that only one of them comes out.
    assert.equal(
      dealerNodeName('Rooftop Demo Motors Vancouver', 'Rooftop Demo Motors — Vancouver'),
      'Rooftop Demo Motors — Vancouver',
    );
    assert.equal(
      dealerNodeName('Cascade Motors', 'Cascade Motors Orchards'),
      'Cascade Motors Orchards',
    );
    assert.equal(dealerNodeName('Cascade Motors', 'Cascade Motors'), 'Cascade Motors');
  });

  it('ignores punctuation and case when comparing', () => {
    assert.equal(dealerNodeName('Cascade Motors', 'CASCADE  MOTORS - Orchards'), 'CASCADE  MOTORS - Orchards');
  });
});

describe('autoDealerLd', () => {
  const opts = { origin: 'https://cascademotorswa.com', basePath: '', brandName: 'Cascade Motors', logoUrl: '/api/logo/abc' };

  it('anchors @id on the lot page so other nodes can point at it', () => {
    const ld = autoDealerLd(ROOFTOP, opts);
    assert.equal(ld['@type'], 'AutoDealer');
    assert.equal(ld['@id'], 'https://cascademotorswa.com/visit/orchards');
    assert.equal(ld['@id'], ld.url);
  });

  it('carries a full postal address and coordinates', () => {
    const ld = autoDealerLd(ROOFTOP, opts) as Record<string, Record<string, unknown>>;
    assert.equal(ld.address!.streetAddress, '8215 NE Highway 99');
    assert.equal(ld.address!.addressCountry, 'US');
    assert.equal(ld.geo!.latitude, 45.6872);
  });

  it('omits geo entirely on a lot with no coordinates', () => {
    const ld = autoDealerLd({ ...ROOFTOP, latitude: null, longitude: null }, opts);
    assert.equal('geo' in ld, false);
  });

  /*
   * Absent means "not stated". An empty array is a claim that the lot is never
   * open, which is worse than saying nothing.
   */
  it('omits openingHoursSpecification when hours are unset or unreadable', () => {
    assert.equal('openingHoursSpecification' in autoDealerLd({ ...ROOFTOP, hours: null }, opts), false);
    assert.equal('openingHoursSpecification' in autoDealerLd({ ...ROOFTOP, hours: 'Mon-Fri 9-6' }, opts), false);
    assert.equal('openingHoursSpecification' in autoDealerLd({ ...ROOFTOP, hours: [] }, opts), false);
  });

  it('makes the logo absolute — a relative image URL is dropped by consumers', () => {
    const ld = autoDealerLd(ROOFTOP, opts);
    assert.equal(ld.image, 'https://cascademotorswa.com/api/logo/abc');
  });
});

describe('storefrontLd', () => {
  it('emits one Organization and one AutoDealer per lot', () => {
    const two = [ROOFTOP, { ...ROOFTOP, id: 'r2', slug: 'fourth-plain', name: 'Fourth Plain' }];
    const graph = storefrontLd(STOREFRONT, two, {
      origin: 'https://cascademotorswa.com',
      basePath: '',
      logoUrl: null,
    })['@graph'] as Record<string, unknown>[];
    assert.equal(graph.length, 3);
    assert.equal(graph[0]!['@type'], 'Organization');
    assert.equal(graph.filter((n) => n['@type'] === 'AutoDealer').length, 2);
  });

  it('points every lot at the one Organization node', () => {
    const graph = storefrontLd(STOREFRONT, [ROOFTOP], {
      origin: 'https://cascademotorswa.com',
      basePath: '',
      logoUrl: null,
    })['@graph'] as Record<string, Record<string, unknown>>[];
    const orgId = graph[0]!['@id'];
    assert.equal(graph[1]!.parentOrganization!['@id'], orgId);
  });

  it('keeps the /s/ prefix out of nothing and in everything on the shared host', () => {
    const graph = storefrontLd(STOREFRONT, [ROOFTOP], {
      origin: 'https://app.rooftopauto.com',
      basePath: '/s/cascade',
      logoUrl: null,
    })['@graph'] as Record<string, unknown>[];
    assert.equal(graph[0]!['@id'], 'https://app.rooftopauto.com/s/cascade#org');
    assert.equal(graph[1]!['@id'], 'https://app.rooftopauto.com/s/cascade/visit/orchards');
  });
});

describe('vehicleLd', () => {
  const V = {
    vin: '1FTFW1ET5DFA12345',
    year: 2018,
    make: 'Ford',
    model: 'F-150',
    trim: 'XLT SuperCrew 4x4',
    mileage: 96410,
    price: 28450,
    salePrice: null,
    exteriorColor: 'Oxford White',
    interiorColor: 'Medium Earth Gray',
    bodyStyle: 'TRUCK',
    fuelType: 'GAS',
    transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WD',
    engine: '5.0L Coyote V8',
    doors: 4,
    description: 'One owner.',
    status: 'FRONT_LINE_READY',
    stockNumber: 'A12345',
    photos: [{ url: '/api/photo/1' }, { url: 'https://cdn.example.com/2.jpg' }],
    rooftopId: 'r1',
  };
  const opts = {
    origin: 'https://cascademotorswa.com',
    url: 'https://cascademotorswa.com/a12345',
    sellerId: 'https://cascademotorswa.com/visit/orchards',
    brandName: 'Cascade Motors',
  };

  /*
   * `mileageFromOdometer` as a bare number is accepted and then read as
   * KILOMETRES by some consumers — a 96,410-mile truck listed as a 60,000-mile
   * one. SMI is UN/CEFACT for the statute mile.
   */
  it('states mileage with a unit code, not as a bare number', () => {
    const ld = vehicleLd(V, opts) as Record<string, Record<string, unknown>>;
    assert.equal(ld.mileageFromOdometer!['@type'], 'QuantitativeValue');
    assert.equal(ld.mileageFromOdometer!.value, 96410);
    assert.equal(ld.mileageFromOdometer!.unitCode, 'SMI');
  });

  it('offers the sale price when there is one', () => {
    const ld = vehicleLd({ ...V, salePrice: 26900 }, opts) as Record<string, Record<string, unknown>>;
    assert.equal(ld.offers!.price, 26900);
    assert.equal(ld.offers!.priceCurrency, 'USD');
    assert.equal(ld.offers!.itemCondition, 'https://schema.org/UsedCondition');
  });

  /* A deposit is not a sale. SoldOut would drop a car that can still come back. */
  it('marks a deposit-taken unit LimitedAvailability, not SoldOut', () => {
    const live = vehicleLd(V, opts) as Record<string, Record<string, unknown>>;
    const pending = vehicleLd({ ...V, status: 'PENDING_SALE' }, opts) as Record<string, Record<string, unknown>>;
    assert.equal(live.offers!.availability, 'https://schema.org/InStock');
    assert.equal(pending.offers!.availability, 'https://schema.org/LimitedAvailability');
  });

  it('points seller at the dealer node by @id rather than repeating the address', () => {
    const ld = vehicleLd(V, opts) as Record<string, Record<string, unknown>>;
    assert.deepEqual(ld.offers!.seller, { '@id': opts.sellerId });
  });

  it('absolutises our photo paths and leaves a CDN URL alone', () => {
    const ld = vehicleLd(V, opts) as Record<string, string[]>;
    assert.deepEqual(ld.image, [
      'https://cascademotorswa.com/api/photo/1',
      'https://cdn.example.com/2.jpg',
    ]);
  });

  it('caps the image list — a 27-photo unit is not 27 images of structured data', () => {
    const many = { ...V, photos: Array.from({ length: 27 }, (_, i) => ({ url: `/p/${i}` })) };
    assert.equal((vehicleLd(many, opts) as Record<string, string[]>).image!.length, 8);
  });
});

describe('firstParagraph / paragraphs', () => {
  it('takes only the opening paragraph', () => {
    assert.equal(firstParagraph('One.\n\nTwo.'), 'One.');
  });

  /*
   * An imported description can carry a 139-item factory spec dump. It must not
   * go whole into a `description` property, and it must not stop mid-word.
   */
  it('cuts long text at a sentence boundary', () => {
    const long = 'A'.repeat(200) + '. ' + 'B'.repeat(400) + '.';
    const out = firstParagraph(long, 300);
    assert.ok(out.length <= 301, `got ${out.length}`);
    assert.ok(out.endsWith('.'), out.slice(-20));
  });

  /*
   * A sentence boundary in the first 40% is not worth cutting to — it would
   * return a 120-character snippet out of a 500-character paragraph and read as
   * truncated rather than summarised. Ellipsis is the better answer there.
   */
  it('ignores a sentence boundary too early to be a useful summary', () => {
    const out = firstParagraph('A'.repeat(120) + '. ' + 'B'.repeat(400) + '.', 300);
    assert.equal(out.endsWith('…'), true);
    assert.ok(out.length > 200, `got ${out.length}`);
  });

  it('never cuts mid-word when there is no sentence boundary to use', () => {
    const out = firstParagraph('word '.repeat(200), 300);
    assert.equal(out.endsWith('…'), true);
    assert.equal(/\bwor…$/.test(out), false);
  });

  it('splits paragraphs on blank lines and drops the empties', () => {
    assert.deepEqual(paragraphs('One.\n\n\n  Two.  \n\n'), ['One.', 'Two.']);
  });
});

describe('paths', () => {
  it('builds the visit path under whatever base the storefront is on', () => {
    assert.equal(visitPath('', ROOFTOP), '/visit/orchards');
    assert.equal(visitPath('/s/cascade', ROOFTOP), '/s/cascade/visit/orchards');
  });

  it('formats the one-line address the same way everywhere', () => {
    assert.equal(fullAddress(ROOFTOP), '8215 NE Highway 99, Vancouver, WA 98665');
  });
});
