// Object-metatile reconstruction round-trip pin (object-metatile.ts) — the BG
// twin of sprite-metasprite.test.ts.
//
//   1. Faithful metatiles ROUND-TRIP: slicing the UNEDITED canvas reproduces the
//      base BG1 sheet tiles (diff → 0 edits).
//   2. A single-pixel edit ISOLATES to the edited quadrant's BG1 tile.
//   3. The quadrant → gfx-file mapping is consistent: a unit's base bytes equal
//      that BG1 file's decoded tile (so metatile + raw bg1-tileset edits coincide).
//
// Run: node snes-framework/scripts/engine/object-metatile.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { decodeLevelById } from './object-decode/index.ts';
import { levelMap16Usage } from './level-tile-usage.ts';
import { snesToPC } from './symbol-map.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { buildPaletteRow } from './color.ts';
import {
  buildMetatileContext, renderMetatile, diffMetatileTiles,
  type MetatileContext, type MetatileHeader
} from './object-metatile.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;
const levelMap = loadLevelMapPublic(FRAMEWORK_ROOT);

function headerFromLevel(h: readonly number[], rec: number): MetatileHeader {
  return {
    bg1Tileset: h[1] ?? 0, bg2Tileset: h[3] ?? 0, bg3Tileset: h[5] ?? 0, spriteTileset: h[7] ?? 0,
    bgColor: h[0] ?? 0, bg1Palette: h[2] ?? 0, bg2Palette: h[4] ?? 0, bg3Palette: h[6] ?? 0,
    spritePalette: h[8] ?? 0, yoshiColor: 0, isWorld6: isWorld6Record(levelMap, rec), levelMode: h[9] ?? 0
  };
}

function decodeGfxFile(format: 'lz2' | 'lz16', fileId: number, sizeBytes: number, rowCount?: number): Uint8Array {
  const tablePC = symbols.pc(format === 'lz16' ? 'DATA_lz16_compressed_gfx_ptrs' : 'DATA_lz2_compressed_gfx_ptrs');
  const p = tablePC + fileId * 3;
  const srcPC = snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16));
  const out = new Uint8Array(sizeBytes);
  if (format === 'lz16') lz16(rom, srcPC, out, 0, rowCount!);
  else lz2(rom, srcPC, out, 0);
  return out;
}

/** Distinct Map16 ids a level stamps (object stream → grid → usage). */
function levelMetatileIds(rec: number, header: readonly number[]): number[] {
  let decoded;
  try { decoded = decodeLevelById({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelRecordId: rec }); } catch { return []; }
  if (!decoded || decoded.stats.aborted) return [];
  const usage = levelMap16Usage(rom, symbols, {
    header, isWorld6: isWorld6Record(levelMap, rec),
    levelDataBuffer: decoded.state.levelDataBuffer, screenPageMap: decoded.state.screenPageMap
  });
  return usage.blocks.map((b) => b.id);
}

const LEVELS = [0x00, 0x14, 0x27, 0x2b, 0x31, 0x32];
let totalIds = 0, totalFaithful = 0, totalUnits = 0, mappingChecked = 0, editTests = 0;

for (const rec of LEVELS) {
  const base = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
  if (base.empty || base.special || base.header.length < 15) { console.log(`\n0x${rec.toString(16)}: skipped`); continue; }
  const header = headerFromLevel(base.header, rec);
  const ids = levelMetatileIds(rec, base.header);
  totalIds += ids.length;
  const ctx = buildMetatileContext(rom, symbols, header);
  let faithfulHere = 0;
  console.log(`\n0x${rec.toString(16).padStart(2, '0')} — ${ids.length} metatiles stamped`);

  // 1. Faithful metatiles round-trip (unedited slice == base → 0 edits).
  let roundTripOk = true;
  for (const id of ids) {
    const canvas = renderMetatile(ctx, id);
    if (!canvas || !canvas.faithful) continue;
    faithfulHere++;
    totalUnits += canvas.units.filter((u) => u).length;
    const { edits } = diffMetatileTiles(ctx, canvas, canvas.rgba);
    if (edits.length !== 0) { roundTripOk = false; console.error(`    0x${id.toString(16)}: unedited slice produced ${edits.length} edits`); }
  }
  totalFaithful += faithfulHere;
  assert(roundTripOk, `every faithful metatile round-trips (${faithfulHere} faithful / ${ids.length})`);

  // 2. Single-pixel edit isolates to the edited quadrant's tile.
  for (const id of ids) {
    const canvas = renderMetatile(ctx, id);
    if (!canvas || !canvas.faithful) continue;
    const ui = canvas.units.findIndex((u) => u);
    if (ui < 0) continue;
    const unit = canvas.units[ui]!;
    const palette = buildPaletteRow(ctx.cgram, unit.paletteRow, false);
    const edited = canvas.rgba.slice();
    const u32 = new Uint32Array(edited.buffer, edited.byteOffset, canvas.width * canvas.height);
    const p = unit.cellY * canvas.width + unit.cellX;
    const cur = u32[p]!;
    for (let i = 0; i < 16; i++) if (palette[i] !== cur) { u32[p] = palette[i]!; break; }
    const { edits } = diffMetatileTiles(ctx, canvas, edited);
    const unitTiles = new Set(canvas.units.filter((u) => u).map((u) => `${u!.format}/${u!.fileId}/${u!.fileTile}`));
    const allInBlock = edits.every((e) => unitTiles.has(`${e.format}/${e.fileId}/${e.fileTile}`));
    const hitEdited = edits.some((e) => `${e.format}/${e.fileId}/${e.fileTile}` === `${unit.format}/${unit.fileId}/${unit.fileTile}`);
    assert(edits.length >= 1 && allInBlock && hitEdited, `0x${id.toString(16)}: 1-px edit → ${edits.length} tile(s), hits the edited quadrant, all in block`);
    editTests++;
    break;
  }

  // 3. Quadrant → gfx-file mapping consistency.
  for (const id of ids.slice(0, 8)) {
    const canvas = renderMetatile(ctx, id);
    if (!canvas) continue;
    for (const u of canvas.units) {
      if (!u) continue;
      const e = ctx.manifest.find((m) => m.fileId === u.fileId && m.format === u.format);
      if (!e) continue;
      const rowCount = u.format === 'lz16' ? e.sizeBytes / 512 : undefined;
      const fileBytes = decodeGfxFile(u.format, u.fileId, e.sizeBytes, rowCount);
      let eq = true;
      for (let k = 0; k < 32; k++) if (fileBytes[u.fileTile * 32 + k] !== u.baseBytes[k]) { eq = false; break; }
      if (!eq) { console.error(`    0x${id.toString(16)} file 0x${u.fileId.toString(16)} tile ${u.fileTile}: base≠file`); failures++; }
      mappingChecked++;
    }
  }
}

assert(totalIds > 0, `enumerated metatiles across levels (${totalIds})`);
assert(totalFaithful > 0, `some metatiles are faithful (${totalFaithful})`);
assert(totalUnits > 0, `quadrants round-trip-checked (${totalUnits})`);
assert(mappingChecked > 0, `manifest mappings cross-checked (${mappingChecked})`);
assert(editTests > 0, `edit-isolation exercised (${editTests} levels)`);

console.log(`\n${failures === 0 ? '✓ all metatile pins pass' : `✗ ${failures} failure(s)`}  ` +
  `[${totalIds} ids, ${totalFaithful} faithful, ${totalUnits} quadrants]`);
process.exit(failures === 0 ? 0 : 1);
