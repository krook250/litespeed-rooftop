import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyPath,
  facetHeading,
  facetLine,
  facetLinks,
  facetPath,
  makePath,
  matchesFacet,
  resolveFacet,
  slugify,
} from './facets';

const lot = [
  { make: 'Chevrolet', model: 'Silverado 1500', bodyStyle: 'TRUCK' },
  { make: 'Chevrolet', model: 'Silverado 1500', bodyStyle: 'TRUCK' },
  { make: 'GMC', model: 'Sierra 2500HD', bodyStyle: 'TRUCK' },
  { make: 'Mercedes-Benz', model: 'C-Class', bodyStyle: 'SEDAN' },
];
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

describe('slugify', () => {
  it('lowercases and dashes', () => {
    assert.equal(slugify('Silverado 1500'), 'silverado-1500');
    assert.equal(slugify('Mercedes-Benz'), 'mercedes-benz');
    assert.equal(slugify('  F-150 '), 'f-150');
  });
});

describe('resolveFacet', () => {
  it('reads a body slug', () => {
    assert.deepEqual(resolveFacet(['trucks'], lot), { kind: 'body', body: 'TRUCK', bodySlug: 'trucks' });
  });
  it('names a make and model from the lot, whatever the case in the URL', () => {
    const f = resolveFacet(['gmc', 'sierra-2500hd'], lot);
    assert.equal(f?.kind, 'make');
    assert.equal(f?.kind === 'make' && f.make, 'GMC');
    assert.equal(f?.kind === 'make' && f.model, 'Sierra 2500HD');
  });
  it('still resolves a make with nothing on the lot, named from the slug', () => {
    const f = resolveFacet(['bmw'], lot);
    assert.equal(f?.kind === 'make' && f.make, 'BMW');
  });
  it('rejects three segments and junk', () => {
    assert.equal(resolveFacet(['a', 'b', 'c'], lot), null);
    assert.equal(resolveFacet([], lot), null);
    assert.equal(resolveFacet(['<script>'], lot), null);
  });
});

describe('matchesFacet / facetPath', () => {
  it('matches by slug, so DMS casing does not matter', () => {
    const f = resolveFacet(['gmc', 'sierra-2500hd'], lot)!;
    assert.equal(matchesFacet({ make: 'Gmc', model: 'Sierra 2500hd', bodyStyle: 'TRUCK' }, f), true);
    assert.equal(matchesFacet(lot[0]!, f), false);
    assert.equal(facetPath(f), '/used/gmc/sierra-2500hd');
  });
});

describe('paths', () => {
  it('builds make, model and body paths', () => {
    assert.equal(makePath('Chevrolet'), '/used/chevrolet');
    assert.equal(makePath('Chevrolet', 'Silverado 1500'), '/used/chevrolet/silverado-1500');
    assert.equal(bodyPath('TRUCK'), '/used/trucks');
    assert.equal(bodyPath('NOPE'), null);
  });
});

describe('heading and line', () => {
  it('puts the place in the heading', () => {
    const f = resolveFacet(['chevrolet', 'silverado-1500'], lot)!;
    assert.equal(facetHeading(f, { city: 'Malabar', state: 'FL' }), 'Used Chevrolet Silverado 1500 in Malabar, FL');
    assert.equal(facetHeading(resolveFacet(['suvs'], lot)!, null), 'Used SUVs');
  });
  it('says the count and floor price, and is honest at zero', () => {
    assert.equal(facetLine(4, 'Malabar Truck and Trade', 12995, usd), '4 in stock at Malabar Truck and Trade, from $12,995.');
    assert.equal(facetLine(1, 'X', 9000, usd), '1 in stock at X.');
    assert.equal(facetLine(0, 'X', null, usd), 'None in stock at X right now.');
  });
});

describe('facetLinks', () => {
  it('counts every page with a car behind it', () => {
    const l = facetLinks(lot);
    assert.deepEqual(l.makes.map((m) => [m.path, m.count]), [
      ['/used/chevrolet', 2],
      ['/used/gmc', 1],
      ['/used/mercedes-benz', 1],
    ]);
    assert.equal(l.models.length, 3);
    assert.deepEqual(l.bodies.map((b) => b.path), ['/used/sedans', '/used/trucks']);
  });
});
