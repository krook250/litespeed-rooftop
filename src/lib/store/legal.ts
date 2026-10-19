/**
 * Who the dealership is, legally, wherever a carrier reviewer will look.
 *
 * A2P 10DLC review checks that the website, the opt-in, the terms and the
 * privacy policy all name the business the brand was registered as (Twilio
 * 30907, 30927). Dealers register as the LLC on their IRS letter and trade
 * under another name: Malabar Truck and Trade is MDF Global Enterprises, LLC.
 * A site that only ever says the trade name does not visibly match the brand,
 * so every one of those places says both.
 *
 * `legalName` comes from the dealer's texting registration. No registration,
 * no legal name, and everything reads exactly as it did before.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The legal name, only when it says something the trade name doesn't. */
export function distinctLegalName(name: string, legalName: string | null | undefined): string | null {
  const legal = (legalName ?? '').trim();
  if (!legal || norm(legal) === norm(name)) return null;
  return legal;
}

/** "Malabar Truck and Trade (MDF GLOBAL ENTERPRISES, LLC)", or just the name. */
export function senderName(name: string, legalName: string | null | undefined): string {
  const legal = distinctLegalName(name, legalName);
  return legal ? `${name} (${legal})` : name;
}

/** "Malabar Truck and Trade is operated by MDF GLOBAL ENTERPRISES, LLC.", or null. */
export function operatedBy(name: string, legalName: string | null | undefined): string | null {
  const legal = distinctLegalName(name, legalName);
  return legal ? `${name} is operated by ${legal}.` : null;
}
