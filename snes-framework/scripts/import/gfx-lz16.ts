// Unsized-lz16 graphics diff for the ROM importer. lz16 streams don't
// self-terminate, so diffing one needs its row count up front. The app layer
// sizes the level-loaded files from its scene walk (`gfxSizeRegistry`), but 55
// of the 187 lz16 files load from no level scene (mini-battle / bonus / boss /
// ending-cutscene sheets — see research/graphics-survey/11-vram-loading.md for
// the closed attribution) and were invisible to the graphics diff. This module covers
// them: the BASE extract's blob byte length is exact (the cart pointer table
// defines each blob's range), so `probeLz16RowCount` recovers the row count —
// and a row count is a property of the file's DECODED size (its VRAM
// destination), so the base-derived count is valid for the foreign stream
// too, exactly like the registry-sized path.
//
// Expected row counts for all 187 blobs are pinned against the ycompress size
// table in gfx-lz16.test.ts (research/graphics-editing/ycompress-allgfx.md);
// the test also pins the decode-level-equality property that makes the diff
// robust to a ycompress-reinserted cart (every blob re-encoded, art unchanged
// → not flagged).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lz16, probeLz16RowCount } from '../engine/decompress/index.ts';
import { snesToPC, type SymbolMap } from '../engine/symbol-map.ts';
import { parseGfxPtrTable, gfxFileForLabel, GFX_ARENA } from '../gfx-reinsert.ts';

/** One changed unsized-lz16 sheet — foreign decoded tiles + the probed row count
 *  (`saveGfxEdit` needs it to re-encode). */
export interface UnsizedLz16Item {
  fileId: number;
  tiles: Uint8Array;
  rowCount: number;
}

export interface UnsizedLz16Result {
  changed: UnsizedLz16Item[];
  /** Probe failures + foreign decode failures — surfaced, never silent. */
  skipped: number;
}

function decodeAt(cart: Uint8Array, tablePC: number, fileId: number, rowCount: number): Uint8Array {
  const p = tablePC + fileId * 3;
  const srcPC = snesToPC(cart[p]! | (cart[p + 1]! << 8) | (cart[p + 2]! << 16));
  const out = new Uint8Array(rowCount * 512);
  lz16(cart, srcPC, out, 0, rowCount);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Diff the foreign cart's lz16 sheets NOT covered by the caller's size registry
 * (`sizedIds`). Row counts are probed from the base extract's blobs under
 * `workRoot/assets/yi`; entries with no extracted blob are skipped silently
 * (unextracted slots), probe/decode failures count as `skipped`.
 */
export function diffUnsizedLz16Gfx(
  foreign: Uint8Array,
  base: Uint8Array,
  symbols: SymbolMap,
  workRoot: string,
  sizedIds: ReadonlySet<number>
): UnsizedLz16Result {
  const changed: UnsizedLz16Item[] = [];
  let skipped = 0;

  const tablePC = symbols.pc('DATA_lz16_compressed_gfx_ptrs');
  const bank06 = fs.readFileSync(path.join(workRoot, 'yi', GFX_ARENA.ptrBankFile), 'utf8');
  const labels = parseGfxPtrTable(bank06, 'lz16');
  const gfxDir = path.join(workRoot, 'assets', 'yi', 'Graphics');

  for (let fileId = 0; fileId < labels.length; fileId++) {
    if (sizedIds.has(fileId)) continue;
    const blobPath = path.join(gfxDir, gfxFileForLabel(labels[fileId]!, 'lz16'));
    if (!fs.existsSync(blobPath)) continue; // unextracted slot
    const rowCount = probeLz16RowCount(new Uint8Array(fs.readFileSync(blobPath)));
    if (rowCount === null) {
      skipped++;
      continue;
    }
    let baseTiles: Uint8Array;
    let foreignTiles: Uint8Array;
    try {
      baseTiles = decodeAt(base, tablePC, fileId, rowCount);
      foreignTiles = decodeAt(foreign, tablePC, fileId, rowCount);
    } catch {
      skipped++; // foreign stream wouldn't decode at the base row count (resized/garbage)
      continue;
    }
    if (!bytesEqual(baseTiles, foreignTiles)) changed.push({ fileId, tiles: foreignTiles, rowCount });
  }

  return { changed, skipped };
}
