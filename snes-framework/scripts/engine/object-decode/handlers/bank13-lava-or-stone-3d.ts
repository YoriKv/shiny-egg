// Bank13 stamp handlers for the shared lava / shore-pool init.
//
// Covers standard objects $1F + $20 — both wired through the same init
// `CODE_init_lava_or_stone_3d` ($12:9448, Bank12.asm:3158). The init
// builds a parity bit in `$A1` from the two nibbles of `$1B`,
// optionally writes a 4-byte effect-block descriptor into $7F:7472+
// (runtime lava-bubble / shore animation — dropped here; static
// render only), then dispatches via DATA_lava_or_stone_3d_extents and
// DATA_lava_or_shore_{stamp,subhandler}_ptrs to the right pair of
// stamp routines with the per-variant row threshold.
//
// Table indexing is `x = $15 & 1`:
//   x=0 ($20)  →  shore_or_pool stamp on EVERY slot,  $19 = $0002
//                 (rows 0..1 even/odd col, rows 2+ row handler — all
//                  the same CODE_stone_3d_stamp)
//   x=1 ($1F)  →  even/odd col → lava_stamp, row handler →
//                 lava_shared_segment, $19 = $0005
//
//
// Asm sources:
//   yi/Banks/Bank12.asm:3158       CODE_init_lava_or_stone_3d
//   yi/Banks/Bank13.asm:1959       CODE_lava_stamp           (YOGAN)
//   yi/Banks/Bank13.asm:1992       CODE_lava_shared_segment  (YOGAN_KYOTU)
//   yi/Banks/Bank13.asm:15013      CODE_stone_3d_stamp  (= CODE_stone_3d_stamp)
//   yi/Banks/Bank13.asm:15082      CODE_stone_3d_cap_select

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerRun } from '../walker.ts';
import { getMap16Left } from '../fetch.ts';
import { readBuf16, setProbeToCurrent, stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_lava_stamp (Bank13.asm:1959 / $13:8F8F) — object $1F per-cell.
//
//   REP #$30
//   LDX $1D
//   LDA $2C            ; row index
//   ASL ; TAY          ; word offset
//   LDA $28
//   AND #$0001
//   BNE  use_table_B
//   LDA DATA_138FAD,y  ; even col table  (left-column variant)
//   BRA store
// use_table_B:
//   LDA DATA_138FB7,y  ; odd col table   (right-column variant)
// store:
//   STA.l LevelDataBuffer,x
//   RTL
//
// Two 5-entry vertical lava strips. Used as both even and odd col
// handler for object $1F (rows 0..4). Rows >= 5 fall through to
// CODE_lava_shared_segment via the walker row handler.
// ─────────────────────────────────────────────────────────────────────

const DATA_lava_stamp_left  = [0x002B, 0x0027, 0x9100, 0x7E02, 0x7E05] as const;
const DATA_lava_stamp_right = [0x002C, 0x0027, 0x9101, 0x7E03, 0x7E05] as const;

const lavaStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  // Cart clamps via Y indexing on a 5-entry table; row threshold $19=5
  // keeps row<5 here, but mirror the cart's exact behaviour and clamp
  // defensively for safety.
  const idx = Math.min(row, DATA_lava_stamp_left.length - 1);
  const tile = (state.zp28 & 1) !== 0
    ? DATA_lava_stamp_right[idx]!
    : DATA_lava_stamp_left[idx]!;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_lava_shared_segment (Bank13.asm:1992 / $13:8FC1) — row handler
// for object $1F. Always stamps the universal lava mid-tile $7E04.
// ─────────────────────────────────────────────────────────────────────

const LAVA_SHARED_TILE = 0x7E04;
const lavaSharedSegment: PerCellHandler = (state) => {
  stampCell(state, LAVA_SHARED_TILE);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_stamp (Bank13.asm:15013
// / $13:FBA0) — object $20 per-cell.
//
// Two paths based on row Y (= $2C * 2):
//   Y <  6  → CODE_stone_3d_cap_select  (rows 0..2 cap)
//   Y >= 6  → deep-water body (row 3+)
//
// At end-of-column the stamp toggles $A1 so the alternating-column
// parity flips between columns.
// ─────────────────────────────────────────────────────────────────────

// Cap-row tile groups (Bank13.asm:15066+, DATA_stone_3d_cap_tiles..DATA_stone_3d_cap_tiles_wall_alt).
const DATA_stone_3d_cap_tiles    = [0x0028, 0x0100, 0x0103] as const;
const DATA_stone_3d_cap_tiles_alt    = [0x002D, 0x010A, 0x0105] as const;
const DATA_stone_3d_cap_tiles_wall = [0x0028, 0x9C00, 0x0103] as const;
const DATA_stone_3d_cap_tiles_wall_alt = [0x002D, 0x9C03, 0x0105] as const;

/**
 * CODE_stone_3d_cap_select — pick a tile from the cap tile
 * group based on column position, $15 orientation, and the left
 * neighbour's tile. Returns the resolved 16-bit Map16 ID (cart writes
 * it into `$04`).
 *
 * Path summary:
 *   - default candidate = DATA_stone_3d_cap_tiles[y] + $A1
 *   - $28 == 0 (first column):
 *       $15 == $8000 → DATA_stone_3d_cap_tiles_wall[y] + $A1
 *       else         → keep default
 *   - $28+1 == $2A (last column):
 *       probe left tile; if it's an edge-marker
 *         ($0029/$002D/$0101/$010A/$0104/$0105) → "merge" branch
 *         (DATA_stone_3d_cap_tiles_wall_alt[y] if $15==$8000, else
 *          DATA_stone_3d_cap_tiles_alt[y])
 *       else → INC default (so the left-edge tile is followed by its
 *              "right-edge cap" counterpart, e.g. $0028 → $0029)
 *   - other columns:
 *       $15 == $8000 → DATA_stone_3d_cap_tiles_wall[y] + $A1
 *       else if $A1 != 0 (column-parity is "right side"):
 *           if at end of column or matching probe → alt group
 *           else → keep default
 *       else → keep default
 *
 * The trace for $20 (with $15=0, $A1 toggling between cols) hits two
 * paths: first col → default ($0028/$0100/$0103); subsequent even
 * cols (post toggle, $A1=0 at col 0/2/4..., $A1=1 at col 1/3/5...) —
 * but spec shows columns 1,3,5,7 stamp $0029/$0101/$0104, which is
 * default+1 from the column-parity ADC. That matches the "ADC $A1"
 * at the top of cap_select: with $A1=1 added to $0028 we get $0029.
 */
function pipeCapSelect(state: DecodeState, y: number): number {
  const a1 = state.zpA1 & 0xffff;
  // Bound y to the 3-entry table; cart never indexes past it because
  // the deep_body branch handles row >= 3.
  const yIdx = Math.min(y >>> 1, DATA_stone_3d_cap_tiles.length - 1);
  let candidate = (DATA_stone_3d_cap_tiles[yIdx]! + a1) & 0xffff;

  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  const orient = state.zp15 & 0xffff;

  if (col === 0) {
    // CODE_13FC4D: $28 == 0 (first column).
    if (orient === 0x8000) {
      // CODE_13FC54: wallet group, +$A1.
      candidate = (DATA_stone_3d_cap_tiles_wall[yIdx]! + a1) & 0xffff;
    }
    return candidate;
  }

  // $28 != 0. Check end-of-column.
  if (((col + 1) & 0xff) === colExtent) {
    // CODE_13FC34: probe left and dispatch.
    setProbeToCurrent(state);
    const leftOff = getMap16Left(state);
    const leftTile = readBuf16(state, leftOff) & 0xffff;
    if (
      leftTile === 0x0029 || leftTile === 0x002D ||
      leftTile === 0x0101 || leftTile === 0x010A ||
      leftTile === 0x0104 || leftTile === 0x0105
    ) {
      // CODE_13FC60: edge-merge branch.
      if (orient === 0x8000) {
        candidate = DATA_stone_3d_cap_tiles_wall_alt[yIdx]!;
      } else {
        candidate = DATA_stone_3d_cap_tiles_alt[yIdx]!;
      }
      return candidate;
    }
    // No merge — INC and return (cart `INC ; BRA CODE_13FC6F`).
    return (candidate + 1) & 0xffff;
  }

  // CODE_13FC44: middle column.
  if (orient === 0x8000) {
    candidate = (DATA_stone_3d_cap_tiles_wall[yIdx]! + a1) & 0xffff;
  }
  // else: keep default (cart `BRA CODE_13FC71` returns with $04
  // unchanged from the top-of-routine ADC $A1).
  return candidate;
}

const shoreOrPoolStamp: PerCellHandler = (state) => {
  const y = (state.zp2C & 0xff) << 1; // cart `LDA $2C ; ASL ; TAY`
  let tile: number;

  if (y < 6) {
    // CODE_stone_3d_cap_select branch (rows 0..2).
    tile = pipeCapSelect(state, y);
  } else {
    // CODE_stone_3d_stamp_body (rows 3+):
    //   LDA $2C ; EOR $A1 ; AND #$0001 ; CLC ; ADC #$0108 ; STA $04
    //   LDX #$0000
    //   LDA $28 ; BEQ leftish ; INC ; CMP $2A ; BNE skip ; LDX #$0002 (rightish)
    //   leftish: LDA $04 ; JSR (DATA_stone_3d_body_subhandlers,x)  → check_left or check_right
    const row = state.zp2C & 0xff;
    let candidate = (((row ^ (state.zpA1 & 0xff)) & 1) + 0x0108) & 0xffff;

    const col = state.zp28 & 0xff;
    const colExtent = state.zp2A & 0xff;
    if (col === 0) {
      // pipe_body_check_left: if candidate == $0109 and left neighbour
      // isn't $0108, demote to $0106.
      if (candidate === 0x0109) {
        setProbeToCurrent(state);
        const leftOff = getMap16Left(state);
        const leftTile = readBuf16(state, leftOff) & 0xffff;
        if (leftTile !== 0x0108) {
          candidate = 0x0106;
        }
      }
    } else if (((col + 1) & 0xff) === colExtent) {
      // pipe_body_check_right: if candidate == $0108 and right neighbour
      // isn't $0109, demote to $0106. We need a right-neighbour probe,
      // but at the LAST column the cell to the right is unwritten, so
      // it'll be $0000 — always demote. (Spec confirms cells at col=7
      // last row stamp $0106.)
      if (candidate === 0x0108) {
        // Cart: JSR CODE_probe_right_tile — reads buffer at $1B+1.
        // We approximate via the same setProbeToCurrent + getMap16Left
        // mirror; since the right cell is post-current, reading it
        // yields the post-stamp value. For end-of-column the cell is
        // unwritten ($0000 != $0109) → demote.
        candidate = 0x0106;
      }
    }
    // Middle columns (col != 0 and col+1 != colExtent) skip the
    // body_check helpers (DATA_stone_3d_body_subhandlers indexed by X=$0000
    // / $0002 only; cart's BNE skip leaves $04 alone).

    // $15 != 0 paths (CODE_stone_3d_body_shape_select, CODE_stone_3d_neighbour_fixup neighbour-fixups) are
    // only entered when $15 is non-zero. Init clears $15 to 0 before
    // walker runs, so for object $20 we never enter these — skip.
    tile = candidate;
  }

  // CODE_stone_3d_stamp_store: at end of column, toggle $A1.
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  if (((row + 1) & 0xff) === rowExtent) {
    state.zpA1 = (state.zpA1 ^ 0x0001) & 0xffff;
  }

  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lava_or_stone_3d (Bank12.asm:3158 / $12:9448).
//
// Pseudo:
//   x = $15 & 1
//   ($24, $21) = bank(table[x])         ; even/odd col handler bank
//   $27       = bank(subhandler[x])     ; row handler bank
//   $A1 = (($1B >> 4) ^ $1B) & 1        ; nibble-XOR parity
//   if ($15 & 2):                        ; effect-block write path
//     pack ($1B, $1C, $2A-1, $2E-1) into next free $7F:7472+ slot
//     (runtime lava-bubble / shore animation; skipped here)
//   $15 = 0
//   ($22, $1F) = stamp_ptr[x] - 1       ; even/odd col handler ptr
//   $25       = subhandler_ptr[x] - 1   ; row handler ptr
//   $19       = extents[x]              ; row threshold
//   $17       = 0                       ; slope = 0
//   intra_object_walker()
//
// We collapse the dispatch into explicit PerCellHandler wiring on the
// walker. Banks are irrelevant in JS; the per-cell function pointers
// directly slot into walkerRun.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x1F, 0x20 share this handler.
function initLavaOrStone3d(state: DecodeState): void {
  // x = $15 & 1 selects the variant.
  const x = state.zp15 & 0x01;

  // Build $A1 = (($1B >> 4) XOR $1B) & 1. Cart runs this in REP #$30,
  // so the operation is on the 16-bit word at $1B — but the result is
  // ANDed to bit 0, so only the low nibble of $1B matters.
  const nibbleXorParity = (((state.zp1B >>> 4) ^ state.zp1B) & 0x0001);
  state.zpA1 = nibbleXorParity;

  // Effect-block write ($15 & 2 path): dropped for static render.
  // The cart finds the next free 4-byte slot in $7F:7472..$7F:74C1 and
  // writes (xy-packed coords, col extent-1, row extent-1). Used at
  // runtime to spawn the lava-bubble / shore-foam animation; the
  // static decoder doesn't model live-cell side effects.

  // Clear orientation and wire walker handlers.
  state.zp15 = 0;
  state.zp17 = 0;

  if (x === 0) {
    // Object $20: shore-or-pool stamp on all slots. $19 = $0002.
    walkerRun(
      state,
      /*oddCol=*/  shoreOrPoolStamp,
      /*evenCol=*/ shoreOrPoolStamp,
      /*row=*/     shoreOrPoolStamp,
      /*rowsEnd=*/ 0x0002
    );
  } else {
    // Object $1F: lava_stamp on col slots, lava_shared_segment on row
    // slot. $19 = $0005.
    walkerRun(
      state,
      /*oddCol=*/  lavaStamp,
      /*evenCol=*/ lavaStamp,
      /*row=*/     lavaSharedSegment,
      /*rowsEnd=*/ 0x0005
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Both $1F and $20 share the same init — selection is
// purely by `$15 & 1` (the orientation byte == object ID at init
// entry, before the STZ $15 wipe).
// ─────────────────────────────────────────────────────────────────────

export function installLavaOrStone3dHandlers(): void {
  registerStdObjectHandler(0x1F, initLavaOrStone3d);
  registerStdObjectHandler(0x20, initLavaOrStone3d);
}
