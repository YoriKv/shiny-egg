// Per-tileset Map16-ID template populator.
//
// Mirror of `init_per_tileset_template_slots` (Bank10 `CODE_init_per_tileset_template_slots`,
// `yi/Banks/Bank10.asm:2164`), which the cart JSLs once at level load
// from `CODE_load_level_object_stream` to populate WRAM `$00:19DA..$1FDA`
// with per-tileset sentinel Map16 IDs. Bank13's per-cell stamp handlers
// read these via `CMP.w $1C92` etc. to pick shape-aware fallback paths
// for floor/slope/wall continuation tiles.
//
// Data table: `DATA_per_tileset_template_table` at SNES
// `$4C:D61A` → PC `$0CD61A`, 74 records, `$00`-terminated. Each record
// is 35 bytes:
//
//   db count                       ; 1B  consecutive WRAM slots to fill
//   dw ram_slot_addr               ; 2B  first slot ($19DA..$1DFC)
//   dw anchor[0..15]               ; 32B 16 anchor Map16 IDs, one per BG1TYP
//
// The loader writes `anchor[BG1TYP], anchor[BG1TYP]+1, anchor[BG1TYP]+2,
// …` for `count` consecutive 16-bit slots starting at `ram_slot_addr`.
// So e.g. the largest record in YI — `db $40 : dw $001C92` — fills 64
// slots from $1C92..$1D12 with `anchor[BG1TYP], anchor+1, …, anchor+63`.
//
// Named slot constants — `TT.FlatFloor_PageAnchor` etc. — live in
// `./template-slots.ts`, mirroring the cart's `!RAM_YI_Level_TileTpl_*`
// defines in `yi/Memory/WRAM_LevelTemplateSlots.asm`. Bank13 handler
// ports should use those rather than raw `$1C92`-style literals.
//
// Note on GoldenEgg: GE's `TilesetSpecificTileTable` constant (`Level.cs`)
// = 841242 = **$0CD61A** — the SAME address as our
// `DATA_per_tileset_template_table`. Both are correct, and GE's
// `LoadTilesetSpecificTiles` reads the identical 35-byte/record layout we
// do here. (A prior version of this note claimed GE used $0CD89A and was
// "wrong by 0x280"; that was a misattribution — verified against the live
// GE source, the constant is $0CD61A. $0CD89A *would* land inside a 65816
// sprite-spawn loop, but GE never uses it.)

import type { SymbolMap } from '../symbol-map.ts';
import { TEMPLATE_WRAM_BASE } from './state.ts';
import type { DecodeState } from './state.ts';

const RECORD_BYTES = 35;
const ANCHORS_PER_RECORD = 16; // one per BG1TYP value 0..15

/** Read a little-endian 16-bit word from `rom` at byte offset `pc`. */
function readU16LE(rom: Uint8Array, pc: number): number {
  return rom[pc]! | (rom[pc + 1]! << 8);
}

/**
 * Populate `state.templates` for the level's BG1 tileset. Must be called
 * after `state.reset(src, header)` (so `state.header[1]` = BG1TYP is set)
 * and before the master parser runs (Bank13 handlers read the templates
 * during stamp dispatch).
 */
export function populateTemplates(
  rom: Uint8Array,
  symbols: SymbolMap,
  state: DecodeState
): void {
  state.templates.fill(0);

  const tablePC = symbols.pc('DATA_per_tileset_template_table');
  const bg1Tileset = state.header[1]! & 0x0F; // BG1TYP is the 4-bit field

  for (let recordOff = 0; ; recordOff += RECORD_BYTES) {
    const recordPC = tablePC + recordOff;
    const count = rom[recordPC]!;
    if (count === 0) break; // $00 terminator

    const destAddr = readU16LE(rom, recordPC + 1);
    let anchor = readU16LE(rom, recordPC + 3 + bg1Tileset * 2);

    // Cart math: starting at `destAddr`, write 16-bit `anchor` to the
    // slot, then advance anchor by 1 and destAddr by 2, `count` times.
    const slotIdx0 = (destAddr - TEMPLATE_WRAM_BASE) >>> 1;
    for (let i = 0; i < count; i++) {
      const slotIdx = slotIdx0 + i;
      if (slotIdx >= 0 && slotIdx < state.templates.length) {
        state.templates[slotIdx] = anchor;
      }
      anchor = (anchor + 1) & 0xFFFF;
    }
  }
}
