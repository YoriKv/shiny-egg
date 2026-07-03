// Reader for the cart-derived levels catalog (editor-data/yi/levels.json),
// produced by extract.ts. Returns null if no extraction has happened yet —
// the renderer falls back to its bundled static catalog in that case.

import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { editorDataRoot, overlayRoot } from '../framework-paths'
import { levelNameOverrides, levelRecordOverrides } from '../resources'
import { getCurrentProjectId, getProjectNewSlots, getProjectRemovedLevels } from '../projects'
import type { LevelsCatalog } from 'snes-framework/types'
import { LEVEL_RECORD_COUNT } from 'snes-framework/extract'

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
      // Surface the project's NEW-SLOT levels (sentinel rows 0xDA/0xDB given
      // real data by a ROM import). The baked catalog can't know them (they're
      // per-project overlay state), so append them to "Unused Rooms" at read
      // time — unless a world-map slot already claims the record (then it's in
      // a world group via the record overlay above). Gated on the overlay obj
      // .bin actually existing, mirroring loadLevel's synthetic-entry marker.
      const projectId = getCurrentProjectId()
      // Drop REMOVED records from every group (after the record overlay above,
      // so a remapped tile that now plays a kept record stays listed). Their
      // map slots are off the entrance tables and their data is deleted at
      // build — the picker must not offer them.
      if (projectId) {
        const removedSet = new Set(getProjectRemovedLevels(projectId))
        if (removedSet.size > 0) {
          for (const g of cat.groups) {
            g.levels = g.levels.filter(
              (l) => l.recordId === null || !removedSet.has(l.recordId as number)
            )
          }
          cat.groups = cat.groups.filter((g) => g.levels.length > 0)
        }
      }
      if (projectId) {
        const claimed = new Set<number>()
        for (const g of cat.groups)
          for (const l of g.levels) if (l.recordId !== null) claimed.add(l.recordId as number)
        const fresh = getProjectNewSlots(projectId).filter((id) => {
          const hex = id.toString(16).toUpperCase().padStart(2, '0')
          const bin = join(overlayRoot(projectId), 'assets', 'yi', 'LevelData', `DATA_level_${hex}_obj.bin`)
          return !claimed.has(id) && existsSync(bin)
        })
        if (fresh.length > 0) {
          let grp = cat.groups.find((g) => g.label === 'Unused Rooms')
          if (!grp) {
            grp = { label: 'Unused Rooms', levels: [] }
            cat.groups.push(grp)
          }
          for (const id of fresh.sort((a, b) => a - b)) {
            const hexId = `0x${id.toString(16).toUpperCase().padStart(2, '0')}`
            grp.levels.push({
              recordId: id,
              name: `New Room ${hexId}`,
              world: 'Unused Rooms',
              slot: hexId
            })
          }
        }
      }
      // Surface the pointer-table size so renderer inputs (the world-map
      // entrance record-id field) can cap to the last real record dynamically.
      cat.recordCount = LEVEL_RECORD_COUNT
      return cat
    } catch {
      return null
    }
  })
}
