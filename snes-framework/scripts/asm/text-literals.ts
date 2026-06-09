// Reusable asm text primitives — shared by any editor tool that edits string
// data inside `db "..."` directives. Deliberately format-preserving: tools edit
// only the *contents* of quoted literals and splice them back in place, so
// comments, control bytes, labels, indentation, and ':'-joined statements all
// survive untouched.
//
// Comment- and string-aware so a `;` inside a quoted literal isn't mistaken for
// a comment, and a `"` inside a comment isn't mistaken for a literal.

/** A `"..."` literal located in some asm text. `start`/`end` are character
 *  offsets of the INNER text (between the quotes) in the scanned string, so a
 *  splice over `[start, end)` replaces the literal's contents and nothing else. */
export interface QuotedLiteral {
  value: string
  start: number
  end: number
}

/**
 * Find every double-quoted literal in `text`, skipping `;` line-comments. asar
 * has no in-string escape for `"` (a `"` always closes the literal), so none is
 * modeled. Newlines reset comment state.
 */
export function findQuotedLiterals(text: string): QuotedLiteral[] {
  const out: QuotedLiteral[] = []
  let i = 0
  let inComment = false
  let inString = false
  let strInner = 0
  while (i < text.length) {
    const c = text[i]
    if (inString) {
      if (c === '"') {
        out.push({ value: text.slice(strInner, i), start: strInner, end: i })
        inString = false
      }
    } else if (inComment) {
      if (c === '\n') inComment = false
    } else if (c === ';') {
      inComment = true
    } else if (c === '"') {
      inString = true
      strInner = i + 1
    }
    i++
  }
  return out
}

/** A single replacement over a half-open character range `[start, end)`. */
export interface TextEdit {
  start: number
  end: number
  replacement: string
}

/**
 * Apply `edits` to `text`. Edits are applied right-to-left so each splice leaves
 * the offsets of the not-yet-applied (earlier) edits valid. Overlapping edits
 * are a caller error — the later-starting one wins and the overlap is clipped.
 */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let out = text
  let lastStart = Infinity
  for (const e of sorted) {
    const end = Math.min(e.end, lastStart)
    out = out.slice(0, e.start) + e.replacement + out.slice(end)
    lastStart = e.start
  }
  return out
}

/** Strip a `;` line-comment from a single line (string-aware). Returns the code
 *  portion (trailing whitespace preserved) — handy for classifying a line. */
export function stripComment(line: string): string {
  let inString = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inString) {
      if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
    } else if (c === ';') {
      return line.slice(0, i)
    }
  }
  return line
}
