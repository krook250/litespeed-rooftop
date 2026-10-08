import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { similarToSold } from './sold';

type V = { id: string; make: string; model: string; bodyStyle: string | null; price: number };
const v = (id: string, make: string, model: string, bodyStyle: string | null, price: number): V => ({ id, make, model, bodyStyle, price });

const sold = v('s', 'GMC', 'Sierra 1500', 'TRUCK', 16000);
const lot = [
  v('car', 'Honda', 'Civic', 'SEDAN', 16000),
  v('truckFar', 'Ford', 'F-150', 'TRUCK', 40000),
  v('truckNear', 'Ram', '1500', 'TRUCK', 17000),
  v('sierraFar', 'gmc', 'sierra 1500', 'TRUCK', 35000),
  v('sierraNear', 'GMC', 'Sierra 1500', 'TRUCK', 15000),
  v('s', 'GMC', 'Sierra 1500', 'TRUCK', 16000),
];

describe('similarToSold', () => {
  it('ranks same model, then same body, then the rest, each by price distance', () => {
    const ids = similarToSold(sold, 16000, lot, (x) => x.price).map((x) => x.id);
    assert.deepEqual(ids, ['sierraNear', 'sierraFar', 'truckNear', 'truckFar', 'car']);
  });
  it('never includes the sold car itself, and respects the limit', () => {
    const ids = similarToSold(sold, 16000, lot, (x) => x.price, 2).map((x) => x.id);
    assert.deepEqual(ids, ['sierraNear', 'sierraFar']);
  });
  it('returns nothing on an empty lot', () => {
    assert.deepEqual(similarToSold(sold, 16000, [], (x: V) => x.price), []);
  });
});
