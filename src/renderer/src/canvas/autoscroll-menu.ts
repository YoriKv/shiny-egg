// Context-menu items for the canvas autoscroll overlay: a right-clicked
// checkpoint node, or empty space beside a shown path (append). Each item runs
// one edit op (lib/autoscroll-edit.ts) and hands the result to `onCommit`.

import type { ContextMenuItem } from '../ContextMenu'
import type { CanvasAutoscroll } from '../Canvas'
import {
  checkpointAfter,
  checkpointFromCenter,
  getCheckpoint,
  insertCheckpoint,
  setCheckpoint,
  setSequenceEnd,
  setTrackStart,
  trackSpriteId,
  type CheckpointRef
} from '../lib/autoscroll-edit'

const sid = (track: number): string => `$${trackSpriteId(track).toString(16).toUpperCase()}`
const NO_ROOM = 'No free bytes in the 376-byte autoscroll stream — remove a checkpoint first.'

export function checkpointMenuItems(
  as: CanvasAutoscroll,
  hit: CheckpointRef & { track: number },
  onOpenWindow: (track: number) => void
): ContextMenuItem[] {
  const model = as.overlay.model
  const c = getCheckpoint(model, hit)
  const seq = model.sequences[hit.sequence]
  if (!c || !seq) return []
  const isLast = hit.checkpoint === seq.checkpoints.length - 1
  const start = model.tracks[hit.track]
  const items: ContextMenuItem[] = [
    {
      label: `Insert checkpoint after #${hit.checkpoint}`,
      onClick: () => as.onCommit(insertCheckpoint(model, hit.sequence, hit.checkpoint + 1, checkpointAfter(model, hit)!), NO_ROOM)
    },
    {
      label: `Insert checkpoint before #${hit.checkpoint}`,
      onClick: () => as.onCommit(insertCheckpoint(model, hit.sequence, hit.checkpoint, { ...c }), NO_ROOM)
    },
    {
      label: `Faster (speed ${c.speed.toString(16).toUpperCase()} → ${Math.min(0x7f, c.speed + 1).toString(16).toUpperCase()})`,
      disabled: c.speed >= 0x7f,
      onClick: () => as.onCommit(setCheckpoint(model, hit, { speed: Math.min(0x7f, c.speed + 1) }))
    },
    {
      label: `Slower (speed ${c.speed.toString(16).toUpperCase()} → ${Math.max(1, c.speed - 1).toString(16).toUpperCase()})`,
      disabled: c.speed <= 1,
      onClick: () => as.onCommit(setCheckpoint(model, hit, { speed: Math.max(1, c.speed - 1) }))
    },
    {
      label: `Start ${sid(hit.track)} here`,
      disabled: !!start && start.sequence === hit.sequence && start.checkpoint === hit.checkpoint,
      onClick: () => as.onCommit(setTrackStart(model, hit.track, hit))
    }
  ]
  if (isLast) {
    const next = seq.end === 0xff ? 0xfe : 0xff
    items.push({
      label: next === 0xfe ? 'End: return to normal scrolling ($FE)' : 'End: lock the camera ($FF)',
      onClick: () => as.onCommit(setSequenceEnd(model, hit.sequence, next))
    })
  }
  items.push(
    {
      label: `Delete checkpoint #${hit.checkpoint}`,
      onClick: () => as.onDeleteCheckpoint(hit)
    },
    { label: 'Open in Autoscroll window…', onClick: () => onOpenWindow(hit.track) }
  )
  return items
}

export function appendMenuItems(as: CanvasAutoscroll, wx: number, wy: number): ContextMenuItem[] {
  const model = as.overlay.model
  const at = checkpointFromCenter(wx, wy)
  return as.overlay.tracks.map((track) => {
    const t = model.tracks[track]!
    const seq = model.sequences[t.sequence]!
    const last = seq.checkpoints[seq.checkpoints.length - 1]
    return {
      label: `Append checkpoint to ${sid(track)} here (X ${at.x.toString(16).toUpperCase()}, Y ${at.y.toString(16).toUpperCase()})`,
      onClick: () =>
        as.onCommit(insertCheckpoint(model, t.sequence, seq.checkpoints.length, { ...at, speed: last?.speed ?? 8 }), NO_ROOM)
    }
  })
}
