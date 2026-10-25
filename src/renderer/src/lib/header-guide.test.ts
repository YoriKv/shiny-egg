// Pins the Level Header panel's guide wording + option list (lib/header-guide):
// usage grouped by root level, collapsed past four groups; curated options get
// counts / "unused"; values only shipped levels use appear as "unnamed".

import { describe, expect, it } from 'vitest'
import { guideOptions, summarizeUsage, usageName, type UsageLabel } from './header-guide'

const label = (id: number): UsageLabel => ({ short: `L${id}`, long: `Level ${id}`, order: id })

describe('summarizeUsage', () => {
  it('says so when no level uses the value', () => {
    expect(summarizeUsage([], [], label)).toEqual({
      count: 0,
      text: 'No shipped level uses this value.',
      full: ''
    })
  })

  it('groups sub-rooms under their root and counts rooms', () => {
    // 10 and 11 are rooms of root 1; 2 is a root; 30 has no root (orphan).
    const rootOf: (number | null)[] = []
    rootOf[1] = 1
    rootOf[2] = 2
    rootOf[10] = 1
    rootOf[11] = 1
    rootOf[30] = null
    const s = summarizeUsage([2, 10, 11, 30], rootOf, label)
    expect(s.count).toBe(4)
    expect(s.text).toBe('Used in 4 rooms: L1 ×2, L2, L30')
    expect(s.full).toBe('Level 1 — 2 rooms\nLevel 2\nLevel 30')
  })

  it('collapses past four groups', () => {
    const s = summarizeUsage([5, 4, 3, 2, 1, 6], [], label)
    expect(s.text).toBe('Used in 6 rooms: L1, L2, L3, L4 +2 more')
  })

  it('uses the singular for one room', () => {
    expect(summarizeUsage([7], [], label).text).toBe('Used in 1 room: L7')
  })
})

describe('usageName', () => {
  it('names by the most common key, capped with +N', () => {
    const key = (id: number): string | undefined => ({ 1: 'Grass', 2: 'Grass', 3: 'Cave', 4: 'Snow', 5: undefined })[id]
    expect(usageName([3, 1, 2, 4, 5], key, 2)).toBe('Grass, Cave +1')
    expect(usageName([5], key, 2)).toBeUndefined()
  })
})

describe('guideOptions', () => {
  const options = [
    { value: 0, label: 'Zero', detail: 'd' },
    { value: 2, label: 'Two' }
  ]

  it('returns the list unchanged without usage', () => {
    expect(guideOptions(options, undefined)).toEqual(options)
  })

  it('names empty labels from usage, else "unnamed"; unused unnamed values say so', () => {
    const blank = [
      { value: 0, label: '' },
      { value: 1, label: '' },
      { value: 2, label: '' }
    ]
    const name = (v: number): string | undefined => (v === 0 ? '1-1, 1-2' : undefined)
    expect(guideOptions(blank, [[5, 6], [7], []], name)).toEqual([
      { value: 0, label: '1-1, 1-2 (2)' },
      { value: 1, label: 'unnamed (1)' },
      { value: 2, label: 'unused' }
    ])
  })

  it('adds counts, marks unused, and offers used-but-unnamed values', () => {
    const used = [[1, 2], [], [], [9]]
    expect(guideOptions(options, used)).toEqual([
      { value: 0, label: 'Zero (2)', detail: 'd' },
      { value: 2, label: 'Two — unused' },
      { value: 3, label: 'unnamed (1)' }
    ])
  })
})
