// Pins for the picker-thumbnail compositor (entity-thumbnails.ts). The
// underlying primitives are pinned elsewhere (renderBg1Patch by
// render-patch.test.ts, the sprite-cel pipeline by render-sprite-patch.test.ts)
// — these pins cover the COMPOSITION: probe-decode → stamped-cell bbox →
// assembled bitmap, and the sprite cel gating.
//
//   - std $01 Ledge (4×4 default) → a 64×64 bitmap with opaque pixels.
//   - ext $FF Tile eraser → null (stamps nothing — text-only row).
//   - a metadata `cel: 'B'` sprite → an opaque bitmap; an ungated num → null.
//   - bbox clamp: a huge object never exceeds THUMB_MAX_CELLS (6) per side.
//
// Run: node snes-framework/scripts/engine/entity-thumbnails.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6RecordDeep } from '../level.ts';
import { createEntityThumbnailer } from './entity-thumbnails.ts';
import { hex0x } from '../hex.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
const { rom, symbols } = cart;

const meta = JSON.parse(
  fs.readFileSync(
    path.join(FRAMEWORK_ROOT, '..', 'src', 'renderer', 'src', 'data', 'obj-metadata.json'),
    'utf8'
  )
) as { sprites: Record<string, { cel?: 'A' | 'B' }> };
const celB = new Set(
  Object.entries(meta.sprites).filter(([, i]) => i.cel === 'B').map(([k]) => parseInt(k, 16))
);
const celA = new Set(
  Object.entries(meta.sprites).filter(([, i]) => i.cel === 'A').map(([k]) => parseInt(k, 16))
);

// Donor: 1-1 (record 0x00) — a plain, backed level.
const donor = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: 0x00 });
const thumbnailer = createEntityThumbnailer({
  rom, symbols, workRoot: FRAMEWORK_ROOT, donor,
  isWorld6: isWorld6RecordDeep(FRAMEWORK_ROOT, 0x00),
  celRenderableNums: celB,
  formatANums: celA
});

function opaquePixels(rgba: Uint8Array): number {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) n++;
  return n;
}

// Object side.
const ledge = thumbnailer.objectThumb('std', 0x01, 4, 4);
assert(ledge !== null, 'std $01 Ledge renders a thumbnail');
if (ledge) {
  // 4×4 nominal, but the handler stamps one extra row (the ledge's soil lip
  // under the grass top) → a 4×5-cell footprint. The thumb is the TRUE stamped
  // bbox, not the nominal size box.
  assert(ledge.width === 64 && ledge.height === 80, `Ledge thumb is 64×80 (got ${ledge.width}×${ledge.height})`);
  assert(opaquePixels(ledge.rgba) > 64 * 64 * 0.5, 'Ledge thumb is mostly opaque');
}
assert(thumbnailer.objectThumb('ext', 0xff, 1, 1) === null, 'ext $FF Tile eraser → null (no bitmap)');

// Bbox clamp: a 32-wide ledge stays ≤ 6 cells per side.
const wide = thumbnailer.objectThumb('std', 0x01, 32, 32);
assert(
  wide !== null && wide.width <= 6 * 16 && wide.height <= 6 * 16,
  `huge object clamps to ≤96px per side (got ${wide?.width}×${wide?.height})`
);

// Sprite side: first cel-B sprite that resolves in this level's gfx config.
const someB = [...celB].find((n) => thumbnailer.spriteThumb(n) !== null);
assert(someB !== undefined, 'some cel-B sprite renders a thumbnail');
if (someB !== undefined) {
  const img = thumbnailer.spriteThumb(someB)!;
  assert(
    img.width > 0 && img.height > 0 && opaquePixels(img.rgba) > 0,
    `cel-B sprite ${hex0x(someB, 3)} thumb has opaque pixels (${img.width}×${img.height})`
  );
}
// An ungated num (no cel, not dynamic) → null. $1BA+ ambient ids are never
// cel-rendered and outside both gates.
assert(thumbnailer.spriteThumb(0x1ba) === null, 'ungated (ambient) sprite → null');

assert(!thumbnailer.mode7, 'donor 0x00 is not a mode-7 arena');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll entity-thumbnail pins passed.');
