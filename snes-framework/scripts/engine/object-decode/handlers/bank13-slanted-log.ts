// Bank12 init wrapper + Bank13 per-cell stamp handler for the
// "slanted log stuck in the ground", mirror-direction variant (object $90).
//
// Sibling of $8F (`bank13-slanted-log-gradual.ts`, the gradual variant) —
// same shape, same walker wiring, three distinct 6-entry tile tables. The
// two objects only differ in which Map16 IDs they stamp (mirror =
// horizontally flipped art) and in the tables' contents.
//
// Asm sources:
//   CODE_init_slanted_log     Bank12.asm:4507 ($12:9D35)
//   CODE_slanted_log_stamp    Bank13.asm:10146 ($13:D574)
//   CODE_slanted_log_stamp_a  Bank13.asm:10194 ($13:D5C2)
//   CODE_slanted_log_stamp_b  Bank13.asm:10216 ($13:D5E7)
//   DATA_slanted_log_tiles_a  Bank13.asm:10138 ($13:D55C)
//   DATA_slanted_log_tiles_b  Bank13.asm:10142 ($13:D568)
//   DATA_slanted_log_tiles_c  Bank13.asm:10212 ($13:D5DB)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_slanted_log_tiles_{a,b,c} — 6 entries each.
//
// Dual-purpose entries: at row 0 ($2C==0) the per-cell handler treats
// the entry as a *template-slot address* (cart `LDA $0000,x` direct-page
// dereference of WRAM zero-page mirror; values $1A0C / $1A18 / $1A1E
// etc. are real `!RAM_YI_Level_TileTpl_*` Family0800 / Family0A00
// slots populated by `init_per_tileset_template_slots`). At rows 1..2
// the entry is used as a raw Map16 ID directly (values $3DB0..$3DBB
// are not addresses — high byte $3D is the Map16 page).
//
// Row layout (Y = ($2C << 2) | $00 where $00 = 2 iff $2A negative):
//   row 0 cols 0..   → entries 0/1  (template-slot pointers)
//   row 1 cols 0..   → entries 2/3  (raw Map16 IDs)
//   row 2 cols 0..   → entries 4/5  (raw Map16 IDs)
// Within each row, col-sign ($00) picks the "right" (0) or "left" (2)
// half of the pair — i.e. $2A>=0 grows right and indexes 0/2/4;
// $2A<0  grows left  and indexes 1/3/5.
// ─────────────────────────────────────────────────────────────────────

const DATA_slanted_log_tiles_a: ReadonlyArray<number> = [
  0x1A0C, 0x1A18, 0x3DB1, 0x3DB0, 0x3DB6, 0x3DB5,
];

const DATA_slanted_log_tiles_b: ReadonlyArray<number> = [
  0x1A1E, 0x1A06, 0x3DBB, 0x3DB8, 0x3DBA, 0x3DB9,
];

const DATA_slanted_log_tiles_c: ReadonlyArray<number> = [
  0x1A20, 0x1A04, 0x3DB7, 0x3DB4, 0x3DB6, 0x3DB5,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_slanted_log_stamp_a.
//
// Returns the Map16 ID to stamp (0 means skip — store path BEQs out).
//
//   LDA $2C ; CMP #$0002 ; BCC body
//   LDA #$0000 ; BRA done           ; rows >= 2 → return 0 (skip)
// body:
//   LDA DATA_a,y                    ; raw word from table
//   LDX $2C ; BNE done              ; row >= 1 → use the word as-is
//   TAX ; LDA $0000,x               ; row 0 → treat as template-slot
//                                   ;          address, dereference
// done:
//   TAY ; RTS                       ; A → Y → store path
// ─────────────────────────────────────────────────────────────────────

function slantedLogStampA(state: DecodeState, y: number): number {
  if ((state.zp2C & 0xff) >= 0x02) return 0;
  const entry = DATA_slanted_log_tiles_a[y >>> 1] ?? 0;
  if ((state.zp2C & 0xff) !== 0) return entry;
  // Row 0: entry is a template-slot address; dereference.
  return state.templateAt(entry);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_slanted_log_stamp_b.
//
//   LDA $12
//   BEQ use_b                       ; empty cell → DATA_b
//   CMP FloorRow0_LeftLo  ; BEQ use_c
//   CMP FloorRow0_RightLo ; BEQ use_c
//   LDA #$0000 ; BRA done           ; non-floor non-empty → skip
// use_c:                             ; floor-row neighbour → DATA_c
//   LDA DATA_c,y ; BRA deref
// use_b:
//   LDA DATA_b,y
// deref:
//   LDX $2C ; BNE done              ; row >= 1 → as-is
//   TAX ; LDA $0000,x               ; row 0 → template-slot deref
// done:
//   TAY ; RTS
//
// Unlike stamp_a, stamp_b doesn't gate on row >= 2 — the caller
// (`CODE_slanted_log_stamp`) already returned via the
// `$2C >= 3` early-exit before reaching here, so the Y indexing
// stays in [0, 12). (Rows 0..2 × col-sign ∈ {0,2} = entries 0..5.)
// ─────────────────────────────────────────────────────────────────────

function slantedLogStampB(state: DecodeState, y: number): number {
  const cur = state.zp12 & 0xffff;
  let entry: number;
  if (cur === 0) {
    entry = DATA_slanted_log_tiles_b[y >>> 1] ?? 0;
  } else if (
    cur === state.templateAt(TT.FloorRow0_LeftLo) ||
    cur === state.templateAt(TT.FloorRow0_RightLo)
  ) {
    entry = DATA_slanted_log_tiles_c[y >>> 1] ?? 0;
  } else {
    return 0;
  }
  if ((state.zp2C & 0xff) !== 0) return entry;
  return state.templateAt(entry);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_slanted_log_stamp. Per-cell stamp.
//
//   REP #$30
//   LDA $2C ; CMP #$0003 ; BCS skip ; rows >= 3 → skip
//   LDA #$0001 ; STA $9B            ; mark "stamped" (used by walker
//                                   ; column-advance heuristics)
//   STZ $00
//   LDA $2A ; BPL .pos              ; $2A positive → $00 stays 0
//   LDA #$0002 ; STA $00            ; $2A negative → $00 = 2  (col-sign)
// .pos:
//   LDA $2C ; ASL ; ASL ; ORA $00 ; TAY    ; Y = ($2C << 2) | $00
//   LDA $28 ; BNE call_b           ; non-leftmost col → stamp_b
//   STZ $9B                        ; leftmost col → clear $9B
//   LDA $12 ; BEQ call_a_direct
//   CMP FloorRow0_LeftLo  ; BEQ add4_then_a
//   CMP FloorRow0_RightLo ; BNE skip
// add4_then_a:                     ; floor-row neighbour: shift to the
//   TYA ; CLC ; ADC #$0004 ; TAY   ; "alt" entry pair (row += 1's worth)
// call_a_direct:
//   JSR stamp_a ; BRA store
// call_b:
//   JSR stamp_b
// store:
//   TYA ; BEQ skip
//   LDX $1D ; STA buffer,x
// skip:
//   SEP #$30 ; RTL
//
// Trace notes:
//   * The `add4_then_a` shift only fires when both $28==0 AND the
//     existing cell ($12) is FloorRow0_Lo. In the spec's traced object
//     no cell hit that branch.
//   * stamp_a's "rows>=2 → 0" gate produces the `$????` skip cells the
//     spec marks (cells 2-9 etc — all row >= 2 on col 0).
// ─────────────────────────────────────────────────────────────────────

const slantedLogStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  if (row >= 0x03) return;

  // $9B = 1 for cols >= 1 (walker uses this; see _shared notes elsewhere).
  state.rewound = 1;

  // $00 = col-sign: 0 if $2A >= 0 (extent grows right), 2 if $2A < 0.
  // The cart reads $2A in REP#$30 mode (16-bit) and BPLs on bit 15;
  // walker stores $2A as a 16-bit signed extent.
  const colSign = (state.zp2A & 0x8000) !== 0 ? 2 : 0;

  // Y = (row << 2) | colSign — indexes a 6-word table as a byte offset.
  let y = ((row << 2) | colSign) & 0xff;

  const colCounter = state.zp28 & 0xff;
  let stampValue: number;

  if (colCounter !== 0) {
    // Non-zero col counter: stamp_b path (DATA_b / DATA_c depending on
    // existing cell). $9B stays 1.
    stampValue = slantedLogStampB(state, y);
  } else {
    // Leftmost column ($28 == 0): stamp_a path. Clear $9B first.
    state.rewound = 0;

    const cur = state.zp12 & 0xffff;
    if (cur !== 0) {
      if (
        cur === state.templateAt(TT.FloorRow0_LeftLo) ||
        cur === state.templateAt(TT.FloorRow0_RightLo)
      ) {
        // Floor-row neighbour → shift Y by 4 (next row's table pair).
        y = (y + 4) & 0xff;
      } else {
        return; // non-empty, non-floor existing cell → skip
      }
    }
    stampValue = slantedLogStampA(state, y);
  }

  // CODE_slanted_log_store: BEQ skip; STA buffer,x.
  if (stampValue === 0) return;
  stampCell(state, stampValue);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_slanted_log ($12:9D35).
//
// Same stamp handler in all 3 walker slots (even-col / odd-col / row).
// Sets $19=$7FFF (unbounded row walk; termination via $2C == $2E) and
// $17=$FFFF (slope = -1; per-row pitch added to $14 on each column
// wrap, makes the rectangle progress diagonally — see walker.ts
// SLOPE_ADVANCE).
//
// `walkerSetupKeepSlope` preserves $17 (vs `walkerSetupTrampoline`
// which zeroes it), so we set $17 first and call the keep-slope entry.
//
// Init does NOT mutate $1B/$1C/$2A/$2E/$15 (spec confirms entry ==
// walker-time).
// ─────────────────────────────────────────────────────────────────────

function initSlantedLog(state: DecodeState): void {
  state.zp17 = 0xFFFF;
  walkerSetupKeepSlope(state, slantedLogStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installSlantedLogHandlers(): void {
  registerStdObjectHandler(0x90, initSlantedLog);
}
