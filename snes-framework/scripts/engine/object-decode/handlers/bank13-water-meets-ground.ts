// Standard object $17 — init_water_meets_ground.
//
// Cart entry: CODE_init_water_meets_ground @ $12:93CB (yi/Banks/Bank12.asm:3071)
// Per-cell stamp handler (decorator): CODE_water_meets_ground @ $13:8CED
// (yi/Banks/Bank13.asm:1569).
//
// Shape: vertical water column with a 2-row waterline at the top, a body
// of mid-water tiles, and a 1-row bottom-row terminator. Width is the
// object's col extent; height is its row extent + 1 (init bumps origin
// up one row and increments $2E to compensate). The stamp handler picks
// from three tile tables (DATA_138D59/5F/6D) by row position, with edge
// columns getting waterline endcaps probed from DATA_138DDF/E3/E7. If
// the cell-above already lives in the `$1600` Map16 page (open water),
// `$0A = 8` shifts indices into the "underwater" half of those tables.
//
// Sibling handlers $16 (`init_water_open`) and $18/$19
// (`init_water_meets_land_or_rock`) are being ported in parallel; this
// file stays self-contained and is wired into the dispatcher by the
// parent after the batch.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below, getMap16Left, getMap16Right } from '../fetch.ts';
import { stampCell, readBuf16, writeBuf16, setProbeToCurrent, floorRowShiftUp } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-row tile tables (yi/Banks/Bank13.asm:1628-1635).
//
//   DATA_138D59 (row "last"-1, "underwater overlay" path for row 2):
//     $011F $0120 $0121
//   DATA_138D5F (row 2..extent-1 body):
//     $011C $011D $011E $0000 $0122 $0123 $0124
//   DATA_138D6D (last row terminator):
//     $013A $013B $013C $0000 $0137 $0138 $0139
//
// Indexed by `col_index` returned from CODE_water_meets_ground_col_index
// (Y=0 for col 0 / interior, Y=2 for col==2A-1 right endcap; Y=4 unused
// by direct index — the table holds an OR'd alt slot via `TYA ORA $0A`,
// so $0A=8 picks indices 4..6 = the underwater-page variants).
// ─────────────────────────────────────────────────────────────────────

const DATA_138D59 = [0x011F, 0x0120, 0x0121] as const;
const DATA_138D5F = [0x011C, 0x011D, 0x011E, 0x0000, 0x0122, 0x0123, 0x0124] as const;
const DATA_138D6D = [0x013A, 0x013B, 0x013C, 0x0000, 0x0137, 0x0138, 0x0139] as const;

// ─────────────────────────────────────────────────────────────────────
// Waterline-select tile tables (yi/Banks/Bank13.asm:1688-1695).
//
//   DATA_138DDF: $0021 $011A          ; Y=0 → top-row base $0021;
//                                       Y=2 → row-1 (mid) base $011A
//   DATA_138DE3: $0020 $001F          ; left-edge endcap (Y=0 / Y=2)
//   DATA_138DE7: $0023 $0024          ; right-edge endcap (Y=0 / Y=2)
//
// Each entry is followed by an implicit "+$28 & 1" parity bump for
// even/odd-column variants of the waterline base.
// ─────────────────────────────────────────────────────────────────────

const DATA_138DDF = [0x0021, 0x011A] as const;
const DATA_138DE3 = [0x0020, 0x001F] as const;
const DATA_138DE7 = [0x0023, 0x0024] as const;

const MAP16_PAGE_WATER_HI = 0x1600;
const UNDERWATER_OFFSET = 0x08;

// ─────────────────────────────────────────────────────────────────────
// CODE_water_meets_ground_col_index ($13:8D7B). Returns a Y-index in
// {0, 2, 4} where:
//   Y=0  → col is 0 (left edge) or interior
//   Y=2  → col is 0..2A-1 boundary "mid"
//   Y=4  → col is exactly (2A-1) — the right-edge cell
// (Asm: LDY #0 ; LDA $28 ; BEQ done ; INY*2 ; INC ; CMP $2A ; BNE done ; INY*2.)
// ─────────────────────────────────────────────────────────────────────
function waterMeetsGroundColIndex(state: DecodeState): number {
  const col = state.zp28 & 0xff;
  if (col === 0) return 0;
  if (((col + 1) & 0xff) === (state.zp2A & 0xff)) return 4;
  return 2;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_water_meets_ground_waterline_select ($13:8D8C).
//
// Stamps a waterline-row tile at the current cell, then optionally
// stamps a left- or right-edge endcap into the neighbour cell if that
// neighbour is still empty ($0000). On row 0, also checks the cell
// below: if it's open water ($1600 page) the endcap probe is skipped
// (the below-water adjacency already provides the seam).
//
// Inputs: Y = base index into DATA_138DDF/E3/E7 (0 or 2),
//         X = current cell buffer offset (= $1D).
// ─────────────────────────────────────────────────────────────────────
function waterlineSelect(state: DecodeState, y: number): void {
  // LDA $28 ; AND #$0001 ; CLC ; ADC DATA_138DDF,y ; STA buffer,x
  const parity = state.zp28 & 0x0001;
  const baseTile = (DATA_138DDF[y >>> 1]! + parity) & 0xffff;
  stampCell(state, baseTile);

  // LDA $2C ; BNE skip_below_probe
  // JSL get_map16_below ; LDA buffer,x ; AND #FF00 ; CMP #1600 ; BEQ done
  // LDA $1B ; STA $0E   ; (re-seat probe to current — was perturbed by below path)
  if (state.zp2C === 0) {
    setProbeToCurrent(state);
    const belowOff = getMap16Below(state);
    const belowId = readBuf16(state, belowOff);
    if ((belowId & 0xff00) === MAP16_PAGE_WATER_HI) {
      return; // below is open-water; endcap not needed
    }
    setProbeToCurrent(state);
  }

  // LDA $28 ; BNE right_branch
  if ((state.zp28 & 0xff) === 0) {
    // Left edge: probe left, stamp endcap if empty.
    const leftOff = getMap16Left(state);
    if (readBuf16(state, leftOff) !== 0) return;
    const tile = DATA_138DE3[y >>> 1]!;
    // STA buffer,x — X (zp1D) is still the current cell, but the asm wrote
    // the endcap by re-reading buffer,x after get_map16_left updated X via
    // TAX. Mirror by writing at the probed offset through the shared primitive.
    writeBuf16(state, leftOff, tile);
    return;
  }

  // Right-edge check: INC ; CMP $2A ; BNE done — only fires when
  // $28 + 1 == $2A (last column).
  if ((((state.zp28 & 0xff) + 1) & 0xff) !== (state.zp2A & 0xff)) return;
  const rightOff = getMap16Right(state);
  if (readBuf16(state, rightOff) !== 0) return;
  const tile = DATA_138DE7[y >>> 1]!;
  writeBuf16(state, rightOff, tile);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_water_meets_ground (decorator stamp, $13:8CED).
//
// Per-row dispatch:
//   row 0 (waterline):     waterline_select(Y=0)        unless underwater
//   row 1 ($2C+1 == 2):    waterline_select(Y=2)        unless underwater
//   row 1 underwater:      DATA_138D59[col_index]       (mid → $011F..$0121)
//   row last ($2C+1 == $2E): DATA_138D6D[col_index | $0A]  (bottom-row terminator)
//   else (body):           DATA_138D5F[col_index | $0A]  (mid body)
//
// `$0A` is set to $0008 if the current cell's Map16 page is already
// $1600 (i.e. the placed-over tile is open water) — this shifts the
// table index into the underwater-overlay half (entries $0122/$0123/
// $0124 for body, $0137/$0138/$0139 for bottom row).
// ─────────────────────────────────────────────────────────────────────
const waterMeetsGround: PerCellHandler = (state) => {
  // REP #$30 ; LDA $1B ; STA $0E ; STZ $0A ; LDX $1D
  setProbeToCurrent(state);
  let zp0A = 0;
  // LDA $12 ; AND #FF00 ; CMP #1600 ; BNE skip ; LDA #0008 ; STA $0A
  if ((state.zp12 & 0xff00) === MAP16_PAGE_WATER_HI) {
    zp0A = UNDERWATER_OFFSET;
  }

  // LDA $2C ; BNE mid_or_bottom
  if ((state.zp2C & 0xff) === 0) {
    // Row 0: waterline (Y=0) unless underwater (then no-op — already water).
    if (zp0A !== 0) return;
    waterlineSelect(state, 0);
    return;
  }

  // mid_or_bottom: INC ; CMP $2E ; BEQ bottom_row
  const rowPlus1 = ((state.zp2C & 0xff) + 1) & 0xff;
  const colIdx = waterMeetsGroundColIndex(state);

  if (rowPlus1 === (state.zp2E & 0xff)) {
    // Bottom row (DATA_138D6D, $0A picks normal vs underwater half).
    const idx = ((colIdx | zp0A) >>> 1) & 0xff;
    const tile = DATA_138D6D[idx] ?? 0;
    stampCell(state, tile);
    return;
  }

  // CMP #0002 ; BNE body — when row counter+1 == 2 we hit either
  // waterline-row-2 (above-water) or DATA_138D59 (underwater alt).
  if (rowPlus1 === 0x0002) {
    if (zp0A !== 0) {
      // Underwater row 2: DATA_138D59[col_index]. Table is 3 words; $0A
      // is NOT OR'd in here (asm path skips ORA $0A entirely).
      const idx = (colIdx >>> 1) & 0xff;
      const tile = DATA_138D59[idx] ?? 0;
      stampCell(state, tile);
      return;
    }
    waterlineSelect(state, 2);
    return;
  }

  // Body row: DATA_138D5F[col_index | $0A].
  const idx = ((colIdx | zp0A) >>> 1) & 0xff;
  const tile = DATA_138D5F[idx] ?? 0;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_water_meets_ground ($12:93CB).
//
// Cart (verbatim):
//   REP #$20
//   LDA $1B ; AND #$F0F0 ; SEC ; SBC #$0010 ; AND #$F0F0 ; STA $00
//   LDA $1B ; AND #$0F0F ; ORA $00 ; STA $1B
//   INC $2E
//   LDX #(CODE_water_meets_ground-1)>>16
//   LDA #CODE_water_meets_ground-1
//   JMP walker_setup_trampoline
//
// Effect: shift the origin up one tile-row (preserve sub-X/sub-Y) and
// bump row extent by 1, then run the walker with a single per-cell
// handler. Identical pre-amble to `init_floor_basic`, so we
// re-use the shared `floorRowShiftUp` helper.
// ─────────────────────────────────────────────────────────────────────
function initWaterMeetsGround(state: DecodeState): void {
  floorRowShiftUp(state);
  walkerSetupTrampoline(state, waterMeetsGround);
}

export function installWaterMeetsGroundHandlers(): void {
  registerStdObjectHandler(0x17, initWaterMeetsGround);
}
