// Engine-side (de)compressors. YI's compressed graphics use two formats; both
// are SuperFX-decoded in-cart but we re-implement on the host so the editor
// can render without an emulator (decode) and re-pack edited graphics at build
// time without external tools (encode).
//
//   lz2  — LC_LZ2  (Lunar Compress FORMAT=1, big-endian backref). ~115 blobs.
//   lz16 — LC_LZ16 (FORMAT=15).                                   ~187 blobs.
//
// `encodeLz2` / `encodeLz16` are inverses: decode(encode(x)) === x, verified
// against both our decoders and `decomp.exe` (see `encode-verify.ts`). Both
// reproduce the cart's own parse byte-for-byte, so re-encoding an unedited blob
// is a no-op and only edited blobs move — that is what keeps the build
// byte-identical to the reference cart.
//
// `encodeLz2Improved` / `encodeLz16Improved` are the same codecs with the size
// brakes off — smaller, but a *different* stream, so they can't reproduce cart
// bytes. `encodeGfxBlob` picks between the pairs: cart parse everywhere by
// default, compact parse for a blob being written into the overlay (already
// edited, so there is no cart blob left to match). The gap between the pairs is
// wildly asymmetric — 13.4% on LZ2, where a shortest-path parse is available,
// and 0.13% on LZ16, which is saturated. Both `-improved` headers carry the
// measurements.
//
// See per-file doc for the reference asm + DLL provenance.

export { lz2 } from './lz2.ts';
export { lz16, probeLz16RowCount } from './lz16.ts';
export { encodeLz2 } from './lz2-encode.ts';
export { encodeLz2Improved } from './lz2-encode-improved.ts';
export { encodeLz16 } from './lz16-encode.ts';
export { encodeLz16Improved } from './lz16-encode-improved.ts';
export type { DecompResult } from './types.ts';
