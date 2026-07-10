import { useMemo, type JSX } from 'react'
import type { AudioCatalogUi, MusicSetsModel } from '../../../preload/api'
import type { MusicSetsEditorApi } from '../edit-session/useMusicSetsEditor'
import { hex0x } from '../lib/hex'

// The Audio panel's Sets tab — full edit control over the music set tables
// (see research/plan-audio-panel.md §1.10): per header-music value (setting),
// which block-set row uploads, which song slot auto-plays on entry, and the
// pause-item flag; plus the 13 rows' upload lists themselves. Edits are a
// draft on the shared overlay-document engine (useMusicSetsEditor at App
// level — global Save / Test Level flush it; closing the window prompts).
// Saves splice the ;@editable regions in Bank00/Bank01 and mark the build
// dirty — there's no live in-game preview, but ▶ auditions the DRAFT row
// composition (unsaved edits included) via audio:composeRowSpc; only the
// module CONTENTS come from the current build + overlays.

/** Song slots known for each block-set row, from the built catalog — the
 *  entry-song dropdown's vocabulary. A draft row-block edit doesn't move
 *  these until a rebuild (the compose itself validates the real slots). */
function songsByRow(catalog: AudioCatalogUi): Map<number, Array<{ slotId: number; name: string }>> {
  const map = new Map<number, Array<{ slotId: number; name: string }>>()
  for (const s of catalog.settings) {
    if (!map.has(s.blockSetRow) && s.songs.length > 0) map.set(s.blockSetRow, s.songs)
  }
  return map
}

/** Short label for a song set: its song module's display name (or the driver). */
function songSetLabel(ids: number[], catalog: AudioCatalogUi): string {
  const byId = new Map(catalog.blocks.map((b) => [b.blockId, b]))
  const songs = ids.map((id) => byId.get(id)).find((b) => b?.kind === 'songs')
  if (songs) return songs.name
  if (ids.some((id) => byId.get(id)?.kind === 'engine')) return 'driver (title songs)'
  return ids.length === 0 ? 'empty' : 'samples only'
}

/** Advisory for a song set's module list — catches silent-wrong combinations. */
function songSetAdvisory(ids: number[], catalog: AudioCatalogUi): string | null {
  const byId = new Map(catalog.blocks.map((b) => [b.blockId, b]))
  const kinds = ids.map((id) => byId.get(id)?.kind)
  if (kinds.includes('engine')) return null // driver row — self-contained
  if (!kinds.includes('songs')) return 'no song module — music values on this set play nothing new'
  // Self-contained banks replace the global bank; anything else needs $25
  // resident for SFX/instrument samples (uploaded implicitly by the engine's
  // baseline only in the editor — in-game it must be IN the row or resident).
  const selfContained = ids.some((id) => id === 0x31 || id === 0x37)
  if (!selfContained && !ids.includes(0x25)) {
    return 'no base sample bank (0x25) — instruments depend on what an earlier set left resident'
  }
  return null
}

export function MusicSetsTab({
  editor,
  catalog,
  playRow
}: {
  editor: MusicSetsEditorApi
  catalog: AudioCatalogUi
  /** Compose + play a DRAFT row's block list through the shared player
   *  (AudioBody's playRow) — unsaved row edits audition as assembled. */
  playRow: (blockIds: number[], slotId: number, label: string) => Promise<void>
}): JSX.Element {
  const model: MusicSetsModel | null = editor.model
  const rowSongs = useMemo(() => songsByRow(catalog), [catalog])

  if (editor.error) return <div className="se-audio__empty-note">{editor.error}</div>
  if (!model) return <div className="se-audio__empty-note">{editor.status || 'Loading…'}</div>

  const preview = (setting: number): void => {
    const m = model.settings[setting]
    if (!m) return
    const slots = rowSongs.get(m.blockSetRow) ?? []
    const slot = m.initSongId && slots.some((s) => s.slotId === m.initSongId)
      ? m.initSongId
      : slots[0]?.slotId
    if (slot === undefined) return
    const name = slots.find((s) => s.slotId === slot)?.name ?? hex0x(slot)
    void playRow(model.rows[m.blockSetRow] ?? [], slot, name)
  }

  return (
    <div className="se-audio__list">
      <div className="se-audio__export-actions">
        <button className="se-audio__btn" disabled={!editor.dirty || editor.saving}
          title="Write the set tables into the project (Test Level / Launch rebuild with them)"
          onClick={() => void editor.save()}>
          {editor.saving ? 'Saving…' : `Save${editor.dirty ? '' : 'd'}`}
        </button>
        <button className="se-audio__btn" disabled={!editor.dirty || editor.saving}
          title="Revert every unsaved change to the last save" onClick={editor.discard}>Discard</button>
        {editor.dirty && <span className="se-audio__badge se-audio__badge--changed">unsaved</span>}
        {editor.saveError && <span className="se-audio__status">{editor.saveError}</span>}
      </div>
      <div className="se-audio__group-detail">
        The level header's music values resolve here: each picks a song set (which modules load), the entry song is the
        slot that auto-plays when the set changes (same-set level chains keep the running song), and
        Items controls the pause menu. No live preview in-game — a rebuild (Test Level) applies edits;
        ▶ auditions your DRAFT (unsaved edits included; module contents from the current build). {hex0x(0x0e)}/{hex0x(0x0f)} are free for custom picks.
      </div>

      <div className="se-audio__group">
        <div className="se-audio__group-title"><span className="se-audio__group-name">music values (level-header picks + engine contexts)</span></div>
        {model.settings.map((m, setting) => {
          const name = catalog.settings[setting]?.name ?? hex0x(setting)
          const slots = rowSongs.get(m.blockSetRow) ?? []
          const initKnown = m.initSongId === null || m.initSongId === 0 || slots.some((s) => s.slotId === m.initSongId)
          const engineContext = setting >= 0x10
          return (
            <div key={setting} className="se-sets__row">
              <span className="se-audio__slot" title={engineContext ? 'Engine context — not selectable from a level header' : 'Level-header music value'}>
                {hex0x(setting)}
              </span>
              <span className="se-sets__name" title={engineContext ? `${name} (engine context)` : name}>{name}</span>
              <select
                className="se-sets__pick"
                title="Song set this music value loads (defined in the song sets section below)"
                value={m.blockSetRow}
                onChange={(e) => editor.setSetting(setting, { blockSetRow: Number(e.currentTarget.value) })}
              >
                {model.rows.map((ids, r) => (
                  <option key={r} value={r}>set {r} — {songSetLabel(ids, catalog)}</option>
                ))}
              </select>
              {m.initSongId !== null ? (
                <select
                  className={`se-sets__pick${initKnown ? '' : ' is-warn'}`}
                  title={
                    'Entry song — the slot auto-played when this set replaces the previous one. ' +
                    'Songs list the current build; a slot the set never loads plays whatever an earlier set left in memory (can hang).'
                  }
                  value={m.initSongId}
                  onChange={(e) => editor.setSetting(setting, { initSongId: Number(e.currentTarget.value) })}
                >
                  <option value={0}>none</option>
                  {slots.map((s) => (
                    <option key={s.slotId} value={s.slotId}>{hex0x(s.slotId)} {s.name}</option>
                  ))}
                  {!initKnown && <option value={m.initSongId}>{hex0x(m.initSongId)} (not in this set!)</option>}
                </select>
              ) : (
                <span className="se-sets__pick se-sets__na" title="The init-song table ends before this setting">—</span>
              )}
              {m.itemDenial !== null ? (
                <select
                  className="se-sets__pick se-sets__pick--items"
                  title="Pause-menu items while this music plays"
                  value={m.itemDenial}
                  onChange={(e) => editor.setSetting(setting, { itemDenial: Number(e.currentTarget.value) })}
                >
                  <option value={0}>items ok</option>
                  <option value={1}>items denied</option>
                  <option value={0xff}>inherit</option>
                </select>
              ) : (
                <span className="se-sets__pick se-sets__pick--items se-sets__na" title="The item table ends before this setting">—</span>
              )}
              <span className="se-audio__row-actions">
                <button className="se-audio__btn" title="Audition this pick — composes your draft song set (module contents from the current build)"
                  onClick={() => preview(setting)}>▶</button>
              </span>
            </div>
          )
        })}
      </div>

      <div className="se-audio__group">
        <div className="se-audio__group-title"><span className="se-audio__group-name">song sets (what each set loads, in order)</span></div>
        <div className="se-audio__group-detail se-sets__danger">
          ⚠ Advanced — don't edit unless you know what you're doing. Changing what a set loads
          affects every music value pointing at it, and a bad combination breaks instruments or
          music in-game in ways the editor can only partly check.
        </div>
        <div className="se-audio__group-detail">
          Up to 3 modules per set, loaded left to right (sample banks before songs). Sound RAM
          accumulates across sets — a set that omits a bank plays whatever an earlier set left resident.
        </div>
        {model.rows.map((ids, r) => {
          const usedBy = model.settings
            .map((m, s) => (m.blockSetRow === r ? s : -1))
            .filter((s) => s >= 0)
          // Friendly name = the music set(s) pointing at this row in the
          // DRAFT (named settings first; custom/unused values don't name it).
          const names = usedBy
            .map((s) => catalog.settings[s])
            .filter((s) => s !== undefined && !s.unused)
            .map((s) => s!.name)
          const advisory = songSetAdvisory(ids, catalog)
          return (
            <div key={r} className="se-sets__row">
              <span className="se-audio__slot se-sets__rowlabel">set {r}</span>
              <span className="se-sets__name" title={names.length ? names.join(', ') : 'No named music value uses this song set'}>
                {names[0] ?? '—'}
              </span>
              {[0, 1, 2].map((slot) => (
                <select
                  key={slot}
                  className="se-sets__pick"
                  title={`Module ${slot + 1} — loaded in order (sample banks before songs)`}
                  value={ids[slot] ?? -1}
                  onChange={(e) => {
                    const v = Number(e.currentTarget.value)
                    editor.setSongSetModule(r, slot, v < 0 ? null : v)
                  }}
                >
                  <option value={-1}>— empty</option>
                  {catalog.blocks.map((b) => (
                    <option key={b.blockId} value={b.blockId}>{b.name}</option>
                  ))}
                </select>
              ))}
              <span className="se-sets__used" title={usedBy.length ? `Music values using this song set: ${usedBy.map((s) => hex0x(s)).join(', ')}` : 'No music value uses this song set'}>
                {usedBy.length ? usedBy.map((s) => hex0x(s)).join(' ') : 'unused'}
              </span>
              {advisory && <span className="se-sets__advisory" title={advisory}>⚠</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
