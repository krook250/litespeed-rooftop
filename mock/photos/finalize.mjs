#!/usr/bin/env node
/* ============================================================================
   Rooftop Auto — finalise the vehicle photo set
   ----------------------------------------------------------------------------
   Run after fetch-photos.mjs and after the frames have been culled:

       node mock/photos/finalize.mjs

   It reads photos/curated.json (the keepers) and photos/manifest.json (the
   licence record for everything downloaded) and then:

     1. regenerates site/demo/credits.html so it credits ONLY the photos the
        demo actually publishes — crediting frames nobody can see is noise, and
        missing a credit on one we do publish breaks CC BY / CC BY-SA;
     2. moves every unused frame into site/demo/img/veh/_to_delete/ (gitignored)
        so the folder that ships to Bluehost is the ~11 MB we use, not 29 MB;
     3. writes photos/manifest.used.json — the licence record for the keepers.

   Nothing is deleted. Empty the _to_delete folder by hand once you are happy.
   Safe to re-run.
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK = path.resolve(HERE, '..');
const ROOT = path.resolve(MOCK, '..');
const VEH = path.join(ROOT, 'site', 'demo', 'img', 'veh');
const BIN = path.join(VEH, '_to_delete');
const CREDITS = path.join(ROOT, 'site', 'demo', 'credits.html');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const curated = JSON.parse(fs.readFileSync(path.join(HERE, 'curated.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));

/* file -> licence record, flattened out of the per-model manifest */
const byFile = new Map();
for (const [model, shots] of Object.entries(manifest)) {
  for (const s of shots) byFile.set(s.file, { ...s, model });
}

/* ------------------------------------------------------------ used vs unused */

const used = new Map();          // file -> {record, group}
for (const g of curated.groups) {
  for (const [file, label] of g.shots) {
    const rec = byFile.get(file);
    if (!rec) {
      console.warn(`! ${file} is in curated.json but not in manifest.json — no licence on record, skipping`);
      continue;
    }
    used.set(file, { ...rec, label, group: g });
  }
}

const onDisk = [];
for (const dir of fs.readdirSync(VEH, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === '_to_delete') continue;
  for (const f of fs.readdirSync(path.join(VEH, dir.name))) {
    if (f.endsWith('.jpg')) onDisk.push(`${dir.name}/${f}`);
  }
}
const unused = onDisk.filter((f) => !used.has(f));

/* ------------------------------------------------------------------ 1. credits */

const rows = [];
for (const g of curated.groups) {
  for (const [file] of g.shots) {
    const u = used.get(file);
    if (!u) continue;
    rows.push(`<tr>
  <td><img src="img/veh/${esc(file)}" alt="" loading="lazy"></td>
  <td>${esc(g.make)} ${esc(g.model)}<br><span class="dim">${esc(g.color[0])} · ${esc(u.label)}</span></td>
  <td>${esc(u.artist)}</td>
  <td>${u.licenseUrl ? `<a href="${esc(u.licenseUrl)}" rel="license noopener">${esc(u.license)}</a>` : esc(u.license)}</td>
  <td><a href="${esc(u.source)}" rel="noopener">Commons</a></td>
</tr>`);
  }
}

fs.writeFileSync(CREDITS, `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Photo credits — Rooftop demo</title>
<style>
  :root{--ink:#0f1620;--ink3:#5b6674;--line:#e3e7ec}
  body{margin:0;padding:48px 22px 90px;color:var(--ink);
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:1040px;margin:0 auto}
  h1{font-size:34px;letter-spacing:-.03em;margin:0 0 12px}
  p{margin:0 0 16px;color:var(--ink3);max-width:70ch}
  a{color:#4f46e5}
  table{border-collapse:collapse;width:100%;margin-top:28px;font-size:14px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
  th{font-weight:800;font-size:11.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink3)}
  td img{width:104px;height:66px;object-fit:cover;border-radius:5px;display:block}
  .dim{color:var(--ink3);font-size:12.5px}
</style>
</head><body><div class="wrap">
<h1>Photo credits</h1>
<p>Cascade Motors is a fictional dealership and every number in the demo is sample
data. The vehicle photographs are real. Each is used under the licence shown and
links back to its source page on Wikimedia Commons; none is a photograph of a
vehicle Cascade Motors has ever owned, because Cascade Motors does not exist.</p>
<p><a href="./">&#9664; Back to the demo</a></p>
<table>
<thead><tr><th></th><th>Used for</th><th>Photographer</th><th>Licence</th><th>Source</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody></table>
</div></body></html>
`);

/* -------------------------------------------------------------- 2. move unused */

let moved = 0;
for (const f of unused) {
  const dest = path.join(BIN, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(path.join(VEH, f), dest); moved++; }
  catch (e) { console.warn(`! could not move ${f}: ${e.message}`); }
}

/* ------------------------------------------------------------ 3. used manifest */

const usedManifest = {};
for (const g of curated.groups) {
  usedManifest[g.id] = g.shots.map(([file, label]) => {
    const u = used.get(file) || {};
    return { file, label, artist: u.artist, license: u.license, licenseUrl: u.licenseUrl, source: u.source };
  });
}
fs.writeFileSync(path.join(HERE, 'manifest.used.json'), JSON.stringify(usedManifest, null, 2));

const mb = (list) => (list.reduce((n, f) => {
  const p = path.join(VEH, f);
  return n + (fs.existsSync(p) ? fs.statSync(p).size : 0);
}, 0) / 1048576).toFixed(1);

console.log(`credits.html   ${rows.length} photos credited`);
console.log(`_to_delete/    ${moved} unused frames moved out`);
console.log(`shipping       ${mb([...used.keys()])} MB in site/demo/img/veh/`);
