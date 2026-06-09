// Bank12 extended-object $67 = !Define_YI_ExtObj67_OldBranch — "branch of a
// tree stuck in the ground" (single-cell).
//
// NAMING: the cart label `CODE_extobj_handler_old_branch` matches the
// behaviour-verified ID (ExtendedObjectIDs.asm:291): OldBranch, NOT a
// stalactite/rock. (Rock 8, the 2x2 rock, is ext 0x66; see
// bank12-ext-rock-2x2.ts.) Earlier disassemblies mislabelled this
// `CODE_extobj_handler_stalactite_rock_a`; the asm has since been corrected.
//
// Shape: INLINE SINGLE-CELL (conditional tile-remap). The init handler does
// NOT set up the walker; it re-resolves the anchor cell, then runs an inline
// stamper that *conditionally* replaces the existing tile at the anchor.
//
// Asm (verbatim, yi/Banks/Bank12.asm):
//
//   CODE_extobj_handler_old_branch:           ; $12:8C8F (line 2153)
//     JSR.w CODE_get_current_map16_tile              ; re-resolve $1D, latch
//                                                    ;   existing Map16 ID → $12
//     REP.b #$30
//     JSL.l CODE_12B14A
//     SEP.b #$30
//     RTL
//
//   ; tables (line 7071-7087)
//   DATA_12B12A: dw $3DBD
//   DATA_12B12C: dw $3DC0
//   DATA_12B12E: dw $1A06,$1A1E,$1A2C,$1A56,DATA_12B12A,DATA_12B12C   ; +$3DCC,$3DCD
//   DATA_12B13A: dw $3DCC
//   DATA_12B13C: dw $3DCD
//   DATA_12B13E: dw $1A08,$1A1C,$1A2E,$1A54,DATA_12B13A,DATA_12B13C
//
//   CODE_12B14A:                                     ; $12:B14A (line 7089)
//     REP.b #$30
//     LDY.w #$0000
//   CODE_12B14F:                                     ; search loop
//     LDA.w DATA_12B12E,y      ; A = search-slot ADDRESS (e.g. $1A06)
//     PHY : TAY : LDA.w $0000,y : PLY   ; A = WORD AT that address (slot value)
//     CMP.b $12               ; == existing Map16 ID at the anchor?
//     BEQ.b CODE_12B165       ; match → remap
//     INY : INY : CPY.w #$0010 : BCC.b CODE_12B14F   ; 8 entries (16 bytes)
//     BRA.b CODE_12B172       ; no match → leave the cell unchanged
//   CODE_12B165:
//     LDX.b $1D
//     LDA.w DATA_12B13E,y      ; parallel table: replacement-slot ADDRESS
//     TAY : LDA.w $0000,y      ; A = WORD AT replacement address
//     STA.l !RAM_YI_Level_LevelDataBuffer,x   ; stamp the remapped tile
//   CODE_12B172:
//     SEP.b #$30 : RTL
//
// So this is a CONDITIONAL TILE-REMAP keyed on the tile already present at
// the anchor: the stamper walks 8 parallel (search → replace) address pairs,
// dereferences each pair to a 16-bit value, and if a search value equals the
// existing tile ($12) it overwrites the cell with the matching replace value.
// If nothing matches, the existing tile is preserved (no stamp).
//
// Pairs (search address → replace address), per the two tables above:
//   $1A06 → $1A08     (per-tileset template slots; runtime-populated)
//   $1A1E → $1A1C
//   $1A2C → $1A2E
//   $1A56 → $1A54
//   $3DBD → $3DCC     (DATA_12B12A → DATA_12B13A: ROM-resident constants)
//   $3DC0 → $3DCD     (DATA_12B12C → DATA_12B13C)
//   $3DCC → (addr $3DCC)   ; entries 6/7 deref the literals $3DCC/$3DCD as
//   $3DCD → (addr $3DCD)   ;   ADDRESSES — cart RAM the editor doesn't model
//
// !! STATIC-DECODE LIMITATION (documented, faithful) !!
//   The first four search/replace pairs read PER-TILESET TEMPLATE SLOTS
//   ($1A06..) which our decoder models via state.templateAt(): they are 0 at
//   static-decode time unless the template populator has run. The last four
//   pairs deref ROM/RAM addresses ($3DBD/$3DC0/$3DCC/$3DCD) the editor does
//   not model. With templates unpopulated the search values are all 0, so a
//   match only occurs if the anchor's existing tile is itself 0 — i.e. on a
//   blank cell the remap is a no-op-ish 0→0. This mirrors what the cart does
//   when slots are clear, which is exactly the state the synthetic ext-67
//   trace cell observed (spec.json output_mapid=null, stamps=[]).
//
//   We therefore replicate the EXACT search/remap algorithm against the
//   template slots we DO model (via templateAt), preserving the existing
//   tile when nothing matches. When the editor's template populator is wired
//   in, the first-four-pair remaps become live automatically; the ROM-resident
//   tail pairs ($3DBD/$3DC0/$3DCC/$3DCD derefs) remain unmodeled — flagged
//   for a future template/ROM-read pass.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell } from './_shared.ts';

// Parallel (search-slot, replace-slot) WRAM template addresses — the first
// four DATA_12B12E / DATA_12B13E pairs. These are per-tileset template slots
// readable via state.templateAt(). (Bank12.asm:7078 / 7087.)
const REMAP_PAIRS: ReadonlyArray<readonly [search: number, replace: number]> = [
  [0x1A06, 0x1A08],
  [0x1A1E, 0x1A1C],
  [0x1A2C, 0x1A2E],
  [0x1A56, 0x1A54],
];

// CODE_extobj_handler_old_branch ($12:8C8F) — OldBranch, inline single cell.
function initOldBranch(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolve $1D, latch existing tile → $12.
  getCurrentMap16Tile(state);

  // CODE_12B14A search loop: find a template slot whose value matches the
  // existing tile, and remap to the parallel slot's value. Preserve the tile
  // when nothing matches (the cart BRAs to CODE_12B172 without storing).
  //
  // Only the four template-slot pairs are modeled; the cart's tail pairs
  // ($3DBD/$3DC0/$3DCC/$3DCD address derefs) read RAM/ROM the editor does
  // not model and are intentionally omitted (see header).
  const existing = state.zp12 & 0xffff;
  for (const [searchSlot, replaceSlot] of REMAP_PAIRS) {
    if ((state.templateAt(searchSlot) & 0xffff) === existing) {
      stampCell(state, state.templateAt(replaceSlot) & 0xffff);
      return;
    }
  }
  // No match: leave the existing tile in place (cart falls through to RTL).
}

export function installExtOldBranchHandlers(): void {
  registerExtObjectHandler(0x67, initOldBranch);
}
