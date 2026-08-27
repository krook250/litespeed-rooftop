'use server';

/**
 * Server actions behind "Add my logo".
 *
 * TENANT SCOPING: same rule as every other write path in this app — the
 * storefront id comes off a FormData and is therefore attacker-controlled, so
 * it is resolved through `assertStorefrontInScope` before anything happens.
 *
 * WHY CANDIDATES ARE STORED BEFORE THE DEALER PICKS ONE
 * The alternative is holding them in memory and re-fetching the chosen one on
 * save, which means the dealer can be shown a logo that then fails to save
 * because the site went down in between. Storing first makes the pick a pure
 * database write that cannot fail. Blobs are content-addressed, so the same
 * logo scanned twice costs nothing, and an unchosen candidate is a few KB of
 * Postgres — cheaper than the failure mode it avoids.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireGroupId } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertStorefrontInScope } from '@/lib/scoped-db';
import { MAX_LOGO_BYTES, owns, put, sniffImage } from '@/lib/storage';
import { scanSite, fetchImage } from './site-scan';
import { isHex, isStoreTheme, suggestPalette, type Suggestion } from './palette';
import type { ActionResult } from '@/lib/domains/actions';

/** How many candidates we are willing to download for one scan. */
const MAX_CANDIDATE_DOWNLOADS = 4;

export type ScannedLogo = {
  key: string;
  url: string;
  hint: string;
  width: number | null;
  height: number | null;
  bytes: number;
};

export type SiteScanResult = {
  host: string;
  title: string | null;
  logos: ScannedLogo[];
  suggestion: Suggestion;
  /**
   * How many images we found and tried to download. Zero and "four, all refused"
   * are the same empty grid to look at and completely different problems to fix,
   * so the screen gets to say which one happened.
   */
  attempted: number;
};

/**
 * Read a dealer's website: find their logo, read their colors.
 *
 * Never throws at the caller. Everything here is a network call against a URL a
 * dealer typed, so failure is the normal case, not the exception — and the
 * failure has to arrive as a sentence they can act on.
 */
export async function scanSiteForBranding(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<SiteScanResult>> {
  const storefrontId = String(formData.get('storefrontId') ?? '');
  const sf = await assertStorefrontInScope(await sessionScope(), storefrontId);
  if (!sf) return { ok: false, error: 'Storefront not found.' };

  const groupId = await requireGroupId();
  const scan = await scanSite(String(formData.get('siteUrl') ?? ''));
  if (!scan.ok) return { ok: false, error: scan.error };

  const logos: ScannedLogo[] = [];
  let attempted = 0;
  for (const candidate of scan.candidates) {
    if (logos.length >= MAX_CANDIDATE_DOWNLOADS) break;
    attempted++;
    try {
      // The page URL as Referer: a logo usually lives on the platform's CDN,
      // and CDNs hotlink-protect by checking where the request came from.
      const buf = await fetchImage(candidate.url, MAX_LOGO_BYTES, scan.url);
      const sniff = sniffImage(buf);
      // A favicon is usually an .ico and a banner is sometimes an SVG; both fail
      // the sniff, and both failing quietly is correct — we just show fewer.
      if (!sniff.ok) continue;
      const key = await put(groupId, buf, sniff.contentType, { width: sniff.width, height: sniff.height });
      if (logos.some((l) => l.key === key)) continue; // same bytes at two URLs
      logos.push({
        key,
        url: `/api/logo/${key}`,
        hint: candidate.hint,
        width: sniff.width,
        height: sniff.height,
        bytes: buf.byteLength,
      });
    } catch {
      continue;
    }
  }

  return {
    ok: true,
    data: {
      host: scan.host,
      title: scan.title,
      logos,
      attempted,
      suggestion: suggestPalette(scan.colors, 'site'),
    },
  };
}

/* ------------------------------------------------------- save the design */

/**
 * Save layout, colors and logo in one write.
 *
 * One action for all three because the dealer experiences them as one decision
 * ("what does my website look like"), and because a partial save is the worst
 * outcome here: a logo that landed without the colors that were chosen to go
 * with it looks broken in a way neither half explains.
 *
 * THE LOGO ARRIVES THREE WAYS and the precedence is deliberate:
 *   1. `logo` — a file they just picked. Most explicit, so it wins.
 *   2. `logoKey` — one of the candidates we pulled off their website. Only
 *      honoured after `owns()` confirms the blob is theirs.
 *   3. `removeLogo` — checked last, so ticking Remove always means removed.
 * Absent all three, whatever is already on the storefront survives untouched.
 * That is what lets the dealer come back and change only their colors.
 */
export async function saveStorefrontDesign(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const storefrontId = String(formData.get('storefrontId') ?? '');
  const scope = await sessionScope();
  const sf = await assertStorefrontInScope(scope, storefrontId);
  if (!sf) return { ok: false, error: 'Storefront not found.' };

  const groupId = await requireGroupId();
  const layout = String(formData.get('layout') ?? sf.layout);
  const brandColor = String(formData.get('brandColor') ?? sf.brandColor);
  const accentColor = String(formData.get('accentColor') ?? sf.accentColor);
  const theme = String(formData.get('theme') ?? sf.theme);

  if (!isHex(brandColor) || !isHex(accentColor)) {
    return { ok: false, error: 'Colors must be six-digit hex values like #3d8bff.' };
  }
  if (!isStoreTheme(theme)) {
    return { ok: false, error: 'Unknown theme.' };
  }
  if (!(t.storefrontLayoutEnum.enumValues as readonly string[]).includes(layout)) {
    return { ok: false, error: 'Unknown layout.' };
  }

  let logoKey = sf.logoKey;

  const file = formData.get('logo');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) {
      return { ok: false, error: `That image is ${Math.round(file.size / 1024)}KB. Keep it under ${Math.round(MAX_LOGO_BYTES / 1024)}KB.` };
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const sniff = sniffImage(buf);
    if (!sniff.ok) return { ok: false, error: sniff.error };
    logoKey = await put(groupId, buf, sniff.contentType, { width: sniff.width, height: sniff.height });
  } else {
    const picked = String(formData.get('logoKey') ?? '').trim();
    if (picked && picked !== sf.logoKey) {
      if (!(await owns(groupId, picked))) return { ok: false, error: 'That logo is no longer available. Scan your site again.' };
      logoKey = picked;
    }
  }

  if (formData.get('removeLogo') === 'on') logoKey = null;

  await db
    .update(t.storefronts)
    .set({ layout: layout as typeof sf.layout, theme, brandColor, accentColor, logoKey })
    .where(eq(t.storefronts.id, storefrontId));

  revalidatePath('/admin/website');
  revalidatePath(`/s/${sf.slug}`);
  return { ok: true, message: 'Saved.' };
}
