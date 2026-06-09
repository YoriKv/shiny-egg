// ROM + symbol-map loader for the engine render IPC path. Loads the built ROM
// + WLA symbol map once at first request and caches them, re-reading when any
// artifact file's mtime changes (so a rebuild mid-session invalidates the cache
// automatically). Prefers the active project’s build dir, falling back to the
// shared base build. Extracted from ipc/render.ts as a cohesive unit. (NOT the
// dev-side loadDevCart, which targets the fixed V1.0 build for engine tools.)

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mergeSymbolMaps, parseWlaSymbolMap, type SymbolMap } from 'snes-framework/symbol-map'
import { outputSfcName } from 'snes-framework/rom-versions'
import { readExtractionState } from 'snes-framework/state'
import { builtArtifactDir, frameworkWorkRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'

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

let cache: RomCache | null = null

function resolveBuildPaths(): { cartPath: string; symPath: string; fxSymPath: string } {
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
  const dir = builtArtifactDir(getCurrentProjectId(), sfcName)
  return {
    cartPath: join(dir, sfcName),
    symPath: join(dir, symName),
    fxSymPath: join(dir, fxSymName)
  }
}


export function loadRomAndSymbols(): RomCache {
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
    cache &&
    cache.cartPath === paths.cartPath &&
    cache.symPath === paths.symPath &&
    cache.fxSymPath === paths.fxSymPath &&
    cache.cartMtime === cartStat.mtimeMs &&
    cache.symMtime === symStat.mtimeMs &&
    cache.fxSymMtime === fxSymMtime
  ) {
    return cache
  }
  const rom = new Uint8Array(readFileSync(paths.cartPath))
  const mainSym = parseWlaSymbolMap(readFileSync(paths.symPath, 'utf8'))
  let symbols = mainSym
  if (fxSymMtime > 0) {
    const fxSym = parseWlaSymbolMap(readFileSync(paths.fxSymPath, 'utf8'))
    symbols = mergeSymbolMaps(mainSym, fxSym)
  }
  cache = {
    cartPath: paths.cartPath,
    symPath: paths.symPath,
    fxSymPath: paths.fxSymPath,
    cartMtime: cartStat.mtimeMs,
    symMtime: symStat.mtimeMs,
    fxSymMtime,
    rom,
    symbols
  }
  return cache
}
