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
