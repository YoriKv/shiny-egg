// Metasprite reconstruction round-trip pin (sprite-metasprite.ts).
//
// Proves the load-bearing properties of the editable "meta" view:
//   1. Faithful canvases ROUND-TRIP: slicing the UNEDITED canvas reproduces the
//      exact base sheet tiles (diff → 0 edits). This is the faithful gate's
//      contract — an edit lands on consistent tiles, never a spurious overlay.
//   2. A single-pixel edit ISOLATES: the diff reports exactly the edited record's
//      tile(s), mapped to the right gfx file, and the bytes actually changed.
//   3. The cel-tile → gfx-file mapping is consistent: every record unit's base
//      bytes equal that file's decoded tile (so a metasprite edit and a raw
//      `sprites/` edit hit the identical bytes).
//
// Run: node snes-framework/scripts/engine/sprite-metasprite.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { snesToPC } from './symbol-map.ts';
import { lz2, lz16 } from './decompress/index.ts';
import { buildPaletteRow } from './color.ts';
import {
  buildMetaspriteContext,
  metaspriteSpriteIds,
  renderMetasprite,
  diffMetaspriteTiles,
  metaspriteAseprite,
  type MetaspriteContext,
  type MetaspriteHeader
} from './sprite-metasprite.ts';
import { decodeAsepriteImage } from './aseprite.ts';

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

function headerFromLevel(h: readonly number[], rec: number): MetaspriteHeader {
  const isWorld6 = isWorld6Record(levelMap, rec);
  return {
    bg1Tileset: h[1] ?? 0, bg2Tileset: h[3] ?? 0, bg3Tileset: h[5] ?? 0,
    spriteTileset: h[7] ?? 0,
    bgColor: h[0] ?? 0, bg1Palette: h[2] ?? 0, bg2Palette: h[4] ?? 0,
    bg3Palette: h[6] ?? 0, spritePalette: h[8] ?? 0, yoshiColor: 0,
    isWorld6, levelMode: h[9] ?? 0
  };
}

/** Decode a gfx file's blob to tile bytes (independent of VRAM, to cross-check
 *  the manifest mapping). */
function decodeGfxFile(format: 'lz2' | 'lz16', fileId: number, sizeBytes: number, rowCount?: number): Uint8Array {
  const tablePC = symbols.pc(format === 'lz16' ? 'DATA_lz16_compressed_gfx_ptrs' : 'DATA_lz2_compressed_gfx_ptrs');
  const p = tablePC + fileId * 3;
  const srcPC = snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16));
  const out = new Uint8Array(sizeBytes);
  if (format === 'lz16') lz16(rom, srcPC, out, 0, rowCount!);
  else lz2(rom, srcPC, out, 0);
  return out;
}

/** Pick an owned pixel + a different palette colour to paint there. */
function findOwnedEdit(ctx: MetaspriteContext, canvas: ReturnType<typeof renderMetasprite>): { p: number; recIndex: number } | null {
  if (!canvas) return null;
  const haveUnits = new Set(canvas.records.filter((r) => r.units).map((r) => r.recordIndex));
  for (let p = 0; p < canvas.ownerMap.length; p++) {
    const o = canvas.ownerMap[p]!;
    if (o >= 0 && haveUnits.has(o)) return { p, recIndex: o };
  }
  return null;
}

const LEVELS = [0x00, 0x14, 0x27, 0x2b, 0x31, 0x32];
let totalFaithful = 0, totalRecordsChecked = 0, totalIds = 0, mappingChecked = 0, editTests = 0, aseChecked = 0;

for (const rec of LEVELS) {
  const base = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
  if (base.empty || base.special || base.header.length < 15) {
    console.log(`\n0x${rec.toString(16)}: skipped (empty/special)`); continue;
  }
  const header = headerFromLevel(base.header, rec);
  const ctx = buildMetaspriteContext(rom, symbols, header);
  const ids = metaspriteSpriteIds(ctx);
  totalIds += ids.length;
  let faithfulHere = 0;
  console.log(`\n0x${rec.toString(16).padStart(2, '0')} — ${ids.length} metasprites`);

  // 1. Faithful canvases round-trip (unedited slice == base → 0 edits).
  let roundTripOk = true;
  for (const id of ids) {
    const canvas = renderMetasprite(ctx, id);
    if (!canvas || !canvas.faithful) continue;
    faithfulHere++;
    totalRecordsChecked += canvas.records.filter((r) => r.units).length;
    const { edits } = diffMetaspriteTiles(ctx, canvas, canvas.rgba);
    if (edits.length !== 0) { roundTripOk = false; console.error(`    0x${id.toString(16)}: unedited slice produced ${edits.length} edits`); }
    // Single-image .aseprite round-trip (no tilemap; transparent index 0): flatten ==
    // canvas → 0 edits. Once (the primitive is the same across sprites).
    if (aseChecked === 0) {
      const dec = decodeAsepriteImage(metaspriteAseprite(ctx, canvas));
      const eq = dec.rgba.length === canvas.rgba.length && dec.rgba.every((v, i) => v === canvas.rgba[i]);
      assert(eq && diffMetaspriteTiles(ctx, canvas, dec.rgba).edits.length === 0,
        `metasprite .aseprite flatten == canvas → 0 edits (0x${id.toString(16)})`);
      aseChecked++;
    }
  }
  totalFaithful += faithfulHere;
  assert(roundTripOk, `every faithful metasprite round-trips (${faithfulHere} faithful / ${ids.length})`);

  // 2. Single-pixel edit isolates to the edited record's tiles. Pick the first
  //    faithful canvas that has an owned, editable pixel (skip vacuously-faithful
  //    pure-dynamic-body sprites that have no static units).
  for (const id of ids) {
    const canvas = renderMetasprite(ctx, id);
    if (!canvas || !canvas.faithful) continue;
    const owned = findOwnedEdit(ctx, canvas);
    if (!owned) continue;
    const rec2 = canvas.records.find((r) => r.recordIndex === owned.recIndex)!;
    const palette = buildPaletteForRecord(ctx, rec2.paletteRow);
    const edited = canvas.rgba.slice();
    const u32 = new Uint32Array(edited.buffer, edited.byteOffset, canvas.width * canvas.height);
    const cur = u32[owned.p]!;
    let newColor = cur;
    for (let i = 1; i < 16; i++) if (palette[i] !== cur) { newColor = palette[i]!; break; }
    u32[owned.p] = newColor;
    const { edits } = diffMetaspriteTiles(ctx, canvas, edited);
    const recTiles = new Set((rec2.units ?? []).map((u) => `${u.format}/${u.fileId}/${u.fileTile}`));
    const allInRecord = edits.every((e) => recTiles.has(`${e.format}/${e.fileId}/${e.fileTile}`));
    assert(edits.length >= 1 && allInRecord, `0x${id.toString(16)}: 1-px edit → ${edits.length} tile(s), all in the edited record`);
    editTests++;
    break;
  }

  // 3. Manifest mapping consistency: a record unit's base bytes == the decoded
  //    gfx file's tile at that fileTile (so metasprite + raw-sheet edits coincide).
  for (const id of ids.slice(0, 6)) {
    const canvas = renderMetasprite(ctx, id);
    if (!canvas) continue;
    for (const r of canvas.records) {
      if (!r.units) continue;
      for (const u of r.units) {
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
}

function buildPaletteForRecord(ctx: MetaspriteContext, row: number): Uint32Array {
  return buildPaletteRow(ctx.cgram, 8 + row, true);
}

assert(totalIds > 0, `enumerated metasprites across levels (${totalIds})`);
assert(totalFaithful > 0, `some metasprites are faithful (${totalFaithful})`);
assert(totalRecordsChecked > 0, `records round-trip-checked (${totalRecordsChecked})`);
assert(mappingChecked > 0, `manifest mappings cross-checked (${mappingChecked})`);
assert(editTests > 0, `edit-isolation exercised (${editTests} levels)`);

console.log(`\n${failures === 0 ? '✓ all metasprite pins pass' : `✗ ${failures} failure(s)`}  ` +
  `[${totalIds} ids, ${totalFaithful} faithful, ${totalRecordsChecked} records]`);
process.exit(failures === 0 ? 0 : 1);
