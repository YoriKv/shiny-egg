import { type JSX } from 'react'
import { useDropdown } from './hooks/useDropdown'

export interface PanelEntry {
  /** Window kind — used as the React key. */
  kind: string
  label: string
  /** Tooltip noun, e.g. "Custom patches". */
  title: string
  /** Whether the panel's floating window is currently open. */
  open: boolean
  /** Toggle the panel open/closed (App binds the open/close-with-dirty-guard). */
  onToggle: () => void
}

export interface PanelGroupMenuProps {
  /** Trigger label, e.g. "Global Panels". */
  label: string
  panels: ReadonlyArray<PanelEntry>
}

/**
 * Toolbar dropdown that collects a related set of panel toggles behind one
 * button (e.g. "Global Panels" = Strings / World Map / Level Banks / Patches;
 * "Graphics Panels" = Graphics / Tiles / Palette), keeping the panel-toggle row
 * compact. Each row toggles its floating window open/closed — exactly what the
 * standalone buttons did — and shows whether that panel is currently open.
 *
 * The popover stays open across toggles (a checklist, not a one-shot menu) so
 * several panels can be opened/closed in one visit; outside-click or Escape
 * dismisses it (via `useDropdown`).
 */
export function PanelGroupMenu({ label, panels }: PanelGroupMenuProps): JSX.Element {
  const { open, setOpen, containerRef } = useDropdown()
  const hasOpen = panels.some((p) => p.open)
  return (
    <div className="se-panelgroup" ref={containerRef}>
      <button
        type="button"
        className={`se-tool se-tool--reopen se-panelgroup__trigger${
          open ? ' is-menu-open' : ''
        }${hasOpen ? ' has-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`${label} — ${panels.map((p) => p.label).join(', ')}`}
      >
        {label}
        <svg className="se-panelgroup__chevron" viewBox="0 0 10 6" width="10" height="6">
          <path d="M1 1 L5 5 L9 1" stroke="currentColor" strokeWidth="1.25" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="se-panelgroup__pop">
          {panels.map((p) => (
            <button
              key={p.kind}
              type="button"
              className={`se-menuitem se-panelgroup__item${p.open ? ' is-open' : ''}`}
              onClick={p.onToggle}
              title={p.open ? `Close ${p.title}` : `Open ${p.title}`}
            >
              <span>{p.label}</span>
              <span className="se-panelgroup__item-state">{p.open ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
