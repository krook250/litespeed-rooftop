/**
 * `node scripts/stage-demo-photos.mjs` — copy the curated photographs into `public/`.
 *
 * The 38 hand-culled Wikimedia frames already live in `site/demo/img/veh/`, but
 * `site/` is the marketing site deployed to Bluehost — Next serves `public/`, so
 * nothing under `site/` is reachable at app.rooftopauto.com. This copies them
 * across and renames them by curated group id, which is what `src/db/real-photos.ts`
 * expects:
 *
 *   site/demo/img/veh/honda-accord/3.jpg  ->  public/demo/veh/acc-a/1.jpg
 *
 * Group id rather than model folder because one model can be several physical
 * cars — four Silverados in different paint — and a gallery has to stay one car.
 *
 * Idempotent. Run it again after re-culling `curated.json` and the tree is rebuilt.
 */

import { readFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'site', 'demo', 'img', 'veh');
const DST = join(root, 'public', 'demo', 'veh');

const curatedPath = join(root, 'mock', 'photos', 'curated.json');
if (!existsSync(curatedPath)) {
  console.error(`missing ${curatedPath} — run this from the repo root`);
  process.exit(1);
}

const { groups } = JSON.parse(readFileSync(curatedPath, 'utf8'));

// Rebuild rather than merge: a group that lost a frame in re-culling must not
// leave the old file behind for the feed to keep serving.
rmSync(DST, { recursive: true, force: true });

let copied = 0;
const missing = [];

for (const g of groups) {
  const dir = join(DST, g.id);
  mkdirSync(dir, { recursive: true });

  g.shots.forEach(([rel], i) => {
    const from = join(SRC, ...rel.split('/'));
    if (!existsSync(from)) {
      missing.push(rel);
      return;
    }
    copyFileSync(from, join(dir, `${i + 1}.jpg`));
    copied += 1;
  });
}

console.log(`staged ${copied} photographs into public/demo/veh/ across ${groups.length} cars`);
const multi = groups.filter((g) => g.shots.length >= 2).length;
console.log(`${multi} cars have 2+ frames (Marketplace-eligible), ${groups.length - multi} have one`);
if (missing.length) {
  console.warn(`\n${missing.length} listed in curated.json but not on disk:`);
  for (const m of missing) console.warn(`  ${m}`);
}
