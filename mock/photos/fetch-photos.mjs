#!/usr/bin/env node
/* ============================================================================
   Rooftop Auto — vehicle photo fetcher
   ----------------------------------------------------------------------------
   Pulls real, commercially-usable photos for every vehicle in seed.json from
   Wikimedia Commons and drops them into site/demo/img/veh/.

   Run it from the repo root:   node mock/photos/fetch-photos.mjs
   or double-click              fetch-photos.bat

   It needs internet. Nothing else — no npm install, no API key.

   What it will and will not accept
   --------------------------------
   Only these licenses are downloaded: public domain / CC0 / CC BY / CC BY-SA.
   Anything NonCommercial (NC) or NoDerivatives (ND) is skipped, because this
   is a commercial site. Every file that lands on disk is recorded in
   photos/manifest.json with its author, license and source page, and
   site/demo/credits.html is regenerated from that so the attribution CC BY and
   CC BY-SA require is actually published.

   Expect to keep roughly a third of what lands. Commons is full of parades,
   racetracks, auto-show floors and decal-covered fleet trucks that no filename
   filter can catch, so the frames still have to be looked at. List the keepers
   in photos/curated.json, then run photos/finalize.mjs — it rewrites
   credits.html to cover only what the demo publishes and moves the rest out.

   Re-running is safe: files already on disk are left alone.
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK = path.resolve(HERE, '..');            // mock/
const ROOT = path.resolve(MOCK, '..');            // repo root
const OUT = path.join(ROOT, 'site', 'demo', 'img', 'veh');
const MANIFEST = path.join(HERE, 'manifest.json');
const CREDITS = path.join(ROOT, 'site', 'demo', 'credits.html');

const PER_MODEL = Number(process.env.PER_MODEL || 6);   // photos to keep per vehicle
const WIDTH = Number(process.env.WIDTH || 1100);        // px, Commons resizes for us
const CANDIDATES = 45;                                  // search results to sift per model

/* Wikimedia asks for a real User-Agent that identifies the project and a
   contact. Do not remove it — anonymous scripted access gets blocked. */
const UA = 'RooftopAutoDemo/1.0 (https://rooftopauto.com; david@litespeedmarketing.com) node-fetch';

/* ---------------------------------------------------------------- licensing */

/* Matched against Commons' LicenseShortName. Deliberately an allowlist:
   anything unrecognised is skipped rather than guessed at. */
const OK_LICENSE = [
  /^cc0/i,
  /^public domain/i,
  /^pd(-|\b)/i,
  /^cc by(-sa)? [1-4]\.\d/i,
  /^cc by(-sa)? [1-4]\.\d [a-z]{2}$/i,   // ported, e.g. "CC BY-SA 3.0 DE"
];
const BAD_LICENSE = [/\bnc\b/i, /noncommercial/i, /\bnd\b/i, /noderiv/i, /fair use/i, /non-free/i];

const licenseOk = (name) => {
  if (!name) return false;
  if (BAD_LICENSE.some((r) => r.test(name))) return false;
  return OK_LICENSE.some((r) => r.test(name));
};

/* ------------------------------------------------------------ frame filters */

/* Commons is full of engine bays, dashboards, wrecks, scale models and
   assembly-line shots. None of those read as a dealer photo. */
const REJECT_TITLE = new RegExp([
  'interior', 'dashboard', 'dash\\b', 'engine', 'motor\\b', 'cockpit', 'seat', 'trunk', 'boot\\b',
  'wheel\\b', 'tire', 'tyre', 'badge', 'emblem', 'logo', 'grille close', 'headlight', 'taillight',
  'taillamp', 'headlamp', 'gauge', 'odometer', 'steering', 'engine bay', 'undercarriage', 'chassis',
  'crash', 'wreck', 'accident', 'burn', 'fire\\b', 'junk', 'scrap', 'salvage', 'rust',
  'police', 'sheriff', 'fire department', 'ambulance', 'taxi', 'military',
  'toy\\b', 'diecast', 'scale model', 'miniature', 'lego',
  'assembly', 'factory', 'production line', 'auto show floor plan', 'diagram', 'blueprint',
  'snow plow', 'tow truck', 'camper', 'conversion',
].join('|'), 'i');

const ASPECT_MIN = 1.15;   // landscape-ish only
const ASPECT_MAX = 2.40;
const MIN_WIDTH = 1000;

/* ------------------------------------------------------------------ helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(params) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) {
    u.searchParams.set(k, v);
  }
  const res = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status} for ${params.gsrsearch || ''}`);
  return res.json();
}

/* One vehicle's worth of candidates, best first. */
async function findPhotos(v) {
  // Bias toward the right generation by naming the year and its neighbours.
  const years = [v.year, v.year - 1, v.year + 1, v.year - 2, v.year + 2].join(' OR ');
  const q = `filetype:bitmap "${v.make} ${v.model}" (${years})`;

  let pages = [];
  try {
    const j = await api({
      action: 'query', generator: 'search',
      gsrsearch: q, gsrnamespace: '6', gsrlimit: String(CANDIDATES),
      prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: String(WIDTH),
    });
    pages = j.query?.pages || [];
  } catch (e) {
    console.warn(`  ! search failed (${e.message}) — retrying without year hint`);
  }

  // Sift the year-hinted results first, so we only widen the net when the strict
  // query genuinely came up short. Counting raw `pages` here was the original
  // bug: a model could return 45 hits, have every one of them rejected on
  // licence or subject, and still never reach the fallback.
  let kept = sift(pages);

  if (kept.length < PER_MODEL) {
    // Fall back to the bare model name; the generation may drift a little.
    const j = await api({
      action: 'query', generator: 'search',
      gsrsearch: `filetype:bitmap "${v.make} ${v.model}"`, gsrnamespace: '6',
      gsrlimit: String(CANDIDATES),
      prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: String(WIDTH),
    });
    const seen = new Set(pages.map((p) => p.title));
    const extra = (j.query?.pages || []).filter((p) => !seen.has(p.title));
    const seenFile = new Set(kept.map((k) => k.title));
    kept = kept.concat(sift(extra).filter((k) => !seenFile.has(k.title)));
  }

  return kept.slice(0, PER_MODEL);
}

/* Apply the licence, subject and framing filters to a page list. */
function sift(pages) {
  const kept = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const meta = ii.extmetadata || {};
    const license = strip(meta.LicenseShortName?.value);
    const title = p.title.replace(/^File:/, '');

    if (!licenseOk(license)) continue;
    if (REJECT_TITLE.test(title)) continue;
    if (!ii.width || ii.width < MIN_WIDTH) continue;
    const ar = ii.width / ii.height;
    if (ar < ASPECT_MIN || ar > ASPECT_MAX) continue;
    if (!ii.thumburl) continue;

    kept.push({
      title,
      artist: strip(meta.Artist?.value) || 'Unknown',
      license,
      licenseUrl: strip(meta.LicenseUrl?.value) || '',
      credit: strip(meta.Credit?.value) || '',
      source: ii.descriptionurl,
      thumb: ii.thumburl,
      w: ii.width,
      h: ii.height,
    });
    if (kept.length >= PER_MODEL) break;
  }
  return kept;
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 4096) return 'cached';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4096) throw new Error('suspiciously small');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return `${(buf.length / 1024).toFixed(0)} KB`;
}

/* ------------------------------------------------------------------- credits */

function writeCredits(manifest) {
  const rows = [];
  for (const [key, shots] of Object.entries(manifest)) {
    for (const s of shots) {
      rows.push(`<tr>
  <td><a href="demo/img/veh/${esc(s.file)}">${esc(s.file)}</a></td>
  <td>${esc(key)}</td>
  <td>${esc(s.artist)}</td>
  <td>${s.licenseUrl ? `<a href="${esc(s.licenseUrl)}" rel="license noopener">${esc(s.license)}</a>` : esc(s.license)}</td>
  <td><a href="${esc(s.source)}" rel="noopener">Commons</a></td>
</tr>`);
    }
  }
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Photo credits — Rooftop demo</title>
<style>
  :root{--ink:#0f1620;--ink3:#5b6674;--line:#e3e7ec}
  body{margin:0;padding:48px 22px 80px;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink)}
  .wrap{max-width:1000px;margin:0 auto}
  h1{font-size:32px;letter-spacing:-.03em;margin:0 0 10px}
  p{margin:0 0 18px;color:var(--ink3)}
  a{color:#4f46e5}
  table{border-collapse:collapse;width:100%;margin-top:24px;font-size:14px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-weight:800;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink3)}
  td:first-child{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
</style>
</head><body><div class="wrap">
<h1>Photo credits</h1>
<p>Cascade Motors is a fictional dealership and its inventory is sample data. The
vehicle photographs below are real, and are used under the licenses shown —
public domain, CC0, CC BY or CC BY-SA. Each links back to its source page on
Wikimedia Commons. <a href="../">Back to the demo</a>.</p>
<table>
<thead><tr><th>File</th><th>Used for</th><th>Photographer</th><th>License</th><th>Source</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody></table>
</div></body></html>
`;
  fs.mkdirSync(path.dirname(CREDITS), { recursive: true });
  fs.writeFileSync(CREDITS, html);
}

/* ---------------------------------------------------------------------- run */

const seed = JSON.parse(fs.readFileSync(path.join(MOCK, 'seed.json'), 'utf8'));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

console.log(`Fetching up to ${PER_MODEL} photos each for ${seed.vehicles.length} vehicles.\n`);

let got = 0, missed = [];
for (const v of seed.vehicles) {
  const key = `${v.make} ${v.model}`;
  const dir = slug(key);
  process.stdout.write(`${v.year} ${key}\n`);

  let shots;
  try {
    shots = await findPhotos(v);
  } catch (e) {
    console.warn(`  ! ${e.message}`);
    missed.push(key);
    continue;
  }
  if (!shots.length) {
    console.warn('  ! nothing usable found');
    missed.push(key);
    continue;
  }

  const entries = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const file = `${dir}/${i + 1}.jpg`;
    try {
      const how = await download(s.thumb, path.join(OUT, file));
      console.log(`  ${String(i + 1).padStart(2)}. ${how.padEnd(8)} ${s.license.padEnd(12)} ${s.title.slice(0, 62)}`);
      entries.push({ file, title: s.title, artist: s.artist, license: s.license, licenseUrl: s.licenseUrl, source: s.source });
      got++;
    } catch (e) {
      console.warn(`  ${String(i + 1).padStart(2)}. skipped — ${e.message}`);
    }
    await sleep(220);   // be a good citizen
  }
  if (entries.length) manifest[key] = entries;
  await sleep(320);
}

fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
writeCredits(manifest);

console.log(`\nDone. ${got} photos in site/demo/img/veh/`);
console.log(`  manifest  mock/photos/manifest.json`);
console.log(`  credits   site/demo/credits.html`);
if (missed.length) console.log(`\nNothing found for: ${missed.join(', ')}`);
console.log(`\nNext: tell Claude it finished, and it will cull the bad frames and wire them in.`);
