import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifySource, isBot } from '@/lib/analytics/source';

const c = (referrer: string | null, search = '', ownHost = 'malabartruckandtrade.com') =>
  classifySource({ referrer, search, ownHost }).source;

describe('classifySource', () => {
  it('a Google ad click is an ad, not search, even with google.com as referrer', () => {
    assert.equal(c('https://www.google.com/', '?gclid=abc'), 'google_ads');
  });
  it('organic Google is search', () => {
    assert.equal(c('https://www.google.com/'), 'search');
  });
  it('Facebook by referrer, by fbclid, and by the l.facebook link shim', () => {
    assert.equal(c('https://l.facebook.com/'), 'facebook');
    assert.equal(c(null, '?fbclid=x'), 'facebook');
    assert.equal(c('https://m.facebook.com/marketplace/item/1'), 'facebook');
    assert.equal(c('https://l.instagram.com/'), 'facebook');
  });
  it('marketplaces', () => {
    assert.equal(c('https://www.cargurus.com/Cars/x'), 'marketplace');
    assert.equal(c('https://www.cars.com/'), 'marketplace');
  });
  it('no referrer is direct; own host is internal', () => {
    assert.equal(c(null), 'direct');
    assert.equal(c('https://malabartruckandtrade.com/inventory'), 'internal');
    assert.equal(c('https://app.rooftopauto.com/s/malabar'), 'internal');
  });
  it('anything else is other', () => {
    assert.equal(c('https://example.org/'), 'other');
  });
});

describe('isBot', () => {
  it('drops crawlers and empty agents, keeps a phone', () => {
    assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
    assert.equal(isBot('facebookexternalhit/1.1'), true);
    assert.equal(isBot(''), true);
    assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'), false);
  });
});
