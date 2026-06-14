// Typed accessor over obj-metadata.json — the catalog of object/sprite names,
// categories, descriptions, default sizes, and the `exitTrigger` flag. All of it
// is pre-baked and shipped (eventually tool-generated), not computed at editor
// load/extract time. STORAGE RULE: this JSON holds bulk, TOOL-GENERATED
// per-entity facts; small HAND-AUTHORED behaviour tables live in typed data
// modules instead (e.g. data/sprite-parity-variants.ts), and pure presentation
// stays in canvas/draw. The `exitTrigger` flag (which entities trigger a screen
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
  /**
   * BG1 tileset indices (hex strings, `"0x4"`) under which this object's art
   * family is present — the wrong-theme gate the X-placeholder probe can't
   * provide (a foreign sheet's slots can hold another family's REAL art).
   * Derived evidence-first (tmp/audit-art-identity.ts --write, 2026-06-11):
   *   shipped objects: allowed(ts) := own-shipped(ts — BAND-resolved through
   *       Graphic-Changer sprites: a placement inside a changer band proves
   *       the band's tileset, not the header's; level 0x58's rail corners
   *       prove ts15) ∨ art byte-identical / ≤¼ different vs a shipped
   *       reference tileset (4bpp VRAM bytes + flips — palette-independent,
   *       so recolours pass);
   *   never-shipped: the GoldenEgg `tilesets` labels greedily mapped onto
   *       tileset indices from band-resolved shipped placements;
   *   plus the reviewed-override lists in the generator (NEVER_ALLOWED — the
   *       Baby-Bowser-room runtime-streamed scenery, baked `[]`; ADD_PAIRS —
   *       thumbnail-reviewed reskin pairings the evidence can't derive, e.g.
   *       the ts12 stake/lily). A retarget-landing inference was tried and
   *       removed (unsound both ways — see the generator header).
   * Value semantics (mirrors `spritesetFiles`): ABSENT ⇒ not theme-gated
   * (universal); NULL ⇒ never shipped + nothing derivable ⇒ theme-unknown
   * (amber badge, never hidden, never asserted ok); `[]` ⇒ locked everywhere.
   * Checked by `lib/theme-validity.ts` (hook + validity-report gate).
   */
  bg1Tilesets?: string[] | null
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
 *  `same-cell` / `offset-cell` / `path` / `row` resolve to a target CELL
 *  (drawable as an expected-location marker); `level` scans the whole level
 *  for a matching tile (marker = the nearest match); `proximity` / `global` /
 *  `carried` resolve to another placed SPRITE (no fixed cell); `screen` reads
 *  the screen-exit table for the sprite's own screen; `note` is a pure
 *  annotation — no geometric check, always resolves `met` (panel text only). */
export type NeighborSpatial =
  | 'same-cell' | 'offset-cell' | 'path' | 'row' | 'level'
  | 'proximity' | 'global' | 'carried' | 'screen' | 'note'

export type NeighborTargetKind = 'std-object' | 'map16-tile' | 'sprite' | 'screen-metadata'

/** Relationship class (research/notes-sprite-neighbor-dependencies.md, Part 4 =
 *  the corrected model). The TSV / asm docs use the letter shorthands; the
 *  metadata carries the developer-friendly names:
 *    A `rail-follower`  — follows the $87xx line-guide rail
 *    B `ice-snap`       — the shared Init prologue CODE_02A007 (collision-tag
 *                         $17 match; replaces the old, WRONG "keyhole snap")
 *    C `tile-read`      — Init/Main reads specific Map16 tiles/tags (slime
 *                         floor, icicle anchor, bomb path, keyhole cork…)
 *    D `sprite-pair`    — needs/uses another placed sprite
 *    E `screen-exit`    — reads the per-screen exit metadata
 *    F `tile-behavior`  — tile-conditional behaviour (pipe spawners, dirt
 *                         diggers, pipe centring)
 *  Not every dep is auto-verifiable or required — see `enforce`:
 *  behaviour-ENABLING relationships (all of `ice-snap` and `tile-behavior`,
 *  the rail-optional rotating platforms, the tree-climbing monkeys…) are
 *  never an error — always `enforce:false`, surfaced as info annotations. */
export type NeighborClass =
  | 'rail-follower' | 'ice-snap' | 'tile-read' | 'sprite-pair' | 'screen-exit' | 'tile-behavior'

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
  /** Collision-tag matcher — the cell's Map16 **page collision secondary-tag**
   *  (hex). The cell matches if its page carries this tag. Used by class F
   *  pipe spawners (`"0x14"` — mirrors the asm gate `CODE_0EB8AE`'s
   *  `R7 & 0xF800 == 0xA000` test), class B ice-block snap (`"0x17"` —
   *  `CODE_02A007`'s `== 0xB800` test), and the falling-rock platform
   *  (`"0x0E"`). OR'd with `tileMatch` / `tileLiterals`. */
  collisionTag?: string
  /** Explicit Map16 tile-id literals (hex) OR'd with `tileMatch` /
   *  `collisionTag` — e.g. the two pipe-mouth tiles (`0x79F1`/`0x79F2`) the asm
   *  special-cases by value because their page isn't tagged pipe, the icicle
   *  anchors `0x8E00-0x8E02`, or the keyhole tile `0x7D24`. */
  tileLiterals?: string[]
  /** Map16 PAGE literals (hex high byte) OR'd with the other matchers — for
   *  asm page-family tests that two ids can't mask-express, e.g. the grinder
   *  monkeys' tree-trunk pages `0x99`/`0x9A` (`SBC #$0099 / LSR / BEQ`). */
  pageLiterals?: string[]
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
  /** Spatial `row` only: how many cells LEFT/RIGHT of the own cell (same row)
   *  the scan covers. The boo-guys-carrying-bomb path-marker scan: the asm
   *  walks the whole row, but every shipped placement matches within ±2; ±4
   *  gives margin without crossing into unrelated marker runs. */
  rowSpan?: number
  /** Sprite-target deps only: a partner counts only within this Chebyshev
   *  cell radius of the sprite. Models the runtime reality that by-ID homing
   *  probes (`FXCODE_098EBF`) see only ACTIVE sprites, and sprites activate
   *  via a CAMERA-relative pixel rectangle (`CODE_check_newspr_screen` →
   *  `FXCODE_098000`: viewport + ~2-3 cells margin, ~21×19 cells, sliding
   *  with the camera) — NOT the level's static 16×16-cell screen grid (that
   *  grid serves exits / page allocation only). Partners farther apart than
   *  the window are never co-active, so the probe never finds them in-game.
   *  Absent ⇒ anywhere in the record (switch pair-state is global; the winged
   *  cloud's rock is transported by the player). `0` = same cell: the
   *  mouser→nest pair uses 0 — the mouser pops out of its hole, so it sits
   *  directly ON it (confirmed in-game; all 22 shipped placements are at
   *  distance 0). */
  radiusCells?: number
  /** Is a missing target a REAL error the editor can verify against a single
   *  loaded level record? `true` ⇒ drives the always-on error indicator.
   *  `false` ⇒ shown as an un-enforced relationship only (panel note, no error
   *  marker), for two reasons: behaviour-ENABLING relationships (all of class
   *  B and F, rail-optional rotating platforms, …) where absence is a valid
   *  placement, and cross-record targets (spatial `carried` — the Key lives in
   *  a connected sub-room, a different record). Derived in the generator
   *  (grade `required` + per-record-checkable) and pinned by the validation
   *  harness, which asserts zero false `missing` among `enforce:true` deps
   *  over every shipped level. */
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
  //    Overlay step: tmp/merge-trace-files.ts.
  //    • GATE-DRIVEN REPAIRS (tmp/refine-spriteset-files.ts, 2026-06-11, pinned
  //      by engine/validity-report.ts): file ids absent from a reachable
  //      shipped host's spriteset dropped (a correct shipped placement can't
  //      lack a hard requirement — the art is global or duplicated across
  //      files), and null-but-placed sprites filled from the cart's static
  //      tile-base table `DATA_sprite_gfx_file_table` (host-confirmed). ──
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
  /**
   * The game only ever brings this sprite into existence by another sprite
   * spawning it at runtime (projectiles, thrown children, boss sub-parts,
   * cutscene/event actors) — it never appears in a placed sprite-stream record.
   * Such sprites can't be hand-placed sensibly (their parent pre-populates the
   * per-slot fields the Init assumes), so the picker marks them with a
   * "spawn-only" badge (informational — they stay listed). Absent ⇒ false.
   * Tool-generated from `engine/spawned-only.ts` (spawned-via-CODE_spawn_sprite*
   * ∩ zero base-cart placements); regenerate with tmp/gen-spawned-only.ts after
   * sprite-spawn asm changes (pinned by engine/spawned-only.test.ts).
   */
  spawnedOnly?: boolean
}

// What the accessors return: stored fields with `exitTrigger` normalised to a
// definite boolean.
export interface ObjectInfo extends StoredObjectInfo {
  /** Stamps a screen-exit tile: a DR/BD door tile (page $18) OR a
   *  player-enterable pipe-mouth tile (tag $14 + DATA_0AEBBC entry bits —
   *  tile-driven pipe entry, no sprite needed). The un-enterable pipe family
   *  ($F4 …) is NOT flagged — those warp via a co-located entrance sprite.
   *  Full three-mechanism model: data/exit-triggers.ts. */
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

/** Hex-string metadata keys — obj-metadata.json's on-disc convention
 *  (`"0x4A"` for 8-bit object ids, `"0x0CA"` for 9-bit sprite ids). */
const objectKey = (id: number): string => `0x${hex(id, 2)}`
const spriteKey = (num: number): string => `0x${hex(num, 3)}`

/** Display-name fallbacks for entities with no (or an empty) metadata name —
 *  the single source for the "Object 4A" / "ExObject 12" / "Sprite 0CA" forms,
 *  shared by the unknown-entity stubs below and the picker's row labels. */
export function fallbackObjectName(id: number): string {
  return `Object ${hex(id, 2)}`
}
export function fallbackExtendedObjectName(exnum: number): string {
  return `ExObject ${hex(exnum, 2)}`
}
export function fallbackSpriteName(num: number): string {
  return `Sprite ${hex(num, 3)}`
}

/** Look up a standard object by ID (1..0xF6). Returns a stable unknown stub if missing. */
export function getStandardObject(id: number): ObjectInfo {
  const stored = data.standardObjects[objectKey(id)] ?? { ...UNKNOWN_OBJECT, name: fallbackObjectName(id) }
  return { ...stored, exitTrigger: stored.exitTrigger ?? false }
}

/** Look up an extended object by exnum (0..0xFF). */
export function getExtendedObject(exnum: number): ObjectInfo {
  const stored = data.extendedObjects[objectKey(exnum)] ?? { ...UNKNOWN_OBJECT, name: fallbackExtendedObjectName(exnum) }
  return { ...stored, exitTrigger: stored.exitTrigger ?? false }
}

/** Look up a sprite by num (9-bit, 0..0x1FF). */
export function getSprite(num: number): SpriteInfo {
  const stored = data.sprites[spriteKey(num)] ?? { ...UNKNOWN_SPRITE, name: fallbackSpriteName(num) }
  return { ...stored, exitTrigger: stored.exitTrigger ?? false }
}

/** Neighbour-dependencies for a sprite (empty array if none). */
export function getSpriteNeighborDeps(num: number): SpriteNeighborDep[] {
  return data.sprites[spriteKey(num)]?.neighborDeps ?? []
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

// The metadata is static, so each catalog is built (entries + map + sort over
// ~1000 ids) once and the same array returned thereafter — the picker + the
// validity/thumbnail hooks all call these per interaction. Treat as read-only.
let standardObjectsCache: CatalogEntry<ObjectInfo>[] | null = null
let extendedObjectsCache: CatalogEntry<ObjectInfo>[] | null = null
let spritesCache: CatalogEntry<SpriteInfo>[] | null = null

/** All standard objects defined in the metadata, sorted by id — for the picker. */
export function listStandardObjects(): CatalogEntry<ObjectInfo>[] {
  if (!standardObjectsCache) {
    standardObjectsCache = Object.entries(data.standardObjects)
      .map(([k, info]) => ({ id: Number(k), info: { ...info, exitTrigger: info.exitTrigger ?? false } }))
      .sort((a, b) => a.id - b.id)
  }
  return standardObjectsCache
}

/** All extended objects (placed with `num=0`, `exnum=id`), sorted by id. */
export function listExtendedObjects(): CatalogEntry<ObjectInfo>[] {
  if (!extendedObjectsCache) {
    extendedObjectsCache = Object.entries(data.extendedObjects)
      .map(([k, info]) => ({ id: Number(k), info: { ...info, exitTrigger: info.exitTrigger ?? false } }))
      .sort((a, b) => a.id - b.id)
  }
  return extendedObjectsCache
}

/** All sprites defined in the metadata, sorted by 9-bit id. */
export function listSprites(): CatalogEntry<SpriteInfo>[] {
  if (!spritesCache) {
    spritesCache = Object.entries(data.sprites)
      .map(([k, info]) => ({ id: Number(k), info: { ...info, exitTrigger: info.exitTrigger ?? false } }))
      .sort((a, b) => a.id - b.id)
  }
  return spritesCache
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
