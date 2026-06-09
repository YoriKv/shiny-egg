// Bank13 stamp handler for std object $CB — the "slope_3variant_3tile"
// family: a uniform-rectangle slope body that selects between 3 base
// Map16 IDs based on column position (leftmost / interior / rightmost)
// and, on row 0 only, optionally overrides with an alternate tile when
// the cell above is already a mid-slope shape (decorator behaviour). The
// top-row connector then falls through to CODE_castle_wall_corner_top_row_probe
// so the slope blends with ceiling/wall-top neighbours.
//
// Asm sources:
//   CODE_init_slope_3variant_3tile        Bank12.asm:5050  ($12:A0C7)
//   CODE_stamp_slope_3tile_with_probe     Bank13.asm:13096 ($13:EBFC)
//   DATA_slope_3tile_normal               Bank13.asm:13088 ($13:EBF0)
//   DATA_slope_3tile_when_above_slope     Bank13.asm:13092 ($13:EBF6)
//   CODE_castle_wall_corner_top_row_probe        Bank13.asm:4980  ($13:A4F8)
//
// Init (CODE_init_slope_3variant_3tile, $12:A0C7):
//     REP #$20
//     STZ $A1                              ; clear autotile latch
//     LDX #(CODE_stamp_slope_3tile_with_probe-1)>>16              ; bank = $13
//     LDA #CODE_stamp_slope_3tile_with_probe-1
//     JMP CODE_walker_setup_trampoline      ; trampoline → $17 = 0
// (No DP mutations beyond $A1 = 0; spec confirms walker reads stream
// values $1B/$1C/$2A/$2E/$15 unchanged.)
//
// Per-cell stamp (CODE_stamp_slope_3tile_with_probe, $13:EBFC):
//     Y = 0
//     LDA $28; BEQ stamp                     ; col 0  → Y = 0 (left tile)
//     INY/INY; INC; CMP $2A; BEQ stamp       ; col+1==$2A → Y = 4 (right)
//     fall-through                           ; interior → Y = 2 (mid)
//   stamp:
//     STA buffer[$1D] = DATA_slope_3tile_normal[Y/2]
//     LDA $2C; BNE rts                       ; only row 0 runs the probe
//     CPY #2; BEQ probe_top_row              ; mid tile → skip override
//     get_map16_above → above tile
//     CMP $0153/BCC probe_top_row            ; \ if above NOT in
//     CMP $0161/BCS probe_top_row            ; / [$0153,$0161): skip override
//     STA buffer[$1D] = DATA_slope_3tile_when_above_slope[Y/2]
//     $A1 = 6                                ; latch for next-cell autotile
//     BRA rts
//   probe_top_row:
//     JSR CODE_castle_wall_corner_top_row_probe     ; ceiling/wall-top connector
//   rts:
//
// DATA_slope_3tile_normal           dw $00D6, $00C2, $00D7  (left, mid, right)
// DATA_slope_3tile_when_above_slope dw $77D8, $0000, $77D9  (Y=2 unused;
//                                                            mid tile skips
//                                                            the override
//                                                            via CPY #2/BEQ)
//
// Trace coverage (std-CB spec, $1×$2 anchor, length-1=1 height-1=2 →
// 2 cols × 3 rows):
//   - Cells (col=0,row=0..2): Y=0 → stamp $00D6 (left); row 0 also runs
//     probe (above=$00 → both range gate and CODE_castle_wall_corner_top_row_probe fall through).
//   - Cells (col=1,row=0..2): col+1 == colExt=2 → Y=4 → stamp $00D7
//     (right); row 0 also runs probe (same all-zero LDB → no rewrite).
//   - $00C2 (mid tile, Y=2) and $77D8/$77D9 (above-is-slope overrides)
//     and the $A1=6 latch are not exercised by the captured trace —
//     ported here from asm. The trace's "interior" path would only fire
//     for col-extent ≥ 3, and the override only when an above-slope tile
//     was stamped by a prior object.
//
// Templates: follows `bank13-slope-3row.ts` for the trampoline + multi-
// tile table shape, and `bank13-castle-wall.ts` for the inlined
// `castle_wall_corner_top_row_probe` body. Probe is duplicated here rather than
// imported because the helper lives as a `function` in two existing
// handler files; consolidation candidate noted in the final report.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Above } from '../fetch.ts';
import {
  isMidSlopeShape,
  readBuf16,
  setProbeToCurrent,
  stampCell,
} from './_shared.ts';
import { castleWallCornerTopRowProbe } from './bank13-castle-wall.ts';

// ───────────────────────────────────────────────────────────────────────
// Tile tables.
// ───────────────────────────────────────────────────────────────────────

/** DATA_slope_3tile_normal @ $13:EBF0 — base tiles indexed by column
 *  position. Y/2: 0 = leftmost, 1 = interior, 2 = rightmost. */
const DATA_slope_3tile_normal = [0x00D6, 0x00C2, 0x00D7] as const;

/** DATA_slope_3tile_when_above_slope @ $13:EBF6 — alternate tiles used
 *  on row 0 when the cell above is in the mid-slope range
 *  [$0153, $0161). Entry [1] ($0000) is unreachable because the
 *  override path is gated by CPY #2 / BEQ (interior column skips it). */
const DATA_slope_3tile_when_above_slope = [0x77D8, 0x0000, 0x77D9] as const;

// `isMidSlopeShape` (mid-slope shape range [$0153, $0161)) is imported
// from `_shared.ts`. Cart: `CMP #$0153 / BCC skip ; CMP #$0161 / BCS
// skip`. Same range as `isCeilingShape` in bank13-castle-wall.ts
// minus the $0151/$0152 wall-top tiles — this probe is slope-only.

// ───────────────────────────────────────────────────────────────────────
// The top-row connector CODE_castle_wall_corner_top_row_probe ($13:A4F8) is
// the cart routine shared with $44 castle_wall — it stamps from
// DATA_castle_wall_corner_top_tiles ($13:A4F0) via the $A1 autotile latch.
// Imported from `bank13-castle-wall.ts` (its owner) rather than duplicated
// here; the slope override above is the only part of this stamp unique to
// these objects.
// ───────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────
// Per-cell stamp — CODE_stamp_slope_3tile_with_probe ($13:EBFC).
// ───────────────────────────────────────────────────────────────────────

const stampSlope3tileWithProbe: PerCellHandler = (state) => {
  // Decide column class:
  //   Y = 0  if col == 0          (leftmost)
  //   Y = 4  if col + 1 == colExt (rightmost)
  //   Y = 2  otherwise            (interior)
  const col    = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;

  let y: number;
  if (col === 0) {
    y = 0;
  } else if (((col + 1) & 0xff) === colExt) {
    y = 4;
  } else {
    y = 2;
  }

  // CODE_13EC10: STA buffer[$1D] = DATA_slope_3tile_normal[Y/2].
  stampCell(state, DATA_slope_3tile_normal[y >>> 1]!);

  // CODE_13EC15: LDA $2C ; BNE exit — only row 0 runs the probes.
  if ((state.zp2C & 0xffff) !== 0) return;

  // CODE_13EC19: CPY #2 ; BEQ → skip override (interior column never
  // overrides — DATA_slope_3tile_when_above_slope[1] is the unreachable
  // $0000 placeholder). Fall straight into the top-row connector.
  if (y === 2) {
    castleWallCornerTopRowProbe(state);
    return;
  }

  // CODE_13EC1D: probe above tile.
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  const above = readBuf16(state, aboveOff);

  // CODE_13EC2C: range check [$0153, $0161). Outside → fall to top-row
  // connector; inside → stamp override + latch $A1 = 6.
  if (!isMidSlopeShape(above)) {
    castleWallCornerTopRowProbe(state);
    return;
  }

  // CODE_13EC36: stamp the alternate tile and set the autotile latch.
  stampCell(state, DATA_slope_3tile_when_above_slope[y >>> 1]!);
  state.zpA1 = 0x0006;
};

// ───────────────────────────────────────────────────────────────────────
// Init — CODE_init_slope_3variant_3tile ($12:A0C7).
// ───────────────────────────────────────────────────────────────────────

function initSlope3variant3tile(state: DecodeState): void {
  // Cart: `STZ $A1` before the trampoline. Clears the autotile latch so
  // the first row-0 cell sees $A1 == 0 in castleWallCornerTopRowProbe.
  state.zpA1 = 0;
  walkerSetupTrampoline(state, stampSlope3tileWithProbe);
}

// ───────────────────────────────────────────────────────────────────────
// Registration.
// ───────────────────────────────────────────────────────────────────────

export function installSlope3variant3tileHandlers(): void {
  registerStdObjectHandler(0xCB, initSlope3variant3tile);
}
