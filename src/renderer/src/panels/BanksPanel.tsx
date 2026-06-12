import { useEffect, useState, type JSX } from 'react'
import type { LevelData, PoolOverview } from '../../../preload/api'
import { getLevel } from '../data/levels'
import { hex0x } from '../lib/hex'

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
}

export function BanksBody({ level, currentLevelRecordId, onJump, onLayoutChange }: BanksBodyProps): JSX.Element {
  const [overview, setOverview] = useState<PoolOverview | null>(null)
  const [loaded, setLoaded] = useState(false)
  // Level id currently being toggled (its buttons disable), and a counter bumped
  // after a toggle to re-fetch the overview.
  const [busy, setBusy] = useState<number | null>(null)
  const [version, setVersion] = useState(0)

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
              <div className="se-banks__pool-sub">
                {r.usedBytes} / {r.capacityBytes} bytes · {r.levels.length} levels
              </div>
              {r.levels.length === 0 ? (
                <div className="se-banks__pool-sub se-banks__region-empty">— empty —</div>
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
            <div className="se-banks__pool-sub">
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
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
