import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { can, sectionsFor, type Section } from '@/lib/permissions';

/**
 * The server half of the permission model.
 *
 * `requireSection` is what actually stops someone, and every admin route calls
 * it. The sidebar filtering in `admin-nav.tsx` is a courtesy — it keeps people
 * from clicking into a wall — but a hidden link is not a locked door, and a URL
 * is four seconds of typing.
 *
 * A refused user is **redirected, not 403'd**, and to the first screen they can
 * actually open rather than to a dead end. Nobody in a dealership needs to be
 * told they lack a permission they never knew existed; they need to be
 * somewhere useful. `feed` is open to every role, so the fallback is real.
 */
export async function requireSection(section: Section) {
  const me = await requireSession();
  if (!can(me.role, section)) {
    const [first] = sectionsFor(me.role);
    redirect(first === 'feed' || !first ? '/admin/feed' : `/admin/${first}`);
  }
  return me;
}
