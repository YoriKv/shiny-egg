import { type JSX } from 'react'
import { useDropdown } from '../hooks/useDropdown'
import type { CameraPreview } from './draw/camera-preview'
import type { CameraSnap } from './parallax'

interface Props {
  /** Camera Preview on/off (the checkbox). */
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  /** Popup settings (mask / zoom / snap). */
  settings: CameraPreview
  onSettingsChange: (s: CameraPreview) => void
}

const ZOOMS = [1, 2, 3, 4] as const
const SNAPS: { value: CameraSnap; label: string; title: string }[] = [
  { value: 'none', label: 'No snap', title: 'Free camera position' },
  { value: 'h', label: 'H-snap', title: 'Snap the camera to screen rows (bottom row = the horizontal-level floor); pan up/down to switch rows' },
  { value: 'v', label: 'V-snap', title: 'Snap the camera to screen columns; pan left/right to switch columns' }
]

/**
 * The canvas Camera Preview control: an on/off checkbox plus a "▾" button that
 * opens a settings popup (mask toggle, zoom 1×–4×, and snap mode). Sits in the
 * top-right view-controls group next to Reset view.
 */
export function CameraPreviewControl({
  enabled,
  onEnabledChange,
  settings,
  onSettingsChange
}: Props): JSX.Element {
  const { open, setOpen, containerRef } = useDropdown()
  const set = (patch: Partial<CameraPreview>): void => onSettingsChange({ ...settings, ...patch })

  return (
    <div className="se-campreview" ref={containerRef}>
      <label
        className={`se-campreview__toggle${enabled ? ' is-active' : ''}`}
        title="Preview the in-game camera (256×224) with parallax-aligned BG2 / BG3 / sky. Pins zoom to the chosen 1×–4× (Shift+Space)."
      >
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        Camera Preview
      </label>
      <button
        type="button"
        className={`se-campreview__caret${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Camera Preview options"
      >
        ▾
      </button>
      {open && (
        <div className="se-campreview__pop">
          <label className="se-campreview__check" title="Black out everything outside the camera view">
            <input
              type="checkbox"
              checked={settings.mask}
              onChange={(e) => set({ mask: e.target.checked })}
            />
            Mask outside camera
          </label>

          <div className="se-campreview__group">
            <span className="se-campreview__grouplabel">Zoom</span>
            <div className="se-campreview__radios">
              {ZOOMS.map((z) => (
                <label key={z} className="se-campreview__radio">
                  <input
                    type="radio"
                    name="campreview-zoom"
                    checked={settings.zoom === z}
                    onChange={() => set({ zoom: z })}
                  />
                  {z}×
                </label>
              ))}
            </div>
          </div>

          <div className="se-campreview__group">
            <span className="se-campreview__grouplabel">Snap</span>
            <div className="se-campreview__radios se-campreview__radios--col">
              {SNAPS.map((s) => (
                <label key={s.value} className="se-campreview__radio" title={s.title}>
                  <input
                    type="radio"
                    name="campreview-snap"
                    checked={settings.snap === s.value}
                    onChange={() => set({ snap: s.value })}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
