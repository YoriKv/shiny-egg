// Generic numeric utilities used across the object-decode pipeline.
// No state knowledge — pure value transforms only.

/** Sign-extend an 8-bit value. The cart freely interprets the same zp
 *  slots as signed or unsigned depending on context (e.g. `$28` is a
 *  signed column counter, `$2A` signed column extent, `$15` an unsigned
 *  ID byte). Use this when the cart's `BPL`/`BMI` instruction implies
 *  signed semantics on a byte-sized value. */
export function signed8(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

/** Sign-extend a 16-bit value. Used by walker step-direction math
 *  where the cart's `DATA_walker_cell_byte_delta` includes negative
 *  word offsets like `$FFE0` (-32). */
export function signed16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}
