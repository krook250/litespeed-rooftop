import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { leadSpamReason } from './lead-spam';

const base = { honeypot: '', name: 'Philip Perkins', message: 'Is stock #204158 still available?', elapsedMs: 20_000 };

describe('leadSpamReason', () => {
  it('lets a normal shopper through', () => {
    assert.equal(leadSpamReason(base), null);
  });
  it('catches the honeypot', () => {
    assert.equal(leadSpamReason({ ...base, honeypot: 'Acme' }), 'honeypot');
  });
  it('catches a form filled in under three seconds', () => {
    assert.equal(leadSpamReason({ ...base, elapsedMs: 800 }), 'too-fast');
  });
  it('ignores timing when it is unknown', () => {
    assert.equal(leadSpamReason({ ...base, elapsedMs: null }), null);
  });
  it('catches a link in the message', () => {
    assert.equal(
      leadSpamReason({ ...base, message: 'Details : https://licscript.com/en/products/ls-auto-marketing' }),
      'link',
    );
    assert.equal(leadSpamReason({ ...base, message: 'see www.example.com' }), 'link');
  });
  it('does not flag a price or a decimal as a link', () => {
    assert.equal(leadSpamReason({ ...base, message: 'Would you take $24.5k? 4.8L engine?' }), null);
  });
});
