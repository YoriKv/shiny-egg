// Bank13 underwater-decor stamp handler + Bank12 init wrapper.
//
// Covers standard objects:
//   $1D  init_water_decor (underwater mushroom)  → tile $001D
//   $1E  init_water_decor (underwater flower)    → tile $001E
//
// Cart asm:
//   $12:942F  CODE_init_water_decor             (Bank12.asm:3138)
//   $13:8F77  CODE_water_decor_mushroom_flower  (Bank13.asm:1936)
//   $13:8F8B  DATA_water_decor_mushroom_flower_tiles = dw $001D, $001E
//
//
// Algorithm summary (both specs):
//   - Init does NOT mutate walker-relevant DP fields.
//   - All 3 walker slots → CODE_water_decor_mushroom_flower @ $138F76(-1).
//   - Per-cell stamp reads `$15 & $0002` to pick mushroom ($001D, $15=$1D)
//     vs flower ($001E, $15=$1E) from the 2-entry tile table.
//
// Asm reference — CODE_init_water_decor:
//
//   REP #$20
//   LDA $15 ; AND #$0001 ; TAY ; ASL ; TAX
//   LDA DATA_water_decor_stamp_ptrs,x   ; ptr-1 low word
//   LDX DATA_water_decor_stamp_banks,y  ; bank byte
//   JMP CODE_walker_setup_trampoline
//
// Both DATA_water_decor_stamp_{banks,ptrs} entries point at the same
// `CODE_water_decor_mushroom_flower`, so the X/Y indexing is functionally
// a no-op for variant selection — the orientation pick happens inside
// the stamp body via `$15 & $0002`. We mirror that directly without
// reproducing the two-table indirection.
//
// Asm reference — CODE_water_decor_mushroom_flower:
//
//   REP #$30
//   LDX $1D
//   LDA $15 ; AND #$0002 ; TAY
//   LDA DATA_water_decor_mushroom_flower_tiles,y
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30
//   RTL
//
// Sibling water-family files: bank13-water-open.ts ($16),
// bank13-water-meets-ground.ts ($17), bank13-water-meets-land-or-rock.ts
// ($18/$19). All five are unconditional walker-trampoline inits with
// per-cell stampers and minimal/no DP mutation — strong candidate for
// consolidation into a single bank13-water.ts once the family is
// complete.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_water_decor_mushroom_flower_tiles — Bank13.asm:1948.
// Y = ($15 & $0002) selects directly (Y is a byte offset into a word
// table, so word-index = Y >> 1 = 0 for $1D, 1 for $1E).
const DATA_water_decor_mushroom_flower_tiles = [0x001D, 0x001E] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_water_decor_mushroom_flower — per-cell stamper ($13:8F77).
//
// Unconditional table-pick stamp. No neighbour probing, no $12 check;
// every cell of the object's rectangle gets the same tile (the spec
// traces show 12 cells for $1D and 16 cells for $1E, all stamping the
// same Map16 ID).
// ─────────────────────────────────────────────────────────────────────
const waterDecorMushroomFlower: PerCellHandler = (state) => {
  const idx = (state.zp15 & 0x0002) >>> 1;
  stampCell(state, DATA_water_decor_mushroom_flower_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_water_decor ($12:942F).
//
// Bare trampoline — the cart's $15-bit-0 indirection through
// DATA_water_decor_stamp_banks/DATA_water_decor_stamp_ptrs picks between two table entries that BOTH
// reference CODE_water_decor_mushroom_flower, so the variant select is
// effectively a no-op at the init level. We register one shared
// init for $1D and $1E and let the stamp body do the tile pick from
// `$15 & $0002` (which equals the original object ID's bit 1).
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x1D, 0x1E share this handler.
function initWaterDecor(state: DecodeState): void {
  walkerSetupTrampoline(state, waterDecorMushroomFlower);
}

export function installWaterDecorHandlers(): void {
  registerStdObjectHandler(0x1D, initWaterDecor);
  registerStdObjectHandler(0x1E, initWaterDecor);
}
