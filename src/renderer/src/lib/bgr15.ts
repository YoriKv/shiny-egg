// BGR-15 ↔ "#RRGGBB" conversion for the palette editor. The SNES stores colours
// as 15-bit BGR words; the swatch grid + the native colour picker speak CSS hex.
// (The main-process render path has its own copy, cssFromBgr15 — the two trees
// can't share a module, but both use the same 5→8-bit full-range expand.)

/** BGR-15 word → "#RRGGBB" (full-range 5→8-bit expand, matching the swatches). */
export function bgr15ToHex(c15: number): string {
  const exp = (v: number): number => ((v << 3) | (v >>> 2)) & 0xff
  const r = exp(c15 & 0x1f)
  const g = exp((c15 >>> 5) & 0x1f)
  const b = exp((c15 >>> 10) & 0x1f)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

/** "#RRGGBB" → BGR-15 word (8→5-bit truncate per channel). */
export function hexToBgr15(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r5 = ((n >>> 16) & 0xff) >>> 3
  const g5 = ((n >>> 8) & 0xff) >>> 3
  const b5 = (n & 0xff) >>> 3
  return (b5 << 10) | (g5 << 5) | r5
}
