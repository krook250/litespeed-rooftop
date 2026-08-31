/**
 * About-writer tests.
 *
 * Two things are worth testing here. `parseFacts` guards a `jsonb` column, so it
 * is tested with the junk a column can actually hold. `draftAbout` is copy that
 * goes on a dealer's website under their name — so it is tested for the way
 * generated prose goes wrong: doubled conjunctions, orphaned sentences, and
 * claims nobody made.
 *
 * No database, no network. Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_FACTS,
  draftAbout,
  factsAreEmpty,
  factsForPrompt,
  joinList,
  parseFacts,
  sanitiseDraft,
  writerPrompt,
  type AboutContext,
  type AboutFacts,
} from './about';

const CTX: AboutContext = {
  dealerName: 'Cascade Motors',
  city: 'Vancouver',
  state: 'WA',
  rooftopCount: 1,
};

const FULL: AboutFacts = {
  since: 2011,
  stock: ['TRUCKS', 'SUVS'],
  points: ['FAMILY', 'NO_HAGGLE', 'INSPECTED', 'RECON_IN_HOUSE', 'TRADES', 'SPANISH'],
  serves: ['Vancouver', 'Camas', 'Ridgefield'],
  ownWords: 'My dad opened this lot in a gravel yard.',
};

describe('parseFacts', () => {
  it('reads a well-formed object', () => {
    const f = parseFacts(FULL);
    assert.equal(f.since, 2011);
    assert.deepEqual(f.stock, ['TRUCKS', 'SUVS']);
    assert.deepEqual(f.serves, ['Vancouver', 'Camas', 'Ridgefield']);
  });

  it('returns empty facts for anything that is not an object', () => {
    for (const junk of [null, undefined, 'text', 42, [], [1, 2]]) {
      assert.deepEqual(parseFacts(junk), EMPTY_FACTS);
    }
  });

  /*
   * A chip value removed in a later build must not crash the screen a dealer
   * opened to fix something else. Losing one chip beats losing the interview.
   */
  it('drops unknown chip values instead of rejecting the whole record', () => {
    const f = parseFacts({ ...FULL, stock: ['TRUCKS', 'HOVERCRAFT'], points: ['FAMILY', 'FREE_PONY'] });
    assert.deepEqual(f.stock, ['TRUCKS']);
    assert.deepEqual(f.points, ['FAMILY']);
    assert.equal(f.since, 2011, 'the rest of the record survives');
  });

  it('refuses a year that is not a plausible year', () => {
    for (const bad of ['2011', 1799, 3000, NaN, null]) {
      assert.equal(parseFacts({ ...FULL, since: bad }).since, null, String(bad));
    }
    assert.equal(parseFacts({ ...FULL, since: new Date().getFullYear() }).since, new Date().getFullYear());
  });

  it('dedupes and caps the towns list', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Town ${i}`);
    assert.equal(parseFacts({ serves: [...many, 'Town 0'] }).serves.length, 12);
  });

  it('trims whitespace-only entries out rather than emitting blanks', () => {
    assert.deepEqual(parseFacts({ serves: ['  Camas ', '   ', ''] }).serves, ['Camas']);
  });
});

describe('factsAreEmpty', () => {
  it('is true only when nothing at all was answered', () => {
    assert.equal(factsAreEmpty(EMPTY_FACTS), true);
    assert.equal(factsAreEmpty({ ...EMPTY_FACTS, serves: ['Camas'] }), false);
    assert.equal(factsAreEmpty({ ...EMPTY_FACTS, ownWords: 'hi' }), false);
  });
});

describe('joinList', () => {
  it('joins the ordinary cases', () => {
    assert.equal(joinList(['a']), 'a');
    assert.equal(joinList(['a', 'b']), 'a and b');
    assert.equal(joinList(['a', 'b', 'c']), 'a, b and c');
    assert.equal(joinList([]), '');
  });

  /*
   * The regression, from the first real draft: "sells trucks and 4x4s and family
   * SUVs". An item carrying its own "and" doubles the conjunction.
   */
  it('does not double the conjunction when an item contains "and"', () => {
    const out = joinList(['trucks and 4x4s', 'family SUVs']);
    assert.equal(out, 'trucks and 4x4s, family SUVs');
    assert.equal(/and .* and /.test(out), false);
  });
});

describe('draftAbout', () => {
  it('opens with who they are, what they sell and where', () => {
    const text = draftAbout(FULL, CTX);
    assert.match(text, /^Cascade Motors sells .* in Vancouver, WA since 2011\./);
  });

  it('never doubles a conjunction anywhere in the copy', () => {
    assert.equal(/\band\b[^.]*\band\b[^.]*\band\b/.test(draftAbout(FULL, CTX)), false);
  });

  /* The dealer's own sentence is theirs. It is carried through verbatim. */
  it('keeps the dealer’s own words exactly', () => {
    assert.ok(draftAbout(FULL, CTX).includes(FULL.ownWords));
  });

  /*
   * The whole risk of generated copy: a claim the dealer never made, printed on
   * their site under their name.
   */
  it('claims nothing that was not ticked', () => {
    const text = draftAbout({ ...EMPTY_FACTS, stock: ['COMMUTERS'] }, CTX).toLowerCase();
    for (const claim of ['warranty', 'financ', 'family owned', 'español', 'inspected', 'since']) {
      assert.equal(text.includes(claim), false, `leaked: ${claim}`);
    }
  });

  it('does not date the business when the year was left blank', () => {
    assert.equal(draftAbout({ ...FULL, since: null }, CTX).includes('since'), false);
  });

  it('says something usable even with nothing answered at all', () => {
    const text = draftAbout(EMPTY_FACTS, CTX);
    assert.ok(text.length > 60);
    assert.ok(text.includes('Cascade Motors'));
    assert.ok(text.includes('Vancouver'));
  });

  /* "Trade-ins are welcome." standing alone reads like a line that lost its
     neighbours — it joins the paragraph above instead. */
  it('does not leave a single clause as its own paragraph', () => {
    const text = draftAbout({ ...EMPTY_FACTS, points: ['FAMILY', 'TRADES'] }, CTX);
    const shortParas = text.split('\n\n').filter((p) => p.split(/[.!?]/).filter(Boolean).length === 1);
    assert.equal(shortParas.some((p) => p.startsWith('Trade-ins')), false, text);
  });

  it('mentions both lots when the storefront covers two', () => {
    const text = draftAbout(FULL, { ...CTX, rooftopCount: 2 });
    assert.ok(text.includes('both of our lots'));
  });

  it('renders as paragraphs separated by blank lines, with no markup', () => {
    const text = draftAbout(FULL, CTX);
    assert.ok(text.split('\n\n').length >= 3);
    assert.equal(/[*_#`<>]/.test(text), false, 'no markup in generated copy');
  });
});

describe('writerPrompt / factsForPrompt', () => {
  /* The prompt is the only thing standing between the model and an invented
     award. If the rule ever gets edited away, this fails. */
  it('tells the model in the first rule not to invent anything', () => {
    const p = writerPrompt(CTX);
    assert.match(p, /1\. Use ONLY the facts given/);
    assert.match(p, /Never invent/);
  });

  it('bans the phrases that make copy read as generated', () => {
    const p = writerPrompt(CTX).toLowerCase();
    for (const banned of ['premier', 'state-of-the-art', 'we pride ourselves', 'nestled in the heart']) {
      assert.ok(p.includes(banned), `should ban: ${banned}`);
    }
  });

  it('sends only the answers that exist, so a blank is visibly blank', () => {
    const only = factsForPrompt({ ...EMPTY_FACTS, since: 2011 });
    assert.equal(only, 'Selling here since: 2011');
    assert.equal(factsForPrompt(EMPTY_FACTS), 'No facts supplied.');
  });

  it('sends chip labels, not the stored enum values', () => {
    const out = factsForPrompt(FULL);
    assert.ok(out.includes('Trucks & 4x4s'));
    assert.equal(out.includes('TRUCKS'), false);
  });
});

describe('sanitiseDraft', () => {
  it('strips markdown the storefront would render literally', () => {
    const out = sanitiseDraft('## About us\n\n- **Family** owned\n- `Great` prices\n\nCome by and see us today.');
    assert.ok(out);
    assert.equal(/[*#`]/.test(out!), false);
    assert.ok(out!.includes('Family owned'));
  });

  it('rejects output too short or too long to be an About section', () => {
    assert.equal(sanitiseDraft('Nope.'), null);
    assert.equal(sanitiseDraft('x'.repeat(3001)), null);
  });

  it('collapses runs of blank lines to paragraph breaks', () => {
    const out = sanitiseDraft('First paragraph of the about section.\n\n\n\nSecond paragraph here too.');
    assert.equal(out!.includes('\n\n\n'), false);
  });
});
