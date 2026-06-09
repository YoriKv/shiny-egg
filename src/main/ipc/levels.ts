// Reader for the cart-derived levels catalog (editor-data/yi/levels.json),
// produced by extract.ts. Returns null if no extraction has happened yet —
// the renderer falls back to its bundled static catalog in that case.

import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { editorDataRoot } from '../framework-paths'
import { levelNameOverrides, levelRecordOverrides } from '../resources'
import type { LevelsCatalog } from 'snes-framework/types'

export function registerLevelsIpc(): void {
  ipcMain.handle('levels:catalog', async (): Promise<LevelsCatalog | null> => {
    const p = join(editorDataRoot(), 'levels.json')
    try {
      const text = await readFile(p, 'utf8')
      const cat = JSON.parse(text) as LevelsCatalog
      // IDs are hex strings on disc (`"0x43"`); parse back to the numeric
      // runtime contract. Tolerant of already-numeric ids (older extracts).
      for (const g of cat.groups)
        for (const l of g.levels) {
          const raw = (l as { recordId: number | string }).recordId
          if (typeof raw === 'string') l.recordId = parseInt(raw, 16)
        }
      // Overlay the project's current (imported / hand-edited) level names so the
      // dropdown reflects them without a rebuild. Matched by translevel slot; only
      // slots with a real name string are overridden (specials keep their name).
      const names = levelNameOverrides()
      if (names.size > 0)
        for (const g of cat.groups)
          for (const l of g.levels) {
            if (l.translevelId !== undefined && names.has(l.translevelId)) {
              l.name = names.get(l.translevelId)!
            }
          }
      // Overlay the world-map remap (entrance byte +0) so the dropdown loads the
      // record a tile now plays, without a rebuild. Same shape as the name overlay.
      const records = levelRecordOverrides()
      if (records.size > 0)
        for (const g of cat.groups)
          for (const l of g.levels) {
            if (l.translevelId !== undefined && records.has(l.translevelId)) {
              l.recordId = records.get(l.translevelId)!
            }
          }
      return cat
    } catch {
      return null
    }
  })
}
