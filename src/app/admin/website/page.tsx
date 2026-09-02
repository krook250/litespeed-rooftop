import { redirect } from 'next/navigation';

/**
 * `/admin/website` was one long screen until Sep 2026. It is now Content,
 * Design and Analytics, and this redirect keeps every old link and bookmark
 * landing somewhere sensible rather than 404ing.
 */
export default function WebsitePage() {
  redirect('/admin/website/content');
}
