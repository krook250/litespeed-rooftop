'use client';

import { useEffect } from 'react';
import { LEADS_SEEN_COOKIE } from '@/lib/leads-seen';

/**
 * Marks the leads list as read once it has rendered.
 *
 * A cookie, not a column: "new since you last looked" is per person per device,
 * and a migration for a bold font weight is a poor trade. The server reads it on
 * the next visit; this render keeps its bold rows so nothing un-bolds under you.
 */
export function MarkLeadsSeen() {
  useEffect(() => {
    document.cookie = `${LEADS_SEEN_COOKIE}=${encodeURIComponent(new Date().toISOString())}; path=/admin; max-age=31536000; samesite=lax`;
  }, []);
  return null;
}
