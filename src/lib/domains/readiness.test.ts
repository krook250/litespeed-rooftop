/**
 * The cutover gate.
 *
 * What these tests actually protect is a product decision, not an algorithm: a
 * dealer must not be able to point their real business domain at an empty,
 * unbranded storefront *by accident*, and must always be able to do it on
 * purpose. Both halves matter — a gate with no override is a trap, and an
 * override that is the default is not a gate.
 *
 * Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildReadiness, readinessSummary, type ReadinessInput } from './readiness';
import { ROOFTOP_ACCENT, ROOFTOP_BRAND } from '@/lib/branding/palette';

/** A storefront that has done nothing: default palette, no logo, empty lot. */
const BARE: ReadinessInput = {
  logoKey: null,
  brandColor: ROOFTOP_BRAND,
  accentColor: ROOFTOP_ACCENT,
  publicUnitCount: 0,
  caaBlocks: false,
  domainRegistered: true,
  mx: [],
};

const READY: ReadinessInput = {
  logoKey: 'abc123',
  brandColor: '#8B1E2D',
  accentColor: '#C9A227',
  publicUnitCount: 12,
  caaBlocks: false,
  domainRegistered: true,
  mx: ['aspmx.l.google.com'],
};

describe('cutover readiness', () => {
  it('blocks a brand-new storefront', () => {
    const r = buildReadiness(BARE);
    assert.equal(r.ready, false);
    const ids = r.blockers.map((b) => b.id).sort();
    assert.deepEqual(ids, ['design', 'inventory']);
  });

  it('passes a finished storefront', () => {
    const r = buildReadiness(READY);
    assert.equal(r.ready, true);
    assert.deepEqual(r.blockers, []);
  });

  it('accepts a logo alone as branding, without custom colors', () => {
    // A dealer whose logo is blue and who genuinely wants Rooftop blue must not
    // be held at the gate for ever. Either signal counts.
    const r = buildReadiness({ ...READY, brandColor: ROOFTOP_BRAND, accentColor: ROOFTOP_ACCENT });
    assert.equal(r.ready, true);
  });

  it('accepts custom colors alone, without a logo', () => {
    const r = buildReadiness({ ...READY, logoKey: null });
    assert.equal(r.ready, true);
  });

  it('blocks a domain nobody has registered', () => {
    // Found in the first live render: an unregistered domain produced an
    // all-green checklist and an enabled button, directly above a panel saying
    // nobody owns it.
    const r = buildReadiness({ ...READY, domainRegistered: false });
    assert.equal(r.ready, false);
    assert.deepEqual(r.blockers.map((b) => b.id), ['registered']);
  });

  it('describes branding honestly when only colors are set', () => {
    const help = buildReadiness({ ...READY, logoKey: null }).items.find((i) => i.id === 'design')!.help;
    assert.ok(!/logo and colors are set/.test(help), help);
    assert.ok(/No logo yet/.test(help), help);
  });

  it('describes branding honestly when only a logo is set', () => {
    const help = buildReadiness({
      ...READY,
      brandColor: ROOFTOP_BRAND,
      accentColor: ROOFTOP_ACCENT,
    }).items.find((i) => i.id === 'design')!.help;
    assert.ok(!/logo and colors are set/.test(help), help);
    assert.ok(/Rooftop defaults/.test(help), help);
  });

  it('blocks on a CAA record that stops the certificate', () => {
    // This is the one gate that is ours rather than theirs: cutting over here
    // produces a browser security warning on the dealer's own domain.
    const r = buildReadiness({ ...READY, caaBlocks: true });
    assert.equal(r.ready, false);
    assert.deepEqual(r.blockers.map((b) => b.id), ['certificate']);
  });

  it('never blocks on email, with or without MX records', () => {
    // The email item exists to be read, not passed. A dealer running mail on a
    // different domain has no MX here and is not broken.
    for (const mx of [[], ['aspmx.l.google.com']]) {
      const r = buildReadiness({ ...READY, mx });
      assert.equal(r.ready, true);
      const email = r.items.find((i) => i.id === 'email')!;
      assert.equal(email.gating, false);
      assert.equal(email.done, true);
    }
  });

  it('always surfaces the email item, so the dealer sees their mail is untouched', () => {
    for (const input of [BARE, READY]) {
      assert.ok(buildReadiness(input).items.some((i) => i.id === 'email'));
    }
  });

  it('does not gate on layout', () => {
    // `storefronts.layout` is NOT NULL DEFAULT 'CLASSIC', so a layout check would
    // be green for everybody and teach the dealer to skim the list.
    assert.equal(buildReadiness(BARE).items.some((i) => i.id === ('layout' as never)), false);
  });

  it('one outstanding item reads as a sentence, not a list', () => {
    const r = buildReadiness({ ...READY, publicUnitCount: 0 });
    assert.equal(readinessSummary(r), 'Before you point your domain: there are cars to look at.');
  });

  it('joins several outstanding items with an "and"', () => {
    const s = readinessSummary(buildReadiness(BARE));
    assert.ok(s.includes(' and '), s);
    assert.ok(!s.includes(', and'), 'no Oxford comma in dealer-facing copy');
  });

  it('says something positive when everything is done', () => {
    assert.equal(readinessSummary(buildReadiness(READY)), 'Your storefront is ready for its own address.');
  });

  it('every failing gate leaves the dealer an instruction', () => {
    // A checklist item that says "not done" and nothing else is a dead end.
    for (const item of buildReadiness(BARE).items) {
      if (!item.done) assert.ok(item.help.length > 40, `${item.id} needs an actionable help line`);
    }
  });
});
