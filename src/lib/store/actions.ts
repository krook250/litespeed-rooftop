'use server';

/**
 * Saving hours and the About section.
 *
 * TENANT SCOPING, same rule as every other write path here: the id arrives on a
 * FormData and is therefore attacker-controlled, so it is resolved through
 * `assertRooftopInScope` / `assertStorefrontInScope` before anything happens.
 * Rooftop slugs are unique across every tenant, which makes "look it up by id
 * and trust it" a way to edit somebody else's lot.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope, assertStorefrontInScope } from '@/lib/scoped-db';
import { isTime, isWeekHours, type DayHours, type WeekHours } from './hours';
import { parseFacts, type AboutContext, type AboutFacts } from './about';
import { writeAbout } from './about-writer';

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ hours */

/**
 * Seven days off a form, as `open-<n>` / `close-<n>` / `closed-<n>`.
 *
 * A day is closed when its checkbox is on **or** either time is blank. That
 * second half matters: a dealer who clears the open time meant to close that
 * day, and saving `{ open: '', close: '17:00' }` would fail validation and lose
 * the whole week's edit over one field.
 */
function readWeek(formData: FormData): WeekHours | null {
  const days: DayHours[] = [];
  for (let i = 0; i < 7; i++) {
    if (formData.get(`closed-${i}`) === 'on') { days.push(null); continue; }
    const open = String(formData.get(`open-${i}`) ?? '').trim();
    const close = String(formData.get(`close-${i}`) ?? '').trim();
    if (!open || !close) { days.push(null); continue; }
    if (!isTime(open) || !isTime(close)) return null;
    if (close <= open) return null;
    days.push({ open, close });
  }
  const week = days as unknown as WeekHours;
  return isWeekHours(week) ? week : null;
}

export async function saveRooftopHours(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const scope = await sessionScope();
  const rooftop = await assertRooftopInScope(scope, rooftopId);
  if (!rooftop) return { ok: false, error: 'Lot not found.' };

  /* An explicit "we have not set hours" is a real answer and must be storable —
     it is what an `openingHoursSpecification` absence is built on. */
  if (formData.get('clear') === 'on') {
    await db.update(t.rooftops).set({ hours: null }).where(eq(t.rooftops.id, rooftopId));
    revalidatePath('/admin/lots');
    revalidatePath('/admin/website');
    return { ok: true, message: 'Hours cleared.' };
  }

  const week = readWeek(formData);
  if (!week) {
    return { ok: false, error: 'Check the times — each open day needs an opening time earlier than its closing time.' };
  }

  await db.update(t.rooftops).set({ hours: week }).where(eq(t.rooftops.id, rooftopId));
  revalidatePath('/admin/lots');
  revalidatePath('/admin/website');
  /* The storefront itself needs no revalidation: every route under `/s` reads
     `headers()` to resolve the host, which makes it dynamic on every request.
     A `revalidatePath('/s', 'layout')` here would look reassuring and do
     nothing — `/s` is not a route. */
  return { ok: true, message: 'Hours saved.' };
}

/* ------------------------------------------------------------------ about */

function readFacts(formData: FormData): AboutFacts {
  const yearRaw = String(formData.get('since') ?? '').trim();
  return parseFacts({
    since: yearRaw ? Number(yearRaw) : null,
    stock: formData.getAll('stock').map(String),
    points: formData.getAll('points').map(String),
    /* Commas and newlines both, because a dealer handed a box of town names will
       use whichever their thumb reaches first. */
    serves: String(formData.get('serves') ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    ownWords: String(formData.get('ownWords') ?? ''),
  });
}

async function contextFor(storefrontId: string, scope: Awaited<ReturnType<typeof sessionScope>>) {
  const sf = await assertStorefrontInScope(scope, storefrontId);
  if (!sf) return null;
  const links = await db
    .select({ rooftopId: t.storefrontRooftops.rooftopId })
    .from(t.storefrontRooftops)
    .where(eq(t.storefrontRooftops.storefrontId, storefrontId));
  const rows = links.length
    ? await db.select().from(t.rooftops).where(eq(t.rooftops.id, links[0]!.rooftopId))
    : [];
  const first = rows[0];
  const ctx: AboutContext = {
    dealerName: sf.name,
    city: first?.city ?? '',
    state: first?.state ?? '',
    rooftopCount: links.length,
  };
  return { sf, ctx };
}

export type DraftResult =
  | { ok: true; text: string; source: 'model' | 'template' }
  | { ok: false; error: string };

/**
 * Write a draft from the answers. **Saves the answers, not the text.**
 *
 * The split is the point. A dealer who has hand-edited three paragraphs and then
 * changes one checkbox must not have their writing replaced by a regeneration
 * they did not ask for — so this returns the draft to the screen and lets them
 * decide. Nothing reaches `storefronts.about` until they press Publish.
 */
export async function draftAboutCopy(_prev: unknown, formData: FormData): Promise<DraftResult> {
  const storefrontId = String(formData.get('storefrontId') ?? '');
  const scope = await sessionScope();
  const found = await contextFor(storefrontId, scope);
  if (!found) return { ok: false, error: 'Storefront not found.' };

  const facts = readFacts(formData);
  await db.update(t.storefronts).set({ aboutFacts: facts }).where(eq(t.storefronts.id, storefrontId));

  const written = await writeAbout(facts, found.ctx);
  revalidatePath('/admin/website');
  return { ok: true, text: written.text, source: written.source };
}

/** Publish whatever is in the box — the dealer's edit is the final word. */
export async function saveAbout(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const storefrontId = String(formData.get('storefrontId') ?? '');
  const scope = await sessionScope();
  const sf = await assertStorefrontInScope(scope, storefrontId);
  if (!sf) return { ok: false, error: 'Storefront not found.' };

  const about = String(formData.get('about') ?? '').trim();
  /* 6,000 characters is roughly four screens. Past that it is a paste accident,
     and the column is unbounded so nothing else would ever stop it. */
  if (about.length > 6000) {
    return { ok: false, error: 'That is longer than an About section should be — trim it to a few paragraphs.' };
  }

  const facts = formData.has('since') || formData.has('ownWords') ? readFacts(formData) : null;

  await db
    .update(t.storefronts)
    .set({ about: about || null, ...(facts ? { aboutFacts: facts } : {}) })
    .where(eq(t.storefronts.id, storefrontId));

  revalidatePath('/admin/website');
  revalidatePath(`/s/${sf.slug}`);
  return { ok: true, message: about ? 'About published.' : 'About removed.' };
}
