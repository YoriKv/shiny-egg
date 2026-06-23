// Frame-0 animated-palette overlay — asm-first port of the cart's per-frame
// palette-animation handlers (`DATA_animation_palette_ptr` at `$01:C454`, 20
// entries; routines `anim_pal_*` / `CODE_01C4xx..C968` in Bank01).
//
// # Why this exists
//
// Header field 11 (`LevelHeaderAnimationPalette`) selects one of ~19 per-frame
// palette-cycle routines that `CODE_main_gamemode_0F` (the in-level gameplay
// loop) runs EVERY frame, overwriting specific CGRAM rows via
// `copy_anim_palette_row` ($01:C9CF). So the colours the cart actually shows
// in-level differ from the static `scene_palette_layout` load (our
// `loadLevelPalettes`) on those rows — e.g. type $01 overwrites BG1 palette row
// 4 (CGRAM colour 67+). Without this overlay the editor shows the static base
// palette the cart only displays for ~1 fade-in frame.
//
// # What "frame 0" means here
//
// These are CYCLING effects with no single static frame. We render the
// PHASE-0 / level-entry resting palette: every cycle counter ($0B73/$0B75/
// $0B77/$0B79) and the global animation frame ($7974) are 0 at level entry
// (cleared by the bulk WRAM clear on load), so each routine's source-table
// index resolves to 0. We DELIBERATELY DO NOT simulate the per-frame counter
// tick (some routines underflow-and-advance on the literal first frame, or gate
// their write on a velocity/interval counter and write nothing on frame 0) —
// the phase-0 base row is the meaningful "what this level looks like" snapshot,
// and it's also what GoldenEgg renders. HEADER-dependent branches (BG1 tileset,
// BG2/BG3 palette) ARE replicated — they're real, not counter-driven.
//
// Verified against the asm, NOT GoldenEgg (GE has documented inaccuracies — e.g.
// for type $10 GE reads source index 7 where the cart's `$0B77` counter gives
// index 0; we follow the cart).
//
// # Source data
//
// Every source row lives in cart bank `$5F` (a 64 KB SuperFX-mapped data bank →
// PC `$1F0000 + addr`, the same region as the master palette blob at
// `$5F:A000`). `copy_anim_palette_row` copies `$0E` BYTES from `$5F:src` into the
// live CGRAM mirror `$702000` (DMA'd to PPU each NMI) at byte-offset X — so a
// write is `cgram[X + i] = rom[$5F:src + i]`. CGRAM colour N = byte 2N. The
// per-type source addresses below are the index-0 entries of the Bank01 pointer
// tables (`DATA_01C47F`, `DATA_01C574`, …); they are cart-static (deep colour
// data, never editor-mutated), so they're inlined with asm citations rather than
// symbol-resolved.

import { snesToPC } from './symbol-map.ts';

const CGRAM_BYTES = 512;
/** Bank $5F base (PC). All animated-palette source rows are $5F:addr. */
const BANK_5F = 0x5f0000;

/** Header field 11 == this → no per-frame palette animation (`anim_pal_00_noop`). */
const ANIM_NONE = 0x00;

/**
 * Overlay the cart's phase-0 animated palette for `header[11]` onto `cgram`,
 * in place. Call AFTER the static `loadLevelPalettes` (+ any palette-edit /
 * resource-to-base passes) on a RENDER/canvas CGRAM — NOT on the editable-
 * palette panel's CGRAM (the panel edits the static base, mapped to the master
 * blob via provenance; the animated rows come from separate $5F tables with no
 * editable provenance). No-op when `header[11] == 0`.
 *
 * `header` is the unpacked 15-field level header (reads field 11 = animation
 * palette, 1 = BG1 tileset, 4 = BG2 palette, 6 = BG3 palette).
 */
export function applyAnimatedPalette(
  rom: Uint8Array,
  cgram: Uint8Array,
  header: readonly number[]
): void {
  const animPal = header[9 + 2] ?? 0; // header[11]
  if (animPal === ANIM_NONE) return;
  if (cgram.length < CGRAM_BYTES) {
    throw new RangeError(`applyAnimatedPalette: cgram is ${cgram.length} bytes, need ${CGRAM_BYTES}`);
  }
  const bg1Tileset = header[1] ?? 0;
  const bg2Palette = header[4] ?? 0;
  const bg3Palette = header[6] ?? 0;

  /** copy_anim_palette_row: `n` bytes from `$5F:src` → `cgram[x..]`. */
  const row = (src: number, x: number, n: number): void => {
    const pc = snesToPC(BANK_5F | (src & 0xffff));
    for (let i = 0; i < n; i++) {
      const d = x + i;
      if (d >= 0 && d < CGRAM_BYTES && pc + i < rom.length) cgram[d] = rom[pc + i]!;
    }
  };

  // --- Shared sub-routines (asm labels in comments), all at phase 0 ----------
  // C5C1: INC $0B73 → (0&$38)<<1 = idx 0 → DATA_5FDA00; X=$E2, 16 bytes.
  const c5c1 = (): void => row(0xda00, 0xe2, 0x10);
  // C611: ($7974&$18)>>2 = idx 0 → DATA_01C5EA[0]=$5F:A150; X=$A6, 8 bytes.
  const c611 = (): void => row(0xa150, 0xa6, 0x08);
  // C702: ($7974&$18)>>2 = idx 0 → DATA_01C6FA[0]=$5F:E2EC; X=$A6, 8 bytes.
  const c702 = (): void => row(0xe2ec, 0xa6, 0x08);
  // C644: only when (BG1Tileset & 7)==0 → DATA_01C634[0]=$5F:F5CE (X=$86,26B)
  //       then +$1A → $5F:F5E8 (X=$04, 12B).
  const c644 = (): void => {
    if ((bg1Tileset & 7) === 0) {
      row(0xf5ce, 0x86, 0x1a);
      row(0xf5e8, 0x04, 0x0c);
    }
  };
  // C85D: BG2Palette bit 0 selects source row (DATA_01C836[0]=$5F:F76E, +$10
  //       for odd) and CGRAM dest (DATA_01C846 = {$D0 even, $C8 odd}); 16 bytes.
  const c85d = (): void => {
    const odd = bg2Palette & 1;
    row(0xf76e + odd * 0x10, odd ? 0xc8 : 0xd0, 0x10);
  };
  // C5F2: JSR C5C1; then DATA_01C634[0]=$5F:F5CE (X=$86,26B); then C611.
  const c5f2 = (): void => {
    c5c1();
    row(0xf5ce, 0x86, 0x1a);
    c611();
  };
  // C84E: BG1Tileset==8 → C702 else C611; then C85D.
  const c84e = (): void => {
    if (bg1Tileset === 8) c702();
    else c611();
    c85d();
  };
  // C8CB: DATA_01C8B3[0]=$5F:F760 (X=$92,14B); then C5C1.  (asm uses $0B77=0 →
  //       index 0; GE's frame-0 reads index 7 here — we follow the cart.)
  const c8cb = (): void => {
    row(0xf760, 0x92, 0x0e);
    c5c1();
  };
  // C4D9 ($02) phase-0 base: DATA_5FA190[0]; X=$0A (colour 5), 6 bytes.
  const c4d9 = (): void => row(0xa190, 0x0a, 0x06);

  switch (animPal) {
    case 0x01: // anim_pal_01_random_cycle: DATA_01C47F[0]=$5F:EB4A, X=$86, 26B.
      row(0xeb4a, 0x86, 0x1a);
      break;
    case 0x02: // anim_pal_02_dir_aware_cycle (velocity-gated; phase-0 base row).
      c4d9();
      break;
    case 0x03: // anim_pal_03_globalframe_cycle: DATA_5FCCEA, X=$E0, 32B.
      row(0xccea, 0xe0, 0x20);
      break;
    case 0x04: // CODE_01C584: DATA_01C574[0]=$5F:EA5A, X=$E2, 30B.
      row(0xea5a, 0xe2, 0x1e);
      break;
    case 0x05: // CODE_01C5BE: JSR C644; fall into C5C1.
      c644();
      c5c1();
      break;
    case 0x06: // CODE_01C5F2.
      c5f2();
      break;
    case 0x07: // CODE_01C62D: JSR C5C1; JSR C5F2.
      c5c1();
      c5f2();
      break;
    case 0x08: // CODE_01C682: DATA_01C67A[0]=$5F:A170, X=$A6, 8B.
      row(0xa170, 0xa6, 0x08);
      break;
    case 0x09: { // CODE_01C6BB: 1 word from DATA_5FC932 → CGRAM colours 1 and 9.
      const pc = snesToPC(BANK_5F | 0xc932);
      for (const color of [1, 9]) {
        const d = color * 2;
        if (pc + 1 < rom.length) {
          cgram[d] = rom[pc]!;
          cgram[d + 1] = rom[pc + 1]!;
        }
      }
      break;
    }
    case 0x0a: // CODE_01C702.
      c702();
      break;
    case 0x0b: // CODE_01C728: DATA_01C718[0]=$5F:E336, X=$02, 6B.
      row(0xe336, 0x02, 0x06);
      break;
    case 0x0c: // CODE_01C783: DATA_01C773[0]=$5F:E30C, X=$02, 6B.
      row(0xe30c, 0x02, 0x06);
      break;
    case 0x0d: // CODE_01C7F2: BG3Palette bit 0 → $5F:EC32 else $5F:EC1A; X=$02, 6B.
      row(bg3Palette & 1 ? 0xec32 : 0xec1a, 0x02, 0x06);
      break;
    case 0x0e: // CODE_01C84E.
      c84e();
      break;
    case 0x0f: // CODE_01C897: DATA_01C88F[0]=$5F:F46A, X=$0A, 6B.
      row(0xf46a, 0x0a, 0x06);
      break;
    case 0x10: // CODE_01C8CB.
      c8cb();
      break;
    case 0x11: // CODE_01C906: JSR C84E (C912 writes nothing at $0B79=0).
      c84e();
      break;
    case 0x12: // CODE_01C955: JSR C702; JSR C8CB (C912 writes nothing at phase 0).
      c702();
      c8cb();
      break;
    default: // 0x13+ → CODE_01C968: JSR C4D9; JSR C85D; DATA_01C634[0]=$5F:F5CE.
      c4d9();
      c85d();
      row(0xf5ce, 0x86, 0x1a);
      break;
  }
}
