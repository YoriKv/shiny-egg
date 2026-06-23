// Enemy-sprite cel decoder + OAM-placement compositor.
//
// YI draws normal (non-boss, non-scaled) enemies by walking a static "cel"
// list and placing OAM tiles — NO GSU rasterisation (the Bank09 sprite region
// $098000-$099253 contains zero PLOT). The pixels are the static sprite tiles
// `loadLevelGfx` already decodes into VRAM; the cel only says WHICH tiles go
// WHERE. So a faithful editor render is "decode the cel → blit those VRAM
// tiles at the cel's offsets" — this module. See
// research/notes-sprite-render.md for the decode evidence + cel format.
//
// **Cel formats** (both feed the same normalised `SpriteCel`):
//   - Format B (dominant; `DATA_enemy_special_chr_addrs` targets) — 5-byte
//     records, self-contained placement (dx/dy in the record). Decoded here.
//   - Format A (`DATA_enemy_object_data_ptrs`, indexed by raw sprite ID) — a
//     `dw` tile list whose positions come from an external fixed grid; its
//     decoder will normalise to the same `SpriteCel` shape (TODO, needs the
//     grid). Once normalised it composites through the same `renderSpriteCel`.
//
// What this module does NOT resolve (the runtime-allocation layer — see task
// "Port GSU sprite char-id derivation"): the Format-B sprite-ID → char-id index
// and the dynamic OBJ tile base. Those are inputs to the decode/compositor
// (`celPC` and `tileBaseBytes`), not its responsibility.

import { decode4bppTile } from './tile.ts';
import { buildPaletteRow } from './color.ts';

const TILE_BYTES_4BPP = 32;
const TILE_PX = 8;
/** Sprite palettes live in CGRAM rows 8..15 (the OBJ half). */
const SPRITE_PALETTE_BASE_ROW = 8;
/** OBJ name table is 16 tiles wide — a 16×16 sprite's lower row is +16 tiles. */
const OBJ_NAME_TABLE_WIDTH = 16;
/** Tiles in the lower OBJ name page; cel tiles >= this index the dynamic OBJ
 *  region (a rigid dynamic body draws those from its chunky bitmap, not VRAM). */
const OBJ_LOWER_PAGE_TILES = 256;

/** One placed tile of a sprite, normalised across cel formats. The compositor
 *  blits it from sprite VRAM through CGRAM at the sprite origin + (dx, dy). */
export interface SpriteCelTile {
  /** Signed pixel offset from the sprite origin. */
  dx: number;
  dy: number;
  /** 9-bit OBJ tile number (relative to the sprite's VRAM tile base). */
  tile: number;
  /** OBJ palette row 0..7 (→ CGRAM row 8..15). */
  paletteRow: number;
  /** OBJ priority 0..3 (informational; unused for a flat editor render). */
  priority: number;
  hflip: boolean;
  vflip: boolean;
  /** 8 = one 8×8 tile; 16 = a 2×2 OBJ tile (4 sub-tiles). */
  size: 8 | 16;
  /** Set by `resolveSpriteCel` on a rigid-dynamic-body placeholder record: its
   *  pixels come from the dynamic body bitmap, not VRAM. The compositor draws the
   *  body at the z of the first such record reached (so the body's front/behind
   *  layering is DERIVED from the cel's OAM order) and skips the VRAM blit. */
  body?: boolean;
  /** This record's palette row is FIXED and must survive the whole-sprite palette
   *  override (spawn-cell parity / settled / runtime). For a sub-element the handler
   *  draws with its own palette independent of the body's variant tint — e.g. the
   *  Lantern Ghost's $11b flame stays pal1 (flame) while its body recolours by parity. */
  lockPalette?: boolean;
  /** Render this record as a normal STATIC VRAM tile even when its `tile` value would
   *  otherwise read as a dynamic-body placeholder (tile 0 or ≥256). For a handler-drawn
   *  sub-element that IS the loaded spriteset tile 0 (the gfx file's first tile = the
   *  tileRow/slot base) — e.g. the Bullet Bill Blaster's cannon-muzzle, which is the
   *  blaster's spriteset tile 0 and so collides with the tile-0 placeholder sentinel. It
   *  only renders correctly when the sprite's gfx file is loaded (spriteset-dependent). */
  static?: boolean;
}

/** A sprite cel = the tiles composing one animation frame. */
export type SpriteCel = SpriteCelTile[];

/** Bytes per Format-B cel record. */
export const CEL_FORMAT_B_RECORD_BYTES = 5;

/**
 * Decode `count` Format-B cel records starting at PC `celPC` in `rom`.
 *
 * Record layout (little-endian, 5 bytes — validated against ROM `db` data,
 * e.g. shy guy's `DATA_4D9605`):
 *   +0 int8  dx           signed X offset
 *   +1 int8  dy           signed Y offset
 *   +2 u8    tile_lo      low 8 bits of the 9-bit tile
 *   +3 u8    attr         bit0=tile bit8, bits1-3=palette, bits4-5=priority,
 *                         bit6=H-flip ($40), bit7=V-flip ($80)
 *   +4 u8    mode         $02 = 16×16 OBJ, else 8×8
 *
 * `count` (records per frame) is external to the stream — supplied by the
 * caller (the animation/frame layer).
 */
export function decodeCelFormatB(rom: Uint8Array, celPC: number, count: number): SpriteCel {
  const cel: SpriteCel = [];
  for (let i = 0; i < count; i++) {
    const o = celPC + i * CEL_FORMAT_B_RECORD_BYTES;
    const b0 = rom[o]!, b1 = rom[o + 1]!, b2 = rom[o + 2]!, b3 = rom[o + 3]!, b4 = rom[o + 4]!;
    cel.push({
      dx: (b0 << 24) >> 24, // signed 8
      dy: (b1 << 24) >> 24,
      tile: b2 | ((b3 & 0x01) << 8),
      paletteRow: (b3 >>> 1) & 0x07,
      priority: (b3 >>> 4) & 0x03,
      hflip: (b3 & 0x40) !== 0,
      vflip: (b3 & 0x80) !== 0,
      size: (b4 === 0x02) ? 16 : 8
    });
  }
  return cel;
}

/**
 * Apply a **whole-sprite OAM flip** to a decoded cel — the per-sprite X/Y flip the
 * engine sets in the slot's `$7042` attribute (from `DATA_0A9F1A`), which the cel
 * stream itself does NOT carry. Mirrors each record's position within the cel's
 * bounding box and toggles its own flip bit, so the bounding box (and hence the
 * sprite's placement origin) is preserved — only the appearance flips. Needed for
 * mirrored variants that share a cel with their unflipped twin, e.g. 0x54
 * Upside-down Wild Piranha shares 0x66's cel but sets Y-flip.
 */
export function applyCelFlip(cel: SpriteCel, xflip: boolean, yflip: boolean): SpriteCel {
  if (!xflip && !yflip) return cel;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of cel) {
    if (t.dx < minX) minX = t.dx;
    if (t.dy < minY) minY = t.dy;
    if (t.dx + t.size > maxX) maxX = t.dx + t.size;
    if (t.dy + t.size > maxY) maxY = t.dy + t.size;
  }
  return cel.map((t) => ({
    ...t,
    dx: xflip ? minX + maxX - t.dx - t.size : t.dx,
    dy: yflip ? minY + maxY - t.dy - t.size : t.dy,
    hflip: xflip ? !t.hflip : t.hflip,
    vflip: yflip ? !t.vflip : t.vflip
  }));
}

export interface CelRenderOpts {
  /** Sprite VRAM (`loadLevelGfx` output). */
  vram: Uint8Array;
  /** CGRAM (`loadLevelPalettes` output); sprite palettes in rows 8..15. */
  cgram: Uint8Array;
  /** VRAM byte offset of OBJ tile 0 = (objNameBase + dynamicTileBase) << 5.
   *  Supplied by the caller (the runtime-allocation layer — see task #10). */
  tileBaseBytes: number;
  /** Optional rigid dynamic-body bitmap (chunky bank-$54 gfx the GSU would
   *  rasterize — see `sprite-dynamic-gfx.ts`). When present, cel records that map
   *  to the dynamic OBJ region (`tile === 0` or `tile >= 256`) are NOT blitted
   *  from VRAM (they have no static tiles); this bitmap is composited in their
   *  place at `(originX, originY)` through palette row `paletteRow`. */
  dynamicBody?: DynamicBody;
  /** Track a per-pixel **owner map** (returned in `CelRenderResult.owner`,
   *  `width*height`). Each painted pixel records WHO drew it — the cel record
   *  index for a static tile, or `-2` for the dynamic body, `-1` if untouched.
   *  Because compositing is back-to-front, the final value is the FRONTMOST
   *  painter (the visible one). Used by the metasprite slicer
   *  (`sprite-metasprite.ts`) to attribute each pixel to a record. No effect on
   *  the rendered RGBA. */
  trackOwner?: boolean;
}

/** A rigid dynamic-body bitmap ready to composite: the decoded chunky indices
 *  plus where (sprite-origin-relative px) and through which palette row to draw
 *  them. Built by `resolveSpriteCel` from `decodeDynamicBody` + the cel's body
 *  records. */
export interface DynamicBody {
  /** `width * height` palette indices (0..15); index 0 = transparent. */
  indices: Uint8Array;
  width: number;
  height: number;
  /** Top-left of the bitmap relative to the sprite's (0,0) anchor. */
  originX: number;
  originY: number;
  /** OBJ palette row 0..7 (→ CGRAM row 8..15). */
  paletteRow: number;
}

export interface CelRenderResult {
  /** RGBA, `width * height * 4` bytes, top-left origin. */
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Pixel position of the sprite's (0,0) anchor within the bitmap — place the
   *  bitmap on a level canvas at `(spritePxX - originX, spritePxY - originY)`. */
  originX: number;
  originY: number;
  /** Per-pixel owner map (`width*height`), present iff `opts.trackOwner`. Each
   *  value is the cel record index that painted that pixel, `-2` for the dynamic
   *  body, `-1` for untouched/transparent. */
  owner?: Int32Array;
}

/**
 * Composite a decoded cel into a tight RGBA bitmap by blitting each cel tile
 * from sprite VRAM through CGRAM (index-0 transparent), respecting per-tile
 * flip / palette / size. Returns the bitmap + the origin anchor offset.
 *
 * 16×16 cels use the SNES OBJ 2×2 convention: dest sub-tile (sx,sy) maps to
 * source tile `base + srcRow*16 + srcCol` with `srcCol = hflip?1-sx:sx`,
 * `srcRow = vflip?1-sy:sy`, and each sub-tile is itself flipped.
 */
export function renderSpriteCel(cel: SpriteCel, opts: CelRenderOpts): CelRenderResult {
  // Bounding box over all cel tiles (in sprite-origin-relative pixels).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of cel) {
    if (t.dx < minX) minX = t.dx;
    if (t.dy < minY) minY = t.dy;
    if (t.dx + t.size > maxX) maxX = t.dx + t.size;
    if (t.dy + t.size > maxY) maxY = t.dy + t.size;
  }
  // Fold the dynamic body's footprint into the bbox so it can't fall outside the
  // canvas even if it extends past the (now-skipped) body cel records.
  if (opts.dynamicBody) {
    const b = opts.dynamicBody;
    if (b.originX < minX) minX = b.originX;
    if (b.originY < minY) minY = b.originY;
    if (b.originX + b.width > maxX) maxX = b.originX + b.width;
    if (b.originY + b.height > maxY) maxY = b.originY + b.height;
  }
  if (cel.length === 0 && !opts.dynamicBody) {
    return { rgba: new Uint8Array(0), width: 0, height: 0, originX: 0, originY: 0 };
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const originX = -minX;
  const originY = -minY;

  const rgba = new Uint8Array(width * height * 4);
  const out = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >>> 2);
  // Per-pixel owner map (frontmost painter), only when requested (metasprite
  // slicer). -1 = untouched/transparent, -2 = dynamic body, else cel record index.
  const owner = opts.trackOwner ? new Int32Array(width * height).fill(-1) : null;

  // Build the 8 sprite palette rows once (CGRAM rows 8..15, index-0 transparent).
  const palettes: Uint32Array[] = [];
  for (let r = 0; r < 8; r++) {
    palettes.push(buildPaletteRow(opts.cgram, SPRITE_PALETTE_BASE_ROW + r, /*transparent0=*/ true));
  }

  const indices = new Uint8Array(64);
  const blit8 = (tile: number, hflip: boolean, vflip: boolean, palette: Uint32Array, px: number, py: number, tag: number): void => {
    const vramOff = (opts.tileBaseBytes + tile * TILE_BYTES_4BPP) & 0xffff;
    if (vramOff + TILE_BYTES_4BPP > opts.vram.length) return;
    decode4bppTile(opts.vram, vramOff, hflip, vflip, indices, 0);
    for (let row = 0; row < TILE_PX; row++) {
      const dy = py + row;
      if (dy < 0 || dy >= height) continue;
      for (let col = 0; col < TILE_PX; col++) {
        const idx = indices[row * TILE_PX + col]!;
        if (idx === 0) continue; // transparent
        const dx = px + col;
        if (dx < 0 || dx >= width) continue;
        out[dy * width + dx] = palette[idx]!;
        if (owner) owner[dy * width + dx] = tag;
      }
    }
  };

  // Rigid dynamic body compositor. The body draws AT the z of its placeholder
  // records (tagged `body` by resolveSpriteCel) within the back-to-front loop below,
  // so its front/behind layering is DERIVED from the cel's OAM order — no flag (e.g.
  // Flamer Guy 0x0ED's flames placeholders sit behind its shy-guy statics, so the
  // flames render behind). A cel-less body (chomp) has no placeholder → drawn last.
  const drawBody = (): void => {
    if (!opts.dynamicBody) return;
    const b = opts.dynamicBody;
    const palette = palettes[b.paletteRow]!;
    const bx = b.originX - minX;
    const by = b.originY - minY;
    for (let y = 0; y < b.height; y++) {
      const dy = by + y;
      if (dy < 0 || dy >= height) continue;
      const srcRow = y * b.width;
      for (let x = 0; x < b.width; x++) {
        const idx = b.indices[srcRow + x]!;
        if (idx === 0) continue; // transparent
        const dx = bx + x;
        if (dx < 0 || dx >= width) continue;
        out[dy * width + dx] = palette[idx]!;
        if (owner) owner[dy * width + dx] = -2; // dynamic body
      }
    }
  };
  let bodyDrawn = false;

  // Composite BACK-TO-FRONT. The SNES draws OBJs in OAM-index order with the LOWER
  // index IN FRONT, and YI writes cel records to increasing OAM indices — so the
  // FIRST cel record is frontmost. We paint by overwrite (later draw wins), so we
  // must iterate in REVERSE: the last record is painted first (backmost), the first
  // record last (on top). Forward order drew later records over earlier ones, which
  // is backwards — e.g. Red Para Koopa 0x16F's wings (later records) covered its head
  // (earlier records). Verified against the in-game layering.
  for (let i = cel.length - 1; i >= 0; i--) {
    const t = cel[i]!;
    // A `body`-tagged record is a rigid-dynamic-body placeholder: its pixels come
    // from the body bitmap, not VRAM. Draw the body at the FIRST one reached in this
    // back-to-front walk (which fixes its z relative to the static records), then skip
    // it + the remaining placeholders' VRAM blits. (Ordinary cel sprites have no
    // `body` tag — their tile 0 is a real loaded tile, e.g. the Flower 0x110 / Kamek,
    // and blits normally; resolveSpriteCel only tags placeholders for dynamic bodies.)
    if (t.body) {
      if (opts.dynamicBody && !bodyDrawn) { drawBody(); bodyDrawn = true; }
      continue;
    }
    const palette = palettes[t.paletteRow]!;
    const px = t.dx - minX;
    const py = t.dy - minY;
    if (t.size === 8) {
      blit8(t.tile, t.hflip, t.vflip, palette, px, py, i);
    } else {
      // 16×16 = 2×2 OBJ sub-tiles.
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const srcCol = t.hflip ? 1 - sx : sx;
          const srcRow = t.vflip ? 1 - sy : sy;
          const subTile = t.tile + srcRow * OBJ_NAME_TABLE_WIDTH + srcCol;
          blit8(subTile, t.hflip, t.vflip, palette, px + sx * TILE_PX, py + sy * TILE_PX, i);
        }
      }
    }
  }

  // Cel-less dynamic body (no `body` placeholder record, e.g. chomp) → draw last
  // (front), the only sensible z when there are no static records to order against.
  if (opts.dynamicBody && !bodyDrawn) drawBody();

  return { rgba, width, height, originX, originY, owner: owner ?? undefined };
}
