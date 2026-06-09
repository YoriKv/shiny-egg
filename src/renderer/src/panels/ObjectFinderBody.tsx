import { useEffect, useRef, useState, type JSX } from 'react'
import type { FindInstanceKind, ObjectInstance } from '../../../preload/api'
import { hex0x } from '../lib/hex'

// Debug navigator: type an object/sprite id, jump through every level instance
// of it with Prev/Next. Backed by the base-cart instance index spliced with the
// active project's SAVED overlay edits — so it reflects on-disk edits but not
// unsaved in-canvas ones. See main/ipc/debug.ts.

const KINDS: { key: FindInstanceKind; label: string; hint: string }[] = [
  { key: 'std', label: 'Std obj', hint: 'standard-object id (0x00–0xFF)' },
  { key: 'ext', label: 'Ext obj', hint: 'extended-object id (0x00–0xFF)' },
  { key: 'sprite', label: 'Sprite', hint: 'sprite id (0x000–0x1FF)' }
]


export interface ObjectFinderBodyProps {
  /** Navigate to the instance's level + focus its cell (routed through the
   *  unsaved-changes guard), then select the matching entity (kind+id) so its
   *  properties show. */
  onJump: (inst: ObjectInstance, select: { kind: FindInstanceKind; id: number }) => void
  /** Currently-loaded level — used to mark the active instance "· here". */
  currentLevelRecordId: number | null
}

export function ObjectFinderBody({ onJump, currentLevelRecordId }: ObjectFinderBodyProps): JSX.Element {
  const [kindIdx, setKindIdx] = useState(0)
  const [idText, setIdText] = useState('')
  const [instances, setInstances] = useState<ObjectInstance[]>([])
  // -1 = results loaded but nothing jumped to yet; else the jumped index.
  const [index, setIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const kind = KINDS[kindIdx]
  // Focus the id box when the panel opens (it mounts on open).
  const idRef = useRef<HTMLInputElement>(null)
  useEffect(() => idRef.current?.focus(), [])

  // Fetch matches on (kind, id) change, debounced. Reset the cursor each time.
  useEffect(() => {
    const s = idText.trim().replace(/^0x/i, '')
    if (s === '' || !/^[0-9a-f]+$/i.test(s)) {
      setInstances([])
      setIndex(-1)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(() => {
      window.shinyEgg.debug
        .findInstances(kind.key, s)
        .then((r) => {
          if (cancelled) return
          setInstances(r)
          setIndex(-1)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setInstances([])
          setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [kind.key, idText])

  const n = instances.length
  const has = n > 0
  const jumpTo = (target: number): void => {
    if (!has) return
    const i = ((target % n) + n) % n
    setIndex(i)
    // Same parsed id the fetch used — instances only exist when it's valid hex.
    const id = parseInt(idText.trim().replace(/^0x/i, ''), 16)
    onJump(instances[i], { kind: kind.key, id })
  }
  const cur = index >= 0 ? instances[index] : null

  return (
    <div className="se-finder">
      <div className="se-finder__row">
        <button
          type="button"
          className="se-finder__cycle"
          onClick={() => setKindIdx((k) => (k + 1) % KINDS.length)}
          title="Cycle search type (Std / Ext object / Sprite)"
        >
          {kind.label}
        </button>
        <span className="se-finder__prefix">0x</span>
        <input
          ref={idRef}
          className="se-finder__input"
          value={idText}
          onChange={(e) => setIdText(e.target.value)}
          placeholder="ID"
          maxLength={4}
          spellCheck={false}
          autoComplete="off"
          title={kind.hint}
        />
      </div>

      <div className="se-finder__row se-finder__nav">
        <button
          type="button"
          className="se-finder__btn"
          onClick={() => jumpTo(index < 0 ? n - 1 : index - 1)}
          disabled={!has}
          title="Previous instance"
        >
          ‹ Prev
        </button>
        <span className="se-finder__count">
          {loading ? '…' : !has ? '0 found' : index < 0 ? `${n} found` : `${index + 1} / ${n}`}
        </span>
        <button
          type="button"
          className="se-finder__btn"
          onClick={() => jumpTo(index < 0 ? 0 : index + 1)}
          disabled={!has}
          title="Next instance"
        >
          Next ›
        </button>
      </div>

      <div className="se-finder__current">
        {cur ? (
          <>
            → level {hex0x(cur.levelRecordId)} @ ({cur.x}, {cur.y}) · @{cur.offset.toString(16).toUpperCase()}
            {currentLevelRecordId === cur.levelRecordId && <span className="se-finder__here"> · here</span>}
          </>
        ) : has ? (
          'Prev / Next to jump'
        ) : idText.trim() ? (
          'no instances found'
        ) : (
          'type an id to search'
        )}
      </div>
    </div>
  )
}
