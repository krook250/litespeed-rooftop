import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOnboarding, onboardingSummary, type OnboardingInput } from '@/lib/onboarding';

/**
 * The checklist decides whether a brand-new dealer is told what to do next, and
 * — because there is no dismiss button — when to stop telling them. Both
 * failures are expensive in opposite directions: a card that never clears nags a
 * paying customer, and one that clears early abandons a trial on an empty lot.
 * So what is worth testing is the clearing rule, not the copy.
 */
describe('onboarding', () => {
  const FULL_LOT = {
    addressLine1: '1200 SE Mill Plain Blvd',
    city: 'Vancouver',
    state: 'WA',
    postalCode: '98684',
    phone: '360-555-0142',
  };

  const fresh: OnboardingInput = {
    rooftop: { addressLine1: '', city: '', state: '', postalCode: '', phone: '' },
    logoKey: null,
    defaultPalette: true,
    unitCount: 0,
    unitsWithPhotos: 0,
  };

  const done: OnboardingInput = {
    rooftop: FULL_LOT,
    logoKey: 'logos/abc.png',
    defaultPalette: false,
    unitCount: 21,
    unitsWithPhotos: 21,
  };

  it('a just-provisioned tenant has everything open, and the lot comes first', () => {
    // Exactly the state signup leaves behind: rooftop row exists, every field on
    // it blank. The ordering claim is load-bearing - the address is the cheapest
    // step and the most depended-on, so it must be what the card leads with.
    const o = buildOnboarding(fresh);
    assert.equal(o.complete, false);
    assert.equal(o.next?.id, 'lot');
    assert.equal(o.doneCount, 0);
  });

  it('clears once the three gating steps pass, photos or not', () => {
    // The whole point of photos being non-gating. A dealer who imported 40 units
    // this morning cannot photograph them this afternoon, and the card must not
    // wait for them.
    const o = buildOnboarding({ ...done, unitsWithPhotos: 0 });
    assert.equal(o.complete, true);
    assert.equal(o.steps.find((s) => s.id === 'photos')?.done, false);
  });

  it('is complete when everything is done', () => {
    const o = buildOnboarding(done);
    assert.equal(o.complete, true);
    assert.equal(o.next, null);
    assert.equal(o.doneCount, 4);
  });

  it('a half-filled address does not count as an address', () => {
    // The failure this guards: a dealer types a street and a town, leaves the
    // zip, and the card clears the step - then Meta refuses every unit for want
    // of coordinates and nothing on screen says why.
    for (const missing of ['addressLine1', 'city', 'state', 'postalCode', 'phone'] as const) {
      const o = buildOnboarding({ ...done, rooftop: { ...FULL_LOT, [missing]: '' } });
      assert.equal(o.complete, false, `${missing} empty should hold the checklist open`);
      assert.equal(o.next?.id, 'lot');
    }
  });

  it('whitespace is not an address either', () => {
    const o = buildOnboarding({ ...done, rooftop: { ...FULL_LOT, city: '   ' } });
    assert.equal(o.steps.find((s) => s.id === 'lot')?.done, false);
  });

  it('no rooftop at all reads as not done rather than throwing', () => {
    // Should be impossible after signup. If it ever happens, showing the
    // checklist is the safe direction; a 500 on the home screen is not.
    const o = buildOnboarding({ ...fresh, rooftop: null });
    assert.equal(o.complete, false);
    assert.equal(o.next?.id, 'lot');
  });

  it('either a logo or custom colors counts as branded', () => {
    const logoOnly = buildOnboarding({ ...done, logoKey: 'logos/a.png', defaultPalette: true });
    const colorsOnly = buildOnboarding({ ...done, logoKey: null, defaultPalette: false });
    const neither = buildOnboarding({ ...done, logoKey: null, defaultPalette: true });
    assert.equal(logoOnly.complete, true);
    assert.equal(colorsOnly.complete, true);
    assert.equal(neither.complete, false);
    assert.equal(neither.next?.id, 'design');
  });

  it('the photos line names how many units are actually short', () => {
    const o = buildOnboarding({ ...done, unitCount: 21, unitsWithPhotos: 14 });
    assert.match(o.steps.find((s) => s.id === 'photos')!.help, /7 of your 21 units/);
  });

  it('the summary counts only the steps that hold the card open', () => {
    // Photos is never counted here. A dealer one step from done should be told
    // "one thing left", not "two", or the card is lying about its own rule.
    assert.equal(onboardingSummary(buildOnboarding(fresh)), '3 things to get your lot live');
    assert.equal(
      onboardingSummary(buildOnboarding({ ...done, logoKey: null, defaultPalette: true })),
      'One thing left to get your lot live',
    );
    assert.equal(onboardingSummary(buildOnboarding(done)), 'Your lot is live.');
  });

  it('every step has somewhere to go', () => {
    // A checklist item with no destination is a complaint.
    for (const s of buildOnboarding(fresh).steps) {
      assert.match(s.href, /^\/admin\//, `${s.id} has no destination`);
      assert.ok(s.cta.length > 0, `${s.id} has no button text`);
      assert.ok(s.help.length > 0, `${s.id} has no help text`);
    }
  });
});
