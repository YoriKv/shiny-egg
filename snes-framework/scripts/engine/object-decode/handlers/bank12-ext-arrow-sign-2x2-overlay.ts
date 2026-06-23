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
// The slot-address entries ($1DC6/$1DC8/$1DCA/$1DCC) are WRAM template slots the
// decoder DOES model (`state.templateAt`), so the deref is ported: the overlay
// pick = templateAt(DATA_12AD7D[elem]). On record $26 the arrow's bottom row
// sits on a floor template → the gate fires → templateAt($1DC6/$1DC8) = the
// floor-blended $6A26/$6A27 the cart produces. (The literal entries are only
// reached on row-0 indices, where the gate never fires for shipped levels — row
// 0 is above the floor — so their templateAt → 0 is never observed.)
//
// ── Side paths after the value is picked (keyed on the BG1 TILESET) ───────
// Both `CPY` checks below test Y = LevelHeaderBG1TilesetLo (NOT the cell
// index — an earlier porting error assumed the latter and dropped the remap):
//  • tileset == 4 AND row 0: remap via DATA_12AD95 (dw $0025,$0026,$0033,$0034)
//    by (pick - $000C). Record $26 DOES use BG1 tileset 4, so this IS ported.
//    The U2 build adds a get_map16_below-gated skip (`!ROM_YI_U2` conditional);
//    V1.0 (our build target) runs it unconditionally, which is what we model.
//  • tileset == $0C (the jungle tileset — World 1-1 uses it): the base pick is
//    DISCARDED and the cell is remapped through DATA_12AD9D
//    (dw $000C,$000D,$008E,$008F,$0013,$0014) by Y2 = (row*2 + col)*2:
//      row 0       → DATA_12AD9D[col]            = $000C / $000D
//      row 1, $85xx underneath → DATA_12AD9D[2+col] = $008E / $008F
//      row 1, otherwise        → DATA_12AD9D[4+col] = $0013 / $0014
//    The row-1 gate is `($12 & $FF00) == $8500` — i.e. is the existing cell an
//    $85xx (slope/ledge decoration) tile. This is the path that makes a $50
//    sign blend onto jungle ground.
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

// DATA_12AD9D ($12:AD9D) — BG1-tileset-$0C (jungle) remap table, indexed by
// Y2 = (row*2 + col)*2 (+4 on row 1 when the cell underneath isn't $85xx).
const DATA_12AD9D = [0x000c, 0x000d, 0x008e, 0x008f, 0x0013, 0x0014] as const;
// BG1 tileset whose stamp goes through the DATA_12AD9D remap (cart CPY #$000C).
const JUNGLE_BG1_TILESET = 0x0c;

// DATA_12AD95 ($12:AD95) — BG1-tileset-$04 (e.g. record $26) ROW-0 remap table,
// indexed by (pick - $000C). The cart's tileset-4 side path (CODE_12ADDE) only
// fires on row 0 and recomputes the cell as DATA_12AD95[base_pick - $000C].
// (V1.0 build: the path is unconditional. The U2 build inserts an extra
// `get_map16_below`-gated skip — `!ROM_YI_U2` conditional — which we don't build.)
const DATA_12AD95 = [0x0025, 0x0026, 0x0033, 0x0034] as const;

// DATA_12AD7D ($12:AD7D) — floor-overlay INDIRECT table. When the cell being
// stamped already holds a floor-row template tile (CODE_12ADD2 gate), the cart
// reads DATA_12AD7D[elem] as a WRAM ADDRESS and derefs it (`LDA $0000,y`) for a
// runtime floor-blended Map16 ID. The slot-address entries ($1DC6/$1DC8/$1DCA/
// $1DCC) resolve through `state.templateAt`; the literal entries ($0013/$0014/
// $000E.. and $0000) are only reachable on row-0 indices, where the overlay
// gate doesn't fire for any shipped level (row 0 sits above the floor), so their
// `templateAt` (→ 0 for non-slot addresses) is never observed.
const DATA_12AD7D = [
  0x0013, 0x0014, 0x1dc6, 0x1dc8, 0x0000, 0x0000,
  0x000e, 0x000f, 0x0011, 0x0012, 0x1dca, 0x1dcc,
] as const;

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
  const tileset = state.header[1] & 0xff;

  // ── Base pick ($00 in the cart) — overlay branch vs normal table ──
  // CODE_12ADD2: when the cell already holds one of the four floor-row template
  // tiles, the cart reads DATA_12AD7D[elem] as a WRAM address and derefs it for
  // a runtime floor-blended ID (`state.templateAt`). Otherwise it's the plain
  // DATA_12AD79 pick. (The earlier port modeled only the gate and always used
  // the plain pick, which dropped the bottom-row floor blends, e.g. $6A26 on
  // record $26.)
  const elem = ((state.zp15 & 0xff) + (col << 1) + (row << 2)) >>> 1;
  const pick = isFloorUnderneath(state)
    ? state.templateAt(DATA_12AD7D[elem]!) & 0xffff
    : ARROW_SIGN_TILES[elem]!;

  // ── Tileset side paths (keyed on BG1 tileset; mutually exclusive) ──
  // BG1 tileset $04 (e.g. record $26), ROW 0 only: remap the pick through
  // DATA_12AD95 by (pick - $000C). (V1.0 unconditional; U2 adds a
  // get_map16_below gate we don't build.)
  if (tileset === 0x04 && row === 0) {
    stampCell(state, DATA_12AD95[(pick - 0x000c) & 0xffff] ?? pick);
    return;
  }

  // BG1 tileset $0C (jungle, e.g. World 1-1): the pick is discarded and the
  // cell is remapped through DATA_12AD9D (cart CODE_12ADF7). Row 1 picks the
  // floor-blended $008E/$008F when an $85xx tile sits underneath, else $0013/
  // $0014.
  if (tileset === JUNGLE_BG1_TILESET) {
    let y2 = ((row << 1) | col) << 1; // (row*2 + col)*2
    if (y2 >= 4 && (state.zp12 & 0xff00) !== 0x8500) y2 += 4;
    stampCell(state, DATA_12AD9D[y2 >> 1]!);
    return;
  }

  // Any other tileset: store the base pick as-is.
  stampCell(state, pick);
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
