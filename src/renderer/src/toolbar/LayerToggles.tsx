import type { JSX, ReactNode } from 'react'
import type { GridMode, LayerVisibility } from '../types'

export interface LayerTogglesProps {
  layers: LayerVisibility
  onToggle: (key: keyof LayerVisibility) => void
}

/**
 * The layer-toggle cluster — a fixed 5-column grid laid out as two functional
 * rows (see App.css `.se-toolbar__layers`):
 *   row 1 — visual layers: Sprites, Foreground (BG1), Background (BG2),
 *           Sky (BG3), Backdrop (COLDATA)
 *   row 2 — editing / overlay toggles: Sprite editing (outlines + ids),
 *           Object editing (outlines + ids), Exits, Collision, Grid
 * Each icon is rendered inline so the BG buttons can draw three stacked
 * rectangles with only the relevant one filled — a quick visual cue for which
 * depth-plane each button toggles. The two "editing" toggles share a dashed
 * blueprint-box motif (object = label tab, sprite = dots inside).
 */

/** Three depth-stacked rectangles. `which` indicates which plane is solid. */
function stackedLayersIcon(which: 'front' | 'mid' | 'back', active: boolean): ReactNode {
  // 16×16 viewBox; three 8×8 rects offset by 2 px each.
  // back: (2,2)-(10,10), mid: (4,4)-(12,12), front: (6,6)-(14,14)
  const fillFor = (plane: 'front' | 'mid' | 'back'): string =>
    active && plane === which ? 'currentColor' : 'none'
  return (
    <>
      <rect x="2" y="2" width="8" height="8" rx="0.5"
        fill={fillFor('back')} stroke="currentColor" strokeWidth="1.25"
        strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="4" width="8" height="8" rx="0.5"
        fill={fillFor('mid')} stroke="currentColor" strokeWidth="1.25"
        strokeLinecap="round" strokeLinejoin="round" />
      <rect x="6" y="6" width="8" height="8" rx="0.5"
        fill={fillFor('front')} stroke="currentColor" strokeWidth="1.25"
        strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}

/** Vertical gradient strip — three horizontal bars stacked with
 *  increasing fill opacity top→bottom. Represents the COLDATA backdrop
 *  fill (the gameplay sky color), distinct from the BG3 tilemap which
 *  uses stackedLayersIcon. */
function gradientFillIcon(active: boolean): ReactNode {
  const fill = active ? 'currentColor' : 'none'
  return (
    <>
      <rect x="2" y="2" width="12" height="4" rx="0.5"
        fill={fill} opacity={active ? 0.35 : 1}
        stroke="currentColor" strokeWidth="1.25"
        strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="6" width="12" height="4" rx="0.5"
        fill={fill} opacity={active ? 0.65 : 1}
        stroke="currentColor" strokeWidth="1.25"
        strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="10" width="12" height="4" rx="0.5"
        fill={fill}
        stroke="currentColor" strokeWidth="1.25"
        strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}

/** Single-path icon helper for the sprites/exits/object-editing buttons. */
function pathIcon(d: string, filled: boolean, active: boolean): ReactNode {
  return (
    <path
      d={d}
      fill={filled && active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

/** Sprite-editing icon — a dashed blueprint box (the "outline") with two sprite
 *  dots inside; the dots fill when active. Pairs with the object-editing icon
 *  (OBJECTS_OUTLINE_PATH), which is a dashed box with a label tab. */
function spriteOutlineIcon(active: boolean): ReactNode {
  const dot = active ? 'currentColor' : 'none'
  return (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="0.5"
        fill="none" stroke="currentColor" strokeWidth="1.25"
        strokeDasharray="2.5 1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.4" cy="7" r="1.6" fill={dot} stroke="currentColor" strokeWidth="1" />
      <circle cx="10" cy="9.6" r="1.3" fill={dot} stroke="currentColor" strokeWidth="1" />
    </>
  )
}

interface LayerItem {
  key: keyof LayerVisibility
  /** Short human name shown in the tooltip. */
  label: string
  /** Technical layer tag (e.g. "BG1") shown after the label in the tooltip. */
  tag?: string
  /** Tooltip override — replaces the default `Show/Hide <label> (<tag>)` text.
   *  Used by the editing toggles, whose label ("Sprite editing") doesn't read
   *  naturally with a bare Show/Hide verb. */
  describe?: (active: boolean) => string
  render: (active: boolean) => ReactNode
}

const SPRITE_PATH =
  'M5 6 m -2 0 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0 ' +
  'M11 7 m -1.5 0 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0 ' +
  'M8 12 m -1.5 0 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0'

const EXIT_PATH = 'M3 4 L3 13 L9 13 L9 4 Z M9 8 L14 8 M12 6 L14 8 L12 10'

// Collision icon — a 16×16 cell with a diagonal slope line + a small "hit"
// dot in the solid corner. Communicates "this layer shows what collides
// with what" without trying to depict any specific collision category.
const COLLISION_PATH = 'M2 2 L14 2 L14 14 L2 14 Z M2 14 L14 4 M11 12 L12 12'

// Grid icon — reflects the 3-state GridMode: an empty box ('off'), a coarse
// 3×3 lattice ('screen'), or a fine 5×5 lattice ('tile'). The button's
// is-active class (mode ≠ 'off') drives brightness; the lattice density is what
// distinguishes the screen grid from the denser tile grid.
function gridIcon(mode: GridMode): ReactNode {
  const box = 'M2 2 L14 2 L14 14 L2 14 Z'
  const coarse = ' M6 2 L6 14 M10 2 L10 14 M2 6 L14 6 M2 10 L14 10'
  const fine =
    ' M4.4 2 L4.4 14 M6.8 2 L6.8 14 M9.2 2 L9.2 14 M11.6 2 L11.6 14' +
    ' M2 4.4 L14 4.4 M2 6.8 L14 6.8 M2 9.2 L14 9.2 M2 11.6 L14 11.6'
  return (
    <path
      d={box + (mode === 'tile' ? fine : mode === 'screen' ? coarse : '')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

// Tooltip for the grid button — names the action a click performs (advancing to
// the NEXT mode), mirroring the `describe(active)` verb the boolean toggles use.
const GRID_NEXT_ACTION: Record<GridMode, string> = {
  off: 'Show screen grid',
  screen: 'Show tile grid',
  tile: 'Hide grid'
}

// Object-editing icon — a dashed-outline rectangle with a small label tab in
// the corner. Communicates "blueprint outlines drawn over the foreground" —
// distinct from the stackedLayersIcon's solid-fill front rectangle that means
// "render the tiles".
const OBJECTS_OUTLINE_PATH =
  'M2 4 L6 4 M8 4 L14 4 ' +     // top edge, dashed
  'M14 4 L14 9 M14 11 L14 14 ' + // right edge, dashed
  'M14 14 L8 14 M6 14 L2 14 ' +  // bottom edge, dashed
  'M2 14 L2 11 M2 9 L2 4 ' +     // left edge, dashed
  'M2 2 L7 2 L7 5 L2 5 Z'        // small label tab top-left

export function LayerToggles({ layers, onToggle }: LayerTogglesProps): JSX.Element {
  // 5-column grid, row-major. Row 1 = visual layers (sprites, BG1, BG2, BG3,
  // backdrop); row 2 = editing / overlay toggles (sprite editing, object
  // editing, exits, collision, grid). The first two editing toggles
  // column-align under the visual layer they pair with (sprites ↑
  // sprite-editing, BG1 ↑ object-editing).
  const cells: LayerItem[] = [
    {
      key: 'sprites',
      label: 'Sprites',
      render: (active) => pathIcon(SPRITE_PATH, true, active)
    },
    {
      key: 'bg1',
      label: 'Foreground',
      tag: 'BG1',
      render: (active) => stackedLayersIcon('front', active)
    },
    {
      key: 'bg2',
      label: 'Background',
      tag: 'BG2',
      render: (active) => stackedLayersIcon('mid', active)
    },
    {
      key: 'bg3',
      label: 'Sky',
      tag: 'BG3',
      render: (active) => stackedLayersIcon('back', active)
    },
    {
      key: 'backdrop',
      label: 'Backdrop',
      tag: 'COLDATA',
      render: (active) => gradientFillIcon(active)
    },
    {
      key: 'spriteOutlines',
      label: 'Sprite editing',
      describe: (a) => `${a ? 'Hide' : 'Show'} sprite outlines`,
      render: (active) => spriteOutlineIcon(active)
    },
    {
      key: 'bg1Outlines',
      label: 'Object editing',
      describe: (a) => `${a ? 'Hide' : 'Show'} object outlines`,
      render: (active) => pathIcon(OBJECTS_OUTLINE_PATH, false, active)
    },
    {
      key: 'exits',
      label: 'Exits',
      render: (active) => pathIcon(EXIT_PATH, false, active)
    },
    {
      key: 'collision',
      label: 'Collision',
      render: (active) => pathIcon(COLLISION_PATH, false, active)
    },
    {
      key: 'grid',
      label: 'Background grid',
      // 3-state cycle (off → screen → tile). Both the tooltip and the icon read
      // layers.grid directly; the loop's boolean `active` only drives the
      // is-active styling (true for both 'screen' and 'tile').
      describe: () => `${GRID_NEXT_ACTION[layers.grid]} (G)`,
      render: () => gridIcon(layers.grid)
    }
  ]

  return (
    <div className="se-toolbar__layers">
      {cells.map((it) => {
        // `active` is the on/off state for the button styling + the boolean
        // icons. Boolean layers map straight through; the 3-state grid counts
        // as "on" in any mode but 'off'.
        const raw = layers[it.key]
        const active = typeof raw === 'boolean' ? raw : raw !== 'off'
        const tip = it.describe
          ? it.describe(active)
          : `${active ? 'Hide' : 'Show'} ${it.label}${it.tag ? ` (${it.tag})` : ''}`
        return (
          <button
            key={it.key}
            type="button"
            className={`se-tool se-tool--layer${active ? ' is-active' : ' is-off'}`}
            onClick={() => onToggle(it.key)}
            title={tip}
          >
            <svg viewBox="0 0 16 16" width="16" height="16">
              {it.render(active)}
            </svg>
          </button>
        )
      })}
    </div>
  )
}
