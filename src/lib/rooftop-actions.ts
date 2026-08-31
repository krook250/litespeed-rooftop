'use server';

/**
 * A lot's own details — the fields signup cannot ask for and every feed needs.
 *
 * The signup hook creates a rooftop with empty strings for the address and null
 * coordinates, because at that moment all we have is a dealership name and an
 * email. That is fine until the lot tries to syndicate, at which point:
 *
 *  - CarGurus lists dealer street, city, state and ZIP as **required** feed
 *    fields, and
 *  - Meta marks `latitude` and `longitude` required on **every item**, not
 *    merely recommended, and explicitly not satisfied by a street address.
 *
 * `src/lib/meta/feed-spec.ts` has told dealers to "set the lot's latitude and
 * longitude in Settings" since early August. There was no Settings screen. The
 * Evergreen rows were fixed by hand in the Neon SQL editor on 4 Aug, which does
 * not scale past the dealer you happen to be sitting next to.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { parseLatLng } from '@/lib/geo';

/**
 * Read the map pin out of the single box the form now posts.
 *
 * Null and zero are different answers and the difference matters: `0` is a real
 * point in the Gulf of Guinea, and a lot silently syndicating itself to the
 * middle of the Atlantic is worse than one that stays excluded with a reason.
 * So an unparseable pair clears the field rather than guessing — `parseLatLng`
 * refuses out-of-range and transposed input for the same reason.
 *
 * `latitude` / `longitude` are still read as a fallback. Nothing in the app
 * posts them today, but the column pair is what every feed reads and a stray
 * caller silently writing nulls over a working pin is not a failure anyone
 * would notice until Marketplace stopped running the lot's cars.
 */
function readPin(formData: FormData): { latitude: number | null; longitude: number | null } {
  const pin = String(formData.get('mapPin') ?? '').trim();
  if (pin) {
    const parsed = parseLatLng(pin);
    return { latitude: parsed?.lat ?? null, longitude: parsed?.lng ?? null };
  }
  if (formData.has('latitude') || formData.has('longitude')) {
    const pair = parseLatLng(
      `${String(formData.get('latitude') ?? '').trim()},${String(formData.get('longitude') ?? '').trim()}`,
    );
    return { latitude: pair?.lat ?? null, longitude: pair?.lng ?? null };
  }
  return { latitude: null, longitude: null };
}

export async function saveRooftopDetails(formData: FormData) {
  const rooftopId = String(formData.get('rooftopId') ?? '');
  await requireSession();
  const scope = await sessionScope();
  if (!(await assertRooftopInScope(scope, rooftopId))) return;

  const str = (k: string, max: number) => String(formData.get(k) ?? '').trim().slice(0, max);

  await db
    .update(t.rooftops)
    .set({
      name: str('name', 120) || 'Main lot',
      addressLine1: str('addressLine1', 200),
      city: str('city', 100),
      state: str('state', 40),
      postalCode: str('postalCode', 20),
      phone: str('phone', 40),
      email: str('email', 200),
      ...readPin(formData),
    })
    .where(eq(t.rooftops.id, rooftopId));

  // The lot's address and coordinates are on every feed row and every storefront
  // page, so this invalidates far more than the screen it was edited on.
  revalidatePath('/admin', 'layout');
  revalidatePath('/ops');
}
