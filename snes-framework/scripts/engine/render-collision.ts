// Collision-overlay renderer.
//
// Produces a full-extent RGBA bitmap (matching `renderBg1`'s 4096×2048 size)
// that visualises the cart's collision metadata as a semi-transparent
// overlay drawn on top of BG1. Slope tiles render their actual per-pixel
// surface line (from `slope_panels_table`); flat solid tiles render as a
// uniform red fill; tunnel / cut tiles (the Layer-2 carve family — walls,
// cross-sections, wall holes) render a more-transparent BLUE because they are
// passage, NOT solid (Yoshi walks through them); exit triggers (pipe mouths +
// doors) render green; on top of the fills, cells whose page carries a
// designer-meaningful BEHAVIOURAL secondary-tag get a dotted box outline (one
// color per group: pipe / door / bonus-door / falling-floor / switch-block /
// damage / water-lava — see `tagOutlineColor`) so the behaviour class reads at
// a glance; collectibles (coins — overlap, no physics) render yellow.
//
// **Per-page caching.** The cart's collision is keyed on the high byte
// (page) of each Map16 ID — all 256 visual variants of a page share the
// same collision. So we render each unique page's 16×16 RGBA "collision
// cell" ONCE, cache it, and blit it into every cell that references the
// page. A typical level uses 30-50 unique pages out of 168; rendering the
// 16384 cells of a 4096×2048 bitmap through a lookup-and-blit is far
// cheaper than re-decoding the slope profile + writing per-pixel for each
// cell from scratch.
//
// Faithful-overlay note (NOT a bug): YI floor slopes carry their collision in
// the slope tiles themselves; the cart stamps a non-collidable decorative
// filler directly beneath the surface (e.g. std-04/05 22.5° slopes use page
// $12, siblings $11/$13 — all bg_type 00 00 00), so the overlay shows a 1-cell
// empty band hugging the slope underside. That's the real cart data — we
// deliberately do NOT add a "fill under the slope" silhouette heuristic; the
// overlay stays data-faithful (designer decision).

import type { CollisionEntry, SlopePanels } from './collision.ts';
import { decodeSlopeProfile, SECONDARY_TAG_NAMES } from './collision.ts';
import type { LayerCellPatch } from '../types.ts';
import { SCREEN_PAGE_UNALLOCATED, LRU_PAGE_MASK, resolveCellMap16 } from './cell-grid.ts';

const CELL_PX = 16;
const SCREENS_WIDE = 16;
const SCREENS_TALL = 8;
const CELLS_PER_SCREEN_EDGE = 16;

const TOTAL_WIDTH = SCREENS_WIDE * CELLS_PER_SCREEN_EDGE * CELL_PX;
const TOTAL_HEIGHT = SCREENS_TALL * CELLS_PER_SCREEN_EDGE * CELL_PX;

export interface CollisionRenderResult {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** How many unique pages contributed visible overlay pixels. Surfaced
   *  for debugging / UI badges. */
  uniquePagesRendered: number;
}

interface RenderCollisionArgs {
  /** Parsed collision table — 168 entries. */
  collisionTable: CollisionEntry[];
  /** Raw slope_panels_table buffer (only consulted for SK pages). */
  slopePanels: SlopePanels;
  /** 32 KB Map16 ID grid from the object decoder. */
  levelDataBuffer: Uint8Array;
  /** 128-byte per-screen LRU-page map. */
  screenPageMap: Uint8Array;
}

// ───────────────────────────────────────────────────────────────────────
// Color palette (semi-transparent ARGB → u32 packed for ImageData)
//
// Alpha values chosen so the BG1 graphics underneath remain visible while
// the overlay clearly communicates the shape category at a glance.
// ───────────────────────────────────────────────────────────────────────

// Alpha values chosen so the overlay reads CLEARLY on top of sprites
// and foreground BG1 tiles. Earlier values (38% fill / 75% line / 25%
// slope-under) were too transparent — sprites bled through enough that
// the collision shapes were hard to pick out at gameplay zoom. Bumped
// to give the overlay first-class visual priority while still letting
// the foreground show through enough to cross-reference.
const ALPHA_FILL = 0xB0; // ≈ 69% opacity for the green/yellow trigger fills
// Solid-collision red is ONE flat, less-transparent red for every solid pixel:
// the solid-cell fill, the slope under-fill, AND the slope surface line all use
// it, so a slope reads as a single uniform red triangle (no darker edge line).
const ALPHA_RED = 0xD8; // ≈ 85% opacity for all solid-collision red
// Tunnel / cut tiles (Layer-2 carve family: walls 0x7A-0x7C, cross-section
// 0x14, wall hole 0x7F) are PASSAGE — Yoshi walks through them, they are not
// solid. They render a more-transparent blue so they read as "carved passage"
// and never get mistaken for the red solid mass. Lower alpha than the solids.
const ALPHA_TUNNEL = 0x70; // ≈ 44% opacity — clearly lighter than the solids

/** Pack RGB + alpha into a u32 in the byte order `R,G,B,A` (canvas
 *  ImageData layout on little-endian — every browser target). */
function rgba(r: number, g: number, b: number, a: number): number {
  return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

// Palette by what the designer needs to distinguish, not by cart category:
// every SOLID-collision category renders the SAME red (slopes too — one flat
// red triangle, no separate edge line). The cart's solid-category distinctions
// (water vs mud vs lava etc.) still matter for gameplay but all communicate
// "Yoshi can't pass through this surface" — one red reads cleaner than 6 hues.
// The categories worth their own color are the NON-solid ones: tunnel / cut
// (Layer-2 passage — walls, cross-sections, holes) renders a transparent blue
// ("carved passage, walkable"), exit triggers render green ("Yoshi warps
// here"), and collectibles render yellow ("overlap to collect, no physics").
const SOLID_RED       = rgba(0xE6, 0x3A, 0x3A, ALPHA_RED);
// Exit triggers (pipe mouths + doors) render GREEN — "Yoshi can WARP here" — to
// set them apart from the red "solid surface" mass. See data/exit-triggers.ts.
const SOLID_GREEN     = rgba(0x35, 0xC8, 0x55, ALPHA_FILL);
// Collectibles (coins) render YELLOW — no physics collision, just overlap-to-
// collect — so the designer can see pickups the red/green solids never show.
const SOLID_YELLOW    = rgba(0xEE, 0xCC, 0x2A, ALPHA_FILL);
// Tunnel / cut (Layer-2 passage) renders a transparent blue — passable, clearly
// distinct from the red solid mass. See ALPHA_TUNNEL.
const TUNNEL_BLUE     = rgba(0x3C, 0x9C, 0xE8, ALPHA_TUNNEL);

const COLOR = {
  AL: SOLID_RED,           // solid-all
  MD: SOLID_RED,           // partial-solid
  WT: SOLID_RED,           // water
  MG: SOLID_RED,           // lava
  TN: TUNNEL_BLUE,         // tunnel / cut — Layer-2 PASSAGE (walls 0x7A-0x7C, cut 0x14, hole 0x7F): passable, blue not red
  EXIT: SOLID_GREEN,       // exit trigger: pipe mouth (tag) or door (DR/BD bit)
  COLLECT: SOLID_YELLOW,   // collectible: coin / switch-coin tag (overlap, no physics)
  // Slope edge + mass are the SAME uniform red as the solid fill now (one red
  // reads cleaner than the old dim under-fill + dark edge line).
  SK_LINE: SOLID_RED,      // slope surface edge
  SK_FILL: SOLID_RED,      // slope solid mass
} as const;

// Secondary-tag index for the enemy-spawn pipe mouth. Enemy sprites (Shy Guy,
// Lantern Ghost, Cactus Jack, Boo Guy) read this tag at init (engine routine
// CODE_0EB8AE) to turn themselves into generators that emit enemies from the
// pipe. It is NOT an exit trigger and the player does not enter via it — player
// pipe-entry is sprite-driven (entrance sprites + the screen-exit list) and
// never reads this tag.
const ENEMY_PIPE_TAG = SECONDARY_TAG_NAMES.indexOf('enemy-pipe');

// Secondary-tag indices for collectibles — pass-through tiles collected on
// overlap (no physics): regular coins and the !-switch ("switch-coin") variant.
const COIN_TAG = SECONDARY_TAG_NAMES.indexOf('coin');
const SWITCH_COIN_TAG = SECONDARY_TAG_NAMES.indexOf('switch-coin');

// ── Behavioural-subclass dotted outlines ────────────────────────────────
// On top of the geometry/passability fill, cells whose page carries a
// designer-meaningful BEHAVIOURAL secondary-tag get a dotted box outline — one
// color per group — so the behaviour class reads at a glance (e.g. which green
// cell is a pipe vs a door vs a bonus door, or which red surface hurts). The
// fill answers "can Yoshi pass?", the outline answers "what does it DO?".
// Cosmetic tags (snow-grass, soap, …) are intentionally skipped. The outline is
// page-keyed (no neighbour context), so it bakes into the per-page cell cache
// and keeps the full + patch renders byte-identical. NOTE: it's a per-cell box,
// so a large same-tag region (e.g. a lava lake) reads as a dotted grid.
const FALLING_FLOOR_TAG = SECONDARY_TAG_NAMES.indexOf('falling-floor');
const SWITCH_BLOCK_TAG = SECONDARY_TAG_NAMES.indexOf('switch-block');
const DAMAGE_TAGS = new Set([
  SECONDARY_TAG_NAMES.indexOf('damage'),
  SECONDARY_TAG_NAMES.indexOf('damage-slope-stake'),
  SECONDARY_TAG_NAMES.indexOf('damage-icicle'),
]);

const OUTLINE_ALPHA = 0xf0; // dotted-outline opacity — sits clearly above fills
const TAG_OUTLINE = {
  enemyPipe:    rgba(0x3d, 0xe8, 0xe8, OUTLINE_ALPHA), // cyan
  door:         rgba(0xe0, 0x52, 0xd6, OUTLINE_ALPHA), // magenta
  bonusDoor:    rgba(0xf2, 0x9a, 0x28, OUTLINE_ALPHA), // orange
  fallingFloor: rgba(0xf2, 0xf2, 0xf2, OUTLINE_ALPHA), // white
  switchBlock:  rgba(0x4d, 0x9a, 0xff, OUTLINE_ALPHA), // azure
  damage:       rgba(0xff, 0x46, 0x7a, OUTLINE_ALPHA), // hot-pink
  waterLava:    rgba(0xa8, 0x6c, 0xf0, OUTLINE_ALPHA), // violet
} as const;

/** Dotted-outline color for a cell's meaningful behavioural subclass, or null
 *  if it carries none. Priority: enemy-pipe > bonus-door > door > falling-floor >
 *  switch-block > damage > water/lava (the exit-trigger green/red fills don't
 *  distinguish these, so the outline does). */
function tagOutlineColor(entry: CollisionEntry): number | null {
  if (entry.tag === ENEMY_PIPE_TAG) return TAG_OUTLINE.enemyPipe;
  if (entry.doors.bd) return TAG_OUTLINE.bonusDoor;
  if (entry.doors.dr) return TAG_OUTLINE.door;
  if (entry.tag === FALLING_FLOOR_TAG) return TAG_OUTLINE.fallingFloor;
  if (entry.tag === SWITCH_BLOCK_TAG) return TAG_OUTLINE.switchBlock;
  if (DAMAGE_TAGS.has(entry.tag)) return TAG_OUTLINE.damage;
  if (entry.flags.wt || entry.flags.mg) return TAG_OUTLINE.waterLava;
  return null;
}

/** Draw a 1px dotted box (2-on / 2-off) around a 16×16 cell in `color`, over
 *  whatever fill is already present. */
function drawDottedOutline(cell: Uint8Array, color: number): void {
  const u32 = new Uint32Array(cell.buffer, cell.byteOffset, CELL_PX * CELL_PX);
  const last = CELL_PX - 1;
  for (let i = 0; i < CELL_PX; i++) {
    if ((i & 3) >= 2) continue; // 2-on, 2-off dash phase
    u32[i] = color;                  // top edge    (y = 0)
    u32[last * CELL_PX + i] = color;  // bottom edge (y = 15)
    u32[i * CELL_PX] = color;         // left edge   (x = 0)
    u32[i * CELL_PX + last] = color;  // right edge  (x = 15)
  }
}

/** A cell that fires a screen exit when entered: a door (DR / bonus-door BD bit).
 *  Rendered green, distinct from solid red. NOTE: the enemy-pipe tag is NOT an
 *  exit trigger — enemies spawn out of it; the player never enters via the tag
 *  (player pipe-entry is sprite-driven, independent of collision tags). It gets
 *  its own cyan behavioural outline via `tagOutlineColor`, not a green fill. */
function isExitTrigger(entry: CollisionEntry): boolean {
  return entry.doors.dr || entry.doors.bd;
}

/** A collectible cell — coin / switch-coin: no physics collision, collected
 *  when Yoshi overlaps it. Rendered yellow. */
function isCollectible(entry: CollisionEntry): boolean {
  return entry.tag === COIN_TAG || entry.tag === SWITCH_COIN_TAG;
}

// ───────────────────────────────────────────────────────────────────────
// Per-page cell renderer (the cache value)
//
// Each cache entry is a 16×16 RGBA tile (1024 bytes) representing how
// every cell of this Map16 page should look in the collision overlay.
// Pages with NO collision (flags all zero, no doors) render as `null`
// to short-circuit the blit step entirely.
// ───────────────────────────────────────────────────────────────────────

type CellBitmap = Uint8Array | null;

const CELL_BYTES = CELL_PX * CELL_PX * 4;

/** Pick the base fill color (or null for "no overlay") for a non-slope,
 *  non-exit-trigger collision entry. Priority: AL > MD > WT > MG > TN > nothing.
 *  (Exit triggers — doors / pipe mouths — are handled earlier, in green.) */
function pickFlatColor(entry: CollisionEntry): number | null {
  if (entry.flags.al) return COLOR.AL;
  if (entry.flags.md) return COLOR.MD;
  if (entry.flags.wt) return COLOR.WT;
  if (entry.flags.mg) return COLOR.MG;
  if (entry.flags.tn) return COLOR.TN;
  return null;
}

/** Render one page's 16×16 collision cell: the geometry/passability fill (or
 *  null when the page has no overlay-worthy collision), PLUS — for cells whose
 *  page carries a meaningful behavioural secondary-tag — a dotted outline in the
 *  tag-group color. Both are page-keyed (no neighbour context), so this bakes
 *  into the per-page cache and keeps full + patch byte-identical. */
function renderPageCell(
  entry: CollisionEntry,
  slopePanels: SlopePanels
): CellBitmap {
  let cell = renderBaseCell(entry, slopePanels);
  const outline = tagOutlineColor(entry);
  if (outline !== null) {
    // A tag-only page (no fill) still gets its outline — allocate a transparent
    // cell so the dotted box draws on its own.
    if (cell === null) cell = new Uint8Array(CELL_BYTES);
    drawDottedOutline(cell, outline);
  }
  return cell;
}

/** The base geometry/passability fill for a page (no behavioural outline).
 *  Returns `null` if the page has no overlay-worthy collision (NO with no doors
 *  / no tag-only quirks), to let the caller skip blits entirely. */
function renderBaseCell(
  entry: CollisionEntry,
  slopePanels: SlopePanels
): CellBitmap {
  // Exit triggers (pipe mouth / door) take priority over any shape — green so
  // the level designer can spot "Yoshi warps here" at a glance.
  if (isExitTrigger(entry)) return renderFlatCell(COLOR.EXIT);
  // Collectibles (coins) — pass-through, overlap-to-collect — render yellow.
  if (isCollectible(entry)) return renderFlatCell(COLOR.COLLECT);
  if (entry.flags.sk) {
    return renderSlopeCell(entry, slopePanels);
  }
  const fill = pickFlatColor(entry);
  if (fill === null) return null;
  return renderFlatCell(fill);
}

/** Solid 16×16 fill of a single color. */
function renderFlatCell(color: number): Uint8Array {
  const cell = new Uint8Array(CELL_BYTES);
  const u32 = new Uint32Array(cell.buffer, cell.byteOffset, CELL_PX * CELL_PX);
  u32.fill(color);
  return cell;
}

/** Slope cell — draws the actual per-pixel surface line plus a dim
 *  under-line fill on the solid side.
 *
 *  STATIC-RENDERING GOTCHAS (hard-won — read before touching this)
 *  ---------------------------------------------------------------
 *
 *  The runtime `BG_HDFTCK` does `direction - player_Y ; BMI` against the
 *  player's actual Y and writes `subpixelY` as the collision result — it
 *  never computes an absolute surface pixel-Y. An editor overlay does
 *  need that absolute Y, so we decode the panel bytes statically. The
 *  answer is simpler than it looks but the wrong theories are seductive:
 *
 *  1. **No X-axis transforms.** The cart's 32 slope panels are
 *     designed to be sampled by the player's actual probe X at runtime;
 *     the surface they paint is consistent ONLY when each Map16 page is
 *     stamped at its NATURAL position within the slope object's growth
 *     direction. For $E5 ("down_left_long") that grows LEFT in the
 *     common case, page $0C lands at the LEFT cell and $0D at the RIGHT
 *     cell — raw bytes left-to-right then produce a smooth `//` surface.
 *     For $E8 ("down_right_long") growing RIGHT, raw bytes give `\\`.
 *     Earlier attempts to X-reverse "tight" panels (`|subpixelY| < 32`)
 *     "fixed" synthetic test cases but visually flipped the actual cart
 *     levels — do not re-introduce that transform.
 *
 *  2. **Direction byte's value IS the surface pixel-Y, top-down.**
 *     0 = top of cell, 15 = bottom. No inversion. Earlier theory of
 *     "tight slope direction is inverted (surface = 15 - direction)"
 *     was wrong; it only matched the geometry by accident on
 *     right-growing variants and broke left-growing ones.
 *
 *  3. **The hi byte's SIGN is not the ground/ceiling flag, but the byte
 *     PAIR is.** The runtime GSU consumer XORs the hi byte against `R3`
 *     (player-direction context) and `BMI`-branches — a per-frame rule we
 *     can't reproduce. But the *shape* always lives in exactly one of the
 *     two foot-probe pairs, and which one cleanly separates ground from
 *     ceiling: the foot-UP pair (bytes 2,3) carries ground surfaces (solid
 *     BELOW — slope idx $00-$11, $18-$1B); the foot-DOWN pair (bytes 0,1)
 *     carries ceiling / overhang surfaces (solid ABOVE — idx $12-$17,
 *     $1C-$1F, e.g. the rock undersides on ext-D6/DD). The cart ships
 *     ground+ceiling versions of the same geometry as distinct slope
 *     indices ($03 ground ↔ $1D ceiling are identical surfaces in opposite
 *     pairs); the non-shape pair is always a uniform off-tile marker. So we
 *     DO render overhangs correctly via `fillAbove`. (This renderer used to
 *     fill below unconditionally, which inverted every underside slope's
 *     collision triangle into the wrong half-cell.)
 *
 *  4. **Byte selection by variance.** Each 8-byte row has 4 candidate
 *     bytes (subpixelY/direction for foot-down + foot-up). We pick
 *     whichever of the 4 varies most across the panel's 16 columns —
 *     that's both the shape source AND, via its pair, the ground/ceiling
 *     fill direction (gotcha #3). For ground slopes the shape is usually
 *     byte 3 (foot-up direction); for ceiling slopes it's byte 1 (foot-
 *     down direction). The non-shape pair is a uniform off-tile marker. */
function renderSlopeCell(
  entry: CollisionEntry,
  slopePanels: SlopePanels
): Uint8Array {
  const cell = new Uint8Array(CELL_BYTES);
  const u32 = new Uint32Array(cell.buffer, cell.byteOffset, CELL_PX * CELL_PX);
  const { surface, fillAbove } = slopeCellSurface(entry, slopePanels);
  for (let x = 0; x < CELL_PX; x++) {
    const result = surface[x]!;
    if (result === 'passable') continue;
    if (result === 'solid') {
      for (let y = 0; y < CELL_PX; y++) u32[y * CELL_PX + x] = COLOR.SK_FILL;
      continue;
    }
    // Fill the solid side of the surface line: below it for ground slopes,
    // above it for ceiling / overhang slopes (rock undersides — see fillAbove).
    if (fillAbove) {
      for (let y = 0; y < result; y++) u32[y * CELL_PX + x] = COLOR.SK_FILL;
    } else {
      for (let y = result + 1; y < CELL_PX; y++) u32[y * CELL_PX + x] = COLOR.SK_FILL;
    }
    u32[result * CELL_PX + x] = COLOR.SK_LINE;
  }
  return cell;
}

/** Per-column decoded surface of a slope cell + which side is solid. This is the
 *  geometry the collision overlay draws; factored out (from renderSlopeCell's
 *  byte-selection above) so the surface-painting outline tracer reads each
 *  cell's exact shape from the SAME source as the rendered collision. */
export interface SlopeCellSurface {
  /** Per-x (0..15): pixel-Y (0..15, top-down) of the surface, or 'solid'
   *  (full column) / 'passable' (no in-tile surface this column). */
  surface: Array<number | 'solid' | 'passable'>;
  /** Solid is ABOVE the surface line (ceiling / overhang) vs below (ground). */
  fillAbove: boolean;
}

/** Decode a slope cell's per-column surface from its slope panel — the byte-pair
 *  selection + ground/ceiling logic documented above `renderSlopeCell`. */
export function slopeCellSurface(entry: CollisionEntry, slopePanels: SlopePanels): SlopeCellSurface {
  // RAM-supplied animated slopes ($80..$81) — no static data; treat as fully solid.
  if (entry.slopeIdx >= 0x80) {
    return { surface: new Array<number | 'solid' | 'passable'>(CELL_PX).fill('solid'), fillAbove: false };
  }
  const profile = decodeSlopeProfile(slopePanels, entry.slopeIdx);

  function distinctCount(getter: (s: typeof profile[number]) => number): number {
    const seen = new Set<number>();
    for (let x = 0; x < CELL_PX; x++) seen.add(getter(profile[x]!));
    return seen.size;
  }
  const varDown_lo = distinctCount((s) => s.subpixelY);
  const varDown_hi = distinctCount((s) => s.direction);
  const varUp_lo   = distinctCount((s) => s.subpixelYUp);
  const varUp_hi   = distinctCount((s) => s.directionUp);

  // Pick (pair, byte) with most variation. Tie-break: prefer foot-down.
  type ByteSel = 'down-lo' | 'down-hi' | 'up-lo' | 'up-hi';
  let bestSel: ByteSel = 'down-lo';
  let bestVar = varDown_lo;
  for (const [sel, v] of [
    ['down-hi', varDown_hi] as const,
    ['up-lo',   varUp_lo  ] as const,
    ['up-hi',   varUp_hi  ] as const,
  ]) {
    if (v > bestVar) { bestVar = v; bestSel = sel; }
  }

  function readByte(s: typeof profile[number]): number {
    switch (bestSel) {
      case 'down-lo': return s.subpixelY;
      case 'down-hi': return s.direction;
      case 'up-lo':   return s.subpixelYUp;
      case 'up-hi':   return s.directionUp;
    }
  }
  const isSubpixel = bestSel === 'down-lo' || bestSel === 'up-lo';
  // foot-UP pair (bytes 2,3) ⇒ ground (solid below); foot-DOWN pair (0,1) ⇒
  // ceiling / overhang (solid above). See the renderSlopeCell header gotcha #3.
  const fillAbove = bestSel === 'down-lo' || bestSel === 'down-hi';

  function readSurface(byte: number): number | 'solid' | 'passable' {
    if (isSubpixel) {
      // Unsigned subpixel-Y in 1/2-pixel units. 0..30 = in-tile (÷2 → pixel-Y). >=32 = off-tile bottom.
      if (byte < 0x20) return byte >>> 1;
      return 'solid';
    }
    if (byte >= 0 && byte < CELL_PX) return byte;
    if (byte >= CELL_PX) return 'passable';   // direction beyond tile → no in-tile surface from this side
    return 'solid';                            // direction < 0 → surface above tile (player below)
  }

  const surface: Array<number | 'solid' | 'passable'> = [];
  for (let x = 0; x < CELL_PX; x++) surface.push(readSurface(readByte(profile[x]!)));
  return { surface, fillAbove };
}

// ───────────────────────────────────────────────────────────────────────
// Per-cell renderer (shared by full + patch) with per-page cache
// ───────────────────────────────────────────────────────────────────────

/** Blits the collision overlay cell at absolute (absCellX, absCellY) into `dst`
 *  at pixel (destX, destY) with row stride `destStridePx` (pixels). No-ops for
 *  unallocated screens, page-0 backing, Map16 ID 0, or no-collision pages —
 *  callers that need the cell CLEARED must pre-zero the destination region. */
type CollisionCellRenderer = (
  absCellX: number,
  absCellY: number,
  dst: Uint8Array,
  destStridePx: number,
  destX: number,
  destY: number
) => void;

/**
 * Build the per-cell collision renderer over a fixed decode + cart collision
 * data, sharing the per-page cell cache. `renderCollisionLayer` (full) and
 * `renderCollisionPatch` (incremental) both drive the returned closure, so
 * their pixels are byte-identical by construction.
 */
function makeCollisionCellRenderer(args: RenderCollisionArgs): {
  renderCell: CollisionCellRenderer;
  /** Pages that produced a visible overlay (populated as cells render). */
  uniquePagesRendered: Set<number>;
} {
  const { collisionTable, slopePanels, levelDataBuffer, screenPageMap } = args;
  // Page cell cache: `null` means "we computed it and there's no overlay
  // to draw"; `undefined` means "not yet computed". Lazy population keeps
  // the overhead proportional to the level's actual page diversity.
  const cellCache: (CellBitmap | undefined)[] = new Array(168).fill(undefined);
  const uniquePagesRendered = new Set<number>();

  const renderCell: CollisionCellRenderer = (absCellX, absCellY, dst, destStridePx, destX, destY) => {
    const map16Id = resolveCellMap16(
      levelDataBuffer, screenPageMap, absCellX >> 4, absCellY >> 4, absCellX & 0xf, absCellY & 0xf
    );
    if (map16Id === 0) return;
    const page = (map16Id >>> 8) & 0xff;
    // Pages beyond the table range (the cart's max valid page is $A7 = 167) get
    // no overlay — they'd be a renderer bug worth surfacing, but for now we
    // silently skip.
    if (page >= collisionTable.length) return;

    let cell = cellCache[page];
    if (cell === undefined) {
      cell = renderPageCell(collisionTable[page]!, slopePanels);
      cellCache[page] = cell;
    }
    if (cell === null) return;
    uniquePagesRendered.add(page);
    blitCell(dst, destStridePx, cell, destX, destY);
  };

  return { renderCell, uniquePagesRendered };
}

// ───────────────────────────────────────────────────────────────────────
// Top-level renderers (full + patch)
// ───────────────────────────────────────────────────────────────────────

export function renderCollisionLayer(args: RenderCollisionArgs): CollisionRenderResult {
  const { screenPageMap } = args;
  const { renderCell, uniquePagesRendered } = makeCollisionCellRenderer(args);
  const rgba = new Uint8Array(TOTAL_WIDTH * TOTAL_HEIGHT * 4);

  // Skip unallocated screens wholesale before the per-cell drive (which would
  // otherwise re-check the page map 256× per empty screen).
  for (let screenY = 0; screenY < SCREENS_TALL; screenY++) {
    for (let screenX = 0; screenX < SCREENS_WIDE; screenX++) {
      const slot = screenPageMap[(screenY << 4) | screenX]!;
      if (slot === SCREEN_PAGE_UNALLOCATED) continue;
      if ((slot & LRU_PAGE_MASK) === 0) continue;
      for (let cellY = 0; cellY < CELLS_PER_SCREEN_EDGE; cellY++) {
        const absCellY = (screenY << 4) | cellY;
        for (let cellX = 0; cellX < CELLS_PER_SCREEN_EDGE; cellX++) {
          const absCellX = (screenX << 4) | cellX;
          renderCell(absCellX, absCellY, rgba, TOTAL_WIDTH, absCellX * CELL_PX, absCellY * CELL_PX);
        }
      }
    }
  }

  return {
    rgba,
    width: TOTAL_WIDTH,
    height: TOTAL_HEIGHT,
    uniquePagesRendered: uniquePagesRendered.size,
  };
}

/** Render ONLY the given absolute cells (a diff's changed-cell list) into a
 *  packed patch — one 16×16 RGBA block per coord pair, in coords order. Cells
 *  that resolve to nothing (unallocated / Map16 0 / no-collision page) produce
 *  an all-zero block so the renderer's overwrite clears the previous overlay.
 *  Byte-identical to the same cells under `renderCollisionLayer` (shared
 *  `makeCollisionCellRenderer`). */
export function renderCollisionPatch(args: RenderCollisionArgs, coords: Int32Array): LayerCellPatch {
  const { renderCell } = makeCollisionCellRenderer(args);
  const n = coords.length >>> 1;
  const cellBytes = CELL_PX * CELL_PX * 4;
  const rgba = new Uint8Array(n * cellBytes);
  const scratch = new Uint8Array(cellBytes);
  for (let i = 0; i < n; i++) {
    const x = coords[i * 2]!;
    const y = coords[i * 2 + 1]!;
    scratch.fill(0);
    renderCell(x, y, scratch, CELL_PX, 0, 0);
    rgba.set(scratch, i * cellBytes);
  }
  return { cellPx: CELL_PX, width: TOTAL_WIDTH, height: TOTAL_HEIGHT, coords, rgba };
}

/** Blit a 16×16 RGBA tile into a dest bitmap at (dx, dy) with row stride
 *  `dstStridePx` (pixels). Cells with alpha=0 are skipped — on a pre-zeroed
 *  destination this equals copying the whole cell, which keeps the patch path
 *  byte-identical to the full path; on the full bitmap it preserves any
 *  existing data underneath. */
function blitCell(
  dst: Uint8Array,
  dstStridePx: number,
  cell: Uint8Array,
  dx: number,
  dy: number
): void {
  for (let row = 0; row < CELL_PX; row++) {
    const dstRowOff = ((dy + row) * dstStridePx + dx) * 4;
    const srcRowOff = row * CELL_PX * 4;
    for (let col = 0; col < CELL_PX; col++) {
      const so = srcRowOff + col * 4;
      const a = cell[so + 3]!;
      if (a === 0) continue;
      const dop = dstRowOff + col * 4;
      dst[dop]     = cell[so]!;
      dst[dop + 1] = cell[so + 1]!;
      dst[dop + 2] = cell[so + 2]!;
      dst[dop + 3] = a;
    }
  }
}
