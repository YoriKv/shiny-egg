// Credits staff-roll text codec — the gm$1C/gm$1D OAM letter streams as
// editable text lines. System fully traced 2026-07-19
// (research/graphics-survey/09-font-hud-messages.md §4b):
//
//   - The alphabet is GSU-rasterized from the 1bpp message font (`FXCODE_09ECD8`)
//     into a two-plane OAM sheet at VRAM $E000: pixel bit 0 = font codes 0-127,
//     bit 1 = codes 128-255. A letter byte's bit 4 picks OBJ palette 6 vs 7,
//     which reveals one plane or the other — so bit 4 IS the code's high bit.
//   - Tile layout (top half; bottom = tile|$10): for n = code & $7F,
//     tile = ((n>>3)&7)*32 + (n>>6)*8 + (n&7).
//   - A page stream: header word (X, Y); per letter (letterByte, advance) with
//     advance = the font's proportional width (word gaps folded into the
//     word-final letter's advance — there is no space letter); `$FF` + control:
//     $00 = end of page, $01 = new line (new header word follows). (The cart
//     grammar also has $02 = Y-skip and ≥$03 = +8px, but no shipped page uses
//     them and the encoder never emits them.)
//
// Editable line model: plain Main.txt text + `[glyph]`/`[$XX]` tokens (the same
// string shape as the intro/ending glyph-line editors). Spaces cost 0 bytes
// (folded into advances); line Y positions are preserved from the base page;
// line X is re-centered on the shipped optical center (128) when a line changes.

import { SPECIAL_GLYPHS } from './msg-markup.ts'
import { invalidChars, type FontTable } from './font-table.ts'

const GLYPHS_BY_LEN = [...SPECIAL_GLYPHS].sort((a, b) => b.bytes.length - a.bytes.length)
const GLYPH_BY_TOKEN = new Map(SPECIAL_GLYPHS.map((g) => [g.token.toLowerCase(), g]))
const hex2 = (n: number): string => (n & 0xff).toString(16).toUpperCase().padStart(2, '0')

/** The 1bpp font's proportional width table (`DATA_09BC2F`, Bank09 — inline,
 *  version-invariant `db` data; pinned against the asm source by the codec test).
 *  Index = font code; value = advance in pixels. */
// prettier-ignore
export const CREDITS_FONT_WIDTHS: readonly number[] = [
  0x08,0x08,0x08,0x08,0x08,0x08,0x05,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x04,0x04,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x04,0x06,0x03,0x07,0x06,0x07,0x06,0x07,0x03,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x07,0x07,
  0x08,0x08,0x05,0x08,0x08,0x07,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x04,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x07,0x07,0x08,0x08,
  0x04,0x07,0x08,0x04,0x08,0x08,0x08,0x08,0x08,0x07,0x08,0x08,0x08,0x08,0x08,0x08,
  0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08
]

/** The roll's optical center: shipped line headers satisfy X + width/2 ≈ 128. */
const CENTER_X = 128

/** letter byte ↔ font code (the two-plane OAM sheet mapping). */
export function creditsCodeToLetterByte(code: number): number {
  const n = code & 0x7f
  const tile = ((n >> 3) & 7) * 32 + (n >> 6) * 8 + (n & 7)
  return tile | (code & 0x80 ? 0x10 : 0)
}

export function creditsLetterByteToCode(b: number): number {
  const tile = b & 0xef
  const q = (tile >> 4) >> 1
  const section = (tile >> 3) & 1
  const o = tile & 7
  return section * 64 + q * 8 + o + (b & 0x10 ? 128 : 0)
}

/** One decoded page line: markup text + its shipped header position. */
export interface CreditsLine {
  markup: string
  x: number
  y: number
}

/** Decode one page's stream bytes → lines. Word gaps (advance > glyph width by
 *  at least ~a space) become ' '; unknown font codes become `[$XX]` (matched
 *  back to named SPECIAL_GLYPHS sequences where possible). */
export function decodeCreditsPage(bytes: readonly number[], ft: FontTable): CreditsLine[] {
  const lines: CreditsLine[] = []
  let p = 0
  const readHeader = (): { x: number; y: number } => {
    const h = { x: bytes[p] ?? 0, y: bytes[p + 1] ?? 0 }
    p += 2
    return h
  }
  let head = readHeader()
  let markup = ''
  let pendingCodes: number[] = [] // raw-code run, flushed to [glyph]/[$XX] tokens
  const flushCodes = (): void => {
    let i = 0
    while (i < pendingCodes.length) {
      let matched = false
      for (const g of GLYPHS_BY_LEN) {
        if (i + g.bytes.length > pendingCodes.length) continue
        if (g.bytes.every((b, k) => b === pendingCodes[i + k])) {
          markup += `[${g.token}]`
          i += g.bytes.length
          matched = true
          break
        }
      }
      if (!matched) {
        markup += `[$${hex2(pendingCodes[i]!)}]`
        i++
      }
    }
    pendingCodes = []
  }
  const endLine = (): void => {
    flushCodes()
    lines.push({ markup, x: head.x, y: head.y })
    markup = ''
  }
  for (;;) {
    const b = bytes[p]
    if (b === undefined) break
    if (b === 0xff) {
      const ctl = bytes[p + 1] ?? 0
      p += 2
      if (ctl === 0) {
        endLine()
        break
      }
      if (ctl === 1) {
        endLine()
        head = readHeader()
        continue
      }
      if (ctl === 2) {
        p += 1 // Y skip — unused by the shipped pages; tolerated, not editable
        continue
      }
      flushCodes()
      markup += ' ' // ≥$03: +8px explicit space
      continue
    }
    const adv = bytes[p + 1] ?? 0
    p += 2
    const code = creditsLetterByteToCode(b)
    const ch = ft.byteToChar.get(code)
    if (ch !== undefined) {
      flushCodes()
      markup += ch
    } else {
      pendingCodes.push(code)
    }
    // A word gap is folded into the word-final letter's advance.
    const gap = adv - (CREDITS_FONT_WIDTHS[code] ?? 8)
    if (gap >= 3) {
      flushCodes()
      markup += ' '
    }
  }
  return lines
}

export type EncodeCreditsResult =
  | { ok: true; bytes: number[] }
  | { ok: false; error: string }

const SPACE_WIDTH = CREDITS_FONT_WIDTHS[0xd0]! // the font's ' ' advance (4 px)
const MAX_LINE_WIDTH = 240 // OAM X is a byte; keep the line on screen

/** Resolve one line of markup into font codes + a leading-space pad (px). */
function lineToCodes(
  markup: string,
  ft: FontTable
): { ok: true; codes: number[]; leadPad: number } | { ok: false; error: string } {
  const codes: number[] = []
  let leadPad = 0
  const re = /\[([^\]]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  const pushText = (text: string): { ok: true } | { ok: false; error: string } => {
    for (const ch of text) {
      if (ch === ' ') {
        if (codes.length === 0) leadPad += SPACE_WIDTH
        else codes.push(-1) // space marker — folds into the previous advance
        continue
      }
      const code = ft.charToByte.get(ch)
      if (code === undefined) {
        const bad = invalidChars(ch, ft)
        return { ok: false, error: `Unsupported character(s) ${bad.map((c) => JSON.stringify(c)).join(', ')}.` }
      }
      codes.push(code)
    }
    return { ok: true }
  }
  while ((m = re.exec(markup)) !== null) {
    if (m.index > last) {
      const r = pushText(markup.slice(last, m.index))
      if (!r.ok) return r
    }
    const named = GLYPH_BY_TOKEN.get(m[1]!.toLowerCase())
    if (named) codes.push(...named.bytes)
    else {
      const hex = /^\$([0-9A-Fa-f]{2})$/.exec(m[1]!)
      if (!hex) return { ok: false, error: `Unknown glyph "[${m[1]}]".` }
      codes.push(parseInt(hex[1]!, 16))
    }
    last = re.lastIndex
  }
  if (last < markup.length) {
    const r = pushText(markup.slice(last))
    if (!r.ok) return r
  }
  return { ok: true, codes, leadPad }
}

/**
 * Encode one page: lines of markup + the base page's per-line Y positions
 * (layout preserved; line count must match). Each line's X is re-centered.
 * Returns the full stream bytes (headers + letters + controls + terminator).
 */
export function encodeCreditsPage(
  lines: readonly string[],
  baseYs: readonly number[],
  ft: FontTable
): EncodeCreditsResult {
  if (lines.length !== baseYs.length) {
    return { ok: false, error: `Page has ${lines.length} line(s); the cart expects ${baseYs.length}.` }
  }
  const out: number[] = []
  for (let li = 0; li < lines.length; li++) {
    const r = lineToCodes(lines[li]!.trimEnd(), ft)
    if (!r.ok) return r
    // Letters + advances; a -1 marker adds a space width to the previous letter.
    const letters: { code: number; adv: number }[] = []
    for (const c of r.codes) {
      if (c === -1) {
        if (letters.length > 0) letters[letters.length - 1]!.adv += SPACE_WIDTH
        continue
      }
      letters.push({ code: c, adv: CREDITS_FONT_WIDTHS[c] ?? 8 })
    }
    if (letters.length === 0) return { ok: false, error: `Line ${li + 1} is empty.` }
    // Width for centering: the trailing letter's advance overhangs by (adv - 8px
    // cell)… the shipped centering just sums advances, so match it.
    const width = r.leadPad + letters.reduce((a, l) => a + l.adv, 0)
    if (width > MAX_LINE_WIDTH) {
      return { ok: false, error: `Line ${li + 1} is ${width}px wide (max ${MAX_LINE_WIDTH}px) — shorten it.` }
    }
    const x = Math.max(8, Math.round(CENTER_X - width / 2)) + r.leadPad
    if (li > 0) out.push(0xff, 0x01)
    out.push(x & 0xff, baseYs[li]! & 0xff)
    for (const l of letters) out.push(creditsCodeToLetterByte(l.code), l.adv & 0xff)
  }
  out.push(0xff, 0x00)
  return { ok: true, bytes: out }
}

/** Exact stream byte cost of a page in the editable model (spaces are free):
 *  2/line header word + 2/letter + 2 per line break + 2 terminator. Mirrors
 *  `encodeCreditsPage`; the panel uses it for the live budget estimate. */
export function creditsPageByteSize(lines: readonly string[]): number {
  let n = 2 + lines.length * 2 + Math.max(0, lines.length - 1) * 2
  for (const line of lines) {
    const re = /\[([^\]]+)\]/g
    let last = 0
    let m: RegExpExecArray | null
    const countText = (t: string): void => {
      for (const ch of t) if (ch !== ' ') n += 2
    }
    while ((m = re.exec(line)) !== null) {
      countText(line.slice(last, m.index))
      const named = GLYPH_BY_TOKEN.get(m[1]!.toLowerCase())
      n += 2 * (named ? named.bytes.length : 1)
      last = re.lastIndex
    }
    countText(line.slice(last))
  }
  return n
}
