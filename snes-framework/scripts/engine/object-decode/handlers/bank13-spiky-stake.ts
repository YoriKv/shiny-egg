// Standard object $6D — init_spiky_stake.
//
// Cart entries:
//   CODE_init_spiky_stake @ $12:9AD0 (yi/Banks/Bank12.asm:4143)
//   CODE_stamp_spiky_stake      @ $13:C7C0 (yi/Banks/Bank13.asm:8255)
//   DATA_3section_vertical_tiles @ $13:C7E2 (yi/Banks/Bank13.asm:8277)
//
// Vertical pillar / column — 3-section layout (top / middle / bottom)
// driven by the walker's row counter $2C vs row extent $2E. Distinct
// from the $0C/$0E/$0F "post" family (bank13-post-vertical.ts) only in
// the choice of "top" WRAM template slot:
//
//                top    middle   bottom
//   $6D (this) $1DD6 / $1DD0  / $1DD2
//   $0C        $1DCE / $1DD0  / $1DD2     (same mid/bot, different top)
//
// Asm (cart) uses double indirection: the 3-entry table holds WRAM
// template-slot ADDRESSES; the handler loads `DATA_3section_vertical_tiles,y`, transfers
// to Y, then `LDA $0000,y` reads the slot's 16-bit Map16 ID. Equivalent
// to `templateAt(slotAddr)` in TS — see `state.templateAt`.
//
//   CODE_stamp_spiky_stake (REP #$30):
//     LDY #$0000
//     LDA $2C
//     BEQ done             ; row 0           → y=0 (top  → slot $1DD6)
//     INY ; INY            ; y=2
//     INC ; CMP $2E
//     BNE done             ; not last row    → y=2 (mid  → slot $1DD0)
//     INY ; INY            ; y=4
//                          ; last row        → y=4 (bot  → slot $1DD2)
//   done:
//     LDX $1D
//     LDA DATA_3section_vertical_tiles,y    ; slot address ($1DD6 / $1DD0 / $1DD2)
//     TAY
//     LDA $0000,y          ; deref → Map16 ID
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     RTL
//
// The captured trace exercises an 11-row
// column (extent $0B): row 0 stamps `slot_1DD6` = $6C00 (top); rows 1-9
// stamp `slot_1DD0` = $6B01 (middle); row 10 stamps `slot_1DD2` = $6B02
// (bottom). DP-diff table all "no" — pure trampoline init.
//
// asm primary; goldenegg has no matching symbol (searched 3section /
// Vertical / case 0x6D — 0 hits).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// WRAM template slots referenced by the stamp handler. These match
// `DATA_3section_vertical_tiles` (Bank13.asm:8277) entry-for-entry; the
// asm table holds slot ADDRESSES (not Map16 IDs), which `state.templateAt`
// dereferences in the TS port.
//
// Mid/bot slots ($1DD0 / $1DD2) are SHARED with bank13-post-vertical's
// $0C variant — see that file's MID_TABLE/BOT_TABLE for the y=0 entries.
// Consolidation candidate: a `TT.PostVertical_*` enum could name the
// $1DCE/$1DD0/$1DD2/$1DD6 quartet once the post family and 3-section
// family share a unified WRAM-slot naming.
// ─────────────────────────────────────────────────────────────────────

const SLOT_3SECTION_TOP    = 0x001DD6;
const SLOT_3SECTION_MIDDLE = 0x001DD0;
const SLOT_3SECTION_BOTTOM = 0x001DD2;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_spiky_stake ($13:C7C0, Bank13.asm:8255) — per-cell handler.
//
// 3-way row classification (top / middle / bottom) → slot → stamp. The
// extent $2E is treated as 8-bit unsigned: the cart compare runs in
// REP #$20 but $2C/$2E are byte-sized counters set by Bank10's stream
// parser. Matches the convention in bank13-post-vertical.ts and
// bank13-jungle-stake.ts.
// ─────────────────────────────────────────────────────────────────────
const section3VerticalStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const ext = state.zp2E & 0xff;

  let slot: number;
  if (row === 0) {
    slot = SLOT_3SECTION_TOP;
  } else if (((row + 1) & 0xff) === ext) {
    slot = SLOT_3SECTION_BOTTOM;
  } else {
    slot = SLOT_3SECTION_MIDDLE;
  }
  stampCell(state, state.templateAt(slot));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_spiky_stake ($12:9AD0, Bank12.asm:4143).
//
//   REP.b #$20
//   LDX.b #(CODE_stamp_spiky_stake-$01)>>16
//   LDA.w #CODE_stamp_spiky_stake-$01
//   JMP.w CODE_walker_setup_trampoline
//
// Bare trampoline — no DP mutations (spec diff table all "no"). The
// walker reads $2A=1 (col extent), $2E=$0B (row extent) directly from
// the stream's header.
// ─────────────────────────────────────────────────────────────────────
function initSpikyStake(state: DecodeState): void {
  walkerSetupTrampoline(state, section3VerticalStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installSpikyStakeHandlers(): void {
  registerStdObjectHandler(0x6D, initSpikyStake);
}
