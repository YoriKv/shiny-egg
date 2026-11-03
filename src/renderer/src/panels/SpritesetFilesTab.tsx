import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { GfxFileBlock, LevelData, RenderHeaderRequest } from '../../../preload/api'
import { DiscardChangesModal } from '../DiscardChangesModal'
import { blitRgba } from '../lib/blit'
import { getSprite } from '../data/obj-metadata'
import { useLevelsCatalog } from '../data/levels'
import type { SpritesetFilesEditorApi } from '../edit-session/useSpritesetFilesEditor'
import { headerFromLevel } from './TilesPanel'
import { summarizeUsage, usageLabel } from '../lib/header-guide'

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

/** Which rooms use each row: the project's saved levels (main-side sweep,
 *  removed levels excluded), with the loaded level moved to its live (possibly
 *  unsaved) header row. `rootOf` groups sub-rooms under their world-map level
 *  (the header guide's warp graph). Refetched when the project, the loaded
 *  level, or the level catalog (removal, new level, ROM import) changes. */
function useSpritesetUsage(
  level: LevelData | null,
  projectActive: boolean
): { byRow: number[][]; rootOf: readonly (number | null)[] } | null {
  const [saved, setSaved] = useState<number[][] | null>(null)
  const [rootOf, setRootOf] = useState<readonly (number | null)[]>([])
  const recordId = level?.recordId ?? null
  const catalog = useLevelsCatalog()
  useEffect(() => {
    let alive = true
    void window.shinyEgg.render
      .spritesetUsage()
      .then((rows) => {
        if (alive) setSaved(rows)
      })
      .catch(() => {
        if (alive) setSaved(null)
      })
    return () => {
      alive = false
    }
  }, [projectActive, recordId, catalog])
  useEffect(() => {
    let alive = true
    void window.shinyEgg.render
      .headerGuide(recordId ?? 0)
      .then((g) => {
        if (alive) setRootOf(g.usage.rootOf)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [recordId])
  const liveRow = level && !level.empty && !level.special ? level.header[7] : undefined
  return useMemo(() => {
    if (!saved) return null
    if (recordId === null || liveRow === undefined) return { byRow: saved, rootOf }
    const byRow = saved.map((ids) => ids.filter((id) => id !== recordId))
    byRow[liveRow]?.push(recordId)
    byRow[liveRow]?.sort((a, b) => a - b)
    return { byRow, rootOf }
  }, [saved, rootOf, recordId, liveRow])
}

export function SpritesetFilesTab({ editor, level, projectActive }: Props): JSX.Element {
  const [selected, setSelected] = useState(level?.header[7] ?? 0)
  const [paletteRow, setPaletteRow] = useState(0)
  const [blocks, setBlocks] = useState<GfxFileBlock[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [actionStatus, setActionStatus] = useState<string | null>(null)
  const [fitBusy, setFitBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const tableRow = editor.model?.rows[selected]
  const referenceRow = editor.model?.referenceRows?.[selected]
  const canFit = !!level && !level.empty && !level.special
  const usage = useSpritesetUsage(level, projectActive)
  const rowUsers = usage?.byRow[selected] ?? []
  const otherUsers = rowUsers.filter((id) => id !== level?.recordId)
  const usageSummary = usage
    ? rowUsers.length === 0
      ? { text: 'No level in this project uses this tileset.', full: '' }
      : summarizeUsage(rowUsers, usage.rootOf, usageLabel)
    : null
  const sharedNote =
    otherUsers.length === 0
      ? ''
      : ` Edits to this tileset also change ${otherUsers.length} other room${otherUsers.length === 1 ? '' : 's'}.`

  useEffect(() => {
    if (level && !level.empty && !level.special) setSelected(level.header[7] ?? 0)
  }, [level?.recordId, level?.header[7]])

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

  async function fitCurrentLevel(): Promise<void> {
    if (!canFit || !level || !tableRow) return
    setFitBusy(true)
    setActionStatus(null)
    try {
      const result = await window.shinyEgg.render.fitSpritesetFiles({
        spriteNums: level.sprites.map((sprite) => sprite.num),
        spriteTileset: selected,
        files: tableRow.slice(),
        spriteFileRequirements: level.sprites.flatMap((sprite) => {
          const requirements = getSprite(sprite.num).spritesetFiles
          return requirements && requirements.length > 0
            ? [{
              spriteNum: sprite.num,
              files: requirements.map((file) => Number.parseInt(file, 16))
            }]
            : []
        })
      })
      editor.setRow(selected, result.files)
      if (result.overflowFiles.length > 0 || result.sequenceConflicts.length > 0) {
        const files = result.overflowFiles.map(hex2).join(', ')
        const reasons = []
        if (result.requiredFiles.length > FILES_PER_ROW) {
          reasons.push(
            `${result.requiredFiles.length} distinct gfx files exceed the six-slot limit. ` +
              `Uncovered: ${files}.`
          )
        } else if (result.overflowFiles.length > 0) {
          reasons.push(`Slot-bound graphics conflict with the six-slot mapping. Uncovered: ${files}.`)
        }
        if (result.sequenceConflicts.length > 0) {
          reasons.push(
            `Ordered multi-slot graphics could not be kept adjacent because of slot-bound graphics: ` +
              `${result.sequenceConflicts.map(hex2).join(', ')}.`
          )
        }
        setActionStatus(`Partial fit: ${reasons.join(' ')} Sprites may render incorrectly.${sharedNote}`)
      } else if (result.requiredFiles.length === 0) {
        setActionStatus('No variable gfx files are required; existing slot-based assignments were kept.')
      } else {
        setActionStatus(
          `Fitted row ${hex2(selected)} to all ${result.requiredFiles.length} required gfx files ` +
            `for ${level.sprites.length} placed sprite${level.sprites.length === 1 ? '' : 's'}. Save to apply.${sharedNote}`
        )
      }
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setFitBusy(false)
    }
  }

  function resetToReference(): void {
    if (!referenceRow) return
    editor.setRow(selected, referenceRow)
    setActionStatus(`Row ${hex2(selected)} reset in the draft. Save to persist the reference-cart values.`)
    setConfirmReset(false)
  }

  return (
    <div className="se-spriteset">
      <div className="se-spriteset__controls">
        <label>
          Sprite tileset
          <select
            className="se-input"
            value={selected}
            onChange={(event) => {
              setSelected(Number(event.target.value))
              setActionStatus(null)
            }}
          >
            {Array.from({ length: SPRITESET_COUNT }, (_, id) => {
              const n = usage?.byRow[id]?.length
              return (
                <option key={id} value={id}>
                  {n === undefined ? hex2(id) : n === 0 ? `${hex2(id)} (unused)` : `${hex2(id)} (${n})`}
                </option>
              )
            })}
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
            onClick={() => void fitCurrentLevel()}
            disabled={!canFit || !tableRow || fitBusy || editor.saving}
            title={canFit ? 'Fit this row to the placed sprites in the current level' : 'Load a regular level to fit its sprites'}
          >
            {fitBusy ? 'Fitting…' : 'Fit to level'}
          </button>
          <button
            type="button"
            className="se-banks__act se-banks__act--danger"
            onClick={() => setConfirmReset(true)}
            disabled={!referenceRow || editor.saving}
            title="Stage this row's reference-cart values"
          >
            Reset to reference…
          </button>
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

      {usageSummary && (
        <div
          className={`se-spriteset__usage${otherUsers.length > 0 ? ' is-shared' : ''}`}
          title={usageSummary.full}
        >
          {usageSummary.text}
          {otherUsers.length > 0 && ` · shared: edits change every room listed`}
        </div>
      )}
      <div className={`se-spriteset__status${actionStatus && /Partial fit:/.test(actionStatus) ? ' is-warning' : ''}`}>
        {editor.error ?? editor.saveError ?? previewError ??
          (actionStatus ?? (editor.status || (editor.dirty ? 'Unsaved sprite tileset edits' : '')))}
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
              onChange={(event) => {
                editor.setFileId(selected, slot, Number(event.target.value))
                setActionStatus(null)
              }}
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
      <DiscardChangesModal
        open={confirmReset}
        title={`Reset spriteset ${hex2(selected)}?`}
        body={`Replace all six file IDs in row ${hex2(selected)} with their reference-cart values. This only changes the editor draft; use Save to persist it. Other row edits will be left unchanged.`}
        confirmLabel="Reset row"
        danger
        onDiscard={resetToReference}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
