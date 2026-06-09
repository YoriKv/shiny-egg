// Standard object $2F — init_jungle_wood.
//
// Cart entry: CODE_init_jungle_wood @ $12:959C (yi/Banks/Bank12.asm:3376).
// Per-cell stamp handler: CODE_jungle_wood @ $13:965E (yi/Banks/Bank13.asm:2979).
//
// Vertical jungle wooden-log beam (the "JNGL_WOOD" stamp). The shape is
// a single 16-tile-tall column whose top two rows are deterministic
// "left-cap / centre / right-cap" trios that ALSO stamp into the cells
// immediately left and right of the current column, and whose body
// rows mix one fixed mid-trunk (row 2), one PRNG-picked under-trunk
// pair ($990B / $990C, rows 3..N-2), and one fixed base tile ($9206) at
// the last row.
//
// The init handler is a plain walker trampoline: no DP mutations, no
// extra columns, no slope. The spec confirms `init_dp_delta` is empty;
// the per-cell handler reads the stream's raw width/height/orientation
// directly.
//
// asm primary; goldenegg notes consulted only as cross-reference.

import { registerStdObjectHandler } from './index.ts';
import type { InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell, stampLeftTile, stampRightTile } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Stamp-handler tile tables (Bank13.asm:2962-2969).
//
//   DATA_139652 (= JNGL_WOD_DT0, 2 entries): row-0/row-1 LEFT-cap tile.
//     Row 0 → $966F, Row 1 → $1530.
//
//   DATA_139656 (= JNGL_WOD_DT1, 2 entries): row-0/row-1 CENTRE tile
//     (current cell). Row 0 → $9670, Row 1 → $9A00.
//
//   DATA_13965A (= JNGL_WOD_DT2, 2 entries): row-0/row-1 RIGHT-cap tile.
//     Row 0 → $9671, Row 1 → $1531.
//
// Each is indexed by Y = row * 2 (16-bit table → ASL row before TAY).
// The cart does NOT consult $12 (existing cell) or the probe's loaded
// value — both `probe_left_tile` / `probe_right_tile` only mutate X
// (and incidentally A); the JSR is solely to position X at the
// neighbour's buffer offset so the immediately-following
// `STA.l buffer,x` stamps into that neighbour rather than the current
// cell. The loaded "observed value" in A is then overwritten by
// `LDA DATA_139652,y` before any store.
// ─────────────────────────────────────────────────────────────────────

const DATA_139652 = [0x966F, 0x1530] as const; // left-cap, indexed Y=row*2
const DATA_139656 = [0x9670, 0x9A00] as const; // centre,   indexed Y=row*2
const DATA_13965A = [0x9671, 0x1531] as const; // right-cap, indexed Y=row*2

// Fixed body tiles (Bank13.asm:2995-3012).
const JUNGLE_WOOD_TOP_OF_BODY = 0x990A;        // row index 2 (when row+1 == 3)
const JUNGLE_WOOD_BASE        = 0x9206;        // last row (when row+1 == row_extent)
const JUNGLE_WOOD_RAND_BASE   = 0x990B;        // random body: $990B or $990C

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_wood ($13:965E, Bank13.asm:2979) — per-cell handler.
//
// Dispatch by row counter $2C (a 16-bit signed counter, but the cart
// reads it as 16-bit via REP #$30 and compares against #$0002):
//
//   row 0..1 (top caps):
//     ASL row → Y. Probe LEFT, stamp DATA_139652[row] into that left
//       neighbour's buffer slot.
//     Probe RIGHT, stamp DATA_13965A[row] into the right neighbour.
//     Then stamp DATA_139656[row] at the current cell.
//
//     The probes use `setProbeToCurrent` (copy $1B/$1C to $0E/$0F)
//     followed by the normal left/right fetch — same pattern as
//     `CODE_probe_left_tile` / `CODE_probe_right_tile` in Bank13. The
//     loaded "observed" value from the probe is unused; only the
//     returned buffer offset matters.
//
//   row >= 2 (body):
//     A = row + 1.
//     - if A == row_extent ($2E)         → stamp $9206 (the base/foot).
//     - elif A == 3 (i.e. row == 2)      → stamp $990A (top-of-body).
//     - else                             → prng & 2, LSR, + $990B
//                                          → $990B or $990C random pick.
//
// PRNG carry-flag caveat (matches jungleFloorRandomBody / jungle wall
// random body): cart uses `ADC #$990B` with no preceding CLC after the
// JSL CODE_prng. Our deterministic LFSR can't replicate the cart's
// stale-carry, so we treat the ADC as carry-clear. The variant pool is
// correct ($990B vs $990C); individual picks won't byte-match a
// specific cart-snapshot trace. Cosmetic-only impact.
// ─────────────────────────────────────────────────────────────────────
const jungleWoodStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;

  if (row < 0x0002) {
    // Top two rows: stamp left/centre/right trio. The cart's probe only
    // repositions X to the neighbour's buffer offset (its loaded value is
    // discarded), so these are plain neighbour stamps.
    const idx = row & 0x01;
    stampLeftTile(state, DATA_139652[idx]!);   // left cap
    stampRightTile(state, DATA_13965A[idx]!);  // right cap
    stampCell(state, DATA_139656[idx]!);       // centre (current cell)
    return;
  }

  // Row >= 2: body dispatch.
  const rowPlus1 = (row + 1) & 0xffff;
  const rowExtent = state.zp2E & 0xffff;

  if (rowPlus1 === rowExtent) {
    // Last row → base/foot tile.
    stampCell(state, JUNGLE_WOOD_BASE);
    return;
  }

  if (rowPlus1 === 0x0003) {
    // Row index 2 (the row directly under the deterministic top pair).
    stampCell(state, JUNGLE_WOOD_TOP_OF_BODY);
    return;
  }

  // Random body: prng & 2, LSR → 0 or 1, + $990B → $990B or $990C.
  // See PRNG carry-flag caveat in the doc-comment above.
  const pick = (prngNext(state) & 0x02) >>> 1;
  stampCell(state, (JUNGLE_WOOD_RAND_BASE + pick) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_wood ($12:959C, Bank12.asm:3376).
//
// Plain walker-trampoline init: no DP mutations, no extra columns,
// slope=0, all 3 handler slots receive `CODE_jungle_wood`. Spec
// confirms init_dp_delta is empty.
// ─────────────────────────────────────────────────────────────────────
const initJungleWood: InitHandler = (state) => {
  walkerSetupTrampoline(state, jungleWoodStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installJungleWoodHandlers(): void {
  registerStdObjectHandler(0x2F, initJungleWood);
}
