/**
 * The About writer: five questions, then copy the dealer can edit.
 *
 * WHY AN INTERVIEW AND NOT A TEXTAREA
 * "Tell buyers about your dealership" in an empty box is the field every dealer
 * skips. It is not that they have nothing to say — they will talk your ear off
 * about the lot — it is that writing three paragraphs about yourself cold is a
 * genuinely hard task and it is sitting between them and a working website. Five
 * questions they can answer without thinking produces the same information, and
 * turning that into prose is our job rather than theirs.
 *
 * WHY THE ANSWERS ARE STORED and not just the finished text: the dealer will
 * come back and change one thing — they added financing, they moved, they want a
 * different tone — and re-answering five questions to change one is the reason
 * they will instead leave it stale. `storefronts.aboutFacts` holds the answers;
 * `storefronts.about` holds the published copy. The two are deliberately
 * independent: **an edit to the text is never overwritten by a regeneration the
 * dealer did not ask for.**
 *
 * This file is pure. The model call lives in `about-writer.ts`, the fallback
 * lives here, and both produce the same shape.
 */

/** The chip lists. Values are stored; labels are what the dealer sees. */
export const STOCK_KINDS = [
  { value: 'TRUCKS', label: 'Trucks & 4x4s' },
  { value: 'SUVS', label: 'Family SUVs' },
  { value: 'COMMUTERS', label: 'Commuter cars' },
  { value: 'WORK', label: 'Work vans & fleet' },
  { value: 'BUDGET', label: 'Budget units under $10k' },
  { value: 'SPECIALTY', label: 'Specialty & performance' },
  { value: 'DIESEL', label: 'Diesel' },
] as const;

/**
 * What the dealer wants said about them.
 *
 * Every one of these is a claim a buyer can check, which is the filter for
 * being on this list at all. "Great customer service" is not here, because
 * every lot says it and no buyer believes any of them.
 */
export const SELLING_POINTS = [
  { value: 'FAMILY', label: 'Family owned' },
  { value: 'NO_HAGGLE', label: 'No-haggle pricing' },
  { value: 'IN_HOUSE_FINANCE', label: 'In-house financing' },
  { value: 'ALL_CREDIT', label: 'We work with all credit' },
  { value: 'INSPECTED', label: 'Every unit inspected' },
  { value: 'WARRANTY', label: 'Warranty available' },
  { value: 'TRADES', label: 'Trade-ins welcome' },
  { value: 'RECON_IN_HOUSE', label: 'We do our own recon' },
  { value: 'SERVICE', label: 'On-site service shop' },
  { value: 'SPANISH', label: 'Se habla español' },
  { value: 'DELIVERY', label: 'We deliver' },
] as const;

export type StockKind = (typeof STOCK_KINDS)[number]['value'];
export type SellingPoint = (typeof SELLING_POINTS)[number]['value'];

export type AboutFacts = {
  /** Four-digit year, or null when they would rather not date the business. */
  since: number | null;
  stock: StockKind[];
  points: SellingPoint[];
  /** Towns and cities, as typed. Prefilled with the lot's own city. */
  serves: string[];
  /** Anything in the dealer's own words. The part that makes it theirs. */
  ownWords: string;
};

export const EMPTY_FACTS: AboutFacts = {
  since: null, stock: [], points: [], serves: [], ownWords: '',
};

const STOCK_VALUES = new Set(STOCK_KINDS.map((s) => s.value as string));
const POINT_VALUES = new Set(SELLING_POINTS.map((s) => s.value as string));

/**
 * Coerce whatever is in the jsonb column into a usable shape.
 *
 * Same discipline as `isWeekHours`: `jsonb` guarantees JSON and nothing more, and
 * an unknown chip value from an older build must not crash the screen a dealer
 * opened to fix something. Unknown values are dropped, not rejected — losing one
 * chip is better than losing the interview.
 */
export function parseFacts(v: unknown): AboutFacts {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return EMPTY_FACTS;
  const o = v as Record<string, unknown>;
  const strings = (k: string, allowed?: Set<string>): string[] =>
    Array.isArray(o[k])
      ? (o[k] as unknown[])
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
          .filter((x) => !allowed || allowed.has(x))
      : [];

  const yearNow = new Date().getFullYear();
  const since = typeof o.since === 'number' && o.since >= 1900 && o.since <= yearNow
    ? Math.floor(o.since)
    : null;

  return {
    since,
    stock: strings('stock', STOCK_VALUES) as StockKind[],
    points: strings('points', POINT_VALUES) as SellingPoint[],
    serves: [...new Set(strings('serves'))].slice(0, 12),
    ownWords: typeof o.ownWords === 'string' ? o.ownWords.trim().slice(0, 1200) : '',
  };
}

/** Nothing to write about yet. */
export function factsAreEmpty(f: AboutFacts): boolean {
  return !f.since && !f.stock.length && !f.points.length && !f.serves.length && !f.ownWords.trim();
}

/* ------------------------------------------------------------- the writer */

export type AboutContext = {
  dealerName: string;
  city: string;
  state: string;
  /** How many lots the storefront covers. Changes "our lot" to "both our lots". */
  rooftopCount: number;
};

const labelOf = <T extends { value: string; label: string }>(list: readonly T[], v: string) =>
  list.find((x) => x.value === v)?.label ?? v;

/**
 * "a, b and c" — the serial comma stays off; this is ad copy, not a contract.
 *
 * With one exception, found on the first real draft: when an item already
 * contains "and", the final conjunction doubles up — "sells trucks and 4x4s and
 * family SUVs". So a list whose items carry their own "and" is joined with
 * commas throughout, which reads correctly and is the reason this is a function
 * rather than a `.join()` at each call site.
 */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.some((i) => / and /.test(i))) return items.join(', ');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const STOCK_PHRASE: Record<StockKind, string> = {
  TRUCKS: 'trucks and 4x4s',
  SUVS: 'family SUVs',
  COMMUTERS: 'commuter cars',
  WORK: 'work vans and fleet units',
  BUDGET: 'budget units under $10,000',
  SPECIALTY: 'specialty and performance cars',
  DIESEL: 'diesels',
};

/**
 * Deterministic copy from the answers alone. No model, no key, no network.
 *
 * This is the floor, not a placeholder. `ANTHROPIC_API_KEY` is optional in this
 * app — the document reader already treats it that way — and a dealer on a
 * deployment without one still has to be able to finish their website. It is
 * also what runs when the model call times out or the account is out of credit,
 * which is a Tuesday afternoon, not a hypothetical.
 *
 * Deliberately plain. It states what the dealer told us in the order a buyer
 * cares about and stops. Copy that oversells reads worse than copy that is
 * merely clear, and the dealer is about to edit it anyway.
 */
export function draftAbout(facts: AboutFacts, ctx: AboutContext): string {
  const paras: string[] = [];

  const stock = facts.stock.length
    ? joinList(facts.stock.map((s) => STOCK_PHRASE[s]))
    : 'used cars, trucks and SUVs';
  const where = ctx.city && ctx.state ? ` in ${ctx.city}, ${ctx.state}` : '';
  const since = facts.since ? ` since ${facts.since}` : '';

  paras.push(
    `${ctx.dealerName} sells ${stock}${where}${since}.`.replace(/\s+/g, ' '),
  );

  if (facts.ownWords.trim()) paras.push(facts.ownWords.trim());

  const pointSentences: string[] = [];
  const has = (p: SellingPoint) => facts.points.includes(p);

  if (has('FAMILY')) pointSentences.push('We are family owned.');
  if (has('NO_HAGGLE')) pointSentences.push('The price on the window is the price — no haggling and no four-square.');
  if (has('INSPECTED') && has('RECON_IN_HOUSE')) {
    pointSentences.push('Every unit is inspected and reconditioned in our own shop before it hits the front line.');
  } else if (has('INSPECTED')) {
    pointSentences.push('Every unit is inspected before it goes out front.');
  } else if (has('RECON_IN_HOUSE')) {
    pointSentences.push('We do our own reconditioning in house.');
  }
  if (has('WARRANTY')) pointSentences.push('Warranty coverage is available on most units.');
  if (has('SERVICE')) pointSentences.push('We have a service shop on site.');
  const financing: string[] = [];
  if (has('IN_HOUSE_FINANCE')) financing.push('We finance in house');
  if (has('ALL_CREDIT')) financing.push('we work with every credit situation');
  if (has('TRADES')) financing.push('trade-ins are welcome');
  if (has('DELIVERY')) financing.push('and we can deliver');
  const financingSentence = financing.length
    ? capitalise(joinClauses(financing)) + '.'
    : null;

  /* One clause does not earn its own paragraph — "Trade-ins are welcome."
     standing alone reads like a line that lost its neighbours. */
  if (financingSentence && financing.length === 1 && pointSentences.length) {
    pointSentences.push(financingSentence);
    paras.push(pointSentences.join(' '));
  } else {
    if (pointSentences.length) paras.push(pointSentences.join(' '));
    if (financingSentence) paras.push(financingSentence);
  }

  const closing: string[] = [];
  if (facts.serves.length) {
    closing.push(
      `We serve buyers from ${joinList(facts.serves)}${ctx.rooftopCount > 1 ? ' across both of our lots' : ''}.`,
    );
  }
  if (has('SPANISH')) closing.push('Se habla español.');
  closing.push('Come by and take something out for a drive — call ahead and we will have it pulled up front.');
  paras.push(closing.join(' '));

  return paras.join('\n\n');
}

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0]!;
  const last = parts[parts.length - 1]!;
  const head = parts.slice(0, -1).join(', ');
  return last.startsWith('and ') ? `${head}, ${last}` : `${head} and ${last}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What the model is told. Exported so it can be asserted in a test rather than
 * drifting quietly.
 *
 * The rules are all of the form "do not invent", because that is the whole risk.
 * A generated About that claims a warranty the dealer does not offer, or an
 * award nobody won, is a liability printed on the dealer's own website under
 * their name — and it is the kind of thing nobody notices until a customer holds
 * them to it.
 */
export function writerPrompt(ctx: AboutContext): string {
  return [
    'You write the "About" section for a small independent used-car dealership website.',
    '',
    'Rules, in order of importance:',
    '1. Use ONLY the facts given. Never invent a founding year, an award, a number of',
    '   cars sold, a review score, a family name, or a service the dealer did not list.',
    '   If something is not in the facts, it does not appear in the copy.',
    '2. Write the way the dealer talks, not the way a marketing agency writes. Short',
    '   sentences. No "premier", "state-of-the-art", "hassle-free experience", "your',
    '   trusted partner", "nestled in the heart of", or "we pride ourselves".',
    '3. Two or three short paragraphs. Under 180 words total.',
    '4. Mention the city and state once, naturally, in the first paragraph. Do not repeat',
    '   the dealership name more than twice in the whole piece.',
    '5. Plain text only. No markdown, no headings, no bullet points, no emoji.',
    '6. If the dealer wrote something in their own words, keep their phrasing and their',
    '   meaning — tidy the grammar, do not replace their voice with yours.',
    '7. End on an invitation to come by or call. One sentence, not a slogan.',
    '',
    `The dealership is ${ctx.dealerName}, in ${ctx.city}, ${ctx.state}.`,
    ctx.rooftopCount > 1 ? `They operate ${ctx.rooftopCount} lots under this one website.` : '',
  ].filter(Boolean).join('\n');
}

/** The facts, as the model sees them. Plain lines, so an empty answer is visibly empty. */
export function factsForPrompt(facts: AboutFacts): string {
  const lines = [
    facts.since ? `Selling here since: ${facts.since}` : null,
    facts.stock.length ? `Mostly stocks: ${facts.stock.map((s) => labelOf(STOCK_KINDS, s)).join(', ')}` : null,
    facts.points.length ? `True of this dealer: ${facts.points.map((p) => labelOf(SELLING_POINTS, p)).join(', ')}` : null,
    facts.serves.length ? `Serves buyers from: ${facts.serves.join(', ')}` : null,
    facts.ownWords.trim() ? `In the dealer's own words: ${facts.ownWords.trim()}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : 'No facts supplied.';
}

/**
 * Guard the model's output before a dealer ever sees it.
 *
 * Not a content filter — a shape check. Markdown, a heading, or a wall of text
 * means the model ignored the format rules, and the honest response is to fall
 * back to the deterministic draft rather than hand the dealer something they
 * have to un-format. Returns null when the text is unusable.
 */
export function sanitiseDraft(text: string): string | null {
  const t = text.replace(/\r\n/g, '\n').trim();
  if (t.length < 60) return null;
  if (t.length > 3000) return null;
  // Markdown emphasis, headings, list bullets — none of which the storefront renders.
  const stripped = t
    .split('\n')
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, '').replace(/\*\*|__|`/g, ''))
    .join('\n');
  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}
