// Shared skeleton for the FIXED project-folder graphics pathways (the Graphics
// panel's M1TE Maps + Misc Art tabs; the YY-CHR tab predates it and keeps its own
// specialized importer). One folder per surface set inside the active project,
// browsed in-editor with per-file change status; import rides the standard
// folder importer (checksum gate + `only` filter) and finishes with the
// checksum write-back that makes "changed" mean "changed since export OR last
// import". Each tab supplies its folder + manifest row enumeration; this module
// owns the import/apply/log/write-back flow they'd otherwise duplicate.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GfxProjectImportResult } from '../shared/ipc-types'
import { importGfxPngsFromDir } from './gfx-png-import'
import { gfxResultToLog } from './graphics-folder-io'
import { fileChecksum } from './gfx-import-conflict'
import { GfxImportReconciler } from './gfx-import-reconcile'
import { updateManifestChecksums } from './gfx-manifest'
import { loadRomAndSymbols } from './render/rom-cache'

/**
 * Import edited files from a project folder — `files` = folder-relative paths
 * for a per-file import, null = everything in `known`. The standard folder
 * importer does the work; afterwards the stored checksum advances for every
 * requested file that imported cleanly (not named in an error), so its status
 * clears — conservative on failures, and a re-import is idempotent either way.
 */
export async function importProjectFolder(
  dir: string,
  known: ReadonlySet<string>,
  files: string[] | null
): Promise<GfxProjectImportResult> {
  if (files) {
    const unknown = files.filter((f) => !known.has(f))
    if (unknown.length > 0) return { ok: false, error: `Not in this export's manifest: ${unknown.join(', ')}` }
  }
  try {
    const reconciler = new GfxImportReconciler()
    const counts = await importGfxPngsFromDir(dir, reconciler, { only: files ? new Set(files) : new Set(known) })
    const { rom, symbols } = loadRomAndSymbols()
    const applyRes = await reconciler.apply(rom, symbols)

    const g = gfxResultToLog(counts)
    const log = [...g.log]
    if (applyRes.applied + applyRes.paletteChanged + applyRes.rawApplied > 0) {
      log.push(
        `Saved ${applyRes.applied} gfx file${applyRes.applied === 1 ? '' : 's'}, ${applyRes.paletteChanged} palette color${applyRes.paletteChanged === 1 ? '' : 's'}, ${applyRes.rawApplied} raw sheet${applyRes.rawApplied === 1 ? '' : 's'}.`
      )
    }
    const errors = [...g.errors]
    if (applyRes.conflicts.length > 0) {
      errors.push(
        `${applyRes.conflicts.length} edit${applyRes.conflicts.length === 1 ? '' : 's'} skipped — two files changed the same data differently:`,
        ...applyRes.conflicts.map((c) => `  ${c}`)
      )
    }
    const warnings = [...g.warnings]
    const changed = g.changed + applyRes.applied + applyRes.paletteChanged + applyRes.rawApplied

    // Checksum write-back: advance the stored hash for every requested file that
    // wasn't named in an error, so its status clears (imported OR proved
    // unchanged). A file an error mentions keeps its old hash — it stays
    // 'changed' for a fix-and-re-import.
    const wanted = files ?? [...known]
    const updates: Record<string, string> = {}
    for (const f of wanted) {
      if (errors.some((e) => e.includes(f))) continue
      try {
        updates[f] = fileChecksum(readFileSync(join(dir, f)))
      } catch {
        /* missing on disk → keep the old hash (stays 'missing') */
      }
    }
    if (!updateManifestChecksums(dir, updates)) {
      warnings.push('Couldn’t update the export manifest — imported files will still show as changed.')
    }

    return { ok: true, dir, changed, log, errors, warnings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
