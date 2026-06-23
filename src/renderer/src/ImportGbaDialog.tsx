import { useEffect, useState, type JSX } from 'react'
import type { GbaImportApplyResult, GbaImportReport, GbaImportSublevel } from '../../preload/api'
import { hex0x } from './lib/hex'

export interface ImportGbaDialogProps {
  open: boolean
  /** Name of the project being imported into (for display + the empty guard). */
  projectName: string | null
  onClose: () => void
  /** Fired after a successful apply so App marks the build dirty + reloads the
   *  current level (its overlay may have just been overwritten). */
  onImported: () => void
}

type Phase = 'idle' | 'analyzing' | 'report' | 'applying' | 'done'

/** Human labels for the engine warning kinds (sublevel.ts ImportWarning.kind). */
const WARN_LABEL: Record<string, string> = {
  'camera-sprite-dropped': 'camera sprites dropped',
  'sprite-extid-dropped': 'sprite params dropped',
  'custom-object-dropped': 'custom objects dropped',
  'header-truncated': 'header/object reconciled'
}

function hex(n: number): string {
  return hex0x(n, 2)
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** Parse a user-typed hex byte (no `0x`), clamped to 0x00..0xFF, or null. */
function parseByte(s: string): number | null {
  const n = parseInt(s.replace(/^0x/i, ''), 16)
  if (Number.isNaN(n) || n < 0 || n > 0xff) return null
  return n
}

/**
 * The "import a level from the GBA version (Super Mario Advance 3)" window.
 * A modal wizard: pick an SMA3 (U) `.gba` cart → analyse (list its importable
 * sublevels) → select sublevels + their target SNES records → apply (overwrite
 * those records in the project overlay). SMA3 is a port of YI, so the data
 * converts near-1:1; graphics are NOT imported (levels use the project's SNES
 * tilesets), and camera sprites / a few custom objects are dropped.
 */
export function ImportGbaDialog({
  open,
  projectName,
  onClose,
  onImported
}: ImportGbaDialogProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle')
  const [report, setReport] = useState<GbaImportReport | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  /** sublevelId → target SNES recordId (defaults to the sublevel id). */
  const [targets, setTargets] = useState<Record<number, number>>({})
  const [filter, setFilter] = useState('')
  const [applyResult, setApplyResult] = useState<GbaImportApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** SNES recordId → friendly level name, for the target column. */
  const [names, setNames] = useState<Record<number, string>>({})

  // Reset on each open; fetch the catalog for friendly target names.
  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setReport(null)
    setSelected(new Set())
    setTargets({})
    setFilter('')
    setApplyResult(null)
    setError(null)
    void window.shinyEgg.getLevelsCatalog().then((cat) => {
      if (!cat) return
      const map: Record<number, string> = {}
      for (const g of cat.groups) {
        for (const e of g.levels) {
          if (e.recordId !== null) map[e.recordId] = e.name
        }
      }
      setNames(map)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && phase !== 'analyzing' && phase !== 'applying') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, phase, onClose])

  if (!open) return null

  async function analyze(): Promise<void> {
    setError(null)
    setPhase('analyzing')
    try {
      const r = await window.shinyEgg.importGba.analyze()
      if (r === null) {
        setPhase('idle')
        return
      }
      if (!r.ok) {
        setError(r.error)
        setPhase('idle')
        return
      }
      setReport(r)
      setSelected(new Set())
      setTargets({})
      setPhase('report')
    } catch (err) {
      setError((err as Error).message)
      setPhase('idle')
    }
  }

  function toggle(sid: number): void {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(sid)) next.delete(sid)
      else next.add(sid)
      return next
    })
  }

  const targetOf = (sid: number): number => targets[sid] ?? sid

  async function apply(): Promise<void> {
    if (!report?.ok || selected.size === 0) return
    setPhase('applying')
    try {
      const items = [...selected].map((sid) => ({ sublevelId: sid, targetRecordId: targetOf(sid) }))
      const res = await window.shinyEgg.importGba.apply({ filePath: report.filePath, items })
      setApplyResult(res)
      if (res.ok && res.applied.length > 0) onImported()
      setPhase('done')
    } catch (err) {
      setApplyResult({ ok: false, error: (err as Error).message })
      setPhase('done')
    }
  }

  const sublevels: GbaImportSublevel[] = report?.ok ? report.sublevels : []
  const q = filter.trim().toLowerCase().replace(/^0x/, '')
  const filtered = q ? sublevels.filter((s) => s.sublevelId.toString(16).padStart(2, '0').includes(q)) : sublevels
  const busy = phase === 'analyzing' || phase === 'applying'

  return (
    <div className="se-modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="se-modal se-modal--import" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="se-modal__title">Import level from GBA</h3>

        <div className="se-import__body">
          {projectName === null && (
            <p className="se-import__warn">No active project — create or open one first.</p>
          )}

          {(phase === 'idle' || phase === 'analyzing') && (
            <div className="se-import__intro">
              <p>
                Pick a <strong>Super Mario Advance 3</strong> (USA) GBA cart. SMA3 is the GBA port of
                Yoshi’s Island, so its level layouts convert almost 1:1 — import a sublevel to
                <strong> overwrite</strong> a level in{' '}
                <strong>{projectName ?? 'your project'}</strong>.
              </p>
              <p className="se-meta se-import__hint">
                Imports object/sprite/exit placements + the level header. Graphics aren’t imported —
                the level uses your project’s SNES tilesets, so visuals may differ. GBA-only camera
                sprites and a few custom objects are dropped.
              </p>
              {error && <p className="se-import__error">{error}</p>}
              <button
                type="button"
                className="se-btn is-primary"
                onClick={() => void analyze()}
                disabled={phase === 'analyzing' || projectName === null}
              >
                {phase === 'analyzing' ? 'Reading cart…' : 'Choose GBA ROM…'}
              </button>
            </div>
          )}

          {phase !== 'idle' && phase !== 'analyzing' && report?.ok && (
            <>
              <p className="se-import__file">
                <strong>{baseName(report.filePath)}</strong>
                <span className="se-meta-xs se-import__md5">
                  {report.title.trim()} · {report.gameCode} · crc {report.crc32}
                </span>
              </p>

              {phase === 'report' && (
                <>
                  <p className="se-import__counts">
                    {sublevels.length} importable sublevel{sublevels.length === 1 ? '' : 's'}.
                    Pick which to import and the SNES record each overwrites (defaults to the same id).
                  </p>
                  <div className="se-import__selrow">
                    <input
                      className="se-input se-projmenu__input"
                      style={{ flex: 1 }}
                      placeholder="Filter by id (hex)…"
                      value={filter}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <button
                      type="button"
                      className="se-linkbtn"
                      onClick={() => setSelected(new Set(filtered.map((s) => s.sublevelId)))}
                    >
                      Select shown
                    </button>
                    <button type="button" className="se-linkbtn" onClick={() => setSelected(new Set())}>
                      Select none
                    </button>
                  </div>
                </>
              )}

              <div className="se-import__list">
                {filtered.map((s) => {
                  const checked = selected.has(s.sublevelId)
                  const tgt = targetOf(s.sublevelId)
                  return (
                    <div
                      key={s.sublevelId}
                      className="se-import__row"
                      style={{ opacity: phase === 'report' || checked ? 1 : 0.5 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={phase !== 'report'}
                        onChange={() => toggle(s.sublevelId)}
                      />
                      <span className="se-import__rowid">{hex(s.sublevelId)}</span>
                      <span className="se-import__rowname" title={names[s.sublevelId] ?? ''}>
                        {names[s.sublevelId] ?? '—'}
                      </span>
                      <span className="se-import__rowcounts">
                        {s.objects}/{s.sprites}/{s.exits}
                      </span>
                      <span className="se-import__rowtags">
                        {(s.spritesDropped > 0 || s.objectsDropped > 0 || s.warnings.length > 0) && (
                          <span
                            className="se-import__tag se-import__tag--warn"
                            title={s.warnings.map((w) => WARN_LABEL[w] ?? w).join('\n')}
                          >
                            {s.spritesDropped > 0 ? `−${s.spritesDropped} spr` : 'note'}
                          </span>
                        )}
                      </span>
                      <span className="se-import__rowtarget">
                        →{' '}
                        <span className="se-import__rowprefix">0x</span>
                        <input
                          className="se-input se-import__hexinput"
                          value={tgt.toString(16).toUpperCase().padStart(2, '0')}
                          spellCheck={false}
                          autoComplete="off"
                          disabled={phase !== 'report' || !checked}
                          onChange={(e) => {
                            const b = parseByte(e.target.value)
                            if (b !== null) setTargets((t) => ({ ...t, [s.sublevelId]: b }))
                          }}
                        />
                        <span className="se-import__rowtargetname">{names[tgt] ?? '(unnamed)'}</span>
                      </span>
                    </div>
                  )
                })}
              </div>

              {phase === 'applying' && <p className="se-meta se-import__hint">Importing…</p>}

              {phase === 'done' && applyResult && (
                <div className="se-import__result">
                  {applyResult.ok ? (
                    <>
                      {applyResult.applied.length > 0 ? (
                        <p>
                          Imported <strong>{applyResult.applied.length}</strong> level
                          {applyResult.applied.length === 1 ? '' : 's'}:{' '}
                          {applyResult.applied
                            .map((a) => `${hex(a.sublevelId)} → ${hex(a.targetRecordId)}`)
                            .join(', ')}
                          .
                        </p>
                      ) : (
                        <p>No levels imported.</p>
                      )}
                      {applyResult.applied.some((a) => a.warnings.length > 0) && (
                        <details className="se-import__anchors">
                          <summary>Conversion notes</summary>
                          <div className="se-import__anchortable">
                            {applyResult.applied
                              .filter((a) => a.warnings.length > 0)
                              .map((a) => (
                                <div key={a.targetRecordId} className="se-import__anchorrow">
                                  <span className="se-import__anchorname">
                                    {hex(a.sublevelId)} → {hex(a.targetRecordId)}
                                  </span>
                                  <span className="se-import__conf" title={a.warnings.join('\n')}>
                                    {a.warnings.length} note{a.warnings.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </details>
                      )}
                      {applyResult.failed.length > 0 && (
                        <div className="se-import__failed">
                          {applyResult.failed.map((f) => (
                            <p key={f.targetRecordId} className="se-import__error">
                              {hex(f.targetRecordId)} — {f.error}
                            </p>
                          ))}
                        </div>
                      )}
                      {applyResult.applied.length > 0 && (
                        <p className="se-meta se-import__hint">
                          Rebuild (Test Level / Launch) to see the changes in-game.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="se-import__error">Import failed: {applyResult.error}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="se-modal__actions">
          {phase === 'report' && report?.ok && (
            <button
              type="button"
              className="se-btn is-primary"
              onClick={() => void apply()}
              disabled={selected.size === 0}
            >
              {selected.size > 0 ? `Import ${selected.size} selected` : 'Import selected'}
            </button>
          )}
          <button type="button" className="se-btn" onClick={onClose} disabled={busy}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
