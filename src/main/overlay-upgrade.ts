// Outdated-overlay checker (research task 2). A project stores edits as a sparse
// overlay of full `.asm` file copies with `;@editable:<id>` regions spliced in.
// When the editor's base `.asm` later changes — code fixed OUTSIDE the regions,
// or a NEW region added (e.g. the message-pointer table) — the overlay's frozen
// copy drifts. This module detects that drift and computes an upgrade: start from
// the fresh base (adopting every out-of-region change + new region), then
// re-splice back ONLY the regions the user genuinely edited. The per-region
// edit test is semantic (resources.ts `regionUserEdited`) so a region that's
// merely frozen-stale base — not actually edited — is refreshed to base rather
// than wrongly "preserved" (this is what restores e.g. message friendly-aliases).
//
// The four inline-`dw` data editors (palette / island / gradient in Bank57.asm,
// logo in Bank0F.asm) now wrap their blocks in `;@editable` regions too, so they
// participate in the drift check like any string region. Projects created BEFORE
// those markers existed carry marker-less overlays, so `migrateInlineDataOverlays`
// (run before every detect/upgrade) rebuilds them = base ⊕ edits-read-from-the-old-
// overlay, in the marker format — otherwise the freshly-added base regions would
// read as drift and an "upgrade" would wipe those edits. Per-file confirm + a
// "duplicate as a backup project" step live in the IPC/renderer layer.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listEditableRegionIds } from 'snes-framework/markers'
import { computeOverlayUpgrade } from 'snes-framework/overlay-merge'
import { DATA_OVERLAY_EDITORS } from 'snes-framework/overlay-data-editors'
import { frameworkWorkRoot, overlayRoot, writeFileAtomicSync } from './framework-paths'
import { projectModifiedFiles } from './projects'
import { regionUserEdited } from './resources'
import type {
  OverlayDriftFile,
  OverlayDriftReport,
  OverlayUpgradeResult
} from '../shared/ipc-types'

/** Overlay `.asm` files that participate in the drift check: marker-based files
 *  whose base copy still exists. Yields `{ rel, basePath, overlayPath }`. */
function* candidateOverlayFiles(
  projectId: string
): Generator<{ rel: string; basePath: string; overlayPath: string }> {
  for (const rel of projectModifiedFiles(projectId)) {
    if (!rel.endsWith('.asm')) continue
    const basePath = join(frameworkWorkRoot(), rel)
    const overlayPath = join(overlayRoot(projectId), rel)
    if (existsSync(basePath) && existsSync(overlayPath)) yield { rel, basePath, overlayPath }
  }
}

/**
 * One-time, idempotent migration of pre-region overlays for the inline-`dw` data
 * editors (the `DATA_OVERLAY_EDITORS` registry). Older projects' Bank57.asm /
 * Bank0F.asm overlays predate the `;@editable` markers around the palette /
 * island / gradient / logo blocks, so their edits sit outside any region. Left
 * alone, the freshly-added base regions read as drift and an "upgrade" would
 * discard those edits. This rebuilds each such overlay = fresh base ⊕ (edit sets
 * read back from the old overlay) in the marker format — byte-for-byte what a
 * current save produces. Idempotent (skips an overlay that already carries every
 * required region) and defensive (any failure leaves the file untouched rather
 * than half-migrated). Runs before every detect/upgrade so neither wipe entry
 * point can fire on an un-migrated file.
 */
export function migrateInlineDataOverlays(projectId: string): void {
  const readBase = (rel: string): string => readFileSync(join(frameworkWorkRoot(), rel), 'utf8')
  for (const ed of DATA_OVERLAY_EDITORS) {
    const overlayPath = join(overlayRoot(projectId), ed.file)
    if (!existsSync(overlayPath)) continue
    try {
      const overlayText = readFileSync(overlayPath, 'utf8')
      const have = new Set(listEditableRegionIds(overlayText))
      if (ed.regions.every((id) => have.has(id))) continue // already migrated
      const rebuilt = ed.rebuild(overlayText, readBase)
      if (rebuilt !== overlayText) writeFileAtomicSync(overlayPath, rebuilt)
    } catch {
      // A still-drifting overlay is recoverable on a later run; a corrupt one is
      // not. Leave it untouched and let the (now-safe) detect report it.
    }
  }
}

/**
 * Scan a project's overlay `.asm` files for drift against the current base.
 * Skips non-marker files (no `;@editable` regions) so they're never rewritten
 * from base. Migrates pre-region data overlays first so they don't false-drift.
 * Cheap enough to run on every project launch.
 */
export function detectOutdatedOverlays(projectId: string): OverlayDriftReport {
  migrateInlineDataOverlays(projectId)
  const files: OverlayDriftFile[] = []
  for (const { rel, basePath, overlayPath } of candidateOverlayFiles(projectId)) {
    const baseText = readFileSync(basePath, 'utf8')
    if (listEditableRegionIds(baseText).length === 0) continue // not a region-based overlay
    const overlayText = readFileSync(overlayPath, 'utf8')
    const up = computeOverlayUpgrade(baseText, overlayText, (id) =>
      regionUserEdited(id, baseText, overlayText)
    )
    if (up.changed) {
      files.push({
        file: rel,
        editsPreserved: up.editsPreserved,
        regionsAdded: up.regionsAdded,
        regionsDropped: up.regionsDropped
      })
    }
  }
  return { files }
}

/**
 * Apply the upgrade to the requested overlay files, recomputing the merge from
 * disk (never trusting a renderer-supplied blob) so it's race-free. Each file is
 * rewritten in place; on the first failure returns `{ ok:false }` with the files
 * upgraded so far. The caller has already prompted for a backup.
 */
export function applyOverlayUpgrades(projectId: string, relFiles: string[]): OverlayUpgradeResult {
  migrateInlineDataOverlays(projectId) // defensive: never adopt-base over an un-migrated inline overlay
  const want = new Set(relFiles)
  const upgraded: string[] = []
  for (const { rel, basePath, overlayPath } of candidateOverlayFiles(projectId)) {
    if (!want.has(rel)) continue
    try {
      const baseText = readFileSync(basePath, 'utf8')
      if (listEditableRegionIds(baseText).length === 0) continue
      const overlayText = readFileSync(overlayPath, 'utf8')
      const up = computeOverlayUpgrade(baseText, overlayText, (id) =>
        regionUserEdited(id, baseText, overlayText)
      )
      if (!up.changed) continue
      writeFileAtomicSync(overlayPath, up.upgraded)
      upgraded.push(rel)
    } catch (err) {
      return { ok: false, error: `${rel}: ${(err as Error).message}`, upgraded }
    }
  }
  return { ok: true, upgraded }
}
