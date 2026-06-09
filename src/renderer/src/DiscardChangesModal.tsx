import { useEffect, type JSX } from 'react'

export interface DiscardChangesModalProps {
  open: boolean
  title: string
  body: string
  /** True while a Save is in flight — disables the buttons. */
  saving?: boolean
  error?: string | null
  /** Label for the confirm (proceed-without-saving) button. Default "Discard". */
  confirmLabel?: string
  /** Style the confirm button as destructive (red). */
  danger?: boolean
  /** Omit to hide the Save action (confirm / Cancel only). */
  onSave?: () => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * Unsaved-changes confirmation, styled like the project-menu modal (`se-modal`).
 * Used when an action would discard the current level's edits — switching levels
 * or following an exit. Backdrop click / Escape cancel. Save (optional) persists
 * first, then the held action runs.
 */
export function DiscardChangesModal({
  open,
  title,
  body,
  saving = false,
  error = null,
  confirmLabel = 'Discard',
  danger = false,
  onSave,
  onDiscard,
  onCancel
}: DiscardChangesModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, saving, onCancel])

  if (!open) return null
  return (
    <div className="se-modal-backdrop" onMouseDown={() => !saving && onCancel()}>
      <div className="se-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="se-modal__title">{title}</h3>
        <p className="se-modal__body">{body}</p>
        {error && <p className="se-modal__error">{error}</p>}
        <div className="se-modal__actions">
          <button type="button" className="se-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={`se-btn${danger ? ' is-danger' : ''}`}
            onClick={onDiscard}
            disabled={saving}
          >
            {confirmLabel}
          </button>
          {onSave && (
            <button
              type="button"
              className="se-btn is-primary"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
