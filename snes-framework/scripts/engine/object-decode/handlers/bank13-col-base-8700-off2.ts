// Bank13 stamp handler for std object $CF — the "col_base_8700_off2"
// (column-pair $8702/$8704 alternating) family. A single-row-tall (in
// terms of the stream's row-extent — $2E=$0001) object whose column
// extent is taken from the stream's length-1 byte; each cell alternates
// between two Map16 IDs based on column parity:
//
//   even col ($28 & 1 == 0) → $8704
//   odd  col ($28 & 1 == 1) → $8705   (= $8704 + 1, via the cart's $28&1 → 1 add)
//
// (Looks counter-intuitive: the cart decrements $9B then ADCs ((A=1)+$8704)
// rather than offsetting by -1. The "DEC $9B" is the rewound-flag side
// effect; the alternation comes from A = $28&1 being added to the base.)
//
// Init at CODE_init_col_base_8700_off2 ($12:A109, Bank12.asm:5091):
//   $15 = 2   (or 0 if $2A < 0, i.e. column extent grows left)
//   $17 = $FFFF
//   dispatch via CODE_walker_setup_keep_slope (preserves $17) to
//   CODE_stamp_col_pair_8702_8704 ($13:EC66).
//
// $15 is the Y-index into DATA_col_pair_8702_tiles ($13:EC62 = `dw $8702, $8704`).
// $15=2 → reads the second word ($8704) — that's the std-$CF variant.
// $15=0 (when $2A is negative) → reads the first word ($8702) instead.
//
// Per-cell stamp (`CODE_stamp_col_pair_8702_8704`):
//   $9B = 0
//   if ($28 & 1) != 0:  $9B = -1 ($FFFF) ; A = 1
//   else:               $9B = 0          ; A = 0
//   A += DATA_col_pair_8702_tiles[$15/2]  (one of $8702 or $8704)
//   stamp A
//
// The rewound flag is set on odd columns so the walker rewinds the
// xy_lo nibble + bumps row extent during the column-1 row-wrap, which
// matches the trace's "$9B = FF on every other cell" pattern.
//
//
// Sibling object $CE (init_col_base_8700_off1) hits the same init shape but
// dispatches to CODE_stamp_col_base_8700 ($13:EC4C — single-cell variant
// without parity alternation) and hardcodes $15=1. Sibling $D0 (off3) also
// hardcodes $15=2 but dispatches to CODE_stamp_col_pair_8706_870A ($13:EC81 —
// different period). When those land, the init-shape can move into _shared.ts
// as `initColBase8700Family(state, $15_fixed, stampHandler)`.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ───────────────────────────────────────────────────────────────────────
// DATA_col_pair_8702_tiles @ $13:EC62 — 2-entry table indexed by $15.
// $15 is bytes (not words) into the table: $15=0 → $8702, $15=2 → $8704.
// This init forces $15 = 2, so only the second entry is used.
// ───────────────────────────────────────────────────────────────────────

const DATA_col_pair_8702_tiles = [0x8702, 0x8704] as const;

// ───────────────────────────────────────────────────────────────────────
// Per-cell stamp (CODE_stamp_col_pair_8702_8704 @ $13:EC66, Bank13.asm:13156).
// ───────────────────────────────────────────────────────────────────────

const stampColPair8702_8704: PerCellHandler = (state) => {
  // $15 is a byte index; the table holds words → divide by 2 for JS.
  const tableIdx = (state.zp15 >>> 1) & 0x01;
  const base = DATA_col_pair_8702_tiles[tableIdx]!;

  // Column-parity adds 1 to the stamped tile on odd columns and sets
  // the rewound flag so the walker rewinds the xy_lo nibble at row-wrap.
  const oddCol = (state.zp28 & 0x0001) !== 0;
  if (oddCol) {
    state.rewound = 0xffff; // cart: DEC.b $9B from 0 → -1 word-wide
    stampCell(state, (base + 1) & 0xffff);
  } else {
    state.rewound = 0x0000;
    stampCell(state, base);
  }
};

// ───────────────────────────────────────────────────────────────────────
// Init handler (CODE_init_col_base_8700_off2 @ $12:A109, Bank12.asm:5091).
// ───────────────────────────────────────────────────────────────────────

function initColBase8700Off2(state: DecodeState): void {
  // $15 = 2 by default; if $2A is negative (column extent grows left)
  // the cart clears it to 0 (selecting the $8702 table entry instead).
  state.zp15 = 0x0002;
  if ((state.zp2A & 0x8000) !== 0) {
    state.zp15 = 0x0000;
  }

  // $17 = $FFFF (per-row slope = -1 signed). The cart uses keep-slope
  // dispatch so $17 survives entry into the walker; the stamp's $9B
  // rewound-flag handling keeps the row counter from being decremented
  // on each row-wrap.
  state.zp17 = 0xffff;

  // Wires the same stamp to all 3 walker handler slots (even-col,
  // odd-col, row). Parity logic lives inside the stamp itself.
  walkerSetupKeepSlope(state, stampColPair8702_8704);
}

// ───────────────────────────────────────────────────────────────────────
// Registration.
// ───────────────────────────────────────────────────────────────────────

export function installColBase8700Off2Handlers(): void {
  registerStdObjectHandler(0xCF, initColBase8700Off2);
}
