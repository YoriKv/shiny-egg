// Surface fitter — collision surface → the std objects that produce it.
//
// Two entry points share one kernel (footprint table + decode + collision):
//
// • fitSurface — EXACT COVER (round-trip / perfect information). Given a decoded
//   collision grid, recover the std objects cell-for-cell: walk the surface, match
//   each cell's footprint (row + slopeIdx, then the below-surface body for the
//   edge-vs-slope tiebreak), emit floors for flats, resolve layered terrain. No
//   angle snapping. Used by the round-trip harness/test.
//
// • fitHeightProfile — FORWARD (editor paint path). Given painted corner heights
//   (a lossy curve), interpolate the slope lines between corners, decompose each
//   monotonic run into a staircase of representable slope/flat pieces (gradual 2:1
//   / normal 1:1 / steep 1:2, tracking the line within ~1 cell), and place each
//   piece by footprint alignment. The output approximates the drawn curve with the
//   cart's discrete vocabulary.
//
// Pure given a FitContext; both decode internally (footprint probing), so they
// need cart access. Engine-side, against the built ROM (WSL-ok, no native deps).

import { decodeLevelFromLevelData } from './object-decode/index.ts';
import { resolveCellGrid, GRID_COLS, GRID_ROWS } from './cell-grid.ts';
import { loadCollisionTable, type CollisionEntry } from './collision.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { LevelObject, LevelData } from '../types.ts';
import { paletteForTileset, type ThemePalette, type SlopeAngle } from './fit-metadata.ts';

export { CAVE_GRASS, paletteForTileset, tilesetName, fitMetadata } from './fit-metadata.ts';
export type { ThemePalette, SlopeIds, FitMetadata } from './fit-metadata.ts';

/** Cart access the fitter needs for footprint probing (decode) + collision. */
export interface FitContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  workRoot: string;
}

/** A painted corner: a target surface row at a cell-corner column. */
export interface HeightCorner { col: number; row: number; }

const collCache = new WeakMap<Uint8Array, CollisionEntry[]>();
function getColl(ctx: FitContext): CollisionEntry[] {
  let c = collCache.get(ctx.rom);
  if (!c) { c = loadCollisionTable(ctx.rom, ctx.symbols); collCache.set(ctx.rom, c); }
  return c;
}

/** Topmost walkable surface row in column `c`: a solid/slope cell with ≥3 cells of
 *  headroom above, solid-below (or itself a slope). Null if none. The single
 *  collision-surface primitive shared by the fitter and the round-trip harness. */
export function surfaceRow(coll: CollisionEntry[], g: Uint16Array, c: number): number | null {
  const solid = (r: number) => { const e = coll[(g[r * GRID_COLS + c] ?? 0) >> 8]; return !!e && (e.flags.al || e.flags.md || e.flags.sk); };
  const slope = (r: number) => !!coll[(g[r * GRID_COLS + c] ?? 0) >> 8]?.flags.sk;
  for (let r = 3; r < GRID_ROWS - 2; r++)
    if (solid(r) && !solid(r - 1) && !solid(r - 2) && !solid(r - 3) && (solid(r + 1) || slope(r))) return r;
  return null;
}

const mkObj = (num: number, x: number, y: number, w: number, h: number, i: number): LevelObject => ({ index: i, num, exnum: 0, x, y, w, h, raw: [] });

// ── footprint table: per-cell (rx, ry, slopeIdx, surface Map16, body column) ──
// `bm` is the Map16 column just below the surface — distinguishes an edge idiom (a
// vertical edge-body column) from a steep slope (a diagonal wedge). `m` (surface
// Map16) distinguishes a flat pit-edge from plain floor.
const BODY_DEPTH = 3;
const W_LO = -16, W_HI = 16;
interface FpCell { rx: number; ry: number; si: number | null; m: number; bm: number[]; }
interface Cand { num: number; w: number; cells: FpCell[]; }
const fpCache = new Map<string, FpCell[]>();

/** The shared per-(ctx,base) kernel: collision lookups, decode, the footprint
 *  table, and the resolved theme palette. Built once per fit call. */
function makeKernel(ctx: FitContext, base: LevelData) {
  const coll = getColl(ctx);
  const cellEntry = (g: Uint16Array, c: number, r: number) => coll[(g[r * GRID_COLS + c] ?? 0) >> 8];
  const surf = (g: Uint16Array, c: number) => surfaceRow(coll, g, c);
  const decode = (objects: LevelObject[]): Uint16Array => {
    const res = decodeLevelFromLevelData({ rom: ctx.rom, symbols: ctx.symbols, workRoot: ctx.workRoot, levelData: { ...base, objects, sprites: [], exits: [] } as LevelData })!;
    return resolveCellGrid(res.state.levelDataBuffer, res.state.screenPageMap);
  };
  const footprintCells = (num: number, w: number): FpCell[] => {
    const key = `${base.recordId}:${num}:${w}`;
    let cells = fpCache.get(key);
    if (cells) return cells;
    // Probe with a generous fill (h=40) so a wide/steep slope's surface isn't
    // clipped — a steep 2:1 over |w|≤16 drops up to 32 rows. The surface cells +
    // the 3 below-surface body rows are independent of total h, so this doesn't
    // disturb the exact-cover matcher.
    const X = 90, Y = 48;
    const g = decode([mkObj(num, X, Y, w, 40, 0)]);
    cells = [];
    for (let c = X - Math.abs(w) - 4; c <= X + Math.abs(w) + 4; c++) {
      const s = surf(g, c); if (s == null) continue;
      const e = cellEntry(g, c, s);
      const bm: number[] = [];
      for (let k = 1; k <= BODY_DEPTH; k++) bm.push(g[(s + k) * GRID_COLS + c] ?? 0);
      cells.push({ rx: c - X, ry: s - Y, si: e?.flags.sk ? e.slopeIdx : null, m: g[s * GRID_COLS + c] ?? 0, bm });
    }
    cells.sort((a, b) => a.rx - b.rx);
    fpCache.set(key, cells);
    return cells;
  };
  const solidBottom = (g: Uint16Array, c: number, y0: number): number => {
    let last = y0;
    for (let r = y0; r < GRID_ROWS; r++) {
      if ((g[r * GRID_COLS + c] ?? 0) === 0) break;
      const e = cellEntry(g, c, r);
      if (e && (e.flags.al || e.flags.md || e.flags.sk)) last = r;
    }
    return last;
  };
  const palette = paletteForTileset(base.header[1] ?? -1);

  // The +w collision direction of a slope id: +1 = down-right (surface row grows
  // left→right), -1 = down-left, 0 = flat. Memoised. We PROBE the real footprint
  // instead of trusting a metadata direction label — see resolveSlope.
  const dirCache = new Map<number, number>();
  const plusWDir = (num: number): number => {
    let d = dirCache.get(num);
    if (d === undefined) {
      const fp = footprintCells(num, 4);
      d = fp.length >= 2 ? Math.sign(fp[fp.length - 1]!.ry - fp[0]!.ry) : 0;
      dirCache.set(num, d);
    }
    return d;
  };

  // Resolve a wanted (angle, direction) → a concrete {num, w}. Picks the
  // visually-correct id the palette assigns to that direction, then chooses the
  // WIDTH SIGN that actually produces that direction's collision surface. Some
  // tilesets have no dedicated +w down-left id (flower garden — its "left" slopes
  // are the right shape mirrored, so they only descend-left at NEGATIVE width);
  // probing the id's natural +w direction and flipping the sign when it differs
  // is what lets an ascending stroke fit ONE wide mirrored slope (corner-to-corner)
  // instead of a stack of single-cell tips. `desc` = descending = down-right.
  const resolveSlope = (angle: SlopeAngle, desc: boolean, width: number): { num: number; w: number } | null => {
    if (!palette) return null;
    const want = desc ? 1 : -1;
    let num = (desc ? palette.slopeDownRight : palette.slopeDownLeft)[angle];
    if (num == null) num = (desc ? palette.slopeDownLeft : palette.slopeDownRight)[angle];
    if (num == null) return null;
    const nat = plusWDir(num) || 1; // flat/unknown ⇒ treat as down-right-natural
    return { num, w: nat === want ? width : -width };
  };

  return { coll, cellEntry, surf, decode, footprintCells, solidBottom, palette, plusWDir, resolveSlope };
}
type Kernel = ReturnType<typeof makeKernel>;

// ════════════════════════════════════════════════════════════════════════════
// fitSurface — exact cover (reverse / round-trip)
// ════════════════════════════════════════════════════════════════════════════
export function fitSurface(ctx: FitContext, base: LevelData, srcGrid: Uint16Array, x0: number, x1: number, baseline: number): LevelObject[] {
  const k = makeKernel(ctx, base);
  const { cellEntry, surf, footprintCells, palette } = k;
  const floorId = palette?.floor ?? 0x01;
  const slopeNums = palette
    ? [...new Set([
        ...Object.values(palette.slopeDownRight), ...Object.values(palette.slopeDownLeft),
        palette.edgeLeft, palette.edgeRight,
      ].filter((n): n is number => n != null))]
    : [];
  const cands: Cand[] = [];
  for (const num of slopeNums) for (let w = W_LO; w <= W_HI; w++) {
    const cells = footprintCells(num, w);
    if (cells.length) cands.push({ num, w, cells });
  }

  // Place `cand` so its leftmost cell lands at (col,row): does its whole footprint
  // reproduce the source cells (row + sk/slopeIdx)? Returns anchor + span + `body`
  // (below-surface Map16 matches, the edge-vs-slope tiebreak), else null.
  const matchAt = (cand: Cand, col: number, row: number): { x: number; y: number; span: number; body: number } | null => {
    const first = cand.cells[0]!;
    const x = col - first.rx, y = row - first.ry;
    let body = 0;
    for (const cell of cand.cells) {
      const cc = x + cell.rx, rr = y + cell.ry;
      if (cc < 0 || cc >= GRID_COLS) return null;
      if (surf(srcGrid, cc) !== rr) return null;
      const e = cellEntry(srcGrid, cc, rr);
      const srcSk = !!e?.flags.sk;
      if ((cell.si != null) !== srcSk) return null;
      if (cell.si != null && e!.slopeIdx !== cell.si) return null;
      for (let kk = 0; kk < cell.bm.length; kk++)
        if (cell.bm[kk] !== 0 && (srcGrid[(rr + 1 + kk) * GRID_COLS + cc] ?? 0) === cell.bm[kk]) body++;
    }
    return { x, y, span: cand.cells[cand.cells.length - 1]!.rx - first.rx + 1, body };
  };

  // A flat pit-edge sits flat like floor but stamps a distinctive surface Map16
  // (floor's decorative tiles never collide with it).
  const flatEdgeAt = (cc: number, ss: number): { num: number; w: number; x: number; y: number; span: number } | null => {
    let best: { num: number; w: number; x: number; y: number; span: number } | null = null;
    for (const cand of cands) {
      if (palette == null || (cand.num !== palette.edgeLeft && cand.num !== palette.edgeRight) || cand.cells[0]!.si != null) continue;
      const r = matchAt(cand, cc, ss);
      if (!r) continue;
      let tiles = true;
      for (const cell of cand.cells) if ((srcGrid[(r.y + cell.ry) * GRID_COLS + (r.x + cell.rx)] ?? 0) !== cell.m) { tiles = false; break; }
      if (tiles && (!best || r.span > best.span || (r.span === best.span && Math.abs(cand.w - 1) < Math.abs(best.w - 1))))
        best = { num: cand.num, w: cand.w, x: r.x, y: r.y, span: r.span };
    }
    return best;
  };

  const out: LevelObject[] = [];
  let idx = 0, c = x0;
  while (c <= x1) {
    const s = surf(srcGrid, c);
    if (s == null) { c++; continue; }
    if (cellEntry(srcGrid, c, s)?.flags.sk) {
      let best: { num: number; w: number; x: number; y: number; span: number; body: number } | null = null;
      for (const cand of cands) {
        const m = matchAt(cand, c, s);
        if (m && (!best || m.span > best.span || (m.span === best.span && m.body > best.body)))
          best = { num: cand.num, w: cand.w, ...m };
      }
      if (best) {
        out.push(mkObj(best.num, best.x, best.y, best.w, Math.max(1, baseline - best.y + 1), idx++));
        c += best.span;
        continue;
      }
    }
    const edge = flatEdgeAt(c, s);
    if (edge) {
      out.push(mkObj(edge.num, edge.x, edge.y, edge.w, Math.max(1, baseline - edge.y + 1), idx++));
      c += edge.span;
      continue;
    }
    let j = c;
    while (j + 1 <= x1) {
      const ns = surf(srcGrid, j + 1);
      if (ns !== s) break;
      if (cellEntry(srcGrid, j + 1, ns)?.flags.sk) break;
      if (flatEdgeAt(j + 1, ns)) break;
      j++;
    }
    out.push(mkObj(floorId, c, s, j - c + 1, Math.max(1, baseline - s + 1), idx++));
    c = j + 1;
  }

  if (palette) layerTerrain(out, palette, floorId, x0, x1, baseline, srcGrid, surf, cellEntry, solidBottomFor(srcGrid, k));
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// fitHeightProfile — forward (paint path): corners → staircase → objects
// ════════════════════════════════════════════════════════════════════════════
const ANGLES = ['gradual', 'normal', 'steep'] as const;
const RATE: Record<typeof ANGLES[number], number> = { gradual: 0.5, normal: 1, steep: 2 };

export function fitHeightProfile(ctx: FitContext, base: LevelData, corners: HeightCorner[], baseline: number): LevelObject[] {
  if (corners.length < 1) return [];
  const k = makeKernel(ctx, base);
  const palette = k.palette;
  const floorId = palette?.floor ?? 0x01;
  const pts = [...corners].sort((a, b) => a.col - b.col).filter((p, i, a) => i === 0 || p.col !== a[i - 1]!.col);
  const fillH = (row: number) => Math.max(1, baseline - row + 1);
  const x0 = pts[0]!.col, x1 = pts[pts.length - 1]!.col;

  const out: LevelObject[] = [];
  let idx = 0;
  if (x1 === x0) { out.push(mkObj(floorId, x0, pts[0]!.row, 1, fillH(pts[0]!.row), idx++)); return out; }

  // Dense per-column TARGET surface row: the slope lines interpolated between the
  // corners. The painter sets one height per column, so this is usually already
  // per-column; sparse corners are linearly filled.
  const target = new Array<number>(x1 - x0 + 1);
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s]!, b = pts[s + 1]!, span = b.col - a.col;
    for (let c = a.col; c <= b.col; c++) target[c - x0] = Math.round(a.row + ((b.row - a.row) * (c - a.col)) / span);
  }
  const targetAt = (c: number) => target[Math.max(0, Math.min(target.length - 1, c - x0))]!;

  // ONE greedy walk over the WHOLE curve (re-anchoring to the target each object so
  // it can't drift). At each column we pick the SMOOTHEST slope and otherwise lay a
  // floor run. "Smoothest" = match the curve's local shape with as few, as wide,
  // and as corner-aligned objects as possible:
  //
  //   • Among all (angle × direction × width) candidates whose footprint, anchored
  //     at the target, tracks the painted row within 1 cell over its WHOLE span, we
  //     prefer (a) a TIGHT far corner — the slope's far end landing exactly on the
  //     curve, so the next object butts up corner-to-corner — then (b) the LONGEST
  //     span, then (c) the angle nearest the local rate, then (d) least deviation.
  //   • Because only the angle whose rate matches the curve can stay within 1 cell
  //     while WIDE, this naturally fits a clean gradual stroke with the gradual
  //     object (not a sawtooth of 1:1 pieces that merely cell-match), a 45° stroke
  //     with one normal slope, etc. Off-angle strokes decompose into a staircase of
  //     the nearest representable slope, each piece re-anchored so it can't drift.
  //
  // Running globally (not per corner-pair) is what lets a slope span many painted
  // columns — a 45° line drawn column-by-column fits ONE slope, not a row of floors.
  const placeSlope = (num: number, w: number, col: number, row: number): void => {
    const fp = k.footprintCells(num, w);
    out.push(mkObj(num, col - fp[0]!.rx, row - fp[0]!.ry, w, fillH(row - fp[0]!.ry), idx++));
  };
  let col = x0, guard = 0;
  while (col <= x1 && guard++ < 100000) {
    const row = targetAt(col);
    const remCols = x1 - col + 1;
    let flatW = 1;
    while (flatW < remCols && targetAt(col + flatW) === row) flatW++;

    // The smoothest slope at `col`. We look past a leading flat to the curve's
    // TREND so a gently-sloped region (which reads as a micro-staircase of flats
    // once heights are rounded to whole cells) still fits a continuous SLOPE, not a
    // run of floor steps — that's the "prioritise smooth curves" intent.
    let best: { num: number; w: number; span: number; endTight: boolean; rank: number; dev: number } | null = null;
    let trendCol = col + 1;
    while (trendCol <= x1 && targetAt(trendCol) === row) trendCol++;
    if (palette && trendCol <= x1) {
      const desc = targetAt(trendCol) > row;
      let end = trendCol; // extend over the monotonic-with-flats run for the local rate
      while (end + 1 <= x1 && (targetAt(end + 1) === targetAt(end) || (targetAt(end + 1) > targetAt(end)) === desc)) end++;
      const rate = Math.abs(targetAt(end) - row) / (end - col);
      const order = [...ANGLES].sort((a, b) => Math.abs(RATE[a] - rate) - Math.abs(RATE[b] - rate));
      // Treat FLAT (rate 0) as a representable option: a run nearer flat than its
      // nearest slope angle reads smoother as monotonic floor steps than as a
      // near-flat slope forced into a sawtooth — so skip slopes and lay floors.
      if (Math.abs(rate) >= Math.abs(rate - RATE[order[0]!])) for (let ai = 0; ai < order.length; ai++) {
        const angle = order[ai]!;
        if (!k.resolveSlope(angle, desc, 1)) continue; // angle id+sign fixed; width scales it
        for (let width = Math.min(remCols, W_HI); width >= 2; width--) {
          const sw = k.resolveSlope(angle, desc, width)!;
          const fp = k.footprintCells(sw.num, sw.w); if (!fp.length) continue;
          const minRx = fp[0]!.rx, minRy = fp[0]!.ry, last = fp[fp.length - 1]!, span = last.rx - minRx + 1;
          if (span > remCols || Math.abs(last.ry - minRy) < 1) continue; // must actually change height
          let dev = 0, ok = true;
          for (const cell of fp) { const d = Math.abs((row + (cell.ry - minRy)) - targetAt(col + (cell.rx - minRx))); if (d > 1) { ok = false; break; } if (d > dev) dev = d; }
          if (!ok) continue;
          const endTight = (row + (last.ry - minRy)) === targetAt(col + span - 1);
          // prefer tight far corner, then longer span, then nearer angle, then less dev
          if (!best
            || (endTight && !best.endTight)
            || (endTight === best.endTight && (span > best.span
              || (span === best.span && (ai < best.rank
                || (ai === best.rank && dev < best.dev)))))) {
            best = { num: sw.num, w: sw.w, span, endTight, rank: ai, dev };
          }
        }
      }
    }

    if (best && best.span >= flatW) { placeSlope(best.num, best.w, col, row); col += best.span; continue; }

    // Floor: a flat run, or a single cell to step over an un-slopeable jump.
    out.push(mkObj(floorId, col, row, flatW, fillH(row), idx++));
    col += flatW;
  }
  return out;
}

// solidBottom bound to a grid (small adapter so layerTerrain's signature stays clean)
function solidBottomFor(grid: Uint16Array, k: Kernel) {
  return (_g: Uint16Array, c: number, y0: number) => k.solidBottom(grid, c, y0);
}

/** Resolve raised-terrain idioms after the exact-cover surface walk (see fitSurface). */
function layerTerrain(
  out: LevelObject[], palette: ThemePalette, floorId: number, x0: number, x1: number, baseline: number,
  srcGrid: Uint16Array, surf: (g: Uint16Array, c: number) => number | null,
  cellEntry: (g: Uint16Array, c: number, r: number) => CollisionEntry | undefined,
  solidBottom: (g: Uint16Array, c: number, y0: number) => number,
): void {
  const isEdge = (o: LevelObject) => o.num === palette.edgeLeft || o.num === palette.edgeRight;
  const groundId = palette.ground;

  if (groundId == null) {
    const corners: number[] = [];
    for (const o of out) {
      if (!isEdge(o)) continue;
      const nb = o.num === palette.edgeLeft ? o.x - 1 : o.x + Math.max(1, o.w);
      const nbSurf = surf(srcGrid, nb);
      const bottom = solidBottom(srcGrid, o.x, o.y);
      if (nbSurf != null && nbSurf > o.y) { o.h = Math.max(1, Math.min(nbSurf, bottom) - o.y + 1); corners.push(Math.min(nbSurf, bottom)); }
      else o.h = Math.max(1, bottom - o.y + 1);
    }
    if (!corners.length) return;
    const B = Math.min(...corners);
    const solidAt = (c: number, r: number) => { const e = cellEntry(srcGrid, c, r); return !!e && (e.flags.al || e.flags.md || e.flags.sk); };
    const edgeAtB = (c: number) => out.some(o => isEdge(o) && o.x === c && o.y === B);
    const onBase = (c: number) => { const s = surf(srcGrid, c); return s != null && s <= B; };
    let lo = Math.min(...out.filter(o => isEdge(o) && surf(srcGrid, o.x) != null && solidAt(o.x, B) && surf(srcGrid, o.x)! < B).map(o => o.x));
    while (lo - 1 >= x0 && solidAt(lo - 1, B) && (surf(srcGrid, lo - 1) == null || surf(srcGrid, lo - 1)! >= B)) lo--;
    let hi = lo;
    while (hi + 1 <= x1 && onBase(hi + 1) && !edgeAtB(hi + 1)) hi++;
    for (let i = out.length - 1; i >= 0; i--) { const o = out[i]!; if (o.num === floorId && o.y === B && o.x >= lo && o.x + Math.max(1, o.w) - 1 <= hi) out.splice(i, 1); }
    out.unshift(mkObj(floorId, lo, B, hi - lo + 1, Math.max(1, baseline - B + 1), 0));
    out.forEach((o, i) => (o.index = i));
    return;
  }

  const edges = out.filter(isEdge).sort((a, b) => a.x - b.x);
  const used = new Set<LevelObject>();
  let idx = out.length;
  for (const L of edges) {
    if (L.num !== palette.edgeLeft || used.has(L)) continue;
    const R = edges.find(o => o.num === palette.edgeRight && o.x > L.x && !used.has(o));
    if (!R) continue;
    const a = L.x, b = R.x;
    const leftFloor = surf(srcGrid, a - 1), rightFloor = surf(srcGrid, b + 1);
    if (leftFloor == null || rightFloor == null) continue;
    const groundTop = Math.min(leftFloor, rightFloor);
    if (groundTop <= L.y) continue;
    used.add(L); used.add(R);
    for (const o of out) if (o.x >= a && o.x <= b && o.num !== groundId) o.h = Math.max(1, groundTop - o.y);
    out.push(mkObj(groundId, a, groundTop, b - a + 1, Math.max(1, baseline - groundTop + 1), idx++));
  }
}
