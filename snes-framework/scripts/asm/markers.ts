// Reusable asm marker contract — the `;@editable:<id> begin` / `;@editable:<id>
// end` comment pair that bounds a curated, editor-owned span inside a framework
// `.asm` file. Boundaries are matched by marker, not byte offset,
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

/** Ids of every `;@editable:<id> begin` marker in `source`, in order of
 *  appearance (deduped). Lets a caller discover which editable regions a file
 *  carries without knowing the ids up front — used by the overlay-drift upgrade
 *  to compare an overlay's regions against the current base's. */
export function listEditableRegionIds(source: string): string[] {
  const re = /^[ \t]*;@editable:(\S+)[ \t]+begin[ \t]*\r?$/gm
  const ids: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      ids.push(m[1])
    }
  }
  return ids
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
