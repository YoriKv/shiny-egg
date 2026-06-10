// Declarative property schema for the Properties panel.
//
// Research (research/notes-entity-properties.md) found the editable surface is
// thin and uniform: every entity is `type + cell-position + optional typed
// payload`. So instead of hand-coding three panels, each entity type declares a
// list of `PropertyField` descriptors and the panel renders them generically.
//
// Descriptors edit SEMANTIC fields on LevelObject / LevelSprite / ScreenExit —
// never raw bytes — so serialize-level.ts keeps owning every encoding gotcha
// (nibble-interleaved x/y, (v-1)&0xFF size fold, atomic num16 recompose, exit
// variant = byte1 range). Adding a property later = append one descriptor.
//
// Today every field is a clamped number (`kind: 'num'`); the `FieldKind` union
// is the seam where future widgets land (enum dropdown for entranceType once
// the spawn-state labels are known, a searchable id picker in the Add-picker
// step, a flag toggle for the ~8-family sprite parity variant).

import type {
  LevelObject,
  LevelSprite,
  ScreenExit,
  ScreenExitMinibattle,
  ScreenExitWarp
} from '../../../preload/api'
import type { SizeMode } from './object-record'

/** A numeric field, clamped to [min, max]; `hex` = display/parse base 16
 *  (ids); `disabled` greys it out (e.g. a size axis the object doesn't encode). */
export interface NumFieldKind {
  kind: 'num'
  min: number
  max: number
  hex?: boolean
  disabled?: boolean
}

/** A dropdown of named values. An out-of-list value stays selectable (shown as
 *  `0xNN`) instead of being forced onto a listed option — important for data the
 *  editor doesn't have a label for. EnumField always offers this raw fallback. */
export interface EnumFieldKind {
  kind: 'enum'
  options: { value: number; label: string }[]
  disabled?: boolean
}

/** Widget seam — extend with 'levelRef' / 'picker' / 'flag' as they're built.
 *  (A catalog `LevelPicker`/`LevelRefField` widget already exists for the World
 *  Map panel; re-add a `'levelRef'` kind here if a property ever needs it again.) */
export type FieldKind = NumFieldKind | EnumFieldKind

/** Player entrance state on arrival (the warp record's 5th byte; the loader
 *  stores it straight into Player_CurrentStateLo — CODE_set_player_entrance_from_exit
 *  set_player_entrance_from_exit). Real cart exits use 0x00-0x0A; labels from the
 *  GoldenEgg reference, cross-checked against the per-exit value histogram. (Level
 *  0x7D's stream is mis-aligned upstream and yields junk values > 0x0A — those
 *  render as raw `0xNN`.) Engine-side reference: snes-framework/docs/leveldataengine.md §2
 *  (screen-exit list) + levelloader.md §3. */
export const ENTRANCE_TYPES: { value: number; label: string }[] = [
  { value: 0x00, label: 'Does nothing' },
  { value: 0x01, label: 'Skis in' },
  { value: 0x02, label: 'Out of pipe → right' },
  { value: 0x03, label: 'Out of pipe → left' },
  { value: 0x04, label: 'Out of pipe → down' },
  { value: 0x05, label: 'Out of pipe → up' },
  { value: 0x06, label: 'Walks in → right' },
  { value: 0x07, label: 'Walks in → left' },
  { value: 0x08, label: 'Walks in → down' },
  { value: 0x09, label: 'Jumps in (high)' },
  { value: 0x0a, label: 'Flung to the moon' }
]

export interface PropertyField<E> {
  /** Stable key (React key + debug). */
  key: string
  label: string
  field: FieldKind
  /** Read the current value off the entity. */
  get: (e: E) => number
  /** Produce a semantic-field patch from an edited value. */
  patch: (v: number) => Partial<E>
  /** Hide the field unless this holds (e.g. minibattle-only fields). */
  showIf?: (e: E) => boolean
  /** Hover tooltip explaining the field. */
  hint?: string
}

// Level grid is 256 cells wide × 128 tall (geometry.ts); sprite/object Y is
// 7-bit. Ids are shown in hex per the editor's 0x convention.

export function objectFields(_o: LevelObject, sizeMode: SizeMode): PropertyField<LevelObject>[] {
  const hasW = sizeMode === 'w' || sizeMode === 'wh'
  const hasH = sizeMode === 'h' || sizeMode === 'wh'
  return [
    {
      key: 'num',
      label: 'Object ID',
      field: { kind: 'num', min: 0, max: 0xff, hex: true, disabled: true },
      get: (o) => o.num,
      patch: (v) => ({ num: v }),
      showIf: (o) => o.num !== 0,
      hint: 'Standard object id (0x01-0xF6) — read-only. Change the object type via the Add picker.'
    },
    {
      key: 'exnum',
      label: 'Ext ID',
      field: { kind: 'num', min: 0, max: 0xff, hex: true, disabled: true },
      get: (o) => o.exnum ?? 0,
      patch: (v) => ({ exnum: v }),
      showIf: (o) => o.num === 0,
      hint: 'Extended-object subtype (0x00-0xFF) — read-only. Change the object type via the Add picker.'
    },
    {
      key: 'x',
      label: 'X',
      field: { kind: 'num', min: 0, max: 255 },
      get: (o) => o.x,
      patch: (v) => ({ x: v }),
      hint: 'Horizontal position in 16-px cells (0-255).'
    },
    {
      key: 'y',
      label: 'Y',
      field: { kind: 'num', min: 0, max: 127 },
      get: (o) => o.y,
      patch: (v) => ({ y: v }),
      hint: 'Vertical position in 16-px cells (0-127).'
    },
    {
      key: 'w',
      label: 'W',
      field: { kind: 'num', min: -128, max: 255, disabled: !hasW },
      get: (o) => o.w,
      patch: (v) => ({ w: v }),
      hint: hasW
        ? 'Width in cells (negative folds the box back from the anchor).'
        : "This object type doesn't encode a width."
    },
    {
      key: 'h',
      label: 'H',
      field: { kind: 'num', min: -128, max: 255, disabled: !hasH },
      get: (o) => o.h,
      patch: (v) => ({ h: v }),
      hint: hasH
        ? 'Height in cells (negative folds the box back from the anchor).'
        : "This object type doesn't encode a height."
    }
  ]
}

export function spriteFields(_s: LevelSprite): PropertyField<LevelSprite>[] {
  return [
    {
      key: 'num',
      label: 'Sprite ID',
      field: { kind: 'num', min: 0, max: 0x1ff, hex: true },
      get: (s) => s.num,
      patch: (v) => ({ num: v }),
      hint: 'Sprite id (9-bit, 0x000-0x1FF). Determines which sprite spawns.'
    },
    {
      key: 'x',
      label: 'X',
      field: { kind: 'num', min: 0, max: 255 },
      get: (s) => s.x,
      patch: (v) => ({ x: v }),
      hint: 'Horizontal position in 16-px cells (0-255).'
    },
    {
      key: 'y',
      label: 'Y',
      field: { kind: 'num', min: 0, max: 127 },
      get: (s) => s.y,
      patch: (v) => ({ y: v }),
      hint: 'Vertical position in 16-px cells (0-127).'
    }
  ]
}

const warp = (e: ScreenExit): ScreenExitWarp => e as ScreenExitWarp
const mini = (e: ScreenExit): ScreenExitMinibattle => e as ScreenExitMinibattle
const isWarp = (e: ScreenExit): boolean => e.variant === 'warp'
const isMini = (e: ScreenExit): boolean => e.variant === 'minibattle'

export function exitFields(_e: ScreenExit): PropertyField<ScreenExit>[] {
  return [
    {
      key: 'screenIndex',
      label: 'Screen',
      field: { kind: 'num', min: 0, max: 0x7f, hex: true, disabled: true },
      get: (e) => e.screenIndex,
      patch: (v) => ({ screenIndex: v }) as Partial<ScreenExit>,
      hint: 'Screen this exit sits on (0x00-0x7F; col = low nibble, row = high) — read-only. Drag the exit marker on the canvas to move it between screens.'
    },
    // warp payload
    {
      key: 'destLevelRecordId',
      label: 'Dest level',
      field: { kind: 'num', min: 0, max: 0xff, hex: true },
      get: (e) => warp(e).destLevelRecordId,
      patch: (v) => ({ destLevelRecordId: v }) as Partial<ScreenExit>,
      showIf: isWarp,
      hint: 'Destination level-data record id (0x00-0xFF) the warp leads to.'
    },
    {
      key: 'destX',
      label: 'Dest X',
      field: { kind: 'num', min: 0, max: 255 },
      get: (e) => warp(e).destX,
      patch: (v) => ({ destX: v }) as Partial<ScreenExit>,
      showIf: isWarp,
      hint: 'X cell in the destination level where the player arrives.'
    },
    {
      key: 'destY',
      label: 'Dest Y',
      field: { kind: 'num', min: 0, max: 255 },
      get: (e) => warp(e).destY,
      patch: (v) => ({ destY: v }) as Partial<ScreenExit>,
      showIf: isWarp,
      hint: 'Y cell in the destination level where the player arrives.'
    },
    {
      key: 'entranceType',
      label: 'Entrance',
      field: { kind: 'enum', options: ENTRANCE_TYPES },
      get: (e) => warp(e).entranceType,
      patch: (v) => ({ entranceType: v }) as Partial<ScreenExit>,
      showIf: isWarp,
      hint: 'How the player arrives — the entry animation/spawn state.'
    },
    // minibattle payload
    {
      key: 'minibattleId',
      label: 'Minibattle',
      field: { kind: 'num', min: 0xde, max: 0xe9, hex: true },
      get: (e) => mini(e).minibattleId,
      patch: (v) => ({ minibattleId: v }) as Partial<ScreenExit>,
      showIf: isMini,
      hint: 'Minibattle id (0xDE-0xE9).'
    },
    {
      key: 'returnX',
      label: 'Return X',
      field: { kind: 'num', min: 0, max: 255 },
      get: (e) => mini(e).returnX,
      patch: (v) => ({ returnX: v }) as Partial<ScreenExit>,
      showIf: isMini,
      hint: 'X cell where the player returns after the minibattle.'
    },
    {
      key: 'returnY',
      label: 'Return Y',
      field: { kind: 'num', min: 0, max: 255 },
      get: (e) => mini(e).returnY,
      patch: (v) => ({ returnY: v }) as Partial<ScreenExit>,
      showIf: isMini,
      hint: 'Y cell where the player returns after the minibattle.'
    },
    {
      key: 'returnLevelRecordId',
      label: 'Return level',
      field: { kind: 'num', min: 0, max: 0xff, hex: true },
      get: (e) => mini(e).returnLevelRecordId,
      patch: (v) => ({ returnLevelRecordId: v }) as Partial<ScreenExit>,
      showIf: isMini,
      hint: 'Level the player returns to after the minibattle.'
    }
  ]
}
