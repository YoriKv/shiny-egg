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
import { SYNTHESIZED_CELS, SYNTHESIZED_CEL_PARITY_Y } from './sprite-synth-cel.ts';
import { parityIndex, SPRITE_PARITY_PALETTE } from './sprite-parity.ts';
import { REST_FRAME, FORMAT_A_NUMS } from './sprite-render-facts.ts';
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
/** Sprites we deliberately DON'T render (force glyph tier). All are spawned-only / never validly
 *  placed, with no correct static gfx, so we drop them rather than draw blank/garbage tiles:
 *   - $07B/$07C — the fired Bullet Bills (spawned-only projectiles from blasters $078/$079/$07A;
 *     only a vestigial shared special_chr cel $4D:1040).
 *   - $026 — the Bowser-battle Giant Egg: boss-spawned (0 instances), gfx-file-table 0, and its cel
 *     uses absolute slot-4 tiles ($180+) from a Bowser-fight-only load no editable level provides.
 *   - $04D — `UnusedSpriteIndex` ($02:9381): an unused/dead slot (0 instances) sharing the same
 *     vestigial $4D:1040 placeholder-quad cel ($180/$182/$1a0/$1a2) as $07B/$07C — renders only
 *     dynamic-slot garbage (an arch + two blobs), no real sprite.
 *  Their metadata is marked `spawnedOnly` and/or `spritesetFiles: null`. */
const RENDER_SUPPRESSED = new Set<number>([0x07b, 0x07c, 0x026, 0x04d]);

/**
 * "Render AS another sprite" — the placed sprite borrows a different id's entire cel render (chr cel,
 * palette/restFrame facts, tile base, $7042 seed). For sprites our generic cel path can't get right but
 * that are visually identical to a sprite it CAN, when the difference is runtime-only.
 *   Roger's Pot $034 → flower pot $0DA. Both are the same pot gfx (shared spriteset file $44, same tile
 *   base): $0DA (the item pot) renders correctly through its celB cel at pal 1; $034 (the boss pot)
 *   only differs at runtime (`init_roger` recolors it via a CGRAM load + spawns Roger), which the
 *   static render can't follow. So draw $034 as $0DA — the red/gold flower pot.
 */
export const SPRITE_RENDER_ALIAS: ReadonlyMap<number, number> = new Map([[0x034, 0x0da]]);
/** Number of OBJ tiles in the lower OBJ name page (256). The spriteset (upper
 *  page) starts here, at name base + 256*32 bytes. */
const OBJ_LOWER_PAGE_TILES = 256;
/** First tile of the SuperFX DYNAMIC OBJ region (VRAM `$B800`, OBJ tile 448 at
 *  name base $8000 + 448*32). Tiles `256..447` are the loaded **spriteset**
 *  (`$A000-$B7FF`, populated by `loadLevelGfx`); only `>= 448` is GSU-streamed
 *  per-frame and absent from any static VRAM. This is the real "not statically
 *  reproducible" boundary — the tile-base gate uses it (NOT 256, which wrongly
 *  treats the loaded spriteset as dynamic). */
const DYNAMIC_OBJ_TILE_BASE = 448;
/** The 32×32 dynamic-SLOT placeholder quad some dynbody sprites reference from the
 *  SPRITESET range (VRAM `$B000`, OBJ tile `0x180`) instead of the `>= 448` region —
 *  the 2×2 of 16×16 records `{0x180,0x182,0x1a0,0x1a2}` the GSU streams its body into.
 *  These ARE placeholders despite being `< 448`; the same 4 tiles recur verbatim across
 *  ~27 sprites (morph bubbles, logs, …), confirming a shared VRAM-slot convention, not
 *  per-sprite gfx. Used by `isPlaceholder` ALONGSIDE the `>= 448` gate so a real spriteset
 *  tile in `256..447` (e.g. Flamer Guy $0EC/$0ED's shy-guy body tile `0x1ae`) isn't
 *  mis-flagged — the bug a blanket `>= 256` caused (its body skipped, fire drawn over it). */
const SPRITESET_DYNAMIC_SLOT_TILES: ReadonlySet<number> = new Set([0x180, 0x182, 0x1a0, 0x1a2]);
const TILE_BYTES_4BPP = 32;
/** OBSEL = $02 → OBJ name base = 2 << 14 = $8000 bytes (the static in-level
 *  value; used as a fallback when no manifest is available to derive it). */
const DEFAULT_OBJ_NAME_BASE = 0x8000;

// SuperFX data tables are read by symbol (drift-proof, no hardcoded literal),
// using the canonical SuperFX-native `DATA_*` definition label (the actual `DATA_…:`
// in SuperFX/Banks/Bank0A.asm — the `FXDATA_*` form is just the 65816-side
// cross-reference alias). Resolves via the merged main+FX symbol map, same as
// `DATA_enemy_special_chr_addrs` below. `symbols.pc()` throws loud if absent.

/** The 6 spriteset file IDs in effect for a header's sprite tileset (asm DP
 *  $17..$1C) — the `spritesetOverride` (a minted set) when present, else the cart
 *  `DATA_spriteset_files` row. `loadLevelGfx` resolves the loaded VRAM from the
 *  exact same source, so a slot here always matches the file loaded there. */
function spritesetFiles(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset' | 'spritesetOverride'>
): number[] {
  if (header.spritesetOverride) return Array.from(header.spritesetOverride, (v) => v & 0xff);
  const base = symbols.pc('DATA_spriteset_files') + header.spriteTileset * 6;
  return [0, 1, 2, 3, 4, 5].map((i) => rom[base + i]!);
}

/** The variable spriteset gfx-file a sprite needs (`DATA_sprite_gfx_file_table[id]`
 *  low byte), or `null` when the sprite is common-page (table entry 0) or an
 *  ambient/special id (≥ {@link AMBIENT_SPRITE_ID_BASE}). The table is `u16 × 442`
 *  — exactly the normal-sprite range `$000..$1B9` — so ambient ids ($1BA+) have no
 *  entry and aren't spriteset-gated. Same byte `spriteTileRow` matches against the
 *  set. */
export function spriteRequiredFile(rom: Uint8Array, symbols: SymbolMap, spriteId: number): number | null {
  if (spriteId < 0 || spriteId >= AMBIENT_SPRITE_ID_BASE) return null;
  const full = u16le(rom, symbols.pc('DATA_sprite_gfx_file_table') + spriteId * 2);
  return full === 0 ? null : full & 0xff;
}

/**
 * "Mint" a 6-slot spriteset covering as many of a level's placed sprites' required
 * gfx files as fit — the static-render answer to *providing a valid spriteset* for
 * a level whose stock `header[7]` (or no stock set at all) doesn't cover its
 * sprites. Feed the returned `files` as `GfxHeader.spritesetOverride`.
 *
 * `required` is the distinct set of variable files the sprites need; `files` is
 * that set padded to 6 (extra slots repeat a required file — harmless, they're
 * never looked up). `overflow` is the files that didn't fit when `required` > 6
 * (the hardware 6-slot ceiling — those sprites can't all render at once, exactly
 * as on real cart); empty in the common case.
 */
export function mintSpriteset(
  rom: Uint8Array,
  symbols: SymbolMap,
  sprites: readonly Pick<import('../types.ts').LevelSprite, 'num'>[]
): { files: number[]; required: number[]; overflow: number[] } {
  const req = new Set<number>();
  for (const s of sprites) {
    const f = spriteRequiredFile(rom, symbols, s.num);
    if (f != null) req.add(f);
  }
  const required = [...req].sort((a, b) => a - b);
  const files = required.slice(0, 6);
  const overflow = required.slice(6);
  while (files.length < 6) files.push(files[0] ?? 0);
  return { files, required, overflow };
}

/**
 * Resolve the 6-slot spriteset to render a level's sprites, PREFERRING the authored
 * `header[7]` set and preserving its slot assignments wherever a placed sprite's cel
 * actually reads from a slot. This is the robust counterpart to {@link mintSpriteset}:
 * it sees the sprites that `mintSpriteset` is blind to — those whose
 * `DATA_sprite_gfx_file_table` entry is 0 yet whose cel hard-codes a spriteset slot
 * (synth-cel boo guys `$105/$106` read slot 3, Silver Tap-Tap `$10B` reads slot 5).
 * A naive mint drops the authored file in that slot and renders garbage.
 *
 * Algorithm: start from the authored spriteset; mark every slot any placed sprite's
 * cel reads (its spriteset-region tiles 256..447, resolved against the authored set);
 * then for each `gfx_file_table`-required file not already present, swap it into a slot
 * that is NEITHER cel-read NOR already required (so a needed file is never evicted).
 * `minted` = the authored set was changed; `overflow` = required files with no free
 * slot (the 6-slot hardware ceiling). Feed `files` as `GfxHeader.spritesetOverride`
 * only when `minted` (else keep the authored set, i.e. pass no override).
 */
export function resolveLevelSpriteset(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset'>,
  sprites: readonly Pick<import('../types.ts').LevelSprite, 'num'>[],
  // Optional caller-supplied EXTRA files a sprite needs beyond its single
  // DATA_sprite_gfx_file_table entry — for composite sprites whose body reuses
  // another sprite's gfx file (the para-Koopas $16D-$16F need the Koopa body file
  // $47 on top of their own $2B). The 1-entry cart table can't express this; the
  // caller (e.g. the defunct-levels gallery) sources it from obj-metadata's curated
  // spritesetFiles. Omitted ⇒ unchanged behaviour.
  extraRequiredFiles?: ReadonlyMap<number, readonly number[]>
): { files: number[]; required: number[]; overflow: number[]; minted: boolean } {
  const base = symbols.pc('DATA_spriteset_files') + (header.spriteTileset ?? 0) * 6;
  const files = [0, 1, 2, 3, 4, 5].map((i) => rom[base + i]!); // authored, slot-indexed
  // One pass over the sprites collects: the slots any cel reads (its spriteset-region
  // tiles, resolved against the AUTHORED set — so a gfx_file_table=0 synth/absolute cel
  // that hard-codes a slot, boo guys → slot 3, tap-tap → slot 5, locks the authored file
  // there); the gfx_file_table-required files; and how many sprite INSTANCES need each
  // file (the file a sprite needs = its gfx_file_table file ∪ the authored files at the
  // slots its cel reads). The instance count drives overflow: when the 6-slot ceiling is
  // hit, the file serving the FEWEST sprites is the one dropped.
  const usedSlots = new Set<number>();
  const required = new Set<number>();
  const count = new Map<number, number>();
  const pinRequests = new Map<number, Set<number>>(); // contested slot → gotcha files wanting it
  let minted = false;
  for (const s of sprites) {
    const needs = new Set<number>();
    const rf = spriteRequiredFile(rom, symbols, s.num);
    if (rf != null) { required.add(rf); needs.add(rf); }
    const extra = extraRequiredFiles?.get(s.num);
    if (extra) for (const f of extra) { required.add(f); needs.add(f); }
    let cel: ReturnType<typeof resolveSpriteCel>;
    try { cel = resolveSpriteCel(rom, symbols, header, s.num, undefined, FORMAT_A_NUMS.has(s.num), undefined, undefined, undefined, REST_FRAME.get(s.num)); }
    catch { cel = null; }
    if (cel) for (const t of cel.cel) {
      if (t.tile >= OBJ_LOWER_PAGE_TILES && t.tile < DYNAMIC_OBJ_TILE_BASE) {
        const slot = ((t.tile - OBJ_LOWER_PAGE_TILES) / 32) | 0;
        usedSlots.add(slot);
        // Slot-hardcoded gotcha sprites (gotcha #9): a sprite whose caller declares exactly
        // ONE file (its DATA_sprite_gfx_file_table is 0, so the mint can't see the need)
        // reads a FIXED slot that MUST hold that file — e.g. the Tap-Taps' body tiles
        // 427/443 = slot 5 ← 0x29. DEFER the pin (resolved below by instance count) so two
        // sprites hardcoding the SAME slot to DIFFERENT files (a foreign level co-placing
        // them) are arbitrated instead of clobbering each other last-write-wins. (Single-file
        // only — a multi-file composite's slot↔file pairing is ambiguous, so those just stay
        // required-files.)
        if (extra && extra.length === 1) {
          (pinRequests.get(slot) ?? pinRequests.set(slot, new Set()).get(slot)!).add(extra[0]!);
          needs.add(extra[0]!);
        } else {
          needs.add(files[slot]!); // the authored file at this slot
        }
      }
    }
    for (const f of needs) count.set(f, (count.get(f) ?? 0) + 1);
  }
  const overflow: number[] = [];
  // Apply the deferred gotcha pins: per contested slot the file serving the MOST sprites
  // wins (count, then lower file id); a competing loser file OVERFLOWS — the slot can't hold
  // both at once, so the multi-pass renderer (resolveLevelSpritesetPasses) draws the loser
  // from a later pass. (No-op for an uncontested slot — winner = its only requested file —
  // so shipped levels, which never co-place two slot-clashing gotcha sprites, are unchanged.)
  for (const [slot, wanted] of pinRequests) {
    const winner = [...wanted].sort((a, b) => (count.get(b)! - count.get(a)!) || a - b)[0]!;
    if (files[slot] !== winner) { files[slot] = winner; minted = true; }
    for (const f of wanted) if (f !== winner) overflow.push(f);
  }
  // Place missing required files MOST-NEEDED first; when no slot is free, evict the
  // present file serving the FEWEST sprites (if fewer than this one) — so a high-traffic
  // sprite (the 7 bandits, file $4E) wins a slot over a 2-instance piranha file ($29).
  // Pin losers are excluded — they're slot-hardcoded, so a free slot can't help them.
  const missing = [...required].filter((f) => !files.includes(f) && !overflow.includes(f)).sort((a, b) => (count.get(b)! - count.get(a)!) || a - b);
  for (const f of missing) {
    let slot = files.findIndex((file, i) => !usedSlots.has(i) && !required.has(file)); // a free filler slot
    if (slot < 0) { // no free slot: drop the lowest-count present file, but only if it serves fewer sprites
      let lo = -1, loCount = count.get(f) ?? 0;
      for (let i = 0; i < 6; i++) { const c = count.get(files[i]!) ?? 0; if (c < loCount) { loCount = c; lo = i; } }
      if (lo < 0) { overflow.push(f); continue; } // f is itself the least-needed → it overflows
      overflow.push(files[lo]!);
      slot = lo;
    }
    files[slot] = f; usedSlots.add(slot); minted = true;
  }
  // Dedupe + drop any overflow file that ended up placed (a pin loser that also won elsewhere).
  const overflowFinal = [...new Set(overflow)].filter((f) => !files.includes(f));
  return { files, required: [...required].sort((a, b) => a - b), overflow: overflowFinal.sort((a, b) => a - b), minted };
}

/**
 * A SEQUENCE of 6-slot spritesets that together cover EVERY placed sprite's gfx —
 * for a static-render path that wants to show all sprites even when a level needs
 * more than 6 files (the >6 hardware-overflow levels). Pass 0 is the best single set
 * ({@link resolveLevelSpriteset}); each subsequent pass covers the sprites the prior
 * passes overflowed. A renderer draws the sprite layer once per pass and takes each
 * sprite from the FIRST pass whose set loads its file (see
 * `renderLevelSpriteLayerMultiPass`). One pass for an ordinary level; rarely >2.
 * NOTE: not a faithful single-VRAM view — the cart can't load all these at once.
 */
export function resolveLevelSpritesetPasses(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset'>,
  sprites: readonly Pick<import('../types.ts').LevelSprite, 'num'>[],
  extraRequiredFiles?: ReadonlyMap<number, readonly number[]> // see resolveLevelSpriteset
): number[][] {
  const passes: number[][] = [];
  let remaining = sprites;
  for (let guard = 0; guard < 8 && remaining.length; guard++) {
    const r = resolveLevelSpriteset(rom, symbols, header, remaining, extraRequiredFiles);
    passes.push(r.files);
    if (!r.overflow.length) break;
    // Re-render the sprites this pass couldn't fully serve. A composite needs ALL its
    // files (gfx-file-table ∪ caller extras) co-located in ONE pass, so re-include it
    // whenever ANY needed file is missing from this pass's set — not only when its single
    // gfx-file-table file overflowed (which would strand a para-Koopa's body file $47 in
    // a later pass while the bird itself is drawn from the pass holding its wing file).
    const inPass = new Set(r.files);
    remaining = remaining.filter((s) => {
      const f = spriteRequiredFile(rom, symbols, s.num);
      const needed = f != null ? [f] : [];
      const ex = extraRequiredFiles?.get(s.num);
      if (ex) needed.push(...ex);
      return needed.some((nf) => !inPass.has(nf));
    });
  }
  return passes;
}

/** Stock spriteset count = `DATA_spriteset_files` rows (768 bytes / 6). The
 *  header's sprite-tileset field is 7-bit, so the table is exactly full — there
 *  are no unused ids to mint into (a custom set must overwrite a free row or grow
 *  the table). */
export const STOCK_SPRITESET_COUNT = 128;

/**
 * Pick the STOCK spriteset (0..127) that best covers a level's placed sprites —
 * the "fit spriteset to this level's sprites" answer (no minting; just chooses
 * the best existing `header[7]`). Scores each spriteset by the number of sprite
 * INSTANCES whose required gfx file (`DATA_sprite_gfx_file_table`) it loads;
 * highest wins (tie → more distinct files covered, then lowest id, for
 * determinism). Common-page / ambient sprites are never file-gated, so a level
 * with none trivially "fits" — we keep id 0 to minimise surprise.
 *
 * Returns the chosen id + coverage: `servedInstances` of `gatedInstances` (the
 * placed sprites that need a variable file) and the `missingFiles` the winner
 * still can't load (non-empty ⇒ some sprites will render wrong in-game — the
 * 6-slot ceiling, or no single stock set covers this mix).
 */
export function bestStockSpriteset(
  rom: Uint8Array,
  symbols: SymbolMap,
  sprites: readonly Pick<import('../types.ts').LevelSprite, 'num'>[]
): { spriteTileset: number; servedInstances: number; gatedInstances: number; missingFiles: number[] } {
  const need = new Map<number, number>(); // required file → instance count
  for (const s of sprites) {
    const f = spriteRequiredFile(rom, symbols, s.num);
    if (f != null) need.set(f, (need.get(f) ?? 0) + 1);
  }
  const gatedInstances = [...need.values()].reduce((a, b) => a + b, 0);
  const base = symbols.pc('DATA_spriteset_files');
  const rowFiles = (id: number): number[] => [0, 1, 2, 3, 4, 5].map((k) => rom[base + id * 6 + k]!);
  let best = { id: 0, served: -1, distinct: -1 };
  for (let i = 0; i < STOCK_SPRITESET_COUNT; i++) {
    const set = new Set(rowFiles(i));
    let served = 0;
    let distinct = 0;
    for (const [f, c] of need) if (set.has(f)) { served += c; distinct++; }
    if (served > best.served || (served === best.served && distinct > best.distinct)) {
      best = { id: i, served, distinct };
    }
  }
  const winner = new Set(rowFiles(best.id));
  const missingFiles = [...need.keys()].filter((f) => !winner.has(f)).sort((a, b) => a - b);
  return { spriteTileset: best.id, servedInstances: Math.max(best.served, 0), gatedInstances, missingFiles };
}

/**
 * GoldenEgg `_spriteTileRow` for one sprite ID: the OBJ tile-row base the cel
 * tiles are relative to. 0 = common-page sprite (tiles at the OBJ name base);
 * `slot*32 | 256` = spriteset-slot sprite (upper OBJ page).
 */
export function spriteTileRow(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset' | 'spritesetOverride'>,
  spriteId: number
): number {
  // sprite-ID → required-gfx-file-id table (u16 × 442) = DATA_sprite_gfx_file_table ($0A:A716).
  const requiredFileId = u16le(rom, symbols.pc('DATA_sprite_gfx_file_table') + spriteId * 2);
  if (requiredFileId === 0) return 0;
  const spriteset = spritesetFiles(rom, symbols, header);
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
  header: Pick<GfxHeader, 'spriteTileset' | 'spritesetOverride'>,
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
 * the sprite's initial render-control flags — bits `$000C` are the GSU off-screen-cull
 * despawn-threshold index (the cull at `FXCODE_098925` does `AND #12`; the OAM renderer
 * dispatches on bits 0-1 via `FXCODE_098AC2` `AND #3`), NOT "draw" bits and NOT a static
 * draw gate. They are RUNTIME-managed (re-derived on reactivation via `AND #$000C`
 * at `$03:9D96`, cleared while the sprite is held on Yoshi's tongue —
 * `CODE_spr_state_tongued` `$03:9AC8` — to exempt it from the cull while carried), and
 * verified irrelevant to drawing: rendered sprites carry `$00`/`$04`/`$08` there with no
 * correlation to whether the sprite draws (e.g. Wild Piranha 0x66 = `$00` yet renders).
 * So the low byte is irrelevant to a static frame-0 render. Count validated byte-exact
 * vs 5 BizHawk traces.
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
 * (they stamp tiles like std/ext objects) — a future enhancement
 * (plan-editor-remaining.md, sprite render residuals).
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
 * Runtime OAM-palette override for the few sprites that recolor themselves in
 * their Init handler. The static `$7042` seed (`DATA_0A9F1A`) is only the
 * *un-initialised* palette; these sprites clear it and recompute their palette at
 * spawn from level state, so a static render shows the wrong color. We can't run
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
/**
 * Hand-curated Format-A per-sprite overrides (the two same-kind Format-A maps, merged):
 *   `size` — OBJ size when the 16×16 default is wrong (0x183 Butterfly is 8×8; the 16×16 default
 *            oversized it + pulled unrelated tiles tile+1/+$10/+$11).
 *   `tile` — tileRow-RELATIVE tile when `object_data[0]` (frame 0) is the wrong ANIMATION FRAME
 *            for normal play. Format A has no frame table (one tile, runtime-animated), so the
 *            static decode draws frame 0. Value = the in-play frame's relative tile (captured-tile
 *            − tileRow), recovered from the v2 capture (`tmp/tier1-probe.ts`). Drift-safe.
 *     $022-$025 Eggs (flash frame 130→128), $031 Potted Spiked Fun Guy (8→10), $183 Butterfly (3→19).
 * CRITICAL (tile): only override to a tile in the STATIC (level-loaded) VRAM. A Format-A sprite
 * animates by STREAMING later frames, so a captured in-play frame may be a tile NOT in the editor's
 * loaded gfx — overriding to it renders BLANK ($0E0 Preying Mantas →2 and $182 Dragonfly →18 were
 * reverted for exactly this). object_data frame 0 is always the loaded base. Verify new entries vs
 * STATIC VRAM (tmp/static-render-check.ts). NB: Coins ($065/$1AF) and $074 are deliberately NOT
 * overridden.
 */
const FORMAT_A_OVERRIDES: Record<number, { size?: 8 | 16; tile?: number }> = {
  0x022: { tile: 128 }, 0x023: { tile: 128 }, 0x024: { tile: 128 }, 0x025: { tile: 128 },
  0x031: { tile: 10 },
  0x183: { size: 8, tile: 19 },
  // WRONG-CEL frame/tile fixes (v2 capture-validated — object_data[0] is not the in-play frame).
  // SIZE is the OAM size bit (oambuf byte6 bit1, per record) — default 16×16; only the genuinely
  // 8×8 OBJs get size:8. (Earlier these mis-read the size from a non-existent high table → coins
  // wrongly 8×8/quarter-size; corrected 2026-06-17.)
  // NB: the Coins ($065/$1AF, shared object_data) are NOT overridden — their object_data frame 0 =
  // tile 160 IS the full FRONT-view coin (the 4 spin frames are 160=front / 92=edge / 96 / 92-flip;
  // a WRONG-CEL pass had forced the edge frame 92 = "partially rotated", user-rejected 2026-06-17).
  0x074: { tile: 2 }, //          Spike ball thrower: standing WALK/idle frame (object_data[1]=tile 2,
  //                              16×16). Its walk cycle is object_data 0-3 (tiles 0/2/4/6); frame 4
  //                              = tile 8 is the SPIT action (mouth open w/ ball, `main_spike` state
  //                              0 spit-trigger) — wrong as a static rest pose. Tile 2 is the upright
  //                              standing frame (vs the hunched/head-down tile 0).
  0x0e0: { tile: 2 }, //          Preying Mantas: in-play tile 2 (16×16)
  0x182: { size: 8, tile: 18 } // Dragonfly: in-play tile 18 (8×8 — matches the $183 butterfly pair)
};

/**
 * Frame-0 record-count override for sprites that SHARE a sibling's special_chr cel but whose OWN
 * DATA_sprite_render_control_table frame-0 count is 0 — the runtime configures their OBJ count via
 * the shared handler, not the per-sprite table, so the static decode would read an empty cel and
 * fall through to the glyph tier. Supply the sibling's frame-0 record count.
 *   $05C Pink Toady shares $058 Green Toady's special_chr ($2dd2) + handler (main_toadies) — same
 *   gfx, only the palette differs (pink = spritePal 4, baked in DATA_0A9F1A; green = 0). Its own
 *   control-table count is 0; borrow the green toady's 5 so it renders the (pink) toady cel.
 */
// $034 Roger's Pot: the cart OAMByteCount (5) is just the pot body — the visible rest pose is the
// flower pot (like $0DA), pot records [0-4] + flower records [5-7], = 8. (Records [8-11] are a
// different/anim element absent from the spr-034 capture.) Paired with settledPaletteRow 6 so the
// pot body (cel pal0) matches the flowers' pal6, the capture's uniform pot palette.
const FRAME0_COUNT_OVERRIDE: Record<number, number> = { 0x05c: 5, 0x034: 8 };

/**
 * Per-record patches to a decoded `special_chr` frame-0 cel, applied after decode+flip.
 * For sprites whose static cel has a PLACEHOLDER tile the handler overwrites at runtime
 * with a separately-drawn, separately-palettized element. Keyed by sprite id → list of
 * `{ index, tile?, paletteRow?, lockPalette? }`:
 *   - 0x133 Lantern Ghost record 0 (the held lantern): the special_chr stores a redundant
 *     body tile $100 there (renders as an "extra head"); in-game the handler draws the lantern
 *     flame tile $11b at a FIXED flame palette (pal1) regardless of the body's spawn-cell-parity
 *     color. So patch the tile to $11b and LOCK pal1 (capture-confirmed: body pal4, lantern pal1).
 */
const SPECIAL_CHR_RECORD_OVERRIDE: Record<number, ReadonlyArray<{ index: number; tile?: number; paletteRow?: number; lockPalette?: boolean; dx?: number; dy?: number; size?: 8 | 16; static?: boolean; drop?: boolean }>> = {
  // Nep-Enut / Gargantua Blargg $0A5: cel records [10][11] are tile-0 dynamic-SLOT placeholders
  // (the GSU mouth/face it rotozoom-streams — `main_nep_enut` FXCODE_088205; capture resolves
  // them to the dynamic tile 382). It's a celB sprite (not in DYNAMIC_BODY_SOURCES), so tile 0
  // isn't gated as a placeholder and blits common-page tile 0 = a stray "tooth" in the centre of
  // the face. Drop them (we don't render GSU-streamed tiles); the eyes/spikes records [0]-[9] are
  // the static figure. (User-reported; asm + v2-capture confirmed.)
  0x0a5: [{ index: 10, drop: true }, { index: 11, drop: true }],
  0x133: [{ index: 0, tile: 0x11b, paletteRow: 1, lockPalette: true }],
  // Tap-Tap $03C's red NOSE. It's special_chr cel rec[0] — a real STATIC spriteset
  // tile (the boss's own gfx file 0x4D, which every Tap-Tap-fort SpriteTileset loads
  // into spriteset slot 0 → VRAM tile 0x10E), NOT a GSU body part. The raw cel tile
  // 0x14E resolves *absolutely* (DATA_0AA716[$03C]=0 ⇒ spriteTileRow can't slot-shift
  // it) to slot 2 = file 0x48 = a Boo, so pin it to slot-0 0x10E. `static:true` keeps
  // the dynbody path from eating it as a ≥256 placeholder. dx/dy place it up-left of
  // the face from the $03C capture OAM (nose at body-local (4,15); body origin
  // (-33,-37)). See sprite-dynamic-gfx.ts $03c entry + notes-sprite-render.md §5 GOTCHA.
  0x03c: [{ index: 0, tile: 0x10e, dx: -29, dy: -22, size: 16, paletteRow: 6, lockPalette: true, static: true }],
  // Spiked log on pulley $126 — cel records [0][1] (the dy0 mid-log row) are wrong: celPal 0 (blue)
  // AND tile 0x5 (an odd tile that interleaves the 0x4/0x6 wood sub-tiles → garbled). The rest of the
  // wooden log is pal4 with even body tiles; record [5][6] (the dy-8 body row) are 0x4 (L)/0x6 (R), so
  // make this row match: tile 0x4/0x6, pal4.
  0x126: [{ index: 0, tile: 0x4, paletteRow: 4 }, { index: 1, tile: 0x6, paletteRow: 4 }],
  // Burt $0E7's two FEET. cel records [0][1] are tile-0 dynamic-SLOT placeholders, but a live
  // BizHawk OAM+VRAM trace (lvl 0x03) shows the engine fills them with STATIC spriteset tile 0x9e
  // (a little shoe), drawn as a mirrored 8×8 pair at the bottom-centre IN FRONT of the GSU body
  // (records [0][1] are frontmost). DATA_0AA716[$0E7]=0 ⇒ tile 0x9e resolves absolutely (no slot
  // shift), like the Tap-Tap nose $03C. `static:true` keeps the dynbody path from eating them as
  // body placeholders; the body (records [2]-[5]) still draws from the bank-$54 entry. The cel's
  // own per-record flip is preserved (record 0 hflipped, record 1 not → the L/R foot pair).
  0x0e7: [{ index: 0, tile: 0x9e, paletteRow: 0, lockPalette: true, static: true }, { index: 1, tile: 0x9e, paletteRow: 0, lockPalette: true, static: true }],
  // Muddy Buddy $063 — its special_chr cel reserves a 32×32 dynamic-OBJ slot (records [0]-[3], the
  // $1c0/$1c2/$1e0/$1e2 quad) for the body's MAX (scale-up attack) size, but the rest body is 16×16
  // at unit scale (see DYNAMIC_BODY_SOURCES $063). Those placeholders are invisible (the body draws
  // from the bank-$54 entry at its explicit origin) yet inflated the cel bbox to 32×32 — making the
  // editor hit-test/outline 2× the visible body. Drop them; the real feet (records [4][5], tile $9e)
  // remain and the dynbody draws cel-less at its origin, so the bbox = the 16×16 body + feet.
  0x063: [{ index: 0, drop: true }, { index: 1, drop: true }, { index: 2, drop: true }, { index: 3, drop: true }],
  // Naked ("Beach") Koopas $169/$16A — the shell-less Koopa. They SHARE the shelled Koopa's cel
  // ($16B/$16C, ptr 0xAA9B) verbatim, so they'd render WITH a shell. A live OAM capture (Mesen
  // dynbody-transform trace, warp-to-cell spawn) of $16B shelled vs $169 naked, anchor-aligned,
  // shows they differ in exactly ONE record: the body. Shelled draws the shell tile (rel 0xA, pal0
  // green / pal1 red); naked draws the bare-torso tile (rel 0x4, pal1 orange). At the rest frame
  // (frame 0, the upright $0AE pose) the shell is record index 3 — swap it to the naked body.
  // (Head/feet are shared, unchanged.)
  0x169: [{ index: 3, tile: 0x4, paletteRow: 1, lockPalette: true }],
  0x16a: [{ index: 3, tile: 0x4, paletteRow: 1, lockPalette: true }]
  // ($10C Chained Spike Ball: rendered by CUSTOM_SPRITE_RENDERERS — a Boo-Guy/pulley ($10D) at top,
  //  an 11-link GSU chain ($55:00C0), and the spike-ball dynbody ($55:00A0) at the bottom. Its cel
  //  stacks every piece at one spot, so it can't be expressed by per-record patches here.)
};

/**
 * Per-sprite OBJ-palette-row REMAP applied to a decoded `special_chr` cel: `{ srcRow → dstRow }`.
 * For sprites whose static cel encodes a PLACEHOLDER palette row that the cart's GSU OAM assembler
 * masks off and replaces at runtime — so the cel's row is meaningless and our (celRow | $7042) model
 * renders the wrong color. The asm proof: the special_chr→OAM builder (`CODE_098B85`/`CODE_098C93`,
 * GSU Bank09) reads each cel record, `AND`s the attribute word with `$F1FF` (clearing the 3 palette
 * bits), then `ADD`s the sprite's runtime palette from GSU RAM `($00)`. The cel palette never reaches
 * OAM. Applied AFTER decode, BEFORE the `$7042` whole-sprite OR (so the OR still distinguishes the
 * green/red shell variant — see below).
 *
 *   Koopa family $169-$16F (naked / shelled / para; green $16B + red $16C literally SHARE one cel,
 *   ptr 0xAA9B) + Hookbill the Koopa boss $0AE (same spriteset file 0x47, same {row7 skin / row0
 *   shell} cel split — it's a big green Koopa). The cel splits each frame into skin records (row 7)
 *   + shell records (row 0). Row 7 is the GSU's masked placeholder; the real skin is OBJ pal 1
 *   (row 9: idx 6/7 = orange #FE7A00 / gold #FEC400, idx 2 = white face, idx 11 = cyan eye — all in
 *   the GLOBAL fixed sprite-palette range, so consistent across levels). Remap row 7 → 1; the shell
 *   records keep row 0 and get the $7042 OR (green $16B $7042=0 → shell stays pal0 = green idx3-5;
 *   red $16C $7042=1 → shell pal1 = red idx3-5). Skin row 1 | $7042∈{0,1} = 1 either way. Confirmed
 *   vs headless EmuHawk capture (translevel 0x2A green / 0x0C red): a uniform pal-1 (the GSU's actual
 *   model over its ANIMATED tiles) turns our STATIC shell tiles red, so the static-cel renderer needs
 *   this split, not uniform. ($0AE Hookbill: same green-koopa structure, renders in arena 0x86.)
 */
const CEL_PALETTE_REMAP: Record<number, Readonly<Record<number, number>>> = {
  0x0ae: { 7: 1 },
  0x169: { 7: 1 }, 0x16a: { 7: 1 }, 0x16b: { 7: 1 }, 0x16c: { 7: 1 },
  0x16d: { 7: 1 }, 0x16e: { 7: 1 }, 0x16f: { 7: 1 }
};

/**
 * Per-sprite SPAWN OFFSET (px) — sprites whose Init snaps their position off the placed cell
 * before first draw, so the cel must shift by the same delta to match the game (the editor
 * anchors at the cell and doesn't run the Init). Applied to every cel record's dx/dy. (Most
 * init-shifts are deliberately NOT mirrored — see the arrow-sign note — only the ones a user
 * confirmed look wrong are listed here.)
 *   $1A4 Cork — `init_cork` (Bank07:15826) does X+=8, Y-=7 ("snap to 8-px grid; line up with
 *   the keyhole tile"), so it draws half a tile right + 7px up of its cell.
 */
const SPRITE_SPAWN_OFFSET: Record<number, { dx: number; dy: number }> = {
  0x1a4: { dx: 8, dy: -7 }
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
 *
 * `cels` (optional): a per-parity HAND-AUTHORED cel (4 entries, indexed the same).
 * For sprites whose Init picks a different-SIZED figure / arrangement by parity (not
 * just a frame/flip of one figure), so neither a frame step nor a record-count slice
 * can express it. When present, the variant's cel is used VERBATIM (tileRow-relative
 * tiles, like a SYNTHESIZED_CEL — the gfx still comes from loaded VRAM), with each
 * figure anchored on its own terms. The whole-sprite `$7042` flip/palette still apply.
 *  - 0x071 Big Boo (`init_big_boo`, Bank0C.asm:11115): X pos bit4 branches the init
 *    (X-even = the Big Boo + 3 companion Boos, count 8; X-odd ORs `$7040` from
 *    `DATA_0CD4F1` by Y bit4 → `$2005`=4 records "Big Boo" / `$0804`=1 record "Boo").
 *    Its 4-part name maps 1:1 to the 4 parities. The cel positions the companions at a
 *    spawn offset (they orbit at runtime), so we hand-place them in a row at the Big
 *    Boo's Y; the lone Boo is re-centred (the cel's count-1 slice is a big-boo corner).
 *    Body tiles rel 4/6/12/14 (2×2), companion/Boo tile rel 46. pal via the seed (1).
 */
const booRec = (dx: number, dy: number, tile: number): SpriteCel[number] =>
  ({ dx, dy, tile, paletteRow: 0, priority: 0, hflip: false, vflip: false, size: 16 });
const BIGBOO_BODY: SpriteCel = [booRec(-8, -8, 4), booRec(8, -8, 6), booRec(-8, 8, 12), booRec(8, 8, 14)];
const BIGBOO_3BOOS: SpriteCel = [...BIGBOO_BODY, booRec(24, 0, 46), booRec(40, 0, 46), booRec(56, 0, 46)];
const PARITY_CEL_VARIANTS: Record<number, { frames?: readonly number[]; flips?: readonly number[]; cels?: readonly SpriteCel[] }> = {
  0x197: { frames: [0, 1, 1, 0], flips: [0x00, 0x40, 0x80, 0xc0] },
  0x198: { frames: [2, 2, 2, 2], flips: [0x00, 0x40, 0x80, 0xc0] },
  // idx = 2*(y&1)+(x&1): x-even (0,2) = Big Boo w/ 3 Boos; x-odd y-even (1) = Big Boo;
  // x-odd y-odd (3) = lone Boo (re-centred on the cell).
  0x071: { cels: [BIGBOO_3BOOS, BIGBOO_BODY, BIGBOO_3BOOS, [booRec(0, 0, 46)]] }
};

/** Parity-cel variant index (0..3) for a placement, or `null` when `spriteId`
 *  has no placement-parity cel. The sprite layer keys its per-num cel cache by
 *  this (the cel bitmap is a function of (num, index), not num alone). */
export function parityCelVariantIndex(spriteId: number, xCell: number, yCell: number): number | null {
  // PARITY_CEL_VARIANTS (special_chr sprites) + Y-parity synth cels (handler-drawn pinwheels
  // whose radius is chosen by cellY parity) both resolve a DIFFERENT cel per placement, so the
  // layer must key its cache per parity. (The synth case only varies by Y, but reusing the
  // 2*(y&1)+(x&1) key just adds harmless redundant cache entries.)
  return spriteId in PARITY_CEL_VARIANTS || spriteId in SYNTHESIZED_CEL_PARITY_Y
    ? parityIndex(xCell, yCell)
    : null;
}

// ── THE sprite render-resolution model (authoritative; this function enforces it) ───────────
// A sprite's appearance is asm-fixed; the per-sprite overrides below capture the parts the cart
// tables don't, and they COMPOSE (they are NOT a one-kind-per-sprite union — e.g. the piranhas
// $054/$066/$09F use a synth-cel stem AND a dynamic-body head; $183 uses both a Format-A size and
// tile override). resolveSpriteCel applies them in this order:
//   1. Cart cel tables — Format-B `special_chr` (the dominant path) or Format-A `object_data`
//      (items, when preferFormatA / no Format-B). FORMAT_A_OVERRIDES tweaks the A size/frame.
//   2. PARITY_CEL_VARIANTS — per-cell-parity frame/flip or hand-authored cel (arrow signs, Big Boo).
//   3. SYNTHESIZED_CELS (+ SYNTHESIZED_CEL_PARITY_Y) — hand-authored layout for handler-drawn
//      sprites with no usable cart cel; OVERRIDES a partial cart decode, COMPOSES with a body.
//   4. Palette/frame facts — settledPaletteRow (SP4) + restFrame (SP3) from sprite-render-facts.ts,
//      and the conditional spriteRuntimePaletteOverride (Red Coin); forced onto the cel.
//   5. DYNAMIC_BODY_SOURCES — a chunky bank-$54 body composited into the cel (placeholders tagged).
// (CUSTOM_SPRITE_RENDERERS — the flipper — is a last-resort offramp consulted by the LAYER before
//  this function, not here.) The cel-format gate (CEL_B/FORMAT_A_NUMS) is engine-owned too.
export function resolveSpriteCel(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: Pick<GfxHeader, 'spriteTileset' | 'spritesetOverride'>,
  spriteId: number,
  manifest?: GfxFileEntry[],
  /** Force the Format-A path even if the sprite also has a `special_chr` cel.
   *  Set by the layer for sprites the categorization trace classed `cel: 'A'`
   *  (e.g. the Key, which carries both tables but draws Format A). */
  preferFormatA = false,
  /** The level's sprite-palette id (`LevelHeaderSpritePaletteLo`, header field 8).
   *  Only consulted by `spriteRuntimePaletteOverride` (the Red Coin's level-state-
   *  dependent recolor). Omit for the static seed palette. */
  levelSpritePaletteId?: number,
  /** Spawn CELL coordinates — only consulted for `PARITY_CEL_VARIANTS` sprites
   *  (the arrow signs), whose frame + flip depend on cell parity. Omit to render
   *  the parity-0 variant (e.g. pickers/galleries with no placement). */
  placement?: { x: number; y: number },
  /** Pre-resolved settled OBJ palette row (0–7) for this sprite — the
   *  `settledPaletteRow` baked from the sprite-render trace (SP4). When supplied,
   *  it FORCES the cel's palette row, replacing the `$7042` seed for sprites that
   *  recolor at spawn. The conditional Red Coin override (`spriteRuntimePaletteOverride`)
   *  takes precedence when both apply. Omit for the static-seed palette. */
  settledPaletteRow?: number,
  /** Pre-resolved animation frame the sprite visibly RESTS at (`restFrame` baked
   *  from the sprite-render-v2 trace), when the frame-0 `special_chr` cel is the
   *  wrong pose (e.g. winged clouds rest at frame 4). When supplied the decoder
   *  steps to that frame AND skips the tile-base gate (v2 verified it renders from
   *  the level's loaded VRAM, so the "upper-page ⇒ dynamic" assumption doesn't
   *  apply). Mutually exclusive with PARITY_CEL_VARIANTS. Omit for frame 0. */
  restFrame?: number
): ResolvedSpriteCel | null {
  // Ambient sprites (triggers / generators / VFX) are not level visuals.
  if (spriteId >= AMBIENT_SPRITE_ID_BASE) return null;
  // Deliberately non-rendered sprites (spawned-only projectiles with no valid static gfx).
  if (RENDER_SUPPRESSED.has(spriteId)) return null;
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
  // Handler-drawn sprites with a hand-recovered layout (no cel/object_data table
  // entry) still render via SYNTHESIZED_CELS, so don't early-out on those.
  if (ptr === 0 && !dynSrc && faPtr === 0 && !SYNTHESIZED_CELS[spriteId]) return null;
  // Per-sprite OAM attr (slot `$7042` = `DATA_0A9F1A[id]` high byte EOR $20): the
  // whole-sprite X/Y flip (bit6/bit7) AND the sprite's palette row (bits1-3) —
  // neither is carried by the cel stream. Mirrored variants share a cel + set a
  // flip (0x54 vs 0x66); the palette row tints the shared gfx (e.g. Pink Pinwheel
  // pal 4). It OR-combines with the cel record's own palette (cel pals are
  // normally 0, so this just selects the sprite's row; a cel that sets its own
  // non-zero row — e.g. Crazee Dayzee pal 4, whose `$7042` is 0 — is preserved).
  // NB: shy guys also recolor by map position at runtime (their Init/Main); we
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
      count = FRAME0_COUNT_OVERRIDE[spriteId] ?? spriteFrame0RecordCount(rom, symbols, spriteId);
      // Placement-parity variant (arrow signs / Big Boo): step to the parity-selected
      // frame, or use a hand-authored per-parity cel. Index by cell parity; a parity
      // sprite with no placement (picker/gallery) defaults to variant 0.
      let h = hflip, v = vflip;
      const parity = PARITY_CEL_VARIANTS[spriteId];
      const pIdx = parity ? (placement ? parityIndex(placement.x, placement.y) : 0) : -1;
      if (parity?.cels && pIdx >= 0) {
        // Hand-authored layout (the figure size/arrangement varies by parity, and the
        // cel's runtime-orbiting companions can't be sliced from frames). Verbatim,
        // tileRow-relative; the whole-sprite flip still applies (no per-parity flip).
        cel = applyCelFlip(parity.cels[pIdx]!.map((t) => ({ ...t })), h, v);
        count = cel.length;
      } else {
        if (parity && pIdx >= 0) {
          celPC += (parity.frames?.[pIdx] ?? 0) * count * CEL_FORMAT_B_RECORD_BYTES;
          h = h !== (((parity.flips?.[pIdx] ?? 0) & 0x40) !== 0);
          v = v !== (((parity.flips?.[pIdx] ?? 0) & 0x80) !== 0);
        } else if (restFrame) {
          // v2-verified resting frame (the frame-0 cel is the wrong pose).
          celPC += restFrame * count * CEL_FORMAT_B_RECORD_BYTES;
        }
        cel = applyCelFlip(decodeCelFormatB(rom, celPC, count), h, v);
      }
      // Replace cel rows the cart's GSU OAM builder masks off + reassigns at runtime (e.g. the
      // Koopa family's row-7 skin placeholder → OBJ pal 1). Before the $7042 OR so the green/red
      // shell variant still resolves through it. (CEL_PALETTE_REMAP header has the asm proof.)
      const palRemap = CEL_PALETTE_REMAP[spriteId];
      if (palRemap) cel = cel.map((t) => (palRemap[t.paletteRow] !== undefined ? { ...t, paletteRow: palRemap[t.paletteRow]! } : t));
      if (spritePal !== 0) cel = cel.map((t) => ({ ...t, paletteRow: (t.paletteRow | spritePal) & 0x07 }));
      // Per-record runtime patches (placeholder → handler-drawn tile, with a locked palette;
      // or `drop` to remove a GSU-streamed dynamic-slot record entirely).
      const recOv = SPECIAL_CHR_RECORD_OVERRIDE[spriteId];
      if (recOv) {
        const dropIdx = new Set<number>();
        for (const ov of recOv) {
          const r = cel[ov.index];
          if (!r) continue;
          if (ov.drop) { dropIdx.add(ov.index); continue; }
          if (ov.tile !== undefined) r.tile = ov.tile;
          if (ov.dx !== undefined) r.dx = ov.dx;
          if (ov.dy !== undefined) r.dy = ov.dy;
          if (ov.size !== undefined) r.size = ov.size;
          if (ov.static) r.static = true;
          if (ov.paletteRow !== undefined) r.paletteRow = ov.paletteRow & 0x07;
          if (ov.lockPalette) r.lockPalette = true;
        }
        if (dropIdx.size) { cel = cel.filter((_, i) => !dropIdx.has(i)); count = cel.length; }
      }
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
      // object_data[0] is frame 0; FORMAT_A_TILE_OVERRIDE swaps in the in-play
      // frame for the few sprites whose frame 0 is the wrong pose (see that table).
      const fa = FORMAT_A_OVERRIDES[spriteId];
      const tile = fa?.tile ?? (u16le(rom, odPC) & 0x1ff);
      const size = fa?.size ?? 16;
      count = 1;
      cel = applyCelFlip(
        [{ dx: 0, dy: 0, tile, paletteRow: 0, priority: 0, hflip: false, vflip: false, size }],
        hflip, vflip
      );
      if (spritePal !== 0) cel = cel.map((t) => ({ ...t, paletteRow: (t.paletteRow | spritePal) & 0x07 }));
    }
  }
  // Synthesized cel: handler-drawn sprites whose OAM layout is hand-recovered from the
  // v2 capture (see sprite-synth-cel.ts). Tiles are tileRow-relative — the gfx still
  // comes from the level's loaded VRAM at render time, like a real cel. Used VERBATIM:
  // the palette row and per-record flips are already baked from the capture (no $7042
  // seed-OR, no whole-sprite flip — the handler folds those into the OAM it emits).
  // A synth cel OVERRIDES any partial special_chr / object_data decode: most entries
  // have neither table (cel was empty), but a few sprites carry a 1-record stub cel
  // that draws only a fragment (the Boo Guys' $105/$106 cel draws just the bomb) — the
  // synth layout is the complete handler-drawn figure, so it wins. A synth cel may ALSO
  // coexist with a dynamic body: the synth supplies the static records (e.g. the Wild
  // Piranha $066 stem) while the body supplies the dyntile part (the head) — so don't
  // gate the synth on `!dynSrc`.
  // Y-parity synth cel ($064 pinwheel): the orbit radius is chosen from cellY parity
  // ($7182 & $0010), so a cellY-ODD placement uses the alternate (larger-radius) cel. With no
  // placement (picker/gallery) we default to the EVEN cel in SYNTHESIZED_CELS.
  const synth = (placement && (placement.y & 1) && SYNTHESIZED_CEL_PARITY_Y[spriteId]) || SYNTHESIZED_CELS[spriteId];
  if (synth) {
    count = synth.length;
    cel = synth.map((tile) => ({ ...tile }));
  }
  if (cel.length === 0 && !dynSrc) return null;

  // Spawn offset: shift the whole cel by the Init's position snap (the editor anchors at the
  // placed cell and doesn't run the Init — see SPRITE_SPAWN_OFFSET).
  const spawn = SPRITE_SPAWN_OFFSET[spriteId];
  if (spawn) cel = cel.map((t) => ({ ...t, dx: t.dx + spawn.dx, dy: t.dy + spawn.dy }));

  // Spawn-cell-parity palette: a handful of sprites pick their OBJ palette row from the
  // placed cell's X/Y parity (shy-guy family green/red/yellow/pink, stilt/fat guy, Mock-Up,
  // Piscatory Pete — asm-derived + capture-validated, see SPRITE_PARITY_PALETTE). It's the
  // most specific source (per-placement, deterministic), so it wins. No placement
  // (picker/gallery) → index 0 (the x-even/y-even row).
  const parityPalRows = SPRITE_PARITY_PALETTE[spriteId];
  const parityPal = parityPalRows
    ? parityPalRows[placement ? parityIndex(placement.x, placement.y) : 0]
    : undefined;
  // Runtime OAM-palette override — replaces the cel's palette row outright, since
  // the recoloring handler clears $7042's palette bits before setting its own.
  // Precedence: (1) spawn-cell parity palette (above), then (2) the level-state-conditioned
  // override (`spriteRuntimePaletteOverride` — the Red Coin 0x065, whose row depends on the
  // level's sprite palette), then (3) the static `settledPaletteRow` baked per sprite (SP4).
  const palOverride = parityPal ?? spriteRuntimePaletteOverride(rom, symbols, spriteId, levelSpritePaletteId) ?? settledPaletteRow;
  // Records with a locked palette (a handler-drawn sub-element, e.g. the Lantern Ghost flame) keep
  // their own row through the whole-sprite override.
  if (palOverride !== undefined) cel = cel.map((t) => (t.lockPalette ? t : { ...t, paletteRow: palOverride & 0x07 }));

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
  // A cel's dynamic-slot placeholder record: the tile-0 sentinel, the GSU DYNAMIC
  // region (`>= 448`), the spriteset-range dynamic-slot quad ($B000 / tile 0x180), or a
  // per-sprite `placeholderTiles` entry. NOT a blanket `>= 256` — that swept in real
  // loaded spriteset tiles (256..447), nulling e.g. Flamer Guy's shy-guy body so the
  // flames (its actual `>= 448` placeholders) drew over the hole. Only meaningful when
  // `dynSrc` is set (both branches below are dynSrc-guarded); the `?.` keeps it safe to hoist.
  const isPlaceholder = (t: SpriteCel[number]): boolean =>
    !t.static && (t.tile === 0 || t.tile >= DYNAMIC_OBJ_TILE_BASE || SPRITESET_DYNAMIC_SLOT_TILES.has(t.tile) || (dynSrc?.placeholderTiles?.includes(t.tile) ?? false));
  let dynamicBody: DynamicBody | undefined;
  if (dynSrc?.staticsOnly) {
    // Render the static cel frame, not the bank-$54 body: drop the dynamic-slot
    // placeholder record(s) so they don't blit VRAM tile 0 as garbage. (No body.)
    cel = cel.filter((t) => !isPlaceholder(t));
  } else if (dynSrc) {
    const decoded = decodeDynamicBody(rom, symbols, spriteId);
    if (decoded) {
      const bodyRecs = cel.filter(isPlaceholder);
      // Origin: explicit override, else the placeholder records' bbox, else TOP-LEFT.
      // The cel-less fallback is (0,0): the GSU draws a cel-less dynamic body at the
      // sprite anchor + 0 (top-left), like a Format-A item — verified against the v2
      // trace ($088 Super Star + $0B4 morph bubble both have their dynamic-tile record
      // at dx=dy=0). (It was previously CENTRED, `-(w/2),-(h/2)`, which mis-placed them
      // half a tile up-left; a sprite that genuinely centres sets an explicit origin.)
      let ox: number, oy: number;
      if (dynSrc.originX !== undefined) {
        ox = dynSrc.originX; oy = dynSrc.originY ?? 0;
      } else if (bodyRecs.length > 0) {
        ox = Math.min(...bodyRecs.map((t) => t.dx));
        oy = Math.min(...bodyRecs.map((t) => t.dy));
      } else {
        ox = 0; oy = 0;
      }
      cel = dynSrc.bodyStandalone
        ? [] // body renders alone (drop the over-allocated placeholder footprint); bounds = body extent
        : dynSrc.bodyOnly
          // body + any explicitly-`static` real record (e.g. Tap-Tap $03C's nose, a loaded
          // spriteset tile drawn alongside the GSU body); drop the rest of the vestigial frame.
          ? cel.filter((t) => isPlaceholder(t) || t.static).map((t) => (isPlaceholder(t) ? { ...t, body: true } : t))
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
      // Spawn-cell-parity palette also applies to a dynamic body (e.g. $08B Mock-Up, whose
      // body IS the render). Parity wins; otherwise the entry's fixed paletteRow. (Not the
      // cel `settledPaletteRow` — bodies intentionally carry their own capture-derived row.)
      const bodyPal = parityPal ?? dynSrc.paletteRow;
      dynamicBody = {
        indices,
        width: decoded.width,
        height: decoded.height,
        originX: ox,
        originY: oy,
        paletteRow: bodyPal
      };
    }
  }

  // restFrame cel referencing the GSU DYNAMIC OBJ region (tile >= 448 = VRAM
  // $B800+) with NO backing dynamic body: drop those records (they're streamed
  // per-frame and absent from static VRAM, so blitting them shows garbage) and keep
  // the static parts. The morph bubbles rest at frame 6 = 4 common-page bubble
  // corners ($7e/$9c, < 256) + 1 dynamic-slot vehicle-icon placeholder ($1dd); only
  // the submarine $0B4 has a static icon source (a DYNAMIC_BODY_SOURCES entry → its
  // placeholder is tagged `body` and rendered from the bitmap, so `dynamicBody` is
  // set and this filter is skipped), so the other 4 render just the bubble. (A body
  // sprite's placeholders are already tagged `body` above, which sets dynamicBody.)
  if (restFrame !== undefined && !dynamicBody) {
    cel = cel.filter((t) => t.tile < DYNAMIC_OBJ_TILE_BASE);
  }

  // Nothing left to draw (e.g. a table sprite whose body decode failed and whose
  // cel was empty / all-placeholder) → glyph tier.
  if (cel.length === 0 && !dynamicBody) return null;

  // Tile-base gate (see docstring): a fileInfo==0 (tileRow 0) sprite whose cel
  // references the GSU DYNAMIC OBJ region (tile >= 448 = VRAM $B800+) draws from a
  // per-frame-streamed base that's in NO static VRAM → skip (glyph tier). Tiles
  // 256..447 are the loaded spriteset ($A000-$B7FF), so they DO render from VRAM —
  // the gate must use the real dynamic boundary (448), not the lower-page split
  // (256) which wrongly nulled spriteset-referencing sprites (e.g. $133 Lantern
  // Ghost, tiles [158,256,271]). Skipped when a rigid dynamic body was resolved
  // (those upper-page records draw from the bitmap) or restFrame is set (the v2
  // trace confirmed a from-VRAM render at that frame; any unbacked dynamic record
  // was already dropped just above).
  const tileRow = spriteTileRow(rom, symbols, header, spriteId);
  if (tileRow === 0 && !dynamicBody && restFrame === undefined) {
    let maxTile = 0;
    for (const t of cel) if (t.tile > maxTile) maxTile = t.tile;
    if (maxTile >= DYNAMIC_OBJ_TILE_BASE) return null;
  }
  const tileBaseBytes = objNameBase(manifest) + tileRow * TILE_BYTES_4BPP;
  return { cel, tileBaseBytes, celPC, count, dynamicBody };
}
