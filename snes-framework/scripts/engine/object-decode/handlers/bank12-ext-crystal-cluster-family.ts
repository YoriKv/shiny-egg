// Ports CODE_extobj_handler_crystal_cluster_family ($12:8FB9, Bank12.asm:2572)
// + its per-cell stamper CODE_12C0B1 ($12:C0B1, Bank12.asm:8372).
//
// Extended-object init handler shared by ext IDs 0xAD..0xB2 (the 6-way
// "crystal cluster" tile family). SHAPE 2 — walker-driven (NOT single-cell).
// Dispatch key = $15 (the extID), re-encoded by the init to variant*2.
//
// Asm (init, verbatim, Bank12.asm:2572):
//   REP #$20
//   JSL CODE_prng : AND #$0006 : TAY                ; pick a random variation
//   LDA DATA_128FA5,y : STA $A1                      ;   -> tile-add offset $A1
//   LDA #$0002 : STA $2A                             ; col extent = 2 (const)
//   LDA $15 : SEC : SBC #$00AD : ASL : STA $15 : TAY ; $15 = (extID-0xAD)*2
//   LDA DATA_128FAD,y : STA $2E                      ; row extent (per variant)
//   LDX #(CODE_12C0B1-1)>>16 : LDA #CODE_12C0B1-1
//   JMP CODE_walker_setup_trampoline
//
//   DATA_128FA5 (Bank12.asm:2565): dw $0000,$000E,$001C,$002A  ; $A1 pool
//   DATA_128FAD (Bank12.asm:2568): dw $0003,$0003,$0002,$0002,$0002,$0002
//
// Asm (stamper CODE_12C0B1, verbatim, Bank12.asm:8372):
//   REP #$30
//   LDY $15 : LDA DATA_12C0A5,y : STA $00     ; ptr to this variant's tiles
//   LDA $2C : ASL : ADC $28 : ASL : TAY       ; byte off = (row*2+col)*2
//   LDA ($00),y : CLC : ADC $A1               ; base tile + variation offset
//   LDX $1D : STA !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30 : RTL
//
// Tile tables, transcribed VERBATIM from the asm `dw` lines (NOT a ROM
// byte-read, so V1.0/V1.1-stable). ROW-MAJOR, cols=2, indexed (row*2 + col):
//   AD DATA_12C06D (8351): 8D54 8D55 8D56 8D57 8D58 8D59  (2x3)
//   AE DATA_12C079 (8354): 8D54 8D55 8D56 8D5A 8D58 8D5B  (2x3)
//   AF DATA_12C085 (8357): 8D5C 8D5D 8D5E 8D5F            (2x2)
//   B0 DATA_12C08D (8360): 8D5C 8D5D 8D60 8D5F            (2x2)
//   B1 DATA_12C095 (8363): 8D5C 8D5D 8D5E 8D61            (2x2)
//   B2 DATA_12C09D (8366): 8D5C 8D5D 8D60 8D61            (2x2)
//   DATA_12C0A5 (8369, ptr table) = {06D,079,085,08D,095,09D} in extID order.
//
// PRNG variation offset ($A1): the init seeds $A1 from a CODE_prng pick out
// of DATA_128FA5 = {$0000,$000E,$001C,$002A} (indexed by prng&6, i.e. one
// of the 4 entries). The picked offset is ADDed to every stamped tile,
// selecting one of 4 crystal-COLOR variants (each variant block is a
// contiguous $0E-tile run: $8D54-$8D61, +$0E, +$1C, +$2A). The cart's PRNG
// is HV-counter noise our static LFSR cannot reproduce.
//
// The $A1 color offset is PRNG-picked from DATA_128FA5 = {0,$0E,$1C,$2A} by
// `prng & 6` (init, once per object). We roll it faithfully via prngNext: under
// per-site replay (RNG_SITE.crystalClusterInit) it reproduces a captured run's
// color exactly; otherwise the LFSR picks a valid color (cosmetic — same $8Dxx
// page, so never a structural diff). (Earlier this was hard-coded to the single
// trace-observed value $1C, which under-modelled the per-object randomisation.)
//
// Verified per-cell (offset $1C applied) against ext-A[DEF]/B[0-2] spec.json
// mapid+buf_addr timelines: AD col0->8D70/8D72/8D74 col1->8D71/8D73/8D75;
// AE col1->8D71/8D76/8D77; AF/B0/B1/B2 all 2x2 -> 8D78/8D79 + variant pair.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { prngNext, RNG_SITE } from '../prng.ts';

const CRYSTAL_CLUSTER_BASE_ID = 0xad;

// DATA_128FA5 — the $A1 color-offset pool, PRNG-picked by `prng & 6` (byte
// offset into these 4 words). Each offset shifts the whole cluster to one of 4
// contiguous $8Dxx color variants.
const A1_POOL: readonly number[] = [0x0000, 0x000e, 0x001c, 0x002a];

// DATA_128FAD — row extent ($2E) per variant (extID order from 0xAD).
const ROW_EXTENT: readonly number[] = [0x0003, 0x0003, 0x0002, 0x0002, 0x0002, 0x0002];

// DATA_12C0A5 pointer targets — per-variant base tile tables, ROW-MAJOR
// (cols=2), indexed by (row*2 + col). Verbatim asm `dw` values (pre-$A1).
const TILE_TABLES: readonly (readonly number[])[] = [
  [0x8d54, 0x8d55, 0x8d56, 0x8d57, 0x8d58, 0x8d59], // 0xAD (2x3) DATA_12C06D
  [0x8d54, 0x8d55, 0x8d56, 0x8d5a, 0x8d58, 0x8d5b], // 0xAE (2x3) DATA_12C079
  [0x8d5c, 0x8d5d, 0x8d5e, 0x8d5f], // 0xAF (2x2) DATA_12C085
  [0x8d5c, 0x8d5d, 0x8d60, 0x8d5f], // 0xB0 (2x2) DATA_12C08D
  [0x8d5c, 0x8d5d, 0x8d5e, 0x8d61], // 0xB1 (2x2) DATA_12C095
  [0x8d5c, 0x8d5d, 0x8d60, 0x8d61], // 0xB2 (2x2) DATA_12C09D
];

// CODE_12C0B1 — per-cell stamper. $15 = variant*2 selects the tile table;
// walker counters give the cell ($2C = row, $28 = col). Cart byte offset
// (row*2 + col)*2 -> word index (row*2 + col). Adds the $A1 color offset.
const crystalClusterStamp: PerCellHandler = (state) => {
  const variant = (state.zp15 & 0xffff) >> 1;
  const table = TILE_TABLES[variant];
  if (table === undefined) return;
  const index = (state.zp2C & 0xffff) * 2 + (state.zp28 & 0xffff);
  const base = table[index];
  if (base === undefined) return; // out of table bounds — skip (defensive)
  stampCell(state, (base + (state.zpA1 & 0xffff)) & 0xffff);
};

// CODE_extobj_handler_crystal_cluster_family — init/dispatch.
function crystalClusterFamily(state: DecodeState): void {
  const extId = state.zp15 & 0xff;
  const variant = extId - CRYSTAL_CLUSTER_BASE_ID;
  if (variant < 0 || variant >= TILE_TABLES.length) return; // not ours
  // $A1 PRNG color offset — `JSL prng ; AND #6 ; TAY ; LDA DATA_128FA5,y`.
  state.zpA1 = A1_POOL[(prngNext(state, RNG_SITE.crystalClusterInit) & 0x06) >>> 1]!;
  // Col extent is the constant $0002 (`LDA #$0002 : STA $2A`).
  state.zp2A = 0x0002;
  // Re-encode $15 = variant*2 (cart `... SBC #$AD : ASL : STA $15`).
  state.zp15 = variant << 1;
  // Row extent from DATA_128FAD[variant].
  state.zp2E = ROW_EXTENT[variant];
  walkerSetupTrampoline(state, crystalClusterStamp);
}

export function installExtCrystalClusterFamilyHandlers(): void {
  for (let i = 0; i < TILE_TABLES.length; i++) {
    registerExtObjectHandler(CRYSTAL_CLUSTER_BASE_ID + i, crystalClusterFamily);
  }
}
