/**
 * The shape of a piece of ad copy, and the rules for it.
 *
 * PURE, AND NOT `server-only`, for the reason `buckets.ts` explains: the editor
 * is a client component and needs the call-to-action list and the limits. One
 * definition, imported by both sides, rather than two that drift.
 */

/**
 * Meta's button values, narrowed to the ones that make sense on a car.
 *
 * Meta's full enum is dozens long and most of it is for app installs, events and
 * donations. Offering a dealer `DOWNLOAD` is noise; offering them `GET_QUOTE` is
 * a real choice about whether they want a form fill or a walk-in.
 *
 * Stored as free text in the database on purpose (see `metaAdCopy` in
 * `schema.ts`), so adding to this list is a deploy and never a migration.
 */
export const CALL_TO_ACTIONS = [
  { key: 'LEARN_MORE', label: 'Learn more' },
  { key: 'SHOP_NOW', label: 'Shop now' },
  { key: 'GET_QUOTE', label: 'Get a quote' },
  { key: 'CONTACT_US', label: 'Contact us' },
  { key: 'GET_OFFER', label: 'Get offer' },
  { key: 'APPLY_NOW', label: 'Apply now' },
] as const;

export type CallToActionKey = (typeof CALL_TO_ACTIONS)[number]['key'];

export function isCallToAction(key: string): key is CallToActionKey {
  return CALL_TO_ACTIONS.some((c) => c.key === key);
}

/**
 * The template tokens Meta interpolates per vehicle.
 *
 * Shown to the dealer as clickable chips rather than documented, because
 * `{{vehicle.year}}` is not something anyone types correctly from memory and a
 * typo produces an ad that says `{{vehicle.yaer}}` to real shoppers.
 *
 * NOT VALIDATED ANYWHERE. Meta owns this list, it changes, and a validator we
 * maintained would eventually refuse a token that works fine.
 */
export const VEHICLE_TOKENS = [
  { token: '{{vehicle.year}}', label: 'Year' },
  { token: '{{vehicle.make}}', label: 'Make' },
  { token: '{{vehicle.model}}', label: 'Model' },
  { token: '{{vehicle.trim}}', label: 'Trim' },
  { token: '{{vehicle.price}}', label: 'Price' },
  { token: '{{vehicle.mileage.value}}', label: 'Mileage' },
  { token: '{{vehicle.exterior_color}}', label: 'Color' },
] as const;

/**
 * What a lot gets before anyone edits anything.
 *
 * These are the exact strings that were hardcoded in `createDemoCampaign` until
 * Sep 2026, so a dealer who never opens the editor sees no change at all — the
 * feature adds a control, it does not quietly restyle their live ads.
 */
export function defaultAdCopy(dealerName: string) {
  return {
    name: 'Default',
    message: `Now at ${dealerName}.`,
    headline: '{{vehicle.year}} {{vehicle.make}} {{vehicle.model}}',
    description: '{{vehicle.price}}',
    callToAction: 'LEARN_MORE' as const,
  };
}

/** Meta truncates rather than refuses, which is worse — the dealer never learns. */
export const COPY_LIMITS = { name: 40, message: 200, headline: 60, description: 60 };

export type AdCopyFields = {
  name: string;
  message: string;
  headline: string;
  description: string;
  callToAction: string;
};

/**
 * Read one ad's fields off a form. `prefix` lets several ads share a form —
 * the new-group form posts `ad0.name`, `ad1.name`… — while the per-ad editor
 * posts bare names. Pure, so both the action and the component can agree on
 * the field names without importing a server module.
 */
export function adFieldName(prefix: string, field: keyof AdCopyFields): string {
  return prefix ? `${prefix}.${field}` : field;
}

export function readAdFields(formData: FormData, prefix = ''): AdCopyFields {
  const get = (f: keyof AdCopyFields) => String(formData.get(adFieldName(prefix, f)) ?? '').trim();
  return {
    name: get('name'),
    message: get('message'),
    headline: get('headline'),
    description: get('description'),
    callToAction: get('callToAction') || 'LEARN_MORE',
  };
}

export function validateAdCopy(c: AdCopyFields): string | null {
  if (!c.name.trim()) return 'Give this ad a name so you can tell them apart.';
  if (!c.message.trim()) return 'The main line of text can’t be empty.';
  if (!c.headline.trim()) return 'The headline can’t be empty.';
  if (c.name.length > COPY_LIMITS.name) return `Name is over ${COPY_LIMITS.name} characters.`;
  if (c.message.length > COPY_LIMITS.message)
    return `Main text is over ${COPY_LIMITS.message} characters — Facebook will cut it off.`;
  if (c.headline.length > COPY_LIMITS.headline)
    return `Headline is over ${COPY_LIMITS.headline} characters — Facebook will cut it off.`;
  if (c.description.length > COPY_LIMITS.description)
    return `Description is over ${COPY_LIMITS.description} characters — Facebook will cut it off.`;
  if (!isCallToAction(c.callToAction)) return 'Pick a button.';
  return null;
}

/**
 * A short list of emoji for the main text, car business first.
 *
 * DELIBERATELY NOT A PICKER. A full emoji keyboard is a dependency, a search
 * box and a scroll region on a panel whose job is four text fields — and a
 * dealer writing "now at the lot 🎄" is not what anybody needed. These are the
 * ones that actually turn up in used-car ads: the vehicle, the deal, and a bit
 * of noise to stop the line reading like a form letter.
 *
 * Order is by how often a lot would reach for it, not by category tidiness.
 * Nothing is required — most good ad copy has none of these.
 */
export const AD_EMOJI = [
  '🚗', '🛻', '🚙', '🚐', '🔑', '⛽',
  '💰', '💵', '🏷️', '🤝', '✅', '📉',
  '🔥', '⭐', '👀', '⚡', '🎉', '😍',
  '😮', '👍', '‼️', '📍',
] as const;
