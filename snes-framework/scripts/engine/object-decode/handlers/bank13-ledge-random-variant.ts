// Bank13 stamp handlers for std objects $9B / $9C — random-decorated
// 1-wide ledges, paired init `CODE_init_ledge_random_variant`.
//
// Init (Bank12.asm:4642, CODE_init_ledge_random_variant @ $12:9E26):
//
//   REP #$20
//   LDA $15 ; AND #$0004 ; LSR ; TAY     ; Y = bit-2 of $15 as 0 or 2
//                                           (selects v1 / v2 body via
//                                            DATA_ledge_random_body_ptrs)
//   JSL CODE_prng ; AND #$0003 ; STA $15  ; $15 = prng & 3 (new variant
//                                           "set index" — picks column
//                                           in DATA_13D935/93D and the
//                                           DATA_13D9A8..13D9C0 caps)
//   EOR #$0003 ; ASL ; STA $A1            ; $A1 = ($15 ^ 3) << 1
//                                           (mirror-column index used by
//                                            the random_a/b/c loaders)
//   LDX #(CODE_stamp_ledge_random_v1-1)>>16               ; bank byte for trampoline
//   LDA DATA_ledge_random_body_ptrs,y                      ; ptr-1 of v1 (Y=0) or v2 (Y=2)
//   JMP walker_setup_trampoline            ; wires the stamp into all
//                                            three handler slots
//
// DATA_ledge_random_body_ptrs = DATA_ledge_random_body_ptrs (Bank12.asm:4637):
//   dw CODE_stamp_ledge_random_v1-1, CODE_stamp_ledge_random_v2-1
//
// Per-cell stamps live in Bank13 and share `CODE_floor_4wide_apply_pick`
// at the tail (stamps the value in Y to LevelDataBuffer[$1D], skipping
// the write when Y == 0).
//
// ─────────────────────────────────────────────────────────────────────
// Stamp state machine (CODE_stamp_ledge_random_v1 / _v2)
// ─────────────────────────────────────────────────────────────────────
//
// Both stamps:
//   1. Compute Y = $15 << 1 (entry index into the 4-word "set"/"cap"
//      tables, scaled to word offset).
//   2. Classify the current row ($2C) against the row extent ($2E) to
//      pick an INDEX into a per-stamp dispatch table (DATA_13D925 /
//      _92D for v1, DATA_13D994 / _99E for v2).
//   3. Dispatch on $2E parity:
//        even row_extent → "main" table (DATA_13D925 / DATA_13D994)
//        odd  row_extent → "swap" table (DATA_13D92D / DATA_13D99E)
//   4. The dispatched sub-handler reads the Map16 ID from the
//      corresponding tile table:
//        - "set"/"cap" loaders: indexed by Y (= $15 << 1)
//        - "random" loaders:    indexed by $A1
//
// v1 row classifier (4-entry tables — idx in [0..3]):
//   idx 0  row == 0                  (top cap)
//   idx 1  row + 1 == row_extent     (bottom cap)
//   idx 2  (row + 1) & 1 == 0        (even-row body)
//   idx 3  (row + 1) & 1 == 1        (odd-row body)
//
// v2 row classifier (5-entry tables — idx in [0..4]):
//   idx 0  row == 0                  (top cap A)
//   idx 1  row == 1                  (top cap B — v2 adds a second cap)
//   idx 2  row + 1 == row_extent     (bottom cap)
//   idx 3  (row + 1) & 1 == 0        (even-row body)
//   idx 4  (row + 1) & 1 == 1        (odd-row body)
//
// ─────────────────────────────────────────────────────────────────────
// Tile tables (Bank13.asm:10539-10546, 10717-10721, 10796-10806)
// ─────────────────────────────────────────────────────────────────────
//
// 4-word tables indexed by Y = $15 << 1 (i.e., $15 in [0..3] selects a
// column). The two "set" tables form the v1 top-cap pair; v2's four
// "cap" tables widen this to two cap rows. The "random" tables are
// shared body tiles indexed by the mirror column in $A1.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell } from './_shared.ts';

// Random-body shared tables (Bank13.asm:10539-10546).
const DATA_ledge_random_body_pool_a = [0x7700, 0x7704, 0x7708, 0x770C] as const; // DATA_13D82D
const DATA_ledge_random_body_pool_b = [0x7733, 0x7737, 0x773B, 0x773F] as const; // DATA_13D835
const DATA_ledge_random_body_pool_c = [0x7723, 0x7727, 0x772B, 0x772F] as const; // DATA_13D83D

// v1 top-cap pair (Bank13.asm:10717-10721). _935 = even-row_extent
// (main), _93D = odd-row_extent (swap).
const DATA_ledge_random_v1_cap_main = [0x7722, 0x7724, 0x7728, 0x772C] as const; // DATA_13D935
const DATA_ledge_random_v1_cap_swap = [0x7751, 0x7757, 0x775A, 0x775D] as const; // DATA_13D93D

// v2 cap tables (Bank13.asm:10796-10806). _9A8/_9B0 used in the
// even-row_extent "main" table; _9B8/_9C0 in the odd "swap" table.
const DATA_ledge_random_v2_cap_a = [0x7753, 0x7756, 0x7759, 0x775C] as const; // DATA_13D9A8
const DATA_ledge_random_v2_cap_b = [0x7752, 0x7755, 0x7758, 0x775B] as const; // DATA_13D9B0
const DATA_ledge_random_v2_cap_c = [0x7720, 0x7725, 0x7729, 0x772D] as const; // DATA_13D9B8
const DATA_ledge_random_v2_cap_d = [0x7721, 0x7726, 0x772A, 0x772E] as const; // DATA_13D9C0

// ─────────────────────────────────────────────────────────────────────
// Dispatch tables — index → (table to read, "use $A1" flag).
//
// `loadByVariant`: read with Y = ($15 << 1), i.e. by the variant set
//                  $15 picked.
// `loadByMirror`:  read with Y = $A1 (the (3 - $15) mirror column).
// ─────────────────────────────────────────────────────────────────────

type LedgeLoader = (state: DecodeState) => number;

function loadByVariant(table: readonly number[]): LedgeLoader {
  return (state) => {
    const y = (state.zp15 & 0x03) << 1;   // word index 0/2/4/6
    return table[y >>> 1] ?? 0;
  };
}

function loadByMirror(table: readonly number[]): LedgeLoader {
  return (state) => {
    const y = state.zpA1 & 0xff;           // word offset (already << 1)
    return table[y >>> 1] ?? 0;
  };
}

// DATA_13D925: [set_a, random_c, random_a, random_b]
const DISPATCH_V1_MAIN: readonly LedgeLoader[] = [
  loadByVariant(DATA_ledge_random_v1_cap_main),
  loadByMirror(DATA_ledge_random_body_pool_c),
  loadByMirror(DATA_ledge_random_body_pool_a),
  loadByMirror(DATA_ledge_random_body_pool_b),
];

// DATA_13D92D: [set_b, random_c, random_b, random_a]
const DISPATCH_V1_SWAP: readonly LedgeLoader[] = [
  loadByVariant(DATA_ledge_random_v1_cap_swap),
  loadByMirror(DATA_ledge_random_body_pool_c),
  loadByMirror(DATA_ledge_random_body_pool_b),
  loadByMirror(DATA_ledge_random_body_pool_a),
];

// DATA_13D994: [cap_a, cap_b, random_c, random_a, random_b]
const DISPATCH_V2_MAIN: readonly LedgeLoader[] = [
  loadByVariant(DATA_ledge_random_v2_cap_a),
  loadByVariant(DATA_ledge_random_v2_cap_b),
  loadByMirror(DATA_ledge_random_body_pool_c),
  loadByMirror(DATA_ledge_random_body_pool_a),
  loadByMirror(DATA_ledge_random_body_pool_b),
];

// DATA_13D99E: [cap_c, cap_d, random_c, random_b, random_a]
const DISPATCH_V2_SWAP: readonly LedgeLoader[] = [
  loadByVariant(DATA_ledge_random_v2_cap_c),
  loadByVariant(DATA_ledge_random_v2_cap_d),
  loadByMirror(DATA_ledge_random_body_pool_c),
  loadByMirror(DATA_ledge_random_body_pool_b),
  loadByMirror(DATA_ledge_random_body_pool_a),
];

// ─────────────────────────────────────────────────────────────────────
// Row classifiers
// ─────────────────────────────────────────────────────────────────────

/** v1: 4-bucket classifier (top cap / bottom cap / even body / odd body). */
function classifyV1Row(row: number, rowExtent: number): number {
  if (row === 0) return 0;                   // top cap
  const rowPlus1 = (row + 1) & 0xff;
  if (rowPlus1 === (rowExtent & 0xff)) return 1; // bottom cap
  return (rowPlus1 & 0x01) === 0 ? 2 : 3;
}

/** v2: 5-bucket classifier — adds a second top cap row at row==1. */
function classifyV2Row(row: number, rowExtent: number): number {
  if (row === 0) return 0;                   // top cap A
  if (row === 1) return 1;                   // top cap B
  const rowPlus1 = (row + 1) & 0xff;
  if (rowPlus1 === (rowExtent & 0xff)) return 2; // bottom cap
  return (rowPlus1 & 0x01) === 0 ? 3 : 4;
}

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamp handlers.
//
// Both stamps end with `CODE_floor_4wide_apply_pick` (`TYA ; BEQ skip ;
// STA buffer,x`) — i.e. a Map16 of $0000 means "do not stamp" (preserve
// the underlying cell). Mirror that via `if (tile === 0) return`.
// ─────────────────────────────────────────────────────────────────────

const stampLedgeRandomV1: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const idx = classifyV1Row(row, state.zp2E);
  const oddExtent = (state.zp2E & 0x01) !== 0;
  const table = oddExtent ? DISPATCH_V1_SWAP : DISPATCH_V1_MAIN;
  const tile = table[idx]!(state);
  if (tile === 0) return;
  stampCell(state, tile);
};

const stampLedgeRandomV2: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const idx = classifyV2Row(row, state.zp2E);
  const oddExtent = (state.zp2E & 0x01) !== 0;
  const table = oddExtent ? DISPATCH_V2_SWAP : DISPATCH_V2_MAIN;
  const tile = table[idx]!(state);
  if (tile === 0) return;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_ledge_random_variant ($12:9E26, Bank12.asm:4642).
//
// `$15 bit 2` (the cart's orientation byte) selects between v1 and v2
// stamps. The init then re-encodes $15 to a PRNG-rolled column index
// (0..3) and writes the mirror column into $A1. Trace specs confirm
// $15: 9B → 02 / 9C → 02 (PRNG happened to roll $02 in both captures).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x9B, 0x9C share this handler.
const initLedgeRandomVariant: InitHandler = (state) => {
  // bit-2 of incoming $15 → 0 (v1) or 1 (v2). The asm does
  //   AND #$0004 ; LSR ; TAY → Y in {0, 2} as a word index.
  const variantBit = (state.zp15 & 0x04) !== 0 ? 1 : 0;

  // PRNG roll, narrowed to a 2-bit set index in [0..3]. Writes both
  // bytes of $15/$16 in the asm via REP #$20 STA $15 — we only carry
  // the low byte.
  const setIdx = prngNext(state, RNG_SITE.initLedgeRandomVariant) & 0x03;
  state.zp15 = setIdx;

  // $A1 = ($15 ^ 3) << 1 — the "mirror column" word offset. Used by
  // every random-body loader to pick the opposite column within the
  // 4-tile pool.
  state.zpA1 = ((setIdx ^ 0x03) << 1) & 0xff;

  walkerSetupTrampoline(
    state,
    variantBit === 0 ? stampLedgeRandomV1 : stampLedgeRandomV2,
  );
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Object IDs $9B and $9C both call
// CODE_init_ledge_random_variant (the variant byte ($15) the parser
// loads from the object record selects v1/v2 via bit 2).
// ─────────────────────────────────────────────────────────────────────

export function installLedgeRandomVariantHandlers(): void {
  registerStdObjectHandler(0x9B, initLedgeRandomVariant);
  registerStdObjectHandler(0x9C, initLedgeRandomVariant);
}
