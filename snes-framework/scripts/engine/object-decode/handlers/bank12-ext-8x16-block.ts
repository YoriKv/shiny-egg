// Extended object $0D / $0E — `CODE_extobj_handler_8x16_block`
// ("8-wide x 16-tall fixed Map16 block", rare large terrain).
//
// This is a WALKER-DRIVEN extended object, not a single inline stamp. The
// init handler (CODE_extobj_handler_8x16_block, $12:88D5) hard-codes the
// rectangle extents, re-encodes the orientation byte, and tail-calls the
// shared intra-object walker trampoline:
//
//   REP #$20
//   LDA $15 : AND #$0002 : STA $15      ; orientation := ($0D/$0E) & 2
//   LDA #$0008 : STA $2A                ; col extent = 8
//   LDA #$0010 : STA $2E                ; row extent = 16
//   LDX #(CODE_12A60F-1)>>16            ; per-cell stamper bank
//   LDA #CODE_12A60F-1                  ; per-cell stamper ptr
//   JMP CODE_walker_setup_trampoline    ; slope 0; all 3 walker slots = stamper
//
// So the walker visits an 8-col x 16-row grid in COLUMN-MAJOR order
// (outer = column 0..7, inner = row 0..15 — verified against the
// spec.json walker timeline: 128 cells, col-major). The per-cell buffer
// address (`$1D`) is produced entirely by the shared walker — there is no
// bespoke offset math here. (Re-resolve-vs-delta is handled inside the
// walker; the spec.json `buf_addr` values reproduce 1:1 via
// `intraObjectWalker` → `stampCell`.)
//
// Per-cell stamper (CODE_12A60F, $12:A60F):
//
//   Y = $2C*8 + $28                      ; row*8 + col → 0..127
//   X = $15                              ; 0 (for $0D) or 2 (for $0E)
//   ptr = DATA_12A60B[X]                 ; selects one of two 128-byte tables
//   b   = (ptr),Y & $00FF                ; fetch this cell's source byte
//   if b == $5B:            (no stamp — "blank" sentinel; RTL)
//   elif b <  $46:  tile = b + $9684
//   elif b <  $54:  tile = b + $9D46
//   else:           tile = b + $9D30
//   stamp tile
//
// The "per-cell offset" the brief mentions is therefore the cart's own
// `row*8 + col` index into a flat 128-byte source table — NOT a
// re-resolve / delta-to-$1D scheme. The two source tables (`$12:A50B`
// for $0D, `$12:A58B` for $0E) are EMBEDDED here verbatim from the cart
// ROM. Both have been verified to reproduce their spec.json per-cell
// `output_mapid` (and the `$5B`→no-stamp cells) with 0/128 mismatches.
//
// $0D and $0E differ: 34 of 128 cells differ (the $0E table substitutes
// alternate tiles in rows 2..4), so `state.zp15` IS the dispatch key and
// each id uses its own table.
//
// Asm references (closure of CODE_extobj_handler_8x16_block, bank $12):
//   $12:88D5  CODE_extobj_handler_8x16_block  (init: extents + walker)
//   $12:A60F  CODE_12A60F                      (per-cell stamper)
//   $12:A60B  DATA_12A60B                      (2-entry pointer table)
//   $12:A50B  source byte table for $0D (X=0)
//   $12:A58B  source byte table for $0E (X=2)
//
// No PRNG, no neighbour probes, no savefile/flag gates: the stamper is a
// pure (id, row, col) → byte → Map16 lookup, so the port is exact (no
// PRNG carry caveat).

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Cart source byte tables (128 bytes each = 16 rows x 8 cols), read
// verbatim from the V1.0 ROM. Indexed by Y = row*8 + col. Byte $5B is
// the "no stamp" sentinel.
// ─────────────────────────────────────────────────────────────────────

/** Source bytes for ext id $0D (DATA_12A60B[0] -> $12:A50B). */
const SRC_BYTES_0D: readonly number[] = [
  0x54, 0x55, 0x54, 0x55, 0x54, 0x55, 0x54, 0x55,
  0x56, 0x57, 0x56, 0x57, 0x56, 0x57, 0x56, 0x57,
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
  0x1c, 0x1d, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x22, 0x23, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x26, 0x27, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x2a, 0x2b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x2e, 0x2f, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x32, 0x33, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x00, 0x01, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x4d, 0x4e, 0x4f, 0x46, 0x47, 0x48, 0x49, 0x4c,
  0x51, 0x52, 0x53, 0x50, 0x4a, 0x4b, 0x53, 0x50,
  0x59, 0x58, 0x59, 0x58, 0x59, 0x58, 0x59, 0x58,
  0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a,
] as const;

/** Source bytes for ext id $0E (DATA_12A60B[1] -> $12:A58B). */
const SRC_BYTES_0E: readonly number[] = [
  0x54, 0x55, 0x54, 0x55, 0x54, 0x55, 0x54, 0x55,
  0x56, 0x57, 0x56, 0x57, 0x56, 0x57, 0x56, 0x57,
  0x00, 0x01, 0x1e, 0x21, 0x36, 0x37, 0x38, 0x39,
  0x10, 0x11, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
  0x1a, 0x1b, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45,
  0x1f, 0x20, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x24, 0x25, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x28, 0x29, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x2c, 0x2d, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x30, 0x31, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x34, 0x35, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x00, 0x01, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b, 0x5b,
  0x4d, 0x4e, 0x4f, 0x46, 0x47, 0x48, 0x49, 0x4c,
  0x51, 0x52, 0x53, 0x50, 0x4a, 0x4b, 0x53, 0x50,
  0x59, 0x58, 0x59, 0x58, 0x59, 0x58, 0x59, 0x58,
  0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a,
] as const;

/** Cart pointer table DATA_12A60B, indexed by `$15` (0 → $0D, 2 → $0E). */
const SRC_BY_ORIENT: Readonly<Record<number, readonly number[]>> = {
  0: SRC_BYTES_0D,
  2: SRC_BYTES_0E,
};

const BLOCK_COLS = 0x08; // col extent (STA $2A)
const BLOCK_ROWS = 0x10; // row extent (STA $2E)
const NO_STAMP_SENTINEL = 0x5b; // CMP #$005B : BEQ (skip stamp)

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamper. Ports CODE_12A60F ($12:A60F).
//
// The walker has already latched this cell's buffer offset into `$1D`
// (state.zp1D) and the column/row counters into `$28`/`$2C`. We index
// the orientation-selected source byte table by row*8 + col, then apply
// the cart's three-way `+base` transform.
// ─────────────────────────────────────────────────────────────────────

const stamp8x16Block: PerCellHandler = (state: DecodeState): void => {
  const src = SRC_BY_ORIENT[state.zp15 & 0x02];
  if (src === undefined) return; // orientation outside {0,2}: cart never reaches here for $0D/$0E
  const y = ((state.zp2C << 3) + state.zp28) & 0xff; // row*8 + col
  const b = src[y]! & 0xff;
  if (b === NO_STAMP_SENTINEL) return; // "blank" cell — leave buffer untouched
  let tile: number;
  if (b < 0x46) {
    tile = (b + 0x9684) & 0xffff;
  } else if (b < 0x54) {
    tile = (b + 0x9d46) & 0xffff;
  } else {
    tile = (b + 0x9d30) & 0xffff;
  }
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// Init handler. Ports CODE_extobj_handler_8x16_block ($12:88D5):
// fixed 8x16 rectangle, orientation := `$15 & 2`, single stamper in all
// walker slots, slope 0.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x0D, 0x0E share this handler.
const initExt8x16Block: InitHandler = (state: DecodeState): void => {
  state.zp15 = state.zp15 & 0x0002; // $0D → 0, $0E → 2 (selects source table)
  state.zp2A = BLOCK_COLS; // col extent = 8
  state.zp2E = BLOCK_ROWS; // row extent = 16
  walkerSetupTrampoline(state, stamp8x16Block);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. $0D and $0E share one init handler; they diverge inside
// the stamper via `state.zp15` (set to 0 / 2). The parent
// (object-decode/index.ts) wires this installer in.
// ─────────────────────────────────────────────────────────────────────

export function installExt8x16BlockHandlers(): void {
  registerExtObjectHandler(0x0d, initExt8x16Block);
  registerExtObjectHandler(0x0e, initExt8x16Block);
}
