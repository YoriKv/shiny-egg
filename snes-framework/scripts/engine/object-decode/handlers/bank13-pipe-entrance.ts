// Bank13 pipe-entrance stamp handlers + Bank12 init wrapper.
//
// Standard objects $BA / $BB / $BC / $BD — the "pipe entrance" family:
// a 1-D strip (either horizontal row or vertical column) whose
// endpoints are end-caps and whose interior alternates between two
// tiles based on (col & 1) or (row & 1). The four IDs are sibling
// variants — same shape, different tile sets — selected by the init
// from a 4-entry stamp-handler table via the formula `(($15 - 2) & 3)`:
//
//   ID    $15 - 2  stamp handler                                  axis    tiles
//   ───   ───────  ─────────────────────────────────────────────  ──────  ─────────────────────────
//   $BA   0        CODE_stamp_pipe_entrance_top_left  ($13:E3BB)  col     $792F $7915 $7916 $7930
//   $BB   1        CODE_stamp_pipe_entrance_top_right ($13:E3EA)  col     $7932 $7925 $7926 $7933
//   $BC   2        CODE_stamp_pipe_entrance_vertical_right ($13:E448)  row     $7930 $7910 $7920 $7933
//   $BD   3        CODE_stamp_pipe_entrance_vertical_left  ($13:E419)  row     $792F $790F $791F $7932
//
// All four stamp handlers share an identical control flow — only the
// axis ($28 col-pos vs $2C row-pos, $2A col-extent vs $2E row-extent)
// and the 4-tile lookup table differ:
//
//   LDY #$0000                  ; pos == 0 (top/left endpoint)  → Y = 0
//   LDA pos
//   BEQ done
//   LDY #$0006                  ; pos+1 == extent (bot/right)   → Y = 6
//   INC ; CMP extent
//   BEQ done
//   DEC ; AND #$0001 ; ASL      ; interior:
//   CLC ; ADC #$0002            ;   even pos → Y = 2, odd pos → Y = 4
//   TAY
// done:
//   LDX $1D ; LDA TABLE,y ; STA buffer,x
//
// The init handler is a bare 4-way dispatcher (no DP mutations — all
// four specs confirm pre-init == post-init for $1B/$1C/$2A/$2E/$15):
//
//   REP #$20
//   LDA $15 ; DEC ; DEC ; AND #$0003 ; ASL ; TAY
//   LDX #(CODE_stamp_pipe_entrance_top_left-1)>>16             ; bank byte (all 4 stamps in $13)
//   LDA DATA_pipe_entrance_stamps,y
//   JMP walker_setup_trampoline
//
// Asm sources:
//   CODE_init_pipe_entrance                   Bank12.asm:4950  ($12:A027)
//   DATA_pipe_entrance_stamps                 Bank12.asm:4946  ($12:A01F)
//   CODE_stamp_pipe_entrance_top_left         Bank13.asm:12154 ($13:E3BB)
//   DATA_edge_top_4tiles                      Bank13.asm:12150 ($13:E3B3)
//   CODE_stamp_pipe_entrance_top_right        Bank13.asm:12181 ($13:E3EA)
//   DATA_edge_top_alt_4tiles                  Bank13.asm:12177 ($13:E3E2)
//   CODE_stamp_pipe_entrance_vertical_left    Bank13.asm:12208 ($13:E419)
//   DATA_edge_vertical_left_4tiles            Bank13.asm:12204 ($13:E411)
//   CODE_stamp_pipe_entrance_vertical_right   Bank13.asm:12235 ($13:E448)
//   DATA_edge_vertical_right_4tiles           Bank13.asm:12231 ($13:E440)
//

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// 4-entry tile tables — endpoint / interior-even / interior-odd /
// endpoint. Layout matches the stamp's Y={0,2,4,6} index → word entry.
// ─────────────────────────────────────────────────────────────────────

/** DATA_edge_top_4tiles ($13:E3B3) — std $BA. */
const DATA_edge_top_4tiles: ReadonlyArray<number> = [0x792F, 0x7915, 0x7916, 0x7930];

/** DATA_edge_top_alt_4tiles ($13:E3E2) — std $BB. Mirror of top_4tiles. */
const DATA_edge_top_alt_4tiles: ReadonlyArray<number> = [0x7932, 0x7925, 0x7926, 0x7933];

/** DATA_edge_vertical_left_4tiles ($13:E411) — std $BD. */
const DATA_edge_vertical_left_4tiles: ReadonlyArray<number> = [0x792F, 0x790F, 0x791F, 0x7932];

/** DATA_edge_vertical_right_4tiles ($13:E440) — std $BC. Mirror of vertical_left. */
const DATA_edge_vertical_right_4tiles: ReadonlyArray<number> = [0x7930, 0x7910, 0x7920, 0x7933];

// ─────────────────────────────────────────────────────────────────────
// Shared stamp body — endpoint/interior parity classifier on a
// 1-D axis. `pos` is the walker's position counter on the active axis
// ($28 for col-axis variants $BA/$BB, $2C for row-axis $BC/$BD); `ext`
// is the matching extent ($2A or $2E). Returns the word index into
// the supplied 4-tile table.
// ─────────────────────────────────────────────────────────────────────

function pipeEntranceTileIndex(pos: number, ext: number): number {
  // Cart: LDY #$0000 ; LDA pos ; BEQ done — pos == 0 → endpoint A.
  if ((pos & 0xff) === 0) return 0;
  // Cart: LDY #$0006 ; INC ; CMP ext ; BEQ done — pos+1 == ext → endpoint B.
  if ((((pos & 0xff) + 1) & 0xff) === (ext & 0xff)) return 3;
  // Cart: DEC ; AND #$0001 ; ASL ; CLC ; ADC #$0002 ; TAY
  //   The DEC here UNDOES the preceding INC (which only mattered for the
  //   extent compare), so parity is on the original pos:
  //     Y = (pos & 1) * 2 + 2 → 2 (even pos) or 4 (odd pos)
  //   Divide by 2 for the word-typed table → idx 1 (even) or 2 (odd).
  return 1 + (pos & 0x01);
}

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamp handler factories — bind a 4-tile table + axis selector.
// ─────────────────────────────────────────────────────────────────────

function makeColAxisStamp(table: ReadonlyArray<number>): PerCellHandler {
  return (state) => {
    const idx = pipeEntranceTileIndex(state.zp28 & 0xff, state.zp2A & 0xff);
    stampCell(state, table[idx]!);
  };
}

function makeRowAxisStamp(table: ReadonlyArray<number>): PerCellHandler {
  return (state) => {
    // $2C is the 16-bit row counter; $2E the 16-bit row extent. The
    // stamp's CMP $2E is a 16-bit compare under REP #$30 — but in
    // practice both are < 256 for these objects, so byte-narrow.
    const idx = pipeEntranceTileIndex(state.zp2C & 0xff, state.zp2E & 0xff);
    stampCell(state, table[idx]!);
  };
}

const stampPipeEntranceTopLeft: PerCellHandler = makeColAxisStamp(DATA_edge_top_4tiles);
const stampPipeEntranceTopRight: PerCellHandler = makeColAxisStamp(DATA_edge_top_alt_4tiles);
const stampPipeEntranceVerticalRight: PerCellHandler = makeRowAxisStamp(DATA_edge_vertical_right_4tiles);
const stampPipeEntranceVerticalLeft: PerCellHandler = makeRowAxisStamp(DATA_edge_vertical_left_4tiles);

// ─────────────────────────────────────────────────────────────────────
// DATA_pipe_entrance_stamps ($12:A01F) — 4-entry dispatch
// table indexed by `(($15 - 2) & 3) * 2`. Matches the asm order
// (CODE_stamp_pipe_entrance_top_left, CODE_stamp_pipe_entrance_top_right, CODE_stamp_pipe_entrance_vertical_right, CODE_stamp_pipe_entrance_vertical_left).
// ─────────────────────────────────────────────────────────────────────

const DATA_pipe_entrance_stamps: ReadonlyArray<PerCellHandler> = [
  stampPipeEntranceTopLeft,         // $BA  ($15 - 2 = 0)
  stampPipeEntranceTopRight,        // $BB  ($15 - 2 = 1)
  stampPipeEntranceVerticalRight,   // $BC  ($15 - 2 = 2)
  stampPipeEntranceVerticalLeft,    // $BD  ($15 - 2 = 3)
];

// ─────────────────────────────────────────────────────────────────────
// CODE_init_pipe_entrance ($12:A027).
//
// Bare dispatcher: pick stamp by (($15 - 2) & 3), no DP mutation.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xBA, 0xBB, 0xBC, 0xBD share this handler.
function initPipeEntrance(state: DecodeState): void {
  const variant = ((state.zp15 - 2) & 0x03);
  const stamp = DATA_pipe_entrance_stamps[variant]!;
  walkerSetupTrampoline(state, stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installPipeEntranceHandlers(): void {
  registerStdObjectHandler(0xBA, initPipeEntrance);
  registerStdObjectHandler(0xBB, initPipeEntrance);
  registerStdObjectHandler(0xBC, initPipeEntrance);
  registerStdObjectHandler(0xBD, initPipeEntrance);
}
