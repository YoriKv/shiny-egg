// Standard object $34 — JungleCattail.
//
// Cart entries:
//   CODE_init_jungle_cattail   @ $12:95E0 (yi/Banks/Bank12.asm:3418)
//   CODE_jungle_cattail_random @ $13:998A (yi/Banks/Bank13.asm:3498)
//
// Jungle cattail (swampy reed-plant decoration; random variant): a wide
// horizontal band of reed/leaf tiles (2 rows tall after the init's row-
// extent bump). The init handler is a thin wrapper: `INC $2E` (grow
// vertical extent by one), zero $A1 (so the first row's PRNG roll starts
// from a fresh slot — see below), then JMP into the walker trampoline
// pointing at `CODE_jungle_cattail_random`.
//
// Per-cell stamp handler is a *decorator* — it carries its own PRNG-rolled
// state across the two rows of each column and, on row > 0, may shift
// the chosen tile by +$0010 if the existing buffer cell is a thorn-
// cluster sentinel ($9608..$960B). Algorithm (REP #$30 throughout):
//
//   if $2C == 0:                  ; first row of this column
//     $A1 = prng() & $001E         ; even byte index 0..30 → one of 16 sub-tables
//   y = $2C * 2                    ; word index within the chosen sub-table
//   $00 = DATA_13996A[$A1 / 2]     ; load sub-table pointer (16-entry table of pointers)
//   tile = *( $00 + y )            ; read this row's tile from the sub-table
//   if tile == 0: return           ; "no-stamp" hole (some sub-tables have row-0 == 0)
//   if $2C != 0:                   ; row > 0: thorn-cluster overlay check
//     ldb = buffer[$1D]
//     if ldb in {$9608, $9609, $960A, $960B}:
//       tile += $0010              ; switch to the thorned variant
//   buffer[$1D] = tile
//
// Critically the per-cell handler depends on `$A1` *not* being clobbered
// between row 0 and row 1 of the same column — the walker visits row 0,
// then row 1, then advances to the next column's row 0 (which re-rolls).
//
// Sub-table layout (Bank13.asm:3436-3486, DATA_13992A..DATA_139966 and
// the index table DATA_13996A = JNGL_WRTKS_DAT). 16 sub-tables of 2 words
// each — row 0 entry and row 1 entry. The last four sub-tables have
// row-0 == $0000 (no-stamp on the top row) to cut the visible cattail
// shorter in those variants; see spec cells 8 and 12 where prng routed to
// those sub-tables and only row 1 stamped.
//
// asm primary; trace harness spec.md cross-checked (all 32 stamped cells
// match for both top and bottom rows, modulo the cart's HV-counter PRNG —
// we use the project's deterministic LFSR so cell-by-cell variant picks
// won't byte-match the cart-snapshot trace, but the table-walk and thorn-
// overlay logic match exactly).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell, readBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-variant sub-tables (Bank13.asm:3436-3482). Each is a 2-word
// array: entry [0] = row 0 tile, entry [1] = row 1 tile.
//
// 12 of the 16 sub-tables have a non-zero row-0 entry; the last four
// (DATA_13995A/_13995E/_139962/_139966) write `$0000` there to indicate
// "skip the row-0 stamp" — only the bottom row paints in those variants.
// ─────────────────────────────────────────────────────────────────────

const DATA_13992A = [0x9640, 0x964F] as const;
const DATA_13992E = [0x9641, 0x9650] as const;
const DATA_139932 = [0x9642, 0x9651] as const;
const DATA_139936 = [0x9643, 0x9652] as const;
const DATA_13993A = [0x9644, 0x9653] as const;
const DATA_13993E = [0x9645, 0x9654] as const;
const DATA_139942 = [0x9646, 0x9655] as const;
const DATA_139946 = [0x9647, 0x9656] as const;
const DATA_13994A = [0x9648, 0x9657] as const;
const DATA_13994E = [0x9649, 0x9658] as const;
const DATA_139952 = [0x964A, 0x9659] as const;
const DATA_139956 = [0x964B, 0x965A] as const;
const DATA_13995A = [0x0000, 0x965B] as const;
const DATA_13995E = [0x0000, 0x965C] as const;
const DATA_139962 = [0x0000, 0x965D] as const;
const DATA_139966 = [0x0000, 0x965E] as const;

// DATA_13996A (= JNGL_WRTKS_DAT, Bank13.asm:3484). 16 sub-table pointers;
// indexed by `$A1 / 2` (the cart's `LDA DATA_13996A,x` uses 16-bit X with
// $A1 ∈ {0, 2, 4, ..., 30} as a *byte* offset into a word table).
const DATA_13996A_VARIANT_TABLES = [
  DATA_13992A, DATA_13992E, DATA_139932, DATA_139936,
  DATA_13993A, DATA_13993E, DATA_139942, DATA_139946,
  DATA_13994A, DATA_13994E, DATA_139952, DATA_139956,
  DATA_13995A, DATA_13995E, DATA_139962, DATA_139966,
] as const;

// Thorn-cluster sentinel range (Bank13.asm:3519-3526). If the existing
// buffer cell at $1D matches one of these on a row > 0 stamp, the chosen
// tile is bumped by +$0010 to pick the "thorned" variant in the Map16 set.
const THORN_CLUSTER_LO = 0x9608;
const THORN_CLUSTER_HI = 0x960B; // inclusive
const THORN_OFFSET     = 0x0010;

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_cattail_random ($13:998A, Bank13.asm:3498) — per-cell.
//
// PRNG roll happens once per column (gated on `$2C == 0`); the chosen
// sub-table persists to the row-1 cell via $A1. Row-0 zero entries skip
// stamping entirely. Row-1 cells consult the previously-stamped buffer
// for a thorn-cluster overlay before writing.
// ─────────────────────────────────────────────────────────────────────
const jungleCattailRandomStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;

  // First row of a column: roll a fresh sub-table index into $A1.
  // `prng & $001E` → even byte offset 0..30 → one of 16 sub-tables.
  if (row === 0) {
    state.zpA1 = prngNext(state, RNG_SITE.jungleCattail) & 0x001E;
  }

  const subTableIdx = (state.zpA1 & 0x001E) >>> 1; // 0..15
  const subTable = DATA_13996A_VARIANT_TABLES[subTableIdx]!;

  // Row pick within the sub-table. Spec confirms row_extent is always 2
  // after the init's INC $2E, so `row` is 0 or 1 in practice.
  const tile = subTable[row]!;
  if (tile === 0x0000) return; // "no stamp" hole (row-0 of last 4 sub-tables).

  // Row 0 has no thorn-overlay check (cart `LDY $2C ; BEQ CODE_1399D0`).
  if (row === 0) {
    stampCell(state, tile);
    return;
  }

  // Row > 0: probe existing buffer cell for thorn cluster.
  const existing = readBuf16(state, state.zp1D & 0x7fff);
  const isThorn =
    existing === THORN_CLUSTER_LO ||
    existing === THORN_CLUSTER_LO + 1 ||
    existing === THORN_CLUSTER_LO + 2 ||
    existing === THORN_CLUSTER_HI;

  stampCell(state, (tile + (isThorn ? THORN_OFFSET : 0)) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_cattail ($12:95E0, Bank12.asm:3418).
//
//   REP.b #$20
//   INC.b $2E                              ; grow row extent by 1
//   STZ.b $A1                              ; clear cross-column PRNG slot
//   LDX.b #(CODE_jungle_cattail_random-$01)>>16
//   LDA.w #CODE_jungle_cattail_random-$01
//   JMP.w CODE_walker_setup_trampoline
//
// Spec confirms the init's only DP mutation: row_extent $0001 → $0002
// (the stream's `length-1` byte already includes the original row count;
// the `INC $2E` adds the cap row that turns it into a 2-row band). $A1
// is zeroed defensively — the per-cell handler reseeds it on the first
// cell anyway, but the cart explicitly clears it (perhaps to keep
// determinism if a degenerate $2A=0 object somehow skipped row 0).
// ─────────────────────────────────────────────────────────────────────
const initJungleCattail: InitHandler = (state) => {
  state.zp2E = (state.zp2E + 1) & 0xffff;
  state.zpA1 = 0;
  walkerSetupTrampoline(state, jungleCattailRandomStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installJungleCattailHandlers(): void {
  registerStdObjectHandler(0x34, initJungleCattail);
}
