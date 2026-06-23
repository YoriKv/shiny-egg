// Standard objects $25 / $26 — init_jungle_mud_wall_lr (left/right variants).
//
// Cart entry: CODE_init_jungle_mud_wall_lr @ $12:951C (yi/Banks/Bank12.asm:3298).
// Per-cell stamp handler: CODE_jungle_mud_wall_left_right @ $13:925C
//   (yi/Banks/Bank13.asm:2396).
// Per-side neighbour-writers:
//   CODE_jungle_mud_wall_left_body  @ $13:9278 (Bank13.asm:2413)
//   CODE_jungle_mud_wall_right_body @ $13:92E0 (Bank13.asm:2455)
// Per-side row-1+ random bodies (shared with single-edge wall objects $23/$24):
//   CODE_jungle_left_wall_random_body  @ $13:9185 (Bank13.asm:2243)
//   CODE_jungle_right_wall_random_body @ $13:91D6 (Bank13.asm:2296)
// Shared neighbour classifier:
//   CODE_jungle_wall_neighbour_classify @ $13:91F9 (Bank13.asm:2316)
//
// Init is a tiny re-encoding pass: A = $15 AND #$0002 keeps just the
// "side" bit (bit 1) — object $25 ($0010_0101) → $0000, object $26
// ($0010_0110) → $0002. The masked value is stored back to $15 and
// also used as Y to index DATA_129518; both entries point at the same
// stamp handler (CODE_jungle_mud_wall_left_right). The trampoline then
// runs the walker with that handler in all 3 slots.
//
// The "left vs right" dispatch happens INSIDE the stamp handler off of
// $15 (which is now 0 or 2): both DATA_139250 (top-row stamp tile),
// DATA_139254 (top-row random-body), and DATA_139258 (other-rows
// neighbour-writer) are 2-entry word tables indexed by that 0/2 value.
//
// Row 0:   probe-and-stamp path. JSRs the per-side neighbour-writer
//          (DATA_139258), then stamps DATA_139250,x at current cell.
//          The neighbour-writer probes the cell on the OPPOSITE side
//          ($908F/$907F band check): if it falls inside [$9090, $9094)
//          the writer overwrites that neighbour + cell-above + a chain
//          of cells one and two screen-rows above (the "mud splash"
//          seam-fix sequence). Otherwise it RTSes and the only stamp
//          is DATA_139250,x at current.
// Row 1+:  random body. PRNG roll picks $909E/$909F (left) or
//          $9062/$9063 (right), then runs the neighbour classifier
//          which inspects $12 (the cell we're about to overwrite); if
//          $12 is in one of three "already a jungle-floor seam tile"
//          ranges (page $92xx/$908x/$909x sub-ranges), the result is
//          overridden via the per-side seam-fix table (DATA_13915F for
//          left, DATA_1391AE for right).
//
// asm primary; goldenegg notes not consulted (no equivalent C# port).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import {
  getMap16Above,
  getMap16Left,
  getMap16Right,
} from '../fetch.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import {
  stampCell,
  setProbeToCurrent,
  readBuf16,
  writeBuf16,
  jungleWallNeighbourClassify,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Top-row stamp tile, indexed by $15 (0 = left variant, 2 = right).
// Bank13.asm:2376  DATA_139250  dw $9400, $9502
// ─────────────────────────────────────────────────────────────────────
const DATA_139250_TOP_ROW_TILE = [0x9400, 0x9502] as const;

// ─────────────────────────────────────────────────────────────────────
// Random-body seam-fix tables (Bank13.asm:2211, 2266).
// Indexed by Y from CODE_jungle_wall_neighbour_classify:
//   Y=0  → existing cell is in $9200..$9203  → use entry [0]
//   Y=2  → existing cell is in $9080..$9083  → use entry [1]
//   Y=4  → existing cell is in $9090..$9093  → use entry [2]
//   Y=$FFFF → no override (BMI in asm, sign-bit check on 16-bit Y)
// ─────────────────────────────────────────────────────────────────────
const DATA_13915F_LEFT_SEAM_FIX  = [0x90A0, 0x90A2, 0x9072] as const;
const DATA_1391AE_RIGHT_SEAM_FIX = [0x90A1, 0x90A3, 0x9073] as const;

// Random-body base tiles. PRNG & 1 picks variant 0 or 1; sum is the
// stamp (left: $909E/$909F, right: $9062/$9063).
const RANDOM_BODY_BASE_LEFT  = 0x909E;
const RANDOM_BODY_BASE_RIGHT = 0x9062;

// CODE_jungle_wall_neighbour_classify ($13:91F9, Bank13.asm:2316) is
// hoisted to ./_shared.ts. Shared signature returns 0/2/4/$FFFF; this
// caller indexes its seam-fix tables via (y >>> 1) so the on-hit slot
// idx is 0/1/2 (matching the prior local helper's return values).

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_mud_wall_left_body ($13:9278, Bank13.asm:2413).
//
// Probes the cell to the RIGHT (yes — the LEFT-variant body looks
// right, mirroring how left-edge walls cap their right-facing side).
// If the right neighbour's tile is in [$9090, $9094) — the jungle-mud
// edge band — write the "mud splash" seam-fix into 4 cells:
//   right     → $908F
//   above     → $964D     (one row up from current)
//   above+1   → $330D     (one row up, sub-X bumped by +$10 — i.e.
//                         the cell above the rightward neighbour)
//   above+2   → $9204     (two rows up from current, again at the
//                         shifted X)
//
// All four extra cells reuse `get_map16_above` / `get_map16_right`
// against $0E/$0F, which the cart sets up via the `LDA $1B; AND #$F0F0;
// SEC; SBC #$0010` (-1 row) / `SBC #$0020` (-2 rows) nibble math. The
// `JSL get_map16_right` calls in the asm here are actually mis-named in
// the symbol map — looking at the body output ($964D above current,
// $330D and $9204 two cells up at shifted sub-X), they are stepping
// UPWARD by 1 row then 2 rows, NOT sideways. We use getMap16Above to
// match the buffer write behaviour the spec confirms.
//
// If the right-side probe is outside [$9090, $9094), the body
// short-circuits (RTS) — the only stamp this row is DATA_139250,x at
// the current cell, written by the caller (CODE_139267).
// ─────────────────────────────────────────────────────────────────────
function jungleMudWallLeftBody(state: DecodeState): void {
  // JSR CODE_probe_right_tile: $0E ← $1B, fetch right neighbour offset,
  // read its buffer tile.
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  const rightTile = readBuf16(state, rightOff);
  if (rightTile < 0x9090 || rightTile >= 0x9094) {
    return; // CODE_1392DF RTS — no seam-fix this cell.
  }

  // Stamp $908F at the right neighbour.
  writeBuf16(state, rightOff, 0x908F);

  // One row up from current → $964D.
  setProbeToCurrent(state);
  let aboveOff = getMap16Above(state);
  writeBuf16(state, aboveOff, 0x964D);

  // Step decorations: shift the probe coord UP by 1 / 2 rows (cart `SBC
  // #$0010` / `#$0020` on the screen-Y nibble), then take the RIGHT neighbour
  // of that shifted coord — cart `JSL get_map16_right` (NOT above). So $330D
  // lands at (col+1, 1up) and $9204 at (col+1, 2up). (An earlier port used
  // getMap16Above after the shift, landing at (col, 2up)/(col, 3up) — wrong
  // cells, over-stamping the wall's own column; record $50.)
  shiftProbeUpRows(state, 1);
  let stepOff = getMap16Right(state);
  writeBuf16(state, stepOff, 0x330D);

  shiftProbeUpRows(state, 2);
  stepOff = getMap16Right(state);
  writeBuf16(state, stepOff, 0x9204);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_mud_wall_right_body ($13:92E0, Bank13.asm:2455).
//
// Mirror of the left body. Probes the LEFT neighbour; if in
// [$9090, $9094) writes:
//   left     → $907F
//   above    → $964E
//   above-1  → $3512
//   above-2  → $9205
// Same "step up by 1 / 2 rows" probe-coord recompute as the left body.
// ─────────────────────────────────────────────────────────────────────
function jungleMudWallRightBody(state: DecodeState): void {
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  const leftTile = readBuf16(state, leftOff);
  if (leftTile < 0x9090 || leftTile >= 0x9094) {
    return; // CODE_139347 RTS.
  }

  writeBuf16(state, leftOff, 0x907F);

  setProbeToCurrent(state);
  let aboveOff = getMap16Above(state);
  writeBuf16(state, aboveOff, 0x964E);

  // Mirror of the left body: shift up 1/2 rows, take the LEFT neighbour
  // (cart `JSL get_map16_left`), not above. $3512 at (col-1, 1up), $9205 at
  // (col-1, 2up).
  shiftProbeUpRows(state, 1);
  let stepOff = getMap16Left(state);
  writeBuf16(state, stepOff, 0x3512);

  shiftProbeUpRows(state, 2);
  stepOff = getMap16Left(state);
  writeBuf16(state, stepOff, 0x9205);
}

// ─────────────────────────────────────────────────────────────────────
// Mirror of the cart's `LDA $1B; AND #$F0F0; SEC; SBC #$N0N0; AND
// #$F0F0; STA $00; LDA $1B; AND #$0F0F; ORA $00; STA $0E` pattern.
// Subtracts (rowsUp * $10) from the screen-Y nibble of the probe coord
// while preserving the sub-X / sub-Y nibbles. Operates on the 16-bit
// word formed by $1B (low) and $1C (high) — necessary because the
// screen-Y nibble lives in the low byte but the subtraction can
// underflow into $1C (screen-page).
// ─────────────────────────────────────────────────────────────────────
function shiftProbeUpRows(state: DecodeState, rowsUp: 1 | 2): void {
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const sub = word1B & 0x0f0f;
  const high = ((word1B & 0xf0f0) - (rowsUp * 0x0010)) & 0xf0f0;
  const newWord = (sub | high) & 0xffff;
  // zp0E holds the 16-bit probe coord (fetch primitives read it via
  // 16-bit masks); zp0F mirrors the high byte for any callers that
  // still inspect $0F directly.
  state.zp0E = newWord;
  state.zp0F = (newWord >>> 8) & 0xff;
}

// ─────────────────────────────────────────────────────────────────────
// Row-1+ random body — shared between this object and the single-edge
// wall objects ($23/$24). Per-side base tile + PRNG variant pick, then
// neighbour-classify override.
//
// Bank13.asm:2243 (left), 2296 (right).
// ─────────────────────────────────────────────────────────────────────
function jungleWallRandomBody(state: DecodeState, side: 'left' | 'right'): void {
  const base = side === 'left' ? RANDOM_BODY_BASE_LEFT : RANDOM_BODY_BASE_RIGHT;
  const table = side === 'left' ? DATA_13915F_LEFT_SEAM_FIX : DATA_1391AE_RIGHT_SEAM_FIX;

  // `JSL CODE_prng ; AND #$0001 ; CLC ; ADC base` — note no explicit
  // CLC dependency since AND clears carry, so this matches the cart.
  //
  // This body routine is the SAME cart routine the single-edge wall objects
  // ($22/etc.) use — CODE_jungle_{left,right}_wall_random_body, JSL-return
  // $13:9189 (left) / $13:91DA (right). So the roll MUST be tagged with the
  // same per-side RNG_SITE: a level's $22 single-edge walls and its $25/$26
  // mud walls all roll at one shared cart PC and feed ONE per-site replay
  // queue, in object-stream order. Tagging here was the missing half — the
  // $22 handler already tagged, but the mud-wall side rolled UNTAGGED, so the
  // capture's mud-wall rolls had no shiny home and looked like "extra" cart
  // rolls (the rec_4c "115 phantom rolls" = its 28 $25/$26 mud walls; see
  // research/notes-bg1-trace-rng-parity.md §7.1). Verified: with both sides
  // tagged, the capture-vs-shiny per-site delta is 0 for every jungle-wall
  // record (delta tracked mud-wall count exactly while this side was untagged).
  const site = side === 'left' ? RNG_SITE.jungleLeftWallBody : RNG_SITE.jungleRightWallBody;
  const variant = prngNext(state, site) & 0x0001;
  let tile = (base + variant) & 0xffff;

  // Classify the cell we're about to overwrite ($12). On hit, override.
  // Shared classifier returns 0/2/4/$FFFF — caller divides by 2 for
  // the per-side seam-fix slot index.
  const y = jungleWallNeighbourClassify(state);
  if (y !== 0xFFFF) {
    tile = table[y >>> 1]!;
  }

  stampCell(state, tile);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_mud_wall_left_right ($13:925C, Bank13.asm:2396) — the
// per-cell handler for std objects $25 / $26 after the init's $15
// re-encoding. $15 is 0 (left) or 2 (right), selecting the side.
//
//   row 0:      JSR (DATA_139258,x)     ← per-side neighbour-writer
//               LDA DATA_139250,x       ← top-row stamp tile
//               STA buffer,$1D          ← stamp at current cell
//   row 1..N:   JMP (DATA_139254,x)     ← per-side random body
//                                         (stamps via its own LDX $1D)
// ─────────────────────────────────────────────────────────────────────
const jungleMudWallLeftRightStamp: PerCellHandler = (state) => {
  const sideIdx: 0 | 1 = (state.zp15 & 0x02) !== 0 ? 1 : 0;
  const side: 'left' | 'right' = sideIdx === 0 ? 'left' : 'right';
  const row = state.zp2C & 0xffff;

  if (row === 0) {
    // Row 0: probe + per-side seam-fix neighbour writes, then top-row stamp.
    if (side === 'left') {
      jungleMudWallLeftBody(state);
    } else {
      jungleMudWallRightBody(state);
    }
    stampCell(state, DATA_139250_TOP_ROW_TILE[sideIdx]!);
    return;
  }

  // Row 1+: random body. Stamps internally via $1D.
  jungleWallRandomBody(state, side);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_mud_wall_lr ($12:951C, Bank12.asm:3298).
//
// Tiny init: re-encode $15 to keep just bit 1 (the side selector), and
// dispatch the shared stamp handler via the standard walker trampoline
// (slope = 0, same handler in all 3 slots).
//
// The cart's `LDA DATA_129518,y ; JMP CODE_walker_setup_trampoline`
// indirection is a no-op for us: both DATA_129518 entries are the same
// handler (jungleMudWallLeftRightStamp), so we just pass it directly.
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x25, 0x26 share this handler.
function initJungleMudWallLr(state: DecodeState): void {
  state.zp15 = state.zp15 & 0x0002;
  walkerSetupTrampoline(state, jungleMudWallLeftRightStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installJungleMudWallLrHandlers(): void {
  registerStdObjectHandler(0x25, initJungleMudWallLr);
  registerStdObjectHandler(0x26, initJungleMudWallLr);
}
