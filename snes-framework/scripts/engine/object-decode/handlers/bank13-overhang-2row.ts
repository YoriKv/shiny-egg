// Bank13 overhang 2-row stamp handler + Bank12 init wrapper.
//
// Standard object $7D — an overhang/awning that always renders exactly 2
// rows tall regardless of the stream record's row-extent byte. The init
// forces `$2E = $0002` then dispatches the per-cell walker; the stamp
// handler picks one of 16 entries from a per-variant indirect template-
// slot table indexed by (col-position-class) x (row) x (neighbour-floor
// flag).
//
// The indirect-table layout is the same shape as $52 overhang_decor but
// with TWO base tables (std vs alt) selected by a neighbour-Map16 probe,
// 16 entries per table (vs 4), and entries that are template-slot
// addresses dereferenced via `state.templateAt()` (matching arch-corner
// dispatch's pattern, not overhang_decor's flat slot list). So this is
// closer in spirit to bank13-castle-wall-platform-slope.ts than to
// bank13-overhang-decor.ts.
//
//
// Asm sources:
//   CODE_init_overhang_2row        Bank12.asm:4325 ($12:9C02)
//   CODE_overhang_2row_stamp       Bank13.asm:9085 ($13:CD32)
//   DATA_overhang_2row_tiles_std   Bank13.asm:9141 (DATA_overhang_2row_tiles_std)
//   DATA_overhang_2row_tiles_alt   Bank13.asm:9146 (DATA_overhang_2row_tiles_alt)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Unnamed template-slot addresses used by the overhang-2row stamp.
// All sit in the Family6800 anchor region (TT.Family6800_Anchor =
// $1D8A); the cart's `init_per_tileset_template_slots` populates them
// with Map16 IDs that vary per tileset. None currently have canonical
// TT.* names; if a parent sweep finds other handlers reading them,
// promote to TT.* there.
// ─────────────────────────────────────────────────────────────────────

// Probed-tile sentinels: if the cell's previously-stamped Map16 ID
// equals one of these, the stamp picks the "alt" base table or sets
// the "neighbour-is-floor" Y-flag respectively.
const SLOT_FLOOR_PROBE_A = 0x001D8C; // alt-table selector A
const SLOT_FLOOR_PROBE_B = 0x001D8E; // alt-table selector B

// Y-flag-16 selectors (neighbour-floor classification). Y |= $10 when
// the current cell already holds any of these template Map16 IDs.
const SLOT_NEIGH_FLOOR_C = 0x001D90; // Family6800 anchor + 6
const SLOT_NEIGH_FLOOR_D = 0x001DAA; // Family6800 anchor + 32 (cap)
const SLOT_NEIGH_FLOOR_E = 0x001DAC; // Family6800 anchor + 34 (cap)
// (TT.Family6800_Anchor = $1D8A itself is the 4th classifier slot.)

// Standard base table (DATA_overhang_2row_tiles_std, DATA_overhang_2row_tiles_std).
// 16 entries; each is a WRAM template-slot address that gets
// dereferenced via state.templateAt() to obtain the actual Map16 ID
// the cell receives. Indexed by Y_byte / 2 where Y_byte is the
// composite (col-class | row | neighbour-floor) index computed below.
const DATA_overhang_2row_tiles_std: ReadonlyArray<number> = [
  // row 0, neighbour not floor
  0x001DB2, // col 0          (left cap top)
  0x001DB4, // col odd middle (body top, odd parity)
  0x001DB6, // col even middle(body top, even parity)
  0x001DB8, // col last       (right cap top)
  // row 1, neighbour not floor
  0x001C80, // col 0          (left cap bottom)
  0x001C84, // col odd middle (body bottom, odd parity)
  0x001C86, // col even middle(body bottom, even parity)
  0x001C8A, // col last       (right cap bottom)
  // row 0, neighbour IS floor (Y |= $10)
  0x001DBA, // col 0          (left cap top, on-floor variant)
  0x001DBA, // col odd middle (collapses to same slot)
  0x001DBC, // col even middle(on-floor variant)
  0x001DBC, // col last       (collapses to same slot)
  // row 1, neighbour IS floor (Y |= $18)
  0x001C82, // col 0
  0x001C84, // col odd middle
  0x001C86, // col even middle
  0x001C88, // col last
];

// Alt base table (DATA_overhang_2row_tiles_alt, DATA_overhang_2row_tiles_alt). Used
// when the previously-stamped cell at this position is one of the two
// FLOOR_PROBE Map16 IDs ($1D8C or $1D8E). Layout matches the std
// table; only the row-0/neighbour-not-floor cap slots differ (the
// $1DBE/$1DC0/$1DC2/$1DC4 row, which are the body-meets-floor caps).
const DATA_overhang_2row_tiles_alt: ReadonlyArray<number> = [
  // row 0, neighbour not floor — alt caps
  0x001DBE, // col 0
  0x001DC0, // col odd middle
  0x001DC2, // col even middle
  0x001DC4, // col last
  // row 1, neighbour not floor — same as std
  0x001C80,
  0x001C84,
  0x001C86,
  0x001C8A,
  // row 0, neighbour IS floor — same as std
  0x001DBA,
  0x001DBA,
  0x001DBC,
  0x001DBC,
  // row 1, neighbour IS floor — same as std
  0x001C82,
  0x001C84,
  0x001C86,
  0x001C88,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_overhang_2row_stamp ($13:CD32, Bank13.asm:9085).
//
// REP #$30
// LDA #DATA_overhang_2row_tiles_std ; STA $00            ; default = std table
// LDA $12 ; CMP $1D8C ; BEQ swap
//          CMP $1D8E ; BNE no_swap
// swap:    LDA #DATA_overhang_2row_tiles_alt ; STA $00   ; use alt table
// no_swap:
// LDY #$0000
// LDA $28 ; BEQ y_set                   ; col == 0 → Y=0 (left cap)
// AND #$0001 ; EOR #$0001 ; INC ; ASL   ; Y = (((col & 1) ^ 1) + 1) * 2
// TAY                                    ;     = 2 if odd, 4 if even
// LDA $28 ; INC ; CMP $2A ; BNE y_set   ; col + 1 == cols? → right cap
// LDY #$0006                            ;   override Y = 6
// y_set:
// LDA $2C ; BEQ row_done                ; row == 0 → leave Y alone
// TYA ; ORA #$0008 ; TAY                ; else Y |= 8 (row 1)
// row_done:
// LDA $12
// CMP $1D8A ; BEQ flag                  ; family6800 anchor match
// CMP $1DAA ; BEQ flag
// CMP $1D90 ; BEQ flag
// CMP $1DAC ; BNE no_flag
// flag: TYA ; ORA #$0010 ; TAY          ; Y |= $10 (neighbour-is-floor)
// no_flag:
// LDA ($00),y ; TAY                     ; deref table[Y/2] → slot addr
// LDX $1D ; LDA $0000,y                 ; deref slot → Map16 ID
// STA.l levelDataBuffer,x               ; stamp
// ─────────────────────────────────────────────────────────────────────

const stampOverhang2row: PerCellHandler = (state) => {
  // Pick the base table. Compare the cell's currently-stamped Map16
  // ID ($12) against the two FLOOR_PROBE sentinels. If either matches,
  // use the alt table (body-meets-floor variants in the cap row).
  const cur = state.zp12 & 0xffff;
  const probeA = state.templateAt(SLOT_FLOOR_PROBE_A);
  const probeB = state.templateAt(SLOT_FLOOR_PROBE_B);
  const table = (cur === probeA || cur === probeB)
    ? DATA_overhang_2row_tiles_alt
    : DATA_overhang_2row_tiles_std;

  // Column-class index. Asm computes a byte-offset Y; we work with
  // entry indices (yIdx = Y/2). Range 0..3 here.
  //   col == 0        → 0  (left cap)
  //   col + 1 == cols → 3  (right cap)
  //   col odd         → 1  (body odd parity)
  //   col even        → 2  (body even parity)
  const col = state.zp28 & 0xff;
  const cols = state.zp2A & 0xff;
  let yIdx: number;
  if (col === 0) {
    yIdx = 0;
  } else if (((col + 1) & 0xff) === cols) {
    yIdx = 3;
  } else {
    // (((col & 1) ^ 1) + 1) — odd → 1, even → 2
    yIdx = ((col & 1) ^ 1) + 1;
  }

  // Row bit: $2C == 0 → row 0 (no flag); else row 1 (Y |= 8, yIdx += 4).
  if ((state.zp2C & 0xff) !== 0) {
    yIdx += 4;
  }

  // Neighbour-floor bit: if $12 matches any of the 4 family6800
  // sentinels, Y |= $10 (yIdx += 8).
  const fam6800 = state.templateAt(TT.Family6800_Anchor);
  const neighC = state.templateAt(SLOT_NEIGH_FLOOR_C);
  const neighD = state.templateAt(SLOT_NEIGH_FLOOR_D);
  const neighE = state.templateAt(SLOT_NEIGH_FLOOR_E);
  if (cur === fam6800 || cur === neighD || cur === neighC || cur === neighE) {
    yIdx += 8;
  }

  // Dereference the indirect table: table[yIdx] is a WRAM template-slot
  // address, state.templateAt() then yields the actual Map16 ID.
  const slotAddr = table[yIdx]!;
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_overhang_2row ($12:9C02, Bank12.asm:4325).
//
//   REP #$20
//   LDA #$0002 ; STA $2E          ; force row-extent = 2 rows
//   LDX #(stamp-1)>>16
//   LDA #stamp-1
//   JMP CODE_walker_setup_trampoline
//
// Forces a 2-row tall object regardless of the stream record's row
// byte (spec confirms: $2E 0001 → 0002 in the DP-diff table). Then
// straight-line trampoline (slope=0, all 3 slots = stampOverhang2row,
// $19 = $7FFF unbounded — termination via $2C == $2E).
// ─────────────────────────────────────────────────────────────────────

function initOverhang2row(state: DecodeState): void {
  // Cart `LDA #$0002 / STA $2E` — pin row extent at exactly 2 rows.
  state.zp2E = 0x0002;
  walkerSetupTrampoline(state, stampOverhang2row);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installOverhang2rowHandlers(): void {
  registerStdObjectHandler(0x7D, initOverhang2row);
}
