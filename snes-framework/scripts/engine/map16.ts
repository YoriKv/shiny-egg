// Map16 decoder. YI groups its BG1 graphics into 16×16-pixel "Map16 tiles",
// each composed of 4 standard SNES 8×8 sub-tiles. The runtime BG1 grid in
// `$7F:8000` stores Map16 IDs; this decoder resolves an ID to the 4 PPU
// sub-tile descriptors needed to draw it.
//
// # Cart layout (cart-static; load once)
//
// Two regions, both in bank `$4C` (HiROM mirror of LoROM `$18`):
//
//   Index table  SNES `$4C:32A4` (LoROM `$18:B2A4`)  PC `$0C32A4`  334 bytes
//                = 167 dw entries — one per Map16 *page* `$00..$A6`. Each
//                entry is a 16-bit LE byte-offset into the page-data region.
//
//   Page data    SNES `$4C:33F2` (LoROM `$18:B3F2`)  PC `$0C33F2`  ~41 KB
//                Contiguous run of 8-byte (4-word) chunks. Each chunk is
//                one Map16 tile = 4 sub-tile descriptor words.
//
// (See `docs/leveldataengine.md` §3.4.5 — addresses verified there. The
// SNES `$4C` and LoROM `$18` addresses both map to the same cart byte via
// YI's HiROM mirror.)
//
// # Map16 ID layout
//
//   high byte = page index (0..A6)
//   low byte  = tile index within page (0..*)  — variable per page
//
// To resolve ID = (page << 8) | tile:
//   1. offset = readU16LE(indexTable, page * 2)        — byte offset into pageData
//   2. base   = offset + tile * 8                       — byte offset of this Map16 tile
//   3. sub-tile words: 4 × readU16LE(pageData, base + i * 2) for i in 0..3
//
// # Sub-tile word layout (standard SNES tilemap entry — `vhopppcc cccccccc`)
//
//   bit 15  v  vertical flip
//   bit 14  h  horizontal flip
//   bit 13  o  priority (BG-priority bit; meaning depends on PPU mode)
//   bits 12..10  ppp  palette row (0..7) — selects CGRAM[ppp*16..ppp*16+15]
//   bits  9..0   cccccccccc  tile index (0..1023) into VRAM tile data
//
// Sub-tile ordering within a Map16 cell follows SNES convention:
//
//   [0] = top-left  8×8
//   [1] = top-right
//   [2] = bottom-left
//   [3] = bottom-right

import type { SymbolMap } from './symbol-map.ts';

const INDEX_TABLE_BYTES = 334;
const PAGE_COUNT = 167;
const BYTES_PER_CELL = 8;
// Page data runs to PC $0CD619 (per docs/leveldataengine.md §3.4.5; verified
// against $4C:D619). Total page-data size = $D619 - $33F2 = 41511 bytes.
const PAGE_DATA_END_OFFSET = 0xd619 - 0x33f2; // 41511

/** Cart-static Map16 lookup tables. Load once via `loadMap16Tables(rom, symbols)`. */
export interface Map16Tables {
  /** 167 16-bit LE entries — one per page index. */
  indexTable: Uint8Array;
  /** Contiguous 8-byte chunks; index via `decodeMap16`. */
  pageData: Uint8Array;
  /** Number of valid cells in each page (one entry per page, length 167).
   *  Derived from the index table: adjacent entries' offset-delta / 8 = the
   *  cell count for that page. The last page's count uses the documented
   *  end-of-page-data marker ($0CD619). YI's pages have **variable sizes**
   *  — most are far smaller than 256 cells; some are only 1-3 cells. */
  pageCellCounts: Uint16Array;
}

export interface Map16SubTile {
  /** 10-bit VRAM tile index (0..1023). */
  tileIndex: number;
  /** 3-bit palette row (0..7). */
  paletteRow: number;
  /** Horizontal flip. */
  hflip: boolean;
  /** Vertical flip. */
  vflip: boolean;
  /** BG priority bit. */
  priority: boolean;
}

/**
 * Extract the Map16 lookup tables from a YI cart. The returned arrays alias
 * the source `rom` buffer — do not mutate them.
 *
 * The page-data slice extends from `$0C33F2` to the end of `rom`; we don't
 * know the exact upper bound without per-page accounting, but extending to
 * EOF is safe because the consumer only reads at offsets computed by
 * `decodeMap16` (and YI never indexes outside the real data region).
 */
export function loadMap16Tables(rom: Uint8Array, symbols: SymbolMap): Map16Tables {
  // SNES $4C:32A4 / $4C:33F2 — SuperFX HiROM. Resolved via the friendly
  // upstream aliases for drift-resistance against any asm patch that
  // shifts the Map16 region.
  const indexTablePC = symbols.pc('DATA_bitmap_asset_offset_table');
  const pageDataPC = symbols.pc('DATA_bitmap_asset_payloads');
  if (rom.length < pageDataPC) {
    throw new RangeError(
      `loadMap16Tables: cart is ${rom.length} bytes, need at least ${pageDataPC} to reach Map16 page data`
    );
  }
  const indexTable = rom.subarray(indexTablePC, indexTablePC + INDEX_TABLE_BYTES);

  // Derive per-page cell counts from the index-table deltas. Each entry is
  // a u16 LE byte-offset into pageData; the gap between consecutive entries
  // is the per-page byte-extent, and dividing by 8 (bytes per cell) gives
  // the cell count. The last page extends to the documented end marker.
  const pageCellCounts = new Uint16Array(PAGE_COUNT);
  for (let p = 0; p < PAGE_COUNT; p++) {
    const start = indexTable[p * 2] | (indexTable[p * 2 + 1] << 8);
    const nextStart =
      p + 1 < PAGE_COUNT
        ? indexTable[(p + 1) * 2] | (indexTable[(p + 1) * 2 + 1] << 8)
        : PAGE_DATA_END_OFFSET;
    pageCellCounts[p] = Math.max(0, Math.floor((nextStart - start) / BYTES_PER_CELL));
  }

  return {
    indexTable,
    pageData: rom.subarray(pageDataPC),
    pageCellCounts,
  };
}

const readU16LE = (buf: Uint8Array, off: number): number =>
  buf[off] | (buf[off + 1] << 8);

/**
 * Resolve a 16-bit Map16 ID to its 4 sub-tile descriptors. `out` is filled
 * in-place to avoid allocation; pass a `Map16SubTile[]` of length 4 (it
 * doesn't have to be pre-populated with valid objects, just a typed
 * 4-element array).
 *
 * Throws if the page index is out of range or the resulting page-data offset
 * would read past the table buffer.
 */
export function decodeMap16(
  tables: Map16Tables,
  map16Id: number,
  out: Map16SubTile[]
): void {
  const page = (map16Id >>> 8) & 0xff;
  const tile = map16Id & 0xff;

  const pageOffset = page * 2;
  if (pageOffset + 2 > tables.indexTable.length) {
    throw new RangeError(
      `decodeMap16: page 0x${page.toString(16)} out of index-table range (table has ${tables.indexTable.length / 2} entries)`
    );
  }
  const pageBase = readU16LE(tables.indexTable, pageOffset);
  const tileBase = pageBase + tile * 8;
  if (tileBase + 8 > tables.pageData.length) {
    throw new RangeError(
      `decodeMap16: Map16 0x${map16Id.toString(16)} would read past pageData (need byte ${tileBase + 7}, have ${tables.pageData.length})`
    );
  }

  for (let i = 0; i < 4; i++) {
    const w = readU16LE(tables.pageData, tileBase + i * 2);
    out[i] = {
      tileIndex: w & 0x3ff,
      paletteRow: (w >>> 10) & 0x07,
      priority: (w & 0x2000) !== 0,
      hflip: (w & 0x4000) !== 0,
      vflip: (w & 0x8000) !== 0,
    };
  }
}

/** Convenience wrapper that allocates the 4-element output array. */
export function decodeMap16Alloc(tables: Map16Tables, map16Id: number): Map16SubTile[] {
  const out: Map16SubTile[] = new Array(4) as Map16SubTile[];
  decodeMap16(tables, map16Id, out);
  return out;
}

/**
 * Build `Map16Tables` from the authoring-side `pnl/unit.dat` — the flat page
 * array `ys_pnlcnv` compiles into the cart's `$4C:32A4` / `$4C:33F2` pair.
 *
 * Layout: **256 pages × 256 cells × 4 BIG-endian words** (TL, TR, BL, BR), so
 * cell (page, tile) is at byte `(page * 256 + tile) * 8`. Only the first
 * `PAGE_COUNT` pages are meaningful; the rest are the allocator's slack.
 *
 * `ys_pnlcnv` does two things to this on the way to the cart: byte-swaps to LE,
 * and tail-compacts each page (drops trailing unused cells, which is why the
 * cart's pages have wildly varying sizes). We skip the compaction — nothing
 * downstream depends on it, `decodeMap16` indexes by `pageBase + tile * 8`
 * either way, and keeping full pages means an override can define a cell the
 * cart's compacted page dropped.
 *
 * Verified: converting `source_Ver0/pnl/unit.dat` this way reproduces the built
 * cart's Map16 page data cell-for-cell (`tmp/unit-dat-check.ts`).
 */
export function map16TablesFromUnitDat(unitDat: Uint8Array): Map16Tables {
  const CELLS_PER_PAGE = 256;
  const pageBytes = CELLS_PER_PAGE * BYTES_PER_CELL;
  const need = PAGE_COUNT * pageBytes;
  if (unitDat.length < need) {
    throw new RangeError(`map16TablesFromUnitDat: need ${need} bytes for ${PAGE_COUNT} pages, got ${unitDat.length}`);
  }
  // Tail-compaction is NOT optional: the index table is u16 byte offsets, and 167
  // uncompacted 2 KB pages would need 340 KB of offset range. Trailing all-zero
  // cells are the padding `ys_pnlcnv` drops, which is what makes the offsets fit.
  const isBlank = (o: number) => {
    for (let i = 0; i < BYTES_PER_CELL; i++) if (unitDat[o + i] !== 0) return false;
    return true;
  };
  const counts = new Uint16Array(PAGE_COUNT);
  let total = 0;
  for (let p = 0; p < PAGE_COUNT; p++) {
    let n = CELLS_PER_PAGE;
    while (n > 0 && isBlank(p * pageBytes + (n - 1) * BYTES_PER_CELL)) n--;
    counts[p] = n;
    total += n * BYTES_PER_CELL;
  }
  const indexTable = new Uint8Array(INDEX_TABLE_BYTES);
  const pageData = new Uint8Array(total);
  let at = 0;
  for (let p = 0; p < PAGE_COUNT; p++) {
    indexTable[p * 2] = at & 0xff;
    indexTable[p * 2 + 1] = (at >>> 8) & 0xff;
    const src = p * pageBytes;
    for (let i = 0; i < counts[p] * BYTES_PER_CELL; i += 2) {
      pageData[at + i] = unitDat[src + i + 1];        // BE -> LE
      pageData[at + i + 1] = unitDat[src + i];
    }
    at += counts[p] * BYTES_PER_CELL;
  }
  return { indexTable, pageData, pageCellCounts: counts };
}
