// The per-project artwork pathway (the Graphics panel's "Misc Art" tab; 'artwork'
// stays the internal name + folder) — the
// PNG/Aseprite twin of gfx-yychr-project.ts / m1te-maps-project.ts. The four
// level-INDEPENDENT image tracks (world map, boot/story/title screens,
// the Raphael arena, the message font/pictures) export to ONE fixed folder
// inside the active project — `<projectRoot>/artwork/` — which the tab browses
// in-editor: per-file details + change status (the same sha256 gate the import
// uses) + thumbnails decoded from the ON-DISK bytes (so external edits preview
// before import) + per-file/all import via the shared project-folder importer.
// The export format (png | aseprite) is the tab's one option: PNG for any image
// editor (pixels only), Aseprite for the tilemap/layout surfaces — a re-export
// in the other format replaces the folder's files and manifest. (The
// level-DEPENDENT surfaces — BG regions, metasprites — stay on the
// Level BGs tab: they need the loaded level.)

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { decodePng } from 'snes-framework/png'
import { decodeAsepriteImage, decodeAsepriteRegion } from 'snes-framework/aseprite'
import type {
  ArtworkFormat,
  GfxProjectExportResult,
  GfxProjectImportResult,
  GfxProjectState,
  GfxProjectFile,
  YychrThumbnail,
  YychrThumbnailEntry
} from '../shared/ipc-types'
import { exportGfxPngsToDir } from './gfx-png-export'
import { importProjectFolder } from './gfx-project-folder'
import { FileHashCache } from './gfx-import-conflict'
import {
  MANIFEST,
  type BossArenaManifestEntry,
  type FontSheetManifestEntry,
  type GfxManifestChecksums,
  type GfxManifestEntry,
  type LevelIconManifestEntry,
  type MapIconManifestEntry,
  type StorybookSceneManifestEntry,
  type TitleIslandManifestEntry,
  type TitleLogoManifestEntry,
  type TitleSceneryManifestEntry
} from './gfx-manifest'
import { getCurrentProjectId } from './projects'
import { projectRoot } from './framework-paths'

/** The active project's dedicated artwork export folder. */
export function artworkDir(projectId: string): string {
  return join(projectRoot(projectId), 'artwork')
}

/** The level-independent image tracks the tab owns. */
const ARTWORK_TRACKS = ['worldmap', 'systemscreens', 'bosses', 'fonts'] as const

interface ArtworkManifestView {
  checksums?: GfxManifestChecksums
  entries?: GfxManifestEntry[]
  mapIcons?: MapIconManifestEntry[]
  levelIcons?: LevelIconManifestEntry[]
  bossArena?: BossArenaManifestEntry | null
  titleLogo?: TitleLogoManifestEntry | null
  titleIsland?: TitleIslandManifestEntry | null
  titleScenery?: TitleSceneryManifestEntry | null
  storybookScene?: StorybookSceneManifestEntry | null
  fonts?: FontSheetManifestEntry[] | null
}

function readArtworkManifest(dir: string): ArtworkManifestView | null {
  try {
    return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as ArtworkManifestView
  } catch {
    return null
  }
}

/** Grouping key from the file's natural export path. */
function categoryOf(file: string): string {
  const norm = file.replace(/\\/g, '/')
  if (norm.startsWith('screens/map/')) return 'map'
  if (norm.startsWith('screens/')) return norm.split('/')[1] ?? 'screens'
  return norm.split('/')[0] ?? ''
}

/** Manifest rows → the tab's flat file list (path + category + description). */
function manifestFiles(m: ArtworkManifestView): { file: string; category: string; description: string }[] {
  const out: { file: string; category: string; description: string }[] = []
  const push = (file: string | undefined, description: string): void => {
    if (file) out.push({ file, category: categoryOf(file), description })
  }
  for (const e of m.entries ?? []) push(e.file, e.description)
  for (const i of m.mapIcons ?? []) push(i.file, `World-map ${i.name} icon (shared across worlds)`)
  for (const i of m.levelIcons ?? []) push(i.file, `Level select picture — ${i.name}`)
  // NOT listed: the overworld terrain / ground-strip layout maps (`mapTerrain` /
  // `mapGround` in older manifests) — their layout editing lives in the M1TE Maps
  // overworld sessions, and the export no longer emits them.
  push(m.bossArena?.file, "Raphael's Mode-7 moon arena (layout — rearrange the 8×8 tiles)")
  push(m.titleLogo?.file, 'Title logo (assembled from the $1D char tiles)')
  push(m.titleIsland?.file, 'Title floating island (Mode-7 — pixels + placement + added tiles)')
  push(m.titleScenery?.file, 'Title scenery atlas (GSU 3D decorations — art only)')
  push(m.storybookScene?.file, 'Storybook first scene (BG3 frame — pixels only)')
  for (const f of m.fonts ?? []) push(f.file, `1bpp ${f.file.includes('picture') ? 'message-box pictures' : 'message font'} (2-color: paint on/off)`)
  return out
}

const hashCache = new FileHashCache()

/** Build the tab's whole view (called on mount / focus / after actions). */
export function buildArtworkState(): GfxProjectState {
  const id = getCurrentProjectId()
  if (!id) return { exported: false, dir: '', changedCount: 0, files: [] }
  const dir = artworkDir(id)
  const manifest = readArtworkManifest(dir)
  const rows = manifest ? manifestFiles(manifest) : []
  if (!manifest || rows.length === 0) return { exported: false, dir, changedCount: 0, files: [] }
  const files: GfxProjectFile[] = rows.map((r) => {
    const st = hashCache.state(dir, r.file, manifest.checksums?.[r.file])
    return { ...r, status: st.status, hash: st.hash }
  })
  return { exported: true, dir, changedCount: files.filter((f) => f.status === 'changed').length, files }
}

/** Export the four artwork tracks into `<projectRoot>/artwork/` in the chosen
 *  format. Single multi-track call → one flat manifest at the folder root (the
 *  same layout the state builder + shared importer read). */
export function exportArtworkProject(format: ArtworkFormat): GfxProjectExportResult {
  const id = getCurrentProjectId()
  if (!id) return { ok: false, error: 'No active project.' }
  try {
    const dir = artworkDir(id)
    const { count } = exportGfxPngsToDir(null, dir, { tracks: [...ARTWORK_TRACKS], format }, { skipRootReadme: true })
    return { ok: true, count, dir }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Import edited files from the project folder — the shared project-folder
 *  import (checksum gate + `only` filter + checksum write-back). */
export async function importArtworkProject(files: string[] | null): Promise<GfxProjectImportResult> {
  const id = getCurrentProjectId()
  if (!id) return { ok: false, error: 'No active project.' }
  const dir = artworkDir(id)
  const manifest = readArtworkManifest(dir)
  const rows = manifest ? manifestFiles(manifest) : []
  if (!manifest || rows.length === 0) return { ok: false, error: 'No Misc Art export in this project yet — export first.' }
  return importProjectFolder(dir, new Set(rows.map((r) => r.file)), files)
}

/** Longest thumbnail edge sent over IPC — bigger images downscale (nearest). */
const THUMB_MAX = 512

function toThumb(rgba: Uint8Array, width: number, height: number): YychrThumbnail {
  const scale = Math.max(width, height) > THUMB_MAX ? THUMB_MAX / Math.max(width, height) : 1
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  let out = rgba
  if (scale !== 1) {
    out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      const sy = Math.min(height - 1, Math.floor(y / scale))
      for (let x = 0; x < w; x++) {
        const sx = Math.min(width - 1, Math.floor(x / scale))
        const s = (sy * width + sx) * 4
        const d = (y * w + x) * 4
        out[d] = rgba[s]!
        out[d + 1] = rgba[s + 1]!
        out[d + 2] = rgba[s + 2]!
        out[d + 3] = rgba[s + 3]!
      }
    }
  }
  const cells = (w >> 3) * (h >> 3)
  return { rgba: out, width: w, height: h, renderedTiles: cells, totalTiles: cells }
}

/** Batch thumbnail render from the ON-DISK bytes (external edits preview before
 *  import): PNGs decode directly, `.aseprite` files flatten to RGBA. Null =
 *  missing/invalid/path-escape. */
export function artworkThumbnails(files: string[]): YychrThumbnailEntry[] {
  const id = getCurrentProjectId()
  if (!id) return files.map((file) => ({ file, thumb: null }))
  const dir = artworkDir(id)
  return files.map((file) => {
    try {
      if (isAbsolute(file)) return { file, thumb: null }
      const p = resolve(dir, file)
      if (!p.startsWith(resolve(dir) + sep)) return { file, thumb: null } // path escapes the folder
      if (!existsSync(p)) return { file, thumb: null }
      const bytes = readFileSync(p)
      if (file.toLowerCase().endsWith('.aseprite')) {
        // Tilemap projects flatten via the region decode; single-image projects
        // (scenery atlas, fonts) have no tilemap cel, so fall back to the image decode.
        let img: { width: number; height: number; rgba: Uint8Array }
        try {
          img = decodeAsepriteRegion(new Uint8Array(bytes))
        } catch {
          img = decodeAsepriteImage(new Uint8Array(bytes))
        }
        return { file, thumb: toThumb(img.rgba, img.width, img.height) }
      }
      const img = decodePng(bytes)
      return { file, thumb: toThumb(img.rgba, img.width, img.height) }
    } catch {
      return { file, thumb: null }
    }
  })
}
