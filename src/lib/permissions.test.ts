import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { userRoleEnum } from '@/db/schema';
import { SECTIONS, can, sectionsFor, ROLE_LABEL, ROLE_BLURB, type Section } from '@/lib/permissions';

/**
 * The permission table is the whole authorization model, so what is worth
 * testing is not any particular line of it — David will move those — but the
 * invariants that make it safe to move them.
 */
describe('permissions', () => {
  const ROLES = userRoleEnum.enumValues;

  it('every role is spelled out in the table, the labels and the blurbs', () => {
    // A role missing from MATRIX would read `undefined.includes` and throw at
    // request time; one missing from ROLE_LABEL renders a raw enum value at a
    // dealer. Both are the kind of thing a new role slips through on.
    for (const r of ROLES) {
      for (const s of SECTIONS) assert.equal(typeof can(r, s), 'boolean', `${r} × ${s}`);
      assert.ok(ROLE_LABEL[r], `${r} has no label`);
      assert.ok(ROLE_BLURB[r], `${r} has no blurb`);
    }
  });

  it('every role can open something, and that something includes the feed', () => {
    // `requireSection` redirects a refused user to the first section they can
    // open. A role with an empty list would redirect to /admin/feed and be
    // refused there too — a loop, on the screen a locked-out person lands on.
    for (const r of ROLES) {
      const open = sectionsFor(r);
      assert.ok(open.length > 0, `${r} can open nothing`);
      assert.ok(open.includes('feed'), `${r} cannot open the feed`);
    }
  });

  it('the owner can open every section', () => {
    for (const s of SECTIONS) assert.ok(can('OWNER', s), `owner locked out of ${s}`);
  });

  it('settings is not reachable by anyone who could then promote themselves', () => {
    // The role picker lives behind `settings`. Anyone who can open it can hand
    // themselves every other section, so this list is the real security
    // boundary and widening it is a decision, not a tweak.
    const holders = ROLES.filter((r) => can(r, 'settings'));
    assert.deepEqual(holders, ['OWNER']);
  });

  it('the sales floor cannot reach marketing spend', () => {
    // The line David actually asked for, kept as a test so a future widening of
    // the matrix has to be deliberate.
    for (const s of ['ad-desk', 'website'] as Section[]) {
      assert.equal(can('SALES', s), false, `sales reached ${s}`);
      assert.equal(can('RECEPTION', s), false, `reception reached ${s}`);
    }
  });

  it('sectionsFor is ordered by the nav, not by the matrix', () => {
    const open = sectionsFor('SALES_MANAGER');
    const positions = open.map((s) => SECTIONS.indexOf(s));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });
});
