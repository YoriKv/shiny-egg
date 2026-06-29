// Decoder for the YI 1bpp message font (`assets/yi/Graphics/GFX_1BPPFont_*.bin`):
// 256 glyphs of 12 bytes each — an 8×12 1-bit-per-pixel cell, one byte per row,
// MSB = leftmost pixel. Format verified against the GSU message renderer, which
// fetches a glyph with `UMULT #12` (char × 12) into `DATA_09BD2F` and plots 12
// rows of 8 px (Bank09 `CODE_09B534`); the on-disk blob `DATA_09BD2F` points to
// IS this file.
//
// The non-typeable special glyphs (button icons, arrows, star, Yoshi, … — the
// msg-markup SPECIAL_GLYPHS, which have no Main.txt character) are surfaced to
// the editor as small RGBA previews for the markup keyboard's token buttons.
import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { SPECIAL_GLYPHS } from '../asm/msg-markup.ts'
import type { ImageData } from './png.ts'

const GLYPH_BYTES = 12 // 8×12 1bpp → 12 rows × 1 byte
const GLYPH_W = 8
const GLYPH_H = 12

/** Load the 1bpp message-font blob from the extract. Version-robust: the file is
 *  `GFX_1BPPFont_<ROMID>.bin` and the glyph set is identical across the supported
 *  versions, so any single match is used. Returns the raw 256-glyph blob. */
export function loadMessageFont(workRoot: string): Uint8Array {
  const dir = path.join(workRoot, 'assets', 'yi', 'Graphics')
  const file = readdirSync(dir).find((f) => /^GFX_1BPPFont_.*\.bin$/i.test(f))
  if (!file) throw new Error(`message font (GFX_1BPPFont_*.bin) not found in ${dir}`)
  return readFileSync(path.join(dir, file))
}

export interface GlyphImage {
  token: string
  width: number
  height: number
  /** RGBA — set bits are opaque white, clear bits transparent (shows on the
   *  panel's dark surface; no recolor needed). */
  rgba: Uint8Array
}

/** Render one glyph token (one or more horizontally-adjacent 8px cells) to RGBA. */
function renderGlyph(font: Uint8Array, token: string, bytes: number[]): GlyphImage {
  const width = GLYPH_W * bytes.length
  const rgba = new Uint8Array(width * GLYPH_H * 4)
  bytes.forEach((charIdx, cell) => {
    const base = charIdx * GLYPH_BYTES
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = font[base + row] ?? 0
      for (let col = 0; col < GLYPH_W; col++) {
        if (!(bits & (0x80 >> col))) continue
        const o = (row * width + cell * GLYPH_W + col) * 4
        rgba[o] = 0xff
        rgba[o + 1] = 0xff
        rgba[o + 2] = 0xff
        rgba[o + 3] = 0xff
      }
    }
  })
  return { token, width, height: GLYPH_H, rgba }
}

/** RGBA previews for every special (non-typeable) glyph token. */
export function renderSpecialGlyphImages(font: Uint8Array): GlyphImage[] {
  return SPECIAL_GLYPHS.map((g) => renderGlyph(font, g.token, g.bytes))
}

// ── 1bpp sheet codec (Graphics-panel export/import) ─────────────────────────
// Bank09 holds two raw, fixed-address 1bpp blobs the Graphics panel can edit:
//   • the message font (`GFX_1BPPFont_*.bin`) — a GRID of 256 × 8×12 glyphs the GSU
//     streamer (`FXCODE_09E92F`) addresses by char×12 (8px wide = 1 byte/row);
//   • the message-box pictures (`GFX_1BPPMesaageBoxPictures.bin`) — a FLAT 1bpp
//     bitmap, 128 px wide × 512 tall (16 bytes/row). It is NOT a tile grid: the
//     message renderer's `$60` "inline bitmap" command plots a sub-rectangle of it
//     by (x, y, w, h) — e.g. the egg-throw demo image (see yi-shiny mchip.md §3.18).
//     Stride confirmed: at 128px the rows align into clean bands; at 256px the
//     pattern breaks at column 128. Modelled here as one 128×512 cell (cols 1).
// Both export to a 2-color RGBA image — set bit = WHITE, clear bit = BLACK (both
// opaque) — and re-import by "is the pixel white": any other color (black, a stray
// edit color, transparent) counts as erased (off). Byte-faithful round-trip. Edits
// write back via `saveRawChrEdit` (fixed incbin, no layout move).

/** A 1bpp Bank09 sheet the Graphics panel exports/imports. */
export interface FontSheetSpec {
  /** Stable id (manifest + UI label). */
  key: 'message-font' | 'message-box-pictures'
  description: string
  /** Cell width in pixels — a multiple of 8 (8px ⇒ 1 byte/row, 16px ⇒ 2 bytes/row). */
  glyphW: number
  /** Cell height in rows. */
  glyphH: number
  /** Cells per row in the exported sheet. */
  cols: number
}

export const FONT_SHEETS: readonly FontSheetSpec[] = [
  { key: 'message-font', description: 'Message font (256 × 8×12 glyphs)', glyphW: 8, glyphH: 12, cols: 16 },
  // A flat 128×512 1bpp bitmap (one cell, full width) — NOT a tile grid; the GSU
  // plots sub-rectangles of it. 8192 B / 16 B-per-row = 512 rows.
  { key: 'message-box-pictures', description: 'Message-box pictures (flat 128×512 1bpp bitmap)', glyphW: 128, glyphH: 512, cols: 1 }
]

/** A pixel is "on" only when WHITE (all channels high + opaque); any other color —
 *  black, transparent, or a stray edit color — is treated as erased (off). */
function pixelOn(rgba: Uint8Array, o: number): boolean {
  return (rgba[o] ?? 0) >= 192 && (rgba[o + 1] ?? 0) >= 192 && (rgba[o + 2] ?? 0) >= 192 && (rgba[o + 3] ?? 0) >= 128
}

/** Decode a 1bpp blob into a `cols`-wide grid of `glyphW`×`glyphH` cells — set bit =
 *  white, clear = black (both opaque). `glyphW` may be 8 or 16 (1 or 2 bytes/row). */
export function decodeFontSheet(bytes: Uint8Array, glyphW: number, glyphH: number, cols: number): ImageData {
  const bpr = glyphW >> 3 // bytes per row (8px = 1, 16px = 2)
  const bytesPerCell = bpr * glyphH
  const count = Math.floor(bytes.length / bytesPerCell)
  const rows = Math.max(1, Math.ceil(count / cols))
  const width = cols * glyphW
  const height = rows * glyphH
  const rgba = new Uint8Array(width * height * 4)
  for (let g = 0; g < count; g++) {
    const cx = (g % cols) * glyphW
    const cy = Math.floor(g / cols) * glyphH
    for (let r = 0; r < glyphH; r++) {
      for (let bb = 0; bb < bpr; bb++) {
        const v = bytes[g * bytesPerCell + r * bpr + bb] ?? 0
        for (let c = 0; c < 8; c++) {
          const o = ((cy + r) * width + cx + bb * 8 + c) * 4
          const on = (v & (0x80 >> c)) !== 0
          rgba[o] = on ? 0xff : 0x00
          rgba[o + 1] = on ? 0xff : 0x00
          rgba[o + 2] = on ? 0xff : 0x00
          rgba[o + 3] = 0xff
        }
      }
    }
  }
  return { width, height, rgba }
}

/** Re-encode an edited `cols`-wide grid back to a `byteLen`-byte 1bpp blob. A pixel
 *  is "on" only when white (see {@link pixelOn}); any other color is erased. */
export function encodeFontSheet(
  rgba: Uint8Array,
  width: number,
  glyphW: number,
  glyphH: number,
  cols: number,
  byteLen: number
): Uint8Array {
  const bpr = glyphW >> 3
  const bytesPerCell = bpr * glyphH
  const count = Math.floor(byteLen / bytesPerCell)
  const out = new Uint8Array(byteLen)
  for (let g = 0; g < count; g++) {
    const cx = (g % cols) * glyphW
    const cy = Math.floor(g / cols) * glyphH
    for (let r = 0; r < glyphH; r++) {
      for (let bb = 0; bb < bpr; bb++) {
        let bits = 0
        for (let c = 0; c < 8; c++) {
          const o = ((cy + r) * width + cx + bb * 8 + c) * 4
          if (pixelOn(rgba, o)) bits |= 0x80 >> c
        }
        out[g * bytesPerCell + r * bpr + bb] = bits
      }
    }
  }
  return out
}
