/**
 * The SMS opt-in disclosure shown on the storefront lead form.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A STRING IN THE JSX
 *
 * Carrier review for A2P 10DLC does not read our privacy policy first — it reads
 * **the opt-in point**, meaning the exact screen where a phone number is
 * collected. `claude/twilio-a2p-onboarding.md` lists the rejection causes in
 * order, and three of the four live here rather than in a legal page:
 *
 *   2. Opt-in language missing the literal word **may** — "Message frequency
 *      **may** vary", "Message and data rates **may** apply". Not "will", not
 *      "can". The reviewer is looking for that word.
 *   3. No direct, ungated privacy-policy link **in the opt-in area**. A link in
 *      the page footer is not the opt-in area.
 *   4. Privacy policy missing the mobile-data carve-out — `/s/[slug]/privacy`
 *      carries it.
 *
 * The text is therefore a constant, and the constant is what gets **stored on
 * the lead row**. When a carrier or TCR asks what a given consumer agreed to,
 * the honest answer is the sentence that was actually on their screen, not
 * whatever the current deploy happens to render. That is why `smsConsentText`
 * exists as a column: reconstructing consent from a version number and a git
 * history is not proof, it is an argument.
 *
 * CHANGING THE COPY: bump `SMS_CONSENT_VERSION` in the same edit. Old rows keep
 * the text they were given, which is the entire point.
 */

export const SMS_CONSENT_VERSION = 1;

/**
 * The checkbox label. Written for a car buyer, not for a compliance reviewer —
 * but every phrase the reviewer needs is in it.
 *
 * `dealerName` rather than "us": on the dealer's own domain this is their form,
 * their brand and their consent, and a disclosure that says "we" without ever
 * naming who is a disclosure that discloses nothing.
 */
export function smsConsentLabel(dealerName: string): string {
  return (
    `Text me about this vehicle. By checking this box I agree to receive text messages from ` +
    `${dealerName} at the number provided, including messages sent by an automatic telephone ` +
    `dialing system. Consent is not a condition of purchase. Message frequency may vary. ` +
    `Message and data rates may apply. Reply STOP to opt out or HELP for help.`
  );
}

/**
 * What gets written to `leads.smsConsentText`.
 *
 * Includes the privacy URL as it was presented, because "there was a link" is
 * half the requirement and "it went here" is the other half.
 */
export function smsConsentRecord(dealerName: string, privacyUrl: string): string {
  return `v${SMS_CONSENT_VERSION} | ${smsConsentLabel(dealerName)} | Privacy policy: ${privacyUrl}`;
}
