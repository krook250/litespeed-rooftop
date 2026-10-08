import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HOME_DESCRIPTION_MAX, homeDescription, homeHeading, homeTitle, lineup } from './home-meta';

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const place = { city: 'Palm Bay', state: 'FL' };
const many = (b: string, n: number) => Array.from({ length: n }, () => b);

describe('lineup', () => {
  it('leads with what the lot has most of', () => {
    assert.equal(lineup([...many('TRUCK', 20), ...many('SEDAN', 8), ...many('SUV', 5)]), 'Trucks, Cars & SUVs');
  });
  it('folds car bodies together', () => {
    assert.equal(lineup([...many('SEDAN', 3), ...many('COUPE', 3), ...many('SUV', 2)]), 'Cars & SUVs');
  });
  it('drops a group under a tenth of the lot', () => {
    assert.equal(lineup([...many('TRUCK', 20), 'VAN']), 'Trucks');
  });
  it('says RVs for an RV lot', () => {
    assert.equal(lineup([...many('TRAVEL_TRAILER', 9), ...many('FIFTH_WHEEL', 4)]), 'RVs');
  });
  it('falls back on an empty lot', () => {
    assert.equal(lineup([]), 'Cars, Trucks & SUVs');
  });
});

describe('home title and heading', () => {
  it('puts town first, brand last', () => {
    assert.equal(homeTitle('Trucks, Cars & SUVs', place, 'Malabar Truck and Trade'),
      'Used Trucks, Cars & SUVs for Sale in Palm Bay, FL · Malabar Truck and Trade');
    assert.equal(homeHeading('Trucks, Cars & SUVs', place), 'Used Trucks, Cars & SUVs in Palm Bay, FL');
  });
  it('drops the town when there is no lot', () => {
    assert.equal(homeHeading('RVs', null), 'Used RVs');
  });
});

describe('homeDescription', () => {
  it('leads with count and floor price, then the dealer blurb, within 160', () => {
    const d = homeDescription('Trucks & SUVs', place, 'Malabar Truck and Trade', 41, 6995,
      'Family owned since 1998. Financing for everyone, trades welcome, and we will find you the truck you are looking for.', usd);
    assert.ok(d.startsWith('Used Trucks & SUVs for sale at Malabar Truck and Trade in Palm Bay, FL: 41 in stock, from $6,995.'));
    assert.ok(d.length <= HOME_DESCRIPTION_MAX);
  });
  it('says nothing about stock on an empty lot', () => {
    assert.equal(homeDescription('Cars', place, 'X', 0, null, null, usd), 'Used Cars for sale at X in Palm Bay, FL.');
  });
});
