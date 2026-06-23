// Sprite-side render-validity: would a sprite's tiles be present in OBJ VRAM
// under a level's spriteset (header field 7)? Pure set-inclusion over the
// prebaked obj-metadata `spritesetFiles` field — the trace-derived gfx files
// the sprite needs among the level's 6 variable spriteset files (see the
// field's doc in data/obj-metadata.ts for derivation + precision). Kept pure
// and DOM-free so the editor hook (useEntityRenderValidity) and the engine's
// shipped-cart gate (snes-framework/scripts/engine/validity-report.ts) judge
// identically — the same sharing pattern as lib/sprite-neighbor-deps.
//
// Direction caveat (accepted): static-fallback metadata values are
// an over-approximation, so the check can be slightly too strict for those
// sprites — never too loose.

export type SpriteRenderVerdict =
  /** Required files all present (or the sprite needs no variable file —
   *  global-sheet / dynamic-only / no visual). */
  | 'ok'
  /** ≥1 required file absent from the level's spriteset — renders garbage
   *  tiles in-game. `missingFiles` lists the absent ids. */
  | 'missing-gfx'
  /** Metadata `spritesetFiles: null` — the sprite never appears in a shipped
   *  level, nothing could be derived. Shown badged, never hidden. */
  | 'unknown'
  /** No `spritesetFiles` field — special sprites ≥ 0x1BA (changers/ambient)
   *  load gfx through a separate path and aren't spriteset-gated. */
  | 'not-gated'

export interface SpriteValidity {
  verdict: SpriteRenderVerdict
  /** `missing-gfx` only: numeric gfx file ids absent from the level's
   *  spriteset (else empty). */
  missingFiles: number[]
}

/**
 * Resolve one sprite's render-validity against the level's 6 variable
 * spriteset file ids. `spritesetFiles` is the metadata field verbatim (hex
 * strings / null / absent); `levelFiles` is the numeric id set from
 * `DATA_spriteset_files[header[7]*6..]` (the `render:entityRenderValidity`
 * result's `spritesetFiles`, parsed).
 */
export function resolveSpriteValidity(
  spritesetFiles: string[] | null | undefined,
  levelFiles: ReadonlySet<number>
): SpriteValidity {
  if (spritesetFiles === undefined) return { verdict: 'not-gated', missingFiles: [] }
  if (spritesetFiles === null) return { verdict: 'unknown', missingFiles: [] }
  const missingFiles = spritesetFiles
    .map((s) => parseInt(s, 16))
    .filter((f) => !levelFiles.has(f))
  return missingFiles.length > 0
    ? { verdict: 'missing-gfx', missingFiles }
    : { verdict: 'ok', missingFiles: [] }
}
