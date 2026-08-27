/**
 * Color maths for the Design card. Pure — no I/O, no React, no database — so
 * every branch here is unit-testable, and so the same suggestion runs on the
 * server (from a scanned website's CSS) and in the browser (from the pixels of
 * an uploaded logo) without two implementations drifting apart.
 *
 * WHAT THIS IS FOR
 * A dealer is asked for two colors. Most of them do not know their own hex
 * values, and the ones who do have them in a PDF somewhere. So we guess from
 * whatever they gave us — a logo, a website — and let them override. The guess
 * only has to be defensible, not perfect; the pickers are right there.
 */

/** Rooftop Auto brand blue. The default when we have nothing to go on. */
export const ROOFTOP_BRAND = '#3D8BFF';
/** Rooftop Auto amber. Used for the one thing on a page that must be clicked. */
export const ROOFTOP_ACCENT = '#FFB020';

/**
 * Color pairs that mean "nobody has chosen anything yet".
 *
 * The current default, plus the generic blue/orange the column shipped with
 * before it. Both are listed because the database default is DDL: a storefront
 * created before `ALTER COLUMN ... SET DEFAULT` ran still holds the old pair,
 * and it would be wrong to read that as a decision the dealer made. Nothing else
 * distinguishes "chose Rooftop blue" from "never opened this screen", and a
 * nullable column to encode the difference is not worth the branch everywhere
 * the color is read.
 */
const DEFAULT_PAIRS: readonly (readonly [string, string])[] = [
  [ROOFTOP_BRAND, ROOFTOP_ACCENT],
  ['#1d4ed8', '#f97316'],
];

export function isDefaultPalette(brand: string, accent: string): boolean {
  const b = brand.toLowerCase(), a = accent.toLowerCase();
  return DEFAULT_PAIRS.some(([db, da]) => db.toLowerCase() === b && da.toLowerCase() === a);
}

export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

/** A color plus how much of the source it accounted for. Weight is unitless. */
export type WeightedColor = { hex: string; weight: number };

export type Suggestion = {
  brand: string;
  accent: string;
  /** Where the suggestion came from, so the UI can say so honestly. */
  source: 'logo' | 'site' | 'default';
};

/* ------------------------------------------------------------ conversions */

export function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Accepts `#abc`, `abc`, `#aabbcc`, `AABBCC`. Returns `#aabbcc` or null. */
export function normalizeHex(raw: string): string | null {
  const v = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    return ('#' + v[0]! + v[0]! + v[1]! + v[1]! + v[2]! + v[2]!).toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(v)) return ('#' + v).toLowerCase();
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return ('#' + c(r) + c(g) + c(b)).toLowerCase();
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: channel(hh + 1 / 3) * 255, g: channel(hh) * 255, b: channel(hh - 1 / 3) * 255 };
}

export function hexToHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex));
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

/* --------------------------------------------------------------- contrast */

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white — whichever is readable on top of `hex`. */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  return contrast(hex, '#ffffff') >= contrast(hex, '#000000') ? '#ffffff' : '#000000';
}

/**
 * Pull a color toward a lightness that works as a button background on white.
 *
 * A dealer's logo is very often near-black or a pale wash, and either one used
 * verbatim as the brand color produces a storefront where nothing reads as
 * clickable. We keep the hue — that is the part that is actually *theirs* — and
 * move only lightness, and only as far as needed.
 */
export function makeUsable(hex: string, { minContrastOnWhite = 3 } = {}): string {
  const hsl = hexToHsl(hex);
  // A grey has no hue worth preserving; leave it alone and let the caller decide.
  if (hsl.s < 0.05) return hex;
  let out = hex;
  let l = hsl.l;
  // Too pale to sit under white text and too pale to read on white: darken.
  for (let i = 0; i < 24 && contrast(out, '#ffffff') < minContrastOnWhite; i++) {
    l = Math.max(0.15, l - 0.03);
    out = hslToHex({ ...hsl, l });
    if (l <= 0.15) break;
  }
  return out;
}

/* ------------------------------------------------------------- suggestion */

/** Smallest distance between two hues on the color wheel, 0–180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Is this color worth offering as a brand color?
 *
 * Rejects the three things that dominate every logo and every stylesheet and
 * mean nothing: white/near-white backgrounds, near-black text, and the grey
 * ramp. Without this filter the suggestion for practically every dealer is
 * `#ffffff` — technically the most common pixel, useless as an answer.
 */
export function isCandidateColor(hex: string): boolean {
  const { s, l } = hexToHsl(hex);
  if (l > 0.93) return false;
  if (l < 0.07) return false;
  return s >= 0.15;
}

/**
 * Turn a weighted color list into a brand + accent pair.
 *
 * Brand is the heaviest usable color. Accent is the heaviest color far enough
 * around the wheel to read as a *second* color rather than a near-miss of the
 * first — 40° is the threshold, below which two swatches side by side look like
 * a mistake. When nothing qualifies we rotate the brand hue rather than falling
 * back to Rooftop amber, because a dealer's own color rotated still looks like
 * their brand, and an unrelated orange does not.
 */
export function suggestPalette(
  colors: WeightedColor[],
  source: Suggestion['source'] = 'logo',
): Suggestion {
  const usable = colors
    .map((c) => ({ hex: normalizeHex(c.hex), weight: c.weight }))
    .filter((c): c is WeightedColor => Boolean(c.hex) && isCandidateColor(c.hex!))
    .sort((a, b) => b.weight - a.weight);

  if (!usable.length) return { brand: ROOFTOP_BRAND, accent: ROOFTOP_ACCENT, source: 'default' };

  const brand = makeUsable(usable[0]!.hex);
  const brandHue = hexToHsl(brand).h;

  const far = usable.slice(1).find((c) => hueDistance(hexToHsl(c.hex).h, brandHue) >= 40);
  const accent = far
    ? makeUsable(far.hex)
    : hslToHex({ ...hexToHsl(brand), h: brandHue + 150, s: Math.max(0.55, hexToHsl(brand).s) });

  return { brand, accent, source };
}

/**
 * Quantise raw pixels into a weighted color list.
 *
 * Buckets at 5 bits per channel (32 levels) rather than clustering properly:
 * k-means on a logo is a lot of arithmetic to arrive at the same three colors,
 * and a logo is flat art with hard edges, which is the one case where naive
 * bucketing works. Fully transparent pixels are skipped — a transparent PNG is
 * the recommended upload, and counting its background as white would swamp
 * everything else.
 */
export function quantize(pixels: Uint8ClampedArray, step = 4): WeightedColor[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < pixels.length; i += 4 * step) {
    const a = pixels[i + 3]!;
    if (a < 128) continue;
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cur = buckets.get(key);
    if (cur) { cur.r += r; cur.g += g; cur.b += b; cur.n++; }
    else buckets.set(key, { r, g, b, n: 1 });
  }
  return [...buckets.values()]
    .map((v) => ({ hex: rgbToHex({ r: v.r / v.n, g: v.g / v.n, b: v.b / v.n }), weight: v.n }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);
}

/* ----------------------------------------------------------- store themes */

/**
 * The three ways a storefront can be painted.
 *
 * WHY THIS IS A THEME AND NOT A HEADER SETTING
 * It started as one — light or dark *header* — on the reasoning that a page of
 * vehicle photographs wants a white background. That is true of the photographs
 * and untrue of everything around them: plenty of dealers want a dark site, buyers
 * increasingly expect one, and a dark header sitting on a white page reads as a
 * mistake rather than a choice. So the switch covers the whole page.
 *
 * The photographs are protected a different way: every image sits on `--paper`
 * with its own border, and the chips that overlay photos use `--scrim`, which is
 * dark in BOTH themes. Nothing that sits on top of a photograph inverts.
 *
 *   LIGHT — white page, brand color on links and the top rule. The default, and
 *           what every storefront rendered before this existed.
 *   DARK  — near-black page, cards a step lighter. The accent carries the header
 *           because a brand color chosen to read on white usually will not.
 *   BRAND — light page, header and footer filled with the dealer's own color.
 *           The loudest option, and the one most dealers picture when they say
 *           "put my colors on it".
 */
export const STORE_THEMES = ['LIGHT', 'DARK', 'BRAND'] as const;
export type StoreTheme = (typeof STORE_THEMES)[number];

export function isStoreTheme(v: string): v is StoreTheme {
  return (STORE_THEMES as readonly string[]).includes(v);
}

export const STORE_THEME_META: Record<StoreTheme, { name: string; blurb: string }> = {
  LIGHT: {
    name: 'Light',
    blurb: 'White page, your color on the links and the line across the top.',
  },
  DARK: {
    name: 'Dark',
    blurb: 'Near-black page. Photos pop; prices and the phone number carry your accent.',
  },
  BRAND: {
    name: 'Your color',
    blurb: 'Light page, but the header and footer are filled with your brand color.',
  },
};

/** Linear blend in sRGB. `t` is how much of `b` to mix into `a`, 0–1. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

/**
 * Move `color` away from `bg` in lightness until it is readable on it.
 *
 * Hue and saturation are left alone — the hue is the dealer's, and a phone
 * number in a hue nobody chose is worse than one a shade off. Direction comes
 * from the background rather than the color, so a mid-tone accent lands on the
 * correct side on both a white page and a black one. This is what makes DARK
 * safe to offer at all: a navy brand color is invisible on near-black, and no
 * dealer is going to pick a second color for the dark version of their site.
 */
export function contrastify(color: string, bg: string, min = 4.5): string {
  if (contrast(color, bg) >= min) return color;
  const hsl = hexToHsl(color);
  const lighten = luminance(bg) < 0.5;
  let out = color;
  let l = hsl.l;
  for (let i = 0; i < 48 && contrast(out, bg) < min; i++) {
    l = lighten ? Math.min(1, l + 0.02) : Math.max(0, l - 0.02);
    out = hslToHex({ ...hsl, l });
    if (l <= 0 || l >= 1) break;
  }
  return out;
}

/**
 * Swap the two colors.
 *
 * Cheap and used constantly: our guess at which of a dealer's two colors is the
 * "brand" one is a frequency count, and a logo that is mostly one color with a
 * small bright mark in another gets it backwards about half the time. Rather
 * than explain that, the Design card offers a button.
 */
export function swapPair(s: { brand: string; accent: string }): { brand: string; accent: string } {
  return { brand: s.accent, accent: s.brand };
}

/**
 * Every color the storefront needs, resolved from one theme and the dealer's pair.
 *
 * Flat hex rather than Tailwind classes because four surfaces consume it — the
 * storefront itself, the drawn layout thumbnails, the live preview in the Design
 * card, and (later) the OG image renderer — and only two of them are Tailwind
 * documents. One function means the preview cannot drift from the site it is
 * previewing, which is exactly what had happened before it existed: the
 * thumbnails drew a brand-filled header while the storefront rendered a white one.
 */
export type StoreThemeTokens = {
  /** Page background, behind everything. */
  page: string;
  /** Cards, inputs, panels. */
  paper: string;
  /** A step off `paper`: hover rows, photo wells, inset blocks. */
  paper2: string;
  /** Every hairline. */
  line: string;
  /** Body text. */
  text: string;
  /** Secondary text — specs, labels. */
  text2: string;
  /** Faint text — disclaimers, hints. */
  text3: string;
  /** The dealer's colors, verbatim, for filled surfaces. */
  brand: string;
  accent: string;
  /** Text on top of a `brand` / `accent` fill. */
  onBrand: string;
  onAccent: string;
  /** The dealer's colors nudged until they read as text on `paper`. */
  brandOnPage: string;
  accentOnPage: string;
  headerBg: string;
  headerFg: string;
  headerMuted: string;
  headerLink: string;
  headerBorder: string;
  /** The thin rule above the header, or null when the bar carries the color. */
  headerRule: string | null;
  footerBg: string;
  footerText: string;
  footerMuted: string;
  /**
   * Background for chips that sit on top of a photograph. Dark in BOTH themes —
   * a photo does not invert, so neither can the thing written across it.
   */
  scrim: string;
};

const LIGHT_BASE = {
  page: '#f6f7f9',
  paper: '#ffffff',
  paper2: '#f6f7f9',
  line: '#d6dae2',
  text: '#18202c',
  text2: '#4f5c72',
  text3: '#66748c',
} as const;

const DARK_BASE = {
  page: '#0e141d',
  paper: '#18202c',
  paper2: '#212b3a',
  line: '#2e394a',
  text: '#f3f5f8',
  text2: '#b2bac8',
  text3: '#8794a8',
} as const;

export function storeTheme(theme: StoreTheme, brand: string, accent: string): StoreThemeTokens {
  const base = theme === 'DARK' ? DARK_BASE : LIGHT_BASE;
  const common = {
    ...base,
    brand,
    accent,
    onBrand: readableOn(brand),
    onAccent: readableOn(accent),
    brandOnPage: contrastify(brand, base.paper),
    accentOnPage: contrastify(accent, base.paper),
    scrim: '#0e141d',
  };

  if (theme === 'DARK') {
    const headerBg = '#131b26';
    return {
      ...common,
      headerBg,
      headerFg: '#ffffff',
      headerMuted: DARK_BASE.text3,
      headerLink: contrastify(accent, headerBg),
      headerBorder: DARK_BASE.line,
      headerRule: brand,
      footerBg: '#0a0f16',
      footerText: DARK_BASE.text,
      footerMuted: DARK_BASE.text3,
    };
  }

  if (theme === 'BRAND') {
    const fg = readableOn(brand);
    return {
      ...common,
      headerBg: brand,
      headerFg: fg,
      headerMuted: mix(fg, brand, 0.4),
      headerLink: fg,
      headerBorder: mix(brand, '#000000', 0.18),
      headerRule: null,
      /* A wash rather than a second full band: two solid brand bars on one page
         is more color than any dealer's logo can carry. */
      footerBg: mix(brand, '#ffffff', 0.9),
      footerText: LIGHT_BASE.text,
      footerMuted: LIGHT_BASE.text3,
    };
  }

  return {
    ...common,
    headerBg: '#ffffff',
    headerFg: LIGHT_BASE.text,
    headerMuted: LIGHT_BASE.text3,
    headerLink: contrastify(brand, '#ffffff'),
    headerBorder: LIGHT_BASE.line,
    headerRule: brand,
    footerBg: LIGHT_BASE.page,
    footerText: LIGHT_BASE.text,
    footerMuted: LIGHT_BASE.text3,
  };
}

/**
 * The tokens as CSS custom properties, ready to spread onto a style attribute.
 *
 * Set once on the storefront's root element. Every component below reads
 * `var(--paper)` / `var(--text)` and takes no color prop, which is what lets a
 * fourth layout — or a fourth theme — arrive without touching any of them.
 */
export function storeThemeVars(t: StoreThemeTokens): Record<string, string> {
  return {
    '--brand': t.brand,
    '--accent': t.accent,
    '--on-brand': t.onBrand,
    '--on-accent': t.onAccent,
    '--brand-text': t.brandOnPage,
    '--accent-text': t.accentOnPage,
    '--page': t.page,
    '--paper': t.paper,
    '--paper-2': t.paper2,
    '--line': t.line,
    '--text': t.text,
    '--text-2': t.text2,
    '--text-3': t.text3,
    '--scrim': t.scrim,
    '--header-bg': t.headerBg,
    '--header-fg': t.headerFg,
    '--header-muted': t.headerMuted,
    '--header-link': t.headerLink,
    '--header-line': t.headerBorder,
    '--footer-bg': t.footerBg,
    '--footer-text': t.footerText,
    '--footer-muted': t.footerMuted,
  };
}
