// Browser-style back/forward navigation history for level views. Each level
// switch / followed exit pushes an entry (both level ids + a camera snapshot);
// back/forward replay the trail with the camera restored.
//
// The stack lives in refs (it's an imperative undo-like structure, and the
// camera is *read at navigate-time* — a side effect that doesn't belong in a
// state reducer). A throwaway counter forces the re-render that refreshes the
// back/forward button-enabled state.

import { useCallback, useRef, useState } from 'react'
import type { View } from '../canvas/view'

export interface NavEntry {
  rootLevelRecordId: number | null
  selectedLevelRecordId: number | null
  /** Camera at the moment we last left this entry (snapshot-on-navigate-away). */
  view: View
}

export interface NavHistory {
  /** Forward navigation: snapshot the current camera into the entry we're
   *  leaving, then push `{root, selected}` as a new entry (truncating any
   *  forward history). A repeat of the current location collapses to a camera
   *  update — no duplicate entry. */
  record: (rootLevelRecordId: number | null, selectedLevelRecordId: number | null) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean
  clear: () => void
}

/** Max entries retained (oldest dropped) to bound memory. */
const MAX_ENTRIES = 100

export interface UseNavHistoryOptions {
  /** Read the live camera (for snapshot-on-navigate-away). Must be stable. */
  readCamera: () => View
  /** Apply a restored entry: set both level ids + the camera. Must be stable. */
  applyEntry: (entry: NavEntry) => void
}

export function useNavHistory({ readCamera, applyEntry }: UseNavHistoryOptions): NavHistory {
  const entries = useRef<NavEntry[]>([])
  const index = useRef(-1)
  const [, bump] = useState(0)
  const sync = useCallback(() => bump((n) => n + 1), [])

  const snapshot = useCallback(() => {
    const i = index.current
    if (i >= 0 && i < entries.current.length) {
      entries.current[i] = { ...entries.current[i], view: readCamera() }
    }
  }, [readCamera])

  const record = useCallback(
    (rootLevelRecordId: number | null, selectedLevelRecordId: number | null) => {
      const list = entries.current
      const i = index.current
      const cur = i >= 0 ? list[i] : null
      if (cur && cur.rootLevelRecordId === rootLevelRecordId && cur.selectedLevelRecordId === selectedLevelRecordId) {
        // Same location — just refresh its camera, don't push a duplicate.
        list[i] = { ...cur, view: readCamera() }
        return
      }
      snapshot()
      const next = list.slice(0, i + 1)
      next.push({ rootLevelRecordId, selectedLevelRecordId, view: readCamera() })
      const overflow = next.length - MAX_ENTRIES
      entries.current = overflow > 0 ? next.slice(overflow) : next
      index.current = entries.current.length - 1
      sync()
    },
    [readCamera, snapshot, sync]
  )

  const back = useCallback(() => {
    if (index.current <= 0) return
    snapshot()
    index.current -= 1
    applyEntry(entries.current[index.current])
    sync()
  }, [applyEntry, snapshot, sync])

  const forward = useCallback(() => {
    if (index.current >= entries.current.length - 1) return
    snapshot()
    index.current += 1
    applyEntry(entries.current[index.current])
    sync()
  }, [applyEntry, snapshot, sync])

  const clear = useCallback(() => {
    entries.current = []
    index.current = -1
    sync()
  }, [sync])

  return {
    record,
    back,
    forward,
    clear,
    canBack: index.current > 0,
    canForward: index.current < entries.current.length - 1
  }
}
