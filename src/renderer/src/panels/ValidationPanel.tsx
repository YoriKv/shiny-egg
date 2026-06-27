import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  AllLevelsValidationResult,
  LevelData,
  ValidationIssue,
  ValidationSeverity
} from '../../../preload/api'
import { levelLabel } from '../data/levels'
import {
  useEntityRenderValidity,
  type EntityValidityView
} from '../hooks/useEntityRenderValidity'
import { checkLevelCore, countCollectibles, summarizeLevel, validateAll } from '../lib/validation'

export interface ValidationPanelProps {
  /** Currently loaded level (live, edited) — null/empty when none is open. */
  level: LevelData | null
  /** Record id of the loaded level. */
  levelRecordId: number | null
  /** Navigate to a level + cell (loads the level, focuses the cell). */
  onJump: (levelRecordId: number, x: number, y: number) => void
}

const hx = (n: number): string => `0x${n.toString(16).toUpperCase()}`

const SEVERITY_ORDER: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 }

/**
 * Per-placement render-validity issues for the CURRENT level, reusing the
 * existing entityRenderValidity probe (object theme/anim/VRAM coverage + sprite
 * spriteset inclusion). Current-level only — too heavy to run across the whole
 * catalog, and these verdicts are already shown in the Picker.
 */
function renderValidityIssues(
  level: LevelData,
  view: EntityValidityView | null,
  levelRecordId: number
): ValidationIssue[] {
  if (!view || view.mode7) return [] // mode-7 arena: object verdicts N/A
  const issues: ValidationIssue[] = []

  const seenObj = new Set<string>()
  for (const o of level.objects) {
    const kind = o.num === 0 && o.exnum !== undefined ? 'ext' : 'std'
    const id = kind === 'ext' ? o.exnum! : o.num
    const key = `${kind}:${id}`
    if (seenObj.has(key)) continue
    seenObj.add(key)
    const v = view.objectVerdict(o.num, o.exnum)
    if (v === 'invalid' || v === 'degraded') {
      issues.push({
        check: 'object-render',
        title: 'Object renders wrong',
        severity: 'warning',
        message:
          v === 'invalid'
            ? `Object ${kind} ${hx(id)} doesn't render under this level's tileset/theme — wrong-theme garbage.`
            : `Object ${kind} ${hx(id)} renders degraded — some tiles aren't in VRAM.`,
        levelRecordId,
        x: o.x,
        y: o.y,
        entity: { kind: 'object', id }
      })
    }
  }

  const seenSpr = new Set<number>()
  for (const s of level.sprites) {
    if (seenSpr.has(s.num)) continue
    seenSpr.add(s.num)
    const sv = view.spriteValidity(s.num)
    if (sv.verdict === 'missing-gfx') {
      const placements = level.sprites.filter((p) => p.num === s.num)
      issues.push({
        check: 'sprite-render',
        title: 'Sprite graphics missing',
        severity: 'warning',
        message: `Sprite ${hx(s.num)} needs gfx file(s) ${sv.missingFiles
          .map(hx)
          .join(', ')} not loaded by this level's sprite tileset.`,
        levelRecordId,
        x: s.x,
        y: s.y,
        entity: { kind: 'sprite', id: s.num },
        sprites: placements.map((p) => ({ num: p.num, x: p.x, y: p.y }))
      })
    }
  }
  return issues
}

function SeverityDot({ severity }: { severity: ValidationSeverity }): JSX.Element {
  return <span className={`se-validation__dot se-validation__dot--${severity}`} />
}

function IssueRow({
  issue,
  onJump
}: {
  issue: ValidationIssue
  onJump: (levelRecordId: number, x: number, y: number) => void
}): JSX.Element {
  const jumpable = issue.x !== undefined && issue.y !== undefined
  const sprites = issue.sprites ?? []
  return (
    <li className="se-validation__issue">
      <button
        type="button"
        className="se-validation__issue-btn"
        disabled={!jumpable}
        title={jumpable ? 'Jump to this location' : undefined}
        onClick={() => jumpable && onJump(issue.levelRecordId, issue.x!, issue.y!)}
      >
        <SeverityDot severity={issue.severity} />
        <span className="se-validation__issue-title">{issue.title}</span>
        <span className="se-validation__issue-msg">{issue.message}</span>
      </button>
      {sprites.length > 0 && (
        <details className="se-validation__sprites">
          <summary>
            {sprites.length} sprite{sprites.length !== 1 ? 's' : ''}
          </summary>
          <ul className="se-validation__sprite-list">
            {sprites.map((sp, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="se-validation__sprite-btn"
                  title="Jump to this sprite"
                  onClick={() => onJump(sp.levelRecordId ?? issue.levelRecordId, sp.x, sp.y)}
                >
                  <span className="se-validation__sprite-id">{hx(sp.num)}</span> @ ({sp.x}, {sp.y})
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

const bySeverity = (a: ValidationIssue, b: ValidationIssue): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]

export function ValidationPanel({
  level,
  levelRecordId,
  onJump
}: ValidationPanelProps): JSX.Element {
  const loaded = level && !level.empty && !level.special ? level : null

  // Collectible tally — pure, recomputed live on every edit, always shown.
  const counts = useMemo(() => (loaded ? countCollectibles(loaded) : null), [loaded])

  // Per-placement render-validity for the current level (async probe).
  const view = useEntityRenderValidity(loaded)

  // The check waits until the level is FULLY loaded: its data is the selected
  // record AND the render-validity probe (deferred to idle, so it lags the load)
  // has resolved for that same level. Until then `view` still carries the
  // previous level's verdicts under the new tilesets, which would transiently
  // flag a bogus "object renders wrong" that vanishes a beat later.
  const ready =
    loaded !== null && loaded.recordId === levelRecordId && view?.levelRecordId === levelRecordId

  const [levelIssues, setLevelIssues] = useState<ValidationIssue[] | null>(null)
  const [busyCurrent, setBusyCurrent] = useState(false)
  // Raw all-levels inputs are cached so the sweep can recompute locally.
  const [allInputs, setAllInputs] = useState<
    Awaited<ReturnType<typeof window.shinyEgg.validation.allLevels>> | null
  >(null)
  const [busyAll, setBusyAll] = useState(false)
  const [allError, setAllError] = useState<string | null>(null)

  const runCurrent = useCallback(async (): Promise<void> => {
    // Don't run (and clear any prior result) until the level is fully loaded —
    // `ready` guarantees `loaded`/`view` reflect the selected level.
    if (!ready || !loaded || !view || levelRecordId === null) {
      setLevelIssues(null)
      return
    }
    setBusyCurrent(true)
    try {
      const signals = await window.shinyEgg.validation.signals(loaded)
      const issues = [
        ...checkLevelCore(loaded, signals, levelRecordId),
        ...renderValidityIssues(loaded, view, levelRecordId)
      ].sort(bySeverity)
      setLevelIssues(issues)
    } catch {
      setLevelIssues(null)
    } finally {
      setBusyCurrent(false)
    }
  }, [ready, loaded, levelRecordId, view])

  // Run once the level becomes fully loaded (and when the probe re-resolves, e.g.
  // after a header edit) — not on every edit. While loading, `ready` is false so
  // runCurrent clears the stale result. A ref keeps the latest closure without
  // re-firing on each keystroke.
  const runRef = useRef(runCurrent)
  runRef.current = runCurrent
  useEffect(() => {
    void runRef.current()
  }, [ready, levelRecordId, view])

  const runAll = useCallback(async (): Promise<void> => {
    setBusyAll(true)
    setAllError(null)
    try {
      setAllInputs(await window.shinyEgg.validation.allLevels())
    } catch (e) {
      setAllError(e instanceof Error ? e.message : 'Validation failed — build the ROM first.')
      setAllInputs(null)
    } finally {
      setBusyAll(false)
    }
  }, [])

  // Recompute the sweep from cached inputs.
  const allResult: AllLevelsValidationResult | null = useMemo(
    () => (allInputs ? validateAll(allInputs, (rec) => levelLabel(rec, 'hex')) : null),
    [allInputs]
  )

  const currentResult =
    loaded && levelRecordId !== null && levelIssues && counts
      ? summarizeLevel(levelRecordId, levelLabel(levelRecordId), levelIssues, counts)
      : null

  return (
    <div className="se-validation">
      {/* Collectible tally — the Advynia "Count Items" readout. */}
      <div className="se-validation__counts">
        {counts ? (
          <>
            <span className="se-validation__count" title="Flowers (sprite 0x0FA / 0x110)">
              <span className="se-validation__count-icon se-validation__count-icon--flower" />
              {counts.flowers} <em>flowers</em>
            </span>
            <span className="se-validation__count" title="Red coins (sprite 0x065)">
              <span className="se-validation__count-icon se-validation__count-icon--redcoin" />
              {counts.redCoins} <em>red coins</em>
            </span>
            <span className="se-validation__count" title="Coins (floating-coin sprite + coin objects)">
              <span className="se-validation__count-icon se-validation__count-icon--coin" />
              {counts.coins} <em>coins</em>
            </span>
          </>
        ) : (
          <span className="se-validation__empty">No level loaded.</span>
        )}
      </div>

      <div className="se-validation__actions">
        <button type="button" onClick={() => void runCurrent()} disabled={!ready || busyCurrent}>
          {busyCurrent ? 'Checking…' : 'Check this level'}
        </button>
        <button type="button" onClick={() => void runAll()} disabled={busyAll}>
          {busyAll ? 'Checking all…' : 'Check all levels'}
        </button>
      </div>

      <div className="se-validation__scroll">
        {/* Current level */}
        <section className="se-validation__section">
          <h3 className="se-validation__heading">
            This level
            {currentResult && (
              <span className="se-validation__tally">
                {currentResult.errorCount > 0 && (
                  <span className="se-validation__chip se-validation__chip--error">
                    {currentResult.errorCount} error{currentResult.errorCount !== 1 ? 's' : ''}
                  </span>
                )}
                {currentResult.warningCount > 0 && (
                  <span className="se-validation__chip se-validation__chip--warning">
                    {currentResult.warningCount} warning{currentResult.warningCount !== 1 ? 's' : ''}
                  </span>
                )}
                {currentResult.errorCount === 0 && currentResult.warningCount === 0 && (
                  <span className="se-validation__chip se-validation__chip--ok">No issues</span>
                )}
              </span>
            )}
          </h3>
          {currentResult && currentResult.issues.length > 0 ? (
            <ul className="se-validation__list">
              {currentResult.issues.map((issue, i) => (
                <IssueRow key={`${issue.check}-${i}`} issue={issue} onJump={onJump} />
              ))}
            </ul>
          ) : currentResult ? (
            <p className="se-validation__empty">No issues found in this level.</p>
          ) : levelRecordId !== null ? (
            <p className="se-validation__empty">Loading level…</p>
          ) : (
            <p className="se-validation__empty">Load a level to check it.</p>
          )}
        </section>

        {/* All levels */}
        {(allResult || allError) && (
          <section className="se-validation__section">
            <h3 className="se-validation__heading">
              All levels
              {allResult && (
                <span className="se-validation__tally">
                  <span className="se-validation__chip se-validation__chip--error">
                    {allResult.totalErrors} error{allResult.totalErrors !== 1 ? 's' : ''}
                  </span>
                  <span className="se-validation__chip se-validation__chip--warning">
                    {allResult.totalWarnings} warning{allResult.totalWarnings !== 1 ? 's' : ''}
                  </span>
                  <span className="se-validation__muted">
                    {allResult.levelsChecked} levels checked
                  </span>
                </span>
              )}
            </h3>
            {allError && <p className="se-validation__error">{allError}</p>}
            {allResult && allResult.levels.length === 0 && allResult.crossLevel.length === 0 && (
              <p className="se-validation__empty">No issues found across any level. 🎉</p>
            )}
            {allResult?.crossLevel.length ? (
              <div className="se-validation__level-group">
                <div className="se-validation__level-name">Cross-level</div>
                <ul className="se-validation__list">
                  {allResult.crossLevel
                    .slice()
                    .sort(bySeverity)
                    .map((issue, i) => (
                      <IssueRow key={`x-${i}`} issue={issue} onJump={onJump} />
                    ))}
                </ul>
              </div>
            ) : null}
            {allResult?.levels.map((lvl) => (
              <div className="se-validation__level-group" key={lvl.levelRecordId}>
                <button
                  type="button"
                  className="se-validation__level-name se-validation__level-name--jump"
                  title="Open this level"
                  onClick={() => onJump(lvl.levelRecordId, 0, 0)}
                >
                  {lvl.name ?? hx(lvl.levelRecordId)}
                  {lvl.errorCount > 0 && (
                    <span className="se-validation__chip se-validation__chip--error">
                      {lvl.errorCount}
                    </span>
                  )}
                  {lvl.warningCount > 0 && (
                    <span className="se-validation__chip se-validation__chip--warning">
                      {lvl.warningCount}
                    </span>
                  )}
                </button>
                <ul className="se-validation__list">
                  {lvl.issues.map((issue, i) => (
                    <IssueRow key={`${lvl.levelRecordId}-${i}`} issue={issue} onJump={onJump} />
                  ))}
                </ul>
              </div>
            ))}
            {allResult && (
              <p className="se-validation__muted se-validation__note">
                The sweep runs the structural / gameplay lints, including cross-level
                item-memory collisions. Per-tile render validity is checked for the current
                level only (shown on the Picker badges).
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
