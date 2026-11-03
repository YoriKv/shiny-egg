// ROM + symbol-map loader for the engine render IPC path. Loads the built ROM
// + WLA symbol map once at first request and caches them, re-reading when any
// artifact file's mtime changes (so a rebuild mid-session invalidates the cache
// automatically). Prefers the active project's build dir, falling back to the
// shared base build. Extracted from ipc/render.ts as a cohesive unit. (NOT the
// dev-side loadDevCart, which targets the fixed V1.0 build for engine tools.)
//
// Table previews: the returned ROM is the build with every fixed-size table in
// ROM_TABLE_PATCHES (snes-framework/scripts/rom-table-patches.ts) patched in,
// first from the project overlay (saved edits), then from the renderer's unsaved
// drafts (table-preview-cache.ts). So a table edit shows on every render
// without a rebuild. Two cache layers: the expensive build read (keyed on the
// artifact files) and cheap patched views keyed on the table BYTES they apply
// (so a save that rewrites the overlay without changing the bytes, or a draft
// cleared to the saved value, keeps the same view). Each new patched view gets a
// NEW `symbols` identity (same labels): every derived render cache keys on
// `symbols`, so a table change invalidates them exactly as a rebuild does.
//
// Two views: `loadRomAndSymbols` (saved + drafts, for anything that previews)
// and `loadSavedRomAndSymbols` (saved only, i.e. what the next build will
// hold, for code that writes a decision to disk or caches cart structure).

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mergeSymbolMaps, parseWlaSymbolMap, type SymbolMap } from 'snes-framework/symbol-map'
import { outputSfcName } from 'snes-framework/rom-versions'
import { readExtractionState } from 'snes-framework/state'
import { ROM_TABLE_PATCHES, applyRomTablePatch, type RomTablePatch } from 'snes-framework/rom-table-patches'
import { builtArtifactDir, frameworkWorkRoot, overlayRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'
import { tablePreviews } from '../table-preview-cache'

export interface RomCache {
  cartPath: string
  symPath: string
  fxSymPath: string
  cartMtime: number
  symMtime: number
  fxSymMtime: number
  rom: Uint8Array
  symbols: SymbolMap
}

/** The unpatched build read (rom + parsed symbols), keyed on the artifacts. */
let base: RomCache | null = null
/** The patched views handed to callers, keyed on `base` + the applied bytes. */
type PatchedView = { base: RomCache; patchKey: string; cache: RomCache }
const views: { live: PatchedView | null; saved: PatchedView | null } = { live: null, saved: null }
/** Saved-overlay table bytes, re-parsed only when the overlay file changes. */
const savedTables = new Map<string, { stamp: string; bytes: Uint8Array | null }>()

function resolveBuildPaths(): {
  cartPath: string
  symPath: string
  fxSymPath: string
  projectId: string | null
} {
  // Pick whichever rom version was most recently extracted/built. If no
  // extraction state yet, fall back to V1.0 (`YI_U1`).
  //
  // Prefer the active project's built ROM + .sym (projectBuildDir); fall back to
  // the shared base build when the project hasn't been built yet. Rendering
  // stays on the last build — the user rebuilds to refresh graphics/palette
  // edits. The mtime-keyed cache keys on the resolved path, so switching
  // projects (a different path) invalidates it automatically.
  const state = readExtractionState(frameworkWorkRoot())
  const version = state?.romVersion ?? 'YI_U1'
  const sfcName = outputSfcName(version)
  // outputSfcName returns "...(USA V1.0).sfc"; the .sym shares the base name.
  // The asar build also emits a separate "-superfx.sym" for FX-side labels
  // (bg_type_table, slope_panels_table, etc. — see snes-framework/scripts/
  // engine/collision.ts).
  const symName = sfcName.replace(/\.sfc$/i, '.sym')
  const fxSymName = sfcName.replace(/\.sfc$/i, '-superfx.sym')
  const projectId = getCurrentProjectId()
  const dir = builtArtifactDir(projectId, sfcName)
  return {
    cartPath: join(dir, sfcName),
    symPath: join(dir, symName),
    fxSymPath: join(dir, fxSymName),
    projectId
  }
}

/** The render ROM: the build with every ROM_TABLE_PATCHES table patched in
 *  (saved overlay, then unsaved drafts). What every render reads. */
export function loadRomAndSymbols(): RomCache {
  const { build, projectId } = loadBuild()
  return patchedView(build, projectId, 'live')
}

/** The build with SAVED table edits only (no unsaved drafts): what the next
 *  build will hold. For code that writes a ROM-derived decision to disk (GBA
 *  import's tileset pick) or caches cart structure for the session (the gfx
 *  role/size indexes). Never mutate the returned ROM. */
export function loadSavedRomAndSymbols(): RomCache {
  // No drafts ⇒ the live view IS the saved view; share it (one identity, so
  // symbols-keyed caches don't hold two copies).
  if (tablePreviews().size === 0) return loadRomAndSymbols()
  const { build, projectId } = loadBuild()
  return patchedView(build, projectId, 'saved')
}

/** Identifies the table bytes the live render ROM applies; changes iff a
 *  render could. `render:setTablePreview` compares it before/after. Doesn't read
 *  the build. */
export function liveTablesKey(): string {
  return tablesKey(effectiveTables(getCurrentProjectId(), 'live'))
}

function loadBuild(): { build: RomCache; projectId: string | null } {
  const paths = resolveBuildPaths()
  // Clear, actionable errors for the "no build yet / incomplete build" cases
  // instead of a raw ENOENT from statSync. (Atomic build promotes the .sfc +
  // .sym together, so a present .sfc with a missing .sym means a build from
  // before that landed, or a hand-deleted sym.)
  if (!existsSync(paths.cartPath)) {
    throw new Error(
      `No built ROM yet at ${paths.cartPath}. Extract the cart (Workshop → ROM → ` +
        `Extract) or build the project before rendering.`
    )
  }
  if (!existsSync(paths.symPath)) {
    throw new Error(
      `Built ROM has no symbol file (${paths.symPath}) — the build is incomplete; ` +
        `rebuild it.`
    )
  }
  const cartStat = statSync(paths.cartPath)
  const symStat = statSync(paths.symPath)
  // FX sym is optional — older builds may not produce it. statSync throws
  // on missing files, so guard explicitly.
  let fxSymMtime = 0
  try { fxSymMtime = statSync(paths.fxSymPath).mtimeMs } catch { /* missing fx sym */ }
  if (
    !base ||
    base.cartPath !== paths.cartPath ||
    base.symPath !== paths.symPath ||
    base.fxSymPath !== paths.fxSymPath ||
    base.cartMtime !== cartStat.mtimeMs ||
    base.symMtime !== symStat.mtimeMs ||
    base.fxSymMtime !== fxSymMtime
  ) {
    base = readBuild(paths, cartStat.mtimeMs, symStat.mtimeMs, fxSymMtime)
  }
  return { build: base, projectId: paths.projectId }
}

function readBuild(
  paths: { cartPath: string; symPath: string; fxSymPath: string },
  cartMtime: number,
  symMtime: number,
  fxSymMtime: number
): RomCache {
  const rom = new Uint8Array(readFileSync(paths.cartPath))
  const mainSym = parseWlaSymbolMap(readFileSync(paths.symPath, 'utf8'))
  let symbols = mainSym
  if (fxSymMtime > 0) {
    const fxSym = parseWlaSymbolMap(readFileSync(paths.fxSymPath, 'utf8'))
    symbols = mergeSymbolMaps(mainSym, fxSym)
  }
  return {
    cartPath: paths.cartPath,
    symPath: paths.symPath,
    fxSymPath: paths.fxSymPath,
    cartMtime,
    symMtime,
    fxSymMtime,
    rom,
    symbols
  }
}

/** A table's saved bytes from the project overlay, or null when the project
 *  has no overlay copy of its file (the build already holds the base table) or
 *  the copy predates the table's region. Cached per overlay-file stat. A
 *  malformed region is logged and skipped: it must not take down every render
 *  (the table's editor surfaces the parse error on load). */
function savedTableBytes(
  projectId: string | null,
  patch: RomTablePatch
): { stamp: string; bytes: Uint8Array | null } {
  if (!projectId) return { stamp: '', bytes: null }
  const file = join(overlayRoot(projectId), patch.file)
  if (!existsSync(file)) return { stamp: '', bytes: null }
  const st = statSync(file)
  const stamp = `${file}:${st.mtimeMs}/${st.ctimeMs}/${st.size}`
  const hit = savedTables.get(patch.kind)
  if (hit?.stamp === stamp) return hit
  let bytes: Uint8Array | null = null
  try {
    bytes = patch.fromAsm(readFileSync(file, 'utf8'))
  } catch (e) {
    console.warn(`[rom-cache] ${patch.kind} overlay table not applied: ${e instanceof Error ? e.message : String(e)}`)
  }
  const entry = { stamp, bytes }
  savedTables.set(patch.kind, entry)
  return entry
}

type EffectiveTable = { patch: RomTablePatch; bytes: Uint8Array | null }

/** Each registered table's bytes for a view: the draft (live view only), else
 *  the saved overlay table, else null (the build's own table stands). */
function effectiveTables(projectId: string | null, which: 'live' | 'saved'): EffectiveTable[] {
  const drafts = which === 'live' ? tablePreviews() : null
  return ROM_TABLE_PATCHES.map((patch) => ({
    patch,
    bytes: drafts?.get(patch.kind) ?? savedTableBytes(projectId, patch).bytes
  }))
}

function tablesKey(tables: EffectiveTable[]): string {
  return tables
    .map(({ patch, bytes }) => `${patch.kind}:${bytes ? Buffer.from(bytes).toString('base64') : '-'}`)
    .join('|')
}

function patchedView(build: RomCache, projectId: string | null, which: 'live' | 'saved'): RomCache {
  const tables = effectiveTables(projectId, which)
  const patchKey = tablesKey(tables)
  const prev = views[which]
  if (prev && prev.base === build && prev.patchKey === patchKey) return prev.cache
  const active = tables.filter((t): t is { patch: RomTablePatch; bytes: Uint8Array } => t.bytes !== null)
  let cache = build
  if (active.length > 0) {
    const rom = build.rom.slice()
    for (const { patch, bytes } of active) {
      try {
        applyRomTablePatch(rom, build.symbols, patch, bytes)
      } catch (e) {
        console.warn(`[rom-cache] ${patch.kind} table not applied: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // Fresh identity, same labels: invalidates the symbols-keyed render caches.
    cache = { ...build, rom, symbols: { ...build.symbols } }
  } else if (prev && prev.base === build) {
    // Patches just went away: the unpatched build still needs a new identity
    // if a patched view was handed out before.
    cache = { ...build, symbols: { ...build.symbols } }
  }
  views[which] = { base: build, patchKey, cache }
  return cache
}
