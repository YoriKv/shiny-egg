// Ports CODE_extobj_handler_mushroom_cluster_pair ($12:903E) — ext objects
// $B8 / $B9 (3- and 4-mushroom underground decoration cluster). Both share ONE
// init that dispatches on the low bit of $15. Shape: WALKER-DRIVEN (shape 2).
//
// Init (CODE_extobj_handler_mushroom_cluster_pair, Bank12.asm:2642, verified against closure):
//   REP #$20
//   LDA $15 : AND #$0001 : ASL : STA $15   ; idx = $15 & 1 ; $15 := idx<<1 (0/2)
//   TAY
//   LDA DATA_129036,y : STA $2A            ; col extent (idx0=4, idx1=5)
//   LDA DATA_12903A,y : STA $2E            ; row extent (idx0=4, idx1=6)
//   LDX #(CODE_12C244-1)>>16 : LDA #CODE_12C244-1 : JMP walker_setup_trampoline
//   DATA_129036: dw $0004,$0005   DATA_12903A: dw $0004,$0006
//
// Dispatch key: $15 low bit. extID $B8 (bit0=0) -> idx 0 -> $15=$00; extID $B9
// (bit0=1) -> idx 1 -> $15=$02. (Matches both spec.json walker_setup.orientation.)
// The TS parser leaves state.zp15 = raw extID, so we recompute idx = extID & 1.
//
// Per-cell stamper (CODE_12C244, Bank12.asm:8557, verified against closure):
//   LDX $15
//   LDA DATA_12C240,x : STA $00     ; $00 = per-row word-offset table
//   LDA DATA_12C23C,x : STA $02     ; $02 = column-strip word table
//   LDA $2C : ASL : TAY : LDA ($00),y : STA $00   ; base = rowoff[row]
//   LDA $28 : ASL : ADC $00 : TAY : LDA ($02),y   ; word = strip[base + col*2]
//   BEQ skip                                       ; word==0 -> stamp nothing
//   LDY $2C : INY : CPY $2E : BEQ store             ; final row -> use word as id
//   TAY : LDA $0000,y                              ; else resolve word (abs, bank-relative)
//   store: LDX $1D : STA buffer,x
//
//   DATA_12C240: dw DATA_12C1DE, DATA_12C230   ; row-offset tables, per idx
//   DATA_12C23C: dw DATA_12C1BA, DATA_12C1E6   ; column-strip tables, per idx
//   DATA_12C1DE: dw $0000,$0008,$0010,$0018                 (idx0 row offsets)
//   DATA_12C230: dw $0000,$000A,$0014,$001E,$0028,$0032     (idx1 row offsets)
//
// The non-final-row "resolve word" step (`TAY : LDA $0000,y`) treats the strip
// word as an address: words in the per-tileset template range ($19DA..$1A5F) are
// Map16-template slots resolved via state.templateAt(); words that are $C1xx
// label addresses point at `dw $8Dxx` and resolve to that constant id. Final-row
// words are direct $8Dxx ids. A strip word of 0 -> walker visits the cell but
// the stamper writes nothing (the cluster's top-left padding).
//
// Verified cell-for-cell against BOTH spec.json per-cell timelines (B8: 4x4,
// B9: 5x6 — every stamped Map16 id and every skipped cell matches, and every
// template-slot read matches the trace's read16 slot_* events). No PRNG, no
// savefile/flag gates involved.
import type { DecodeState, PerCellHandler } from '../state.ts'
import { stampCell } from './_shared.ts'
import { walkerSetupTrampoline } from '../walker.ts'
import { registerExtObjectHandler } from './index.ts'

// DATA_129036 / DATA_12903A — extents per orientation index (idx = $15 & 1).
const COL_EXTENTS = [0x0004, 0x0005] as const // idx 0 ($B8) / idx 1 ($B9)
const ROW_EXTENTS = [0x0004, 0x0006] as const

// Per-row word offsets into the column-strip table (DATA_12C1DE / DATA_12C230).
// Stored as element indices (asm byte offsets / 2): row r -> ROW_OFFSETS[idx][r].
const ROW_OFFSETS: readonly (readonly number[])[] = [
  [0x00, 0x04, 0x08, 0x0c], // idx 0: $0000,$0008,$0010,$0018
  [0x00, 0x05, 0x0a, 0x0f, 0x14, 0x19], // idx 1: $0000,$000A,...,$0032
]

// Column-strip word tables DATA_12C1BA (idx0) / DATA_12C1E6 (idx1), with $C1xx
// label refs already resolved to their `dw $8Dxx` content. Each entry is either
// 0 (skip), a template-slot WRAM addr ($19DA..$1A5F), or a direct $8Dxx id.
const STRIP_TABLES: readonly (readonly number[])[] = [
  // DATA_12C1BA (idx 0): 12 words
  [
    0x0000, 0x1a2c, 0x1a3a, 0x19f2, 0x0000, 0x8d0d, 0x8d0e, 0x19fc, 0x1a04, 0x1a48,
    0x8d1c, 0x8d1d,
  ],
  // DATA_12C1E6 (idx 1): 25 words
  [
    0x0000, 0x19e0, 0x1a4c, 0x1a56, 0x0000, 0x0000, 0x19ea, 0x8d12, 0x8d13, 0x0000,
    0x0000, 0x8d21, 0x8d22, 0x1a38, 0x1a18, 0x19de, 0x1a4a, 0x1a54, 0x8d23, 0x8d24,
    0x19e8, 0x8d08, 0x8d25, 0x8d26, 0x8d27,
  ],
]

const isTemplateSlot = (word: number): boolean => word >= 0x19da && word <= 0x1a5f

// Ports CODE_extobj_handler_mushroom_cluster_pair ($12:903E).
// Merge: object IDs 0xB8, 0xB9 share this handler.
function initMushroomClusterPair(state: DecodeState): void {
  const idx = state.zp15 & 0x01 // $15 & 1 -> 0 ($B8) / 1 ($B9)
  state.zp15 = idx << 1 // re-encode $15 (0 / 2), read by the per-cell stamper
  state.zp2A = COL_EXTENTS[idx] // $2A col extent
  state.zp2E = ROW_EXTENTS[idx] // $2E row extent
  walkerSetupTrampoline(state, perCellMushroomClusterPair)
}

// Ports CODE_12C244 ($12:C244) — per-cell column-strip stamp.
const perCellMushroomClusterPair: PerCellHandler = (state) => {
  const idx = state.zp15 >> 1 // recover orientation index from re-encoded $15
  const col = state.zp28 & 0xff
  const row = state.zp2C & 0xff
  const rows = state.zp2E & 0xff

  const base = ROW_OFFSETS[idx][row] // ($00),y where y=row*2
  const word = STRIP_TABLES[idx][base + col] // ($02),y where y=col*2 + base*2
  if (word === 0) return // BEQ skip: padding cell, stamp nothing

  // Final row uses the strip word directly; earlier rows resolve it.
  if (row + 1 === rows) {
    stampCell(state, word)
    return
  }
  stampCell(state, isTemplateSlot(word) ? state.templateAt(word) : word)
}

export function installExtMushroomClusterPairHandlers(): void {
  registerExtObjectHandler(0xb8, initMushroomClusterPair)
  registerExtObjectHandler(0xb9, initMushroomClusterPair)
}
