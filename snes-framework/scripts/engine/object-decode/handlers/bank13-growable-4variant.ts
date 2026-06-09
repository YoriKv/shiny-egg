// Bank13 growable-4variant stamp handlers + Bank12 init wrapper.
//
// Standard objects $D4 / $D5 / $D6 / $D7 — the "growable 4-variant"
// family: a 1-D growable decoration strip whose ends are 3-tile build
// helpers (edge / corner) and whose interior is a PRNG-rolled tile from
// a per-variant pool, with shape-aware anchor-replacement overrides for
// cells whose previously-stamped Map16 ID hits one of 12-13 anchor
// sentinels. The four IDs are sibling orientations selected by the init
// via `$15 & 3`:
//
//   ID    $15&3   stamp handler                                axis     orientation
//   ───   ─────   ───────────────────────────────────────────  ──────   ─────────────
//   $D4   0       CODE_stamp_grow_top_left      ($13:ED27)     col $2C  top-left
//   $D5   1       CODE_stamp_grow_top_right     ($13:EE31)     col $2C  top-right
//   $D6   2       CODE_stamp_grow_bottom_left   ($13:EF57)     row $28  bottom-left
//   $D7   3       CODE_stamp_grow_bottom_right  ($13:F06C)     row $28  bottom-right
//
// All four stamp handlers share an identical control flow — only the
// active axis (col-axis $D4/$D5 walk on `$2C`; row-axis $D6/$D7 walk on
// `$28`), the four per-orientation data tables, the side the probe-
// neighbour helper probes (left for D4/D6, right for D5/D7), and the
// direction the seam-helper's secondary stamp goes (left for D4/D5,
// above for D6/D7) differ:
//
//   if pos == 0: dispatch first-edge build helper                   (3-cell stamp)
//   if pos+1 == extent: dispatch last-edge corner-build helper      (3-cell stamp)
//   else:
//     anchor-search $12 against 12/13-entry anchor table:
//       hit → stamp replacement[y], clear $A1, return                (1-cell)
//     else if $A1 != 0:
//       seam-helper(y=$A1), clear $A1, return                        (1 or 2-cell)
//     else:
//       y = (prng & 7) * 2                                           [0..14]
//       if y >= $C and NOT last row/col: y = (y & 7) * 2             // demote $C/$E -> 4/6
//       stamp random_4tiles[y]   (8-byte table; y in 0..14 spans into secondary)
//       if y < 8:  return
//       if y >= $C: $A1 = y                                          // latch for next cell
//       probe-neighbour → stamp secondary_8tiles[y]                  // 2-cell pattern
//
// The init handler is a bare dispatcher (specs confirm no DP mutation
// on entry → walker time for $1B/$1C/$2A/$2E/$15):
//
//   REP #$20
//   STZ $A1                            ; clear latched-secondary
//   LDA $15 ; AND #$0003 ; ASL ; TAY
//   LDX #(CODE_stamp_grow_top_left-1)>>16            ; bank byte
//   LDA DATA_growable_4variant_stamps,y
//   JMP walker_setup_trampoline
//
// Asm sources:
//   CODE_init_growable_4variant            Bank12.asm:5146 ($12:A163)
//   DATA_growable_4variant_stamps          Bank12.asm:5142 ($12:A15B)
//   CODE_stamp_grow_top_left               Bank13.asm:13258 ($13:ED27)
//   CODE_grow_top_left_edge_build          Bank13.asm:13332 ($13:EDA2)
//   CODE_grow_top_left_corner_build        Bank13.asm:13345 ($13:EDC1)
//   CODE_grow_top_left_seam_helper         Bank13.asm:13362 ($13:EDE4)
//   CODE_stamp_grow_top_right              Bank13.asm:13393 ($13:EE31)
//   CODE_grow_top_right_edge_build         Bank13.asm:13467 ($13:EEAC)
//   CODE_grow_top_right_corner_build       Bank13.asm:13480 ($13:EECB)
//   CODE_grow_top_right_seam_helper        Bank13.asm:13496 ($13:EEEE)
//   CODE_stamp_grow_bottom_left            Bank13.asm:13532 ($13:EF57)
//   CODE_grow_bottom_left_edge_build       Bank13.asm:13608 ($13:EFD7)
//   CODE_grow_bottom_left_corner_build     Bank13.asm:13621 ($13:EFF6)
//   CODE_grow_bottom_left_seam_helper      Bank13.asm:13640 ($13:F01D)
//   CODE_stamp_grow_bottom_right           Bank13.asm:13670 ($13:F06C)
//   CODE_grow_bottom_right_edge_build      Bank13.asm:13746 ($13:F0EC)
//   CODE_grow_bottom_right_corner_build    Bank13.asm:13759 ($13:F10B)
//   CODE_grow_bottom_right_seam_helper     Bank13.asm:13778 ($13:F132)
//

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import {
  getMap16Above,
  getMap16Below,
  getMap16Left,
  getMap16Right,
} from '../fetch.ts';
import { prngNext } from '../prng.ts';
import { stampCell, setProbeToCurrent, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-orientation data tables.
//
// Layout: `random8tiles` is the conceptual 8-word table indexed by
// `Y/2 = (prng & 7)`. The cart's `DATA_grow_*_random_4tiles` is only
// 4 words long, but the stamp's `LDA DATA_random_4tiles,y` with Y in
// {0..14} reads past the end into `DATA_*_secondary_8tiles` for the
// upper half. We pre-merge them here so the indexed read is well-
// defined within the array. The first 4 entries match the cart's
// `random_4tiles`; entries 4-7 match the first 4 entries of the cart's
// adjacent `secondary_8tiles` array (i.e. the data the asm reads via
// `DATA_random_4tiles+8`).
//
// `secondary8tiles` is the actual cart `secondary_8tiles` — 8 words
// total — read when the random pick goes through the 2-cell "with
// neighbour" branch.
//
// `anchor` / `replacement` are the parallel anchor-search tables: if
// `$12` matches `anchor[y/2]`, stamp `replacement[y/2]` instead. The
// top variants have 12 entries; the bottom variants have 13 (the 13th
// is a one-off `DATA_grow_bottom_anchor_13tiles[12]` = $77CE that maps
// to entry 12 of each bottom replacement table).
//
// `seamA` / `seamB` are the 2-word lookup pair used by the seam-helper
// when the previous cell latched its Y into $A1. The cart's helper
// indexes `DATA_*_seamA-$0C, y` (so Y must be $0C or $0E to hit
// `DATA_*_seamA[0]` or `[1]`). For top variants only `seamA` is used
// (and the helper conditionally also writes $793D/$7950 via probe);
// for bottom variants both `seamA` (here-cell) and `seamB` (above-
// cell, via get_map16_above) are written unconditionally.
//
// `seamProbeTile` is the constant the top-variant seam-helper writes
// to the probed neighbour when `Y < $0E` ($793D for top_left, $7950
// for top_right). Bottom variants don't have this — their seam-helper
// unconditionally writes `seamB`.
// ─────────────────────────────────────────────────────────────────────

interface GrowVariant {
  /** 0 → row-axis (D4/D5): walker counter is $2C, extent is $2E.
   *  1 → row-axis (D6/D7): walker counter is $28, extent is $2A. */
  axis: 'col' | 'row';
  /** 8-entry random-tile pool (first 4 = cart's `random_4tiles`, next
   *  4 = first half of `secondary_8tiles`, read via end-of-table run-on). */
  random8tiles: ReadonlyArray<number>;
  /** 8-entry secondary tile table (the cart's actual `secondary_8tiles`). */
  secondary8tiles: ReadonlyArray<number>;
  /** Anchor sentinels (12 entries top, 13 entries bottom). */
  anchor: ReadonlyArray<number>;
  /** Replacement tiles (same length as `anchor`, parallel). */
  replacement: ReadonlyArray<number>;
  /** 2-entry seam helper table A (probed cell's stamp, indexed by `Y-$0C`). */
  seamA: readonly [number, number];
  /** 2-entry seam helper table B (only bottom variants — above-cell stamp).
   *  Top variants set seamB = null and use `seamProbeTile` + probe-left/right
   *  instead, conditional on `Y < $0E`. */
  seamB: readonly [number, number] | null;
  /** Edge-build helper's 3-cell stamps:
   *  [probed-vertical-neighbour, probed-horizontal-neighbour, here]. */
  edgeBuild: readonly [number, number, number];
  /** Corner-build helper's 3-cell stamps (same layout). */
  cornerBuild: readonly [number, number, number];
  /** Probe direction for the edge-build helper's first probe (above
   *  for top variants, below for bottom variants). */
  probeVert: 'above' | 'below';
  /** Probe direction for the corner-build helper's first probe
   *  (below for top variants, above for bottom variants — mirror of
   *  edgeBuild). */
  probeVertCorner: 'above' | 'below';
  /** Horizontal probe direction (left for D4/D6, right for D5/D7). */
  probeHoriz: 'left' | 'right';
  /** For top variants only: the constant tile the seam-helper writes
   *  to the horizontal-probed neighbour when `Y < $0E` ($793D / $7950).
   *  Bottom variants set this to null (their helper uses seamB instead). */
  seamProbeTile: number | null;
}

// $D4 — CODE_stamp_grow_top_left  (col-axis, probe left, $793D seam)
const VARIANT_TOP_LEFT: GrowVariant = {
  axis: 'col',
  // DATA_grow_top_left_random_4tiles random_4tiles + first 4 of DATA_grow_top_left_secondary_8tiles secondary_8tiles.
  random8tiles: [0x7941, 0x7947, 0x7941, 0x7947, 0x7940, 0x7946, 0x793C, 0x7943],
  // DATA_grow_top_left_secondary_8tiles (8 words).
  secondary8tiles: [0x7940, 0x7946, 0x793C, 0x7943, 0x793F, 0x7945, 0x7931, 0x7942],
  // DATA_grow_top_left_anchor_12tiles (12 words).
  anchor: [
    0x7915, 0x7916, 0x77A9, 0x77AA, 0x77AB, 0x77AC,
    0x77AD, 0x77AE, 0x77AF, 0x77B0, 0x7925, 0x7926,
  ],
  // DATA_grow_top_left_replacement_12tiles (12 words).
  replacement: [
    0x7938, 0x7938, 0x8543, 0x8543, 0x8544, 0x8544,
    0x8545, 0x8545, 0x8546, 0x8546, 0x7939, 0x7939,
  ],
  // DATA_13EDE0 (2 words).
  seamA: [0x793E, 0x7944],
  seamB: null,
  // CODE_grow_top_left_edge_build: above=$7980, left=$7981, here=$7982.
  edgeBuild: [0x7980, 0x7981, 0x7982],
  // CODE_grow_top_left_corner_build: below=$7988, left=$7986, here=$7987.
  cornerBuild: [0x7988, 0x7986, 0x7987],
  probeVert: 'above',
  probeVertCorner: 'below',
  probeHoriz: 'left',
  seamProbeTile: 0x793D,
};

// $D5 — CODE_stamp_grow_top_right (col-axis, probe right, $7950 seam)
const VARIANT_TOP_RIGHT: GrowVariant = {
  axis: 'col',
  // DATA_grow_top_right_random_4tiles random_4tiles + first 4 of DATA_grow_top_right_secondary_8tiles secondary_8tiles.
  random8tiles: [0x794D, 0x7953, 0x794D, 0x7953, 0x794B, 0x7951, 0x794E, 0x7948],
  // DATA_grow_top_right_secondary_8tiles (8 words).
  secondary8tiles: [0x794B, 0x7951, 0x794E, 0x7948, 0x794C, 0x7952, 0x7931, 0x7949],
  // Top-right shares DATA_grow_top_left_anchor_12tiles anchor with top-left.
  anchor: [
    0x7915, 0x7916, 0x77A9, 0x77AA, 0x77AB, 0x77AC,
    0x77AD, 0x77AE, 0x77AF, 0x77B0, 0x7925, 0x7926,
  ],
  // DATA_grow_top_right_replacement_12tiles (12 words).
  replacement: [
    0x793A, 0x793A, 0x8547, 0x8547, 0x8548, 0x8548,
    0x8549, 0x8549, 0x854A, 0x854A, 0x793B, 0x793B,
  ],
  // DATA_13EEEA (2 words).
  seamA: [0x794F, 0x794A],
  seamB: null,
  // CODE_grow_top_right_edge_build: above=$7983, right=$7985, here=$7984.
  edgeBuild: [0x7983, 0x7985, 0x7984],
  // CODE_grow_top_right_corner_build: below=$798B, right=$798A, here=$7989.
  cornerBuild: [0x798B, 0x798A, 0x7989],
  probeVert: 'above',
  probeVertCorner: 'below',
  probeHoriz: 'right',
  seamProbeTile: 0x7950,
};

// $D6 — CODE_stamp_grow_bottom_left  (row-axis, probe left, seamB = above)
const VARIANT_BOTTOM_LEFT: GrowVariant = {
  axis: 'row',
  // DATA_grow_bottom_left_random_4tiles random_4tiles + first 4 of DATA_grow_bottom_left_secondary_8tiles secondary_8tiles.
  random8tiles: [0x795A, 0x7961, 0x795A, 0x7961, 0x7959, 0x7960, 0x7956, 0x795D],
  // DATA_grow_bottom_left_secondary_8tiles (8 words).
  secondary8tiles: [0x7959, 0x7960, 0x7956, 0x795D, 0x7958, 0x795F, 0x7954, 0x795B],
  // DATA_grow_bottom_anchor_13tiles (13 words — bottom variants have an extra entry).
  anchor: [
    0x790F, 0x791F, 0x7799, 0x779A, 0x779B, 0x779C, 0x779D,
    0x779E, 0x779F, 0x77A0, 0x7910, 0x7920, 0x77CE,
  ],
  // DATA_grow_bottom_left_replacement_13tiles (13 words).
  replacement: [
    0x7934, 0x7934, 0x853B, 0x853B, 0x853C, 0x853C, 0x853D,
    0x853D, 0x853E, 0x853E, 0x7935, 0x7935, 0x853C,
  ],
  // DATA_13F015 (here-cell), DATA_13F019 (above-cell).
  seamA: [0x7957, 0x795E],
  seamB: [0x7955, 0x795C],
  // CODE_grow_bottom_left_edge_build: above=$7980, left=$7981, here=$7982.
  // (Note the asm reuses identical tile literals as top_left's edge_build
  // but with the same probe geometry — the cells visually pair with the
  // bottom-decoration body. See spec D6 cell 0.)
  edgeBuild: [0x7980, 0x7981, 0x7982],
  // CODE_grow_bottom_left_corner_build: above=$7983, right=$7985, here=$7984.
  cornerBuild: [0x7983, 0x7985, 0x7984],
  probeVert: 'above',
  probeVertCorner: 'above',
  probeHoriz: 'left',
  seamProbeTile: null,
};

// $D7 — CODE_stamp_grow_bottom_right (row-axis, probe right, seamB = below)
const VARIANT_BOTTOM_RIGHT: GrowVariant = {
  axis: 'row',
  // DATA_grow_bottom_right_random_4tiles random_4tiles + first 4 of DATA_grow_bottom_right_secondary_8tiles secondary_8tiles.
  random8tiles: [0x7968, 0x796F, 0x7968, 0x796F, 0x7966, 0x796D, 0x7962, 0x7969],
  // DATA_grow_bottom_right_secondary_8tiles (8 words).
  secondary8tiles: [0x7966, 0x796D, 0x7962, 0x7969, 0x7967, 0x796E, 0x7964, 0x796B],
  // Bottom-right shares DATA_grow_bottom_anchor_13tiles anchor with bottom-left.
  anchor: [
    0x790F, 0x791F, 0x7799, 0x779A, 0x779B, 0x779C, 0x779D,
    0x779E, 0x779F, 0x77A0, 0x7910, 0x7920, 0x77CE,
  ],
  // DATA_grow_bottom_right_replacement_13tiles (13 words).
  replacement: [
    0x7936, 0x7936, 0x853F, 0x853F, 0x8540, 0x8540, 0x8541,
    0x8541, 0x8542, 0x8542, 0x7937, 0x7937, 0x8540,
  ],
  // DATA_13F12A (here-cell), DATA_13F12E (below-cell).
  seamA: [0x7963, 0x796A],
  seamB: [0x7965, 0x796C],
  // CODE_grow_bottom_right_edge_build: below=$7988, left=$7986, here=$7987.
  edgeBuild: [0x7988, 0x7986, 0x7987],
  // CODE_grow_bottom_right_corner_build: below=$798B, right=$798A, here=$7989.
  cornerBuild: [0x798B, 0x798A, 0x7989],
  probeVert: 'below',
  probeVertCorner: 'below',
  probeHoriz: 'right',
  seamProbeTile: null,
};

// ─────────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────────

/** Get the buffer offset for the vertical-probe neighbour direction
 *  the variant specifies. */
function probeVertOffset(state: DecodeState, dir: 'above' | 'below'): number {
  // Cart: LDA $1B ; STA $0E ; JSL get_map16_{above|below}
  setProbeToCurrent(state);
  return dir === 'above' ? getMap16Above(state) : getMap16Below(state);
}

/** Get the buffer offset for the horizontal-probe neighbour direction. */
function probeHorizOffset(state: DecodeState, dir: 'left' | 'right'): number {
  setProbeToCurrent(state);
  return dir === 'left' ? getMap16Left(state) : getMap16Right(state);
}

/** CODE_grow_*_edge_build — stamp the 3-cell first-end-of-strip pattern.
 *   1. probe the vertical neighbour (above for top variants, below for
 *      bottom-right) → stamp `edge[0]` there.
 *   2. probe the horizontal neighbour → stamp `edge[1]` there.
 *   3. stamp `edge[2]` at the current cell ($1D). */
function edgeBuild(state: DecodeState, v: GrowVariant): void {
  const vertOff = probeVertOffset(state, v.probeVert);
  writeBuf16(state, vertOff, v.edgeBuild[0]);
  const horizOff = probeHorizOffset(state, v.probeHoriz);
  writeBuf16(state, horizOff, v.edgeBuild[1]);
  stampCell(state, v.edgeBuild[2]);
}

/** CODE_grow_*_corner_build — stamp the 3-cell last-end-of-strip
 *  pattern. Same shape as edgeBuild but with `cornerBuild` data and
 *  the mirror vertical probe direction (`probeVertCorner`). */
function cornerBuild(state: DecodeState, v: GrowVariant): void {
  const vertOff = probeVertOffset(state, v.probeVertCorner);
  writeBuf16(state, vertOff, v.cornerBuild[0]);
  const horizOff = probeHorizOffset(state, v.probeHoriz);
  writeBuf16(state, horizOff, v.cornerBuild[1]);
  stampCell(state, v.cornerBuild[2]);
}

/** Top-variant seam helper (CODE_grow_top_*_seam_helper).
 *
 *  Indexes `seamA` by `(Y - $0C) / 2` (so Y=$0C → 0, Y=$0E → 1), stamps
 *  that at the current cell. If `Y < $0E` (i.e. only at Y=$0C), also
 *  probes the horizontal neighbour and stamps `seamProbeTile` there. */
function topSeamHelper(state: DecodeState, v: GrowVariant, y: number): void {
  const idx = (y - 0x0C) >>> 1;
  stampCell(state, v.seamA[idx]!);
  if (y < 0x0E) {
    const horizOff = probeHorizOffset(state, v.probeHoriz);
    writeBuf16(state, horizOff, v.seamProbeTile!);
  }
}

/** Bottom-variant seam helper (CODE_grow_bottom_*_seam_helper).
 *
 *  Indexes `seamA` for the here-cell stamp, then UNCONDITIONALLY
 *  probes the vertical neighbour (`probeVert`) and stamps `seamB`
 *  there. The cart's helper doesn't have the `CPY #$0E` early-out
 *  that top variants do. */
function bottomSeamHelper(state: DecodeState, v: GrowVariant, y: number): void {
  const idx = (y - 0x0C) >>> 1;
  stampCell(state, v.seamA[idx]!);
  // Cart: LDA $1B ; STA $0E ; JSL get_map16_above (bottom_left) /
  // get_map16_below (bottom_right). Both bottom variants use the
  // vertical-probe direction from `probeVert`.
  const vertOff = probeVertOffset(state, v.probeVert);
  writeBuf16(state, vertOff, v.seamB![idx]!);
}

/** Common per-cell stamp body. `pos` is the walker counter on the
 *  active axis ($2C for col-axis variants D4/D5, $28 for row-axis
 *  D6/D7); `ext` is the matching extent ($2E or $2A). */
function growStamp(state: DecodeState, v: GrowVariant): void {
  const pos = v.axis === 'col' ? (state.zp2C & 0xff) : (state.zp28 & 0xff);
  const ext = v.axis === 'col' ? (state.zp2E & 0xff) : (state.zp2A & 0xff);

  // Cart: LDA pos ; BEQ first-end. LDA pos ; INC ; CMP ext ; BEQ last-end.
  if (pos === 0) {
    edgeBuild(state, v);
    return;
  }
  if (((pos + 1) & 0xff) === ext) {
    cornerBuild(state, v);
    return;
  }

  // Anchor-search: LDY #$0000 ; LDA $12 ; loop comparing against
  // anchor[Y/2]. The cart's CPY against $0018 (top, 24 bytes = 12 words)
  // or $001A (bottom, 26 bytes = 13 words) becomes a length compare.
  const cur = state.zp12 & 0xffff;
  for (let i = 0; i < v.anchor.length; i++) {
    if (v.anchor[i] === cur) {
      state.zpA1 = 0;
      stampCell(state, v.replacement[i]!);
      return;
    }
  }

  // Seam-helper continuation: previous cell latched Y into $A1, so this
  // cell pulls it back, runs the seam-helper, clears $A1.
  if ((state.zpA1 & 0xff) !== 0) {
    const y = state.zpA1 & 0xff;
    if (v.seamB !== null) bottomSeamHelper(state, v, y);
    else                  topSeamHelper(state, v, y);
    state.zpA1 = 0;
    return;
  }

  // PRNG body. Y = (prng & 7) * 2  →  Y in {0,2,4,6,8,10,12,14}.
  let y = (prngNext(state) & 0x07) << 1;
  if (y >= 0x0C) {
    // Cart: LDA $2E ; CLC ; SBC $2C ; DEC ; BNE skip-demote. Translated:
    //   $2E - $2C - 1 (no preceding SEC, so SBC's borrow eats one) → 0
    //   means this IS the last cell of the strip. Otherwise demote.
    // (No-carry SBC is `A - M - 1`. Cart sets CLC explicitly, so the
    // expression is `$2E - $2C - 1` exactly.)
    const lastCell = (((ext - pos - 1) & 0xff) === 0);
    if (!lastCell) {
      // TYA ; AND #$0007 ; TAY — strips bit 3 of the byte-typed index.
      // Since Y was `(prng&7)*2`, Y in {12,14} → byte y & 7 in {4,6}
      // → demoted Y in {4,6}. So the demote re-targets entries 2-3 of
      // random8tiles instead of the secondary-overflow entries 6-7.
      y &= 0x07;
    }
  }

  // Stamp random8tiles[y/2]. Cart: LDA DATA_random_4tiles,y reads the
  // 8-byte (4-word) random table, then runs on into the secondary
  // table when Y >= 8 — exactly what `random8tiles` already encodes.
  stampCell(state, v.random8tiles[y >>> 1]!);

  // CPY #$0008 BCC: Y < 8 → single-cell stamp only, return.
  if (y < 0x08) return;

  // CPY #$000C BCC ... STY $A1: if Y in {12,14} latch into $A1 (so
  // the next cell runs the seam-helper continuation path).
  if (y >= 0x0C) {
    state.zpA1 = y;
  }

  // Probe horizontal neighbour and stamp secondary[y/2].
  const horizOff = probeHorizOffset(state, v.probeHoriz);
  writeBuf16(state, horizOff, v.secondary8tiles[y >>> 1]!);
}

// ─────────────────────────────────────────────────────────────────────
// Stamp handler factories.
// ─────────────────────────────────────────────────────────────────────

function makeStamp(v: GrowVariant): PerCellHandler {
  return (state) => growStamp(state, v);
}

const stampGrowTopLeft     = makeStamp(VARIANT_TOP_LEFT);
const stampGrowTopRight    = makeStamp(VARIANT_TOP_RIGHT);
const stampGrowBottomLeft  = makeStamp(VARIANT_BOTTOM_LEFT);
const stampGrowBottomRight = makeStamp(VARIANT_BOTTOM_RIGHT);

// ─────────────────────────────────────────────────────────────────────
// DATA_growable_4variant_stamps ($12:A15B) — 4-entry dispatch table
// indexed by `($15 & 3) * 2`. Order matches the asm.
// ─────────────────────────────────────────────────────────────────────

const DATA_growable_4variant_stamps: ReadonlyArray<PerCellHandler> = [
  stampGrowTopLeft,      // $D4  ($15 & 3 = 0)
  stampGrowTopRight,     // $D5  ($15 & 3 = 1)
  stampGrowBottomLeft,   // $D6  ($15 & 3 = 2)
  stampGrowBottomRight,  // $D7  ($15 & 3 = 3)
];

// ─────────────────────────────────────────────────────────────────────
// CODE_init_growable_4variant ($12:A163).
//
// Clears $A1 (the seam-latch state — fresh for each object), picks
// the stamp by `$15 & 3`, dispatches via walker_setup_trampoline.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xD4, 0xD5, 0xD6, 0xD7 share this handler.
function initGrowable4variant(state: DecodeState): void {
  state.zpA1 = 0;
  const variant = state.zp15 & 0x03;
  const stamp = DATA_growable_4variant_stamps[variant]!;
  walkerSetupTrampoline(state, stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installGrowable4variantHandlers(): void {
  registerStdObjectHandler(0xD4, initGrowable4variant);
  registerStdObjectHandler(0xD5, initGrowable4variant);
  registerStdObjectHandler(0xD6, initGrowable4variant);
  registerStdObjectHandler(0xD7, initGrowable4variant);
}
