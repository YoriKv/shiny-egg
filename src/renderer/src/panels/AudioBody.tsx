import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { AudioCatalogUi, AudioSettingUi, SettingAramUsage, SongTimeline } from '../../../preload/api'
import { useSpcPlayer } from '../hooks/useSpcPlayer'
import { getLevel } from '../data/levels'
import { persistedState } from '../lib/persisted-state'
import { hex0x } from '../lib/hex'
import { SequenceView } from './SequenceView'
import { AudioExportTab } from './AudioExportTab'
import { AramUsageDiagram } from './AramUsageDiagram'
import { MusicSetsTab } from './MusicSetsTab'
import type { MusicSetsEditorApi } from '../edit-session/useMusicSetsEditor'

// Audio panel — four tabs + the sequencer popup (research/plan-audio-panel.md §4/§5):
//  - Song Sets: the 13 music-set rows (settings, song slots with verified
//    names, init stars, used-by-levels, per-set ARAM diagram); SFX: the
//    named ids, filterable. Both play in-editor through the synthesized-SPC
//    path (audio:composeSongSpc / composeSfxSpc → our snes_spc wasm build —
//    no emulator, no build), and ♫ opens the sequencer popup.
//  - Sequencer popup (SequencerPopup below → SequenceView): a read-only
//    piano-roll modal over one song/SFX timeline, with a live sample-exact
//    playhead (only when the inspected item is what's loaded — `loaded`
//    tracks that identity) and per-voice mute pills (player.muteMask → DSP;
//    the mask lives in the shared player store so a reopened panel always
//    shows what's actually muted). Replaced the former Sequence/SFX Seq tabs.
//  - Edit Song Sets: MusicSetsTab.tsx over the App-level music-sets draft
//    (the set-table asm regions; save marks the build dirty).
//  - Export: extracted to AudioExportTab.tsx (folder browser, export-all,
//    sample + song import — the panel's project-mutating actions, each
//    onMutated → markRomDirty).
// Fetches its own catalog state; the only edit-session document is the
// Sets draft, owned at App level (imports persist immediately).

const TAB_IDS = ['songs', 'sfx', 'sets', 'export'] as const
type TabId = (typeof TAB_IDS)[number]

/** A cross-panel "open this tab" request (Header panel's Edit-sets button —
 *  App bumps `seq` so repeat clicks re-apply). */
export interface AudioTabRequest {
  tab: TabId
  seq: number
}

const TAB_STORE = persistedState<{ tab: TabId }>('shinyEgg.audioPanel.v1', { tab: 'songs' })

function loadTab(): TabId {
  const t = TAB_STORE.load().tab
  return (TAB_IDS as readonly string[]).includes(t) ? t : 'songs'
}

/** One browser row = one block-set row; settings sharing it play the same
 *  audio (they differ only in init song / item flag). */
interface SetGroup {
  row: number
  /** Settings in the row, named ones first (unused 0x0E/0x0F sort last). */
  settings: AudioSettingUi[]
  modules: string[]
  songs: Array<{ slotId: number; name: string }>
  /** slot id → settings that auto-play it on entry. */
  initOf: Map<number, AudioSettingUi[]>
  usedByLevels: number[]
  /** ROM byte size of the row's song module (engine-only rows: undefined). */
  songModuleBytes?: number
}

function groupSettings(settings: AudioSettingUi[]): SetGroup[] {
  const byRow = new Map<number, AudioSettingUi[]>()
  for (const s of settings) {
    ;(byRow.get(s.blockSetRow) ?? byRow.set(s.blockSetRow, []).get(s.blockSetRow)!).push(s)
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, list]) => {
      const named = [...list].sort((a, b) => Number(a.unused) - Number(b.unused) || a.setting - b.setting)
      const rep = named[0]
      const initOf = new Map<number, AudioSettingUi[]>()
      for (const s of named) {
        if (s.initSongId > 0) {
          ;(initOf.get(s.initSongId) ?? initOf.set(s.initSongId, []).get(s.initSongId)!).push(s)
        }
      }
      const usedByLevels = [...new Set(named.flatMap((s) => s.usedByLevels))].sort((a, b) => a - b)
      return {
        row,
        settings: named,
        modules: rep.modules,
        songs: rep.songs,
        initOf,
        usedByLevels,
        songModuleBytes: rep.songModuleBytes
      }
    })
}

interface TimelineData {
  name: string
  timeline: SongTimeline
}

/** The sequencer popup — a modal piano-roll over one song or sound effect,
 *  opened by the ♫ button on a Song Sets / SFX row (there are no picker
 *  tabs anymore). Decodes on open (cancelled on change), plays through the
 *  shared transport, and shows the live playhead while the inspected item
 *  is what the player has loaded. Esc / backdrop / ✕ close it — playback
 *  keeps running (the panel transport still controls it). */
function SequencerPopup({
  decodeKey,
  decode,
  playTitle,
  onPlay,
  onClose,
  playheadLive,
  getPosition,
  muteMask,
  onToggleVoice
}: {
  /** Identity of the inspected item; change re-fetches (bake the project id
   *  in so a project switch refreshes too). */
  decodeKey: string
  decode: () => Promise<{ ok: true; name: string; timeline: SongTimeline } | { ok: false; error: string }>
  playTitle: string
  onPlay: (data: TimelineData) => void
  onClose: () => void
  /** True when the current playback IS the inspected item. */
  playheadLive: boolean
  getPosition: () => number | null
  muteMask: number
  onToggleVoice: (voice: number) => void
}): JSX.Element {
  const [data, setData] = useState<TimelineData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    void decode().then((r) => {
      if (cancelled) return
      if (r.ok) setData({ name: r.name, timeline: r.timeline })
      else setError(r.error)
    })
    return () => {
      cancelled = true
    }
  }, [decodeKey, decode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="se-modal-backdrop" onMouseDown={onClose}>
      <div className="se-modal se-modal--sequencer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="se-seqpop__head">
          <h3 className="se-modal__title">{data ? data.name : 'Sequencer'}</h3>
          {data && (
            <button className="se-audio__btn" title={playTitle} onClick={() => onPlay(data)}>▶</button>
          )}
          <button className="se-audio__btn se-seqpop__close" title="Close (Esc)" onClick={onClose}>✕</button>
        </div>
        {error && <div className="se-audio__empty-note">{error}</div>}
        {!data && !error && <div className="se-audio__empty-note">Decoding…</div>}
        {data && (
          <SequenceView
            timeline={data.timeline}
            muteMask={muteMask}
            onToggleVoice={onToggleVoice}
            getPositionSeconds={playheadLive ? getPosition : null}
          />
        )}
      </div>
    </div>
  )
}

export function AudioBody({
  projectId,
  onMutated,
  onJumpToLevel,
  setsEditor,
  tabRequest
}: {
  projectId: string | null
  /** Called after an import changes the project overlay (→ markRomDirty). */
  onMutated?: () => void
  /** Open a level record in the editor (the Songs tab's used-by chips). */
  onJumpToLevel?: (levelRecordId: number) => void
  /** The App-level music-set-table draft (the Sets tab's document). */
  setsEditor: MusicSetsEditorApi
  /** Cross-panel tab-open request (Header panel's Edit-sets button). */
  tabRequest?: AudioTabRequest | null
}): JSX.Element {
  const [tab, setTab] = useState<TabId>(loadTab)
  const [catalog, setCatalog] = useState<AudioCatalogUi | null>(null)
  /** Per-block-set-row ARAM usage (the Songs-tab diagram), keyed by row. */
  const [aramUsage, setAramUsage] = useState<Map<number, SettingAramUsage> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [sfxFilter, setSfxFilter] = useState('')
  /** Songs-tab groups with their used-by-levels chips expanded (by row). */
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set())
  /** The open sequencer popup (♫ on a song / SFX row), or null. */
  const [seqPopup, setSeqPopup] = useState<
    | { kind: 'song'; setting: number; slotId: number }
    | { kind: 'sfx'; id: number }
    | null
  >(null)
  /** What the player currently has loaded (drives the inspector playheads).
   *  `seq` ties it to a specific playback — another consumer (Header preview,
   *  another row) replacing the audio bumps the shared player's seq, hiding
   *  the stale playhead. */
  const [loaded, setLoaded] = useState<
    | { kind: 'song'; setting: number; slotId: number; seq: number }
    | { kind: 'sfx'; id: number; seq: number }
    | null
  >(null)
  const player = useSpcPlayer()

  const selectTab = useCallback((t: TabId): void => {
    setTab(t)
    TAB_STORE.save({ tab: t })
  }, [])

  const refreshUsage = useCallback(async (): Promise<void> => {
    const r = await window.shinyEgg.audio.aramUsage()
    setAramUsage(r.ok ? new Map(r.rows.map((u) => [u.blockSetRow, u])) : null)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setLoadError(null)
    const r = await window.shinyEgg.audio.catalog()
    if (r.ok) setCatalog(r.catalog)
    else {
      setCatalog(null)
      setLoadError(r.error)
    }
    void refreshUsage()
  }, [refreshUsage])

  useEffect(() => {
    void refresh()
  }, [refresh, projectId])

  // Cross-panel tab request (Header panel's Edit-sets button): every `seq`
  // bump re-applies, so a repeat click refocuses the tab.
  useEffect(() => {
    if (tabRequest) selectTab(tabRequest.tab)
  }, [tabRequest, selectTab])

  /** Imports/resets in the Export tab change the overlay modules the diagram
   *  reflects — refresh it alongside the caller's markRomDirty. */
  const handleMutated = useCallback((): void => {
    onMutated?.()
    void refreshUsage()
  }, [onMutated, refreshUsage])

  const groups = useMemo(() => (catalog ? groupSettings(catalog.settings) : []), [catalog])

  const playSong = useCallback(
    async (setting: number, slotId: number, label: string): Promise<void> => {
      setStatus(null)
      const r = await window.shinyEgg.audio.composeSongSpc(setting, slotId)
      if (!r.ok) {
        setStatus(`Compose failed: ${r.error}`)
        return
      }
      try {
        const seq = await player.play(r.spc, label)
        setLoaded({ kind: 'song', setting, slotId, seq })
      } catch (e) {
        setStatus(`Playback failed: ${(e as Error).message}`)
      }
    },
    [player]
  )

  const playSfx = useCallback(
    async (id: number, name: string): Promise<void> => {
      setStatus(null)
      const r = await window.shinyEgg.audio.composeSfxSpc(id)
      if (!r.ok) {
        setStatus(`Compose failed: ${r.error}`)
        return
      }
      try {
        const seq = await player.play(r.spc, `SFX — ${name}`)
        setLoaded({ kind: 'sfx', id, seq })
      } catch (e) {
        setStatus(`Playback failed: ${(e as Error).message}`)
      }
    },
    [player]
  )

  /** Audition an Edit-Song-Sets DRAFT row pick (unsaved edits included) —
   *  composes the explicit block list instead of a built-table setting. */
  const playRow = useCallback(
    async (blockIds: number[], slotId: number, label: string): Promise<void> => {
      setStatus(null)
      const r = await window.shinyEgg.audio.composeRowSpc(blockIds, slotId)
      if (!r.ok) {
        setStatus(`Compose failed: ${r.error}`)
        return
      }
      try {
        await player.play(r.spc, label)
        setLoaded(null) // not a catalog (setting, slot) identity — no playhead
      } catch (e) {
        setStatus(`Playback failed: ${(e as Error).message}`)
      }
    },
    [player]
  )

  const openInSequence = useCallback((setting: number, slotId: number): void => {
    setSeqPopup({ kind: 'song', setting, slotId })
  }, [])

  const openInSfxSequence = useCallback((id: number): void => {
    setSeqPopup({ kind: 'sfx', id })
  }, [])

  const toggleVoice = useCallback(
    (voice: number): void => {
      player.muteVoices(player.muteMask ^ (1 << voice))
    },
    [player]
  )

  const decodePopup = useCallback(
    () =>
      seqPopup?.kind === 'song'
        ? window.shinyEgg.audio.decodeSong(seqPopup.setting, seqPopup.slotId)
        : window.shinyEgg.audio.decodeSfx(seqPopup?.kind === 'sfx' ? seqPopup.id : 0),
    [seqPopup]
  )

  const filteredSfx = useMemo(() => {
    if (!catalog) return []
    const q = sfxFilter.trim().toLowerCase()
    if (!q) return catalog.sfx
    return catalog.sfx.filter(
      (s) => s.name.toLowerCase().includes(q) || hex0x(s.id).toLowerCase().includes(q)
    )
  }, [catalog, sfxFilter])

  if (loadError) {
    return (
      <div className="se-audio se-audio--empty">
        <div>{loadError}</div>
        <button className="se-audio__btn" onClick={() => void refresh()}>Retry</button>
      </div>
    )
  }
  if (!catalog) return <div className="se-audio se-audio--empty">Loading audio catalog…</div>

  return (
    <div className="se-audio">
      <div className="se-audio__transport">
        <div className="se-audio__tabs">
          {TAB_IDS.map((t) => (
            <button
              key={t}
              className={`se-audio__tab${tab === t ? ' se-audio__tab--active' : ''}`}
              onClick={() => selectTab(t)}
            >
              {t === 'songs' ? 'Song Sets' : t === 'sfx' ? 'SFX' : t === 'sets' ? 'Edit Song Sets' : 'Export/Import'}
              {t === 'sets' && setsEditor.dirty ? ' •' : ''}
            </button>
          ))}
        </div>
        <button className="se-audio__btn" onClick={player.stop} disabled={!player.playing} title="Stop in-editor playback">
          ⏹ Stop
        </button>
        <input
          className="se-audio__volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(player.volume * 100)}
          onChange={(e) => player.setVolume(Number(e.currentTarget.value) / 100)}
          title="Editor playback volume"
        />
        <div className="se-audio__now" title={player.nowLabel ?? undefined}>
          {player.playing && player.nowLabel ? `▶ ${player.nowLabel}` : ''}
        </div>
      </div>

      {tab === 'songs' ? (
        <div className="se-audio__list">
          {groups.map((g) => {
            const rep = g.settings[0]
            const namedSettings = g.settings.filter((s) => !s.unused)
            const title = (namedSettings.length ? namedSettings : g.settings).map((s) => s.name).join(' · ')
            const levelsOpen = expandedLevels.has(g.row)
            return (
              <div key={g.row} className="se-audio__group">
                <div className="se-audio__group-title">
                  <span className="se-audio__group-name" title={`Song set ${g.row}`}>{title}</span>
                  <span className="se-audio__group-meta">
                    {g.modules.join(' + ')}
                    {g.usedByLevels.length > 0 && (
                      <>
                        {' · '}
                        <button
                          className="se-audio__levels-toggle"
                          title={levelsOpen ? 'Hide the levels using this music' : 'List the levels using this music — click one to open it'}
                          onClick={() => {
                            setExpandedLevels((s) => {
                              const next = new Set(s)
                              if (next.has(g.row)) next.delete(g.row)
                              else next.add(g.row)
                              return next
                            })
                          }}
                        >
                          {g.usedByLevels.length} level{g.usedByLevels.length === 1 ? '' : 's'} {levelsOpen ? '▾' : '▸'}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                <div
                  className="se-audio__group-detail"
                  title="Song module = the row’s ROM blob (what an imported song replaces); the shared growth budget is the sound region’s free tail."
                >
                  {g.songModuleBytes !== undefined
                    ? `song module ${g.songModuleBytes.toLocaleString('en-US')} B ROM`
                    : 'songs live in the driver image'}
                </div>
                {(() => {
                  const usage = aramUsage?.get(g.row)
                  return usage ? <AramUsageDiagram usage={usage} /> : null
                })()}
                {levelsOpen && g.usedByLevels.length > 0 && (
                  <div className="se-audio__levels">
                    {g.usedByLevels.map((id) => {
                      const entry = getLevel(id)
                      return (
                        <button
                          key={id}
                          className="se-audio__level-chip"
                          title={entry ? `Open ${entry.world} ${entry.slot} — ${entry.name}` : `Open sub-room ${hex0x(id)}`}
                          onClick={() => onJumpToLevel?.(id)}
                          disabled={!onJumpToLevel}
                        >
                          {hex0x(id)}{entry ? ` ${entry.slot}` : ''}
                        </button>
                      )
                    })}
                  </div>
                )}
                {g.songs.map(({ slotId, name }) => {
                  const initFor = g.initOf.get(slotId) ?? []
                  return (
                    <div key={slotId} className="se-audio__row">
                      <span className="se-audio__slot" title="Song slot id (the value written to the music mailbox)">{hex0x(slotId)}</span>
                      <span className="se-audio__song-name">{name}</span>
                      <span className="se-audio__song-note" title={initFor.length ? `Plays on entry for: ${initFor.map((s) => s.name).join(', ')}` : undefined}>
                        {initFor.length > 0 ? `★ ${initFor.map((s) => s.name).join(', ')}` : ''}
                      </span>
                      <span className="se-audio__row-actions">
                        <button className="se-audio__btn" title="Play in the editor"
                          onClick={() => void playSong(rep.setting, slotId, name)}>▶</button>
                        <button className="se-audio__btn" title="Open in the sequencer"
                          onClick={() => openInSequence(rep.setting, slotId)}>♫</button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : tab === 'sfx' ? (
        <div className="se-audio__list">
          <input
            className="se-audio__filter"
            type="text"
            placeholder="Filter by name or id…"
            value={sfxFilter}
            onChange={(e) => setSfxFilter(e.currentTarget.value)}
          />
          {filteredSfx.map((s) => (
            <div key={s.id} className="se-audio__row">
              <span className="se-audio__slot">{hex0x(s.id)}</span>
              <span className="se-audio__sfx-name">{s.name}</span>
              <span
                className="se-audio__sfx-voice"
                title={`Plays on voice ${s.voice} (priority ${hex0x(s.priority)} — same-voice contention: higher priority wins)`}
              >
                v{s.voice}
              </span>
              <span className="se-audio__row-actions">
                <button className="se-audio__btn" title="Play in the editor"
                  onClick={() => void playSfx(s.id, s.name)}>▶</button>
                <button className="se-audio__btn" title="Open in the sequencer"
                  onClick={() => openInSfxSequence(s.id)}>♫</button>
              </span>
            </div>
          ))}
          {filteredSfx.length === 0 && <div className="se-audio__empty-note">No SFX match the filter.</div>}
        </div>
      ) : tab === 'sets' ? (
        <MusicSetsTab editor={setsEditor} catalog={catalog} playRow={playRow} />
      ) : (
        <AudioExportTab
          projectId={projectId}
          player={player}
          setStatus={setStatus}
          onMutated={handleMutated}
          playSong={playSong}
          onForeignPlayback={() => setLoaded(null)}
        />
      )}

      {(status ?? player.error) && <div className="se-audio__status">{status ?? player.error}</div>}

      {seqPopup && (
        <SequencerPopup
          decodeKey={
            seqPopup.kind === 'song'
              ? `${projectId ?? ''}:song:${seqPopup.setting}:${seqPopup.slotId}`
              : `${projectId ?? ''}:sfx:${seqPopup.id}`
          }
          decode={decodePopup}
          playTitle={seqPopup.kind === 'song' ? 'Play this song (mutes apply live)' : 'Play this SFX (mutes apply live)'}
          onPlay={(data) => {
            if (seqPopup.kind === 'song') void playSong(seqPopup.setting, seqPopup.slotId, data.name)
            else void playSfx(seqPopup.id, data.name)
          }}
          onClose={() => setSeqPopup(null)}
          playheadLive={
            seqPopup.kind === 'song'
              ? loaded?.kind === 'song' && loaded.seq === player.seq &&
                loaded.setting === seqPopup.setting && loaded.slotId === seqPopup.slotId
              : loaded?.kind === 'sfx' && loaded.seq === player.seq && loaded.id === seqPopup.id
          }
          getPosition={player.getPosition}
          muteMask={player.muteMask}
          onToggleVoice={toggleVoice}
        />
      )}
    </div>
  )
}
