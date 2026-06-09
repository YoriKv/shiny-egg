// Resolved-cell grid + diff — the shared substrate for incremental
// (patch-based) BG1 / collision re-rendering (Tier 2 incremental re-render).
//
// The object decoder produces a 32-KB `levelDataBuffer` of 16-bit Map16 IDs
// addressed *through* the per-screen LRU-page indirection (`screenPageMap`):
// a cell's bytes live at `page*512 + cellY*32 + cellX*2`, and which page backs
// a given on-screen position depends on `screenPageMap`. Both renderers walk
// that indirection per cell.
//
// To diff two decodes we first FLATTEN that indirection into a dense grid
// addressed by absolute on-screen cell position (the same coordinate the
// rendered bitmap uses). Then a cell-by-cell compare of two flattened grids
// captures EVERY change to the rendered output — autotile neighbour ripples,
// overwrite-order effects, AND screen alloc/dealloc / page-remap (a screen
// that now resolves to a different LRU page yields different resolved IDs for
// its whole 16×16 block). That exactness is what lets the patch path stay
// byte-identical to a full re-render.
//
// What a resolved ID captures vs. doesn't:
//   - BG1 pixels depend on (resolved Map16 ID, tileset/palette/changer-band).
//     The grid captures the ID; the caller must additionally hold the band/
//     tileset context fixed (it forces a full render when those change).
//   - Collision pixels depend ONLY on the resolved ID (its high byte = page →
//     collision table). So the grid diff is exact for collision with no extra
//     context gate.

const SCREENS_WIDE = 16;
const SCREENS_TALL = 8;
const CELLS_PER_SCREEN_EDGE = 16;

// ── Per-screen LRU-page indirection (single source for all four renderers) ──
// The decoder's Map16 buffer is addressed THROUGH `screenPageMap`: a slot picks
// the backing page for an on-screen position, and a cell's 16-bit ID lives at
// `page*PAGE_STRIDE + cellY*32 + cellX*2`. render-bg1, render-collision, and
// provenance all walk this same indirection — import these (and `resolveCellMap16`)
// rather than re-declaring them.

/** Stride of one screen-page in the Map16 buffer: 512 bytes (16×16 cells × 2). */
export const PAGE_STRIDE = 1 << 9;
/** `screenPageMap` slot for an unallocated screen — renders nothing. */
export const SCREEN_PAGE_UNALLOCATED = 0x80;
/** Low 6 bits of a slot = its LRU page index (1..63; 0 = unstamped backing). */
export const LRU_PAGE_MASK = 0x3f;
/** LRU page-index space: 6 bits → 64 pages (0..63). */
export const PAGES = 64;

/**
 * Resolve the 16-bit Map16 ID backing on-screen cell `(screenX,screenY / cellX,
 * cellY)` through the LRU-page indirection. Returns 0 — the renderers' uniform
 * "render nothing" sentinel — for an unallocated screen, the unstamped page 0,
 * OR a genuinely-unstamped cell, so a single `=== 0` check at the call site
 * collapses all three skip cases. */
export function resolveCellMap16(
  levelDataBuffer: Uint8Array,
  screenPageMap: Uint8Array,
  screenX: number,
  screenY: number,
  cellX: number,
  cellY: number
): number {
  const slot = screenPageMap[(screenY << 4) | screenX]!;
  if (slot === SCREEN_PAGE_UNALLOCATED) return 0;
  const lruPage = slot & LRU_PAGE_MASK;
  if (lruPage === 0) return 0;
  const off = lruPage * PAGE_STRIDE + (cellY << 5) + cellX * 2;
  return levelDataBuffer[off]! | (levelDataBuffer[off + 1]! << 8);
}

/** Dense grid dimensions, in cells (matches the rendered bitmap / 16). */
export const GRID_COLS = SCREENS_WIDE * CELLS_PER_SCREEN_EDGE; // 256
export const GRID_ROWS = SCREENS_TALL * CELLS_PER_SCREEN_EDGE; // 128

/**
 * Flatten the decoder's page-indirected Map16 buffer into a dense
 * `GRID_ROWS × GRID_COLS` grid of resolved 16-bit Map16 IDs, indexed by
 * `absCellY * GRID_COLS + absCellX`. Unallocated / page-0 cells resolve to 0
 * (the renderers' "render nothing" sentinel), so the grid value IS the rendered
 * cell's identity.
 */
export function resolveCellGrid(
  levelDataBuffer: Uint8Array,
  screenPageMap: Uint8Array
): Uint16Array {
  const grid = new Uint16Array(GRID_COLS * GRID_ROWS);
  for (let screenY = 0; screenY < SCREENS_TALL; screenY++) {
    for (let screenX = 0; screenX < SCREENS_WIDE; screenX++) {
      const slot = screenPageMap[(screenY << 4) | screenX]!;
      if (slot === SCREEN_PAGE_UNALLOCATED) continue;
      const page = slot & LRU_PAGE_MASK;
      if (page === 0) continue; // page 0 = "unstamped" backing, renders nothing
      const pageBase = page * PAGE_STRIDE;
      for (let cellY = 0; cellY < CELLS_PER_SCREEN_EDGE; cellY++) {
        const rowBase = pageBase + (cellY << 5);
        const outRow = (screenY * CELLS_PER_SCREEN_EDGE + cellY) * GRID_COLS
          + screenX * CELLS_PER_SCREEN_EDGE;
        for (let cellX = 0; cellX < CELLS_PER_SCREEN_EDGE; cellX++) {
          const off = rowBase + cellX * 2;
          grid[outRow + cellX] = levelDataBuffer[off]! | (levelDataBuffer[off + 1]! << 8);
        }
      }
    }
  }
  return grid;
}

/**
 * Diff two resolved grids (same length) and return the absolute cell coords
 * whose cell value changed, as a flat `Int32Array` of `[x0,y0,x1,y1,…]` — the
 * patch's changed-cell list. A cleared cell (value → 0) IS included (its new
 * render is fully transparent, which the patch must apply to overwrite the old
 * pixels). Order is row-major; both renderers and the renderer-side apply are
 * order-independent (each cell is overwritten in place).
 *
 * Accepts `Uint16Array` (BG1/collision resolved Map16 IDs) or `Uint32Array`
 * (the sprite layer's per-cell content-signature grid — see
 * `render-sprite-layer.ts`): same diff, the cell value is just an opaque
 * identity either way.
 */
export function diffCellGrids(
  oldGrid: Uint16Array | Uint32Array,
  newGrid: Uint16Array | Uint32Array
): Int32Array {
  // Two passes: count, then fill — avoids growing a JS array (the common case
  // is a handful of cells, but a big object move can touch thousands).
  let n = 0;
  for (let i = 0; i < newGrid.length; i++) if (oldGrid[i] !== newGrid[i]) n++;
  const coords = new Int32Array(n * 2);
  let w = 0;
  for (let i = 0; i < newGrid.length; i++) {
    if (oldGrid[i] === newGrid[i]) continue;
    coords[w++] = i % GRID_COLS; // x
    coords[w++] = (i / GRID_COLS) | 0; // y
  }
  return coords;
}
