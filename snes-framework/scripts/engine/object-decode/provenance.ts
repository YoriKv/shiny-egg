// Object-drag cell-highlight: reconstruct the recorded provenance cells into
// absolute on-screen cell coordinates + per-cell flags.
//
// The recorder (`_shared.ts:recordProvenance`) keys cells by their raw
// LevelDataBuffer byte-offset (page-indirected). To paint them, the renderer
// needs absolute cell coords (x 0..255, y 0..127) — the same space the
// rendered bitmap and `cell-grid.ts` use. We invert the page indirection here:
// each allocated screen owns exactly one LRU page (allocation is 1:1), so a
// `page → screen` map is unique and lets us map every recorded offset back to
// its on-screen cell.
//
// (Output reconstruction — the inverse of cell-grid.ts's page-indirection walk.)

import type { DecodeState } from './state.ts';
import { SCREEN_PAGE_UNALLOCATED, LRU_PAGE_MASK, PAGES } from '../cell-grid.ts';

/** One recorded cell of the provenance target, in absolute cell coords.
 *  `neighbor` = a touch-up the object wrote into a non-footprint cell;
 *  `buried` = a later object overdrew it. The IPC layer maps the
 *  (neighbor, buried) pair to a colour class. */
export interface ProvenanceCell {
  x: number;
  y: number;
  neighbor: boolean;
  buried: boolean;
  /** The Map16 ID this object stamped into the cell (read back from the
   *  decoded buffer). Lets the editor link a selected object to the Map16
   *  blocks it produces (Tiles "Used" view) and their palette rows. */
  mid: number;
}

/**
 * Resolve `state.provenanceCells` (buffer offset → flags) into absolute-cell
 * records. Returns `[]` when no target was armed or nothing was recorded.
 * Pure — depends only on the recorded map + `screenPageMap`.
 */
export function resolveProvenanceCells(state: DecodeState): ProvenanceCell[] {
  const cells = state.provenanceCells;
  if (cells === null || cells.size === 0) return [];

  // page → screen (0..127); -1 = no screen resolves to this page.
  const pageToScreen = new Int16Array(PAGES).fill(-1);
  for (let screen = 0; screen < state.screenPageMap.length; screen++) {
    const slot = state.screenPageMap[screen]!;
    if (slot === SCREEN_PAGE_UNALLOCATED) continue;
    const page = slot & LRU_PAGE_MASK;
    if (page === 0) continue; // page 0 = unstamped backing
    pageToScreen[page] = screen;
  }

  const out: ProvenanceCell[] = [];
  for (const [off, flags] of cells) {
    const page = off >> 9; // 512 bytes per page
    const screen = pageToScreen[page] ?? -1;
    if (screen < 0) continue; // page no longer mapped to a screen (cleared)
    const row = (off & 0x1ff) >> 5; // 0..15 within the screen
    const col = (off & 0x1f) >> 1; // 0..15 within the screen
    out.push({
      x: (screen & 0x0f) * 16 + col,
      y: (screen >> 4) * 16 + row,
      neighbor: flags.neighbor,
      buried: flags.buried,
      mid: state.levelDataBuffer[off]! | (state.levelDataBuffer[off + 1]! << 8)
    });
  }
  return out;
}
