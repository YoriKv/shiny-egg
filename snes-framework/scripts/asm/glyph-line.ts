// Glyph-aware text-line codec for the intro (Bank0F) + ending (Bank0D) cutscene
// editors. Those regions render through the SAME font as the message box
// (DATA_09BD2F — verified: Bank0F CODE_09E9AF / Bank0D CODE_09F7BC both plot it),
// so the special glyphs (button icons, star, Yoshi, arrows, …) render there too.
// They have no Main.txt character, so they're raw font bytes — to put one in a
// line we emit it as a `db` byte arg: `db "a",$F6,$F7,"b"`.
//
// This codec converts ONE text `db` directive's argument list to/from an editable
// "line" string of plain Main.txt text + `[glyph]` tokens (e.g. "Suddenly[star]").
// The cutscene's layout/control directives (intro `$FE/$FD/$FC` byte directives,
// ending `$xxFF` word directives) are SEPARATE directives the editor never
// touches — only text `db` directives flow through here.
//
// A serialized text line ALWAYS keeps at least one quoted segment (an empty `""`
// when it is all glyphs), so a re-parse can still tell a text directive
// (`db "",$F6`) from a control directive (`db $FE,$00`) by "has a quoted arg".

import { SPECIAL_GLYPHS } from './msg-markup.ts'
import { invalidChars, type FontTable } from './font-table.ts'

const GLYPHS_BY_LEN = [...SPECIAL_GLYPHS].sort((a, b) => b.bytes.length - a.bytes.length)
const GLYPH_BY_TOKEN = new Map(SPECIAL_GLYPHS.map((g) => [g.token.toLowerCase(), g]))
const hex2 = (n: number): string => (n & 0xff).toString(16).toUpperCase().padStart(2, '0')

/** One argument of a `db` directive: a quoted text run or a single literal byte. */
type DbArg = { kind: 'text'; value: string } | { kind: 'byte'; value: number }

/** Split a `db` directive's argument text on commas OUTSIDE quoted strings, then
 *  classify each arg as a `"…"` text run or a `$XX` byte. Returns null if any arg
 *  is neither (a label, expression, etc.) — i.e. not an editable text line. */
export function parseDbArgs(argText: string): DbArg[] | null {
  const raw: string[] = []
  let cur = ''
  let inStr = false
  for (const c of argText) {
    if (inStr) {
      cur += c
      if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
      cur += c
    } else if (c === ',') {
      raw.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  raw.push(cur)

  const args: DbArg[] = []
  for (const r of raw) {
    const t = r.trim()
    const str = /^"(.*)"$/.exec(t)
    if (str) {
      args.push({ kind: 'text', value: str[1] })
      continue
    }
    const byte = /^\$([0-9A-Fa-f]{1,2})$/.exec(t)
    if (byte) {
      args.push({ kind: 'byte', value: parseInt(byte[1], 16) })
      continue
    }
    return null // not a pure text/byte arg list → not an editable text line
  }
  return args
}

/** True if a `db` directive's args form an editable TEXT line (≥1 quoted run).
 *  Control directives (`db $FE,$00,…`) have only bytes → false. */
export function isTextLineArgs(args: DbArg[] | null): boolean {
  return !!args && args.some((a) => a.kind === 'text')
}

/** Decode a run of consecutive raw bytes into `[glyph]` tokens (longest match
 *  against SPECIAL_GLYPHS; an unmatched byte → `[$XX]`). */
function bytesToTokens(bytes: number[]): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    let matched = false
    for (const g of GLYPHS_BY_LEN) {
      if (i + g.bytes.length > bytes.length) continue
      if (g.bytes.every((b, k) => b === bytes[i + k])) {
        out += `[${g.token}]`
        i += g.bytes.length
        matched = true
        break
      }
    }
    if (!matched) {
      out += `[$${hex2(bytes[i])}]`
      i++
    }
  }
  return out
}

/** Decode a parsed text-line arg list into the editable line string: text runs
 *  pass through, byte runs become `[glyph]` / `[$XX]` tokens. */
export function dbArgsToLine(args: DbArg[]): string {
  let out = ''
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a.kind === 'text') {
      out += a.value
      i++
      continue
    }
    const run: number[] = []
    while (i < args.length && args[i].kind === 'byte') {
      run.push((args[i] as { value: number }).value)
      i++
    }
    out += bytesToTokens(run)
  }
  return out
}

/** Resolve one `[token]` to its bytes: a named special glyph, or `[$XX]` hex. */
function resolveToken(token: string): number[] | null {
  const named = GLYPH_BY_TOKEN.get(token.toLowerCase())
  if (named) return named.bytes
  const hex = /^\$([0-9A-Fa-f]{2})$/.exec(token)
  if (hex) return [parseInt(hex[1], 16)]
  return null
}

export type EncodeLineResult =
  | { ok: true; args: string; bytes: number }
  | { ok: false; error: string }

/**
 * Encode an editable line (plain text + `[glyph]` tokens) into a `db` directive's
 * argument string (e.g. `"a",$F6,$F7,"b"`) plus its byte cost. Validates that
 * plain text uses only legal Main.txt characters and that every `[token]` is a
 * known glyph (or `[$XX]`). Always emits at least one quoted segment (an empty
 * `""` for an all-glyph line) so the directive re-parses as a text line.
 */
export function encodeLineToDbArgs(line: string, ft: FontTable): EncodeLineResult {
  const parts: ({ text: string } | { bytes: number[] })[] = []
  const re = /\[([^\]]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index) })
    const bytes = resolveToken(m[1])
    if (!bytes) return { ok: false, error: `Unknown glyph "[${m[1]}]".` }
    parts.push({ bytes })
    last = re.lastIndex
  }
  if (last < line.length) parts.push({ text: line.slice(last) })

  const args: string[] = []
  let byteCount = 0
  for (const p of parts) {
    if ('text' in p) {
      if (p.text === '') continue
      const bad = invalidChars(p.text, ft)
      if (bad.length > 0) {
        return {
          ok: false,
          error: `Unsupported character(s) ${bad.map((c) => JSON.stringify(c)).join(', ')} in "${p.text}".`
        }
      }
      args.push(`"${p.text}"`)
      byteCount += [...p.text].length
    } else {
      if (args.length === 0) args.push('""') // ensure a leading quoted segment
      for (const b of p.bytes) {
        args.push(`$${hex2(b)}`)
        byteCount++
      }
    }
  }
  if (args.length === 0) args.push('""') // empty line → db ""
  return { ok: true, args: args.join(','), bytes: byteCount }
}
