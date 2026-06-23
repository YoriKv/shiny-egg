// Object animation-tileset validity: do this object's *animated* tiles render
// under a level's animation tileset (`header[10]`)? The render-validity probe
// (engine entity-render-validity.ts) checks VRAM COVERAGE — every stamped
// sub-tile maps to non-zero VRAM — but the header[10]-selected animated BG1
// region ($1000-$13FF) is filled by WHATEVER animation `header[10]` selects, so
// any animation reads as "covered". The probe therefore can't tell a level
// loading the WATER animation from one loading LAVA: an animated-water object
// ($35) placed in a lava-animation level (e.g. 1-4 / record 0x03, whose
// `header[10]` 0x07 drives the castle-lava animation for its $47) probes `ok`
// yet renders the lava frames. This field gates that blind spot, exactly as
// `bg1Tilesets` gates the static BG1 family — see lib/theme-validity.ts. Pure +
// JSON-free so the editor hook and the engine shipped-cart gate
// (validity-report.ts) judge identically.
//
// Field semantics (obj-metadata `animTilesets`, hex `header[10]` strings):
//   absent / null ⇒ not gated (the object's tiles don't come from the animated
//                   region — almost every object)
//   [...]         ⇒ valid iff the level's `header[10]` is in the set, else
//                   'locked' (the animation that draws this object's tiles
//                   isn't the one loaded).
// Unlike the theme gate there is no 'unknown' verdict: `header[10]` is always a
// concrete known value, so membership is decisive.

export type AnimVerdict = 'allowed' | 'locked'

export function objectAnimVerdict(
  animTilesets: string[] | null | undefined,
  animationTileset: number
): AnimVerdict {
  if (animTilesets == null) return 'allowed'
  return animTilesets.some((t) => parseInt(t, 16) === animationTileset) ? 'allowed' : 'locked'
}
