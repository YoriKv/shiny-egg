// CGX reader — the tile format Nintendo's S-CG-CAD editor wrote, and the format
// the YI artists' working graphics are stored in.
//
// ── Layout (pinned against 287 files; every one agrees) ──────────────────────
//
//   [tile data: 1024 tiles × tileBytes]
//   [0x100 header, starting with the ASCII magic "NAK1989 S-CG-CAD Ver1.23 901226  "]
//   [0x400 per-tile attribute bytes]      ← 2bpp and 4bpp only; absent at 8bpp
//
// The header sits AFTER the pixels, so the data length is simply the magic's
// offset. Header byte `+0x20` is the depth code and is the only field this
// reader needs:
//
//   +0x20 = 0 → 2bpp, 16 bytes/tile → 0x4000 data   (33+16+10+19+… files)
//         = 1 → 4bpp, 32 bytes/tile → 0x8000 data
//         = 2 → 8bpp, 64 bytes/tile → 0x10000 data
//
// The tile COUNT is always 1024, whatever the depth — so a CGX is exactly eight
// 128-tile banks, and a 128-tile bank is exactly one YI gfx file. Bytes are
// already in SNES planar order, so a bank drops straight into VRAM.
//
// `+0x21` (0..3) and `+0x22` (0/1) also vary across the corpus; they don't
// affect the pixels and are exposed raw rather than guessed at.
//
// ── Depth conversion ────────────────────────────────────────────────────────
// SNES planar tiles nest: an 8bpp tile's first 32 bytes ARE a valid 4bpp tile
// (planes 0-3), and a 4bpp tile's first 16 bytes ARE a valid 2bpp tile (planes
// 0/1). So converting down is a per-tile truncation and converting up is a
// per-tile zero-pad — no bit shuffling. `cgxBank` does that for you, since a
// gfx file's depth is fixed by the game, not by whatever the artist was working
// in.

/** Magic at the start of the 0x100 header block. */
const CGX_MAGIC = 'NAK1989 S-CG-CAD';
/** Every CGX holds exactly this many tiles, at any depth. */
export const CGX_TILE_COUNT = 1024;
/** …which is eight banks of this many — i.e. one YI gfx file per bank. */
export const CGX_TILES_PER_BANK = 128;
export const CGX_BANKS = CGX_TILE_COUNT / CGX_TILES_PER_BANK;
const HEADER_BYTES = 0x100;
const ATTR_BYTES = 0x400;
const BYTES_PER_TILE: Record<number, number> = { 2: 16, 4: 32, 8: 64 };
const DEPTH_FOR_CODE: Record<number, 2 | 4 | 8> = { 0: 2, 1: 4, 2: 8 };

export interface CgxFile {
  /** Bit depth the artist stored the tiles at (2 / 4 / 8). */
  bpp: 2 | 4 | 8;
  /** 16 / 32 / 64. */
  tileBytes: number;
  /** Raw planar tile data — `CGX_TILE_COUNT * tileBytes` bytes. */
  data: Uint8Array;
  /** Per-tile attribute byte (the artist's palette assignment), or null at 8bpp. */
  attrs: Uint8Array | null;
  /** The raw 0x100 header block, for callers that want `+0x21` / `+0x22`. */
  header: Uint8Array;
}

/** Parse a CGX. Throws if the magic is absent or the sizes don't add up. */
export function parseCgx(buf: Uint8Array): CgxFile {
  const magic = Buffer.from(CGX_MAGIC, 'latin1');
  const at = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).indexOf(magic);
  if (at < 0) throw new Error('parseCgx: no "NAK1989 S-CG-CAD" header — not a CGX file');
  const header = buf.subarray(at, at + HEADER_BYTES);
  const bpp = DEPTH_FOR_CODE[header[0x20]];
  if (!bpp) throw new Error(`parseCgx: unknown depth code ${header[0x20]} at header +0x20`);
  const tileBytes = BYTES_PER_TILE[bpp];
  const expect = CGX_TILE_COUNT * tileBytes;
  if (at !== expect) {
    throw new Error(`parseCgx: ${bpp}bpp implies 0x${expect.toString(16)} bytes of tile data, header sits at 0x${at.toString(16)}`);
  }
  // 8bpp files carry no attribute block; 2/4bpp do.
  const attrStart = at + HEADER_BYTES;
  const attrs = buf.length >= attrStart + ATTR_BYTES ? buf.subarray(attrStart, attrStart + ATTR_BYTES) : null;
  return { bpp, tileBytes, data: buf.subarray(0, at), attrs, header };
}

/**
 * One 128-tile bank as SNES planar bytes at `targetBpp` — i.e. exactly the
 * payload of one YI gfx file, ready to drop into VRAM or hand to a
 * `gfxOverride` map.
 *
 * Depth conversion is a per-tile truncate (down) or zero-pad (up); see the file
 * header for why that is sufficient.
 */
export function cgxBank(cgx: CgxFile, bank: number, targetBpp: 2 | 4 | 8 = cgx.bpp): Uint8Array {
  if (bank < 0 || bank >= CGX_BANKS) throw new RangeError(`cgxBank: bank ${bank} out of range 0..${CGX_BANKS - 1}`);
  const srcTile = cgx.tileBytes;
  const dstTile = BYTES_PER_TILE[targetBpp];
  const out = new Uint8Array(CGX_TILES_PER_BANK * dstTile);
  const copy = Math.min(srcTile, dstTile); // truncate when going down, zero-pad when going up
  for (let t = 0; t < CGX_TILES_PER_BANK; t++) {
    const s = (bank * CGX_TILES_PER_BANK + t) * srcTile;
    out.set(cgx.data.subarray(s, s + copy), t * dstTile);
  }
  return out;
}

/** Depth whose 128-tile bank is `sizeBytes` long — the game's per-file size
 *  (0x800 → 2bpp, 0x1000 → 4bpp, 0x2000 → 8bpp) turned back into a depth. */
export function cgxBppForFileSize(sizeBytes: number): 2 | 4 | 8 | null {
  for (const bpp of [2, 4, 8] as const) if (CGX_TILES_PER_BANK * BYTES_PER_TILE[bpp] === sizeBytes) return bpp;
  return null;
}
