// Bank13 wide signed-direction slope ($81).
//
// Cart routines:
//   $12:9C47  CODE_init_wide_slope_signed       — std-init for $81
//   $13:D098  CODE_wide_slope_signed_stamp      — per-cell stamp
//   $13:D0C3  CODE_wide_slope_signed_leftcap    — row 0 sub-handler
//   $13:D0DB  CODE_wide_slope_signed_mid        — row 1 sub-handler
//   $13:D071  CODE_slope_fill_alt_rightcap      — row 2+ sub-handler (shared with $80)
//
// Description (init): keep-slope walker setup with $17 = $FFFF (descending
// per-row pitch, so $2E shrinks by 1 each col-step) and $19 = $7FFF
// (unbounded row-end). Latches |$2A| into $2E (so a negative col-extent —
// "grows left" — still terminates on a positive count when the rewind
// path adds $17 each col-wrap). Doesn't touch $1B/$1C, $A1, or $9B at
// init time — the stamp sets $9B=1 on every cell to keep the walker in
// slope-rewind mode.
//
// Description (stamp): a 3-entry sub-handler table indexed by ROW ($2C):
//   row == 0       → CODE_wide_slope_signed_leftcap   (X=0, $1D8A-suppression)
//   row == 1       → CODE_wide_slope_signed_mid       (X=2, no suppression)
//   row >= 2       → CODE_slope_fill_alt_rightcap     (X=4, shared with $80)
// The asm comment on CODE_wide_slope_signed_stamp reads "by col-position" — this is
// MISLEADING. The instruction stream loads $2C (the row counter inside
// the column) and dispatches on its value. Trace specs confirm: cell 0
// (row=0) → leftcap, cell 1 (row=1) → mid, cells 2-11 (row=2..11) all
// take the rightcap branch in the same column. Walker is column-major
// (slope-mode), so "row" here is the vertical step within each column.
//
// Each sub-handler returns a Map16 ID in Y; the outer stamp tests Y's
// sign (REP #$30 → 16-bit BMI on Y), and skips the buffer write when
// Y < 0 (the sub-handlers signal "suppress this cell" via Y = $FFFF).
//
// Per-sub-handler tile picks:
//   leftcap  : Y = templateAt($1D9A) if $2A signed-negative else templateAt($1DA0).
//              Then if ($12 & $FF00) == templateAt(Family6800_Anchor)
//              ($1D8A), force Y = $FFFF (don't stamp over a Family6800
//              cell already in the buffer).
//   mid      : Y = templateAt($1D9C) if $2A signed-negative else templateAt($1D9E).
//              No suppression.
//   rightcap : if $12 != 0 AND ($12 & $FF00) != templateAt(Family6800_Anchor),
//              suppress (Y = $FFFF). Otherwise pick the col-parity slot:
//              col even → templateAt($1D8C), col odd → templateAt($1D8E).
//
// All 4 read slots ($1D8C/$1D8E/$1D9A/$1D9C/$1D9E/$1DA0) live inside the
// Family6800 (anchor $1D8A, 20 slots) — per-tileset Map16 IDs populated
// by CODE_init_per_tileset_template_slots. Trace-verified slot values:
// $6800 anchor → $1D8C=$6801, $1D9A unused (positive $2A in spec), $1D9E=$680A,
// $1DA0=$680B.
//
// Shared with object $80 (CODE_init_slope_fill_signed): the rightcap
// sub-handler is byte-for-byte the same as $80's row=2+ fill. When $80
// is ported, this `slopeFillAltRightcap` helper should move to `_shared.ts`
// to avoid duplication.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell, signed16 } from './_shared.ts';

// ───────────────────────────────────────────────────────────────────────
// Family6800 sub-slot addresses (within the 20-slot family anchored at
// TT.Family6800_Anchor = $1D8A). Each is a 16-bit WRAM template slot
// holding a per-tileset Map16 ID; deref via state.templateAt().
// ───────────────────────────────────────────────────────────────────────
const SLOT_1D8C = 0x001D8C; // rightcap, col-even pick
const SLOT_1D8E = 0x001D8E; // rightcap, col-odd  pick
const SLOT_1D9A = 0x001D9A; // leftcap, $2A signed-negative pick
const SLOT_1D9C = 0x001D9C; // mid,     $2A signed-negative pick
const SLOT_1D9E = 0x001D9E; // mid,     $2A non-negative pick
const SLOT_1DA0 = 0x001DA0; // leftcap, $2A non-negative pick

const Y_SUPPRESS = 0xFFFF; // sub-handler return sentinel; outer BMI skips stamp.

// ───────────────────────────────────────────────────────────────────────
// CODE_wide_slope_signed_leftcap — row==0 sub-handler.
// ───────────────────────────────────────────────────────────────────────

function wideSlopeSignedLeftcap(state: DecodeState): number {
  // LDY $1DA0 / LDA $2A / BPL skip / LDY $1D9A
  // $2A is the column extent; signed-negative selects the alt slot.
  // Cart reads $2A as 16-bit (REP #$30 in effect) — combine $2A:$2B.
  const colExtent16 = signed16((state.zp2A | (state.zp2B << 8)) & 0xffff);
  let y = colExtent16 < 0
    ? state.templateAt(SLOT_1D9A)
    : state.templateAt(SLOT_1DA0);

  // Suppression: if ($12 & $FF00) == templateAt(Family6800_Anchor), force Y = $FFFF.
  // The cart's CMP is a 16-bit compare against the WORD stored at $1D8A
  // (the Family6800 anchor's per-tileset Map16 ID, e.g. $6800), not the
  // raw address — so this only fires when the underlying cell's high byte
  // is the family's "low byte must be zero" sentinel, i.e., the cell IS
  // a Family6800 anchor tile.
  const pageByte = state.zp12 & 0xFF00;
  if (pageByte === state.templateAt(TT.Family6800_Anchor)) {
    y = Y_SUPPRESS;
  }
  return y & 0xFFFF;
}

// ───────────────────────────────────────────────────────────────────────
// CODE_wide_slope_signed_mid — row==1 sub-handler.
// ───────────────────────────────────────────────────────────────────────

function wideSlopeSignedMid(state: DecodeState): number {
  // LDY $1D9E / LDA $2A / BPL skip / LDY $1D9C — no neighbour suppression.
  const colExtent16 = signed16((state.zp2A | (state.zp2B << 8)) & 0xffff);
  return colExtent16 < 0
    ? state.templateAt(SLOT_1D9C) & 0xFFFF
    : state.templateAt(SLOT_1D9E) & 0xFFFF;
}

// ───────────────────────────────────────────────────────────────────────
// CODE_slope_fill_alt_rightcap — row>=2 sub-handler.
//
// Shared between object $80 (CODE_init_slope_fill_signed) and object
// $81 (this file). Returns Y = col-parity-indexed Family6800 slot when
// the underlying cell is either empty ($12==0) or already a Family6800
// member; otherwise suppresses with Y = $FFFF.
// ───────────────────────────────────────────────────────────────────────

function slopeFillAltRightcap(state: DecodeState): number {
  // LDA $12 / CMP #$0000 / BEQ to-table-lookup
  if (state.zp12 === 0) {
    return colParityRightcapPick(state);
  }
  // AND #$FF00 / CMP $1D8A / BEQ to-table-lookup
  if ((state.zp12 & 0xFF00) === state.templateAt(TT.Family6800_Anchor)) {
    return colParityRightcapPick(state);
  }
  // Otherwise: LDY #$FFFF, BRA to RTS.
  return Y_SUPPRESS;
}

/** Inner "table lookup" tail of slopeFillAltRightcap. DATA_slope_fill_alt_rightcap_tiles holds
 *  two WRAM slot addresses { $1D8C, $1D8E }; $28 LSB picks which one
 *  to deref. */
function colParityRightcapPick(state: DecodeState): number {
  // LDA $28 / AND #$0001 / ASL / TAY / LDX DATA_slope_fill_alt_rightcap_tiles,y / LDA $0000,x / TAY
  const slot = (state.zp28 & 0x01) === 0 ? SLOT_1D8C : SLOT_1D8E;
  return state.templateAt(slot) & 0xFFFF;
}

// ───────────────────────────────────────────────────────────────────────
// CODE_wide_slope_signed_stamp
//
// REP #$30 outer stamp: writes $9B = 1 (slope-keep latch), dispatches on
// $2C to one of the 3 sub-handlers, then stamps Y unless BMI (Y has bit
// 15 set, i.e., Y == $FFFF "suppress").
// ───────────────────────────────────────────────────────────────────────

const wideSlopeSignedStamp: PerCellHandler = (state) => {
  // LDA #$01 / STA $9B — set the walker's "rewound / keep-slope" latch.
  // The walker clears $9B at the top of intra_object_walker; setting it
  // here on every cell ensures the col-step rewind path runs each col
  // boundary, which is what propagates the $17 = -1 slope.
  state.rewound = 1;

  const row = state.zp2C & 0xFF;
  let y: number;
  if (row === 0) {
    y = wideSlopeSignedLeftcap(state);
  } else if (row === 1) {
    y = wideSlopeSignedMid(state);
  } else {
    y = slopeFillAltRightcap(state);
  }

  // TYA / BMI skip — Y signed (16-bit) negative means suppress this cell.
  if ((y & 0x8000) !== 0) return;
  stampCell(state, y & 0xFFFF);
};

// ───────────────────────────────────────────────────────────────────────
// CODE_init_wide_slope_signed (CODE_12:9C47)
//
// All 3 walker handler slots get wideSlopeSignedStamp; the cart's setup
// path bypasses the standard trampoline ($17 = 0) and instead sets:
//   $17 = $FFFF   (per-row -1 slope advance — descending)
//   $19 = $7FFF   (unbounded row-end — termination via $2C==$2E)
//   $2E = abs($2A)  (signed-magnitude row extent so the rewind path
//                    knows when each column is done)
// then runs the walker.
// ───────────────────────────────────────────────────────────────────────

function initWideSlopeSigned(state: DecodeState): void {
  // $17 = $FFFF — per-row $14 slope advance (-1, descending bias).
  state.zp17 = 0xFFFF;

  // $2E = |column extent| (16-bit signed magnitude). The cart does `LDA.b $2A`
  // under REP #$30 — the extent is the WORD at $2A, which in our state model is
  // held WHOLE in `zp2A` (the parser stores the full signed 16-bit extent there).
  // `zp2B` is the walker's unrelated page-carry scratch; an earlier
  // `zp2A | (zp2B<<8)` read it stale. Keep $2E 16-bit (`& 0xffff`) so the walker
  // reads its sign 16-bit (see walker.ts). NB: no backed level uses std-$81, so
  // this path is exercised only by edits — kept faithful for that case.
  const colExt16 = signed16(state.zp2A);
  state.zp2E = Math.abs(colExt16) & 0xffff;

  // Walker keeps caller's $17. Same handler wired to all three slots.
  walkerSetupKeepSlope(state, wideSlopeSignedStamp);
}

// ───────────────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────────────

export function installWideSlopeSignedHandlers(): void {
  registerStdObjectHandler(0x81, initWideSlopeSigned);
}
