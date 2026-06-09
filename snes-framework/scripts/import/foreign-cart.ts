// Read level-data streams out of a FOREIGN (modified) cart, given the resolved
// top-level anchors. This is the import counterpart to extract.ts's per-level
// loop: it walks the same pointer table and reuses the same stream-end walkers,
// but returns the raw stream bytes in memory (no scratch tree) using the
// foreign cart's OWN header-bit-widths + property table. See plan-rom-import.md §6.

import { snesToPC } from '../engine/symbol-map.ts';
import { readU24LE, findObjStreamEndPC, findSprStreamEndPC } from '../extract.ts';
import {
  LEVEL_COUNT,
  SENTINEL_OBJ_SNES,
  SENTINEL_SPR_SNES,
  type ImportAnchors
} from './anchors.ts';

export interface ForeignRecordStreams {
  objBytes: Buffer | null;
  sprBytes: Buffer | null;
}

export interface ForeignStreams {
  /** The foreign cart's header bit-widths (read at the resolved anchor). */
  headerBitWidths: number[];
  /** The foreign cart's 256-byte standard-object property table. */
  standardObjectInfo: number[];
  /** recordId → raw streams. Records with no data are absent. */
  records: Map<number, ForeignRecordStreams>;
}

/**
 * Walk the foreign cart's level pointer table and slice each record's object +
 * sprite streams. Pointers that don't map in-bounds, are zero, or hit a sentinel
 * are treated as "no stream" for that side (matches extract.ts semantics).
 */
export function readForeignStreams(cart: Buffer, anchors: ImportAnchors): ForeignStreams {
  const headerBitWidths: number[] = [];
  for (let i = 0; i < 32; i++) {
    const w = cart[anchors.headerBitWidthsPc + i];
    if (w === 0) break;
    headerBitWidths.push(w);
  }

  const standardObjectInfo: number[] = [];
  for (let i = 0; i < 256; i++) standardObjectInfo.push(cart[anchors.objectPropertyTablePc + i] ?? 0);

  const records = new Map<number, ForeignRecordStreams>();
  for (let id = 0; id < LEVEL_COUNT; id++) {
    const entryPc = anchors.levelPtrsPc + id * 6;
    if (entryPc + 6 > cart.length) break;
    const objSnes = readU24LE(cart, entryPc);
    const sprSnes = readU24LE(cart, entryPc + 3);

    let objBytes: Buffer | null = null;
    let sprBytes: Buffer | null = null;

    if (objSnes !== 0 && objSnes !== SENTINEL_OBJ_SNES) {
      const start = snesToPC(objSnes);
      if (start >= 0 && start < cart.length) {
        const end = findObjStreamEndPC(cart, start, headerBitWidths, standardObjectInfo);
        if (end > start) objBytes = cart.subarray(start, end);
      }
    }

    if (sprSnes !== 0 && sprSnes !== SENTINEL_SPR_SNES) {
      const start = snesToPC(sprSnes);
      if (start >= 0 && start < cart.length) {
        const end = findSprStreamEndPC(cart, start);
        if (end > start) sprBytes = cart.subarray(start, end);
      }
    }

    if (objBytes || sprBytes) records.set(id, { objBytes, sprBytes });
  }

  return { headerBitWidths, standardObjectInfo, records };
}
