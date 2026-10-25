// Level Header panel body — edits the loaded level's 15 bit-packed header fields
// (BG color, per-layer tileset/palette, sprite tileset/palette, level mode,
// animation tileset/palette, BG scroll rate, music, item memory).
//
// The header is level-wide (not a canvas selection), so this is its own floating
// panel rather than part of Properties. Each field is rendered with the shared
// FieldRow widget and commits via the level reducer's `setHeaderField` action —
// so header edits ride the SAME live-render / undo / dirty / save path as every
// other level edit (the override re-decode picks up the new header, all caches
// key on it, and the serializer already packs header into the .bin). Fields are
// grouped into "Visual" (re-skins live) and "Gameplay" (built-ROM only).
//
// Under each field is a guide for the value it holds: the selected option's
// `detail`, the shipped levels that use the value (lib/header-guide over the
// base-cart `render:headerGuide` index), and for the palette-row fields a strip
// of the colors that row loads (palette catalog ⊕ the live palette / gradient
// drafts, so it matches the canvas). Dropdowns carry each value's usage count
// and offer values shipped levels use that the curated lists don't name. The
// tooltip gives the field's bit position, and the packed bytes close the panel —
// both so an edit can be checked against a hex editor.
//
// The backdrop-preset dropdown applies a BG2 / BG3 recipe (data/bg-setups, from
// the community BG2/BG3 settings charts): the backdrop's tileset, the palette it
// was drawn for and the settings it expects, as one undo step
// (`setHeaderFields`). Presets the header already follows are ticked.

import { useEffect, useMemo, useState, type Dispatch, type JSX } from 'react'
import type { HeaderGuide, LevelData, PaletteCatalogGroup } from '../../../preload/api'
import type { LevelAction } from '../canvas/level-reducer'
import {
  headerFieldBits,
  headerFields,
  packHeader,
  type HeaderField,
  type HeaderSwatch
} from '../data/header-schema'
import type { FieldKind } from '../data/property-schema'
import { getLevel } from '../data/levels'
import { BG_PRESETS, presetEdits, presetMatches } from '../lib/bg-setup'
import { useSpcPlayer } from '../hooks/useSpcPlayer'
import { bgr15ToHex } from '../lib/bgr15'
import { gradientOffset, GRADIENT_STOPS } from '../lib/gradient'
import { guideOptions, recordHeaders, summarizeUsage, usageName, type UsageLabel } from '../lib/header-guide'
import { hex, hex0x } from '../lib/hex'
import { FieldRow } from './field-widgets'

/** How a usage summary names a record: world-map levels by slot, in map order;
 *  anything else by id, after them. */
function usageLabel(recordId: number): UsageLabel {
  const l = getLevel(recordId)
  if (l) return { short: l.slot, long: `${l.slot} ${l.name}`, order: l.translevelId ?? 0x100 + recordId }
  return { short: hex0x(recordId), long: `Room ${hex0x(recordId)}`, order: 0x200 + recordId }
}

/** The guide index for a level — refetched per level (the usage half is cached
 *  main-side, so only the World-6 flag costs anything after the first call). */
function useHeaderGuide(recordId: number | null): HeaderGuide | null {
  const [guide, setGuide] = useState<HeaderGuide | null>(null)
  useEffect(() => {
    if (recordId === null) return
    let alive = true
    void window.shinyEgg.render
      .headerGuide(recordId)
      .then((g) => {
        if (alive) setGuide(g)
      })
      .catch(() => {
        if (alive) setGuide(null)
      })
    return () => {
      alive = false
    }
  }, [recordId])
  return guide
}

/** The palette catalog's pointer-table groups by id. Base colors only change on
 *  rebuild/extract, so a one-shot fetch on mount suffices (as in WorldMapPanel). */
function usePaletteGroups(): Map<string, PaletteCatalogGroup> | null {
  const [groups, setGroups] = useState<Map<string, PaletteCatalogGroup> | null>(null)
  useEffect(() => {
    let alive = true
    void window.shinyEgg.render.paletteCatalog().then((cat) => {
      if (alive && cat) setGroups(new Map(cat.catalog.map((g) => [g.id, g])))
    })
    return () => {
      alive = false
    }
  }, [])
  return groups
}

/** Live color sources for the swatch strips — the same drafts the canvas uses. */
export interface HeaderColorSources {
  /** Palette-edit draft by master-blob offset (saved + unsaved edits). */
  paletteDraft: Map<number, number>
  /** Pristine gradient tables (BG color 0x10..0x1F × 24 stops), null until loaded. */
  gradientBase: number[][] | null
  /** Gradient-edit draft by flat gradient offset. */
  gradientDraft: Map<number, number>
}

/** The colors palette-row field `kind` loads at `value`, or null when the
 *  source isn't loaded / the value is past the table. */
function swatchColors(
  kind: HeaderSwatch,
  value: number,
  groups: Map<string, PaletteCatalogGroup>,
  isWorld6: boolean,
  colors: HeaderColorSources
): { colors: string[]; cols: number } | null {
  const live = (s: { offset: number; base: number }): string =>
    bgr15ToHex(s.offset >= 0 ? (colors.paletteDraft.get(s.offset) ?? s.base) : s.base)
  if (kind === 'backdrop') {
    if (value < 0x10) {
      const s = groups.get('backdrop')?.entries[0]?.swatches[value]
      return s ? { colors: [live(s)], cols: 1 } : null
    }
    const gid = value - 0x10
    const base = colors.gradientBase?.[gid]
    if (!base) return null
    const stops = Array.from({ length: GRADIENT_STOPS }, (_, i) =>
      bgr15ToHex(colors.gradientDraft.get(gradientOffset(gid, i)) ?? base[i]!)
    )
    return { colors: stops, cols: GRADIENT_STOPS }
  }
  const entry = groups.get(kind === 'bg1' && isWorld6 ? 'bg1-dark' : kind)?.entries[value]
  return entry ? { colors: entry.swatches.map(live), cols: entry.cols } : null
}

function SwatchStrip({ colors, cols }: { colors: string[]; cols: number }): JSX.Element {
  return (
    <div
      className="se-props__swatches"
      style={{ gridTemplateColumns: `repeat(${cols}, 8px)` }}
      title="The colors this palette row loads (live palette edits included). Edit them in the Palette panel."
    >
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </div>
  )
}

/** Action under the Visual fields: set the sprite tileset (header[7]) to the
 *  stock spriteset that best covers this level's placed sprites. Handy after a
 *  GBA import or after adding sprites whose gfx the current set doesn't load. */
function SpritesetFitRow({
  level,
  dispatchLevel
}: {
  level: LevelData
  dispatchLevel: Dispatch<LevelAction>
}): JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function fit(): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const r = await window.shinyEgg.render.fitSpriteset(level.sprites.map((s) => s.num))
      dispatchLevel({ type: 'setHeaderField', index: 7, value: r.spriteTileset })
      const id = `0x${r.spriteTileset.toString(16).toUpperCase().padStart(2, '0')}`
      setStatus(
        r.gatedInstances === 0
          ? `Set ${id} — no graphics-gated sprites, any set works.`
          : r.missingFiles.length === 0
            ? `Set ${id} — covers all ${r.gatedInstances} graphics-gated sprite${r.gatedInstances === 1 ? '' : 's'}.`
            : `Set ${id} — best available, but ${r.missingFiles.length} gfx file${r.missingFiles.length === 1 ? '' : 's'} still uncovered; some sprites may render wrong.`
      )
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <dd className="se-props__fitspriteset">
      <button type="button" className="se-btn" onClick={() => void fit()} disabled={busy}>
        {busy ? 'Fitting…' : 'Fit sprite tileset to sprites'}
      </button>
      {status && <span className="se-props__fithint">{status}</span>}
    </dd>
  )
}

/** Action under the Gameplay fields: play the selected music setting in the
 *  editor (the Audio panel's synthesized-SPC path — same shared player, so
 *  the panel's transport shows/stops it too). Plays the setting's entry song.
 *  `onEditSets` jumps to the Audio panel's Sets tab (edit what each music
 *  value uploads/plays). */
function MusicPreviewRow({ musicSetting, onEditSets }: { musicSetting: number; onEditSets?: () => void }): JSX.Element {
  const player = useSpcPlayer()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [playedSeq, setPlayedSeq] = useState<number | null>(null)
  const isOurs = playedSeq !== null && playedSeq === player.seq && player.playing

  async function toggle(): Promise<void> {
    if (isOurs) {
      player.stop()
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const cat = await window.shinyEgg.audio.catalog()
      if (!cat.ok) {
        setStatus(cat.error)
        return
      }
      const setting = cat.catalog.settings[musicSetting]
      if (!setting || setting.songs.length === 0) {
        setStatus('No song data for this music setting.')
        return
      }
      const slot = setting.songs.find((s) => s.slotId === setting.initSongId) ?? setting.songs[0]
      const r = await window.shinyEgg.audio.composeSongSpc(musicSetting, slot.slotId)
      if (!r.ok) {
        setStatus(r.error)
        return
      }
      setPlayedSeq(await player.play(r.spc, `${setting.name} — ${slot.name}`))
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <dd className="se-props__fitspriteset">
      <button
        type="button"
        className="se-btn"
        onClick={() => void toggle()}
        disabled={busy}
        title="Play this music setting's entry song in the editor (synthesized — no emulator)"
      >
        {isOurs ? '⏹ Stop music' : busy ? 'Composing…' : '▶ Play music'}
      </button>
      {onEditSets && (
        <button
          type="button"
          className="se-btn"
          onClick={onEditSets}
          title="Open the Audio panel's Edit Song Sets tab — edit which modules each music value uploads, its entry song, and the pause-item flag"
        >
          Edit sets…
        </button>
      )}
      {status && <span className="se-props__fithint">{status}</span>}
    </dd>
  )
}

/** The backdrop-preset dropdown: pick a BG2 or BG3 backdrop and every setting
 *  it needs is set at once. Its value is the preset the header follows — the
 *  last one picked while it still matches, else the first match — so it reads
 *  back what's set and Up/Down steps to the neighbouring preset (an always-""
 *  value snapped back to the placeholder after each change, so arrow keys
 *  re-applied the first presets over and over). The status line says what
 *  changed and carries the recipe's notes. */
function BackdropPresetRow({
  header,
  fields,
  dispatchLevel
}: {
  header: readonly number[]
  fields: HeaderField[]
  dispatchLevel: Dispatch<LevelAction>
}): JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const matched = BG_PRESETS.filter((p) => presetMatches(p, header))
  const current = matched.find((p) => p.id === picked) ?? matched[0]
  const fieldLabel = (i: number): string => fields.find((f) => f.index === i)?.label ?? `Field ${i}`
  const apply = (id: string): void => {
    const p = BG_PRESETS.find((x) => x.id === id)
    if (!p) return
    setPicked(p.id)
    const edits = presetEdits(p, header)
    if (edits.length > 0) dispatchLevel({ type: 'setHeaderFields', fields: edits })
    const changed =
      edits.length > 0
        ? `Set ${edits.map((e) => `${fieldLabel(e.index)} ${hex0x(e.value)}`).join(', ')}.`
        : 'Already set.'
    setStatus([`${p.label}: ${changed}`, ...p.notes].join(' '))
  }
  const option = (p: (typeof BG_PRESETS)[number]): JSX.Element => (
    <option key={p.id} value={p.id}>
      {`${matched.includes(p) ? '✓ ' : ''}${p.label} · ${hex0x(p.accept[0]!.values[0]!)}`}
    </option>
  )
  return (
    <dd className="se-props__preset">
      <span className="se-props__preset-label">Backdrop preset</span>
      <select
        className="se-input se-props__select"
        value={current?.id ?? ''}
        onChange={(e) => apply(e.target.value)}
        title="Sets a backdrop’s tileset, the palette it was drawn for, and the animation / scroll / level-mode settings it expects (community BG2/BG3 settings charts, checked against the shipped levels). One undo step."
      >
        {!current && <option value="">Choose a backdrop…</option>}
        <optgroup label="BG2 backdrops">{BG_PRESETS.filter((p) => p.layer === 2).map(option)}</optgroup>
        <optgroup label="BG3 backdrops">{BG_PRESETS.filter((p) => p.layer === 3).map(option)}</optgroup>
      </select>
      {status && <span className="se-props__fithint">{status}</span>}
    </dd>
  )
}

export interface HeaderBodyProps {
  /** The loaded level (its `header` is the edited surface). */
  level: LevelData | null
  /** Live color sources for the palette-row swatch strips. */
  colors: HeaderColorSources
  /** Dispatch header edits to the level reducer. */
  dispatchLevel: Dispatch<LevelAction>
  /** Open the Audio panel's Sets tab (the music dropdown's edit affordance). */
  onEditMusicSets?: () => void
}

export function HeaderBody({ level, colors, dispatchLevel, onEditMusicSets }: HeaderBodyProps): JSX.Element {
  const guide = useHeaderGuide(level && !level.empty && !level.special ? level.recordId : null)
  const groups = usePaletteGroups()
  const headerOf = useMemo(() => (guide ? recordHeaders(guide.usage) : null), [guide])
  if (!level) {
    return <p className="se-props__empty">No level loaded.</p>
  }
  if (level.empty || level.special) {
    return <p className="se-props__empty">This level has no editable header.</p>
  }
  const header = level.header
  const fields = headerFields()
  const swatchFor = (kind: HeaderSwatch, value: number): { colors: string[]; cols: number } | null =>
    groups ? swatchColors(kind, value, groups, guide?.isWorld6 ?? false, colors) : null
  // Names for values no list names: a palette after the tilesets its levels pair
  // it with (`companion`), anything else after the levels that use it.
  const unnamed =
    (f: HeaderField) =>
    (value: number): string | undefined => {
      const ids = guide?.usage.byField[f.index]?.[value]
      if (!ids || !guide || !headerOf) return undefined
      const companion = f.companion
      if (companion !== undefined) {
        const comp = fields.find((c) => c.index === companion)?.field
        return usageName(
          ids,
          (id) => {
            const cv = headerOf.get(id)?.[companion]
            return comp?.kind === 'enum' ? comp.options.find((o) => o.value === cv)?.label : undefined
          },
          2,
          '; ' // tileset names carry their own commas and slashes ("Lava / 3D rock")
        )
      }
      return usageName(ids, (id) => usageLabel(guide.usage.rootOf[id] ?? id).short, 3)
    }
  const row = (f: HeaderField): JSX.Element => {
    const value = header[f.index] ?? 0
    const used = guide?.usage.byField[f.index]
    const field: FieldKind =
      f.field.kind === 'enum' ? { ...f.field, options: guideOptions(f.field.options, used, unnamed(f)) } : f.field
    const detail = f.field.kind === 'enum' ? f.field.options.find((o) => o.value === value)?.detail : undefined
    const usage = used && guide ? summarizeUsage(used[value] ?? [], guide.usage.rootOf, usageLabel) : null
    const swatch = f.swatch ? swatchFor(f.swatch, value) : null
    const { start, width } = headerFieldBits(f.index)
    const bits = `Header bits ${start}–${start + width - 1} (${width} bits, 0x00–0x${hex((1 << width) - 1)}).`
    return (
      <FieldRow
        key={f.index}
        label={f.label}
        field={field}
        value={value}
        hint={`${f.hint}\n\n${bits}`}
        below={
          <div className="se-props__guide">
            {swatch && <SwatchStrip colors={swatch.colors} cols={swatch.cols} />}
            {detail && <span className="se-props__guide-detail">{detail}</span>}
            {usage && <span title={usage.full || undefined}>{usage.text}</span>}
          </div>
        }
        onCommit={(v) => dispatchLevel({ type: 'setHeaderField', index: f.index, value: v })}
      />
    )
  }
  // Known/acceptable for v1: the main BG/sprite/palette/collision layers update live on a
  // header edit, but a few auxiliary panels (Tiles "Used in this level", Properties→Collision
  // readout, Map16/gfx galleries) key on recordId / on-disk decode rather than the live header
  // override, so they reflect a header edit only after rebuild/reselect. Fix-if-it-grates: thread
  // a `headerVersion` counter the way the palette editor threads `paletteVersion`.
  return (
    <dl className="se-props__list se-props__list--2col">
      <dt className="se-props__section">
        Visual
        <span className="se-props__section-note">Re-skins the level live.</span>
      </dt>
      {fields.filter((f) => f.preview).map(row)}
      <SpritesetFitRow level={level} dispatchLevel={dispatchLevel} />
      <BackdropPresetRow key={level.recordId} header={header} fields={fields} dispatchLevel={dispatchLevel} />
      <dt className="se-props__section">
        Gameplay
        <span className="se-props__section-note">No live preview — Test Level to verify.</span>
      </dt>
      {fields.filter((f) => !f.preview).map(row)}
      <MusicPreviewRow musicSetting={header[13] ?? 0} onEditSets={onEditMusicSets} />
      <dt className="se-props__section">
        Bytes
        <span className="se-props__section-note">
          The packed header as stored at the start of the level’s object data.
        </span>
      </dt>
      <dd className="se-props__bytes">
        <code>{Array.from(packHeader(header), (b) => hex(b)).join(' ')}</code>
      </dd>
    </dl>
  )
}
