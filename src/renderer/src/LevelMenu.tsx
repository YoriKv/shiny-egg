import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
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
  const [gotoError, setGotoError] = useState(false)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const catalog = useLevelsCatalog()

  // Jump to any data record by id — including rooms not in the catalog or
  // reachable as sub-rooms. loadLevel reports empty/unbacked records, so we
  // don't pre-validate against the catalog here.
  const submitGoto = (e: FormEvent): void => {
    e.preventDefault()
    const id = parseRecordId(gotoText)
    if (id === null) {
      setGotoError(true)
      return
    }
    setGotoError(false)
    setGotoText('')
    onSelect(id)
    setOpen(false)
  }


  // Scroll the currently selected row into view when the menu opens; reset the
  // by-id field when it closes so a stale error/value doesn't linger.
  useEffect(() => {
    if (!open) {
      setGotoText('')
      setGotoError(false)
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
          <form className="se-levelmenu__goto" onSubmit={submitGoto}>
            <span className="se-levelmenu__gotolabel">Go to room</span>
            <span className="se-levelmenu__gotoprefix">0x</span>
            <input
              className={`se-levelmenu__gotoinput${gotoError ? ' is-error' : ''}`}
              value={gotoText}
              onChange={(e) => {
                setGotoText(e.target.value)
                setGotoError(false)
              }}
              placeholder="ID"
              maxLength={4}
              spellCheck={false}
              autoComplete="off"
              title="Open any data record by id (0x00–0xFF), including rooms not listed below"
            />
          </form>
          {catalog.groups.map((group) => (
            <div className="se-levelmenu__group" key={group.label}>
              <div className="se-levelmenu__grouphead">{group.label}</div>
              {group.levels.map((l) => {
                // null id = bonus / mini-game / intro: catalogued but not an
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
                      lid === null ? 'Bonus / mini-game — not an editable level' : undefined
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
