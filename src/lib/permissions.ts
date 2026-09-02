import type { UserRole } from '@/db/schema';

/**
 * Who can open what.
 *
 * **This file is the whole authorization model, and it is meant to be edited.**
 * The matrix below is a starting position taken off how an independent lot is
 * actually staffed — it is not a claim that these are the right lines forever.
 * Adding a section or moving a role is a one-line change here and nowhere else,
 * which is the point.
 *
 * Two rules that must not drift apart:
 *
 *  1. The sidebar renders from `sectionsFor()`, so a role never sees a link it
 *     cannot open.
 *  2. Every admin route calls `requireSection()` in `src/lib/auth-guard.ts`.
 *
 * Rule 1 without rule 2 is not access control — it is a hidden link and a URL
 * anyone can type. Rule 2 without rule 1 is a menu full of doors that slam. A
 * new section needs both, and the test in `permissions.test.ts` fails if a
 * section is missing from this table.
 */

export const SECTIONS = [
  'feed',
  'dashboard',
  'inventory',
  'at-risk',
  'syndication',
  'ad-desk',
  'website',
  'lots',
  'reporting',
  'settings',
] as const;

export type Section = (typeof SECTIONS)[number];

/**
 * The reasoning, so the next person changing this knows what they are undoing:
 *
 *  - **feed** is everyone. It is the shift board; a store where half the staff
 *    cannot see what moved has no reason to run it.
 *  - **inventory** is everyone too, and deliberately so — reception is asked
 *    "do you still have the blue truck" twenty times a day, and parts and
 *    service need to look a unit up by stock number. What they should *not* see
 *    is cost and gross, which is a column-level question, not a page-level one.
 *    See the note at the bottom of this file.
 *  - **dashboard, reporting, at-risk** are the money screens: owner and the
 *    sales desk.
 *  - **ad-desk and website** are marketing spend and marketing surface. David's
 *    line: "their sales reps won't need access to ad center, or website."
 *  - **syndication** is where a unit goes dark on a channel. Marketing owns the
 *    channels, the sales desk needs to know when a car is not listed anywhere.
 *  - **lots** is rooftop administration, plus the porter, who moves the cars
 *    between them.
 *  - **settings** is the owner alone until there is a reason for otherwise. It
 *    is where billing and user roles live, and a sales manager who can promote
 *    themselves is not a permission system.
 */
const MATRIX: Record<Section, readonly UserRole[]> = {
  feed: ['OWNER', 'SALES_MANAGER', 'SALES', 'RECEPTION', 'PARTS', 'SERVICE', 'MARKETING', 'LOT_PORTER'],
  inventory: ['OWNER', 'SALES_MANAGER', 'SALES', 'RECEPTION', 'PARTS', 'SERVICE', 'MARKETING', 'LOT_PORTER'],
  dashboard: ['OWNER', 'SALES_MANAGER'],
  'at-risk': ['OWNER', 'SALES_MANAGER'],
  reporting: ['OWNER', 'SALES_MANAGER', 'MARKETING'],
  syndication: ['OWNER', 'SALES_MANAGER', 'MARKETING'],
  'ad-desk': ['OWNER', 'MARKETING'],
  website: ['OWNER', 'MARKETING'],
  lots: ['OWNER', 'SALES_MANAGER', 'LOT_PORTER'],
  settings: ['OWNER'],
};

export function can(role: UserRole, section: Section): boolean {
  return MATRIX[section].includes(role);
}

/** Every section this role may open, in the order `SECTIONS` declares. */
export function sectionsFor(role: UserRole): Section[] {
  return SECTIONS.filter((s) => can(role, s));
}

export const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'Owner',
  SALES_MANAGER: 'Sales manager',
  SALES: 'Sales',
  RECEPTION: 'Reception',
  PARTS: 'Parts',
  SERVICE: 'Service',
  MARKETING: 'Marketing',
  LOT_PORTER: 'Lot porter',
};

/** One line each, for the role picker on the users screen. */
export const ROLE_BLURB: Record<UserRole, string> = {
  OWNER: 'Everything, including billing and who works here.',
  SALES_MANAGER: 'Every screen except settings — the desk view.',
  SALES: 'The feed and the inventory. No spend, no reporting.',
  RECEPTION: 'The feed and the inventory, to answer the phone.',
  PARTS: 'The feed and the inventory, to look a unit up.',
  SERVICE: 'The feed and the inventory, to look a unit up.',
  MARKETING: 'Channels, the ad desk, the website and reporting.',
  LOT_PORTER: 'The feed, the inventory and the lots.',
};

/**
 * OPEN QUESTION — money is still page-level, not column-level.
 *
 * Reception can open the inventory list, and that list has cost, pack and front
 * gross on it. At most stores the sales floor is not supposed to see cost. The
 * fix is not another section: it is a `canSeeMoney(role)` check applied to
 * columns and to the stat strips.
 *
 * It is not built yet because of where the numbers live. Feed cards carry their
 * figures in `feed_events.stats`, written at emit time and stored as JSON — so
 * hiding gross from a rep means filtering stats at read time in `getFeed`, and
 * deciding whether a card whose only figure was gross should render at all or
 * disappear. That is a real design decision, not a flag, and it deserves its
 * own pass. Until then, assume anyone who can open a screen can see the money
 * on it, and staff the roles accordingly.
 */
