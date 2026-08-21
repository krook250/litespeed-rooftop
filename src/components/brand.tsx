/**
 * Brand marks — the same lockup the marketing site uses (rooftopauto.com).
 *
 * MARK: the v2 line-art coupe under the roof chevron, traced from
 * `logo/.../brand/svg/v2/rooftop-mark-newcar.svg`. It is ~2.6:1 and its strokes are
 * 2% of its height, so **it stops reading below about 56px wide** — that constraint,
 * not taste, is why the sidebar lockup is stacked rather than in a row. The same path
 * data is in `site/index.html` as a `<symbol id="ra-mark">`; keep the two in step.
 *
 * WORDMARK: Archivo 900 italic converted to outlines, deliberately. The app ships no
 * webfonts (see the note in src/app/layout.tsx) and the brand rules forbid setting the
 * wordmark in a substitute face — outlining is the only way to have both. Never
 * hand-edit the path data.
 *
 * The separator is a lightning bolt as of brand v2 (Aug 2026) — it was a slash. It is a
 * plain polygon, no font involved, measured off brand/png/v2/lockup-header-*.png at
 * exactly 0.300 wordmark units per source pixel. One unit here is 1/62 em, because the
 * outlines were generated at font-size 62. Full write-up in claude/brand-v2-logo.md.
 */

const CHEVRON = '#3D8BFF';
const BODY = '#F4F7FA';
const MUTED = 'text-ink-400';

/* ------------------------------------------------------------------ mark */

const MARK_D =
  'm371 2-5 2-20 8-6 3-8 3-4 2-4 1-7 3-2 1-3 1-11 5-8 3-33 14-5 2-29 13-4 1-3 2-3 1-37 16-4 2-70 30-15 6-8 3-7 3-16 7-11 5-8 3-40 18q-1 6 6 4l15-6 12-5 9-3 8-3 9-4 10-4 51-19 12-4 8-3 20-8 6-2 30-11 13-5 29-11 46-17 3-1 1-1h2l2-1 4-2 7-2 14-6 14-6 9-3 40-14 4 1 9 3 7 2 91 26 15 4 8 3 8 2 6 2 4 1 5 1 12 4 15 4 4 1 5 1 14 4 7 2 7 2 7 2 17 5 6 2h4l22 6 7 2 16 5 10 3 11 3 21 6 5 1 8 2h1l4 1 14 4 30 8 11 3 45 12 5 2 10 2 7 2 4 2h4l3 1 14 4 5 2 33 8 6 2 28 7q12 4 11-1c0-3 0-3-16-8l-7-2-86-27-10-4-10-3-58-18-5-1-46-14-36-12-8-2-13-4-33-10-5-2-9-2-23-7-8-3-14-4-15-4-13-4-8-3-25-7-24-7-28-8-6-2-7-2-28-8-8-2-9-3-25-7-5-1q-5-2-11 1m55 134h-12l-38 4-9 1-17 3-29 6-3 1-8 2a359 359 0 0 0-65 18l-15 5-11 4h-6l-10-1-14-1a544 544 0 0 0-109 0q-15 2-30-1-16-4-9 7c5 11 12 16 31 17 11 2 11 2 11-5q0-11 7 1 8 7-3 7l-7 2-6 1c-21 4-24 7-30 28l-3 8q-4 10-2 22 2 13-3 13-7 2-6 8l1 3 4 16 4 12 6 16q3 6 13 8l20 6 7 1 9 2 4 1 6 1q23 5 20-3-1-2-13-6c-26-8-35-15-44-34q-10-26-21-28v-3l1-10c1-15 2-19 9-22l4-2c29-13 37-27 15-27q-6 0 1-2l24-4 16-2a522 522 0 0 1 114 0l29 6 24 4 7 1q7 1 4 4l-2 4c-2 5-1 4-7 4l-23-1h-55q-1 3 2 5l34 4h5l7 1 20 1 10 1 4 1v2l1 9 4 16q3 5 0 5l-4 1-15 2-9 1-9 1q-5 1-5 3c0 2 1 3 24 3 27 0 23-2 29 10l14 24q6 6 1 5l-9-1-15-1c-15-2-18-2-18-1q-3 4 3 5l45 7q3-1 6 3l13 11-38-2h-26l-33-1-13-1-1 2q-5 4 10 5l64 4 33 3 11 1 9 1 40 5-102 1-103-1 4-5c17-18 21-31 21-58a96 96 0 0 0-10-48l-3-4q-18-27-43-22l-8 2c-8 3-26 19-26 23l-3 5-4 7a91 91 0 0 0-7 31c-3 22 4 46 20 64l4 5-50 1c-61 0-67 0-68 3-1 2 4 3 27 4l24 1 28 2 104 4 35 1a3192 3192 0 0 0 182 5l144 2q5-2-5-7-23-11-30-38l-1-2v-2c-2-8-2-24 0-34v-2l4-12 2-5a62 62 0 0 1 36-32c4-2 18-1 23 1 15 5 32 28 37 49q3 15 1 24v7l-1 4a166 166 0 0 1-22 47q-2 2 2 3l358-4c29-1 28-1 29-3 1-3-1-4-14-5l-61-3a3030 3030 0 0 0-224 2l-39-3c-27-2-25-1-22-7l5-11c2-4 3-7 5-19q3-17-1-38-5-17-10-26l-4-5q-8-14-19-21l-6-4a57 57 0 0 0-41-7c-12 2-29 15-39 30a101 101 0 0 0-15 45 121 121 0 0 0 8 51l1 1h-5l-130-11-14-1h-6l-7-4q-23-11-12-9a375 375 0 0 0 59 7h6l12 1 27 1h21l1-4 1-6c0-7 3-19 6-25l1-3c2-7 9-20 17-31q6-8 2-9l-128 2-23 1-41 2h-5l-1-1-2-7-4-13-1-6-1-3h28c26 0 26 0 26-2q0-4-4-4l-25-2-6-1-6-1-10-1 2-5 3-5h3l6 1 4 1 5 1 38 5 4 1h6a719 719 0 0 0 142 0l11-1 28-3a281 281 0 0 1 62 1l10 4 13 7 2 1 3 2h1l4 3 3 2 39 25 6 5c18 12 21 13 21 9 0-5-29-33-45-44l-5-4 19 10 9 4 19 10 16 7 17 6 10 3 14 4 22 7 15 4 13 3 4 1 1-2c3-2 2-3-19-10l-7-2-16-6-16-6a559 559 0 0 1-91-42l-9-4-40-11-6-1a287 287 0 0 0-89 2l-12 1c-9 0-8 1-11-3l-4-6-5-6-2-3-3-4-24-23-18-16a469 469 0 0 1 99 8l6 1 20 6 6 2 2 1 5 2 48 21 62 30q3 2 6-1 3-1-1-4l-3-3-1-1 12 1a229 229 0 0 1 46 4l35 7 5 1 9 3 5 1 6 2 6 2 6 2 5 2h2l1 1 4 1 6 3 33 15 7 4 36 23c6 5 11 3 7-2l-14-12-19-14-13-9-10-6c-5-3-26-15-34-18l-6-3-5-2q-17-8-52-14c-28-6-65-7-91-3-4 1-4 1-9-2l-5-3-7-3-48-25-5-2a428 428 0 0 0-83-29l-6-1-13-2a504 504 0 0 0-87-4m-9 24q10 3 26 14a267 267 0 0 1 51 44 795 795 0 0 1-179-12l15-27 5-9 3-5 5-1a353 353 0 0 1 74-4m-90 7-2 3-3 4-3 6-6 10-6 11q-2 6-8 3l-7-1-39-11 3-2 4-1 12-6 5-1 7-3 7-3 15-4 5-2 5-1 5-1zm-148 19 16 1-17 4-61 8-8 1c-1 1-6-5-8-9q-3-2 7-2c22-3 42-3 71-3m2 61a64 64 0 0 1 26 39c8 12 1 51-12 74l-3 5 1 2h-17c-17 0-19-1-24-3a40 40 0 0 1-15-16 79 79 0 0 1-8-24v-28q5-26 20-42 10-10 22-9 6 0 10 2m302 41-3 3a181 181 0 0 0-23 39l-8 1a271 271 0 0 1-60-1l-22-1-17-1c-12-1-14-1-16-4l-14-19-2-3-7-14 86-1zm264 16h-4c-5 0-15 3-21 6q-8 5-19 20l-4 6-11 16q-9 9-2 8l6 1 16 2c10 3 20 3 69 3 35-1 38-1 39-3v-3l-19-2-78-8 6-8 4-5q14-15 27-18a214 214 0 0 1 43 4h9a770 770 0 0 0 114 2l-1 3-1 2-3 9-3 8c-2 4-1 4 13 10l23 9c2-2 1-3-10-14l-11-11v-3c0-7 9-26 14-29q3-2 0-3l-1-1-19 3-12 2a902 902 0 0 1-118-3l-17-2-11-1z';
const MARK_RATIO = 390 / 1000;

/**
 * Roof chevron over the coupe. `width` drives it, not height — the art is 2.6:1.
 * Do not go below ~56px: the strokes fall under a pixel and it turns to haze.
 */
export function RooftopMark({ width = 150, className }: { width?: number; className?: string }) {
  return (
    <svg
      width={width}
      height={Math.round(width * MARK_RATIO)}
      viewBox="0 0 1000 390"
      className={className}
      aria-hidden="true"
    >
      <path fill={CHEVRON} d={MARK_D} />
    </svg>
  );
}

/* -------------------------------------------------------------- wordmark */

/**
 * ROOFTOP-bolt-AUTO.
 *
 * `height` keeps its original meaning — the letters render at exactly the size they
 * did when the separator was a slash — but the drawn box is now taller than the caps
 * because the bolt overshoots the cap line and the baseline. The negative margins
 * below cancel that overshoot so the element still *occupies* the old box and no
 * caller's layout moves; the bolt simply draws outside it.
 *
 * The two BODY paths are ROOFTOP and AUTO separately, because v2 opens the gap between
 * them from 11.7 units to 22.5 to seat the bolt. Do not merge them back into one `d`.
 */
const VB = { x: 1.7, y: -54, w: 535, h: 67.5 };
const OLD_VB_H = 48.7; // the slash-era viewBox height, kept as the sizing reference
const AUTO_SHIFT = 10.8;
const OVERSHOOT_TOP = 8.3 / OLD_VB_H; // units the bolt adds above the old box
const OVERSHOOT_BOT = 10.5 / OLD_VB_H; // ...and below it

export function RooftopWordmark({ height = 13, className }: { height?: number; className?: string }) {
  const unit = height / OLD_VB_H; // px per viewBox unit — unchanged from the slash era
  return (
    <svg
      width={Math.round(VB.w * unit)}
      height={VB.h * unit}
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      className={className}
      role="img"
      aria-label="Rooftop Auto"
      style={{
        display: 'block',
        marginTop: -OVERSHOOT_TOP * height,
        marginBottom: -OVERSHOOT_BOT * height,
      }}
    >
      {/* ROOFTOP */}
      <path fill={BODY} d="M1.7 0 9.2 -42.7H35.3Q39.7 -42.7 42.5 -41.2Q45.4 -39.7 46.8 -37.2Q48.2 -34.8 48.2 -31.7Q48.2 -27.8 47 -24.9Q45.8 -21.9 43.6 -19.9Q41.5 -17.9 38.6 -16.6L44.1 0.0H28.9L24.9 -14.3H18.0L15.4 0.0ZM19.7 -23.8H28.6Q29.9 -23.8 31.1 -24.5Q32.4 -25.2 33.2 -26.5Q34 -27.7 34 -29.3Q34 -30.9 33.1 -31.9Q32.2 -32.9 30.8 -32.9H21.2Z M69.6 0.7Q63.2 0.7 58.6 -1.2Q54 -3.1 51.7 -6.9Q49.3 -10.7 49.3 -16.4Q49.3 -17.7 49.5 -19.1Q49.6 -20.5 49.9 -21.9Q51.1 -29 54.4 -33.8Q57.6 -38.6 63 -41.0Q68.4 -43.4 76.1 -43.4Q82.6 -43.4 87.2 -41.5Q91.7 -39.6 94.1 -35.7Q96.5 -31.9 96.5 -26.1Q96.5 -24.9 96.3 -23.5Q96.2 -22.1 96 -20.7Q94.7 -13.6 91.4 -8.9Q88.1 -4.1 82.7 -1.7Q77.2 0.7 69.6 0.7ZM70.8 -9.5Q73 -9.5 74.8 -10.2Q76.7 -10.9 78 -12.2Q79.4 -13.5 80.3 -15.3Q81.2 -17.2 81.6 -19.3Q81.9 -21.1 82.1 -22.3Q82.3 -23.4 82.4 -24.1Q82.4 -24.8 82.5 -25.2Q82.5 -25.5 82.5 -25.9Q82.5 -28.1 81.7 -29.7Q80.8 -31.4 79.2 -32.3Q77.5 -33.2 74.9 -33.2Q72.7 -33.2 70.9 -32.5Q69.1 -31.7 67.7 -30.4Q66.4 -29.1 65.5 -27.3Q64.6 -25.5 64.2 -23.3Q63.9 -21.5 63.7 -20.3Q63.5 -19.2 63.4 -18.5Q63.3 -17.8 63.3 -17.4Q63.3 -17.1 63.3 -16.7Q63.3 -14.6 64.1 -12.9Q64.9 -11.3 66.6 -10.4Q68.2 -9.5 70.8 -9.5Z M119.3 0.7Q112.8 0.7 108.3 -1.2Q103.7 -3.1 101.3 -6.9Q99 -10.7 99 -16.4Q99 -17.7 99.1 -19.1Q99.3 -20.5 99.5 -21.9Q100.8 -29 104 -33.8Q107.2 -38.6 112.6 -41.0Q118 -43.4 125.8 -43.4Q132.3 -43.4 136.8 -41.5Q141.4 -39.6 143.7 -35.7Q146.1 -31.9 146.1 -26.1Q146.1 -24.9 146 -23.5Q145.9 -22.1 145.6 -20.7Q144.4 -13.6 141 -8.9Q137.7 -4.1 132.3 -1.7Q126.9 0.7 119.3 0.7ZM120.4 -9.5Q122.7 -9.5 124.5 -10.2Q126.3 -10.9 127.7 -12.2Q129.1 -13.5 130 -15.3Q130.8 -17.2 131.2 -19.3Q131.5 -21.1 131.7 -22.3Q131.9 -23.4 132 -24.1Q132.1 -24.8 132.1 -25.2Q132.2 -25.5 132.2 -25.9Q132.2 -28.1 131.3 -29.7Q130.5 -31.4 128.8 -32.3Q127.1 -33.2 124.6 -33.2Q122.4 -33.2 120.5 -32.5Q118.7 -31.7 117.4 -30.4Q116 -29.1 115.1 -27.3Q114.2 -25.5 113.9 -23.3Q113.6 -21.5 113.4 -20.3Q113.2 -19.2 113.1 -18.5Q113 -17.8 113 -17.4Q112.9 -17.1 112.9 -16.7Q112.9 -14.6 113.7 -12.9Q114.5 -11.3 116.2 -10.4Q117.9 -9.5 120.4 -9.5Z M147.2 0 154.8 -42.7H189.2L187.4 -32.4H166.7L165.4 -25.1H183.2L181.5 -15.3H163.6L160.9 0.0Z M197.5 0 203.2 -31.7H189.2L191.1 -42.7H232.7L230.8 -31.7H216.9L211.2 0.0Z M251 0.7Q244.6 0.7 240 -1.2Q235.5 -3.1 233.1 -6.9Q230.7 -10.7 230.7 -16.4Q230.7 -17.7 230.9 -19.1Q231.1 -20.5 231.3 -21.9Q232.5 -29 235.8 -33.8Q239 -38.6 244.4 -41.0Q249.8 -43.4 257.5 -43.4Q264 -43.4 268.6 -41.5Q273.2 -39.6 275.5 -35.7Q277.9 -31.9 277.9 -26.1Q277.9 -24.9 277.7 -23.5Q277.6 -22.1 277.4 -20.7Q276.1 -13.6 272.8 -8.9Q269.5 -4.1 264.1 -1.7Q258.6 0.7 251 0.7ZM252.2 -9.5Q254.4 -9.5 256.3 -10.2Q258.1 -10.9 259.5 -12.2Q260.8 -13.5 261.7 -15.3Q262.6 -17.2 263 -19.3Q263.3 -21.1 263.5 -22.3Q263.7 -23.4 263.8 -24.1Q263.9 -24.8 263.9 -25.2Q263.9 -25.5 263.9 -25.9Q263.9 -28.1 263.1 -29.7Q262.2 -31.4 260.6 -32.3Q258.9 -33.2 256.4 -33.2Q254.1 -33.2 252.3 -32.5Q250.5 -31.7 249.1 -30.4Q247.8 -29.1 246.9 -27.3Q246 -25.5 245.6 -23.3Q245.3 -21.5 245.1 -20.3Q244.9 -19.2 244.9 -18.5Q244.8 -17.8 244.7 -17.4Q244.7 -17.1 244.7 -16.7Q244.7 -14.6 245.5 -12.9Q246.3 -11.3 248 -10.4Q249.7 -9.5 252.2 -9.5Z M279 0 286.5 -42.7H311.2Q314.8 -42.7 317.4 -41.1Q320.1 -39.6 321.6 -36.9Q323 -34.2 323 -30.6Q323 -27.1 321.9 -24.0Q320.8 -21 318.6 -18.7Q316.5 -16.4 313.5 -15.1Q310.6 -13.8 306.9 -13.8H295.1L292.7 0.0ZM296.9 -23.7H304.0Q305.8 -23.7 306.8 -24.5Q307.9 -25.2 308.4 -26.5Q309 -27.7 309 -29.2Q309 -30.8 308 -31.7Q307.1 -32.5 305.1 -32.5H298.4Z" />
      {/* AUTO, shifted right to open the 22.5-unit gap the bolt sits in */}
      <path fill={BODY} d="M334.7 0 357.9 -42.7H373.9L381.8 0.0H367.7L367 -6.0H352.0L349.1 0.0ZM356.5 -15.6H365.8L365 -22.4Q364.9 -23.4 364.7 -24.5Q364.6 -25.5 364.5 -26.6Q364.3 -27.6 364.2 -28.6Q364.1 -29.7 363.9 -30.8H363.7Q363.1 -29.4 362.4 -28.0Q361.7 -26.6 361.1 -25.2Q360.4 -23.8 359.7 -22.4Z M406.7 0.7Q397.8 0.7 392.8 -2.8Q387.7 -6.4 387.7 -13.5Q387.7 -14.4 387.8 -15.4Q387.9 -16.4 388 -17.5L392.5 -42.7H406.2L401.7 -17.4Q401.7 -16.9 401.6 -16.4Q401.6 -15.9 401.6 -15.4Q401.6 -12.7 403.1 -11.1Q404.6 -9.5 407.8 -9.5Q411.6 -9.5 413.9 -11.7Q416.2 -13.9 416.8 -17.4L421.3 -42.7H435.0L430.4 -16.6Q429.4 -10.8 426.3 -6.9Q423.2 -3.1 418.3 -1.2Q413.3 0.7 406.7 0.7Z M445.6 0 451.2 -31.7H437.2L439.1 -42.7H480.8L478.9 -31.7H464.9L459.3 0.0Z M499 0.7Q492.6 0.7 488 -1.2Q483.5 -3.1 481.1 -6.9Q478.8 -10.7 478.8 -16.4Q478.8 -17.7 478.9 -19.1Q479.1 -20.5 479.3 -21.9Q480.6 -29 483.8 -33.8Q487 -38.6 492.4 -41.0Q497.8 -43.4 505.6 -43.4Q512.1 -43.4 516.6 -41.5Q521.2 -39.6 523.5 -35.7Q525.9 -31.9 525.9 -26.1Q525.9 -24.9 525.8 -23.5Q525.6 -22.1 525.4 -20.7Q524.2 -13.6 520.8 -8.9Q517.5 -4.1 512.1 -1.7Q506.7 0.7 499 0.7ZM500.2 -9.5Q502.5 -9.5 504.3 -10.2Q506.1 -10.9 507.5 -12.2Q508.8 -13.5 509.7 -15.3Q510.6 -17.2 511 -19.3Q511.3 -21.1 511.5 -22.3Q511.7 -23.4 511.8 -24.1Q511.9 -24.8 511.9 -25.2Q511.9 -25.5 511.9 -25.9Q511.9 -28.1 511.1 -29.7Q510.3 -31.4 508.6 -32.3Q506.9 -33.2 504.4 -33.2Q502.1 -33.2 500.3 -32.5Q498.5 -31.7 497.2 -30.4Q495.8 -29.1 494.9 -27.3Q494 -25.5 493.7 -23.3Q493.3 -21.5 493.2 -20.3Q493 -19.2 492.9 -18.5Q492.8 -17.8 492.8 -17.4Q492.7 -17.1 492.7 -16.7Q492.7 -14.6 493.5 -12.9Q494.3 -11.3 496 -10.4Q497.7 -9.5 500.2 -9.5Z" transform={`translate(${AUTO_SHIFT} 0)`} />
      {/* the bolt — replaces the slash, and is why the viewBox is taller than the caps */}
      <path fill={CHEVRON} d="M349.1 -54 340.9 -29 352.9 -28.4 326 13.5 334.6 -15.5 323.4 -16.1Z" />
    </svg>
  );
}

/* -------------------------------------------------------------- lockup */

function Sub({ size, tracking, gap }: { size: number; tracking: number; gap: number }) {
  return (
    <span
      className={`font-semibold uppercase ${MUTED}`}
      style={{ fontSize: size, letterSpacing: tracking, marginTop: gap, lineHeight: 1 }}
    >
      A Litespeed company
    </span>
  );
}

/**
 * Mark + wordmark + "A Litespeed company".
 *
 * `compact` is the 240px admin sidebar, and it **stacks** — mark above wordmark. A row
 * does not work there: 240px minus 20px padding each side leaves 200px, and a mark small
 * enough to sit beside the wordmark is below the legibility floor. Stacking buys the mark
 * its full width and costs ~50px of vertical space, which a sidebar has to spare.
 *
 * The default is the sign-in chrome (max-w-sm = 384px), which has room for a row and so
 * matches the marketing-site nav.
 */
export function RooftopLockup({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-col items-start" style={{ gap: 10 }}>
        <RooftopMark width={150} />
        <div className="flex flex-col">
          <RooftopWordmark height={13} />
          <Sub size={8.5} tracking={1.3} gap={4} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center" style={{ gap: 12 }}>
      <RooftopMark width={104} className="shrink-0" />
      <div className="flex flex-col">
        <RooftopWordmark height={17} />
        <Sub size={9.5} tracking={1.7} gap={5} />
      </div>
    </div>
  );
}
