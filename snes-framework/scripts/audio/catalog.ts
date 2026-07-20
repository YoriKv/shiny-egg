// Audio catalog — names, roles, and ROM readers for YI's 20 SPC upload
// modules, the 13 block-set rows, and the music-setting tables.
//
// Sources of truth:
//  - Block ids / pointer rows: DATA_SPC_ptr + DATA_spc_data_blocks +
//    DATA_spc_block_set_indexes + DATA_item_denial_table (yi/Banks/Bank00.asm)
//    — read from the built ROM via the symbol map, so asm edits survive.
//  - Init-song-per-setting: DATA_01B24B (Bank01), indexed by the 1-based music
//    setting (CODE_01B25E does `LDA DATA_01B24B-1,x` with X = the setting).
//  - Module identities: descriptive per-module names + roles (our own
//    naming: songs by theme, sample banks with a -bank suffix, the engine
//    block as `driver`). The 20
//    modules concatenate to the audio region at $4E:0000; every framework
//    DATA_4Exxxx/DATA_4Fxxxx label matches a module boundary arithmetically
//    (file sizes chain exactly, ending at the engine's $50B3FA free-space
//    marker), and 19/20 are byte-identical to the original module files —
//    only the title-music sequence block differs (a late +8-byte edit; the
//    extracted TitleScreenMusic.bin is the retail version).
//    Full derivation: research/plan-audio-panel.md §2.2.
//
// Music-setting index spaces (all four appear below — don't conflate):
//  - "music setting" = level-header field 13 value (0x00-0x0D used, 0x0E/0x0F
//    free) extended by engine contexts 0x10-0x13 (title/demo/map/ending).
//    Tables index it 1-BASED (setting+1).
//  - "block-set row" = row index 0-12 into DATA_spc_data_blocks.
//  - "block id" = raw byte offset into DATA_SPC_ptr (entry*3+1: $01,$04..$3A).
//  - "song slot id" = 1-based index into the ARAM $FF90 pointer table
//    (slot n read at $FF8E+2n by CODE_music_load_song).

import { snesToPC, type SymbolMap } from '../engine/symbol-map.ts';
import { u16le, u24le } from '../engine/rom-read.ts';
import { parseUploadStream, type ParsedUploadStream } from './upload-stream.ts';

export type SpcBlockKind = 'engine' | 'samples' | 'songs';

export interface SpcBlockInfo {
  /** Block id = raw byte offset into DATA_SPC_ptr ($01, $04, ... $3A). */
  blockId: number;
  /** Framework label at the block's ROM location. */
  label: string;
  /** Module identifier — descriptive: songs named by theme, sample banks
   *  with a -bank suffix, the engine block as `driver`. */
  module: string;
  kind: SpcBlockKind;
  /** Human-readable content description. */
  role: string;
  /** Encoded module size in the retail/built ROM (upload stream incl. terminator). */
  retailBytes: number;
}

/** The 20 upload modules, in DATA_SPC_ptr row order (block id ascending). */
export const SPC_BLOCKS: readonly SpcBlockInfo[] = [
  { blockId: 0x01, label: 'DATA_4E0000', module: 'athleticbank',  kind: 'samples', role: 'athletic/invincible instrument add-on (+4 samples)', retailBytes: 5788 },
  { blockId: 0x04, label: 'DATA_4E169C', module: 'athletic',      kind: 'songs',   role: 'Athletic music',                                     retailBytes: 3363 },
  { blockId: 0x07, label: 'DATA_4E23BF', module: 'bonus',         kind: 'songs',   role: 'Bonus Challenge music',                              retailBytes: 2170 },
  { blockId: 0x0A, label: 'DATA_4E2C39', module: 'boss',          kind: 'songs',   role: 'Boss music (+ mid-song "immediate" entries)',        retailBytes: 3225 },
  { blockId: 0x0D, label: 'DATA_4E38D2', module: 'underground',   kind: 'songs',   role: 'Underground music',                                  retailBytes: 1470 },
  { blockId: 0x10, label: 'DATA_4ED0FE', module: 'ground',        kind: 'songs',   role: 'Ground music',                                       retailBytes: 1234 },
  { blockId: 0x13, label: 'DATA_4ED5D0', module: 'flowergarden',  kind: 'songs',   role: 'Flower Garden music',                                retailBytes: 3241 },
  { blockId: 0x16, label: 'DATA_4EE279', module: 'cavebossbank',  kind: 'samples', role: 'ground/underground/boss instrument add-on',          retailBytes: 2572 },
  { blockId: 0x19, label: 'DATA_4EEC85', module: 'grasslandbank', kind: 'samples', role: 'flower-garden/bonus/big-boss instrument add-on',     retailBytes: 4668 },
  { blockId: 0x1C, label: 'DATA_4F4122', module: 'worldmap',      kind: 'songs',   role: 'Map music + goal fanfare + bonus/defeat jingles (overworld-exclusive block)', retailBytes: 6950 },
  { blockId: 0x1F, label: 'DATA_4F5C48', module: 'bigboss',       kind: 'songs',   role: 'Big Boss music',                                     retailBytes: 4626 },
  { blockId: 0x22, label: 'DATA_4F6E5A', module: 'mapcastlebank', kind: 'samples', role: 'demo/map/castle instrument add-on',                  retailBytes: 5260 },
  { blockId: 0x25, label: 'DATA_4F82E6', module: 'globalbank',    kind: 'samples', role: 'common SFX + base 24-sample bank',                   retailBytes: 31180 },
  { blockId: 0x28, label: 'DATA_4FFCB2', module: 'castle',        kind: 'songs',   role: 'Castle music',                                       retailBytes: 1680 },
  { blockId: 0x2B, label: 'YI_SPCEngine', module: 'driver',        kind: 'engine',  role: 'SPC700 driver + all SFX sequences + title music + title samples', retailBytes: 45240 },
  { blockId: 0x2E, label: 'DATA_4F33F0', module: 'welcome',       kind: 'songs',   role: '1W-0 demo / "Welcome To Yoshi\'s Island" music',      retailBytes: 3378 },
  { blockId: 0x31, label: 'DATA_4EFEC1', module: 'bowserbank',    kind: 'samples', role: 'Bowser samples (replaces upper bank from $A480)',    retailBytes: 8604 },
  { blockId: 0x34, label: 'DATA_4F205D', module: 'bowser',        kind: 'songs',   role: 'Bowser music',                                       retailBytes: 5011 },
  { blockId: 0x37, label: 'DATA_4E3E90', module: 'endingbank',    kind: 'samples', role: 'Ending samples (self-contained bank replacement)',   retailBytes: 32092 },
  { blockId: 0x3A, label: 'DATA_4EBBEC', module: 'ending',        kind: 'songs',   role: 'Ending music',                                       retailBytes: 5394 },
] as const;

export function spcBlockById(blockId: number): SpcBlockInfo {
  const info = SPC_BLOCKS.find((b) => b.blockId === blockId);
  if (!info) throw new Error(`unknown SPC block id 0x${blockId.toString(16)}`);
  return info;
}

// ── the title-import module (rides INSIDE the driver's upload stream) ────────
// The Title setting (0x10) composes from the driver alone — its three songs
// live inside the engine image. A title song import splices into the END of
// the engine's own upload stream at build time (Bank00's tables are
// address-pinned, so a 21st DATA_SPC_ptr entry is impossible — the audio
// layout pass instead incbins the blob before the engine asm's stream
// terminator). Absent in a pristine build, so unedited builds stay
// byte-identical, and every reader sees it as part of block $2B.
/** Sentinel id for preview exclusion — never appears in any block-set row
 *  (the import is inside the driver), so "exclude it" excludes nothing. */
export const TITLE_IMPORT_BLOCK_ID = 0x3d;
/** Overlay blob file name (under assets/yi/SPC700/): a complete serialized
 *  upload module (blocks + terminator+entry — the engine's own terminator
 *  becomes 4 dead tail bytes after the splice). */
export const TITLE_IMPORT_BLOB_FILE = 'TitleImport.bin';

/** Song modules whose playback context never READS the accumulation-resident
 *  jingle sequences at ARAM $264C-$2C00 (death / toadies / level intro /
 *  game over / goal — uploaded by retail worldmap/welcome, consumed during level
 *  play and on the map), so an imported song targeting them may run echo
 *  delay 3 (buffer $2400-$3C00 — over the jingle region, but below nothing
 *  else those contexts need):
 *  - ending: the ending is a cutscene + credits with no jingle triggers, and
 *    it exits to the title screen (full re-upload) before any consumer.
 *  welcome was WRONGLY in this set until 2026-07-09 — its scene requests the
 *  Game Start jingle (MusicID $03, Bank01's level-intro path) from data the
 *  module itself uploads at $287A, and the $0203 setting cache skips the
 *  re-upload on re-entry, so an EDL-3 import silenced the scene permanently
 *  (verified live: 6 s of echo zeroes $264C-$2C00; the next jingle request
 *  stops all music). "The context never reads a jingle" must hold for EVERY
 *  entry into the context, including cache-skipped re-entries — not just the
 *  first pass from the map.
 *  Every other song module is heard in-level or on the map, where the
 *  corrupted region outlives the song into a jingle read (the goal fanfare
 *  even reads $2AE8 from WITHIN levels) — those keep the EDL ≤ 2 clamp.
 *  EDL ≥ 4 is fatal everywhere (buffer over the SFX block / driver code). */
export const JINGLE_FREE_SONG_MODULES: ReadonlySet<string> = new Set(['ending']);

/** ARAM $D000-$DC7E is accumulation-resident IN LEVELS, exactly like the
 *  $264C jingles one page up: the worldmap module parks Score at $D000 and
 *  Powerful Infant (invincibility) at $D7A2 there, and both are requested
 *  mid-level with no re-upload (star pickup → setting 0x0B's init slot 2;
 *  Bank02/Bank10/Bank11 request MusicIDs $02/$06 from level/minigame code).
 *  Every retail level-song module starts its sequence at $DC7F for this
 *  reason. Imports into level-set song modules must dodge the region. */
export const MAP_RESIDENT_SEQ_REGION = { start: 0xd000, end: 0xdc7f } as const;

/** Song modules whose playback context never requests the map-resident
 *  slots above, so their imports may use $D000 (retail precedent — each of
 *  these modules' own retail data overwrites the region):
 *  - worldmap: owns the region (it uploads Score/Powerful Infant).
 *  - welcome: retail welcome's own songs sit at $D000 (the 1W-0 context
 *    accepts score/invincibility being unavailable).
 *  - ending: cutscene + credits — no gameplay, no star, no score tally.
 *  - driver: the title screen (its own title music lives at $D000). */
export const MAP_RESIDENT_FREE_SONG_MODULES: ReadonlySet<string> = new Set([
  'worldmap',
  'welcome',
  'ending',
  'driver',
]);

/** The engine-tail gap $230E-$264B: the driver's $0EB0 data block ends at
 *  $230E, the accumulation-resident jingles start at $264C, and nothing
 *  references the 830 bytes between (engine-asm sweep 2026-07-09 — zero
 *  non-data mentions of $2300-$264B; the EDL-2 echo buffer floor is $2C00).
 *  Free for import sequence/sample data on every target. An EDL-3 echo
 *  buffer (jingle-free targets) starts at $2400 and truncates it. */
export const ENGINE_TAIL_REGION = { start: 0x230e, end: 0x264c } as const;

/** The retail echo buffer $2C00-$3C00 (every retail $F7 is EDL 2; ESA =
 *  $3C00 − 8·EDL·$100). The DSP writes it ONLY while echo is enabled: FLG
 *  bit 5 (shadow $48, flushed every driver tick) starts SET — writes off —
 *  at every boot, and the driver REBOOTS through the $0400 entry on every
 *  set upload; only a played $F5 clears it ($F6 re-sets it; SFX and the
 *  voice-7 ambient interpreter have no echo ops; nothing else in the engine
 *  references $2C00-$3BFF — sweep 2026-07-09). So when every song playable
 *  in a module's context is echo-free, the region is plain RAM an import
 *  may claim — the "No echo" import option. Other sets' echo writes
 *  self-heal: returning re-uploads the changed module. */
export const ECHO_BUFFER_REGION = { start: 0x2c00, end: 0x3c00 } as const;

/** UI display names for the upload modules (role-derived; the internal
 *  `module` identifiers stay dev-facing). Keyed by block id. */
export const SPC_BLOCK_DISPLAY_NAMES: Readonly<Record<number, string>> = {
  0x01: 'athletic instruments',
  0x04: 'athletic songs',
  0x07: 'bonus-game songs',
  0x0a: 'boss songs',
  0x0d: 'underground songs',
  0x10: 'overworld songs',
  0x13: 'flower-garden songs',
  0x16: 'cave/boss instruments',
  0x19: 'garden/bonus instruments',
  0x1c: 'map songs + jingles',
  0x1f: 'big-boss songs',
  0x22: 'map/castle instruments',
  0x25: 'base samples + SFX',
  0x28: 'castle songs',
  0x2b: 'sound driver + title data',
  0x2e: 'intro/practice songs',
  0x31: 'Bowser samples',
  0x34: 'Bowser songs',
  0x37: 'ending samples',
  0x3a: 'ending songs',
};

/** Song display names, keyed `"<blockSetRow>:<songSlotId>"`.
 *
 *  Naming follows the SMW Central community soundtrack pack's track structure
 *  (LadiesMan217 / Musicalman's YI OST port — the de facto public track
 *  list). Every assignment was verified mechanically by audio-fingerprint
 *  correlation between our synthesized .spc for the slot and the pack's SPC
 *  of the same name (log-band spectral signatures over ffmpeg+libgme PCM;
 *  tmp/song-name-match.ts), cross-checked against the framework's
 *  behavior-derived MusicIDs.asm roles (e.g. the level-intro cutscene
 *  requests slot $03; Raphael's boss-clear exit requests slot $05; Baby
 *  Bowser's phase cues request $0B/$0C — Bank0D).
 *
 *  Confidence: unmarked = fingerprint match ≥0.95 with clear margin.
 *  "(≈)" in the comment = weaker/ambiguous fingerprint, assigned by role +
 *  channel-count evidence. Slots with no OST counterpart get role names.
 *
 *  Independent corroboration (2026-07-08): the AddMusicY beta's "YI ARAM
 *  Map" names the retail $FF90+ slots by role — level / invincibility /
 *  level-intro / game-over / GOAL / scoreboard / death / toadies / map×7 —
 *  agreeing with every map-row assignment below, including the two (≈)
 *  jingles (slot 3 "level intro" = Game Start, slot 8 "toadies" = Mario
 *  Kidnapped). */
export const SONG_NAMES: Readonly<Record<string, string>> = {
  // Title context (engine-only row) — the driver's 3 songs. Roles verified
  // against the 65816 source (asm-analysis), not the OST track titles:
  //  0:1 title-screen theme — gm_load_title_screen ($09) plays slot 1
  //      (Bank17 CODE_1785FC: LDA #$01 → PlayMusicLo).
  //  0:2 opening story cutscene ("Once upon a time…") — gm05_load_cutscene
  //      queues MusicID02 = slot 2 (Bank0F CODE_gm05_load_cutscene).
  //  0:3 title-screen theme, post-final-world variant — the SAME title routine
  //      does INC:INC → 3 when !RAM_YI_Level_FinalWorldUnlockedFlag is set; its
  //      sequence data is a subset of 0:1 (the shared title melody).
  '0:1': 'Title Screen',
  '0:2': 'Storybook',
  '0:3': 'Title Screen (Final World)',
  // Intro / practice (1W-0)
  '1:1': 'Yoshi\'s Start Demo',
  '1:2': 'Practice Course',
  '1:3': 'Game Start', // (≈) level-intro cutscene jingle (slot $03 caller)
  '1:4': 'Game Over',
  '1:7': 'Player Down',
  '1:8': 'Mario Kidnapped', // (≈) intro-cutscene cue (slot $08 caller)
  // Map (the jingle slots 3/4/7/8 are the same data as the intro row's)
  '2:1': 'Map (World 1)',
  '2:2': 'Powerful Infant',
  '2:3': 'Game Start',
  '2:4': 'Game Over',
  '2:5': 'Goal',
  '2:6': 'Score',
  '2:7': 'Player Down',
  '2:8': 'Mario Kidnapped',
  '2:9': 'Map (World 1)',
  '2:10': 'Map (World 2)',
  '2:11': 'Map (World 3)',
  '2:12': 'Map (World 4)',
  '2:13': 'Map (World 5)',
  '2:14': 'Map (World 6)',
  '2:15': 'Map (World 7)',
  // Level themes
  '3:1': 'Flower Garden',
  '4:1': 'Overworld',
  '5:1': 'Underground',
  '6:1': 'Castle & Fortress',
  // Boss (fort) set
  '7:1': "In Front of the Boss' Room",
  '7:9': 'Kamek',
  '7:10': 'Mid-Boss',
  // Bonus challenge
  '8:1': 'Bonus Game',
  // Big Boss (castle) set
  '9:1': "In Front of the Boss' Room",
  '9:5': 'Big Boss Clear',
  '9:9': 'Kamek',
  '9:10': 'Big Boss',
  '9:11': 'Baby Bowser (phase cue)', // no OST counterpart; Bank0D requests slot $0B
  '9:12': 'Big Boss (No Intro)',
  // Athletic
  '10:1': 'Athletic',
  // Bowser
  '11:1': 'Bowser',
  '11:9': "Luigi's Rescue",
  '11:10': 'Bowser Clear', // (≈) victory fanfare; channel-count + role
  // Ending
  '12:1': 'Ending (Part 1)',
  '12:2': 'Ending (Part 2)',
};

/** Display name for a song slot within a block-set row ("Songs" browser +
 *  export filenames + ID666 titles). Falls back to the bare slot id. */
export function songDisplayName(blockSetRow: number, songSlotId: number): string {
  return SONG_NAMES[`${blockSetRow}:${songSlotId}`]
    ?? `Song 0x${songSlotId.toString(16).toUpperCase().padStart(2, '0')}`;
}

// ── UI vocabulary (one name per concept, everywhere the user sees it) ────────
//  - "music value"  = a music SETTING below (level-header field-13 value
//    0x00-0x0F, or an engine context 0x10-0x13). Code keeps `setting`.
//  - "song set"     = a BLOCK-SET ROW (one DATA_spc_data_blocks row — the
//    modules the game loads together). Code keeps `blockSetRow` (the
//    asm-anchored term); the Song Sets / Edit Song Sets tabs speak "set".
//  - "module"       = one DATA_SPC_ptr upload blob (sample bank / song
//    module / the sound driver) — SPC_BLOCK_DISPLAY_NAMES below.
//  - "entry song"   = the slot auto-played on a set change (init song).

/** Music settings 0x00-0x13 — level-header values 0x00-0x0F plus the engine
 *  contexts 0x10-0x13 the header can't express. Names for 0x00-0x0D are
 *  IDENTICAL to the Header panel's MUSIC_TRACKS labels (header-schema.ts) —
 *  one game concept, one name everywhere; keep the two lists in lockstep
 *  (0x0E/0x0F share the "Custom 0xNN" base; the dropdown adds a silence
 *  hint). */
export const MUSIC_SETTING_NAMES: readonly string[] = [
  'Flower Garden',            // 0x00
  'Overworld (above-ground)', // 0x01
  'Castle / Fortress',        // 0x02
  'Boss',                     // 0x03
  'Underground',              // 0x04
  'Boss (instant-boss variant)',      // 0x05
  'Bonus Game',               // 0x06
  'Big Boss',                 // 0x07
  'Big Boss (instant-boss variant)',  // 0x08
  'Big Boss (hard-mode variant)',     // 0x09 (Tap-Tap)
  'Athletic',                 // 0x0A
  'Invincible Mario (star)',  // 0x0B
  'King Bowser',              // 0x0C
  'Special 4',                // 0x0D
  'Custom 0x0E',              // 0x0E (free — silent until repointed)
  'Custom 0x0F',              // 0x0F (free — silent until repointed)
  'Title',                    // 0x10
  '1W-0 Demo',                // 0x11
  'Map',                      // 0x12
  'Ending',                   // 0x13
] as const;

export interface MusicSetting {
  /** Music setting value (0x00-0x13; header field 13 expresses 0x00-0x0F). */
  setting: number;
  name: string;
  /** True for the free header values (0x0E/0x0F) — no shipped level uses
   *  them; they alias block-set row 0 ahead of Title. */
  unused: boolean;
  /** Row index into DATA_spc_data_blocks. */
  blockSetRow: number;
  /** Block ids the setting uploads, in upload order ($FF slots dropped). */
  blockIds: number[];
  /** Song slot id auto-played on level start (DATA_01B24B; 0 = none). */
  initSongId: number;
  /** DATA_item_denial_table value (0=items ok, 1=disabled, 0xFF=inherit). */
  itemDenial: number;
}

export interface AudioCatalog {
  blocks: readonly SpcBlockInfo[];
  /** Block id → PC offset of the module's upload stream in the ROM. */
  blockPc: Map<number, number>;
  /** The 13 DATA_spc_data_blocks rows (block ids, $FF slots dropped). */
  blockSetRows: number[][];
  /** Music settings 0x00-0x13 resolved through DATA_spc_block_set_indexes. */
  settings: MusicSetting[];
}

/** Read the audio tables from the built ROM. All offsets go through the
 *  symbol map so asm-layout changes (or a future V1.1 map) survive. */
export function readAudioCatalog(rom: Uint8Array, symbols: SymbolMap): AudioCatalog {
  // DATA_SPC_ptr: 20 `dl` rows; block id = raw byte offset into the table.
  const ptrPc = symbols.pc('DATA_SPC_ptr');
  const blockPc = new Map<number, number>();
  for (const block of SPC_BLOCKS) {
    const p = ptrPc + block.blockId - 1; // id = entry*3+1 → row start = id-1
    blockPc.set(block.blockId, snesToPC(u24le(rom, p)));
  }

  // DATA_spc_data_blocks: 13 rows × 4 bytes (≤3 block ids + $FF fill).
  const rowsPc = symbols.pc('DATA_spc_data_blocks');
  const blockSetRows: number[][] = [];
  for (let row = 0; row < 13; row++) {
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const id = rom[rowsPc + row * 4 + i];
      if (id !== 0xff) ids.push(id);
    }
    blockSetRows.push(ids);
  }

  // DATA_spc_block_set_indexes: byte 0 is a sentinel; setting s → byte s+1,
  // holding the row's *byte offset* (row*4). DATA_item_denial_table and
  // DATA_01B24B are 1-based on the setting the same way.
  const setIdxPc = symbols.pc('DATA_spc_block_set_indexes');
  const denialPc = symbols.pc('DATA_item_denial_table');
  const initPc = symbols.pc('DATA_01B24B');
  const settings: MusicSetting[] = [];
  for (let setting = 0; setting <= 0x13; setting++) {
    const rowOffset = rom[setIdxPc + 1 + setting];
    const blockSetRow = rowOffset / 4;
    if (!Number.isInteger(blockSetRow) || blockSetRow >= blockSetRows.length) {
      throw new Error(`music setting 0x${setting.toString(16)}: bad block-set row offset 0x${rowOffset.toString(16)}`);
    }
    settings.push({
      setting,
      name: MUSIC_SETTING_NAMES[setting],
      unused: setting === 0x0e || setting === 0x0f,
      blockSetRow,
      blockIds: [...blockSetRows[blockSetRow]],
      // DATA_01B24B is read `-1,x` with X = the 1-based setting → entry
      // `setting`; 19 entries cover 0x00-0x12, so 0x13 (Ending) has none.
      initSongId: setting <= 0x12 ? rom[initPc + setting] : 0,
      itemDenial: rom[denialPc + setting] ?? 0xff,
    });
  }

  return { blocks: SPC_BLOCKS, blockPc, blockSetRows, settings };
}

/** Parse a block's upload stream out of the ROM. */
export function parseBlockFromRom(rom: Uint8Array, catalog: AudioCatalog, blockId: number): ParsedUploadStream {
  const pc = catalog.blockPc.get(blockId);
  if (pc === undefined) throw new Error(`no ROM location for block 0x${blockId.toString(16)}`);
  return parseUploadStream(rom, pc);
}

/** One representative setting per block-set row — the first non-`unused`
 *  setting that uses the row. Settings sharing a row upload identical audio,
 *  so per-row walks (export-all, the decode sweep, reports) enumerate the 13
 *  rows through this instead of all 20 settings. */
export function representativeSettingByRow(catalog: AudioCatalog): Map<number, number> {
  const rep = new Map<number, number>();
  for (const s of catalog.settings) {
    if (s.unused) continue;
    if (!rep.has(s.blockSetRow)) rep.set(s.blockSetRow, s.setting);
  }
  return rep;
}

/** Lowercase slug for export file names. */
export const exportSlug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Canonical exported-song file name (`<row>-<slot>-<title>.spc`) — shared by
 *  the export-spc CLI and the app's Export tab so the two never diverge. */
export function songExportFileName(blockSetRow: number, songSlotId: number, title: string): string {
  return `${String(blockSetRow).padStart(2, '0')}-${songSlotId.toString(16).padStart(2, '0')}-${exportSlug(title)}.spc`;
}

/** Extracted-sample directory name (assets/yi/SPC700/Samples/<dir>) per
 *  sample-carrying block. The engine block carries the title screen's own
 *  bank. Keys double as the Export tab's bank grouping. */
export const SPC_BLOCK_SAMPLE_DIRS: Readonly<Record<number, string>> = {
  0x01: 'Athletic',
  0x16: 'CaveFortBoss',
  0x19: 'BonusCastleBossGrassland',
  0x22: 'IntroMapCastleFort',
  0x25: 'Global',
  0x2b: 'TitleScreen',
  0x31: 'Bowser',
  0x37: 'Ending',
};

/** Wrapper asm (relative to `yi/`) holding each bank's ARAM sample
 *  directory — the authority for loop-start offsets
 *  (sample-import.ts parseSampleLoopOffsets). */
export const SAMPLE_BANK_WRAPPERS: Readonly<Record<string, string>> = {
  Athletic: 'SPC700/AthleticSampleBank.asm',
  BonusCastleBossGrassland: 'SPC700/BonusCastleBossGrasslandSampleBank.asm',
  Bowser: 'SPC700/BowserSampleBank.asm',
  CaveFortBoss: 'SPC700/CaveFortBossSampleBank.asm',
  Ending: 'SPC700/EndingSampleBank.asm',
  Global: 'SPC700/GlobalSampleBank.asm',
  IntroMapCastleFort: 'SPC700/IntroMapCastleFortSampleBank.asm',
  TitleScreen: 'SPC700/SPC700_Engine_YI.asm',
};

/** Community-sourced sample display names, keyed by bank dir name
 *  (SPC_BLOCK_SAMPLE_DIRS values), indexed by directory-entry index (the
 *  extracted `NN.brr` number; == SRCN for the Global bank's monotonic dir).
 *
 *  Source: the AddMusicY beta's "List of Instruments (Unfinished).txt"
 *  (../AddMusicY Beta/) — its #default table maps @0-@23 1:1 onto global
 *  SRCNs $00-$17, and its "flower garden set" @24-@27 are grasslandbank's 4 add-on
 *  samples ($18-$1B). Cross-consistent with our own usage analysis
 *  (tmp/aram-reclaim-report.ts): e.g. $01 "Baby Mario Cry" and $05 "Toadie"
 *  are SFX-record samples; $09/$17 (Buzz Thing/Splash) drive the voice-7
 *  ambient presets. Only well-attested banks are named — the other add-on
 *  banks' lists are incomplete in the AMY doc (a lone "@27 Octave Brass"
 *  for Athletic). */
export const SAMPLE_DISPLAY_NAMES: Readonly<Record<string, readonly (string | null)[]>> = {
  Global: [
    'Paper Rustle', 'Baby Mario Cry', 'Bongo', 'Vibraphone',
    'Slap Bass', 'Toadie', 'Organ', 'Cowbell',
    'Chorded Guitar', 'Buzz Thing', 'Trumpet', 'Boing!',
    'Lick', 'Boom', 'Glock', 'Orchestral Hit',
    'Recorder', 'Snare', 'Violin', 'Jazz Guitar',
    'Piranha Plant', 'Enemy Stomp', 'Pop!', 'Splash',
  ],
  BonusCastleBossGrassland: ['Kick', 'Closed Hi-hat', 'Open Hi-hat', 'Harmonica'],
  Athletic: [null, null, null, 'Octave Brass'],
};

/** Display name for a bank sample, or null when unattested. */
export function sampleDisplayName(bank: string, index: number): string | null {
  return SAMPLE_DISPLAY_NAMES[bank]?.[index] ?? null;
}

export interface BankSampleSlice {
  /** Directory-entry index — matches the extracted file name (`NN.brr`). */
  index: number;
  file: string;
  /** ARAM address of the sample's first BRR byte. */
  aramStart: number;
  /** Byte length of the sample's slot (== the extracted file's size; the
   *  bank's last slice includes its slice-to-block-end padding). */
  byteLength: number;
}

/** Derive a bank block's per-sample ARAM slices from its own upload stream:
 *  the $3Cxx directory block lists (start, loop) pairs; entries backed by
 *  this module's own data blocks are sorted by ARAM start (extract slices
 *  the module's data in offset order — the Bowser bank's directory is NOT
 *  monotonic and lists entries other modules back), and each sample runs to
 *  the next backed start (last: to its data block's end). `index`/`file`
 *  therefore match the extracted `NN.brr` numbering. Pinned against the
 *  extracted files' sizes in sample-import.test.ts. */
export function bankSampleSlices(rom: Uint8Array, catalog: AudioCatalog, blockId: number): BankSampleSlice[] {
  const { stream } = parseBlockFromRom(rom, catalog, blockId);
  const dataBlocks = stream.blocks
    .filter((b) => b.dest >= 0x4000)
    .map((b) => ({ start: b.dest, end: b.dest + b.data.length }));
  const starts: number[] = [];
  for (const b of stream.blocks) {
    if (b.dest < 0x3c00 || b.dest >= 0x3d00) continue;
    for (let off = 0; off + 3 < b.data.length; off += 4) {
      starts.push(u16le(b.data, off));
    }
  }
  const backed = [...new Set(starts)]
    .map((start) => ({ start, home: dataBlocks.find((d) => start >= d.start && start < d.end) }))
    .filter((e): e is { start: number; home: { start: number; end: number } } => e.home !== undefined)
    .sort((a, b) => a.start - b.start);
  return backed.map((e, index) => {
    const next = backed.find((o) => o.start > e.start && o.home === e.home);
    return {
      index,
      file: `${index.toString(16).toUpperCase().padStart(2, '0')}.brr`,
      aramStart: e.start,
      byteLength: (next ? next.start : e.home.end) - e.start,
    };
  });
}

/** ARAM song-pointer table location: slot n (1-based) is read from $FF8E+2n
 *  by CODE_music_load_song. Slot ids are what MusicIDs.asm calls "song IDs". */
export const SONG_TABLE_BASE = 0xff8e;

/** Song slots a module patches: every upload block targeting the $FF90 table
 *  region declares its slots by (dest, length). Returns slot id → ARAM ptr. */
export function songSlotsOfStream(stream: { blocks: { dest: number; data: Uint8Array }[] }): Map<number, number> {
  const slots = new Map<number, number>();
  for (const b of stream.blocks) {
    if (b.dest < SONG_TABLE_BASE || b.dest >= 0x10000) continue;
    if (b.dest > 0xffee) continue; // not plausibly the song table
    for (let off = 0; off + 1 < b.data.length; off += 2) {
      const aramAddr = b.dest + off;
      if ((aramAddr - SONG_TABLE_BASE) % 2 !== 0) continue;
      const slot = (aramAddr - SONG_TABLE_BASE) / 2;
      if (slot < 1 || slot > 0x14) continue;
      const ptr = u16le(b.data, off);
      if (ptr !== 0) slots.set(slot, ptr);
    }
  }
  return slots;
}
