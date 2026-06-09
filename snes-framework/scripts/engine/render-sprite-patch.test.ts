// Patch == full parity test (Tier 2 incremental SPRITE-layer re-render).
//
// The sprite layer's Tier-2 path renders a level once in FULL, then on each edit
// ships only the 16×16 cells a content-signature-grid diff flagged (a "patch")
// which the renderer overwrites onto its backing canvas. For that to be correct
// the backing canvas must, after applying patches, be byte-identical to a fresh
// FULL render. This test proves exactly that:
//
//   base full → edit → diff(base sig grid, new sig grid) → patch(new model)
//   → apply patch onto a COPY of the base full → assert == fresh full render.
//
// One byte-equality assertion catches BOTH failure modes:
//   - the signature diff missed a changed cell → that cell keeps base's old
//     pixels, which differ from the fresh full → mismatch.
//   - a patch cell composites differently from the full path (z-order / clip)
//     → mismatch.
//
// Run: node snes-framework/scripts/engine/render-sprite-patch.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { loadLevelGfx, type GfxFileEntry, type GfxHeader } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import {
  buildSpriteRenderModel,
  buildSpriteCellGrid,
  compositeSpriteFull,
  renderSpritePatch,
  type SpriteRenderModel
} from './render-sprite-layer.ts';
import { diffCellGrids } from './cell-grid.ts';
import type { LevelData, LayerCellPatch } from '../types.ts';

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

function gfxHeaderFromLevel(h: readonly number[], rec: number): GfxHeader {
  return {
    bg1Tileset: h[1] ?? 0, bg2Tileset: h[3] ?? 0, bg3Tileset: h[5] ?? 0,
    spriteTileset: h[7] ?? 0, isWorld6: isWorld6Record(levelMap, rec)
  };
}
function paletteHeaderFromLevel(h: readonly number[], rec: number): PaletteHeader {
  return {
    bgColor: h[0] ?? 0, bg1Palette: h[2] ?? 0, bg2Palette: h[4] ?? 0,
    bg3Palette: h[6] ?? 0, spritePalette: h[8] ?? 0, yoshiColor: 0,
    isWorld6: isWorld6Record(levelMap, rec), levelMode: h[9] ?? 0
  };
}

interface SpriteCtx { gfx: GfxHeader; vram: Uint8Array; cgram: Uint8Array; manifest: GfxFileEntry[]; levelSpritePaletteId: number; }

/** Per-level sprite gfx context — built once from the BASE level and reused for
 *  the fresh full render + the patch (the patch must use the same context its
 *  backing canvas reflects; a sprite edit never changes the header). No cel gate
 *  (render every resolvable sprite) — a stronger parity test, and gating is
 *  irrelevant to full-vs-patch equality. */
function buildSpriteCtx(level: LevelData): SpriteCtx {
  const gfx = gfxHeaderFromLevel(level.header, level.recordId);
  const pal = paletteHeaderFromLevel(level.header, level.recordId);
  const vram = new Uint8Array(0x10000); const cgram = new Uint8Array(512);
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, gfx, vram, manifest);
  loadLevelPalettes(rom, symbols, pal, cgram);
  return { gfx, vram, cgram, manifest, levelSpritePaletteId: pal.spritePalette };
}

function spriteModel(level: LevelData, ctx: SpriteCtx): SpriteRenderModel {
  return buildSpriteRenderModel({
    rom, symbols, header: ctx.gfx, sprites: level.sprites,
    vram: ctx.vram, cgram: ctx.cgram, manifest: ctx.manifest,
    levelSpritePaletteId: ctx.levelSpritePaletteId
  });
}

/** Overwrite each patch cell onto `full` (same 16-px-row replace the renderer's
 *  putImageData does). */
function applyPatch(full: Uint8Array, fullWidth: number, patch: LayerCellPatch): void {
  const { coords, rgba, cellPx } = patch;
  const cellBytes = cellPx * cellPx * 4;
  const n = coords.length >>> 1;
  for (let i = 0; i < n; i++) {
    const x = coords[i * 2]!; const y = coords[i * 2 + 1]!;
    for (let row = 0; row < cellPx; row++) {
      const srcOff = i * cellBytes + row * cellPx * 4;
      const dstOff = ((y * cellPx + row) * fullWidth + x * cellPx) * 4;
      full.set(rgba.subarray(srcOff, srcOff + cellPx * 4), dstOff);
    }
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array, width: number, label: string): boolean {
  const av = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const bv = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (av.length === bv.length && Buffer.compare(av, bv) === 0) return true;
  let first = -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) { first = i; break; }
  if (first >= 0) {
    const px = (first >> 2); const x = px % width; const y = (px / width) | 0;
    console.error(`    ${label}: first diff at byte ${first} = pixel (${x},${y}) cell (${x >> 4},${y >> 4})  a=${a[first]} b=${b[first]}`);
  } else {
    console.error(`    ${label}: length mismatch a=${a.length} b=${b.length}`);
  }
  return false;
}

type Edit = { name: string; apply: (l: LevelData) => LevelData };
const EDITS: Edit[] = [
  { name: 'noop', apply: (l) => l },
  { name: 'move-first', apply: (l) => l.sprites.length ? ({ ...l, sprites: l.sprites.map((s, i) => i === 0 ? { ...s, x: s.x + 2, y: s.y + 1 } : s) }) : l },
  { name: 'delete-last', apply: (l) => l.sprites.length ? ({ ...l, sprites: l.sprites.slice(0, -1) }) : l },
  { name: 'add-shifted-dup', apply: (l) => l.sprites.length ? ({ ...l, sprites: [...l.sprites, { ...l.sprites[0]!, index: l.sprites.length, x: Math.min(255, l.sprites[0]!.x + 4), y: Math.min(127, l.sprites[0]!.y + 4) }] }) : l }
];

const LEVELS = [0x00, 0x14, 0x2b, 0x32];
let totalChangedSeen = 0;

for (const rec of LEVELS) {
  const base = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
  if (base.empty || base.special || base.header.length < 15) {
    console.log(`\n0x${rec.toString(16)}: skipped (empty/special)`);
    continue;
  }
  const ctx = buildSpriteCtx(base);
  const baseModel = spriteModel(base, ctx);
  const baseGrid = buildSpriteCellGrid(baseModel).grid;
  const baseFull = compositeSpriteFull(baseModel);
  console.log(`\n0x${rec.toString(16).padStart(2, '0')} — ${base.sprites.length} sprites, ${baseModel.placed.length} placed`);

  for (const edit of EDITS) {
    const next = edit.apply(base);
    const nextModel = spriteModel(next, ctx);
    const nextCellGrid = buildSpriteCellGrid(nextModel);
    const coords = diffCellGrids(baseGrid, nextCellGrid.grid);
    const changed = coords.length >>> 1;
    totalChangedSeen += changed;

    if (edit.name === 'noop') assert(changed === 0, `${edit.name}: empty diff (0 changed cells)`);

    const freshFull = compositeSpriteFull(nextModel);
    const patch = renderSpritePatch(nextModel, nextCellGrid, coords);
    const patched = baseFull.rgba.slice();
    applyPatch(patched, baseFull.width, patch);
    assert(bytesEqual(patched, freshFull.rgba, freshFull.width, `sprite ${edit.name}`),
      `${edit.name}: patched base == fresh full (${changed} cells, ${(patch.rgba.length / 1024).toFixed(0)} KB)`);
  }
}

// Guard against a vacuous pass: at least one edit somewhere must have produced a
// non-empty diff (else the patch path was never exercised).
assert(totalChangedSeen > 0, `diff path exercised (${totalChangedSeen} changed cells across all edits)`);

console.log(failures === 0 ? '\n✓ all sprite-patch parity tests passed' : `\n✗ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
