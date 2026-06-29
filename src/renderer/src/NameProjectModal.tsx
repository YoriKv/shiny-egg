import { useEffect, useRef, useState, type JSX } from 'react'

// Mirror of the main-side name rule (src/main/projects.ts isValidProjectName):
// lowercase ascii + digits + "-"/"_", must start alphanumeric, ≤64 chars. Used
// for live feedback; the backend enforces it authoritatively.
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export interface NameProjectModalProps {
  open: boolean
  /** Suggested default (the next free `new-shiny-NN`); the input starts here,
   *  pre-selected, so the user can accept it with Enter or type their own. */
  defaultName: string
  /** Existing project names, for a live duplicate check before submitting. */
  existingNames: readonly string[]
  /** True while the create is in flight — disables the input + buttons. */
  busy?: boolean
  /** Backend error (e.g. a name that raced into existence after the check). */
  error?: string | null
  onSubmit: (name: string) => void
  onCancel: () => void
}

/**
 * Name-a-new-project prompt — a text-input modal (`se-modal` styling, Escape /
 * backdrop-click cancel) shown when creating a project, so it's named up front
 * instead of being created with an auto `new-shiny-NN` and renamed later. Validates
 * the filesystem-safe name rule live (format + duplicate); the backend enforces it
 * authoritatively and any residual error surfaces in `error`.
 */
export function NameProjectModal({
  open,
  defaultName,
  existingNames,
  busy = false,
  error = null,
  onSubmit,
  onCancel
}: NameProjectModalProps): JSX.Element | null {
  const [value, setValue] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // On each open, reset to the suggested default and focus + select it so the
  // user can accept it or immediately type over it.
  useEffect(() => {
    if (!open) return
    setValue(defaultName)
    const id = requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [open, defaultName])

  // Escape cancels (capture phase, matching DiscardChangesModal).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, busy, onCancel])

  if (!open) return null

  const trimmed = value.trim()
  const formatOk = NAME_RE.test(trimmed)
  const duplicate = formatOk && existingNames.includes(trimmed)
  const valid = formatOk && !duplicate
  // Inline validation message — only once the user has typed something invalid.
  const problem = duplicate
    ? `A project named “${trimmed}” already exists.`
    : trimmed.length > 0 && !formatOk
      ? 'Lowercase letters, digits, “-” or “_”, starting with a letter or digit. No spaces.'
      : null

  const submit = (): void => {
    if (valid && !busy) onSubmit(trimmed)
  }

  return (
    <div className="se-modal-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div className="se-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="se-modal__title">New project</h3>
        <p className="se-modal__body">Pick a name — you can change it later in Project info.</p>
        <input
          ref={inputRef}
          className="se-input se-modal__input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="lowercase-name"
        />
        <p className={`se-modal__hint${problem ? ' is-error' : ''}`}>
          {problem ?? 'Lowercase letters, digits, “-” or “_”. No spaces.'}
        </p>
        {error && <p className="se-modal__error">{error}</p>}
        <div className="se-modal__actions">
          <button type="button" className="se-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="se-btn is-primary"
            onClick={submit}
            disabled={busy || !valid}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
