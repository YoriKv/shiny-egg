// Bank13 fence-2variant stamp handlers + Bank12 init wrapper.
//
// Standard objects $A7 / $A8 — two "fence/wall with corner-awareness"
// variants. Both share `CODE_init_fence_2variant` ($12:9EDE); the
// orientation byte `$15` bit 3 picks the stamp body:
//
//   $15 bit 3 == 0  →  CODE_stamp_fence_corner   ($13DC91)
//   $15 bit 3 == 1  →  CODE_stamp_fence_probing  ($13DCF3) [decorator]
//
// Corner-corpus tile selection is shared: both stampers index
// `DATA_fence_corner_tiles` ($13DC7F) — a 9-entry 3x3 lookup keyed on a
// 3-state column bucket (left/middle/right) × 3-state row bucket
// (top/middle/bottom):
//
//   col bucket: $28==0 → 0;   $28+1 == $2A → 2;   else 1   (×2 entries)
//   row bucket: $2C==0 → 0;   $2C+1 == $2E → 6;   else 3
//
//   bucket → DATA_fence_corner_tiles[col + row]:
//     [ $0000, $7780, $0000,    ← top row    (corners: $7780 = top edge)
//       $777E, $7C00, $777D,    ← middle row (body $7C00, sides $777E/$777D)
//       $0000, $7784, $0000 ]   ← bottom row (corners: $7784 = bottom edge)
//
//   Cells that land on a $0000 entry skip the stamp (corner cells of the
//   3x3 corpus are intentionally blank — the visible fence is a "plus"
//   shape inside a 3x3 corner grid).
//
// Both stampers also implement a "page-OR" post-process: when the
// resolved tile is in the contiguous fence Map16 range $777D..$778C
// AND the existing cell underneath is also in that range, OR the
// existing cell's low-bits into the new tile to preserve previously-
// stamped connection bits. This lets overlapping fence objects keep
// adjacent-side bits visible from both placements.
//
// The probing variant ($A8) is the "remove a section of $A7" pass: when the
// cell would stamp the centre body, it probes the four neighbours
// (above/below/left/right) for $7C00 and ORs connection bits ($08 above, $04
// below, $01 left, $02 right). The final tile is `$777C + mask` — a
// connection-aware spike border — UNLESS no neighbour is a body tile (mask==0),
// in which case the cart stamps $0000, i.e. ERASES the cell (the body is
// stamped unconditionally; a no-connection body cell is blanked, not kept).
//
// Init handler mutations (from spec):
//   $1B (xy_lo): SBC #$0010 on high nibbles + DEC on low nibbles
//                (origin shifts left 1 sub-col AND up 1 sub-row,
//                 wrapping across screen-page boundaries)
//   $2A: +2     (col extent: $10 → $12; visual width = data width + 2)
//   $2E: +2     (row extent: $02 → $04, $10 → $12; height + 2)
//

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import {
  getMap16Above, getMap16Below, getMap16Left, getMap16Right,
} from '../fetch.ts';
import {
  stampCell, readBuf16, setProbeToCurrent, shiftOriginNibble,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_fence_corner_tiles
//
// 9-entry 3x3 corner-tile lookup. Indexed by (rowBucket + colBucket)
// where each bucket is 0/2/4 (col) or 0/6/12 (row), so the flat
// 16-bit-pitch array maps as:
//
//   colBucket=0 (left col)   1 (mid col)  2 (right col)
//   rowBucket=0  $0000       $7780        $0000
//   rowBucket=6  $777E       $7C00        $777D
//   rowBucket=12 $0000       $7784        $0000
//
// Cells that land on a $0000 entry are skipped (no stamp).
// ─────────────────────────────────────────────────────────────────────
const DATA_fence_corner_tiles = [
  0x0000, 0x7780, 0x0000,
  0x777E, 0x7C00, 0x777D,
  0x0000, 0x7784, 0x0000,
] as const;

const FENCE_BODY_TILE = 0x7C00;   // centre-of-corpus tile
const FENCE_RANGE_BASE = 0x777C;  // SBC #$777C in stamp epilogue
const FENCE_RANGE_LIMIT = 0x000F; // CMP #$000F BCS skip in stamp epilogue

// Connection-mask bits for CODE_stamp_fence_probing:
const FENCE_PROBE_ABOVE = 0x08;
const FENCE_PROBE_BELOW = 0x04;
const FENCE_PROBE_LEFT  = 0x01;
const FENCE_PROBE_RIGHT = 0x02;

// ─────────────────────────────────────────────────────────────────────
// Shared 3x3 bucket resolution used by both stampers.
// Returns the chosen tile from DATA_fence_corner_tiles, or 0 if the
// cell falls on a blank-corner slot.
// ─────────────────────────────────────────────────────────────────────
function fenceCornerLookup(state: DecodeState): number {
  // Column bucket in flat entry units: 0 (left edge), 1 (middle), 2 (right
  // edge). Asm uses INC then CMP $2A: col is "last" when col+1 == colExtent.
  let colIdx = 0;
  const col = state.zp28 & 0xff;
  if (col === 0) {
    colIdx = 0;
  } else if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    colIdx = 2;
  } else {
    colIdx = 1;
  }

  // Row bucket: 0 (top), 6 (middle), 12 (bottom).
  let rowIdx = 0;
  const row = state.zp2C & 0xffff;
  if (row === 0) {
    rowIdx = 0;
  } else if (((row + 1) & 0xffff) === (state.zp2E & 0xffff)) {
    rowIdx = 6;
  } else {
    rowIdx = 3;  // (rowIdx in our 3x3 table is 3 in flat form, = $0006/2 in 16-bit asm pitch)
  }

  // Flat 3x3 index = rowIdx + colIdx. Both buckets are ALREADY in flat entry
  // units — colIdx is 0/1/2 (left/middle/right), rowIdx is 0/3/6 (top/middle/
  // bottom row base). The asm computes them as 16-bit *byte* offsets (col
  // 0/2/4, row 0/6/12) and reads DATA_fence_corner_tiles,y; ours are pre-divided by the
  // word pitch, so they index the flat array directly — no >>1. (The old
  // `colIdx >>> 1` re-halved an already-flat index, collapsing middle→left
  // and right→middle: the garbled-spike-ball / $A7 bug.)
  return DATA_fence_corner_tiles[rowIdx + colIdx] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_fence_corner ($13DC91) — variant 0 ($A7).
//
// 3x3 corner-bucket lookup + connection-preserving page-OR.
// ─────────────────────────────────────────────────────────────────────
const stampFenceCorner: PerCellHandler = (state) => {
  const baseTile = fenceCornerLookup(state);
  if (baseTile === 0) return;              // blank corner slot → skip stamp
  if (baseTile === FENCE_BODY_TILE) {      // body ($7C00) → stamp as-is, no merge
    stampCell(state, baseTile);
    return;
  }

  // Edge tile. The cart merges with / defers to whatever is already here:
  //   existing == 0           → stamp the edge tile (empty cell).
  //   existing is a fence tile → OR connection bits into the new tile (merge).
  //   existing is anything else → RETURN WITHOUT STAMPING (preserve it).
  // Asm: SBC #$777C ; STA $02 ; DEC ; CMP #$000F ; BCS skip — i.e. stamp only
  // when exMask ∈ [1,$F] (existing ∈ $777D..$778B). The old port stamped the
  // edge tile in the skip case too, overwriting an adjacent fence's body
  // ($7C00) and the brick below it (the "A7 blacks out its neighbour" bug).
  const existing = state.zp12 & 0xffff;
  if (existing === 0) {
    stampCell(state, baseTile);
    return;
  }
  const exMask = (existing - FENCE_RANGE_BASE) & 0xffff;
  if (exMask < 1 || exMask > FENCE_RANGE_LIMIT) return;  // non-fence neighbour → preserve
  const newMask = (baseTile - FENCE_RANGE_BASE) & 0xffff;
  stampCell(state, (FENCE_RANGE_BASE + (newMask | exMask)) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_fence_probing_neighbour_scan ($13DD66) — used by stamp_fence_probing
// when the body tile $7C00 is the candidate. Probes 4 neighbours for
// $7C00 and returns a connection mask shifted into the fence Map16 range.
//
// Returns the resolved tile (== $777C + mask) OR 0 if no neighbour
// connections (mask == 0 → no stamp).
// ─────────────────────────────────────────────────────────────────────
function fenceProbingNeighbourScan(state: DecodeState): number {
  let mask = 0;

  // Above probe: zp0E = zp1B; get_map16_above; LDA buffer,x.
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  if (readBuf16(state, aboveOff) === FENCE_BODY_TILE) {
    mask |= FENCE_PROBE_ABOVE;
  }

  // Below probe: only when row+2 == row-extent (we're at the second-to-last
  // row, allowing the probe to reach beyond — see asm LDA $2C INC INC CMP $2E).
  const row = state.zp2C & 0xffff;
  const rowExt = state.zp2E & 0xffff;
  if (((row + 2) & 0xffff) === rowExt) {
    setProbeToCurrent(state);
    const belowOff = getMap16Below(state);
    if (readBuf16(state, belowOff) === FENCE_BODY_TILE) {
      mask |= FENCE_PROBE_BELOW;
    }
  }

  // Left probe: always.
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  if (readBuf16(state, leftOff) === FENCE_BODY_TILE) {
    mask |= FENCE_PROBE_LEFT;
  }

  // Right probe: only when col+2 == col-extent.
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  if (((col + 2) & 0xff) === colExt) {
    setProbeToCurrent(state);
    const rightOff = getMap16Right(state);
    if (readBuf16(state, rightOff) === FENCE_BODY_TILE) {
      mask |= FENCE_PROBE_RIGHT;
    }
  }

  if (mask === 0) return 0;
  return (FENCE_RANGE_BASE + mask) & 0xffff;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_fence_probing ($13DCF3) — variant 1 ($A8) [decorator].
//
// Same 3x3 bucket as corner variant. Diverges at the resolved-tile
// epilogue (the cart STAMPS in every non-skip branch — including with $0000):
//   - if base tile is $7C00 (body): probe 4 neighbours, derive
//     connection-mask, stamp $777C+mask — or $0000 when mask==0 (erase).
//   - if base tile is a corner: skip (RTS, preserve) when the existing cell is
//     $7C00, is non-fence, or shares NO connection bits with the new tile
//     (newMask & exMask == 0). Otherwise EOR the masks: a zero result stamps
//     $0000, a non-zero result re-anchors at $777C+result.
// ─────────────────────────────────────────────────────────────────────
const stampFenceProbing: PerCellHandler = (state) => {
  const baseTile = fenceCornerLookup(state);
  if (baseTile === 0) return;  // blank corner slot

  let outTile: number;
  if (baseTile === FENCE_BODY_TILE) {
    // Body cell. The cart stamps UNCONDITIONALLY (JSR neighbour_scan ; BRA
    // load_result → `LDA $04 ; STA buffer,x`): when no neighbour is a body tile
    // the scan leaves $04 = 0, so the cell is overwritten with $0000 — this is
    // A8's whole purpose ("remove"/erase a section of the A7 spike field). An
    // earlier port `return`ed on mask==0, leaving A7's $7C00 in place — that is
    // the leftover-checkerboard the erase pass should have blanked.
    outTile = fenceProbingNeighbourScan(state); // 0 ⇒ stamp blank (erase)
  } else {
    // Corner/edge tile (CODE_fence_probing_connection_mask).
    const existing = state.zp12 & 0xffff;
    if (existing === FENCE_BODY_TILE) return;  // existing==body → cart RTSes, preserve

    const exMask = (existing - FENCE_RANGE_BASE) & 0xffff;
    // DEC ; CMP #$000F ; BCS skip — keep only exMask ∈ [1,$F] (existing is a
    // fence-range tile); otherwise the cart RTSes without stamping.
    if (exMask < 1 || exMask > FENCE_RANGE_LIMIT) return;

    const newMask = (baseTile - FENCE_RANGE_BASE) & 0xffff;
    // AND $02 ; BEQ skip — no shared connection bits ⇒ cart RTSes (preserve the
    // existing cell). The old port stamped `baseTile` here, painting stray fence
    // edges over good cells.
    if ((newMask & exMask) === 0) return;

    // LDA $04 ; EOR $02 ; BEQ store — when newMask == exMask the EOR is 0 and the
    // `BEQ` branches straight to the store with A still 0, so the cart stamps
    // $0000 (NOT the raw newMask — the old port misread the branch target as the
    // `LDA $04` reload, which produced the stray $0002/$0004 "stone" tiles above
    // an A8 region). Non-zero ⇒ re-anchor in the fence range.
    const merged = newMask ^ exMask;
    outTile = merged === 0 ? 0 : (FENCE_RANGE_BASE + merged) & 0xffff;
  }
  stampCell(state, outTile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_fence_2variant ($12:9EDE)
//
// Origin / extent mutation, then $15 bit 3 selects stamper.
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0xA7, 0xA8 share this handler.
function initFence2variant(state: DecodeState): void {
  // $1B mutation:
  //   - high-nibble pair (screen X/Y, $F0F0 mask): SBC #$0010 → shift
  //     up 1 sub-row at the screen-page level
  //   - low-nibble pair (sub X/Y, $0F0F mask): DEC then AND $0F0F →
  //     subtract 1 from low nibble (wrap-safe within sub coords)
  //   - OR back together
  // Compose from both bytes — the screen-shift can underflow from the
  // low byte's screen-X into the high byte's screen-Y when the object
  // sits near the left edge of a page.
  const xyEntry = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const screenPart = (xyEntry & 0xF0F0) - 0x0010;
  const screenKeep = screenPart & 0xF0F0;
  const subPart = (xyEntry & 0x0F0F) - 1;
  const subKeep = subPart & 0x0F0F;
  const newWord = (screenKeep | subKeep) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // Extent bumps: $2A += 2, $2E += 2.
  state.zp2A = (state.zp2A + 2) & 0xff;
  state.zp2E = (state.zp2E + 2) & 0xffff;

  // Dispatch on $15 bit 3.
  const variantBit = (state.zp15 & 0x08) >>> 3;
  const handler = variantBit === 0 ? stampFenceCorner : stampFenceProbing;
  walkerSetupTrampoline(state, handler);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installFence2variantHandlers(): void {
  registerStdObjectHandler(0xA7, initFence2variant);
  registerStdObjectHandler(0xA8, initFence2variant);
}
