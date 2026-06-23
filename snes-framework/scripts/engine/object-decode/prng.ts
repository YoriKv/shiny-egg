// PRNG — port of `get_random_byte` at `$12:8875` (yi/Banks/Bank12.asm:1495).
//
// The cart's PRNG reads the PPU HV-counter software latch + live H/V
// counters, all of which depend on real hardware timing we can't reproduce
// offline. Per docs/leveldataengine.md §3.6 the consumer use-cases are
// purely cosmetic (~50 Bank13 sites for grass/floor decoration variant
// selection, ~12 Bank12 sites for pre-walker orientation pre-randomisation).
//
// We replace the HV-counter source with a deterministic 16-bit LFSR
// (Galois form, polynomial x^16+x^14+x^13+x^11+1). Output: low 8 bits of
// the LFSR after one advance.
//
// **Tradeoff:** Map16 buffer output from our decoder will be byte-stable
// across runs but will NOT exactly match a specific cart-snapshot dump,
// because the cart-side cosmetic-variant decisions were made against
// real PPU timing. For golden-master tests we can either:
//   (a) accept "close enough" matches (most cells deterministic; only
//       grass-tuft decorations vary), or
//   (b) capture the cart's PRNG seed at the moment of level load via
//       BizHawk and feed it in here.
// For Phase 3 / 4 we go with (a). Phase 7 polish can revisit if needed.
//
// Render-diff signature (expected, cosmetic — NOT a bug): a cluster of
// same-Map16-page variant tiles (differing only in low byte) under a
// random-fill object — std-01 (bg_floor_random), std-87/88 (ledge_no_grass),
// both via DATA_floor_random_grass_8way_pool. Our LFSR selects different
// variants than a live dump; rule it out before suspecting a handler.

import type { DecodeState } from './state.ts';

/** Cart caller PCs of the dominant Bank13 PRNG stamper sites — the JSL-return
 *  addresses the `level-rng` trace records (callerPC column). These four sites
 *  account for ~95% of a level's random-tile rolls and their per-site call
 *  counts match our ports EXACTLY, so per-site replay keyed by these PCs lands
 *  each captured byte on the same cell the cart rolled it for. Pass the matching
 *  one as `prngNext`'s `site` arg from the corresponding handler. (Untagged
 *  sites — the minor slope decorations — fall back to the LFSR; their counts
 *  don't yet match the cart 1:1.) */
export const RNG_SITE = {
  // std-01 init_floor_basic random grass-fill (CODE_bg_floor_random / pick_random
  // at $13:8105, JSL-return $13:810C). THE dominant random-tile site — ~65% of all
  // rolls across the shipped catalog (every grassy floor taller than 3 rows). The
  // roll fires only in the pick_random path; bgFloorRandom's early-outs (RndBoundA/B,
  // NoSeamCheckA..$1CE8 range) and last-row branch (Row1→slope-cap, Row3/SelfMark→exit)
  // mirror the cart's CODE_1380B4/1380CC exactly, so the per-site roll count matches.
  floorRandomGrass8way: 0x13810c,
  // CODE_floor_random_8way_pick ($13:C15F, JSL-return $13:C163) — the SHARED 8-way
  // grass-pool picker leaf helper. ~30% of all rolls (2nd-dominant site). The cart
  // calls it from 63 sites (big_floor_stamp, every tunnel ceiling/floor slope,
  // grass_slope_*_60deg_hole, wide_floor_interior, ceiling endcaps) — all funnel
  // into this one PC, so the per-site queue is one decode-ordered stream. Shiny
  // routes them through _shared.ts:floorRandom8wayPick + bank13-floor.ts:bigFloorStamp;
  // both must tag this PC and roll in the same order/cadence as the cart.
  floorRandom8wayPick: 0x13c163,
  // CODE_floor_edge_random_side ($13:8231, JSL-return $13:8237) — floor/ledge
  // side-edge 4-variant picker (`prng & 3` → DATA_floor_edge_random_side_pool). The
  // roll fires FIRST, unconditionally, before any branch, so cadence = one roll per
  // invocation. Shiny's single port (_floor-edge-or-wall.ts:floorEdgeRandomSide) is
  // also used by thick-post $58 edges — both route through that one function.
  floorEdgeRandomSide: 0x138237,
  // CODE_jungle_floor_random_body ($13:9049, JSL-return $13:904D) — jungle-floor
  // foliage body fill: `(prng + $2C + 1) & $1E` → DATA_jungle_foliage_pool. The roll
  // fires first/unconditionally (cadence = one per invocation). The `+1` is the
  // carry-in: all six entry paths reach the routine via a `CMP` with A>=operand
  // (carry SET), and CODE_prng's PHP/PLP preserves it — so carry-in is a constant 1.
  jungleFloorRandomBody: 0x13904d,
  // CODE_jungle_block_pattern_a_mid ($13:9828, JSL-return $13:982C) — jungle stone-
  // block mid-row variant: `prng & 7` → L/C/R column sub-handler. Roll fires first/
  // unconditionally (cadence = one per mid-row cell). Sub-handlers use explicit CLC
  // before their ADC, so no carry-in subtlety (unlike [[jungleFloorRandomBody]]).
  jungleBlockPatternMid: 0x13982c,
  jungleBlockATopInterior: 0x13981a, // a_top interior: `prng & 1` + $90BE (interior cols only)
  jungleBlockABotDefault: 0x1398e5,  // a_bot default path: `prng & 3` + $90B2 ($12 page != $9200)
  jungleBlockABot92: 0x1398cb,       // a_bot $9200 path: `prng & 3` + $90CE ($12 page == $9200)
  // ── Jungle decoration tail sites (each rolls first/unconditionally in its body
  // routine → cadence = one per cell; matched to the shiny port by base+mask). ──
  jungleFloorTopSeed: 0x139012,    // CODE_jungle_floor row-0: `prng & 3` → $A1 seed (row==0 only)
  jungleMudFloorTopbody: 0x139238, // CODE_jungle_mud_floor_topbody: `prng & 3` → $00
  // CODE_jungle_{left,right}_wall_random_body ($13:9189 / $13:91DA): `prng & 1` +
  // $909E/$9062. SHARED cart body: reached from BOTH the single-edge jungle-wall
  // objects (bank13-jungle-left-wall.ts / -right-wall.ts) AND the jungle mud-wall
  // objects $25/$26, whose per-cell handler (bank13-jungle-mud-wall-lr.ts) JMPs
  // through DATA_139254 into the same routine. So EVERY handler that reaches this
  // body must tag the site — a level's single-edge walls and its $25/$26 mud walls
  // all roll at one cart PC and feed ONE per-site replay queue, in object-stream
  // order. Tagging only the single-edge side (the historical bug) left the mud-wall
  // rolls untagged, so the capture's mud-wall rolls had no shiny home and read as
  // "extra" cart rolls — which an earlier note here mis-diagnosed as sub-room warp
  // contamination ("rec_4c: 115 rolls, ZERO $22 objects"). They are NOT
  // contamination: rec_4c genuinely has 28 $25/$26 mud walls, and those are the 115
  // rolls. With BOTH sides tagged the per-site cadence is EXACT (388/388 across the
  // 11 jungle-wall records, 0 undershoot) and the jungle-wall rng-variant residual
  // closed catalog-wide (228 → 27). The no-replay editor render is unaffected
  // (LFSR); tagging sharpens only the capture comparison. Full write-up + the
  // shared-site disambiguation method: research/notes-bg1-trace-rng-parity.md §7.1.
  jungleLeftWallBody: 0x139189,    // CODE_jungle_left_wall_random_body: `prng & 1` + $909E
  jungleRightWallBody: 0x1391da,   // CODE_jungle_right_wall_random_body: `prng & 1` + $9062
  jungleBlockPatternBTop: 0x139922,// CODE_jungle_block_pattern_b_top interior: `prng & 3` + $90C0
  jungleWaterStateRoll: 0x139a18,  // jungle-water: `prng & 6` → $15
  jungleWaterTableRoll: 0x139a57,  // jungle-water: `prng & 6` → DATA_1399F1 table
  jungleWoodBody: 0x139695,        // CODE_jungle_wood random body: `(prng & 2)>>1` + $990B
  jungleStoneBody: 0x139560,       // CODE_jungle_stone body: `prng & 6` + $90DA
  treeSprinkle: 0x13d3ff,          // CODE_tree_stamp ($8D): `prng & 1` picks entry 0/1 (non-last row)
  jungleSlopeLeftDownBody: 0x1393a6,  // CODE_jungle_slope_left_down_body row-jitter: `prng & 1`
  jungleSlopeRightDownBody: 0x13943e, // CODE_jungle_slope_right_down_body row-jitter: `prng & 1`
  spikePitBody: 0x13c837,          // CODE_spike_pit_body ($6F): `prng & 3` → DATA_spike_pit_body_tiles
  // ── Bank12/13 INIT-time pre-walker pre-randomization (one roll per OBJECT, sets
  // the object's $15/$A1 orientation/variant before the walker runs). ──
  initMushroomPlatform: 0x12a1f0,  // CODE_init_mushroom_platform ($E1): `prng & 3` → $15
  initStoneLarge: 0x129619,        // CODE_init_stone_large: `prng & 2` → $15
  initDandelionFamily: 0x12907c,   // CODE_extobj_handler_dandelion_family: `prng & 3`
  initLedgeRandomVariant: 0x129e33,// CODE_init_ledge_random_variant: `prng & 3`
  initRandom8phase: 0x12a1b9,      // CODE_init_random_8phase: `prng & 7` → $15
  initMushroomSmallPair: 0x128ffd, // CODE_extobj_handler_mushroom_small_pair ($B4/$B5): `prng & 4` → $A1
  mushroomBigPairInit: 0x12901e,   // CODE_extobj_handler_mushroom_big_pair ($B6/$B7): `prng & 1` → $15 sub-table select
  initPlantCaveLarge: 0x129e0f,    // CODE_init_plant_cave_large ($9A): `prng & 3`
  initJungleVineThin: 0x129589,    // CODE_init_jungle_vine_thin ($2D/$2E) init: `prng & 2` → $A1
  jungleVineThinExtras: 0x139617,  // CODE_jungle_vine_thin_plus_extras body: `prng & 2` (decoration gate)
  floorNoDecoTopBody: 0x13d2b4,    // CODE_stamp_floor_no_deco_top ($87/$88) body: `prng & 3` → random tile
  crystalClusterInit: 0x128fbf,    // CODE_extobj_handler_crystal_cluster_family ($AD-$B2) init: `prng & 6` → DATA_128FA5 → $A1
  // CODE_stamp_stone_3d_wall ($ED waterfall) row-group promote, JSL-return $13:FB36.
  // Reached when rowGroup<6 AND $2C is ODD — which happens for the column's cells
  // ABOVE the placement origin, where the walker's $2C is negative (e.g. $FFFD →
  // `EOR #$FFFF;INC` clamp yields rowGroup 3). `prng & 2` set → INC $00 ×3 (rowGroup
  // += 3), bumping the waterfall cap base. NOT a dead branch (175 rolls in captures).
  stone3dWallPromote: 0x13fb36,
  jungleFloorFill: 0x13f658,   // CODE_jungle_floor_random_fill (the grass-on-floor roll)
  jungleCanopy: 0x13c6ab,      // jungle-canopy random
  slopeSteepUpLeft: 0x13f613,  // CODE_slope_steep_up_left random decoration
  randomDeco8way: 0x13c7ee,    // random 8-way decoration pick
  // Slope/shoreline edge-decoration variant rolls (the "minor" Bank13 sites).
  slopeDownLeftShort: 0x13f797,  // CODE_slope_down_left_short_body  (row-0 variant)
  slopeDownRightShort: 0x13f96f, // CODE_slope_down_right_short_body (row-0 variant)
  slopeDownLeftHalf: 0x13f7ee,   // CODE_stamp_slope_down_left_half
  slopeDownRightHalf: 0x13f9c6,  // CODE_stamp_slope_down_right_half
  slopeDownLeftLongBody: 0x13f713,  // CODE_slope_down_left_long_body
  slopeDownRightLongBody: 0x13f8c9, // CODE_slope_down_right_long_body
  shorelineSlopeLeft: 0x13fa4d,  // CODE_shoreline_slope_left_deep
  shorelineSlopeRight: 0x13fac0, // CODE_shoreline_slope_right_deep
  // Growable-4variant family (std $D4-$D7 — the maze decoration strips; the
  // dominant roll site in maze/castle levels, e.g. record $5A "The Impossible
  // Maze"). One body-cell roll per stamp routine; each variant has its own PC.
  growTopLeft: 0x13ed6b,     // CODE_stamp_grow_top_left     ($D4) body roll
  growTopRight: 0x13ee75,    // CODE_stamp_grow_top_right    ($D5) body roll
  growBottomLeft: 0x13ef9b,  // CODE_stamp_grow_bottom_left  ($D6) body roll
  growBottomRight: 0x13f0b0, // CODE_stamp_grow_bottom_right ($D7) body roll
  // Stone-3d / moving-stone family (std $EE/$EF + $F0-$F3 — the 3D stone blocks
  // and warp pipes; dominant in castle levels, e.g. record $30). All share the
  // one cart routine CODE_stone_3d_body_shape_select, so both TS ports tag the
  // SAME PCs (per-site queue is shared across all those object IDs).
  stone3dBodyAlt: 0x13fce0,    // alt-tiles roll (candidate $0106 → DATA_stone_3d_body_alt_tiles)
  stone3dBodyMain: 0x13fcf4,   // main-tiles roll #1: ((prng&3)+$2C)*2
  stone3dBodyMainHi: 0x13fd04, // main-tiles roll #2: re-roll when ((prng&3)+$2C)*2 >= $16
  // Jungle-tree family (std $30/$31 trunk, $36 leaves-only; foliage in non-jungle
  // tilesets too, e.g. record $1A). The leaves roll gates whether the overlay +
  // side-leaf cells stamp (so it drives footprint, not just colour).
  jungleTrunkInit: 0x1295b2,     // CODE_init_jungle_tree_trunk: $A1 leaf-tint bias roll (per object)
  jungleTrunkBranches: 0x139711, // CODE_jungle_tree_trunk_with_branches: per-cell body roll
  jungleTrunkLeaves: 0x139780,   // CODE_jungle_tree_trunk_with_leaves: per-cell overlay+side roll
  // Jungle treetop canopy (std $29/$2A — the big leafy canopy halves; distinct
  // from the [[jungleCanopy]] site above). Per-column $A1 variant roll selects
  // the tile-family table (DATA_1394C8), so a wrong roll swaps $96xx↔$9bxx.
  jungleTreetopCanopy: 0x1394e5, // CODE_jungle_treetop_canopy: per-column $A1 variant roll
  // Ice floor (std $DB). Row-0 scatter roll picks $0000(skip)/$0017/$0018, so it
  // gates whether each row-0 cell stamps → drives footprint, not just colour.
  iceFloorScatter: 0x13f1b0,     // CODE_stamp_ice_floor: row-0 floor-top scatter roll
  // Jungle cattail (std $34). Per-column roll picks one of 16 sub-tables; the
  // last 4 have a $0000 row-0 (no stamp), so the roll drives footprint too.
  jungleCattail: 0x139994,       // CODE_jungle_cattail_random: per-column sub-table roll
  // Lava-castle wall (std $47). Per-cell grass-top decoration roll from the
  // $0084-$0088 pool (cosmetic; same-page variant pick).
  lavaCastleGrass: 0x13a68e,     // CODE_stamp_lava_castle: wall-top grass-pool roll
} as const;

export function prngNext(state: DecodeState, site?: number): number {
  state.prngCalls++;
  // ALWAYS advance the LFSR, even when a replay value is returned below. The
  // LFSR is the fallback for untagged sites; advancing it on every call keeps
  // that fallback sequence INDEPENDENT of which sites are replayed (otherwise
  // tagging one site would skip an advance and shift every untagged site's
  // values — entangling them). The normal no-replay path is unchanged (same
  // value as before): advance, return it.
  let s = state.prngState & 0xffff;
  const lsb = s & 1;
  s >>>= 1;
  if (lsb) s ^= 0xb400; // 16-bit Galois LFSR, taps 16/14/13/11 (maximal-length)
  state.prngState = s & 0xffff;
  const lfsr = s & 0xff;

  // Replay a captured cart-PRNG sequence (from the `level-rng`/`bg1-render`
  // trace) when present, so the decode reproduces the live game's exact
  // random-tile variants. The cart PRNG is stateless (HCounter+VCounter), so the
  // output byte sequence in call order is the complete, replayable RNG info.
  //
  // PER-SITE replay (preferred): the cart calls get_random_byte from ~12 Bank13
  // stamper sites, which interleave in an order a single global sequence can't
  // reproduce. Keyed by the cart caller PC (`site`), the per-site queues stay
  // aligned even when other sites' call counts differ. A call site passes its
  // cart PC; a site replays correctly only if our handler rolls at the SAME
  // cells in the SAME order as the cart. Untagged sites / spent queues fall back
  // to the LFSR.
  if (state.prngReplayBySite && site != null) {
    const q = state.prngReplayBySite.get(site);
    if (q && q.idx < q.bytes.length) return q.bytes[q.idx++]! & 0xff;
  }
  const replay = state.prngReplay;
  if (replay && state.prngReplayIdx < replay.length) {
    return replay[state.prngReplayIdx++]! & 0xff;
  }
  return lfsr;
}
