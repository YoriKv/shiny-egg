// Ext object 0x49 — treetop_grass (Bank12 ext init table).
//
// Ports CODE_extobj_handler_treetop_grass ($12:8AC1, aka CODE_extobj_handler_treetop_grass;
// yi/Banks/Bank12.asm:1864). Reached via the DATA_extended_object_init_ptrs /
// DATA_extended_object_init_ptrs ext init-pointer table at extID 0x49.
//
// Shape: WALKER-DRIVEN (shape 2) — a single-row, 3-wide horizontal strip
// (tree-top grass tuft). The init tail-calls CODE_walker_setup_trampoline
// with the per-cell stamper CODE_12ACBB; the walker runs synchronously and
// invokes the stamper once per column cell. (xref: handler
// `calls CODE_walker_setup_trampoline`, `refs CODE_12ACBB`.)
//
// Init handler (CODE_extobj_handler_treetop_grass, $12:8AC1):
//
//   REP #$20
//   LDA $1B : AND #$0F0F : DEC : AND #$0F0F : STA $00   ; sub-X nibble -= 1
//   LDA $1B : AND #$F0F0 : ORA $00 : STA $1B            ; keep screen nibbles
//   LDA #$0003 : STA $2A                                ; col extent = 3 (3-wide)
//   LDA #$0001 : STA $2E                                ; row extent = 1 (1 tall)
//   LDX #(CODE_12ACBB-1)>>16 : LDA #CODE_12ACBB-1
//   JMP CODE_walker_setup_trampoline                    ; slope 0; stamper in all slots
//
// $2A is the column EXTENT; the walker terminates when the column counter
// $28 reaches $2A (== 3), so it visits columns 0, 1, 2 — a 3-wide strip
// (the spec trace stamps exactly those 3 columns).
//
// The `$1B` mutate is a sub-X-nibble decrement (the cart works on the
// 16-bit $1B:$1C word, decrements only the $0F0F sub-position nibbles, and
// re-ORs the $F0F0 screen nibbles). The spec confirms $1B 0F→0E (sub-X
// 0xF→0xE, sub-Y unchanged): the strip's left edge starts one sub-tile to
// the left of the placed cell. $15 (orientation = 0x49) is ignored — no
// variants.
//
// Per-cell stamper (CODE_12ACBB, $12:ACBB):
//
//   REP #$30
//   LDA $28 : ASL : TAY            ; Y = column counter * 2
//   LDX $1D
//   LDA DATA_12ACCD,y             ; word table indexed by column
//   STA buffer,x                  ; stamp
//
// So map16 = DATA_12ACCD[column]. The spec timeline matches: col0→$3D4D
// (Y=0), col1→$3D4E (Y=2), col2→$3D4F (Y=4).
import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12ACCD ($12:ACCD, yi/Banks/Bank12.asm:6472 — `dw $3D4D,$3D4E,$3D4F`):
// per-column Map16 IDs (16-bit words), indexed by the walker column counter.
// Exactly 3 entries (the strip is 3-wide); all three are spec-verified.
const DATA_12ACCD = [0x3d4d, 0x3d4e, 0x3d4f] as const;

// CODE_extobj_handler_treetop_grass ($12:8AC1).
function initTreetopGrass(state: DecodeState): void {
  // Sub-X-nibble decrement on the $1B:$1C word ($0F0F sub-nibbles only,
  // $F0F0 screen nibbles preserved) — matches the cart's
  // AND #$0F0F : DEC : AND #$0F0F : ORA (orig & $F0F0).
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subDec = ((word1B & 0x0f0f) - 1) & 0x0f0f;
  const newWord = (subDec | (word1B & 0xf0f0)) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  state.zp2A = 3; // column extent → 3-wide row
  state.zp2E = 1; // row extent → single row
  walkerSetupTrampoline(state, perCellTreetopGrass);
}

// CODE_12ACBB ($12:ACBB): map16 = DATA_12ACCD[column counter].
const perCellTreetopGrass: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const id = DATA_12ACCD[col];
  if (id !== undefined) stampCell(state, id);
};

export function installExtTreetopGrassHandlers(): void {
  registerExtObjectHandler(0x49, initTreetopGrass);
}
