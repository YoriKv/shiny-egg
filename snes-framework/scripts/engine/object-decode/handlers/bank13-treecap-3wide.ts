// Standard objects $91 / $92 — init_treecap_3wide.
//
// Cart entry: CODE_init_treecap_3wide @ $12:9D5C (Bank12.asm:4530).
// Per-cell stamp handlers (shared init; $15 bit 1 picks which):
//   CODE_treecap_stamp_a @ $13:D61A (Bank13.asm:10247)
//     — Variant A. Top-2-rows table from DATA_treecap_tiles_a; middle-
//        column stem $3DB2; last-row middle-column shape probe reads
//        template slots in family-0800 ($1A06/$1A0A) and family-0C00
//        ($1A2C/$1A30) to graft onto an existing canopy / branch tile,
//        with fallback $3DAC.
//   CODE_treecap_stamp_b @ $13:D675 (Bank13.asm:10298)
//     — Variant B. Same shape, different tile family: top-2-rows from
//        DATA_treecap_tiles_b; middle-column stem $3DB3; last-row
//        middle-column shape probe reads family-0A00 ($1A1A/$1A1E)
//        and family-1000 ($1A52/$1A56); fallback $3DAD.
//
// Init handler is shared between two object IDs:
//   $91 ($15 bit 1 == 0) → CODE_treecap_stamp_a.
//   $92 ($15 bit 1 == 1) → CODE_treecap_stamp_b.
//
// The init forces col extent $2A = 3, DECs the sub-X nibble of $1B by 1
// (shifting column origin one cell left so the 3-wide cap centres on
// the stream's nominal anchor), then trampolines into the variant's
// stamp handler via DATA_treecap_variant_handlers ($12:9D58):
//   dw CODE_treecap_stamp_a-1, CODE_treecap_stamp_b-1
// indexed by ($15 & 2). The Y-load preserves the bit position (0 or
// 2), not normalised to 0/1, so the dw table is sparse-stepped by 2.
//
// Per-cell decision tree (mirrors the cart prose, identical structure
// for both variants — only the tile constants + neighbour slots differ):
//
//   if row < 2:
//     idx = (col * 2) | (row * 8)
//     stamp DATA_treecap_tiles_X[idx]      ; canopy-row pick
//     // Note idx 6 (col=3,row=0) holds $0000 but is unreachable with
//     // col extent 3. Idx 6 is dead; the stamp would write $0000 if hit.
//
//   else (row >= 2):
//     if col == 0 or col == 2:  return  ; outer columns leave row 2+ blank
//     // col == 1 (middle column).
//     if row + 1 != extent:
//       stamp STEM                         ; $3DB2 (A) / $3DB3 (B)
//     else (last row, middle column):
//       // Shape-aware grafting: stamp a template-slot tile if the cell
//       // already there matches one of two anchor patterns; else stamp
//       // the literal default ($3DAC for A / $3DAD for B).
//       cur = $12 (existing Map16 ID under us)
//       if cur == slot[NeighbourMatchA]: stamp slot[NeighbourStampA]
//       elif cur == slot[NeighbourMatchB]: stamp slot[NeighbourStampB]
//       else: stamp DEFAULT_LAST_ROW
//
// Init handler DP mutations (cross-checked against spec.md):
//   $1B (low byte of word $1B:$1C) — sub-X nibble decremented by 1
//     (keep $F0F0 screen nibbles, DEC the $0F0F sub nibbles, OR back).
//     Spec $91: $6A → $69. Spec $92: $84 → $83.
//   $2A (col extent) — forced to $0003.
//   $1C / $2E / $15 — untouched.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_treecap_tiles_a ($13:D60C, Bank13.asm:10243).
// DATA_treecap_tiles_b ($13:D667, Bank13.asm:10294).
//
// 7-entry top-rows tile tables. Indexed by Y = (col * 2) | (row * 8).
// Reachable indices for col extent 3 + rows 0..1: {0,2,4,8,10,12}.
// Index 6 ($0000) is unreachable with col-extent 3 (would require col=3).
// ─────────────────────────────────────────────────────────────────────

const DATA_treecap_tiles_a = [0x3DC2, 0x3DC3, 0x3DC4, 0x0000, 0x3DC8, 0x3DC9, 0x3DCA] as const;
const DATA_treecap_tiles_b = [0x3DC5, 0x3DC6, 0x3DC7, 0x0000, 0x3DCB, 0x3DAE, 0x3DAF] as const;

// ─────────────────────────────────────────────────────────────────────
// Per-variant tile + template-slot constants. The variants are
// structurally identical — only these 7 values differ.
//
// Neighbour-match / neighbour-stamp slots are WRAM template-slot
// addresses (`$00:1Axx`); the populator at level-load deposits per-
// tileset Map16 anchors at these slots. The stamp dereferences via
// `state.templateAt()`.
//
// Family provenance (see template-slots.ts + WRAM_LevelTemplateSlots.asm):
//   $1A02 → Family0800_Anchor    ($1A06 = +$04, $1A0A = +$08)
//   $1A16 → Family0A00_Anchor    ($1A1A = +$04, $1A1E = +$08)
//   $1A2A → Family0C00_Anchor    ($1A2C = +$02, $1A30 = +$06)
//   $1A50 → Family1000_Anchor    ($1A52 = +$02, $1A56 = +$06)
// ─────────────────────────────────────────────────────────────────────

interface TreecapVariant {
  topRowTiles:        ReadonlyArray<number>; // DATA_treecap_tiles_{a,b}
  stemTile:           number; // middle-column row 2..(extent-2) tile ($3DB2 / $3DB3)
  defaultLastRowTile: number; // fallback when neighbour probes miss ($3DAC / $3DAD)
  neighbourMatchA:    number; // slot read for shape probe A ($1A06 / $1A1A)
  neighbourStampA:    number; // slot stamped on match A ($1A0A / $1A1E)
  neighbourMatchB:    number; // slot read for shape probe B ($1A2C / $1A52)
  neighbourStampB:    number; // slot stamped on match B ($1A30 / $1A56)
}

const VARIANT_A: TreecapVariant = {
  topRowTiles:        DATA_treecap_tiles_a,
  stemTile:           0x3DB2,
  defaultLastRowTile: 0x3DAC,
  neighbourMatchA:    0x001A06,
  neighbourStampA:    0x001A0A,
  neighbourMatchB:    0x001A2C,
  neighbourStampB:    0x001A30,
};

const VARIANT_B: TreecapVariant = {
  topRowTiles:        DATA_treecap_tiles_b,
  stemTile:           0x3DB3,
  defaultLastRowTile: 0x3DAD,
  neighbourMatchA:    0x001A1A,
  neighbourStampA:    0x001A1E,
  neighbourMatchB:    0x001A52,
  neighbourStampB:    0x001A56,
};

// ─────────────────────────────────────────────────────────────────────
// Shared stamp body. Both variants run identical logic against a
// `TreecapVariant` constants pack.
// ─────────────────────────────────────────────────────────────────────

function stampTreecap(state: DecodeState, v: TreecapVariant): void {
  const row    = state.zp2C & 0xffff;
  const col    = state.zp28 & 0xffff;
  const colExt = state.zp2A & 0xffff;
  const rowExt = state.zp2E & 0xffff;

  // CODE_13D61E (variant A) / CODE_13D677 (variant B).
  if (row < 2) {
    // Top-2-rows table pick. Idx = (col << 1) | (row << 3).
    const idx = ((col << 1) | (row << 3)) & 0x07; // 7-entry table guard
    const tile = v.topRowTiles[idx]!;
    stampCell(state, tile);
    return;
  }

  // CODE_13D635 — stem / last-row branch (row >= 2).
  // Skip outer columns: `LDA $28 ; BEQ skip ; INC ; CMP $2A ; BEQ skip`.
  if (col === 0) return;
  if (col + 1 === colExt) return;
  // col == 1 (middle column).

  if (row + 1 !== rowExt) {
    // Interior row: stamp stem tile.
    stampCell(state, v.stemTile);
    return;
  }

  // Last row, middle column: shape-aware graft against existing $12.
  const cur = state.zp12 & 0xffff;
  if (cur === state.templateAt(v.neighbourMatchA)) {
    stampCell(state, state.templateAt(v.neighbourStampA));
    return;
  }
  if (cur === state.templateAt(v.neighbourMatchB)) {
    stampCell(state, state.templateAt(v.neighbourStampB));
    return;
  }
  stampCell(state, v.defaultLastRowTile);
}

export const treecapStampA: PerCellHandler = (state) => stampTreecap(state, VARIANT_A);
export const treecapStampB: PerCellHandler = (state) => stampTreecap(state, VARIANT_B);

// ─────────────────────────────────────────────────────────────────────
// CODE_init_treecap_3wide ($12:9D5C, Bank12.asm:4530).
//
//   REP #$20
//   LDA #$0003 ; STA $2A                ; col extent = 3
//   LDA $1B ; PHA ; AND #$F0F0 ; STA $00
//   PLA ; AND #$0F0F ; DEC ; AND #$0F0F ; ORA $00 ; STA $1B
//                                        ; sub-X nibble -= 1 (origin
//                                        ;   shift, screen nibbles kept)
//   LDA $15 ; AND #$0002 ; TAY           ; Y = 0 ($91) or 2 ($92)
//   LDX #(CODE_treecap_stamp_a-1)>>16              ; bank ($13) — handler bank
//   LDA DATA_treecap_variant_handlers,y                     ; pointer to variant handler
//   JMP CODE_walker_setup_trampoline
//
// DATA_treecap_variant_handlers (Bank12.asm:4525):
//   dw CODE_treecap_stamp_a-1, CODE_treecap_stamp_b-1
//
// `$15` bit 1 selects: $91 → variant A, $92 → variant B.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x91, 0x92 share this handler.
const initTreecap3wide: InitHandler = (state) => {
  // Force col extent = 3.
  state.zp2A = 0x0003;

  // Sub-X nibble -= 1 (16-bit composite $1B:$1C; only sub nibbles move).
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const screenKeep = word1B & 0xf0f0;
  const subDec = ((word1B & 0x0f0f) - 1) & 0x0f0f;
  const newWord = (screenKeep | subDec) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // $15 bit 1 picks variant. Bit 1 == 0 → A ($91); bit 1 == 1 → B ($92).
  const handler = (state.zp15 & 0x02) === 0 ? treecapStampA : treecapStampB;

  walkerSetupTrampoline(state, handler);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Both std IDs share the same init; the init branches
// internally on $15 bit 1 to pick the per-cell handler. Parent wires
// this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────

export function installTreecap3wideHandlers(): void {
  registerStdObjectHandler(0x91, initTreecap3wide);
  registerStdObjectHandler(0x92, initTreecap3wide);
}
