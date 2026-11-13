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
const properties = Uint8Array.from([
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

const cache = new Map<string, boolean>();
class ProbeBudgetError extends Error {}

/** Whether this single object's loader walk completes without overflowing.
 * Blank neighbour context is intentional: this checks the walker, not rendered
 * tile bounds. Full-level page exhaustion remains a separate level-wide limit.
 */
export function isObjectPlacementSafe(
  object: Pick<LevelObject, 'num' | 'exnum' | 'x' | 'y' | 'w' | 'h'>,
  header: readonly number[] = []
): boolean {
  const { num, exnum, x, y, w, h } = object;
  if (![num, x, y, w, h].every(Number.isInteger) || num < 0 || num >= 255 || x < 0 || x > 255 || y < 0 || y > 127) return false;
  const key = `${num},${exnum},${x},${y},${w},${h};${header.join(',')}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const bytes = [num, (y & 0xf0) | (x >>> 4), ((y & 15) << 4) | (x & 15)];
  if (num === 0) bytes.push(exnum ?? 0);
  else {
    const mode = properties[num] & 3;
    if (mode !== 1) bytes.push((w - 1) & 255);
    if (mode !== 0) bytes.push((h - 1) & 255);
  }
  bytes.push(0xff, 0xff);
  const state = new DecodeState();
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
    if (!(error instanceof ProbeBudgetError)) throw error;
    safe = false;
  }
  if (cache.size >= 4096) cache.clear();
  cache.set(key, safe);
  return safe;
}
