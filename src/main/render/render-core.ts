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
import { loadCollisionTable, loadSlopePanels, type CollisionEntry } from 'snes-framework/collision'
import { loadMap16Tables, decodeMap16, type Map16Tables, type Map16SubTile } from 'snes-framework/map16'
import { loadSceneRegs } from 'snes-framework/scene-regs'
import { loadLevelGfx, type GfxFileEntry, type GfxHeader } from 'snes-framework/load-graphics'
import { loadLevelPalettes, type PaletteHeader } from 'snes-framework/load-palettes'
import { loadTileAnimation } from 'snes-framework/load-tile-animation'
import { loadLevel, isWorld6RecordDeep } from 'snes-framework/level'
import { type SymbolMap } from 'snes-framework/symbol-map'
import type { InfluenceClass, LevelRenderRequest } from '../../shared/ipc-types'

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
  workRoot: string
): Bg1Context {
  const h = level.header
  // The palette-override sig is part of the key so a live colour edit (which
  // changes neither the header nor the changer sprites) still invalidates the
  // cached CGRAM and re-renders the level with the new colours.
  const key = `${levelRecordId}:${h.join(',')}:${changerSpriteSig(level.sprites)}:${paletteEditsSig(paletteEdits)}`
  if (bg1ContextCache && bg1ContextCache.symbols === symbols && bg1ContextCache.key === key) {
    return bg1ContextCache.ctx
  }
  const gfxHeader = gfxHeaderFromLevel(h, levelRecordId, workRoot)
  const palHeader = paletteHeaderFromLevel(h, levelRecordId, workRoot)
  const vram = new Uint8Array(0x10000)
  const cgram = new Uint8Array(512)
  const palProvenance = new Int32Array(256)
  const manifest: GfxFileEntry[] = []
  loadLevelGfx(rom, symbols, gfxHeader, vram, manifest)
  loadTileAnimation(rom, symbols, {
    animationTileset: h[10] ?? 0, bg1Tileset: gfxHeader.bg1Tileset, levelMode: h[9] ?? 0
  }, vram)
  loadLevelPalettes(rom, symbols, palHeader, cgram, palProvenance)
  applyPaletteEdits(cgram, palProvenance, paletteEdits)
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
    bands: bandResult?.bands, bandAxis: bandResult?.bandAxis, manifest
  }
  bg1ContextCache = { symbols, key, ctx }
  return ctx
}

/** Cart-global collision data (table + slope panels) — rom-only, so keyed on the
 *  symbols reference. */
let collisionDataCache:
  | { symbols: SymbolMap; table: CollisionEntry[]; panels: ReturnType<typeof loadSlopePanels> }
  | null = null
export function getCollisionData(
  rom: Uint8Array,
  symbols: SymbolMap
): { table: CollisionEntry[]; panels: ReturnType<typeof loadSlopePanels> } {
  if (collisionDataCache && collisionDataCache.symbols === symbols) return collisionDataCache
  const table = loadCollisionTable(rom, symbols)
  const panels = loadSlopePanels(rom, symbols)
  collisionDataCache = { symbols, table, panels }
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
    isWorld6: isWorld6(levelRecordId, workRoot)
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
  applyPaletteEdits(cgram, provenance, paletteEdits)
  return { cgram, provenance }
}

/** A level's VRAM (gfx-loaded, optionally tile-animated) + CGRAM (+ palette-edit
 *  draft) + the gfx manifest + the resolved gfx/palette headers — the inputs the
 *  bgLayers/spriteLayer renderers share. `animate` overlays the tile-animation
 *  VRAM slots (BG layers need it; the sprite layer does not). The manifest +
 *  headers are always built; consumers ignore what they don't use. */
export function buildLevelVramCgram(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData,
  levelRecordId: number,
  workRoot: string,
  opts: { animate: boolean; paletteEdits?: PaletteEdit[] }
): {
  vram: Uint8Array
  cgram: Uint8Array
  provenance: Int32Array
  manifest: GfxFileEntry[]
  gfxHeader: GfxHeader
  palHeader: PaletteHeader
} {
  const h = level.header
  const gfxHeader = gfxHeaderFromLevel(h, levelRecordId, workRoot)
  const palHeader = paletteHeaderFromLevel(h, levelRecordId, workRoot)
  const vram = new Uint8Array(0x10000)
  const cgram = new Uint8Array(512)
  const provenance = new Int32Array(256)
  const manifest: GfxFileEntry[] = []
  loadLevelGfx(rom, symbols, gfxHeader, vram, manifest)
  if (opts.animate) {
    // Tile-animation VRAM must overlay AFTER loadLevelGfx — it overwrites the
    // animated-tile slots the chunk-list interpreter filled, so reversing the
    // order leaves BG1 cells that reference animated tiles rendering garbage.
    loadTileAnimation(rom, symbols, {
      animationTileset: h[10] ?? 0, bg1Tileset: gfxHeader.bg1Tileset, levelMode: h[9] ?? 0
    }, vram)
  }
  loadLevelPalettes(rom, symbols, palHeader, cgram, provenance)
  applyPaletteEdits(cgram, provenance, opts.paletteEdits)
  return { vram, cgram, provenance, manifest, gfxHeader, palHeader }
}

