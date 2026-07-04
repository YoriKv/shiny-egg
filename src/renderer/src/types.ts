// Renderer-side shared types. The shell (App), the canvas, the panels, and
// the hit-test layer all need to agree on the shape of selection and layer
// visibility — keeping them here means no module is the de facto "owner"
// just because it happens to be the largest.
//
// Pure-data types from snes-framework (LevelObject, LevelSprite, ScreenExit,
// LevelData) come through the preload `.d.ts` and are *not* re-exported here;
// import them from '../../preload/api' as before.

/**
 * Background-grid overlay mode — a 3-state toolbar toggle, cycled by the grid
 * button (off → screen → tile → off):
 *   'off'    — no grid.
 *   'screen' — faint per-screen lines (every 16 cells) + the editable-boundary
 *              rectangle (the previous always-on behaviour).
 *   'tile'   — adds the finer per-CELL lines underneath, with the screen lines
 *              still emphasized on top (so the tile grid "also shows the screen
 *              grid").
 */
export type GridMode = 'off' | 'screen' | 'tile'

/** Cycle order for the toolbar grid button: off → screen → tile → off. */
export const GRID_MODE_CYCLE: readonly GridMode[] = ['off', 'screen', 'tile']

/** The mode the grid button advances to from `mode` (one step around the cycle). */
export function nextGridMode(mode: GridMode): GridMode {
  return GRID_MODE_CYCLE[(GRID_MODE_CYCLE.indexOf(mode) + 1) % GRID_MODE_CYCLE.length]!
}

/**
 * Sprite / object outline mode — a 3-state toolbar toggle, cycled by the editing
 * button (detailed → render → off → detailed):
 *   'detailed' — the full blueprint: outlines over every entity, plus id
 *                labels, badges, and (objects) resize handles. Editing on.
 *   'render'   — a cleaner preview. Drops the per-entity outline box + id label,
 *                showing ONLY the selected entity as an alternating black/white
 *                dashed line — a trace of an object's drawn tiles, a box for a
 *                sprite. Keeps all the guiding overlays (badges, hint lines,
 *                behaviour/neighbour visuals). Click-to-select still on.
 *   'off'      — no outlines and no hit-testing: the entity type can't be
 *                selected or edited (the old "hide outlines" state).
 */
export type OutlineMode = 'detailed' | 'render' | 'off'

/** Cycle order for the outline toggles: detailed → render → off → detailed. */
export const OUTLINE_MODE_CYCLE: readonly OutlineMode[] = ['detailed', 'render', 'off']

/** The mode the outline button advances to from `mode` (one step around the cycle). */
export function nextOutlineMode(mode: OutlineMode): OutlineMode {
  return OUTLINE_MODE_CYCLE[(OUTLINE_MODE_CYCLE.indexOf(mode) + 1) % OUTLINE_MODE_CYCLE.length]!
}

/** Whether this outline mode allows selecting/editing its entities. Hit-testing
 *  is enabled in both 'detailed' and 'render'; only 'off' disables it. */
export function outlineEditable(mode: OutlineMode): boolean {
  return mode !== 'off'
}

/**
 * Toolbar visibility toggles. The three BG flags match the SNES PPU layers
 * the level loader populates:
 *   bg1 — the decoded BG1 (object stream); shown as "Foreground"
 *   bg2 — the mid-distance scenery tilemap; shown as "Background"
 *   bg3 — the far parallax tilemap; shown as "Sky"
 *   backdrop — the COLDATA gradient / solid-color fill behind every
 *     layer; the gameplay "sky color" most levels actually show
 * Object outlines are part of BG1 (the object stream feeds BG1), so they're
 * gated on `bg1` regardless of obj-metadata category.
 */
export interface LayerVisibility {
  /** The decoded BG1 graphics (Map16 tiles rendered through VRAM +
   *  CGRAM). Shown as "Foreground". Independent of `bg1Outlines` so the
   *  user can show outlines without the tiles, or vice versa. */
  bg1: boolean
  bg2: boolean
  bg3: boolean
  /** The back-most fill — either CGRAM[0] solid color (header BG color
   *  < $10) or the 24-stop COLDATA gradient (header BG color >= $10).
   *  Split out from `bg3` so the user can toggle the gameplay sky color
   *  independently of the BG3 parallax tilemap. */
  backdrop: boolean
  /** Sprite graphics: the tier-1 cel pixel render plus the tier-2 landmark
   *  glyphs (Goal / Boss Door / checkpoint flags). The sprite analog of `bg1`
   *  (the rendered tiles). Split from `spriteOutlines` so the user can show the
   *  outline blueprint without the graphics, or the graphics without outlines. */
  sprites: boolean
  exits: boolean
  /** Per-page collision overlay (red solid-fill + dark-red slope edge).
   *  Drawn on TOP of every other layer so the user can cross-reference
   *  collision shapes against the foreground at a glance. Default off. */
  collision: boolean
  /** Object outline mode (3-state OutlineMode — see above). 'detailed' draws the
   *  full blueprint (per-object box + id label); 'render' drops those and traces
   *  only the selected object's drawn tiles as a dashed line (keeping badges +
   *  guiding overlays); 'off' hides everything AND disables click-to-select on
   *  objects. Default 'detailed'. */
  bg1Outlines: OutlineMode
  /** Sprite outline mode — the sprite analog of `bg1Outlines` (3-state
   *  OutlineMode). 'detailed' draws a box + hex-id over every sprite; 'render'
   *  drops those and shows only the selected sprite as a dashed box (keeping
   *  badges + guiding overlays); 'off' hides everything AND disables
   *  click-to-select on sprites. Default 'detailed'. */
  spriteOutlines: OutlineMode
  /** Background-grid overlay mode (a 3-state toggle — see GridMode). 'screen'
   *  draws faint per-screen lines + the brighter editable-boundary rectangle;
   *  'tile' adds the finer per-cell lines on top; 'off' hides it entirely. A
   *  pure editing aid drawn over every layer. Default 'screen'. */
  grid: GridMode
}

/**
 * "Someone else's exit lands here." Computed by walking the sub-level graph
 * at the App level and handed to the Canvas so we can draw entry markers
 * for one-way connections (where a sibling room exits into this one but the
 * current room has no return exit).
 */
export interface IncomingExit {
  /** Level ID of the room whose outgoing exit lands here. */
  sourceLevelRecordId: number
  /** Cell-grid position where the player materializes in THIS level. */
  destX: number
  destY: number
  /** Source room's screen index for the outgoing exit (debug / future hover). */
  sourceScreenIndex: number
  /** Entrance/spawn state the source exit applies on arrival (the warp record's
   *  5th byte; `ENTRANCE_TYPES`). Editable from the incoming marker's Properties
   *  — the commit writes back to the source exit's `entranceType`, the dropdown
   *  twin of the destX/destY drag. */
  entranceType: number
}

/**
 * What the user has currently picked on the canvas. Objects, sprites,
 * outgoing screen-exit markers, incoming-exit markers (where a sibling room
 * lands the player here), and the spawn flag are all individually
 * selectable. Drawn-on-top stacking decides cycling order when multiple
 * things sit under the cursor:
 *   exits → incoming → spawn → sprites → objects
 */
// Objects, sprites, and exits are referenced by their editor-session `uid`
// (stamped at load by the level reducer), NOT by a snapshot — so a selection
// stays valid as the stream reindexes under add/delete and across undo/redo.
// Resolve uid → live entity against the current `LevelData`. Incoming markers
// and the spawn flag aren't stream entities, so they carry their data inline.
export type Selection =
  | { kind: 'object'; uid: number }
  | { kind: 'sprite'; uid: number }
  | { kind: 'exit'; uid: number }
  | { kind: 'incoming'; incoming: IncomingExit }
  | { kind: 'spawn'; spawn: { x: number; y: number } }

/**
 * An entity armed in the Add-picker for click-to-place on the canvas. Objects
 * carry their default W/H (from obj-metadata); the reducer stamps uid/index on
 * placement. `label` is for the "placing X" affordance.
 */
export type PlacementItem =
  | { kind: 'object'; num: number; exnum?: number; w: number; h: number; label: string }
  | { kind: 'sprite'; num: number; label: string }
  /** A screen exit (the picker's "Screen Exit" tab): clicking the canvas
   *  adds a warp exit on the clicked cell's SCREEN (exits are per-screen
   *  singletons), defaulting to a self-warp at that cell. */
  | { kind: 'exit'; label: string }
