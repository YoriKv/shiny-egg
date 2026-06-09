// Bank12 ext-objects $50 AND $A8 — arrow_sign_2x2_overlay. A 2x2 block of
// Map16 tiles whose four IDs are picked from a word table by an orientation
// base + the walker col/row counters, with a floor-aware "overlay" branch.
//
// Ports:
//   $12:8B3E  CODE_extobj_handler_arrow_sign_2x2_overlay  (init)
//   $12:ADA9  CODE_12ADA9                                  (per-cell stamper)
//   $12:AD79  DATA_12AD79                                  (main tile table)
//   $12:AD7D  DATA_12AD7D                                  (floor-overlay indirect table)
//
// Both ext IDs $50 and $A8 dispatch to the SAME init handler (spec.json
// `init_handler` is identical for both); the init re-encodes the ext ID
// into the orientation byte $15, which becomes the table base offset.
//
// ── Init (verbatim, Bank12.asm:1952 / $12:8B3E) ──────────────────────────
//   REP #$20
//   LDA $15 : AND #$0008 : ASL : STA $15   ; $15 := ($15 & 8) << 1
//   LDA #$0002 : STA $2A : STA $2E          ; force 2x2 extent
//   LDX #(CODE_12ADA9-1)>>16
//   LDA #CODE_12ADA9-1
//   JMP CODE_walker_setup_trampoline        ; slope 0; all 3 slots = stamper
//
// `($15 & 8) << 1` maps ext $50 → $00 and ext $A8 → $10 (matches the spec
// DP-diff). Since $15&8 ∈ {0,8} and the result is shifted left, $15 is always
// one of {0x00, 0x10}. The 2x2 extents overwrite the stream's raw 1x1
// (spec: col/row 0001→0002).
//
// ── Stamper (verbatim core, Bank12.asm:6577 / $12:ADA9) ──────────────────
//   REP #$30
//   LDY #0
//   LDA $28 : ASL : STA $00          ; col*2
//   LDA $2C : ASL : ASL : ORA $00    ; + row*4
//   ORA $15 : TAY                    ; Y = $15 + col*2 + row*4  (byte index)
//   LDA $12                          ; existing Map16 ID at this cell
//   CMP $1C5C : BEQ over             ; \ if the cell already holds one of the
//   CMP $1C5E : BEQ over             ; |  four FLOOR template IDs, take the
//   CMP $1DB4 : BEQ over             ; |  floor-aware "overlay" branch
//   CMP $1DB6 : BNE normal          ; /
//   over:   LDA DATA_12AD7D,y : TAY : LDA $0000,y     ; indirect WRAM deref
//   normal: LDA DATA_12AD79,y
//   store:  ... (tileset-4/row-0 + CPY #$000C side paths, see below) ...
//           LDX $1D : STA.l LevelDataBuffer,x
//
// The byte index `Y = $15 + col*2 + row*4` indexes a WORD table, i.e.
// element index ($15>>1) + col + row*2.
//
// Trace evidence (spec ext-50, $15=$00):     Trace evidence (ext-A8, $15=$10):
//   (c0,r0) Y$00 → $000C  (c1,r0) Y$02 → $000D    Y$10 → $000E   Y$12 → $000F
//   (c0,r1) Y$04 → $0013  (c1,r1) Y$06 → $0014    Y$14 → $0011   Y$16 → $0012
// All 8 reachable cells reproduce 1:1 from the ROM-verified table below.
//
// ── Overlay branch (the "overlay" in the name) ───────────────────────────
// When the cell underneath already holds a floor-row template tile
// ($1C5C/$1C5E = TileTpl_FloorRow0_Left/RightLo, or slots $1DB4/$1DB6), the
// cart swaps to the indirect table DATA_12AD7D (Bank12.asm:6568):
//   dw $0013,$0014,$1DC6,$1DC8,$0000,$0000,$000E,$000F,$0011,$0012,$1DCA,$1DCC
// Some entries are WRAM template-slot ADDRESSES; the cart reads DATA_12AD7D[Y]
// and dereferences it (`LDA $0000,y`) to fetch a floor-blended replacement
// Map16 ID. That deref reads a runtime WRAM slot the static decoder doesn't
// model, so we honor the gate but fall through to the plain DATA_12AD79[Y]
// value when it fires. Safe for every observed cell: in BOTH captured traces
// the existing cell is $0000 (all four CMPs miss) → normal branch → output
// is exactly DATA_12AD79[Y]. (Static buffers start zeroed; the overlay only
// matters when an arrow-sign is placed directly over a pre-stamped floor.)
//
// ── Side paths after the value is picked (both trace-confirmed no-ops) ────
//  • If LevelHeaderBG1TilesetLo == 4 AND row 0: a tileset-specific remap via
//    DATA_12AD95 (dw $0025,$0026,$0033,$0034). Neither test level uses BG1
//    tileset 4, so this branch is skipped.
//  • CPY #$000C : BNE store — taken (Y ∈ {$00..$06,$10..$16}, never == $0C),
//    so the DATA_12AD9D remap (dw $000C,$000D,$008E,$008F,$0013,$0014) is
//    skipped.
// Both fall straight through to the plain stamp in the traces; we document
// them rather than port remaps that are dead for our inputs and key off
// runtime tileset state we don't model.
//
// Buffer offsets fall out of the walker (+2/col, +0x20/row) — handled by
// walkerSetupTrampoline + stampCell. The trace's interleaved CODE_128874 /
// CODE_128640 frames are the walker's own wrap sentinels + bookkeeping.
//
// No PRNG, no savefile/flag gates.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Table read at `DATA_12AD79,y` with byte index Y = $15 + col*2 + row*4 (the
// WORD element is Y>>1). The asm label DATA_12AD79 is only 2 words wide
// (`dw $000C,$000D`, Bank12.asm:6565); for Y up to $16 the cart reads PAST it
// into the contiguous bytes that follow (the head of DATA_12AD7D). The 12
// words below are the verbatim contiguous ROM bytes at $12:AD79 (PC $92D79,
// V1.0), so indexing by Y>>1 reproduces the cart's read exactly:
//     $000C,$000D,$0013,$0014,$1DC6,$1DC8,$0000,$0000,$000E,$000F,$0011,$0012
// $15 only ever holds {$00,$10} (see init), so the reachable elements are
// 0..3 (ext $50) and 8..11 (ext $A8). Elements 4..7 ($1DC6,$1DC8,$0000,$0000)
// are never reached by these IDs but kept verbatim for fidelity.
const ARROW_SIGN_TILES = [
  0x000c, 0x000d, 0x0013, 0x0014, // elems 0..3 — ext $50 ($15=$00): r0c0,r0c1,r1c0,r1c1
  0x1dc6, 0x1dc8, 0x0000, 0x0000, // elems 4..7 — past DATA_12AD79 (unreachable for $50/$A8)
  0x000e, 0x000f, 0x0011, 0x0012, // elems 8..11 — ext $A8 ($15=$10): r0c0,r0c1,r1c0,r1c1
] as const;

// Cart WRAM template slots compared against the existing cell ($12) to
// decide the floor-aware overlay branch (Bank12.asm:6585-6592).
const TPL_FLOOR_ROW0_LEFT_LO  = 0x1c5c; // !RAM_YI_Level_TileTpl_FloorRow0_LeftLo
const TPL_FLOOR_ROW0_RIGHT_LO = 0x1c5e; // !RAM_YI_Level_TileTpl_FloorRow0_RightLo
const TPL_SLOT_1DB4 = 0x1db4;
const TPL_SLOT_1DB6 = 0x1db6;

/** True when the existing cell holds one of the four floor-row template
 *  tiles — the cart's trigger for the indirect DATA_12AD7D overlay path.
 *  Compares $12 against the runtime-populated template slots. */
function isFloorUnderneath(state: DecodeState): boolean {
  const cur = state.zp12 & 0xffff;
  return (
    cur === state.templateAt(TPL_FLOOR_ROW0_LEFT_LO) ||
    cur === state.templateAt(TPL_FLOOR_ROW0_RIGHT_LO) ||
    cur === state.templateAt(TPL_SLOT_1DB4) ||
    cur === state.templateAt(TPL_SLOT_1DB6)
  );
}

// ─────────────────────────────────────────────────────────────────────
// CODE_12ADA9 — per-cell stamper. Y = $15 + col*2 + row*4 (byte index into
// the word table). The floor-overlay branch is modeled (see header): its
// indirect WRAM deref can't be resolved at static decode, so when it fires
// we fall back to the plain table value — which matches every observed cell.
// ─────────────────────────────────────────────────────────────────────

const arrowSignStamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const wordIndex = ((state.zp15 & 0xff) + (col << 1) + (row << 2)) >>> 1;
  // Overlay gate: when a floor tile sits underneath, the cart would deref
  // DATA_12AD7D[Y] (a runtime WRAM pointer); unresolvable statically, so we
  // proceed with the plain pick. `isFloorUnderneath` is false for both traces.
  void isFloorUnderneath(state);
  stampCell(state, ARROW_SIGN_TILES[wordIndex]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_arrow_sign_2x2_overlay ($12:8B3E). $15 := ($15 & 8)
// << 1 (the table base), force a 2x2 extent, run the bare walker. The
// walker reads zp2A/zp2E at dispatch and the stamper reads zp15 per cell,
// so set them before dispatching.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x50, 0xA8 share this handler.
function initArrowSign2x2Overlay(state: DecodeState): void {
  state.zp15 = ((state.zp15 & 0x0008) << 1) & 0xffff; // $50→$00, $A8→$10
  state.zp2A = 0x0002; // col extent = 2
  state.zp2E = 0x0002; // row extent = 2
  walkerSetupTrampoline(state, arrowSignStamp);
}

export function installExtArrowSign2x2OverlayHandlers(): void {
  registerExtObjectHandler(0x50, initArrowSign2x2Overlay);
  registerExtObjectHandler(0xa8, initArrowSign2x2Overlay);
}
