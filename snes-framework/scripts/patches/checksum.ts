// SNES internal-header checksum recompute. After custom patches mutate the
// built ROM we must re-fix the checksum field, since asar only fixed it for the
// unpatched assembly. Pure (no node/DOM).
//
// YI's internal header sits at the LoROM position: the 16-bit checksum lives at
// PC $7FDE and its one's-complement at PC $7FDC (both little-endian) — see
// CLAUDE.md "PC $7FDC-$7FDF (ROM-header checksum)".
//
// Algorithm (canonical, header-content-independent): the checksum is the 16-bit
// sum of every ROM byte, where the 4-byte checksum/complement field is taken at
// its *final* value. complement = ~checksum, so per byte the field always
// contributes 0xFF (lo) + 0xFF (hi) = 0x1FE total regardless of the value. So:
// sum all bytes, subtract whatever is currently in the field, add 0x1FE, mask to
// 16 bits → checksum; complement = checksum ^ 0xFFFF. Hardware verifies
// `checksum + complement == 0xFFFF` and `fullRomSum & 0xFFFF == checksum`, both
// of which this satisfies.
//
// Assumes a single power-of-two image (YI is exactly 2 MB) — no non-power-of-two
// mirror folding (unnecessary here).

/** PC offset of the complement field (checksum field is +2). */
export const CHECKSUM_FIELD_PC = 0x7fdc;

/** The checksum that *should* be stored for `rom`, header-content-independent. */
export function computeSnesChecksum(rom: Uint8Array): number {
  if (rom.length < CHECKSUM_FIELD_PC + 4) {
    throw new Error(`computeSnesChecksum: ROM too small (${rom.length} bytes)`);
  }
  let total = 0;
  for (let i = 0; i < rom.length; i++) total += rom[i];
  for (let i = 0; i < 4; i++) total -= rom[CHECKSUM_FIELD_PC + i];
  total += 0x1fe;
  return total & 0xffff;
}

/**
 * Recompute and write the checksum + complement into `rom` in place. Returns the
 * checksum written. Idempotent — re-fixing an already-correct ROM is a no-op.
 */
export function fixSnesChecksum(rom: Uint8Array): number {
  const checksum = computeSnesChecksum(rom);
  const complement = checksum ^ 0xffff;
  rom[CHECKSUM_FIELD_PC + 0] = complement & 0xff;
  rom[CHECKSUM_FIELD_PC + 1] = (complement >> 8) & 0xff;
  rom[CHECKSUM_FIELD_PC + 2] = checksum & 0xff;
  rom[CHECKSUM_FIELD_PC + 3] = (checksum >> 8) & 0xff;
  return checksum;
}

/** The checksum currently stored in the header (PC $7FDE, little-endian). */
export function storedSnesChecksum(rom: Uint8Array): number {
  return rom[CHECKSUM_FIELD_PC + 2] | (rom[CHECKSUM_FIELD_PC + 3] << 8);
}
