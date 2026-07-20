// The per-project M1TE maps pathway (the Graphics panel's "M1TE Maps" tab) — the
// M1TE twin of gfx-yychr-project.ts. The cart-static `.M1` map surfaces (6 overworlds
// + the combined icons grid + the tilemap-based system screens) export to ONE fixed
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
import { importProjectFolder } from './gfx-project-folder'
import { FileHashCache } from './gfx-import-conflict'
import {
  MANIFEST,
  type GfxManifestChecksums,
  type MapM1Manifest,
  type ScreenM1ManifestEntry
} from './gfx-manifest'
import { getCurrentProjectId } from './projects'
import { projectRoot } from './framework-paths'

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
    else if (s.kind === 'storybook-intro') out.push({ file: s.file, category: 'storybook', description: 'Storybook intro (gm$38 prologue) — BG2 story frame + BG3 backdrop (black in the preview = transparency over the in-game level layer; the BG2 top half is an authored blank fill)' })
    else if (s.kind === 'bonus-game') out.push({ file: s.file, category: 'bonus', description: `Bonus game ${(s.game ?? 0) + 1} — BG1 + BG2 screens (the blank lower half IS shown during the board drop-in intro)` })
    else if (s.kind === 'minibattle') out.push({ file: s.file, category: 'bonus', description: 'Mini-battle score screen (BG3 HUD overlay — shared by every sub-mode using this tilemap)' })
    else if (s.kind === 'minibattle-playfield') out.push({ file: s.file, category: 'bonus', description: 'Mini-battle playfield (BG1 + BG2 upper half — shared by every sub-mode using this scene)' })
    else if (s.kind === 'minibattle-result') out.push({ file: s.file, category: 'bonus', description: `Mini-battle result screen — the ${s.result === 0 ? 'Yoshi' : 'Bandit'}-wins wallpaper (the result text is sprites)` })
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

/** Import edited `.M1`s from the project folder — the shared project-folder
 *  import (checksum gate + `only` filter + checksum write-back). */
export async function importM1teMapsProject(files: string[] | null): Promise<M1teMapsImportResult> {
  const id = getCurrentProjectId()
  if (!id) return { ok: false, error: 'No active project.' }
  const dir = m1teMapsDir(id)
  const manifest = readM1teManifest(dir)
  const rows = manifest ? manifestFiles(manifest) : []
  if (!manifest || rows.length === 0) return { ok: false, error: 'No M1TE export in this project yet — export first.' }
  return importProjectFolder(dir, new Set(rows.map((r) => r.file)), files)
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
