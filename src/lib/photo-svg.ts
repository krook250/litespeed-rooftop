/**
 * Deterministic vehicle photo generator.
 *
 * The demo ships without real lot photography, and gray placeholder boxes would
 * sink a VDP demo. These are studio-style vector renders keyed off the VIN, so
 * every unit gets a consistent, intentional-looking photo set in its real
 * exterior color. Real dealer photos replace these by URL — nothing else changes.
 */

export type PhotoScene =
  | 'EXTERIOR_FRONT'
  | 'EXTERIOR_SIDE'
  | 'EXTERIOR_REAR'
  | 'INTERIOR'
  | 'ODOMETER'
  | 'ENGINE';

export type PhotoBody =
  | 'SEDAN' | 'SUV' | 'TRUCK' | 'COUPE' | 'HATCHBACK' | 'WAGON' | 'VAN' | 'CONVERTIBLE';

export interface PhotoSpec {
  scene: PhotoScene;
  body: PhotoBody;
  hex: string;
  label: string;      // watermark line 1 — dealer name
  sublabel: string;   // watermark line 2 — stock number
  mileage?: number;
  seed?: string;
}

/* ------------------------------------------------------------------ color */

function clamp(n: number) { return Math.max(0, Math.min(255, Math.round(n))); }

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

export function shade(hex: string, amount: number) {
  const [r, g, b] = parseHex(hex);
  if (amount >= 0) {
    return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  }
  const k = 1 + amount;
  return toHex(r * k, g * k, b * k);
}

function luminance(hex: string) {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/* --------------------------------------------------------------- geometry */

interface Geometry {
  body: string;
  glass: string;
  extraGlass?: string;
  pillarX?: number;
  frontWheelX: number;
  rearWheelX: number;
  wheelR: number;
  wheelCY: number;
  beltline?: string;
}

const GEO: Record<PhotoBody, Geometry> = {
  SEDAN: {
    body:
      'M148 542 L148 500 Q150 466 200 454 L342 428 L436 352 Q470 324 548 320 L740 320 ' +
      'Q812 322 848 366 L902 432 L1030 450 Q1062 458 1062 498 L1062 542 Q1062 566 1036 566 ' +
      'L174 566 Q148 566 148 542 Z',
    glass: 'M462 352 Q492 336 552 334 L730 334 Q784 336 812 372 L856 428 L440 428 Z',
    pillarX: 640,
    frontWheelX: 352, rearWheelX: 886, wheelR: 86, wheelCY: 556,
    beltline: 'M300 442 L1044 462',
  },
  WAGON: {
    body:
      'M148 542 L148 500 Q150 466 200 454 L342 428 L436 352 Q470 326 548 322 L866 322 ' +
      'Q906 324 918 344 L1020 430 Q1058 442 1060 490 L1060 542 Q1060 566 1034 566 ' +
      'L174 566 Q148 566 148 542 Z',
    glass: 'M462 352 Q492 338 552 336 L862 336 Q890 338 900 354 L962 424 L440 424 Z',
    pillarX: 660,
    frontWheelX: 352, rearWheelX: 890, wheelR: 86, wheelCY: 556,
    beltline: 'M300 440 L1040 456',
  },
  SUV: {
    body:
      'M146 546 L146 480 Q148 440 196 426 L316 400 L390 296 Q418 264 486 260 L878 260 ' +
      'Q920 262 936 288 L1000 384 Q1054 400 1058 466 L1058 546 Q1058 570 1030 570 ' +
      'L174 570 Q146 570 146 546 Z',
    glass: 'M414 296 Q438 278 492 276 L872 276 Q900 278 912 298 L966 380 L396 380 Z',
    pillarX: 622,
    frontWheelX: 344, rearWheelX: 900, wheelR: 100, wheelCY: 548,
    beltline: 'M276 412 L1046 430',
  },
  TRUCK: {
    body:
      'M142 548 L142 486 Q144 444 196 430 L332 402 L406 288 Q432 260 496 258 L720 258 ' +
      'Q748 260 754 288 L754 400 L1076 400 Q1096 402 1096 438 L1096 548 Q1096 572 1064 572 ' +
      'L172 572 Q142 572 142 548 Z',
    glass: 'M430 292 Q450 276 498 274 L718 274 L718 392 L410 392 Z',
    pillarX: 580,
    frontWheelX: 340, rearWheelX: 940, wheelR: 104, wheelCY: 548,
    beltline: 'M276 414 L1080 424',
  },
  COUPE: {
    body:
      'M150 540 L150 500 Q152 468 200 456 L346 430 L458 348 Q500 322 570 320 L714 320 ' +
      'Q782 326 812 366 L906 436 L1030 452 Q1060 460 1060 500 L1060 540 Q1060 564 1034 564 ' +
      'L176 564 Q150 564 150 540 Z',
    glass: 'M482 352 Q516 336 574 334 L706 334 Q762 338 786 372 L836 430 L462 430 Z',
    frontWheelX: 356, rearWheelX: 884, wheelR: 88, wheelCY: 554,
    beltline: 'M300 444 L1044 462',
  },
  CONVERTIBLE: {
    body:
      'M150 540 L150 500 Q152 468 200 456 L346 430 L458 348 Q500 322 570 320 L714 320 ' +
      'Q782 326 812 366 L906 436 L1030 452 Q1060 460 1060 500 L1060 540 Q1060 564 1034 564 ' +
      'L176 564 Q150 564 150 540 Z',
    glass: 'M482 352 Q516 336 574 334 L706 334 Q762 338 786 372 L836 430 L462 430 Z',
    frontWheelX: 356, rearWheelX: 884, wheelR: 88, wheelCY: 554,
    beltline: 'M300 444 L1044 462',
  },
  HATCHBACK: {
    body:
      'M152 542 L152 500 Q154 468 202 456 L338 430 L428 350 Q458 326 522 324 L792 324 ' +
      'Q846 328 868 360 L918 430 L962 444 Q998 452 1000 492 L1000 542 Q1000 566 974 566 ' +
      'L178 566 Q152 566 152 542 Z',
    glass: 'M454 352 Q480 338 528 336 L790 336 Q828 340 846 366 L892 426 L434 426 Z',
    pillarX: 636,
    frontWheelX: 350, rearWheelX: 838, wheelR: 84, wheelCY: 556,
    beltline: 'M300 442 L984 458',
  },
  VAN: {
    body:
      'M144 552 L144 470 Q146 420 190 400 L298 296 Q330 260 402 256 L1002 256 ' +
      'Q1064 260 1068 320 L1068 552 Q1068 576 1036 576 L172 576 Q144 576 144 552 Z',
    glass: 'M330 300 Q354 278 406 276 L558 276 L558 392 L294 392 Z',
    extraGlass: 'M596 276 L1002 276 L1002 392 L596 392 Z',
    frontWheelX: 336, rearWheelX: 942, wheelR: 96, wheelCY: 552,
    beltline: 'M276 414 L1052 422',
  },
};

/* ------------------------------------------------------------- primitives */

function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function wheel(cx: number, cy: number, r: number) {
  const spokes = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(a) * (r * 0.16);
    const y1 = cy + Math.sin(a) * (r * 0.16);
    const x2 = cx + Math.cos(a) * (r * 0.5);
    const y2 = cy + Math.sin(a) * (r * 0.5);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#cbd5e1" stroke-width="${(r * 0.13).toFixed(1)}" stroke-linecap="round"/>`;
  }).join('');
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#111318"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.995}" fill="none" stroke="#26292f" stroke-width="${(r * 0.06).toFixed(1)}"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="url(#rim)"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="none" stroke="#94a3b8" stroke-width="2"/>
    ${spokes}
    <circle cx="${cx}" cy="${cy}" r="${r * 0.17}" fill="#e2e8f0"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.17}" fill="none" stroke="#94a3b8" stroke-width="2"/>`;
}

function watermark(label: string, sublabel: string) {
  return `
  <g opacity="0.92">
    <rect x="40" y="700" width="${Math.max(210, label.length * 11 + 40)}" height="62" rx="10" fill="#0b1120" opacity="0.72"/>
    <text x="60" y="726" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="19" font-weight="700" fill="#ffffff" letter-spacing="0.5">${escapeXml(label)}</text>
    <text x="60" y="748" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="14" font-weight="500" fill="#93c5fd" letter-spacing="1.2">${escapeXml(sublabel)}</text>
  </g>`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!),
  );
}

function studioDefs(hex: string) {
  const light = shade(hex, 0.42);
  const mid = hex;
  const dark = shade(hex, -0.42);
  const deep = shade(hex, -0.66);
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="55%" stop-color="#e7ecf3"/>
      <stop offset="100%" stop-color="#cfd8e3"/>
    </linearGradient>
    <radialGradient id="spot" cx="50%" cy="38%" r="62%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="26%" stop-color="${mid}"/>
      <stop offset="72%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${dark}"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="#c9d6e5"/>
      <stop offset="45%" stop-color="#7d8ea3"/>
      <stop offset="100%" stop-color="#454f5e"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f1f5f9"/>
      <stop offset="100%" stop-color="#8c96a3"/>
    </linearGradient>
    <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${dark}"/>
      <stop offset="100%" stop-color="${deep}"/>
    </linearGradient>
    <radialGradient id="shadow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

function stage() {
  return `
  <rect width="1200" height="800" fill="url(#bg)"/>
  <rect width="1200" height="800" fill="url(#spot)"/>
  <path d="M0 596 L1200 596 L1200 800 L0 800 Z" fill="#b9c4d2" opacity="0.55"/>
  <path d="M0 596 L1200 596" stroke="#98a6b8" stroke-width="2"/>`;
}

/* ------------------------------------------------------------------ scenes */

function exteriorSide(spec: PhotoSpec, mirrored: boolean, rearThreeQuarter: boolean) {
  const g = GEO[spec.body] ?? GEO.SEDAN;
  const glassExtra = g.extraGlass
    ? `<path d="${g.extraGlass}" fill="url(#glass)" opacity="0.92"/>`
    : '';
  const pillar = g.pillarX
    ? `<rect x="${g.pillarX}" y="330" width="15" height="98" fill="url(#deep)" opacity="0.85"/>`
    : '';
  const headlight = mirrored
    ? ''
    : `<path d="M156 462 Q186 452 232 450 L236 486 Q192 488 158 494 Z" fill="#fdf5d8" opacity="0.95"/>
       <path d="M1030 456 Q1052 460 1056 480 L1056 500 L1016 494 Z" fill="#e0483a" opacity="0.9"/>`;
  const arch = (cx: number) => {
    const r = g.wheelR * 1.14;
    const y = g.wheelCY + 4;
    return `<path d="M${cx - r} ${y} A ${r} ${r} 0 0 1 ${cx + r} ${y} Z" fill="${shade(spec.hex, -0.68)}"/>`;
  };
  const inner = `
    <ellipse cx="600" cy="646" rx="470" ry="34" fill="url(#shadow)"/>
    <path d="${g.body}" fill="url(#paint)"/>
    <path d="${g.body}" fill="none" stroke="${shade(spec.hex, -0.55)}" stroke-width="3" stroke-linejoin="round"/>
    <path d="${g.glass}" fill="url(#glass)" opacity="0.92"/>
    ${glassExtra}
    ${pillar}
    ${g.beltline ? `<path d="${g.beltline}" stroke="${shade(spec.hex, 0.28)}" stroke-width="4" opacity="0.55" fill="none"/>` : ''}
    <path d="M240 496 Q600 476 990 494" stroke="${shade(spec.hex, 0.5)}" stroke-width="6" opacity="0.35" fill="none"/>
    ${headlight}
    ${arch(g.frontWheelX)}
    ${arch(g.rearWheelX)}
    ${wheel(g.frontWheelX, g.wheelCY, g.wheelR)}
    ${wheel(g.rearWheelX, g.wheelCY, g.wheelR)}`;

  const transform = mirrored
    ? ' transform="translate(1200,0) scale(-1,1)"'
    : rearThreeQuarter
      ? ' transform="translate(1180,40) scale(-0.94,0.94)"'
      : '';
  return `<g${transform}>${inner}</g>`;
}

function exteriorFront(spec: PhotoSpec) {
  const light = shade(spec.hex, 0.34);
  const dark = shade(spec.hex, -0.44);
  const deep = shade(spec.hex, -0.66);
  const tall = spec.body === 'SUV' || spec.body === 'TRUCK' || spec.body === 'VAN';
  const roofY = tall ? 230 : 268;
  const glassY = roofY + 22;
  const beltY = tall ? 392 : 412;
  const shell =
    `M302 620 L302 ${beltY - 42} Q302 ${roofY + 96} 356 ${roofY + 62} L420 ${roofY + 22} ` +
    `Q456 ${roofY} 600 ${roofY} Q744 ${roofY} 780 ${roofY + 22} L844 ${roofY + 62} ` +
    `Q898 ${roofY + 96} 898 ${beltY - 42} L898 620 Q898 646 866 646 L334 646 Q302 646 302 620 Z`;
  return `
  <ellipse cx="600" cy="672" rx="336" ry="30" fill="url(#shadow)"/>
  <path d="${shell}" fill="url(#paint)"/>
  <path d="${shell}" fill="none" stroke="${shade(spec.hex, -0.55)}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M388 ${glassY + 46} Q444 ${glassY + 8} 600 ${glassY + 6} Q756 ${glassY + 8} 812 ${glassY + 46} L830 ${beltY - 8} L370 ${beltY - 8} Z" fill="url(#glass)" opacity="0.94"/>
  <rect x="366" y="${beltY - 8}" width="468" height="12" rx="6" fill="${dark}"/>
  <path d="M286 ${beltY + 6} L302 ${beltY + 2} L302 ${beltY + 44} L286 ${beltY + 40} Z" fill="${light}"/>
  <path d="M914 ${beltY + 6} L898 ${beltY + 2} L898 ${beltY + 44} L914 ${beltY + 40} Z" fill="${light}"/>
  <path d="M320 ${beltY + 38} L466 ${beltY + 32} L470 ${beltY + 78} L320 ${beltY + 84} Z" fill="#fdf6dd"/>
  <path d="M320 ${beltY + 38} L466 ${beltY + 32} L470 ${beltY + 78} L320 ${beltY + 84} Z" fill="none" stroke="${deep}" stroke-width="3"/>
  <path d="M880 ${beltY + 38} L734 ${beltY + 32} L730 ${beltY + 78} L880 ${beltY + 84} Z" fill="#fdf6dd"/>
  <path d="M880 ${beltY + 38} L734 ${beltY + 32} L730 ${beltY + 78} L880 ${beltY + 84} Z" fill="none" stroke="${deep}" stroke-width="3"/>
  <rect x="486" y="${beltY + 34}" width="228" height="54" rx="12" fill="${deep}"/>
  <rect x="500" y="${beltY + 46}" width="200" height="30" rx="6" fill="${shade(spec.hex, -0.78)}"/>
  <rect x="574" y="${beltY + 50}" width="52" height="22" rx="4" fill="${light}" opacity="0.8"/>
  <rect x="302" y="${beltY + 108}" width="596" height="66" rx="14" fill="${shade(spec.hex, -0.52)}"/>
  <rect x="430" y="${beltY + 122}" width="340" height="38" rx="8" fill="${shade(spec.hex, -0.74)}"/>
  <rect x="520" y="${beltY + 128}" width="160" height="26" rx="4" fill="#eef2f7"/>
  <rect x="308" y="600" width="80" height="52" rx="8" fill="#15181d"/>
  <rect x="812" y="600" width="80" height="52" rx="8" fill="#15181d"/>`;
}

function interior(spec: PhotoSpec) {
  const leather = luminance(spec.hex) > 0.62 ? '#8a7a68' : '#3a4150';
  const leatherDark = luminance(spec.hex) > 0.62 ? '#6b5d4e' : '#2a303c';
  return `
  <rect width="1200" height="800" fill="#1a1f28"/>
  <!-- windshield -->
  <path d="M60 0 L1140 0 L1180 210 Q600 262 20 210 Z" fill="#8fa6bd"/>
  <path d="M60 0 L1140 0 L1180 210 Q600 262 20 210 Z" fill="url(#spot)" opacity="0.5"/>
  <path d="M20 210 Q600 262 1180 210 L1200 300 Q600 348 0 300 Z" fill="#11151c"/>
  <!-- dash face -->
  <path d="M0 300 Q600 348 1200 300 L1200 560 Q600 512 0 560 Z" fill="#232935"/>
  <rect x="0" y="540" width="1200" height="260" fill="#1a1f28"/>
  <!-- vents -->
  <rect x="188" y="356" width="150" height="46" rx="12" fill="#0d1118"/>
  <rect x="862" y="356" width="150" height="46" rx="12" fill="#0d1118"/>
  <path d="M200 368 L326 368 M200 380 L326 380 M200 392 L326 392" stroke="#252b35" stroke-width="4"/>
  <path d="M874 368 L1000 368 M874 380 L1000 380 M874 392 L1000 392" stroke="#252b35" stroke-width="4"/>
  <!-- center touchscreen -->
  <rect x="450" y="326" width="300" height="184" rx="16" fill="#080b10"/>
  <rect x="464" y="340" width="272" height="140" rx="8" fill="#0f2a52"/>
  <rect x="480" y="356" width="108" height="14" rx="7" fill="#63a4ff"/>
  <rect x="480" y="382" width="176" height="9" rx="4" fill="#2f63ad"/>
  <rect x="480" y="400" width="140" height="9" rx="4" fill="#2f63ad"/>
  <rect x="480" y="418" width="196" height="9" rx="4" fill="#2f63ad"/>
  <circle cx="700" cy="452" r="18" fill="#63a4ff" opacity="0.9"/>
  <rect x="470" y="490" width="260" height="8" rx="4" fill="#1d2431"/>
  <!-- climate row -->
  <rect x="470" y="522" width="260" height="52" rx="10" fill="#151a23"/>
  <circle cx="510" cy="548" r="18" fill="#2c3442"/>
  <circle cx="690" cy="548" r="18" fill="#2c3442"/>
  <rect x="548" y="540" width="104" height="16" rx="8" fill="#2c3442"/>
  <!-- steering wheel -->
  <g transform="translate(262,486)">
    <ellipse cx="0" cy="0" rx="212" ry="164" fill="none" stroke="#0c1017" stroke-width="34"/>
    <ellipse cx="0" cy="0" rx="212" ry="164" fill="none" stroke="#39414f" stroke-width="5"/>
    <path d="M-150 -6 L150 -6 L150 22 L-150 22 Z" fill="#0c1017"/>
    <path d="M-30 22 L30 22 L46 150 L-46 150 Z" fill="#0c1017"/>
    <circle cx="0" cy="8" r="54" fill="#141922"/>
    <circle cx="0" cy="8" r="54" fill="none" stroke="#3f4857" stroke-width="3"/>
    <circle cx="0" cy="8" r="22" fill="#2c3442"/>
  </g>
  <!-- gauge cluster glow behind wheel -->
  <rect x="150" y="352" width="226" height="96" rx="16" fill="#070a0f"/>
  <circle cx="214" cy="400" r="34" fill="none" stroke="#4b5769" stroke-width="4"/>
  <circle cx="312" cy="400" r="34" fill="none" stroke="#4b5769" stroke-width="4"/>
  <rect x="252" y="392" width="34" height="16" rx="4" fill="#f0b429" opacity="0.85"/>
  <!-- console + shifter -->
  <rect x="470" y="600" width="270" height="200" rx="24" fill="#1e242e"/>
  <rect x="540" y="624" width="76" height="120" rx="34" fill="#0c1017"/>
  <circle cx="578" cy="638" r="26" fill="#39414f"/>
  <rect x="646" y="640" width="72" height="72" rx="14" fill="#151a23"/>
  <!-- seats -->
  <path d="M846 800 L846 548 Q846 504 900 502 L1080 502 Q1136 504 1136 548 L1136 800 Z" fill="${leatherDark}"/>
  <path d="M872 800 L872 556 Q872 530 908 528 L1074 528 Q1110 530 1110 556 L1110 800 Z" fill="${leather}"/>
  <path d="M902 606 L1080 606 M902 676 L1080 676 M902 746 L1080 746" stroke="${leatherDark}" stroke-width="6"/>
  <path d="M0 660 L300 700 L300 800 L0 800 Z" fill="${leatherDark}" opacity="0.9"/>
  ${watermark(spec.label, spec.sublabel)}`;
}

function odometer(spec: PhotoSpec) {
  const miles = (spec.mileage ?? 0).toLocaleString('en-US');
  const tickA = Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI * (0.78 + (i / 8) * 1.44);
    const x1 = 340 + Math.cos(a) * 128, y1 = 400 + Math.sin(a) * 128;
    const x2 = 340 + Math.cos(a) * 104, y2 = 400 + Math.sin(a) * 104;
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#94a3b8" stroke-width="4"/>`;
  }).join('');
  const tickB = Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI * (0.78 + (i / 8) * 1.44);
    const x1 = 860 + Math.cos(a) * 128, y1 = 400 + Math.sin(a) * 128;
    const x2 = 860 + Math.cos(a) * 104, y2 = 400 + Math.sin(a) * 104;
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#94a3b8" stroke-width="4"/>`;
  }).join('');
  return `
  <rect width="1200" height="800" fill="#0b0e14"/>
  <rect x="60" y="140" width="1080" height="520" rx="48" fill="#12161f"/>
  <rect x="60" y="140" width="1080" height="520" rx="48" fill="none" stroke="#232a36" stroke-width="4"/>
  <circle cx="340" cy="400" r="150" fill="#090c12"/>
  <circle cx="340" cy="400" r="150" fill="none" stroke="#2b3342" stroke-width="6"/>
  ${tickA}
  <path d="M340 400 L262 316" stroke="#ef4444" stroke-width="8" stroke-linecap="round"/>
  <circle cx="340" cy="400" r="14" fill="#64748b"/>
  <text x="340" y="500" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" fill="#64748b" letter-spacing="3">RPM</text>
  <circle cx="860" cy="400" r="150" fill="#090c12"/>
  <circle cx="860" cy="400" r="150" fill="none" stroke="#2b3342" stroke-width="6"/>
  ${tickB}
  <path d="M860 400 L790 306" stroke="#ef4444" stroke-width="8" stroke-linecap="round"/>
  <circle cx="860" cy="400" r="14" fill="#64748b"/>
  <text x="860" y="500" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" fill="#64748b" letter-spacing="3">MPH</text>
  <rect x="452" y="352" width="296" height="96" rx="12" fill="#05070b"/>
  <rect x="452" y="352" width="296" height="96" rx="12" fill="none" stroke="#2b3342" stroke-width="3"/>
  <text x="600" y="412" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="52" font-weight="700" fill="#fbbf24" letter-spacing="4">${escapeXml(miles)}</text>
  <text x="600" y="436" text-anchor="middle" font-family="system-ui,sans-serif" font-size="18" fill="#78716c" letter-spacing="6">MILES</text>
  ${watermark(spec.label, spec.sublabel)}`;
}

function engineBay(spec: PhotoSpec) {
  return `
  <rect width="1200" height="800" fill="#cfd6df"/>
  <path d="M0 0 L1200 0 L1200 150 L0 210 Z" fill="${shade(spec.hex, -0.15)}"/>
  <rect x="60" y="180" width="1080" height="580" rx="18" fill="#3c434f"/>
  <rect x="86" y="206" width="1028" height="528" rx="12" fill="#2b313b"/>
  <rect x="300" y="250" width="480" height="230" rx="18" fill="#4b5566"/>
  <rect x="322" y="272" width="436" height="186" rx="12" fill="#5c6779"/>
  <text x="540" y="382" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#cbd5e1" letter-spacing="4">ENGINE</text>
  <rect x="820" y="250" width="230" height="120" rx="12" fill="#1f242c"/>
  <rect x="840" y="272" width="190" height="76" rx="8" fill="#111318"/>
  <rect x="120" y="250" width="150" height="180" rx="12" fill="#59626f"/>
  <rect x="120" y="470" width="380" height="70" rx="10" fill="#1f242c"/>
  <circle cx="880" cy="470" r="62" fill="#1f242c"/>
  <circle cx="880" cy="470" r="40" fill="#3c434f"/>
  <path d="M300 500 Q480 560 700 520 Q860 490 1010 540" stroke="#1a1e25" stroke-width="22" fill="none" stroke-linecap="round"/>
  <path d="M180 560 Q420 620 720 590" stroke="#232830" stroke-width="16" fill="none" stroke-linecap="round"/>
  <rect x="560" y="600" width="220" height="90" rx="10" fill="#f0b429" opacity="0.9"/>
  <rect x="580" y="620" width="180" height="50" rx="6" fill="#1f242c" opacity="0.85"/>
  ${watermark(spec.label, spec.sublabel)}`;
}

/* -------------------------------------------------------------------- api */

export function vehicleSvg(spec: PhotoSpec): string {
  const raw = buildSvg(spec);
  // Namespace every gradient id — several of these render on one page and
  // duplicate ids would make every car take the first car's paint color.
  const uid = 'x' + hashSeed(spec.hex + spec.body + spec.scene + spec.sublabel).toString(36);
  return raw
    .replace(/id="([a-zA-Z]+)"/g, `id="$1-${uid}"`)
    .replace(/url\(#([a-zA-Z]+)\)/g, `url(#$1-${uid})`);
}

function buildSvg(spec: PhotoSpec): string {
  const seed = hashSeed(spec.seed ?? spec.label + spec.sublabel + spec.scene);
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" role="img">${studioDefs(spec.hex)}`;
  const tail = '</svg>';

  switch (spec.scene) {
    case 'INTERIOR':
      return head + interior(spec) + tail;
    case 'ODOMETER':
      return head + odometer(spec) + tail;
    case 'ENGINE':
      return head + engineBay(spec) + tail;
    case 'EXTERIOR_FRONT':
      return head + stage() + exteriorFront(spec) + watermark(spec.label, spec.sublabel) + tail;
    case 'EXTERIOR_REAR':
      return (
        head + stage() + exteriorSide(spec, true, false) + watermark(spec.label, spec.sublabel) + tail
      );
    case 'EXTERIOR_SIDE':
    default:
      return (
        head +
        stage() +
        exteriorSide(spec, seed % 2 === 0 ? false : false, false) +
        watermark(spec.label, spec.sublabel) +
        tail
      );
  }
}

export const PHOTO_SET: PhotoScene[] = [
  'EXTERIOR_SIDE',
  'EXTERIOR_FRONT',
  'EXTERIOR_REAR',
  'INTERIOR',
  'ODOMETER',
  'ENGINE',
];

/** URL for a generated photo. Real photos just replace this string. */
export function generatedPhotoUrl(opts: {
  scene: PhotoScene;
  body: PhotoBody;
  hex: string;
  label: string;
  sublabel: string;
  mileage?: number;
}) {
  const p = new URLSearchParams({
    s: opts.scene,
    b: opts.body,
    c: opts.hex.replace('#', ''),
    l: opts.label,
    k: opts.sublabel,
  });
  if (opts.mileage != null) p.set('m', String(opts.mileage));
  return `/api/photo?${p.toString()}`;
}
