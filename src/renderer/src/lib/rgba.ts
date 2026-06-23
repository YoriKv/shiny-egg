// Small RGBA colour helpers shared by the toolbar's grid-colour picker (a
// native `#rrggbb` swatch + an alpha slider, recombined into one `rgba()`
// string) and the canvas grid renderer (which parses that string back out and
// scales the alpha across its depth tiers — see canvas/draw/grid.ts). The grid
// colour is stored as an `rgba()` string so it carries opacity, which
// `<input type="color">` can't.

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const clamp255 = (n: number): number => clamp(Math.round(n), 0, 255)

/** Parse `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` (the 8-digit form is what the
 *  native colour input emits with the `alpha` attribute). Null on no match. */
function parseHex(s: string): Rgba | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(s.trim())
  if (!m) return null
  const raw = m[1]
  const dbl = (c: string): string => c + c
  let hex: string
  let hasAlpha: boolean
  if (raw.length === 3) (hex = raw.split('').map(dbl).join('')), (hasAlpha = false) // #rgb
  else if (raw.length === 4) (hex = raw.split('').map(dbl).join('')), (hasAlpha = true) // #rgba
  else if (raw.length === 6) (hex = raw), (hasAlpha = false) // #rrggbb
  else if (raw.length === 8) (hex = raw), (hasAlpha = true) // #rrggbbaa
  else return null
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hasAlpha ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  }
}

/** Parse `rgb(r,g,b)` / `rgba(r,g,b,a)` / `#rgb[a]` / `#rrggbb[aa]` into
 *  components. Anything unparseable falls back to opaque black (so a corrupt
 *  setting can't break the render). */
export function parseRgba(s: string): Rgba {
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    s.trim()
  )
  if (fn) {
    return {
      r: clamp255(+fn[1]),
      g: clamp255(+fn[2]),
      b: clamp255(+fn[3]),
      a: fn[4] === undefined ? 1 : clamp(+fn[4], 0, 1)
    }
  }
  return parseHex(s) ?? { r: 0, g: 0, b: 0, a: 1 }
}

/** `#rrggbb` for a native `<input type="color">` (drops alpha — the colour
 *  input can't show it; opacity is a separate slider in the picker popover). */
export function rgbToHex({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  const h = (n: number): string => clamp255(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Canonical `rgba(r, g, b, a)` string (alpha rounded to 2 dp for stable JSON). */
export function formatRgba({ r, g, b, a }: Rgba): string {
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${Math.round(clamp(a, 0, 1) * 100) / 100})`
}

/** Same colour with its alpha multiplied by `scale` (clamped to [0,1]) — the
 *  grid renderer's per-tier alpha derivation. */
export function withAlphaScale(c: Rgba, scale: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp(c.a * scale, 0, 1)})`
}
