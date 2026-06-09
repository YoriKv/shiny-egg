// Bank13 decoration-tile-remap stamp handler + Bank12 init wrapper.
//
// Standard object $B1 — current-tile-aware decoration remap. The init
// is a bare trampoline-walker into CODE_stamp_dec_tile_remap; no DP
// mutation. The stamp is a READ-MODIFY-WRITE: it inspects the existing
// buffer cell ($12) and writes a tileset-correct replacement Map16 ID.
//
// Two paths, gated by $12 vs the constant $77B9:
//
//   1) $12 < $77B9  → "default tile" path
//      Treat $12 as an offset into the $7799 grass base; index a 12-entry
//      default-tile table by `($12 - $7799) & $000E` (word stride, four
//      slots wide before the mask wraps), then stamp.
//
//   2) $12 >= $77B9 → "match-replace" path
//      Linear scan 12-entry source-tile table for an exact match. On hit,
//      stamp the parallel target-tile table at the same Y. On miss
//      (Y scans to $0018 without a hit), no stamp.
//
// Note on the AND $000E mask: with the table having only 12 entries
// (Y=0..22 byte offsets), the &$000E mask folds Y back into the
// 0..14 range — keeping the lookup inside the first 8 entries. The
// surviving $7799-base offsets that this object naturally hits
// (single-tile grass family, $7799..$77B8) land here only via the
// init dispatcher routing, so the trace's Y=$0006 → entry $1516
// matches the table exactly.
//
// Asm sources:
//   CODE_init_decoration_tile_remap        Bank12.asm:4863 ($12:9F99)
//   CODE_stamp_dec_tile_remap              Bank13.asm:11940 ($13:E246)
//   DATA_dec_remap_source_tiles            Bank13.asm:11924 (DATA_dec_remap_source_tiles)
//   DATA_dec_remap_target_tiles            Bank13.asm:11929 (DATA_dec_remap_target_tiles)
//   DATA_dec_remap_default_tiles           Bank13.asm:11934 (DATA_dec_remap_default_tiles)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// 12-entry source-tile table (DATA_dec_remap_source_tiles). Patterns to match against $12
// when $12 >= $77B9.
const DATA_dec_remap_source_tiles = [
  0x77B9, 0x77BB, 0x77C9, 0x77CC, 0x8100, 0x8101, 0x8102, 0x8103,
  0x854B, 0x854C, 0x854D, 0x854E,
] as const;

// 12-entry target-tile table (DATA_dec_remap_target_tiles). Parallel to the source table
// — the replacement stamped on a match.
const DATA_dec_remap_target_tiles = [
  0x1519, 0x1519, 0x1519, 0x1519, 0x1517, 0x1517, 0x1517, 0x1517,
  0x151C, 0x151D, 0x151D, 0x151D,
] as const;

// 12-entry default-tile table (DATA_dec_remap_default_tiles). Used when $12 < $77B9 — the
// existing tile is interpreted as a $7799-base offset.
const DATA_dec_remap_default_tiles = [
  0x1513, 0x1514, 0x1515, 0x1516, 0x0000, 0x0000, 0x0000, 0x0000,
  0x1513, 0x1514, 0x1518, 0x1516,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_dec_tile_remap ($13:E246, Bank13.asm:11940).
//
//   REP #$30
//   LDA $12
//   CMP #$77B9
//   BCC default_path
//
//   ; match-replace path
//   LDY #$0000
//   loop:
//     CMP DATA_dec_remap_source_tiles,y
//     BEQ hit
//     INY ; INY
//     CPY #$0018
//     BCC loop
//     BRA exit                  ; no match → no stamp
//   hit:
//     LDA DATA_dec_remap_target_tiles,y
//     BRA stamp
//
//   default_path:
//     SEC ; SBC #$7799 ; AND #$000E ; TAY
//     LDA DATA_dec_remap_default_tiles,y
//   stamp:
//     LDX $1D ; STA.l buffer,x
//   exit:
//     SEP #$30 ; RTL
// ─────────────────────────────────────────────────────────────────────

const stampDecTileRemap: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;

  if (cur < 0x77B9) {
    // Default-tile path: ($12 - $7799) & $000E indexes the table as words.
    const byteY = ((cur - 0x7799) & 0x000E) & 0xffff;
    const idx = byteY >>> 1;
    const tile = DATA_dec_remap_default_tiles[idx] ?? 0;
    stampCell(state, tile);
    return;
  }

  // Match-replace path: linear scan source-tiles for cur.
  for (let i = 0; i < DATA_dec_remap_source_tiles.length; i++) {
    if (DATA_dec_remap_source_tiles[i] === cur) {
      stampCell(state, DATA_dec_remap_target_tiles[i]!);
      return;
    }
  }
  // No match → no stamp.
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_decoration_tile_remap ($12:9F99, Bank12.asm:4863).
//
//   REP #$20
//   LDX #(CODE_stamp_dec_tile_remap-1)>>16
//   LDA #CODE_stamp_dec_tile_remap-1
//   JMP walker_setup_trampoline
//
// Bare trampoline; walker reads col_extent / row_extent / orientation
// straight from the stream-loaded DP fields. No init-time mutation.
// ─────────────────────────────────────────────────────────────────────

function initDecorationTileRemap(state: DecodeState): void {
  walkerSetupTrampoline(state, stampDecTileRemap);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installDecorationTileRemapHandlers(): void {
  registerStdObjectHandler(0xB1, initDecorationTileRemap);
}
