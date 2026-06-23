// Engine-side (de)compressors. YI's compressed graphics use two formats; both
// are SuperFX-decoded in-cart but we re-implement on the host so the editor
// can render without an emulator (decode) and re-pack edited graphics at build
// time without external tools (encode).
//
//   lz2  — LC_LZ2  (Lunar Compress FORMAT=1, big-endian backref). ~115 blobs.
//   lz16 — LC_LZ16 (FORMAT=15).                                   ~187 blobs.
//
// `encodeLz2` / `encodeLz16` are inverses: decode(encode(x)) === x, verified
// against both our decoders and `decomp.exe` (see `encode-verify.ts`).
//
// See per-file doc for the reference asm + DLL provenance.

export { lz2 } from './lz2.ts';
export { lz16 } from './lz16.ts';
export { encodeLz2 } from './lz2-encode.ts';
export { encodeLz16 } from './lz16-encode.ts';
export type { DecompResult } from './types.ts';
