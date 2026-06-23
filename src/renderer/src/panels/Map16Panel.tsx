import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { LevelData, Map16SubTileEdit, Map16BlockPreview } from '../../../preload/api'
import { headerFromLevel } from './TilesPanel'

interface Props {
  /** The loaded level — its header colours + sources the BG1 tiles. */
  level: LevelData | null
  /** Mark the build dirty after a save/reset (Map16 edits apply on rebuild). */
  onMutated: () => void
}

const QUAD_LABELS = ['Top-left', 'Top-right', 'Bottom-left', 'Bottom-right']
const PREVIEW_SCALE = 8

const eqSub = (a: Map16SubTileEdit, b: Map16SubTileEdit): boolean =>
  a.tileIndex === b.tileIndex && a.paletteRow === b.paletteRow && a.hflip === b.hflip && a.vflip === b.vflip && a.priority === b.priority
const eqAll = (a: Map16SubTileEdit[] | null, b: Map16SubTileEdit[] | null): boolean =>
  !!a && !!b && a.length === b.length && a.every((s, i) => eqSub(s, b[i]!))

/**
 * Structured Map16 block editor (object-metatile Phase 3). Load a Map16 object
 * block, reassign each of its 4 sub-tiles (BG1 tile index / palette row / flip /
 * priority) with a live preview, and save — the edit is a size-neutral 8-byte
 * patch to the `$4C` region applied on the next build (Test Level / Launch).
 */
export function Map16Body({ level, onMutated }: Props): JSX.Element {
  const header = headerFromLevel(level)
  const [idText, setIdText] = useState('')
  const [map16Id, setMap16Id] = useState<number | null>(null)
  const [base, setBase] = useState<Map16SubTileEdit[] | null>(null) // as-loaded
  const [subs, setSubs] = useState<Map16SubTileEdit[] | null>(null) // edited draft
  const [preview, setPreview] = useState<Map16BlockPreview | null>(null)
  const [editedIds, setEditedIds] = useState<number[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const refreshEdited = useCallback(async (): Promise<void> => {
    try {
      setEditedIds(await window.shinyEgg.editor.listMap16BlockEdits())
    } catch {
      setEditedIds([])
    }
  }, [])
  useEffect(() => {
    void refreshEdited()
  }, [refreshEdited])

  const load = useCallback(async (id: number): Promise<void> => {
    setStatus(null)
    const st = await window.shinyEgg.editor.loadMap16Block(id)
    if (!st) {
      setStatus(`Map16 0x${id.toString(16)} isn't an editable block.`)
      setBase(null); setSubs(null); setMap16Id(null)
      return
    }
    setMap16Id(id)
    setBase(st)
    setSubs(st.map((s) => ({ ...s })))
  }, [])

  const onLoad = (): void => {
    const id = parseInt(idText.replace(/^0x/i, ''), 16)
    if (Number.isNaN(id)) { setStatus('Enter a Map16 id in hex, e.g. 15A.'); return }
    void load(id)
  }

  // Live preview whenever the draft (or level header) changes.
  useEffect(() => {
    if (!header || !subs) { setPreview(null); return }
    let cancelled = false
    void window.shinyEgg.editor.renderMap16Block(header, subs).then((p) => {
      if (!cancelled) setPreview(p)
    })
    return () => { cancelled = true }
  }, [header, subs])

  // Draw the 16×16 preview to the backing canvas (CSS scales it up, pixelated).
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !preview) return
    cv.width = preview.width
    cv.height = preview.height
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(new Uint8ClampedArray(preview.rgba), preview.width, preview.height), 0, 0)
  }, [preview])

  const setQuad = (q: number, patch: Partial<Map16SubTileEdit>): void => {
    setSubs((cur) => (cur ? cur.map((s, i) => (i === q ? { ...s, ...patch } : s)) : cur))
  }

  const dirty = !eqAll(subs, base)
  const isEdited = map16Id !== null && editedIds.includes(map16Id)

  const onSave = async (): Promise<void> => {
    if (map16Id === null || !subs) return
    const r = await window.shinyEgg.editor.saveMap16Block(map16Id, subs)
    if (r.ok) {
      setBase(subs.map((s) => ({ ...s })))
      onMutated()
      setStatus(`Saved Map16 0x${map16Id.toString(16)}. Rebuild (Test Level) to apply.`)
      void refreshEdited()
    } else {
      setStatus(`Save failed: ${r.error}`)
    }
  }

  const onReset = async (): Promise<void> => {
    if (map16Id === null) return
    const r = await window.shinyEgg.editor.resetMap16Block(map16Id)
    if (r.ok) {
      if (r.removed) onMutated()
      await load(map16Id)
      setStatus(`Reset Map16 0x${map16Id.toString(16)} to vanilla. Rebuild to apply.`)
      void refreshEdited()
    } else {
      setStatus(`Reset failed: ${r.error}`)
    }
  }

  return (
    <div className="se-map16">
      <p className="se-map16__desc">
        Edit a Map16 object block’s 4 sub-tiles (which BG1 tile, palette row and
        flip each quadrant uses). Changes apply on the next build (Test Level /
        Launch); the pixels themselves are edited via the Graphics panel.
      </p>
      <div className="se-map16__row">
        <label>
          Map16 id 0x
          <input
            value={idText}
            onChange={(e) => setIdText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onLoad() }}
            placeholder="15A"
            size={5}
          />
        </label>
        <button className="se-banks__act" onClick={onLoad} disabled={!header} title={header ? 'Load this Map16 block' : 'Load a level first'}>
          Load
        </button>
      </div>
      {!header && <p className="se-map16__status">Load a level first.</p>}
      {status && <p className="se-map16__status">{status}</p>}

      {subs && (
        <>
          <div className="se-map16__preview">
            <canvas
              ref={canvasRef}
              style={{ width: 16 * PREVIEW_SCALE, height: 16 * PREVIEW_SCALE, imageRendering: 'pixelated' }}
            />
          </div>
          <div className="se-map16__quads">
            {subs.map((s, q) => (
              <div key={q} className="se-map16__quad">
                <span className="se-map16__quad-label">{QUAD_LABELS[q]}</span>
                <label>
                  tile 0x
                  <input
                    value={s.tileIndex.toString(16)}
                    onChange={(e) => {
                      const v = parseInt(e.target.value || '0', 16)
                      if (!Number.isNaN(v)) setQuad(q, { tileIndex: v & 0x3ff })
                    }}
                    size={4}
                  />
                </label>
                <label>
                  pal
                  <select value={s.paletteRow} onChange={(e) => setQuad(q, { paletteRow: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label><input type="checkbox" checked={s.hflip} onChange={(e) => setQuad(q, { hflip: e.target.checked })} /> H</label>
                <label><input type="checkbox" checked={s.vflip} onChange={(e) => setQuad(q, { vflip: e.target.checked })} /> V</label>
                <label><input type="checkbox" checked={s.priority} onChange={(e) => setQuad(q, { priority: e.target.checked })} /> Pri</label>
              </div>
            ))}
          </div>
          <div className="se-map16__row">
            <button className="se-banks__act" onClick={() => void onSave()} disabled={!dirty} title="Save this block's definition (applies on rebuild)">
              Save
            </button>
            <button
              className="se-banks__act se-banks__act--danger"
              onClick={() => void onReset()}
              disabled={!isEdited}
              title="Discard this block's edit, back to vanilla"
            >
              Reset to vanilla
            </button>
          </div>
        </>
      )}

      <div className="se-map16__changes">
        <span className="se-map16__changes-title">Edited blocks ({editedIds.length})</span>
        {editedIds.length > 0 && (
          <ul className="se-map16__list">
            {editedIds.map((id) => (
              <li key={id}>
                <button className="se-map16__chip" onClick={() => { setIdText(id.toString(16)); void load(id) }}>
                  0x{id.toString(16).toUpperCase()}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
