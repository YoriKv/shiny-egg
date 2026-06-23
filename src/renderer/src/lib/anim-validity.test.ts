// Pins for the object animation-tileset validity check (objectAnimVerdict) —
// the animTilesets-field → verdict mapping the picker filter and the engine's
// shipped-cart gate share. The bug it fixes: animated-tile objects pass the
// VRAM-coverage probe under ANY animation tileset (the animated region is
// always filled), so animated water $35 / icy water $DC showed as "in level
// tileset" for 1-4 (record 0x03, header[10] 0x07 = castle lava) yet render the
// lava frames. See lib/anim-validity.ts.

import { describe, expect, it } from 'vitest'
import { objectAnimVerdict } from './anim-validity'
import { getStandardObject } from '../data/obj-metadata'

describe('objectAnimVerdict', () => {
  it('field absent ⇒ allowed everywhere (not animated-region gated)', () => {
    expect(objectAnimVerdict(undefined, 0x07)).toBe('allowed')
  })

  it('null ⇒ allowed (header[10] always known — no unknown verdict)', () => {
    expect(objectAnimVerdict(null, 0x07)).toBe('allowed')
  })

  it('allowed iff the level header[10] is in the set', () => {
    expect(objectAnimVerdict(['0xC', '0xE', '0x11'], 0x0c)).toBe('allowed') // $35 in a water level
    expect(objectAnimVerdict(['0xC', '0xE', '0x11'], 0x07)).toBe('locked') // $35 in a lava level (1-4)
    expect(objectAnimVerdict(['0x8'], 0x08)).toBe('allowed') // $DC in its ice level (5-3)
    expect(objectAnimVerdict(['0x8'], 0x07)).toBe('locked') // $DC in a lava level (1-4)
  })

  it('hex-string ids parse case-insensitively, two-digit included', () => {
    expect(objectAnimVerdict(['0xa'], 0x0a)).toBe('allowed')
    expect(objectAnimVerdict(['0x11'], 0x11)).toBe('allowed')
  })

  it('the gated objects carry their animTilesets in the metadata', () => {
    // $35 animated water + $DC icy water are the reported cases; $47 castle
    // lava is the same family and renders correctly under 1-4's 0x07.
    expect(objectAnimVerdict(getStandardObject(0x35).animTilesets, 0x07)).toBe('locked')
    expect(objectAnimVerdict(getStandardObject(0xdc).animTilesets, 0x07)).toBe('locked')
    expect(objectAnimVerdict(getStandardObject(0x47).animTilesets, 0x07)).toBe('allowed')
  })
})
