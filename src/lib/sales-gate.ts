import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Shared-password gate for /send-email. Not a user account: one password the
 * sales team shares. The cookie holds an HMAC of the password, so changing
 * SALES_PAGE_PASSWORD signs everyone out.
 */

const PASSWORD = process.env.SALES_PAGE_PASSWORD || 'Sales101!';
export const SALES_COOKIE = 'rt_sales';

function sign(value: string): string {
  return createHmac('sha256', process.env.BETTER_AUTH_SECRET || 'local-dev')
    .update(`sales-page:${value}`)
    .digest('hex');
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(input: string): boolean {
  return same(sign(input), sign(PASSWORD));
}

export function gateToken(): string {
  return sign(PASSWORD);
}

export async function salesUnlocked(): Promise<boolean> {
  const value = (await cookies()).get(SALES_COOKIE)?.value;
  return Boolean(value) && same(value!, gateToken());
}

/** Sender. Must be on a domain verified in Resend. */
export const SALES_FROM = process.env.SALES_EMAIL_FROM || 'David Watson <david@mail.rooftopauto.com>';
/** Replies land in David's real inbox. */
export const SALES_REPLY_TO = process.env.SALES_EMAIL_REPLY_TO || 'david@rooftopauto.com';
