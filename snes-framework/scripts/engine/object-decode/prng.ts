// PRNG — port of `get_random_byte` at `$12:8875` (yi/Banks/Bank12.asm:1495).
//
// The cart's PRNG reads the PPU HV-counter software latch + live H/V
// counters, all of which depend on real hardware timing we can't reproduce
// offline. Per docs/leveldataengine.md §3.6 the consumer use-cases are
// purely cosmetic (~50 Bank13 sites for grass/floor decoration variant
// selection, ~12 Bank12 sites for pre-walker orientation pre-randomisation).
//
// We replace the HV-counter source with a deterministic 16-bit LFSR
// (Galois form, polynomial x^16+x^14+x^13+x^11+1). Output: low 8 bits of
// the LFSR after one advance.
//
// **Tradeoff:** Map16 buffer output from our decoder will be byte-stable
// across runs but will NOT exactly match a specific cart-snapshot dump,
// because the cart-side cosmetic-variant decisions were made against
// real PPU timing. For golden-master tests we can either:
//   (a) accept "close enough" matches (most cells deterministic; only
//       grass-tuft decorations vary), or
//   (b) capture the cart's PRNG seed at the moment of level load via
//       BizHawk and feed it in here.
// For Phase 3 / 4 we go with (a). Phase 7 polish can revisit if needed.
//
// Render-diff signature (expected, cosmetic — NOT a bug): a cluster of
// same-Map16-page variant tiles (differing only in low byte) under a
// random-fill object — std-01 (bg_floor_random), std-87/88 (ledge_no_grass),
// both via DATA_floor_random_grass_8way_pool. Our LFSR selects different
// variants than a live dump; rule it out before suspecting a handler.

import type { DecodeState } from './state.ts';

export function prngNext(state: DecodeState): number {
  // 16-bit Galois LFSR — feedback bit = (b0 ^ b2 ^ b3 ^ b5) of the OUTPUT.
  let s = state.prngState & 0xffff;
  const lsb = s & 1;
  s >>>= 1;
  if (lsb) s ^= 0xb400; // taps at bits 16, 14, 13, 11 (maximal-length sequence)
  state.prngState = s & 0xffff;
  return s & 0xff;
}
