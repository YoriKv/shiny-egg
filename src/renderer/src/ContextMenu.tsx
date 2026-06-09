import { useEffect, useRef, type JSX } from 'react'

export interface ContextMenuItem {
  label: string
  /** Optional shortcut hint shown right-aligned (e.g. "Ctrl+D"). */
  shortcut?: string
  onClick: () => void
  disabled?: boolean
}

/**
 * A small popup menu anchored at viewport coords (`position: fixed`). Closes on
 * Escape or an outside mousedown; a click inside runs the item then closes.
 * Generic — the canvas builds entity-specific items.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="se-ctxmenu"
      style={{ left: x, top: y }}
      // Don't let interactions inside the menu reach the canvas (pan/select).
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className="se-ctxmenu__item"
          disabled={it.disabled}
          onClick={() => {
            it.onClick()
            onClose()
          }}
        >
          <span>{it.label}</span>
          {it.shortcut && <span className="se-ctxmenu__shortcut">{it.shortcut}</span>}
        </button>
      ))}
    </div>
  )
}
