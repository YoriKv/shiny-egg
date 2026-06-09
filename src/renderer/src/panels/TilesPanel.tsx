import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  GfxFileBlock,
  GfxFileEntry,
  GfxFilesResult,
  LevelData,
  LevelRenderRequest,
  LevelTileUsage,
  RenderHeaderRequest,
  TileCoverage
} from '../../../preload/api'
import { persistedState } from '../lib/persisted-state'
import { hex0x } from '../lib/hex'
import { blitRgba } from '../lib/blit'

interface TilesBodyProps {
  /** The live edited level (App-owned) — drives every view + tracks edits. */
  level: LevelData | null
  /** Record id of the loaded level — for the Header tab's gfx-manifest fetch. */
  selectedLevelRecordId: number | null
  /** The level's Map16 usage (App-owned fetch, shared with the Palette panel). */
  usage: LevelTileUsage | null
  /** Map16 IDs the selected object stamps — outlined in the Used view. */
  highlightBlockIds: Set<number> | null
}

type Mode = 'used' | 'files' | 'header'

interface PanelState {
  mode: Mode
  /** Sprite palette row (0..7 = CGRAM rows 8..15). Used by Files mode
   *  to pick a default for sprite-sheet blocks. The cart picks per-
   *  sprite via OAM attribute, so there's no globally correct value;
   *  this is a user-facing inspector default. */
  spritePaletteRow: number
}

const DEFAULT_STATE: PanelState = { mode: 'used', spritePaletteRow: 0 }
const STATE_KEY = 'shinyEgg.tilesPanel.v1'
const store = persistedState<PanelState>(STATE_KEY, DEFAULT_STATE)

const MODE_LABELS: Record<Mode, string> = {
  used: 'Map16 Blocks',
  files: 'Files',
  header: 'Header'
}

const MODE_TITLES: Record<Mode, string> = {
  used: 'The Map16 blocks THIS level stamps, across every page it loads — usage count, palette, and VRAM-coverage health',
  files: 'Per-file blocks — matches the cart\'s scene_gfx_layout chunk-list + animated slots',
  header: 'Level-header rendering config — per-layer tilesets/palettes, spriteset, and the gfx files this level loads into VRAM'
}

const COVERAGE_LABEL: Record<TileCoverage, string> = {
  loaded: 'graphics loaded',
  anim: 'filled by tile animation',
  miss: 'GRAPHICS NOT LOADED — renders as garbage'
}

/** 2× display scale so the 8×8 source pixels are readable on screen.
 *  Image-rendering: pixelated keeps it nearest-neighbor sharp. */
const BLOCK_DISPLAY_SCALE = 2

const hex4 = (n: number): string => hex0x(n, 4)

/** Build the render header from the live level — used by the Files tab.
 *  (`isWorld6` is resolved main-side; Files renders the non-dark tileset for
 *  world-6 levels, a pre-existing limitation.) */
function headerFromLevel(level: LevelData | null): RenderHeaderRequest | null {
  if (!level || level.empty || level.special) return null
  const h = level.header
  return {
    bgColor: h[0] ?? 0,
    bg1Tileset: h[1] ?? 0,
    bg1Palette: h[2] ?? 0,
    bg2Tileset: h[3] ?? 0,
    bg2Palette: h[4] ?? 0,
    bg3Tileset: h[5] ?? 0,
    bg3Palette: h[6] ?? 0,
    spriteTileset: h[7] ?? 0,
    spritePalette: h[8] ?? 0,
    yoshiColor: 0,
    isWorld6: false,
    levelMode: h[9] ?? 0,
    animationTileset: h[10] ?? 0
  }
}

/** The "Used in this level" grid: the composite thumbnail of the level's blocks
 *  with a per-cell coverage badge + selection outline, row-major in usage order
 *  (most-placed first). Detail lives in each cell's tooltip. */
function UsedBlocks({
  usage,
  highlightBlockIds
}: {
  usage: LevelTileUsage
  highlightBlockIds: Set<number> | null
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    blitRgba(ref.current, usage.image)
  }, [usage])

  const cell = usage.cellPx * BLOCK_DISPLAY_SCALE
  const gridWidth = usage.cellsPerRow * cell
  return (
    <div className="se-tiles__used" style={{ width: `${gridWidth}px` }}>
      <canvas
        ref={ref}
        className="se-tiles__used-canvas"
        style={{
          width: `${usage.image.width * BLOCK_DISPLAY_SCALE}px`,
          height: `${usage.image.height * BLOCK_DISPLAY_SCALE}px`
        }}
      />
      <div className="se-tiles__used-grid">
        {usage.blocks.map((b) => {
          const sel = highlightBlockIds?.has(b.id) ?? false
          return (
            <div
              key={b.id}
              className={
                `se-tiles__used-cell se-cov--${b.coverage}` +
                (sel ? ' is-sel' : '') +
                (b.overflow ? ' is-overflow' : '')
              }
              style={{ width: `${cell}px`, height: `${cell}px` }}
              title={
                `Map16 ${hex4(b.id)}  ×${b.count}\n` +
                `palette row ${b.paletteRows.join(', ') || '—'}\n` +
                `${COVERAGE_LABEL[b.coverage]}${b.overflow ? '\npage overflow (tile past page data)' : ''}`
              }
            >
              {b.coverage !== 'loaded' && (
                <span className="se-tiles__cov-badge">{b.coverage === 'miss' ? '!' : '~'}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Renders one Files-mode block: header label + canvas of the block's RGBA. */
function FileBlock({ block }: { block: GfxFileBlock }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    blitRgba(ref.current, block)
  }, [block])
  return (
    <div className={`se-tiles__block se-tiles__block--${block.kind}`}>
      <div className="se-tiles__block-label">{block.label}</div>
      <div className="se-tiles__block-sublabel">{block.sublabel}</div>
      <canvas
        ref={ref}
        className="se-tiles__block-canvas"
        style={{
          width: `${block.width * BLOCK_DISPLAY_SCALE}px`,
          height: `${block.height * BLOCK_DISPLAY_SCALE}px`
        }}
      />
    </div>
  )
}

function FilesBlockList({ blocks }: { blocks: GfxFileBlock[] }): JSX.Element {
  return (
    <div className="se-tiles__blocks">
      {blocks.map((b, i) => (
        <FileBlock key={`${b.kind}-${b.vramByteOffset}-${i}`} block={b} />
      ))}
    </div>
  )
}

// ── Header tab ──────────────────────────────────────────────────────────────
// The 15-field unpacked level header (see engine/inspect-level.ts HEADER_LABELS
// / header.ts). The two-column layer table covers the BG/sprite/animation
// tileset+palette pairs; the scalar list covers the rest.
const hex2 = (n: number): string => hex0x(n, 2)

const HEADER_LAYERS: { label: string; tileset: number; palette: number }[] = [
  { label: 'BG1', tileset: 1, palette: 2 },
  { label: 'BG2', tileset: 3, palette: 4 },
  { label: 'BG3', tileset: 5, palette: 6 },
  { label: 'Sprites', tileset: 7, palette: 8 },
  { label: 'Animation', tileset: 10, palette: 11 }
]

const HEADER_SCALARS: { label: string; idx: number }[] = [
  { label: 'BG color', idx: 0 },
  { label: 'Level mode', idx: 9 },
  { label: 'BG scroll rate', idx: 12 },
  { label: 'Music', idx: 13 },
  { label: 'Item memory', idx: 14 }
]

// Loaded-gfx files are grouped by the layer their DP slot feeds (load-graphics.ts
// stage 1: 0..2 BG1, 3..4 BG2, 5..6 BG3, 7..12 sprite). Entries that loaded a
// literal file id carry no dpSlot → "Other".
const FILE_LAYER_ORDER = ['BG1', 'BG2', 'BG3', 'Sprite', 'Other'] as const
type FileLayer = (typeof FILE_LAYER_ORDER)[number]

function layerForDpSlot(slot: number | undefined): FileLayer {
  if (slot == null) return 'Other'
  if (slot <= 2) return 'BG1'
  if (slot <= 4) return 'BG2'
  if (slot <= 6) return 'BG3'
  return 'Sprite'
}

const vramHex = (n: number): string => hex0x(n, 4)

/** The Header tab: decoded level-header rendering config + the gfx files this
 *  level loads into VRAM (grouped by layer; the Sprite group is the spriteset). */
function HeaderInfo({
  level,
  usage,
  manifest
}: {
  level: LevelData
  usage: LevelTileUsage | null
  manifest: GfxFileEntry[] | null
}): JSX.Element {
  const h = level.header
  const grouped = useMemo(() => {
    const m = new Map<FileLayer, GfxFileEntry[]>()
    for (const e of manifest ?? []) {
      const layer = layerForDpSlot(e.dpSlot)
      const arr = m.get(layer)
      if (arr) arr.push(e)
      else m.set(layer, [e])
    }
    return m
  }, [manifest])

  return (
    <div className="se-hdr">
      <section className="se-hdr__section">
        <h4 className="se-hdr__h">Layers</h4>
        <table className="se-hdr__table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Tileset</th>
              <th>Palette</th>
            </tr>
          </thead>
          <tbody>
            {HEADER_LAYERS.map((l) => (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td>{hex2(h[l.tileset] ?? 0)}</td>
                <td>{hex2(h[l.palette] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="se-hdr__section">
        <h4 className="se-hdr__h">Rendering</h4>
        <dl className="se-hdr__kv">
          {HEADER_SCALARS.map((f) => (
            <div className="se-hdr__kv-row" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{hex2(h[f.idx] ?? 0)}</dd>
            </div>
          ))}
          <div className="se-hdr__kv-row">
            <dt>Palette rows used</dt>
            <dd>{usage?.paletteRowsUsed.join(', ') || '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="se-hdr__section">
        <h4 className="se-hdr__h">Loaded graphics files</h4>
        {manifest == null ? (
          <p className="se-hdr__muted">Loading…</p>
        ) : manifest.length === 0 ? (
          <p className="se-hdr__muted">No files loaded.</p>
        ) : (
          FILE_LAYER_ORDER.filter((layer) => grouped.has(layer)).map((layer) => {
            const entries = grouped.get(layer) ?? []
            const bpp = layer === 'BG3' ? 2 : 4
            return (
              <div className="se-hdr__filegroup" key={layer}>
                <div className="se-hdr__filegroup-label">
                  {layer === 'Sprite' ? 'Sprite (spriteset)' : layer}
                  <span className="se-hdr__filegroup-count">{entries.length}</span>
                </div>
                <ul className="se-hdr__files">
                  {entries.map((e, i) => (
                    <li className="se-hdr__file" key={`${layer}-${e.vramByteOffset}-${i}`}>
                      <span className="se-hdr__file-id">file {hex2(e.fileId)}</span>
                      <span className="se-hdr__file-meta">
                        VRAM {vramHex(e.vramByteOffset)} · {e.format.toUpperCase()} ·{' '}
                        {Math.round(e.sizeBytes / (bpp === 2 ? 16 : 32))} tiles
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}

/**
 * Live tile inspector for the currently-selected level:
 *   - **Map16 Blocks**: the Map16 blocks this level actually stamps (across every
 *     page it loads), with per-block usage count, palette rows, and VRAM-coverage
 *     health (loaded / anim / miss). Selecting an object outlines the blocks it
 *     produces. (Replaces the old whole-cart page browser, which rendered the
 *     global Map16 space with this level's gfx — misleading for unloaded pages.)
 *   - **Files**: raw per-file blocks from the cart's scene_gfx_layout chunk-list.
 *
 * Mode is persisted to `localStorage["shinyEgg.tilesPanel.v1"]`.
 */
export function TilesBody({ level, selectedLevelRecordId, usage, highlightBlockIds }: TilesBodyProps): JSX.Element {
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<PanelState>(() => {
    const s = store.load()
    // Coerce a stale/unknown persisted mode (e.g. the removed 'map16' page
    // browser) back to 'used'.
    const mode: Mode = s.mode === 'files' || s.mode === 'header' ? s.mode : 'used'
    return { ...s, mode }
  })

  const setMode = (mode: Mode): void => {
    setState((s) => {
      const next = { ...s, mode }
      store.save(next)
      return next
    })
  }
  const setSpritePaletteRow = (row: number): void => {
    const clamped = Math.max(0, Math.min(7, row))
    setState((s) => {
      const next = { ...s, spritePaletteRow: clamped }
      store.save(next)
      return next
    })
  }

  const header = useMemo(() => headerFromLevel(level), [level])

  // Files-mode block list (rendered as a stack of labeled canvases).
  const [fileBlocks, setFileBlocks] = useState<GfxFileBlock[] | null>(null)

  // Re-render the Files tab whenever header / sprite-palette change. (The Map16
  // Pages tab renders from `usage`, which App fetches.)
  useEffect(() => {
    if (state.mode !== 'files') return
    if (!header) {
      setFileBlocks(null)
      return
    }
    let cancelled = false
    setStatus('Rendering…')
    setError(null)
    void (async () => {
      try {
        const result: GfxFilesResult = await window.shinyEgg.render.gfxFiles({
          header,
          cellsPerRow: 16,
          spritePaletteRow: state.spritePaletteRow
        })
        if (cancelled) return
        setFileBlocks(result.blocks)
        setStatus(`${result.blocks.length} blocks (scene_gfx_layout + animated)`)
      } catch (e) {
        if (cancelled) return
        setError(String(e instanceof Error ? e.message : e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [header, state.mode, state.spritePaletteRow])

  // Header-tab gfx manifest. Fetched only while the Header tab is active, and
  // re-fetched only when the header bytes change (not on every object edit) —
  // the manifest depends solely on the header's tileset fields. `override` is
  // the live level, so unsaved header edits are reflected. `headerSig` gates
  // the re-fetch; `levelRef` supplies the override without widening deps.
  const [manifest, setManifest] = useState<GfxFileEntry[] | null>(null)
  const levelRef = useRef(level)
  levelRef.current = level
  const headerSig = level ? level.header.join(',') : ''
  useEffect(() => {
    if (state.mode !== 'header') return
    const lvl = levelRef.current
    if (!lvl || lvl.empty || lvl.special || selectedLevelRecordId == null) {
      setManifest(null)
      return
    }
    let cancelled = false
    setManifest(null)
    setError(null)
    void (async () => {
      try {
        const req: LevelRenderRequest = { levelRecordId: selectedLevelRecordId, override: lvl }
        const m = await window.shinyEgg.render.gfxManifest(req)
        if (!cancelled) setManifest(m)
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.mode, selectedLevelRecordId, headerSig])

  const usedStatus = useMemo(() => {
    if (!usage) return ''
    const miss = usage.blocks.filter((b) => b.coverage === 'miss').length
    const anim = usage.blocks.filter((b) => b.coverage === 'anim').length
    return (
      `${usage.blocks.length} blocks · ${usage.totalCells} cells` +
      (anim ? ` · ${anim} animated` : '') +
      (miss ? ` · ${miss} MISSING gfx` : '') +
      ` · palette rows ${usage.paletteRowsUsed.join(', ') || '—'}`
    )
  }, [usage])

  const headerStatus = useMemo(() => {
    const files = manifest?.length
    const rows = usage?.paletteRowsUsed.join(', ') || '—'
    return `${files != null ? `${files} gfx files · ` : ''}palette rows ${rows}`
  }, [manifest, usage])

  const message = error
    ? `Error: ${error}`
    : !header
      ? 'Pick a level.'
      : state.mode === 'used'
        ? usedStatus
        : state.mode === 'header'
          ? headerStatus
          : status

  const usedHasMiss = (usage?.blocks.some((b) => b.coverage === 'miss')) ?? false

  return (
    <div className="se-tiles">
      <div className="se-tiles__controls">
        <div className="se-tabs">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`se-tab${state.mode === m ? ' is-active' : ''}`}
              onClick={() => setMode(m)}
              title={MODE_TITLES[m]}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {state.mode === 'files' && (
          <div className="se-tiles__page" title="Sprite palette row (CGRAM rows 8-15). The cart picks per-sprite via OAM at runtime — this is the inspector default.">
            <span className="se-tiles__page-label se-tiles__page-label--prefix">Sprite palette</span>
            <button
              type="button"
              className="se-tiles__page-btn"
              onClick={() => setSpritePaletteRow(state.spritePaletteRow - 1)}
              disabled={state.spritePaletteRow <= 0}
              title="Previous sprite palette row"
            >
              ‹
            </button>
            <span className="se-tiles__page-label">{state.spritePaletteRow}</span>
            <button
              type="button"
              className="se-tiles__page-btn"
              onClick={() => setSpritePaletteRow(state.spritePaletteRow + 1)}
              disabled={state.spritePaletteRow >= 7}
              title="Next sprite palette row"
            >
              ›
            </button>
          </div>
        )}
      </div>
      <div className={`se-tiles__status${usedHasMiss && state.mode === 'used' ? ' se-tiles__status--warn' : ''}`}>
        {message}
      </div>
      {state.mode === 'used' ? (
        usage && usage.blocks.length > 0 ? (
          <UsedBlocks usage={usage} highlightBlockIds={highlightBlockIds} />
        ) : (
          <div className="se-tiles__empty">{header ? 'No blocks stamped.' : 'Pick a level.'}</div>
        )
      ) : state.mode === 'header' ? (
        header && level ? (
          <HeaderInfo level={level} usage={usage} manifest={manifest} />
        ) : (
          <div className="se-tiles__empty">Pick a level.</div>
        )
      ) : fileBlocks ? (
        <FilesBlockList blocks={fileBlocks} />
      ) : (
        <div className="se-tiles__empty">{header ? 'Rendering…' : 'Pick a level.'}</div>
      )}
    </div>
  )
}
