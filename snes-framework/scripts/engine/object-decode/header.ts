// Port of UnpackLevelHeader (CODE_unpack_level_header) — bit-extracts 15 fields from
// the 10-byte level header into a 15-element number array.
//
// See yi/Banks/Bank10.asm:1075-1118 and docs/leveldataengine.md §2.
// The bit-width table is statically known:
//
//   0:5  BG color           1:4  BG1 tileset        2:5  BG1 palette
//   3:5  BG2 tileset        4:6  BG2 palette        5:6  BG3 tileset
//   6:6  BG3 palette        7:7  sprite tileset     8:4  sprite palette
//   9:5  level mode        10:6  animation tileset 11:5  animation palette
//  12:5  BG scroll rate    13:4  music             14:2  item memory
//
// Total = 75 bits; on-disk = 10 bytes with 5 unused trailing bits.

const HEADER_BIT_WIDTHS: readonly number[] = [
  5, 4, 5, 5, 6, 6, 6, 7, 4, 5, 6, 5, 5, 4, 2
];

export const HEADER_FIELD_COUNT = HEADER_BIT_WIDTHS.length;

/** Number of bytes consumed from `src` (always 10 for a well-formed header). */
export const HEADER_BYTES = 10;

/**
 * Port of `UnpackLevelHeader` at $10:8B15. Reads bits MSB-first from
 * `src[offset..offset+9]`, peeling off the per-field widths in the table
 * above, and returns the 15 unpacked field values.
 *
 * Throws if `src` doesn't have at least 10 bytes available at `offset`.
 */
export function unpackLevelHeader(
  src: Uint8Array,
  offset = 0
): { fields: number[]; bytesConsumed: number } {
  if (offset + HEADER_BYTES > src.length) {
    throw new RangeError(
      `unpackLevelHeader: src too short (need ${HEADER_BYTES} at offset ${offset}, have ${src.length})`
    );
  }
  const fields: number[] = new Array(HEADER_FIELD_COUNT);
  let bitOff = offset * 8;
  for (let i = 0; i < HEADER_FIELD_COUNT; i++) {
    const w = HEADER_BIT_WIDTHS[i];
    let v = 0;
    for (let b = 0; b < w; b++) {
      const byte = src[bitOff >>> 3];
      const bit = 7 - (bitOff & 7);
      v = (v << 1) | ((byte >>> bit) & 1);
      bitOff++;
    }
    fields[i] = v;
  }
  return { fields, bytesConsumed: HEADER_BYTES };
}
