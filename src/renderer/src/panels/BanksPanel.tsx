import { useEffect, useState, type JSX } from 'react'
import type {
  CreatableSlot,
  LevelData,
  PoolOverview,
  RemovalPreview,
  RemovedLevelEntry
} from '../../../preload/api'
import { getLevel } from '../data/levels'
import { hex0x } from '../lib/hex'
import { persistedState } from '../lib/persisted-state'
import { DiscardChangesModal } from '../DiscardChangesModal'

/** Panel UI prefs (versioned localStorage key, CLAUDE.md convention). */
const banksPrefs = persistedState('shinyEgg.banksPanel.v1', { showRemoved: false })

// Overview of the level-data bank pools + the free-space regions levels can be
// migrated into. Lists every bank that holds level data with its used/free byte
// totals (free includes a movable pool's boundary-move headroom + any space a
// migrated level reclaimed) and the per-level breakdown; clicking a level jumps
// to it. Per level it offers "→ free space" (migrate into a free region) and, for
// the two biased-sprite levels (0x19/0xCB), "De-couple". The "Free space" section
// shows each region's usage + the levels relocated into it ("← return" migrates
// them home). Backed by computePoolOverview + computeFreeRegionsOverview in
// snes-framework/scripts/level-budget.ts; toggles persist to project.json and mark
// the build dirty (layout changes don't render live — Test Level rebuilds).

const REFRESH_DEBOUNCE_MS = 350

/** `FreeRegion51` → `$51 free region`. */
function regionLabel(id: string): string {
  return '$' + id.replace(/^FreeRegion/, '') + ' free region'
}

/** The clickable level-id/name/bytes jump button shared by every row (pool,
 *  free-region, and migrated-out). `name` defaults to the catalog slot. */
function LevelJump({
  id,
  name,
  bytes,
  here,
  onJump
}: {
  id: number
  name?: string
  bytes?: number
  here?: boolean
  onJump: (id: number) => void
}): JSX.Element {
  const entry = getLevel(id)
  return (
    <button
      type="button"
      className={`se-banks__jump${here ? ' is-here' : ''}`}
      onClick={() => onJump(id)}
      title={entry ? `Jump to ${entry.world} ${entry.slot} — ${entry.name}` : `Jump to level ${hex0x(id, 2)}`}
    >
      <span className="se-banks__level-id">{hex0x(id, 2)}</span>
      <span className="se-banks__level-name">
        {name ?? (entry ? entry.slot : 'sub-room')}
        {here && <span className="se-banks__here"> · here</span>}
      </span>
      {bytes != null && <span className="se-banks__level-bytes">{bytes} B</span>}
    </button>
  )
}

/** The de-couple toggle for the two biased-sprite levels (0x19/0xCB), shared by
 *  their resident row and their migrated-out row (a coupled level migrated to
 *  free space has no resident row, and de-coupling it is what frees its partner
 *  to migrate). */
function DecoupleButton({
  decoupled,
  disabled,
  onClick
}: {
  decoupled: boolean
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`se-banks__act${decoupled ? ' is-on' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={
        decoupled
          ? 'Re-couple: drop its own sprite blob (only if unedited)'
          : 'De-couple: give it its own sprite blob, freeing its partner to migrate'
      }
    >
      {decoupled ? 'decoupled ✓' : 'de-couple'}
    </button>
  )
}

/** The "← return" action shared by free-region rows + migrated-out rows. */
function ReturnButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="se-banks__act"
      disabled={disabled}
      onClick={onClick}
      title="Return this level to its home bank (rebuild to apply)"
    >
      ← return
    </button>
  )
}

/** The per-row "remove from game" action (vanilla-level removal). */
function RemoveButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="se-banks__act se-banks__act--danger"
      disabled={disabled}
      onClick={onClick}
      title="Remove this level from the game (frees its bytes; rebuild to apply)"
    >
      ✕
    </button>
  )
}

/** `0x12 (World 3 3-1 — Welcome To Monkey World)`, falling back to the bare id. */
function levelLabel(id: number): string {
  const e = getLevel(id)
  return e ? `${hex0x(id, 2)} (${e.world} ${e.slot} — ${e.name})` : hex0x(id, 2)
}

/** Compose the confirm-dialog body for a removal preview. */
function previewBody(p: RemovalPreview, intro: string): string {
  const parts: string[] = [intro]
  if (p.recordIds.length > 0) {
    parts.push(
      p.freedBytes > 0
        ? `Frees ${p.freedBytes} bytes of level data at the next build.`
        : 'Freed bytes unknown until the ROM is built.'
    )
    if (p.residualBytes > 0) {
      parts.push(`${p.residualBytes} bytes stay resident (shared or fixed-bank data).`)
    }
    if (p.translevels.length > 0) {
      parts.push(
        `Clears ${p.translevels.length} world-map slot(s)` +
          (p.unlockRewires > 0
            ? `; ${p.unlockRewires} unlock(s) redirect back to the level just completed.`
            : '.')
      )
    }
    if (p.incomingWarps.length > 0) {
      const srcs = [...new Set(p.incomingWarps.map((w) => w.sourceRecordId))]
      const shown = srcs.slice(0, 4).map((s) => hex0x(s, 2)).join(', ')
      parts.push(
        `Warning: ${p.incomingWarps.length} exit(s) in kept level(s) ` +
          `${shown}${srcs.length > 4 ? ', …' : ''} lead into the removed room(s) and will be stranded.`
      )
    }
  }
  if (p.blocked.length > 0) {
    parts.push(
      'Not removable: ' +
        p.blocked.map((b) => `${hex0x(b.recordId, 2)} — ${b.reason}`).join('; ') +
        '.'
    )
  }
  return parts.join(' ')
}

export interface BanksBodyProps {
  /** The level currently open in the editor — its blobs are sized live so the
   *  bank totals track unsaved edits. */
  level: LevelData | null
  /** Record id of the open level (marks its rows "· here"). */
  currentLevelRecordId: number | null
  /** Jump into a level — routed through the unsaved-changes guard. */
  onJump: (levelRecordId: number) => void
  /** Called after a migrate / de-couple toggle so the host marks the build dirty
   *  (the change only takes effect on the next build). */
  onLayoutChange?: () => void
  /** Called after levels were removed from the game — the host refreshes the
   *  catalog, marks the build dirty, and navigates away if the open level went. */
  onLevelsRemoved?: (removedIds: number[]) => void
}

/** A pending removal confirm: the validated preview behind the dialog. An empty
 *  `ids` means there's nothing to do (the dialog is informational only). */
interface RemovalDialog {
  title: string
  ids: number[]
  body: string
}

export function BanksBody({
  level,
  currentLevelRecordId,
  onJump,
  onLayoutChange,
  onLevelsRemoved
}: BanksBodyProps): JSX.Element {
  const [overview, setOverview] = useState<PoolOverview | null>(null)
  const [loaded, setLoaded] = useState(false)
  // Level id currently being toggled (its buttons disable), and a counter bumped
  // after a toggle to re-fetch the overview.
  const [busy, setBusy] = useState<number | null>(null)
  const [version, setVersion] = useState(0)
  // Vanilla-level removal flow: preview → confirm dialog → apply.
  const [removalDialog, setRemovalDialog] = useState<RemovalDialog | null>(null)
  const [removalBusy, setRemovalBusy] = useState(false)
  const [removalError, setRemovalError] = useState<string | null>(null)
  // Restore flow: list of removed levels → checkbox picks → restore.
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreList, setRestoreList] = useState<RemovedLevelEntry[]>([])
  const [restoreChecked, setRestoreChecked] = useState<Set<number>>(new Set())
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  // Create flow: list of free slots → radio pick → create + jump in.
  const [createOpen, setCreateOpen] = useState(false)
  const [createSlots, setCreateSlots] = useState<CreatableSlot[]>([])
  const [createPick, setCreatePick] = useState<number | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Whether removed levels' residual/freed rows are listed (persisted pref).
  const [showRemoved, setShowRemoved] = useState(() => banksPrefs.load().showRemoved)
  const toggleShowRemoved = (): void => {
    setShowRemoved((v) => {
      banksPrefs.save({ showRemoved: !v })
      return !v
    })
  }

  // Escape closes the restore/create modals (parity with DiscardChangesModal).
  useEffect(() => {
    if (!restoreOpen && !createOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (restoreOpen && !restoreBusy) setRestoreOpen(false)
      if (createOpen && !createBusy) setCreateOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [restoreOpen, restoreBusy, createOpen, createBusy])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      window.shinyEgg.editor
        .poolOverview(currentLevelRecordId, level)
        .then((r) => {
          if (cancelled) return
          setOverview(r)
          setLoaded(true)
        })
        .catch(() => {
          if (cancelled) return
          setOverview(null)
          setLoaded(true)
        })
    }, REFRESH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [level, currentLevelRecordId, version])

  const run = async (id: number, op: Promise<unknown>): Promise<void> => {
    setBusy(id)
    try {
      await op
      onLayoutChange?.()
      setVersion((v) => v + 1)
    } catch {
      /* surfaced by the next overview fetch; nothing to undo locally */
    } finally {
      setBusy(null)
    }
  }
  const migrate = (id: number, on: boolean): Promise<void> =>
    run(id, window.shinyEgg.editor.setLevelRelocation(id, on))
  const decouple = (id: number, on: boolean): Promise<void> =>
    run(id, window.shinyEgg.editor.setLevelDecoupled(id, on))

  // ── Vanilla-level removal ──────────────────────────────────────────────────

  const openSingleRemoval = async (id: number): Promise<void> => {
    setRemovalBusy(true)
    setRemovalError(null)
    try {
      const p = await window.shinyEgg.editor.removeLevelsPreview([id])
      if (!p.ok) {
        setRemovalDialog({ title: 'Remove level', ids: [], body: p.error })
        return
      }
      const openNote =
        id === currentLevelRecordId && p.recordIds.includes(id)
          ? ' This level is open in the editor — unsaved edits will be lost.'
          : ''
      setRemovalDialog({
        title: `Remove ${levelLabel(id)}`,
        ids: p.recordIds,
        body: previewBody(p, `Remove ${levelLabel(id)} from the game?${openNote}`)
      })
    } catch (err) {
      setRemovalDialog({ title: 'Remove level', ids: [], body: (err as Error).message })
    } finally {
      setRemovalBusy(false)
    }
  }

  const openBulkRemoval = async (): Promise<void> => {
    setRemovalBusy(true)
    setRemovalError(null)
    try {
      const all = await window.shinyEgg.editor.removableVanillaLevels()
      if ('error' in all) {
        setRemovalDialog({ title: 'Remove all vanilla levels', ids: [], body: all.error })
        return
      }
      if (all.recordIds.length === 0) {
        setRemovalDialog({
          title: 'Remove all vanilla levels',
          ids: [],
          body: 'Nothing to remove — every remaining level is edited, engine-required, or reachable from a kept level.'
        })
        return
      }
      const p = await window.shinyEgg.editor.removeLevelsPreview(all.recordIds)
      if (!p.ok) {
        setRemovalDialog({ title: 'Remove all vanilla levels', ids: [], body: p.error })
        return
      }
      const kept =
        `Keeps ${all.keptProtected.length} engine-required room(s), ` +
        `${all.keptEdited.length} level(s) with overlay changes, and ` +
        `${all.keptWarpReachable.length} room(s) reachable from kept levels.`
      setRemovalDialog({
        title: 'Remove all vanilla levels',
        ids: p.recordIds,
        body: previewBody(p, `Remove ${p.recordIds.length} unedited vanilla level(s) from the game? ${kept}`)
      })
    } catch (err) {
      setRemovalDialog({ title: 'Remove all vanilla levels', ids: [], body: (err as Error).message })
    } finally {
      setRemovalBusy(false)
    }
  }

  const openRestore = async (): Promise<void> => {
    setRestoreBusy(true)
    setRestoreError(null)
    try {
      const list = await window.shinyEgg.editor.removedLevels()
      setRestoreList(list)
      setRestoreChecked(new Set(list.map((l) => l.recordId)))
      setRestoreOpen(true)
    } catch (err) {
      setRestoreList([])
      setRestoreChecked(new Set())
      setRestoreError((err as Error).message)
      setRestoreOpen(true)
    } finally {
      setRestoreBusy(false)
    }
  }

  const confirmRestore = async (): Promise<void> => {
    if (restoreChecked.size === 0) return
    setRestoreBusy(true)
    setRestoreError(null)
    try {
      const r = await window.shinyEgg.editor.restoreLevels([...restoreChecked])
      if (!r.ok) {
        setRestoreError(r.error)
        return
      }
      setRestoreOpen(false)
      setVersion((v) => v + 1)
      // Same host refresh as a removal (marks the build dirty + refreshes the
      // catalog); nothing disappeared, so the navigate-away check no-ops.
      onLevelsRemoved?.([])
    } catch (err) {
      setRestoreError((err as Error).message)
    } finally {
      setRestoreBusy(false)
    }
  }

  const openCreate = async (): Promise<void> => {
    setCreateBusy(true)
    setCreateError(null)
    try {
      const slots = await window.shinyEgg.editor.creatableSlots()
      setCreateSlots(slots)
      setCreatePick(slots[0]?.recordId ?? null)
      setCreateOpen(true)
    } catch (err) {
      setCreateSlots([])
      setCreatePick(null)
      setCreateError((err as Error).message)
      setCreateOpen(true)
    } finally {
      setCreateBusy(false)
    }
  }

  const confirmCreate = async (): Promise<void> => {
    if (createPick == null) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const r = await window.shinyEgg.editor.createLevel(createPick)
      if (!r.ok) {
        setCreateError(r.error)
        return
      }
      setCreateOpen(false)
      setVersion((v) => v + 1)
      onLevelsRemoved?.([]) // marks the build dirty + refreshes the catalog
      onJump(r.recordId) // open the fresh level (guarded nav)
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }

  const confirmRemoval = async (): Promise<void> => {
    if (!removalDialog) return
    if (removalDialog.ids.length === 0) {
      setRemovalDialog(null)
      return
    }
    setRemovalBusy(true)
    setRemovalError(null)
    try {
      const r = await window.shinyEgg.editor.removeLevels(removalDialog.ids)
      if (!r.ok) {
        setRemovalError(r.error)
        return
      }
      setRemovalDialog(null)
      setVersion((v) => v + 1)
      onLevelsRemoved?.(r.removed)
    } catch (err) {
      setRemovalError((err as Error).message)
    } finally {
      setRemovalBusy(false)
    }
  }

  if (!overview) {
    return (
      <div className="se-banks se-banks--empty">
        {loaded ? 'Build the ROM to see bank budgets.' : 'Loading…'}
      </div>
    )
  }

  const anyRoom = (bytes: number): boolean => overview.freeRegions.some((r) => r.freeBytes >= bytes)

  return (
    <div className="se-banks">
      <div className="se-banks__bulk">
        <label
          className="se-banks__show-removed"
          title="List removed levels' residual bytes and freed-space rows in the pools below"
        >
          <input type="checkbox" checked={showRemoved} onChange={toggleShowRemoved} />
          <span>Show Removed</span>
        </label>
        <button
          type="button"
          className="se-banks__act"
          disabled={createBusy || restoreBusy || removalBusy}
          onClick={() => void openCreate()}
          title="Create a blank level in a removed level's pointer slot and point the slot at it"
        >
          Create Level…
        </button>
        <button
          type="button"
          className="se-banks__act"
          disabled={restoreBusy || removalBusy || createBusy}
          onClick={() => void openRestore()}
          title="Undo level removals: restore picked levels to their base data and world-map slots"
        >
          Restore levels…
        </button>
        <button
          type="button"
          className="se-banks__act se-banks__act--danger"
          disabled={removalBusy || restoreBusy || createBusy}
          onClick={() => void openBulkRemoval()}
          title="Remove every unedited vanilla level from the game, freeing its bytes for your own levels"
        >
          Remove all vanilla levels…
        </button>
      </div>
      {overview.freeRegions.length > 0 && (
        <section className="se-banks__pool se-banks__freespace">
          <header className="se-banks__pool-head">
            <span className="se-banks__pool-id">Free space</span>
            <span className="se-banks__pool-tag">regions</span>
          </header>
          {overview.freeRegions.map((r) => (
            <div className="se-banks__region" key={r.id}>
              <div className="se-banks__region-head">
                <span className="se-banks__pool-id">{regionLabel(r.id)}</span>
                <span className={`se-banks__free${r.freeBytes < 0 ? ' is-over' : ''}`}>{r.freeBytes} free</span>
              </div>
              <div className="se-meta se-banks__pool-sub">
                {r.usedBytes} / {r.capacityBytes} bytes · {r.levels.length} levels
              </div>
              {r.levels.length === 0 ? (
                <div className="se-meta se-banks__pool-sub se-banks__region-empty">— empty —</div>
              ) : (
                <ul className="se-banks__levels">
                  {r.levels.map((lv) => {
                    const id = parseInt(lv.levelRecordId, 16)
                    return (
                      <li className="se-banks__level" key={lv.levelRecordId}>
                        <LevelJump id={id} bytes={lv.bytes} onJump={onJump} />
                        <ReturnButton disabled={busy === id} onClick={() => migrate(id, false)} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {overview.pools.map((pool) => {
        const over = pool.freeBytes < 0
        return (
          <section className="se-banks__pool" key={pool.poolId}>
            <header className="se-banks__pool-head">
              <span className="se-banks__pool-id">{pool.poolId}</span>
              <span
                className="se-banks__pool-tag"
                title={
                  pool.movable
                    ? 'Can grow into end-of-bank headroom; levels can also migrate to free space'
                    : pool.reclaimable
                      ? 'Can’t grow, but its levels can migrate to free space (reclaiming their slot)'
                      : 'Can’t grow and its levels can’t migrate'
                }
              >
                {pool.movable ? 'movable' : pool.reclaimable ? 'reclaimable' : 'fixed'}
              </span>
              <span className={`se-banks__free${over ? ' is-over' : ''}`}>
                {over ? `${-pool.freeBytes} over` : `${pool.freeBytes} free`}
              </span>
            </header>
            <div className="se-meta se-banks__pool-sub">
              {pool.usedBytes} / {pool.limitBytes} bytes · {pool.levels.length} levels
            </div>
            <ul className="se-banks__levels">
              {pool.levels.map((lv) => {
                const id = parseInt(lv.levelRecordId, 16)
                const here = id === currentLevelRecordId
                const canMigrate = !lv.migrated && !!lv.migratable && anyRoom(lv.bytes)
                const migrateTitle = lv.migrated
                  ? 'Already migrated — these bytes are its de-coupled sprite blob, which stays in the home bank'
                  : lv.migratable
                    ? canMigrate
                      ? 'Migrate this level into free space (rebuild to apply)'
                      : 'No free region has room for this level'
                    : 'This level can’t be migrated (engine-hardcoded, shared/aliased, or in a fixed pool)'
                if (lv.removed) {
                  // Residual bytes of a removed level (shared slice / fixed pool /
                  // borrowed terminator) — informational, no actions.
                  if (!showRemoved) return null
                  return (
                    <li className="se-banks__level is-removed" key={lv.levelRecordId}>
                      <LevelJump id={id} name="removed (residual bytes)" bytes={lv.bytes} onJump={onJump} />
                    </li>
                  )
                }
                return (
                  <li className="se-banks__level" key={lv.levelRecordId}>
                    <LevelJump id={id} bytes={lv.bytes} here={here} onJump={onJump} />
                    {lv.decouplable && (
                      <DecoupleButton
                        decoupled={!!lv.decoupled}
                        disabled={busy === id}
                        onClick={() => decouple(id, !lv.decoupled)}
                      />
                    )}
                    <button
                      type="button"
                      className="se-banks__act"
                      disabled={!canMigrate || busy === id}
                      onClick={() => migrate(id, true)}
                      title={migrateTitle}
                    >
                      → free space
                    </button>
                    <RemoveButton
                      disabled={removalBusy || busy === id}
                      onClick={() => void openSingleRemoval(id)}
                    />
                  </li>
                )
              })}
              {showRemoved &&
                pool.removedOut?.map((r) => {
                  const id = parseInt(r.levelRecordId, 16)
                  return (
                    <li className="se-banks__level is-removed" key={`rm-${r.levelRecordId}`}>
                      <LevelJump id={id} name="removed" bytes={r.bytes} onJump={onJump} />
                      <span className="se-meta se-banks__pool-sub">freed</span>
                    </li>
                  )
                })}
              {pool.migratedOut?.map((m) => {
                const id = parseInt(m.levelRecordId, 16)
                return (
                  <li className="se-banks__level is-migrated" key={`out-${m.levelRecordId}`}>
                    <LevelJump id={id} name={`→ ${regionLabel(m.regionId)}`} bytes={m.bytes} onJump={onJump} />
                    {m.decouplable && (
                      <DecoupleButton
                        decoupled={!!m.decoupled}
                        disabled={busy === id}
                        onClick={() => decouple(id, !m.decoupled)}
                      />
                    )}
                    <ReturnButton disabled={busy === id} onClick={() => migrate(id, false)} />
                    <RemoveButton
                      disabled={removalBusy || busy === id}
                      onClick={() => void openSingleRemoval(id)}
                    />
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {createOpen && (
        <div className="se-modal-backdrop" onMouseDown={() => !createBusy && setCreateOpen(false)}>
          <div className="se-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="se-modal__title">Create level</h3>
            {createSlots.length === 0 ? (
              <p className="se-modal__body">
                No free pointer slots. Remove a vanilla level first — its slot becomes available
                for a new level.
              </p>
            ) : (
              <>
                <p className="se-modal__body">
                  Pick the pointer slot for the new (blank) level. The slot also gets its old
                  world-map tile back, pointing at the new level. Takes effect in the editor
                  immediately, in the game at the next build.
                </p>
                <div className="se-banks__restore-list">
                  {createSlots.map((s) => (
                    <label className="se-banks__restore-row" key={s.recordId}>
                      <input
                        type="radio"
                        name="se-create-slot"
                        checked={createPick === s.recordId}
                        onChange={() => setCreatePick(s.recordId)}
                      />
                      <span className="se-banks__level-id">{hex0x(s.recordId, 2)}</span>
                      <span className="se-banks__level-name">
                        {`removed — was ${s.name ?? 'a sub-room'}`}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {createError && <p className="se-modal__error">{createError}</p>}
            <div className="se-modal__actions">
              <button
                type="button"
                className="se-btn"
                onClick={() => setCreateOpen(false)}
                disabled={createBusy}
              >
                Cancel
              </button>
              {createSlots.length > 0 && (
                <button
                  type="button"
                  className="se-btn is-primary"
                  onClick={() => void confirmCreate()}
                  disabled={createBusy || createPick == null}
                >
                  {createBusy
                    ? 'Creating…'
                    : `Create level${createPick != null ? ` in ${hex0x(createPick, 2)}` : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {restoreOpen && (
        <div className="se-modal-backdrop" onMouseDown={() => !restoreBusy && setRestoreOpen(false)}>
          <div className="se-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="se-modal__title">Restore levels</h3>
            {restoreList.length === 0 ? (
              <p className="se-modal__body">No removed levels to restore.</p>
            ) : (
              <>
                <p className="se-modal__body">
                  Restore the checked levels to their pristine base data and base world-map slots.
                  Their bytes return to the level banks at the next build.
                </p>
                <label className="se-banks__restore-all">
                  <input
                    type="checkbox"
                    checked={restoreChecked.size === restoreList.length}
                    onChange={() =>
                      setRestoreChecked(
                        restoreChecked.size === restoreList.length
                          ? new Set()
                          : new Set(restoreList.map((l) => l.recordId))
                      )
                    }
                  />
                  <span>
                    {restoreChecked.size === restoreList.length ? 'Uncheck all' : 'Check all'} (
                    {restoreChecked.size}/{restoreList.length})
                  </span>
                </label>
                <div className="se-banks__restore-list">
                  {restoreList.map((l) => (
                    <label className="se-banks__restore-row" key={l.recordId}>
                      <input
                        type="checkbox"
                        checked={restoreChecked.has(l.recordId)}
                        onChange={() =>
                          setRestoreChecked((s) => {
                            const next = new Set(s)
                            if (next.has(l.recordId)) next.delete(l.recordId)
                            else next.add(l.recordId)
                            return next
                          })
                        }
                      />
                      <span className="se-banks__level-id">{hex0x(l.recordId, 2)}</span>
                      <span className="se-banks__level-name">{l.name ?? 'sub-room'}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {restoreError && <p className="se-modal__error">{restoreError}</p>}
            <div className="se-modal__actions">
              <button
                type="button"
                className="se-btn"
                onClick={() => setRestoreOpen(false)}
                disabled={restoreBusy}
              >
                Cancel
              </button>
              {restoreList.length > 0 && (
                <button
                  type="button"
                  className="se-btn is-primary"
                  onClick={() => void confirmRestore()}
                  disabled={restoreBusy || restoreChecked.size === 0}
                >
                  {restoreBusy
                    ? 'Restoring…'
                    : `Restore ${restoreChecked.size} level${restoreChecked.size === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <DiscardChangesModal
        open={removalDialog !== null}
        title={removalDialog?.title ?? ''}
        body={removalDialog?.body ?? ''}
        saving={removalBusy}
        error={removalError}
        confirmLabel={removalDialog && removalDialog.ids.length > 0 ? 'Remove' : 'OK'}
        danger={!!removalDialog && removalDialog.ids.length > 0}
        onDiscard={() => void confirmRemoval()}
        onCancel={() => {
          if (!removalBusy) {
            setRemovalDialog(null)
            setRemovalError(null)
          }
        }}
      />
    </div>
  )
}
