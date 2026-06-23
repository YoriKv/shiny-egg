// import-verify — post-import re-render confidence check
// (plan-editor-remaining.md RI5c). For every changed level a foreign hack
// would import, prove the IMPORT PIPELINE is pixel-faithful: decode the
// foreign streams (the apply payload), push them through the same
// serialize → re-decode round-trip the overlay write + editor load perform,
// render BOTH LevelData through the engine's layer renderer against the SAME
// base dev cart, and compare per-layer RGBA hashes. A mismatch means a
// decoder/serializer gap the byte-level round-trip check didn't catch (the
// reverse is also checked: 'full' levels must already be byte-faithful).
//
// Both renders use the BASE cart's graphics/palettes deliberately — a hack's
// changed gfx isn't imported, so rendering with its own art would diff every
// level for reasons outside the import's control. This isolates STREAM
// fidelity, which is what the importer owns.
//
// Raw-only levels are reported but not double-rendered: their overlay bytes
// are an exact copy of the foreign stream, so re-decode ≡ foreign decode by
// construction.
//
// Run (WSL-safe, no native deps; needs the built V1.0 ROM + reference cart):
//   node snes-framework/scripts/engine/import-verify.ts <hack.sfc> [--records 0x10,0x2c]

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeForeignRom } from '../import/analyze.ts';
import { decodeLevelStreams } from '../level.ts';
import { serializeLevel } from '../serialize-level.ts';
import { loadDevCart } from './dev-cart.ts';
import { renderLevelLayers, type RenderedLevelLayers } from './render-level-layers.ts';
import { loadLevelMapPublic } from '../level.ts';
import { hex0x } from '../hex.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK_ROOT = path.resolve(here, '..', '..');

function md5(buf: Uint8Array): string {
  return crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);
}

/** Per-layer hashes of a rendered level (decode buffer + RGBA layers). */
function layerHashes(r: RenderedLevelLayers): Record<string, string> {
  return {
    decode: md5(r.decode.levelDataBuffer),
    pages: md5(r.decode.screenPageMap),
    bg1: md5(r.bg1.rgba),
    bg2: md5(r.bg2.rgba),
    bg3: md5(r.bg3.rgba),
    // Foreground (priority-1) planes — hashed so a round-trip can't silently
    // drop above-BG1 BG2/BG3 content. '(none)' = no foreground tiles.
    bg2Front: r.bg2Front ? md5(r.bg2Front.rgba) : '(none)',
    bg3Front: r.bg3Front ? md5(r.bg3Front.rgba) : '(none)',
    sprite: r.sprite ? md5(r.sprite.rgba) : '(none)',
    collision: md5(r.collision.rgba)
  };
}

const args = process.argv.slice(2);
const hackPath = args.find((a) => !a.startsWith('--'));
if (!hackPath) {
  console.error('usage: node snes-framework/scripts/engine/import-verify.ts <hack.sfc> [--records 0x10,0x2c]');
  process.exit(2);
}
const recordsArg = args.find((a) => a.startsWith('--records'));
const onlyRecords = recordsArg
  ? new Set(
      (recordsArg.includes('=') ? recordsArg.split('=')[1] : args[args.indexOf(recordsArg) + 1])
        .split(',')
        .map((s) => parseInt(s, 16))
    )
  : null;

const basePath = path.join(WORK_ROOT, 'reference', 'reference.sfc');
if (!fs.existsSync(basePath)) {
  console.log('SKIP: reference cart not found (run extract first).');
  process.exit(0);
}
const base = fs.readFileSync(basePath);
const foreign = fs.readFileSync(hackPath);
const dev = loadDevCart();
const map = loadLevelMapPublic(WORK_ROOT);

const { analysis, items } = analyzeForeignRom(foreign, base);
if (!analysis.levelPtrsResolved) {
  console.error('Level pointer table did not resolve — nothing to verify.');
  process.exit(1);
}

let pass = 0;
let raw = 0;
let skipped = 0;
let failed = 0;

for (const item of items) {
  if (onlyRecords && !onlyRecords.has(item.recordId)) continue;
  const id = hex0x(item.recordId, 2);

  if (item.importability === 'raw-only') {
    console.log(`${id}  RAW   (byte-exact copy — re-decode ≡ foreign by construction)`);
    raw++;
    continue;
  }

  // The apply path: serialize the decoded foreign level (the overlay write),
  // then re-decode it (the editor / build read).
  const serialized = serializeLevel({
    level: item.level,
    headerBitWidths: map.headerBitWidths,
    standardObjectInfo: map.standardObjectInfo
  });
  const reLevel = decodeLevelStreams({
    recordId: item.recordId,
    romVersion: map.romVersion,
    headerBitWidths: map.headerBitWidths,
    standardObjectInfo: map.standardObjectInfo,
    objectBytes: serialized.objectBytes,
    spriteBytes: serialized.spriteBytes
  });

  const a = renderLevelLayers(dev.rom, dev.symbols, WORK_ROOT, item.level);
  const b = renderLevelLayers(dev.rom, dev.symbols, WORK_ROOT, reLevel);
  if (!a || !b) {
    console.log(`${id}  SKIP  (renderer declined: ${!a ? 'foreign' : 'round-trip'} side)`);
    skipped++;
    continue;
  }
  const ha = layerHashes(a);
  const hb = layerHashes(b);
  const diffs = Object.keys(ha).filter((k) => ha[k] !== hb[k]);
  if (diffs.length === 0) {
    console.log(`${id}  PASS  ${ha.bg1} bg1 · ${ha.sprite} sprite`);
    pass++;
  } else {
    console.log(`${id}  FAIL  layers differ: ${diffs.join(', ')}`);
    for (const k of diffs) console.log(`        ${k}: ${ha[k]} → ${hb[k]}`);
    failed++;
  }
}

console.log(
  `\n${pass} pass · ${raw} raw (byte-exact) · ${skipped} skipped · ${failed} FAILED ` +
    `(of ${items.length} importable changed levels)`
);
process.exit(failed > 0 ? 1 : 0);
