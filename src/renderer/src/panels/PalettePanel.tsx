import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { hex as hexFmt, hex0x } from '../lib/hex'
import type { DecodedPalette, LevelData, PaletteEdit } from '../../../preload/api'
import { bgr15ToHex, hexToBgr15 } from '../lib/bgr15'
import { type PaletteEditorApi } from '../edit-session/usePaletteEditor'
import { useThrottledCallback } from '../lib/throttle'

/** Throttle for the live colour preview while dragging the picker. This caps the
 *  rate of draft updates → swatch-grid + App re-renders. It does NOT gate the
 *  canvas render queue — `useLevelRenderLayers` coalesces those (one render in
 *  flight, always re-issued with the latest, so the queue can't back up
 *  regardless of this value). So this is just a "don't recompute the 256-swatch
 *  grid every frame" guard. The undo step is separate: one per drag, on release. */
const PALETTE_PREVIEW_THROTTLE_MS = 200

/** First CGRAM index the palette interpreter writes (provenance ≥ 0) — the
 *  auto-selected swatch so the editor is never in a "nothing selected" state.
 *  Note: row-0 indices (0, 16, 32, …, 240) hold real colours and ARE editable —
 *  in YI palette index 0 is not a transparency marker; transparency is PPU
 *  layer-blending behaviour, not a palette-index property. */
function firstEditable(prov: Int32Array): number | null {
  for (let i = 0; i < 256; i++) if (prov[i] >= 0) return i
  return null
}

interface PaletteBodyProps {
  selectedLevelRecordId: number | null
  /** BG palette rows (0..7) the level's Map16 blocks actually reference, from
   *  the shared tile-usage fetch. Rows not in here are dimmed as unused. Null
   *  while usage is unknown (then nothing is dimmed). */
  paletteRowsUsed: number[] | null
  /** BG palette rows (0..7) the selected object's blocks use — outlined. */
  highlightRows: Set<number> | null
  /** The App-level palette colour-edit document (usePaletteEditor). */
  editor: PaletteEditorApi
  /** Bumped on every successful build. Re-fetches the BASE CGRAM (the built ROM
   *  changed) and re-checks the palette-stale warning. */
  renderRefresh: number
  /** The live (in-memory edited) level, so a header edit's CGRAM is rebuilt from
   *  the override rather than the on-disk header. Null when no level is loaded. */
  override: LevelData | null
  /** A primitive that changes iff a palette-relevant header field changes (BG
   *  color + BG1/BG2/BG3/sprite palette rows + level mode — the inputs to
   *  `paletteHeaderFromLevel`). Editing one re-skins CGRAM, so the swatch grid
   *  re-fetches; object edits (which don't touch these) leave it untouched. */
  headerVersion: string
}

/**
 * The level's CGRAM as a 16×16 swatch grid. Convention: row 0 = backdrop, rows
 * 1-7 = BG palettes, rows 8-15 = sprite palettes.
 *
 * **Editing (§B10):** the panel fetches the level's BASE CGRAM + per-entry blob
 * provenance, and overlays the App-level edit DRAFT (`usePaletteEditor`) for
 * display. The first editable swatch is auto-selected; click another to switch.
 * Dragging the colour picker previews **live + throttled** (the draft feeds the
 * canvas via the render `paletteOverride`, like the reorder slider) and commits
 * **one undo step per drag** on release. **Edits are global** — the blob is
 * shared by palette *index*, so a colour changes every level that uses it.
 * Nothing is written until **Save** (or the global Save / Test Level), which
 * persists the delta to the overlay and rebuilds.
 *
 * **Editing aids:** BG rows the level's tiles don't reference are dimmed;
 * selecting an object outlines the BG rows its blocks use.
 */
export function PaletteBody({
  selectedLevelRecordId,
  paletteRowsUsed,
  highlightRows,
  editor,
  renderRefresh,
  override,
  headerVersion
}: PaletteBodyProps): JSX.Element {
  // Base (unedited) CGRAM + provenance for the selected level. Fetched on level
  // change only — the draft is applied locally for display, so a colour edit
  // never re-fetches.
  const [cgram, setCgram] = useState<Uint8Array | null>(null)
  const [provenance, setProvenance] = useState<Int32Array | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [status, setStatus] = useState<string>('Pick a level.')
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  // The built ROM's palette is out of date vs the saved overlay (a colour
  // edit/reset saved but not yet rebuilt) — the panel's BASE CGRAM comes from
  // that built ROM, so the swatches can lag the saved edits until a rebuild.
  const [stale, setStale] = useState(false)

  const { draftMap } = editor

  useEffect(() => {
    if (selectedLevelRecordId === null) {
      setCgram(null)
      setProvenance(null)
      setSelected(null)
      setStatus('Pick a level to see its CGRAM.')
      setError(null)
      return
    }
    let cancelled = false
    setStatus(`Loading level ${hex0x(selectedLevelRecordId)}…`)
    setError(null)
    setConfirmReset(false)
    void (async () => {
      try {
        const res: DecodedPalette | null = await window.shinyEgg.render.editablePalette({
          levelRecordId: selectedLevelRecordId
        })
        if (cancelled) return
        if (!res || res.cgram.length < 512) {
          setCgram(null)
          setProvenance(null)
          setSelected(null)
          setStatus(`Level ${hex0x(selectedLevelRecordId)} has no CGRAM data.`)
          return
        }
        setCgram(Uint8Array.from(res.cgram))
        setProvenance(res.provenance)
        setSelected(firstEditable(res.provenance))
        setStatus(`Level ${hex0x(selectedLevelRecordId)} CGRAM — click a swatch to edit`)
      } catch (e) {
        if (cancelled) return
        setError(String(e instanceof Error ? e.message : e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedLevelRecordId])

  // Re-query whether the built ROM is showing out-of-date colours, passing the
  // live draft so a saved-but-unbuilt edit (previewed correctly by the draft)
  // doesn't warn — only a reset-but-unbuilt swatch does. Re-runs when the draft
  // changes (edit / reset), on a rebuild (`renderRefresh`), and on level change.
  const draft = editor.draft
  useEffect(() => {
    let cancelled = false
    void window.shinyEgg.render
      .paletteBuildStale(draft)
      .then((s) => {
        if (!cancelled) setStale(s)
      })
      .catch(() => {
        if (!cancelled) setStale(false)
      })
    return () => {
      cancelled = true
    }
  }, [draft, renderRefresh, selectedLevelRecordId])

  // After a rebuild the built ROM's colours changed, so re-fetch the BASE CGRAM
  // (e.g. a reset's swatches refresh from blue back to yellow). Updates only the
  // colours — selection / status are preserved (the layout is unchanged). Skips
  // the initial render (the level-load effect above already fetched).
  const prevRefreshRef = useRef(renderRefresh)
  useEffect(() => {
    if (prevRefreshRef.current === renderRefresh) return
    prevRefreshRef.current = renderRefresh
    if (selectedLevelRecordId === null) return
    let cancelled = false
    void window.shinyEgg.render
      .editablePalette({ levelRecordId: selectedLevelRecordId })
      .then((res: DecodedPalette | null) => {
        if (cancelled || !res || res.cgram.length < 512) return
        setCgram(Uint8Array.from(res.cgram))
        setProvenance(res.provenance)
      })
      .catch(() => {
        /* keep the existing CGRAM; next level load re-syncs */
      })
    return () => {
      cancelled = true
    }
  }, [renderRefresh, selectedLevelRecordId])

  // Live header refresh: editing a palette-relevant header field (BG color, the
  // BG1/BG2/BG3/sprite palette rows, or level mode) reloads a different colour
  // block into CGRAM — the canvas re-skins immediately via the override, and this
  // keeps the swatch grid in lockstep. The edit rides the in-memory `override`,
  // so re-fetch the override-aware CGRAM and update only the colours (selection /
  // status preserved, like the rebuild refresh above). `override` sits in deps
  // for closure freshness, but the `headerVersion` guard limits the actual fetch
  // to a header change: an object edit (which also changes the override identity)
  // no-ops, and a level change is left to the level-load effect (which resets the
  // selection) rather than double-fetching here.
  const prevHeaderRef = useRef(headerVersion)
  const prevLevelForHeaderRef = useRef(selectedLevelRecordId)
  useEffect(() => {
    if (prevLevelForHeaderRef.current !== selectedLevelRecordId) {
      prevLevelForHeaderRef.current = selectedLevelRecordId
      prevHeaderRef.current = headerVersion
      return
    }
    if (prevHeaderRef.current === headerVersion) return
    prevHeaderRef.current = headerVersion
    if (selectedLevelRecordId === null) return
    let cancelled = false
    void window.shinyEgg.render
      .editablePalette({
        levelRecordId: selectedLevelRecordId,
        override: override?.recordId === selectedLevelRecordId ? override : undefined
      })
      .then((res: DecodedPalette | null) => {
        if (cancelled || !res || res.cgram.length < 512) return
        setCgram(Uint8Array.from(res.cgram))
        setProvenance(res.provenance)
      })
      .catch(() => {
        /* keep the existing CGRAM; next level load / rebuild re-syncs */
      })
    return () => {
      cancelled = true
    }
  }, [headerVersion, selectedLevelRecordId, override])

  /** The displayed BGR-15 word for CGRAM index `i` = the draft edit if any, else
   *  the base colour. */
  const wordAt = useCallback(
    (i: number): number => {
      if (!cgram) return 0
      const off = provenance ? provenance[i] : -1
      const d = off >= 0 ? draftMap.get(off) : undefined
      return d !== undefined ? d : cgram[i * 2] | (cgram[i * 2 + 1] << 8)
    },
    [cgram, provenance, draftMap]
  )

  const entries = useMemo<Uint32Array>(() => {
    const out = new Uint32Array(256)
    if (!cgram) return out
    const expand = (v: number): number => ((v << 3) | (v >>> 2)) & 0xff
    for (let i = 0; i < 256; i++) {
      const c15 = wordAt(i)
      const r = expand(c15 & 0x1f)
      const g = expand((c15 >>> 5) & 0x1f)
      const b = expand((c15 >>> 10) & 0x1f)
      out[i] = (0xff << 24) | (b << 16) | (g << 8) | r
    }
    return out
  }, [cgram, wordAt])

  const usedRows = useMemo(() => (paletteRowsUsed ? new Set(paletteRowsUsed) : null), [paletteRowsUsed])

  const selOffset = selected !== null ? provenance?.[selected] ?? -1 : -1
  const selectedHasEdit = selOffset >= 0 && draftMap.has(selOffset)
  const selColor = selected !== null && cgram ? bgr15ToHex(wordAt(selected)) : '#000000'

  // Throttled live preview while dragging (the draft → canvas paletteOverride).
  const throttledPreview = useThrottledCallback<number>((value) => {
    if (selected === null || !provenance) return
    const off = provenance[selected]
    if (off >= 0) editor.preview(off, value)
  }, PALETTE_PREVIEW_THROTTLE_MS)

  // Drag-start snapshot (null = not dragging) so the whole drag is ONE undo step.
  const dragStartRef = useRef<PaletteEdit[] | null>(null)

  // Native 'change' (= picker release) commits one undo step. React's onChange
  // fires per drag-frame (the `input` event) → throttled preview only.
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const commitRef = useRef<() => void>(() => {})
  commitRef.current = () => {
    const el = pickerRef.current
    if (!el || selected === null || !provenance) return
    const off = provenance[selected]
    if (off < 0) return
    const before = dragStartRef.current ?? editor.read()
    dragStartRef.current = null
    editor.commitFrom(before, off, hexToBgr15(el.value))
  }
  const pickerChangeRef = useRef<() => void>(() => commitRef.current())
  const attachPicker = useCallback((el: HTMLInputElement | null) => {
    if (pickerRef.current) pickerRef.current.removeEventListener('change', pickerChangeRef.current)
    pickerRef.current = el
    if (el) el.addEventListener('change', pickerChangeRef.current)
  }, [])

  // Keep the (uncontrolled) picker's value synced to the selected swatch's colour
  // when the selection / committed colour changes — done IMPERATIVELY (no
  // setState) so a per-frame drag doesn't re-render the 256-swatch grid every
  // tick (that, not the throttled canvas re-decode, was the drag slowdown).
  // Skipped mid-drag so it doesn't disturb the open OS colour dialog.
  useEffect(() => {
    const el = pickerRef.current
    if (el && dragStartRef.current === null) el.value = selColor
  }, [selColor])

  const resetSelectedColor = (): void => {
    if (selOffset >= 0) editor.resetColor(selOffset)
  }

  const message = error ? `Error: ${error}` : editor.saveError ? `Error: ${editor.saveError}` : status
  const editCount = editor.draft.length

  const renderCell = (i: number): JSX.Element => {
    const argb = entries[i]
    const r = argb & 0xff
    const g = (argb >> 8) & 0xff
    const b = (argb >> 16) & 0xff
    const css = cgram ? `rgb(${r}, ${g}, ${b})` : 'transparent'
    const hex = '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
    const idx = hexFmt(i, 2)
    const row = (i >> 4) & 0xf
    const col = i & 0xf
    const isBg = row < 8
    const region = row === 0 ? 'backdrop' : isBg ? `BG row ${row}` : `sprite row ${row - 8}`
    const unused = isBg && usedRows !== null && row !== 0 && !usedRows.has(row)
    const rowSel = isBg && (highlightRows?.has(row) ?? false)
    const editable = (provenance?.[i] ?? -1) >= 0
    const note = unused ? '  · unused by this level' : rowSel ? '  · used by selected object' : ''
    return (
      <button
        key={i}
        type="button"
        className={
          `se-palette__cell${unused ? ' is-unused' : ''}${rowSel ? ' is-sel' : ''}` +
          `${editable ? ' is-editable' : ''}${selected === i ? ' is-editing' : ''}`
        }
        style={{ background: css }}
        title={`CGRAM[0x${idx}]  ${region}, col ${col}  ${hex}${editable ? '  · click to edit' : ''}${note}`}
        onClick={() => editable && setSelected(i)}
      />
    )
  }

  return (
    <div className="se-palette">
      {stale && (
        <div className="se-palette__stale-warn" title="Palette edits are asm edits — they don't render live; the built ROM keeps the previous build's colours until you rebuild.">
          ⚠ Palette out of date — saved colour edits aren't in the built ROM yet.
          The swatches here and the in-game colours won't refresh until you rebuild
          (Test Level / Launch).
        </div>
      )}
      {selected !== null && cgram && (
        <div className="se-palette__editor">
          <input
            ref={attachPicker}
            type="color"
            className="se-palette__picker"
            defaultValue={selColor}
            onChange={(e) => {
              // Uncontrolled: NO setState here, so a per-frame drag doesn't
              // re-render the swatch grid — only the throttled preview re-renders
              // (and the swatch updates once per throttle window). The dialog
              // tracks its own value; we read it on preview / commit.
              if (dragStartRef.current === null) dragStartRef.current = editor.read()
              throttledPreview(hexToBgr15(e.currentTarget.value))
            }}
          />
          <div className="se-palette__editor-info">
            <div>
              <b>CGRAM[{hex0x(selected, 2)}]</b>{' '}
              <span className="se-palette__editor-dim">blob 0x{selOffset.toString(16)}</span>
            </div>
            <div className="se-palette__editor-warn">
              Global — changes every level using this palette. Previewed live; Save to keep it.
            </div>
          </div>
        </div>
      )}
      <div className="se-palette__section-label">Background</div>
      <div className="se-palette__grid">
        {Array.from({ length: 128 }, (_, i) => renderCell(i))}
      </div>
      <div className="se-palette__section-label">Sprites</div>
      <div className="se-palette__grid">
        {Array.from({ length: 128 }, (_, i) => renderCell(i + 128))}
      </div>
      <p className="se-palette__hint">
        {message}
        {editCount > 0 &&
          ` · ${editCount} colour edit${editCount === 1 ? '' : 's'}${editor.dirty ? ' (unsaved)' : ''}`}
      </p>
      <div className="se-palette__toolbar">
        <button
          type="button"
          className="se-palette__reset-btn is-save"
          disabled={!editor.dirty || editor.saving}
          onClick={() => void editor.save()}
          title="Save palette colour edits to the project (rebuilds on Test Level / Launch)"
        >
          {editor.saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="se-palette__reset-btn"
          disabled={!selectedHasEdit}
          onClick={resetSelectedColor}
          title="Revert just the selected colour to its base cart value"
        >
          Reset Color
        </button>
        {confirmReset ? (
          <span className="se-palette__reset-confirm">
            Discard all colour edits?
            <button
              type="button"
              className="se-palette__reset-btn is-danger"
              onClick={() => {
                setConfirmReset(false)
                editor.resetAll()
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="se-palette__reset-btn"
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="se-palette__reset-btn"
            disabled={editCount === 0}
            onClick={() => setConfirmReset(true)}
            title="Revert every colour edit to the base cart palette"
          >
            Reset all colors{editCount > 0 ? ` (${editCount})` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
