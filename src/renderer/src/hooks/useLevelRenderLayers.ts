import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  Bg1LayerResponse,
  CollisionLayerResponse,
  LayerCellPatch,
  LevelData,
  PaletteEdit,
  SpriteCelBounds,
  SpriteLayerResponse
} from '../../../preload/api'
import { buildBgLayerBitmaps, type BgLayerBitmaps } from '../canvas/draw/bg-layers'
import { celRenderableSpriteNums, formatARenderableSpriteNums } from '../data/obj-metadata'

/** Stable empty override so "no palette edits" keys identically across renders
 *  (a new array would force-full bg1 on every render). */
const NO_PALETTE_EDITS: PaletteEdit[] = []

/**
 * Coalesce a render layer's fetches: returns a stable `trigger` to call from the
 * layer's effect on every relevant change. While a fetch is in flight, the
 * latest trigger is HELD and re-issued on completion — so a rapid palette-colour
 * drag converges to the latest colours WITHOUT backing up a queue of large
 * (≤33 MB) RGBA transfers. Without this, the throttle issues a render per window
 * regardless of whether the previous finished; once a full recolour render is
 * slower than the window they pile up on the main process and the renderer keeps
 * receiving + discarding superseded payloads — the drag jank + the post-release
 * "catch-up". `run` reads the latest inputs from its closure and must bail on a
 * superseded generation / unmount before mutating a canvas.
 */
function useCoalescedTrigger(run: () => Promise<void>): () => void {
  const busy = useRef(false)
  const again = useRef(false)
  const runRef = useRef(run)
  runRef.current = run
  const fireRef = useRef<() => void>(() => {})
  fireRef.current = (): void => {
    if (busy.current) {
      again.current = true
      return
    }
    busy.current = true
    void runRef.current()
      .catch(() => {})
      .finally(() => {
        busy.current = false
        if (again.current) {
          again.current = false
          fireRef.current()
        }
      })
  }
  return useCallback(() => fireRef.current(), [])
}

/** Graphic/Palette-Changer sprite id range — these are the ONLY sprites that
 *  alter BG1 (they swap the tileset/palette for a column/row band; see
 *  engine `bg1-regions.ts` BG1_CHANGER_LO/HI, which this mirrors — cart-fixed).
 *  So bg1 depends on the sprite list only through these; ordinary sprite edits
 *  leave the bg1 layer untouched. */
const BG1_CHANGER_LO = 0x1ba
const BG1_CHANGER_HI = 0x1c9

/**
 * Convert an RGBA render result into an ImageBitmap for fast canvas drawing.
 * Used for full-layer repaints (the whole backing canvas) and the sprite layer.
 */
async function rgbaToBitmap(result: {
  width: number
  height: number
  rgba: ArrayLike<number>
}): Promise<ImageBitmap> {
  const clamped = new Uint8ClampedArray(result.width * result.height * 4)
  clamped.set(result.rgba)
  return createImageBitmap(new ImageData(clamped, result.width, result.height))
}

/** Overwrite each patch cell onto a backing canvas via putImageData (which
 *  replaces pixels incl. alpha, so a cleared cell's all-zero block erases the
 *  old pixels). One reused ImageData; putImageData copies out, so reuse is safe. */
function applyPatch(ctx: CanvasRenderingContext2D, patch: LayerCellPatch): void {
  const { coords, rgba, cellPx } = patch
  const cellBytes = cellPx * cellPx * 4
  const n = coords.length >>> 1
  if (n === 0) return
  const img = new ImageData(cellPx, cellPx)
  for (let i = 0; i < n; i++) {
    img.data.set(rgba.subarray(i * cellBytes, (i + 1) * cellBytes))
    ctx.putImageData(img, coords[i * 2]! * cellPx, coords[i * 2 + 1]! * cellPx)
  }
}

export interface LevelRenderLayers {
  /** Backing canvas the BG1 layer composites into (Tier 2 incremental render):
   *  full responses repaint it, patch responses overwrite changed cells. Null
   *  until the first full render lands (and when the level is empty/special).
   *  Draw it with `ctx.drawImage(bg1Canvas, 0, 0)`. */
  bg1Canvas: HTMLCanvasElement | null
  /** Backing canvas the sprite layer composites into (Tier 2 incremental render,
   *  same model as bg1): full responses repaint it, patch responses overwrite the
   *  changed cells. Null until the first full render lands (and when empty/special).
   *  Draw it with `ctx.drawImage(spriteCanvas, 0, 0)`. */
  spriteCanvas: HTMLCanvasElement | null
  /** Per-num cel bounds → lookup the draw + hit-test paths share (so the click
   *  area always matches the drawn box). Null until the sprite layer resolves. */
  spriteBounds: Map<number, SpriteCelBounds> | null
  bgLayers: BgLayerBitmaps | null
  /** Backing canvas for the collision overlay (Tier 2, same model as bg1). */
  collisionCanvas: HTMLCanvasElement | null
  /** Bumps whenever a backing canvas is repainted/patched — Canvas keys its
   *  redraw on this so a mutated-in-place canvas still triggers a frame. */
  renderVersion: number
}

/**
 * Fetch + composite the per-level render layers (bg1 / sprite / bg2-3 /
 * collision). bg1 + sprite + collision all use a Tier-2 incremental path: main
 * returns a FULL bitmap (first load / level / tileset / changer change) the hook
 * repaints a backing canvas with, or a sparse PATCH of only the changed cells it
 * overwrites onto that canvas — so a common edit ships ~tens of KB instead of a
 * 33.6 MB bitmap. (bg1/collision diff a resolved Map16 grid; the sprite layer
 * diffs a per-cell content-signature grid — see engine `render-sprite-layer.ts`.)
 *
 * Each layer re-fetches ONLY when the `LevelData` slice it actually depends on
 * changes (referential equality — the reducer shares unchanged slices across
 * commits, see `canvas/level-reducer.ts`):
 *   - bg1       ← objects + header (tileset) + changer sprites ($1BA-$1C9)
 *   - sprite    ← sprites + header (tileset)
 *   - bgLayers  ← header only (BG2/BG3/backdrop never touch the object stream)
 *   - collision ← objects + header (overlay pixels are tileset-independent, but
 *                 the decode it reads can shift on a header edit)
 * So an object edit re-renders only bg1 + collision; a sprite edit only the
 * sprite layer (and bg1 iff a changer sprite moved); an exit / spawn edit or a
 * `saved` re-renders nothing. (This relies on the reducer's structural sharing —
 * see the load-bearing invariant note in `canvas/level-reducer.ts`.)
 *
 * Each layer echoes its backing canvas's current `baseToken` back to main so the
 * diff is against exactly what the canvas shows; a cancelled (superseded)
 * response never mutates the canvas or advances the token, so the next request
 * still diffs from the right base (or main falls back to a full render).
 */
export function useLevelRenderLayers(
  level: LevelData | null,
  /** The palette colour-edit DRAFT (usePaletteEditor) — passed to bg1 / sprite /
   *  bgLayers as `paletteOverride` so the canvas previews unsaved palette edits
   *  (the analog of feeding the mutated `level`). A change forces bg1 to re-fetch
   *  FULL: the Map16 grid is unchanged, so the incremental patch would diff to
   *  zero cells and the stale colours would persist. Collision is
   *  palette-independent, so it ignores this. */
  paletteOverride: PaletteEdit[] = NO_PALETTE_EDITS
): LevelRenderLayers {
  // bg1 + collision backing canvases (created lazily, reused across edits).
  const bg1CanvasRef = useRef<HTMLCanvasElement | null>(null)
  const bg1CtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const bg1TokenRef = useRef<string | null>(null)
  // Last paletteOverride the bg1 effect rendered — a change forces a FULL bg1
  // fetch (see the paletteOverride param doc).
  const bg1PaletteOverrideRef = useRef(paletteOverride)
  // Unmount guard + per-layer "structural generation": bumped when a layer's
  // STRUCTURAL inputs change (level / objects / sprites / header / changer), NOT
  // on a palette-only change. A coalesced fetch captures its layer's gen and
  // discards its result if the gen advanced (a newer structural state superseded
  // it — replaces the old per-effect `cancelled` flag, keeping the bg1 patch
  // token's race-safety). A palette-only change keeps the gen, so its render
  // draws (live, one-behind) instead of being thrown away.
  const mountedRef = useRef(true)
  // Reset on (re)mount, not just clear on unmount — StrictMode's dev
  // mount→unmount→mount would otherwise leave it false and every layer would
  // bail at its `!mountedRef.current` guard (blank canvas).
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const bg1GenRef = useRef(0)
  const spriteGenRef = useRef(0)
  const bgLayersGenRef = useRef(0)
  const collisionCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const collisionCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const collisionTokenRef = useRef<string | null>(null)
  // Sprite backing canvas + Tier-2 patch state (mirrors bg1).
  const spriteCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const spriteCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const spriteTokenRef = useRef<string | null>(null)
  // Last paletteOverride the sprite effect rendered — a change forces a FULL
  // sprite fetch (the signature grid is palette-independent, so a patch would
  // diff to zero cells and keep stale colours; same reasoning as bg1).
  const spritePaletteOverrideRef = useRef(paletteOverride)

  const [bg1Canvas, setBg1Canvas] = useState<HTMLCanvasElement | null>(null)
  const [collisionCanvas, setCollisionCanvas] = useState<HTMLCanvasElement | null>(null)
  const [renderVersion, setRenderVersion] = useState(0)
  const bumpVersion = (): void => setRenderVersion((v) => v + 1)

  // Sprite layer: Tier-2 incremental backing canvas (full repaint or cell patch),
  // plus the per-num cel bounds the hit-test/draw paths consult (set from every
  // response — both modes carry bounds, so a newly-placed num gets a hit-box
  // without waiting for a full render).
  const [spriteCanvas, setSpriteCanvas] = useState<HTMLCanvasElement | null>(null)
  const [spriteBounds, setSpriteBounds] = useState<Map<number, SpriteCelBounds> | null>(null)
  const [bgLayers, setBgLayers] = useState<BgLayerBitmaps | null>(null)

  // Latest LevelData fed to the `override` IPC. Held in a ref so each per-layer
  // effect can read the whole level without keying on its identity — it keys on
  // the slice it depends on instead (so unrelated edits don't re-fetch it).
  const levelRef = useRef(level)
  levelRef.current = level

  const renderable = !!level && !level.empty && !level.special
  // Slice keys: referential equality answers "did this layer's input change".
  const objects = renderable ? level!.objects : null
  const sprites = renderable ? level!.sprites : null
  const header = renderable ? level!.header : null
  // Changer-only signature: ordinary sprite edits leave it unchanged (so bg1
  // doesn't re-render); a changer-sprite move/add/delete changes it.
  const changerSig = useMemo(() => {
    if (!sprites) return ''
    let sig = ''
    for (const s of sprites) {
      if (s.num >= BG1_CHANGER_LO && s.num <= BG1_CHANGER_HI) sig += `${s.num},${s.x},${s.y};`
    }
    return sig
  }, [sprites])

  // Bump each layer's generation when ITS structural inputs change (not on a
  // palette-only change) so an in-flight render for the old structure is
  // discarded, while a palette preview render still draws (gen unchanged).
  useEffect(() => { bg1GenRef.current += 1 }, [objects, header, changerSig])
  useEffect(() => { spriteGenRef.current += 1 }, [sprites, header])
  useEffect(() => { bgLayersGenRef.current += 1 }, [header])

  /** Ensure a backing canvas exists (created once, (re)sized to w×h). */
  const ensureCanvas = (
    ref: RefObject<HTMLCanvasElement | null>,
    ctxRef: RefObject<CanvasRenderingContext2D | null>,
    w: number,
    h: number
  ): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    let canvas = ref.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      ref.current = canvas
      ctxRef.current = canvas.getContext('2d')
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    return { canvas, ctx: ctxRef.current! }
  }

  /** Wipe a backing canvas in place (if it exists): opaque black, or transparent
   *  clear. Used to drop the previous level's pixels the instant the record
   *  changes, before the new full render arrives. */
  const blankCanvas = (
    ref: RefObject<HTMLCanvasElement | null>,
    ctxRef: RefObject<CanvasRenderingContext2D | null>,
    mode: 'black' | 'clear'
  ): void => {
    const canvas = ref.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    if (mode === 'black') {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  // On a level-RECORD change, blank the bg1 + sprite backing canvases at once so
  // the previous level's rendered tiles/sprites don't linger under the new
  // level's outlines during the new full render's IPC round-trip (the
  // "disjointed info" flash). bg1 → opaque black: it sits over BG2/BG3/backdrop,
  // so black also hides those (likewise stale until their re-fetch lands).
  // sprite → transparent: it's an overlay drawn ABOVE the object outlines, so a
  // black fill would paint over them. Invalidate the patch tokens too — a patch
  // can't diff across levels, and the wiped canvas no longer matches its old
  // token, so the pending fetch must repaint FULL. Declared before the per-layer
  // fetch effects so the token reset + wipe land before they read the token.
  const prevRecordRef = useRef<number | null>(null)
  useEffect(() => {
    const recordId = level?.recordId ?? null
    if (recordId === prevRecordRef.current) return
    prevRecordRef.current = recordId
    blankCanvas(bg1CanvasRef, bg1CtxRef, 'black')
    bg1TokenRef.current = null
    blankCanvas(spriteCanvasRef, spriteCtxRef, 'clear')
    spriteTokenRef.current = null
    bumpVersion()
  }, [level])

  // bg1 ← objects + header (tileset) + changer sprites. Coalesced + gen-guarded.
  const runBg1 = async (): Promise<void> => {
    const lvl = levelRef.current
    if (!objects || !header || !lvl) {
      setBg1Canvas(null)
      bg1TokenRef.current = null
      return
    }
    void changerSig
    const myGen = bg1GenRef.current
    // A palette-override change must repaint with the new colours, but the Map16
    // grid is unchanged → a token-based patch would diff to zero cells. Drop the
    // base token so main renders a FULL bitmap this time.
    const paletteChanged = bg1PaletteOverrideRef.current !== paletteOverride
    bg1PaletteOverrideRef.current = paletteOverride
    const baseToken = paletteChanged ? undefined : bg1TokenRef.current ?? undefined
    const res: Bg1LayerResponse | null = await window.shinyEgg.render.bg1Layer({
      levelRecordId: lvl.recordId,
      override: lvl,
      baseToken,
      paletteOverride
    })
    if (!mountedRef.current || bg1GenRef.current !== myGen) return
    if (!res) {
      setBg1Canvas(null)
      bg1TokenRef.current = null
      return
    }
    // Build the ImageBitmap BEFORE the final gen/unmount check, so the canvas
    // mutation below is the only step after it.
    let bmp: ImageBitmap | null = null
    if (res.mode === 'full') bmp = await rgbaToBitmap(res.full)
    if (!mountedRef.current || bg1GenRef.current !== myGen) { bmp?.close?.(); return }
    if (res.mode === 'full') {
      const { canvas, ctx } = ensureCanvas(bg1CanvasRef, bg1CtxRef, res.full.width, res.full.height)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bmp!, 0, 0)
      bmp!.close?.()
      bg1TokenRef.current = res.token
      setBg1Canvas(canvas)
    } else {
      const { canvas, ctx } = ensureCanvas(bg1CanvasRef, bg1CtxRef, res.patch.width, res.patch.height)
      applyPatch(ctx, res.patch)
      bg1TokenRef.current = res.token
      setBg1Canvas(canvas)
    }
    bumpVersion()
  }
  const triggerBg1 = useCoalescedTrigger(runBg1)
  useEffect(() => {
    void objects
    void header
    void changerSig
    void paletteOverride
    triggerBg1()
  }, [objects, header, changerSig, paletteOverride, triggerBg1])

  // sprite ← sprites + header (tileset). Tier-2 incremental backing canvas (full
  // repaint or cell patch), mirroring runBg1. Coalesced + gen-guarded.
  const runSprite = async (): Promise<void> => {
    const lvl = levelRef.current
    if (!sprites || !header || !lvl) {
      setSpriteCanvas(null)
      setSpriteBounds(null)
      spriteTokenRef.current = null
      return
    }
    const myGen = spriteGenRef.current
    // A palette change must repaint with the new colours, but the signature grid
    // is unchanged → a token patch would diff to zero cells. Drop the base token
    // so main renders a FULL bitmap this time (same as bg1).
    const paletteChanged = spritePaletteOverrideRef.current !== paletteOverride
    spritePaletteOverrideRef.current = paletteOverride
    const baseToken = paletteChanged ? undefined : spriteTokenRef.current ?? undefined
    const res: SpriteLayerResponse | null = await window.shinyEgg.render.spriteLayer({
      levelRecordId: lvl.recordId,
      override: lvl,
      baseToken,
      paletteOverride,
      celRenderableNums: celRenderableSpriteNums(),
      formatANums: formatARenderableSpriteNums()
    })
    if (!mountedRef.current || spriteGenRef.current !== myGen) return
    if (!res) {
      setSpriteCanvas(null)
      setSpriteBounds(null)
      spriteTokenRef.current = null
      return
    }
    // Build the ImageBitmap (full path) BEFORE the final gen/unmount check, so the
    // canvas mutation below is the only step after it.
    let bmp: ImageBitmap | null = null
    if (res.mode === 'full') bmp = await rgbaToBitmap(res.full)
    if (!mountedRef.current || spriteGenRef.current !== myGen) { bmp?.close?.(); return }
    if (res.mode === 'full') {
      const { canvas, ctx } = ensureCanvas(spriteCanvasRef, spriteCtxRef, res.full.width, res.full.height)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bmp!, 0, 0)
      bmp!.close?.()
      spriteTokenRef.current = res.token
      setSpriteCanvas(canvas)
    } else {
      const { canvas, ctx } = ensureCanvas(spriteCanvasRef, spriteCtxRef, res.patch.width, res.patch.height)
      applyPatch(ctx, res.patch)
      spriteTokenRef.current = res.token
      setSpriteCanvas(canvas)
    }
    const m = new Map<number, SpriteCelBounds>()
    for (const b of res.bounds) m.set(b.num, b)
    setSpriteBounds(m)
    bumpVersion()
  }
  const triggerSprite = useCoalescedTrigger(runSprite)
  useEffect(() => {
    void sprites
    void header
    void paletteOverride
    triggerSprite()
  }, [sprites, header, paletteOverride, triggerSprite])

  // bgLayers ← header only (BG2/BG3/backdrop are header-driven tilemaps).
  // Coalesced + gen-guarded (see useCoalescedTrigger).
  const runBgLayers = async (): Promise<void> => {
    const lvl = levelRef.current
    if (!header || !lvl) { setBgLayers(null); return }
    const myGen = bgLayersGenRef.current
    const result = await window.shinyEgg.render.bgLayers({
      levelRecordId: lvl.recordId,
      override: lvl,
      paletteOverride
    })
    if (!mountedRef.current || bgLayersGenRef.current !== myGen) return
    if (!result) { setBgLayers(null); return }
    const bitmaps = await buildBgLayerBitmaps(result)
    if (!mountedRef.current || bgLayersGenRef.current !== myGen) return
    setBgLayers(bitmaps)
  }
  const triggerBgLayers = useCoalescedTrigger(runBgLayers)
  useEffect(() => {
    void header
    void paletteOverride
    triggerBgLayers()
  }, [header, paletteOverride, triggerBgLayers])

  // Release the previous bgLayers' ImageBitmaps when it's replaced (level /
  // header / palette change) or on unmount. `createImageBitmap` holds GPU/native
  // memory that is only reclaimed on `.close()` or eventual GC (which lags,
  // being blind to GPU pressure), so without this each level load accumulates a
  // few bitmaps' worth. Safe to close here: the bitmaps are only consumed by
  // Canvas's passive draw effect, and React runs this cleanup (with the OLD
  // value) before that effect re-runs with the new bitmaps. The pattern cache
  // (canvas/draw/bg-layers.ts) is a WeakMap keyed by bitmap, so its entries are
  // collected with the bitmaps — patterns need no explicit release.
  useEffect(() => {
    const current = bgLayers
    return () => {
      current?.bg2?.close?.()
      current?.bg3?.close?.()
      if (current?.backdrop.kind === 'gradient') current.backdrop.bitmap?.close?.()
    }
  }, [bgLayers])

  // collision ← objects + header. Collision PIXELS are tileset-independent, but
  // the DECODE (the Map16 grid the overlay reads) can shift on a header edit, so
  // we re-fetch on header too (mirrors bg1; without it a header-only edit left
  // the overlay stale). The patch gate is recordId-only, so the grid diff
  // captures any header-driven decode change correctly.
  useEffect(() => {
    const lvl = levelRef.current
    if (!objects || !header || !lvl) {
      setCollisionCanvas(null)
      collisionTokenRef.current = null
      return
    }
    let cancelled = false
    void window.shinyEgg.render
      .collisionLayer({ levelRecordId: lvl.recordId, override: lvl, baseToken: collisionTokenRef.current ?? undefined })
      .then(async (res: CollisionLayerResponse | null) => {
        if (cancelled) return
        if (!res) {
          setCollisionCanvas(null)
          collisionTokenRef.current = null
          return
        }
        let bmp: ImageBitmap | null = null
        if (res.mode === 'full') bmp = await rgbaToBitmap(res.full)
        if (cancelled) { bmp?.close?.(); return }
        if (res.mode === 'full') {
          const { canvas, ctx } = ensureCanvas(collisionCanvasRef, collisionCtxRef, res.full.width, res.full.height)
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(bmp!, 0, 0)
          bmp!.close?.()
          collisionTokenRef.current = res.token
          setCollisionCanvas(canvas)
        } else {
          const { canvas, ctx } = ensureCanvas(collisionCanvasRef, collisionCtxRef, res.patch.width, res.patch.height)
          applyPatch(ctx, res.patch)
          collisionTokenRef.current = res.token
          setCollisionCanvas(canvas)
        }
        bumpVersion()
      })
      .catch(() => { /* keep the existing canvas; next edit re-syncs */ })
    return () => { cancelled = true }
  }, [objects, header])

  return {
    bg1Canvas,
    spriteCanvas,
    spriteBounds,
    bgLayers,
    collisionCanvas,
    renderVersion
  }
}
