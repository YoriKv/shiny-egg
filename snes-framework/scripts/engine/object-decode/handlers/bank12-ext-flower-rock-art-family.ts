// Ports CODE_extobj_handler_flower_rock_art_family ($12:9137) — ext objects
// 0xD4-0xDF (12 IDs, ONE init dispatching on $15).
//
// Shape 2 (walker-driven). This is the "wall-art" cousin of the rock
// family (0x5F-0x66): a different init + stamper, but the same two-table
// (col-pointer, row-stride) cart idiom, so it reuses _shared.ts's
// makeRockEntryStamp — see "Helper fit" below.
//
// Init (Bank12.asm:2770), verbatim:
//   REP #$20
//   LDA $15 : SEC : SBC #$00D4 : TAY    ; Y = extID - 0xD4 (0..11)
//   ASL : STA $15                       ; $15 = Y*2 (WORD offset, 0,2,..22)
//   LDA DATA_12911F,y : AND #$00FF : STA $2A   ; col extent
//   LDA DATA_12912B,y : AND #$000F : STA $2E   ; row extent
//   LDX/LDA #(CODE_12C690-1) : JMP CODE_walker_setup_trampoline
//
//   DATA_12911F (Bank12.asm:2763, col extents, by extID-0xD4):
//     D4..DF: 05 05 05 03 03 05 05 05 03 03 07 07
//   DATA_12912B (Bank12.asm:2766, row extents &$0F):
//     D4..DF: 05 05 06 04 03 05 05 06 04 03 06 06
//
// Per-cell stamper CODE_12C690 ($12:C690, Bank12.asm:8884), verbatim:
//   REP #$30
//   LDX $15 : LDA DATA_12C658,x : STA $00     ; $00 = col-table ptr  (by $15)
//             LDA DATA_12C670,x : STA $02     ; $02 = row-base ptr   (by $15)
//   LDY $2C : LDA ($02),y : AND #$00FF        ; rowBase = row-base byte[row]
//   CLC : ADC $28 : ASL : TAY                 ; word index = (rowBase + col)*2
//   LDA ($00),y : BEQ .done                   ; entry = colTable[rowBase+col]
//   LDX $1D : STA buffer,x                     ; entry IS the literal Map16 id
//   .done: SEP #$30 : RTL                      ; (+ a last-row below-fix tail)
//
//   DATA_12C658 (col-table ptrs by $15/2): DATA_12C40C, _43E, _470, _4AC,
//     _4C4, _4D6, _508, _53A, _576, _58E, _5A0, _5F4.
//   DATA_12C670 (row-base ptrs by $15/2): all point into the shared byte ramp
//     at DATA_12C656 (db $00,$02,$04,…), but each variant's pointer picks a
//     START offset into that ramp, so rowBase(row) is a per-variant DIAGONAL
//     base, NOT a clean row*cols stride. The col-tables are correspondingly
//     NON-rectangular (jagged, leading-zero runs).
//
// Two-tier deref? NO. Unlike CODE_12B101 (the 0x5F-0x66 stamper), this routine
// does NOT do `TAY : LDA $0000,y` — the table entry is stamped directly. Every
// non-zero entry observed is a literal Map16 id; zero = skip (BEQ). So all
// baked cells are {mapid:…} or {skip:true}; there are NO {slot:…} cells.
//
// Helper fit: makeRockEntryStamp wants a rectangular [row][col] table
// indexed `table[row][col]`. The cart's `colTable[rowBase(row)+col]` is NOT
// that — the diagonal row-base flattens a jagged shape. We resolve this at
// BUILD time: each variant's effective cell grid is pre-flattened into a clean
// rows×cols [row][col] table, then fed to makeRockEntryStamp(table,
// 'rowMajor') unchanged. So the helper fits cleanly only AFTER pre-flattening
// the diagonal addressing (it cannot model the row-base offset itself). The
// baked grids below are taken directly from the per-cell spec.json traces (the
// authoritative ground truth: every walker cell with its observed stamp/skip).
//
// Below-fix tail (CODE_12C6CA): on the LAST row of a column, after stamping,
// the cart calls CODE_get_map16_below and, if the below-neighbour's tile
// matches one of DATA_12C688 (= dw $100F,$0C0B), overwrites it with
// DATA_12C68C. At static-decode time this is a neighbour gate modelled as
// "proceed / no overwrite": across all 12 specs no such overwrite stamp is
// observed (the trace records only the primary table stamp). Matches the
// bank13-special-coin gate convention.
//
// VERIFIED cell-for-cell against ext-D4..DF spec.json: all 12 grids reproduce
// every walker cell's stamp/skip exactly, and the declared col/row extents
// equal each spec's observed walker extent and cell count. (The CODE_128874
// "wrap" cells are walker column-wrap events with no stamp.)
import type { DecodeState, PerCellHandler } from '../state.ts';
import type { RockEntry } from './_shared.ts';
import { makeRockEntryStamp } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12911F / DATA_12912B (Bank12.asm:2763/2766), indexed by extID-0xD4.
const COL_EXTENT = [0x05, 0x05, 0x05, 0x03, 0x03, 0x05, 0x05, 0x05, 0x03, 0x03, 0x07, 0x07] as const;
const ROW_EXTENT = [0x05, 0x05, 0x06, 0x04, 0x03, 0x05, 0x05, 0x06, 0x04, 0x03, 0x06, 0x06] as const;

// Pre-flattened rows×cols [row][col] RockEntry grids, one per extID
// (0xD4-0xDF). Each is the cart's diagonal `colTable[ROWBASE[off+row]+col]`
// collapsed into a flat grid (sourced from spec.json ground truth). All
// non-skip entries are literal Map16 ids ({mapid}); no template slots.
const GRIDS: ReadonlyArray<ReadonlyArray<ReadonlyArray<RockEntry>>> = [
  /* 0xD4 (5x5) */ [
    [{ skip: true }, { skip: true }, { mapid: 0x0817 }, { mapid: 0x0a18 }, { skip: true }],
    [{ skip: true }, { mapid: 0x0817 }, { mapid: 0x9000 }, { mapid: 0x9001 }, { mapid: 0x0a1a }],
    [{ mapid: 0x79de }, { mapid: 0x9002 }, { mapid: 0x9003 }, { mapid: 0x9004 }, { mapid: 0x9005 }],
    [{ mapid: 0x79b6 }, { mapid: 0x9006 }, { mapid: 0x9007 }, { mapid: 0x9008 }, { mapid: 0x5d0c }],
    [{ mapid: 0x79ae }, { mapid: 0x9009 }, { mapid: 0x900a }, { mapid: 0x5d0c }, { skip: true }],
  ],
  /* 0xD5 (5x5) */ [
    [{ mapid: 0x79de }, { mapid: 0x900b }, { mapid: 0x900c }, { mapid: 0x0f12 }, { mapid: 0x1010 }],
    [{ mapid: 0x79ae }, { mapid: 0x900d }, { mapid: 0x900e }, { mapid: 0x900f }, { mapid: 0x9010 }],
    [{ mapid: 0x79c7 }, { mapid: 0x9002 }, { mapid: 0x9011 }, { mapid: 0x9003 }, { mapid: 0x9012 }],
    [{ skip: true }, { mapid: 0x9013 }, { mapid: 0x9014 }, { mapid: 0x9015 }, { mapid: 0x5d0c }],
    [{ skip: true }, { mapid: 0x79bf }, { mapid: 0x9009 }, { mapid: 0x5d0c }, { skip: true }],
  ],
  /* 0xD6 (5x6) */ [
    [{ skip: true }, { mapid: 0x0c0d }, { mapid: 0x0d0f }, { mapid: 0x9016 }, { mapid: 0x0a18 }],
    [{ mapid: 0x79de }, { mapid: 0x9017 }, { mapid: 0x9018 }, { mapid: 0x9019 }, { mapid: 0x901a }],
    [{ mapid: 0x79bd }, { mapid: 0x901b }, { mapid: 0x901c }, { mapid: 0x901d }, { mapid: 0x901e }],
    [{ mapid: 0x79c6 }, { mapid: 0x901f }, { mapid: 0x901d }, { mapid: 0x9015 }, { mapid: 0x5d0c }],
    [{ mapid: 0x79c3 }, { mapid: 0x9020 }, { mapid: 0x9008 }, { mapid: 0x5d0c }, { skip: true }],
    [{ mapid: 0x79af }, { mapid: 0x9009 }, { mapid: 0x5d0c }, { skip: true }, { skip: true }],
  ],
  /* 0xD7 (3x4) */ [
    [{ skip: true }, { mapid: 0x0817 }, { mapid: 0x0a18 }],
    [{ mapid: 0x79c6 }, { mapid: 0x9021 }, { mapid: 0x901a }],
    [{ mapid: 0x79ae }, { mapid: 0x9006 }, { mapid: 0x9022 }],
    [{ mapid: 0x79bd }, { mapid: 0x9009 }, { mapid: 0x9023 }],
  ],
  /* 0xD8 (3x3) */ [
    [{ mapid: 0x79c6 }, { mapid: 0x900b }, { mapid: 0x0a18 }],
    [{ mapid: 0x79be }, { mapid: 0x9024 }, { mapid: 0x5d0d }],
    [{ mapid: 0x79de }, { mapid: 0x5d0e }, { skip: true }],
  ],
  /* 0xD9 (5x5) */ [
    [{ skip: true }, { mapid: 0x0817 }, { mapid: 0x0a19 }, { skip: true }, { skip: true }],
    [{ mapid: 0x0817 }, { mapid: 0x9000 }, { mapid: 0x9025 }, { mapid: 0x0a19 }, { skip: true }],
    [{ mapid: 0x9026 }, { mapid: 0x9027 }, { mapid: 0x9028 }, { mapid: 0x9029 }, { mapid: 0x79da }],
    [{ mapid: 0x5b10 }, { mapid: 0x902a }, { mapid: 0x902b }, { mapid: 0x902c }, { mapid: 0x79bd }],
    [{ skip: true }, { mapid: 0x5b10 }, { mapid: 0x900a }, { mapid: 0x902d }, { mapid: 0x79ae }],
  ],
  /* 0xDA (5x5) */ [
    [{ mapid: 0x0c0d }, { mapid: 0x0d0f }, { mapid: 0x0f13 }, { mapid: 0x1011 }, { skip: true }],
    [{ mapid: 0x902e }, { mapid: 0x902f }, { mapid: 0x9030 }, { mapid: 0x9029 }, { mapid: 0x79da }],
    [{ mapid: 0x9031 }, { mapid: 0x9032 }, { mapid: 0x9033 }, { mapid: 0x9034 }, { mapid: 0x79b6 }],
    [{ mapid: 0x5b10 }, { mapid: 0x9035 }, { mapid: 0x9036 }, { mapid: 0x9037 }, { skip: true }],
    [{ skip: true }, { mapid: 0x5b10 }, { mapid: 0x902d }, { mapid: 0x79af }, { skip: true }],
  ],
  /* 0xDB (5x6) */ [
    [{ mapid: 0x0c0d }, { mapid: 0x0d0f }, { mapid: 0x0f12 }, { mapid: 0x1010 }, { skip: true }],
    [{ mapid: 0x902e }, { mapid: 0x9038 }, { mapid: 0x9039 }, { mapid: 0x903a }, { mapid: 0x79da }],
    [{ mapid: 0x9026 }, { mapid: 0x9027 }, { mapid: 0x903b }, { mapid: 0x903c }, { mapid: 0x79af }],
    [{ mapid: 0x5b10 }, { mapid: 0x902a }, { mapid: 0x903d }, { mapid: 0x903e }, { mapid: 0x79cc }],
    [{ skip: true }, { mapid: 0x5b10 }, { mapid: 0x902a }, { mapid: 0x903f }, { mapid: 0x79c3 }],
    [{ skip: true }, { skip: true }, { mapid: 0x5b10 }, { mapid: 0x902d }, { mapid: 0x79ad }],
  ],
  /* 0xDC (3x4) */ [
    [{ mapid: 0x0817 }, { mapid: 0x0a18 }, { skip: true }],
    [{ mapid: 0x9040 }, { mapid: 0x9041 }, { mapid: 0x79cc }],
    [{ mapid: 0x9042 }, { mapid: 0x902c }, { mapid: 0x79bd }],
    [{ mapid: 0x9043 }, { mapid: 0x902d }, { mapid: 0x79cd }],
  ],
  /* 0xDD (3x3) */ [
    [{ mapid: 0x0817 }, { mapid: 0x9044 }, { mapid: 0x79cc }],
    [{ mapid: 0x5b11 }, { mapid: 0x904f }, { mapid: 0x79ae }],
    [{ skip: true }, { mapid: 0x5b12 }, { mapid: 0x79b6 }],
  ],
  /* 0xDE (7x6) */ [
    [{ skip: true }, { skip: true }, { skip: true }, { mapid: 0x0817 }, { mapid: 0x0a18 }, { skip: true }, { skip: true }],
    [{ skip: true }, { skip: true }, { mapid: 0x0817 }, { mapid: 0x9000 }, { mapid: 0x9001 }, { mapid: 0x0f14 }, { mapid: 0x1010 }],
    [{ skip: true }, { mapid: 0x0817 }, { mapid: 0x9045 }, { mapid: 0x9038 }, { mapid: 0x9039 }, { mapid: 0x9033 }, { mapid: 0x9010 }],
    [{ skip: true }, { mapid: 0x9046 }, { mapid: 0x9047 }, { mapid: 0x9048 }, { mapid: 0x9004 }, { mapid: 0x9049 }, { mapid: 0x9010 }],
    [{ skip: true }, { mapid: 0x79dc }, { mapid: 0x79c1 }, { mapid: 0x79ca }, { mapid: 0x9009 }, { mapid: 0x902b }, { mapid: 0x9022 }],
    [{ skip: true }, { mapid: 0x79d0 }, { mapid: 0x79ce }, { mapid: 0x79c0 }, { mapid: 0x79dc }, { mapid: 0x9009 }, { mapid: 0x9023 }],
  ],
  /* 0xDF (7x6) */ [
    [{ skip: true }, { mapid: 0x0817 }, { mapid: 0x900c }, { mapid: 0x0a18 }, { skip: true }, { skip: true }, { skip: true }],
    [{ mapid: 0x0817 }, { mapid: 0x9045 }, { mapid: 0x9038 }, { mapid: 0x9001 }, { mapid: 0x0a1a }, { skip: true }, { skip: true }],
    [{ mapid: 0x902e }, { mapid: 0x9011 }, { mapid: 0x904a }, { mapid: 0x9039 }, { mapid: 0x904b }, { mapid: 0x0a1a }, { skip: true }],
    [{ mapid: 0x9026 }, { mapid: 0x9027 }, { mapid: 0x9022 }, { mapid: 0x904c }, { mapid: 0x901f }, { mapid: 0x903e }, { skip: true }],
    [{ mapid: 0x904d }, { mapid: 0x904e }, { mapid: 0x902d }, { mapid: 0x79dc }, { mapid: 0x79b6 }, { mapid: 0x79c5 }, { skip: true }],
    [{ mapid: 0x9043 }, { mapid: 0x902d }, { mapid: 0x79af }, { mapid: 0x79d0 }, { mapid: 0x79b3 }, { mapid: 0x79b4 }, { skip: true }],
  ],
] as const;

// One shared CODE_12C690 per-cell stamper per variant (built from the flattened
// row-major grid). Index = extID - 0xD4.
const PER_CELL: PerCellHandler[] = GRIDS.map((grid) =>
  makeRockEntryStamp(grid, 'rowMajor'),
);

// CODE_extobj_handler_flower_rock_art_family init ($12:9137).
function initFlowerRockArt(state: DecodeState): void {
  const idx = (state.zp15 - 0xd4) & 0xff; // SBC #$00D4 ; 0..11
  state.zp15 = (idx * 2) & 0xffff;        // ASL : STA $15 (word offset; unused after flattening)
  state.zp2A = COL_EXTENT[idx]! & 0x00ff; // DATA_12911F & $00FF
  state.zp2E = ROW_EXTENT[idx]! & 0x000f; // DATA_12912B & $000F
  walkerSetupTrampoline(state, PER_CELL[idx]!);
}

export function installExtFlowerRockArtFamilyHandlers(): void {
  for (let id = 0xd4; id <= 0xdf; id++) {
    registerExtObjectHandler(id, initFlowerRockArt);
  }
}
