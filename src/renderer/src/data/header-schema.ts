// Declarative schema for the Level Header panel — the 15 bit-packed header
// fields of a level (the analogue of property-schema's objectFields/spriteFields,
// but level-wide rather than per-entity).
//
// Field order, names, and bit widths are the engine's
// snes-framework/scripts/engine/object-decode/header.ts (HEADER_BIT_WIDTHS), and
// the widths are mirrored renderer-side in canvas/limits.ts (HEADER_BIT_WIDTHS),
// which is the single source the clamp + this schema both read. Each field's max
// is its bit-width max (2^width − 1) — the value can never overflow the packed
// field; semantic over-range (e.g. a level mode past the dispatch table) is left
// to the live render to reveal rather than guessed-clamped.
//
// Most fields are plain numeric inputs (hex, per the editor's 0x convention)
// with a factual hint. Level mode (field 9) is a curated enum — its labels are
// behaviour-verified (not guessed glosses): see LEVEL_MODES. Music track names
// remain a follow-up for the same reason.

import { HEADER_BIT_WIDTHS } from '../canvas/limits'
import type { FieldKind } from './property-schema'

/** Curated labels for the level-mode field (header[9], 5-bit). Behaviour-verified
 *  against `snes-framework/docs/bg23rendering.md §3` (the live per-mode scene-
 *  register capture), `enginecore.md`/`bossengine.md`/`levelloader.md`, and a
 *  usage survey across every backed level (`tmp/survey-levelmode.ts`):
 *    - 0x03 — offset-per-tile BG3 (BG Mode 2): the "wavy" distortion levels
 *      (1-7 Touch Fuzzy Get Dizzy, 6-3 Spinning Logs).
 *    - 0x09 — Mode-7 (irq_raphael): Raphael's moon boss (record 0xCB only).
 *    - 0x0A — autoscroll, BG Mode 0 (load_levelmode_0A_*): 6-8 Kamek (record 0x6B).
 *  The rest are standard in-level modes differing only in BG2/BG3 draw order +
 *  colour math; the verified differentiators (0x00 BG3-over-BG2, 0x05 BG3-under,
 *  0x02/0x0E colour math) are noted, the others left plain. 0x04 is unused and
 *  omitted; any unlisted value (incl. 0x04 / 0x10+) shows as a raw fallback. */
export const LEVEL_MODES: { value: number; label: string }[] = [
  { value: 0x00, label: 'Standard level (BG3 over BG2)' },
  { value: 0x01, label: 'Standard level' },
  { value: 0x02, label: 'Standard level (BG2 colour math)' },
  { value: 0x03, label: 'Offset-per-tile BG3 (wavy)' },
  { value: 0x05, label: 'Standard level (BG3 under BG2)' },
  { value: 0x06, label: 'Standard level' },
  { value: 0x07, label: 'Standard level' },
  { value: 0x08, label: 'Standard level' },
  { value: 0x09, label: "Mode 7 boss (Raphael's moon)" },
  { value: 0x0a, label: 'Autoscroll (6-8 Kamek)' },
  { value: 0x0b, label: 'Standard level' },
  { value: 0x0c, label: 'Standard level' },
  { value: 0x0d, label: 'Standard level' },
  { value: 0x0e, label: 'Standard level (BG2 colour math)' },
  { value: 0x0f, label: 'Standard level' }
]

/** Curated labels for the music field (header[13], 4-bit). The disassembly only
 *  proves the *mechanism* — the value indexes `DATA_spc_block_set_indexes` to
 *  pick the SPC data blocks (`CODE_upload_music_data`, Bank00:1134); no human
 *  track names exist in the asm, and the static editor can't audition them. So
 *  the names are taken from the **GoldenEgg reference editor** (HeaderEditor.cs,
 *  reference-only — may carry inaccuracies) and CROSS-VALIDATED against a
 *  per-level usage survey (`tmp/survey-music.ts`): the major themes are
 *  independently confirmed by which levels use them — 0x00 Flower Garden (1-1,
 *  2-1, …), 0x01 Jungle (Monkey World / Jungle Rhythm), 0x02 Castle & Fortress
 *  (every fort + castle), 0x04 Underground (World-6 caves), 0x0A Athletic (Donut
 *  Lifts / Ride Like the Wind). The boss / Kamek / bonus values (0x03/05–09/0B/0D)
 *  are used only by unnamed sub-rooms, so they rest on the GoldenEgg label alone —
 *  un-auditioned, lower confidence; audition in-game before trusting/correcting.
 *  0x0E/0x0F are blank in GoldenEgg + unused by any level → omitted (raw fallback). */
export const MUSIC_TRACKS: { value: number; label: string }[] = [
  { value: 0x00, label: 'Flower Garden' },
  { value: 0x01, label: 'Jungle' },
  { value: 0x02, label: 'Castle & Fortress' },
  { value: 0x03, label: "In Front of Boss's Room" },
  { value: 0x04, label: 'Underground' },
  { value: 0x05, label: "Kamek's Theme" },
  { value: 0x06, label: 'Bonus Game' },
  { value: 0x07, label: "In Front of Boss's Room" },
  { value: 0x08, label: "Kamek's Theme" },
  { value: 0x09, label: 'Big Boss BGM' },
  { value: 0x0a, label: 'Athletic' },
  { value: 0x0b, label: 'Powerful Baby' },
  { value: 0x0c, label: 'No Music' },
  { value: 0x0d, label: "In Front of Boss's Room" }
]

export interface HeaderField {
  /** Index into LevelData.header (0..14). */
  index: number
  label: string
  field: FieldKind
  hint: string
  /** Whether editing it re-skins the static preview live. Fields 12–14 (BG
   *  scroll rate, music, item memory) have no renderer consumer — they affect
   *  only the built ROM, so the panel groups them under "Gameplay". */
  preview: boolean
}

/** One row per header field. `index` matches header.ts; `max` is the bit-width
 *  max so the input can't overflow the packed field. */
function num(index: number, label: string, hint: string, preview: boolean): HeaderField {
  const width = HEADER_BIT_WIDTHS[index] ?? 0
  const field: FieldKind = { kind: 'num', min: 0, max: (1 << width) - 1, hex: true }
  return { index, label, field, hint, preview }
}

export function headerFields(): HeaderField[] {
  return [
    num(0, 'BG color', 'Backdrop colour. 0x00–0x0F = a solid colour; 0x10+ = a gradient preset.', true),
    num(1, 'BG1 tileset', 'BG1 tile graphics set. Also drives object decode, so changing it can move stamped tiles, not just re-skin them.', true),
    // isWorld6 is derived from the record id, NOT the header, so editing this field still
    // selects from the correct dark-vs-normal pointer table — no header↔dark-variant interaction bug.
    num(2, 'BG1 palette', 'BG1 palette row (the dark variant is auto-selected for World 6).', true),
    num(3, 'BG2 tileset', 'BG2 (parallax) tile graphics set.', true),
    num(4, 'BG2 palette', 'BG2 palette row.', true),
    num(5, 'BG3 tileset', 'BG3 (far parallax) tile graphics set.', true),
    num(6, 'BG3 palette', 'BG3 palette row.', true),
    num(7, 'Sprite tileset', 'Sprite (OBJ) graphics set for this level.', true),
    num(8, 'Sprite palette', 'Sprite palette row.', true),
    {
      index: 9,
      label: 'Level mode',
      field: { kind: 'enum', options: LEVEL_MODES },
      hint: 'PPU display / scene mode — selects the BG layout + colour-math. Most are interchangeable "standard level" variants; 0x03 / 0x09 / 0x0A are special (offset-per-tile / Mode-7 boss / autoscroll).',
      preview: true
    },
    num(10, 'Animation tileset', 'Which frame-0 tile-animation handler runs (water / clouds / lava / …).', true),
    num(11, 'Animation palette', 'Palette row used by the animated tiles.', true),
    num(12, 'BG scroll rate', 'Parallax scroll/damping mode. No live preview (parallax is not simulated) — Test Level to verify.', false),
    {
      index: 13,
      label: 'Music',
      field: { kind: 'enum', options: MUSIC_TRACKS },
      hint: 'Background music track. No live preview — Test Level to hear it. Track names are from the GoldenEgg reference editor, cross-checked against which levels use each value.',
      preview: false
    },
    num(14, 'Item memory', 'Which of 4 RAM bitmaps tracks collected items (coins/flowers/red coins, keys, opened doors). Connected sublevels that both hold collectibles should use different pages, or their collected-state collides. No live preview — Test Level to verify.', false)
  ]
}
