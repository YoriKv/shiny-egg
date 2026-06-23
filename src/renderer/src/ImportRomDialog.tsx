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

/** Outcome of the optional post-import "remove all vanilla levels" pass. */
interface RemoveVanillaResult {
  removed: number[]
  /** Kept-level breakdown for the result text. */
  keptEdited: number
  keptProtected: number
  keptWarpReachable: number
  error: string | null
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
  const [selPalette, setSelPalette] = useState(false)
  const [selNames, setSelNames] = useState(false)
  const [selMessages, setSelMessages] = useState(false)
  const [selWorldMap, setSelWorldMap] = useState(false)
  const [selUnblock, setSelUnblock] = useState(false)
  const [selRemoveVanilla, setSelRemoveVanilla] = useState(false)
  const [applyResult, setApplyResult] = useState<RomImportApplyResult | null>(null)
  const [removeVanillaResult, setRemoveVanillaResult] = useState<RemoveVanillaResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [names, setNames] = useState<Record<number, string>>({})

  // Reset on each open; fetch the catalog for friendly level names.
  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setReport(null)
    setSelected(new Set())
    setSelPalette(false)
    setSelNames(false)
    setSelMessages(false)
    setSelWorldMap(false)
    setSelUnblock(false)
    setSelRemoveVanilla(false)
    setApplyResult(null)
    setRemoveVanillaResult(null)
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
      // Default-select importable, non-conflicting levels. Conflicts (already
      // edited in this project) stay OFF so the user opts into overwriting.
      const def = new Set<number>(
        r.levels
          .filter((l) => l.importability !== 'blocked' && !l.hasOverlayConflict)
          .map((l) => l.recordId)
      )
      setSelected(def)
      setSelPalette(r.palette.changedWords > 0)
      setSelNames(r.names.changed > 0 && !r.names.overBudget)
      setSelMessages((r.messages.changed > 0 || r.messages.blanked > 0) && !r.messages.overBudget)
      setSelWorldMap(r.worldMap.entrances > 0 || r.worldMap.midway > 0 || r.worldMap.indexRemaps > 0)
      setPhase('report')
    } catch (err) {
      setError((err as Error).message)
      setPhase('idle')
    }
  }

  // The post-import "remove all vanilla levels" pass. Runs AFTER the import on
  // purpose: the imported overlays mark their records as kept, and the warp
  // closure walks the IMPORTED exits — so a vanilla sub-room a hack still pipes
  // into survives. (Removing before the import would delete rooms the import is
  // about to fill or reference.)
  async function removeVanilla(): Promise<RemoveVanillaResult> {
    const all = await window.shinyEgg.editor.removableVanillaLevels()
    if ('error' in all) {
      return { removed: [], keptEdited: 0, keptProtected: 0, keptWarpReachable: 0, error: all.error }
    }
    const kept = {
      keptEdited: all.keptEdited.length,
      keptProtected: all.keptProtected.length,
      keptWarpReachable: all.keptWarpReachable.length
    }
    if (all.recordIds.length === 0) return { removed: [], ...kept, error: null }
    const r = await window.shinyEgg.editor.removeLevels(all.recordIds)
    if (!r.ok) return { removed: [], ...kept, error: r.error }
    return { removed: r.removed, ...kept, error: null }
  }

  async function apply(): Promise<void> {
    if (selected.size === 0 && !selPalette && !selNames && !selMessages && !selWorldMap) return
    setPhase('applying')
    try {
      const res = await window.shinyEgg.importRom.apply({
        recordIds: [...selected],
        palette: selPalette,
        names: selNames,
        messages: selMessages,
        worldMap: selWorldMap,
        unblock: selUnblock
      })
      setApplyResult(res)
      let removal: RemoveVanillaResult | null = null
      if (res.ok && selRemoveVanilla) {
        try {
          removal = await removeVanilla()
        } catch (err) {
          removal = { removed: [], keptEdited: 0, keptProtected: 0, keptWarpReachable: 0, error: (err as Error).message }
        }
        setRemoveVanillaResult(removal)
      }
      if (res.ok) onImported(removal?.removed ?? [])
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

  return (
    <div className="se-modal-backdrop" onMouseDown={() => phase !== 'analyzing' && phase !== 'applying' && onClose()}>
      <div className="se-modal se-modal--import" onMouseDown={(e) => e.stopPropagation()}>
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
                progression, master-palette colours, level-name strings, and message-box text.
                Graphics, Map16, and custom code are not yet imported.
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

          {phase !== 'idle' && phase !== 'analyzing' && report?.ok && (
            <ReportView
              report={report}
              names={names}
              selected={selected}
              onToggle={toggle}
              onSelect={(ids) => setSelected(new Set(ids))}
              selectable={selectableIds()}
              selPalette={selPalette}
              selNames={selNames}
              selMessages={selMessages}
              selWorldMap={selWorldMap}
              onTogglePalette={() => setSelPalette((v) => !v)}
              onToggleNames={() => setSelNames((v) => !v)}
              onToggleMessages={() => setSelMessages((v) => !v)}
              onToggleWorldMap={() => setSelWorldMap((v) => !v)}
              phase={phase}
              applyResult={applyResult}
              removeVanilla={removeVanillaResult}
              unblockOn={selUnblock}
              onToggleUnblock={toggleUnblock}
              selRemoveVanilla={selRemoveVanilla}
              onToggleRemoveVanilla={() => setSelRemoveVanilla((v) => !v)}
            />
          )}
        </div>

        <div className="se-modal__actions">
          {phase === 'report' && report?.ok && (
            <button
              type="button"
              className="se-btn is-primary"
              onClick={() => void apply()}
              disabled={selected.size === 0 && !selPalette && !selNames && !selMessages && !selWorldMap}
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
  selPalette: boolean
  selNames: boolean
  selMessages: boolean
  selWorldMap: boolean
  onTogglePalette: () => void
  onToggleNames: () => void
  onToggleMessages: () => void
  onToggleWorldMap: () => void
  phase: Phase
  applyResult: RomImportApplyResult | null
  removeVanilla: RemoveVanillaResult | null
  /** The "unblock imports" option — makes resolvable-blocked levels selectable. */
  unblockOn: boolean
  onToggleUnblock: () => void
  selRemoveVanilla: boolean
  onToggleRemoveVanilla: () => void
}

function ReportView({
  report,
  names,
  selected,
  onToggle,
  onSelect,
  selectable,
  selPalette,
  selNames,
  selMessages,
  selWorldMap,
  onTogglePalette,
  onToggleNames,
  onToggleMessages,
  onToggleWorldMap,
  phase,
  applyResult,
  removeVanilla,
  unblockOn,
  onToggleUnblock,
  selRemoveVanilla,
  onToggleRemoveVanilla
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

      {(report.palette.changedWords > 0 ||
        report.names.changed > 0 ||
        report.names.skipped > 0 ||
        report.messages.changed > 0 ||
        report.messages.skipped > 0 ||
        report.worldMap.entrances > 0 ||
        report.worldMap.midway > 0 ||
        report.worldMap.indexRemaps > 0) && (
        <div className="se-import__cats">
          {report.palette.changedWords > 0 && (
            <label className="se-import__cat">
              <input
                type="checkbox"
                checked={selPalette}
                disabled={phase !== 'report'}
                onChange={onTogglePalette}
              />
              <span className="se-import__catname">Palette colours</span>
              <span className="se-import__catinfo">
                {report.palette.changedWords} changed
                {report.palette.conflicts > 0 && (
                  <span className="se-import__tag se-import__tag--warn" title="These colours are also edited in your project — importing overwrites them.">
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
                checked={selNames}
                disabled={phase !== 'report' || report.names.changed === 0 || report.names.overBudget}
                onChange={onToggleNames}
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
                checked={selMessages}
                disabled={
                  phase !== 'report' ||
                  (report.messages.changed === 0 && report.messages.blanked === 0) ||
                  report.messages.overBudget
                }
                onChange={onToggleMessages}
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
                checked={selWorldMap}
                disabled={phase !== 'report'}
                onChange={onToggleWorldMap}
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
            {report.counts.blocked > 0 && (
              <span className="se-import__pill se-import__pill--blocked">{report.counts.blocked} blocked</span>
            )}
          </p>

          {phase === 'report' && (
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
              <label
                className="se-import__cat se-import__cat--danger"
                title={
                  'After the import applies, remove every remaining unedited vanilla level — their bytes free up ' +
                  'for your levels at the next build. Imported levels, rooms they warp into, and engine-required ' +
                  'rooms (boot/minigame/arena) are kept. World-map slots of removed levels are marked unused.'
                }
              >
                <input
                  type="checkbox"
                  checked={selRemoveVanilla}
                  onChange={onToggleRemoveVanilla}
                />
                <span className="se-import__catname">Remove all vanilla levels</span>
                <span className="se-import__catinfo">
                  after import — frees every level the hack didn’t change or reach
                </span>
              </label>
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

          {report.inventory && <InventoryTable inventory={report.inventory} />}
        </>
      )}

      {phase === 'applying' && <p className="se-meta se-import__hint">Applying…</p>}

      {phase === 'done' && applyResult && (
        <div className="se-import__result">
          {applyResult.ok ? (
            <>
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
                  {applyResult.migration.recordIds.map((r) => hex(r)).join(', ')}) — the hack had
                  relocated them and they no longer fit their home banks.
                </p>
              )}
              {applyResult.migration.warning && (
                <p className="se-import__warn">⚠ {applyResult.migration.warning}</p>
              )}
              {(applyResult.unblocked.migrated.length > 0 ||
                applyResult.unblocked.decoupled.length > 0) && (
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
                  Imported <strong>{applyResult.palette.words}</strong> palette colour
                  {applyResult.palette.words === 1 ? '' : 's'}.
                </p>
              )}
              {applyResult.palette.error && (
                <p className="se-import__error">Palette import failed: {applyResult.palette.error}</p>
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
              {removeVanilla && removeVanilla.error === null && (
                <p>
                  Removed <strong>{removeVanilla.removed.length}</strong> vanilla level
                  {removeVanilla.removed.length === 1 ? '' : 's'} — kept{' '}
                  {removeVanilla.keptEdited} imported/edited, {removeVanilla.keptProtected}{' '}
                  engine-required, {removeVanilla.keptWarpReachable} warp-reachable. Their bytes
                  free up at the next build.
                </p>
              )}
              {removeVanilla?.error && (
                <p className="se-import__error">
                  Vanilla-level removal failed (the import itself succeeded): {removeVanilla.error}
                </p>
              )}
              {(applyResult.applied > 0 ||
                applyResult.palette.applied ||
                applyResult.names.applied ||
                applyResult.messages.applied ||
                applyResult.worldMap.applied) && (
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
            </>
          ) : (
            <p className="se-import__error">Import failed: {applyResult.error}</p>
          )}
        </div>
      )}
    </>
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
          <div key={c.key} className="se-import__anchorrow">
            <span className="se-import__anchorname" title={c.examples.join('\n')}>
              {c.label}
            </span>
            <span className="se-import__addr">{fmtBytes(c.bytes)}</span>
            <span className="se-import__conf">
              {c.runs} run{c.runs === 1 ? '' : 's'}
            </span>
            {c.imported ? (
              <span className="se-import__tag" title="A semantic import above covers this region — select it there.">
                imported above
              </span>
            ) : (
              <span className="se-import__tag se-import__tag--raw" title="No import path for this region yet — the change stays in the source ROM only.">
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
  const f = level.foreign
  const b = level.base
  return (
    <label className={`se-import__row${level.importability === 'blocked' && !unblocks ? ' is-blocked' : ''}`}>
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
      {level.importability === 'blocked' && !unblocks && (
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
