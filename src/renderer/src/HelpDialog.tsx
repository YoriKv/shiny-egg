import { useEffect, type JSX, type ReactNode } from 'react'

export interface HelpDialogProps {
  open: boolean
  title: string
  /** Help content — JSX so it can carry lists, shortcuts, emphasis, etc. */
  children: ReactNode
  /** Optional actions-row content, rendered left of the Close button (e.g. the
   *  sub-room help's "Hide … in Dropdown" checkbox). */
  footer?: ReactNode
  onClose: () => void
}

/**
 * Per-panel help modal, styled like the project/discard modals (`se-modal`) with
 * a wider, scrollable body for longer content. Backdrop click / Escape close.
 * Owned by `FloatingWindow` (one per panel) — content comes from the
 * `panel-help` registry. Always rendered when a panel has help; returns null
 * while closed.
 */
export function HelpDialog({ open, title, children, footer, onClose }: HelpDialogProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="se-modal-backdrop" onMouseDown={onClose}>
      <div className="se-modal se-modal--help" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="se-modal__title">{title}</h3>
        <div className="se-help__body">{children}</div>
        <div className="se-modal__actions">
          {footer}
          <button type="button" className="se-btn is-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
