// Per-object size mode + live record encoding for the editor.
//
// `obj-metadata.json` is hand-curated and has no size info, so the cart's
// 256-byte standard-object property table (low 2 bits per id = the W/H
// encoding flag) is fetched once via `render.objectPropertyTable()` and cached
// here. From it we derive each object's `sizeMode` (which dimensions it
// actually encodes) — used to gate the Properties panel fields + the resize
// handles — and `encodeObjectRecord`, which regenerates an object's stream
// bytes live (the loader-time `LevelObject.raw` goes stale once edited).

import type { LevelObject } from '../../../preload/api'
import { createRefetchableCache } from '../lib/refetchable-cache'

export type SizeMode = 'none' | 'w' | 'h' | 'wh'

/**
 * Map a property-table byte's low 2 bits to which dimensions the object
 * encodes. Mirrors `serialize-level.ts` exactly: width is present unless the
 * flag is 1, height is present unless the flag is 0 (so flags 2 and 3 both
 * encode W+H). Standard objects are therefore always 'w' / 'h' / 'wh'; 'none'
 * is reserved for extended objects (which carry no W/H).
 */
export function sizeModeFromFlag(propByte: number): SizeMode {
  const flag = propByte & 0b11
  const hasW = flag !== 1
  const hasH = flag !== 0
  return hasW && hasH ? 'wh' : hasW ? 'w' : hasH ? 'h' : 'none'
}

/**
 * Resolve an object's size mode. Extended objects (`num === 0`) encode no W/H.
 * `propTable` is the cart's 256-byte standard-object property table (null until
 * fetched → permissive 'wh' so nothing is wrongly disabled before it loads).
 */
export function objectSizeMode(
  num: number,
  exnum: number | undefined,
  propTable: Uint8Array | null
): SizeMode {
  if (num === 0 && exnum !== undefined) return 'none'
  if (!propTable) return 'wh'
  return sizeModeFromFlag(propTable[num] ?? 0)
}

/** Inverse of `decodeXY` in level.ts — the nibble-interleaved coord pair. */
function encodeXY(x: number, y: number): [number, number] {
  return [
    (y & 0xf0) | ((x >> 4) & 0x0f),
    ((y & 0x0f) << 4) | (x & 0x0f)
  ]
}

/** Inverse of the signed width/height fold in `parseObjects`: byte = (v-1)&0xff. */
function encodeSize(v: number): number {
  return (v - 1) & 0xff
}

/**
 * Regenerate an object's stream record bytes from its semantic fields — a
 * renderer-side mirror of `serializeObjects`. Lets the Properties panel show
 * the CURRENT raw bytes of a moved / resized / added object (whose loader-time
 * `raw[]` no longer matches). `num === 0` ⇒ extended (`exnum` byte, no W/H);
 * otherwise the W and/or H bytes are emitted per `sizeMode`.
 */
export function encodeObjectRecord(o: LevelObject, sizeMode: SizeMode): number[] {
  const [locH, locL] = encodeXY(o.x, o.y)
  const bytes = [o.num & 0xff, locH, locL]
  if (o.num === 0) {
    bytes.push((o.exnum ?? 0) & 0xff)
  } else {
    if (sizeMode === 'w' || sizeMode === 'wh') bytes.push(encodeSize(o.w))
    if (sizeMode === 'h' || sizeMode === 'wh') bytes.push(encodeSize(o.h))
  }
  return bytes
}

// ── Cached cart property table ──────────────────────────────────────────────
// ~256 bytes, read from the render ROM: the project's build with any saved or
// draft overlay edit to the table patched in (it is enrolled in
// ROM_TABLE_PATCHES). It can change, so it lives in a refetchable cache that
// App invalidates (lib/refetchable-cache.ts); an unchanged table keeps its
// identity, which also keeps the placement probe's per-table cache warm.

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

export const objectPropertyTableCache = createRefetchableCache(
  'Object property table',
  () => window.shinyEgg.render.objectPropertyTable(),
  sameBytes
)

/** The last fetched property table (possibly being refreshed), else null. For
 * synchronous callers (edit clamps in the reducer) that can't await it. */
export function cachedObjectPropertyTable(): Uint8Array | null {
  return objectPropertyTableCache.current()
}
