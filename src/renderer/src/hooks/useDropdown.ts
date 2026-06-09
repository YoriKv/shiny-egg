import { useEffect, useRef, useState } from 'react'

/**
 * Open/close state + outside-click/Escape dismissal for a popover dropdown
 * menu. Attach `containerRef` to the menu's root element; while `open`, a
 * mousedown outside it or the Escape key closes it. Shared by the toolbar
 * dropdown menus (Project / ROM / Level / SubLevel).
 */
export function useDropdown() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the popup on outside-click / Escape while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, containerRef }
}
