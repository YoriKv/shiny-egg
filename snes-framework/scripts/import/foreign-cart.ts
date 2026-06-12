// Read level-data streams out of a FOREIGN (modified) cart, given the resolved
// top-level anchors. This is the import counterpart to extract.ts's per-level
// loop: it walks the same pointer table and reuses the same stream-end walkers,
// but returns the raw stream bytes in memory (no scratch tree) using the
// foreign cart's OWN header-bit-widths + property table. See plan-rom-import.md §6.

import { snesToPC } from '../engine/symbol-map.ts';
import { findObjStreamEndPC, findSprStreamEndPC } from '../extract.ts';
import { u24le } from '../engine/rom-read.ts';
import {
  LEVEL_COUNT,
  SENTINEL_OBJ_SNES,
  SENTINEL_SPR_SNES,
  type ImportAnchors
} from './anchors.ts';

export interface ForeignRecordStreams {
  objBytes: Buffer | null;
  sprBytes: Buffer | null;
  /** Cart PC offset each stream was sliced from (absent when the side is null).
   *  Feeds the diff inventory's level-extent attribution. */
  objStartPc?: number;
  sprStartPc?: number;
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
    const objSnes = u24le(cart, entryPc);
    const sprSnes = u24le(cart, entryPc + 3);

    let objBytes: Buffer | null = null;
    let sprBytes: Buffer | null = null;
    let objStartPc: number | undefined;
    let sprStartPc: number | undefined;

    if (objSnes !== 0 && objSnes !== SENTINEL_OBJ_SNES) {
      const start = snesToPC(objSnes);
      if (start >= 0 && start < cart.length) {
        const end = findObjStreamEndPC(cart, start, headerBitWidths, standardObjectInfo);
        if (end > start) {
          objBytes = cart.subarray(start, end);
          objStartPc = start;
        }
      }
    }

    if (sprSnes !== 0 && sprSnes !== SENTINEL_SPR_SNES) {
      const start = snesToPC(sprSnes);
      if (start >= 0 && start < cart.length) {
        const end = findSprStreamEndPC(cart, start);
        if (end > start) {
          sprBytes = cart.subarray(start, end);
          sprStartPc = start;
        }
      }
    }

    if (objBytes || sprBytes) {
      records.set(id, {
        objBytes,
        sprBytes,
        ...(objStartPc !== undefined ? { objStartPc } : {}),
        ...(sprStartPc !== undefined ? { sprStartPc } : {})
      });
    }
  }

  return { headerBitWidths, standardObjectInfo, records };
}
