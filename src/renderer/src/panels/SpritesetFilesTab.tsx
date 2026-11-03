import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { GfxFileBlock, LevelData, RenderHeaderRequest } from '../../../preload/api'
import { blitRgba } from '../lib/blit'
import type { SpritesetFilesEditorApi } from '../edit-session/useSpritesetFilesEditor'
import { headerFromLevel } from './TilesPanel'

const SPRITESET_COUNT = 128
const FILE_ID_COUNT = 0x100
const FILES_PER_ROW = 6
const hex2 = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`

function SpriteSheet({ block }: { block: GfxFileBlock }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => blitRgba(ref.current, block), [block])
  return (
    <div className="se-spriteset__sheet">
      <div className="se-spriteset__sheet-label">{block.label}</div>
      <div className="se-spriteset__sheet-meta">{block.sublabel}</div>
      <canvas
        ref={ref}
        className="se-spriteset__canvas"
        style={{ width: `${block.width * 2}px` }}
      />
    </div>
  )
}

interface Props {
  editor: SpritesetFilesEditorApi
  level: LevelData | null
  projectActive: boolean
}

export function SpritesetFilesTab({ editor, level, projectActive }: Props): JSX.Element {
  const [selected, setSelected] = useState(0)
  const [paletteRow, setPaletteRow] = useState(0)
  const [blocks, setBlocks] = useState<GfxFileBlock[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const tableRow = editor.model?.rows[selected]
  const header = useMemo<RenderHeaderRequest>(() => headerFromLevel(level) ?? ({
    bgColor: 0,
    bg1Tileset: 0,
    bg1Palette: 0,
    bg2Tileset: 0,
    bg2Palette: 0,
    bg3Tileset: 0,
    bg3Palette: 0,
    spriteTileset: selected,
    spritePalette: 0,
    yoshiColor: 0,
    isWorld6: false,
    levelMode: 0
  }), [level, selected])

  useEffect(() => {
    if (!tableRow) {
      setBlocks(null)
      return
    }
    let cancelled = false
    setBlocks(null)
    setPreviewError(null)
    const renderHeader = {
      ...header,
      spriteTileset: selected,
      spritesetOverride: tableRow.slice()
    }
    const timer = window.setTimeout(() => {
      void window.shinyEgg.render.gfxFiles({
        header: renderHeader,
        spritePaletteRow: paletteRow
      }).then((result) => {
        if (!cancelled) setBlocks(result.blocks.filter((block) => block.kind === 'sprite-sheet'))
      }).catch((error: unknown) => {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : String(error))
        }
      })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [header, paletteRow, selected, tableRow])

  const hasSlotLabels = blocks?.some((block) => block.dpSlot !== undefined) ?? false

  return (
    <div className="se-spriteset">
      <div className="se-spriteset__controls">
        <label>
          Sprite tileset
          <select
            className="se-input"
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
          >
            {Array.from({ length: SPRITESET_COUNT }, (_, id) => (
              <option key={id} value={id}>{hex2(id)}</option>
            ))}
          </select>
        </label>
        <label>
          Sprite palette row
          <select
            className="se-input"
            value={paletteRow}
            onChange={(event) => setPaletteRow(Number(event.target.value))}
          >
            {Array.from({ length: 8 }, (_, row) => (
              <option key={row} value={row}>{row}</option>
            ))}
          </select>
        </label>
        <div className="se-spriteset__actions">
          <button
            type="button"
            className="se-banks__act"
            onClick={() => editor.discard()}
            disabled={!editor.dirty || editor.saving}
          >
            Discard
          </button>
          <button
            type="button"
            className="se-banks__act"
            onClick={() => void editor.save()}
            disabled={!editor.dirty || editor.saving || !projectActive}
            title={projectActive ? 'Save sprite tileset edits to the project overlay' : 'Open a project to save edits'}
          >
            {editor.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="se-spriteset__status">
        {editor.error ?? editor.saveError ?? previewError ??
          (editor.status || (editor.dirty ? 'Unsaved sprite tileset edits' : ''))}
      </div>
      {!projectActive && (
        <div className="se-spriteset__hint">Open a project to save sprite tileset changes.</div>
      )}
      <div className="se-spriteset__files">
        {Array.from({ length: FILES_PER_ROW }, (_, slot) => (
          <label className="se-spriteset__file" key={slot}>
            <span>Slot {slot + 1}</span>
            <select
              className="se-input"
              value={tableRow?.[slot] ?? 0}
              disabled={!tableRow}
              onChange={(event) => editor.setFileId(selected, slot, Number(event.target.value))}
            >
              {Array.from({ length: FILE_ID_COUNT }, (_, fileId) => (
                <option key={fileId} value={fileId}>{hex2(fileId)}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="se-spriteset__preview">
        {!editor.model ? (
          <div className="se-spriteset__empty">{editor.error ?? editor.status ?? 'Loading sprite tilesets…'}</div>
        ) : previewError ? (
          <div className="se-spriteset__empty se-spriteset__empty--error">{previewError}</div>
        ) : blocks === null ? (
          <div className="se-spriteset__empty">Rendering {hex2(selected)}…</div>
        ) : blocks.length === 0 ? (
          <div className="se-spriteset__empty">No sprite sheets were emitted for this render context.</div>
        ) : hasSlotLabels ? (
          Array.from({ length: FILES_PER_ROW }, (_, slot) => {
            const slotBlocks = blocks.filter((block) => block.dpSlot === slot + 7)
            return (
              <section className="se-spriteset__slot" key={slot}>
                <h3>Slot {slot + 1} · {hex2(tableRow?.[slot] ?? 0)}</h3>
                {slotBlocks.length > 0
                  ? slotBlocks.map((block, index) => <SpriteSheet key={`${slot}-${index}-${block.vramByteOffset}`} block={block} />)
                  : <div className="se-spriteset__empty">No rendered sheet for this slot.</div>}
              </section>
            )
          })
        ) : (
          blocks.map((block, index) => <SpriteSheet key={`${index}-${block.vramByteOffset}`} block={block} />)
        )}
      </div>
    </div>
  )
}
