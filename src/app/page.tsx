import { redirect } from 'next/navigation';
import { landingForSession } from '@/lib/landing';

/**
 * The front door. Signed-out visitors fall through /admin's own session guard
 * to /login; signed-in ones go wherever they belong -- /ops for Rooftop staff,
 * /admin for a dealer. See src/lib/landing.ts.
 */
// Reads the session, so it can never be prerendered. Declared rather than
// inferred: this route used to be a static redirect and a build that quietly
// tried to keep it that way would be a confusing failure.
export const dynamic = 'force-dynamic';

export default async function Home() {
  redirect(await landingForSession());
}
