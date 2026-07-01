import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { TestInventory } from '../../../preload/api'
import { gates, type Blocker } from '../lib/level-blockers'
import { getAllLevels, getLevel } from '../data/levels'
import { findWarpChain } from '../lib/warp-graph'
import { hex } from '../lib/hex'

// Best-effort spawn cell for an orphan-room Test Level boot — a room with no
// world-map slot AND no warp path has no canonical entry point, so we drop Yoshi
// near the top-center of screen 0 and let the user reposition in-game if it
// lands in terrain.
const ORPHAN_SPAWN_CELL_X = 8
const ORPHAN_SPAWN_CELL_Y = 2

export interface EmulatorActionsParams {
  /** Whether ANY editor document (level, palette, strings, …) has unsaved edits
   *  — drives the save-all-before-build flush so every overlay edit is on disk
   *  before asar assembles. */
  anyDirty: boolean
  /** Save every dirty EditSession document (each marks the build dirty as needed).
   *  Resolves false if any save failed. */
  saveAll: () => Promise<boolean>
  /** Synchronous mirror of needsBuild (read after a save without a stale closure). */
  needsBuildRef: RefObject<boolean>
  setNeedsBuild: (v: boolean) => void
  /** Called after a successful build — clears needsBuild AND triggers a render
   *  refresh so the canvas/palette re-fetch from the freshly-built ROM. */
  onBuilt: () => void
  /** Open the ROM log popover (called when a build fails so the asar error shows). */
  openLog: () => void
  blockers: Blocker[]
  selectedLevelRecordId: number | null
  rootLevelRecordId: number | null
  testSpawn: { levelRecordId: number; x: number; y: number } | null
  /** Items to seed into Yoshi's egg trail on Test Level boot (toolbar dropdown). */
  testInventory: TestInventory
  appendLog: (line: string) => void
  /** Re-query the located EmuHawk.exe path. Called after a failed launch: the
   *  main process forgets a saved-but-unlaunchable path, so this flips the
   *  toolbar back to "Locate BizHawk" for re-pointing. */
  refreshBizhawkExe: () => void
}

export interface EmulatorActionsApi {
  /** Emulator action in flight — disables the Launch / Test Level buttons. */
  emuBusy: boolean
  handleLaunch: () => void
  handleTestLevel: () => void
}

/**
 * Launch / Test Level orchestration: save→build→boot EmuHawk, with the
 * three-path boot logic (catalog level / reachable sub-room warp chain / orphan
 * room) and the Set-Spawn override. `emuBusyRef` is a synchronous re-entry guard
 * so a rapid shortcut + click can't kick off two builds at once.
 */
export function useEmulatorActions({
  anyDirty,
  saveAll,
  needsBuildRef,
  setNeedsBuild,
  onBuilt,
  openLog,
  blockers,
  selectedLevelRecordId,
  rootLevelRecordId,
  testSpawn,
  testInventory,
  appendLog,
  refreshBizhawkExe
}: EmulatorActionsParams): EmulatorActionsApi {
  const [emuBusy, setEmuBusy] = useState<boolean>(false)
  const emuBusyRef = useRef<boolean>(false)

  // Flush pending edits into the ROM: save EVERY dirty document (level + palette
  // + strings + …) — each marks the build dirty — then rebuild if any save has
  // happened since the last build. Shared by Launch and Test Level so both boot
  // a ROM that includes the latest changes. Saving through `saveAll` (not just
  // the level) is what guarantees a palette/strings overlay edit is on disk
  // BEFORE asar assembles — otherwise the build races the async overlay write
  // and assembles a stale tree. Returns false (and logs) if a step fails.
  const saveAndBuildIfNeeded = useCallback(
    async (append: (line: string) => void, label: string): Promise<boolean> => {
      if (anyDirty) {
        append(`${label}: saving…`)
        try {
          if (!(await saveAll())) {
            append(`${label}: save failed`)
            return false
          }
        } catch (err) {
          append(`${label}: save failed — ${(err as Error).message}`)
          return false
        }
      }
      if (needsBuildRef.current) {
        append(`${label}: building…`)
        try {
          const r = await window.shinyEgg.build()
          const name = r.outputPath.split(/[/\\]/).pop()
          append(`${label}: built → ${name}`)
          onBuilt()
        } catch (err) {
          append(`${label}: build failed — ${(err as Error).message}`)
          // The build left no fresh ROM — keep needsBuild set so the next Test
          // Level / Launch rebuilds rather than booting a stale/corrupt
          // artifact, and surface the log so the failure is visible.
          setNeedsBuild(true)
          openLog()
          return false
        }
      }
      return true
    },
    [anyDirty, saveAll, setNeedsBuild, onBuilt, needsBuildRef, openLog]
  )

  // Test Level chain: save+build if needed → ensure BizHawk running →
  // loadLevel. Each step's failure aborts the chain and reports back through
  // `append`. Returns when the load completes (or fails). Caller controls the
  // busy gate via the returned promise.
  const onTestLevel = useCallback(
    async (append: (line: string) => void): Promise<void> => {
      if (selectedLevelRecordId === null) {
        append('Test Level: no level selected')
        return
      }
      // Build-scope blockers hard-stop before save/build (the byte-budget gate,
      // #14, lands here — see lib/level-blockers.ts). None today (stub).
      const buildBlock = blockers.filter((b) => b.scope === 'build' && gates(b))
      if (buildBlock.length > 0) {
        buildBlock.forEach((b) =>
          append(`Test Level: blocked — ${b.message}${b.detail ? ` (${b.detail})` : ''}`)
        )
        return
      }
      if (!(await saveAndBuildIfNeeded(append, 'Test Level'))) return
      append('Test Level: ensuring EmuHawk…')
      try {
        await window.shinyEgg.bizhawk.launch()
      } catch (err) {
        append(`Test Level: launch failed — ${(err as Error).message}`)
        refreshBizhawkExe()
        return
      }
      // Three paths into the cart:
      //   1. Catalog level (selectedLevelRecordId has a translevel slot): boot it via
      //      the world-map flow — the natural in-game entry.
      //   2. Reachable sub-room: boot a parent, then replay the shortest chain of
      //      warp records (over the shared warp graph) so the cart loads the
      //      sub-room as if Yoshi took each pipe / door in sequence.
      //   3. Orphan room (no translevel slot AND no warp path — e.g. opened via
      //      "Open any room by id"): boot any valid parent, then a SINGLE direct
      //      warp to the record id. The cart's warp re-entry (CODE_load_level_data_pointers)
      //      indexes the level-data pointer table by id directly, so any backed
      //      record loads — including ones unreachable from the world map.
      const targetEntry = getLevel(selectedLevelRecordId)
      let bootTranslevelId: number
      let warps:
        | Array<{ destLevelRecordId: number; destX: number; destY: number; entranceType: number }>
        | undefined
      if (targetEntry?.translevelId != null) {
        // (1) Catalog level — natural world-map boot.
        bootTranslevelId = targetEntry.translevelId
        append(`Test Level: loading 0x${hex(bootTranslevelId)} (record=0x${hex(selectedLevelRecordId)})…`)
      } else {
        // (2)/(3) Non-catalog room. Boot a valid parent — the root if it's a
        // catalog level, else the first catalog level (any bootable level works:
        // the warp records carry absolute dest ids) — then warp in.
        //
        // The parent MUST be a normal, gm$0C-loadable level. The "Intro" group —
        // translevel $0A (record $38, the gm38 intro cutscene) and $0B (Welcome) —
        // is NOT a playable level: its data is cutscene/intro data, so booting it
        // via gm$0C hangs (the loader never reaches gm$0F; the level-name overlay
        // shows a placeholder string and the load wedges). Since getAllLevels()
        // lists the Intro group first (WORLD_ORDER = ["Intro", "World 1", …]), the
        // old `find(translevelId != null)` picked the cutscene and FROZE Test Level
        // for every orphan room. Skip the Intro group on both the root and the
        // fallback so the parent is always a real World level (→ translevel $00).
        const isBootableParent = (tlId: number | null | undefined): boolean => {
          if (tlId == null) return false
          const e = getAllLevels().find((l) => l.translevelId === tlId)
          return e != null && e.world !== 'Intro'
        }
        const rootTranslevelId =
          rootLevelRecordId !== null ? getLevel(rootLevelRecordId)?.translevelId : null
        const parentTranslevelId =
          (isBootableParent(rootTranslevelId) ? rootTranslevelId : null) ??
          getAllLevels().find((l) => l.translevelId != null && l.world !== 'Intro')
            ?.translevelId ??
          null
        if (parentTranslevelId == null) {
          append('Test Level: no bootable catalog level to launch from — extract a cart first')
          return
        }
        bootTranslevelId = parentTranslevelId
        const chain =
          rootLevelRecordId !== null && rootLevelRecordId !== selectedLevelRecordId
            ? await findWarpChain(rootLevelRecordId, selectedLevelRecordId, { maxDepth: 16 })
            : null
        if (chain) {
          // (2) Reachable sub-room — replay the real route.
          warps = chain
          append(
            `Test Level: loading 0x${hex(bootTranslevelId)} → ${chain.length}-hop warp chain → sub-room 0x${hex(selectedLevelRecordId)} (${chain.map((w) => '0x' + hex(w.destLevelRecordId)).join(' → ')})…`
          )
        } else {
          // (3) Orphan / no path — single direct warp to the record id, spawning
          // at a best-effort cell (the room defines no canonical entry).
          warps = [
            {
              destLevelRecordId: selectedLevelRecordId,
              destX: ORPHAN_SPAWN_CELL_X,
              destY: ORPHAN_SPAWN_CELL_Y,
              entranceType: 0
            }
          ]
          append(
            `Test Level: 0x${hex(selectedLevelRecordId)} has no warp path — loading directly via a single warp ` +
              `(orphan room; spawning near cell ${ORPHAN_SPAWN_CELL_X},${ORPHAN_SPAWN_CELL_Y})…`
          )
        }
      }
      // Spawn override (Set Spawn tool): position Yoshi through the cart's own
      // warp/entrance loader (CODE_set_player_entrance_from_exit) rather than a
      // post-load position stomp. That routine seeds Player.X/Y from the
      // record's cell coords (destX/Y << 4) AND sets WarpToScreenFlag, so the
      // destination region's tilemap + collision are built before control
      // resumes — exactly how an in-game pipe drops Yoshi mid-level cleanly. A
      // raw stomp skips that, so a spawn far from where the level happened to
      // load shows un-paged tiles and drops Yoshi through not-yet-built floor.
      // A single warp into the target at the marker cell replaces whatever warp
      // plan we built above (the cart re-enters any backed record by id);
      // bootTranslevelId already boots a valid parent — for a catalog target that's
      // the target's own world slot, so the world/tilesets stay correct. The
      // marker is cell-snapped, so this matches the old pixel stomp exactly.
      if (testSpawn && testSpawn.levelRecordId === selectedLevelRecordId) {
        warps = [
          { destLevelRecordId: selectedLevelRecordId, destX: testSpawn.x, destY: testSpawn.y, entranceType: 0 }
        ]
        append(
          `Test Level: spawn override → warp into 0x${hex(selectedLevelRecordId)} at cell ${testSpawn.x},${testSpawn.y}…`
        )
      }
      const { eggs, keys } = testInventory
      if (eggs + keys > 0) {
        const parts: string[] = []
        if (eggs > 0) parts.push(`${eggs} egg${eggs > 1 ? 's' : ''}`)
        if (keys > 0) parts.push(`${keys} key${keys > 1 ? 's' : ''}`)
        append(`Test Level: inventory → ${parts.join(' + ')}`)
      }
      try {
        const reply = await window.shinyEgg.bizhawk.loadLevel(bootTranslevelId, warps, testInventory)
        // Reply is the OK / TIMEOUT / ERR status line. Split-tolerant in case
        // a future reply appends detail lines.
        const lines = reply.split('\n')
        append(`Test Level: ${lines[0]}`)
        for (let i = 1; i < lines.length; i++) append(lines[i])
      } catch (err) {
        append(`Test Level: loadLevel failed — ${(err as Error).message}`)
      }
    },
    [
      selectedLevelRecordId,
      rootLevelRecordId,
      saveAndBuildIfNeeded,
      blockers,
      testSpawn,
      testInventory,
      refreshBizhawkExe
    ]
  )

  // Launch (cold boot): flush edits into the ROM first (save + build if
  // needed), then spawn EmuHawk against the built ROM. No level is loaded —
  // the user drives the game (world map, intro, etc.).
  const onLaunch = useCallback(
    async (append: (line: string) => void): Promise<void> => {
      if (!(await saveAndBuildIfNeeded(append, 'Launch'))) return
      append('Launch: starting EmuHawk…')
      try {
        await window.shinyEgg.bizhawk.launch()
      } catch (err) {
        append(`Launch: failed — ${(err as Error).message}`)
        refreshBizhawkExe()
      }
    },
    [saveAndBuildIfNeeded, refreshBizhawkExe]
  )

  // Emulator-action wrappers shared by the toolbar buttons (BizHawkMenu) and the
  // Ctrl+R shortcut. `emuBusyRef` is a synchronous re-entry guard so a rapid
  // shortcut + click can't launch two builds at once.
  const runEmuAction = useCallback(
    async (action: (append: (line: string) => void) => Promise<void>) => {
      if (emuBusyRef.current) return
      emuBusyRef.current = true
      setEmuBusy(true)
      try {
        await action(appendLog)
      } finally {
        emuBusyRef.current = false
        setEmuBusy(false)
      }
    },
    [appendLog]
  )
  const handleLaunch = useCallback(() => void runEmuAction(onLaunch), [runEmuAction, onLaunch])
  const handleTestLevel = useCallback(() => {
    if (selectedLevelRecordId === null) return
    void runEmuAction(onTestLevel)
  }, [runEmuAction, onTestLevel, selectedLevelRecordId])

  return { emuBusy, handleLaunch, handleTestLevel }
}
