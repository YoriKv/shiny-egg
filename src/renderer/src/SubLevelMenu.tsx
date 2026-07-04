import { useEffect, useRef, useState, type JSX } from 'react'
import { formatLevelId, levelLabel, useRemovedRecords } from './data/levels'
import { useDropdown } from './hooks/useDropdown'
import { HelpDialog } from './HelpDialog'
import { ROOM_LIST_HELP, RoomListHelpPref } from './app-help'

export interface SubLevelMenuProps {
  /** The root level RECORD id (the LevelMenu pick) — anchors the BFS. */
  rootLevelRecordId: number | null
  /** Currently-viewed level record (may be the root or a discovered sub-room). */
  currentLevelRecordId: number | null
  /** BFS-discovered level RECORD ids reachable from root via warp exits. Root
   *  included as element 0; populated incrementally as discovery proceeds. */
  subLevels: number[]
  /** True while BFS is still in flight. */
  loading: boolean
  onSelect: (id: number) => void
  /** Hide the "Room List — Help" entry at the bottom of the dropdown. App owns
   *  the preference (persisted); the checkbox inside the help dialog — mirrored
   *  in the Level Editor Help, which is how it comes back — drives it. */
  helpHidden: boolean
  onHelpHiddenChange: (hidden: boolean) => void
}

/**
 * Secondary toolbar menu showing where in the current translevel's room graph
 * the user is. Mirrors `LevelMenu`'s visual idiom but narrower. When the root
 * has no sub-rooms (single-room translevel), renders as a static info chip
 * instead of a dropdown.
 */
export function SubLevelMenu({
  rootLevelRecordId,
  currentLevelRecordId,
  subLevels,
  loading,
  onSelect,
  helpHidden,
  onHelpHiddenChange
}: SubLevelMenuProps): JSX.Element | null {
  const { open, setOpen, containerRef } = useDropdown()
  const activeRef = useRef<HTMLButtonElement>(null)
  // A discovered sub-room can have been individually removed (its parent kept);
  // disable it here so it's clearly not openable. The central nav guard refuses
  // it regardless — this is the visible cue. See hooks/useLevelNavigation.
  const removed = useRemovedRecords()
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  if (rootLevelRecordId === null) return null

  // Rendered in the chip AND dropdown branches so an open dialog survives
  // discovery collapsing the menu to the single-room chip.
  const helpDialog = (
    <HelpDialog
      open={helpOpen}
      title="Room List — Help"
      footer={<RoomListHelpPref hidden={helpHidden} onChange={onHelpHiddenChange} />}
      onClose={() => setHelpOpen(false)}
    >
      {ROOM_LIST_HELP}
    </HelpDialog>
  )

  const triggerLabel = describe(currentLevelRecordId, rootLevelRecordId)
  const hasSubRooms = subLevels.length > 1
  const indicator = loading
    ? '…discovering'
    : hasSubRooms
      ? `${subLevels.length} rooms`
      : 'single room'
  // Render as a static chip only when we KNOW there are no sub-rooms — i.e.
  // discovery has finished and only the root is present. While loading, keep
  // the dropdown form so the user can peek at partial results.
  const renderAsChip = !loading && !hasSubRooms

  if (renderAsChip) {
    // Static chip — no dropdown to open.
    return (
      <div className="se-sublevelmenu" ref={containerRef}>
        <div className="se-sublevelmenu__trigger is-static" title="No sub-rooms in this translevel.">
          <span className="se-sublevelmenu__tag">Room</span>
          <span className="se-sublevelmenu__name">{triggerLabel}</span>
          <span className="se-sublevelmenu__count">{indicator}</span>
        </div>
        {helpDialog}
      </div>
    )
  }

  return (
    <div className="se-sublevelmenu" ref={containerRef}>
      <button
        type="button"
        className={`se-sublevelmenu__trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Sub-rooms reachable from translevel root ${formatLevelId(rootLevelRecordId)}`}
      >
        <span className="se-sublevelmenu__tag">Room</span>
        <span className="se-sublevelmenu__name">{triggerLabel}</span>
        <span className="se-sublevelmenu__count">{indicator}</span>
        <svg
          className="se-sublevelmenu__chevron"
          viewBox="0 0 10 6"
          width="10"
          height="6"
        >
          <path
            d="M1 1 L5 5 L9 1"
            stroke="currentColor"
            strokeWidth="1.25"
            fill="none"
          />
        </svg>
      </button>

      {open && (
        <div className="se-sublevelmenu__pop">
          {subLevels.map((id, i) => {
            const isActive = id === currentLevelRecordId
            const isRoot = id === rootLevelRecordId
            const isRemoved = removed.has(id)
            const display = isRemoved ? 'removed' : levelLabel(id, 'dash')
            return (
              <button
                key={id}
                type="button"
                ref={isActive ? activeRef : undefined}
                className={`se-sublevelmenu__row${isActive ? ' is-active' : ''}${
                  isRemoved ? ' is-removed' : ''
                }`}
                disabled={isRemoved}
                title={isRemoved ? 'Removed — restore it in Level Banks to open it' : undefined}
                onClick={() => {
                  onSelect(id)
                  setOpen(false)
                }}
              >
                <span className="se-sublevelmenu__rowtag">
                  {isRoot ? 'ENTRY' : `#${i}`}
                </span>
                <span className="se-sublevelmenu__rowname">{display}</span>
                <span className="se-sublevelmenu__rowid">{formatLevelId(id)}</span>
              </button>
            )
          })}
          {!helpHidden && (
            <>
              <div className="se-sublevelmenu__divider" />
              <button
                type="button"
                className="se-sublevelmenu__row se-sublevelmenu__row--help"
                onClick={() => {
                  setHelpOpen(true)
                  setOpen(false)
                }}
              >
                <span className="se-sublevelmenu__rowtag">?</span>
                <span className="se-sublevelmenu__rowname">Room List &mdash; Help</span>
              </button>
            </>
          )}
        </div>
      )}
      {helpDialog}
    </div>
  )
}

function describe(currentId: number | null, rootId: number): string {
  if (currentId === null) return formatLevelId(rootId)
  return levelLabel(currentId, 'hex')
}
