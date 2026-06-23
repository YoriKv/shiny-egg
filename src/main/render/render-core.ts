// Render cache engine + per-level helpers for the IPC render path. The Tier-1.5
// per-edit caches (decode / bg1-context / collision) + the Tier-2 cell-grid LRUs
// (bg1 + sprite), plus the level/header/palette resolution helpers the handlers
// share. Extracted from ipc/render.ts so that file is thin handlers over this
// engine. The cache state (decodeCache/bg1ContextCache/collisionDataCache/
// gridCache/spriteGridCache) is module-private; handlers reach it via the
// exported get/put + decode/context helpers. Electron-free: every cart-resident
// input (rom / symbols / workRoot / overlayRoot) is passed in by the caller, so
// the engine holds no ambient app/electron state. The thin ipc/render.ts glue
// resolves those from the active project + build and passes them in.

import { decodeLevelById, decodeLevelFromLevelData, type DecodeLevelByIdResult } from 'snes-framework/object-decode'
import { BG1_CHANGER_LO, BG1_CHANGER_HI } from 'snes-framework/bg1-regions'
import type { LevelData, PaletteEdit } from 'snes-framework/types'
import { hex } from 'snes-framework/hex'
import type { RenderHeader } from 'snes-framework/render-gallery'
import { renderBg1 } from 'snes-framework/render-bg1'
import { buildBg1Bands } from 'snes-framework/bg1-band-gfx'
import {
  loadCollisionTable,
  loadPipeEntryBits,
  loadSlopePanels,
  type CollisionEntry
} from 'snes-framework/collision'
import { loadMap16Tables, decodeMap16, type Map16Tables, type Map16SubTile } from 'snes-framework/map16'
import { loadSceneRegs, bgLayerBpp } from 'snes-framework/scene-regs'
import { loadLevelGfx, type GfxFileEntry, type GfxHeader } from 'snes-framework/load-graphics'
import { loadLevelPalettes, type PaletteHeader } from 'snes-framework/load-palettes'
import { applyAnimatedPalette } from 'snes-framework/load-anim-palette'
import { basePaletteWords, PALETTE_BLOB_BANK_FILE } from 'snes-framework/palette-edit'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTileAnimation } from 'snes-framework/load-tile-animation'
import { loadLevel, isWorld6RecordDeep } from 'snes-framework/level'
import { type SymbolMap } from 'snes-framework/symbol-map'
import { createValidityProbe } from 'snes-framework/entity-render-validity'
import { createEntityThumbnailer } from 'snes-framework/entity-thumbnails'
import {
  decodeSingleObject,
  singleObjectDonorLevel,
  type SingleObjectDecode
} from 'snes-framework/single-object-decode'
import { hex0x } from 'snes-framework/hex'
import type { ObjectRenderVerdict } from 'snes-framework/types'
import type {
  EntityValidityCandidate,
  InfluenceClass,
  LevelRenderRequest,
  PickerThumbnails,
  PickerThumbnailsRequest,
  RenderImage
} from '../../shared/ipc-types'

// ── Palette-colour live preview (§B10) ───────────────────────────────────────
// The render path reads BASE CGRAM from the built ROM; the editor's UNSAVED
// colour draft rides in per-request as `req.paletteOverride` (the analog of
// `override` for level data) and is patched into CGRAM via provenance — so the
// canvas previews unsaved palette edits without writing the overlay or
// rebuilding. The SAVED overlay only matters at build time (asar reads it).
// Two known v1 gaps where a live edit does NOT preview (both rebuild correctly
// on Build): (a) gradient backdrops read the blob straight from ROM via
// `backdrop.ts`, bypassing the palette interpreter, so the override never
// reaches them; (b) Graphic/Palette-Changer band palettes are built inside
// `buildBg1Bands`, also outside the override path.

/** Cache-key signature for a palette override — changes iff the edits change. */
export function paletteEditsSig(edits: PaletteEdit[] | undefined): string {
  if (!edits || edits.length === 0) return ''
  return edits.map((e) => `${e.offset}:${e.value}`).sort().join(',')
}

/** Patch CGRAM in place with the draft colour edits via provenance. `cgram` must
 *  have been filled by `loadLevelPalettes` with `provenance` populated. No-op for
 *  an absent / empty override. */
export function applyPaletteEdits(
  cgram: Uint8Array,
  provenance: Int32Array,
  edits: PaletteEdit[] | undefined
): void {
  if (!edits || edits.length === 0) return
  const byOffset = new Map(edits.map((e) => [e.offset, e.value]))
  for (let i = 0; i < 256; i++) {
    const off = provenance[i]!
    if (off < 0) continue
    const v = byOffset.get(off)
    if (v !== undefined) {
      cgram[i * 2] = v & 0xff
      cgram[i * 2 + 1] = (v >>> 8) & 0xff
    }
  }
}

// Pristine base palette words (byte-offset → BGR-15), parsed from the framework's
// base Bank57.asm. Static within a session (changes only on re-extract), so cache
// per workRoot — `buildLevel*Cgram` re-sources from this every render.
let basePalCache: { workRoot: string; words: Map<number, number> } | null = null
function pristineBasePalette(workRoot: string): Map<number, number> {
  if (basePalCache?.workRoot === workRoot) return basePalCache.words
  let words: Map<number, number>
  try {
    words = basePaletteWords(readFileSync(join(workRoot, PALETTE_BLOB_BANK_FILE), 'utf8'))
  } catch (e) {
    // Degrade to the built-ROM palette (the old behaviour) rather than crashing a
    // render; surface it since it disables the reset-to-base preview fix.
    console.error('pristineBasePalette: could not read base palette blob:', e)
    words = new Map()
  }
  basePalCache = { workRoot, words }
  return words
}

/** Re-source CGRAM's master-palette colours from the PRISTINE base blob (not the
 *  built ROM, whose blob has saved palette edits baked in), so the live preview is
 *  BASE ⊕ draft — independent of the build. This makes a colour RESET show base
 *  immediately (the palette twin of `gfxLiveResetToBase`): without it, a reset of a
 *  previously-built colour would fall through to the built ROM's baked colour until
 *  the next rebuild. `loadLevelPalettes` supplies the structure + provenance; only
 *  the blob-sourced colour VALUES change (non-blob entries are unaffected by edits).
 *  Apply BEFORE `applyPaletteEdits` (the draft overlays on top). */
export function resourcePaletteToBase(cgram: Uint8Array, provenance: Int32Array, workRoot: string): void {
  const base = pristineBasePalette(workRoot)
  if (base.size === 0) return // base blob unreadable → leave built-ROM colours
  for (let i = 0; i < 256; i++) {
    const off = provenance[i]!
    if (off < 0) continue
    const v = base.get(off)
    if (v !== undefined) {
      cgram[i * 2] = v & 0xff
      cgram[i * 2 + 1] = (v >>> 8) & 0xff
    }
  }
}

/** Resolve the level — the override as-is when present, else load from disk
 *  (`workRoot` + the active project's `overlayRoot`). */
export function resolveLevel(
  req: LevelRenderRequest,
  workRoot: string,
  overlayRoot: string | undefined
): LevelData {
  if (req.override) return req.override
  return loadLevel({ workRoot, levelRecordId: req.levelRecordId, overlayRoot })
}

// ── Per-edit caches (Tier 1.5 incremental re-render) ─────────────────────────
// Object edits don't change the tileset/palette/Map16 tables or (usually) the
// changer bands, and bg1+collision decode the SAME override per edit. Cache that
// work and reuse it. Every key carries the `symbols` reference: a rebuild
// re-parses the .sym → new ref → all of these invalidate.

/** 64-bit (two-FNV) content key over the inputs that change the Map16 decode —
 *  object stream + header. Sprites don't affect the decode, so a sprite edit
 *  reuses the cached buffer. Two independent FNV streams make a stale-reuse
 *  collision ~1/2^64 (and it self-heals on the next edit). */
export function decodeInputKey(level: LevelData): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b1
  const mix = (n: number): void => {
    a = Math.imul(a ^ (n & 0xffff), 0x01000193) >>> 0
    b = Math.imul(b ^ (n & 0xffff), 0x85ebca77) >>> 0
  }
  for (const f of level.header) mix(f)
  for (const o of level.objects) { mix(o.num); mix(o.exnum ?? 0xffff); mix(o.x); mix(o.y); mix(o.w); mix(o.h) }
  return `${level.recordId}:${level.objects.length}:${a.toString(16)}${b.toString(16)}`
}

/** Size-1 decode cache shared by the bg1 + collision handlers (they decode the
 *  same override on one object edit). Only the override (editor) path is cached
 *  — the disk path can change under a save. */
let decodeCache: { symbols: SymbolMap; key: string; result: DecodeLevelByIdResult | null } | null = null

/** Decode the level's Map16 buffer. Disk path uses `decodeLevelById`; override
 *  path re-serializes + decodes (cached — see decodeCache). */
export function decodeForRequest(
  rom: Uint8Array,
  symbols: SymbolMap,
  req: LevelRenderRequest,
  workRoot: string,
  overlayRoot: string | undefined
): DecodeLevelByIdResult | null {
  if (req.override) {
    const key = decodeInputKey(req.override)
    if (decodeCache && decodeCache.symbols === symbols && decodeCache.key === key) {
      return decodeCache.result
    }
    const result = decodeLevelFromLevelData({
      rom, symbols, workRoot, levelData: req.override
    })
    decodeCache = { symbols, key, result }
    return result
  }
  return decodeLevelById({
    rom, symbols, workRoot, levelRecordId: req.levelRecordId, overlayRoot
  })
}

/** Map a provenance cell's (neighbor, buried) flags to its colour class. */
export function influenceClass(neighbor: boolean, buried: boolean): InfluenceClass {
  if (buried) return neighbor ? 'buriedNeighbor' : 'buried'
  return neighbor ? 'neighbor' : 'footprint'
}

/** Changer-sprite ($1BA-$1C9) signature: only these sprites alter BG1 (via the
 *  per-region bands), so the bg1 context depends on the sprite list only through
 *  them — ordinary sprite edits leave this unchanged. */
export function changerSpriteSig(sprites: LevelData['sprites']): string {
  let sig = ''
  for (const s of sprites) {
    if (s.num >= BG1_CHANGER_LO && s.num <= BG1_CHANGER_HI) sig += `${s.num},${s.x},${s.y};`
  }
  return sig
}

/** Per-tileset bg1 render context — everything `renderBg1` needs EXCEPT the
 *  decoded buffer (VRAM/CGRAM/Map16 tables/char base/changer bands + the gfx
 *  manifest for diagnostics). Invariant across object edits, so built once per
 *  tileset and reused. */
export interface Bg1Context {
  vram: Uint8Array
  cgram: Uint8Array
  map16Tables: Map16Tables
  bg1CharAddr: number
  /** BG1 colour depth — 4bpp (BG Mode 1/2) or 2bpp (BG Mode 0 / level mode $0A).
   *  See renderBg1's `bg1Bpp`. */
  bg1Bpp: 2 | 4
  bands?: Parameters<typeof renderBg1>[0]['bands']
  bandAxis?: Parameters<typeof renderBg1>[0]['bandAxis']
  manifest: GfxFileEntry[]
}
let bg1ContextCache: { symbols: SymbolMap; key: string; ctx: Bg1Context } | null = null

export function getBg1Context(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData,
  levelRecordId: number,
  paletteEdits: PaletteEdit[] | undefined,
  workRoot: string,
  gfxOverride?: ReadonlyMap<string, Uint8Array>,
  gfxRevision?: number
): Bg1Context {
  const h = level.header
  // The palette-override sig + gfx-edit revision are part of the key so a live
  // colour edit (which changes neither the header nor the changer sprites) OR a
  // live gfx-tile edit still invalidates the cached CGRAM/VRAM and re-renders.
  const key = `${levelRecordId}:${h.join(',')}:${changerSpriteSig(level.sprites)}:${paletteEditsSig(paletteEdits)}:gfx${gfxRevision ?? 0}`
  if (bg1ContextCache && bg1ContextCache.symbols === symbols && bg1ContextCache.key === key) {
    return bg1ContextCache.ctx
  }
  // VRAM/CGRAM/manifest come from the shared (cached) build — the same entry
  // the bgLayers handler consumes, so a fresh level load decompresses once,
  // not once per layer. Read-only by contract (see LevelVramCgram).
  const { vram, cgram, manifest, gfxHeader, palHeader } = buildLevelVramCgram(
    rom, symbols, level, levelRecordId, workRoot, { animate: true, paletteEdits, gfxOverride, gfxRevision }
  )
  const regs = loadSceneRegs(rom, symbols, h[9] ?? 0)
  const map16Tables = loadMap16Tables(rom, symbols)
  // Per-region BG1 (Graphic/Palette Changer sprites $1BA-$1C9): some levels swap
  // the BG1 char tileset/palette mid-playfield (e.g. 4-4's fort → tileset 6).
  // buildBg1Bands returns the override bands + axis, or undefined for the common
  // single-tileset case. Keyed via changerSpriteSig above.
  const bandResult = buildBg1Bands({
    rom, symbols, sprites: level.sprites, gfx: gfxHeader, palette: palHeader,
    animationTileset: h[10] ?? 0, levelMode: h[9] ?? 0
  })
  const ctx: Bg1Context = {
    vram, cgram, map16Tables, bg1CharAddr: regs.bg1CharAddr,
    bg1Bpp: bgLayerBpp(regs.bgmodeMode, 'bg1'),
    bands: bandResult?.bands, bandAxis: bandResult?.bandAxis, manifest
  }
  bg1ContextCache = { symbols, key, ctx }
  return ctx
}

/** Cart-global collision data (table + slope panels + per-tile pipe-entry
 *  bits) — rom-only, so keyed on the symbols reference. */
let collisionDataCache:
  | {
      symbols: SymbolMap
      table: CollisionEntry[]
      panels: ReturnType<typeof loadSlopePanels>
      pipeEntryBits: Uint8Array
    }
  | null = null
export function getCollisionData(
  rom: Uint8Array,
  symbols: SymbolMap
): { table: CollisionEntry[]; panels: ReturnType<typeof loadSlopePanels>; pipeEntryBits: Uint8Array } {
  if (collisionDataCache && collisionDataCache.symbols === symbols) return collisionDataCache
  const table = loadCollisionTable(rom, symbols)
  const panels = loadSlopePanels(rom, symbols)
  const pipeEntryBits = loadPipeEntryBits(rom, symbols)
  collisionDataCache = { symbols, table, panels, pipeEntryBits }
  return collisionDataCache
}

// ── Tier 2: incremental cell patching ────────────────────────────────────────
// Each bg1/collision request decodes the (full) level, flattens it to a
// resolved-cell grid, and — when the renderer supplies a `baseToken` whose grid
// we still have AND whose render context matches — ships only the cells that
// differ (a "patch") instead of the 33.6 MB full bitmap. The diff is over the
// COMPLETE decoded grid, so every ripple (autotile neighbours, overwrite order,
// screen alloc/dealloc / page-remap) is captured → a patched backing canvas is
// byte-identical to a fresh full render (proven by render-patch.test.ts).

/** Above this many changed cells a patch loses to a full render (per-cell
 *  putImageData overhead on the renderer + payload size), so fall back to full.
 *  Single-entity editor edits change tens–low-hundreds of cells; this only trips
 *  on pathological bulk changes the editor can't produce one commit at a time. */
export const PATCH_CELL_THRESHOLD = 2048

export interface GridCacheEntry {
  grid: Uint16Array
  recordId: number
  /** `header.join(',')` — bg1 pixels depend on the tileset/palette it encodes. */
  headerKey: string
  /** Changer-sprite signature — bg1 bands depend on it. */
  changerSig: string
  symbols: SymbolMap
}

/** token (decodeInputKey) → resolved grid + the context it was rendered under.
 *  Insertion-ordered Map used as a small LRU. Sized so the live base + a few
 *  recent states survive in-flight cancellations; eviction just forces a (still
 *  correct) full render. */
export const GRID_CACHE_MAX = 16
const gridCache = new Map<string, GridCacheEntry>()

export function gridCacheGet(token: string): GridCacheEntry | undefined {
  const e = gridCache.get(token)
  if (e) { gridCache.delete(token); gridCache.set(token, e) } // bump to MRU
  return e
}

export function gridCachePut(token: string, entry: GridCacheEntry): void {
  gridCache.delete(token)
  gridCache.set(token, entry)
  while (gridCache.size > GRID_CACHE_MAX) {
    const oldest = gridCache.keys().next().value
    if (oldest === undefined) break
    gridCache.delete(oldest)
  }
}

// ── Sprite-layer Tier-2 (content-signature grid) ─────────────────────────────
// Same shape as the bg1/collision cell-grid cache, but the diff substrate is the
// sprite content-signature grid (see render-sprite-layer.ts), not resolved Map16
// IDs. Token is over header + each sprite's (num, x, y) in list order — the inputs
// that determine the signature grid. Palette-independent (a palette change forces a
// full render renderer-side, like bg1), so the same token can back a re-coloured
// patch (cells are always re-rendered with the request's current palette).

/** Sprite-layer Tier-2 token (decode content key for the sprite signature grid). */
export function spriteInputKey(level: LevelData): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b1
  const mix = (n: number): void => {
    a = Math.imul(a ^ (n & 0xffff), 0x01000193) >>> 0
    b = Math.imul(b ^ (n & 0xffff), 0x85ebca77) >>> 0
  }
  for (const f of level.header) mix(f)
  for (const s of level.sprites) { mix(s.num); mix(s.x); mix(s.y) }
  return `${level.recordId}:${level.sprites.length}:${a.toString(16)}${b.toString(16)}`
}

export interface SpriteGridCacheEntry {
  grid: Uint32Array
  recordId: number
  /** `header.join(',')` — sprite cel pixels depend on the tileset/palette it encodes. */
  headerKey: string
  symbols: SymbolMap
}
const spriteGridCache = new Map<string, SpriteGridCacheEntry>()
export function spriteGridCacheGet(token: string): SpriteGridCacheEntry | undefined {
  const e = spriteGridCache.get(token)
  if (e) { spriteGridCache.delete(token); spriteGridCache.set(token, e) } // bump to MRU
  return e
}
export function spriteGridCachePut(token: string, entry: SpriteGridCacheEntry): void {
  spriteGridCache.delete(token)
  spriteGridCache.set(token, entry)
  while (spriteGridCache.size > GRID_CACHE_MAX) {
    const oldest = spriteGridCache.keys().next().value
    if (oldest === undefined) break
    spriteGridCache.delete(oldest)
  }
}

// ── Entity render-validity (picker filter) ───────────────────────────────────
// ~500 single-object probe decodes per call, so cached on the gfx-relevant
// header subset (bg1/bg2/bg3/spriteset/levelMode/animTileset/isWorld6) + the
// candidate set — ~16 distinct header keys ever occur, so after first touch
// per tileset the picker's refetches are dictionary lookups. Symbols-ref keyed
// like the other caches (a rebuild invalidates everything).

export interface EntityValidityVerdicts {
  objects: Record<string, ObjectRenderVerdict>
  extended: Record<string, ObjectRenderVerdict>
  mode7: boolean
}

const ENTITY_VALIDITY_CACHE_MAX = 32
const entityValidityCache = new Map<string, { symbols: SymbolMap; result: EntityValidityVerdicts }>()

/** FNV signature over the candidate list — static in practice (the picker
 *  catalog), but keyed so a metadata change can't serve stale verdicts. */
function candidatesSig(candidates: EntityValidityCandidate[]): string {
  let a = 0x811c9dc5
  for (const c of candidates) {
    a = Math.imul(a ^ (c.kind === 'std' ? 1 : 2), 0x01000193) >>> 0
    a = Math.imul(a ^ c.id, 0x01000193) >>> 0
    a = Math.imul(a ^ (c.w & 0xff), 0x01000193) >>> 0
    a = Math.imul(a ^ (c.h & 0xff), 0x01000193) >>> 0
  }
  return `${candidates.length}:${a.toString(16)}`
}

/** A per-call memoised single-object decode keyed by (kind, id, w, h). The
 *  validity pass + the thumbnail pass of one getEntityCatalog call share it, so
 *  each candidate decodes ONCE and feeds both (the picker-catalog dedup). The
 *  memo (and its ~500 decode buffers) lives only as long as the closure — the
 *  caller drops it after warming, so nothing is retained between calls. */
function makeSharedObjectDecode(
  rom: Uint8Array,
  symbols: SymbolMap,
  workRoot: string,
  donor: LevelData
): SingleObjectDecode {
  const memo = new Map<string, DecodeLevelByIdResult | null>()
  return (kind, id, w, h) => {
    const k = `${kind}:${id}:${w}x${h}`
    const hit = memo.get(k)
    if (hit !== undefined) return hit
    const d = decodeSingleObject(rom, symbols, workRoot, singleObjectDonorLevel(donor, kind, id, w, h))
    memo.set(k, d)
    return d
  }
}

export function getEntityValidity(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData,
  levelRecordId: number,
  workRoot: string,
  candidates: EntityValidityCandidate[],
  /** Shared single-object decode (the unified getEntityCatalog pass) so the
   *  probe's decodes also feed the thumbnailer. Omit for a standalone verdict
   *  run. */
  sharedDecode?: SingleObjectDecode
): EntityValidityVerdicts {
  const h = level.header
  const w6 = isWorld6(levelRecordId, workRoot)
  const key =
    `${[h[1], h[3], h[5], h[7], h[9], h[10], w6 ? 1 : 0].join(',')}` +
    `:${candidatesSig(candidates)}`
  const hit = entityValidityCache.get(key)
  if (hit && hit.symbols === symbols) {
    entityValidityCache.delete(key)
    entityValidityCache.set(key, hit) // bump to MRU
    return hit.result
  }

  const probe = createValidityProbe({ rom, symbols, workRoot, donor: level, isWorld6: w6, decode: sharedDecode })
  const objects: Record<string, ObjectRenderVerdict> = {}
  const extended: Record<string, ObjectRenderVerdict> = {}
  if (!probe.mode7) {
    for (const c of candidates) {
      const verdict = probe.probe(c.kind, c.id, c.w, c.h)
      ;(c.kind === 'std' ? objects : extended)[hex0x(c.id, 2)] = verdict
    }
  }
  const result: EntityValidityVerdicts = { objects, extended, mode7: probe.mode7 }
  entityValidityCache.set(key, { symbols, result })
  while (entityValidityCache.size > ENTITY_VALIDITY_CACHE_MAX) {
    const oldest = entityValidityCache.keys().next().value
    if (oldest === undefined) break
    entityValidityCache.delete(oldest)
  }
  return result
}

// ── Picker thumbnails (§B5) ──────────────────────────────────────────────────
// Same caching discipline as the validity verdicts: keyed on the gfx-relevant
// header subset + the request's id sets. The payload is bitmaps (MBs, not
// bytes), so the LRU is small — a tab refetch within the same header tuple is
// a cache hit, a tileset change re-renders.

const THUMBNAIL_CACHE_MAX = 6
const thumbnailCache = new Map<string, { symbols: SymbolMap; result: PickerThumbnails }>()

export function getPickerThumbnails(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData,
  levelRecordId: number,
  workRoot: string,
  req: PickerThumbnailsRequest,
  /** Shared single-object decode (the unified getEntityCatalog pass): object
   *  thumbs reuse the validity probe's decodes instead of re-decoding. Omit for
   *  a standalone thumbnail run (the direct render:pickerThumbnails IPC). */
  sharedDecode?: SingleObjectDecode
): PickerThumbnails {
  const h = level.header
  const w6 = isWorld6(levelRecordId, workRoot)
  let sig = 0x811c9dc5
  const mix = (n: number): void => {
    sig = Math.imul(sig ^ n, 0x01000193) >>> 0
  }
  for (const c of req.candidates ?? []) {
    mix(c.kind === 'std' ? 1 : 2); mix(c.id); mix(c.w); mix(c.h)
  }
  for (const n of req.spriteNums ?? []) mix(n)
  // (the cel-format gate / settled palette / rest frame are engine-owned constants now —
  // sprite-render-facts.ts — so they no longer vary per request and aren't mixed into the key.)
  const key = `${[h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8], h[9], h[10], w6 ? 1 : 0].join(',')}:${sig.toString(16)}`
  const hit = thumbnailCache.get(key)
  if (hit && hit.symbols === symbols) {
    thumbnailCache.delete(key)
    thumbnailCache.set(key, hit) // bump to MRU
    return hit.result
  }

  const thumbnailer = createEntityThumbnailer({
    rom, symbols, workRoot, donor: level, isWorld6: w6, decode: sharedDecode
  })
  const objects: Record<string, RenderImage> = {}
  const extended: Record<string, RenderImage> = {}
  const sprites: Record<string, RenderImage> = {}
  for (const c of req.candidates ?? []) {
    const img = thumbnailer.objectThumb(c.kind, c.id, c.w, c.h)
    if (img) (c.kind === 'std' ? objects : extended)[hex0x(c.id, 2)] = img
  }
  for (const num of req.spriteNums ?? []) {
    const img = thumbnailer.spriteThumb(num)
    if (img) sprites[hex0x(num, 3)] = img
  }
  const result: PickerThumbnails = { objects, extended, sprites }
  thumbnailCache.set(key, { symbols, result })
  while (thumbnailCache.size > THUMBNAIL_CACHE_MAX) {
    const oldest = thumbnailCache.keys().next().value
    if (oldest === undefined) break
    thumbnailCache.delete(oldest)
  }
  return result
}

// ── Unified picker catalog (§B5): validity + thumbnails in one decode pass ───
// The picker's two cold costs (object render-validity verdicts and object/
// sprite thumbnails) BOTH decode every catalog object alone under the header.
// This computes the verdicts NOW (the caller — the validity IPC — returns them)
// and warms the thumbnail caches off the critical path via a shared decode, so
// each object decodes ONCE instead of twice (validity-at-load + thumbnails-at-
// open). The validity IPC fires on every level load (Canvas), so the picker's
// first open is a thumbnail cache hit. Warming runs in setImmediate so it never
// blocks the validity return; a newer level supersedes an in-flight warm.

let catalogWarmGen = 0

export function getEntityCatalog(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData,
  levelRecordId: number,
  workRoot: string,
  candidates: EntityValidityCandidate[],
  spriteNums: number[]
): EntityValidityVerdicts {
  const sharedDecode = makeSharedObjectDecode(rom, symbols, workRoot, level)
  // Verdicts now (returned to the caller), filling the shared memo on a cold
  // header. A cached header skips the probe → the memo stays empty and the warm
  // below decodes fresh (still off the critical path) — no dedup, but no cost on
  // the validity path either.
  const verdicts = getEntityValidity(
    rom, symbols, level, levelRecordId, workRoot, candidates, sharedDecode
  )
  const gen = ++catalogWarmGen
  setImmediate(() => {
    if (gen !== catalogWarmGen) return // superseded by a newer level/header
    try {
      // Object thumbs hit the shared memo (render-only on the cold path); sprite
      // thumbs need no object decode. Two requests → the two thumbnail-cache
      // keys the picker's object/sprite tabs read.
      getPickerThumbnails(rom, symbols, level, levelRecordId, workRoot, { levelRecordId, candidates }, sharedDecode)
      getPickerThumbnails(rom, symbols, level, levelRecordId, workRoot, { levelRecordId, spriteNums })
    } catch {
      /* warming is best-effort — the picker's own fetch recomputes on a miss */
    }
  })
  return verdicts
}

/**
 * Gated Map16 + GFX diagnostics for one BG1 render. Enable with the
 * `SE_MAP16_LOG` env var (`SE_MAP16_LOG=1 pnpm run dev`). Optionally scope to
 * one level id with `SE_MAP16_LEVEL=0x1E` to avoid flooding.
 *
 * Logs, to the main-process console:
 *   1. the level header + resolved BG1 char base,
 *   2. the GFX→VRAM manifest (which compressed chunks loaded where),
 *   3. the Map16 table provenance (index/page-data PCs + page cell counts),
 *   4. every DISTINCT Map16 ID the level references, with each sub-tile's
 *      (tileIndex/palette/flips), its VRAM byte offset, and whether that
 *      offset was actually filled by a loaded GFX chunk (`!MISS` = not
 *      covered by gfx, `~anim` = filled by tile-animation, blank = gfx-loaded).
 *
 * "wrong tiles" should show up here as either an out-of-page Map16 resolution
 * (THREW) or a sub-tile pointing at unloaded VRAM (`!MISS`).
 */
export function logMap16Diagnostics(args: {
  rom: Uint8Array
  symbols: SymbolMap
  levelRecordId: number
  header: number[]
  bg1CharAddr: number
  gfxManifest: GfxFileEntry[]
  vram: Uint8Array
  map16Tables: Map16Tables
  levelDataBuffer: Uint8Array
  screenPageMap: Uint8Array
}): void {
  if (!process.env.SE_MAP16_LOG) return
  const want = process.env.SE_MAP16_LEVEL
  if (want && parseInt(want, 16) !== args.levelRecordId) return

  const { symbols, levelRecordId, header, bg1CharAddr, gfxManifest, vram, map16Tables, levelDataBuffer, screenPageMap } = args
  const hx = (n: number, w = 2): string => hex(n, w)
  const tag = `[map16:0x${hx(levelRecordId)}]`
  const log = (s: string): void => console.log(`${tag} ${s}`)

  log(`header=[${header.join(',')}] bg1Tileset=${header[1]} levelMode=$${hx(header[9] ?? 0)} bg1CharAddr=$${hx(bg1CharAddr, 4)}`)

  const ranges: Array<[number, number]> = []
  log(`GFX manifest: ${gfxManifest.length} chunks ->`)
  for (const e of [...gfxManifest].sort((a, b) => a.vramByteOffset - b.vramByteOffset)) {
    const end = e.vramByteOffset + e.sizeBytes
    ranges.push([e.vramByteOffset, end])
    log(`  dp${e.dpSlot ?? '?'} ${e.format} src$${hx(e.srcPC, 6)} -> VRAM $${hx(e.vramByteOffset, 4)}..$${hx(end, 4)} (${e.sizeBytes}b)`)
  }
  const coveredByGfx = (off: number, len = 32): boolean => ranges.some(([s, en]) => off >= s && off + len <= en)
  const vramNonZero = (off: number, len = 32): boolean => { for (let k = 0; k < len; k++) if (vram[off + k]! !== 0) return true; return false }

  try {
    log(`Map16 tables: index@$${hx(symbols.pc('DATA_bitmap_asset_offset_table'), 6)} pageData@$${hx(symbols.pc('DATA_bitmap_asset_payloads'), 6)} pageCells[0..1]=${map16Tables.pageCellCounts[0]},${map16Tables.pageCellCounts[1]}`)
  } catch { /* sym names may differ on older builds */ }

  // Distinct referenced Map16 IDs across allocated screens.
  const counts = new Map<number, number>()
  for (let s = 0; s < screenPageMap.length; s++) {
    if (screenPageMap[s] === 0x80) continue
    const page = screenPageMap[s]! & 0x3f
    if (page === 0) continue
    const base = page * 512
    for (let i = 0; i < 512; i += 2) {
      const id = levelDataBuffer[base + i]! | (levelDataBuffer[base + i + 1]! << 8)
      if (id !== 0) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  log(`referenced Map16 IDs: ${counts.size} distinct`)
  const out: Map16SubTile[] = new Array(4) as Map16SubTile[]
  for (const id of [...counts.keys()].sort((a, b) => a - b)) {
    let line = `$${hx(id, 4)} x${String(counts.get(id)).padStart(4)} pg${hx(id >>> 8)} t${hx(id & 0xff)}: `
    try {
      decodeMap16(map16Tables, id, out)
      line += out.map((st) => {
        const v = (bg1CharAddr + st.tileIndex * 32) & 0xffff
        const cov = coveredByGfx(v) ? '' : (vramNonZero(v) ? '~anim' : '!MISS')
        return `${hx(st.tileIndex, 3)}/${st.paletteRow}${st.hflip ? 'H' : ''}${st.vflip ? 'V' : ''}@$${hx(v, 4)}${cov}`
      }).join(' ')
    } catch (e) {
      line += `THREW ${e instanceof Error ? e.message : e}`
    }
    log(line)
  }
}

/** BGR-15 → CSS `#rrggbb` (full-range expand, matches engine/color.ts). */
export function cssFromBgr15(c15: number): string {
  const expand = (v: number): number => ((v << 3) | (v >>> 2)) & 0xff
  const r5 = c15 & 0x1f
  const g5 = (c15 >>> 5) & 0x1f
  const b5 = (c15 >>> 10) & 0x1f
  return `#${expand(r5).toString(16).padStart(2, '0')}${expand(g5).toString(16).padStart(2, '0')}${expand(b5).toString(16).padStart(2, '0')}`
}

/** World-6 (dark tileset/palette) test for a record id, resolved against the
 *  cart's level-map under `workRoot`. Uses the deep resolver so warp-reached
 *  sub-rooms of a world-6 level (e.g. 6-6's maze interior) inherit the dark
 *  tileset too — they have no world-map translevel of their own (see
 *  isWorld6RecordDeep). */
export function isWorld6(levelRecordId: number, workRoot: string): boolean {
  return isWorld6RecordDeep(workRoot, levelRecordId)
}

/** GfxHeader from an unpacked level header + record id. `isWorld6` selects the
 *  dark-world BG1 tileset/palette tables (sub-rooms included — see isWorld6). */
export function gfxHeaderFromLevel(h: readonly number[], levelRecordId: number, workRoot: string): GfxHeader {
  return {
    bg1Tileset: h[1] ?? 0,
    bg2Tileset: h[3] ?? 0,
    bg3Tileset: h[5] ?? 0,
    spriteTileset: h[7] ?? 0,
    isWorld6: isWorld6(levelRecordId, workRoot),
    levelMode: h[9] ?? 0
  }
}

/** PaletteHeader from an unpacked level header + record id. */
export function paletteHeaderFromLevel(h: readonly number[], levelRecordId: number, workRoot: string): PaletteHeader {
  return {
    bgColor: h[0] ?? 0,
    bg1Palette: h[2] ?? 0,
    bg2Palette: h[4] ?? 0,
    bg3Palette: h[6] ?? 0,
    spritePalette: h[8] ?? 0,
    yoshiColor: 0,
    isWorld6: isWorld6(levelRecordId, workRoot),
    levelMode: h[9] ?? 0
  }
}

/** RenderHeader (Map16-gallery / tile-usage thumbnails) from an unpacked level
 *  header + record id — the full per-layer tileset/palette + spriteset + anim +
 *  isWorld6 view the gallery renderers take. */
export function renderHeaderFromLevel(h: readonly number[], levelRecordId: number, workRoot: string): RenderHeader {
  return {
    bgColor: h[0] ?? 0,
    bg1Tileset: h[1] ?? 0,
    bg1Palette: h[2] ?? 0,
    bg2Tileset: h[3] ?? 0,
    bg2Palette: h[4] ?? 0,
    bg3Tileset: h[5] ?? 0,
    bg3Palette: h[6] ?? 0,
    spriteTileset: h[7] ?? 0,
    spritePalette: h[8] ?? 0,
    yoshiColor: 0,
    isWorld6: isWorld6(levelRecordId, workRoot),
    levelMode: h[9] ?? 0,
    animationTileset: h[10] ?? 0
  }
}

// ── Per-level VRAM/CGRAM build (shared by the per-level render handlers) ──────
// The cgram / editablePalette / bgLayers / spriteLayer handlers each used to
// re-inline the same loader sequence — including the load-ORDER constraint that
// tile-animation must overlay VRAM *after* loadLevelGfx. Centralised here so the
// ordering lives in one place and the handlers stay thin.

/** Base CGRAM + per-entry provenance for a level, with the live palette-edit
 *  draft patched in (pass `paletteEdits = undefined` for the unedited base, as
 *  the editable-palette panel needs). */
export function buildLevelCgram(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData,
  levelRecordId: number,
  workRoot: string,
  paletteEdits?: PaletteEdit[]
): { cgram: Uint8Array; provenance: Int32Array } {
  const palHeader = paletteHeaderFromLevel(level.header, levelRecordId, workRoot)
  const cgram = new Uint8Array(512)
  const provenance = new Int32Array(256)
  loadLevelPalettes(rom, symbols, palHeader, cgram, provenance)
  resourcePaletteToBase(cgram, provenance, workRoot)
  applyPaletteEdits(cgram, provenance, paletteEdits)
  return { cgram, provenance }
}

/** `buildLevelVramCgram`'s (cached, shared) result. READ-ONLY by contract: the
 *  buffers are handed to every consumer with the same key, so writing into
 *  `vram`/`cgram` would corrupt later renders. All current consumers
 *  (composeBgLayers / buildSpriteRenderModel / renderBg1) only read. */
export interface LevelVramCgram {
  vram: Uint8Array
  cgram: Uint8Array
  provenance: Int32Array
  manifest: GfxFileEntry[]
  gfxHeader: GfxHeader
  palHeader: PaletteHeader
}

/** Small LRU over `buildLevelVramCgram`. The build only reads the header (the
 *  gfx/palette headers derive from it) + the palette-edit draft, so the key is
 *  just those + the animate flag — sprite/object edits hit the cache, which is
 *  the point: without it every sprite-edit commit re-ran the full LZ2/LZ16
 *  decompress. 4 entries covers a level's animate:true (bgLayers/bg1) +
 *  animate:false (spriteLayer) pair with headroom for a level switch. A rebuild
 *  re-parses the .sym → new `symbols` ref → flush (same convention as every
 *  other cache in this file). */
let vramCgramCache: { symbols: SymbolMap; entries: Map<string, LevelVramCgram> } | null = null
const VRAM_CGRAM_CACHE_MAX = 4

/** A level's VRAM (gfx-loaded, optionally tile-animated) + CGRAM (+ palette-edit
 *  draft) + the gfx manifest + the resolved gfx/palette headers — the inputs the
 *  bgLayers/spriteLayer renderers share. `animate` overlays the tile-animation
 *  VRAM slots (BG layers need it; the sprite layer does not). The manifest +
 *  headers are always built; consumers ignore what they don't use. Cached —
 *  treat the result as read-only (see LevelVramCgram). */
export function buildLevelVramCgram(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData,
  levelRecordId: number,
  workRoot: string,
  opts: {
    animate: boolean
    paletteEdits?: PaletteEdit[]
    /** Live gfx-file edits (`format/fileId` → tiles) to overlay onto VRAM — the
     *  gfx twin of `paletteEdits`. `gfxRevision` bumps on any edit so it keys the
     *  cache (the Map identity alone wouldn't, being mutated in place). */
    gfxOverride?: ReadonlyMap<string, Uint8Array>
    gfxRevision?: number
  }
): LevelVramCgram {
  const h = level.header
  const key = `${levelRecordId}:${h.join(',')}:${opts.animate ? 'a' : ''}:${paletteEditsSig(opts.paletteEdits)}:gfx${opts.gfxRevision ?? 0}`
  if (vramCgramCache && vramCgramCache.symbols === symbols) {
    const hit = vramCgramCache.entries.get(key)
    if (hit) {
      // Re-insert to refresh LRU recency (Map preserves insertion order).
      vramCgramCache.entries.delete(key)
      vramCgramCache.entries.set(key, hit)
      return hit
    }
  } else {
    vramCgramCache = { symbols, entries: new Map() }
  }
  const gfxHeader = gfxHeaderFromLevel(h, levelRecordId, workRoot)
  const palHeader = paletteHeaderFromLevel(h, levelRecordId, workRoot)
  const vram = new Uint8Array(0x10000)
  const cgram = new Uint8Array(512)
  const provenance = new Int32Array(256)
  const manifest: GfxFileEntry[] = []
  loadLevelGfx(rom, symbols, gfxHeader, vram, manifest, opts.gfxOverride)
  if (opts.animate) {
    // Tile-animation VRAM must overlay AFTER loadLevelGfx — it overwrites the
    // animated-tile slots the chunk-list interpreter filled, so reversing the
    // order leaves BG1 cells that reference animated tiles rendering garbage.
    loadTileAnimation(rom, symbols, {
      animationTileset: h[10] ?? 0, bg1Tileset: gfxHeader.bg1Tileset, levelMode: h[9] ?? 0
    }, vram)
  }
  loadLevelPalettes(rom, symbols, palHeader, cgram, provenance)
  resourcePaletteToBase(cgram, provenance, workRoot)
  applyPaletteEdits(cgram, provenance, opts.paletteEdits)
  // Cart per-frame animated palette (gm0F) at phase 0 — applied LAST so the
  // animated rows reflect the in-level appearance (the cart overwrites them
  // every frame). Render/canvas only: the editable-palette panel uses the
  // separate `buildLevelCgram` (no anim) so palette editing stays on the static
  // base mapped to the master blob via provenance.
  applyAnimatedPalette(rom, cgram, h)
  const result: LevelVramCgram = { vram, cgram, provenance, manifest, gfxHeader, palHeader }
  vramCgramCache.entries.set(key, result)
  if (vramCgramCache.entries.size > VRAM_CGRAM_CACHE_MAX) {
    vramCgramCache.entries.delete(vramCgramCache.entries.keys().next().value!)
  }
  return result
}

