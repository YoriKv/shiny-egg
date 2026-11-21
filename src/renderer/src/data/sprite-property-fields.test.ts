import { describe, expect, it } from 'vitest'
import {
  SPRITE_PROPERTY_FIELDS,
  SPRITE_PROPERTY_TABLE_INFO,
  SPRITE_TERRAIN_PRESETS,
  fieldsForTable,
  getFieldValue,
  setFieldValue
} from './sprite-property-fields'

const field = (id: string) => SPRITE_PROPERTY_FIELDS.find((f) => f.id === id)!

describe('sprite property fields', () => {
  it('fields within a table never overlap and stay within 16 bits', () => {
    for (const t of SPRITE_PROPERTY_TABLE_INFO) {
      let used = 0
      for (const f of fieldsForTable(t.key)) {
        const m = ((1 << f.bits) - 1) << f.shift
        expect(used & m, `${t.key}.${f.id} overlaps`).toBe(0)
        expect(m & ~0xffff).toBe(0)
        used |= m
      }
    }
  })
  it('enum options fit their width', () => {
    for (const f of SPRITE_PROPERTY_FIELDS.filter((x) => x.kind === 'enum')) {
      expect(f.options!.length).toBeLessThanOrEqual(1 << f.bits)
    }
  })
  it('offers all terrain presets and changes only the low five bits', () => {
    const terrain = field('terrainSet')
    expect(terrain.kind).toBe('enum')
    expect(terrain.options?.map(({ value }) => value)).toEqual(Array.from({ length: 32 }, (_, i) => i))
    for (const { value } of terrain.options!) {
      const word = setFieldValue(0xffff, terrain, value)
      expect(getFieldValue(word, terrain)).toBe(value)
      expect(word & 0xffe0).toBe(0xffe0)
    }
    expect(SPRITE_TERRAIN_PRESETS[0].points).toEqual([])
    expect(SPRITE_TERRAIN_PRESETS[1].points).toEqual([[8, 5], [2, 5], [13, 5], [8, 1], [8, 16]])
    expect(SPRITE_TERRAIN_PRESETS[17].points).toEqual([[8, -6]])
  })
  it('decodes the LavaLog collision word ($0040 = not tongueable, shape 0)', () => {
    expect(getFieldValue(0x0040, field('notTongue'))).toBe(1)
    expect(getFieldValue(0x0040, field('hitbox'))).toBe(0)
    expect(getFieldValue(0x687a, field('stomp'))).toBe(5)
    expect(getFieldValue(0x687a, field('side'))).toBe(1)
  })
  it('round-trips signed gravity bytes', () => {
    const w = setFieldValue(0, field('target'), -8)
    expect(w).toBe(0xf800)
    expect(getFieldValue(w, field('target'))).toBe(-8)
    expect(setFieldValue(w, field('accel'), 0x40)).toBe(0xf840)
  })
  it('only touches the field bits and clamps', () => {
    expect(setFieldValue(0xffff, field('hitbox'), 0)).toBe(0xffe0)
    expect(setFieldValue(0, field('oamCount'), 99)).toBe(31 << 11)
  })
})
