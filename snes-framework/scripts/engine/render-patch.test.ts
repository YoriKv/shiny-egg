// Patch == full parity test (Tier 2 incremental BG1/collision re-render).
//
// The Tier-2 incremental path renders a level once in FULL, then on each edit
// ships only the cells a grid-diff flagged (a "patch") which the renderer
// overwrites onto its backing canvas. For that to be correct the backing canvas
// must, after applying patches, be byte-identical to what a fresh FULL render
// would produce. This test proves exactly that for bg1 AND collision:
//
//   base full render → edit → diff(base grid, new grid) → patch(new decode)
//   → apply patch onto a COPY of the base full → assert == fresh full render.
//
// A single byte-equality assertion catches BOTH failure modes at once:
//   - the diff missed a changed cell  → that cell keeps base's old pixels,
//     which differ from the fresh full → mismatch.
//   - a patch cell renders differently from the full path → mismatch.
//
// Run: node snes-framework/scripts/engine/render-patch.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { decodeLevelFromLevelData } from './object-decode/index.ts';
import { loadLevelGfx, type GfxFileEntry, type GfxHeader } from './load-graphics.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { loadMap16Tables, type Map16Tables } from './map16.ts';
import { buildBg1Bands } from './bg1-band-gfx.ts';
import { renderBg1, renderBg1Patch } from './render-bg1.ts';
import { loadCollisionTable, loadSlopePanels, type CollisionEntry, type SlopePanels } from './collision.ts';
import { renderCollisionLayer, renderCollisionPatch } from './render-collision.ts';
import { resolveCellGrid, diffCellGrids, GRID_COLS } from './cell-grid.ts';
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

interface Bg1Ctx {
  vram: Uint8Array; cgram: Uint8Array; map16Tables: Map16Tables; bg1CharAddr: number;
  bands?: Parameters<typeof renderBg1>[0]['bands'];
  bandAxis?: Parameters<typeof renderBg1>[0]['bandAxis'];
}

/** Per-tileset bg1 render context — built once from the BASE level and reused
 *  for the fresh full render + the patch (mirrors the cached context in the
 *  app's render.ts; the patch must use the same context its backing canvas
 *  reflects). */
function buildBg1Ctx(level: LevelData): Bg1Ctx {
  const h = level.header; const rec = level.recordId;
  const gfx = gfxHeaderFromLevel(h, rec); const pal = paletteHeaderFromLevel(h, rec);
  const vram = new Uint8Array(0x10000); const cgram = new Uint8Array(512);
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, gfx, vram, manifest);
  loadTileAnimation(rom, symbols, { animationTileset: h[10] ?? 0, bg1Tileset: gfx.bg1Tileset, levelMode: h[9] ?? 0 }, vram);
  loadLevelPalettes(rom, symbols, pal, cgram);
  const regs = loadSceneRegs(rom, symbols, h[9] ?? 0);
  const map16Tables = loadMap16Tables(rom, symbols);
  const band = buildBg1Bands({ rom, symbols, sprites: level.sprites, gfx, palette: pal, animationTileset: h[10] ?? 0, levelMode: h[9] ?? 0 });
  return { vram, cgram, map16Tables, bg1CharAddr: regs.bg1CharAddr, bands: band?.bands, bandAxis: band?.bandAxis };
}

function decodeBuf(level: LevelData): { levelDataBuffer: Uint8Array; screenPageMap: Uint8Array } {
  const d = decodeLevelFromLevelData({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelData: level });
  if (!d) throw new Error(`decode returned null for record 0x${level.recordId.toString(16)}`);
  return { levelDataBuffer: d.state.levelDataBuffer, screenPageMap: d.state.screenPageMap };
}

/** Overwrite each patch cell onto `full` (the same 16-px-row replace, alpha
 *  included, that the renderer's putImageData does). */
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

/** Byte-equal check; on mismatch report the first differing pixel + its cell. */
function bytesEqual(a: Uint8Array, b: Uint8Array, width: number, label: string): boolean {
  const av = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const bv = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (av.length === bv.length && Buffer.compare(av, bv) === 0) return true;
  let first = -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) { first = i; break; }
  if (first >= 0) {
    const px = (first >> 2);
    const x = px % width; const y = (px / width) | 0;
    console.error(`    ${label}: first diff at byte ${first} = pixel (${x},${y}) cell (${x >> 4},${y >> 4})  a=${a[first]} b=${b[first]}`);
  } else {
    console.error(`    ${label}: length mismatch a=${a.length} b=${b.length}`);
  }
  return false;
}

// Cart-global collision data (rom-only).
const collisionTable: CollisionEntry[] = loadCollisionTable(rom, symbols);
const slopePanels: SlopePanels = loadSlopePanels(rom, symbols);

type Edit = { name: string; expectChange: boolean; apply: (l: LevelData) => LevelData };
const EDITS: Edit[] = [
  { name: 'noop', expectChange: false, apply: (l) => l },
  { name: 'move-one', expectChange: false, // may or may not change cells; not asserted
    apply: (l) => ({ ...l, objects: l.objects.map((o, i) => i === 1 ? { ...o, x: o.x + 2 } : o) }) },
  { name: 'shift-all-x', expectChange: true,
    apply: (l) => ({ ...l, objects: l.objects.map((o) => ({ ...o, x: o.x + 1 })) }) },
  { name: 'delete-last', expectChange: true,
    apply: (l) => ({ ...l, objects: l.objects.slice(0, -1) }) },
];

// 1-1 (plain), 3-3 (std-24 area), 0x2B (vertical → y-axis bands),
// 6-6 / 0x32 (world-6 dark tileset, busy).
const LEVELS = [0x00, 0x14, 0x2b, 0x32];

for (const rec of LEVELS) {
  const base = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
  if (base.empty || base.special || base.header.length < 15) {
    console.log(`\n0x${rec.toString(16)}: skipped (empty/special)`);
    continue;
  }
  console.log(`\n0x${rec.toString(16).padStart(2, '0')} — ${base.objects.length} objects, bandAxis=${buildBg1Ctx(base).bandAxis ?? 'none'}`);

  const ctx = buildBg1Ctx(base);              // built from base, reused for patch
  const baseBuf = decodeBuf(base);
  const baseGrid = resolveCellGrid(baseBuf.levelDataBuffer, baseBuf.screenPageMap);
  const baseBg1Full = renderBg1({ ...ctx, ...baseBuf });
  const baseColFull = renderCollisionLayer({ collisionTable, slopePanels, ...baseBuf });

  for (const edit of EDITS) {
    const next = edit.apply(base);
    const nextBuf = decodeBuf(next);
    const nextGrid = resolveCellGrid(nextBuf.levelDataBuffer, nextBuf.screenPageMap);
    const coords = diffCellGrids(baseGrid, nextGrid);
    const changed = coords.length >>> 1;

    if (!edit.expectChange && edit.name === 'noop') {
      assert(changed === 0, `${edit.name}: empty diff (0 changed cells)`);
    }
    if (edit.expectChange) {
      assert(changed > 0, `${edit.name}: diff non-empty (${changed} changed cells)`);
    }

    // Fresh FULL renders of the edited state (the ground truth).
    const freshBg1 = renderBg1({ ...ctx, ...nextBuf });
    const freshCol = renderCollisionLayer({ collisionTable, slopePanels, ...nextBuf });

    // bg1: apply patch onto a copy of the base full → must equal fresh full.
    const bg1Patch = renderBg1Patch({ ...ctx, ...nextBuf }, coords);
    const bg1Patched = baseBg1Full.rgba.slice();
    applyPatch(bg1Patched, baseBg1Full.width, bg1Patch);
    assert(bytesEqual(bg1Patched, freshBg1.rgba, freshBg1.width, `bg1 ${edit.name}`),
      `bg1 ${edit.name}: patched base == fresh full (${changed} cells, ${(bg1Patch.rgba.length / 1024).toFixed(0)} KB)`);

    // collision: same invariant.
    const colPatch = renderCollisionPatch({ collisionTable, slopePanels, ...nextBuf }, coords);
    const colPatched = baseColFull.rgba.slice();
    applyPatch(colPatched, baseColFull.width, colPatch);
    assert(bytesEqual(colPatched, freshCol.rgba, freshCol.width, `collision ${edit.name}`),
      `collision ${edit.name}: patched base == fresh full (${changed} cells, ${(colPatch.rgba.length / 1024).toFixed(0)} KB)`);
  }
}

// Sanity: coords stay within grid bounds.
{
  const g0 = new Uint16Array(GRID_COLS * 128);
  const g1 = g0.slice(); g1[GRID_COLS * 5 + 7] = 0x1234; // change cell (7,5)
  const c = diffCellGrids(g0, g1);
  assert(c.length === 2 && c[0] === 7 && c[1] === 5, 'diffCellGrids reports (7,5) for a single-cell change');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
