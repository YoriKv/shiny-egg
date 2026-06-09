// Typed accessor over obj-metadata.json — the catalog of object/sprite names,
// categories, descriptions, default sizes, and the `exitTrigger` flag. All of it
// is pre-baked and shipped (eventually tool-generated), not computed at editor
// load/extract time. The `exitTrigger` flag (which entities trigger a screen
// exit) is asm-derived — see data/exit-triggers.ts for how it's derived.

import raw from './obj-metadata.json'
import { hex } from '../lib/hex'

export type ObjectCategory =
  | 'terrain'
  | 'slope'
  | 'platform'
  | 'hazard'
  | 'water'
  | 'pipe'
  | 'collectible'
  | 'interactive'
  | 'decoration'
  | 'command'
  | 'enemy'
  | 'item'
  | 'generator'
  | 'boss'
  | 'unknown'

// What's stored per entry in obj-metadata.json. `exitTrigger` is optional
// (present + true only on the trigger entries); accessors normalise it.
interface StoredObjectInfo {
  name: string
  desc: string
  category: ObjectCategory
  tilesets: string[]
  defaultWidth: number
  defaultHeight: number
  exitTrigger?: boolean
  // Whether a NEGATIVE width / height extent is valid for this object — i.e. the
  // cart's per-cell stamp handler walks correctly when the object grows
  // left / up (high-bit extent byte). Standard objects only; default-deny
  // (absent ⇒ treat as false ⇒ the resize clamp pins the extent ≥ 0). Seeded
  // from a scan of shipped level data (objects the original game places negative
  // are proven-safe), then extended by a per-handler audit. See
  // research notes on negative-extent validity.
  negWAllowed?: boolean
  negHAllowed?: boolean
}

// ── Neighbour dependencies ────────────────────────────────────────────────
// A sprite's behaviour can depend on surrounding *placed* level data — a rail
// painted from line-guide objects, a keyhole Map16 tile, a partner sprite, or
// the screen-exit row. Transcoded from yi-shiny's
// docs/sprite-neighbor-index.tsv by tmp/gen-neighbor-deps.ts; full prose in
// docs/sprite-neighbor-dependencies.md. The resolver
// (lib/sprite-neighbor-deps.ts) checks satisfaction and the validation harness
// (snes-framework/scripts/engine/validate-neighbor-deps.ts) pins zero false
// errors against shipped levels.

/** Spatial nature of a dependency — drives the check and the visual.
 *  `same-cell` / `offset-cell` / `path` resolve to a target CELL (drawable as
 *  an expected-location marker); `proximity` / `global` / `carried` resolve to
 *  another placed SPRITE (no fixed cell); `screen` reads the screen-exit table
 *  for the sprite's own screen. */
export type NeighborSpatial =
  | 'same-cell' | 'offset-cell' | 'path' | 'proximity' | 'global' | 'carried' | 'screen'

export type NeighborTargetKind = 'std-object' | 'map16-tile' | 'sprite' | 'screen-metadata'

/** Relationship class from the reference doc: A rail-follower, B1 keyhole-snap,
 *  C direct-tile-scan, D sprite-pair, E screen-metadata, F pipe-spawner
 *  (tile-conditional behaviour). The doc's *incidental* tiers (class B2
 *  anchor-prologue, the borderline MessageBox) fire a mechanism but are never a
 *  designed relationship — excluded from the editor metadata entirely (kept only
 *  in the yi-shiny reference doc). Every dep here IS a real designer
 *  relationship, but not all are auto-verifiable — see `enforce`. Class F is
 *  *behaviour-enabling* (placing the sprite on a pipe-mouth tile turns it into a
 *  continuous self-spawning generator), so it is never an error — always
 *  `enforce:false`, surfaced as an info annotation. See Part 3 of
 *  research/notes-sprite-neighbor-dependencies.md. */
export type NeighborClass = 'A' | 'B1' | 'C' | 'D' | 'E' | 'F'

/** One neighbour-dependency: a piece of surrounding level data the sprite needs
 *  the designer to position. Matching rules used by the resolver:
 *   - `map16-tile` targets match via `tileMatch` (`(id & mask) === value`), NOT
 *     `targetIds` (which is left empty for tile deps).
 *   - `std-object` / `sprite` targets match by id membership in `targetIds`.
 *   - class F (pipe-spawner) matches the sprite's own cell against
 *     `collisionTag` (the page secondary-tag) OR any of `tileLiterals` — a
 *     behaviour gained when on a pipe mouth, never a requirement.
 *  `targetName` / `failureMode` / `designerRule` are verbatim human text for the
 *  panel + canvas labels. */
export interface SpriteNeighborDep {
  cls: NeighborClass
  targetKind: NeighborTargetKind
  spatial: NeighborSpatial
  /** Hex-string ids — std-object ids (ranges expanded) or sprite ids. Empty for
   *  map16-tile / screen-metadata deps (those resolve via `tileMatch` / the
   *  exit table). */
  targetIds: string[]
  /** Map16 match for tile targets: `(id & mask) === value`. Also carried on the
   *  class-A rail dep (the `$87xx` rail tile) for the precise path check. `note`
   *  is a human-readable gloss of what the masked tile family is (ignored at
   *  runtime; surfaced for documentation — see the JSON). */
  tileMatch?: { mask: string; value: string; note?: string }
  /** Class-F pipe-spawner matcher — the cell's Map16 **page collision
   *  secondary-tag** (hex, e.g. `"0x14"` = pipe / DK enterable-pipe-mouth). The
   *  cell matches if its page carries this tag. Mirrors the asm gate
   *  `CODE_0EB8AE`'s `R7 & 0xF800 == 0xA000` page-attribute test. */
  collisionTag?: string
  /** Class-F pipe-spawner matcher — explicit Map16 tile-id literals (hex) OR'd
   *  with `collisionTag`. Covers the two pipe-mouth tiles (`0x79F1`/`0x79F2`)
   *  the asm special-cases by value because their page isn't tagged pipe. */
  tileLiterals?: string[]
  /** Human-readable gloss of the `collisionTag` / `tileLiterals` matcher
   *  (sibling `note`, ignored at runtime). */
  collisionNote?: string
  /** Signed pixel offset from the sprite's own (X,Y) to the probed cell — class
   *  C only (`(X-0x18, Y-0x38)` → `{dx:-24, dy:-56}`). */
  offsetPx?: { dx: number; dy: number }
  /** Class-A rail follower only: how many cells DOWN the own column the rail
   *  read can sit. Absent ⇒ 1 (own cell or its foot — the ten flatbed
   *  platforms); 2 for the spiral lift (`$18F`), whose pivot sits a cell lower.
   *  See `PATH_DOWN` + the resolver's `path` case. */
  pathDown?: number
  /** Can the editor RELIABLY verify this against a single loaded level record?
   *  `true` ⇒ a missing target is a real error → drives the always-on error
   *  indicator. `false` ⇒ shown as an un-enforced relationship only (panel
   *  note, no error marker): the target isn't visible to a per-record static
   *  check — class B1 keyhole `$B8xx` tiles are produced by no object (absent
   *  from the decoder's Map16 buffer entirely), and the locked-door Key
   *  (spatial `carried`) lives in a connected sub-room, i.e. a different record.
   *  Derived in the generator and pinned by the validation harness, which
   *  asserts zero false `missing` among `enforce:true` deps over every shipped
   *  level. */
  enforce: boolean
  /** Friendly target description for labels/panel (verbatim `target_ids`). */
  targetName: string
  /** What breaks if absent (verbatim `failure_mode`). */
  failureMode: string
  /** Short designer rule (verbatim `spatial_rule`). */
  designerRule: string
}

interface StoredSpriteInfo {
  name: string
  category: ObjectCategory
  exitTrigger?: boolean
  // ── GFX-lock fields (sprites 0x000–0x1B9 only; special sprites ≥0x1BA use a
  //    separate GFX path and are left absent). Two-source derivation:
  //    • PRIMARY — dynamic trace (yi-shiny `sprite-render` scenario): each
  //      sprite is spawned in a level that contains it, OAM+VRAM are
  //      snapshotted, and every rendered tile's VRAM byte is mapped back to a
  //      spriteset file ($A000-$B7FF = the 6 variable slots, $8000-$9FFF /
  //      $F000+ = global sheets $72/$19, anything else = dynamic SuperFX
  //      region). This is the EXACT "which files" answer and is applied
  //      wherever the trace conclusively captured the sprite (≥1 OAM entry).
  //    • FALLBACK — static derivation (tmp/classify-sprites.ts) for sprites the
  //      trace couldn't spawn or that rendered nothing in the captured frame.
  //    Overlay step: tmp/merge-trace-files.ts. ──
  /**
   * Does the sprite supply graphics outside its level's variable spriteset
   * (so `spritesetFiles` may understate what it needs)? True if EITHER the
   * trace observed it rendering tiles from the dynamic SuperFX region, OR its
   * Init/Main routine can reach `CODE_03AD74` (the dynamic-tile allocator) in
   * the call graph — the static signal also covers non-idle states the
   * single-frame trace didn't capture. Absent ⇒ treat as false.
   */
  dynamicGfx?: boolean
  /**
   * GFX file IDs the sprite's own tiles need present in the level's *variable*
   * spriteset (header field 7 → the 6 files in `DATA_spriteset_files`). The
   * editor re-checks rendering when a level's spriteset changes: the sprite
   * still renders iff the new spriteset's 6 files ⊇ this set.
   *   `[]`   ⇒ needs no variable-spriteset file: tiles are in the always-loaded
   *            global sheet (portable), streamed from the dynamic region
   *            (see `dynamicGfx`), or the sprite has no graphics → renders
   *            under any spriteset.
   *   `null` ⇒ the sprite never appears in a level, so nothing could be derived.
   * Trace-derived values are exact (observed). Static-fallback values are a
   * safe over-approximation: "appears in a level" ≠ "renders correctly there",
   * so an incidental placement can drop a real file, and a single-appearance
   * sprite lists its whole spriteset (can't be narrowed).
   * Stored as hex file-id strings (e.g. `"0x28"`); parse with `parseInt(s, 16)`
   * when comparing against a spriteset's numeric file IDs.
   */
  spritesetFiles?: string[] | null
  /**
   * How the sprite cel-renders at rest, prebaked from a per-sprite emulator
   * **categorization trace** (`drawType` dispatch index — authoritative + level-
   * independent): `'B'` = Format-B `special_chr` cel (enemies, bosses, …), `'A'` =
   * Format-A single `object_data` tile (items). **Absent** = not statically cel-
   * rendered here: dynamic/rotzoom (handled by the dynamic-body table), no visual,
   * or a 1-1 placeholder/no-spawn awaiting per-natural-level refinement. Replaces
   * the unreliable `category` as the cel-render + Format-A gate (see
   * research/notes-sprite-render.md). Drives `celRenderableSpriteNums` /
   * `formatARenderableSpriteNums`.
   */
  cel?: 'A' | 'B'
  /**
   * Neighbour-dependency inventory — surrounding placed level data this sprite's
   * behaviour reads (rail tiles, keyhole tiles, a partner sprite, an exit row).
   * Absent ⇒ the sprite reads no placed neighbour. Tool-generated; see
   * SpriteNeighborDep.
   */
  neighborDeps?: SpriteNeighborDep[]
}

// What the accessors return: stored fields with `exitTrigger` normalised to a
// definite boolean.
export interface ObjectInfo extends StoredObjectInfo {
  /** Stamps a screen-exit collision tile — a pipe mouth (`pipe` tag) or door
   *  (DR/BD bit). Set for std/ext pipe & door objects. See data/exit-triggers.ts. */
  exitTrigger: boolean
}

export interface SpriteInfo extends StoredSpriteInfo {
  /** This sprite's handler fires a screen exit (door / pipe / teleport). */
  exitTrigger: boolean
}

type Payload = {
  standardObjects: Record<string, StoredObjectInfo>
  extendedObjects: Record<string, StoredObjectInfo>
  sprites: Record<string, StoredSpriteInfo>
}

const data = raw as Payload

const UNKNOWN_OBJECT: StoredObjectInfo = {
  name: '',
  desc: '',
  category: 'unknown',
  tilesets: [],
  defaultWidth: 1,
  defaultHeight: 1
}
const UNKNOWN_SPRITE: StoredSpriteInfo = { name: '', category: 'unknown' }

/** Look up a standard object by ID (1..0xF6). Returns a stable unknown stub if missing. */
export function getStandardObject(id: number): ObjectInfo {
  const stored = data.standardObjects[`0x${hex(id, 2)}`] ?? { ...UNKNOWN_OBJECT, name: `Object ${hex(id, 2)}` }
  return { ...stored, exitTrigger: stored.exitTrigger ?? false }
}

/** Look up an extended object by exnum (0..0xFF). */
export function getExtendedObject(exnum: number): ObjectInfo {
  const stored = data.extendedObjects[`0x${hex(exnum, 2)}`] ?? { ...UNKNOWN_OBJECT, name: `ExObject ${hex(exnum, 2)}` }
  return { ...stored, exitTrigger: stored.exitTrigger ?? false }
}

/** Look up a sprite by num (9-bit, 0..0x1FF). */
export function getSprite(num: number): SpriteInfo {
  const stored = data.sprites[`0x${hex(num, 3)}`] ?? { ...UNKNOWN_SPRITE, name: `Sprite ${hex(num, 3)}` }
  return { ...stored, exitTrigger: stored.exitTrigger ?? false }
}

/** Neighbour-dependencies for a sprite (empty array if none). */
export function getSpriteNeighborDeps(num: number): SpriteNeighborDep[] {
  return data.sprites[`0x${hex(num, 3)}`]?.neighborDeps ?? []
}

/**
 * Resolve an object record (standard num + optional exnum) to the right info.
 * `num === 0` ⇒ extended object indexed by exnum; otherwise standard.
 */
export function getObjectInfo(num: number, exnum?: number): ObjectInfo {
  if (num === 0 && exnum !== undefined) return getExtendedObject(exnum)
  return getStandardObject(num)
}


export interface CatalogEntry<I> {
  id: number
  info: I
}

/** All standard objects defined in the metadata, sorted by id — for the picker. */
export function listStandardObjects(): CatalogEntry<ObjectInfo>[] {
  return Object.entries(data.standardObjects)
    .map(([k, info]) => ({ id: Number(k), info: { ...info, exitTrigger: info.exitTrigger ?? false } }))
    .sort((a, b) => a.id - b.id)
}

/** All extended objects (placed with `num=0`, `exnum=id`), sorted by id. */
export function listExtendedObjects(): CatalogEntry<ObjectInfo>[] {
  return Object.entries(data.extendedObjects)
    .map(([k, info]) => ({ id: Number(k), info: { ...info, exitTrigger: info.exitTrigger ?? false } }))
    .sort((a, b) => a.id - b.id)
}

/** All sprites defined in the metadata, sorted by 9-bit id. */
export function listSprites(): CatalogEntry<SpriteInfo>[] {
  return Object.entries(data.sprites)
    .map(([k, info]) => ({ id: Number(k), info: { ...info, exitTrigger: info.exitTrigger ?? false } }))
    .sort((a, b) => a.id - b.id)
}

let celRenderableNumsCache: number[] | null = null
let formatANumsCache: number[] | null = null
/**
 * Sprite nums that cel-render via the **Format-B** `special_chr` OAM-cel path
 * (`render:spriteLayer` gate). Sourced from the prebaked `cel === 'B'` field —
 * a per-sprite emulator categorization (`drawType`, authoritative) that replaces
 * the old unreliable `category === 'enemy'` proxy (which mis-gated ~59 sprites:
 * bosses/items that DO draw a cel were excluded; "enemies" that draw nothing were
 * included). Memoised; static across levels. (Dynamic/rotzoom bodies are handled
 * separately by `DYNAMIC_BODY_SOURCES`; Format-A items are `formatARenderableSpriteNums`.)
 */
export function celRenderableSpriteNums(): number[] {
  if (!celRenderableNumsCache) {
    celRenderableNumsCache = Object.entries(data.sprites)
      .filter(([, info]) => info.cel === 'B')
      .map(([k]) => Number(k))
  }
  return celRenderableNumsCache
}

/**
 * Sprite nums that cel-render via the **Format-A** single-`object_data`-tile path
 * (items: red coin, eggs, key, …), from the prebaked `cel === 'A'` field. The
 * engine renders these AND forces the Format-A path for them, which resolves the
 * few sprites carrying both a `special_chr` and an `object_data` (e.g. the Key).
 */
export function formatARenderableSpriteNums(): number[] {
  if (!formatANumsCache) {
    formatANumsCache = Object.entries(data.sprites)
      .filter(([, info]) => info.cel === 'A')
      .map(([k]) => Number(k))
  }
  return formatANumsCache
}
