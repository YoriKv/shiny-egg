// Bank13 goal platform ($6B) — wide structure with neighbour-probe edge-snap.
//
// Cart routines:
//   $12:9AA3  CODE_init_goal_platform  — std-object $6B init
//   $13:C742  CODE_goal_platform       — per-cell stamp
//   $13:FD54  CODE_probe_left_tile                       — left-neighbour probe
//
// Tables:
//   DATA_goal_platform_top_tiles  DATA_goal_platform_top_tiles  ($0188, $0189, $018A) — row-1 default fills
//   DATA_goal_platform_bot_tiles  DATA_goal_platform_bot_tiles  ($018B, $018C, $018D) — row-2+ default fills
//
// Init (CODE_12:9AA3):
//   INC $2E                  ; bump row extent (the stamp body's "row 1" coexists
//                              with the row-0 cap path)
//   $1B = $1B with the high-nibble of the low byte decremented by 1
//         (nibble-preserving "row shift up" by one tile-row — same shape as
//         `floorRowShiftUp` in `_shared.ts`)
//   walker setup trampoline → CODE_goal_platform on all 3 slots.
//
// Stamp (CODE_goal_platform): per-cell decision tree.
//
//   Row 0 ($2C == 0):
//     Only the LEFT column ($28 == 0) does any work. It probes the left
//     neighbour and, if that cell already holds either FloorRow0_LeftLo
//     ($1C5C) or FloorRow0_RightLo ($1C5E), stamps templateAt($1D14) into
//     the current cell — "snap onto an adjacent flat-floor cap".
//     Other columns on row 0 stamp nothing (autoconnect-only).
//
//   Row 1+ ($2C != 0): pick a default tile from the top/bot table, with a
//   row-1 left-edge override.
//     Build a 3-state column-index Y (multiplied by 2 for word stride):
//       Y = 0   when $28 == 0                                  (left edge)
//       Y = 4   when $28+1 == $2A   (i.e. last col)            (right edge)
//       Y = 2   otherwise                                       (interior)
//     If $2C == 1 (top body row):
//       Left-edge col ($28 == 0): probe left; on match against one of
//         {Row1LeftLo, Row1RightLo, $1CD2, $1CE6}, stamp templateAt($1CFC)
//         instead of the default. (Cap-snap onto a flat-floor body row.)
//       Otherwise stamp top_tiles[Y].
//     Else ($2C > 1, bottom rows):
//       Stamp bot_tiles[Y]. (No probe — bottom rows always use the table.)
//
// Trace spec ($6B, 16x5 cells): cell 0 row-0 probes left, finds $0000,
// stamps nothing. Cell 1 row-1 left-edge probes left, $0000, no override,
// stamps top_tiles[0]=$0188. Cells 2-4 (rows 2-4 of col 0) stamp
// bot_tiles[0]=$018B. Interior cols repeat with $0189/$018C. Last column
// (col 15) uses $018A/$018D. Matches our implementation exactly.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell, readBuf16, setProbeToCurrent, floorRowShiftUp } from './_shared.ts';
import { getMap16Left } from '../fetch.ts';

// ───────────────────────────────────────────────────────────────────────
// DATA_goal_platform_top_tiles and
// DATA_goal_platform_bot_tiles.
// 3-entry word tables indexed by Y ∈ {0, 2, 4} (byte stride, so /2 for
// JS array index). All entries are literal Map16 IDs (no template-slot
// deref).
// ───────────────────────────────────────────────────────────────────────

const DATA_goal_platform_top_tiles: readonly number[] = [0x0188, 0x0189, 0x018A];
const DATA_goal_platform_bot_tiles: readonly number[] = [0x018B, 0x018C, 0x018D];

// Unnamed template slots referenced by the row-1 left-edge override path
// and the row-0 cap-snap path. Raw $00:xxxx addresses; templateAt does
// the family-base-relative deref.
const SLOT_CAP_SNAP_OUT    = 0x001D14; // row-0 left-edge override result
const SLOT_ROW1_OVERRIDE_A = 0x001CD2; // row-1 left-edge override probe match A
const SLOT_ROW1_OVERRIDE_B = 0x001CE6; // row-1 left-edge override probe match B
const SLOT_ROW1_SNAP_OUT   = 0x001CFC; // row-1 left-edge override result

// ───────────────────────────────────────────────────────────────────────
// CODE_goal_platform
// ───────────────────────────────────────────────────────────────────────

const goalPlatformStamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const colExtent = state.zp2A & 0xff;

  // ─── Row 0: cap-snap onto adjacent flat-floor only on left edge ───
  if (row === 0) {
    if (col !== 0) return; // non-left-edge cells on row 0 stamp nothing
    setProbeToCurrent(state);
    const leftOff = getMap16Left(state);
    const leftVal = readBuf16(state, leftOff);
    const row0L = state.templateAt(TT.FloorRow0_LeftLo);
    const row0R = state.templateAt(TT.FloorRow0_RightLo);
    if (leftVal !== row0L && leftVal !== row0R) return;
    stampCell(state, state.templateAt(SLOT_CAP_SNAP_OUT));
    return;
  }

  // ─── Row 1+: 3-state column index (left / interior / right) ───
  // Asm:
  //   LDY #0
  //   LDA $28; BEQ keep_y0
  //     INY; INY                      ; Y = 2 (interior)
  //     INC; CMP $2A; BNE keep_y2
  //       INY; INY                    ; Y = 4 (right edge)
  let yIdx: 0 | 2 | 4 = 0;
  if (col !== 0) {
    yIdx = 2;
    if (((col + 1) & 0xff) === colExtent) {
      yIdx = 4;
    }
  }
  const tableIdx = yIdx >>> 1; // 0 / 1 / 2

  if (row === 1) {
    // Top body row. Left-edge column gets the override probe.
    if (col === 0) {
      setProbeToCurrent(state);
      const leftOff = getMap16Left(state);
      const leftVal = readBuf16(state, leftOff);
      const row1L = state.templateAt(TT.FlatFloor_Row1LeftLo);
      const row1R = state.templateAt(TT.FlatFloor_Row1RightLo);
      const ovrA  = state.templateAt(SLOT_ROW1_OVERRIDE_A);
      const ovrB  = state.templateAt(SLOT_ROW1_OVERRIDE_B);
      if (leftVal === row1L || leftVal === row1R || leftVal === ovrA || leftVal === ovrB) {
        stampCell(state, state.templateAt(SLOT_ROW1_SNAP_OUT));
        return;
      }
    }
    stampCell(state, DATA_goal_platform_top_tiles[tableIdx]!);
    return;
  }

  // Row 2+: pure table dispatch.
  stampCell(state, DATA_goal_platform_bot_tiles[tableIdx]!);
};

// ───────────────────────────────────────────────────────────────────────
// CODE_init_goal_platform (CODE_12:9AA3)
//
// Bumps row extent, nudges the column origin up by one tile-row (so the
// row-0 cap-snap probe targets the row above the object's original top),
// and wires the stamp on all 3 walker slots via the trampoline.
// ───────────────────────────────────────────────────────────────────────

function initGoalPlatform(state: DecodeState): void {
  // INC $2E + nibble-preserving "row shift up" of $1B (-$10 in screen-Y
  // high-nibble of the low byte). floorRowShiftUp() does both in one
  // helper, matching the cart's pattern exactly.
  floorRowShiftUp(state);
  walkerSetupTrampoline(state, goalPlatformStamp);
}

// ───────────────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────────────

export function installGoalPlatformHandlers(): void {
  // Per cart `DATA_standard_object_init_ptrs`, $6B → CODE_init_goal_platform.
  registerStdObjectHandler(0x6B, initGoalPlatform);
}
