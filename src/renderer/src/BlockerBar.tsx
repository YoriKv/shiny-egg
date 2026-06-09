import { type JSX } from 'react'
import type { Blocker } from './lib/level-blockers'

/**
 * The shared surface for save / build blockers — a small stack at the top of the
 * stage. Generalises the old single save-error banner: every contributor in
 * `lib/level-blockers.ts` renders here (errors red, warnings amber), so a new
 * blocker (e.g. the byte budget, task #14) appears with no UI change. Dismissible
 * blockers (transient IO errors) get an ×; derived ones reflect live state.
 */
export function BlockerBar({
  blockers,
  onDismiss
}: {
  blockers: Blocker[]
  onDismiss: (id: string) => void
}): JSX.Element | null {
  if (blockers.length === 0) return null
  return (
    <div className="se-blockers">
      {blockers.map((b) => (
        <div key={b.id} className={`se-blocker se-blocker--${b.severity}`}>
          <span className="se-blocker__msg">
            {b.message}
            {b.detail && <span className="se-blocker__detail"> · {b.detail}</span>}
          </span>
          {b.dismissible && (
            <button type="button" title="Dismiss" onClick={() => onDismiss(b.id)}>
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
