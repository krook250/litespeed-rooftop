import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_PROFILE_PATTERN, parseGoogleProfileUrl } from './google-profile';

const GOOD = [
  'https://maps.app.goo.gl/AbCdEf123',
  'https://share.google/xYz789',
  'https://g.page/malabar-truck',
  'https://www.google.com/maps/place/Malabar+Truck+and+Trade/@27.99,-80.62,17z',
  'https://maps.google.com/?cid=1234567890',
  'https://g.co/kgs/AbC123',
];
const BAD = [
  'http://maps.app.goo.gl/AbCdEf123',
  'https://maps.app.goo.gl/',
  'https://www.google.com/search?q=malabar',
  'https://facebook.com/malabar',
  'https://evil.com/maps.app.goo.gl/x',
  'not a link',
];

describe('parseGoogleProfileUrl', () => {
  it('accepts the links Google hands out', () => {
    for (const u of GOOD) assert.ok(parseGoogleProfileUrl(u), u);
  });
  it('refuses anything else', () => {
    for (const u of BAD) assert.equal(parseGoogleProfileUrl(u), null, u);
  });
  it('trims and drops the fragment', () => {
    assert.equal(parseGoogleProfileUrl('  https://g.page/x#reviews '), 'https://g.page/x');
  });
  it('the input pattern agrees on the good ones', () => {
    const re = new RegExp(`^(?:${GOOGLE_PROFILE_PATTERN})$`);
    for (const u of GOOD) assert.ok(re.test(u), u);
    assert.equal(re.test('https://facebook.com/malabar'), false);
  });
});
