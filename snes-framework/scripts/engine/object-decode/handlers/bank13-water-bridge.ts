// Bank13 water-bridge stamp handlers + shared Bank12 init wrapper.
//
// Covered handlers:
//   $1A init_water_bridge  ($15 bit 0 == 0 → CODE_water_bridge_horizontal)
//   $1B init_water_bridge  ($15 bit 0 == 1 → CODE_water_bridge_vertical)
//
// Cart asm:
//   yi/Banks/Bank12.asm:3109 (CODE_init_water_bridge, $12:9407)
//   yi/Banks/Bank13.asm:1808 (CODE_water_bridge_horizontal, $13:8EB8)
//   yi/Banks/Bank13.asm:1850 (CODE_water_bridge_vertical,   $13:8EEF)
//
// CODE_init_water_bridge ($12:9407):
//   REP #$20
//   LDA $15 ; AND #$0001 ; TAY ; ASL ; TAX
//   LDA DATA_water_bridge_stamp_ptrs,x          ; ptr-1 word
//   LDX DATA_water_bridge_stamp_banks,y          ; bank byte
//   JMP CODE_walker_setup_trampoline
//
// — same orientation-bit-0 dispatch pattern as init_water_meets_land_or_rock.
// Both std $1A and $1B route through here; the orientation byte (= object ID)
// picks between the horizontal and vertical Bank13 stampers.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_water_bridge_horizontal ($13:8EB8) — WTRBRIDGEH stamp.
//
// Cart pseudocode (REP #$30):
//   $00 = $28 & 1                          ; column parity
//   if $28 == 0:                           ; first column
//     A = $1505                            ;   left endcap
//   else if ($28+1) == $2A:                ; last column
//     A = $1506                            ;   right endcap
//   else if $12 == $0019:                  ; overlap vertical-bridge plank
//     A = $1509                            ;   joint tile
//   else:
//     A = $1501 + ($28 & 1)                ;   alternating body $1501/$1502
//   stamp A
//
// Spec std-1A (col extent 3): cells [$1505, $1502, $1506] across cols 0..2.
// Verified: col=0→$1505; col=1 (parity 1) body→$1501+1=$1502; col=2→$1506.
// ─────────────────────────────────────────────────────────────────────

const TILE_BRIDGE_LEFT_ENDCAP  = 0x1505;
const TILE_BRIDGE_RIGHT_ENDCAP = 0x1506;
const TILE_BRIDGE_BODY_BASE    = 0x1501; // +parity → $1501 (even) / $1502 (odd)
const TILE_BRIDGE_PLANK_JOINT  = 0x1509; // overlap with vertical plank ($0019)
const TILE_VERTICAL_PLANK_MID  = 0x0019;

const waterBridgeHorizontal: PerCellHandler = (state) => {
  // STA $00 (parity latch) — read once, used in the body-fall-through.
  const parity = state.zp28 & 0x0001;

  // LDA $28 ; BNE +  → first column?
  if ((state.zp28 & 0xff) === 0) {
    stampCell(state, TILE_BRIDGE_LEFT_ENDCAP);
    return;
  }

  // INC ; CMP $2A ; BEQ +  → last column? (col+1 == col extent)
  if ((((state.zp28 & 0xff) + 1) & 0xff) === (state.zp2A & 0xff)) {
    stampCell(state, TILE_BRIDGE_RIGHT_ENDCAP);
    return;
  }

  // LDA $12 ; CMP #$0019 ; BNE + → overlap with vertical-bridge plank?
  if ((state.zp12 & 0xffff) === TILE_VERTICAL_PLANK_MID) {
    stampCell(state, TILE_BRIDGE_PLANK_JOINT);
    return;
  }

  // Body: $1501 + ($28 & 1) — alternating plank pattern.
  stampCell(state, (TILE_BRIDGE_BODY_BASE + parity) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_water_bridge_vertical ($13:8EEF) — WTRBRIDGEV stamp.
//
// 8-entry tile table DATA_138F34 (Bank13.asm:1890):
//   $1500 $0019 $001A $1400 $1615 $1616 $0000 $1509
//   ─ idx 0..2 = top/mid/bottom plank (above-water)
//   ─ idx 3..5 = top/mid/bottom plank (underwater, offset +3)
//   ─ idx 6..7 = unused/joint slots (offset +6)
//
// Cart pseudocode (REP #$30):
//   $0A = 0
//   if ($12 & $FF00) == $1600:   ; existing tile in open-water page
//     $0A = $0006                ;   shift to underwater half
//   elif $12 == $1501 or $12 == $1502:  ; overlap horizontal-bridge body
//     $0A = $000C                ;   shift to joint half (idx 6..7)
//   Y = 0
//   if $2C != 0:                 ; not top row
//     Y = 2                      ;   default to mid
//     if ($2C+1) == $2E:         ; last row
//       Y = 4                    ;   bottom
//   Y += $0A
//   stamp DATA_138F34[Y/2]
//
// Spec std-1B (row extent $10): row 0 → $1500, rows 1..14 → $0019,
// row 15 → $001A. Verified: $0A=0 throughout (cells overlap empty $0000).
// ─────────────────────────────────────────────────────────────────────

const DATA_138F34 = [
  0x1500, 0x0019, 0x001A, // 0..2: above-water top/mid/bottom
  0x1400, 0x1615, 0x1616, // 3..5: underwater top/mid/bottom (+$0006)
  0x0000, 0x1509,         // 6..7: joint slots (+$000C; entry 6 = blank)
] as const;

const MAP16_PAGE_WATER_HI    = 0x1600;
const UNDERWATER_INDEX_SHIFT = 3;  // $0A=$0006 → +3 word entries
const JOINT_INDEX_SHIFT      = 6;  // $0A=$000C → +6 word entries
const TILE_BRIDGE_HORIZ_EVEN = 0x1501;
const TILE_BRIDGE_HORIZ_ODD  = 0x1502;

const waterBridgeVertical: PerCellHandler = (state) => {
  // STZ $0A ; then conditionally set to $0006 or $000C (byte offsets;
  // we work in word indices = halved).
  let extraIdx = 0;

  const cur = state.zp12 & 0xffff;
  // LDA $12 ; AND #$FF00 ; CMP #$1600 — overlap with open-water page?
  if ((cur & 0xff00) === MAP16_PAGE_WATER_HI) {
    extraIdx = UNDERWATER_INDEX_SHIFT;
  }
  // LDA $12 ; CMP #$1501 / #$1502 — overlap with horizontal-bridge body?
  // (Note: cart falls through from the water-page test, so this branch
  //  OVERRIDES the underwater shift when both conditions hold — but the
  //  horiz-bridge body tiles ($1501/$1502) are NOT in the $1600 page, so
  //  the two checks are mutually exclusive in practice.)
  if (cur === TILE_BRIDGE_HORIZ_EVEN || cur === TILE_BRIDGE_HORIZ_ODD) {
    extraIdx = JOINT_INDEX_SHIFT;
  }

  // LDY #$0000 ; LDA $2C ; BEQ done → row=0 picks Y=0 (top plank).
  // Otherwise INY/INY (Y=2 = mid) and check INC ; CMP $2E for last row
  // (Y=4 = bottom).
  let yIdx: number;
  const row = state.zp2C & 0xff;
  if (row === 0) {
    yIdx = 0;
  } else if (((row + 1) & 0xff) === (state.zp2E & 0xff)) {
    yIdx = 2; // last row (bottom plank)
  } else {
    yIdx = 1; // mid plank
  }

  // TYA ; CLC ; ADC $0A ; TAY ; LDA DATA_138F34,y — final word index.
  const tile = DATA_138F34[(yIdx + extraIdx) & 0x07]!;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_water_bridge ($12:9407).
//
// Standard walker-trampoline init. $15 bit 0 picks between the two
// stamp routines via DATA_water_bridge_stamp_banks/DATA_water_bridge_stamp_ptrs:
//   bit 0 == 0 → CODE_water_bridge_horizontal (object $1A)
//   bit 0 == 1 → CODE_water_bridge_vertical   (object $1B)
//
// Init does NOT mutate any walker-relevant DP fields — both specs confirm
// "init handler does not mutate the walker-relevant DP fields".
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x1A, 0x1B share this handler.
function initWaterBridge(state: DecodeState): void {
  const handler =
    (state.zp15 & 0x01) === 0 ? waterBridgeHorizontal : waterBridgeVertical;
  walkerSetupTrampoline(state, handler);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installWaterBridgeHandlers(): void {
  registerStdObjectHandler(0x1A, initWaterBridge);
  registerStdObjectHandler(0x1B, initWaterBridge);
}
