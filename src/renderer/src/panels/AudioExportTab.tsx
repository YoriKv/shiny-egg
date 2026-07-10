import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import type {
  AramImportBudget,
  AudioExportFileUi,
  AudioImportItemUi,
  AudioImportSongCandidateUi,
  AudioImportSongFileUi,
  AudioImportTargetUi
} from '../../../preload/api'
import type { SpcPlayerControls } from '../hooks/useSpcPlayer'
import { useDropdown } from '../hooks/useDropdown'
import { persistedState } from '../lib/persisted-state'
import { formatBytes } from '../lib/format-bytes'
import { hex0x } from '../lib/hex'

// The Audio panel's Export tab (see AudioBody.tsx for the panel frame) — the
// YY-CHR-tab model: fixed per-project folder
// (`<projectRoot>/audio/{songs,sfx,samples,import}`), export-all buttons, a
// collapsible browser over what's on disk (refreshed on window focus;
// per-section collapse persisted, absent = collapsed), per-file playback,
// changed/imported badges, and the import/ section: dropped YI-driver .spc
// files list their candidate songs, each previewable over — and importable
// into — a chosen target song module (overlay blob; the build's audio layout
// pass re-fits the region; Reset reverts). The tab's project-mutating
// actions — Import Samples, song Import, and Reset — each call `onMutated`
// (→ markRomDirty); everything else is read-only over the folder.

/** Flower Garden's module — the everyday "replace a level song" pick. */
const DEFAULT_IMPORT_TARGET = 0x13

const fmtB = (n: number): string => n.toLocaleString('en-US')

/** One size figure on an import-candidate row, mapped onto an ARAM budget
 *  section (see the Songs tab's per-set diagram). `over` = it exceeds the
 *  selected target's available space. */
function SizeChip({ text, over, hint }: { text: string; over: boolean; hint: string }): JSX.Element {
  return (
    <span className={`se-audio__size-chip${over ? ' is-over' : ''}`} title={hint}>
      {text}
    </span>
  )
}

/** Candidate size chips: sequence bytes, custom samples, instrument rows,
 *  directory slots — each against `budget` (MML only; .spc songs keep their
 *  source layout, so their figures are informational). */
function CandidateSizes({
  c,
  budget,
  mml
}: {
  c: AudioImportSongCandidateUi
  budget: AramImportBudget | undefined
  mml: boolean
}): JSX.Element {
  const gate = (over: boolean): boolean => mml && over
  return (
    <span className="se-audio__song-note se-audio__sizes">
      <span title="Note events in the song">{fmtB(c.noteEvents)} notes</span>
      <SizeChip
        text={`seq ${fmtB(c.seqBytes)} B`}
        over={gate(budget !== undefined && c.seqBytes > budget.seqLargestGap)}
        hint={
          'Sequence data (patterns, tracks, loops).' +
          (mml && budget
            ? ` Must fit the target's largest free run: ${fmtB(budget.seqLargestGap)} B.`
            : '')
        }
      />
      {c.sampleBytes !== undefined && c.sampleBytes > 0 && (
        <SizeChip
          text={`samples ${c.sampleCount ?? '?'} · ${fmtB(c.sampleBytes)} B`}
          over={gate(budget !== undefined && c.seqBytes + c.sampleBytes > budget.freeTotal)}
          hint={
            'Custom sample data carried into the module.' +
            (mml && budget
              ? ` Sequence + samples share the target's free space: ${fmtB(budget.freeTotal)} B.`
              : '')
          }
        />
      )}
      {c.instrumentRows !== undefined && c.instrumentRows > 0 && (
        <SizeChip
          text={`${c.instrumentRows} rows`}
          over={gate(budget !== undefined && c.instrumentRows > budget.instrumentRowsFree)}
          hint={
            'Instrument-table rows the song needs (48-row table).' +
            (mml && budget ? ` Target has ${budget.instrumentRowsFree} free.` : '')
          }
        />
      )}
      {c.dirSlots !== undefined && c.dirSlots > 0 && (
        <SizeChip
          text={`${c.dirSlots} slots`}
          over={gate(budget !== undefined && c.dirSlots > budget.dirSlotsFree)}
          hint={
            'Sample-directory slots the song claims (one per distinct sample).' +
            (mml && budget ? ` Target has ${budget.dirSlotsFree} free.` : '')
          }
        />
      )}
    </span>
  )
}

/** Export-tab per-section collapse state, persisted like the YY-CHR tab's
 *  (keys: 'songs' | 'sfx' | 'samples/<Bank>'). ABSENCE = collapsed — every
 *  section starts collapsed; expanding one stores `false` for its key. */
const EXPORT_COLLAPSED_STORE = persistedState<Record<string, boolean>>('shinyEgg.audioExportCollapsed.v1', {})
const DOWNSAMPLE_TO_FIT_STORE = persistedState<boolean>('shinyEgg.audioImportDownsample.v1', true)
const DROP_STACCATO_TO_FIT_STORE = persistedState<boolean>('shinyEgg.audioImportDropStaccato.v1', false)
const USE_SMW_SAMPLES_STORE = persistedState<boolean>('shinyEgg.audioImportSmwSamples.v1', false)
const NO_ECHO_STORE = persistedState<boolean>('shinyEgg.audioImportNoEcho.v1', false)

/** One collapsible Export-tab section: caret + folder name + count meta
 *  (+ status badges while collapsed, so pending edits aren't hidden). */
function ExportGroup({
  id,
  name,
  meta,
  collapsed,
  onToggle,
  badges,
  children
}: {
  id: string
  name: string
  meta: string
  collapsed: boolean
  onToggle: (id: string) => void
  badges?: JSX.Element | null
  children: ReactNode
}): JSX.Element {
  return (
    <div className="se-audio__group">
      <button className="se-audio__cat" onClick={() => onToggle(id)} title={collapsed ? 'Expand' : 'Collapse'}>
        <span className="se-audio__cat-caret">{collapsed ? '▸' : '▾'}</span>
        <span className="se-audio__group-name">{name}</span>
        {collapsed ? badges : null}
        <span className="se-audio__group-meta">{meta}</span>
      </button>
      {!collapsed && children}
    </div>
  )
}

export function AudioExportTab({
  projectId,
  player,
  setStatus,
  onMutated,
  playSong,
  onForeignPlayback
}: {
  projectId: string | null
  player: SpcPlayerControls
  /** The panel's shared transport status line. */
  setStatus: (s: string | null) => void
  /** Called after an import/reset changes the project overlay (→ markRomDirty). */
  onMutated?: () => void
  /** Play a (setting, slot) through the shared player (AudioBody's playSong —
   *  keeps the inspector-playhead identity it tracks). */
  playSong: (setting: number, slotId: number, label: string) => Promise<void>
  /** Called when this tab plays something the inspectors can't track (an
   *  exported file / import preview) — clears the playhead identity. */
  onForeignPlayback: () => void
}): JSX.Element {
  const [exportDir, setExportDir] = useState<string | null>(null)
  const [exportFiles, setExportFiles] = useState<AudioExportFileUi[]>([])
  const [exporting, setExporting] = useState(false)
  const [importLog, setImportLog] = useState<AudioImportItemUi[] | null>(null)
  const [exportCollapsed, setExportCollapsed] = useState<Record<string, boolean>>(() => EXPORT_COLLAPSED_STORE.load())
  const [downsampleToFit, setDownsampleToFit] = useState<boolean>(() => DOWNSAMPLE_TO_FIT_STORE.load())
  const [dropStaccatoToFit, setDropStaccatoToFit] = useState<boolean>(() => DROP_STACCATO_TO_FIT_STORE.load())
  const [useSmwSamples, setUseSmwSamples] = useState<boolean>(() => USE_SMW_SAMPLES_STORE.load())
  const [noEcho, setNoEcho] = useState<boolean>(() => NO_ECHO_STORE.load())
  const { open: settingsOpen, setOpen: setSettingsOpen, containerRef: settingsRef } = useDropdown()
  const [importSongs, setImportSongs] = useState<AudioImportSongFileUi[]>([])
  const [importTargets, setImportTargets] = useState<AudioImportTargetUi[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [importFreeBytes, setImportFreeBytes] = useState<number | null>(null)
  /** Per import file: the song module its preview replaces (blockId). */
  const [importTargetSel, setImportTargetSel] = useState<Record<string, number>>({})
  /** Per import file: the slot inside the target module (-1/absent = replace
   *  the whole module; a slot id = MML-only merge that keeps the module's
   *  other songs). */
  const [importSlotSel, setImportSlotSel] = useState<Record<string, number>>({})

  const refreshExport = useCallback(async (): Promise<void> => {
    const r = await window.shinyEgg.audio.exportState()
    if (r.ok) {
      setExportDir(r.dir)
      setExportFiles(r.files)
    } else {
      setExportDir(null)
      setExportFiles([])
    }
    const s = await window.shinyEgg.audio.songImportState(downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho)
    if (s.ok) {
      setImportSongs(s.files)
      setImportTargets(s.targets)
      setImportFreeBytes(s.freeBytes)
      setImportError(null)
    } else {
      setImportSongs([])
      setImportTargets([])
      setImportFreeBytes(null)
      setImportError(s.error)
    }
  }, [downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho])

  // The tab mirrors the on-disk folder — re-scan on mount (it only mounts
  // while visible) and whenever the app window regains focus (the
  // alt-tab-back moment after touching the folder externally), like the
  // YY-CHR tab.
  useEffect(() => {
    void refreshExport()
    const onFocus = (): void => void refreshExport()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshExport, projectId])

  const playExported = useCallback(
    async (file: AudioExportFileUi): Promise<void> => {
      setStatus(null)
      const r = await window.shinyEgg.audio.readExportedSpc(file.rel)
      if (!r.ok) {
        setStatus(`Read failed: ${r.error}`)
        return
      }
      try {
        const label = `${file.bank ? `${file.bank}/` : ''}${file.name.replace(/\.(spc|wav)$/i, '')}`
        if (/\.wav$/i.test(file.name)) await player.playWav(r.spc, label)
        else await player.play(r.spc, label)
        onForeignPlayback()
      } catch (e) {
        setStatus(`Playback failed: ${(e as Error).message}`)
      }
    },
    [player, setStatus, onForeignPlayback]
  )

  const runExport = useCallback(async (): Promise<void> => {
    setExporting(true)
    setStatus(null)
    try {
      const r = await window.shinyEgg.audio.exportAll()
      setStatus(r.ok ? `Exported ${r.written} file(s) — SFX .txt + sample .brr/.wav` : `Export failed: ${r.error}`)
      await refreshExport()
    } finally {
      setExporting(false)
    }
  }, [refreshExport, setStatus])

  /** SFX rows are MML text — ▶ synthesizes the sound from its id. */
  const playSfxFile = useCallback(
    async (file: AudioExportFileUi): Promise<void> => {
      if (file.sfxId === undefined) return
      setStatus(null)
      const r = await window.shinyEgg.audio.composeSfxSpc(file.sfxId)
      if (!r.ok) {
        setStatus(`Playback failed: ${r.error}`)
        return
      }
      try {
        await player.play(r.spc, file.name.replace(/\.txt$/i, ''))
        onForeignPlayback()
      } catch (e) {
        setStatus(`Playback failed: ${(e as Error).message}`)
      }
    },
    [player, setStatus, onForeignPlayback]
  )

  /** The file's slot pick, when it names a real slot of its selected
   *  target (-1/absent/stale = whole-module). Slot-targeting is MML-only —
   *  .spc songs keep their source layout. */
  const slotPickOf = useCallback(
    (file: AudioImportSongFileUi, targetId: number): number | null => {
      if (file.kind !== 'mml') return null
      const sel = importSlotSel[file.rel] ?? -1
      const target = importTargets.find((t) => t.blockId === targetId)
      if (sel >= 0 && target?.slots.includes(sel)) return sel
      // Slot-mandatory targets (title): default to the first slot instead
      // of whole-module.
      return target?.slotRequired ? (target.slots[0] ?? null) : null
    },
    [importSlotSel, importTargets]
  )

  /** The selected target's available ARAM space for this file's pick: the
   *  slot-merge budget when a slot is selected (the module's other songs
   *  keep their bytes), else the whole-module-replace budget. */
  const budgetOf = useCallback(
    (file: AudioImportSongFileUi, targetId: number): AramImportBudget | undefined => {
      const target = importTargets.find((t) => t.blockId === targetId)
      if (!target) return undefined
      return slotPickOf(file, targetId) !== null ? target.budgetSlot : (target.budgetReplace ?? target.budgetSlot)
    },
    [importTargets, slotPickOf]
  )

  const previewImportSong = useCallback(
    async (file: AudioImportSongFileUi, slot: number): Promise<void> => {
      setStatus(null)
      const targetId = importTargetSel[file.rel] ?? DEFAULT_IMPORT_TARGET
      const target = importTargets.find((t) => t.blockId === targetId)
      const targetSlotId = slotPickOf(file, targetId)
      const r = await window.shinyEgg.audio.previewSongImport(file.rel, slot, targetId, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, targetSlotId)
      if (!r.ok) {
        setStatus(`Preview failed: ${r.error}`)
        return
      }
      try {
        await player.play(r.spc, `${file.name.replace(/\.spc$/i, '')} → ${target?.name ?? 'module'}${targetSlotId !== null ? ` ${hex0x(targetSlotId)}` : ''}`)
        onForeignPlayback()
        setStatus(
          r.warnings.length > 0
            ? `⚠ ${r.warnings[0]}${r.warnings.length > 1 ? ` (+${r.warnings.length - 1} more)` : ''}`
            : `Module ${formatBytes(r.moduleBytes)} — replaces a ${formatBytes(r.targetRetailBytes)} slot`
        )
      } catch (e) {
        setStatus(`Playback failed: ${(e as Error).message}`)
      }
    },
    [importTargetSel, importTargets, player, setStatus, onForeignPlayback, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, slotPickOf]
  )

  const importSongAction = useCallback(
    async (file: AudioImportSongFileUi, slot: number): Promise<void> => {
      setStatus(null)
      const targetId = importTargetSel[file.rel] ?? DEFAULT_IMPORT_TARGET
      const target = importTargets.find((t) => t.blockId === targetId)
      const targetSlotId = slotPickOf(file, targetId)
      const r = await window.shinyEgg.audio.importSong(file.rel, slot, targetId, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, targetSlotId)
      if (!r.ok) {
        setStatus(`Import failed: ${r.error}`)
        return
      }
      onMutated?.()
      setStatus(
        `Imported into ${target?.name ?? 'module'}${targetSlotId !== null ? ` slot ${hex0x(targetSlotId)}` : ''} — ${formatBytes(r.moduleBytes)} ` +
          `(slot was ${formatBytes(r.targetRetailBytes)}), ${formatBytes(r.freeBytes)} budget left` +
          (r.warnings.length ? ` · ⚠ ${r.warnings[0]}` : '')
      )
      await refreshExport()
    },
    [importTargetSel, importTargets, onMutated, refreshExport, setStatus, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, slotPickOf]
  )

  const revertImportAction = useCallback(
    async (target: AudioImportTargetUi): Promise<void> => {
      setStatus(null)
      const r = await window.shinyEgg.audio.revertSongImport(target.blockId)
      if (!r.ok) {
        setStatus(`Reset failed: ${r.error}`)
        return
      }
      onMutated?.()
      setStatus(`${target.name} reset to the original song`)
      await refreshExport()
    },
    [onMutated, refreshExport, setStatus]
  )

  const toggleExportGroup = useCallback((id: string): void => {
    setExportCollapsed((c) => {
      const next = { ...c, [id]: !(c[id] ?? true) } // absent = collapsed
      EXPORT_COLLAPSED_STORE.save(next)
      return next
    })
  }, [])

  const runImport = useCallback(async (): Promise<void> => {
    setExporting(true)
    setStatus(null)
    try {
      const r = await window.shinyEgg.audio.importSamples()
      if (!r.ok) {
        setStatus(`Import failed: ${r.error}`)
        setImportLog(null)
        return
      }
      setImportLog(r.items.filter((i) => i.action !== 'unchanged' || i.warnings.length > 0))
      setStatus(
        `${r.imported} imported, ${r.reverted} reverted, ` +
        `${r.items.filter((i) => i.action === 'unchanged').length} unchanged, ` +
        `${r.items.filter((i) => i.action === 'rejected').length} rejected`
      )
      if (r.imported + r.reverted > 0) onMutated?.()
      await refreshExport()
    } finally {
      setExporting(false)
    }
  }, [onMutated, refreshExport, setStatus])

  const sfxFiles = exportFiles.filter((f) => f.kind === 'sfx')
  const importedTargets = importTargets.filter((t) => t.imported)
  /** "slot 0x01 (Yoshi's Start Demo)" for a slot-targeted import, "all slots"
   *  for a whole-module one; null when the import predates slot metadata. */
  const importedSlotLabel = (t: AudioImportTargetUi): string | null => {
    const ts = t.imported?.targetSlots
    if (!ts || ts.length === 0) return null
    if (ts.length === t.slots.length) return 'all slots'
    return ts
      .map((s) => {
        const name = t.slotNames[t.slots.indexOf(s)]
        return `slot ${hex0x(s)}${name ? ` (${name})` : ''}`
      })
      .join(', ')
  }
  const sampleBanks = new Map<string, AudioExportFileUi[]>()
  for (const f of exportFiles) {
    if (f.kind !== 'sample') continue
    const bank = f.bank ?? '?'
    ;(sampleBanks.get(bank) ?? sampleBanks.set(bank, []).get(bank)!).push(f)
  }

  return (
    <div className="se-audio__list">
      <div className="se-audio__export-actions">
        <button className="se-audio__btn" disabled={exporting || !exportDir}
          title="Write every sound effect as an editable MML .txt and every instrument sample as raw .brr plus a decoded .wav, grouped by sample bank"
          onClick={() => void runExport()}>Export All Audio</button>
        <button className="se-audio__btn" disabled={exporting || !exportDir}
          title="Re-encode edited sample .wavs into the project (unchanged files are skipped; restored files revert to the original bytes)"
          onClick={() => void runImport()}>Import Samples</button>
        <button className="se-audio__btn" disabled={!exportDir}
          title="Open the export folder in the file manager"
          onClick={() => void window.shinyEgg.audio.openExportFolder()}>Open Folder</button>
        <div className="se-audio__settings" ref={settingsRef}>
          <button type="button"
            className={`se-audio__settings-btn${settingsOpen ? ' is-open' : ''}`}
            onClick={() => setSettingsOpen((o) => !o)}
            title="Song-import options">
            Import Settings ▾
          </button>
          {settingsOpen && (
            <div className="se-audio__settings-pop">
              <label className="se-audio__settings-check"
                title="When an imported song's samples exceed the sample budget, halve their rate (with pitch compensation) until they fit — off = a hard budget error instead">
                <input type="checkbox" checked={downsampleToFit}
                  onChange={(e) => {
                    const v = e.currentTarget.checked
                    setDownsampleToFit(v)
                    DOWNSAMPLE_TO_FIT_STORE.save(v)
                  }} />
                Downsample to fit
              </label>
              <label className="se-audio__settings-check"
                title="When an AddmusicK song's light-staccato articulation (extra note+tie pairs) pushes the module over the ARAM budget, retry without it — notes ring 1 tick shorter. Off = a hard budget error instead">
                <input type="checkbox" checked={dropStaccatoToFit}
                  onChange={(e) => {
                    const v = e.currentTarget.checked
                    setDropStaccatoToFit(v)
                    DROP_STACCATO_TO_FIT_STORE.save(v)
                  }} />
                Drop light staccato to fit
              </label>
              <label className="se-audio__settings-check"
                title="Carry Super Mario World's actual instrument samples (packaged with the app) into imported AddmusicK songs — exact timbres at a sample-budget cost. Off = approximate with Yoshi's Island's own sounds">
                <input type="checkbox" checked={useSmwSamples}
                  onChange={(e) => {
                    const v = e.currentTarget.checked
                    setUseSmwSamples(v)
                    USE_SMW_SAMPLES_STORE.save(v)
                  }} />
                Real SMW samples
              </label>
              <label className="se-audio__settings-check"
                title={
                  'Remove echo (reverb) from imported text/MML songs and claim the 4 KB echo buffer as extra room for the song. ' +
                  'The import warns when the destination music originally used echo — the level (and its sound effects, which inherit ' +
                  'the music’s reverb) plays dry. Does not affect .spc imports.'
                }>
                <input type="checkbox" checked={noEcho}
                  onChange={(e) => {
                    const v = e.currentTarget.checked
                    setNoEcho(v)
                    NO_ECHO_STORE.save(v)
                  }} />
                No echo (extra room)
              </label>
            </div>
          )}
        </div>
      </div>
      <div className="se-audio__export-dir" title={exportDir ?? undefined}>
        {exportDir ? exportDir : 'No active project.'}
      </div>
      {exportDir && (
        <div className="se-audio__changes">
          <div className="se-audio__changes-head">
            <span className="se-audio__changes-title">Imported songs ({importedTargets.length})</span>
            {importedTargets.length > 0 && importFreeBytes !== null && (
              <span className="se-audio__changes-budget" title="Remaining audio-region growth budget shared by all imports">
                {formatBytes(importFreeBytes)} budget free
              </span>
            )}
          </div>
          {importedTargets.length === 0 ? (
            <p className="se-audio__changes-empty">No songs imported yet.</p>
          ) : (
            importedTargets.map((t) => (
              <div key={t.blockId} className="se-audio__row">
                <span className="se-audio__sfx-name" title={`Replaces ${t.module} — heard in: ${t.usedBy.join(', ')}`}>
                  {t.name}
                  {importedSlotLabel(t) && <span className="se-audio__group-meta"> · {importedSlotLabel(t)}</span>}
                  {' ← '}{t.imported!.title ?? t.imported!.source ?? 'imported song'}
                </span>
                <span className="se-audio__group-meta">
                  {formatBytes(t.imported!.moduleBytes)} / was {formatBytes(t.imported!.baseBytes)}
                </span>
                <span className="se-audio__row-actions">
                  <button className="se-audio__btn" title="Play the imported song in the editor"
                    onClick={() => void playSong(t.setting, t.imported!.targetSlots?.[0] ?? t.slots[0] ?? 1, t.imported!.title ?? t.name)}>▶</button>
                  <button className="se-audio__btn" title="Remove the imported song — the module returns to the original"
                    onClick={() => void revertImportAction(t)}>Reset</button>
                </span>
              </div>
            ))
          )}
        </div>
      )}
      {exportDir && (
        <ExportGroup id="import" name="import/" meta={`${importSongs.length} file(s)`}
          collapsed={exportCollapsed['import'] ?? true} onToggle={toggleExportGroup}>
          {importError && <div className="se-audio__empty-note">{importError}</div>}
          {!importError && importSongs.length === 0 && (
            <div className="se-audio__empty-note">
              Drop .spc files (emulator captures of the game and its hacks) or MML
              sources (.txt/.mml — AddmusicK packages with their sample folders, or
              AddMusicY files) into the import folder. Each file lists the songs it
              contains — pick the module to replace, preview the song over that
              music set, then Import it into the ROM.
            </div>
          )}
          {importSongs.map((f) => {
            const healthy = f.candidates.filter((c) => c.ok && c.aliasOf === undefined)
            const hidden = f.candidates.length - healthy.length
            const targetId = importTargetSel[f.rel] ?? DEFAULT_IMPORT_TARGET
            const budget = f.ok ? budgetOf(f, targetId) : undefined
            return (
              <div key={f.rel} className="se-audio__import-file">
                <div className="se-audio__row">
                  <span className="se-audio__sfx-name" title={f.error ?? f.title ?? f.name}>
                    {f.name}
                    {f.title ? ` — ${f.title}` : ''}
                  </span>
                  {f.kind === 'mml' && f.dialect && (
                    <span className="se-audio__badge"
                      title={f.dialect === 'amk' ? 'AddmusicK-dialect MML (translated to the YI driver)' : 'AddMusicY-dialect MML'}>
                      {f.dialect}
                    </span>
                  )}
                  {!f.ok && (
                    <span className="se-audio__badge se-audio__badge--changed" title={f.error}>unusable</span>
                  )}
                  <span className="se-audio__group-meta">{formatBytes(f.bytes)}</span>
                  {f.ok && (
                    <select
                      className="se-audio__import-target"
                      title={'Song set the import goes into — every level/context using it hears the import'}
                      value={importTargetSel[f.rel] ?? DEFAULT_IMPORT_TARGET}
                      onChange={(e) => {
                        const v = Number(e.currentTarget.value)
                        setImportTargetSel((m) => ({ ...m, [f.rel]: v }))
                        // Slot ids are module-specific — back to whole-set.
                        setImportSlotSel((m) => ({ ...m, [f.rel]: -1 }))
                      }}
                    >
                      {importTargets.map((t) => (
                        <option key={t.blockId} value={t.blockId} title={`${t.usedBy.join(', ')} — ${t.module} module`}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {f.ok && f.kind === 'mml' && (() => {
                    const target = importTargets.find((t) => t.blockId === (importTargetSel[f.rel] ?? DEFAULT_IMPORT_TARGET))
                    if (!target || target.slots.length === 0) return null
                    return (
                      <select
                        className="se-audio__import-target"
                        title={"Where inside the set the import goes: a single song merges alongside the set's existing songs (they keep playing, but share its space); Replace entire set repoints every song at the import"}
                        value={slotPickOf(f, target.blockId) ?? -1}
                        onChange={(e) => {
                          const v = Number(e.currentTarget.value)
                          setImportSlotSel((m) => ({ ...m, [f.rel]: v }))
                        }}
                      >
                        {!target.slotRequired && <option value={-1}>Replace entire set</option>}
                        {target.slots.map((s, i) => (
                          <option key={s} value={s}>
                            {hex0x(s)} — {target.slotNames[i] ?? 'song'}
                          </option>
                        ))}
                      </select>
                    )
                  })()}
                </div>
                {f.ok && f.kind === 'mml' && budget && (
                  <div
                    className="se-audio__import-budget"
                    title={
                      'What the selected target can still hold, under the module layout rules ' +
                      '(the set’s resident sample banks are dodged; a slot merge also keeps the module’s other songs). ' +
                      'The sequence must fit one contiguous run; sequence + samples share the total.'
                    }
                  >
                    space in target ({slotPickOf(f, targetId) !== null ? 'merge into slot' : 'replace entire set'}):{' '}
                    seq ≤ {fmtB(budget.seqLargestGap)} B · seq+samples ≤ {fmtB(budget.freeTotal)} B ·{' '}
                    {budget.dirSlotsFree} sample slots · {budget.instrumentRowsFree} instrument rows
                  </div>
                )}
                {f.ok && healthy.map((c) => (
                  <div key={c.slot} className="se-audio__row se-audio__import-candidate">
                    <span className="se-audio__slot" title="Song slot in the source file">{hex0x(c.slot)}</span>
                    <CandidateSizes c={c} budget={budget} mml={f.kind === 'mml'} />
                    <span className="se-audio__row-actions">
                      <button className="se-audio__btn"
                        title="Preview this song over the selected module's music set"
                        onClick={() => void previewImportSong(f, c.slot)}>▶</button>
                      <button className="se-audio__btn"
                        title="Import this song into the ROM, replacing the selected module (reversible with Reset)"
                        onClick={() => void importSongAction(f, c.slot)}>Import</button>
                    </span>
                  </div>
                ))}
                {f.ok && healthy.length === 0 && (
                  <div className="se-audio__empty-note">No playable songs found in this file.</div>
                )}
                {f.ok && hidden > 0 && (
                  <div className="se-audio__import-hidden">{hidden} empty/leftover slot(s) not shown</div>
                )}
                {!f.ok && f.error && (
                  <div className="se-audio__empty-note">{f.error}</div>
                )}
                {f.report && f.report.length > 0 && (
                  <div className="se-audio__import-report">
                    <div className="se-audio__import-report-title">
                      port report — {f.report.length} note{f.report.length > 1 ? 's' : ''}
                    </div>
                    <ul className="se-audio__import-report-list">
                      {f.report.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </ExportGroup>
      )}
      {exportFiles.length === 0 && exportDir && (
        <div className="se-audio__empty-note">
          Nothing exported yet — Export All Audio writes every sound effect as an
          editable MML .txt and each instrument sample as raw .brr plus a
          listenable .wav, into the folder above.
        </div>
      )}
      {sfxFiles.length > 0 && (
        <ExportGroup id="sfx" name="sfx/" meta={`${sfxFiles.length} MML file(s)`}
          collapsed={exportCollapsed['sfx'] ?? true} onToggle={toggleExportGroup}>
          {sfxFiles.map((f) => (
            <div key={f.rel} className="se-audio__row">
              <span className="se-audio__sfx-name">{f.name}</span>
              <span className="se-audio__group-meta">{formatBytes(f.bytes)}</span>
              <span className="se-audio__row-actions">
                {f.sfxId !== undefined && (
                  <button className="se-audio__btn" title="Play this sound effect in the editor"
                    onClick={() => void playSfxFile(f)}>▶</button>
                )}
              </span>
            </div>
          ))}
        </ExportGroup>
      )}
      {[...sampleBanks.entries()].map(([bank, files]) => {
        const editedN = files.filter((f) => f.changed).length
        const importedN = files.filter((f) => f.overlay).length
        return (
          <ExportGroup key={bank} id={`samples/${bank}`} name={`samples/${bank}/`}
            meta={`${files.length} sample(s), .brr + .wav`}
            collapsed={exportCollapsed[`samples/${bank}`] ?? true} onToggle={toggleExportGroup}
            badges={
              editedN + importedN > 0 ? (
                <>
                  {editedN > 0 && (
                    <span className="se-audio__badge se-audio__badge--changed"
                      title="Samples edited since export — Import Samples will re-encode them">{editedN} edited</span>
                  )}
                  {importedN > 0 && (
                    <span className="se-audio__badge se-audio__badge--overlay"
                      title="Project overrides from a previous import are in effect">{importedN} imported</span>
                  )}
                </>
              ) : null
            }>
            {files.map((f) => (
              <div key={f.rel} className="se-audio__row">
                <span className="se-audio__sfx-name">{f.name}{f.label ? ` — ${f.label}` : ''}</span>
                {f.changed && (
                  <span className="se-audio__badge se-audio__badge--changed"
                    title="Edited since export — Import Samples will re-encode it">edited</span>
                )}
                {f.overlay && (
                  <span className="se-audio__badge se-audio__badge--overlay"
                    title="A project override from a previous import is in effect">imported</span>
                )}
                <span className="se-audio__group-meta">{formatBytes(f.bytes)}</span>
                <span className="se-audio__row-actions">
                  <button className="se-audio__btn" title="Play the decoded sample"
                    onClick={() => void playExported(f)}>▶</button>
                </span>
              </div>
            ))}
          </ExportGroup>
        )
      })}
      {importLog && importLog.length > 0 && (
        <div className="se-audio__group">
          <div className="se-audio__group-title">
            <span className="se-audio__group-name">last import</span>
          </div>
          {importLog.map((i) => (
            <div key={`${i.bank}/${i.file}`} className={`se-audio__log-line se-audio__log-line--${i.action}`}>
              {i.bank}/{i.wav}: {i.action}
              {i.action === 'import' && i.sameSize === false ? ' (resized — hear it after the next build)' : ''}
              {i.message ? ` — ${i.message}` : ''}
              {i.warnings.map((w, wi) => (
                <div key={wi} className="se-audio__log-warning">⚠ {w}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
