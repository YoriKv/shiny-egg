// Browser-safe loader probe: no ROM, filesystem, rendering, or emulator needed.
// Run the same handlers as the renderer at the proposed coordinates. Unlike a
// translated bounding rectangle this preserves position-dependent walker logic.
import { HANDLER_INSTALLERS } from './object-decode/handlers/all.ts';
import { loadLevelObjectStream } from './object-decode/parser.ts';
import { DecodeState } from './object-decode/state.ts';
import type { LevelObject } from '../types.ts';

for (const install of HANDLER_INSTALLERS) install();

// USA 1.0 Bank12 DATA_object_property_table, low two bits. These control
// which dimensions are actually serialized, not the visible object geometry.
// Fallback only: callers pass the cart's own table when they have it (an asm
// edit to the table changes which size bytes each id carries). Kept inline so
// this module needs no ROM or filesystem; object-placement.test.ts pins it to
// the `object-properties` region of Bank12.asm.
export const DEFAULT_OBJECT_PROPERTIES = Uint8Array.from([
  3,2,1,1,2,2,2,2,2,2,1,1,1,0,1,1,
  2,2,2,0,2,0,2,2,2,2,0,1,1,0,0,2,
  2,2,1,1,2,1,1,2,2,2,2,1,1,1,1,1,
  1,1,2,2,0,2,1,0,2,2,2,2,1,0,1,1,
  1,0,1,1,2,2,2,2,2,1,1,1,1,1,2,2,
  1,0,2,0,2,2,2,0,2,2,2,2,2,2,2,2,
  2,2,2,0,0,0,2,2,2,2,0,2,2,1,2,1,
  0,0,0,1,1,1,1,1,2,0,2,2,0,0,0,2,
  0,0,2,0,0,2,2,2,2,2,2,2,0,1,0,2,
  2,1,1,1,2,2,2,2,2,1,1,1,1,2,0,0,
  2,2,2,2,2,1,0,2,2,1,1,1,0,0,1,0,
  2,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,
  0,0,0,0,0,1,0,0,1,0,2,2,2,2,0,0,
  0,1,0,2,1,1,0,0,0,0,2,2,2,2,1,0,
  1,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,
  2,2,2,2,1,2,2,3,3,3,3,3,3,3,3,3
]);

/** One probe's verdict plus what it cost: cells the loader walk visited plus
 * a fixed per-probe overhead. Callers searching over many anchors budget by
 * cost (a degenerate extent can walk thousands of cells before it overflows),
 * and a cached result reports its original cost, so a budgeted search makes
 * the same decisions whether or not its probes were cached. */
export interface PlacementProbe {
  safe: boolean;
  cost: number;
}

/** Per-probe overhead in visit units (stream setup + DecodeState reset). */
const PROBE_OVERHEAD = 64;

// One cache per property table (results depend on it), values encoded as
// +cost (safe) / -cost (unsafe). Evicts oldest-first rather than clearing, so
// a search that overruns the limit keeps its recent probes.
const CACHE_LIMIT = 16384;
const caches = new WeakMap<Uint8Array, Map<string, number>>();
class ProbeBudgetError extends Error {}
let warnedThrow = false;
// Reused across probes (reset() reinitializes every buffer); probes are
// synchronous and handlers never re-enter the probe.
let probeState: DecodeState | null = null;

/** Whether this single object's loader walk completes without overflowing.
 * Blank neighbour context is intentional: this checks the walker, not rendered
 * tile bounds. Full-level page exhaustion remains a separate level-wide limit.
 * A handler that throws anything else counts as unsafe rather than propagating:
 * callers run this synchronously inside edit reducers and draw code.
 */
export function probeObjectPlacement(
  object: Pick<LevelObject, 'num' | 'exnum' | 'x' | 'y' | 'w' | 'h'>,
  header: readonly number[] = [],
  properties: Uint8Array = DEFAULT_OBJECT_PROPERTIES
): PlacementProbe {
  const { num, exnum, x, y, w, h } = object;
  if (![num, x, y, w, h].every(Number.isInteger) || num < 0 || num >= 255 || x < 0 || x > 255 || y < 0 || y > 127) {
    return { safe: false, cost: 1 };
  }
  let cache = caches.get(properties);
  if (!cache) caches.set(properties, (cache = new Map()));
  const key = `${num},${exnum},${x},${y},${w},${h};${header.join(',')}`;
  const cached = cache.get(key);
  if (cached !== undefined) return { safe: cached > 0, cost: Math.abs(cached) };
  const bytes = [num, (y & 0xf0) | (x >>> 4), ((y & 15) << 4) | (x & 15)];
  if (num === 0) bytes.push(exnum ?? 0);
  else {
    const mode = (properties[num] ?? 0) & 3;
    if (mode !== 1) bytes.push((w - 1) & 255);
    if (mode !== 0) bytes.push((h - 1) & 255);
  }
  bytes.push(0xff, 0xff);
  const state = (probeState ??= new DecodeState());
  state.reset(Uint8Array.from(bytes), header);
  let visits = 0;
  state.visitCell = () => {
    // Malformed zero/wrapped extents must not hang the editor either.
    if (++visits > 65536) throw new ProbeBudgetError();
  };
  let safe: boolean;
  try {
    const result = loadLevelObjectStream(state, properties);
    safe = !result.overflowed && !result.aborted && result.unregisteredObjects === 0;
  } catch (error) {
    if (!(error instanceof ProbeBudgetError) && !warnedThrow) {
      warnedThrow = true;
      console.warn(`object placement probe: handler threw for ${key}; treating as unsafe`, error);
    }
    safe = false;
  }
  state.visitCell = null;
  const cost = visits + PROBE_OVERHEAD;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, safe ? cost : -cost);
  return { safe, cost };
}

/** `probeObjectPlacement(...).safe`. */
export function isObjectPlacementSafe(
  object: Pick<LevelObject, 'num' | 'exnum' | 'x' | 'y' | 'w' | 'h'>,
  header: readonly number[] = [],
  properties: Uint8Array = DEFAULT_OBJECT_PROPERTIES
): boolean {
  return probeObjectPlacement(object, header, properties).safe;
}
