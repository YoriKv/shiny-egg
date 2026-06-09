// SNES copier-header detection + stripping.
//
// Some ROM dumpers / copiers prepend an external 512-byte "copier header"
// (SMC/SWC) to the ROM data. It is NOT the internal cartridge header (at
// $7FC0/$FFC0) — it's an out-of-band prefix that every tool reading the ROM
// bytes must strip first, and checksums / MD5s must be computed on the stripped
// result. Detection per https://snes.nesdev.org/wiki/ROM_file_formats : a
// complete ROM is a whole number of 32/64 KB banks, so a file whose size is
// `512 (mod 1024)` carries the odd 512-byte copier header.
//
// All carts this project has worked with are unheadered; this is a defensive
// strip for user-supplied ROMs (extract + ROM import) so a headered dump still
// resolves to the same bytes (and MD5) as its unheadered form.

/** External copier-header size (SMC/SWC) — NOT the internal cart header. */
export const COPIER_HEADER_BYTES = 512;

/** True when a ROM file of `byteLength` bytes carries a 512-byte copier header
 *  (`byteLength % 1024 === 512`). */
export function hasCopierHeader(byteLength: number): boolean {
  return byteLength % 1024 === COPIER_HEADER_BYTES;
}

/** Return the ROM bytes with any 512-byte copier header removed (else the input
 *  unchanged). Returns a view (no copy). Compute checksums / MD5 on the RESULT,
 *  not the raw file. Works on `Buffer` and `Uint8Array` alike. */
export function stripCopierHeader<T extends Uint8Array>(buf: T): T {
  return (hasCopierHeader(buf.length) ? buf.subarray(COPIER_HEADER_BYTES) : buf) as T;
}
