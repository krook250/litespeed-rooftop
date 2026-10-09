/**
 * Is this lead-form submission spam?
 *
 * Three checks, all free to a real shopper — no captcha, because every extra
 * step on a listing's form is a lead that does not happen:
 *
 *  1. **Honeypot.** A hidden `company` field (same trick as `/signup`). A form
 *     bot fills every field it finds; a person never sees it.
 *  2. **Too fast.** A person needs more than a few seconds to type a name and an
 *     email. The render time is closed over by the server action, which Next
 *     encrypts, so it cannot be forged from the request body.
 *  3. **A link in the message.** A shopper asking about a truck does not paste a
 *     URL; the "we can help you reach millions of businesses" crowd always does.
 *
 * A caught submission gets the normal "Got it" screen and is never stored or
 * emailed. Telling a bot it was caught is how it learns to stop.
 */

export const MIN_FILL_MS = 3_000;

const URL_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;

export type SpamReason = 'honeypot' | 'too-fast' | 'link';

export function leadSpamReason(input: {
  honeypot: string;
  message: string;
  name: string;
  /** ms between the page rendering and the form arriving; null if unknown. */
  elapsedMs: number | null;
}): SpamReason | null {
  if (input.honeypot.trim()) return 'honeypot';
  if (input.elapsedMs !== null && input.elapsedMs >= 0 && input.elapsedMs < MIN_FILL_MS) {
    return 'too-fast';
  }
  if (URL_RE.test(input.message) || URL_RE.test(input.name)) return 'link';
  return null;
}
