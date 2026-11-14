import { useEffect, useState, type JSX, type MouseEvent } from 'react'
import { HelpDialog } from './HelpDialog'
import { getRecordCount, getLevel, isRemovedRecord, roomLabel, useLevelsCatalog, useRemovedRecords } from './data/levels'
import { getRoomMetadata, saveRoomMetadata, useRoomMetadata } from './data/room-metadata'
import { hex0x } from './lib/hex'

export type RoomContextHandler = (event: MouseEvent, recordId: number) => void

export function RoomsDialog({ onClose, onSelect, onContextMenu }: {
  onClose: () => void
  onSelect: (id: number) => void
  onContextMenu: RoomContextHandler
}): JSX.Element {
  useLevelsCatalog()
  useRoomMetadata()
  useRemovedRecords()
  const [query, setQuery] = useState('')
  const ids = Array.from({ length: getRecordCount() }, (_, id) => id)
    .filter((id) => `${hex0x(id, 2)} ${roomLabel(id)} ${getLevel(id)?.slot ?? ''} ${getLevel(id)?.name ?? ''} ${getRoomMetadata(id)?.notes ?? ''}`
      .toLowerCase().includes(query.trim().toLowerCase()))
  return <HelpDialog open title="All Rooms" onClose={onClose}>
    <input autoFocus className="se-input" type="search" placeholder="Search ID, name, stage or notes…"
      value={query} onChange={(e) => setQuery(e.target.value)} />
    <p className="se-muted">Right-click a room to edit its name and notes.</p>
    <div className="se-rooms-list">
      {ids.map((id) => <div key={id} className="se-rooms-row" onContextMenu={(e) => onContextMenu(e, id)}>
        <button type="button" className="se-btn" disabled={isRemovedRecord(id)}
          onClick={() => { onSelect(id); onClose() }}>
          {roomLabel(id)}{isRemovedRecord(id) ? ' — removed' : ''}
        </button>
      </div>)}
      {ids.length === 0 && <p>No rooms match.</p>}
    </div>
  </HelpDialog>
}

export function RoomMetadataDialog({ recordId, projectId, onClose }: {
  recordId: number
  projectId: string
  onClose: () => void
}): JSX.Element {
  const original = getRoomMetadata(recordId)
  const [name, setName] = useState(original?.name ?? '')
  const [notes, setNotes] = useState(original?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void window.shinyEgg.projects.metadata(projectId).then((metadata) => {
      if (cancelled) return
      const room = metadata.rooms[hex0x(recordId, 2)]
      setName(room?.name ?? '')
      setNotes(room?.notes ?? '')
      setLoading(false)
    }).catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [projectId, recordId])
  const save = async (): Promise<void> => {
    if (saving || loading) return
    setSaving(true)
    setError(null)
    try {
      await saveRoomMetadata(projectId, recordId, { name, notes })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }
  return <HelpDialog open title={`Room ${hex0x(recordId, 2)} — Metadata`}
    onClose={() => { if (!saving) onClose() }} footer={
      <button type="button" className="se-btn is-primary" disabled={saving || loading} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>}>
    <form className="se-room-metadata" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <label>Name<input autoFocus className="se-input" value={name} maxLength={160} disabled={loading || saving}
        onChange={(e) => setName(e.target.value)} placeholder="Use the default room or stage label" /></label>
      <label>Notes<textarea className="se-input" rows={6} maxLength={16000} value={notes} disabled={loading || saving}
        onChange={(e) => setNotes(e.target.value)} /></label>
      <p className="se-muted">Saved with this Shiny Egg project. Clearing the name restores its default label.</p>
      {error && <p role="alert">{error}</p>}
    </form>
  </HelpDialog>
}
