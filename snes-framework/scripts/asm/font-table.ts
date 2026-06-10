// YI message-font character set — the `table "Tables/Fonts/Main.txt"` mapping
// asar applies when encoding `db "..."` text into the cart's font byte codes.
// Reusable by any text-editing tool: it defines which characters are legal in a
// string (asar fails the build on an unmapped char) and how many bytes each
// encodes to (one byte per char in this table).
//
// Main.txt line format is `<char>=<HH>` (one char, `=`, two hex digits). The
// char may itself be `=` (the line `==36`), so the key is always the first
// character, the separator the second, the value the rest.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FontTable } from '../types.ts'

// FontTable's home is the Node/DOM-free `types.ts` (so renderer-side codec
// helpers can reference it). Re-exported here for the existing
// `./asm/font-table.ts` import sites.
export type { FontTable }

export function parseFontTable(text: string): FontTable {
  const charToByte = new Map<string, number>()
  const byteToChar = new Map<number, string>()
  const chars: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.length < 3 || line[1] !== '=') continue
    const ch = line[0]
    const byte = parseInt(line.slice(2), 16)
    if (Number.isNaN(byte)) continue
    charToByte.set(ch, byte)
    if (!byteToChar.has(byte)) byteToChar.set(byte, ch)
    chars.push(ch)
  }
  return { charToByte, byteToChar, chars }
}

/** Load + parse `yi/Tables/Fonts/Main.txt` from a framework work root. */
export function loadFontTable(workRoot: string): FontTable {
  const path = join(workRoot, 'yi', 'Tables', 'Fonts', 'Main.txt')
  return parseFontTable(readFileSync(path, 'utf8'))
}

/** Unique characters in `text` that the font table can't encode (in order of
 *  first appearance). Empty array = the whole string is encodable. */
export function invalidChars(text: string, ft: FontTable): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ch of text) {
    if (!ft.charToByte.has(ch) && !seen.has(ch)) {
      seen.add(ch)
      out.push(ch)
    }
  }
  return out
}

/** Encoded byte length of `text` (one byte per char in this table). Throws on an
 *  unmapped char so callers that need an exact count fail loudly rather than
 *  silently under-counting. */
export function encodedByteLength(text: string, ft: FontTable): number {
  let n = 0
  for (const ch of text) {
    if (!ft.charToByte.has(ch)) {
      throw new Error(`Character ${JSON.stringify(ch)} is not in the font table.`)
    }
    n++
  }
  return n
}
