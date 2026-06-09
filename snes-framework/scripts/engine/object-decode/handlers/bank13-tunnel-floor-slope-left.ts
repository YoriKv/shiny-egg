// Bank13 tunnel-floor-slope-left stamp handlers (std objects $5C / $5D / $5E).
//
// Tunnel floor sloping down-left — the parallel 3-variant family to the
// down-right slopes ($59/$5A/$5B): $5C gradual, $5D medium, $5E steep.
//
// Cart entry points:
//   CODE_init_tunnel_floor_slope_left ($12:98F5, Bank12.asm:3877)
//   DATA_tunnel_floor_slope_variant_stamps  ($12:98E9) — reused 3-entry stamp-ptr table.
//   DATA_tunnel_floor_slope_left_steps ($12:9938) — 3-entry positive $17 step table.
//   CODE_stamp_tunnel_floor_slope_v0/v1/v2  — identical to the $59/$5A/$5B family.
//
// This is the down-left parallel of CODE_init_tunnel_floor_slope_right ($12:989C).
// Per-cell stamping is byte-identical — same 3 stamp handlers, indexed
// against the same DATA_tunnel_floor_slope_variant_stamps stamp-pointer table. Only the init wrapper
// differs:
//
//   down-right ($59/$5A/$5B)               | down-left ($5C/$5D/$5E)
//   ---------------------------------------|---------------------------------------
//   X = (($15 & 3) - 1) << 1                | X = ($15 & 3) << 1
//     ($59→0, $5A→2, $5B→4)                 |   ($5C→0, $5D→2, $5E→4)
//   $17 = DATA_tunnel_floor_slope_right_steps[X]                    | $17 = DATA_tunnel_floor_slope_left_steps[X]
//     ($FFFF, $FFFF, $FFFE — negative)      |   ($0001, $0001, $0002 — positive)
//   $2E += 1; $2A += 2                      | $2A += 2  (no $2E bump)
//   $1B's screen-Y nibble -= $10            | (omitted — no row-up shift)
//   $1B's sub-X nibble    -= 1              | $1B's sub-X nibble -= 1
//
// Trace spec verification:
//   - std $5C: pre $1B=$34 post $33  (Δ=$FF — sub-X-only).
//              col_extent 0002→0004 (+2). row_extent unchanged.
//   - std $5D: pre $1B=$28 post $27  (Δ=$FF).
//              col_extent 0001→0003. row_extent unchanged.
//   - std $5E: pre $1B=$19 post $18  (Δ=$FF).
//              col_extent 0001→0003. row_extent unchanged.
//
// The positive $17 step means the diagonal sweeps the opposite direction
// (down-left — the slope "rises" through subsequent columns rather than
// falls). The per-cell handlers don't care about $17's sign — it's
// consumed by the walker between column transitions to step the cursor
// along the slope.
//
// Stamps reused (no duplication) — see `bank13-tunnel-floor-slope-right.ts`
// for the per-cell logic; only the init wrapper lives here.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import {
  stampTunnelFloorSlopeV0,
  stampTunnelFloorSlopeV1,
  stampTunnelFloorSlopeV2,
} from './bank13-tunnel-floor-slope-right.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_init_tunnel_floor_slope_left (Bank12.asm:3877).
// Shared init for std $5C / $5D / $5E.
// ─────────────────────────────────────────────────────────────────────

const VARIANT_STAMPS: readonly PerCellHandler[] = [
  stampTunnelFloorSlopeV0,
  stampTunnelFloorSlopeV1,
  stampTunnelFloorSlopeV2,
];

// DATA_tunnel_floor_slope_left_steps (Bank12.asm:3912).
// Per-variant $17 positive step. Mirrors DATA_tunnel_floor_slope_right_steps
// but with sign flipped: v0/v1 advance +1 column-unit/row, v2 advances +2.
const DATA_tunnel_floor_slope_left_steps = [0x0001, 0x0001, 0x0002] as const;

// Merge: object IDs 0x5C, 0x5D, 0x5E share this handler.
function initTunnelFloorSlopeLeft(state: DecodeState): void {
  // Step 1: variant index from $15 bits 0-1 (NO decrement vs. down-right).
  //   X = ($15 & 3) << 1 → 0 / 2 / 4 for $5C / $5D / $5E.
  const variantWordIdx = state.zp15 & 0x03;
  const stamp = VARIANT_STAMPS[variantWordIdx];
  if (!stamp) {
    // ($15 & 3) == 3 is not used by any std object in the $5C-$5E family;
    // bail rather than indexing into junk.
    return;
  }

  // Step 2: $19 = $7FFF (unbounded — walker terminates on $2C==$2E).
  //         Handled inside walkerSetupKeepSlope below.

  // Step 3: $17 = DATA_tunnel_floor_slope_left_steps[variantWordIdx]
  //   ($0001 / $0001 / $0002). Positive step — slope rises (down-left).
  state.zp17 = DATA_tunnel_floor_slope_left_steps[variantWordIdx]!;

  // Step 4: $2A += 2.  (NO $2E increment — the down-left family doesn't
  // push the row count up, unlike down-right which adds a slope-cap row.)
  state.zp2A = (state.zp2A + 2) & 0xff;

  // Step 5: Adjust $1B as a 16-bit word — sub-X nibble -= 1. The
  // screen-Y nibble is left alone (NO row-up shift). Cart reads $1B as
  // a 16-bit value covering $1B:$1C.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const screenKeep = word1B & 0xf0f0;
  const subKeep = (word1B & 0x0f0f);
  const subDec = (subKeep - 1) & 0x0f0f;
  const newWord = (screenKeep | subDec) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // Step 6: walker_setup keep-slope (the pre-set $17 must survive).
  walkerSetupKeepSlope(state, stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installTunnelFloorSlopeLeftHandlers(): void {
  registerStdObjectHandler(0x5C, initTunnelFloorSlopeLeft);
  registerStdObjectHandler(0x5D, initTunnelFloorSlopeLeft);
  registerStdObjectHandler(0x5E, initTunnelFloorSlopeLeft);
}
