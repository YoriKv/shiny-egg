// Raphael arena Bosses-track export (screen-raphael.ts). Pins:
//   1. context anatomy — 256 CPC chars, 4096-byte tilemap, palette-row model
//      (chars 0-127 row 0; 128-255 from the DATA_00B637/00B677 tables);
//   2. the export shape (PNG view always; .aseprite + tileKeys in aseprite mode);
//   3. an unedited layout .aseprite round-trips to ZERO edits;
//   4. a repositioned cell → exactly that tilemap byte;
//   5. an erased cell → cell 0's byte, counted in `erased`;
//   6. the arena palette is master-blob-backed (provenance ≥ 0 → color write-back).
//
// Run: node snes-framework/scripts/engine/screen-raphael.test.ts (reference-cart-gated).

import { loadDevCart } from './dev-cart.ts';
import { decodeAsepriteStructural } from './aseprite.ts';
import {
  buildRaphaelArenaContext, exportRaphaelArena, raphaelTileKeys, diffRaphaelArenaPlacement,
  RAPHAEL_TILEMAP_FILE_ID
} from './screen-raphael.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (!c) { console.error(`  ✗ ${m}`); failures++; } else console.log(`  ✓ ${m}`); };

const { rom, symbols } = loadDevCart();

// ── (1) context anatomy ──────────────────────────────────────────────────────
const ctx = buildRaphaelArenaContext(rom, symbols);
assert(ctx.chars.length === 256 * 32, 'all 256 CPC chars decoded (files $B9-$BC)');
assert(ctx.tilemap.length === 64 * 64, 'the $BD tilemap is 64×64 byte cells');
assert(ctx.tilemap.every((b) => b >= 0 && b <= 0xff), 'every cell is a char index');
assert(ctx.palRow.slice(0, 128).every((r) => r === 0), 'chars 0-127 draw with palette row 0');
assert(ctx.palRow.slice(128).some((r) => r > 0), 'chars 128-255 carry table palette rows');
assert(ctx.palRow.every((r) => r <= 7), 'palette rows are 3-bit');
assert(ctx.provenance[0]! >= 0 && ctx.provenance[0x4f]! >= 0, 'arena palette rows 0-4 are master-blob-backed');
assert(ctx.provenance[0x50]! === -1, 'rows 5-7 are not blob-sourced');

// ── (2) export shape ─────────────────────────────────────────────────────────
{
  const png = exportRaphaelArena(rom, symbols);
  assert(png.file === 'bosses/raphael-arena.png' && png.png.length > 0, 'PNG view exported under bosses/');
  assert(png.aseprite === undefined && png.tileKeys === undefined, 'png mode carries no layout tilemap');
  assert(png.width === 512 && png.height === 512, 'the view is the full 512×512 arena');
  assert(png.fileId === RAPHAEL_TILEMAP_FILE_ID, 'round-trip target is the $BD tilemap file');
}
const exp = exportRaphaelArena(rom, symbols, { aseprite: true });
assert(!!exp.aseprite && !!exp.tileKeys && !!exp.paletteOffsets, 'aseprite mode carries the layout + keys + palette offsets');
assert(exp.tileKeys!.length === 257 && exp.tileKeys![0] === -1, 'tileKeys = empty tile + the full 256-char space');
assert(exp.tileKeys!.every((k, i) => i === 0 || (k >> 3) === i - 1), 'tile i = char i-1 (identity order)');
assert(exp.paletteOffsets!.some((o) => o >= 0), 'some exported colors are blob-editable');

// ── (3) unedited round-trip ──────────────────────────────────────────────────
const struct = decodeAsepriteStructural(exp.aseprite!);
assert(struct.wTiles === 64 && struct.hTiles === 64, 'layout grid is 64×64 cells');
{
  const d = diffRaphaelArenaPlacement(ctx, exp.tileKeys!, struct);
  assert(d.tilemap === null && d.erased === 0, 'unedited .aseprite → zero edits');
}

// ── (4) one repositioned cell → exactly that byte ────────────────────────────
{
  const cellIdx = 64 * 30 + 31; // middle of the moon
  const newChar = (ctx.tilemap[cellIdx]! + 1) & 0xff;
  const edited = decodeAsepriteStructural(exp.aseprite!);
  edited.cells[cellIdx] = { tile: newChar + 1 };
  const d = diffRaphaelArenaPlacement(ctx, exp.tileKeys!, edited);
  assert(d.tilemap !== null && d.erased === 0, 'a moved cell produces an edit');
  let diffs = 0;
  for (let i = 0; i < 4096; i++) if (d.tilemap![i] !== ctx.tilemap[i]) diffs++;
  assert(diffs === 1 && d.tilemap![cellIdx] === newChar, 'exactly the edited cell byte changed, to the new char');
}

// ── (5) erased cell → cell 0's byte ──────────────────────────────────────────
{
  // Pick a cell whose char differs from cell 0's (any moon/cloud cell) so the
  // erase-to-backdrop write is observable, not a no-op.
  const cellIdx = ctx.tilemap.findIndex((b) => b !== ctx.tilemap[0]);
  assert(cellIdx > 0, 'the arena has a non-backdrop cell to erase');
  const edited = decodeAsepriteStructural(exp.aseprite!);
  edited.cells[cellIdx] = { tile: 0 };
  const d = diffRaphaelArenaPlacement(ctx, exp.tileKeys!, edited);
  assert(d.erased === 1, 'the erased cell is counted');
  assert(d.tilemap !== null && d.tilemap![cellIdx] === ctx.tilemap[0], 'erased cell takes cell 0\'s byte');
  // A raphaelTileKeys-derived key set (old manifest fallback) matches the export's.
  const derived = raphaelTileKeys(ctx);
  assert(derived.length === exp.tileKeys!.length && derived.every((k, i) => k === exp.tileKeys![i]), 'tileKeys derive deterministically');
}

console.log(failures === 0 ? '\n✓ all screen-raphael pins pass' : `\n✗ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
