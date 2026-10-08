import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DESCRIPTION_MAX, clip, vdpDescription, vdpTitle } from './vdp-meta';

const fmt = { miles: (n: number) => `${n.toLocaleString('en-US')} mi`, usd: (n: number) => `$${n.toLocaleString('en-US')}` };
const truck = {
  year: 2008, make: 'Chevrolet', model: 'Silverado 1500', trim: 'LT1 4WD 2dr Regular Cab 6.5 ft. SB',
  mileage: 166164, price: 12999, city: 'Palm Bay', state: 'FL', dealer: 'Malabar Truck and Trade',
  description: 'Lifted, new tires,   clean title. Financing available for everyone — buy here pay here, no credit check, call today for details and to schedule a test drive.',
};

describe('vdpTitle', () => {
  it('leads with what is searched and drops a long trim', () => {
    assert.equal(vdpTitle(truck), 'Used 2008 Chevrolet Silverado 1500 for Sale in Palm Bay, FL');
  });
  it('keeps a short trim', () => {
    assert.equal(vdpTitle({ ...truck, trim: 'LT' }), 'Used 2008 Chevrolet Silverado 1500 LT for Sale in Palm Bay, FL');
  });
  it('never carries the stock number', () => {
    assert.doesNotMatch(vdpTitle(truck), /stock|#/i);
  });
});

describe('vdpDescription', () => {
  it('leads with miles, price and place, then the dealer’s words, within budget', () => {
    const d = vdpDescription(truck, fmt);
    assert.ok(d.startsWith('2008 Chevrolet Silverado 1500 LT1 4WD 2dr Regular Cab 6.5 ft. SB, 166,164 mi, $12,999 at Malabar Truck and Trade in Palm Bay, FL.'));
    assert.ok(d.length <= DESCRIPTION_MAX);
    assert.doesNotMatch(d, /  /);
  });
  it('leaves out a zero price and a missing odometer', () => {
    const d = vdpDescription({ ...truck, trim: null, mileage: null, price: 0, description: null }, fmt);
    assert.equal(d, '2008 Chevrolet Silverado 1500 at Malabar Truck and Trade in Palm Bay, FL.');
  });
});

describe('clip', () => {
  it('cuts on a word and adds an ellipsis', () => {
    assert.equal(clip('one two three four', 12), 'one two…');
    assert.equal(clip('short', 12), 'short');
  });
});
