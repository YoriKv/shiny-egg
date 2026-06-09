// Bank12 init wrapper + Bank13 per-cell stamp handler for the
// "slanted log stuck in the ground", gradual variant (object $8F).
//
// Sibling of $90 (`bank13-slanted-log.ts`, the mirror-direction variant) —
// same shape family, but $8F dispatches across THREE sub-stamps (a / b / cd)
// by $28 column counter, whereas $90 only has two and dispatches differently.
//
//   $28 == 0 (leftmost column)       → CODE_slanted_log_gradual_stamp_a
//   $28 odd                          → CODE_slanted_log_gradual_stamp_b
//   $28 even, non-zero ($28 >= 2 even) → CODE_slanted_log_gradual_stamp_cd
//
// The CD sub-dispatcher then picks between load_c_tiles, load_d_tiles,
// or a zero-stamp (skip) based on a context check of the existing cell
// ($12) against floor-row template slots and the $3DB0..$3DBA $3D-page
// sentinels.
//
// Asm sources:
//   CODE_init_slanted_log_gradual  Bank12.asm:4488 ($12:9D12)
//   CODE_slanted_log_gradual_stamp            Bank13.asm:9982 ($13:D473)
//   CODE_slanted_log_gradual_stamp_a          Bank13.asm:10040 ($13:D4D8)
//   CODE_slanted_log_gradual_stamp_b          Bank13.asm:10066 ($13:D4FD)
//   CODE_slanted_log_gradual_stamp_cd         Bank13.asm:10105 ($13:D536)
//   CODE_slanted_log_gradual_load_c_tiles     Bank13.asm:10121 ($13:D54D)
//   CODE_slanted_log_gradual_load_d_tiles     Bank13.asm:10127 ($13:D553)
//   CODE_slanted_log_gradual_zero_tile        Bank13.asm:10133 ($13:D559)
//   DATA_slanted_log_gradual_tiles_a          Bank13.asm:9960 ($13:D439)
//   DATA_slanted_log_gradual_tiles_b          Bank13.asm:9964 ($13:D445)
//   DATA_slanted_log_gradual_tiles_c          Bank13.asm:9968 ($13:D455)
//   DATA_slanted_log_gradual_tiles_d          Bank13.asm:9972 ($13:D461)
//   DATA_slanted_log_gradual_handler_ptrs     Bank13.asm:9976 ($13:D46D)
//   DATA_slanted_log_gradual_cd_subhandlers   Bank13.asm:10098 ($13:D52E)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile tables. Like the $90 mirror-direction tables, entries serve dual
// purposes:
//
//   row 0 ($2C == 0): entry is a *template-slot WRAM address*; the cart
//                      does `TAX / LDA $0000,x` to dereference into a
//                      live Map16 ID. Values $1A0E/$1A22/$1A2C/$1A32/
//                      $1A36/$1A38/$1A46/$1A48/$1A56/$1A58 are real
//                      `!RAM_YI_Level_TileTpl_*` slots in the Family0A00
//                      / Family0C00 / Family1000 ranges.
//   rows 1..2:        entry is a raw Map16 ID stamped as-is. Values
//                      $3DBF/$3DBE/$3DBD/$3DC0/$3DC1/$3DBC/$3DD8..$3DDD
//                      are direct IDs on the $3D Map16 page.
//
// Indexing: Y = $2C * 4 (within main stamp), optionally +2 if $2A is
// negative (col extent grows left). The sub-stamps a/b also conditionally
// shift Y by +4 (stamp_a) or +8 (stamp_b) based on the $00 context flag.
// ─────────────────────────────────────────────────────────────────────

/** DATA_slanted_log_gradual_tiles_a — 6 entries. Used when $28 == 0 (leftmost
 *  col). Y in {0,2,4,6,8,10}; row-0 entries are WRAM slots, rows 1..2
 *  are literal Map16 IDs on the $3D page. */
const DATA_slanted_log_gradual_tiles_a: ReadonlyArray<number> = [
  0x1A0E, 0x1A22, 0x3DBF, 0x3DBE, 0x3DDB, 0x3DDA,
];

/** DATA_slanted_log_gradual_tiles_b — 8 entries. Used when $28 is odd. The
 *  extra 2 entries (vs tiles_a) accommodate the $00=1 shift (+8 on Y),
 *  which moves the row-0 indices to entries 4/5 (also WRAM slots). */
const DATA_slanted_log_gradual_tiles_b: ReadonlyArray<number> = [
  0x1A46, 0x1A36, 0x3DC0, 0x3DBD, 0x1A48, 0x1A38, 0x3DDC, 0x3DD9,
];

/** DATA_slanted_log_gradual_tiles_c — 6 entries. Used by stamp_cd when $00 ==
 *  0 (empty cell, or $1A0C/$1A18 sentinel — i.e. the "default" pick). */
const DATA_slanted_log_gradual_tiles_c: ReadonlyArray<number> = [
  0x1A56, 0x1A2C, 0x3DC1, 0x3DBC, 0x3DBF, 0x3DBE,
];

/** DATA_slanted_log_gradual_tiles_d — 6 entries. Used by stamp_cd when $00 ==
 *  1 (existing cell matches FloorRow0_Left/Right — i.e. stamping over
 *  a floor row, switch to floor-aware variant). */
const DATA_slanted_log_gradual_tiles_d: ReadonlyArray<number> = [
  0x1A58, 0x1A32, 0x3DDD, 0x3DD8, 0x3DDB, 0x3DDA,
];

// ─────────────────────────────────────────────────────────────────────
// $1A0C and $1A18 are WRAM template-slot addresses populated at level
// load. They're NOT in TT yet — the only handler that reads them is
// this one (the main stamp dispatcher's "existing cell already part of
// the mirror-direction slanted-log family" check). The mirror-direction
// slanted log ($90) stamps $1A0C and $1A18 (via its tiles_a entries
// 0/1), so a hit on these values means an adjacent mirror slanted-log
// already covered this cell — in which case $8F leaves $00 = 0 (treated
// as "empty" context, same as BEQ-on-$12==0).
//
// Promote to TT.* if a third handler ever reads them.
// ─────────────────────────────────────────────────────────────────────
const SLOT_MirrorSlantedLog_Probe_A = 0x001A0C;
const SLOT_MirrorSlantedLog_Probe_B = 0x001A18;

// ─────────────────────────────────────────────────────────────────────
// $3DB0/$3DB1/$3DB9/$3DBA are LITERAL Map16 IDs on the $3D page, not
// WRAM slots. The mirror-direction slanted log ($90) stamps $3DB0/$3DB1/
// $3DB9/$3DBA via tiles_a entries 2..5 (the row-1/row-2 literals). A hit
// on these values means the cell is already a mirror slanted-log mid-/
// bottom-row — context flag $00 = 2 (= "load_c is forced to STZ $02",
// i.e. the stamp_cd path will skip-stamp).
//
// These are direct constants in the asm (not template slots) — embed
// inline.
// ─────────────────────────────────────────────────────────────────────
const MIRROR_LOG_PAGE_PROBE_LO_A = 0x3DB0;
const MIRROR_LOG_PAGE_PROBE_LO_B = 0x3DB1;
const MIRROR_LOG_PAGE_PROBE_HI_A = 0x3DB9;
const MIRROR_LOG_PAGE_PROBE_HI_B = 0x3DBA;

// ─────────────────────────────────────────────────────────────────────
// CODE_slanted_log_gradual_stamp_a ($13:D4D8).
//
//   STZ $9B
//   LDA $2C ; CMP #$0002 ; BCC body  ; rows >= 2 → return Y=0 (skip)
//   LDA #$0000 ; BRA done
// body:
//   LDA $00 ; BEQ no_shift            ; context flag: 0 → no Y shift
//   TYA ; CLC ; ADC #$0004 ; TAY      ; non-zero → Y += 4
// no_shift:
//   LDA DATA_a,y                      ; raw table entry
//   LDX $2C ; BNE done                ; row >= 1 → use as-is
//   TAX ; LDA $0000,x                 ; row 0 → template-slot deref
// done:
//   TAY ; RTS
//
// Returns the Map16 ID (or 0 to skip stamp).
// ─────────────────────────────────────────────────────────────────────

function slantedLogGradualStampA(state: DecodeState, ctx: number, yByte: number): number {
  state.rewound = 0;
  if ((state.zp2C & 0xff) >= 0x02) return 0;
  const y = ctx !== 0 ? ((yByte + 4) & 0xff) : yByte;
  const entry = DATA_slanted_log_gradual_tiles_a[y >>> 1] ?? 0;
  if ((state.zp2C & 0xff) !== 0) return entry;
  return state.templateAt(entry);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_slanted_log_gradual_stamp_b ($13:D4FD).
//
//   STZ $9B
//   LDA $2C ; CMP #$0002 ; BCC body  ; rows >= 2 → return Y=0 (skip)
//   LDA #$0000 ; BRA done
// body:
//   LDA.l $000000                     ; read 16-bit at zp $00 (i.e. ctx)
//   BEQ no_shift                      ; ctx == 0 → no Y shift
//   CMP #$0002 ; BCC small_shift      ; ctx == 1 → Y += 8
//   LDA #$0000 ; BRA done             ; ctx >= 2 → return Y=0 (skip)
// small_shift:
//   TYA ; CLC ; ADC #$0008 ; TAY      ; Y += 8
// no_shift:
//   LDA DATA_b,y
//   LDX $2C ; BNE done                ; row >= 1 → as-is
//   TAX ; LDA $0000,x                 ; row 0 → deref
// done:
//   TAY ; RTS
// ─────────────────────────────────────────────────────────────────────

function slantedLogGradualStampB(state: DecodeState, ctx: number, yByte: number): number {
  state.rewound = 0;
  if ((state.zp2C & 0xff) >= 0x02) return 0;
  let y = yByte;
  if (ctx !== 0) {
    if (ctx >= 0x02) return 0;
    y = (y + 8) & 0xff;
  }
  const entry = DATA_slanted_log_gradual_tiles_b[y >>> 1] ?? 0;
  if ((state.zp2C & 0xff) !== 0) return entry;
  return state.templateAt(entry);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_slanted_log_gradual_stamp_cd ($13:D536) — sub-dispatcher.
//
//   LDA #$0001 ; STA $9B
//   LDA $00 ; ASL ; TAX                ; X = ctx * 2 (word stride)
//   JSR (DATA_slanted_log_gradual_cd_subhandlers,x)                ; → load_c_tiles / load_d_tiles
//                                       ;   / zero_tile / zero_tile
//   LDY $02                            ; tile (or 0) returned via $02
//   LDX $2C ; BNE done                 ; row >= 1 → return Y as-is
//   LDA $0000,y                        ; row 0 → template-slot deref
//   TAY
// done:
//   RTS
//
// The sub-handlers:
//   load_c_tiles ($13:D54D): LDA DATA_c,y ; STA $02 ; RTS
//   load_d_tiles ($13:D553): LDA DATA_d,y ; STA $02 ; RTS
//   zero_tile    ($13:D559): STZ $02 ; RTS
//
// Dispatch table DATA_slanted_log_gradual_cd_subhandlers has 4 entries — the last two both point at
// zero_tile, so ctx in {2, 3} both yield the no-stamp path. This is
// safe even though the main stamp produces ctx in {0..3}.
//
// Note: cd does NOT have the `$2C >= 2 → skip` gate that a/b have. The
// row 2 stamp_cd path is reachable; only the main dispatcher's
// `$2C >= 3 → skip` early-exit gates it.
// ─────────────────────────────────────────────────────────────────────

function slantedLogGradualStampCD(state: DecodeState, ctx: number, yByte: number): number {
  state.rewound = 1; // $9B = 1

  let entry: number;
  if (ctx === 0) {
    entry = DATA_slanted_log_gradual_tiles_c[yByte >>> 1] ?? 0;
  } else if (ctx === 1) {
    entry = DATA_slanted_log_gradual_tiles_d[yByte >>> 1] ?? 0;
  } else {
    // ctx in {2, 3} → zero_tile (both dispatch slots point to it).
    entry = 0;
  }

  // After sub-handler: outer code does `LDX $2C ; BNE done ; LDA $0000,y`.
  // If $2C != 0, return entry (in Y) as-is. Otherwise deref via templateAt.
  if ((state.zp2C & 0xff) !== 0) return entry;
  return state.templateAt(entry);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_slanted_log_gradual_stamp ($13:D473) — main per-cell stamp dispatcher.
//
// REP #$30 throughout. Pseudocode:
//
//   LDA $2C ; CMP #$0003 ; BCS done       ; rows >= 3 → skip entirely
//   ASL ; ASL ; TAY                       ; Y = $2C * 4
//   LDA $2A ; BPL no_inc                  ; $2A positive → no Y bump
//   INY ; INY                             ; $2A negative → Y += 2
// no_inc:
//   STZ $00
//   LDA $12
//   BEQ ctx_zero                          ; existing cell empty → ctx=0
//   CMP FloorRow0_LeftLo  ; BEQ ctx_one   ; FloorRow0 L  → ctx=1
//   CMP FloorRow0_RightLo ; BEQ ctx_one   ; FloorRow0 R  → ctx=1
//   CMP #$3DB0 ; BEQ ctx_two              ; mirror slanted-log LO → ctx=2
//   CMP #$3DB1 ; BEQ ctx_two
//   CMP #$3DB9 ; BEQ ctx_two              ; mirror slanted-log HI → ctx=2
//   CMP #$3DBA ; BEQ ctx_two
//   CMP $1A0C  ; BEQ ctx_zero             ; mirror slanted-log slot A → ctx=0
//   CMP $1A18  ; BEQ ctx_zero             ; mirror slanted-log slot B → ctx=0
//   INC $00                               ; fallthrough: ctx = 3 (3 INCs)
// ctx_two:  INC $00                       ; INC chain: D4B5 = +3
// ctx_one:  INC $00                       ; INC chain: D4B7 = +2
// ctx_zero: ; INC chain: D4B9 = +0
//   LDX #$0000
//   LDA $28 ; BEQ pick                    ; $28 == 0 → entry 0 (stamp_a)
//   INX ; INX                             ; X = 2
//   AND #$0001 ; BNE pick                 ; $28 odd → entry 1 (stamp_b)
//   INX ; INX                             ; X = 4 → entry 2 (stamp_cd)
// pick:
//   JSR (DATA_slanted_log_gradual_handler_ptrs,x)                   ; → stamp_a/_b/_cd, returns Y
//   TYA ; BEQ done
//   LDX $1D ; STA buffer,x                ; stamp
// done:
//   SEP #$30 ; RTL
// ─────────────────────────────────────────────────────────────────────

const slantedLogGradualStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  if (row >= 0x03) return;

  // Y = row * 4, +2 if $2A is negative (col extent grows left).
  // Cart reads $2A in 16-bit mode and BPLs on bit 15; state.zp2A holds
  // the (signed) extent. Use byte-sign for consistency with siblings.
  const colExtNeg = (state.zp2A & 0x80) !== 0;
  const yByte = ((row << 2) + (colExtNeg ? 2 : 0)) & 0xff;

  // Context flag $00 ∈ {0, 1, 2, 3} from existing-cell ($12) inspection.
  let ctx: number;
  const cur = state.zp12 & 0xffff;
  if (cur === 0) {
    ctx = 0;
  } else if (
    cur === state.templateAt(TT.FloorRow0_LeftLo) ||
    cur === state.templateAt(TT.FloorRow0_RightLo)
  ) {
    ctx = 1;
  } else if (
    cur === MIRROR_LOG_PAGE_PROBE_LO_A ||
    cur === MIRROR_LOG_PAGE_PROBE_LO_B ||
    cur === MIRROR_LOG_PAGE_PROBE_HI_A ||
    cur === MIRROR_LOG_PAGE_PROBE_HI_B
  ) {
    ctx = 2;
  } else if (
    cur === state.templateAt(SLOT_MirrorSlantedLog_Probe_A) ||
    cur === state.templateAt(SLOT_MirrorSlantedLog_Probe_B)
  ) {
    ctx = 0;
  } else {
    ctx = 3;
  }

  // Pick sub-stamp by $28 column counter:
  //   $28 == 0    → stamp_a   (leftmost col)
  //   $28 odd     → stamp_b
  //   $28 even>=2 → stamp_cd
  const col = state.zp28 & 0xff;
  let stampValue: number;
  if (col === 0) {
    stampValue = slantedLogGradualStampA(state, ctx, yByte);
  } else if ((col & 0x01) !== 0) {
    stampValue = slantedLogGradualStampB(state, ctx, yByte);
  } else {
    stampValue = slantedLogGradualStampCD(state, ctx, yByte);
  }

  // Store path: TYA ; BEQ done ; STA buffer,x.
  if (stampValue === 0) return;
  stampCell(state, stampValue);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_slanted_log_gradual ($12:9D12).
//
//   ; bank byte of stamp handler → $24/$21/$27
//   ; 16-bit handler offset      → $22/$1F/$25
//   LDA #$7FFF ; STA $19    ; row-walk end = unbounded
//   LDA #$FFFF ; STA $17    ; slope = -1 per row (diagonal advance)
//   JSR object_stream_walk
//   SEP #$30 ; RTL
//
// All 3 handler slots dispatch to CODE_slanted_log_gradual_stamp. Walker
// terminates when $2C catches $2E (the per-cell main stamp's `$2C>=3`
// gate handles the rectangle's tall side; in practice rectangle is
// up to 16 rows but only the first 3 stamp anything).
//
// Use walkerSetupKeepSlope so the pre-set $17 = -1 propagates into the
// walker — walkerSetupTrampoline zeros $17 unconditionally.
// ─────────────────────────────────────────────────────────────────────

function initSlantedLogGradual(state: DecodeState): void {
  state.zp17 = 0xFFFF; // -1 per-row slope (diagonal step)
  walkerSetupKeepSlope(state, slantedLogGradualStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installSlantedLogGradualHandlers(): void {
  registerStdObjectHandler(0x8F, initSlantedLogGradual);
}
