// The per-project YY-CHR pathway (the Graphics panel's YY-CHR tab). Unlike the
// dialog-picked extract folders, the whole-cart yychr track exports to ONE fixed
// folder inside the active project — `<projectRoot>/yychr/` — which the tab then
// browses in-editor: per-sheet details + change status (the same sha256 gate the
// import uses) + thumbnails rendered from the ON-DISK bytes (so external YY-CHR
// edits preview before import) + per-file/all import. The folder follows the
// active project and is deliberately NOT in the "Extracted folders" list (the tab
// owns it). Import goes through the same importYychrEntries → GfxImportReconciler
// → saveGfxEdit/saveRawChrEdit path as the generic folder import, so live preview
// + the gfx-live cache come along unchanged; afterwards the manifest checksum
// write-back advances each imported sheet's stored hash, so "changed" means
// "changed since export OR last import" instead of sticking forever.

import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { renderYychrSheetRgba, yychrColName, yychrPalName } from 'snes-framework/gfx-yychr'
import type {
  YychrProjectExportResult,
  YychrProjectFile,
  YychrProjectImportResult,
  YychrProjectState,
  YychrThumbnail,
  YychrThumbnailEntry
} from '../shared/ipc-types'
import { exportGfxPngsToDir } from './gfx-png-export'
import { changedSinceExport, fileChecksum, FileHashCache } from './gfx-import-conflict'
import { GfxImportReconciler } from './gfx-import-reconcile'
import { MANIFEST, readYychrManifest, updateManifestChecksums, type YychrManifestEntry, type YychrManifestFile } from './gfx-manifest'
import { importYychrEntries } from './gfx-yychr-io'
import { getCurrentProjectId } from './projects'
import { projectRoot } from './framework-paths'
import { loadRomAndSymbols } from './render/rom-cache'

/** The active project's dedicated yychr export folder. */
export function yychrProjectDir(projectId: string): string {
  return join(projectRoot(projectId), 'yychr')
}

// ── Caches ────────────────────────────────────────────────────────────────────
// A refresh sweeps the whole folder and a thumbnail pass touches every sheet
// (~110 files), and both re-run on every window focus — so the manifest is
// parsed once per on-disk version (mtime+size validated, with a per-file lookup
// map), and per-file hashes are stat-validated (FileHashCache: a focus refresh
// re-hashes only sheets whose bytes actually changed). Both self-invalidate via
// stat, so export / import write-back / project switch need no explicit hooks.

interface CachedManifest {
  value: YychrManifestFile | null
  byFile: Map<string, YychrManifestEntry>
}
let manifestCache: ({ path: string; mtimeMs: number; size: number } & CachedManifest) | null = null
const hashCache = new FileHashCache()

function cachedManifest(dir: string): CachedManifest {
  const p = join(dir, MANIFEST)
  let mtimeMs: number, size: number
  try {
    ;({ mtimeMs, size } = statSync(p))
  } catch {
    manifestCache = null
    return { value: null, byFile: new Map() }
  }
  if (manifestCache && manifestCache.path === p && manifestCache.mtimeMs === mtimeMs && manifestCache.size === size) {
    return manifestCache
  }
  const value = readYychrManifest(dir)
  manifestCache = { path: p, mtimeMs, size, value, byFile: new Map((value?.yychr ?? []).map((e) => [e.file, e])) }
  return manifestCache
}

/** Whole 8×8 tiles at the sheet's depth, for display. (`tileBytes` in a manifest
 *  row is the DIFF stride — 1 for raw rows — not the display geometry; a tile is
 *  `bpp` bytes per row × 8 rows at every depth, CPC included.) */
const displayTileBytes = (e: YychrManifestEntry): number => (e.kind === 'chr' ? e.tileBytes : e.bpp * 8)

/** The YY-CHR tab's whole view: manifest rows + per-file change status. Reads only
 *  the folder (no ROM), so it works before a first build. Cache-backed: after the
 *  first sweep, a refresh costs one stat per sheet (see the Caches block). */
export function buildYychrProjectState(): YychrProjectState {
  const id = getCurrentProjectId()
  if (!id) return { exported: false, dir: '', changedCount: 0, files: [] }
  const dir = yychrProjectDir(id)
  const manifest = cachedManifest(dir).value
  if (!manifest) return { exported: false, dir, changedCount: 0, files: [] }
  const files: YychrProjectFile[] = manifest.yychr.map((e) => {
    const st = hashCache.state(dir, e.file, manifest.checksums?.[e.file])
    return {
      file: e.file,
      category: e.file.split(/[\\/]/)[0] ?? '',
      description: e.description,
      kind: e.kind,
      format: e.format,
      bpp: e.bpp,
      sizeBytes: e.sizeBytes,
      tileCount: Math.ceil(e.sizeBytes / displayTileBytes(e)),
      status: st.status,
      hash: st.hash
    }
  })
  return { exported: true, dir, changedCount: files.filter((f) => f.status === 'changed').length, files }
}

/** Export the whole-cart yychr track into the project folder. The track's
 *  `gfxTrackFolder` mapping nests everything (sheets + sidecars + gfx-manifest +
 *  the track README) under `<projectRoot>/yychr/`; `skipRootReadme` keeps the
 *  extract-folder README out of the project root (this is not a user-picked
 *  extract folder). Deliberately NOT added to the "Extracted folders" list. */
export function exportYychrProject(): YychrProjectExportResult {
  const id = getCurrentProjectId()
  if (!id) return { ok: false, error: 'No active project.' }
  try {
    const { count } = exportGfxPngsToDir(null, projectRoot(id), { tracks: ['yychr'] }, { skipRootReadme: true })
    return { ok: true, count, dir: yychrProjectDir(id) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Import edited sheets from the project folder — `files` = folder-relative paths
 * for a per-file import, null = everything in the manifest. Same machinery as the
 * generic folder import (gate → importYychrEntries → one reconciler apply), plus
 * the checksum write-back that clears each imported/no-op sheet's changed status.
 */
export async function importYychrProject(files: string[] | null): Promise<YychrProjectImportResult> {
  const id = getCurrentProjectId()
  if (!id) return { ok: false, error: 'No active project.' }
  const dir = yychrProjectDir(id)
  const manifest = cachedManifest(dir).value
  if (!manifest) return { ok: false, error: 'No YY-CHR export in this project yet — export first.' }
  let wanted = manifest.yychr
  if (files) {
    const want = new Set(files)
    wanted = manifest.yychr.filter((e) => want.has(e.file))
    if (wanted.length !== want.size) {
      const known = new Set(wanted.map((e) => e.file))
      return { ok: false, error: `Not in this export's manifest: ${files.filter((f) => !known.has(f)).join(', ')}` }
    }
  }
  try {
    const { rom, symbols } = loadRomAndSymbols()
    // No baseline splices here (unlike importGfxPngsFromDir's placement/raw-bank
    // ROM copy): yychr chr bases come from the live gfx cache ?? the lz tables, and
    // the raw/chunky/1bpp bases are read overlay-first inside importYychrEntries —
    // nothing reads the placement regions or raw SuperFX banks out of `rom`.
    const gate = (relFile: string): 'missing' | 'unchanged' | 'changed' =>
      changedSinceExport(dir, relFile, manifest.checksums?.[relFile])
    const reconciler = new GfxImportReconciler()
    const counts = importYychrEntries(dir, wanted, gate, reconciler, rom, symbols)
    const applyRes = await reconciler.apply(rom, symbols)

    const log: string[] = []
    const plural = (n: number): string => (n === 1 ? '' : 's')
    if (counts.imported > 0) log.push(`${counts.imported} YY-CHR sheet${plural(counts.imported)} changed`)
    if (counts.skipped > 0) log.push(`${counts.skipped} unchanged`)
    if (counts.missing > 0) log.push(`${counts.missing} missing on disk`)
    if (applyRes.applied + applyRes.rawApplied > 0) {
      log.push(`Saved ${applyRes.applied} gfx file${plural(applyRes.applied)}, ${applyRes.rawApplied} raw sheet${plural(applyRes.rawApplied)}.`)
    }
    const errors = [...counts.errors, ...applyRes.conflicts]
    const warnings: string[] = []
    if (counts.padEdited > 0) {
      warnings.push(`${counts.padEdited} sheet${plural(counts.padEdited)} had edits past the sheet's end (bank padding) — those pixels were ignored.`)
    }

    // Checksum write-back: advance the stored hash for every sheet that imported or
    // proved byte-identical to base ⊕ live ('no-op'), so its status clears — UNLESS
    // the apply reported conflicts/save failures (they can't be attributed to one
    // sheet, so conservatively every status is kept; a re-import is idempotent).
    if (applyRes.conflicts.length === 0) {
      const updates: Record<string, string> = {}
      for (const o of counts.outcomes) {
        if (o.outcome !== 'imported' && o.outcome !== 'no-op') continue
        try {
          updates[o.file] = fileChecksum(readFileSync(join(dir, o.file)))
        } catch { /* unreadable now → keep the old hash (stays 'changed') */ }
      }
      if (!updateManifestChecksums(dir, updates)) {
        warnings.push('Couldn’t update the export manifest — imported sheets will still show as changed.')
      }
    } else if (counts.imported > 0) {
      warnings.push('Some edits were skipped — sheet statuses were left unchanged; fix and re-import.')
    }

    return { ok: true, dir, imported: counts.imported, outcomes: counts.outcomes, log, errors, warnings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Batch thumbnail render: one IPC round trip covers a chunk of sheets (the tab
 *  fetches the whole export after a first export), amortizing the manifest
 *  lookup; each entry renders independently (null thumb = no preview). */
export function yychrProjectThumbnails(files: string[]): YychrThumbnailEntry[] {
  return files.map((file) => ({ file, thumb: yychrProjectThumbnail(file) }))
}

/** Render one sheet's ON-DISK bytes to a thumbnail (renderYychrSheetRgba), colored
 *  by its `.pal`/`.col` sidecars. Null for the $BD Mode-7 tilemap (not pixel art),
 *  a missing/unlisted file, or a renderer-supplied path that escapes the folder. */
function yychrProjectThumbnail(file: string): YychrThumbnail | null {
  const id = getCurrentProjectId()
  if (!id) return null
  if (isAbsolute(file) || file.split(/[\\/]/).includes('..')) return null
  const dir = yychrProjectDir(id)
  const entry = cachedManifest(dir).byFile.get(file)
  if (!entry) return null
  const bpp = entry.bpp
  if (bpp === 8) return null
  const read = (p: string): Uint8Array | null => {
    try {
      return new Uint8Array(readFileSync(join(dir, p)))
    } catch {
      return null
    }
  }
  const sheet = read(file)
  if (!sheet) return null
  return renderYychrSheetRgba(
    sheet,
    { bpp, cpc: file.endsWith('.4bpp.gba'), sizeBytes: entry.sizeBytes, maxTiles: 256 },
    read(yychrPalName(file)),
    read(yychrColName(file))
  )
}
