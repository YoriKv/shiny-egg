// Reusable asm marker contract — the `;@editable:<id> begin` / `;@editable:<id>
// end` comment pair that bounds a curated, editor-owned span inside a framework
// `.asm` file (plan step 5). Boundaries are matched by marker, not byte offset,
// so they're robust to line shifts elsewhere in the file.
//
// Editing strategy (see text-literals.ts): tools edit only the contents of the
// region and splice the new region body back between the unchanged marker lines.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Marker line matcher: `;@editable:<id> <begin|end>`, tolerant of leading
 *  indentation, inner whitespace, a trailing CR, and trailing spaces. */
function markerRe(id: string, kw: 'begin' | 'end'): RegExp {
  return new RegExp(`^[ \\t]*;@editable:${escapeRegex(id)}[ \\t]+${kw}[ \\t]*\\r?$`, 'm')
}

export interface AsmRegion {
  /** Text strictly between (not including) the begin and end marker lines. */
  inner: string
  /** Character offset where `inner` begins in the source. */
  innerStart: number
  /** Character offset where `inner` ends (start of the end-marker line). */
  innerEnd: number
}

/** Locate the `;@editable:<id>` region in `source`, or null if its marker pair
 *  is absent. Throws if exactly one of the two markers is present (malformed). */
export function findRegion(source: string, id: string): AsmRegion | null {
  const begin = markerRe(id, 'begin').exec(source)
  const end = markerRe(id, 'end').exec(source)
  if (!begin && !end) return null
  if (!begin || !end) {
    throw new Error(`Malformed @editable region "${id}": missing ${begin ? 'end' : 'begin'} marker.`)
  }
  if (end.index < begin.index) {
    throw new Error(`Malformed @editable region "${id}": end marker precedes begin.`)
  }
  const nl = source.indexOf('\n', begin.index + begin[0].length)
  const innerStart = nl === -1 ? source.length : nl + 1
  return { inner: source.slice(innerStart, end.index), innerStart, innerEnd: end.index }
}

/** Replace the `;@editable:<id>` region body with `newInner`, leaving the marker
 *  lines (and everything outside the region) byte-identical. Throws if the
 *  region isn't found. `newInner` should end with a newline so the end marker
 *  stays on its own line. */
export function spliceRegion(source: string, id: string, newInner: string): string {
  const region = findRegion(source, id)
  if (!region) throw new Error(`@editable region "${id}" not found.`)
  return source.slice(0, region.innerStart) + newInner + source.slice(region.innerEnd)
}
