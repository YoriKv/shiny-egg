// gfx-file-catalog.ts — the single source of per-file knowledge for the cart's
// graphics containers, distilled from the 2026-07 graphics survey
// (research/graphics-survey/, esp. 03-bg2-bg3.md §4 — the CLOSED 150-tilemap
// census — and 11-vram-loading.md §4-§5). Consumers (the YY-CHR export, the ROM
// importer, the diff inventory) read their columns from here instead of keeping
// hand tables that rot independently (research/graphics-editing/
// pipeline-evaluation-2026-07.md §3 O1).
//
// ⚠ ID-SPACE RULE: the LZ2 and LZ16 pointer tables are numbered INDEPENDENTLY —
// "$76" means one thing as an LZ2 id (a Bowser-finale tilemap frame) and another
// as an in-level lz16 manifest id (a HUD sheet). Every record here is keyed in
// its own table's id space; never join across tables by number.
//
// Scope: this catalog holds the SPECIAL knowledge — files whose role can't be
// derived from the per-level scene walk (`collectLevelGfxInfo` / the gfx
// manifest). An id absent from these maps is an ordinary level-scene file whose
// role the runtime walk classifies. Data-only module: Node- and DOM-free.

/** What a special LZ2-table entry actually is. */
export type Lz2SpecialKind =
  /** Mode-7 chars, CPC-packed 2 px/byte. Unpacked to 1 byte/px at load by the
   *  ≥$B1 handler path ($B1/$B9-$BC, Bank00 CODE_00B609/CODE_00B6B7) or the GSU
   *  twin ($B3-$B8, FXCODE_08AA5F via CODE_00B756 — the boss loaders bypass the
   *  65816 handler tail but the STORED packing is identical; asm-verified
   *  2026-07-19, was mis-cataloged as raw 1 byte/px). */
  | 'mode7-chr-cpc'
  /** A Mode-7 TILEMAP (one byte per cell = char index) — not pixel art. */
  | 'mode7-tilemap'
  /** An LZ16-encoded blob parked in an LZ2 slot with no loader path — decode as
   *  lz16 for viewing only; never re-encode through the lz2 path. */
  | 'orphan-lz16'
  /** A CHR-directory slot verified unused (leftover 32×32 tilemap screens). */
  | 'unused-chr-slot'
  /** A tilemap-directory slot verified unused/blank (no loader; blank fill —
   *  confirmed by decoding: $E2/$E3 are solid $01EE, $B2 an 11-word filler). */
  | 'unused-tilemap-slot'
  /** A non-level screen tilemap with a known owning scene. */
  | 'screen-tilemap'
  /** Ordinary planar CHR with a known non-level owning scene (export surfaces
   *  keep treating it as normal CHR; this only supplies the attribution). */
  | 'screen-chr'
  /** Real CHR art with NO loader on this cart — content-identified leftovers
   *  (e.g. French/German hint panels). Still exported normally; the record
   *  only supplies the content description. */
  | 'leftover-chr';

export interface Lz2SpecialRecord {
  kind: Lz2SpecialKind;
  /** Owning scene/system (census attribution). */
  owner: string;
  /** Human description for export surfaces. */
  description: string;
  /** Mode-7 char sets $BB/$BC: the per-char palette-row table (SNES address)
   *  the loader ORs into the pixels. */
  charPalTableSnes?: number;
  /** screen-chr only: display depth when the owning layer pins it (e.g. a BG3
   *  2bpp char file). Absent = 4bpp. */
  bpp?: 2 | 4;
}

const M7 = (kind: Lz2SpecialKind, owner: string, description: string, charPalTableSnes?: number): Lz2SpecialRecord =>
  ({ kind, owner, description, ...(charPalTableSnes !== undefined ? { charPalTableSnes } : {}) });
const CHR = (owner: string, description: string, bpp?: 2 | 4): Lz2SpecialRecord =>
  ({ kind: 'screen-chr', owner, description, ...(bpp !== undefined ? { bpp } : {}) });

/** Special LZ2-table entries (ids 0–264; ids absent = ordinary level-scene
 *  CHR (0–114) or level BG2/BG3 / world-map screen tilemaps (115–264) that the
 *  runtime walk / tilemap tables classify). */
export const LZ2_SPECIALS: Readonly<Record<number, Lz2SpecialRecord>> = {
  // ── orphaned LZ16 blobs in LZ2 slots (no loader; diamond/lattice mesh) ──
  0x2c: M7('orphan-lz16', 'none (orphaned)', 'Orphaned LZ16 blob in an LZ2 slot — no in-game loader; view-only'),
  0x2d: M7('orphan-lz16', 'none (orphaned)', 'Orphaned LZ16 blob in an LZ2 slot — no in-game loader; view-only'),
  0x2e: M7('orphan-lz16', 'none (orphaned)', 'Orphaned LZ16 blob in an LZ2 slot — no in-game loader; view-only'),
  0x2f: M7('orphan-lz16', 'none (orphaned)', 'Orphaned LZ16 blob in an LZ2 slot — no in-game loader; view-only'),
  // ── verified-unused CHR-directory slots (leftover 32×32 tilemap screens) ──
  0x6f: M7('unused-chr-slot', 'none (unused)', 'UNUSED — leftover 32×32 tilemap data; nothing in-game reads it'),
  0x70: M7('unused-chr-slot', 'none (unused)', 'UNUSED — leftover 32×32 tilemap data; nothing in-game reads it'),
  0x71: M7('unused-chr-slot', 'none (unused)', 'UNUSED — leftover 32×32 tilemap data; nothing in-game reads it'),
  0x72: M7('unused-chr-slot', 'none (unused)', 'UNUSED — leftover 32×32 tilemap data; nothing in-game reads it'),
  // ── non-level screen CHR with known owners (normal planar CHR; attribution
  // only — scene-program walk + direct-load sweep, 2026-07-19). Dests are VRAM
  // word addresses from the walked programs. ──
  0x1c: CHR('bonus games (gm$2A)', 'Bonus-games BG3 chars — 2bpp (flowers/brick decorations; scene program $0F3 → VRAM word $2800)', 2),
  0x1d: CHR('title screen', 'Title screen Mode-0 logo/sky chars — 2bpp ("SUPER MARIO WORLD 2 / YOSHI\'S ISLAND" lettering; scene program $04F → VRAM word $3800; the title-logo editor assembles from this file)', 2),
  0x1e: CHR('mode-$0A cinema (6-8 Kamek)', 'Kamek-cinema BG3 chars — 2bpp (scene program $18A → VRAM words $7400/$7800)', 2),
  0x1f: CHR('title screen', 'Title screen Mode-0 sky/foliage BG chars — 2bpp, normal-boot variant (scene program $04F DP → VRAM word $3400; the final-world/high-score boot loads $68 instead)', 2),
  0x20: CHR('goal ring (in-level)', 'GOAL! ring lettering chars (Bank02 main_goal: LDA #$20 → CODE_00B753; draws in the level\'s palette row 0)'),
  0x21: CHR('bonus games (gm$2A)', 'Bonus-games title lettering chars (scene program $0F3 → VRAM word $7000)'),
  0x22: CHR('bonus games (gm$2A)', 'Bonus-games BG chars (scene program $0F3 → VRAM word $7400)'),
  0x24: CHR('bandit minigames (gm$2E)', 'Bandit-minigame chars (scene program $122 → VRAM word $5000)'),
  0x25: CHR('bandit minigames (gm$2E)', 'Bandit-minigame chars (scene program $122 → VRAM word $0000)'),
  0x26: CHR('bandit minigames (gm$2E)', 'Bandit-minigame chars (scene program $122 → VRAM word $0800)'),
  0x27: CHR('storybook (gm$05)', 'Storybook BG3 frame chars — 2bpp (scene program $079 → VRAM word $7800; the storybook-scene editor slices back to this file)', 2),
  0x4a: CHR('storybook (gm$05)', 'Storybook attract chars (scene program $079 → VRAM word $5000, OBJ region)'),
  0x50: CHR('bandit minigames (gm$2E)', 'Bandit-minigame HUD text chars — 2bpp (digits, YOSHI/BANDIT/TIME labels; scene program $122 → VRAM word $2800)', 2),
  // ── localization / dev leftovers (no loader on this cart; content identified
  // from per-id renders 2026-07-19 — identify from per-id renders, not stacked
  // contact sheets, where strip boundaries mislead; see also GSU bank $57) ──
  0x4b: M7('leftover-chr', 'none (no loader found)', 'LEFTOVER — Kamek animation frames; no in-game loader found (not in any bg1 tileset row)'),
  0x4c: M7('leftover-chr', 'none (no loader found)', 'LEFTOVER — English controls-explanation panel ("Grab/Spit out", "Release to throw", "Push twice to throw", "Jump" + Y/B/A pad diagram); no loader found'),
  0x6c: M7('leftover-chr', 'none (no loader found)', 'LEFTOVER — French controls-explanation panel ("Prendre", "Cracher", "Presser 2x", "Pour lancer", "Saut" + pad diagram); localization leftover'),
  0x6d: M7('leftover-chr', 'none (no loader found)', 'LEFTOVER — German controls-explanation panel ("Spucken", "Loslassen", "2x = Werfen", "Springen" + pad diagram); localization leftover'),
  0x6e: M7('leftover-chr', 'none (no loader found)', 'LEFTOVER — "BONUS …" bonus-game title lettering (localized); no loader found'),
  0x5d: CHR('giant Baby Bowser (6-8 finale)', 'Giant-Bowser finale cutscene CHR (preload DATA_0DD2F2 → VRAM $5800)'),
  0x5e: CHR('ending scene', 'Ending-scene chars (CODE_00B753 "file A" load — doc 11 §3i)'),
  0x5f: CHR('giant Baby Bowser (6-8 finale)', 'Giant-Bowser finale cutscene CHR (preload DATA_0DD2F2 → VRAM $7000)'),
  0x60: CHR('giant Baby Bowser (6-8 finale)', 'Giant-Bowser finale cutscene CHR (preload DATA_0DD2F2 → VRAM $5000)'),
  // ── storybook / cutscene / minigame screen tilemaps (census, doc 03 §4) ──
  0x73: M7('screen-tilemap', 'storybook (gm$05)', 'Storybook static tilemap'),
  0x74: M7('screen-tilemap', 'storybook (gm$05)', 'Storybook static tilemap'),
  0x75: M7('screen-tilemap', 'storybook (gm$05)', 'Storybook static tilemap'),
  0x76: M7('screen-tilemap', 'Baby Bowser finale (gm$05/$07)', 'Giant-Bowser cutscene BG1 tilemap frame (double-buffered into the $C000 map region)'),
  0x77: M7('screen-tilemap', 'Baby Bowser finale (gm$05/$07)', 'Giant-Bowser cutscene BG1 tilemap frame'),
  0x78: M7('screen-tilemap', 'Baby Bowser finale (gm$05/$07)', 'Giant-Bowser cutscene BG1 tilemap frame'),
  0x79: M7('screen-tilemap', 'Baby Bowser finale (gm$05/$07)', 'Giant-Bowser cutscene BG1 tilemap frame'),
  0x7a: M7('screen-tilemap', 'Baby Bowser finale (gm$05/$07)', 'Giant-Bowser cutscene BG1 tilemap frame'),
  0x7b: M7('screen-tilemap', 'Baby Bowser finale (gm$05/$07)', 'Giant-Bowser cutscene BG1 tilemap frame'),
  0x9d: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle result screen — Yoshi-wins wallpaper (CODE_119169 → VRAM word $3C00; BG2SC repointed to the 32×32 map at byte $7800)'),
  0x9e: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle result screen — Bandit-wins wallpaper (CODE_119169 → VRAM word $3C00; BG2SC repointed to the 32×32 map at byte $7800)'),
  0xa2: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle BG3 score screen (table DATA_11820A → VRAM $3400; 8×8 tiles via CODE_118216)'),
  0xa3: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle BG3 score screen (table DATA_11820A)'),
  0xa4: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle BG3 score screen (table DATA_11820A)'),
  0xa5: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle BG3 score screen (table DATA_11820A)'),
  0xa6: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle BG3 score screen (table DATA_11820A)'),
  0xa7: M7('screen-tilemap', 'mini-battle (gm$2E/$30)', 'Mini-battle BG3 score screen (table DATA_11820A)'),
  0xa8: M7('screen-tilemap', 'storybook intro (gm$38)', 'Playable-prologue BG2 tilemap (→ VRAM $3800)'),
  0xa9: M7('screen-tilemap', 'storybook intro (gm$38)', 'Playable-prologue BG3 tilemap (→ VRAM $3400)'),
  0xaf: M7('screen-tilemap', 'mode-$0A cinema (6-8 Kamek)', 'Kamek-cinema BG tilemap (scene program $18A, loaded 3×; rides the mode-$0A level walk — not CHR)'),
  // Decoded + rendered 2026-07-19: plain 32-wide BG2 tilemap-word
  // grids (12-13 rows) — the staff-roll SCENERY vignettes the roll pages through
  // (table DATA_10E5F6 → $70:1C00 → VRAM word $5CA0). The staff NAMES are OAM
  // letters (DATA_00D2C2 byte streams), not in these blocks.
  0xab: M7('screen-tilemap', 'credits (gm$1D)', 'Credits staff-roll scenery block 0 — mountain-trek vignette (32×12 tilemap words)'),
  0xac: M7('screen-tilemap', 'credits (gm$1D)', 'Credits staff-roll scenery block 1 — village vignette (32×12 tilemap words)'),
  0xad: M7('screen-tilemap', 'credits (gm$1D)', 'Credits staff-roll scenery block 2 — palm-shore vignette (32×12 tilemap words)'),
  0xae: M7('screen-tilemap', 'credits (gm$1D)', 'Credits staff-roll scenery block 3 — stork-finale vignette (32×13 tilemap words)'),
  // NOT portraits (mis-glossed pre-2026-07-18): each is a flat two-tone MASK — one blank
  // char + one half-filled edge char — the Kamek-foreshadow color-math overlay strip
  // (bottom 16 tilemap rows; layer moves to the subscreen, CGADSUB from DATA_0CDA82).
  0xd8: M7('screen-tilemap', 'boss intros (BG2-ts-$16 rooms)', 'Kamek-foreshadow color-math overlay MASK → BG2 rows 48-63 ($7C00; tables DATA_0CDA9A/0CDAB2)'),
  0xfa: M7('screen-tilemap', 'boss intros (other rooms)', 'Kamek-foreshadow color-math overlay MASK → BG3 rows 16-31 ($6C00)'),
  // ── Mode-7 char/tilemap sets ──
  0xb1: M7('mode7-chr-cpc', 'title screen', 'Title floating island — Mode-7 chars (CPC 2 px/byte)'),
  0xb9: M7('mode7-chr-cpc', 'Raphael arena (level-mode 9)', 'Raphael moon arena — Mode-7 chars 0-63 (CPC 2 px/byte)'),
  0xba: M7('mode7-chr-cpc', 'Raphael arena (level-mode 9)', 'Raphael moon arena — Mode-7 chars 64-127 (CPC 2 px/byte)'),
  0xbb: M7('mode7-chr-cpc', 'Raphael arena (level-mode 9)', 'Raphael moon arena — Mode-7 chars 128-191 (CPC; per-char palette rows)', 0x00b637),
  0xbc: M7('mode7-chr-cpc', 'Raphael arena (level-mode 9)', 'Raphael moon arena — Mode-7 chars 192-255 (CPC; per-char palette rows)', 0x00b677),
  0xbd: M7('mode7-tilemap', 'Raphael arena (level-mode 9)', 'Raphael moon arena — Mode-7 TILEMAP (one byte per cell = char index); not pixel art'),
  0xb3: M7('mode7-chr-cpc', 'giant Baby Bowser (6-8 finale)', 'Giant-Bowser Mode-7 chars 0-63 (CPC 2 px/byte; preload CODE_0DD3E9 / DATA_0DD2F2, GSU unpack FXCODE_08AA5F)'),
  0xb4: M7('mode7-chr-cpc', 'giant Baby Bowser (6-8 finale)', 'Giant-Bowser Mode-7 chars 64-127 (CPC 2 px/byte)'),
  0xb5: M7('mode7-chr-cpc', 'giant Baby Bowser (6-8 finale)', 'Giant-Bowser Mode-7 chars 128-191 (CPC 2 px/byte)'),
  0xb6: M7('mode7-chr-cpc', 'giant Baby Bowser (6-8 finale)', 'Giant-Bowser Mode-7 chars 192-255 (CPC 2 px/byte)'),
  0xb7: M7('mode7-chr-cpc', 'giant Hookbill (4-8 boss)', 'Giant-Hookbill Mode-7 chars 0-63 (CPC 2 px/byte; CODE_hookbill_begin_init1 / DATA_019D0B, GSU unpack FXCODE_08AA5F)'),
  0xb8: M7('mode7-chr-cpc', 'giant Hookbill (4-8 boss)', 'Giant-Hookbill Mode-7 chars 64-127 (CPC 2 px/byte)'),
  // ── verified unused/blank tilemap-directory slots ──
  0xb2: M7('unused-tilemap-slot', 'none (unused)', 'UNUSED tilemap slot — repetitive filler pattern; no loader path'),
  0xe2: M7('unused-tilemap-slot', 'none (unused)', 'UNUSED tilemap slot — solid $01EE fill; no loader path'),
  0xe3: M7('unused-tilemap-slot', 'none (unused)', 'UNUSED tilemap slot — solid $01EE fill; no loader path')
};

/** Special LZ16-table entries (independent id space — see the header rule). */
export const LZ16_SPECIALS: Readonly<Record<number, { owner: string; description: string }>> = {
  // Non-level scenes the export walks don't cover (scene-program walk 2026-07-19;
  // dests are VRAM word addresses).
  0x10: { owner: 'retry / game-over (gm$13)', description: 'Retry-screen OBJ sheet (scene program $06E → VRAM word $4000)' },
  0x11: { owner: 'retry / game-over (gm$13)', description: 'Retry-screen OBJ sheet (scene program $06E → VRAM word $4800)' },
  0x13: { owner: 'bonus games (gm$2A)', description: 'Bonus-games item/prize art — dice, stars, coins, flowers (scene program $0F3 → VRAM word $5000; also re-loaded by the credits phase swaps, DATA_10E59E)' },
  0x14: { owner: 'bonus games (gm$2A)', description: 'Bonus-games English text/HUD chars — "Slot Match", "Roulette", SCORE/TOTAL, digits (scene program $0F3 → VRAM word $7800; the French/German versions are the unused lz16 $B5-$BA sheets)' },
  0x15: { owner: 'bonus games (gm$2A)', description: 'Bonus-games chars (scene program $0F3 → VRAM word $1000)' },
  0x16: { owner: 'bonus games (gm$2A)', description: 'Bonus-games chars (scene program $0F3 → VRAM word $1800)' },
  0x73: { owner: 'title + world map', description: 'Shared OBJ chrome chars — cursor / HUD / Yoshi+stork token (title $5C00+$7C00, world map $7C00)' },
  0x87: { owner: 'storybook (gm$05)', description: 'Storybook attract illustration chars (scene program $079 → VRAM word $0000)' },
  0x89: { owner: 'storybook (gm$05)', description: 'Storybook attract illustration chars (scene program $079 → VRAM word $2000)' },
  0x8a: { owner: 'storybook (gm$05)', description: 'Storybook attract OBJ chars (scene program $079 → VRAM word $4000)' },
  0x8b: { owner: 'storybook (gm$05)', description: 'Storybook attract illustration chars (scene program $079 → VRAM word $3000)' },
  0x8c: { owner: 'world map (gm$20)', description: 'World-map OBJ chrome (scene program $0A2 → VRAM word $7000)' },
  0x8d: { owner: 'credits (gm$1B)', description: 'Credits phase-swap chars (DATA_10E588/DATA_10E59E → CODE_10E5B2 → VRAM word $6000/$6800)' },
  0x8e: { owner: 'credits (gm$1B)', description: 'Credits phase-swap chars (DATA_10E59E → VRAM word $6800)' },
  0x8f: { owner: 'world map (gm$20)', description: 'World-map OBJ chrome (scene program $0A2 → VRAM word $6000)' },
  // World-map per-world OBJ marker/chrome sets (DATA_00B409, 8 per world:
  // worlds 1-5 = $99-$A0; world 6 swaps the back half for $95-$98).
  0x95: { owner: 'world map (gm$20)', description: 'World-map OBJ marker slot — world 6 (DATA_00B409 row 6 → VRAM word $3800); content is an X-pattern filler placeholder' },
  0x96: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — world 6 (DATA_00B409 row 6)' },
  0x97: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — world 6 (DATA_00B409 row 6)' },
  0x98: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — world 6 (DATA_00B409 row 6)' },
  0x99: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — all worlds (DATA_00B409 → VRAM word $3800)' },
  0x9a: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — all worlds (DATA_00B409)' },
  0x9b: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — all worlds (DATA_00B409)' },
  0x9c: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — all worlds (DATA_00B409)' },
  0x9d: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — worlds 1-5 (DATA_00B409)' },
  0x9e: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — worlds 1-5 (DATA_00B409)' },
  0x9f: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — worlds 1-5 (DATA_00B409)' },
  0xa0: { owner: 'world map (gm$20)', description: 'World-map OBJ marker set — worlds 1-5 (DATA_00B409)' },
  // Ending cutscene: Baby Bowser sprite-frame strips (32 4bpp tiles each →
  // OBJ words $5600-$5FFF), advanced frame-by-frame by the ending streamer
  // CODE_0DF232 (which indexes past the LZ2 table into the contiguous LZ16
  // table; its lz2 $4D/$4E loads are the sunrise BG3 char swaps). The same
  // files ride level spriteset $7B (record $DD, the ending room).
  0x6a: { owner: 'ending cutscene', description: 'Baby Bowser sprite frames — ending cutscene (spriteset $7B; streamed per phase by CODE_0DF232)' },
  0xad: { owner: 'ending cutscene', description: 'Baby Bowser sprite frames — ending cutscene (spriteset $7B; streamed per phase by CODE_0DF232)' },
  0xae: { owner: 'ending cutscene', description: 'Baby Bowser sprite frames — ending cutscene (spriteset $7B; streamed per phase by CODE_0DF232)' },
  0xaf: { owner: 'ending cutscene', description: 'Baby Bowser sprite frames — ending cutscene (spriteset $7B; streamed per phase by CODE_0DF232)' },
  0xb0: { owner: 'ending cutscene', description: 'Baby Bowser sprite frames — ending cutscene (spriteset $7B; streamed per phase by CODE_0DF232)' },
  // Localization / dev leftovers (no loader on this cart; content identified
  // from per-id renders 2026-07-19).
  0x7c: { owner: 'none (latent)', description: 'LEFTOVER — plant/tree art; bg2 tileset row $0C partner file ($7B,$7C), which no shipped level uses' },
  0x91: { owner: 'none (unused filler)', description: 'UNUSED — X-pattern filler sheet; nothing in-game reads it' },
  0x92: { owner: 'none (unused filler)', description: 'UNUSED — X-pattern filler sheet; nothing in-game reads it' },
  0x93: { owner: 'none (unused filler)', description: 'UNUSED — X-pattern filler sheet; nothing in-game reads it' },
  0x94: { owner: 'none (unused filler)', description: 'UNUSED — X-pattern filler sheet; nothing in-game reads it' },
  0xb5: { owner: 'none (no loader found)', description: 'LEFTOVER — French minigame digits + token text ("FICHES" …); localization leftover' },
  0xb6: { owner: 'none (no loader found)', description: 'LEFTOVER — French minigame text ("Lancer", "Coeur", "Pastèque/Pièces", "MINI…"); localization leftover' },
  0xb7: { owner: 'none (no loader found)', description: 'LEFTOVER — German minigame digits + "SPIEL 1" text; localization leftover' },
  0xb8: { owner: 'none (no loader found)', description: 'LEFTOVER — German minigame text ("Duell 1", "Rennen 1/2" …); localization leftover' },
  0xb9: { owner: 'none (no loader found)', description: 'LEFTOVER — French minigame menu/score text ("Loterie", "Paires", "Roulette", "Cartes", SCORE/TOTAL); localization leftover' },
  0xba: { owner: 'none (no loader found)', description: 'LEFTOVER — German minigame menu text ("Karten", "Memory", "Roulette", GEWINN); localization leftover' },
  // Mode-$0A Kamek cinema (its record rides the level walk via the $18A program).
  0x67: { owner: 'mode-$0A cinema (6-8 Kamek)', description: 'Kamek-cinema OBJ chars (scene program $18A → VRAM word $5000)' },
  // Ending room (record $DD — a warp-only sub-level the export's scene walk
  // skips): its bg2 tileset row $1F = files $A7/$A8.
  0xa7: { owner: 'ending scene (record $DD)', description: 'Ending-room BG2 chars (bg2 tileset row $1F → VRAM word $1800)' },
  0xa8: { owner: 'ending scene (record $DD)', description: 'Ending-room BG2 chars (bg2 tileset row $1F → VRAM word $2000)' },
  // Storybook playable prologue + credits (asm-traced 2026-07-19; these scenes
  // aren't screen-walk variants, so without these rows they'd read "no known
  // scene loads" in the YY-CHR export).
  0xab: { owner: 'storybook prologue (gm$38)', description: 'Storybook playable-prologue OBJ chars (CODE_gm38_load_intro_cutscene DP $17 → VRAM word $5000)' },
  0xac: { owner: 'storybook prologue (gm$38)', description: 'Storybook playable-prologue OBJ chars (DP $18 → VRAM word $5200)' },
  0xb1: { owner: 'storybook prologue (gm$38)', description: 'Storybook playable-prologue BG2 story-frame chars (CODE_gm38_load_intro_cutscene DP $13 → VRAM word $1800)' },
  0xb2: { owner: 'storybook prologue (gm$38)', description: 'Storybook playable-prologue BG2 story-frame chars (DP $14 → VRAM word $2000)' },
  0xb3: { owner: 'credits (gm$1B)', description: 'Credits BG2 text-layer char sheet — chars $40-$BF (scene program $1C3 → VRAM word $5400)' },
  0xb4: { owner: 'credits (gm$1B)', description: 'Credits staff-roll phase-swap chars (DATA_10E588 → CODE_10E5B2 → VRAM word $6000)' }
};

/** The raw (uncompressed) graphics banks — planar CHR + chunky GSU bitmaps.
 *  `binFile` is the extract asset each region round-trips through. */
export interface RawGfxFileRecord {
  binFile: string;
  /** 'planar' = 65816-DMA'd CHR; 'chunky' = GSU bitmap (1 byte/px, two nibble layers). */
  kind: 'planar' | 'chunky';
  bpp?: 1 | 4;
  /** Display palette row hint for whole-bank views (chunky banks). */
  palRow?: number;
  /** `palRow` is representative only — parts of the bank draw in other rows
   *  (per-slot icon palettes, per-sprite glyph palettes, multi-row map art).
   *  Absent = the row was verified across the whole bank. */
  palRowApprox?: boolean;
  /** Display CGRAM source for whole-bank views: 'map' = the world-map scene's
   *  palettes (the $53 icons render as map-scene OAM);
   *  'title' = the title scene's palettes (the $56 scenery draws in its OBJ
   *  row 7 = CGRAM row 15 — screen-title-scenery.ts, capture-verified);
   *  'bonus' = the bonus-game scene's palettes (the $53:8000 prize/HUD icons);
   *  'ending' = the ending scene's BG row (DATA_5FC328 — the $53:C000 bank);
   *  absent = the first level scene's CGRAM. Display-only, never data. */
  palScene?: 'map' | 'title' | 'bonus' | 'ending';
  description: string;
}

export const RAW_GFX_FILES: readonly RawGfxFileRecord[] = [
  { binFile: 'Graphics/GFX_520000.bin', kind: 'planar', bpp: 4, description: 'Animation tiles — coins / !-blocks / star / water / lava / torches (+ Yoshi player frames, pause icons at +$B000, victory overlay at +$1E00)' },
  { binFile: 'Graphics/GFX_568000.bin', kind: 'planar', bpp: 4, description: 'Animation tiles — clouds / water cycles / backdrop strips (+ victory overlay at +$5000, pause icons at +$6800)' },
  { binFile: 'Graphics/GFX_53C000.bin', kind: 'planar', bpp: 4, palScene: 'ending', description: 'Ending / credits cast CHR (bank $53 tail; sheet sections labeled E-0..E-3 in the art) — planar 4bpp, DMA-streamed by the credits IRQ' },
  { binFile: 'Graphics/SuperFX/DATA_530000.bin', kind: 'chunky', palRow: 8, palRowApprox: true, palScene: 'map', description: 'World-map level-select icon pictures (GSU bank $53, planar view)' },
  // palRow 9: the prize icons draw as OBJ palette 1 (visually verified against the
  // bonus scene CGRAM — row 9 gives the yellow stars / red POW / 1UP greens; row 8,
  // the "first OBJ row" default, tints everything green). lz16 $13's item chars
  // use OBJ palette 0 (row 8) — the two bonus OBJ consumers differ.
  { binFile: 'Graphics/SuperFX/DATA_538000.bin', kind: 'chunky', palRow: 9, palScene: 'bonus', description: 'Bonus/minigame prize + HUD icon pictures — 1UP/2UP/10UP, items, "HIT", EXIT (GSU bank $53 upper half, planar view)' },
  { binFile: 'Graphics/SuperFX/DATA_540000.bin', kind: 'chunky', palRow: 8, palRowApprox: true, description: 'GSU sprite glyphs (bank $54, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  { binFile: 'Graphics/SuperFX/DATA_548000.bin', kind: 'chunky', palRow: 8, palRowApprox: true, description: 'GSU sprite glyphs (bank $54, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  { binFile: 'Graphics/SuperFX/DATA_550000.bin', kind: 'chunky', palRow: 8, palRowApprox: true, description: 'GSU sprite glyphs (bank $55, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  { binFile: 'Graphics/SuperFX/DATA_558000.bin', kind: 'chunky', palRow: 8, palRowApprox: true, description: 'GSU sprite glyphs (bank $55, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  // palRow 15 + title scene: the scenery (first 3 quarter-rows of the bank) draws
  // in the TITLE scene's OBJ palette 7 = CGRAM row 15 (screen-title-scenery.ts,
  // capture-verified); the 4th quarter is boss Mode-7 pieces on other palettes
  // (hence approx). The old 'map' pick came from the DATA_map_character_base
  // label, not from any consumer.
  { binFile: 'Graphics/SuperFX/DATA_560000.bin', kind: 'chunky', palRow: 15, palRowApprox: true, palScene: 'title', description: 'Title-island 3D scenery + boss Mode-7 pieces (GSU bank $56 — the "map character base" label — planar view)' },
  { binFile: 'Graphics/SuperFX/DATA_570000.bin', kind: 'chunky', palRow: 8, palRowApprox: true, palScene: 'map', description: 'Menu / tutorial icon pictures (GSU bank $57, planar view) — controller diagrams + text panels in the level-select-icon two-per-byte format; no in-game loader found (likely localization/dev leftovers)' }
];

/** PC range of the raw graphics banks ($52:0000–$57:3BFF) — the importer's
 *  raw-CHR coverage and the diff inventory's `graphics-raw` band. */
export const RAW_GFX_PC_RANGE: readonly [number, number] = [0x120000, 0x173c00];

/** Derived id sets (convenience views over LZ2_SPECIALS). */
const idsOfKind = (kind: Lz2SpecialKind): ReadonlySet<number> =>
  new Set(Object.entries(LZ2_SPECIALS).filter(([, r]) => r.kind === kind).map(([id]) => Number(id)));

export const ORPHANED_LZ16_IN_LZ2_SLOTS: ReadonlySet<number> = idsOfKind('orphan-lz16');
export const VERIFIED_UNUSED_LZ2_CHR: ReadonlySet<number> = idsOfKind('unused-chr-slot');
export const UNUSED_TILEMAP_SLOTS: ReadonlySet<number> = idsOfKind('unused-tilemap-slot');
