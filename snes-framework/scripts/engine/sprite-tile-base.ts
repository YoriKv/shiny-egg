// Dynamic OBJ-tile-base derivation for the static enemy-sprite renderer.
//
// The Format-B cel decoder (`sprite-cel.ts`) yields tiles that are RELATIVE to
// a per-sprite OBJ tile base. This module computes that base + the frame-0
// record count at RENDER TIME (never baked — the user can edit the sprite
// tileset, which shifts every spriteset-resolved sprite's base).
//
// # The derivation (ported from GoldenEgg `Level._spriteTileRow`,
//   Level.cs:8771-8781 — verified end-to-end; produces a recognisable shy guy)
//
//   fileInfoTablePC = 0x52716            // raw PC offset; u16 per sprite ID, 442 entries
//   requiredFileId  = rom_u16(fileInfoTablePC + spriteId*2)
//   spriteset       = spriteset_files[header.spriteTileset]   // 6 file ids
//   slot            = s in 0..5 where spriteset[s] == (requiredFileId & 0xFF)
//                     (GE scans s = 5..0, so a lower slot wins on a tie)
//   tileRow         = (requiredFileId === 0) ? 0 : (slot*32 | 256)
//
// `requiredFileId === 0` means the sprite is NOT drawn from a dynamic spriteset
// slot — its tiles live in the always-loaded common sprite-gfx page (file $72 in
// most levels), which `scene_gfx_layout` decompresses to the OBJ name base. So
// `tileRow` stays 0 and the cel tiles are absolute OBJ tiles from the name base
// (this is shy guy's case).
//
// # tileRow → VRAM byte (Task A, empirically validated against shy guy $01E)
//
//   tileBaseBytes = objNameBase + tileRow*32
//
// `objNameBase` is the OBJ name-table base in VRAM bytes. In-level scenes set
// OBSEL ($2101) = $02 unconditionally (`CODE_init_scene_regs`, Bank00.asm:6095),
// whose low 3 bits select name base = 2 << 14 = $8000 bytes, gap select 0 (the
// upper 256 OBJ tiles sit contiguously at name base + $2000). The first
// spriteset file therefore lands at $A000 = $8000 + 256*32 = name base +
// (slot-0 tileRow)*32 — which lets us DERIVE the base from the manifest rather
// than hardcode it, so it survives a VRAM-layout change. We use the manifest's
// dp7 (first sprite slot) entry: objNameBase = dp7.vramByteOffset - $2000,
// falling back to the constant $8000 when no manifest is supplied.

import { snesToPC, type SymbolMap } from './symbol-map.ts';
import type { GfxFileEntry, GfxHeader } from './load-graphics.ts';
import { decodeCelFormatB, applyCelFlip, CEL_FORMAT_B_RECORD_BYTES, type SpriteCel, type DynamicBody } from './sprite-cel.ts';
import { DYNAMIC_BODY_SOURCES, decodeDynamicBody } from './sprite-dynamic-gfx.ts';
import { u16le } from './rom-read.ts';

/** First **ambient** sprite ID (`!Define_YI_AmbSpr1BA` / `AmbientSpriteIDs.asm`).
 *  IDs `>= $1BA` are auto-scroll/gfx-palette-swap triggers ($1BA-$1C9, no-visual
 *  engine behaviour modifiers — the swap is drawn via the BG1-region path, not the
 *  sprite), sprite generators ($1CA-$1F4), and code-spawned VFX/particles ($1F5+).
 *  None are level visuals, so they are NOT cel-rendered — they fall through to the
 *  editor's vector-glyph tier. Only normal-range IDs (`$000-$1A9`,
 *  `NormalSpriteIDs.asm`) carry renderable enemy/object cels. See the sprite
 *  taxonomy in research/notes-sprite-render.md. */
export const AMBIENT_SPRITE_ID_BASE = 0x1ba;
/** Number of OBJ tiles in the lower OBJ name page (256). The spriteset (upper
 *  page) starts here, at name base + 256*32 bytes. */
const OBJ_LOWER_PAGE_TILES = 256;
const TILE_BYTES_4BPP = 32;
/** OBSEL = $02 → OBJ name base = 2 << 14 = $8000 bytes (the static in-level
 *  value; used as a fallback when no manifest is available to derive it). */
const DEFAULT_OBJ_NAME_BASE = 0x8000;

// SuperFX data tables are read by symbol (drift-proof, no hardcoded literal),
// using the canonical SuperFX-native `DATA_*` definition label (the actual `DATA_…:`
// in SuperFX/Banks/Bank0A.asm — the `FXDATA_*` form is just the 65816-side
// cross-reference alias). Resolves via the merged main+FX symbol map, same as
// `DATA_enemy_special_chr_addrs` below. `symbols.pc()` throws loud if absent.

/** The 6 spriteset file IDs for a header's sprite tileset (asm DP $17..$1C). */
function spritesetFiles(rom: Uint8Array, symbols: SymbolMap, spriteTileset: number): number[] {
  const base = symbols.pc('DATA_spriteset_files') + spriteTileset * 6;
  return [0, 1, 2, 3, 4, 5].map((i) => rom[base + i]!);
}

/**
 * GoldenEgg `_spriteTileRow` for one sprite ID: the OBJ tile-row base the cel
 * tiles are relative to. 0 = common-page sprite (tiles at the OBJ name base);
 * `slot*32 | 256` = spriteset-slot sprite (upper OBJ page).
 */
export function spriteTileRow(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset'>,
  spriteId: number
): number {
  // sprite-ID → required-gfx-file-id table (u16 × 442) = DATA_sprite_gfx_file_table ($0A:A716).
  const requiredFileId = u16le(rom, symbols.pc('DATA_sprite_gfx_file_table') + spriteId * 2);
  if (requiredFileId === 0) return 0;
  const spriteset = spritesetFiles(rom, symbols, header.spriteTileset);
  let row = 0;
  // GE scans slot 5..0; the LAST match wins, i.e. the lowest matching slot.
  for (let s = 5; s >= 0; s--) {
    if (spriteset[s] === (requiredFileId & 0xff)) row = (s * 32) | 256;
  }
  return row;
}

/** Derive the OBJ name base (VRAM bytes) from the sprite-gfx manifest, falling
 *  back to the static in-level OBSEL value when no manifest is given. */
function objNameBase(manifest?: GfxFileEntry[]): number {
  const dp7 = manifest?.find((e) => e.dpSlot === 7);
  if (dp7) return dp7.vramByteOffset - OBJ_LOWER_PAGE_TILES * TILE_BYTES_4BPP;
  return DEFAULT_OBJ_NAME_BASE;
}

/**
 * The `tileBaseBytes` to feed `renderSpriteCel` for `spriteId`, computed
 * dynamically from cart tables + the level's sprite-gfx manifest.
 *
 * `manifest` is `loadLevelGfx`'s output for THIS level — used to derive the OBJ
 * name base (so a VRAM-layout change is followed automatically). Omit it to use
 * the static fallback base ($8000).
 */
export function spriteTileBaseBytes(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset'>,
  spriteId: number,
  manifest?: GfxFileEntry[]
): number {
  const tileRow = spriteTileRow(rom, symbols, header, spriteId);
  return objNameBase(manifest) + tileRow * TILE_BYTES_4BPP;
}

/**
 * Number of cel records composing frame 0 for `spriteId`. The count is NOT in the
 * cel stream (the `mode` byte is the 8×8-vs-16×16 size flag, not a frame
 * terminator — `DATA_4D1040` is one 4-record 32×32 enemy with every record
 * `mode=$02`). It is the **OAMByteCount** the GSU draw walker (`CODE_098B85`)
 * loops over: `count = (OAMByteCount & $F8) >> 3`, where OAMByteCount is the high
 * byte of `DATA_sprite_render_control_table[spriteId]`. That word seeds the slot's `$7040` render-control
 * word at spawn (Bank03:3646): HIGH byte = OAMByteCount (what we read); LOW byte =
 * the sprite's initial render-control flags — bits `$000C` are the "draw normally"
 * bits, but those are RUNTIME-managed (re-derived on reactivation via `AND #$000C`
 * at `$03:9D96`, cleared while the sprite is held on Yoshi's tongue,
 * `CODE_spr_state_tongued` `$03:9AC8`), NOT a static draw gate — verified: rendered
 * sprites carry `$00`/`$04`/`$08` there with no correlation to whether the sprite
 * draws (e.g. Wild Piranha 0x66 = `$00` yet renders). So the low byte is irrelevant
 * to a static frame-0 render. Count validated byte-exact vs 5 BizHawk traces.
 * Pure-static, sprite-ID-indexed.
 */
export function spriteFrame0RecordCount(rom: Uint8Array, symbols: SymbolMap, spriteId: number): number {
  const oamByteCount = (u16le(rom, symbols.pc('DATA_sprite_render_control_table') + spriteId * 2) >>> 8) & 0xff;
  return (oamByteCount & 0xf8) >> 3;
}

export interface ResolvedSpriteCel {
  /** Decoded frame-0 cel. */
  cel: SpriteCel;
  /** VRAM byte base to feed `renderSpriteCel`. */
  tileBaseBytes: number;
  /** PC of the Format-B cel data. */
  celPC: number;
  /** Records in frame 0. */
  count: number;
  /** Rigid dynamic-body bitmap (chunky bank-$54 gfx), when the sprite is a
   *  registered rigid dynamic-OBJ sprite — feed to `renderSpriteCel` via opts.
   *  Absent for spriteset/common-page sprites and for stretchy/rotzoom sprites
   *  (which stay stem-only). See `sprite-dynamic-gfx.ts`. */
  dynamicBody?: DynamicBody;
}

/**
 * Resolve a sprite ID to a renderable Format-B cel (frame 0) + its dynamic tile
 * base, or `null` when the sprite has no renderable cel (those fall through to
 * the editor's vector-glyph tier). Pure-static: cel data + tile base both come
 * from cart tables / the level manifest, no emulator.
 *
 * Scope: only normal-range IDs (`$000-$1A9`) are cel-rendered; ambient-range IDs
 * (`>= AMBIENT_SPRITE_ID_BASE`) are skipped (see that constant).
 *
 * **char-id == sprite ID** for normal enemies (validated against BizHawk
 * `sprite-slot-dump` traces: shy guy 0x1E, Pink Pinwheel 0x64, Crazee Dayzee
 * 0x181 all match `special_chr[spriteId]`). So the raw sprite-ID index is correct;
 * earlier "garbage" was the frame-0 record count (now `spriteFrame0RecordCount`)
 * plus the tile-base gate below.
 *
 * **Tile-base gate.** A `fileInfo==0` sprite whose cel references upper-page tiles
 * (`>= OBJ_LOWER_PAGE_TILES`) draws from a DYNAMICALLY-allocated OBJ region
 * (`CODE_03AD74`, spawn-order-dependent) — its base is not statically derivable,
 * so we skip it (glyph tier) rather than blit against the wrong VRAM. `fileInfo==0`
 * + all tiles `< 256` is the always-loaded common page (base 0, OK); `fileInfo!=0`
 * is a fixed spriteset slot (OK). On 1-1 this gates Chomp Rock + the Winged Cloud
 * variants (dynamic) while keeping shy guy / piranhas / pinwheel / Dayzee. NOTE:
 * those dynamic objects are candidates for the **Map16 object-render pathway**
 * (they stamp tiles like std/ext objects) — a future enhancement, see plan doc.
 *
 * `DATA_enemy_special_chr_addrs` is a Bank4D-local `dw` table; a zero entry = no
 * Format-B cel.
 */
/**
 * True for a **Format-A-only** sprite: no Format-B cel (`special_chr == 0`) but an
 * `object_data` pointer (`!= 0`). These are items / simple objects (red coin, eggs,
 * key, …) the renderer cel-renders despite their non-`enemy` category — used by the
 * layer to let them past the `enemy`-only category gate. (Sprites that DO have a
 * Format-B cel stay gated by category, so a wrong cel isn't drawn for them.)
 */
export function isFormatAOnlySprite(rom: Uint8Array, symbols: SymbolMap, spriteId: number): boolean {
  if (spriteId >= AMBIENT_SPRITE_ID_BASE) return false;
  const chrPC = symbols.tryPc('DATA_enemy_special_chr_addrs');
  const objPC = symbols.tryPc('DATA_enemy_object_data_ptrs');
  if (chrPC === undefined || objPC === undefined) return false;
  return u16le(rom, chrPC + spriteId * 2) === 0 && u16le(rom, objPC + spriteId * 2) !== 0;
}

/**
 * Runtime OAM-palette override for the few sprites that recolour themselves in
 * their Init handler. The static `$7042` seed (`DATA_0A9F1A`) is only the
 * *un-initialised* palette; these sprites clear it and recompute their palette at
 * spawn from level state, so a static render shows the wrong colour. We can't run
 * the handler, so we reproduce the deterministic, normal-play palette it computes.
 *
 * Returns the OBJ palette row (0..7) to FORCE on the cel, or `undefined` for none.
 *
 * Deliberately a tiny per-sprite registry, not a general solution — the broad fix
 * is a trace that captures each sprite's settled `$7042` at rest (see
 * research/plan-editor-remaining.md SP4). Today it covers only:
 *
 *   0x065 Red Coin — `YI_NorSpr065_RedCoin_Init` ($0C:EA10) does
 *     `LDA $7042,x : AND #$FFF1 : ORA DATA_0CE9FE,y : STA $7042,x`, where (normal
 *     play, "show hidden items" off) y = 0, or y = 4 when the level's sprite-
 *     palette id == 2. The hidden-items branch (y += 2) is the *revealed* red tint,
 *     not the in-play look — YI red coins are disguised as ordinary yellow coins
 *     during play — so we read the non-revealing entries. The static seed is
 *     palette 0 (green CGRAM row 8); this yields palette 2 (gold row 10), or 7 in
 *     sprite-palette-2 levels. (0x115 "Coin" needs no override — its Init leaves
 *     `$7042` at the static seed, palette 2, which is already correct.)
 */
function spriteRuntimePaletteOverride(
  rom: Uint8Array,
  symbols: SymbolMap,
  spriteId: number,
  levelSpritePaletteId: number | undefined
): number | undefined {
  if (spriteId === 0x065) {
    const tablePC = symbols.tryPc('DATA_0CE9FE');
    if (tablePC === undefined) return undefined; // no-build map without the table → leave as-is
    const y = levelSpritePaletteId === 2 ? 4 : 0; // normal play (hidden-items off)
    return (u16le(rom, tablePC + y) >>> 1) & 0x07;
  }
  return undefined;
}

/**
 * Hand-curated OAM tile **size** for the few Format-A sprites whose single
 * `object_data` tile is an 8×8 small OBJ rather than the default 16×16 large OBJ.
 *
 * The Format-A draw routine (`CODE_098B0B`) emits one OBJ record whose size bit
 * is the sprite's OAM small-vs-large flag (OBSEL's two sizes + the slot attr) —
 * which we don't statically reproduce, so Format A defaults to the common case
 * (16×16, correct for the items: red coin, eggs, key, …) and the exceptions are
 * listed here. A wrong 16×16 default draws the sprite at 2× extent, the real cel
 * occupying only the top-left quarter and the other 3 pulled from the adjacent
 * (unrelated) OBJ tiles `tile+1 / tile+$10 / tile+$11`.
 *
 *   0x183 Butterfly — 8×8 (object_data tile 0x03; the 16×16 default oversized it).
 */
const FORMAT_A_CEL_SIZE: Record<number, 8 | 16> = {
  0x183: 8
};

/**
 * Placement-parity cel variants — sprites whose Init picks the ANIMATION FRAME +
 * a whole-sprite OAM flip from the spawn cell's X/Y parity (position pixel bit 4),
 * so a static frame-0 render draws every instance in one orientation. Indexed by
 * `2*(yCell&1) + (xCell&1)`; `flips` XOR onto the `$7042` seed flip bits (both
 * signs' seed is $0006 — palette only, so the XOR is absolute here). Frame N's
 * cel records sit at `celPC + N*count*5` — the GSU draw walker (`CODE_098B85`)
 * multiplies the per-sprite record count by the slot's anim frame.
 *  - 0x197 Arrow Sign (`init_arrow_sign`, Bank0F.asm:1336): frames `DATA_0F8962`
 *    {0,1,1,0} + EOR flips `DATA_0F896E` {$00,$40,$80,$C0} → up/right/left/down.
 *  - 0x198 Diagonal Arrow Sign (`init_diagonal_arrow_sign`, Bank0F.asm:1306):
 *    fixed frame 2 + ORA of the same flip table → NW/NE/SW/SE.
 * (Both inits then snap the position to the 32px-block centre +8 — a runtime
 * anchor shift the editor does NOT mirror; we draw at the placed cell.)
 */
const PARITY_CEL_VARIANTS: Record<number, { frames: readonly number[]; flips: readonly number[] }> = {
  0x197: { frames: [0, 1, 1, 0], flips: [0x00, 0x40, 0x80, 0xc0] },
  0x198: { frames: [2, 2, 2, 2], flips: [0x00, 0x40, 0x80, 0xc0] }
};

/** Parity-cel variant index (0..3) for a placement, or `null` when `spriteId`
 *  has no placement-parity cel. The sprite layer keys its per-num cel cache by
 *  this (the cel bitmap is a function of (num, index), not num alone). */
export function parityCelVariantIndex(spriteId: number, xCell: number, yCell: number): number | null {
  return spriteId in PARITY_CEL_VARIANTS ? 2 * (yCell & 1) + (xCell & 1) : null;
}

export function resolveSpriteCel(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset'>,
  spriteId: number,
  manifest?: GfxFileEntry[],
  /** Force the Format-A path even if the sprite also has a `special_chr` cel.
   *  Set by the layer for sprites the categorization trace classed `cel: 'A'`
   *  (e.g. the Key, which carries both tables but draws Format A). */
  preferFormatA = false,
  /** The level's sprite-palette id (`LevelHeaderSpritePaletteLo`, header field 8).
   *  Only consulted by `spriteRuntimePaletteOverride` (the Red Coin's level-state-
   *  dependent recolour). Omit for the static seed palette. */
  levelSpritePaletteId?: number,
  /** Spawn CELL coordinates — only consulted for `PARITY_CEL_VARIANTS` sprites
   *  (the arrow signs), whose frame + flip depend on cell parity. Omit to render
   *  the parity-0 variant (e.g. pickers/galleries with no placement). */
  placement?: { x: number; y: number }
): ResolvedSpriteCel | null {
  // Ambient sprites (triggers / generators / VFX) are not level visuals.
  if (spriteId >= AMBIENT_SPRITE_ID_BASE) return null;
  const tablePC = symbols.tryPc('DATA_enemy_special_chr_addrs');
  if (tablePC === undefined) return null;
  const ptr = u16le(rom, tablePC + spriteId * 2);
  // A registered dynamic-body sprite renders even with no Format-B cel (its body
  // is the bank-$54 bitmap, not cel tiles) — e.g. Super Star $088. Non-table
  // sprites with no cel fall through to the glyph tier.
  const dynSrc = DYNAMIC_BODY_SOURCES[spriteId];
  // Format-A sprites (no special_chr cel) draw as a single OBJ tile from
  // DATA_enemy_object_data_ptrs ($4D:0000) — items (red coin, eggs, key, …) and a
  // few simple enemies. See research/plan-editor-remaining.md SP7.
  const objDataTablePC = symbols.tryPc('DATA_enemy_object_data_ptrs');
  const faPtr = objDataTablePC === undefined ? 0 : u16le(rom, objDataTablePC + spriteId * 2);
  if (ptr === 0 && !dynSrc && faPtr === 0) return null;
  // Per-sprite OAM attr (slot `$7042` = `DATA_0A9F1A[id]` high byte EOR $20): the
  // whole-sprite X/Y flip (bit6/bit7) AND the sprite's palette row (bits1-3) —
  // neither is carried by the cel stream. Mirrored variants share a cel + set a
  // flip (0x54 vs 0x66); the palette row tints the shared gfx (e.g. Pink Pinwheel
  // pal 4). It OR-combines with the cel record's own palette (cel pals are
  // normally 0, so this just selects the sprite's row; a cel that sets its own
  // non-zero row — e.g. Crazee Dayzee pal 4, whose `$7042` is 0 — is preserved).
  // NB: shy guys also recolour by map position at runtime (their Init/Main); we
  // don't reproduce that, and the static `$7042` base palette is correct here.
  const oamAttr = (rom[symbols.pc('DATA_0A9F1A') + spriteId * 2 + 1]! ^ 0x20) & 0xff;
  const spritePal = (oamAttr >>> 1) & 0x07;
  const hflip = (oamAttr & 0x40) !== 0;
  const vflip = (oamAttr & 0x80) !== 0;
  let celPC = -1;
  let count = 0;
  let cel: SpriteCel = [];
  if (ptr !== 0 && !preferFormatA) {
    const pc = snesToPC(0x4d0000 | ptr);
    if (pc >= 0 && pc < rom.length) {
      celPC = pc;
      count = spriteFrame0RecordCount(rom, symbols, spriteId);
      // Placement-parity variant (arrow signs): step to the parity-selected
      // frame's records and fold its flip bits into the whole-sprite flip.
      let h = hflip, v = vflip;
      const parity = PARITY_CEL_VARIANTS[spriteId];
      if (parity && placement) {
        const idx = 2 * (placement.y & 1) + (placement.x & 1);
        celPC += parity.frames[idx]! * count * CEL_FORMAT_B_RECORD_BYTES;
        h = h !== ((parity.flips[idx]! & 0x40) !== 0);
        v = v !== ((parity.flips[idx]! & 0x80) !== 0);
      }
      cel = applyCelFlip(decodeCelFormatB(rom, celPC, count), h, v);
      if (spritePal !== 0) cel = cel.map((t) => ({ ...t, paletteRow: (t.paletteRow | spritePal) & 0x07 }));
    }
  }
  // Format A: no special_chr cel but an object_data pointer → render frame 0 as a
  // single OBJ tile (the OAMByteCount is 1 for all 47 such sprites). Default size is
  // 16×16; the few 8×8-OBJ exceptions are curated in FORMAT_A_CEL_SIZE. The tile
  // is `object_data[0]`'s low 9 bits; palette + whole-sprite flip come from $7042
  // (same as Format B — the tile-word's own attr palette/flip is unused, verified
  // against captures). Top-left-anchored (dx=dy=0): the Format-A draw routine
  // CODE_098B0B ($09:8B0B) writes the OBJ record's X/Y straight from the slot's
  // screen position $1640/$1642 with NO centering offset — i.e. the tile's top-left
  // coincides with the sprite anchor (the same anchor Format-B cel dx/dy are
  // relative to). An earlier `dx=dy=-8` centred it on the cell, shifting 1×1 items
  // up-left by half a tile. The tile base resolves common-page (items,
  // requiredFile 0) vs spriteset (enemies) via the tileRow derivation + gate below,
  // exactly like Format B.
  if (cel.length === 0 && !dynSrc && faPtr !== 0) {
    const odPC = snesToPC(0x4d0000 | faPtr);
    if (odPC >= 0 && odPC + 1 < rom.length) {
      const tile = u16le(rom, odPC) & 0x1ff;
      const size = FORMAT_A_CEL_SIZE[spriteId] ?? 16;
      count = 1;
      cel = applyCelFlip(
        [{ dx: 0, dy: 0, tile, paletteRow: 0, priority: 0, hflip: false, vflip: false, size }],
        hflip, vflip
      );
      if (spritePal !== 0) cel = cel.map((t) => ({ ...t, paletteRow: (t.paletteRow | spritePal) & 0x07 }));
    }
  }
  if (cel.length === 0 && !dynSrc) return null;

  // Runtime OAM-palette override (sprites that recolour in their Init handler —
  // the Red Coin 0x065). Replaces the cel's palette row outright, since the
  // handler clears $7042's palette bits before setting its own. See
  // spriteRuntimePaletteOverride.
  const palOverride = spriteRuntimePaletteOverride(rom, symbols, spriteId, levelSpritePaletteId);
  if (palOverride !== undefined) cel = cel.map((t) => ({ ...t, paletteRow: palOverride }));

  // Rigid dynamic-body sprites (registered in DYNAMIC_BODY_SOURCES) draw their
  // body from a chunky bank-$54 bitmap the GSU would rasterize at identity scale
  // (see sprite-dynamic-gfx.ts), bypassing the tile-base gate below (which exists
  // precisely because that gfx isn't in VRAM). The cel's body **placeholder**
  // records (tile===0 sentinel, tile>=256, or the per-sprite `placeholderTiles`)
  // are NOT blitted from VRAM — the GSU remaps them to the dynamic slot, so the
  // bitmap stands in for them; they're TAGGED `body` (kept IN the cel in OAM order,
  // not stripped) so the compositor draws the body at their z — deriving its
  // front/behind layering vs the real static parts (bucket lid, zeppelin balloons,
  // Flamer Guy's shy-guy) from the cel order rather than always compositing on top.
  // A cel's dynamic-slot placeholder record: tile-0 sentinel, an upper-page tile,
  // or a per-sprite `placeholderTiles` entry. Only meaningful when `dynSrc` is
  // set (both branches below are dynSrc-guarded); the `?.` keeps it safe to hoist.
  const isPlaceholder = (t: SpriteCel[number]): boolean =>
    t.tile === 0 || t.tile >= OBJ_LOWER_PAGE_TILES || (dynSrc?.placeholderTiles?.includes(t.tile) ?? false);
  let dynamicBody: DynamicBody | undefined;
  if (dynSrc?.staticsOnly) {
    // Render the static cel frame, not the bank-$54 body: drop the dynamic-slot
    // placeholder record(s) so they don't blit VRAM tile 0 as garbage. (No body.)
    cel = cel.filter((t) => !isPlaceholder(t));
  } else if (dynSrc) {
    const decoded = decodeDynamicBody(rom, symbols, spriteId);
    if (decoded) {
      const bodyRecs = cel.filter(isPlaceholder);
      // Origin: explicit override, else the placeholder records' bbox, else centred.
      let ox: number, oy: number;
      if (dynSrc.originX !== undefined) {
        ox = dynSrc.originX; oy = dynSrc.originY ?? 0;
      } else if (bodyRecs.length > 0) {
        ox = Math.min(...bodyRecs.map((t) => t.dx));
        oy = Math.min(...bodyRecs.map((t) => t.dy));
      } else {
        ox = -(decoded.width >> 1); oy = -(decoded.height >> 1);
      }
      cel = dynSrc.bodyOnly
        ? cel.filter(isPlaceholder).map((t) => ({ ...t, body: true })) // drop vestigial static frame, body only
        : cel.map((t) => (isPlaceholder(t) ? { ...t, body: true } : t)); // tag placeholders, keep OAM order
      // Whole-sprite flip (slot `$7042` bits, same as the cel) mirrors the body
      // bitmap too — e.g. 0x54 Upside-down Wild Piranha (V-flip) shares 0x66's
      // un-flipped source. The bbox/origin is preserved (flip is in-place).
      let indices = decoded.indices;
      if (hflip || vflip) {
        const w = decoded.width, h = decoded.height;
        const flipped = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          const sy = vflip ? h - 1 - y : y;
          for (let x = 0; x < w; x++) flipped[y * w + x] = decoded.indices[sy * w + (hflip ? w - 1 - x : x)]!;
        }
        indices = flipped;
      }
      dynamicBody = {
        indices,
        width: decoded.width,
        height: decoded.height,
        originX: ox,
        originY: oy,
        paletteRow: dynSrc.paletteRow
      };
    }
  }

  // Nothing left to draw (e.g. a table sprite whose body decode failed and whose
  // cel was empty / all-placeholder) → glyph tier.
  if (cel.length === 0 && !dynamicBody) return null;

  // Tile-base gate (see docstring): fileInfo==0 (tileRow 0) + upper-page cel tiles
  // = dynamically-allocated OBJ base, not statically derivable → skip — UNLESS we
  // resolved a rigid dynamic body above (then those upper-page records are drawn
  // from the bitmap, not VRAM).
  const tileRow = spriteTileRow(rom, symbols, header, spriteId);
  if (tileRow === 0 && !dynamicBody) {
    let maxTile = 0;
    for (const t of cel) if (t.tile > maxTile) maxTile = t.tile;
    if (maxTile >= OBJ_LOWER_PAGE_TILES) return null;
  }
  const tileBaseBytes = objNameBase(manifest) + tileRow * TILE_BYTES_4BPP;
  return { cel, tileBaseBytes, celPC, count, dynamicBody };
}
