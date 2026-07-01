import { useEffect, useState, type JSX } from 'react'
import type {
  RomImportApplyResult,
  RomImportInventory,
  RomImportLevel,
  RomImportReport
} from '../../preload/api'
import { hex0x } from './lib/hex'

export interface ImportRomDialogProps {
  open: boolean
  /** Name of the project being imported into (for display + the empty guard). */
  projectName: string | null
  onClose: () => void
  /** Fired after a successful apply so App marks the build dirty + reloads.
   *  `removedVanillaIds` carries the records the optional "remove all vanilla
   *  levels" pass took out (empty/absent when the option was off), so App can
   *  navigate away if the open level was among them. */
  onImported: (removedVanillaIds?: number[]) => void
}

type Phase = 'idle' | 'analyzing' | 'report' | 'applying' | 'done'

/** The non-level "global" import categories — each one checkbox in the report. */
type CatKey =
  | 'palette'
  | 'names'
  | 'messages'
  | 'worldMap'
  | 'gradient'
  | 'yoshiColors'
  | 'islandTilemap'
  | 'logoTilemap'
  | 'introStory'
  | 'endingText'
  | 'graphics'

const NO_CATS: Record<CatKey, boolean> = {
  palette: false,
  names: false,
  messages: false,
  worldMap: false,
  gradient: false,
  yoshiColors: false,
  islandTilemap: false,
  logoTilemap: false,
  introStory: false,
  endingText: false,
  graphics: false
}

function hex(n: number): string {
  return hex0x(n, 2)
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * The "import from a modified ROM" window. A modal wizard:
 * pick a `.sfc` → analyse (diff vs the extracted V1.0 base) → review the
 * re-identified memory locations + the per-level change set (with overwrite
 * warnings) → apply the selected records into the project overlay.
 */
export function ImportRomDialog({
  open,
  projectName,
  onClose,
  onImported
}: ImportRomDialogProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle')
  const [report, setReport] = useState<RomImportReport | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [cats, setCats] = useState<Record<CatKey, boolean>>(NO_CATS)
  const toggleCat = (k: CatKey): void => setCats((c) => ({ ...c, [k]: !c[k] }))
  const anyCat = Object.values(cats).some(Boolean)
  const [selUnblock, setSelUnblock] = useState(false)
  const [applyResult, setApplyResult] = useState<RomImportApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [names, setNames] = useState<Record<number, string>>({})

  // Reset on each open; fetch the catalog for friendly level names.
  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setReport(null)
    setSelected(new Set())
    setCats(NO_CATS)
    setSelUnblock(false)
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
      const r = await window.shinyEgg.importRom.analyze()
      if (r === null) {
        // Dialog cancelled — back to idle.
        setPhase('idle')
        return
      }
      if (!r.ok) {
        setError(r.error)
        setPhase('idle')
        return
      }
      setReport(r)
      // Default-select importable, non-conflicting levels. "Unblock imports"
      // defaults ON, so resolvably-blocked levels are selectable + default-
      // selected too. Conflicts (already edited in this project) stay OFF so the
      // user opts into overwriting.
      const def = new Set<number>(
        r.levels
          .filter((l) => (l.importability !== 'blocked' || !!l.unblockAction) && !l.hasOverlayConflict)
          .map((l) => l.recordId)
      )
      setSelected(def)
      setSelUnblock(true)
      setCats({
        palette: r.palette.changedWords > 0,
        names: r.names.changed > 0 && !r.names.overBudget,
        messages: (r.messages.changed > 0 || r.messages.blanked > 0) && !r.messages.overBudget,
        worldMap: r.worldMap.entrances > 0 || r.worldMap.midway > 0 || r.worldMap.indexRemaps > 0,
        gradient: r.gradient.changedStops > 0,
        yoshiColors: r.yoshiColors.changed > 0,
        islandTilemap: r.islandTilemap.changedCells > 0,
        logoTilemap: r.logoTilemap.changedCells > 0,
        introStory: r.introStory.changed > 0 && !r.introStory.overBudget,
        endingText: r.endingText.changed > 0 && !r.endingText.overBudget,
        graphics: r.graphics.changed > 0 || r.graphics.rawFiles > 0
      })
      setPhase('report')
    } catch (err) {
      setError((err as Error).message)
      setPhase('idle')
    }
  }

  async function apply(): Promise<void> {
    if (selected.size === 0 && !anyCat) return
    setPhase('applying')
    try {
      const res = await window.shinyEgg.importRom.apply({
        recordIds: [...selected],
        ...cats,
        unblock: selUnblock
      })
      setApplyResult(res)
      // The import removes the levels the hack itself emptied (default), returned
      // in `emptiedRemoved` — pass them on so App navigates away if the open level
      // was among them.
      if (res.ok) onImported(res.emptiedRemoved.removed)
      setPhase('done')
    } catch (err) {
      setApplyResult({ ok: false, error: (err as Error).message })
      setPhase('done')
    }
  }

  function toggle(recordId: number): void {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  function selectableIds(unblockOn: boolean = selUnblock): number[] {
    return (report?.ok ? report.levels : [])
      .filter((l) => l.importability !== 'blocked' || (unblockOn && l.unblockAction))
      .map((l) => l.recordId)
  }

  // Toggling "unblock" flips the unblockable levels in/out of the selection:
  // ON default-selects them (unless they'd overwrite an existing edit), OFF
  // deselects them (they'd just fail the save gate otherwise).
  function toggleUnblock(): void {
    const next = !selUnblock
    setSelUnblock(next)
    const unblockables = (report?.ok ? report.levels : []).filter(
      (l) => l.importability === 'blocked' && l.unblockAction
    )
    setSelected((s) => {
      const out = new Set(s)
      for (const l of unblockables) {
        if (next && !l.hasOverlayConflict) out.add(l.recordId)
        else if (!next) out.delete(l.recordId)
      }
      return out
    })
  }

  // Backdrop is intentionally NOT click-to-close — the import is a multi-step
  // review the user shouldn't lose to a stray outside click. Dismiss via the
  // Cancel button or Escape (the keydown handler above).
  return (
    <div className="se-modal-backdrop">
      <div className="se-modal se-modal--import">
        <h3 className="se-modal__title">Import from modified ROM</h3>

        <div className="se-import__body">
          {projectName === null && (
            <p className="se-import__warn">No active project — create or open one first.</p>
          )}

          {(phase === 'idle' || phase === 'analyzing') && (
            <div className="se-import__intro">
              <p>
                Pick an already-modified Yoshi’s Island ROM (a built <code>.sfc</code> hack based on
                USA&nbsp;V1.0). Shiny&nbsp;Egg re-locates the cart’s key tables, diffs the level data
                against your extracted base, and imports the changed levels into{' '}
                <strong>{projectName ?? 'your project'}</strong> as editable overlays.
              </p>
              <p className="se-meta se-import__hint">
                Imports level object/sprite/exit placements, world-map spawns &amp; level
                progression, palette colors &amp; backdrop gradients, per-level Yoshi colors,
                graphics (GFX sheets), title-screen island/logo layouts, level-name strings,
                message-box text, and intro/ending cutscene text. Map16 page tables and custom
                code are not yet imported.
              </p>
              {error && <p className="se-import__error">{error}</p>}
              <button
                type="button"
                className="se-btn is-primary"
                onClick={() => void analyze()}
                disabled={phase === 'analyzing' || projectName === null}
              >
                {phase === 'analyzing' ? 'Analysing…' : 'Choose ROM…'}
              </button>
            </div>
          )}

          {/* Import log moved to the TOP of the panel: the apply outcome shows
              first once the import runs, above the (still-visible) report. */}
          {phase === 'applying' && <p className="se-meta se-import__hint">Applying…</p>}
          {phase === 'done' && applyResult && <ImportLog applyResult={applyResult} />}

          {phase !== 'idle' && phase !== 'analyzing' && report?.ok && (
            <ReportView
              report={report}
              names={names}
              selected={selected}
              onToggle={toggle}
              onSelect={(ids) => setSelected(new Set(ids))}
              selectable={selectableIds()}
              cats={cats}
              onToggleCat={toggleCat}
              phase={phase}
              unblockOn={selUnblock}
              onToggleUnblock={toggleUnblock}
            />
          )}
        </div>

        <div className="se-modal__actions">
          {phase === 'report' && report?.ok && (
            <button
              type="button"
              className="se-btn is-primary"
              onClick={() => void apply()}
              disabled={selected.size === 0 && !anyCat}
            >
              Import selected
            </button>
          )}
          <button
            type="button"
            className="se-btn"
            onClick={onClose}
            disabled={phase === 'analyzing' || phase === 'applying'}
          >
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ReportViewProps {
  report: Extract<RomImportReport, { ok: true }>
  names: Record<number, string>
  selected: Set<number>
  onToggle: (recordId: number) => void
  onSelect: (ids: number[]) => void
  selectable: number[]
  /** The non-level category toggles + a single toggler. */
  cats: Record<CatKey, boolean>
  onToggleCat: (k: CatKey) => void
  phase: Phase
  /** The "unblock imports" option — makes resolvable-blocked levels selectable. */
  unblockOn: boolean
  onToggleUnblock: () => void
}

function ReportView({
  report,
  names,
  selected,
  onToggle,
  onSelect,
  selectable,
  cats,
  onToggleCat,
  phase,
  unblockOn,
  onToggleUnblock
}: ReportViewProps): JSX.Element {
  return (
    <>
      <p className="se-import__file">
        <strong>{baseName(report.foreignPath)}</strong>
        <span className="se-meta-xs se-import__md5">md5 {report.foreignMd5}</span>
      </p>

      {!report.baseDerived && (
        <p className="se-import__warn">
          ⚠ This ROM’s engine constants differ from USA&nbsp;V1.0 — it may not be a V1.0-based hack.
          Import results may be unreliable.
        </p>
      )}

      <AnchorsTable report={report} />

      {report.inventory && <InventoryTable inventory={report.inventory} />}

      {(report.palette.changedWords > 0 ||
        report.names.changed > 0 ||
        report.names.skipped > 0 ||
        report.messages.changed > 0 ||
        report.messages.skipped > 0 ||
        report.worldMap.entrances > 0 ||
        report.worldMap.midway > 0 ||
        report.worldMap.indexRemaps > 0 ||
        report.gradient.changedStops > 0 ||
        report.yoshiColors.changed > 0 ||
        report.islandTilemap.changedCells > 0 ||
        report.logoTilemap.changedCells > 0 ||
        report.introStory.changed > 0 ||
        report.introStory.skipped > 0 ||
        report.endingText.changed > 0 ||
        report.endingText.skipped > 0 ||
        report.graphics.changed > 0 ||
        report.graphics.skipped > 0) && (
        <div className="se-import__cats">
          {report.palette.changedWords > 0 && (
            <label className="se-import__cat">
              <input
                type="checkbox"
                checked={cats.palette}
                disabled={phase !== 'report'}
                onChange={() => onToggleCat('palette')}
              />
              <span className="se-import__catname">Palette colors</span>
              <span className="se-import__catinfo">
                {report.palette.changedWords} changed
                {report.palette.conflicts > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="These colors are also edited in your project — importing overwrites them.">
                    {report.palette.conflicts} overwrite
                  </span>
                )}
              </span>
            </label>
          )}
          {(report.names.changed > 0 || report.names.skipped > 0) && (
            <label
              className={`se-import__cat${report.names.changed === 0 || report.names.overBudget ? ' is-blocked' : ''}`}
            >
              <input
                type="checkbox"
                checked={cats.names}
                disabled={phase !== 'report' || report.names.changed === 0 || report.names.overBudget}
                onChange={() => onToggleCat('names')}
              />
              <span className="se-import__catname">Level names</span>
              <span className="se-import__catinfo">
                {report.names.changed} changed
                {report.names.skipped > 0 ? ` · ${report.names.skipped} skipped` : ''}
                {report.names.overBudget && (
                  <span className="se-import__tag se-import__tag--blocked" title="The imported names don't fit the cart's fixed name byte budget.">
                    over budget
                  </span>
                )}
                {report.names.hasConflict && report.names.changed > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="Layers on top of your existing name edits.">
                    your edits
                  </span>
                )}
              </span>
            </label>
          )}
          {(report.messages.changed > 0 ||
            report.messages.blanked > 0 ||
            report.messages.skipped > 0) && (
            <label
              className={`se-import__cat${(report.messages.changed === 0 && report.messages.blanked === 0) || report.messages.overBudget ? ' is-blocked' : ''}`}
            >
              <input
                type="checkbox"
                checked={cats.messages}
                disabled={
                  phase !== 'report' ||
                  (report.messages.changed === 0 && report.messages.blanked === 0) ||
                  report.messages.overBudget
                }
                onChange={() => onToggleCat('messages')}
              />
              <span className="se-import__catname">Message text</span>
              <span className="se-import__catinfo">
                {report.messages.changed} changed
                {report.messages.blanked > 0 ? ` · ${report.messages.blanked} blanked` : ''}
                {report.messages.duplicates > 0 ? ` · ${report.messages.duplicates} dup ignored` : ''}
                {report.messages.skipped > 0 ? ` · ${report.messages.skipped} skipped` : ''}
                {report.messages.overBudget && (
                  <span className="se-import__tag se-import__tag--blocked" title="The imported messages don't fit the cart's fixed message byte budget, even after deduping shared messages.">
                    over budget
                  </span>
                )}
                {report.messages.hasConflict &&
                  (report.messages.changed > 0 || report.messages.blanked > 0) && (
                    <span className="se-import__tag se-import__tag--warn" title="Layers on top of your existing message edits.">
                      your edits
                    </span>
                  )}
              </span>
            </label>
          )}
          {(report.worldMap.entrances > 0 ||
            report.worldMap.midway > 0 ||
            report.worldMap.indexRemaps > 0) && (
            <label className="se-import__cat">
              <input
                type="checkbox"
                checked={cats.worldMap}
                disabled={phase !== 'report'}
                onChange={() => onToggleCat('worldMap')}
              />
              <span className="se-import__catname">World map</span>
              <span className="se-import__catinfo">
                {[
                  report.worldMap.entrances > 0 &&
                    `${report.worldMap.entrances} entrance${report.worldMap.entrances === 1 ? '' : 's'}`,
                  report.worldMap.midway > 0 &&
                    `${report.worldMap.midway} checkpoint${report.worldMap.midway === 1 ? '' : 's'}`,
                  report.worldMap.indexRemaps > 0 && `${report.worldMap.indexRemaps} slot remap${report.worldMap.indexRemaps === 1 ? '' : 's'}`,
                  report.worldMap.indexSkipped > 0 && `${report.worldMap.indexSkipped} remap${report.worldMap.indexSkipped === 1 ? '' : 's'} skipped`
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {report.worldMap.hasConflict && (
                  <span className="se-import__tag se-import__tag--warn" title="Layers on top of your existing world-map edits.">
                    your edits
                  </span>
                )}
              </span>
            </label>
          )}
          {report.gradient.changedStops > 0 && (
            <label className="se-import__cat">
              <input
                type="checkbox"
                checked={cats.gradient}
                disabled={phase !== 'report'}
                onChange={() => onToggleCat('gradient')}
              />
              <span className="se-import__catname">Backdrop gradients</span>
              <span className="se-import__catinfo">
                {report.gradient.changedStops} stop{report.gradient.changedStops === 1 ? '' : 's'} changed
                {report.gradient.conflicts > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="These gradient stops are also edited in your project — importing overwrites them.">
                    {report.gradient.conflicts} overwrite
                  </span>
                )}
              </span>
            </label>
          )}
          {report.yoshiColors.changed > 0 && (
            <label className="se-import__cat">
              <input
                type="checkbox"
                checked={cats.yoshiColors}
                disabled={phase !== 'report'}
                onChange={() => onToggleCat('yoshiColors')}
              />
              <span className="se-import__catname">Yoshi level colors</span>
              <span className="se-import__catinfo">
                {report.yoshiColors.changed} level{report.yoshiColors.changed === 1 ? '' : 's'} changed
                {report.yoshiColors.conflicts > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="These levels' Yoshi colors are also edited in your project — importing overwrites them.">
                    {report.yoshiColors.conflicts} overwrite
                  </span>
                )}
              </span>
            </label>
          )}
          {report.islandTilemap.changedCells > 0 && (
            <label className="se-import__cat">
              <input
                type="checkbox"
                checked={cats.islandTilemap}
                disabled={phase !== 'report'}
                onChange={() => onToggleCat('islandTilemap')}
              />
              <span className="se-import__catname">Title island layout</span>
              <span className="se-import__catinfo">
                {report.islandTilemap.changedCells} cell{report.islandTilemap.changedCells === 1 ? '' : 's'} changed
                {report.islandTilemap.conflicts > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="These island cells are also edited in your project — importing overwrites them.">
                    {report.islandTilemap.conflicts} overwrite
                  </span>
                )}
              </span>
            </label>
          )}
          {report.logoTilemap.changedCells > 0 && (
            <label className="se-import__cat">
              <input
                type="checkbox"
                checked={cats.logoTilemap}
                disabled={phase !== 'report'}
                onChange={() => onToggleCat('logoTilemap')}
              />
              <span className="se-import__catname">Title logo layout</span>
              <span className="se-import__catinfo">
                {report.logoTilemap.changedCells} cell{report.logoTilemap.changedCells === 1 ? '' : 's'} changed
                {report.logoTilemap.conflicts > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="These logo cells are also edited in your project — importing overwrites them.">
                    {report.logoTilemap.conflicts} overwrite
                  </span>
                )}
              </span>
            </label>
          )}
          {(report.introStory.changed > 0 || report.introStory.skipped > 0) && (
            <label
              className={`se-import__cat${report.introStory.changed === 0 || report.introStory.overBudget ? ' is-blocked' : ''}`}
            >
              <input
                type="checkbox"
                checked={cats.introStory}
                disabled={phase !== 'report' || report.introStory.changed === 0 || report.introStory.overBudget}
                onChange={() => onToggleCat('introStory')}
              />
              <span className="se-import__catname">Intro story</span>
              <span className="se-import__catinfo">
                {report.introStory.changed} changed
                {report.introStory.skipped > 0 ? ` · ${report.introStory.skipped} skipped` : ''}
                {report.introStory.overBudget && (
                  <span className="se-import__tag se-import__tag--blocked" title="The imported intro text doesn't fit the cart's fixed byte budget.">
                    over budget
                  </span>
                )}
                {report.introStory.hasConflict && report.introStory.changed > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="Layers on top of your existing intro-story edits.">
                    your edits
                  </span>
                )}
              </span>
            </label>
          )}
          {(report.endingText.changed > 0 || report.endingText.skipped > 0) && (
            <label
              className={`se-import__cat${report.endingText.changed === 0 || report.endingText.overBudget ? ' is-blocked' : ''}`}
            >
              <input
                type="checkbox"
                checked={cats.endingText}
                disabled={phase !== 'report' || report.endingText.changed === 0 || report.endingText.overBudget}
                onChange={() => onToggleCat('endingText')}
              />
              <span className="se-import__catname">Ending text</span>
              <span className="se-import__catinfo">
                {report.endingText.changed} changed
                {report.endingText.skipped > 0 ? ` · ${report.endingText.skipped} skipped` : ''}
                {report.endingText.overBudget && (
                  <span className="se-import__tag se-import__tag--blocked" title="The imported ending text doesn't fit the cart's fixed byte budget.">
                    over budget
                  </span>
                )}
                {report.endingText.hasConflict && report.endingText.changed > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="Layers on top of your existing ending-text edits.">
                    your edits
                  </span>
                )}
              </span>
            </label>
          )}
          {(report.graphics.changed > 0 ||
            report.graphics.rawFiles > 0 ||
            report.graphics.skipped > 0) && (
            <label
              className={`se-import__cat${report.graphics.changed === 0 && report.graphics.rawFiles === 0 ? ' is-blocked' : ''}`}
            >
              <input
                type="checkbox"
                checked={cats.graphics}
                disabled={
                  phase !== 'report' ||
                  (report.graphics.changed === 0 && report.graphics.rawFiles === 0)
                }
                onChange={() => onToggleCat('graphics')}
              />
              <span className="se-import__catname">Graphics</span>
              <span className="se-import__catinfo">
                {report.graphics.changed} sheet{report.graphics.changed === 1 ? '' : 's'} changed
                {report.graphics.rawFiles > 0 ? ` · ${report.graphics.rawFiles} raw CHR` : ''}
                {report.graphics.skipped > 0 ? ` · ${report.graphics.skipped} skipped` : ''}
                {report.graphics.conflicts > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="These sheets are also gfx-edited in your project — importing overwrites them.">
                    {report.graphics.conflicts} overwrite
                  </span>
                )}
              </span>
            </label>
          )}
        </div>
      )}

      {!report.levelPtrsResolved ? (
        <p className="se-import__error">
          Could not locate the level-data pointer table at its expected address — this hack relocated
          or fully repointed it. Level import isn’t possible for this ROM yet (signature/scan
          re-anchoring is planned).
        </p>
      ) : (
        <>
          <p className="se-import__counts">
            {report.counts.changed} changed level{report.counts.changed === 1 ? '' : 's'}:{' '}
            <span className="se-import__pill se-import__pill--full">{report.counts.full} importable</span>
            {report.counts.rawOnly > 0 && (
              <span className="se-import__pill se-import__pill--raw">{report.counts.rawOnly} raw-only</span>
            )}
            {report.counts.emptied > 0 && (
              <span
                className="se-import__pill se-import__pill--emptied"
                title="Levels the hack removed — Shiny Egg removes them from your project too (a normal cleanup, not an import problem)."
              >
                {report.counts.emptied} emptied
              </span>
            )}
            {report.counts.blocked > 0 && (
              <span className="se-import__pill se-import__pill--blocked">{report.counts.blocked} blocked</span>
            )}
          </p>

          {phase === 'report' && report.levels.some((l) => l.unblockAction) && (
            <div className="se-import__cats">
              {report.levels.some((l) => l.unblockAction) && (
                <label
                  className="se-import__cat"
                  title={
                    'Some changed levels can only import after a one-time layout change: 0x7D needs a free-space ' +
                    'migration (its own self-contained object copy) and 0x19/0xCB need de-coupling (their own ' +
                    'sprite blob). Checking this makes them selectable and flips those toggles automatically ' +
                    'before the import writes. 0xBF/0xD0 stay blocked (shared room data — no resolution).'
                  }
                >
                  <input type="checkbox" checked={unblockOn} onChange={onToggleUnblock} />
                  <span className="se-import__catname">Unblock imports</span>
                  <span className="se-import__catinfo">
                    pre-emptively de-couple / migrate blocked levels (
                    {report.levels
                      .filter((l) => l.unblockAction)
                      .map((l) => hex(l.recordId))
                      .join(', ')}
                    )
                  </span>
                </label>
              )}
            </div>
          )}

          {report.counts.conflicts > 0 && (
            <p className="se-import__warn">
              ⚠ {report.counts.conflicts} selected-able level
              {report.counts.conflicts === 1 ? ' is' : 's are'} already edited in this project —
              importing them <strong>overwrites your edits</strong>. They’re unchecked by default and
              marked “overwrite” below.
            </p>
          )}

          {phase === 'report' && (
            <div className="se-import__selrow">
              <button type="button" className="se-linkbtn" onClick={() => onSelect(selectable)}>
                Select all importable
              </button>
              <button type="button" className="se-linkbtn" onClick={() => onSelect([])}>
                Select none
              </button>
            </div>
          )}

          <div className="se-import__list">
            {report.levels.map((l) => (
              <LevelRow
                key={l.recordId}
                level={l}
                name={names[l.recordId]}
                checked={selected.has(l.recordId)}
                disabled={
                  phase !== 'report' ||
                  (l.importability === 'blocked' && !(unblockOn && l.unblockAction))
                }
                unblockOn={unblockOn}
                onToggle={() => onToggle(l.recordId)}
              />
            ))}
          </div>
        </>
      )}

    </>
  )
}

/**
 * The import log — moved to the TOP of the panel. Shows the apply outcome (one
 * line per category that imported, plus warnings/failures) once the import runs,
 * so the result is the first thing the user sees above the (still-visible) report.
 */
function ImportLog({ applyResult }: { applyResult: RomImportApplyResult }): JSX.Element {
  if (!applyResult.ok) {
    return (
      <div className="se-import__result">
        <p className="se-import__error">Import failed: {applyResult.error}</p>
      </div>
    )
  }
  const anyApplied =
    applyResult.applied > 0 ||
    applyResult.palette.applied ||
    applyResult.names.applied ||
    applyResult.messages.applied ||
    applyResult.worldMap.applied ||
    applyResult.gradient.applied ||
    applyResult.yoshiColors.applied ||
    applyResult.islandTilemap.applied ||
    applyResult.logoTilemap.applied ||
    applyResult.introStory.applied ||
    applyResult.endingText.applied ||
    applyResult.graphics.applied ||
    applyResult.emptiedRemoved.removed.length > 0
  return (
    <div className="se-import__result">
      {applyResult.applied > 0 && (
        <p>
          Imported <strong>{applyResult.applied}</strong> level
          {applyResult.applied === 1 ? '' : 's'}
          {applyResult.rawOnly > 0
            ? ` (${applyResult.full} full, ${applyResult.rawOnly} raw-only)`
            : ''}
          .
        </p>
      )}
      {applyResult.newSlots.length > 0 && (
        <p>
          Added <strong>{applyResult.newSlots.length}</strong> brand-new level
          {applyResult.newSlots.length === 1 ? '' : 's'} (
          {applyResult.newSlots.map((r) => hex(r)).join(', ')}) in previously-unused slots.
        </p>
      )}
      {applyResult.migration.applied > 0 && (
        <p>
          Migrated <strong>{applyResult.migration.applied}</strong> level
          {applyResult.migration.applied === 1 ? '' : 's'} to free space (
          {applyResult.migration.recordIds.map((r) => hex(r)).join(', ')}) — the hack had relocated
          them and they no longer fit their home banks.
        </p>
      )}
      {applyResult.migration.warning && (
        <p className="se-import__warn">⚠ {applyResult.migration.warning}</p>
      )}
      {(applyResult.unblocked.migrated.length > 0 || applyResult.unblocked.decoupled.length > 0) && (
        <p>
          Unblocked{' '}
          {[
            applyResult.unblocked.migrated.length > 0 &&
              `migrated ${applyResult.unblocked.migrated.map((r) => hex(r)).join(', ')} to free space`,
            applyResult.unblocked.decoupled.length > 0 &&
              `de-coupled ${applyResult.unblocked.decoupled.map((r) => hex(r)).join(', ')}`
          ]
            .filter(Boolean)
            .join('; ')}{' '}
          so their imports could apply.
        </p>
      )}
      {applyResult.palette.applied && (
        <p>
          Imported <strong>{applyResult.palette.words}</strong> palette color
          {applyResult.palette.words === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.palette.error && (
        <p className="se-import__error">Palette import failed: {applyResult.palette.error}</p>
      )}
      {applyResult.gradient.applied && (
        <p>
          Imported <strong>{applyResult.gradient.stops}</strong> gradient stop
          {applyResult.gradient.stops === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.gradient.error && (
        <p className="se-import__error">Gradient import failed: {applyResult.gradient.error}</p>
      )}
      {applyResult.yoshiColors.applied && (
        <p>
          Imported <strong>{applyResult.yoshiColors.changed}</strong> level Yoshi color
          {applyResult.yoshiColors.changed === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.yoshiColors.error && (
        <p className="se-import__error">Yoshi-color import failed: {applyResult.yoshiColors.error}</p>
      )}
      {applyResult.islandTilemap.applied && (
        <p>
          Imported <strong>{applyResult.islandTilemap.cells}</strong> title-island cell
          {applyResult.islandTilemap.cells === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.islandTilemap.error && (
        <p className="se-import__error">
          Title-island import failed: {applyResult.islandTilemap.error}
        </p>
      )}
      {applyResult.logoTilemap.applied && (
        <p>
          Imported <strong>{applyResult.logoTilemap.cells}</strong> title-logo cell
          {applyResult.logoTilemap.cells === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.logoTilemap.error && (
        <p className="se-import__error">Title-logo import failed: {applyResult.logoTilemap.error}</p>
      )}
      {applyResult.names.applied && (
        <p>
          Imported <strong>{applyResult.names.changed}</strong> level name
          {applyResult.names.changed === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.names.error && (
        <p className="se-import__error">Name import failed: {applyResult.names.error}</p>
      )}
      {applyResult.messages.applied && (
        <p>
          Imported <strong>{applyResult.messages.changed}</strong> message
          {applyResult.messages.changed === 1 ? '' : 's'}
          {applyResult.messages.blanked > 0
            ? ` (+${applyResult.messages.blanked} blanked to match the hack’s deletions)`
            : ''}
          .
        </p>
      )}
      {applyResult.messages.error && (
        <p className="se-import__error">Message import failed: {applyResult.messages.error}</p>
      )}
      {applyResult.introStory.applied && (
        <p>
          Imported <strong>{applyResult.introStory.changed}</strong> intro-story page
          {applyResult.introStory.changed === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.introStory.error && (
        <p className="se-import__error">Intro-story import failed: {applyResult.introStory.error}</p>
      )}
      {applyResult.endingText.applied && (
        <p>
          Imported <strong>{applyResult.endingText.changed}</strong> ending-text line
          {applyResult.endingText.changed === 1 ? '' : 's'}.
        </p>
      )}
      {applyResult.endingText.error && (
        <p className="se-import__error">Ending-text import failed: {applyResult.endingText.error}</p>
      )}
      {applyResult.worldMap.applied && (
        <p>
          Imported <strong>{applyResult.worldMap.entrances}</strong> world-map entrance
          {applyResult.worldMap.entrances === 1 ? '' : 's'}
          {applyResult.worldMap.midway > 0
            ? `, ${applyResult.worldMap.midway} checkpoint${applyResult.worldMap.midway === 1 ? '' : 's'}`
            : ''}
          {applyResult.worldMap.indexRemaps > 0
            ? ` and ${applyResult.worldMap.indexRemaps} slot remap${applyResult.worldMap.indexRemaps === 1 ? '' : 's'}`
            : ''}
          .
        </p>
      )}
      {applyResult.worldMap.error && (
        <p className="se-import__error">World-map import failed: {applyResult.worldMap.error}</p>
      )}
      {applyResult.graphics.applied && (
        <p>
          Imported{' '}
          {applyResult.graphics.files > 0 && (
            <>
              <strong>{applyResult.graphics.files}</strong> graphics sheet
              {applyResult.graphics.files === 1 ? '' : 's'}
            </>
          )}
          {applyResult.graphics.files > 0 && applyResult.graphics.rawFiles > 0 ? ' and ' : ''}
          {applyResult.graphics.rawFiles > 0 && (
            <>
              <strong>{applyResult.graphics.rawFiles}</strong> raw CHR file
              {applyResult.graphics.rawFiles === 1 ? '' : 's'}
            </>
          )}
          .
        </p>
      )}
      {applyResult.graphics.error && (
        <p className="se-import__error">Graphics import failed: {applyResult.graphics.error}</p>
      )}
      {applyResult.emptiedRemoved.removed.length > 0 && (
        <p>
          Removed <strong>{applyResult.emptiedRemoved.removed.length}</strong> level
          {applyResult.emptiedRemoved.removed.length === 1 ? '' : 's'} the hack emptied (
          {applyResult.emptiedRemoved.removed.map((r) => hex(r)).join(', ')}). Their bytes free up at
          the next build.
        </p>
      )}
      {applyResult.emptiedRemoved.error && (
        <p className="se-import__error">
          Emptied-level removal failed (the import itself succeeded): {applyResult.emptiedRemoved.error}
        </p>
      )}
      {anyApplied && (
        <p className="se-meta se-import__hint">
          Rebuild (Test Level / Launch) to see the changes in-game.
        </p>
      )}
      {applyResult.failed.length > 0 && (
        <div className="se-import__failed">
          {applyResult.failed.map((f) => (
            <p key={f.recordId} className="se-import__error">
              {hex(f.recordId)} — {f.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtBytes(n: number): string {
  return n >= 4096 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`
}

/**
 * The detect-only diff inventory: everything the hack changed, by cart
 * structure — including the categories the importer does NOT apply (graphics,
 * Map16, collision, code). Read-only; categories a semantic import covers are
 * tagged "imported above" so the rest reads as the genuine not-imported diff.
 */
function InventoryTable({ inventory }: { inventory: RomImportInventory }): JSX.Element | null {
  const notImported = inventory.categories.filter((c) => !c.imported)
  if (inventory.categories.length === 0) return null
  const notImportedBytes = notImported.reduce((n, c) => n + c.bytes, 0)
  return (
    <details className="se-import__anchors">
      <summary>
        Full diff inventory ({fmtBytes(inventory.totalDiffBytes)} changed
        {notImportedBytes > 0 ? `, ${fmtBytes(notImportedBytes)} not imported` : ''})
      </summary>
      <div className="se-import__anchortable">
        {inventory.categories.map((c) => (
          <div key={c.key} className="se-import__anchorrow se-import__anchorrow--inv">
            <span className="se-import__anchorname" title={c.examples.join('\n')}>
              {c.label}
            </span>
            <span className="se-import__addr">{fmtBytes(c.bytes)}</span>
            <span className="se-import__conf">
              {c.runs} run{c.runs === 1 ? '' : 's'}
            </span>
            {c.imported ? (
              <span className="se-import__tag se-import__tag--imported" title="A semantic import above covers this region — select it there.">
                imported
              </span>
            ) : (
              <span className="se-import__tag se-import__tag--notimported" title="No import path for this region yet — the change stays in the source ROM only.">
                not imported
              </span>
            )}
          </div>
        ))}
      </div>
      {notImportedBytes > 0 && (
        <p className="se-meta se-import__hint">
          “Not imported” regions (graphics, Map16, collision, custom code …) have no editable
          import path yet — they are detected and listed so nothing is silently dropped.
        </p>
      )}
    </details>
  )
}

function AnchorsTable({ report }: { report: Extract<RomImportReport, { ok: true }> }): JSX.Element {
  return (
    <details className="se-import__anchors">
      <summary>
        Re-identified memory locations ({report.anchors.filter((a) => a.pc !== null).length}/
        {report.anchors.length} resolved)
      </summary>
      <div className="se-import__anchortable">
        {report.anchors.map((a) => (
          <div key={a.key} className="se-import__anchorrow">
            <span className="se-import__anchorname">{a.label}</span>
            <span className={`se-meta-xs se-import__method se-import__method--${a.method}`}>{a.method}</span>
            <span className="se-import__addr">{a.pc === null ? '—' : `0x${a.pc.toString(16).toUpperCase()}`}</span>
            <span className="se-import__conf">{a.pc === null ? '' : `${Math.round(a.confidence * 100)}%`}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

function LevelRow({
  level,
  name,
  checked,
  disabled,
  unblockOn,
  onToggle
}: {
  level: RomImportLevel
  name?: string
  checked: boolean
  disabled: boolean
  unblockOn: boolean
  onToggle: () => void
}): JSX.Element {
  const unblocks = level.importability === 'blocked' && !!level.unblockAction && unblockOn
  // Emptied = the hack removed this level (blocked at the analyzer, but a normal
  // non-error state). Tag + style it distinctly from a genuinely-blocked slot.
  const isEmptied = !!level.emptied
  const f = level.foreign
  const b = level.base
  return (
    <label
      className={`se-import__row${
        isEmptied ? ' is-emptied' : level.importability === 'blocked' && !unblocks ? ' is-blocked' : ''
      }`}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="se-import__rowid">{hex(level.recordId)}</span>
      <span className="se-import__rowname">{name ?? '—'}</span>
      <span className="se-import__rowchg">
        {level.objChanged && <span className="se-import__chg">obj</span>}
        {level.sprChanged && <span className="se-import__chg">spr</span>}
      </span>
      <span className="se-import__rowcounts">
        {b && f
          ? `${b.objects}/${b.sprites}/${b.exits} → ${f.objects}/${f.sprites}/${f.exits}`
          : f
            ? `${f.objects}/${f.sprites}/${f.exits}`
            : '(emptied)'}
      </span>
      {level.isNew && (
        <span className="se-import__tag" title="A brand-new level in an unused slot — importing places it in free space and points the slot at it.">
          new
        </span>
      )}
      {level.importability === 'raw-only' && (
        <span className="se-import__tag se-import__tag--raw" title="Decode didn't round-trip — imported as raw bytes; may not edit correctly.">
          raw
        </span>
      )}
      {isEmptied && (
        <span
          className="se-import__tag se-import__tag--emptied"
          title="The hack removed this level's data — Shiny Egg removes it from your project too (a normal cleanup, not an import problem)."
        >
          emptied
        </span>
      )}
      {!isEmptied && level.importability === 'blocked' && !unblocks && (
        <span className="se-import__tag se-import__tag--blocked" title={level.blockedReason}>
          blocked
        </span>
      )}
      {unblocks && (
        <span
          className="se-import__tag"
          title={
            level.unblockAction === 'migrate'
              ? 'Imports after an automatic free-space migration (its own self-contained data copy).'
              : 'Imports after an automatic de-couple (its own sprite blob).'
          }
        >
          {level.unblockAction === 'migrate' ? 'will migrate' : 'will de-couple'}
        </span>
      )}
      {level.hasOverlayConflict && (level.importability !== 'blocked' || unblocks) && (
        <span className="se-import__tag se-import__tag--warn" title="You've already edited this level — importing overwrites it.">
          overwrite
        </span>
      )}
    </label>
  )
}
