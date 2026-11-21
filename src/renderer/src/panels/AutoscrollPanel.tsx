// Autoscroll window: the 12 autoscroll tracks (special sprites $1CA-$1D5) and
// the checkpoint sequences they run through (Bank03 tables). Lists every
// checkpoint of the selected track with hex X / Y / speed fields, insert /
// delete / start-here actions, the end command, the shared byte budget, and
// restore-to-reference. The same draft is edited on the level canvas (drag a
// checkpoint node; right-click for insert/delete). Ops: lib/autoscroll-edit.ts.

import { useState, type JSX } from 'react'
import {
  AUTOSCROLL_HORIZONTAL_ONLY,
  AUTOSCROLL_TRACK_COUNT,
  AUTOSCROLL_UNUSED_TRACKS,
  AUTOSCROLL_VALUES_SIZE,
  autoscrollBytesUsed,
  autoscrollCheckpointWarnings
} from 'snes-framework/autoscroll-model'
import type { AutoscrollEditorApi, AutoscrollShowMode } from '../edit-session/useAutoscrollEditor'
import {
  addSequence,
  checkpointAfter,
  checkpointCamera,
  checkpointCenter,
  detachTrack,
  differsFromReference,
  insertCheckpoint,
  removeSequence,
  resetToReference,
  setCheckpoint,
  setSequenceEnd,
  setTrackStart,
  speedPxPerFrame,
  trackSpriteId,
  tracksInSequence,
  type CheckpointRef
} from '../lib/autoscroll-edit'
import type { AutoscrollPlaybackRequest } from '../lib/autoscroll-playback'
import { NumberField } from './field-widgets'
import { DiscardChangesModal } from '../DiscardChangesModal'
import { hex } from '../lib/hex'

/** Where each track plays in the base game (racknae's Custom Autoscroll readme). */
const TRACK_USES: Record<number, string> = {
  0x1ca: '6-8 Kamek section',
  0x1cb: '1-5',
  0x1cc: '1-5 from the middle ring',
  0x1cd: '6-5 re-entering from the optional area',
  0x1ce: '6-5 optional area',
  0x1cf: '6-5 first area',
  0x1d0: '6-5 second area',
  0x1d1: '5-6 first area',
  0x1d2: '2-1 falling-rock section',
  0x1d3: '6-8 door 3 Tap-Tap chase',
  0x1d4: '1-Extra',
  0x1d5: 'unused (no sprite runs it in the base game)'
}

const sid = (track: number): string => `$${hex(trackSpriteId(track), 3)}`

export function AutoscrollBody({
  editor,
  projectActive,
  onJump,
  onSelectCheckpoint,
  canPlay,
  onPlay
}: {
  editor: AutoscrollEditorApi
  projectActive: boolean
  /** Centre the canvas on a level cell. */
  onJump: (x: number, y: number) => void
  onSelectCheckpoint: (track: number, ref: CheckpointRef) => void
  canPlay: boolean
  onPlay: (request: AutoscrollPlaybackRequest) => void
}): JSX.Element {
  const { model, ui, setUi, apply } = editor
  const [confirmReset, setConfirmReset] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (!model) {
    return <div className="se-spriteset__empty">{editor.error ?? 'Loading autoscroll tables…'}</div>
  }
  const track = Math.min(ui.track, AUTOSCROLL_TRACK_COUNT - 1)
  const start = model.tracks[track]!
  const seq = model.sequences[start.sequence]!
  const selected = ui.checkpoint
  const playFrom = selected?.sequence === start.sequence &&
    selected.checkpoint >= start.checkpoint && selected.checkpoint < seq.checkpoints.length
    ? selected.checkpoint
    : start.checkpoint
  const used = autoscrollBytesUsed(model.sequences)
  const free = AUTOSCROLL_VALUES_SIZE - used
  const sharers = tracksInSequence(model, start.sequence).filter((t) => t !== track)
  const num = trackSpriteId(track)
  const refused = (r: { reason: string } | { model: unknown }): void => {
    if ('reason' in r) setNote(r.reason)
  }
  const act = (next: typeof model | null, failure?: string): void => {
    if (next) {
      apply(next)
      setNote(null)
    } else if (failure) setNote(failure)
  }

  return (
    <div className="se-autoscroll">
      <div className="se-spriteset__controls">
        <label>
          Track
          <select className="se-input" value={track} onChange={(e) => setUi({ track: Number(e.target.value), checkpoint: null })}>
            {model.tracks.map((_, i) => (
              <option key={i} value={i}>{`${sid(i)} · ${TRACK_USES[trackSpriteId(i)] ?? ''}`}</option>
            ))}
          </select>
        </label>
        <label title="When the level canvas draws autoscroll paths (also hidden when Sprite editing is off or in Render Only)">
          Show paths
          <select className="se-input" value={ui.show} onChange={(e) => setUi({ show: e.target.value as AutoscrollShowMode })}>
            <option value="selected">Selected sprite / this track</option>
            <option value="all">All autoscrolls in the room</option>
            <option value="off">Hidden</option>
          </select>
        </label>
        <div className="se-spriteset__actions">
          <button type="button" className="se-banks__act se-banks__act--danger" disabled={!differsFromReference(model) || editor.saving} onClick={() => setConfirmReset(true)} title="Restore both autoscroll tables to the reference cart">Restore to reference…</button>
          <button type="button" className="se-banks__act" disabled={!editor.dirty || editor.saving} onClick={() => editor.discard()}>Discard</button>
          <button type="button" className="se-banks__act" disabled={!editor.dirty || editor.saving || !projectActive || editor.invalid !== null} onClick={() => void editor.save()} title={editor.invalid ?? (projectActive ? 'Save to the project overlay (Bank03.asm)' : 'Open a project to save edits')}>
            {editor.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className={`se-autoscroll__budget${free < 0 ? ' is-over' : ''}`} title="All 12 tracks share one fixed 376-byte checkpoint stream (code follows it in ROM). A checkpoint costs 3 bytes, each sequence's end command 1.">
        <div className="se-autoscroll__budget-bar"><span style={{ width: `${Math.min(100, (used / AUTOSCROLL_VALUES_SIZE) * 100)}%` }} /></div>
        <span>{used} / {AUTOSCROLL_VALUES_SIZE} bytes · {free >= 0 ? `${free} free (${Math.floor(free / 3)} checkpoint${Math.floor(free / 3) === 1 ? '' : 's'})` : `${-free} over`}</span>
      </div>

      <div className="se-spriteset__status">
        {editor.invalid ?? note ?? editor.error ?? editor.saveError ?? (editor.status || (editor.dirty ? 'Unsaved autoscroll edits' : ''))}
      </div>
      {!projectActive && <div className="se-spriteset__hint">Open a project to save autoscroll changes.</div>}

      <div className="se-autoscroll__track">
        <div>
          Sprite <strong>{sid(track)}</strong> starts at checkpoint <strong>{start.checkpoint}</strong> of sequence <strong>{start.sequence}</strong>
          {' '}and runs {seq.checkpoints.length - start.checkpoint} checkpoint{seq.checkpoints.length - start.checkpoint === 1 ? '' : 's'}.
        </div>
        {AUTOSCROLL_HORIZONTAL_ONLY.has(num) && <div className="se-autoscroll__warn">This sprite only drives the camera horizontally — the player still scrolls vertically.</div>}
        {AUTOSCROLL_UNUSED_TRACKS.has(num) && <div className="se-autoscroll__warn">Sprite $1D5 is a scroll stopper in the base game, so this track never runs unless a patch (racknae's enablesprite1D5) repurposes it.</div>}
        {sharers.length > 0 && (
          <div className="se-autoscroll__warn">
            Shares sequence {start.sequence} with {sharers.map(sid).join(', ')} — edits to shared checkpoints change those tracks too.{' '}
            <button type="button" className="se-banks__act" onClick={() => {
              const r = detachTrack(model, track)
              if ('model' in r) act(r.model)
              else refused(r)
            }} title="Copy the checkpoints this track visits into a new sequence of its own (uses free bytes)">Detach into own sequence</button>
          </div>
        )}
        <div className="se-spriteset__controls">
          <label>
            Play from checkpoint
            <select className="se-input" value={playFrom} onChange={(e) => {
              onSelectCheckpoint(track, { sequence: start.sequence, checkpoint: Number(e.target.value) })
            }}>
              {seq.checkpoints.slice(start.checkpoint).map((_, i) => {
                const checkpoint = start.checkpoint + i
                return <option key={checkpoint} value={checkpoint}>#{checkpoint}</option>
              })}
            </select>
          </label>
          <button type="button" className="se-banks__act" disabled={!canPlay} title={canPlay ? undefined : 'Open a playable level first'} onClick={() => {
            onPlay({ track, sequence: seq, checkpoint: playFrom })
          }}>Play autoscroll</button>
        </div>
        <div className="se-autoscroll__hint">Playback starts at the chosen checkpoint. The camera uses the current room and starts at rest.</div>
        <div className="se-autoscroll__hint">Drag a node to move it. Select a node and press Delete to remove it. Right-click a node to insert a checkpoint or empty space to append one.</div>
      </div>

      <table className="se-autoscroll__table">
        <thead>
          <tr>
            <th title="Checkpoint index in the sequence">#</th>
            <th title="Camera left edge ÷ 16 (hex). Keep ≤ F0.">X</th>
            <th title="(Camera top − $1C) ÷ 16 (hex). Keep ≤ 70.">Y</th>
            <th title="Speed toward this checkpoint (hex, 01–7F). Dominant-axis velocity = speed × 16 subpixels / frame; the camera ramps toward it by 1 subpixel per frame.">Speed</th>
            <th title="Dominant-axis pixels per frame">px/f</th>
            <th title="Camera top-left in level pixels">Camera</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {seq.checkpoints.map((c, i) => {
            const ref = { sequence: start.sequence, checkpoint: i }
            const before = i < start.checkpoint
            const active = ui.checkpoint?.sequence === ref.sequence && ui.checkpoint.checkpoint === i
            const warns = autoscrollCheckpointWarnings(c)
            const startsHere = model.tracks.flatMap((t, ti) => (t.sequence === ref.sequence && t.checkpoint === i ? [ti] : []))
            const cam = checkpointCamera(c)
            return (
              <tr
                key={i}
                className={`${before ? 'is-before' : ''}${active ? ' is-active' : ''}${warns.length ? ' is-warn' : ''}`}
                onClick={() => onSelectCheckpoint(track, ref)}
                title={before ? `Before ${sid(track)}'s start — only tracks that start earlier in this sequence visit it.` : warns.join(' ')}
              >
                <td>
                  {i}
                  {startsHere.map((t) => <span key={t} className="se-autoscroll__tag" title={`${sid(t)} starts here`}>{sid(t)}</span>)}
                </td>
                <td><NumberField value={c.x} min={0} max={0xfd} hex onCommit={(v) => act(setCheckpoint(model, ref, { x: v }))} /></td>
                <td><NumberField value={c.y} min={0} max={0xff} hex onCommit={(v) => act(setCheckpoint(model, ref, { y: v }))} /></td>
                <td><NumberField value={c.speed} min={0} max={0xff} hex onCommit={(v) => act(setCheckpoint(model, ref, { speed: v }))} /></td>
                <td className="se-autoscroll__num">{speedPxPerFrame(c.speed).toFixed(2)}</td>
                <td className="se-autoscroll__num">{cam.x},{cam.y}{warns.length > 0 && <span className="se-autoscroll__warn-dot" title={warns.join(' ')}> ⚠</span>}</td>
                <td className="se-autoscroll__acts" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="se-banks__act" title="Centre the canvas on this checkpoint's screen" onClick={() => {
                    const ctr = checkpointCenter(c)
                    onSelectCheckpoint(track, ref)
                    onJump(Math.floor(ctr.x / 16), Math.floor(ctr.y / 16))
                  }}>⌖</button>
                  <button type="button" className="se-banks__act" title="Insert a checkpoint before this one" disabled={free < 3} onClick={() => act(insertCheckpoint(model, ref.sequence, i, { ...c }), 'No free bytes.')}>+↑</button>
                  <button type="button" className="se-banks__act" title="Insert a checkpoint after this one" disabled={free < 3} onClick={() => act(insertCheckpoint(model, ref.sequence, i + 1, checkpointAfter(model, ref)!), 'No free bytes.')}>+↓</button>
                  <button type="button" className="se-banks__act" title={`Start ${sid(track)} at this checkpoint`} disabled={i === start.checkpoint} onClick={() => act(setTrackStart(model, track, ref))}>▶</button>
                  <button type="button" className="se-banks__act se-banks__act--danger" title="Delete this checkpoint" onClick={() => {
                    setNote(editor.deleteCheckpoint(ref))
                  }}>✕</button>
                </td>
              </tr>
            )
          })}
          <tr className="se-autoscroll__end">
            <td colSpan={7}>
              End command{' '}
              <select className="se-input" value={seq.end} onChange={(e) => act(setSequenceEnd(model, start.sequence, Number(e.target.value) as 0xfe | 0xff))}>
                <option value={0xff}>$FF · lock the camera at the last checkpoint</option>
                <option value={0xfe}>$FE · return to normal scrolling</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>

      <details className="se-autoscroll__sequences">
        <summary>All sequences ({model.sequences.length})</summary>
        <ul>
          {model.sequences.map((s, i) => {
            const users = tracksInSequence(model, i)
            return (
              <li key={i}>
                <span>Sequence {i}: {s.checkpoints.length} checkpoint{s.checkpoints.length === 1 ? '' : 's'} · {s.checkpoints.length * 3 + 1} bytes · ${hex(s.end)}</span>
                <span className="se-sprprops__dim">{users.length ? ` · ${users.map(sid).join(', ')}` : ' · unused'}</span>
                {users.length > 0 && !users.includes(track) && (
                  <button type="button" className="se-banks__act" onClick={() => setUi({ track: users[0]!, checkpoint: null })}>Show</button>
                )}
                <button type="button" className="se-banks__act" title={`Start ${sid(track)} at this sequence's first checkpoint`} disabled={s.checkpoints.length === 0 || (start.sequence === i && start.checkpoint === 0)} onClick={() => act(setTrackStart(model, track, { sequence: i, checkpoint: 0 }))}>Use for {sid(track)}</button>
                <button type="button" className="se-banks__act se-banks__act--danger" disabled={users.length > 0} title={users.length ? 'A track starts here' : 'Delete this unused sequence'} onClick={() => {
                  const r = removeSequence(model, i)
                  if ('model' in r) act(r.model)
                  else refused(r)
                }}>✕</button>
              </li>
            )
          })}
        </ul>
        <button type="button" className="se-banks__act" disabled={free < 4} onClick={() => act(addSequence(model, { ...(seq.checkpoints[seq.checkpoints.length - 1] ?? { x: 0, y: 0, speed: 8 }) }), 'Needs 4 free bytes.')} title="Append a new one-checkpoint sequence (4 bytes); point a track at it with “Use for”">+ New sequence</button>
      </details>

      <DiscardChangesModal
        open={confirmReset}
        title="Restore autoscroll tables?"
        body="Replace every track and checkpoint with the reference-cart values. This changes the editor draft; Save to persist it."
        confirmLabel="Restore"
        danger
        onDiscard={() => {
          act(resetToReference(model))
          setConfirmReset(false)
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
