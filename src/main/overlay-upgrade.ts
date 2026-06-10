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
// Non-marker overlays (the palette Bank57.asm, whose edits are inline `dw`s with
// no region boundary) are excluded — rewriting them from base would wipe the
// edits. Per-file confirm + a "duplicate as a backup project" step live in the
// IPC/renderer layer.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listEditableRegionIds } from 'snes-framework/markers'
import { computeOverlayUpgrade } from 'snes-framework/overlay-merge'
import { frameworkWorkRoot, overlayRoot } from './framework-paths'
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
 * Scan a project's overlay `.asm` files for drift against the current base.
 * Skips non-marker files (no `;@editable` regions — e.g. the inline-edited
 * palette overlay) so they're never rewritten from base. Cheap enough to run on
 * every project launch.
 */
export function detectOutdatedOverlays(projectId: string): OverlayDriftReport {
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

/** Atomic write (tmp + rename) so a crash mid-write can't leave a half-written
 *  overlay file. */
function writeFileAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

/**
 * Apply the upgrade to the requested overlay files, recomputing the merge from
 * disk (never trusting a renderer-supplied blob) so it's race-free. Each file is
 * rewritten in place; on the first failure returns `{ ok:false }` with the files
 * upgraded so far. The caller has already prompted for a backup.
 */
export function applyOverlayUpgrades(projectId: string, relFiles: string[]): OverlayUpgradeResult {
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
      writeFileAtomic(overlayPath, up.upgraded)
      upgraded.push(rel)
    } catch (err) {
      return { ok: false, error: `${rel}: ${(err as Error).message}`, upgraded }
    }
  }
  return { ok: true, upgraded }
}
