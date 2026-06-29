// Title-island tilemap PLACEMENT editing — pure text helpers over the island
// tilemap's inline `dw` words in `yi/Banks/Bank57.asm` (`DATA_5F9800`, worlds 1-5).
// Each `dw` holds TWO Mode-7 char-index cells (low byte = even cell, high = odd), so
// a cell edit rewrites one byte of its word. Same file + mechanism as palette-edit.ts
// (also Bank57.asm `dw` data) — the app layer composes both into the one overlay.
//
//   readIslandTilemapBytes — the asm text's DATA_5F9800 as a flat 1024-byte tilemap
//   applyIslandTilemapEdits — splice cell edits (offset→char) into the BASE text
//   readIslandTilemapEdits  — diff overlay-vs-base → the cell edits an overlay holds

import { dataWordEdits, findRegionDataWords } from './asm/data-words.ts';
import { applyEdits } from './asm/text-literals.ts';

/** The asm file + label the island tilemap lives in. */
export const ISLAND_TILEMAP_BANK_FILE = 'yi/Banks/Bank57.asm';
export const ISLAND_TILEMAP_LABEL = 'DATA_5F9800';
/** The `;@editable` region wrapping the worlds-1-5 block — bounds the scan to
 *  exactly DATA_5F9800 (the world-6 variant DATA_5F9C00 follows it in the same
 *  contiguous `dw` run, outside this region). */
export const ISLAND_TILEMAP_REGION = 'island-tilemap';
/** The worlds-1-5 island tilemap is 32×32 = 1024 cells. `findDataWords` keeps reading
 *  consecutive `dw` runs PAST the next label (`DATA_5F9C00`, the world-6 variant, etc.),
 *  so we cap to this — byteOffset is contiguous from the base, so cells 0..1023 are
 *  exactly DATA_5F9800 (verified vs the cart). */
const ISLAND_TILEMAP_BYTES = 1024;

/** One island placement edit: a Mode-7 char index `value` (0..255) at cell `offset`
 *  (0..1023, row-major into the 32×32 tilemap). */
export interface IslandTilemapEdit { offset: number; value: number }

/** The island tilemap as a flat byte array (1 byte/cell) from the asm `dw` words. */
export function readIslandTilemapBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(ISLAND_TILEMAP_BYTES);
  for (const w of findRegionDataWords(text, ISLAND_TILEMAP_REGION, ISLAND_TILEMAP_LABEL)) {
    if (w.byteOffset >= ISLAND_TILEMAP_BYTES) break; // past DATA_5F9800 into the next run
    bytes[w.byteOffset] = w.value & 0xff;
    if (w.byteOffset + 1 < ISLAND_TILEMAP_BYTES) bytes[w.byteOffset + 1] = (w.value >> 8) & 0xff;
  }
  return bytes;
}

/**
 * Splice cell edits into the BASE text → edited text (format-preserving; only the
 * `dw` words whose value changes are touched). Reborn from base, so the result =
 * base + exactly these edits. An edit's `offset` outside the tilemap is ignored.
 */
export function applyIslandTilemapEdits(baseText: string, edits: readonly IslandTilemapEdit[]): string {
  if (edits.length === 0) return baseText;
  const words = findRegionDataWords(baseText, ISLAND_TILEMAP_REGION, ISLAND_TILEMAP_LABEL);
  const editByte = new Map(edits.map((e) => [e.offset, e.value & 0xff]));
  const changes = new Map<number, number>();
  for (const w of words) {
    if (w.byteOffset >= ISLAND_TILEMAP_BYTES) break; // never touch the runs past DATA_5F9800
    const lo = editByte.has(w.byteOffset) ? editByte.get(w.byteOffset)! : (w.value & 0xff);
    const hi = editByte.has(w.byteOffset + 1) ? editByte.get(w.byteOffset + 1)! : ((w.value >> 8) & 0xff);
    const nv = (lo | (hi << 8)) & 0xffff;
    if (nv !== w.value) changes.set(w.byteOffset, nv);
  }
  return applyEdits(baseText, dataWordEdits(words, changes));
}

/**
 * Diff the base island tilemap against the SAME-layout bytes of a foreign cart →
 * the cell edits reproducing the foreign tilemap. Used by the ROM importer:
 * `foreignAt(byteOffset)` reads the foreign cart's char byte at that cell offset
 * (the tilemap sits at a fixed cart address, `DATA_5F9800`). Mirrors palette-edit.ts
 * `diffPaletteBlob`; the result is always a valid {@link applyIslandTilemapEdits} input.
 */
export function diffForeignIslandTilemap(
  baseText: string,
  foreignAt: (byteOffset: number) => number
): IslandTilemapEdit[] {
  const base = readIslandTilemapBytes(baseText);
  const out: IslandTilemapEdit[] = [];
  for (let i = 0; i < base.length; i++) {
    const fv = foreignAt(i) & 0xff;
    if (fv !== base[i]) out.push({ offset: i, value: fv });
  }
  return out;
}

/** The cell edits an overlay `Bank57.asm` holds vs base (every cell whose char differs). */
export function readIslandTilemapEdits(baseText: string, overlayText: string | null): IslandTilemapEdit[] {
  if (overlayText === null) return [];
  const base = readIslandTilemapBytes(baseText);
  const over = readIslandTilemapBytes(overlayText);
  const out: IslandTilemapEdit[] = [];
  for (let i = 0; i < Math.min(base.length, over.length); i++) {
    if (base[i] !== over[i]) out.push({ offset: i, value: over[i]! });
  }
  return out;
}
