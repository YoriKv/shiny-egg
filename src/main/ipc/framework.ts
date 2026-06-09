// IPC handlers for the framework pipeline — cart identification, extraction
// state, extract, and build. The generic editable-resource dispatch (editor:*)
// lives in ipc/editor.ts. Registered once from main/index.

import { BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { buildRom, type BuildResult } from 'snes-framework/build'
import { extractAssets, type ExtractResult } from 'snes-framework/extract'
import { invalidateLevelMapCache } from 'snes-framework/level'
import { identifyByMd5 } from 'snes-framework/rom-versions'
import { stripCopierHeader } from 'snes-framework/rom-header'
import { readExtractionState, type ExtractionState } from 'snes-framework/state'
import { asarBinPath, devReferenceCartPath, frameworkWorkRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'
import { buildProject } from '../build-tree'
import { getBizHawk } from '../bizhawk'
import { checkActivePoolBudgets, poolViolationMessage } from '../resources'
import type { CartIdentification, FrameworkExtractArgs } from '../../shared/ipc-types'

export function registerFrameworkIpc(): void {
  ipcMain.handle(
    'framework:identifyCart',
    async (_event, cartPath: string): Promise<CartIdentification> => {
      // Strip an external 512-byte copier header (if present) so a headered dump
      // identifies by the same MD5 as its unheadered form. See rom-header.ts.
      const buf = stripCopierHeader(await readFile(cartPath))
      const md5 = createHash('md5').update(buf).digest('hex')
      const romVersion = identifyByMd5(md5)
      return { path: cartPath, md5, romVersion, supported: romVersion !== null }
    }
  )

  ipcMain.handle(
    'framework:state',
    async (): Promise<ExtractionState | null> =>
      readExtractionState(frameworkWorkRoot())
  )

  // Dev-only: the pre-selectable reference cart next to the project root, so the
  // extract UI doesn't make us re-browse for it each run. null in packaged builds.
  ipcMain.handle(
    'framework:devReferenceCart',
    async (): Promise<string | null> => devReferenceCartPath()
  )

  ipcMain.handle(
    'framework:extract',
    async (event, args: FrameworkExtractArgs): Promise<ExtractResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await extractAssets({
        workRoot: frameworkWorkRoot(),
        asarBin: asarBinPath(),
        romVersion: args.romVersion,
        referenceCartPath: args.referenceCartPath,
        onProgress: (msg) => win?.webContents.send('framework:progress', msg)
      })
      // A fresh extract rewrites level-map.json — drop any cached copy.
      invalidateLevelMapCache()
      // Build a pristine reference ROM into the base build dir (no overlay).
      // It's a known-good baseline AND the fallback render/BizHawk read for
      // projects that haven't been built yet. Best-effort: a build failure is
      // logged but doesn't fail the (already-completed) extract.
      try {
        win?.webContents.send('framework:progress', 'Building reference ROM…')
        buildRom({
          workRoot: frameworkWorkRoot(),
          asarBin: asarBinPath(),
          onProgress: (msg) => win?.webContents.send('framework:progress', msg)
        })
        win?.webContents.send('framework:progress', 'Reference ROM built.')
      } catch (err) {
        win?.webContents.send(
          'framework:progress',
          `Reference build failed: ${(err as Error).message}`
        )
      }
      return result
    }
  )

  ipcMain.handle(
    'framework:build',
    async (event): Promise<BuildResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const projectId = getCurrentProjectId()
      const onProgress = (msg: string): void => {
        win?.webContents.send('framework:progress', msg)
      }
      // Pre-build budget gate (task #14). Saved overlay streams may exceed a
      // shared bank pool; building them would trip the asar boundary assert and
      // fail the build. Refuse with an actionable message first (the asar error
      // is cryptic). The renderer also gates Test Level on the same signal
      // (build-scope blocker); this is the defense-in-depth backstop (covers
      // Launch too). The build itself is now atomic (build.ts) — a failure here
      // would leave the previous good ROM intact regardless — but the friendly
      // pre-check still beats showing the raw asar assert.
      const violations = checkActivePoolBudgets()
      if (violations.length > 0) {
        const msg = poolViolationMessage(violations)
        onProgress(`Build blocked: ${msg}`)
        throw new Error(msg)
      }
      // With an active project, build through the project pipeline (data-only
      // include fast path, or build-tree merge when the overlay has asm edits).
      const result = projectId
        ? buildProject({ id: projectId, onProgress })
        : buildRom({ workRoot: frameworkWorkRoot(), asarBin: asarBinPath(), onProgress })
      // Build produced a new ROM. If BizHawk is already running it's holding the
      // OLD ROM in memory (no auto-reload). Stop it so the next manual Launch
      // picks up the new file.
      if (getBizHawk().isRunning()) {
        win?.webContents.send('framework:progress', 'Stopping BizHawk to release old ROM…')
        getBizHawk().stop()
      }
      return result
    }
  )
}
