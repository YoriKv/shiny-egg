// Bank13 tunnel ceiling sloping up-right stamp handler ($5F / $60).
//
// Tunnel ceiling sloping up-right — $5F gradual, $60 medium; the two
// share one init and split on $15 bit 5 inside the stamp.
//
// Cart routines:
//   $12:993E  CODE_init_tunnel_ceiling_slope_right   — shared init for $5F + $60
//   $13:BEF5  CODE_stamp_tunnel_ceiling_slope_right  — per-cell stamp
//
// Description (init): computes $2E (row count) from $15 bits 0-3 halved
// if set; clamps against $2E; increments $2A by 2 and $2E by 1; nudges
// $1B down by 1 in the sub-X nibble (with borrow into screen-X); clears
// $A1.
//
// Description (stamp): a multi-path decision tree gated on column
// position ($28 vs $2A) and the orientation byte $15's bit 5 (latched
// into $02 = ($15 & $20) >> 1, yielding $00 or $10). Bit 5 distinguishes
// the two variants — $5F ($02=0) is the "left half" slope, $60 ($02=$10)
// is the "right half" slope (so each contributes a different bias to
// the table lookups DATA_tunnel_ceiling_slope_right_default_tiles / DATA_wide_floor_block_aux_pointers).
//
// Per-cell paths:
//   $28 == 0           → first_col: call CODE_wide_floor_left_neighbour_fix
//                        when not on the final row (no $A1 mutation; no
//                        stamp unless the neighbour-fix matches).
//   $28+1 == $2A       → right_col: call CODE_wide_floor_above_neighbour_fix
//                        when not on the final row; on final row, perform
//                        the "$12 == slot_1C04 → restamp slot_1C1E" seam-
//                        fix (only when $A1 was previously 0). For $60
//                        ($02!=0) on row 0, $2E is pre-decremented (the
//                        right column is one row shorter).
//   otherwise (interior): a tangle of pre-decrements and load-A maneuvers
//                        feeding the shared BF8D "compute Y, table-lookup,
//                        stamp" sequence — or BFDE which falls back to
//                        CODE_floor_random_8way_pick (a PRNG-picked
//                        $79xx-family floor tile from DATA_floor_random_grass_8way_pool).
//
// Tables:
//   DATA_tunnel_ceiling_slope_right_default_tiles (16 words) — default ground tileset. Each entry is a
//   WRAM template-slot address; deref via state.templateAt() yields
//   the actual Map16 ID. Empty ($0000) entries skip the stamp.
//
//   DATA_wide_floor_block_aux_pointers (16 words) — BG1Tileset = $08 variant (Castle 1). Mixed
//   contents: some WRAM slots, some ROM-resident literal Map16 IDs at
//   DATA_wide_floor_tile_a/_037/_039. Tracked specs use the default tileset so this
//   path isn't trace-verified — we honour the structure but document the
//   skip below if a Castle 1 level surfaces a divergence.
//
// Acknowledged simplifications:
//   - The seam-fix "stamp slot_1C1E when $12 == slot_1C04" branch is a
//     no-op in the trace specs (their $12 always reads as 0 because no
//     prior object stamped a slot_1C04-family tile underneath). Logic
//     ported faithfully; not exercised by the traces.
//   - CODE_wide_floor_left_neighbour_fix / _above_neighbour_fix are
//     stamp-only when the underlying cell's page matches
//     `TileTpl_WideFloorPage_Anchor` ($1BE0). In a fresh-decode context
//     the underlying cell is $0000, so these reduce to "no stamp". We
//     implement that minimal version (template page check + early-out)
//     and skip the DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap remap tables — they would
//     only fire when stamping over a pre-existing wide-floor anchor,
//     which the trace specs do not exercise. Refining later (overlay
//     scenarios) needs the 46-entry remap tables ported.
//   - BG1Tileset == 8 (Castle 1) path is implemented but untested by
//     the trace specs; DATA_wide_floor_block_aux_pointers's ROM-resident DATA_wide_floor_tile_a/_037/_039
//     are detected via a small sentinel set so we stamp the literal
//     Map16 word ($5703 / $5903 / $5D04) instead of dereferencing a
//     template slot.
//
// GoldenEgg divergence note: GE's Obj5FInit has `--Level._x` (raw cell
// decrement, no F0F0/0F0F nibble preservation) where the cart actually
// does the nibble-preserving DEC of the sub-X. For most placements they
// produce the same byte; for sub-X==0 (page-boundary), the cart borrows
// into the screen-X nibble correctly while GE's plain decrement would
// underflow the byte. Our port mirrors the cart.
// GE also lacks an Obj60Init entry — both $5F and $60 share the cart's
// `CODE_init_tunnel_ceiling_slope_right` per the std-init pointer table, with the
// bit-5 distinction made downstream in the stamp via $02. Confirmed
// against `DATA_standard_object_init_ptrs` xrefs.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import {
  stampCell, floorRandom8wayPick,
  wideFloorNeighbourFix, WIDE_FLOOR_REMAP_LEFT, WIDE_FLOOR_REMAP_RIGHT,
} from './_shared.ts';

// ───────────────────────────────────────────────────────────────────────
// CODE_wide_floor_left_neighbour_fix and
// CODE_wide_floor_above_neighbour_fix.
//
// When $12's page byte == TileTpl_WideFloorPage_Anchor (the current cell
// already holds a WideFloorPage tile — e.g. a $14 tunnel stamped a $1D-page
// tile under this slope), remap it in place via DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap.
// This IS reached in real levels at the seam between a wide slope and an
// abutting wide-floor object; the shared port lives in _shared.ts.
// ───────────────────────────────────────────────────────────────────────

function wideFloorLeftNeighbourFix(state: DecodeState): void {
  wideFloorNeighbourFix(state, WIDE_FLOOR_REMAP_LEFT);
}

function wideFloorAboveNeighbourFix(state: DecodeState): void {
  wideFloorNeighbourFix(state, WIDE_FLOOR_REMAP_RIGHT);
}

// ───────────────────────────────────────────────────────────────────────
// DATA_tunnel_ceiling_slope_right_default_tiles + DATA_wide_floor_block_aux_pointers — Y-indexed pointer tables consumed by
// CODE_stamp_tunnel_ceiling_slope_right's BF8D path. Each entry is the SOURCE
// of an `LDA $0000,y` that resolves to either:
//   - a WRAM template-slot address (deref via state.templateAt), or
//   - for DATA_wide_floor_block_aux_pointers: a ROM-resident literal-Map16 pointer
//     (DATA_wide_floor_tile_a=$5703, DATA_wide_floor_tile_b=$5903, DATA_wide_floor_tile_c=$5D04).
//
// We encode each as a discriminated union: `{kind: 'slot', addr}` vs
// `{kind: 'literal', value}` so the dispatcher can deref correctly.
// ───────────────────────────────────────────────────────────────────────

type SlopeTableEntry =
  | { readonly kind: 'slot';    readonly addr: number }
  | { readonly kind: 'literal'; readonly value: number }
  | { readonly kind: 'skip' };

const SLOT = (addr: number): SlopeTableEntry => ({ kind: 'slot', addr });
const LIT  = (value: number): SlopeTableEntry => ({ kind: 'literal', value });
const SKIP: SlopeTableEntry = { kind: 'skip' };

// DATA_tunnel_ceiling_slope_right_default_tiles — 16 entries (default tileset / BG1Tileset != 8). All WRAM
// template-slot addresses, with $0000 skip-sentinels at positions 3/6/7
// and (in the second row) 11/15.
const DATA_tunnel_ceiling_slope_right_default_tiles: readonly SlopeTableEntry[] = [
  SLOT(0x001C1E), SLOT(0x001D6C), SLOT(0x001CB2), SKIP,
  SLOT(0x001D72), SLOT(0x001CB4), SKIP,            SKIP,
  SLOT(0x001C1E), SLOT(0x001D82), SLOT(0x001CB2), SKIP,
  SLOT(0x001C1E), SLOT(0x001D82), SLOT(0x001CB4), SKIP,
];

// DATA_wide_floor_block_aux_pointers — 16 entries (BG1Tileset == 8, Castle 1). Mix of slots,
// literal-Map16 pointers, and skip sentinels.
const DATA_wide_floor_block_aux_pointers: readonly SlopeTableEntry[] = [
  SKIP,             LIT(0x5703),    SLOT(0x001CB2), SKIP,
  LIT(0x5903),      SLOT(0x001CB4), SKIP,           SKIP,
  SKIP,             LIT(0x5D04),    SLOT(0x001CB2), SKIP,
  SKIP,             LIT(0x5D04),    SLOT(0x001CB4), SKIP,
];

function resolveTableEntry(state: DecodeState, e: SlopeTableEntry): number | null {
  if (e.kind === 'skip') return null;
  if (e.kind === 'literal') return e.value;
  return state.templateAt(e.addr);
}

// ───────────────────────────────────────────────────────────────────────
// CODE_stamp_tunnel_ceiling_slope_right
//
// REP #$30; LDX $1D; A = ($15 & $20) >> 1 → $02 (0 for $5F, $10 for $60).
// Then dispatch on $28 (first col / right col / interior).
// ───────────────────────────────────────────────────────────────────────

const stampTunnelCeilingSlopeRight: PerCellHandler = (state) => {
  const zp02 = (state.zp15 & 0x0020) >>> 1;
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const colExtent = state.zp2A & 0xff;
  let rowExtent = state.zp2E & 0xff;
  const cur = state.zp12 & 0xffff;

  // ───── first_col path ($28 == 0) ─────
  if (col === 0) {
    // $2C+1 < $2E (BCS skip when >= → BCC continues to call fix)
    if (((row + 1) & 0xff) < rowExtent) {
      wideFloorLeftNeighbourFix(state);
    }
    return;
  }

  // ───── right_col path ($28+1 == $2A) ─────
  if (((col + 1) & 0xff) === colExtent) {
    // For $60 ($02 != 0) on row 0, $2E is pre-decremented.
    if (zp02 !== 0 && row === 0) {
      rowExtent = (rowExtent - 1) & 0xff;
      state.zp2E = rowExtent;
    }
    // BF14: $2C+1 == $2E → right_col_seam; else above-fix + clear $A1.
    if (((row + 1) & 0xff) === rowExtent) {
      // right_col_seam: only restamp if $A1 was 0 AND $12 matches slot_1C04.
      if ((state.zpA1 & 0xffff) === 0 && cur === state.templateAt(0x001C04)) {
        stampCell(state, state.templateAt(0x001C1E));
      }
      return;
    }
    wideFloorAboveNeighbourFix(state);
    state.zpA1 = 0;
    return;
  }

  // ───── interior path ─────
  // BF8D-source value (the A that feeds CLC; SBC $2C; ASL → row_diff_doubled).
  let aForBF8D: number | null = null;

  // Top of interior: for $60 ($02 != 0) and row 0 and $28 != 1, pre-DEC
  // $2E. If new $2E becomes 2 exactly, hardcode A = 2 and jump to BF8D.
  // Otherwise fall through to BF62.
  if (zp02 !== 0 && row === 0 && col !== 1) {
    rowExtent = (rowExtent - 1) & 0xff;
    state.zp2E = rowExtent;
    if (rowExtent === 2) {
      aForBF8D = 2;
    }
  }

  // BF62: if $28+2 == $2A and $2C == 0 and $2E < 3 → DEC $2A; A = $2A if
  // $2A==2 else 1; jump to BF8D. Else fall through to BF83.
  if (aForBF8D === null) {
    const colPlus2 = (col + 2) & 0xff;
    if (colPlus2 === colExtent && row === 0 && rowExtent < 3) {
      const newColExtent = (colExtent - 1) & 0xff;
      state.zp2A = newColExtent;
      aForBF8D = newColExtent === 2 ? newColExtent : 1;
    }
  }

  // BF83: if $2C+2 < $2E → BFDE (PRNG-pick + maybe DEC $2E). Else A = $2E
  // and fall through to BF8D.
  if (aForBF8D === null) {
    if (((row + 2) & 0xff) < rowExtent) {
      // BFDE: floor_random_8way_pick + ($02 == 0 AND $2C == 0 AND $28 even →
      // DEC $2E).
      floorRandom8wayPick(state);
      if (zp02 === 0 && row === 0 && (col & 1) === 0) {
        state.zp2E = (state.zp2E - 1) & 0xffff;
      }
      return;
    }
    aForBF8D = rowExtent;
  }

  // BF8D: row_diff = A - $2C - 1 (CLC then SBC = subtract operand + carry-borrow).
  // If row_diff < 0 (BMI), exit without stamping.
  const rowDiff = aForBF8D - row - 1;
  if (rowDiff < 0) return;

  // $00 = (row_diff << 1) | ((($28 ^ 1) & 1) << 3) | $02
  const rowBits = (rowDiff << 1) & 0xff;
  const colBits = ((col & 1) ^ 1) << 3;
  const yIdx = rowBits | colBits | zp02;

  // Table dispatch: BG1Tileset == 8 → DATA_wide_floor_block_aux_pointers, else DATA_tunnel_ceiling_slope_right_default_tiles.
  const bg1TilesetByte = state.header[1] ?? 0;
  // !RAM_YI_Level_LevelHeaderBG1TilesetLo is the lo byte; CMP #$0008 against
  // the full word — high byte is the BG1Palette nibble, so this matches when
  // tileset == 8 AND palette == 0 (or the full 16-bit literal is $0008).
  // The header field 1 in our state is already the unpacked tileset byte.
  // Match the cart's #$0008 literal compare.
  const useC015 = (bg1TilesetByte & 0xff) === 0x08;
  const table = useC015 ? DATA_wide_floor_block_aux_pointers : DATA_tunnel_ceiling_slope_right_default_tiles;
  // The table is word-indexed in the asm but Y is a byte-offset stride of
  // 2 (the `ASL` baked into rowDiff << 1 + colBits << 3 already gives a
  // byte offset). Convert to a word index by >>1.
  const entry = table[(yIdx >>> 1) & 0x0f];
  if (!entry) return;
  const resolved = resolveTableEntry(state, entry);
  if (resolved === null) return;

  // BFB9: if resolved == slot_1C1E AND $12 != slot_1C18 AND $12 != slot_1C04 → skip.
  // Else fall through to BFCE → stamp resolved + set $A1 = ($00 & 8).
  const slot1C1E = state.templateAt(0x001C1E);
  if (resolved === slot1C1E) {
    const slot1C18 = state.templateAt(0x001C18);
    const slot1C04 = state.templateAt(0x001C04);
    if (cur !== slot1C18 && cur !== slot1C04) return;
  }

  stampCell(state, resolved);
  state.zpA1 = yIdx & 0x0008;
};

// ───────────────────────────────────────────────────────────────────────
// CODE_init_tunnel_ceiling_slope_right
//
// Init handler shared by std-object $5F and $60. Wires the stamp,
// computes per-orientation row extent, and adjusts the position.
// ───────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x5F, 0x60 share this handler.
function initTunnelCeilingSlopeRight(state: DecodeState): void {
  // The trampoline below sets $17 = 0 and wires the same handler for all
  // 3 walker slots. We do the position/extent math first.

  // $00 = $2A. If ($15 & $0F) != 0, LSR $00 (halve).
  let scratch = state.zp2A & 0xff;
  if ((state.zp15 & 0x000f) !== 0) {
    scratch = (scratch >>> 1) & 0xff;
  }

  // If signed $00 >= signed $2E (BMI skip when negative result), $2E = $00.
  // Asm: CMP $2E; BMI skip; STA $2E. CMP A,$2E sets N from A-$2E. BMI on N=1
  // means A < $2E (signed), so the STA $2E runs when A >= $2E (signed).
  const sScratch = (scratch & 0x80) ? scratch - 0x100 : scratch;
  const sRowExt  = (state.zp2E & 0x80) ? (state.zp2E & 0xff) - 0x100 : (state.zp2E & 0xff);
  if (sScratch >= sRowExt) {
    state.zp2E = scratch;
  }

  // INC $2A twice, INC $2E once.
  state.zp2A = (state.zp2A + 2) & 0xff;
  state.zp2E = (state.zp2E + 1) & 0xffff;

  // Decrement $1B's sub-X nibble (preserving screen nibbles). Cart reads
  // $1B as a 16-bit word covering $1B:$1C.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const screenKeep = word1B & 0xf0f0;
  const subKeep = word1B & 0x0f0f;
  const subDec = (subKeep - 1) & 0xffff;
  const newWord = (screenKeep | (subDec & 0x0f0f)) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // Clear $A1 (per-object variant latch).
  state.zpA1 = 0;

  // Trampoline-style walker setup ($17 = 0; single handler for all slots).
  walkerSetupTrampoline(state, stampTunnelCeilingSlopeRight);
}

// ───────────────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────────────

export function installTunnelCeilingSlopeRightHandlers(): void {
  // Per cart `DATA_standard_object_init_ptrs`, both $5F and $60 dispatch
  // to CODE_init_tunnel_ceiling_slope_right. The $5F/$60 distinction is read from
  // $15 bit 5 inside the stamp ($02 = ($15 & $20) >> 1).
  registerStdObjectHandler(0x5F, initTunnelCeilingSlopeRight);
  registerStdObjectHandler(0x60, initTunnelCeilingSlopeRight);
}
