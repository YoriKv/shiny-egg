// Backdrop presets for the Level Header panel — one per BG2/BG3 recipe variant
// (data/bg-setups): picking one sets the layer's tileset + palette and every
// setting the backdrop expects (animation, scroll rate, level mode …) in one
// undo step. Pure, so the preset list and matching are unit-testable.
//
// Sprite-layer BG3 recipes (graphics for BG3 sprites, not a backdrop) and
// optional companions aren't applied — a preset is "make this backdrop work".

import { BG2_SETUPS, BG3_SETUPS, type BgSetup, type BgVariant } from '../data/bg-setups'
import { HEADER_FIELD as F } from '../data/header-schema'

export interface BgPreset {
  /** Stable key for the dropdown. */
  id: string
  layer: 2 | 3
  label: string
  /** Each field the preset sets and the values that already satisfy it (the
   *  first is the one applied). */
  accept: { index: number; values: number[] }[]
  /** The recipe's notes, shown once the preset is applied. */
  notes: string[]
}

const LAYER_FIELDS = {
  2: { tileset: F.bg2Tileset, palette: F.bg2Palette },
  3: { tileset: F.bg3Tileset, palette: F.bg3Palette }
} as const

function preset(layer: 2 | 3, setup: BgSetup, variant: BgVariant, index: number): BgPreset {
  const { tileset, palette } = LAYER_FIELDS[layer]
  const req = { ...setup.req, ...variant.req }
  const accept = [
    { index: tileset, values: setup.tilesets },
    { index: palette, values: variant.palettes },
    ...Object.keys(req)
      .map(Number)
      .filter((field) => !setup.optional?.includes(field) && (req[field]?.length ?? 0) > 0)
      .sort((a, b) => a - b)
      .map((field) => ({ index: field, values: req[field]! }))
  ]
  const label = `${setup.name}${variant.name ? ` — ${variant.name}` : ''}`
  return { id: `bg${layer}:${setup.tilesets[0]}:${index}`, layer, label, accept, notes: setup.notes ?? [] }
}

function presets(layer: 2 | 3, setups: BgSetup[]): BgPreset[] {
  return setups.flatMap((s) =>
    s.variants.filter((v) => !v.sprites).map((v, i) => preset(layer, s, v, i))
  )
}

export const BG_PRESETS: BgPreset[] = [...presets(2, BG2_SETUPS), ...presets(3, BG3_SETUPS)]

/** The header edits applying `p` makes — only the fields not already satisfied
 *  (so re-applying a matched preset is a no-op). */
export function presetEdits(p: BgPreset, header: readonly number[]): { index: number; value: number }[] {
  return p.accept
    .filter((a) => !a.values.includes(header[a.index] ?? -1))
    .map((a) => ({ index: a.index, value: a.values[0]! }))
}

/** Whether the header already follows `p` (tileset, palette and every
 *  companion setting within the recipe). */
export function presetMatches(p: BgPreset, header: readonly number[]): boolean {
  return presetEdits(p, header).length === 0
}
