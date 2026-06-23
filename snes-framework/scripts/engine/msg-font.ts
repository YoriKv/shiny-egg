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
   *  panel's dark surface; no recolour needed). */
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
