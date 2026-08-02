/**
 * Domain events in the Lot Walk feed.
 *
 * "Your website is live at cascademotorswa.com" is exactly what a dealer should
 * see on the feed — it is the single most visible thing that happens during
 * onboarding, and it happens hours after they did the work, when they are not
 * looking at the setup screen any more.
 *
 * `kind: 'domain'` groups under the **Channels** filter, because a dealer's own
 * website is a channel in the same sense Cars.com is — it is somewhere their
 * inventory appears.
 *
 * EVERY CARD CARRIES A NUMBER (section 2 of `data-model-and-decisions.md`), and
 * that rule is enforced at the emitter, so these events carry real ones: how many
 * units went live with the site, and how long the cutover actually took.
 *
 * Domain events are scoped by `rooftopId` like every other feed event. A
 * storefront can front several rooftops, so the card is posted to the storefront's
 * **first** rooftop rather than fanned out — one website going live is one event,
 * not three.
 */

import 'server-only';
import { emitFeedEvent } from '@/lib/feed';
import { num } from '@/lib/domain';

type DomainEventBase = {
  rooftopId: string;
  domain: string;
  /** Units publicly visible on the storefront at the moment of the event. */
  unitCount: number;
  actorId?: string | null;
};

/** Records added, Vercel is watching DNS. Repeatable — a dealer may re-point. */
export async function emitDomainPointed(input: DomainEventBase & { host: string }) {
  return emitFeedEvent({
    rooftopId: input.rooftopId,
    kind: 'domain',
    actorId: input.actorId ?? null,
    title: `${input.domain} is pointed at your storefront`,
    body:
      `DNS records are in at ${input.host}. It can take up to 48 hours to reach everyone, and the ` +
      `padlock appears on its own once it resolves. Nothing else for you to do.`,
    stats: [
      { k: 'Units going live', v: num(input.unitCount) },
      { k: 'Status', v: 'Verifying' },
    ],
  });
}

/**
 * The one that matters. Deduped so it posts exactly once per domain per
 * storefront however many times the status poll runs.
 */
export async function emitDomainLive(
  input: DomainEventBase & { daysToLive: number | null; storefrontId: string },
) {
  return emitFeedEvent({
    rooftopId: input.rooftopId,
    kind: 'domain',
    actorId: null, // the system noticed this, nobody clicked it
    title: `Your website is live at ${input.domain}`,
    body:
      `The certificate issued and the site is serving over HTTPS. Put it on your buyer's guides, your ` +
      `window stickers and your Facebook page — every lead that comes through it is one you are not ` +
      `paying a marketplace for.`,
    stats: [
      { k: 'Units live', v: num(input.unitCount), good: true },
      ...(input.daysToLive !== null
        ? [{ k: 'Days to go live', v: num(input.daysToLive) }]
        : []),
      { k: 'SSL', v: 'Active', good: true },
    ],
    dedupeKey: `domain-live:${input.storefrontId}:${input.domain}`,
  });
}

/**
 * Something is wrong and the dealer has to act — almost always a CAA record or a
 * registrar hold. Not deduped: if it breaks twice, that is twice.
 */
export async function emitDomainBlocked(
  input: DomainEventBase & { reason: string; blockerCount: number },
) {
  return emitFeedEvent({
    rooftopId: input.rooftopId,
    kind: 'domain',
    actorId: null,
    title: `${input.domain} can't go live yet`,
    body: `${input.reason} Open Website settings and we'll show you the exact record to change.`,
    stats: [
      { k: 'Things to fix', v: num(input.blockerCount), bad: true },
      { k: 'Units waiting', v: num(input.unitCount) },
    ],
  });
}

/** A domain was bought through us. Money moved, so the card says so. */
export async function emitDomainPurchased(
  input: DomainEventBase & { priceUsd: number; renewalPriceUsd: number; storefrontId: string },
) {
  return emitFeedEvent({
    rooftopId: input.rooftopId,
    kind: 'domain',
    actorId: input.actorId ?? null,
    title: `${input.domain} is registered to you`,
    body:
      `We bought it and pointed it at your storefront — no DNS records for you to add. You are the ` +
      `registrant on the ICANN record, so the domain is yours.`,
    stats: [
      { k: 'Registered for', v: '1 year' },
      { k: 'Renews at', v: `$${input.renewalPriceUsd}/yr` },
      { k: 'Units going live', v: num(input.unitCount) },
    ],
    dedupeKey: `domain-bought:${input.storefrontId}:${input.domain}`,
  });
}
