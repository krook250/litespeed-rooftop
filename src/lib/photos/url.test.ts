import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extForContentType, isForeignPhotoUrl } from './url';

describe('isForeignPhotoUrl', () => {
  it('claims someone else\'s CDN', () => {
    assert.equal(isForeignPhotoUrl('https://cdn05.carsforsale.com/a/b/c.jpg'), true);
    assert.equal(isForeignPhotoUrl('http://images.dealer.example/x.jpg'), true);
  });

  it('leaves Blob alone — those bytes are already ours', () => {
    assert.equal(
      isForeignPhotoUrl('https://abc123.public.blob.vercel-storage.com/vehicles/v1/deadbeef.jpg'),
      false,
    );
  });

  it('leaves our own domains alone — the demo lot is served from app.rooftopauto.com', () => {
    assert.equal(isForeignPhotoUrl('https://app.rooftopauto.com/demo/veh/g1/3.jpg'), false);
    assert.equal(isForeignPhotoUrl('https://rooftopauto.com/x.jpg'), false);
  });

  it("still claims a dealer's own old website — that site dies too", () => {
    assert.equal(isForeignPhotoUrl('https://malabartruckandtrade.com/photos/1.jpg'), true);
    // Not a subdomain of ours, despite the suffix.
    assert.equal(isForeignPhotoUrl('https://notrooftopauto.com/x.jpg'), true);
  });

  it('leaves generated placeholder tiles alone', () => {
    assert.equal(isForeignPhotoUrl('/api/photo?s=lot&b=truck&c=9ca3af&l=F-150&k=2018'), false);
  });

  it('refuses to treat an unparseable URL as work', () => {
    assert.equal(isForeignPhotoUrl('https://'), false);
    assert.equal(isForeignPhotoUrl(''), false);
  });
});

describe('extForContentType', () => {
  it('maps the three formats every channel accepts', () => {
    assert.equal(extForContentType('image/jpeg'), 'jpg');
    assert.equal(extForContentType('image/png; charset=binary'), 'png');
    assert.equal(extForContentType('IMAGE/WEBP'), 'webp');
  });

  it('returns null rather than guessing', () => {
    assert.equal(extForContentType('image/gif'), null);
    assert.equal(extForContentType('text/html'), null);
    assert.equal(extForContentType(''), null);
  });
});
