// Custom-code render offramp — the LAST-RESORT render tier.
//
// **Prefer the data-driven tiers first.** Almost every sprite should render via, in order of
// preference: the cel tables (Format-A/B), `DYNAMIC_BODY_SOURCES` (a chunky bank-$54 body, incl.
// `mirror`/`scale`/`placeholderTiles`/`bodyOnly`), `SYNTHESIZED_CELS` (hand-authored cels for
// handler-drawn sprites), and `PARITY_CEL_VARIANTS` (per-parity cels). Reach for this module
// ONLY when a sprite's appearance genuinely can't be expressed by those — i.e. it needs
// arbitrary runtime composition the data shapes don't model.
//
// A sprite registered in CUSTOM_SPRITE_RENDERERS runs arbitrary TS to compose its own image:
// decode any bank-$54-$56 body region(s), blit them at computed positions with flips/rotation,
// branch on the placement cell (parity), etc. It returns a finished RGBA image + anchor-relative
// origin, which the layer/picker blit exactly like a resolved cel.
//
// First (and so far only) legitimate user: the pinball flippers. Each draws TWO bodies ~48px
// apart, EACH rotated by a flip angle, the 2nd mirrored, and $144 picks its orientation from
// sprite-X parity (a re-derived layout, not a flip). That's a multi-body + rotation + parity
// composite — no single data-table entry can express it, so it earns a custom renderer.
import type { SymbolMap } from './symbol-map.ts';
import { DYNAMIC_GFX_ANCHOR_SYMBOL } from './sprite-dynamic-gfx.ts';
import { rotozoomDecode } from './rotozoom.ts';
import { resolveSpriteCel } from './sprite-tile-base.ts';
import { renderSpriteCel } from './sprite-cel.ts';
import { SETTLED_PALETTE_ROW, REST_FRAME, FORMAT_A_NUMS } from './sprite-render-facts.ts';
import { decode4bppTile, decode2bppTile } from './tile.ts';
import { buildPaletteRow } from './color.ts';
import { loadMap16Tables, decodeMap16, type Map16SubTile } from './map16.ts';
import { loadSceneRegs, bgLayerBpp } from './scene-regs.ts';
import { loadLevelGfx, loadSpritesetFileIds, type GfxFileEntry, type GfxHeader } from './load-graphics.ts';
import { spriteRequiredFile, spriteTileBaseBytes } from './sprite-tile-base.ts';

const ANCHOR_SNES = 0x548000;
const STRIDE = 0x100;

/** A finished sprite image in the same shape `renderSpriteCel` returns: RGBA + the anchor's
 *  position WITHIN the image — i.e. origin = (distance from the image's top-left to the anchor).
 *  This matches `renderSpriteCel`'s `originX=-minX` convention so the layer can place BOTH the
 *  same way: `baseX = cell*16 - originX`. (A sprite whose art extends left of the anchor has a
 *  POSITIVE originX.) */
export interface RenderedSprite {
  rgba: Uint8Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

/** Everything a custom renderer needs: the cart + the level's loaded OBJ VRAM/CGRAM, and
 *  the placement cell (for parity-dependent sprites). `header`/`manifest`/`levelSpritePaletteId`
 *  let a custom renderer resolve ANOTHER sprite's cel (e.g. Salvo $02D compositing its eyes
 *  sprite $02E) via `resolveSpriteCel`, which is level-aware (spriteset tile base). */
export interface CustomRenderCtx {
  rom: Uint8Array;
  symbols: SymbolMap;
  vram: Uint8Array;
  cgram: Uint8Array;
  cellX: number;
  cellY: number;
  /** `levelMode` is read by Map16-stamping renderers (the donut lifts) to
   *  resolve the BG1 char base + bpp via `loadSceneRegs`; both the IPC sprite
   *  path and `render-level-layers` already pass the full gfx header. */
  header: Pick<GfxHeader, 'spriteTileset' | 'levelMode'>;
  manifest?: GfxFileEntry[];
  levelSpritePaletteId?: number;
}

export type CustomSpriteRenderer = (ctx: CustomRenderCtx) => RenderedSprite | null;

/** Decode a chunky bank-$54-$56 body region (one 4bpp index/byte, 256-byte row stride) →
 *  `w*h` indices. `srcSnes` is the absolute SNES address; `highNibble` reads `byte >> 4`. */
export function decodeBodyRegion(
  rom: Uint8Array, symbols: SymbolMap, srcSnes: number, w: number, h: number, highNibble = false
): Uint8Array | null {
  const anchorPC = symbols.tryPc(DYNAMIC_GFX_ANCHOR_SYMBOL);
  if (anchorPC === undefined) return null;
  const srcPC = anchorPC + (srcSnes - ANCHOR_SNES);
  if (srcPC < 0 || srcPC + (h - 1) * STRIDE + w > rom.length) return null;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    out[y * w + x] = (highNibble ? (rom[srcPC + y * STRIDE + x]! >> 4) : rom[srcPC + y * STRIDE + x]!) & 0x0f;
  }
  return out;
}

/** Per-blit transform: flip and/or a 90°-step rotation (cheap, no interpolation). */
export interface BlitOpts { flipX?: boolean; flipY?: boolean; rot?: 0 | 90 | 180 | 270; paletteRow?: number; }

/** An anchor-relative compositor. The canvas is large + centred on the anchor (0,0 dx/dy);
 *  blits accumulate, then `finish()` crops to the opaque bbox and reports the origin. */
export class SpriteCompositor {
  private static readonly DIM = 384;        // generous; cropped at finish (tall enough for the
                                            // $10C chained spike ball's ~146px downward chain+ball)
  private static readonly AX = 128;         // anchor (dx=dy=0) maps here
  private static readonly AY = 128;
  private readonly rgba = new Uint8Array(SpriteCompositor.DIM * SpriteCompositor.DIM * 4);
  private readonly cgram: Uint8Array;
  constructor(cgram: Uint8Array) { this.cgram = cgram; }

  private color(paletteRow: number, idx: number): [number, number, number] {
    const ci = (0x80 + paletteRow * 16 + idx) * 2;
    const w = this.cgram[ci]! | (this.cgram[ci + 1]! << 8);
    return [(w & 31) << 3, ((w >> 5) & 31) << 3, ((w >> 10) & 31) << 3];
  }

  /** Blit 4bpp `indices` (w×h) so its top-left lands at anchor-relative (dx,dy), after any
   *  rotation/flip. Transparent (index 0) skipped. */
  blit(indices: Uint8Array, w: number, h: number, dx: number, dy: number, opts: BlitOpts = {}): void {
    const rot = opts.rot ?? 0, palRow = opts.paletteRow ?? 0;
    const rw = rot === 90 || rot === 270 ? h : w;
    const rh = rot === 90 || rot === 270 ? w : h;
    const { DIM, AX, AY } = SpriteCompositor;
    for (let oy = 0; oy < rh; oy++) for (let ox = 0; ox < rw; ox++) {
      // map output (ox,oy) back to pre-rotation source (sx,sy)
      let sx: number, sy: number;
      if (rot === 90) { sx = oy; sy = rw - 1 - ox; }
      else if (rot === 180) { sx = rw - 1 - ox; sy = rh - 1 - oy; }
      else if (rot === 270) { sx = rh - 1 - oy; sy = ox; }
      else { sx = ox; sy = oy; }
      if (opts.flipX) sx = w - 1 - sx;
      if (opts.flipY) sy = h - 1 - sy;
      const v = indices[sy * w + sx]!; if (!v) continue;
      const X = AX + dx + ox, Y = AY + dy + oy;
      if (X < 0 || Y < 0 || X >= DIM || Y >= DIM) continue;
      const [r, g, b] = this.color(palRow, v);
      const d = (Y * DIM + X) * 4; this.rgba[d] = r; this.rgba[d + 1] = g; this.rgba[d + 2] = b; this.rgba[d + 3] = 255;
    }
  }

  /** Blit a finished RGBA image (e.g. another sprite's `renderSpriteCel` output) so its top-left
   *  lands at anchor-relative (dx,dy). Transparent (alpha 0) pixels skipped. Lets a composite mix
   *  cel-rendered parts (Boo Guy) with raw index-blit bodies (chain/ball). */
  blitRgba(rgba: Uint8Array, w: number, h: number, dx: number, dy: number): void {
    const { DIM, AX, AY } = SpriteCompositor;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4; if (rgba[s + 3] === 0) continue;
      const X = AX + dx + x, Y = AY + dy + y;
      if (X < 0 || Y < 0 || X >= DIM || Y >= DIM) continue;
      const d = (Y * DIM + X) * 4;
      this.rgba[d] = rgba[s]!; this.rgba[d + 1] = rgba[s + 1]!; this.rgba[d + 2] = rgba[s + 2]!; this.rgba[d + 3] = 255;
    }
  }

  /** Crop to the opaque bounding box. origin = the anchor's position within the cropped image
   *  (= AX-minX, AY-minY), matching `renderSpriteCel`'s `originX=-minX` so the layer places
   *  both via `baseX = cell*16 - originX`. */
  finish(): RenderedSprite | null {
    const { DIM, AX, AY } = SpriteCompositor;
    let minX = DIM, minY = DIM, maxX = -1, maxY = -1;
    for (let y = 0; y < DIM; y++) for (let x = 0; x < DIM; x++) {
      if (this.rgba[(y * DIM + x) * 4 + 3] !== 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return null;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(this.rgba.subarray(((minY + y) * DIM + minX) * 4, ((minY + y) * DIM + minX + w) * 4), y * w * 4);
    return { rgba: out, width: w, height: h, originX: AX - minX, originY: AY - minY };
  }
}

/** Rotate a w×h index buffer by a 90° multiple into a fresh buffer (CW). */
function rotate(idx: Uint8Array, w: number, h: number, rot: 0 | 90 | 180 | 270): { indices: Uint8Array; w: number; h: number } {
  if (rot === 0) return { indices: idx, w, h };
  const ow = rot === 90 || rot === 270 ? h : w;
  const oh = rot === 90 || rot === 270 ? w : h;
  const out = new Uint8Array(ow * oh);
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
    let sx: number, sy: number;
    if (rot === 90) { sx = oy; sy = ow - 1 - ox; }
    else if (rot === 180) { sx = ow - 1 - ox; sy = oh - 1 - oy; }
    else { sx = oh - 1 - oy; sy = ox; }
    out[oy * ow + ox] = idx[sy * w + sx]!;
  }
  return { indices: out, w: ow, h: oh };
}

// ── Pinball flipper $144 (right/left) ──────────────────────────────────────────────────
// One 32×32 paddle bitmap at $55:4060 (LOW nibble). The asm ($144 main → CODE_0D9D64 →
// CODE_0D9CE6) puts the paddle through the FXCODE_088205 rotozoom and lays out a VERTICAL
// mirror pair (the $60xx quad descriptor flips the second copy with `EOR #$8000`); the pair is
// oriented left/right by the rotozoom angle, which carries `$7A36 = ±$80` from sprite-X parity
// (set in $144 Init from `$70E2 AND $0010` via DATA_0D9D2A).
//
// Render — the exact transform chain, recovered from the in-game OAM (sprite-render-v2
// spr-144 capture, validated against $13C: trace tile-offset == editor origin):
//   1. SOURCE: the 32×32 paddle at $55:4060.
//   2. ROTATE: the GSU rotozoom turns it by the parity angle (odd ≈ 90° = "one-way left",
//      even ≈ 270° = its h-flip = "one-way right"); the rotation is BAKED into the rendered
//      tiles — the OAM placement itself is NOT rotated. We approximate with a 90° rotate +
//      an in-cell h-flip for the even parity (both parities place at the SAME x[-8..24]).
//   3. PLACE: the rotated paddle fills a 32×32 cell at offset (-8,-25); a SECOND copy,
//      V-flipped, fills the cell directly below at (-8,+7). The two touch at the hinge seam
//      y=+7 (7 px below the sprite anchor). Net body = 32×64, origin (-8,-25).
// ($13C, the un-rotated HORIZONTAL mirror pair, is a plain `mirror:'right'` body in
// DYNAMIC_BODY_SOURCES; only $144's rotation earns the custom offramp.)
const FLIPPER_SRC = 0x554060, FLIPPER_PAL = 0;
const FLIP_TOP_DY = -25, FLIP_SEAM_DY = 7, FLIP_DX = -8; // from the spr-144 OAM capture

const renderFlipper144: CustomSpriteRenderer = (ctx) => {
  const body = decodeBodyRegion(ctx.rom, ctx.symbols, FLIPPER_SRC, 32, 32, false);
  if (!body) return null;
  const r = rotate(body, 32, 32, 90);       // base (left) orientation
  const flipX = (ctx.cellX & 1) === 0;      // even (X clear) = "one-way right" = h-flip in cell
  const c = new SpriteCompositor(ctx.cgram);
  // Top cell, then the V-flipped bottom cell — both at FLIP_DX, touching at the hinge seam.
  c.blit(r.indices, r.w, r.h, FLIP_DX, FLIP_TOP_DY, { paletteRow: FLIPPER_PAL, flipX });
  c.blit(r.indices, r.w, r.h, FLIP_DX, FLIP_SEAM_DY, { paletteRow: FLIPPER_PAL, flipX, flipY: true });
  return c.finish();
};

// NB: Large Wheel $051 is intentionally NOT here — it emits zero OAM tiles (GSU rasterises the
// whole wheel into a $7E:5040 buffer drawn off-OAM), so there's no faithful bitmap to decode. It
// stays glyph-tier (name only, no graphics). A schematic outline placeholder was tried and dropped.

// ── Goal ring $00D (spinning roulette ring) ────────────────────────────────────────────────
// GSU-rotozoom-rendered. `init_goal` seeds a 2×2 dynamic-tile work area, but the idle/rest
// `main_goal` path displays the ring through the 10 circular OAM records only; the `$54:4010`
// seed tile is not an extra visible bead. Drawing that seed as a separate chunk was the source
// of the spurious sprites. For the static editor rest pose we reproduce the two visible dynamic
// bead sources in their captured OAM circle and let the SVG goal glyph continue to draw elsewhere.
const GOAL_BEAD_SRC = { ring: 0x5560e0, alt: 0x543040 };
const GOAL_RING_BEADS: readonly [number, number, keyof typeof GOAL_BEAD_SRC, number, number][] = [
  [234, 61, 'ring', 256, 1], [241, 85, 'alt', 153, 2],
  [241, 115, 'ring', 256, 1], [234, 139, 'alt', 153, 2],
  [224, 148, 'ring', 256, 1], [213, 138, 'alt', 153, 2],
  [206, 114, 'ring', 256, 1], [206, 85, 'alt', 153, 2],
  [213, 61, 'ring', 256, 1], [224, 52, 'alt', 153, 2]
];
// Anchor = the level sprite cell's top-left in the same OAM capture coordinate frame as
// `GOAL_RING_BEADS`. Do not derive this from `main_goal`'s R2/R3 inputs: those are GSU-local draw
// coordinates (`R2 = screenY + $18`, `R3 = screenX - $40`) consumed by FXCODE_08E1BE before the
// final dynamic body is emitted.
const GOAL_ANCHOR_X = 200, GOAL_ANCHOR_Y = 164;

const renderGoalRing00D: CustomSpriteRenderer = (ctx) => {
  const anchorPC = ctx.symbols.tryPc(DYNAMIC_GFX_ANCHOR_SYMBOL);
  if (anchorPC === undefined) return null;
  const c = new SpriteCompositor(ctx.cgram);

  for (const [sx, sy, which, scale, pal] of GOAL_RING_BEADS) {
    const srcPC = anchorPC + (GOAL_BEAD_SRC[which] - ANCHOR_SNES);
    const r = rotozoomDecode(ctx.rom, ctx.symbols, srcPC, 16, 16, false, { angle: 0, scale });
    const dx = (sx + 8) - (r.width / 2) - GOAL_ANCHOR_X;
    const dy = (sy + 8) - (r.height / 2) - GOAL_ANCHOR_Y;
    c.blit(r.indices, r.width, r.height, Math.round(dx), Math.round(dy), { paletteRow: pal });
  }

  return c.finish();
};

// ── Salvo the Slime $02D (boss) ──────────────────────────────────────────────────────────────
// Unlike every other sprite, Salvo has NO bitmap gfx anywhere and NO normal-cel records:
// DATA_0A9B1C[$2D] OAMByteCount = 0, so `resolveSpriteCel` returns an empty cel → it renders
// blank. Its body is rasterised PROCEDURALLY by the SuperFX. Trace (main_salvo `$06:83CA` →
// CODE_068442 → FXCODE_0A81C9 / CODE_0A81C9 in SuperFX/Banks/Bank0A.asm): the GSU fills a solid
// rounded shape from two shape LUTs in bank $0A, scales it by the runtime grow factor, then
// color-math blends it (translucent), DMA'd off-OAM via `$70:3372 → $7E:5040` (the same off-OAM
// class as $051, which we leave glyph-tier — but Salvo's exact shape LUTs make a faithful
// reconstruction possible). There is NO $54-$56 source, so the DYNAMIC_BODY_SOURCES path
// does not apply; this custom renderer rebuilds the silhouette from the asm.
//
// Shape (read live from ROM, drift-proof):
//   - DATA_0A860E ($0A:860E): byte[0] = $60 = entry count (96); bytes[1..96] = a SYMMETRIC
//     half-width profile $00→$7F→$00 — the blob's left/right silhouette.
//   - The rasteriser's row counter is R9 = $D1 = 209 (≈ the $348-byte / 4 DMA'd span count), i.e.
//     the body HEIGHT. So the 96-entry width profile stretches over ~209 rows → a rounded mound
//     slightly wider than tall (≈ 254×209 at unit scale), NOT a flat lens.
// We render the SETTLED (full-grown, post-emergence, pre-attack) pose = the silhouette at a fixed
// display scale. The in-game green comes from hardware color math (the captured palette row is a
// grayscale ramp, not green) which the editor can't reproduce, so we fill flat translucent green —
// matches the on-screen look. Salvo's eyes are a separate sprite ($02E) that already renders.
// SALVO_DISPLAY_H is the one un-pinned value: the GSU grow scale ($1079 / $18,x) is computed, not
// a static literal, so the settled pixel size is a tunable choice, not a cart constant.
const SALVO_DISPLAY_H = 80;         // settled blob height in px (tunable; raw LUT height = $D1 = 209)
const SALVO_GREEN: readonly [number, number, number] = [88, 200, 96];
const SALVO_ALPHA = 150;            // ~59% — approximates the color-math translucency
const SALVO_OUTLINE = 2;            // black silhouette outline thickness (px)
const SALVO_EYES_NUM = 0x02e;       // "Salvo the Slime's eyes" — a normal-cel sprite drawn on top
const SALVO_EYES_FRAME = 1;         // cel frame: 0 = blink/closed (the frame-0 default), 1 = eyes OPEN
const SALVO_EYES_T = 0.30;          // eyes vertical centre as a fraction down the blob body
const SALVO_EYES_SCALE = 2;         // the eyes sprite grows with the blob in-game; upscale to match

const renderSalvo02D: CustomSpriteRenderer = (ctx) => {
  const pcA = ctx.symbols.tryPc('DATA_0A860E');
  if (pcA === undefined) return null;
  const count = ctx.rom[pcA]!;                  // $60 = 96
  if (count === 0) return null;
  const halfW: number[] = [];                   // the symmetric width profile, [1..count]
  for (let i = 1; i <= count; i++) halfW.push(ctx.rom[pcA + i]!);
  const maxHalf = Math.max(...halfW);           // $7F = 127

  const RAW_H = 0xd1;                            // R9 row counter = body height at unit scale
  const scale = SALVO_DISPLAY_H / RAW_H;
  const bodyH = SALVO_DISPLAY_H;
  const bodyW = Math.max(1, Math.round(maxHalf * 2 * scale) + 1);
  const pad = SALVO_OUTLINE;                     // grow the canvas so the outline isn't clipped
  const W = bodyW + pad * 2, H = bodyH + pad * 2;
  const cx = W / 2;

  // 1. silhouette mask (the body fill), inset by `pad`.
  const filled = new Uint8Array(W * H);
  for (let y = 0; y < bodyH; y++) {
    const t = y / (bodyH - 1);                   // 0 (top) .. 1 (bottom)
    const hw = halfW[Math.min(count - 1, Math.floor(t * count))]! * scale;
    for (let x = 0; x < bodyW; x++) {
      if (Math.abs(x + 0.5 - bodyW / 2) > hw) continue;
      filled[(y + pad) * W + (x + pad)] = 1;
    }
  }

  // 2. translucent green fill + an opaque black outline (empty pixels within SALVO_OUTLINE of fill).
  const rgba = new Uint8Array(W * H * 4);
  const [gr, gg, gb] = SALVO_GREEN;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const idx = y * W + x, d = idx * 4;
    if (filled[idx]) { rgba[d] = gr; rgba[d + 1] = gg; rgba[d + 2] = gb; rgba[d + 3] = SALVO_ALPHA; continue; }
    let near = false;
    for (let oy = -SALVO_OUTLINE; oy <= SALVO_OUTLINE && !near; oy++) for (let ox = -SALVO_OUTLINE; ox <= SALVO_OUTLINE; ox++) {
      const nx = x + ox, ny = y + oy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && filled[ny * W + nx]) { near = true; break; }
    }
    if (near) { rgba[d] = 0; rgba[d + 1] = 0; rgba[d + 2] = 0; rgba[d + 3] = 255; }
  }

  // 3. composite the eyes ($02E) opaque on top, centred near the blob's upper third.
  const eyes = resolveSpriteCel(ctx.rom, ctx.symbols, ctx.header, SALVO_EYES_NUM, ctx.manifest, false, ctx.levelSpritePaletteId, undefined, undefined, SALVO_EYES_FRAME);
  if (eyes) {
    const ei = renderSpriteCel(eyes.cel, { vram: ctx.vram, cgram: ctx.cgram, tileBaseBytes: eyes.tileBaseBytes, dynamicBody: eyes.dynamicBody });
    if (ei.width > 0 && ei.height > 0) {
      const ew = ei.width * SALVO_EYES_SCALE, eh = ei.height * SALVO_EYES_SCALE;
      const ex = Math.round(cx - ew / 2);
      const ey = Math.round(pad + bodyH * SALVO_EYES_T - eh / 2);
      for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) {
        const s = (Math.floor(y / SALVO_EYES_SCALE) * ei.width + Math.floor(x / SALVO_EYES_SCALE)) * 4;
        if (!ei.rgba[s + 3]) continue;
        const X = ex + x, Y = ey + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const d = (Y * W + X) * 4;
        rgba[d] = ei.rgba[s]!; rgba[d + 1] = ei.rgba[s + 1]!; rgba[d + 2] = ei.rgba[s + 2]!; rgba[d + 3] = 255;
      }
    }
  }

  // Anchor the placed cell at the blob's bottom-centre (the slime sits on its cell).
  return { rgba, width: W, height: H, originX: Math.round(cx), originY: H - pad };
};

// ── Rotating Doors $01F (the numbered-door puzzle) ──────────────────────────────────────────────
// NOT one door — a CIRCLE of FOUR doors, each with its own number, that rotate around a centre.
// Each door = the GSU dyntile FRAME body (the door-transition dispatcher DEFAULT, Bank02
// CODE_02A153→CODE_02A17A: FXDATA_550000+$0021 = $55:0020 HIGH, the blue arched glass door — any
// door not $04E/$131/$093/$0CA/$012) mirrored to 32×32, PLUS a static centre number tile from the
// sprite's own special_chr cel gfx (file 0x31: tiles 0x0C/0x0E/0x28/0x2A relative to its tile base,
// pal1). Single-door dynbody + cel couldn't express the 4-up ring, so it earns a custom renderer.
// The 4 door positions + per-door number are the spr-01F capture OAM (a real rotation pose);
// anchor = the ring centre (avg of the 4 frame centres).
const DOOR_FRAME_SRC = 0x550020;                       // $55:0020 HIGH, 16×32 → mirror to 32×32
// [frameTL dx, dy (anchor=ring centre), number cel-tile]; numbers are file-0x31 quads via tile base.
// dx values include a +8 (half-tile-right) shift of the whole ring vs the placed cell (user-tuned).
const ROT_DOORS: readonly [number, number, number][] = [
  [-15, -48, 0x0e], [24, -23, 0x0c], [-40, -10, 0x28], [-2, 15, 0x2a],
];
// Decode a 16×16 OBJ quad (tiles t,t+1,t+0x10,t+0x11) from VRAM at byte `base` → 16×16 indices.
function decodeVramQuad16(vram: Uint8Array, base: number): Uint8Array {
  const out = new Uint8Array(16 * 16);
  for (const [qx, qy, off] of [[0, 0, 0], [8, 0, 1], [0, 8, 0x10], [8, 8, 0x11]] as const) {
    const b = (base + off * 32) & 0xffff;
    for (let y = 0; y < 8; y++) {
      const p0 = vram[b + y * 2]!, p1 = vram[b + y * 2 + 1]!, p2 = vram[b + 16 + y * 2]!, p3 = vram[b + 16 + y * 2 + 1]!;
      for (let x = 0; x < 8; x++) { const k = 7 - x; out[(qy + y) * 16 + (qx + x)] = ((p0 >> k) & 1) | (((p1 >> k) & 1) << 1) | (((p2 >> k) & 1) << 2) | (((p3 >> k) & 1) << 3); }
    }
  }
  return out;
}

const renderRotatingDoors01F: CustomSpriteRenderer = (ctx) => {
  const half = decodeBodyRegion(ctx.rom, ctx.symbols, DOOR_FRAME_SRC, 16, 32, true);
  if (!half) return null;
  const frame = new Uint8Array(32 * 32);                // mirror the 16-wide half to a 32-wide door
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) frame[y * 32 + x] = half[y * 16 + (x < 16 ? x : 31 - x)]!;
  // Level-aware number tile base (file 0x31's loaded slot) from the sprite's own cel resolution.
  const resolved = resolveSpriteCel(ctx.rom, ctx.symbols, ctx.header, 0x01f, ctx.manifest);
  if (!resolved) return null;
  const c = new SpriteCompositor(ctx.cgram);
  for (const [fdx, fdy, numTile] of ROT_DOORS) {
    c.blit(frame, 32, 32, fdx, fdy, { paletteRow: 0 });                                   // door frame
    const num = decodeVramQuad16(ctx.vram, resolved.tileBaseBytes + numTile * 32);
    c.blit(num, 16, 16, fdx + 8, fdy + 8, { paletteRow: 1 });                             // centred number
  }
  return c.finish();
};

/** Sprites that render via custom code (LAST resort). Checked before the cel/dynamic-body tiers.
 *  `Partial` so indexing an unregistered num yields `undefined` (most sprites have no entry). */
// ── Donut Lifts $117 (small) / $118 (large) — BG-tile (KATI) platforms ─────────────────────
// These カチカチ ("KATI") platforms have NO OAM cel (special_chr ptr 0). Their visible graphic
// is a Map16 BLOCK the handler stamps into BG1 via `change_map16`: small=1 block, large=2×2.
// (`main_donut_lift` Bank04:9521; the small Format-A object_data tile-8 is vestigial.) The editor's
// static BG1 render only draws the LEVEL'S stamped cells, not a sprite's runtime stamp, so the donut
// is otherwise invisible when placed. We reproduce it here: decode the donut's Map16 block(s) from
// the (BG1-shared) VRAM at the level's BG1 char base, exactly as renderBg1 would — so the donut reads
// correct in any level whose BG1 tileset carries its gfx. Validity (swept across all 16 BG1 tilesets):
//   • small $117 ($7502) — renders the donut ring under EVERY tileset (its tile is globally loaded);
//   • large $118 ($7500/$7501 + $3DAA/$3DAB) — only coherent under BG1 tileset $0F (e.g. records
//     $09/$2A/…; garbage elsewhere, incl. 0xDC/$2E, since page $3D isn't the donut there). $118 is never
//     placed in vanilla; it's valid where tileset $0F is loaded. This is a BG1-tileset gate, NOT the
//     sprite-spriteset gate `resolveSpriteValidity` models — so the corner badge can't express it.
// Block layout is derived verbatim from the asm draw tables (tile DATA_04CB5E, accumulated offsets
// DATA_04CB68/72), anchored top-left at the sprite cell (change_map16 stamps at the sprite's own cell
// → origin 0,0).
interface Map16Block { id: number; dx: number; dy: number }
const DONUT_LIFT_SMALL: readonly Map16Block[] = [{ id: 0x7502, dx: 0, dy: 0 }];
const DONUT_LIFT_LARGE: readonly Map16Block[] = [
  { id: 0x7500, dx: 0, dy: 0 }, { id: 0x7501, dx: 16, dy: 0 },
  { id: 0x3daa, dx: 0, dy: 16 }, { id: 0x3dab, dx: 16, dy: 16 }
];
const MAP16_SUB_OFF = [{ dx: 0, dy: 0 }, { dx: 8, dy: 0 }, { dx: 0, dy: 8 }, { dx: 8, dy: 8 }];

/** Rasterise a set of placed Map16 blocks (each 16×16) from BG1 VRAM/CGRAM into a finished sprite
 *  image, anchored top-left at the sprite cell. Returns null if no block decodes to opaque pixels
 *  (e.g. the level's Map16 tables can't be read). */
function renderMap16StampSprite(ctx: CustomRenderCtx, blocks: readonly Map16Block[]): RenderedSprite | null {
  const { rom, symbols, vram, cgram, header } = ctx;
  const tables = loadMap16Tables(rom, symbols);
  const regs = loadSceneRegs(rom, symbols, header.levelMode ?? 0);
  const bpp = bgLayerBpp(regs.bgmodeMode, 'bg1');
  const tileBytes = bpp === 4 ? 32 : 16;
  const decodeTile = bpp === 4 ? decode4bppTile : decode2bppTile;
  const colorsPerRow = bpp === 4 ? 16 : 4;
  // BG palette rows 0..7 (decodeMap16's sub-tile paletteRow is 3-bit); index 0 transparent.
  const palettes = Array.from({ length: 8 }, (_, r) => buildPaletteRow(cgram, r, true, 'expand', colorsPerRow));
  const bg1CharAddr = regs.bg1CharAddr;

  let width = 0, height = 0;
  for (const b of blocks) { width = Math.max(width, b.dx + 16); height = Math.max(height, b.dy + 16); }
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  const idx = new Uint8Array(64);
  const subTiles: Map16SubTile[] = Array.from({ length: 4 }, () => ({ tileIndex: 0, paletteRow: 0, hflip: false, vflip: false, priority: false }));
  let opaque = false;
  for (const b of blocks) {
    try { decodeMap16(tables, b.id, subTiles); } catch { continue; } // out-of-range page → skip block
    for (let s = 0; s < 4; s++) {
      const st = subTiles[s]!;
      const off = (bg1CharAddr + st.tileIndex * tileBytes) & 0xffff;
      if (off + tileBytes > vram.length) continue;
      decodeTile(vram, off, st.hflip, st.vflip, idx, 0);
      const pal = palettes[st.paletteRow]!;
      const px = b.dx + MAP16_SUB_OFF[s]!.dx, py = b.dy + MAP16_SUB_OFF[s]!.dy;
      for (let row = 0; row < 8; row++) {
        const dstRow = (py + row) * width + px;
        const srcRow = row * 8;
        for (let col = 0; col < 8; col++) {
          const v = idx[srcRow + col]!;
          if (v === 0) continue;
          u32[dstRow + col] = pal[v]!;
          opaque = true;
        }
      }
    }
  }
  return opaque ? { rgba, width, height, originX: 0, originY: 0 } : null;
}

const renderDonutLiftSmall117: CustomSpriteRenderer = (ctx) => renderMap16StampSprite(ctx, DONUT_LIFT_SMALL);
const renderDonutLiftLarge118: CustomSpriteRenderer = (ctx) => renderMap16StampSprite(ctx, DONUT_LIFT_LARGE);

// ── Double spiked platform + switch $162 ─────────────────────────────────────────────────────────
// `DoubleSpikePlatformWithSwitch` ($0D:A8C7) bundles the $15C/$15D switch + $15F/$160 platform-pair
// mechanic into ONE placed sprite: a central switch with a spiked platform to its LEFT and RIGHT that
// rotate around it. It's the GREEN pair ($15C switch + $15F platform — `CODE_0DAB6A` plots from
// FXDATA_550000+$40C0 = $55:40C0 at paletteRow 0 = green; the same source $160/red uses at pal 1).
// Handler-drawn (FXCODE_088205 rotozoom, two platforms at opposite angles 180° apart) with 0 shipped
// placements (can't capture), so we COMPOSE it from the component renders — $15F's green-platform
// dynbody (drawn left + right) + the $15C switch Format-A tile (centre). Rest pose = the un-rotated
// horizontal layout: [left platform][switch][right platform].
const renderDoubleSpikePlatform162: CustomSpriteRenderer = (ctx) => {
  const hdr = { spriteTileset: ctx.header.spriteTileset };
  const plat = resolveSpriteCel(ctx.rom, ctx.symbols, hdr, 0x15f, ctx.manifest, false, ctx.levelSpritePaletteId); // green platform (pal 0)
  const sw = resolveSpriteCel(ctx.rom, ctx.symbols, hdr, 0x15c, ctx.manifest, true, ctx.levelSpritePaletteId, undefined, SETTLED_PALETTE_ROW.get(0x15c), REST_FRAME.get(0x15c)); // green switch
  if (!plat || !sw) return null;
  const P = renderSpriteCel(plat.cel, { vram: ctx.vram, cgram: ctx.cgram, tileBaseBytes: plat.tileBaseBytes, dynamicBody: plat.dynamicBody });
  const S = renderSpriteCel(sw.cel, { vram: ctx.vram, cgram: ctx.cgram, tileBaseBytes: sw.tileBaseBytes, dynamicBody: sw.dynamicBody });
  if (P.width === 0 || S.width === 0) return null;
  const W = P.width * 2 + S.width;            // left platform + switch + right platform
  const H = Math.max(P.height, S.height);
  const rgba = new Uint8Array(W * H * 4);
  const blit = (src: Uint8Array, sw_: number, sh: number, ox: number, oy: number): void => {
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw_; x++) {
      const s = (y * sw_ + x) * 4;
      if (src[s + 3] === 0) continue;
      const X = ox + x, Y = oy + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const d = (Y * W + X) * 4;
      rgba[d] = src[s]!; rgba[d + 1] = src[s + 1]!; rgba[d + 2] = src[s + 2]!; rgba[d + 3] = 255;
    }
  };
  blit(P.rgba, P.width, P.height, 0, (H - P.height) >> 1);                          // left platform
  blit(S.rgba, S.width, S.height, P.width, (H - S.height) >> 1);                    // switch (centre)
  blit(P.rgba, P.width, P.height, P.width + S.width, (H - P.height) >> 1);          // right platform
  return { rgba, width: W, height: H, originX: W >> 1, originY: H >> 1 };
};

// ── Chained Spike Ball $10C ──────────────────────────────────────────────────────────────────────
// A COMPOSITE of three asm-distinct parts (init_chained_spike_ball $0D:89FF + main/draw $0D:8AF1):
//   (1) a Boo Guy "operating the pulley" at the TOP — a separate child sprite $10D the $10C Init
//       spawns AT the placed cell (`LDA #$010D : JSL CODE_spawn_sprite_active`, child placed at
//       anchorX/anchorY; the $10C ball/chain anchor `$7182` then drops +$30 = 48px below). $10D has
//       a real special_chr cel (a Boo Guy holding a circular pulley wheel) needing gfx file 0x3F.
//   (2) an 11-link CHAIN hanging straight DOWN from below the Boo Guy. The draw loop `CODE_0D8C09`
//       runs `LDA #$000B : STA $0E` (11 iterations), each `$02 SBC #$000A` (10px down). The links'
//       runtime zigzag (`$08 AND $0003`) is swing animation — a static REST pose draws them straight.
//       The links plot only X/Y into the GSU OAM template `$6000,y` (tile pre-set, not in the cel),
//       so the source isn't greppable from the loop; a render test disambiguated it as $55:00C0 — the
//       SAME source the sibling spiky-mace family $101/$102 (live-OAM-validated) uses for their chain
//       segments. The link is the central golden strand of that 32×32 body.
//   (3) the SPIKE BALL at the BOTTOM — a 32×32 dynamic body from $55:00A0 (init's GSU ball plot
//       `LDA #FXDATA_550000+$00A0 : STA R12`), palette row 0. Reuses DYNAMIC_BODY_SOURCES[$10C].
// Why custom: the special_chr cel stacks every chain link at one spot (runtime-positioned) AND its
// records 0-1 are a vestigial $0xc0 green block (NOT the Boo Guy) — no per-record patch can express
// the vertical Boo-Guy→chain→ball stack, so it earns the offramp.
//
// SPRITESET CAVEAT (gotcha #9 + a render-path gap): $10D needs gfx file 0x3F, and $10C's ONLY
// vanilla placement is level record 0xDC, whose authored spriteset (header[7]=0x16) does NOT load
// 0x3F. The editor's live render path (`gfxHeaderFromLevel`) does not mint a spriteset override, so
// `ctx.vram` lacks 0x3F and a naive `resolveSpriteCel($10D)` against it renders garbage. So this
// renderer loads its OWN private VRAM with a spritesetOverride that forces 0x3F into a slot, then
// resolves the Boo Guy cel against that. (The chain + ball come from the bank-$54/$55 GSU bodies,
// which are file-independent, so they render from any level's gfx.)
// Chain gfx = STATIC tile 0x0b — an 8×8 golden RING (the chain "circle"), in $10C's own spriteset
// file 0x3F. (The GSU $55:00C0 source is the spiked-ball chain SEGMENT but reads as a bone here; the
// ring tile is the link the game actually shows.) Length is HALF the in-game max: CODE_0D8C09 draws
// up to 11 links @10px (LDA #$000B / SBC #$000A), but the rest length is a runtime ceiling-distance
// probe, so a shorter editor chain reads cleaner.
const CHAIN10C_LINK_TILE = 0x0b;        // static ring tile in file 0x3F (verified vs the tile grid)
const CHAIN10C_LINKS = 7;               // ~half the 11-link in-game max
const CHAIN10C_STEP = 8;                // 8×8 rings touching → a connected chain
const CHAIN10C_X_SHIFT = 16;            // hang the chain + ball one tile RIGHT, under the pulley wheel
const CHAIN10C_BALL_SRC = 0x5500a0;     // init GSU ball plot (== DYNAMIC_BODY_SOURCES[$10C])
const CHAIN10C_BALL_W = 32, CHAIN10C_BALL_H = 32;

const renderChainedSpikeBall10C: CustomSpriteRenderer = (ctx) => {
  const c = new SpriteCompositor(ctx.cgram);

  // Private VRAM with file 0x3F (the chain/Boo-Guy gfx) forced into spriteset slot 0, so BOTH the
  // $10D Boo-Guy cel AND the static ring tile resolve to real art regardless of the placed level's
  // own spriteset — the live render path doesn't mint a spriteset override (see SPRITESET CAVEAT).
  const booFile = spriteRequiredFile(ctx.rom, ctx.symbols, 0x10d); // = 0x3F
  let privVram: Uint8Array | null = null;
  let privHeader: GfxHeader | null = null;
  let chainTileBase = 0;
  if (booFile != null) {
    const stock = loadSpritesetFileIds(ctx.rom, ctx.symbols, ctx.header.spriteTileset ?? 0);
    const override = [...stock]; override[0] = booFile;
    privHeader = {
      bg1Tileset: 0, bg2Tileset: 0, bg3Tileset: 0,
      spriteTileset: ctx.header.spriteTileset ?? 0,
      isWorld6: false, levelMode: ctx.header.levelMode ?? 0,
      spritesetOverride: override
    };
    privVram = new Uint8Array(0x10000);
    try { loadLevelGfx(ctx.rom, ctx.symbols, privHeader, privVram); } catch { privVram = null; }
    chainTileBase = spriteTileBaseBytes(ctx.rom, ctx.symbols, privHeader, 0x10c); // file 0x3F slot-0 base
  }

  // (1) Boo Guy / pulley at the TOP (anchor).
  let booH = 0;
  if (privVram && privHeader) {
    const boo = resolveSpriteCel(ctx.rom, ctx.symbols, privHeader, 0x10d, undefined, false, ctx.levelSpritePaletteId);
    if (boo) {
      const bi = renderSpriteCel(boo.cel, { vram: privVram, cgram: ctx.cgram, tileBaseBytes: boo.tileBaseBytes, dynamicBody: boo.dynamicBody });
      if (bi.width > 0 && bi.height > 0) {
        // Boo Guy's cel anchor at the placed cell (dx=dy=0); child spawns at the cell +4px right
        // (init `ADC #$0004`), so nudge right by 4.
        c.blitRgba(bi.rgba, bi.width, bi.height, 4 - bi.originX, -bi.originY);
        booH = bi.height - bi.originY;   // px the Boo Guy extends BELOW the anchor
      }
    }
  }

  // (2) Chain: a column of ring links (static tile 0x0b), shifted one tile RIGHT to hang under the
  //     pulley wheel, starting just below the Boo Guy.
  const chainTop = Math.max(booH, 4);
  let chainBottom = chainTop;
  if (privVram) {
    const ring = renderSpriteCel(
      [{ dx: 0, dy: 0, tile: CHAIN10C_LINK_TILE, paletteRow: 0, priority: 0, hflip: false, vflip: false, size: 8 }],
      { vram: privVram, cgram: ctx.cgram, tileBaseBytes: chainTileBase, dynamicBody: undefined }
    );
    if (ring.width > 0 && ring.height > 0) {
      for (let i = 0; i < CHAIN10C_LINKS; i++) {
        c.blitRgba(ring.rgba, ring.width, ring.height, CHAIN10C_X_SHIFT - (ring.width >> 1), chainTop + i * CHAIN10C_STEP);
      }
      chainBottom = chainTop + (CHAIN10C_LINKS - 1) * CHAIN10C_STEP + ring.height;
    }
  }

  // (3) Spike ball at the BOTTOM, centred under the (right-shifted) chain.
  const ball = decodeBodyRegion(ctx.rom, ctx.symbols, CHAIN10C_BALL_SRC, CHAIN10C_BALL_W, CHAIN10C_BALL_H, false);
  if (ball) {
    const by = chainBottom - 6;         // overlap the last link slightly so the chain enters the ball
    c.blit(ball, CHAIN10C_BALL_W, CHAIN10C_BALL_H, CHAIN10C_X_SHIFT - (CHAIN10C_BALL_W >> 1), by, { paletteRow: 0 });
  }

  return c.finish();
};

// ── Heading Cactus $0E4 (body) + Green Needlenose $0E5 (head) ────────────────────────────────────
// The cactus's pointy head is a SEPARATE sprite ($0E5, Format-A, spawnedOnly) the Init spawns
// (CODE_spawn_sprite_active) at the parent's X and Y-0x10 (16px above) — it's the head at rest and
// the projectile the cactus spits (Main state 2). Spawned children aren't placed entities, so the
// editor drew only the body. Composite the head as an editor aid: both pieces are TOP-LEFT-anchored
// (Format-A and Format-B share the anchor), so the spawn's Y-16 maps directly to the head's cel
// anchor at (0,-16) relative to the body's. Head drawn IN FRONT (it covers the body's top tile —
// the round grinning head is the visible top). Each piece resolves its OWN tile base (the head's
// gfx is in a different spriteset slot than the body), which is why this can't be a synth cel.
const renderHeadingCactus0E4: CustomSpriteRenderer = (ctx) => {
  const body = resolveSpriteCel(ctx.rom, ctx.symbols, ctx.header, 0x0e4, ctx.manifest, false, ctx.levelSpritePaletteId, undefined, SETTLED_PALETTE_ROW.get(0x0e4), REST_FRAME.get(0x0e4));
  if (!body) return null;
  const bi = renderSpriteCel(body.cel, { vram: ctx.vram, cgram: ctx.cgram, tileBaseBytes: body.tileBaseBytes, dynamicBody: body.dynamicBody });
  if (bi.width === 0 || bi.height === 0) return null;
  const c = new SpriteCompositor(ctx.cgram);
  c.blitRgba(bi.rgba, bi.width, bi.height, -bi.originX, -bi.originY); // body anchor → compositor (0,0)
  // Head $0E5 spawned at parent Y-16 → its cel anchor sits at (0,-16) relative to the body anchor.
  const head = resolveSpriteCel(ctx.rom, ctx.symbols, ctx.header, 0x0e5, ctx.manifest, FORMAT_A_NUMS.has(0x0e5), ctx.levelSpritePaletteId, undefined, SETTLED_PALETTE_ROW.get(0x0e5), REST_FRAME.get(0x0e5));
  if (head) {
    const hi = renderSpriteCel(head.cel, { vram: ctx.vram, cgram: ctx.cgram, tileBaseBytes: head.tileBaseBytes, dynamicBody: head.dynamicBody });
    if (hi.width > 0 && hi.height > 0) c.blitRgba(hi.rgba, hi.width, hi.height, -hi.originX, -16 - hi.originY);
  }
  return c.finish();
};

export const CUSTOM_SPRITE_RENDERERS: Readonly<Partial<Record<number, CustomSpriteRenderer>>> = {
  0x0e4: renderHeadingCactus0E4, // Heading Cactus — green body + the spawned Green Needlenose head ($0E5) on top (Y-16)
  0x01f: renderRotatingDoors01F, // Rotating Doors — ring of 4 numbered doors ($55:0020 frame + file-0x31 number ×4)
  0x00d: renderGoalRing00D, // Goal ring — 10-bead rotozoom roulette rest pose (SVG glyph kept)
  0x02d: renderSalvo02D, // Salvo the Slime (boss) — procedural translucent blob from the $0A860E shape LUT
  0x144: renderFlipper144, // Flipper (R/L) — vertical pair, rotated right/left by X parity
  0x117: renderDonutLiftSmall117, // Donut Lift (small) — BG Map16 block $7502 stamped at the sprite cell
  0x118: renderDonutLiftLarge118, // Large Donut Lift — BG Map16 2×2 ($7500/$7501/$3DAA/$3DAB)
  0x162: renderDoubleSpikePlatform162, // Double spiked platform + switch — $160 platform ×2 + $15D switch
  0x10c: renderChainedSpikeBall10C, // Chained Spike Ball — Boo-Guy/pulley ($10D, top) + 11-link chain ($55:00C0) + spike ball ($55:00A0, bottom)
};
