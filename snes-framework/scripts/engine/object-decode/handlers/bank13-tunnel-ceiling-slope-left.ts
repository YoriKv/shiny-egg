// Bank13 tunnel ceiling sloping up-left ($61 / $62).
//
// Tunnel ceiling sloping up-left — $61 gradual, $62 medium; the two
// share one init and split on $15 bit 1 inside the stamp.
//
// Cart routines:
//   $12:998F  CODE_init_tunnel_ceiling_slope_left   — shared init for $61 + $62
//   $13:C03B  CODE_tunnel_ceiling_slope_left         — per-cell stamp
//   $13:C175  CODE_wide_floor_left_neighbour_fix    — first-col seam helper
//   $13:C1F0  CODE_wide_floor_above_neighbour_fix   — right-col seam helper
//   $13:C15F  CODE_floor_random_8way_pick           — interior PRNG fill
//
// Tables:
//   DATA_wide_floor_edge_tiles_normal  DATA_wide_floor_edge_tiles_normal   (16 words; tileset != 8)
//   DATA_wide_floor_edge_tiles_tileset8  DATA_wide_floor_edge_tiles_tileset8 (16 words; tileset == 8)
//   DATA_wide_floor_tile8_a/_15B/_15D — pointer-tiles ($5303/$5503/$5B05) referenced by
//                           the tileset-8 table.
//   DATA_floor_left_neighbour_remap  DATA_floor_left_neighbour_remap     (46-entry, overlay-only)
//   DATA_floor_above_neighbour_remap  DATA_floor_above_neighbour_remap    (46-entry, overlay-only)
//
// The init differs from the up-right init ($5F/$60) in three ways:
//   - row-extent reduction is keyed on `$15 & 2` (bit 1) NOT bit 5;
//   - the "$2A | $2E == 1" early-out (degenerate 1x1) only does `$2A += 2`
//     and skips the row-extent shave entirely;
//   - $2E is post-clamped to >= 1 (was unconditional in the up-right slope).
//
// The stamp differs from the up-right slope in shape:
//   - $02 = ($15 & 2) << 3 (bit 1 -> bit 4) — same range (0 / $10), different
//     orientation-bit source.
//   - First-col path: skip neighbour-fix if $2E == 1 OR $2C+1 == $2E (i.e.
//     no fix on a single-row object or on the last row).
//   - Right-col path: on row 0 unconditionally INC $2E (no $02-gate); then
//     dispatch among "$2C+1==$2E exit", "$2C+2==$2E seam-fix-conditional",
//     and "default above-fix + STZ $A1".
//   - Interior path: row-0 + (even $28 OR $02 set) → INC $2E; then if
//     $2C+2 < $2E → PRNG-pick (the BIG difference vs the up-right slope),
//     else run the Y-indexed edge-tile lookup with the slot_1C1C seam-check.
//
// Static-decode caveats:
//   - The neighbour-fix routines short-circuit when $12's page byte doesn't
//     match the WideFloorPage_Anchor template ($1BE0). In a fresh decode
//     buffer (no prior stamp) the underlying cell is $0000, so both fixes
//     reduce to no-ops. Trace specs confirm this — both calls in the $62
//     spec stamp nothing. We implement the page-check early-out and skip
//     the 46-entry remap tables (DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap) — they would
//     only fire when stamping over a pre-existing wide-floor anchor, which
//     the static editor's per-level decode does not exercise.
//   - Tileset-8 (Castle 1) path encodes the literal-pointer entries
//     ($5303/$5503/$5B05) as `kind: 'literal'` table entries — same
//     discriminated-union pattern as bank13-tunnel-ceiling-slope-right.ts.
//   - The seam-check restamp branches ("$12 == slot_1C04 stamp anyway"
//     etc.) are implemented faithfully but not exercised by trace specs
//     since $12 is always $0000 on fresh-decode cells.

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
// When the current cell ($12) already holds a WideFloorPage tile, remap it in
// place via DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap — the seam-blend between this extender
// and an abutting wide-floor object. Reached in real levels (a prior version
// stubbed these as no-ops on the false "always 0 on fresh decode" assumption).
// Shared port in _shared.ts.
// ───────────────────────────────────────────────────────────────────────

function wideFloorLeftNeighbourFix(state: DecodeState): void {
  wideFloorNeighbourFix(state, WIDE_FLOOR_REMAP_LEFT);
}

function wideFloorAboveNeighbourFix(state: DecodeState): void {
  wideFloorNeighbourFix(state, WIDE_FLOOR_REMAP_RIGHT);
}

// ───────────────────────────────────────────────────────────────────────
// DATA_wide_floor_edge_tiles_normal and
// DATA_wide_floor_edge_tiles_tileset8.
//
// Each is a 16-entry word table. Most entries are WRAM template-slot
// pointers (deref via templateAt). The tileset-8 table has $0000 gaps
// (BEQ early-out before the deref) and three literal-pointer entries
// pointing to DATA_wide_floor_tile8_a/_15B/_15D — single-word ROM blobs holding the
// raw Map16 IDs $5303 / $5503 / $5B05. We encode literal entries as
// `kind: 'literal'` so the dispatcher knows to skip the templateAt deref.
// ───────────────────────────────────────────────────────────────────────

type EdgeTableEntry =
  | { readonly kind: 'slot';    readonly addr: number }
  | { readonly kind: 'literal'; readonly value: number }
  | { readonly kind: 'skip' };

const SLOT = (addr: number): EdgeTableEntry => ({ kind: 'slot', addr });
const LIT  = (value: number): EdgeTableEntry => ({ kind: 'literal', value });
const SKIP: EdgeTableEntry = { kind: 'skip' };

// DATA_wide_floor_edge_tiles_normal (BG1Tileset != 8) — 16 entries.
// Note slot_1C1C ($1C1C) appears 6 times as a "seam-check sentinel" —
// when the resolved pointer equals this slot, the stamp takes the
// $12-vs-{slot_1C04, slot_1BFA, slot_1C02} branching path.
const DATA_wide_floor_edge_tiles_normal: readonly EdgeTableEntry[] = [
  SLOT(0x001C1C), SLOT(0x001D60), SLOT(0x001CB2), SKIP,
  SLOT(0x001C1C), SLOT(0x001C1C), SLOT(0x001D66), SLOT(0x001CB4),
  SLOT(0x001C1C), SLOT(0x001C1C), SLOT(0x001D78), SLOT(0x001CB2),
  SLOT(0x001C1C), SLOT(0x001C1C), SLOT(0x001D78), SLOT(0x001CB4),
];

// DATA_wide_floor_edge_tiles_tileset8 (BG1Tileset == 8, Castle 1) —
// 16 entries. Skip-zero entries cause an early exit; literal entries
// point to single-word ROM blobs.
const DATA_wide_floor_edge_tiles_tileset8: readonly EdgeTableEntry[] = [
  SKIP,           LIT(0x5303),    SLOT(0x001CB2), SKIP,
  SKIP,           SKIP,           LIT(0x5503),    SLOT(0x001CB4),
  SKIP,           SKIP,           LIT(0x5B05),    SLOT(0x001CB2),
  SKIP,           SKIP,           LIT(0x5B05),    SLOT(0x001CB4),
];

/** Returns null when the entry is `skip` OR when it's a slot whose
 *  templateAt deref yields 0 (matches the cart's `BEQ exit` on a $0000
 *  read from the table or from the dereferenced WRAM slot). */
function resolveEdgeEntry(state: DecodeState, e: EdgeTableEntry): number | null {
  if (e.kind === 'skip') return null;
  if (e.kind === 'literal') return e.value & 0xffff;
  const v = state.templateAt(e.addr);
  return v === 0 ? null : v;
}

// ───────────────────────────────────────────────────────────────────────
// CODE_tunnel_ceiling_slope_left
//
// Per-cell stamp. Branches on column position ($28 vs $2A) and row
// position ($2C vs $2E) into 6 cases. `$02` = ($15 & 2) << 3 selects
// the $61 (0) / $62 ($10) variant — feeds the Y-index OR into the edge
// table lookup so $62 reads the upper-row slice of the same 16-entry
// table.
// ───────────────────────────────────────────────────────────────────────

const tunnelCeilingSlopeLeftStamp: PerCellHandler = (state) => {
  // $02 = ($15 & 2) << 3 → 0 for $61, $10 for $62.
  const zp02 = (state.zp15 & 0x0002) << 3;
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  const row = state.zp2C & 0xff;

  // ───── first_col path ($28 == 0) ─────
  if (col === 0) {
    const rowExtent = state.zp2E & 0xff;
    // Skip neighbour-fix if single-row ($2E == 1) OR at last row ($2C+1 == $2E).
    if (rowExtent === 1) return;
    if (((row + 1) & 0xff) === rowExtent) return;
    wideFloorLeftNeighbourFix(state);
    return;
  }

  // ───── right_col path ($28+1 == $2A) ─────
  if (((col + 1) & 0xff) === colExtent) {
    // Row 0 of the right column: unconditionally INC $2E (no $02 gate).
    if (row === 0) {
      state.zp2E = (state.zp2E + 1) & 0xffff;
    }
    const rowExtent = state.zp2E & 0xff;

    // $2C+1 == $2E → past-end exit (no fix).
    if (((row + 1) & 0xff) === rowExtent) return;

    // $2C+2 == $2E → seam-fix-conditional: only restamp slot_1C1E if
    // $A1 == 0 AND $12 == slot_1C04 (else exit without stamping).
    if (((row + 2) & 0xff) === rowExtent) {
      if (state.zpA1 !== 0) return;
      const slot1C04 = state.templateAt(0x001C04);
      if ((state.zp12 & 0xffff) !== slot1C04) return;
      stampCell(state, state.templateAt(0x001C1E));
      return;
    }

    // Default: above-neighbour-fix + clear $A1.
    wideFloorAboveNeighbourFix(state);
    state.zpA1 = 0;
    return;
  }

  // ───── interior path ─────
  // Row-0 $2E bump: gated by ($02 set) OR ($28 even). Only on $2C == 0.
  if (row === 0) {
    const colEven = (col & 1) === 0;
    if (zp02 !== 0 || colEven) {
      state.zp2E = (state.zp2E + 1) & 0xffff;
    }
  }
  const rowExtent = state.zp2E & 0xff;

  // BCC ($2C+2 < $2E) → PRNG-pick. Else fall through to the edge-table
  // dispatch.
  if (((row + 2) & 0xff) < rowExtent) {
    floorRandom8wayPick(state);
    return;
  }

  // Y = (($2E - $2C) << 1) | ((($28 ^ 1) & 1) << 3) | $02
  // Stops if $2E - $2C is negative (BMI exit).
  const rowDiff = (rowExtent - row) & 0xff;
  if (rowDiff & 0x80) return; // BMI: negative result
  const rowBits = (rowDiff << 1) & 0xff;
  const colBits = ((col & 1) ^ 1) << 3;
  const yIdx = rowBits | colBits | zp02;

  // BG1Tileset == 8 selects the alt table. Header field 1 is the
  // unpacked BG1Tileset byte (the cart compares the full word against
  // #$0008, where the high byte is BG1Palette = 0 for the match).
  const bg1Tileset = state.header[1] ?? 0;
  const table = (bg1Tileset & 0xff) === 0x08
    ? DATA_wide_floor_edge_tiles_tileset8
    : DATA_wide_floor_edge_tiles_normal;

  const entry = table[(yIdx >>> 1) & 0x0f];
  if (!entry) return;
  const resolved = resolveEdgeEntry(state, entry);
  if (resolved === null) return;

  // slot_1C1C seam-check: if the resolved value equals templateAt(0x1C1C),
  // probe $12 against {slot_1C04, slot_1BFA, slot_1C02}:
  //   $12 == slot_1C04 → stamp resolved anyway (the "BEQ CODE_13C0F8")
  //   $12 == slot_1BFA → stamp slot_1C2E instead
  //   $12 == slot_1C02 → stamp slot_1C30 instead
  //   otherwise         → skip stamp
  // For non-sentinel entries, just stamp resolved.
  const slot1C1C = state.templateAt(0x001C1C);
  if (resolved === slot1C1C) {
    const cur = state.zp12 & 0xffff;
    const slot1C04 = state.templateAt(0x001C04);
    if (cur === slot1C04) {
      stampCell(state, resolved);
      return;
    }
    const slot1BFA = state.templateAt(0x001BFA);
    if (cur === slot1BFA) {
      stampCell(state, state.templateAt(0x001C2E));
      return;
    }
    const slot1C02 = state.templateAt(0x001C02);
    if (cur === slot1C02) {
      stampCell(state, state.templateAt(0x001C30));
      return;
    }
    return; // skip stamp
  }

  stampCell(state, resolved);
};

// ───────────────────────────────────────────────────────────────────────
// CODE_init_tunnel_ceiling_slope_left
//
// Init handler shared by std-object $61 and $62. Wires the stamp on all
// 3 walker slots, computes per-orientation extents, nudges the position.
// ───────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x61, 0x62 share this handler.
function initTunnelCeilingSlopeLeft(state: DecodeState): void {
  const variantBit = state.zp15 & 0x0002; // 0 for $61, 2 for $62

  let skipRowAdjust = false;
  if (variantBit !== 0) {
    // $62 path: if $2A | $2E == 1 (degenerate 1x1 object), only do
    // `$2A += 2` and skip the row-extent reduction entirely.
    if (((state.zp2A & 0xff) | (state.zp2E & 0xff)) === 1) {
      state.zp2A = (state.zp2A + 2) & 0xff;
      skipRowAdjust = true;
    }
  }

  if (!skipRowAdjust) {
    // Normal path: $2A += 2.
    state.zp2A = (state.zp2A + 2) & 0xff;
    // If $2E >= 2, do the row reduction.
    if ((state.zp2E & 0xff) >= 2) {
      state.zp2E = (state.zp2E + 2) & 0xffff;
      // $00 = $2A; if variant bit clear, halve $00.
      let scratch = state.zp2A & 0xff;
      if (variantBit === 0) {
        scratch = (scratch >>> 1) & 0xff;
      }
      // $2E -= $00. The trailing `BNE / STZ` is redundant (already-zero
      // result writes itself), so we omit it.
      state.zp2E = (state.zp2E - scratch) & 0xffff;
    }
  }

  // Decrement $1B sub-X (nibble-preserving DEC on the 16-bit word at
  // $1B:$1C). Mirrors the up-right slope's DEC.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const screenKeep = word1B & 0xf0f0;
  const subKeep = word1B & 0x0f0f;
  const subDec = (subKeep - 1) & 0xffff;
  const newWord = (screenKeep | (subDec & 0x0f0f)) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // Clear $A1 (the right-col-seam latch).
  state.zpA1 = 0;

  // Clamp $2E to >= 1 (signed). $2E == 0 OR $2E negative → set to 1.
  const rowExtSigned = (state.zp2E & 0x80) ? (state.zp2E & 0xff) - 0x100 : (state.zp2E & 0xff);
  if (rowExtSigned <= 0) {
    state.zp2E = 1;
  }

  // Trampoline-style walker setup: all 3 slots get the same handler,
  // $17 = 0, $19 = $7FFF. Matches the init's `STZ $17 / STA #$7FFF $19`
  // + identical writes to $22/$1F/$25 (handler ptr) and $24/$21/$27 (bank).
  walkerSetupTrampoline(state, tunnelCeilingSlopeLeftStamp);
}

// ───────────────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────────────

export function installTunnelCeilingSlopeLeftHandlers(): void {
  // Per cart `DATA_standard_object_init_ptrs`, both $61 and $62 dispatch
  // to CODE_init_tunnel_ceiling_slope_left. The variant distinction is
  // read from `$15 & 2`: $61 → bit clear → gradual sub-mode, $62 → bit set
  // → medium sub-mode (different row-extent reduction).
  registerStdObjectHandler(0x61, initTunnelCeilingSlopeLeft);
  registerStdObjectHandler(0x62, initTunnelCeilingSlopeLeft);
}
