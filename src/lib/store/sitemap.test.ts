import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRobots, buildSitemap, xmlEscape } from './sitemap';

const origin = 'https://malabartruckandtrade.com';
const d = new Date('2026-10-01T12:00:00Z');

describe('buildSitemap', () => {
  const xml = buildSitemap({
    origin,
    lotSlugs: ['malabar'],
    facetPaths: ['/used/gmc', '/used/trucks'],
    vehicles: [
      { stockNumber: 'T491674', updatedAt: d, photos: [{ url: '/api/photo/abc' }, { url: 'https://cdn.x/y.jpg' }, { url: 'junk' }] },
    ],
  });

  it('lists home, lot, loan application and each vehicle at its canonical URL', () => {
    assert.match(xml, /<loc>https:\/\/malabartruckandtrade\.com\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/malabartruckandtrade\.com\/visit\/malabar<\/loc>/);
    assert.match(xml, /<loc>https:\/\/malabartruckandtrade\.com\/loan-application<\/loc>/);
    assert.match(xml, /<loc>https:\/\/malabartruckandtrade\.com\/t491674<\/loc>/);
    assert.match(xml, /<loc>https:\/\/malabartruckandtrade\.com\/used\/gmc<\/loc>/);
    assert.match(xml, /<loc>https:\/\/malabartruckandtrade\.com\/used\/trucks<\/loc>/);
  });

  it('never lists the /s/ path or a filtered SRP', () => {
    assert.doesNotMatch(xml, /\/s\//);
    assert.doesNotMatch(xml, /\?make=/);
  });

  it('makes relative photos absolute and drops ones it cannot', () => {
    assert.match(xml, /<image:loc>https:\/\/malabartruckandtrade\.com\/api\/photo\/abc<\/image:loc>/);
    assert.match(xml, /<image:loc>https:\/\/cdn\.x\/y\.jpg<\/image:loc>/);
    assert.doesNotMatch(xml, /junk/);
  });

  it('dates the home page by the newest vehicle', () => {
    assert.match(xml, /\/<\/loc>\n    <lastmod>2026-10-01T12:00:00\.000Z<\/lastmod>/);
  });
});

describe('xmlEscape', () => {
  it('escapes the five', () => assert.equal(xmlEscape(`a&b<c>"d'`), 'a&amp;b&lt;c&gt;&quot;d&apos;'));
});

describe('buildRobots', () => {
  it('points at the sitemap on a live domain and blocks /s/', () => {
    const r = buildRobots(origin);
    assert.match(r, /Disallow: \/s\//);
    assert.match(r, /Sitemap: https:\/\/malabartruckandtrade\.com\/sitemap\.xml/);
  });
  it('has no sitemap line otherwise', () => assert.doesNotMatch(buildRobots(null), /Sitemap/));
});
