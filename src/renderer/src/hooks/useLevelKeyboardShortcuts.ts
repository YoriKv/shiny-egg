// Level-edit keyboard shortcuts (the editor canvas must have focus, not a text
// field): undo/redo, Escape, +/- paint-order reorder (single + group), Ctrl+C/X/V
// clipboard, Delete, Ctrl+D duplicate (single + group), and arrow nudge / resize /
// exit-move. Extracted verbatim from App so the 1400-line component does not own
// ~280 lines of key dispatch. levelState is read through a ref so the listener
// only re-binds on selection / undo-redo / propTable changes, not on every edit.

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { LevelObject, LevelSprite } from '../../../preload/api'
import type { LevelAction, LevelState } from '../canvas/level-reducer'
import type { PlacementItem, Selection } from '../types'
import { MAX_LEVEL_SPRITES } from '../canvas/limits'
import { objectSizeMode } from '../data/object-record'
import { LEVEL_SCREENS_H, LEVEL_SCREENS_W, screenCol, screenRow } from '../canvas/geometry'

export interface LevelKeyboardShortcutsParams {
  levelState: LevelState
  dispatchLevel: Dispatch<LevelAction>
  selection: Selection[]
  primarySelection: Selection | null
  setSelection: (sel: Selection[]) => void
  setPlacement: Dispatch<SetStateAction<PlacementItem | null>>
  /** Drop out of the Place tool back to Select (so the toolbar de-highlights). */
  cancelPlacement: () => void
  globalUndo: () => void
  globalRedo: () => void
  propTable: Uint8Array | null
  clipboardRef: RefObject<{ objects: LevelObject[]; sprites: LevelSprite[] } | null>
}

export function useLevelKeyboardShortcuts(p: LevelKeyboardShortcutsParams): void {
  const {
    levelState, dispatchLevel, selection, primarySelection, setSelection, setPlacement, cancelPlacement, globalUndo, globalRedo, propTable, clipboardRef
  } = p
  // Read the current level WITHOUT re-binding the listener on every edit
  // (levelState changes each commit). Handlers read levelStateRef.current; the
  // dep array below omits levelState so only selection/undo-redo/propTable
  // changes re-create the listener.
  const levelStateRef = useRef(levelState)
  levelStateRef.current = levelState
  useEffect(() => {
    // Deep-copy the selected objects/sprites into the clipboard (raw bytes too,
    // so a later edit/delete can't mutate what was copied).
    const copyEntities = (objUids: number[], sprUids: number[]): void => {
      const lvl = levelStateRef.current.level
      if (!lvl) return
      const objects = objUids
        .map((uid) => lvl.objects.find((o) => o.uid === uid))
        .filter((o): o is LevelObject => !!o)
        .map((o) => ({ ...o, raw: o.raw ? o.raw.slice() : o.raw }))
      const sprites = sprUids
        .map((uid) => lvl.sprites.find((s) => s.uid === uid))
        .filter((s): s is LevelSprite => !!s)
        .map((s) => ({ ...s }))
      clipboardRef.current = { objects, sprites }
    }
    // After an `addEntities` dispatch, select the new group. The reducer assigns
    // uids from the current `nextUid`, objects-first — predict that run (same
    // technique as single duplicate) so the selection swaps to the new copies.
    const reselectAfterAdd = (objCount: number, sprCount: number): void => {
      const base = levelStateRef.current.nextUid
      const sel: Selection[] = []
      for (let i = 0; i < objCount; i++) sel.push({ kind: 'object', uid: base + i })
      for (let i = 0; i < sprCount; i++) sel.push({ kind: 'sprite', uid: base + objCount + i })
      setSelection(sel)
    }
    // Shared by Duplicate (entities offset from the live selection) and Paste
    // (from the clipboard): clone, offset one cell, trim sprites to the cap so
    // the predicted reselect matches what the reducer actually adds.
    const addCloned = (srcObjs: LevelObject[], srcSprs: LevelSprite[]): void => {
      const lvl = levelStateRef.current.level
      if (!lvl) return
      const objects = srcObjs.map((o) => ({
        ...o,
        raw: o.raw ? o.raw.slice() : o.raw,
        x: o.x + 1,
        y: o.y + 1
      }))
      const room = Math.max(0, MAX_LEVEL_SPRITES - lvl.sprites.length)
      const sprites = srcSprs.map((s) => ({ ...s, x: s.x + 1, y: s.y + 1 })).slice(0, room)
      if (objects.length === 0 && sprites.length === 0) return
      dispatchLevel({ type: 'addEntities', objects, sprites })
      reselectAfterAdd(objects.length, sprites.length)
    }

    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      // Text fields keep the browser's own undo while you're editing them, so
      // global undo/redo must NOT fire there. A <select> isn't a text field — it
      // has no native undo and its onChange commits immediately — so undo/redo
      // must reach it while focused (the message-pointer dropdowns); previously
      // the form-field guard swallowed it until the select lost focus.
      const inTextField =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const mod = e.ctrlKey || e.metaKey
      if (mod && !inTextField && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) globalRedo()
        else globalUndo()
        return
      }
      if (mod && !inTextField && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        globalRedo()
        return
      }
      // Every other shortcut (Delete, arrows, copy/paste, Escape, +/- reorder)
      // stays out of ANY form field — text fields and selects alike, whose own
      // arrow / type-ahead keys must navigate options, not nudge entities.
      if (inTextField || t?.tagName === 'SELECT') return
      if (e.key === 'Escape') {
        setSelection([])
        setPlacement(null)
        cancelPlacement()
        return
      }

      // +/- reorder the single selected object (paint order) or sprite (overlap
      // order); exits have no order. Accept the unshifted variants too ('=' for
      // '+', '_' for '-'). Modifier combos belong to other shortcuts.
      if (!mod && (primarySelection?.kind === 'object' || primarySelection?.kind === 'sprite')) {
        const fwd = e.key === '+' || e.key === '='
        const back = e.key === '-' || e.key === '_'
        if (fwd || back) {
          e.preventDefault()
          const delta = fwd ? 1 : -1
          dispatchLevel(
            primarySelection.kind === 'object'
              ? { type: 'reorderObject', uid: primarySelection.uid, delta }
              : { type: 'reorderSprite', uid: primarySelection.uid, delta }
          )
          return
        }
      }

      // Partition the selection into the editable kinds (flatMap narrows so
      // `s.uid` is only read where it exists).
      const objUids = selection.flatMap((s) => (s.kind === 'object' ? [s.uid] : []))
      const sprUids = selection.flatMap((s) => (s.kind === 'sprite' ? [s.uid] : []))
      const exitUids = selection.flatMap((s) => (s.kind === 'exit' ? [s.uid] : []))
      const hasEntities = objUids.length > 0 || sprUids.length > 0

      // +/- reorder a multi-selection as a group (objects in paint order, sprites
      // in overlap order — each shifts past its nearest unselected neighbour).
      // The single-entity +/- case is handled above.
      if (!mod && selection.length > 1 && hasEntities) {
        const fwd = e.key === '+' || e.key === '='
        const back = e.key === '-' || e.key === '_'
        if (fwd || back) {
          e.preventDefault()
          dispatchLevel({
            type: 'reorderEntities',
            objectUids: objUids,
            spriteUids: sprUids,
            delta: fwd ? 1 : -1
          })
          return
        }
      }

      // Clipboard — objects + sprites only (exits/incoming/spawn aren't copyable).
      if (mod && (e.key === 'c' || e.key === 'C')) {
        if (hasEntities) {
          e.preventDefault()
          copyEntities(objUids, sprUids)
        }
        return
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        if (hasEntities) {
          e.preventDefault()
          copyEntities(objUids, sprUids)
          dispatchLevel({ type: 'deleteEntities', objectUids: objUids, spriteUids: sprUids })
          setSelection([])
        }
        return
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        const clip = clipboardRef.current
        if (clip && (clip.objects.length > 0 || clip.sprites.length > 0)) {
          e.preventDefault()
          addCloned(clip.objects, clip.sprites)
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (hasEntities) {
          e.preventDefault()
          dispatchLevel({ type: 'deleteEntities', objectUids: objUids, spriteUids: sprUids })
          setSelection([])
          return
        }
        if (exitUids.length === 1) {
          e.preventDefault()
          dispatchLevel({ type: 'deleteExit', uid: exitUids[0]! })
          setSelection([])
          return
        }
      }

      if (mod && (e.key === 'd' || e.key === 'D')) {
        // Multi-select → one batched addEntities (appended; selection swaps to the
        // copies). A single entity keeps the existing duplicate actions (which
        // insert the clone right after its source) so keyboard Ctrl+D matches the
        // context-menu Duplicate's paint order exactly.
        if (selection.length > 1 && hasEntities) {
          e.preventDefault()
          const lvl = levelStateRef.current.level
          if (lvl) {
            const objs = objUids
              .map((uid) => lvl.objects.find((o) => o.uid === uid))
              .filter((o): o is LevelObject => !!o)
            const sprs = sprUids
              .map((uid) => lvl.sprites.find((s) => s.uid === uid))
              .filter((s): s is LevelSprite => !!s)
            addCloned(objs, sprs)
          }
          return
        }
        if (primarySelection?.kind === 'object' || primarySelection?.kind === 'sprite') {
          e.preventDefault()
          const newUid = levelStateRef.current.nextUid
          if (primarySelection.kind === 'object') {
            dispatchLevel({ type: 'duplicateObject', uid: primarySelection.uid })
          } else {
            dispatchLevel({ type: 'duplicateSprite', uid: primarySelection.uid })
          }
          setSelection([{ kind: primarySelection.kind, uid: newUid }])
          return
        }
        if (primarySelection?.kind === 'exit') {
          e.preventDefault()
          const newUid = levelStateRef.current.nextUid
          dispatchLevel({ type: 'duplicateExit', uid: primarySelection.uid })
          setSelection([{ kind: 'exit', uid: newUid }])
          return
        }
      }

      // Arrows on a multi-select → nudge the whole group by one cell (one batched
      // commit), mirroring the multi drag-to-move. Single nudges fall through
      // below. (Shift is no longer a one-screen step — it's the single-object
      // resize modifier now; it has no effect on a multi-select.)
      if (selection.length > 1 && hasEntities && e.key.startsWith('Arrow')) {
        const step = 1
        let dx = 0
        let dy = 0
        if (e.key === 'ArrowLeft') dx = -step
        else if (e.key === 'ArrowRight') dx = step
        else if (e.key === 'ArrowUp') dy = -step
        else if (e.key === 'ArrowDown') dy = step
        if (dx !== 0 || dy !== 0) {
          e.preventDefault()
          dispatchLevel({ type: 'moveEntities', objectUids: objUids, spriteUids: sprUids, dx, dy })
        }
        return
      }
      // Arrows — single object/sprite. Plain arrow nudges by one cell;
      // Shift+Arrow RESIZES a single OBJECT (←/→ = width, ↑/↓ = height; →/↓ grow,
      // ←/↑ shrink), gated by the object's encodable axes (`sizeMode`) so it never
      // edits a dimension the object doesn't carry. The resize routes through the
      // same `setObjectFields` clamp + idempotent no-op as the drag handles.
      if (
        (primarySelection?.kind === 'object' || primarySelection?.kind === 'sprite') &&
        e.key.startsWith('Arrow')
      ) {
        if (e.shiftKey && primarySelection.kind === 'object') {
          e.preventDefault()
          const o = levelStateRef.current.level?.objects.find((ob) => ob.uid === primarySelection.uid)
          if (o) {
            const sm = objectSizeMode(o.num, o.exnum, propTable)
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (sm === 'w' || sm === 'wh')) {
              const dw = e.key === 'ArrowRight' ? 1 : -1
              dispatchLevel({ type: 'setObjectFields', uid: o.uid!, patch: { w: o.w + dw } })
            } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (sm === 'h' || sm === 'wh')) {
              const dh = e.key === 'ArrowDown' ? 1 : -1
              dispatchLevel({ type: 'setObjectFields', uid: o.uid!, patch: { h: o.h + dh } })
            }
          }
          return
        }
        let dx = 0
        let dy = 0
        if (e.key === 'ArrowLeft') dx = -1
        else if (e.key === 'ArrowRight') dx = 1
        else if (e.key === 'ArrowUp') dy = -1
        else if (e.key === 'ArrowDown') dy = 1
        if (dx !== 0 || dy !== 0) {
          e.preventDefault()
          if (primarySelection.kind === 'object') {
            dispatchLevel({ type: 'moveObject', uid: primarySelection.uid, dx, dy })
          } else {
            dispatchLevel({ type: 'moveSprite', uid: primarySelection.uid, dx, dy })
          }
        }
      }
      if (primarySelection?.kind === 'exit' && e.key.startsWith('Arrow')) {
        // Exits are per-screen, so an arrow moves the selected exit to the
        // adjacent screen (one screen per press; Shift doesn't apply). The
        // reducer rejects the move if that screen is already occupied.
        const exit = levelStateRef.current.level?.exits.find((x) => x.uid === primarySelection.uid)
        if (exit) {
          let col = screenCol(exit.screenIndex)
          let row = screenRow(exit.screenIndex)
          if (e.key === 'ArrowLeft') col -= 1
          else if (e.key === 'ArrowRight') col += 1
          else if (e.key === 'ArrowUp') row -= 1
          else if (e.key === 'ArrowDown') row += 1
          if (col >= 0 && col < LEVEL_SCREENS_W && row >= 0 && row < LEVEL_SCREENS_H) {
            e.preventDefault()
            dispatchLevel({
              type: 'setExitFields',
              uid: primarySelection.uid,
              patch: { screenIndex: (row << 4) | col }
            })
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, primarySelection, globalUndo, globalRedo, propTable])
}
