import { useEffect, useState, type JSX } from 'react'
import type { OverlayDriftReport, ProjectBackupResult } from '../../preload/api'

/** Prettify a region id for display ('message-box-text' → 'Message box text'). */
function regionLabel(id: string): string {
  const s = id.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Basename of a workRoot-relative path ('yi/.../Bank51.asm' → 'Bank51.asm'). */
function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

type BackupState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; name: string }
  | { kind: 'error'; error: string }

export interface OverlayUpgradeModalProps {
  report: OverlayDriftReport
  /** Duplicate the project as a restore point — the "back up first" step. */
  onBackup: () => Promise<ProjectBackupResult>
  /** Upgrade the chosen overlay files. Resolves on success (parent closes +
   *  reloads); rejects with a message the modal shows while staying open. */
  onUpgrade: (files: string[]) => Promise<void>
  onDismiss: () => void
}

/**
 * Shown on project launch when overlay `.asm` files have drifted from the
 * current editor base. Recommends a one-click backup, then a per-file checklist
 * to upgrade (re-splice your edited regions onto the fresh base). Each file's
 * detail spells out what the upgrade keeps / adds / drops. "Not now" dismisses;
 * it re-prompts next launch until resolved.
 */
export function OverlayUpgradeModal({
  report,
  onBackup,
  onUpgrade,
  onDismiss
}: OverlayUpgradeModalProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(report.files.map((f) => f.file))
  )
  const [backup, setBackup] = useState<BackupState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = busy || backup.kind === 'running'

  // Escape dismisses unless a write is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !inFlight) {
        e.stopPropagation()
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [inFlight, onDismiss])

  const toggle = (file: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })

  const runBackup = async (): Promise<void> => {
    setBackup({ kind: 'running' })
    const r = await onBackup()
    setBackup(r.ok ? { kind: 'done', name: r.project.name } : { kind: 'error', error: r.error })
  }

  const runUpgrade = async (): Promise<void> => {
    const files = report.files.map((f) => f.file).filter((f) => selected.has(f))
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await onUpgrade(files) // parent closes + reloads on success
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="se-modal-backdrop" onMouseDown={() => !inFlight && onDismiss()}>
      <div className="se-modal se-modal--upgrade" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="se-modal__title">Update project to the current editor</h3>
        <p className="se-modal__body">
          This project was saved against an older version of the editor. Updating adopts the
          latest base game code and any new editable sections while keeping your edits. Back up
          first, then choose which files to update.
        </p>

        <div className="se-upgrade__backup">
          <button
            type="button"
            className="se-btn"
            onClick={() => void runBackup()}
            disabled={inFlight || backup.kind === 'done'}
          >
            {backup.kind === 'running'
              ? 'Backing up…'
              : backup.kind === 'done'
                ? '✓ Backed up'
                : 'Back up project'}
          </button>
          {backup.kind === 'done' && (
            <span className="se-upgrade__backup-note">Saved as “{backup.name}”</span>
          )}
          {backup.kind === 'error' && <span className="se-modal__error">{backup.error}</span>}
        </div>

        <ul className="se-upgrade__files">
          {report.files.map((f) => {
            const blank =
              f.editsPreserved.length === 0 &&
              f.regionsAdded.length === 0 &&
              f.regionsDropped.length === 0
            return (
              <li key={f.file} className="se-upgrade__file">
                <label className="se-upgrade__file-head">
                  <input
                    type="checkbox"
                    checked={selected.has(f.file)}
                    onChange={() => toggle(f.file)}
                    disabled={inFlight}
                  />
                  <span className="se-upgrade__file-name">{baseName(f.file)}</span>
                </label>
                <div className="se-upgrade__file-detail">
                  {f.editsPreserved.length > 0 && (
                    <span className="se-upgrade__tag">
                      Keeps your edits: {f.editsPreserved.map(regionLabel).join(', ')}
                    </span>
                  )}
                  {f.regionsAdded.length > 0 && (
                    <span className="se-upgrade__tag">
                      Adds: {f.regionsAdded.map(regionLabel).join(', ')}
                    </span>
                  )}
                  {f.regionsDropped.length > 0 && (
                    <span className="se-upgrade__tag is-warn">
                      ⚠ Drops (removed from base): {f.regionsDropped.map(regionLabel).join(', ')}
                    </span>
                  )}
                  {blank && <span className="se-upgrade__tag">Updates base game code</span>}
                </div>
              </li>
            )
          })}
        </ul>

        {error && <p className="se-modal__error">{error}</p>}
        <div className="se-modal__actions">
          <button type="button" className="se-btn" onClick={onDismiss} disabled={inFlight}>
            Not now
          </button>
          <button
            type="button"
            className="se-btn is-primary"
            onClick={() => void runUpgrade()}
            disabled={inFlight || selected.size === 0}
          >
            {busy ? 'Updating…' : `Update ${selected.size} file${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
