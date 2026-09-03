/**
 * Brand marks — the same lockup the marketing site uses (rooftopauto.com).
 *
 * MARK: the house/car glyph (brand icon v3, Sep 2026). Traced from the 492px app-icon
 * PNG with potrace and copied out of `public/rooftop-mark-house-white.svg`, which is the
 * master — see `claude/brand-icon-v3.md`. The same glyph is the `<symbol id="ra-mark">`
 * in all six pages under `site/`; keep the two in step.
 *
 * **The v2 line-art coupe is gone.** It was retired everywhere else on 2 Sep 2026 and
 * survived here only because `RooftopLockup` was left alone in that pass, which is why
 * the signed-out chrome kept showing a car the brand no longer uses. Do not bring it
 * back; if you need the old art it is in git.
 *
 * The glyph is 1346:1114 — near square, where the coupe was 2.6:1 — so it is sized by
 * HEIGHT here, and it holds up small in a way the coupe never did (the favicon is the
 * same art at 16px). The two paths are roof-plus-chimney and car-with-windshield-hole;
 * they are a set and both are required.
 *
 * THE TRANSFORMS ARE LOAD-BEARING. potrace emits its coordinates flipped, so the
 * `translate(0,1968) scale(0.1,-0.1)` wrapper is what puts the glyph the right way up —
 * it is not decoration and it is not removable. The offset viewBox `326 426 …` is fine
 * on a standalone `<svg>` like this one; it is only inside a `<symbol>` that it crops,
 * which is why the marketing site normalizes it and this does not.
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

/**
 * The glyph, in two paths, exactly as `public/rooftop-mark-house-white.svg` holds them.
 * Do not hand-edit: re-render from the master and paste, or the roof line drifts off the
 * car and nobody notices until it is on a favicon.
 */
const HOUSE_ROOF_D =
  'M9900 15406 c-19 -6 -57 -27 -85 -46 -27 -19 -57 -39 -67 -45 -9 -5 -49 -33 -90 -61 -40 -28 -107 -74 -148 -102 -41 -29 -111 -77 -155 -107 -44 -31 -123 -85 -175 -120 -52 -36 -113 -77 -136 -92 -22 -16 -47 -32 -56 -38 -15 -10 -26 -18 -173 -120 -77 -53 -163 -112 -385 -263 -58 -40 -124 -85 -148 -102 -23 -16 -46 -30 -49 -30 -4 0 -16 -8 -27 -19 -20 -18 -114 -83 -311 -215 -49 -34 -92 -63 -95 -66 -3 -3 -57 -40 -120 -83 -63 -42 -151 -102 -195 -132 -44 -31 -109 -76 -145 -100 -36 -25 -113 -77 -171 -117 -58 -40 -152 -104 -208 -143 -56 -38 -113 -77 -126 -85 -12 -8 -45 -30 -71 -49 -27 -19 -94 -65 -149 -103 -55 -37 -136 -93 -180 -123 -44 -31 -123 -85 -175 -120 -52 -36 -114 -78 -138 -95 -23 -16 -46 -30 -51 -30 -5 0 -14 -7 -21 -15 -7 -8 -62 -48 -124 -90 -61 -41 -160 -109 -221 -150 -60 -42 -153 -105 -205 -140 -52 -36 -114 -78 -138 -95 -23 -16 -46 -30 -49 -30 -4 0 -16 -8 -27 -19 -20 -18 -114 -83 -311 -215 -49 -34 -92 -63 -95 -66 -5 -6 -164 -114 -204 -140 -13 -8 -57 -38 -97 -66 -41 -28 -108 -74 -149 -102 -41 -29 -111 -77 -155 -107 -44 -31 -123 -85 -175 -120 -52 -36 -113 -77 -136 -92 -22 -16 -47 -32 -56 -38 -16 -11 -45 -31 -173 -120 -44 -30 -123 -84 -175 -120 -270 -183 -268 -180 -288 -251 -16 -56 -17 -657 -1 -722 27 -111 117 -168 247 -160 81 6 116 21 236 106 26 17 51 32 55 32 5 0 14 7 21 15 7 8 49 39 94 70 44 30 117 80 161 110 44 31 123 85 175 120 52 36 114 78 138 95 23 16 46 30 51 30 5 0 14 7 21 15 7 8 49 39 94 70 44 30 117 80 161 110 44 31 123 85 175 120 52 36 114 78 138 95 23 16 46 30 51 30 5 0 14 7 21 15 7 8 49 39 94 70 44 30 117 80 161 110 44 31 123 85 175 120 52 36 114 78 138 95 23 16 46 30 51 30 5 0 14 7 21 15 7 8 49 39 94 70 44 30 117 80 161 110 44 31 123 85 175 120 52 36 114 78 138 95 23 16 46 30 49 30 4 0 16 8 27 19 12 10 66 49 121 87 55 37 136 92 180 123 44 30 112 76 150 103 39 26 89 61 113 78 23 16 46 30 49 30 4 0 16 8 27 19 12 10 66 49 121 87 55 37 136 92 180 123 44 30 112 76 150 103 39 26 89 61 113 78 23 16 46 30 49 30 4 0 16 8 27 19 12 10 66 49 121 87 55 37 136 92 180 123 44 30 112 76 150 103 39 26 89 61 113 78 23 16 46 30 49 30 4 0 16 8 27 19 20 18 114 83 311 215 50 34 92 63 95 66 5 6 163 114 204 140 13 8 46 30 72 49 27 19 94 65 149 103 55 37 136 93 180 123 44 31 123 85 175 120 52 36 114 78 138 95 23 16 46 30 51 30 5 0 14 7 21 15 7 8 49 39 94 70 44 30 100 68 124 85 23 16 48 30 55 30 7 0 41 -21 77 -46 36 -25 108 -74 160 -109 145 -98 290 -198 344 -236 26 -19 55 -38 64 -44 8 -5 34 -22 56 -38 23 -15 84 -56 136 -92 52 -35 145 -98 205 -140 61 -41 160 -109 221 -150 62 -42 117 -82 124 -90 7 -8 16 -15 21 -15 5 0 28 -14 51 -30 24 -17 99 -68 168 -115 69 -46 175 -118 235 -160 61 -41 155 -106 210 -143 55 -38 122 -84 148 -103 27 -19 56 -39 65 -44 23 -14 77 -51 207 -140 61 -42 153 -105 205 -140 52 -36 131 -90 175 -120 145 -101 158 -110 174 -120 25 -16 90 -60 166 -113 111 -77 263 -181 350 -240 44 -30 89 -63 101 -73 11 -10 23 -19 27 -19 3 0 26 -14 49 -30 24 -17 86 -59 138 -95 52 -35 131 -89 175 -120 44 -30 125 -86 180 -123 55 -38 122 -84 149 -103 26 -19 59 -41 72 -49 13 -8 69 -47 126 -86 238 -163 307 -211 383 -262 44 -30 89 -63 101 -73 11 -10 23 -19 27 -19 3 0 26 -14 49 -30 24 -17 86 -59 138 -95 52 -35 131 -89 175 -120 44 -30 125 -86 180 -123 55 -38 122 -84 149 -103 26 -19 59 -41 72 -49 13 -8 69 -47 126 -86 57 -39 148 -101 203 -139 55 -38 121 -83 146 -101 105 -73 151 -83 241 -53 71 24 107 53 144 116 l25 43 -3 358 c-3 352 -3 358 -26 402 -16 29 -42 57 -75 80 -29 19 -54 37 -57 40 -3 3 -43 31 -90 63 -224 150 -297 200 -316 218 -11 10 -23 19 -27 19 -3 0 -26 14 -49 30 -24 17 -86 59 -138 95 -52 35 -131 89 -175 120 -77 53 -127 88 -299 206 -43 30 -89 61 -102 69 -40 26 -199 134 -204 140 -3 3 -45 32 -95 66 -197 132 -291 197 -311 215 -11 11 -23 19 -27 19 -3 0 -27 15 -52 33 -26 17 -54 37 -63 42 -10 6 -37 24 -61 40 -24 17 -51 35 -60 40 -9 6 -36 24 -60 40 -77 52 -95 64 -123 80 l-28 16 0 1193 0 1194 -32 43 c-18 23 -46 52 -61 63 -28 21 -33 21 -752 21 l-723 0 -48 -41 c-27 -22 -54 -52 -61 -65 -9 -18 -14 -188 -19 -612 -4 -323 -11 -590 -16 -593 -10 -7 -56 21 -208 127 -63 43 -179 122 -256 174 -78 53 -147 102 -154 110 -7 8 -16 15 -21 15 -5 0 -28 14 -51 30 -24 17 -99 68 -168 115 -69 46 -174 118 -235 160 -60 41 -174 118 -251 170 -78 53 -147 102 -154 110 -7 8 -16 15 -21 15 -5 0 -28 14 -51 30 -24 17 -99 68 -168 115 -69 46 -174 118 -235 160 -60 41 -174 118 -251 170 -78 53 -147 102 -154 110 -7 8 -18 15 -25 15 -7 0 -23 8 -36 18 -52 39 -156 52 -229 28z';
const HOUSE_CAR_D =
  'M9345 11489 c-115 -4 -273 -10 -350 -13 -203 -7 -935 -66 -1075 -87 -144 -21 -244 -46 -380 -96 -110 -41 -300 -142 -372 -198 -14 -11 -39 -29 -54 -40 -91 -65 -279 -246 -354 -340 -25 -31 -50 -62 -55 -68 -12 -15 -111 -165 -150 -229 -5 -9 -29 -49 -53 -90 -24 -40 -52 -86 -62 -103 -10 -16 -37 -61 -60 -100 -23 -38 -50 -83 -60 -100 -10 -16 -38 -63 -62 -104 -24 -40 -53 -90 -65 -110 -12 -20 -25 -43 -29 -51 -4 -8 -25 -41 -46 -73 -21 -32 -38 -61 -38 -64 0 -3 -15 -29 -33 -57 -18 -28 -47 -73 -65 -101 -57 -90 -70 -95 -102 -37 -11 20 -29 51 -40 67 -11 17 -28 46 -39 65 -31 53 -54 77 -97 99 -78 41 -152 45 -524 29 -372 -16 -387 -19 -456 -79 -72 -62 -104 -141 -104 -259 0 -145 46 -243 151 -322 58 -43 324 -122 516 -154 192 -31 243 -41 250 -48 4 -4 -17 -30 -47 -58 -30 -27 -147 -141 -259 -252 -185 -182 -285 -297 -319 -366 -7 -14 -21 -38 -32 -55 -11 -16 -25 -41 -31 -55 -6 -14 -19 -42 -30 -62 -10 -20 -19 -43 -19 -50 0 -7 -7 -26 -16 -43 -16 -30 -44 -118 -82 -255 -34 -124 -60 -277 -72 -415 -12 -151 -13 -1556 -1 -2040 8 -294 10 -325 31 -383 47 -135 91 -204 189 -302 79 -79 138 -123 181 -135 14 -4 30 -12 37 -17 6 -5 47 -19 90 -30 75 -21 102 -22 764 -25 665 -3 687 -3 744 17 32 11 66 20 76 20 17 0 80 27 119 51 8 5 33 18 55 30 22 12 72 54 111 93 96 96 149 181 234 371 83 186 115 237 188 301 40 35 80 64 90 64 9 0 31 8 47 18 28 16 164 17 2395 17 l2365 0 81 -33 c158 -64 190 -105 318 -407 14 -33 36 -80 50 -105 14 -25 34 -61 45 -80 49 -90 219 -244 321 -292 129 -60 103 -58 888 -59 695 0 723 1 801 21 237 60 422 245 481 480 18 71 19 141 23 1255 5 1148 3 1251 -27 1420 -23 131 -86 350 -113 390 -7 11 -13 26 -13 33 0 13 -87 195 -113 236 -83 134 -114 169 -510 571 -64 65 -116 124 -114 130 2 5 37 15 78 22 170 26 218 35 286 54 40 10 81 19 90 19 21 0 131 35 191 61 23 11 47 19 52 19 19 0 100 62 128 98 64 81 74 114 76 251 1 120 0 128 -26 171 -38 63 -84 105 -148 134 -53 23 -68 25 -415 36 -396 14 -442 10 -516 -38 -23 -15 -50 -43 -60 -62 -11 -19 -30 -53 -43 -75 -13 -22 -30 -51 -38 -65 -30 -54 -43 -70 -55 -70 -7 0 -29 30 -50 66 -21 36 -46 78 -56 92 -9 15 -24 41 -32 57 -9 17 -29 50 -45 75 -16 25 -34 54 -40 65 -6 11 -22 38 -35 60 -13 22 -34 56 -45 75 -11 19 -29 49 -40 65 -11 17 -27 44 -35 60 -9 17 -29 50 -45 75 -16 25 -34 54 -40 65 -6 11 -22 38 -35 60 -13 22 -34 56 -45 75 -11 19 -29 49 -40 65 -11 17 -26 41 -33 55 -6 14 -43 72 -82 129 -38 57 -77 114 -86 127 -78 118 -325 353 -474 451 -145 95 -146 96 -195 119 -242 114 -433 170 -620 181 -41 2 -131 11 -200 19 -69 9 -161 18 -205 20 -44 2 -170 11 -280 19 -541 41 -1381 56 -1960 34z m1540 -644 c198 -9 416 -20 485 -26 69 -6 161 -12 205 -14 223 -12 416 -36 515 -65 36 -11 76 -22 90 -25 26 -7 48 -16 145 -61 188 -87 356 -243 461 -427 21 -38 47 -81 56 -95 9 -15 36 -60 60 -101 24 -40 53 -90 65 -110 12 -20 27 -45 33 -56 6 -11 21 -36 33 -57 19 -32 47 -77 122 -203 11 -18 47 -80 80 -136 33 -56 69 -117 80 -135 71 -116 125 -214 125 -228 0 -15 -275 -16 -3449 -16 -1995 0 -3452 4 -3455 9 -3 5 1 14 9 21 8 7 15 16 15 21 0 5 24 50 53 99 28 50 60 105 70 123 10 18 26 46 37 62 11 17 29 46 40 65 11 19 32 53 45 75 13 22 29 49 35 60 6 11 21 36 33 56 12 20 41 70 65 110 24 41 52 88 62 104 10 17 38 63 62 104 24 40 53 90 65 110 12 20 25 43 30 51 46 94 171 259 245 325 77 68 157 122 243 163 128 62 255 101 355 111 42 5 81 11 86 14 5 3 63 10 129 16 385 34 492 42 695 50 124 5 234 10 245 10 462 22 1140 20 1730 -4z';

/** 1346:1114. Height drives it — see the note about sizing in the file header. */
const MARK_RATIO = 1346 / 1114;

/**
 * The house/car mark. `height` drives it, unlike the coupe it replaced.
 *
 * `color` defaults to the one brand blue. The master art is white-on-blue as an app
 * icon; on a page it is the glyph in blue on whatever the page is, which is why this
 * takes a fill rather than shipping a tile.
 */
export function RooftopMark({
  height = 40,
  color = CHEVRON,
  className,
}: {
  height?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={Math.round(height * MARK_RATIO)}
      height={height}
      viewBox="326 426 1346 1114"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(0,1968) scale(0.1,-0.1)" fill={color} stroke="none">
        <path d={HOUSE_ROOF_D} />
        <path d={HOUSE_CAR_D} />
      </g>
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
 * Mark + wordmark + "A Litespeed company". The signed-out chrome — sign in, sign up,
 * forgot password, /install.
 *
 * **Both variants are rows now.** `compact` used to stack, because the v2 coupe needed
 * 150px of width to stay legible and the 240px sidebar had only 200px after padding.
 * The house glyph is near square and reads at 16px, so that constraint is gone and the
 * two variants differ only in scale. Kept as separate cases rather than collapsed to one,
 * because the sizes are tuned to their containers and a single lockup would be tuned to
 * neither.
 *
 * The mark is set a little taller than the wordmark in both, matching the marketing-site
 * nav: the glyph's visual weight sits below its bounding box because of the roof line,
 * so matching the boxes exactly makes it look small.
 */
export function RooftopLockup({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center" style={{ gap: 10 }}>
        <RooftopMark height={32} className="shrink-0" />
        <div className="flex flex-col">
          <RooftopWordmark height={13} />
          <Sub size={8.5} tracking={1.3} gap={4} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center" style={{ gap: 12 }}>
      <RooftopMark height={42} className="shrink-0" />
      <div className="flex flex-col">
        <RooftopWordmark height={17} />
        <Sub size={9.5} tracking={1.7} gap={5} />
      </div>
    </div>
  );
}
