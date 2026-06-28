import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { hex as hexFmt, hex0x } from '../lib/hex'
import type {
  DecodedPalette,
  GradientEdit,
  LevelData,
  PaletteCatalog,
  PaletteCatalogEntry,
  PaletteCatalogGroup,
  PaletteEdit
} from '../../../preload/api'
import { bgr15ToHex, hexToBgr15 } from '../lib/bgr15'
import { type PaletteEditorApi } from '../edit-session/usePaletteEditor'
import { type GradientEditorApi } from '../edit-session/useGradientEditor'
import { useEmulatorRunning } from '../hooks/useEmulatorRunning'
import { useThrottledCallback } from '../lib/throttle'
import { fillGradient, gradientOffset, GRADIENT_BLACK, GRADIENT_STOPS } from '../lib/gradient'

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

/** Per-layer attribution of which BG palette rows (0..7) each background layer
 *  references in the current level — BG1 from Map16 usage, BG2/BG3 from their
 *  tilemaps. Drives the Palette panel's per-row indicator chips. */
export interface PaletteRowUsage {
  bg1: number[]
  bg2: number[]
  bg3: number[]
}

/** One per-row indicator chip. `kind` selects the chip colour (CSS
 *  `se-palette__tag is-<kind>`); `title` is the hover tooltip. */
interface RowTag {
  kind: 'backdrop' | 'bg1' | 'bg2' | 'bg3' | 'sprite' | 'unused'
  label: string
  title: string
}

interface PaletteBodyProps {
  selectedLevelRecordId: number | null
  /** Per-layer BG palette-row usage (BG1/BG2/BG3), from the shared tile-usage
   *  fetch. Drives the per-row "belongs to" indicators. Null while usage is
   *  unknown (then BG rows show no layer chips). */
  rowUsage: PaletteRowUsage | null
  /** BG palette rows (0..7) the selected object's blocks use — outlined. */
  highlightRows: Set<number> | null
  /** The App-level palette colour-edit document (usePaletteEditor). */
  editor: PaletteEditorApi
  /** The App-level backdrop-gradient colour-edit document (useGradientEditor) —
   *  drives the gradient strip shown for a gradient-backdrop level. */
  gradientEditor: GradientEditorApi
  /** Bumped on every successful build (and gfx edit). Re-fetches the BASE CGRAM
   *  (the built ROM changed) so the swatches refresh. */
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
 * **Editing aids:** each row carries indicator chips to its right marking what it
 * belongs to (Backdrop / BG1 / BG2 / BG3 / Sprite, or Unused for an unreferenced
 * BG row); selecting an object outlines the BG rows its blocks use.
 *
 * This is the **"Level Palette" tab**; the sibling {@link AllPalettesView} is the
 * whole-game catalog. Both are mounted by the {@link PaletteBody} tab wrapper and
 * share the App-level colour-edit document (`editor`).
 */
function LevelPaletteView({
  selectedLevelRecordId,
  rowUsage,
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
        setStatus(`Level ${hex0x(selectedLevelRecordId)} CGRAM — click to select, double-click to edit`)
      } catch (e) {
        if (cancelled) return
        setError(String(e instanceof Error ? e.message : e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedLevelRecordId])

  // (The "palette out of date" warning now lives at the canvas top, unified with
  // the graphics-out-of-date warning — see App's `visualsStale` / BlockerBar.)

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

  // Per-row "belongs to" indicators (to the right of each colour row). Row 0 is
  // the backdrop; BG rows 1-7 list the layer(s) that reference them (or Unused);
  // sprite rows 8-15 are the OBJ palette region. BG usage comes from `rowUsage`
  // (null ⇒ usage unknown, so BG rows show no layer chips).
  const rowTags = useCallback(
    (row: number): RowTag[] => {
      // Sprite rows 8-15 are the OBJ palette region (structural label).
      if (row >= 8) {
        const obj = row - 8
        return [{ kind: 'sprite', label: 'Sprite', title: `Sprite OBJ palette ${obj}` }]
      }
      // Row 0 always carries the backdrop (CGRAM index 0); BG layers can still
      // use its colours 1-15, so append any layer chips after it. Rows 1-7 are
      // BG-only — chip per referencing layer, or Unused if none.
      const tags: RowTag[] = []
      if (row === 0)
        tags.push({ kind: 'backdrop', label: 'Backdrop', title: 'Backdrop colour (CGRAM index 0)' })
      if (rowUsage) {
        if (rowUsage.bg1.includes(row)) tags.push({ kind: 'bg1', label: 'BG1', title: 'Used by BG1 (main level tiles)' })
        if (rowUsage.bg2.includes(row)) tags.push({ kind: 'bg2', label: 'BG2', title: 'Used by BG2 background' })
        if (rowUsage.bg3.includes(row)) tags.push({ kind: 'bg3', label: 'BG3', title: 'Used by BG3 background' })
      }
      if (tags.length === 0)
        tags.push({ kind: 'unused', label: 'Unused', title: 'No BG layer references this row in this level' })
      return tags
    },
    [rowUsage]
  )

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

  // Double-click a swatch → jump straight to editing: select it, then open the
  // OS colour picker. A color input's `.click()` opens its dialog without a
  // preserved user gesture, so a deferred rAF (after the input mounts) is fine;
  // the value is set explicitly since rAF runs before the passive value-sync.
  const openCellEdit = (i: number): void => {
    setSelected(i)
    const hex = bgr15ToHex(wordAt(i))
    requestAnimationFrame(() => {
      const el = pickerRef.current
      if (!el) return
      el.value = hex
      el.click()
    })
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
    const rowSel = isBg && (highlightRows?.has(row) ?? false)
    const editable = (provenance?.[i] ?? -1) >= 0
    const note = rowSel ? '  · used by selected object' : ''
    return (
      <button
        key={i}
        type="button"
        className={
          `se-palette__cell${rowSel ? ' is-sel' : ''}` +
          `${editable ? ' is-editable' : ''}${selected === i ? ' is-editing' : ''}`
        }
        style={{ background: css }}
        title={`CGRAM[0x${idx}]  ${region}, col ${col}  ${hex}${editable ? '  · double-click to edit' : ''}${note}`}
        onClick={(e) => {
          if (!editable) return
          if (e.detail >= 2) openCellEdit(i)
          else setSelected(i)
        }}
      />
    )
  }

  // One CGRAM row (0..15): its 16 swatches in a fixed-width strip, then the
  // indicator chips to the right. The chip column is fixed-width with clipped
  // overflow (see CSS) so long chip text can never resize the swatch grid.
  const renderRow = (row: number): JSX.Element => {
    const tags = rowTags(row)
    return (
      <div className="se-palette__row" key={row}>
        <div className="se-palette__row-cells">
          {Array.from({ length: 16 }, (_, c) => renderCell(row * 16 + c))}
        </div>
        <div
          className="se-palette__row-tags"
          title={tags.map((t) => t.title).join(' · ') || undefined}
        >
          {tags.map((t) => (
            <span key={t.kind} className={`se-palette__tag is-${t.kind}`}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="se-palette">
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
      <div className="se-palette__rows">
        {Array.from({ length: 8 }, (_, r) => renderRow(r))}
      </div>
      <div className="se-palette__section-label">Sprites</div>
      <div className="se-palette__rows">
        {Array.from({ length: 8 }, (_, r) => renderRow(r + 8))}
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

/**
 * The level's backdrop gradient (24 BGR-15 stops) — shown only for a gradient
 * backdrop (BackgroundColor header byte $10..$1F); a solid backdrop has no table.
 * Each stop is a clickable swatch (double-click opens the OS colour picker); a
 * drag previews live and commits one undo step on release, exactly like the CGRAM
 * swatch picker. Generate controls: **Clear** (all stops black) and **Fill
 * gradient** (interpolate between sequential non-black stops). Edits are global
 * (the table is shared by every level with this BackgroundColor) and preview on
 * the canvas via `gradientOverride` until Save bakes them.
 */
function GradientStrip({
  editor,
  bgColor
}: {
  editor: GradientEditorApi
  bgColor: number | null
}): JSX.Element {
  const gradientId = bgColor !== null && bgColor >= 0x10 ? bgColor - 0x10 : null
  const base = gradientId !== null ? editor.baseColors?.[gradientId] ?? null : null
  const [selected, setSelected] = useState<number | null>(null)
  const { draftMap } = editor

  // Reset the selection when the level's gradient table changes.
  useEffect(() => {
    setSelected(null)
  }, [gradientId])

  const effective = useCallback(
    (i: number): number => {
      if (gradientId === null || !base) return 0
      return draftMap.get(gradientOffset(gradientId, i)) ?? base[i]!
    },
    [gradientId, base, draftMap]
  )
  const selColor = selected !== null ? bgr15ToHex(effective(selected)) : '#000000'

  // Throttled live preview while dragging the picker (draft → canvas gradientOverride).
  const throttledPreview = useThrottledCallback<number>((value) => {
    if (selected === null || gradientId === null) return
    editor.preview(gradientOffset(gradientId, selected), value)
  }, PALETTE_PREVIEW_THROTTLE_MS)

  // Native 'change' (picker release) commits one undo step; React onChange (the
  // per-frame 'input' event) only previews — same split as the CGRAM picker.
  const dragStartRef = useRef<GradientEdit[] | null>(null)
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const commitRef = useRef<() => void>(() => {})
  commitRef.current = () => {
    const el = pickerRef.current
    if (!el || selected === null || gradientId === null) return
    const before = dragStartRef.current ?? editor.read()
    dragStartRef.current = null
    editor.commitFrom(before, gradientOffset(gradientId, selected), hexToBgr15(el.value))
  }
  const pickerChangeRef = useRef<() => void>(() => commitRef.current())
  const attachPicker = useCallback((el: HTMLInputElement | null) => {
    if (pickerRef.current) pickerRef.current.removeEventListener('change', pickerChangeRef.current)
    pickerRef.current = el
    if (el) el.addEventListener('change', pickerChangeRef.current)
  }, [])

  // Keep the uncontrolled picker synced to the selected stop's colour, except mid-drag.
  useEffect(() => {
    const el = pickerRef.current
    if (el && dragStartRef.current === null) el.value = selColor
  }, [selColor])

  const openStopEdit = (i: number): void => {
    setSelected(i)
    const hex = bgr15ToHex(effective(i))
    requestAnimationFrame(() => {
      const el = pickerRef.current
      if (!el) return
      el.value = hex
      el.click()
    })
  }

  if (gradientId === null) {
    // No gradient table: prompt to pick a level when none is loaded; otherwise the
    // loaded level genuinely uses a solid backdrop (BackgroundColor < 0x10).
    return (
      <>
        <div className="se-palette__section-label">Backdrop gradient</div>
        <p className="se-palette__hint">
          {bgColor === null
            ? 'Pick a level to see its backdrop gradient.'
            : 'This level uses a solid backdrop colour (BackgroundColor below 0x10) — no gradient table.'}
        </p>
      </>
    )
  }
  if (!base) {
    return (
      <>
        <div className="se-palette__section-label">Backdrop gradient</div>
        <p className="se-palette__hint">Loading gradient…</p>
      </>
    )
  }

  const colors = Array.from({ length: GRADIENT_STOPS }, (_, i) => effective(i))
  const editsHere = colors.reduce((n, c, i) => (c !== base[i] ? n + 1 : n), 0)

  return (
    <>
      <div className="se-palette__section-label">
        Backdrop gradient <span className="se-palette__editor-dim">table {hex0x(gradientId, 2)}</span>
      </div>
      <div
        className="se-gradient__strip"
        title="Backdrop gradient stops — left = bottom of level, right = top"
      >
        {colors.map((c, i) => {
          const css = bgr15ToHex(c)
          const where = i === 0 ? ' (bottom)' : i === GRADIENT_STOPS - 1 ? ' (top)' : ''
          return (
            <button
              key={i}
              type="button"
              className={`se-gradient__stop${selected === i ? ' is-selected' : ''}`}
              style={{ background: css }}
              title={`Stop ${i}${where}  ${css} · double-click to edit`}
              onClick={(e) => {
                if (e.detail >= 2) openStopEdit(i)
                else setSelected(i)
              }}
            />
          )
        })}
      </div>
      <div className="se-palette__editor">
        <input
          ref={attachPicker}
          type="color"
          className="se-palette__picker"
          defaultValue={selColor}
          disabled={selected === null}
          onChange={(e) => {
            if (dragStartRef.current === null) dragStartRef.current = editor.read()
            throttledPreview(hexToBgr15(e.currentTarget.value))
          }}
        />
        <div className="se-palette__editor-info">
          {selected !== null ? (
            <div>
              <b>Stop {selected}</b>{' '}
              <span className="se-palette__editor-dim">{bgr15ToHex(effective(selected))}</span>
            </div>
          ) : (
            <div className="se-palette__editor-dim">
              Click a stop to select; double-click for the colour picker.
            </div>
          )}
          <div className="se-palette__editor-warn">
            Global — changes every level using this gradient. Previewed live; Save to keep it.
          </div>
        </div>
      </div>
      <div className="se-palette__toolbar">
        <button
          type="button"
          className="se-palette__reset-btn is-save"
          disabled={!editor.dirty || editor.saving}
          onClick={() => void editor.save()}
          title="Save gradient edits to the project (rebuilds on Test Level / Launch)"
        >
          {editor.saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="se-palette__reset-btn"
          onClick={() => editor.setTableColors(gradientId, fillGradient(colors))}
          title="Interpolate a gradient between each sequential pair of non-black stops"
        >
          Fill gradient
        </button>
        <button
          type="button"
          className="se-palette__reset-btn"
          onClick={() => editor.setTableColors(gradientId, new Array(GRADIENT_STOPS).fill(GRADIENT_BLACK))}
          title="Set all 24 stops to black"
        >
          Clear
        </button>
        <button
          type="button"
          className="se-palette__reset-btn"
          disabled={editsHere === 0}
          onClick={() => editor.resetTable(gradientId)}
          title="Revert this gradient to the base cart colours"
        >
          Reset{editsHere > 0 ? ` (${editsHere})` : ''}
        </button>
      </div>
      {editor.saveError && <p className="se-palette__hint">Error: {editor.saveError}</p>}
    </>
  )
}

/**
 * Palette panel body — a three-tab wrapper. **Level Palette**
 * ({@link LevelPaletteView}) is the per-level CGRAM editor; **Level Gradient**
 * ({@link GradientStrip}) is the per-level backdrop colour-gradient editor (its own
 * `gradientEditor` document); **All Palettes** ({@link AllPalettesView}) is the
 * whole-game catalog (every master-blob palette by pointer table + by scene). The
 * two palette tabs edit the SAME global colour-edit document (`editor`), so a colour
 * changed in either previews on the canvas and bakes on Save / Test Level identically.
 */
export function PaletteBody(props: PaletteBodyProps): JSX.Element {
  const [tab, setTab] = useState<'level' | 'gradient' | 'all'>('level')
  const editor = props.editor
  const emulatorRunning = useEmulatorRunning()
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  // Blob offsets the last successful sync wrote — so the next sync can REVERT any
  // since undone/reset (write them back to base), without disturbing colours the
  // user never touched.
  const lastSyncedOffsets = useRef<Set<number>>(new Set())

  // "Sync to Emulator": apply the current colour edits to the CGRAM of the screen the
  // emulator is showing right now (main detects the game mode). Writes only the edited
  // entries + reverts of ones undone since the last sync — nothing else. Per-screen
  // only (the master blob is read-only ROM); re-sync after switching screens. Manual,
  // so it never competes with gameplay; the button only enables while EmuHawk runs.
  const handleSync = useCallback(async () => {
    setSyncing(true)
    setSyncStatus(null)
    try {
      const currentOffsets = new Set(editor.draft.map((e) => e.offset))
      const revert = [...lastSyncedOffsets.current].filter((o) => !currentOffsets.has(o))
      const r = await window.shinyEgg.bizhawk.applyPaletteLive(editor.draft, revert)
      if (!r.applied) {
        setSyncStatus('Emulator not running.')
      } else if (r.scene) {
        lastSyncedOffsets.current = currentOffsets
        setSyncStatus(`Synced to ${r.scene} screen (${r.bytesWritten ?? 0} B). Re-sync after switching screens.`)
      } else {
        setSyncStatus('Current screen not recognized — nothing written. Try on a level or the world map.')
      }
    } catch (e) {
      setSyncStatus(`Sync failed — ${(e as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }, [editor])

  // Clear the status after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!syncStatus) return
    const t = setTimeout(() => setSyncStatus(null), 6000)
    return () => clearTimeout(t)
  }, [syncStatus])

  return (
    <div className="se-palette-tabs">
      <div className="se-palette-tabs__bar">
        <button
          type="button"
          className={`se-palette-tabs__tab${tab === 'level' ? ' is-active' : ''}`}
          onClick={() => setTab('level')}
          title="The selected level's composed CGRAM"
        >
          Lvl Palette
        </button>
        <button
          type="button"
          className={`se-palette-tabs__tab${tab === 'gradient' ? ' is-active' : ''}`}
          onClick={() => setTab('gradient')}
          title="The selected level's backdrop colour gradient (gradient backdrops only)"
        >
          Lvl Gradient
        </button>
        <button
          type="button"
          className={`se-palette-tabs__tab${tab === 'all' ? ' is-active' : ''}`}
          onClick={() => setTab('all')}
          title="Every palette the game can select, from the master palette blob"
        >
          All Palettes
        </button>
        <div className="se-palette-sync__wrap">
          {syncStatus && (
            <div className="se-palette-sync__status" role="status">
              {syncStatus}
            </div>
          )}
          <button
            type="button"
            className="se-palette-sync"
            onClick={() => void handleSync()}
            disabled={!emulatorRunning || syncing}
            title={
              emulatorRunning
                ? 'Write the current palette edits into the screen the emulator is showing now (re-sync after switching screens)'
                : 'Launch or Test Level to enable'
            }
          >
            {syncing ? 'Syncing…' : 'Sync to Emulator'}
          </button>
        </div>
      </div>
      {tab === 'level' ? (
        <LevelPaletteView {...props} />
      ) : tab === 'gradient' ? (
        <div className="se-palette">
          <GradientStrip editor={props.gradientEditor} bgColor={props.override?.header?.[0] ?? null} />
        </div>
      ) : (
        <AllPalettesView editor={props.editor} renderRefresh={props.renderRefresh} />
      )}
    </div>
  )
}

// ── All Palettes tab ─────────────────────────────────────────────────────────

/** Render a master-blob BGR-15 word as a CSS colour (5→8-bit expansion via the
 *  shared `bgr15ToHex`, the same the picker uses, so swatch ≡ picker value). */
function bgr15Css(word: number): string {
  return bgr15ToHex(word)
}

/** Colour-picker mechanics for the All-Palettes tab, keyed on a master-blob
 *  byte-offset. The offset twin of {@link LevelPaletteView}'s CGRAM-index picker
 *  — same throttled-preview / one-undo-per-drag model (a drag previews live and
 *  commits a single undo step on release). */
/** A selected swatch: its primary blob offset, any mirror offsets that take the
 *  same edit (World-map panels), and its base colour. */
interface CatalogSel {
  offset: number
  mirrors: number[]
  base: number
}

function useCatalogPicker(editor: PaletteEditorApi): {
  sel: CatalogSel | null
  setSel: (s: CatalogSel | null) => void
  /** Select a swatch AND open the OS colour picker (double-click). */
  selectAndOpen: (s: CatalogSel) => void
  selColor: string
  selHasEdit: boolean
  attachPicker: (el: HTMLInputElement | null) => void
  onPickerInput: (value: string) => void
  resetSelected: () => void
} {
  const [sel, setSel] = useState<CatalogSel | null>(null)
  const { draftMap } = editor
  // All offsets this selection writes (primary + mirrored copies).
  const allOffsets = sel ? [sel.offset, ...sel.mirrors] : []
  const curWord = sel ? draftMap.get(sel.offset) ?? sel.base : 0
  const selColor = sel ? bgr15ToHex(curWord) : '#000000'
  const selHasEdit = allOffsets.some((o) => draftMap.has(o))

  // Drag-start snapshot (null = not dragging) so the whole drag is ONE undo step.
  const dragStartRef = useRef<PaletteEdit[] | null>(null)
  const pickerRef = useRef<HTMLInputElement | null>(null)

  const throttledPreview = useThrottledCallback<number>((value) => {
    if (sel) editor.previewMany(allOffsets, value)
  }, PALETTE_PREVIEW_THROTTLE_MS)

  // Native 'change' (picker release) commits one undo step; React onChange (the
  // per-frame 'input' event) only previews — same split as the level tab.
  const commitRef = useRef<() => void>(() => {})
  commitRef.current = () => {
    const el = pickerRef.current
    if (!el || !sel) return
    const before = dragStartRef.current ?? editor.read()
    dragStartRef.current = null
    editor.commitManyFrom(before, allOffsets, hexToBgr15(el.value))
  }
  const changeRef = useRef<() => void>(() => commitRef.current())
  const attachPicker = useCallback((el: HTMLInputElement | null) => {
    if (pickerRef.current) pickerRef.current.removeEventListener('change', changeRef.current)
    pickerRef.current = el
    if (el) el.addEventListener('change', changeRef.current)
  }, [])

  // Keep the (uncontrolled) picker synced to the selected colour, except mid-drag.
  useEffect(() => {
    const el = pickerRef.current
    if (el && dragStartRef.current === null) el.value = selColor
  }, [selColor])

  const onPickerInput = (value: string): void => {
    if (dragStartRef.current === null) dragStartRef.current = editor.read()
    throttledPreview(hexToBgr15(value))
  }
  const resetSelected = (): void => {
    if (sel) editor.resetColors(allOffsets)
  }

  // Double-click → select the swatch AND open the OS picker. A color input's
  // `.click()` opens its dialog without a preserved user gesture, so a deferred
  // rAF (after the input mounts) works; the value is set explicitly since rAF
  // runs before the passive value-sync effect.
  const selectAndOpen = (s: CatalogSel): void => {
    setSel(s)
    const hex = bgr15ToHex(draftMap.get(s.offset) ?? s.base)
    requestAnimationFrame(() => {
      const el = pickerRef.current
      if (!el) return
      el.value = hex
      el.click()
    })
  }

  return { sel, setSel, selectAndOpen, selColor, selHasEdit, attachPicker, onPickerInput, resetSelected }
}

/**
 * The whole-game palette catalog (`render.paletteCatalog`): every selectable
 * master-blob palette, by pointer table (BG1/BG2/BG3/sprite/Yoshi/backdrop +
 * fixed/universal) and by scene (system screens / world maps), each labelled with
 * what the graphics pipeline knows. Swatches are **editable** — a click selects
 * its blob offset and the picker writes the SAME global colour-edit document as
 * the level tab (a change propagates everywhere that offset is used). Groups are
 * collapsible; only expanded groups render swatches (keeps the DOM light).
 */
function AllPalettesView({
  editor,
  renderRefresh
}: {
  editor: PaletteEditorApi
  renderRefresh: number
}): JSX.Element {
  const [catalog, setCatalog] = useState<PaletteCatalog | null>(null)
  const [status, setStatus] = useState<string>('Loading palette catalog…')
  // All groups start collapsed; the user expands what they want.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [confirmReset, setConfirmReset] = useState(false)
  const picker = useCatalogPicker(editor)

  // Fetch the catalog on mount + after each build (renderRefresh) — a rebuild can
  // change the base blob, so re-source the base colours (the draft overlays).
  useEffect(() => {
    let cancelled = false
    setStatus('Loading palette catalog…')
    void window.shinyEgg.render
      .paletteCatalog()
      .then((res) => {
        if (cancelled) return
        if (!res) {
          setCatalog(null)
          setStatus('No palette data — build the ROM first.')
          return
        }
        setCatalog(res)
        setStatus('')
      })
      .catch((e) => {
        if (!cancelled) setStatus(`Error: ${String(e instanceof Error ? e.message : e)}`)
      })
    return () => {
      cancelled = true
    }
  }, [renderRefresh])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Click delegation: read the blob offset + colour off the clicked swatch.
  // Single click selects; double-click (e.detail >= 2) opens the OS picker.
  const { setSel, selectAndOpen } = picker
  const onGridClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const el = (e.target as HTMLElement).closest('[data-offset]') as HTMLElement | null
      if (!el) return
      const offset = Number(el.dataset.offset)
      if (!Number.isFinite(offset) || offset < 0) return
      const mirrors = el.dataset.mirrors
        ? el.dataset.mirrors.split(',').map(Number).filter((n) => Number.isFinite(n))
        : []
      const selObj = { offset, mirrors, base: Number(el.dataset.base) }
      if (e.detail >= 2) selectAndOpen(selObj)
      else setSel(selObj)
    },
    [setSel, selectAndOpen]
  )

  const editCount = editor.draft.length

  return (
    <div className="se-palcat">
      {picker.sel && (
        <div className="se-palette__editor">
          <input
            ref={picker.attachPicker}
            type="color"
            className="se-palette__picker"
            defaultValue={picker.selColor}
            onChange={(e) => picker.onPickerInput(e.currentTarget.value)}
          />
          <div className="se-palette__editor-info">
            <div>
              <b>blob 0x{picker.sel.offset.toString(16)}</b>{' '}
              <span className="se-palette__editor-dim">{picker.selColor}</span>
              {picker.sel.mirrors.length > 0 && (
                <span className="se-palette__editor-dim">
                  {' '}
                  · +{picker.sel.mirrors.length} synced copies
                </span>
              )}
            </div>
            <div className="se-palette__editor-warn">
              Global — changes every palette using this colour. Previewed live; Save to keep it.
            </div>
          </div>
        </div>
      )}

      <div className="se-palcat__scroll">
        {catalog ? (
          <>
            {catalog.catalog.map((g) => (
              <CatalogGroupView
                key={g.id}
                group={g}
                expanded={expanded.has(g.id)}
                onToggle={() => toggle(g.id)}
                draftMap={editor.draftMap}
                selOffset={picker.sel?.offset ?? -1}
                onGridClick={onGridClick}
              />
            ))}
            {catalog.scenes.length > 0 && (
              <div className="se-palcat__section-head">Scenes (system screens / maps)</div>
            )}
            {catalog.scenes.map((g) => (
              <CatalogGroupView
                key={g.id}
                group={g}
                expanded={expanded.has(g.id)}
                onToggle={() => toggle(g.id)}
                draftMap={editor.draftMap}
                selOffset={picker.sel?.offset ?? -1}
                onGridClick={onGridClick}
              />
            ))}
          </>
        ) : (
          <p className="se-palette__hint">{status}</p>
        )}
      </div>

      <p className="se-palette__hint">
        {status && catalog
          ? status
          : 'Single-click selects a swatch; double-click opens the colour picker. Edits are global.'}
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
          disabled={!picker.selHasEdit}
          onClick={picker.resetSelected}
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
            <button type="button" className="se-palette__reset-btn" onClick={() => setConfirmReset(false)}>
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

/** One collapsible catalog group (a pointer table or a scene class). Renders its
 *  swatch grids only when expanded. */
function CatalogGroupView({
  group,
  expanded,
  onToggle,
  draftMap,
  selOffset,
  onGridClick
}: {
  group: PaletteCatalogGroup
  expanded: boolean
  onToggle: () => void
  draftMap: Map<number, number>
  selOffset: number
  onGridClick: (e: ReactMouseEvent<HTMLDivElement>) => void
}): JSX.Element {
  return (
    <div className="se-palcat__group" data-group={group.id}>
      <button type="button" className="se-palcat__group-head" onClick={onToggle}>
        <span className={`se-palcat__caret${expanded ? ' is-open' : ''}`}>▸</span>
        <span className="se-palcat__group-label">{group.label}</span>
        <span className="se-palcat__group-count">{group.entries.length}</span>
      </button>
      {expanded && (
        <div className="se-palcat__group-body">
          {group.note && <div className="se-palcat__note">{group.note}</div>}
          {group.entries.map((entry, i) => (
            <CatalogEntryRow
              key={i}
              entry={entry}
              draftMap={draftMap}
              selOffset={selOffset}
              onGridClick={onGridClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One catalog entry — a label + a swatch strip laid out `entry.cols` wide. */
function CatalogEntryRow({
  entry,
  draftMap,
  selOffset,
  onGridClick
}: {
  entry: PaletteCatalogEntry
  draftMap: Map<number, number>
  selOffset: number
  onGridClick: (e: ReactMouseEvent<HTMLDivElement>) => void
}): JSX.Element {
  return (
    <div className="se-palcat__entry">
      <div className="se-palcat__entry-label" title={entry.sublabel}>
        <span className="se-palcat__entry-name">{entry.label}</span>
        {entry.sublabel && <span className="se-palcat__entry-sub">{entry.sublabel}</span>}
      </div>
      <div
        className="se-palcat__grid"
        style={{ gridTemplateColumns: `repeat(${entry.cols}, var(--se-palcat-cell, 14px))` }}
        onClick={onGridClick}
      >
        {entry.swatches.map((sw, i) => {
          const editable = sw.offset >= 0
          const word = editable ? draftMap.get(sw.offset) ?? sw.base : sw.base
          const edited = editable && (draftMap.has(sw.offset) || !!sw.mirrors?.some((o) => draftMap.has(o)))
          const isSel = editable && sw.offset === selOffset
          const syncNote = sw.mirrors?.length ? `  · syncs ${sw.mirrors.length + 1} copies` : ''
          return (
            <button
              key={i}
              type="button"
              data-offset={sw.offset}
              data-base={sw.base}
              data-mirrors={sw.mirrors?.length ? sw.mirrors.join(',') : undefined}
              className={
                `se-palcat__cell${editable ? ' is-editable' : ''}` +
                `${edited ? ' is-edited' : ''}${isSel ? ' is-sel' : ''}`
              }
              style={{ background: bgr15Css(word) }}
              title={
                editable
                  ? `blob 0x${sw.offset.toString(16)}  ${bgr15ToHex(word)}${syncNote}${edited ? '  · edited' : '  · double-click to edit'}`
                  : `${bgr15ToHex(word)}  · not blob-backed`
              }
            />
          )
        })}
      </div>
    </div>
  )
}
