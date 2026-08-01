/* ============================================================
   Rooftop — vehicle imagery
   The demo ships no external images. Each "photo" is a generated
   placeholder tile keyed to the unit's real paint color and body
   type, so a gallery still reads as "silver crew cab" vs "green
   wagon" without pretending to be photography it isn't.
   Real dealer photos drop straight into photoSet().
   ============================================================ */

/* icon-scale body glyphs, viewBox 0 0 120 44 */
const GLYPH = {
  Sedan: {
    hull: 'M4,30 Q4,25 9,24 L34,21 L48,10 Q51,7 57,7 L80,7 Q86,7 90,10 L104,21 L112,23 Q116,24 116,29 L116,33 Q116,35 113,35 L7,35 Q4,35 4,32 Z',
    wheels: [[30, 34, 8], [92, 34, 8]],
  },
  Wagon: {
    hull: 'M4,30 Q4,25 9,24 L33,20 L45,8 Q48,5 54,5 L92,5 Q97,5 100,8 L110,20 L114,23 Q117,25 117,29 L117,33 Q117,35 114,35 L7,35 Q4,35 4,32 Z',
    wheels: [[30, 34, 8], [94, 34, 8]],
  },
  SUV: {
    hull: 'M4,30 Q4,24 9,23 L32,19 L44,7 Q47,4 53,4 L88,4 Q94,4 97,7 L108,20 L113,23 Q116,25 116,29 L116,33 Q116,35 113,35 L7,35 Q4,35 4,32 Z',
    wheels: [[30, 34, 8.5], [92, 34, 8.5]],
  },
  Pickup: {
    hull: 'M4,30 Q4,24 9,23 L32,19 L44,7 Q47,4 53,4 L76,4 Q81,4 82,8 L84,20 L114,20 Q117,20 117,23 L117,33 Q117,35 114,35 L7,35 Q4,35 4,32 Z',
    wheels: [[30, 34, 8.5], [98, 34, 8.5]],
  },
};
const glyphFor = (v) => GLYPH[v.body] || GLYPH.SUV;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v =>
    Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))))
  );
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 168;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/* A paint-swatch tile: the unit's real color, its body glyph, and honest labelling. */
function tileSVG(v, label, idx, total) {
  const uid = 't' + v.id + idx;
  const paint = v.colorHex;
  const light = isLight(paint);
  const a = shade(paint, light ? -0.06 : 0.30);
  const b = shade(paint, light ? -0.34 : -0.30);
  const ink = light ? '#12161c' : '#ffffff';
  const g = glyphFor(v);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 428" width="760" height="428" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<defs>
  <linearGradient id="bg${uid}" x1="0" y1="0" x2=".65" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient>
  <pattern id="hx${uid}" width="14" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="0" y2="14" stroke="${ink}" stroke-opacity=".05" stroke-width="7"/>
  </pattern>
  <radialGradient id="vg${uid}" cx=".5" cy=".38" r=".78">
    <stop offset="0" stop-color="#fff" stop-opacity="${light ? .55 : .16}"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
</defs>

<rect width="760" height="428" fill="url(#bg${uid})"/>
<rect width="760" height="428" fill="url(#hx${uid})"/>
<rect width="760" height="428" fill="url(#vg${uid})"/>

<g transform="translate(148,150) scale(3.9)" fill="${ink}" opacity=".17">
  <path d="${g.hull}"/>
  ${g.wheels.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}" opacity=".55"/>`).join('')}
</g>

<g fill="${ink}">
  <text x="40" y="62" font-size="15" font-weight="700" letter-spacing="2.4" opacity=".55">${esc(v.year)} ${esc(v.make).toUpperCase()}</text>
  <text x="40" y="98" font-size="30" font-weight="800" letter-spacing="-.4">${esc(v.model)} ${esc(v.trim)}</text>
  <text x="40" y="392" font-size="14" font-weight="700" letter-spacing="1.6" opacity=".62">STK ${esc(v.stock)} · ${esc(v.exteriorColor).toUpperCase()}</text>
  <text x="720" y="392" font-size="14" font-weight="700" letter-spacing="1.6" text-anchor="end" opacity=".62">${esc(label).toUpperCase()}</text>
</g>

<g opacity=".9">
  <rect x="646" y="36" width="76" height="30" rx="15" fill="${ink}" opacity=".14"/>
  <text x="684" y="56" text-anchor="middle" font-size="14" font-weight="800" fill="${ink}" letter-spacing="1" opacity=".8">${idx + 1} / ${total}</text>
</g>
</svg>`;
}

function odoSVG(v) {
  const uid = 'o' + v.id;
  const tick = (cx, n) => Array.from({ length: n }, (_, i) => {
    const ang = (-212 + i * (250 / (n - 1))) * Math.PI / 180;
    return `<line x1="${cx + Math.cos(ang) * 84}" y1="${196 + Math.sin(ang) * 84}" x2="${cx + Math.cos(ang) * 96}" y2="${196 + Math.sin(ang) * 96}" stroke="#cdd5de" stroke-width="3"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 428" width="760" height="428">
<defs><radialGradient id="og${uid}" cx=".5" cy=".44" r=".74"><stop offset="0" stop-color="#242b34"/><stop offset="1" stop-color="#0b0f13"/></radialGradient></defs>
<rect width="760" height="428" fill="url(#og${uid})"/>
<circle cx="232" cy="196" r="104" fill="none" stroke="#39424e" stroke-width="8"/>
<circle cx="528" cy="196" r="104" fill="none" stroke="#39424e" stroke-width="8"/>
${tick(232, 11)}${tick(528, 9)}
<line x1="232" y1="196" x2="152" y2="254" stroke="#df453c" stroke-width="6" stroke-linecap="round"/>
<line x1="528" y1="196" x2="448" y2="254" stroke="#df453c" stroke-width="6" stroke-linecap="round"/>
<circle cx="232" cy="196" r="10" fill="#cdd5de"/><circle cx="528" cy="196" r="10" fill="#cdd5de"/>
<rect x="268" y="290" width="224" height="56" rx="8" fill="#05080b" stroke="#39424e" stroke-width="2"/>
<text x="380" y="330" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="34" font-weight="700" fill="#6fdd9e" letter-spacing="4">${v.mileage.toLocaleString()}</text>
<text x="380" y="374" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#8b95a1" letter-spacing="3">MILES · STK ${v.stock}</text>
</svg>`;
}

const enc = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

const SHOT_LABELS = ['Driver side', 'Front 3/4', 'Rear 3/4', 'Interior', 'Engine bay', 'Wheels', 'Rear seat', 'Cargo'];

function photoSet(v) {
  const n = Math.max(1, Math.min(8, Math.round(v.photoCount / 4)));
  const shots = [];
  for (let i = 0; i < n; i++) {
    shots.push({ label: SHOT_LABELS[i % SHOT_LABELS.length], src: enc(tileSVG(v, SHOT_LABELS[i % SHOT_LABELS.length], i, n + 1)) });
  }
  shots.push({ label: 'Odometer', src: enc(odoSVG(v)) });
  return shots;
}
const heroPhoto = (v) => enc(tileSVG(v, 'Driver side', 0, Math.max(2, Math.round(v.photoCount / 4) + 1)));
