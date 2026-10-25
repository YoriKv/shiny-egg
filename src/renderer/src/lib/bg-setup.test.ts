// Pins the backdrop presets (lib/bg-setup over data/bg-setups): one preset per
// backdrop variant (sprite-layer recipes excluded), applying only unmet fields,
// optional companions never applied, and matching against a header.

import { describe, expect, it } from 'vitest'
import { HEADER_FIELD as F } from '../data/header-schema'
import { BG_PRESETS, presetEdits, presetMatches } from './bg-setup'

const header = (set: Partial<Record<number, number>>): number[] =>
  Array.from({ length: 15 }, (_, i) => set[i] ?? 0)

const find = (layer: 2 | 3, label: string) => BG_PRESETS.find((p) => p.layer === layer && p.label === label)!

describe('BG_PRESETS', () => {
  it('has one preset per named variant, and none for sprite-layer recipes', () => {
    expect(find(3, 'Water — Blue')).toBeDefined()
    expect(find(3, 'Snowstorm — Incoming')).toBeDefined()
    expect(BG_PRESETS.some((p) => p.label.includes('sprite layer'))).toBe(false)
  })

  it('applies tileset, palette and companions (Spotlight)', () => {
    const p = find(3, 'Spotlight')
    expect(presetEdits(p, header({ [F.bgColor]: 0x18 }))).toEqual([
      { index: F.bg3Tileset, value: 0x1c },
      { index: F.bg3Palette, value: 0x01 },
      { index: F.bgColor, value: 0x00 },
      { index: F.levelMode, value: 0x0e },
      { index: F.scrollRate, value: 0x0d }
    ])
  })

  it('leaves satisfied fields alone and matches a header that follows it', () => {
    const p = find(3, 'Snowstorm — Incoming')
    const h = header({ [F.bg3Tileset]: 0x19, [F.bg3Palette]: 0x14, [F.levelMode]: 0x08, [F.animTileset]: 0x09, [F.animPalette]: 0x0b, [F.scrollRate]: 0x03 })
    expect(presetMatches(p, h)).toBe(true)
    const moved = h.slice()
    moved[F.levelMode] = 0x0f
    expect(presetEdits(p, moved)).toEqual([{ index: F.levelMode, value: 0x08 }])
  })

  it('never applies an optional companion (BG2 Cave crystals animation palette)', () => {
    const p = find(2, 'Cave crystals')
    expect(presetEdits(p, header({})).map((e) => e.index)).toEqual([F.bg2Tileset, F.bg2Palette])
  })
})
