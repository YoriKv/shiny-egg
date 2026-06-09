// Standard object $DC — IceFloorEdgeWater.
//
// Icy floor edges with water between them: a 3-row lookup-table stamp.
//
// Cart entries:
//   CODE_init_ice_floor_edge_water       @ $12:A1A9 (yi/Banks/Bank12.asm:5193)
//   CODE_stamp_ice_floor_edge_water      @ $13:F206 (yi/Banks/Bank13.asm:13878)
//   DATA_ice_floor_edge_water_top_9tiles @ $13:F1E0 (Bank13.asm:13868)
//   DATA_ice_floor_edge_water_mid_10tiles@ $13:F1F2 (Bank13.asm:13873)
//
// Lookup-driven 3-row band stamper: row 0 picks from the 9-entry "top"
// table by column-position (first / middle / last); rows 1+ pick from
// the "mid" table by $2C-derived base + col-position + odd/even phase.
// The middle-column path of row 0 also probes the cell ABOVE the
// current write and stamps it as `$0000` (cart-side overwrite — sometimes
// called the "decorator overwrite" pattern in trace specs).
//
// Init is a bare trampoline (DP diff table all "no") — all the variation
// lives in the per-cell stamp handler.
//
// Following templates:
//   - bank13-slope-3row.ts        — per-row tile-table family
//   - bank13-3section-vertical.ts — bare-trampoline 3-section pattern
//   - bank13-floor-edges.ts       — `setProbeToCurrent` → getMap16Above →
//                                    writeBuf16 overwrite-above sequence
//
// The captured trace exercises a 16×16 sweep.
// Cell 0 (col=0 row=0)  → row-0 first-col   → $13F1E0[0]    = $8C03
// Cell 16 (col=1 row=0) → row-0 middle-col  → above $0000 + curr $0000
//                                              ($13F1E2 = $0000)
// Cells col>0 rows>0 with $28&1 = 0 → DATA_ice_floor_edge_water_top_9tiles+2 lookup ($0015 etc.)
// Cells col>0 rows>0 with $28&1 = 1 → DATA_ice_floor_edge_water_mid_10tiles  lookup ($0016/$1622…)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Above } from '../fetch.ts';
import { setProbeToCurrent, stampCell, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile tables (DATA_ice_floor_edge_water_top_9tiles / DATA_ice_floor_edge_water_mid_10tiles, Bank13.asm:13868-13876).
//
// `DATA_ice_floor_edge_water_top_9tiles` is the 9-entry top table. The asm
// indexes either at offset 0 (row-0 first/mid/last col) or at offset 2
// (rows>0 col=0 / col=last — picks from the same word array but treated
// as if it overruns into `DATA_ice_floor_edge_water_mid_10tiles[0]` once Y ≥ $10).
// Byte-offset addressing makes this clean to model as a single 19-entry
// stream; we model the two arrays separately and let the "+2 offset"
// case dispatch on the appropriate table.
// ─────────────────────────────────────────────────────────────────────

const DATA_ice_floor_edge_water_top_9tiles = [
  0x8C03, 0x0000, 0x8C00, 0x8C07, 0x8C04,
  0x8C0B, 0x8C08, 0x8C0E, 0x8C0C,
] as const;

const DATA_ice_floor_edge_water_mid_10tiles = [
  0x8C0E, 0x8C0C, 0x0015, 0x0016, 0x1621,
  0x1622, 0x1623, 0x1624, 0x1625, 0x1625,
] as const;

/** Combined view: cart's row-0-with-offset reads from `DATA_ice_floor_edge_water_top_9tiles`;
 *  rows-1+ first/last col reads from `DATA_ice_floor_edge_water_top_9tiles+$02` and indexes can
 *  overrun into the mid table (e.g. Y=$10 → mid[0]). Concatenating
 *  matches the cart's contiguous byte layout. */
const DATA_ice_floor_edge_water_combined = [
  ...DATA_ice_floor_edge_water_top_9tiles,
  ...DATA_ice_floor_edge_water_mid_10tiles,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_ice_floor_edge_water ($13:F206, Bank13.asm:13878) — per-cell handler.
//
//   REP #$30
//   LDA $2C
//   BNE row_else        ; $2C != 0 → rows 1+
//   ; row-0 path: Y in {0, 2, 4}
//   LDY #0
//   LDA $28
//   BEQ y_done          ; first col → Y=0
//   INY ; INY           ; Y=2 (middle)
//   INC ; CMP $2A
//   BNE y_done          ; not last col → Y=2 (middle)
//   INY ; INY           ; Y=4 (last col)
// y_done:
//   CPY #$0002
//   BNE skip_probe      ; only middle col probes above
//   LDA $1B  STA $0E
//   JSL get_map16_above
//   LDA #$0000  STA buffer,X   ; write $0000 at cell-above offset
// skip_probe:
//   LDA DATA_ice_floor_edge_water_top_9tiles,y
//   BRA stamp
//
// ; row_else: $2C != 0
//   ASL ASL  TAY        ; Y = $2C * 4
//   LDA $2C  CMP #$0004
//   BCC under4
//   LDY #$0010          ; clamp Y at $10 for rows ≥ 4
// under4:
//   STY $00             ; save base
//   LDA $28
//   BEQ first_col       ; col=0 → use DATA_ice_floor_edge_water_top_9tiles+2,Y
//   INC  CMP $2A
//   BNE not_last        ; middle col → mid-table path
//   INY ; INY            ; last col → Y = base + 2
// first_col:
//   LDA DATA_ice_floor_edge_water_top_9tiles+$02,y
//   BRA stamp
// not_last:
//   LDA $28  AND #$0001  ASL
//   CLC  ADC $00         ; Y_idx = base + ($28 & 1) * 2
//   TAY
//   LDA DATA_ice_floor_edge_water_mid_10tiles,y
// stamp:
//   LDX $1D  STA buffer,X
// ─────────────────────────────────────────────────────────────────────

const stampIceFloorEdgeWater: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;

  let tile: number;

  if (row === 0) {
    // Row-0 path — first / middle / last column lookup into top table.
    let y: number;
    if (col === 0) {
      y = 0; // first col
    } else if (((col + 1) & 0xff) === colExt) {
      y = 4; // last col
    } else {
      y = 2; // middle col
    }

    if (y === 2) {
      // Middle-col decorator overwrite: stamp $0000 at the cell ABOVE
      // the current write before stamping the current cell. Cart writes
      // `$0000` (not a template ID), so this is a literal zero.
      setProbeToCurrent(state);
      const aboveOff = getMap16Above(state);
      writeBuf16(state, aboveOff, 0x0000);
    }

    // Y is a byte-offset into the 9-entry top table (word entries).
    tile = DATA_ice_floor_edge_water_top_9tiles[y >>> 1]!;
  } else {
    // Rows 1+ path.
    // base = (row < 4) ? row * 4 : $10 — clamps the per-row base so all
    // rows beyond the 4th reuse the same body tiles.
    const base = row < 4 ? row * 4 : 0x10;

    let tableByteOff: number;
    let mid: boolean;
    if (col === 0) {
      // First col: index DATA_ice_floor_edge_water_top_9tiles + $02 at byte offset `base`.
      tableByteOff = base;
      mid = false;
    } else if (((col + 1) & 0xff) === colExt) {
      // Last col: index DATA_ice_floor_edge_water_top_9tiles + $02 at byte offset `base + 2`.
      tableByteOff = base + 2;
      mid = false;
    } else {
      // Middle col: index DATA_ice_floor_edge_water_mid_10tiles at byte offset `base + (col&1)*2`.
      tableByteOff = base + ((col & 1) << 1);
      mid = true;
    }

    if (mid) {
      tile = DATA_ice_floor_edge_water_mid_10tiles[tableByteOff >>> 1]!;
    } else {
      // Cart's `LDA DATA_ice_floor_edge_water_top_9tiles+$02,y` treats the top + mid tables as a
      // contiguous byte stream — once `base = $10` (rows ≥ 4) the +2
      // offset crosses into mid_10tiles entries (e.g. Y=$12 → mid[0],
      // Y=$10 → top[9] which doesn't exist in the named 9-entry table
      // but does in the byte layout = mid[-1] which is top's last). The
      // `combined` array preserves that byte-contiguous view; +2 byte =
      // +1 word index from the top-table base.
      const wordIdx = (tableByteOff >>> 1) + 1; // "+$02" offset
      tile = DATA_ice_floor_edge_water_combined[wordIdx]!;
    }
  }

  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_ice_floor_edge_water ($12:A1A9, Bank12.asm:5193).
//
//   REP.b #$20
//   LDX.b #(CODE_stamp_ice_floor_edge_water-$01)>>16
//   LDA.w #CODE_stamp_ice_floor_edge_water-$01
//   JMP.w CODE_walker_setup_trampoline
//
// Bare trampoline — no DP mutations. All decisions live in the stamp
// handler; walker reads $2A / $2E (extents) directly from the stream.
// ─────────────────────────────────────────────────────────────────────
function initIceFloorEdgeWater(state: DecodeState): void {
  walkerSetupTrampoline(state, stampIceFloorEdgeWater);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installIceFloorEdgeWaterHandlers(): void {
  registerStdObjectHandler(0xDC, initIceFloorEdgeWater);
}
