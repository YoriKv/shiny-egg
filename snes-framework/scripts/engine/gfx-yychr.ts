// YY-CHR export sidecars + layout helpers (pure — no fs; the Electron writer is
// src/main/gfx-yychr-io.ts). YY-CHR edits raw SNES CHR bytes in place, so the export
// body is just the decompressed blob — these helpers produce the display sidecars
// (.pal palette, .col per-tile palette rows) and the padding/naming the round-trip
// depends on. Facts below were verified against the decompiled YY-CHR.NET 20210606
// source (CharactorLib/*, YYCHR/*); see research/graphics-editing/yychr-export.md.
//
// The load-bearing YY-CHR behaviors:
//  • Format auto-select is EXTENSION-driven, first match in registration order
//    (FormatManager.GetFormatByExtension). ".sfc" → 4BPP SNES, ".gb" → 2BPP GB
//    (= SNES 2bpp), ".gba" → 4BPP GBA (= YI's CPC nibble packing, byte-identical).
//    ".bin" is a TRAP: it matches 2BPP MSX first — never name an export .bin.
//    Unmatched extensions keep the last-selected format (used for .m7/.1bpp, which
//    need a manual format pick).
//  • Sidecars auto-load per opened file, APPENDED name first ("sheet.sfc.pal", then
//    the ChangeExtension fallback "sheet.pal") — DataFileManager.AutoLoadFiles.
//  • A 512-byte .pal auto-detects as R5G5B5: little-endian words, R bits 0-4,
//    G 5-9, B 10-14 — byte-identical to SNES CGRAM, EXCEPT bit 15 set marks the
//    color "invalid" (ColorBit.LoadData) — always mask it.
//  • .col assigns one byte per char: displayed index = pixel + colByte × ColorNum
//    (16 for 4bpp, 4 for 2bpp — BytemapConvertor.AddPalSet). The col byte for the
//    char at file offset B is read at B/16 + 256 (ColSetData.GetBankPaletteSetAddr),
//    after a 256-byte header. So with the .pal packed as one sub-palette per
//    ColorNum-color group, colByte = the file's per-tile sub-palette index directly.
//  • Copier-header autodetect is ON by default (header = fileSize % 2048) and files
//    smaller than one bank (128×128 px view) get buffer-padded + a save prompt —
//    both dodged by zero-padding every export to a whole number of banks.

/** Bytes per YY-CHR bank view (128×128 px at `bpp`): 2048/4096/8192/16384. */
export function yychrBankBytes(bpp: 1 | 2 | 4 | 8): number {
  return (128 * 128 * bpp) / 8;
}

/** Zero-pad `data` to a whole number of YY-CHR banks (min one bank) — see the
 *  copier-header + small-file notes in the module header. Returns `data` itself
 *  when already aligned. */
export function padToYychrBank(data: Uint8Array, bpp: 1 | 2 | 4 | 8): Uint8Array {
  const bank = yychrBankBytes(bpp);
  const padded = Math.max(bank, Math.ceil(data.length / bank) * bank);
  if (padded === data.length) return data;
  const out = new Uint8Array(padded);
  out.set(data);
  return out;
}

/** Truncate an imported (possibly bank-padded) file back to the true blob length.
 *  `padEdited` = a nonzero byte sat beyond the real end (the user painted into the
 *  padding — those pixels are dropped; the importer warns). */
export function stripYychrPad(data: Uint8Array, sizeBytes: number): { bytes: Uint8Array; padEdited: boolean } {
  let padEdited = false;
  for (let i = sizeBytes; i < data.length; i++) {
    if (data[i] !== 0) { padEdited = true; break; }
  }
  return { bytes: data.slice(0, sizeBytes), padEdited };
}

/** 0xRRGGBB → SNES/YY-CHR BGR-15 word (bit 15 clear). */
export function rgbToBgr15(rgb: number): number {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);
}

/** Build a 512-byte YY-CHR .pal from per-sub-palette RGB rows (0xRRGGBB), each row
 *  occupying one `colorsPerRow` group (16 for 4bpp, 4 for 2bpp) — so a .col byte of
 *  `i` displays sub-palette `i`. Row 0 first ⇒ files without a .col still show
 *  their primary row at YY-CHR's default palette selection. Unused slots stay 0. */
export function buildPalFromRgbRows(rows: readonly (readonly number[])[], colorsPerRow: number): Uint8Array {
  const out = new Uint8Array(512);
  rows.forEach((row, i) => {
    row.forEach((rgb, j) => {
      const slot = i * colorsPerRow + j;
      if (slot >= 256) return;
      const w = rgbToBgr15(rgb);
      out[slot * 2] = w & 0xff;
      out[slot * 2 + 1] = (w >> 8) & 0x7f; // bit 15 clear — set = "invalid" in YY-CHR
    });
  });
  return out;
}

/** Build a 512-byte YY-CHR .pal from CGRAM (BGR-15 LE), the file's primary 16-color
 *  row FIRST (so it displays right at YY-CHR's default selection), then the other 15
 *  rows in CGRAM order. Bit 15 masked (see module header). */
export function buildPalFromCgram(cgram: Uint8Array, primaryRow: number): Uint8Array {
  const out = new Uint8Array(512);
  const rows: number[] = [primaryRow & 0xf];
  for (let r = 0; r < 16; r++) if (r !== (primaryRow & 0xf)) rows.push(r);
  rows.forEach((srcRow, dstRow) => {
    for (let c = 0; c < 16; c++) {
      const s = (srcRow * 16 + c) * 2, d = (dstRow * 16 + c) * 2;
      out[d] = cgram[s] ?? 0;
      out[d + 1] = (cgram[s + 1] ?? 0) & 0x7f;
    }
  });
  return out;
}

/** Build the .col sidecar for a (bank-padded) file: 256-byte header (zeros; offset
 *  128 feeds YY-CHR's NES-DAT view, unused for SNES) + one byte per char at
 *  `charFileOffset/16 + 256` (so 4bpp banks stride 512 with the upper 256 unused;
 *  2bpp banks pack contiguously). `tileSub[t]` = the char's sub-palette group in the
 *  companion `buildPalFromRgbRows` .pal; chars past the end (padding) read group 0. */
export function buildColSidecar(tileSub: readonly number[], bpp: 2 | 4, paddedBytes: number): Uint8Array {
  const tileBytes = bpp === 4 ? 32 : 16;
  const out = new Uint8Array(256 + paddedBytes / 16);
  const tiles = paddedBytes / tileBytes;
  for (let t = 0; t < tiles; t++) {
    out[256 + (t * tileBytes) / 16] = (tileSub[t] ?? 0) & 0xff;
  }
  return out;
}

// ── GSU chunky ↔ planar (the ycompress type-1 transform) ────────────────────
//
// The GSU bitmap banks ($53-$56) are CHUNKY: a 256-px-wide page, 1 byte per
// pixel, carrying TWO independent 4-bit layers (low nibble + high nibble).
// No YY-CHR format reads that — so, like FuSoYa's ycompress does for AllGFX.bin,
// we present them as ordinary planar 4bpp CHR through this bijective transform
// (spec + validation: research/graphics-editing/ycompress-allgfx.md §3 — the
// forward direction reproduces ycompress's real output byte-for-byte).
//
// Layout of the planar view (N = bytes/32 tiles, q = N/4 per quadrant):
//   quadrant 0 = LOW-nibble layer, LEFT page half (chunky x 0-127)
//   quadrant 1 = low nibble, RIGHT half (x 128-255)
//   quadrant 2 = HIGH nibble, left      quadrant 3 = high nibble, right
// Within a quadrant: row-major, 16 tiles per row — i.e. each quadrant is a
// 128-px-wide picture of one nibble layer of one page half.

/** GSU chunky page → planar 4bpp CHR (see the block comment above). `src.length`
 *  must be a multiple of 128 (whole quadrant rows); output length == input. */
export function chunkyToPlanar(src: Uint8Array): Uint8Array {
  const nTiles = src.length >> 5;
  const out = new Uint8Array(nTiles * 32);
  const q = nTiles >> 2;
  for (let t = 0; t < nTiles; t++) {
    const quad = Math.floor(t / q); // 0=lo/left 1=lo/right 2=hi/left 3=hi/right
    const k = t % q;
    const shift = quad < 2 ? 0 : 4;
    const halfBase = quad % 2 === 0 ? 0 : 0x80;
    const tx = k & 0xf;
    const ty = k >> 4;
    for (let py = 0; py < 8; py++) {
      let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
      for (let px = 0; px < 8; px++) {
        const sb = src[(ty * 8 + py) * 0x100 + halfBase + tx * 8 + px] ?? 0;
        const v = (sb >> shift) & 0xf;
        const bit = 7 - px;
        p0 |= (v & 1) << bit;
        p1 |= ((v >> 1) & 1) << bit;
        p2 |= ((v >> 2) & 1) << bit;
        p3 |= ((v >> 3) & 1) << bit;
      }
      out[t * 32 + py * 2] = p0;
      out[t * 32 + py * 2 + 1] = p1;
      out[t * 32 + 16 + py * 2] = p2;
      out[t * 32 + 16 + py * 2 + 1] = p3;
    }
  }
  return out;
}

/** Planar 4bpp CHR → GSU chunky page — the exact inverse of {@link chunkyToPlanar}
 *  (each nibble layer writes only its own half of each byte). */
export function planarToChunky(planar: Uint8Array): Uint8Array {
  const nTiles = planar.length >> 5;
  const out = new Uint8Array(planar.length);
  const q = nTiles >> 2;
  for (let t = 0; t < nTiles; t++) {
    const quad = Math.floor(t / q);
    const k = t % q;
    const shift = quad < 2 ? 0 : 4;
    const halfBase = quad % 2 === 0 ? 0 : 0x80;
    const tx = k & 0xf;
    const ty = k >> 4;
    for (let py = 0; py < 8; py++) {
      const p0 = planar[t * 32 + py * 2] ?? 0;
      const p1 = planar[t * 32 + py * 2 + 1] ?? 0;
      const p2 = planar[t * 32 + 16 + py * 2] ?? 0;
      const p3 = planar[t * 32 + 16 + py * 2 + 1] ?? 0;
      for (let px = 0; px < 8; px++) {
        const bit = 7 - px;
        const v = ((p0 >> bit) & 1) | (((p1 >> bit) & 1) << 1) | (((p2 >> bit) & 1) << 2) | (((p3 >> bit) & 1) << 3);
        const d = (ty * 8 + py) * 0x100 + halfBase + tx * 8 + px;
        if (d < out.length) out[d] = (out[d]! & (0xf0 >> shift)) | (v << shift);
      }
    }
  }
  return out;
}

// ── 1bpp re-tiling ───────────────────────────────────────────────────────────
//
// YI's 1bpp blobs are NOT 8×8 tiles: the message font is sequential 8×12 glyph
// records (12 bytes each) and the message-box pictures are a flat 128-px-wide
// scanline bitmap — so YY-CHR's "1BPP 8x8" (its only 8-px 1bpp format; the FF5/FF6
// 1bpp formats are 16-px-wide) renders both as scrambled rows. Fix, same principle
// as the GSU chunky transform: export a bijectively RE-TILED view — arrange the
// content as one `widthPx`-wide bitmap, then store it in 8×8-tile order. YY-CHR
// draws tiles row-major 16-per-row at its 128-px bank width, which reconstructs
// the bitmap exactly, so glyphs/pictures display correctly; import inverts.

/** Sequential 1bpp glyph records (glyphW×glyphH, MSB-first rows) → one
 *  `cols`-wide sheet bitmap (width = cols×glyphW px). Bijective with
 *  {@link bitmapToGlyphs1bpp}; same byte length when the glyph count fills whole
 *  sheet rows (YI's font: 256 glyphs = 16×16 sheet). */
export function glyphs1bppToBitmap(bytes: Uint8Array, glyphW: number, glyphH: number, cols: number): Uint8Array {
  const bprGlyph = glyphW >> 3;
  const bytesPerGlyph = bprGlyph * glyphH;
  const count = Math.floor(bytes.length / bytesPerGlyph);
  const rows = Math.ceil(count / cols);
  const bprSheet = cols * bprGlyph;
  const out = new Uint8Array(bprSheet * rows * glyphH);
  for (let g = 0; g < count; g++) {
    const gx = (g % cols) * bprGlyph;
    const gy = Math.floor(g / cols) * glyphH;
    for (let r = 0; r < glyphH; r++) {
      for (let b = 0; b < bprGlyph; b++) out[(gy + r) * bprSheet + gx + b] = bytes[g * bytesPerGlyph + r * bprGlyph + b]!;
    }
  }
  return out;
}

/** Inverse of {@link glyphs1bppToBitmap}: slice `count` glyph records back out. */
export function bitmapToGlyphs1bpp(bitmap: Uint8Array, glyphW: number, glyphH: number, cols: number, count: number): Uint8Array {
  const bprGlyph = glyphW >> 3;
  const bytesPerGlyph = bprGlyph * glyphH;
  const bprSheet = cols * bprGlyph;
  const out = new Uint8Array(count * bytesPerGlyph);
  for (let g = 0; g < count; g++) {
    const gx = (g % cols) * bprGlyph;
    const gy = Math.floor(g / cols) * glyphH;
    for (let r = 0; r < glyphH; r++) {
      for (let b = 0; b < bprGlyph; b++) out[g * bytesPerGlyph + r * bprGlyph + b] = bitmap[(gy + r) * bprSheet + gx + b] ?? 0;
    }
  }
  return out;
}

/** A 1bpp scanline bitmap (`widthPx` wide, MSB-first) → 8×8-tile order (8 bytes
 *  per tile, tiles row-major `widthPx/8` per band). Bijective with
 *  {@link tiles1bppToBitmap} when the bitmap height is a multiple of 8. */
export function bitmap1bppToTiles(bitmap: Uint8Array, widthPx: number): Uint8Array {
  const bpr = widthPx >> 3; // bytes (= tiles) per pixel row
  const rows = Math.ceil(bitmap.length / bpr);
  const bands = Math.ceil(rows / 8);
  const out = new Uint8Array(bands * bpr * 8);
  for (let t = 0; t < bands * bpr; t++) {
    const tx = t % bpr, ty = Math.floor(t / bpr);
    for (let r = 0; r < 8; r++) out[t * 8 + r] = bitmap[(ty * 8 + r) * bpr + tx] ?? 0;
  }
  return out;
}

/** Inverse of {@link bitmap1bppToTiles}. */
export function tiles1bppToBitmap(tiles: Uint8Array, widthPx: number): Uint8Array {
  const bpr = widthPx >> 3;
  const nTiles = Math.floor(tiles.length / 8);
  const out = new Uint8Array(nTiles * 8);
  for (let t = 0; t < nTiles; t++) {
    const tx = t % bpr, ty = Math.floor(t / bpr);
    for (let r = 0; r < 8; r++) {
      const o = (ty * 8 + r) * bpr + tx;
      if (o < out.length) out[o] = tiles[t * 8 + r]!;
    }
  }
  return out;
}

/** The exported filename for a sheet: the extension drives YY-CHR's format
 *  auto-select (module header). `cpc` = YI's SuperFX CPC nibble packing (2 px/byte,
 *  low nibble first, 32 B/tile — e.g. the title island $B1), which is byte-identical
 *  to YY-CHR's "4BPP GBA" format. 8bpp (Mode-7) and 1bpp have no safe auto-select
 *  extension, so they get neutral ones + a manual format pick (README). */
export function yychrSheetName(base: string, bpp: 1 | 2 | 4 | 8, opts: { cpc?: boolean } = {}): string {
  if (opts.cpc) return `${base}.4bpp.gba`;
  switch (bpp) {
    case 4: return `${base}.4bpp.sfc`;
    case 2: return `${base}.2bpp.gb`;
    case 8: return `${base}.8bpp.m7`;
    case 1: return `${base}.1bpp`;
  }
}

/** Sidecar paths use the APPENDED naming (checked first by AutoLoadFiles). */
export const yychrPalName = (sheetFile: string): string => `${sheetFile}.pal`;
export const yychrColName = (sheetFile: string): string => `${sheetFile}.col`;
export const yychrAdfName = (sheetFile: string): string => `${sheetFile}.adf`;

/** An identity-pattern `.adf` sidecar (one 288-byte record: 32-byte Shift-JIS name +
 *  a 256-byte char-index remap, here 0..255 = no-op). REQUIRED next to every `.col`:
 *  YY-CHR's Col-mode redraw dereferences the selected ADF pattern unguarded
 *  (`MainForm.ConvertFileDataToBytemap` → `GetBankPaletteSet(addr,
 *  mFormat.AdfPattern.Pattern)`), and the ADF combo is only populated when an .adf
 *  actually loads — builds shipped WITHOUT `Resources/yychr.adf` (e.g. 20210606)
 *  leave it null, so opening a .col'd file throws NullReferenceException in the
 *  redraw and the view shows garbage. Auto-loading this identity .adf (AutoLoadFiles
 *  processes .adf BEFORE .col) populates the combo with a no-op pattern: Col mode
 *  then works, and the identity remap leaves the sheet layout untouched.
 *  Byte 31 of the name stays 0 — $FF there flags "blank char $FF" mode (AdfInfo). */
export function buildIdentityAdf(name = 'linear'): Uint8Array {
  const out = new Uint8Array(288);
  for (let i = 0; i < Math.min(name.length, 30); i++) out[i] = name.charCodeAt(i) & 0x7f;
  for (let i = 0; i < 256; i++) out[32 + i] = i;
  return out;
}
