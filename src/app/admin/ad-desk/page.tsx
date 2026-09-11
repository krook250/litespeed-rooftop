import { redirect } from 'next/navigation';

/** The Ad Desk is two screens now. Old links and bookmarks land on the ads. */
export default function AdDeskIndex() {
  redirect('/admin/ad-desk/ads');
}
