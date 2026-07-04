// The per-project M1TE maps pathway (the Graphics panel's "M1TE Maps" tab) — the
// M1TE twin of gfx-yychr-project.ts. The cart-static `.M1` map surfaces (6 overworlds
// + the combined icons grid + the 9 tilemap-based system screens) export to ONE fixed
// folder inside the active project — `<projectRoot>/m1te/` — which the tab browses
// in-editor: per-file details + change status (the same sha256 gate the import uses) +
// thumbnails composed from the ON-DISK `.M1` bytes (so external M1TE edits preview
// before import) + per-file/all import. Export/import both ride the standard
// gfx-manifest machinery (`exportGfxPngsToDir` / `importGfxPngsFromDir` in m1te2
// format — a two-track call, so the manifest lands flat at the folder root); the
// import's `only` filter gives the per-file button, and the checksum write-back
// advances each cleanly-imported file's stored hash so "changed" means "changed
// since export OR last import". (The per-LEVEL BG-layer `.M1`s stay on the
// Extract/Import tab — they need a loaded level.)

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { parseM1te2, renderM1te2Rgba } from 'snes-framework/m1te2'
import type {
  M1teMapsExportResult,
  M1teMapsFile,
  M1teMapsImportResult,
  M1teMapsState,
  YychrThumbnailEntry
} from '../shared/ipc-types'
import { exportGfxPngsToDir } from './gfx-png-export'
import { importGfxPngsFromDir } from './gfx-png-import'
import { gfxResultToLog } from './graphics-folder-io'
import { FileHashCache, fileChecksum } from './gfx-import-conflict'
import { GfxImportReconciler } from './gfx-import-reconcile'
import {
  MANIFEST,
  updateManifestChecksums,
  type GfxManifestChecksums,
  type MapM1Manifest,
  type ScreenM1ManifestEntry
} from './gfx-manifest'
import { getCurrentProjectId } from './projects'
import { projectRoot } from './framework-paths'
import { loadRomAndSymbols } from './render/rom-cache'

/** The active project's dedicated m1te export folder. */
export function m1teMapsDir(projectId: string): string {
  return join(projectRoot(projectId), 'm1te')
}

/** The two tracks whose m1te2-format export IS the fixed `.M1` map set. */
const M1TE_TRACKS = ['worldmap', 'systemscreens'] as const

interface M1teManifestView {
  checksums?: GfxManifestChecksums
  mapM1?: MapM1Manifest | null
  screenM1?: ScreenM1ManifestEntry[] | null
}

function readM1teManifest(dir: string): M1teManifestView | null {
  try {
    return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as M1teManifestView
  } catch {
    return null
  }
}

/** Manifest rows → the tab's flat file list (path + category + description). */
function manifestFiles(m: M1teManifestView): { file: string; category: string; description: string }[] {
  const out: { file: string; category: string; description: string }[] = []
  for (const ov of m.mapM1?.overworlds ?? []) {
    out.push({ file: ov.file, category: 'map', description: `World ${ov.world + 1} overworld — BG1 + BG2 tilemaps + the shared BG3 ground` })
  }
  if (m.mapM1?.icons) {
    out.push({ file: m.mapM1.icons.file, category: 'map', description: 'Level icons — every world in level order, + the marker / boss-castle shapes' })
  }
  for (const s of m.screenM1 ?? []) {
    if (s.kind === 'island') out.push({ file: s.file, category: 'title', description: 'Title screen — the floating island (Mode-7)' })
    else if (s.kind === 'storybook-scene') out.push({ file: s.file, category: 'storybook', description: 'Storybook first scene (BG3 frame — pixels only; the frame layout is runtime-streamed)' })
    else if (s.kind === 'bonus-game') out.push({ file: s.file, category: 'bonus', description: `Bonus game ${(s.game ?? 0) + 1} — BG1 + BG2 screens` })
    else out.push({ file: s.file, category: 'bonus', description: 'Shared bonus-game backdrop (BG3, 16×16 tiles — edits show in all six games)' })
  }
  return out
}

const hashCache = new FileHashCache()

/** Build the tab's whole view (called on mount / focus / after actions). */
export function buildM1teMapsState(): M1teMapsState {
  const id = getCurrentProjectId()
  if (!id) return { exported: false, dir: '', changedCount: 0, files: [] }
  const dir = m1teMapsDir(id)
  const manifest = readM1teManifest(dir)
  const rows = manifest ? manifestFiles(manifest) : []
  if (!manifest || rows.length === 0) return { exported: false, dir, changedCount: 0, files: [] }
  const files: M1teMapsFile[] = rows.map((r) => {
    const st = hashCache.state(dir, r.file, manifest.checksums?.[r.file])
    return { ...r, status: st.status, hash: st.hash }
  })
  return { exported: true, dir, changedCount: files.filter((f) => f.status === 'changed').length, files }
}

/** Export every fixed `.M1` map surface into `<projectRoot>/m1te/`. Single-manifest:
 *  the two-track call keeps the legacy flat layout (manifest at the folder root). */
export function exportM1teMapsProject(): M1teMapsExportResult {
  const id = getCurrentProjectId()
  if (!id) return { ok: false, error: 'No active project.' }
  try {
    const dir = m1teMapsDir(id)
    const { count } = exportGfxPngsToDir(null, dir, { tracks: [...M1TE_TRACKS], format: 'm1te2' }, { skipRootReadme: true })
    return { ok: true, count, dir }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Import edited `.M1`s from the project folder — `files` = folder-relative paths for a
 * per-file import, null = everything changed. The standard folder importer does the
 * work (checksum gate + the `only` filter); afterwards the stored checksum advances
 * for every requested file that imported cleanly (not named in an error), so its
 * status clears — conservative on failures, and a re-import is idempotent either way.
 */
export async function importM1teMapsProject(files: string[] | null): Promise<M1teMapsImportResult> {
  const id = getCurrentProjectId()
  if (!id) return { ok: false, error: 'No active project.' }
  const dir = m1teMapsDir(id)
  const manifest = readM1teManifest(dir)
  const rows = manifest ? manifestFiles(manifest) : []
  if (!manifest || rows.length === 0) return { ok: false, error: 'No M1TE export in this project yet — export first.' }
  const known = new Set(rows.map((r) => r.file))
  if (files) {
    const unknown = files.filter((f) => !known.has(f))
    if (unknown.length > 0) return { ok: false, error: `Not in this export's manifest: ${unknown.join(', ')}` }
  }
  try {
    const reconciler = new GfxImportReconciler()
    const counts = await importGfxPngsFromDir(dir, reconciler, { only: files ? new Set(files) : known })
    const { rom, symbols } = loadRomAndSymbols()
    const applyRes = await reconciler.apply(rom, symbols)

    const g = gfxResultToLog(counts)
    const log = [...g.log]
    if (applyRes.applied + applyRes.paletteChanged + applyRes.rawApplied > 0) {
      log.push(`Saved ${applyRes.applied} gfx file${applyRes.applied === 1 ? '' : 's'}, ${applyRes.paletteChanged} palette color${applyRes.paletteChanged === 1 ? '' : 's'}, ${applyRes.rawApplied} raw sheet${applyRes.rawApplied === 1 ? '' : 's'}.`)
    }
    const errors = [...g.errors]
    if (applyRes.conflicts.length > 0) {
      errors.push(`${applyRes.conflicts.length} edit${applyRes.conflicts.length === 1 ? '' : 's'} skipped — two files changed the same data differently:`, ...applyRes.conflicts.map((c) => `  ${c}`))
    }
    const warnings = [...g.warnings]
    const changed = g.changed + applyRes.applied + applyRes.paletteChanged + applyRes.rawApplied

    // Checksum write-back: advance the stored hash for every requested file that wasn't
    // named in an error, so its status clears (imported OR proved unchanged). A file an
    // error mentions keeps its old hash — it stays 'changed' for a fix-and-re-import.
    const wanted = files ?? [...known]
    const updates: Record<string, string> = {}
    for (const f of wanted) {
      if (errors.some((e) => e.includes(f))) continue
      try {
        updates[f] = fileChecksum(readFileSync(join(dir, f)))
      } catch { /* missing on disk → keep the old hash (stays 'missing') */ }
    }
    if (!updateManifestChecksums(dir, updates)) {
      warnings.push('Couldn’t update the export manifest — imported files will still show as changed.')
    }

    return { ok: true, dir, changed, log, errors, warnings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Batch thumbnail render from the ON-DISK `.M1` bytes (external M1TE edits preview
 *  before import). Reuses the yychr thumbnail entry shape; null = missing/invalid. */
export function m1teMapsThumbnails(files: string[]): YychrThumbnailEntry[] {
  const id = getCurrentProjectId()
  if (!id) return files.map((file) => ({ file, thumb: null }))
  const dir = m1teMapsDir(id)
  return files.map((file) => {
    try {
      if (isAbsolute(file)) return { file, thumb: null }
      const p = resolve(dir, file)
      if (!p.startsWith(resolve(dir) + sep)) return { file, thumb: null } // path escapes the folder
      if (!existsSync(p)) return { file, thumb: null }
      const view = renderM1te2Rgba(parseM1te2(new Uint8Array(readFileSync(p))))
      const cells = (view.width >> 3) * (view.height >> 3)
      return { file, thumb: { rgba: view.rgba, width: view.width, height: view.height, renderedTiles: cells, totalTiles: cells } }
    } catch {
      return { file, thumb: null }
    }
  })
}
