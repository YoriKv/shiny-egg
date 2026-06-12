// Object theme-validity: is this object's art family present under a BG1
// tileset? The X-placeholder probe (engine entity-render-validity.ts) catches
// sheets that mark the absence explicitly; this catches the rest — slots that
// hold ANOTHER family's real art (wrong-theme garbage, undetectable by
// content). Backed by the prebaked obj-metadata `bg1Tilesets` field (see its
// doc for the derivation). Pure + JSON-free so the editor hook and the engine
// shipped-cart gate (validity-report.ts) judge identically, like
// lib/sprite-render-validity.
//
// Field semantics (mirrors the sprite side's spritesetFiles conventions):
//   absent ⇒ 'allowed' everywhere (universal family — not gated)
//   null   ⇒ 'unknown' (never shipped + nothing derivable — badge, never hide,
//            never assert ok)
//   []     ⇒ 'locked' everywhere (runtime-streamed scenery whose static tiles
//            are wrong under every tileset — the Baby Bowser room blocks;
//            their shipped 0x6B placements are pinned in validity-report.ts)
//   [...]  ⇒ 'allowed' iff ANY of the level's effective tilesets (header ∪
//            Graphic-Changer band targets) is in the set.

export type ThemeVerdict = 'allowed' | 'locked' | 'unknown'

export function objectThemeVerdict(
  bg1Tilesets: string[] | null | undefined,
  effectiveTilesets: readonly number[]
): ThemeVerdict {
  if (bg1Tilesets === undefined) return 'allowed'
  if (bg1Tilesets === null) return 'unknown'
  return effectiveTilesets.some((ts) => bg1Tilesets.some((t) => parseInt(t, 16) === ts))
    ? 'allowed'
    : 'locked'
}

/** Single-tileset convenience (matrix columns, tests). */
export function objectThemeAllowed(
  bg1Tilesets: string[] | null | undefined,
  bg1Tileset: number
): boolean {
  return objectThemeVerdict(bg1Tilesets, [bg1Tileset]) === 'allowed'
}
