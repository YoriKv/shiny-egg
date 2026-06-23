// Map16 block-definition edit (object-metatile Phase 3 — the structured editor's
// write-back core). Editing an EXISTING block's 4 sub-tile descriptors (which
// tile / flip / palette / priority each quadrant uses) is **size-neutral**: it
// overwrites the block's 8 bytes (4 LE words) in place in the `$4C:33F2`
// page-data region. No relocation/budget (that's only for ADDING blocks). The
// edits are applied as a post-assembly byte patch to the built ROM (mirrors
// `applyProjectPatches`), so the editor render + BizHawk both see them.
//
// Sub-tile word layout (standard SNES tilemap entry — `vhopppcc cccccccc`):
//   bit15 V-flip · bit14 H-flip · bit13 priority · bits12-10 palette row ·
//   bits9-0 10-bit tile index. (Same as map16.ts decode.)

import { loadMap16Tables, decodeMap16, type Map16SubTile, type Map16Tables } from './map16.ts';
import type { SymbolMap } from './symbol-map.ts';

/** Encode a Map16 sub-tile descriptor → its 16-bit tilemap word. Inverse of the
 *  `decodeMap16` bit-unpack. */
export function encodeSubTileWord(st: Map16SubTile): number {
  return (
    (st.vflip ? 0x8000 : 0) |
    (st.hflip ? 0x4000 : 0) |
    (st.priority ? 0x2000 : 0) |
    ((st.paletteRow & 0x07) << 10) |
    (st.tileIndex & 0x3ff)
  ) & 0xffff;
}

/** One Map16 block-definition edit: the 4 sub-tiles (TL, TR, BL, BR) to write. */
export interface Map16BlockEdit {
  map16Id: number;
  subtiles: Map16SubTile[];
}

/** Byte offset of a Map16 block within the page-data region (index[page] + tile*8). */
function blockByteOffset(tables: Map16Tables, map16Id: number): number {
  const page = (map16Id >>> 8) & 0xff;
  const tile = map16Id & 0xff;
  const base = tables.indexTable[page * 2]! | (tables.indexTable[page * 2 + 1]! << 8);
  return base + tile * 8;
}

/** The PC of a Map16 block's 8-byte definition in `rom`, or null if the page/tile
 *  is out of range (an overflow id with no real slot — never editable). */
export function map16BlockPC(rom: Uint8Array, symbols: SymbolMap, map16Id: number): number | null {
  const page = (map16Id >>> 8) & 0xff;
  const tables = loadMap16Tables(rom, symbols);
  if (page * 2 + 2 > tables.indexTable.length) return null;
  const tile = map16Id & 0xff;
  if (page < tables.pageCellCounts.length && tile >= tables.pageCellCounts[page]!) return null; // overflow slot
  const pc = symbols.pc('DATA_bitmap_asset_payloads') + blockByteOffset(tables, map16Id);
  return pc + 8 <= rom.length ? pc : null;
}

/** The current 4 sub-tiles of a block (base or already-patched `rom`) — the
 *  editor's starting state. Null if the id isn't a real block. */
export function readMap16Block(rom: Uint8Array, symbols: SymbolMap, map16Id: number): Map16SubTile[] | null {
  if (map16BlockPC(rom, symbols, map16Id) === null) return null;
  const out: Map16SubTile[] = new Array(4) as Map16SubTile[];
  try {
    decodeMap16(loadMap16Tables(rom, symbols), map16Id, out);
  } catch {
    return null;
  }
  return out;
}

/**
 * Overwrite the 4-word (8-byte) block definition for each edit IN PLACE in `rom`.
 * Size-neutral (editing an existing block never grows the region). Skips edits to
 * non-existent blocks (reported via the returned `skipped` ids). Returns bytes
 * written + skipped.
 */
export function applyMap16BlockEdits(
  rom: Uint8Array,
  symbols: SymbolMap,
  edits: readonly Map16BlockEdit[]
): { bytesWritten: number; skipped: number[] } {
  let bytesWritten = 0;
  const skipped: number[] = [];
  for (const e of edits) {
    const pc = map16BlockPC(rom, symbols, e.map16Id);
    if (pc === null || e.subtiles.length !== 4) { skipped.push(e.map16Id); continue; }
    for (let i = 0; i < 4; i++) {
      const w = encodeSubTileWord(e.subtiles[i]!);
      rom[pc + i * 2] = w & 0xff;
      rom[pc + i * 2 + 1] = (w >>> 8) & 0xff;
      bytesWritten += 2;
    }
  }
  return { bytesWritten, skipped };
}
