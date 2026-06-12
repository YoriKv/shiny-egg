// Renderer-side shared types. The shell (App), the canvas, the panels, and
// the hit-test layer all need to agree on the shape of selection and layer
// visibility — keeping them here means no module is the de facto "owner"
// just because it happens to be the largest.
//
// Pure-data types from snes-framework (LevelObject, LevelSprite, ScreenExit,
// LevelData) come through the preload `.d.ts` and are *not* re-exported here;
// import them from '../../preload/api' as before.

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
  /** Object outlines + labels (the blueprint view of the level-stream
   *  parser). Used to be bundled with `bg1` since both originate from
   *  the object stream, but they're independently useful — turn off
   *  outlines to see the BG1 tiles cleanly, or turn off BG1 tiles to
   *  see the blueprint without graphics noise. Default on. Also gates
   *  click-to-select on objects (no outline → no hit). */
  bg1Outlines: boolean
  /** Sprite outlines + hex-id labels (the blueprint view of the sprite list) —
   *  the sprite analog of `bg1Outlines`. Draws a bounding box + id label over
   *  every sprite and gates click-to-select (no outline → no hit), exactly as
   *  `bg1Outlines` does for objects. Default on. */
  spriteOutlines: boolean
  /** The spatial-bounds overlay: faint per-screen grid lines + the brighter
   *  editable-boundary rectangle (see canvas/draw/grid.ts). A pure editing aid
   *  drawn over every layer; toggle it off for an unobstructed view of the
   *  rendered level. Default on. */
  grid: boolean
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
  /** A screen exit (the picker's "Exit / Special" tab): clicking the canvas
   *  adds a warp exit on the clicked cell's SCREEN (exits are per-screen
   *  singletons), defaulting to a self-warp at that cell. */
  | { kind: 'exit'; label: string }
