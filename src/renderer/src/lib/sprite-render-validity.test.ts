// Pins for the sprite-side render-validity check (resolveSpriteValidity) —
// the metadata-field → verdict mapping the picker filter and the engine's
// shipped-cart gate (validity-report.ts) both rely on.

import { describe, expect, it } from 'vitest'
import { resolveSpriteValidity } from './sprite-render-validity'

const files = new Set([0x28, 0x3b, 0x4d, 0x52, 0x60, 0x71])

describe('resolveSpriteValidity', () => {
  it('field absent ⇒ not-gated (special sprites ≥ 0x1BA, separate gfx path)', () => {
    expect(resolveSpriteValidity(undefined, files)).toEqual({
      verdict: 'not-gated',
      missingFiles: []
    })
  })

  it('null ⇒ unknown (never appears in a shipped level), NOT ok', () => {
    expect(resolveSpriteValidity(null, files)).toEqual({
      verdict: 'unknown',
      missingFiles: []
    })
  })

  it('[] ⇒ ok under any spriteset (global sheet / dynamic-only / no visual)', () => {
    expect(resolveSpriteValidity([], new Set())).toEqual({
      verdict: 'ok',
      missingFiles: []
    })
  })

  it('subset of the level files ⇒ ok', () => {
    expect(resolveSpriteValidity(['0x28', '0x60'], files)).toEqual({
      verdict: 'ok',
      missingFiles: []
    })
  })

  it('missing file ⇒ missing-gfx listing exactly the absent ids', () => {
    expect(resolveSpriteValidity(['0x28', '0x99', '0x9A'], files)).toEqual({
      verdict: 'missing-gfx',
      missingFiles: [0x99, 0x9a]
    })
  })

  it('hex-string ids parse case-insensitively', () => {
    expect(resolveSpriteValidity(['0x3B', '0x3b'], files).verdict).toBe('ok')
  })
})
