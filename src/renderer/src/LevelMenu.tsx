import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { RemovedLevelEntry } from '../../preload/api'
import { formatLevelId, getLevel, useLevelsCatalog } from './data/levels'
import { useDropdown } from './hooks/useDropdown'

export interface LevelMenuProps {
  selectedId: number | null
  onSelect: (id: number) => void
}

/** Records are indexed into the cart `Ptrs` table — a single byte (0x00–0xFF). */
const MAX_RECORD = 0xff

/** Parse a user-typed hex record id, tolerating an optional `0x` prefix and
 *  case. Returns null for anything that isn't a record id in range. */
function parseRecordId(raw: string): number | null {
  const s = raw.trim().replace(/^0x/i, '')
  if (s === '' || !/^[0-9a-f]+$/i.test(s)) return null
  const n = parseInt(s, 16)
  if (Number.isNaN(n) || n < 0 || n > MAX_RECORD) return null
  return n
}

export function LevelMenu({ selectedId, onSelect }: LevelMenuProps): JSX.Element {
  const { open, setOpen, containerRef } = useDropdown()
  const [gotoText, setGotoText] = useState('')
  // null = no error; a string is the message shown under the field (bad id, or a
  // refused removed record).
  const [gotoError, setGotoError] = useState<string | null>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const catalog = useLevelsCatalog()

  // Jump to any data record by id — including rooms not in the catalog or
  // reachable as sub-rooms. loadLevel reports empty/unbacked records, so we
  // don't pre-validate against the catalog here. The one exception is REMOVED
  // levels (see below): the catalog list already hides them, and this field
  // would otherwise be a back door to a level whose data the next build drops.
  const submitGoto = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const id = parseRecordId(gotoText)
    if (id === null) {
      setGotoError('Enter a record id between 0x00 and 0xFF.')
      return
    }
    // Removed levels are flagged for build-time reclaim: their Ptrs row is
    // repointed and their bytes deleted at the next build, so opening one and
    // editing it would be silently discarded. Refuse it here (the field bypasses
    // the catalog filter that hides them from the list below).
    let removed: RemovedLevelEntry[] = []
    try {
      removed = await window.shinyEgg.editor.removedLevels()
    } catch {
      /* lookup failed — fall through and allow the jump rather than block it */
    }
    const hit = removed.find((r) => r.recordId === id)
    if (hit) {
      setGotoError(
        `${formatLevelId(id)}${hit.name ? ` — ${hit.name}` : ''} was removed. ` +
          'Restore it in Level Banks to open it.'
      )
      return
    }
    setGotoError(null)
    setGotoText('')
    onSelect(id)
    setOpen(false)
  }


  // Scroll the currently selected row into view when the menu opens; reset the
  // by-id field when it closes so a stale error/value doesn't linger.
  useEffect(() => {
    if (!open) {
      setGotoText('')
      setGotoError(null)
      return
    }
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  const selected = selectedId !== null ? getLevel(selectedId) : null

  return (
    <div className="se-levelmenu" ref={containerRef}>
      <button
        type="button"
        className={`se-levelmenu__trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="se-levelmenu__slot">
          {selected ? selected.slot : 'LEVEL'}
        </span>
        <span className="se-levelmenu__name">
          {selected ? selected.name : 'Select level…'}
        </span>
        <svg
          className="se-levelmenu__chevron"
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
        <div className="se-levelmenu__pop">
          <div className="se-levelmenu__gotowrap">
            <form className="se-levelmenu__goto" onSubmit={(e) => void submitGoto(e)}>
              <span className="se-levelmenu__gotolabel">Go to room</span>
              <span className="se-levelmenu__gotoprefix">0x</span>
              <input
                className={`se-input se-levelmenu__gotoinput${gotoError ? ' is-error' : ''}`}
                value={gotoText}
                onChange={(e) => {
                  setGotoText(e.target.value)
                  setGotoError(null)
                }}
                placeholder="ID"
                maxLength={4}
                spellCheck={false}
                autoComplete="off"
                title="Open any data record by id (0x00–0xFF), including rooms not listed below"
              />
            </form>
            {gotoError && <div className="se-levelmenu__gotoerror">{gotoError}</div>}
          </div>
          {catalog.groups.map((group) => (
            <div className="se-levelmenu__group" key={group.label}>
              <div className="se-levelmenu__grouphead">{group.label}</div>
              {/* Bonus slots (the GameMode $2A minigame code scenes) are catalogued
                  for the World Map panel but have no level data — hide them here
                  rather than show a permanently disabled row. */}
              {group.levels.filter((l) => l.slot !== 'Bonus').map((l) => {
                // null id (e.g. the Prologue intro slot): catalogued but not an
                // editable level — render disabled, no selectable hex id.
                const lid = l.recordId
                const isActive = lid !== null && lid === selectedId
                return (
                  <button
                    key={`${l.world}:${l.slot}`}
                    type="button"
                    ref={isActive ? selectedRef : undefined}
                    className={`se-levelmenu__row${isActive ? ' is-active' : ''}${
                      lid === null ? ' is-nodata' : ''
                    }`}
                    disabled={lid === null}
                    title={
                      lid === null ? 'No level data — not an editable level' : undefined
                    }
                    onClick={() => {
                      if (lid === null) return
                      onSelect(lid)
                      setOpen(false)
                    }}
                  >
                    <span className="se-levelmenu__rowslot">{l.slot}</span>
                    <span className="se-levelmenu__rowname">{l.name}</span>
                    <span className="se-levelmenu__rowid">
                      {lid === null ? '—' : formatLevelId(lid)}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
