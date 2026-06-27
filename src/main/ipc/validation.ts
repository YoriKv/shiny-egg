// Validation IPC — the decode side of the Validation panel. The CHECK LOGIC
// lives renderer-side (src/renderer/src/lib/validation.ts), where the
// obj-metadata module + render-validity verdict libs already live. Main's only
// job is to run the object decoder (which it already does for rendering) and
// hand back the decode-derived signals the renderer can't compute itself:
// page-pool count/overflow, the abort flag, and the 128-byte screen→page map
// the item-memory check needs.
//
//   validation:signals(level)  — decode the (possibly-edited) current level.
//   validation:allLevels()     — level data + signals for every backed record,
//                                 for the all-levels sweep.

import { ipcMain } from 'electron'
import { decodeLevelById, decodeLevelFromLevelData } from 'snes-framework/object-decode'
import { loadLevel, loadLevelMapPublic } from 'snes-framework/level'
import type { LevelData, LevelDecodeSignals, LevelValidationInput } from 'snes-framework/types'
import { loadRomAndSymbols } from '../render/rom-cache'
import { frameworkWorkRoot, overlayRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'

function activeOverlayRoot(): string | undefined {
  const id = getCurrentProjectId()
  return id ? overlayRoot(id) : undefined
}

const NO_DECODE: LevelDecodeSignals = {
  decoded: false,
  screenPageMap: [],
  pageCount: 0,
  overflowed: false,
  aborted: false
}

function signalsFrom(decoded: ReturnType<typeof decodeLevelById>): LevelDecodeSignals {
  if (!decoded) return NO_DECODE
  return {
    decoded: true,
    screenPageMap: Array.from(decoded.state.screenPageMap),
    pageCount: decoded.state.pageCount,
    overflowed: decoded.stats.overflowed,
    aborted: decoded.stats.aborted
  }
}

export function registerValidationIpc(): void {
  // Decode signals for the live (edited) current level — uses the same override
  // decode path the canvas preview rides, so it validates UNSAVED edits.
  ipcMain.handle('validation:signals', async (_e, level: LevelData): Promise<LevelDecodeSignals> => {
    try {
      const { rom, symbols } = loadRomAndSymbols()
      const decoded = decodeLevelFromLevelData({
        rom,
        symbols,
        workRoot: frameworkWorkRoot(),
        levelData: level
      })
      return signalsFrom(decoded)
    } catch {
      // No build yet, or a decode failure — the renderer treats !decoded as
      // "decode-dependent checks skipped".
      return NO_DECODE
    }
  })

  // Level data + signals for every backed record. Decodes ~220 levels; the
  // renderer shows a spinner while this resolves.
  ipcMain.handle('validation:allLevels', async (): Promise<LevelValidationInput[]> => {
    const { rom, symbols } = loadRomAndSymbols()
    const workRoot = frameworkWorkRoot()
    const overlay = activeOverlayRoot()
    // Records entered from the world map (values of translevelToRecord) — fresh
    // item-memory sessions start here (the cross-level check roots on them).
    const rootSet = new Set<number>(
      Object.values(loadLevelMapPublic(workRoot).translevelToRecord).filter((r): r is number => r !== null)
    )
    const out: LevelValidationInput[] = []
    // Iterate record slots (the two sentinel rows 0xDA/0xDB and any unbacked
    // slot are skipped by the empty/special guard — same pattern as
    // resources.ts's per-record sweep).
    for (let rec = 0; rec <= 0xdb; rec++) {
      let level: LevelData
      try {
        level = loadLevel({ workRoot, levelRecordId: rec, overlayRoot: overlay })
      } catch {
        continue
      }
      if (level.empty || level.special || level.header.length < 15) continue
      let signals: LevelDecodeSignals
      try {
        signals = signalsFrom(decodeLevelById({ rom, symbols, workRoot, levelRecordId: rec, overlayRoot: overlay }))
      } catch {
        signals = NO_DECODE
      }
      out.push({ levelRecordId: rec, level, signals, isRoot: rootSet.has(rec) })
    }
    return out
  })
}
