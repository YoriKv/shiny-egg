// MML compiler front end — compiles community MML into the YI driver's
// sequence IR (TrackEvents + patterns + instrument rows + samples), ready for
// mml-module.ts to assemble into an upload-stream module. Two dialects:
//
//  - 'amk'  — AddmusicK package format (the SMW Central port corpus; file
//             declares `#amk N`). Raw $-hex is the AMK/SMW driver's command
//             set and is TRANSLATED to YI vcmds; constructs with no YI
//             equivalent follow the gap policies pinned in
//             research/plan-audio-panel.md §1.11 (superloop unroll, remote
//             key-on inlining, ADSR/GAIN → synthetic instrument rows, …).
//             Every approximation/drop lands in `report` (the port report).
//  - 'amy'  — AddMusicY dialect (YI-native letter commands, #patterns/
//             #tracks/#local_samples/#instruments; raw $-hex passes through
//             as YI vcmds). Grammar per the AMY beta command reference +
//             source (../AddMusicY/, analyzed 2026-07-08).
//
// Both front ends share the structural layer: notes/lengths/ties/triplets,
// loops-as-$EF-subroutines (bodies out-of-line, no nesting — the driver has
// one return slot per voice), sticky length+gate/velocity emission, and the
// intro/loop 2-pattern default song shape. Detection: detectMmlDialect.

import type { TrackEvent } from './sequence.ts';
import { SAMPLE_DISPLAY_NAMES } from './catalog.ts';

export type MmlDialect = 'amk' | 'amy';

// ── SMW stock-instrument mapping (AMK mode) ──────────────────────────────────
// SMW's default samples don't exist on YI; stock @0-@18/@21-@29 uses map onto
// resident YI global-bank samples (zero sample-budget cost) as synthetic
// instrument rows. Facts from the AddmusicK distribution
// (../AddmusicK/test/asm/InstrumentData.asm + Music.cpp instrToSample/
// tmpTrans); the SMW→YI sample pairing is curated by musical role and every
// use is reported for audible verification.

/** SMW default instrument rows @0-@19: SRCN, ADSR1, ADSR2, GAIN, tune, sub. */
const SMW_DEFAULT_ROWS: readonly (readonly number[])[] = [
  [0x00, 0xfe, 0x6a, 0xb8, 0x06, 0x00], [0x01, 0xfa, 0x6a, 0xb8, 0x03, 0x00],
  [0x02, 0xae, 0x2f, 0xb8, 0x04, 0x00], [0x03, 0xfe, 0x6a, 0xb8, 0x03, 0x00],
  [0x04, 0xa9, 0x6a, 0xb8, 0x03, 0x00], [0x07, 0xae, 0x26, 0xb8, 0x07, 0x00],
  [0x08, 0xfa, 0x6a, 0xb8, 0x03, 0x00], [0x09, 0x9e, 0x1f, 0xb8, 0x03, 0x00],
  [0x05, 0xae, 0x26, 0xb8, 0x1e, 0x00], [0x0a, 0xee, 0x6a, 0xb8, 0x02, 0x00],
  [0x0b, 0xfe, 0x6a, 0xb8, 0x08, 0x00], [0x01, 0xf7, 0x6a, 0xb8, 0x03, 0x00],
  [0x10, 0x0e, 0x6a, 0x7f, 0x04, 0x00], [0x0c, 0xfe, 0x6a, 0xb8, 0x03, 0x00],
  [0x0d, 0xae, 0x26, 0xb8, 0x07, 0x00], [0x12, 0x8e, 0xe0, 0xb8, 0x03, 0x00],
  [0x0c, 0xfe, 0x70, 0xb8, 0x03, 0x00], [0x11, 0xfe, 0x6a, 0xb8, 0x05, 0x00],
  [0x01, 0xe9, 0x6a, 0xb8, 0x03, 0x00], [0x0f, 0x0f, 0x6a, 0x7f, 0x03, 0x00],
];

/** SMW percussion @21-@29: SRCN, ADSR1, ADSR2, GAIN, tune, sub, fixed pitch
 *  (the note byte the drum plays regardless of the written note). */
const SMW_PERC_ROWS: readonly (readonly number[])[] = [
  [0x0f, 0x0f, 0x6a, 0x7f, 0x03, 0x00, 0xa8], [0x06, 0x0e, 0x6a, 0x40, 0x07, 0x00, 0xa4],
  [0x06, 0x8c, 0xe0, 0x70, 0x07, 0x00, 0xa1], [0x0e, 0xfe, 0x6a, 0xb8, 0x07, 0x00, 0xa4],
  [0x0e, 0xfe, 0x6a, 0xb8, 0x08, 0x00, 0xa4], [0x0b, 0xfe, 0x6a, 0xb8, 0x02, 0x00, 0x9c],
  [0x0b, 0x7e, 0x6a, 0x7f, 0x08, 0x00, 0xa6], [0x0b, 0x7e, 0x6a, 0x30, 0x08, 0x00, 0xa6],
  [0x0e, 0x0e, 0x6a, 0x7f, 0x03, 0x00, 0xa1],
];

/** SMW driver note transpose per stock instrument (added at play time —
 *  folded into the substitute row's tuning as 2^(n/12)). */
// AMK SUBTRACTS these from emitted note bytes for stock instruments (the
// samples are tuned +t to compensate); we emit written bytes verbatim, so
// the substitute row's tuning shifts by 2^(-t/12) instead.
const SMW_TMP_TRANS: readonly number[] = [0, 0, 5, 0, 0, 0, 0, 0, 0, -5, 6, 0, -5, 0, 0, 8, 0, 0, 0];

const SMW_INSTRUMENT_NAMES: readonly string[] = [
  'flute', 'strings', 'xylophone', 'marimba', 'strings (strong)', 'acoustic guitar',
  'trumpet', 'steel drum', 'bass guitar', 'piano', 'drums', 'strings (light)',
  'bongos', 'electric guitar', 'harpsichord', 'orchestra hit', 'electric guitar (light)',
  'distortion guitar', 'strings',
];
const SMW_PERC_NAMES: readonly string[] = [
  'kick', 'closed hi-hat', 'maracas', 'snare', 'snare 2', 'bass drum', 'bass drum 2', 'bass drum (soft)', 'trap snare',
];

/** SMW sample index → canonical tuning of its melodic default row (the base
 *  the port's tuning is relative to; percussion-only samples use their
 *  percussion row's). */
const SMW_SAMPLE_BASE_TUNING: Readonly<Record<number, number>> = {
  0x00: 6, 0x01: 3, 0x02: 4, 0x03: 3, 0x04: 3, 0x05: 30, 0x06: 7, 0x07: 7,
  0x08: 3, 0x09: 3, 0x0a: 2, 0x0b: 8, 0x0c: 3, 0x0d: 7, 0x0e: 7, 0x0f: 3,
  0x10: 4, 0x11: 5, 0x12: 3,
};

/** Curated SMW sample → YI global-bank sample pairing (by musical role). */
const SMW_SAMPLE_TO_YI: Readonly<Record<number, number>> = {
  0x00: 0x10, // flute → Recorder
  0x01: 0x12, // strings → Violin
  0x02: 0x0e, // xylophone → Glock
  0x03: 0x03, // marimba → Vibraphone
  0x04: 0x12, // strong strings → Violin
  0x05: 0x04, // bass → Slap Bass
  0x06: 0x00, // hi-hat/maracas → Paper Rustle
  0x07: 0x13, // acoustic guitar → Jazz Guitar
  0x08: 0x0a, // trumpet → Trumpet
  0x09: 0x0e, // steel drum → Glock
  0x0a: 0x13, // piano → Jazz Guitar
  0x0b: 0x0d, // drums/bass drum → Boom
  0x0c: 0x08, // electric guitar → Chorded Guitar
  0x0d: 0x13, // harpsichord → Jazz Guitar
  0x0e: 0x11, // snare → Snare
  0x0f: 0x15, // kick → Enemy Stomp
  0x10: 0x02, // bongos → Bongo
  0x11: 0x08, // distortion guitar → Chorded Guitar
  0x12: 0x0f, // orchestra hit → Orchestral Hit
};

/** When the import target's music set carries the grassland add-on bank
 *  (grasslandbank — Flower Garden / Bonus / Big Boss sets), SMW drum samples map onto
 *  YI's REAL drums instead of the global-bank approximations. */
const GRASSLAND_DRUM_OVERRIDES: Readonly<Record<number, number>> = {
  0x0f: 0x18, // SMW kick → Kick
  0x06: 0x19, // SMW hi-hat/maracas → Closed Hi-hat
  0x0b: 0x18, // SMW bass drums / melodic drums → Kick
};

/** SMW timbres YI lacks entirely, covered by samples PACKAGED with the app
 *  (yi/SPC700/ExtraSamples/, the AMY community library — see the provenance
 *  README there) and carried into the module as custom samples. `tuning` is
 *  the sample's canonical multiplier (from the AMY SM3DW example rows:
 *  %pitch(1200) = ×2, %pitch(1700) = ×2^(17/12)) — the T_yi term of the
 *  correction formula. */
// Tunings use the N-SPC 768-base convention: bytes = round(768 × 2^(cents/1200))
// — %pitch(0) = $0300, which matches the cart's own default rows.
const PACKAGED_SAMPLE_OVERRIDES: Readonly<Record<number, { key: 'panFlute' | 'brass'; name: string; tuning: number }>> = {
  0x00: { key: 'panFlute', name: 'Pan Flute', tuning: Math.round(768 * Math.pow(2, 1700 / 1200)) / 256 }, // SMW flute, %pitch(1700)
  0x08: { key: 'brass', name: 'Brass', tuning: Math.round(768 * 2) / 256 }, // SMW trumpet/brass, %pitch(1200)
};

/** SMW sample index → file name in the community "Super Mario World
 *  Samples" pack (AMK-format .brr, 2-byte loop header). The mapping is
 *  row-matched: the pack's SMW.txt #instruments rows carry the same
 *  ADSR/tuning bytes as AMK's InstrumentData.asm rows (SMW_DEFAULT_ROWS /
 *  SMW_PERC_ROWS above), pairing each file to the SRCN those rows
 *  reference (e.g. @14's $AE $26 … $07 row ↔ "Slap Bass.brr", the
 *  $7E $6A $30 $08 percussion row ↔ "Snare Drum.brr"). */
export const SMW_SAMPLE_FILES: Readonly<Record<number, string>> = {
  0x00: 'Flute.brr', 0x01: 'Violin.brr', 0x02: 'Glockenspiel.brr', 0x03: 'Marimba.brr',
  0x04: 'Cello.brr', 0x05: 'Acoustic Bass.brr', 0x06: 'Closed Hi-Hat.brr',
  0x07: 'Acoustic Steel Guitar.brr', 0x08: 'Trumpet.brr', 0x09: 'Steel Drum.brr',
  0x0a: 'Acoustic Grand.brr', 0x0b: 'Snare Drum.brr', 0x0c: 'Electric Piano.brr',
  0x0d: 'Slap Bass.brr', 0x0e: 'Power Snare.brr', 0x0f: 'Bass Drum.brr',
  0x10: 'Bongo.brr', 0x11: 'Distortion Guitar.brr', 0x12: 'Orchestra Hit.brr',
  0x13: 'Thunder.brr',
};

const yiSampleName = (srcn: number): string =>
  (srcn >= 0x18
    ? SAMPLE_DISPLAY_NAMES.BonusCastleBossGrassland?.[srcn - 0x18]
    : SAMPLE_DISPLAY_NAMES.Global?.[srcn]) ?? `$${srcn.toString(16)}`;

export class MmlCompileError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

/** Port-report grouping: related lines cluster together, instruments first.
 *  Lines keep their encounter order within each group. */
type ReportCategory = 'instrument' | 'sample' | 'volume' | 'timing' | 'echo' | 'other';
const REPORT_CATEGORY_ORDER: readonly ReportCategory[] = ['instrument', 'sample', 'volume', 'timing', 'echo', 'other'];

// ── detection ────────────────────────────────────────────────────────────────

export interface MmlDetection {
  dialect: MmlDialect | null;
  /** Human-readable evidence (shown in the import UI on ambiguity). */
  reasons: string[];
}

/** Detect which dialect a source file is. `#amk`/`#am4`/`#amm` are decisive
 *  (AMK inserts `#amk` into every song it touches); AMY has no version
 *  directive, so it's recognized by structural fingerprints. */
export function detectMmlDialect(text: string): MmlDetection {
  const reasons: string[] = [];
  if (/^\s*#amk\s+\d+/im.test(text)) return { dialect: 'amk', reasons: ['#amk directive'] };
  if (/^\s*#(am4|amm)\b/im.test(text)) return { dialect: 'amk', reasons: ['#am4/#amm directive (ancient Addmusic dialect)'] };

  const amyMarks: [RegExp, string][] = [
    [/#patterns\s*\{/i, '#patterns block'],
    [/#tracks\s*\{/i, '#tracks block'],
    [/#local_samples\s*\{/i, '#local_samples block'],
    [/#(default|fg_set)\b/i, '#default/#fg_set instrument set'],
    [/~[mnpuxz]\b/, '~-family off command'],
    [/\bs\d+\s*,\s*[tvwyxp]/, 's-fade command'],
    [/!print\b/, '!print'],
    [/%[a-z_]+\s*\(/, '%-macro call'],
    [/\?[a-z_][a-z0-9_]*\s*=\s*:/i, '?var definition'],
  ];
  for (const [re, why] of amyMarks) if (re.test(text)) reasons.push(why);
  if (reasons.length > 0) return { dialect: 'amy', reasons };

  const amkMarks: [RegExp, string][] = [
    [/#spc\s*\{/i, '#spc block'],
    [/#samples\s*\{/i, '#samples block'],
    [/\(![0-9a-z]+\)/i, 'remote code'],
    [/\[\[/, 'superloop'],
    [/#option\b/i, '#option directive'],
  ];
  for (const [re, why] of amkMarks) if (re.test(text)) reasons.push(why);
  if (reasons.length > 0) return { dialect: 'amk', reasons };
  return { dialect: null, reasons: ['no version directive or dialect fingerprints'] };
}

// ── compiled output ──────────────────────────────────────────────────────────

export interface MmlMeta {
  title?: string;
  game?: string;
  author?: string;
  comment?: string;
  /** #length "m:ss" verbatim when present. */
  length?: string;
}

/** One $3D00 instrument record (6 bytes: SRCN/noise, ADSR1, ADSR2, GAIN,
 *  pitch-mult hi, lo). */
export interface MmlInstrumentRow {
  bytes: [number, number, number, number, number, number];
  /** Provenance for diagnostics ("custom @30", "synthetic gain $91 of @31"…). */
  source: string;
}

export interface MmlSample {
  /** File name as written in the MML. */
  name: string;
  /** BRR payload (AMK 2-byte loop header stripped). */
  data: Uint8Array;
  /** Loop start, byte offset into `data` (from the header). */
  loopOffset: number;
}

export interface CompiledMml {
  dialect: MmlDialect;
  meta: MmlMeta;
  /** Part list: pattern indices into `patterns`, in play order. */
  parts: number[];
  /** Index into `parts` the song loops back to; null = play once (no loop). */
  loopPartIndex: number | null;
  /** Each pattern = 8 voice entries of track id, or -1 for silent. */
  patterns: number[][];
  /** Track id → event stream (top level). */
  trackEvents: TrackEvent[][];
  /** Subroutine id → event stream. $EF events in any stream carry
   *  args [subId & $FF, subId >> 8, count] until mml-module fixes them up. */
  subEvents: TrackEvent[][];
  /** `#N=continue` chains: track N's stream is a window into its
   *  predecessor's — laid out contiguously with no terminator between
   *  (the retail conductor/continuation trick). */
  continuations: { track: number; prev: number }[];
  instrumentRows: MmlInstrumentRow[];
  /** Directory entries in slot order (SRCN `sampleSrcnBase` + index).
   *  Entries may share a `sampleIndex` (AMY re-lists a name to alias). */
  dirEntries: { sampleIndex: number }[];
  samples: MmlSample[];
  /** First custom-sample SRCN: $18, or $1C in grassland-drums mode (the
   *  add-on keeps its $18-$1B slots — mml-module places dir + data
   *  accordingly). */
  sampleSrcnBase: number;
  /** True when SMW drums mapped onto the grassland bank's real drums. */
  usedGrasslandDrums: boolean;
  /** AMK $F4 $02 emulation actually split notes (note + 2-tick tie) — a
   *  seq-budget overflow can retry with emulateLightStaccato: false. */
  usedLightStaccato: boolean;
  /** Real SMW samples were carried into the module (smwSamples library) —
   *  a sample-budget overflow can retry without them. */
  usedSmwSamples: boolean;
  /** True when app-packaged extra samples (Pan Flute/Brass) were carried. */
  usedPackagedSamples: boolean;
  /** Port report — every approximation, drop, and notable mapping. */
  report: string[];
}

export interface CompileMmlOptions {
  /** Read a file referenced by the MML (sample .brr), path relative to the
   *  MML's folder. Return null when absent — the compiler tries fallbacks
   *  (#path prefix, bare name, samples/ subdir) before erroring. */
  readFile(relPath: string): Uint8Array | null;
  /** 144-byte $3D00 rows 0-23 for AMY `#default` (sourced from the cart's
   *  flower-garden module — required only when the file uses #default). */
  defaultInstrumentRows?: Uint8Array;
  /** 24-byte rows 24-27 for AMY `#fg_set`. */
  fgSetInstrumentRows?: Uint8Array;
  /** App-packaged extra samples (yi/SPC700/ExtraSamples/) for SMW timbres
   *  YI lacks — carried into the module when its stock instruments need
   *  them (PACKAGED_SAMPLE_OVERRIDES). Omit to approximate with the global
   *  bank instead. */
  packagedSamples?: {
    panFlute?: { data: Uint8Array; loopOffset: number };
    brass?: { data: Uint8Array; loopOffset: number };
  };
  /** SMW drums map onto YI's real Kick/Closed Hi-hat (the grassland add-on
   *  bank, grasslandbank). Two modes:
   *  - `resident: true` — the import TARGET's set carries grasslandbank: drum rows
   *    reference SRCN $18/$19 directly; custom samples shift to $1C+ and
   *    relocate after the sequence (the $B960 window belongs to the bank).
   *  - `resident: false` — any other target: the drum BRRs (cart-sliced,
   *    `kick`/`closedHat`) ride the module as ordinary custom samples.
   *  `rows` = the cart's fg_set table (the drums' tunings). Omit the whole
   *  option to fall back to global-bank approximations. */
  grasslandBank?: {
    rows: Uint8Array;
    resident: boolean;
    kick?: { data: Uint8Array; loopOffset: number };
    closedHat?: { data: Uint8Array; loopOffset: number };
  };
  /** Echo-delay clamp ceiling. Default 2 (safe everywhere). Pass 3 when the
   *  import target is a JINGLE_FREE_SONG_MODULES module (catalog.ts) — its
   *  context never reads the $264C jingle region the EDL-3 buffer covers.
   *  Values above 3 are ignored (EDL ≥ 4 is fatal on YI: buffer over the
   *  SFX block / driver code). */
  echoDelayLimit?: number;
  /** Emulate AMK's $F4 $02 light staccato by re-emitting affected full-gate
   *  notes as note + 2-tick tie (default true). False = the seq-budget
   *  fallback: the command is dropped with a report line and those notes
   *  ring 1 tick shorter than under AMK's driver. */
  emulateLightStaccato?: boolean;
  /** Real SMW sample library (the "Super Mario World Samples" pack —
   *  SMW_SAMPLE_FILES). When present, stock SMW instruments and @N-derived
   *  customs carry the ACTUAL SMW sample into the module (AMK-exact rows,
   *  no tuning correction) instead of approximating with YI's banks.
   *  `read` returns the loop-header-stripped .brr for an SMW sample index,
   *  or null when that file is missing. */
  smwSamples?: { read(sampleIdx: number): { data: Uint8Array; loopOffset: number } | null };
  /** The import target's music set does NOT upload the global sample bank
   *  (the Title set is driver-only; the Bowser and Ending sets ship their
   *  own banks) — a resident global-bank SRCN would play whatever that
   *  set's directory holds there. `read` returns the cart's global-bank
   *  sample for an SRCN ($00-$17) so every global-bank reference (curated
   *  stock approximations, AMY #default rows) CARRIES the sample into the
   *  module instead. Same tuning — identical bytes, relocated. */
  globalBankCarry?: { read(srcn: number): { data: Uint8Array; loopOffset: number } | null };
}

// ── shared helpers ───────────────────────────────────────────────────────────

const NOTE_SEMITONES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const WHOLE_NOTE_TICKS = 192;
/** SMW/AMK gate-fraction table (NoteDurations, AMK main.asm; YI's $3FE8
 *  differs slightly at gates 2/4/6/7). Used only to decide when AMK's light
 *  staccato would let a note ring to slot−1 ticks — see emitTimed. */
const AMK_GATE_RATIOS = [0x33, 0x66, 0x80, 0x99, 0xb3, 0xcc, 0xe6, 0xff] as const;
const MAX_INSTRUMENT_ROWS = 48; // $3D00-$3E20 (engine code follows)
const MAX_DIR_ENTRIES = 40; // $3C60-$3D00

const isHexDigit = (c: string): boolean => /[0-9a-f]/i.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
// BOM + NBSP count as whitespace — real SMWC files carry a UTF-8 BOM, and
// AMK itself tolerates ﻿/\xA0 mid-stream (porter tooling emits them).
const isSpace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿' || c === ' ';

/** Signed byte for -128..255 inputs (MML signed params). */
function toByte(n: number, what: string, line: number): number {
  if (!Number.isInteger(n) || n < -128 || n > 255) {
    throw new MmlCompileError(`${what} out of range: ${n}`, line);
  }
  return n & 0xff;
}

// ── compiler ─────────────────────────────────────────────────────────────────

interface ChannelState {
  /** Track id events are currently appended to. */
  track: number;
  octave: number;
  defaultLength: number; // MML denominator (l command)
  transpose: number; // h — compile-time semitone offset
  q: number; // gate<<4 | velocity byte (always < $80)
  /** AMK $FA $03 amplify byte (0 = off) — lives on the channel state so it
   *  survives the '/' intro→loop track switch, like the driver's per-channel
   *  !VolumeMult. */
  amplify: number;
  /** Last unscaled channel volume (v/$E7/$E8 target; both drivers boot
   *  voices at $FF) — $FA $03 re-emits it folded, since AMK's driver
   *  rescales the current volume live. `volumeSet` = an explicit volume
   *  command preceded the amplify (no retro-emit for the boot default). */
  volume: number;
  volumeSet: boolean;
  prevTicks: number; // sticky emission trackers (-1 = must emit)
  prevQ: number;
  /** Current instrument row (for synthetic-row cloning); -1 = unknown. */
  row: number;
  /** SMW percussion (@21-@29) plays a fixed pitch — the note byte written
   *  notes are overridden with; null = melodic. */
  fixedNote: number | null;
  /** AMK remote key-on body (inlined before every note) — null = off. */
  keyOnEvents: TrackEvent[] | null;
  /** AMK $FB pending arpeggio/trill/glissando for the next note. */
  arp: { stepTicks: number; offsets: number[]; once: boolean } | null;
  triplet: boolean;
}

const freshChannel = (track: number, defaultLength: number): ChannelState => ({
  track, octave: 4, defaultLength, transpose: 0, q: 0x7f, amplify: 0, volume: 255, volumeSet: false,
  prevTicks: -1, prevQ: -1, row: -1, fixedNote: null, keyOnEvents: null, arp: null, triplet: false,
});

class Compiler {
  readonly dialect: MmlDialect;
  readonly opts: CompileMmlOptions;
  /** Port-report lines with their grouping category — finish() assembles
   *  the visible report grouped (instruments first), stable within each
   *  group. */
  readonly reportEntries: { cat: ReportCategory; msg: string }[] = [];
  readonly meta: MmlMeta = {};
  reported = new Set<string>();

  src = '';
  pos = 0;
  line = 1;

  // Output structures
  trackEvents: TrackEvent[][] = [];
  subEvents: TrackEvent[][] = [];
  instrumentRows: MmlInstrumentRow[] = [];
  dirEntries: { sampleIndex: number }[] = [];
  samples: MmlSample[] = [];
  sampleIndexByName = new Map<string, number>();
  syntheticRowKeys = new Map<string, number>();

  // Song structure
  amyPatterns: number[][] | null = null; // #tracks rows (track ids, -1 silent)
  amyPartList: number[] | null = null; // #patterns entries (1-based pattern numbers; 0 = end)
  amyLoopPart: number | null = null;
  usedTrackIds = new Set<number>();
  chainLinks: { track: number; prev: number }[] = [];
  lastDefinedTrack = -1;
  noLoop = false;
  /** Default mode: voice → [introTrack, loopTrack] (-1 = none). */
  voiceTracks: [number, number][] = Array.from({ length: 8 }, () => [-1, -1]);
  hasIntro = false;

  // Parse state
  ch: ChannelState | null = null;
  /** Non-null while compiling a remote-code body — events divert here. */
  fragmentCapture: TrackEvent[] | null = null;
  /** Commands before the first #N (the "w255 t58 $EF…" global-prelude
   *  idiom) collect on an implicit track and prepend to the first channel. */
  preludeTrack = -1;
  /** A '/' inside the prelude: the setup commands ARE the intro (voice 0 of
   *  pattern 0) and every channel body is loop-section content. */
  preludeSplit = false;
  sawChannel = false;
  channelSection = 0; // 0 = intro, 1 = post-'/'
  /** Non-null while inside [...] — events divert to this subroutine body. */
  loopSub: { id: number } | null = null;
  lastSubId = -1;
  labelSubs = new Map<string, number>();
  pendingLabel: string | null = null;
  superloopStack: { startIndex: number; line: number }[] = [];
  remoteBodies = new Map<string, string>(); // AMK (!id)[body text]
  // AMK context
  amkVersion = 2;
  path = '';
  listedSamples: string[] = [];
  customInstrumentBase = 30; // AMK @30+ are customs
  smwVtable = false;
  sampleGroupDeclared = false;
  /** #halvetempo doubles it; #option dividetempo N sets it. Note/fade/delay
   *  ticks divide by it, LFO rates multiply (AMK's divideByTempoRatio /
   *  multiplyByTempoRatio table) — halves the tick resolution to dodge
   *  driver slowdown at high tempos. */
  tempoRatio = 1;
  /** AMK $F4 $02 toggle. AMK's is a global driver variable at play time; we
   *  track it in stream order — exact for the usual pre-note setup usage,
   *  per-channel-from-here for mid-song toggles (warned). */
  lightStaccato = false;
  /** Any note/tie emitted yet (mid-song $F4 $02 detection). */
  emittedNotes = false;
  amyVars = new Map<string, string>();
  /** First custom-sample SRCN ($1C in grassland-drums mode — see options). */
  customSrcnBase: number;
  usedGrasslandDrums = false;
  usedLightStaccato = false;
  usedPackagedSamples = false;
  usedSmwSamples = false;

  /** Carried substitute samples (grassland 'kick'/'closedHat' + packaged
   *  'panFlute'/'brass' → sample index; each registers once). */
  carriedDrums = new Map<string, number>();
  /** SMW sample index → carried this.samples index (null = file missing,
   *  don't re-read). */
  carriedSmw = new Map<number, number | null>();
  /** Global-bank SRCN → carried this.samples index (globalBankCarry;
   *  null = slice unavailable, don't re-read). */
  carriedGlobal = new Map<number, number | null>();
  /** AMK: per-track channel state persists across #N re-entries. */
  savedChannelStates = new Map<number, ChannelState>();

  constructor(dialect: MmlDialect, opts: CompileMmlOptions) {
    this.dialect = dialect;
    this.opts = opts;
    this.customSrcnBase = opts.grasslandBank?.resident ? 0x1c : 0x18;
  }

  /** Append a port-report line under a grouping category. */
  note(cat: ReportCategory, message: string): void {
    this.reportEntries.push({ cat, msg: message });
  }

  warnOnce(key: string, message: string, cat: ReportCategory = 'other'): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.note(cat, message);
  }

  fail(message: string): never {
    throw new MmlCompileError(message, this.line);
  }

  // ── low-level scanning ────────────────────────────────────────────────────

  peek(): string {
    return this.src[this.pos] ?? '';
  }

  next(): string {
    const c = this.src[this.pos++] ?? '';
    if (c === '\n') this.line++;
    return c;
  }

  skipSpace(): void {
    while (this.pos < this.src.length && isSpace(this.peek())) this.next();
  }

  /** Read an unsigned/signed decimal number. */
  readInt(what: string, signed = false): number {
    this.skipSpace();
    let s = '';
    if (signed && (this.peek() === '-' || this.peek() === '+')) s += this.next();
    while (isDigit(this.peek())) s += this.next();
    if (s === '' || s === '-' || s === '+') this.fail(`expected number for ${what}`);
    return parseInt(s, 10);
  }

  /** Comma + number (AMY-style parameter chains). */
  readCommaInt(what: string, signed = false): number {
    this.skipSpace();
    if (this.peek() !== ',') this.fail(`expected ',' before ${what}`);
    this.next();
    return this.readInt(what, signed);
  }

  /** Read `$XX` (1-2 hex digits). Returns -1 when the next token isn't hex. */
  tryReadHexByte(): number {
    this.skipSpace();
    if (this.peek() !== '$') return -1;
    const save = this.pos;
    this.next();
    let s = '';
    while (isHexDigit(this.peek()) && s.length < 2) s += this.next();
    if (s === '') {
      this.pos = save;
      return -1;
    }
    return parseInt(s, 16);
  }

  readHexByte(what: string): number {
    const v = this.tryReadHexByte();
    if (v < 0) this.fail(`expected $XX hex byte for ${what}`);
    return v;
  }

  readQuoted(what: string): string {
    this.skipSpace();
    if (this.peek() !== '"') this.fail(`expected quoted string for ${what}`);
    this.next();
    let s = '';
    while (this.pos < this.src.length && this.peek() !== '"' && this.peek() !== '\n') s += this.next();
    if (this.peek() !== '"') this.fail(`unterminated quote for ${what}`);
    this.next();
    return s;
  }

  // ── event emission ────────────────────────────────────────────────────────

  get events(): TrackEvent[] {
    if (this.loopSub !== null) return this.subEvents[this.loopSub.id];
    const ch = this.requireChannel();
    return this.trackEvents[ch.track];
  }

  requireChannel(): ChannelState {
    if (this.ch === null) {
      // Global prelude: open an implicit track; defineChannel() folds it
      // into the first real channel.
      this.preludeTrack = this.trackEvents.length;
      this.trackEvents.push([]);
      this.ch = freshChannel(this.preludeTrack, this.defaultNoteLength());
    }
    return this.ch;
  }

  /** Dialect default note length: AMK l8, AMY l16 (AMY's init()). */
  defaultNoteLength(): number {
    return this.dialect === 'amy' ? 16 : 8;
  }

  /** Channel state for a track: AMK keeps o/l/q PER TRACK across #N
   *  re-entries (Track.h per-track state; only transpose + the sticky
   *  emission trackers reset); AMY's init() resets everything each time. */
  channelStateFor(track: number): ChannelState {
    if (this.dialect === 'amk') {
      const saved = this.savedChannelStates.get(track);
      if (saved) {
        saved.transpose = 0;
        saved.prevTicks = -1;
        saved.prevQ = -1;
        return saved;
      }
    }
    const fresh = freshChannel(track, this.defaultNoteLength());
    this.savedChannelStates.set(track, fresh);
    return fresh;
  }

  push(ev: TrackEvent): void {
    this.events.push(ev);
  }

  vcmd(op: number, name: string, args: number[]): void {
    this.push({ kind: 'vcmd', op, name, args });
  }

  /** Emit the sticky length byte if duration or gate/velocity changed. The
   *  qv byte can only ride a length byte, so a q change forces a length
   *  emission even at the same duration. */
  emitLength(ticks: number): void {
    const ch = this.requireChannel();
    const needQ = ch.q !== ch.prevQ;
    if (ticks === ch.prevTicks && !needQ) return;
    const ev: TrackEvent = { kind: 'length', ticks };
    if (needQ) {
      ev.gate = (ch.q >> 4) & 7;
      ev.velocity = ch.q & 0x0f;
    }
    this.push(ev);
    ch.prevTicks = ticks;
    ch.prevQ = ch.q;
  }

  /** Reset sticky trackers (track boundaries — the play-time context is
   *  unknown there, so the next length must re-emit). */
  resetSticky(): void {
    const ch = this.requireChannel();
    ch.prevTicks = -1;
    ch.prevQ = -1;
  }

  /** Adopt the runtime length/qv state a subroutine body's bytes leave
   *  behind. The driver's per-voice length + gate/velocity registers persist
   *  across an $EF return, so after a call the stream state is the body's
   *  TAIL, not unknown — and both AMK and AMY rely on that inheritance (no
   *  re-sync byte after a call). Re-emitting the channel's tracked q here
   *  re-asserts a stale/default articulation over the body's tail — the bug
   *  that made the retail bowser retranscription play caller notes at q7F
   *  where retail inherits the body's q7D. */
  adoptSubSticky(id: number): void {
    const ch = this.requireChannel();
    for (const ev of this.subEvents[id]) {
      if (ev.kind !== 'length') continue;
      ch.prevTicks = ev.ticks;
      if (ev.gate !== undefined) {
        ch.prevQ = ((ev.gate & 7) << 4) | ((ev.velocity ?? 0) & 0x0f);
        ch.q = ch.prevQ;
      }
    }
  }

  /** Divide a tick/tempo value by the #halvetempo/dividetempo ratio. */
  divT(v: number, what: string): number {
    if (this.tempoRatio === 1) return v;
    const d = v / this.tempoRatio;
    const r = Math.round(d);
    if (!Number.isInteger(d)) {
      this.warnOnce(`frac-${what}`, `#halvetempo/dividetempo produced fractional ${what} values — rounded (AMK errors on these)`, 'timing');
    }
    return r === 0 && v > 0 ? 1 : r;
  }

  /** Multiply an LFO rate by the tempo ratio (ticks got longer). */
  multT(v: number): number {
    return Math.min(255, v * this.tempoRatio);
  }

  /** Echo-delay ceiling (engine-verified: CODE_music_dsp_echo_commit sets
   *  ESA = $3C − 8·EDL with no clamp of its own, so the buffer always ends
   *  at $3C00 and grows down in 2 KB steps). EDL 2 bottoms at $2C00 and is
   *  safe; EDL 3 bottoms at $2400, on top of the resident jingle sequences
   *  ($264C+) — crashes when a jingle plays (death, goal, level intro,
   *  game over), so it's allowed only via opts.echoDelayLimit on jingle-free
   *  import targets (catalog.ts JINGLE_FREE_SONG_MODULES); EDL ≥ 4 bottoms
   *  at $1C00 or below, over the SFX block and the driver code itself — the
   *  DSP's continuous echo writes destroy the running engine as soon as
   *  echo turns on (breaks even the preview), never allowed. Clamp and
   *  report; the echo tail shortens but the song survives. */
  clampEchoDelay(edl: number): number {
    const limit = Math.min(this.opts.echoDelayLimit ?? 2, 3);
    if (edl <= limit) return edl;
    this.warnOnce(
      `edl-${edl}`,
      limit >= 3
        ? `echo delay ${edl} clamped to 3 — even on this jingle-free target, EDL ≥ 4 puts the echo buffer over the SFX data and driver code`
        : `echo delay ${edl} clamped to 2 — on YI the echo buffer grows down from $3C00, and EDL ≥ 3 lands on the resident jingles ($264C) or the driver code itself (3 is allowed only on jingle-free targets: the Ending module)`,
      'echo'
    );
    return limit;
  }

  /** Emit a note/rest/tie of `ticks` total (splitting >127 into tie chains).
   *  `noStaccatoSplit` suppresses the light-staccato split when the caller
   *  itself continues the note with a tie (the '&' slide head) — there is no
   *  keyoff at this event's end to re-shape. */
  emitTimed(head: TrackEvent, ticks: number, noStaccatoSplit = false): void {
    const ch = this.requireChannel();
    if (ticks < 1) this.fail('zero-length note');
    if (head.kind === 'note' && ch.arp !== null) {
      this.emitArpeggiated(head.note, ticks);
      return;
    }
    if (head.kind === 'note' && ch.keyOnEvents !== null) {
      for (const ev of ch.keyOnEvents) this.push(structuredClone(ev));
    }
    if (head.kind !== 'rest') this.emittedNotes = true;
    const comps: number[] = [];
    let rest = ticks;
    while (rest > 0) {
      const step = Math.min(rest, rest > 127 ? 96 : rest);
      comps.push(step);
      rest -= step;
    }
    // AMK light staccato ($F4 $02): both drivers key a ringing note off 2
    // ticks before its slot ends; AMK's toggle shrinks that cut to 1 tick,
    // YI's is hard-coded (CODE_voice_sustain_release `CBNE $70+x`). No gate
    // value can cross the cut, but a trailing 2-tick tie can: the keyoff
    // lookahead sees the tie byte and skips every cut in the first slot, and
    // the tie slot's own gate (max(1, 2·ratio>>8) = 1 at any splittable gate)
    // keys off after exactly one tick — the note rings slot−1, AMK parity.
    // Split only when AMK's gate would ring past the cut (AMK table — its
    // gate-7 $FF reaches L−1 where YI's $FC tops out at the cut); otherwise
    // the gate keys off first in both drivers and staccato depth is moot.
    if (this.lightStaccato && !noStaccatoSplit && head.kind !== 'rest') {
      const last = comps[comps.length - 1];
      const gateTicks = Math.max(1, (last * AMK_GATE_RATIOS[(ch.q >> 4) & 7]) >> 8);
      if (last >= 3 && gateTicks >= last - 1) {
        comps[comps.length - 1] = last - 2;
        comps.push(2);
        this.usedLightStaccato = true;
      }
    }
    this.emitLength(comps[0]);
    this.push(head);
    for (let i = 1; i < comps.length; i++) {
      this.emitLength(comps[i]);
      this.push({ kind: 'tie' });
    }
  }

  /** AMK $FB family — replace the next note with a run of short rekeyed
   *  notes cycling the offset pattern (documented approximation: YI has no
   *  arpeggio vcmd; AMK's non-rekey nuances are lost). */
  emitArpeggiated(note: number, ticks: number): void {
    const ch = this.requireChannel();
    const arp = ch.arp!;
    if (arp.once) ch.arp = null;
    const step = Math.max(1, Math.min(127, arp.stepTicks));
    let t = 0;
    let i = 0;
    while (t < ticks) {
      const len = Math.min(step, ticks - t);
      const signed = (n: number): number => (n << 24) >> 24;
      // Glissando (once): base, base+z, base+2z…  Cycle: base+offsets[i mod n].
      const pitch = arp.once
        ? note + signed(arp.offsets[0]) * i
        : note + signed(arp.offsets[i % arp.offsets.length]);
      this.emitLength(len);
      this.push({ kind: 'note', note: Math.max(0x80, Math.min(0xc7, pitch)) });
      t += len;
      i++;
    }
  }

  // ── notes ─────────────────────────────────────────────────────────────────

  /** Parse a duration suffix: `=ticks`, or denominator + dots (default
   *  length when absent). Returns ticks. */
  readDuration(): number {
    const ch = this.requireChannel();
    this.skipSpace();
    if (this.peek() === '=') {
      this.next();
      const t = this.readInt('tick count');
      if (t < 1) this.fail('tick count must be ≥ 1');
      while (this.peek() === '.') this.next(); // dots don't apply to =ticks
      return this.divT(t, 'duration');
    }
    let denom = ch.defaultLength;
    if (isDigit(this.peek())) {
      denom = this.readInt('note length');
      if (denom < 1 || denom > 192) this.fail(`bad note length ${denom}`);
    }
    let ticks = Math.floor(WHOLE_NOTE_TICKS / denom);
    if (ch.triplet) ticks = Math.floor((ticks * 2) / 3);
    let half = ticks;
    while (this.peek() === '.') {
      this.next();
      half = Math.floor(half / 2);
      ticks += half;
    }
    return this.divT(ticks, 'duration');
  }

  /** Note letter (already consumed as `letter`) → note byte with accidental,
   *  octave, transpose. */
  readNoteByte(letter: string): number {
    const ch = this.requireChannel();
    let semitone = NOTE_SEMITONES[letter];
    if (this.peek() === '+') {
      this.next();
      semitone++;
    } else if (this.peek() === '-') {
      this.next();
      semitone--;
    }
    const note = 0x80 + (ch.octave - 1) * 12 + semitone + ch.transpose;
    if (note < 0x80 || note > 0xc7) {
      this.fail(`note out of the driver's range (o1c-o6b): octave ${ch.octave}, offset ${semitone + ch.transpose}`);
    }
    return note;
  }

  /** Full note/rest/tie command starting at `letter`. */
  parseNote(letter: string): void {
    const ch = this.requireChannel();
    let head: TrackEvent;
    if (letter === 'r') head = { kind: 'rest' };
    else if (letter === '^') head = { kind: 'tie' };
    else {
      let note = this.readNoteByte(letter);
      // SMW percussion plays a fixed pitch regardless of the written note.
      if (ch.fixedNote !== null) note = ch.fixedNote;
      head = { kind: 'note', note };
    }
    let ticks = this.readDuration();
    // ^-chains merge into ONE event (`c4^8` = a single 72-tick note): the
    // gate fraction applies to the whole tied duration — emitting note+tie
    // would key off inside the first component under gates < 7.
    if (head.kind !== 'tie') {
      for (;;) {
        const save = this.pos;
        this.skipSpace();
        if (this.peek() !== '^') {
          this.pos = save;
          break;
        }
        this.next();
        ticks += this.readDuration();
      }
    }

    // AMK inter-note portamento: c4&d4 — keep the first note, slide to the
    // second over its duration (YI's inline-$F9-after-note form).
    this.skipSpace();
    if (this.dialect === 'amk' && this.peek() === '&' && head.kind === 'note') {
      this.next();
      this.skipSpace();
      const l2 = this.next().toLowerCase();
      if (!(l2 in NOTE_SEMITONES)) this.fail("expected a note after '&'");
      const target = this.readNoteByte(l2);
      const ticks2 = this.readDuration();
      this.emitTimed(head, ticks, true);
      this.vcmd(0xf9, 'pitchSlide', [0, Math.min(127, ticks2), target]);
      this.emitTimed({ kind: 'tie' }, ticks2);
      this.warnOnce('amp-slide', "'&' portamento translated as note + $F9 slide over the target's duration — verify audibly", 'timing');
      return;
    }
    this.emitTimed(head, ticks);
  }

  // ── instruments / samples ─────────────────────────────────────────────────

  addSample(name: string): number {
    const existing = this.sampleIndexByName.get(name);
    if (existing !== undefined) return existing;
    const candidates = [
      this.path ? `${this.path}/${name}` : null,
      name,
      `samples/${name}`,
    ].filter((p): p is string => p !== null);
    let raw: Uint8Array | null = null;
    for (const rel of candidates) {
      raw = this.opts.readFile(rel);
      if (raw !== null) break;
    }
    if (raw === null) this.fail(`sample file not found: "${name}" (tried ${candidates.join(', ')})`);
    if (raw.length < 11 || (raw.length - 2) % 9 !== 0) {
      this.fail(`sample "${name}": not an AMK-format .brr (2-byte loop header + 9-byte blocks)`);
    }
    const loopOffset = raw[0] | (raw[1] << 8);
    const data = raw.slice(2);
    if (loopOffset > data.length) {
      this.note('sample', `sample "${name}": loop offset 0x${loopOffset.toString(16)} past its end — in-game the loop reads whatever follows`);
    }
    const index = this.samples.length;
    this.samples.push({ name, data, loopOffset });
    this.sampleIndexByName.set(name, index);
    return index;
  }

  /** Dir slot for a sample index (creates one per sample; AMY aliases add
   *  more via addDirEntry directly). SRCN = customSrcnBase + slot. */
  dirSlotFor(sampleIndex: number): number {
    const existing = this.dirEntries.findIndex((e) => e.sampleIndex === sampleIndex);
    if (existing >= 0) return existing;
    const max = 0x40 - this.customSrcnBase;
    if (this.dirEntries.length >= max) {
      this.fail(`too many sample directory entries (max ${max} local slots)`);
    }
    this.dirEntries.push({ sampleIndex });
    return this.dirEntries.length - 1;
  }

  /** SRCN a custom sample plays as. */
  customSrcn(sampleIndex: number): number {
    return this.customSrcnBase + this.dirSlotFor(sampleIndex);
  }

  addInstrumentRow(bytes: number[], source: string): number {
    if (bytes.length !== 6) this.fail(`instrument row needs 6 bytes (${source})`);
    if (this.instrumentRows.length >= MAX_INSTRUMENT_ROWS) {
      this.fail(`instrument table overflow: more than ${MAX_INSTRUMENT_ROWS} rows ($3D00-$3E20; ${source})`);
    }
    this.instrumentRows.push({ bytes: bytes as MmlInstrumentRow['bytes'], source });
    return this.instrumentRows.length - 1;
  }

  /** Clone the channel's current row with modified bytes → synthetic row +
   *  $E0. The AMK ADSR/GAIN-override policy. */
  syntheticRowFrom(mutate: (b: number[]) => void, what: string): void {
    const ch = this.requireChannel();
    if (ch.row < 0) {
      this.warnOnce(`syn-noinst:${what}`, `${what} before any instrument was set — dropped`, 'instrument');
      return;
    }
    const base = this.instrumentRows[ch.row];
    const bytes = [...base.bytes];
    mutate(bytes);
    const key = bytes.join(',');
    let row = this.syntheticRowKeys.get(key);
    if (row === undefined) {
      row = this.addInstrumentRow(bytes, `synthetic ${what} of row ${ch.row}`);
      this.syntheticRowKeys.set(key, row);
    }
    this.vcmd(0xe0, 'setInstrument', [row]);
    ch.row = row;
  }

  setInstrument(id: number): void {
    const ch = this.requireChannel();
    let row: number;
    if (this.dialect === 'amy') {
      row = id; // AMY @N indexes the table directly (unchecked in the reference)
      if (row >= this.instrumentRows.length) {
        this.warnOnce(`amy-row-${id}`, `@${id} is past the ${this.instrumentRows.length}-row instrument table — emitted verbatim (plays whatever ARAM holds there)`, 'instrument');
      }
    } else {
      if (id < this.customInstrumentBase) {
        return this.setStockInstrument(id);
      }
      row = id - this.customInstrumentBase;
      if (row >= this.instrumentRows.length) {
        this.fail(`@${id}: only ${this.instrumentRows.length} custom instruments defined (customs start at @${this.customInstrumentBase})`);
      }
    }
    this.vcmd(0xe0, 'setInstrument', [row]);
    ch.row = row;
    ch.fixedNote = null;
  }

  /** Resolve where an SMW stock sample lands on YI: the real grassland drum
   *  (referenced when resident, or carried into the module as a custom
   *  sample), else the curated global-bank approximation. Returns the SRCN
   *  the row should reference, the YI-side default tuning (the T_yi term),
   *  and report labeling. */
  resolveStockSample(sampleIdx: number, source: string): { srcn: number; tYi: number; label: string; real: boolean } {
    // Highest priority: the real SMW sample library. tYi = the SMW base
    // tuning, so both correction formulas (stockRow and @N-derived customs)
    // reduce to the port's own row tuning — AMK-exact playback.
    const lib = this.opts.smwSamples;
    const tBase = SMW_SAMPLE_BASE_TUNING[sampleIdx];
    if (lib && tBase !== undefined) {
      let idx = this.carriedSmw.get(sampleIdx);
      if (idx === undefined) {
        const brr = lib.read(sampleIdx);
        if (brr === null) {
          idx = null;
        } else {
          idx = this.samples.length;
          const stem = SMW_SAMPLE_FILES[sampleIdx]?.replace(/\.brr$/i, '') ?? `$${sampleIdx.toString(16)}`;
          this.samples.push({ name: `(SMW ${stem})`, data: brr.data, loopOffset: brr.loopOffset });
        }
        this.carriedSmw.set(sampleIdx, idx);
      }
      if (idx !== null) {
        this.usedSmwSamples = true;
        const stem = SMW_SAMPLE_FILES[sampleIdx]!.replace(/\.brr$/i, '');
        return { srcn: this.customSrcn(idx), tYi: tBase, label: `the real SMW ${stem} sample (carried into the module)`, real: true };
      }
    }
    const g = this.opts.grasslandBank;
    const drum = GRASSLAND_DRUM_OVERRIDES[sampleIdx];
    if (g && drum !== undefined) {
      if (g.rows.length !== 24) this.fail(`${source}: grassland drum mapping needs the cart-sourced fg_set rows (internal wiring)`);
      const tYi = g.rows[(drum - 0x18) * 6 + 4] + g.rows[(drum - 0x18) * 6 + 5] / 256;
      const name = yiSampleName(drum);
      if (g.resident) {
        this.usedGrasslandDrums = true;
        return { srcn: drum, tYi, label: `YI's real ${name} (grassland add-on bank)`, real: true };
      }
      const which = drum === 0x18 ? 'kick' : 'closedHat';
      const brr = g[which as 'kick' | 'closedHat'];
      if (brr) {
        let idx = this.carriedDrums.get(which);
        if (idx === undefined) {
          idx = this.samples.length;
          this.samples.push({ name: `(YI ${name})`, data: brr.data, loopOffset: brr.loopOffset });
          this.carriedDrums.set(which, idx);
        }
        this.usedGrasslandDrums = true;
        return { srcn: this.customSrcn(idx), tYi, label: `YI's real ${name} (carried into the module)`, real: true };
      }
      // No drum data supplied — fall through to the approximation.
    }
    const extra = PACKAGED_SAMPLE_OVERRIDES[sampleIdx];
    const extraBrr = extra && this.opts.packagedSamples?.[extra.key];
    if (extra && extraBrr) {
      let idx = this.carriedDrums.get(extra.key);
      if (idx === undefined) {
        idx = this.samples.length;
        this.samples.push({ name: `(${extra.name})`, data: extraBrr.data, loopOffset: extraBrr.loopOffset });
        this.carriedDrums.set(extra.key, idx);
      }
      this.usedPackagedSamples = true;
      return { srcn: this.customSrcn(idx), tYi: extra.tuning, label: `the packaged ${extra.name} sample (carried into the module)`, real: true };
    }
    const mapped = SMW_SAMPLE_TO_YI[sampleIdx];
    if (mapped === undefined) this.fail(`${source}: SMW sample $${sampleIdx.toString(16)} has no YI mapping`);
    const defaults = this.opts.defaultInstrumentRows;
    if (!defaults || defaults.length !== 144) {
      this.fail(`${source}: SMW stock-instrument mapping needs the cart-sourced default table (internal wiring)`);
    }
    const tYi = defaults[mapped * 6 + 4] + defaults[mapped * 6 + 5] / 256;
    if (this.opts.globalBankCarry) {
      const srcn = this.carryGlobalSample(mapped);
      if (srcn !== null) {
        return { srcn, tYi, label: `YI ${yiSampleName(mapped)} (carried — this music set lacks the global bank)`, real: false };
      }
    }
    return { srcn: mapped, tYi, label: `YI ${yiSampleName(mapped)}`, real: false };
  }

  /** Carry a global-bank sample into the module (globalBankCarry targets —
   *  the sample bytes are identical, just relocated, so tunings are
   *  untouched). Returns the custom SRCN, or null when the slice is
   *  unavailable (reported; the resident reference stays as a last resort,
   *  wrong-timbre on the target set). */
  carryGlobalSample(srcn: number): number | null {
    const carry = this.opts.globalBankCarry;
    if (!carry) return null;
    let idx = this.carriedGlobal.get(srcn);
    if (idx === undefined) {
      const brr = carry.read(srcn);
      if (brr === null) {
        idx = null;
        this.warnOnce(
          `gbcarry-miss-${srcn}`,
          `global-bank sample $${srcn.toString(16)} (${yiSampleName(srcn)}) could not be carried — it will play whatever this set's directory holds there`,
          'sample'
        );
      } else {
        idx = this.samples.length;
        this.samples.push({ name: `(YI ${yiSampleName(srcn)})`, data: brr.data, loopOffset: brr.loopOffset });
        this.warnOnce(
          'gbcarry',
          "this music set lacks the global sample bank — referenced global-bank samples are carried into the module (identical sound, sample-budget cost)",
          'sample'
        );
      }
      this.carriedGlobal.set(srcn, idx);
    }
    return idx === null ? null : this.customSrcn(idx);
  }

  stockRow(sampleIdx: number, adsr1: number, adsr2: number, gain: number, tPort: number, transSemis: number, source: string): number {
    const { srcn: mapped, tYi } = this.resolveStockSample(sampleIdx, source);
    const tBase = SMW_SAMPLE_BASE_TUNING[sampleIdx] ?? tPort;
    let mult = tYi * (tPort / tBase) * Math.pow(2, transSemis / 12);
    if (mult >= 256) {
      this.note('instrument', `${source}: corrected tuning ${mult.toFixed(2)} clamped to the multiplier ceiling`);
      mult = 255.996;
    }
    if (mult < 1 / 256) mult = 1 / 256;
    const hi = Math.floor(mult);
    let lo = Math.round((mult - hi) * 256);
    const bytes = lo === 256 ? [mapped, adsr1, adsr2, gain, hi + 1, 0] : [mapped, adsr1, adsr2, gain, hi, lo];
    const key = bytes.join(',');
    let row = this.syntheticRowKeys.get(key);
    if (row === undefined) {
      row = this.addInstrumentRow(bytes, source);
      this.syntheticRowKeys.set(key, row);
    }
    return row;
  }

  reportStockMapping(what: string, key: string, sampleIdx: number, suffix: string): void {
    const r = this.resolveStockSample(sampleIdx, what);
    this.warnOnce(
      key,
      r.real
        ? `${what} mapped to ${r.label}${suffix}`
        : `${what} mapped to ${r.label}${suffix} — approximation, verify audibly`,
      'instrument'
    );
    if (!r.real && GRASSLAND_DRUM_OVERRIDES[sampleIdx] !== undefined) {
      this.warnOnce(
        'grassland-hint',
        "tip: YI's real Kick / Closed Hi-hat substitute for SMW drums when the grassland bank data is available (internal wiring)",
        'instrument'
      );
    }
  }

  setStockInstrument(id: number): void {
    const ch = this.requireChannel();
    if (id === 19 || id === 20) {
      // AMK emits nothing for these (state-only) — keep the current row.
      this.warnOnce(`stock-${id}`, `@${id} has no sample in AddmusicK — ignored`, 'instrument');
      return;
    }
    if (id >= 21) {
      const p = SMW_PERC_ROWS[id - 21];
      const name = SMW_PERC_NAMES[id - 21];
      this.reportStockMapping(`SMW percussion @${id} (${name})`, `stock-${id}`, p[0], ' at its fixed pitch');
      const row = this.stockRow(p[0], p[1], p[2], p[3], p[4] + p[5] / 256, 0, `SMW @${id} (${name})`);
      this.vcmd(0xe0, 'setInstrument', [row]);
      ch.row = row;
      ch.fixedNote = p[6];
      return;
    }
    const d = SMW_DEFAULT_ROWS[id];
    const name = SMW_INSTRUMENT_NAMES[id];
    this.reportStockMapping(`SMW @${id} (${name})`, `stock-${id}`, d[0], '');
    const row = this.stockRow(d[0], d[1], d[2], d[3], d[4] + d[5] / 256, -(SMW_TMP_TRANS[id] ?? 0), `SMW @${id} (${name})`);
    this.vcmd(0xe0, 'setInstrument', [row]);
    ch.row = row;
    ch.fixedNote = null;
  }

  // ── loops ─────────────────────────────────────────────────────────────────

  beginLoop(): void {
    if (this.loopSub !== null) this.fail('nested loop brackets (the driver has a single return slot)');
    const ch = this.requireChannel();
    const id = this.subEvents.length;
    this.subEvents.push([]);
    if (this.pendingLabel !== null) {
      this.labelSubs.set(this.pendingLabel, id);
      this.pendingLabel = null;
    }
    this.loopSub = { id };
    // The body plays under unknown sticky state at later call sites — force
    // its first length to emit. AMY's '[' resets ONLY the duration sticky
    // (mml.cpp:972); AMK synchronizes both.
    ch.prevTicks = -1;
    if (this.dialect === 'amk') ch.prevQ = -1;
  }

  endLoop(): void {
    if (this.loopSub === null) this.fail("']' with no open loop");
    const id = this.loopSub.id;
    this.loopSub = null;
    let count = 1;
    this.skipSpace();
    if (isDigit(this.peek())) count = this.readInt('loop count');
    if (count === 0) this.note('other', 'loop count 0 — both references warn and emit it verbatim (driver plays 256)');
    if (count < 0 || count > 255) this.fail(`loop count ${count} out of range 0-255`);
    this.lastSubId = id;
    this.vcmd(0xef, 'subroutine', [id & 0xff, id >> 8, count]);
    // Post-call state is the body's tail; the inline compile just left the
    // channel trackers exactly there (emitLength ran through the body), so
    // nothing to re-sync — and ch.q keeps a trailing in-body q command.
  }

  callSub(id: number, count: number): void {
    if (this.loopSub !== null) this.fail('loop call inside a loop body');
    if (count === 0) this.note('other', 'loop count 0 — both references warn and emit it verbatim (driver plays 256)');
    if (count < 0 || count > 255) this.fail(`loop count ${count} out of range 0-255`);
    this.lastSubId = id;
    this.vcmd(0xef, 'subroutine', [id & 0xff, id >> 8, count]);
    this.adoptSubSticky(id);
  }

  beginSuperloop(): void {
    this.superloopStack.push({ startIndex: this.events.length, line: this.line });
    if (this.superloopStack.length > 1) this.fail('nested superloops');
  }

  endSuperloop(): void {
    const open = this.superloopStack.pop();
    if (!open) this.fail("']]' with no open superloop");
    let count = 1;
    this.skipSpace();
    if (isDigit(this.peek())) count = this.readInt('superloop count');
    if (count < 1 || count > 255) this.fail(`superloop count ${count} out of range`);
    const seg = this.events.slice(open.startIndex);
    // A body with no subroutine calls can BE a subroutine, called ×count —
    // same replayed bytes as AMK's driver-level $E6 subloop, at ~body+5
    // bytes instead of body×count. Bodies containing label-loop calls (or
    // sitting inside a [ ] body — one return slot) must unroll instead.
    const hasCalls = seg.some((ev) => ev.kind === 'vcmd' && ev.op === 0xef);
    if (!hasCalls && this.loopSub === null && count >= 2 && seg.length > 0) {
      const id = this.subEvents.length;
      this.subEvents.push(seg);
      this.events.length = open.startIndex;
      this.lastSubId = id;
      this.vcmd(0xef, 'subroutine', [id & 0xff, id >> 8, count]);
      // Channel trackers already hold the seg's tail state (it compiled
      // inline before being packed), which is exactly the post-call state.
      return;
    }
    for (let i = 1; i < count; i++) {
      for (const ev of seg) this.push(structuredClone(ev));
    }
    if (count >= 2) {
      this.warnOnce('superloop', `superloops containing loop calls unrolled (YI's driver has one loop level) — byte cost scales with the count`);
    }
  }
}

// ── preprocessing ────────────────────────────────────────────────────────────

/** Strip ;-comments (outside double quotes). Newlines preserved. */
export function stripComments(text: string): string {
  let out = '';
  let inQuote = false;
  let inComment = false;
  for (const c of text) {
    if (c === '\n') {
      inComment = false;
      inQuote = false;
      out += c;
      continue;
    }
    if (inComment) continue;
    if (c === '"') inQuote = !inQuote;
    if (c === ';' && !inQuote) {
      inComment = true;
      continue;
    }
    out += c;
  }
  return out;
}

/** AMK preprocessor lines: #define/#undef/#ifdef/#ifndef/#if/#endif/#error.
 *  Simple single-pass, no nesting of #if inside skipped regions beyond a
 *  depth counter. */
function runAmkPreprocessor(text: string, report: string[]): string {
  const defines = new Map<string, number>();
  const out: string[] = [];
  const skipStack: boolean[] = [];
  const skipping = (): boolean => skipStack.some((s) => s);
  for (const [i, rawLine] of text.split('\n').entries()) {
    const m = rawLine.match(/^\s*#(define|undef|ifdef|ifndef|if|endif|error)\b\s*(.*)$/i);
    if (!m) {
      out.push(skipping() ? '' : rawLine);
      continue;
    }
    const [, dir, rest] = m;
    const d = dir.toLowerCase();
    if (d === 'endif') {
      if (skipStack.length === 0) throw new MmlCompileError('#endif without #if', i + 1);
      skipStack.pop();
    } else if (d === 'ifdef' || d === 'ifndef') {
      const name = rest.trim().split(/\s+/)[0] ?? '';
      const has = defines.has(name);
      skipStack.push(skipping() || (d === 'ifdef' ? !has : has));
    } else if (d === 'if') {
      const em = rest.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(-?\d+)$/);
      if (!em) throw new MmlCompileError(`unsupported #if expression: ${rest.trim()}`, i + 1);
      const v = defines.get(em[1]) ?? 0;
      const n = parseInt(em[3], 10);
      const ok = { '==': v === n, '!=': v !== n, '<': v < n, '>': v > n, '<=': v <= n, '>=': v >= n }[em[2]]!;
      skipStack.push(skipping() || !ok);
    } else if (skipping()) {
      // directives inside skipped regions are ignored
    } else if (d === 'define') {
      const dm = rest.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(-?\d+))?/);
      if (dm) defines.set(dm[1], dm[2] !== undefined ? parseInt(dm[2], 10) : 1);
    } else if (d === 'undef') {
      defines.delete(rest.trim().split(/\s+/)[0] ?? '');
    } else if (d === 'error') {
      throw new MmlCompileError(`#error: ${rest.trim()}`, i + 1);
    }
    out.push(''); // keep line numbering stable
  }
  if (skipStack.length > 0) report.push('unterminated #if/#ifdef at end of file');
  return out.join('\n');
}

/** Apply AMK `"name=value"` replacements / AMY `?var = :value:` variables.
 *  Definitions apply to all following text; expansion is recursive with a
 *  budget guard; names match longest-first at each position. */
function applyReplacements(text: string, dialect: MmlDialect, report: string[]): string {
  const defs: { name: string; value: string }[] = [];
  const sorted = (): { name: string; value: string }[] => [...defs].sort((a, b) => b.name.length - a.name.length);
  let out = '';
  let i = 0;
  let braceDepth = 0;
  let expansions = 0;
  const N = () => text.length;
  while (i < N()) {
    const c = text[i];
    if (c === '{') braceDepth++;
    if (c === '}') braceDepth = Math.max(0, braceDepth - 1);

    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) break;
      const body = text.slice(i + 1, end);
      const eq = body.indexOf('=');
      if (eq > 0 && (dialect === 'amy' || braceDepth === 0)) {
        defs.push({ name: body.slice(0, eq).trim(), value: body.slice(eq + 1).trim() });
      } else {
        // Quoted content (filenames, titles) passes through verbatim —
        // replacements must not fire inside it.
        out += text.slice(i, end + 1);
      }
      i = end + 1;
      continue;
    }
    if (dialect === 'amy' && c === ':' && braceDepth === 0) {
      // AMY assignment: `:?name = pieces:` — the WHOLE assignment is
      // colon-wrapped; double-quoted pieces inside are literals.
      const am = text.slice(i).match(/^:\s*\?([A-Za-z0-9_]+)\s*=\s*([^:]*):/);
      if (am) {
        // Strip literal-piece quotes; everything else was already macro/var
        // expanded by the streaming pass.
        defs.push({ name: '?' + am[1], value: am[2].replace(/"/g, '').trim() });
        i += am[0].length;
        continue;
      }
    }
    if (dialect === 'amy' && c === '?' && braceDepth >= 0) {
      const um = text.slice(i).match(/^\?([A-Za-z0-9_]+)/);
      if (um) {
        const def = defs.find((d) => d.name === '?' + um[1]);
        if (!def) {
          throw new MmlCompileError(
            `?${um[1]}: undefined variable (AMY's ~50 built-in tracked variables aren't supported — assign it with :?${um[1]} = value: first)`,
            text.slice(0, i).split('\n').length
          );
        }
        if (++expansions > 10000) throw new MmlCompileError('replacement expansion budget exceeded (cycle?)', 1);
        text = text.slice(0, i) + def.value + text.slice(i + um[0].length);
        continue;
      }
    }
    if (defs.length > 0) {
      // AMK replacements are raw greedy text substitution, longest name
      // first, at ANY position — ports juxtapose them with notes
      // ("bumc8" where "bum= @31 v255"). No word-boundary rule; the
      // expansion budget guards cycles.
      let matched = false;
      for (const d of sorted()) {
        if (d.name === '' || !text.startsWith(d.name, i)) continue;
        if (++expansions > 10000) throw new MmlCompileError('replacement expansion budget exceeded (cycle?)', 1);
        text = text.slice(0, i) + d.value + text.slice(i + d.name.length);
        matched = true;
        break;
      }
      if (matched) continue;
    }
    out += c;
    i++;
  }
  void report;
  return out;
}

/** AMY value macros expanded textually: %bpm/%adsr/%gain/%pitch. Anything
 *  else %-shaped is a fatal diagnostic (the AMY macro system is out of
 *  scope — see the plan's §1.11 addendum). */
function expandAmyValueMacros(text: string, report: string[]): string {
  return text.replace(/%([a-z_]+)\s*\(([^)]*)\)/gi, (whole, name: string, argStr: string, off: number) => {
    const line = text.slice(0, off).split('\n').length;
    const args = argStr.split(',').map((s) => parseFloat(s.trim()));
    const n = name.toLowerCase();
    if (n === 'bpm') {
      if (args.length !== 1 || !isFinite(args[0])) throw new MmlCompileError('%bpm needs one number', line);
      return 't' + Math.round(args[0] * 0.4096);
    }
    const hexByte = (v: number): string => `$${(v & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
    if (n === 'adsr') {
      const [a, d, sus, r] = args;
      if (args.length !== 4 || args.some((x) => !Number.isInteger(x))) throw new MmlCompileError('%adsr needs 4 integers', line);
      if (a > 15 || d > 7 || sus > 7 || r > 31 || args.some((x) => x < 0)) throw new MmlCompileError('%adsr values out of range (a≤15 d≤7 s≤7 r≤31)', line);
      // THREE bytes — ADSR1, ADSR2, and the (unused-in-ADSR-mode) GAIN
      // column, matching AMY (macros.cpp Adsr) so instrument rows align.
      return `${hexByte(0x80 | (d << 4) | a)} ${hexByte((sus << 5) | r)} $00`;
    }
    if (n === 'gain') {
      const [mode, value] = args;
      if (args.length !== 2 || !Number.isInteger(mode) || !Number.isInteger(value)) throw new MmlCompileError('%gain needs 2 integers', line);
      // Exact AMY encoding (macros.cpp Gain): mode 0 = direct (v≤127);
      // modes 1-5 = hardware curves ((mode+3)<<5 | v, v≤31). THREE bytes —
      // the ADSR columns are zeroed.
      let gn: number;
      if (mode === 0) {
        if (value < 0 || value > 127) throw new MmlCompileError('%gain mode 0 value out of range 0-127', line);
        gn = value;
      } else if (mode >= 1 && mode <= 5) {
        if (value < 0 || value > 31) throw new MmlCompileError(`%gain mode ${mode} value out of range 0-31`, line);
        gn = (((mode + 3) << 5) + value) & 0xff;
      } else throw new MmlCompileError(`%gain mode ${mode} out of range 0-5`, line);
      return `$00 $00 ${hexByte(gn)}`;
    }
    if (n === 'pitch') {
      if (args.length !== 1 || !isFinite(args[0])) throw new MmlCompileError('%pitch needs one number (cents)', line);
      // N-SPC tuning is 768-based: %pitch(0) = $0300 (matches the cart's
      // default rows). AMY: nspcTune = round(768 × 2^(cents/1200)).
      const tune = Math.round(768 * Math.pow(2, args[0] / 1200)) & 0xffff;
      return `${hexByte(tune >> 8)} ${hexByte(tune)}`;
    }
    throw new MmlCompileError(`%${name}: AMY macro not supported (only %bpm/%adsr/%gain/%pitch are) — expand it by hand`, line);
  });
}

// ── main dispatch (methods appended onto Compiler's prototype) ───────────────
// Declaration merging makes the prototype-assigned methods visible on the
// class type; the class body above stays focused on state + emission
// primitives.

interface Compiler {
  run(): void;
  parseHash(): void;
  defineChannel(n: number, isContinue?: boolean): void;
  parseIntroMarker(): void;
  openBrace(what: string): void;
  parseSpcBlock(): void;
  parseSamplesBlock(): void;
  readRowTail(first: number, source: string): number;
  parseInstrumentsBlock(): void;
  parseLocalSamplesBlock(): void;
  parsePatternsBlock(): void;
  parseTracksBlock(): void;
  skipSpace0(): void;
  parseParen(): void;
  parseRemote(): void;
  compileFragment(body: string, what: string): TrackEvent[];
  parseBang(): void;
  parseInstrumentCommand(): void;
  parseLetter(letter: string): void;
  parseAmyLetter(letter: string): void;
  parseHexCommand(): void;
  parseAmyHex(op: number): void;
  parseAmkHex(op: number): void;
  readHexOrNote(what: string): number;
  finish(): CompiledMml;
}

/** Channel-volume amplify fold (AMK $FA $03). Both drivers compute the DSP
 *  volume as the SQUARE of the (songVol × velocity × chVol) product (SMW
 *  L_124D ≡ YI CODE_voice_volume_to_dsp — same self-`MUL YA`); AMK's driver
 *  then scales the squared, pan-multiplied result by (1 + n/256)
 *  (!VolumeMult at L_103B). Folding into the pre-square channel-volume byte
 *  therefore uses the square root, so the squared output lands ×(1+n/256)
 *  — validated against the AMK-built ridley.spc (see the plan's §1.11
 *  amplify row). When v·√f exceeds 255 the fold clips (AMK's post-square
 *  headroom isn't expressible pre-square) — reported. */
function amp(c: Compiler, v: number): number {
  const ch = c.requireChannel();
  if (ch.amplify === 0) return v;
  const scaled = Math.round(v * Math.sqrt(1 + ch.amplify / 256));
  if (scaled > 255) {
    c.warnOnce('amplify-clip', '$FA $03 amplify on an already-high volume clips at the driver max — that channel plays up to a few dB quieter than under AMK (1 dB at amplify $40 on v255)', 'volume');
    return 255;
  }
  return scaled;
}

// Divert `events` to the fragment capture while compiling remote bodies.
const eventsGetter = Object.getOwnPropertyDescriptor(Compiler.prototype, 'events')!.get!;
Object.defineProperty(Compiler.prototype, 'events', {
  get(this: Compiler): TrackEvent[] {
    if (this.fragmentCapture !== null) return this.fragmentCapture;
    return eventsGetter.call(this) as TrackEvent[];
  },
});

Object.assign(Compiler.prototype, {
  run(this: Compiler): void {
    while (this.pos < this.src.length) {
      this.skipSpace();
      if (this.pos >= this.src.length) break;
      const c = this.peek();
      if (c === '#') {
        this.next();
        this.parseHash();
      } else if (c === '(') {
        this.next();
        this.parseParen();
      } else if (c === '[') {
        this.next();
        if (this.peek() === '[') {
          this.next();
          this.requireChannel();
          this.beginSuperloop();
        } else {
          this.requireChannel();
          this.beginLoop();
        }
      } else if (c === ']') {
        this.next();
        if (this.peek() === ']' && this.superloopStack.length > 0) {
          this.next();
          this.endSuperloop();
        } else if (this.peek() === ']' && this.loopSub === null) {
          this.next();
          this.endSuperloop();
        } else {
          this.endLoop();
        }
      } else if (c === '*') {
        this.next();
        this.requireChannel();
        if (this.lastSubId < 0) this.fail("'*' with no previous loop");
        let count = 1;
        this.skipSpace();
        if (isDigit(this.peek())) count = this.readInt('loop count');
        this.callSub(this.lastSubId, count);
      } else if (c === '{') {
        this.next();
        this.requireChannel().triplet = true;
      } else if (c === '}') {
        this.next();
        this.requireChannel().triplet = false;
      } else if (c === '<') {
        this.next();
        const ch = this.requireChannel();
        if (--ch.octave < 1) this.fail('octave below 1');
      } else if (c === '>') {
        this.next();
        const ch = this.requireChannel();
        if (++ch.octave > 6) this.fail('octave above 6');
      } else if (c === '/') {
        this.next();
        this.parseIntroMarker();
      } else if (c === '$') {
        this.parseHexCommand();
      } else if (c === '?') {
        this.next();
        if (this.dialect === 'amk') {
          this.skipSpace();
          if (isDigit(this.peek())) this.readInt('noloop arg');
          this.noLoop = true;
        } else this.fail("stray '?' (AMY ?vars are handled in preprocessing)");
      } else if (c === '!') {
        this.next();
        this.parseBang();
      } else if (c === '@') {
        this.next();
        this.parseInstrumentCommand();
      } else if (c === '&' && this.dialect === 'amy') {
        this.next();
        const delay = this.readInt('slide delay');
        const dur = this.readCommaInt('slide duration');
        const note = this.readCommaInt('slide note');
        if (note < 0 || note > 71) this.note('other', `&${delay},${dur},${note}: note value outside 0-71`);
        this.vcmd(0xf9, 'pitchSlide', [toByte(delay, 'slide delay', this.line), toByte(dur, 'slide duration', this.line), 0x80 + (note & 0x7f)]);
      } else if (c === '~' && this.dialect === 'amy') {
        this.next();
        const sub = this.next().toLowerCase();
        const map: Record<string, [number, string]> = {
          p: [0xe4, 'vibratoOff'], u: [0xec, 'tremoloOff'],
          m: [0xf3, 'pitchEnvelopeOff'], n: [0xf3, 'pitchEnvelopeOff'],
          x: [0xf6, 'echoOff'], z: [0xf6, 'echoOff'],
        };
        const hit = map[sub];
        if (!hit) this.fail(`'~${sub}' is not a disable command`);
        this.requireChannel();
        this.vcmd(hit[0], hit[1], []);
      } else if (c === '|') {
        this.next(); // bar separator — a documented no-op
      } else if (/[a-z^]/i.test(c)) {
        this.next();
        this.parseLetter(c.toLowerCase());
      } else if (this.dialect === 'amy') {
        // AMY silently skips unknown characters (mml.cpp default: i++) —
        // real files carry stray junk the reference never diagnosed.
        this.warnOnce(`junk-${c}`, `stray '${c}' ignored (AddMusicY skips unknown characters)`);
        this.next();
      } else {
        this.fail(`unexpected character '${c}'`);
      }
    }
  },

  // ── '#' directives + channel definitions ─────────────────────────────────

  parseHash(this: Compiler): void {
    let word = '';
    while (this.pos < this.src.length && !isSpace(this.peek()) && this.peek() !== '{') word += this.next();
    if (word === '') this.fail("bare '#'");

    if (/^\d/.test(word)) {
      // Channel definitions juxtapose with data in the wild ("#1r64/…") —
      // consume only the number (+ optional =continue) and rescan the rest.
      const m = word.match(/^(\d+)(=continue)?/i)!;
      this.pos -= word.length - m[0].length;
      this.defineChannel(parseInt(m[1], 10), m[2] !== undefined);
      return;
    }
    const amkEq = word.match(/^amk(?==)/i);
    if (amkEq) {
      // '#amk=2' — put the '=…' back for the amk branch's optional '='.
      this.pos -= word.length - 3;
      word = word.slice(0, 3);
    }
    const w = word.toLowerCase();
    if (w === 'amk') {
      this.skipSpace0();
      if (this.peek() === '=') this.next(); // '#amk=2' is legal
      const v = this.readInt('#amk version');
      this.amkVersion = v;
      if (v < 2) {
        this.smwVtable = true;
        this.warnOnce('amk1', "#amk 1 song: written for SMW's quieter velocity table — velocities play louder on YI's N-SPC table", 'volume');
      }
      if (v > 4) this.note('other', `#amk ${v} is newer than the supported parser (4) — compiling with #amk 4 semantics`);
      return;
    }
    if (w === 'am4' || w === 'amm') this.fail(`#${w}: ancient Addmusic dialects are not supported — re-port with AddmusicK`);
    if (w === 'spc') return this.parseSpcBlock();
    if (w === 'samples') return this.parseSamplesBlock();
    if (w === 'instruments') return this.parseInstrumentsBlock();
    if (w === 'local_samples') {
      if (this.dialect !== 'amy') this.fail('#local_samples is an AddMusicY block');
      return this.parseLocalSamplesBlock();
    }
    if (w === 'patterns') {
      if (this.dialect !== 'amy') this.fail('#patterns is an AddMusicY block');
      return this.parsePatternsBlock();
    }
    if (w === 'tracks') {
      if (this.dialect !== 'amy') this.fail('#tracks is an AddMusicY block');
      return this.parseTracksBlock();
    }
    if (w === 'path') {
      this.path = this.readQuoted('#path');
      return;
    }
    if (w === 'option') {
      this.skipSpace();
      let opt = '';
      while (this.pos < this.src.length && !isSpace(this.peek())) opt += this.next();
      const o = opt.toLowerCase();
      if (o === 'noloop') this.noLoop = true;
      else if (o === 'nspcvtable') { /* the YI default */ }
      else if (o === 'smwvtable') {
        this.smwVtable = true;
        this.note('volume', '#option smwvtable: SMW velocity table not emitted yet — song plays with the (louder) N-SPC tables');
      } else if (o === 'tempoimmunity') this.note('timing', '#option tempoimmunity ignored — YI has no timer tempo hike');
      else if (o === 'dividetempo') {
        if (this.sawChannel) this.fail('#option dividetempo must precede channel data');
        const n = this.readInt('dividetempo ratio');
        if (n < 1 || n > 256) this.fail(`dividetempo ratio ${n} out of range 1-256`);
        this.tempoRatio = n;
      }
      else this.fail(`unknown #option ${opt}`);
      return;
    }
    if (w === 'halvetempo') {
      if (this.sawChannel) this.fail('#halvetempo must precede channel data');
      this.tempoRatio = Math.min(256, this.tempoRatio * 2);
      return;
    }
    if (w === 'pad') {
      this.skipSpace();
      while (this.pos < this.src.length && !isSpace(this.peek())) this.next();
      this.note('other', '#pad ignored (module size is layout-managed)');
      return;
    }
    if (w === 'louder') {
      this.note('volume', '#louder ignored (N-SPC velocity table is the YI default)');
      return;
    }
    if (w.startsWith('tuning')) {
      // tuning[N]=±M[,±M…] — per-instrument transpose-map overrides.
      this.skipSpace0();
      while (this.pos < this.src.length && this.peek() !== '\n') this.next();
      this.warnOnce('tuning-directive', 'tuning[N]=… transpose overrides are not supported — affected stock instruments play at their default transpose', 'instrument');
      return;
    }
    this.fail(`unknown directive #${word}`);
  },

  defineChannel(this: Compiler, n: number, isContinue = false): void {
    if (this.loopSub !== null || this.superloopStack.length > 0) this.fail('channel definition inside a loop');
    const foldPrelude = (track: number): void => {
      if (this.preludeTrack < 0 || this.sawChannel) return;
      this.trackEvents[track].push(...this.trackEvents[this.preludeTrack]);
      this.trackEvents[this.preludeTrack] = [];
    };
    if (this.amyPatterns !== null) {
      // AMY #patterns mode: #N names a track number from the #tracks matrix.
      while (this.trackEvents.length <= n) this.trackEvents.push([]);
      this.usedTrackIds.add(n);
      if (isContinue) {
        if (this.lastDefinedTrack < 0) this.fail(`#${n}=continue with no preceding channel`);
        this.chainLinks.push({ track: n, prev: this.lastDefinedTrack });
      }
      foldPrelude(n);
      this.sawChannel = true;
      this.lastDefinedTrack = n;
      this.ch = this.channelStateFor(n);
      return;
    }
    if (isContinue) this.fail('#N=continue needs #patterns/#tracks mode');
    if (n < 0 || n > 7) this.fail(`channel #${n} out of range 0-7`);
    // After a global prelude '/', channel bodies are loop-section content.
    const section = this.preludeSplit ? 1 : 0;
    this.channelSection = section;
    if (this.voiceTracks[n][section] === -1) {
      this.voiceTracks[n][section] = this.trackEvents.length;
      this.trackEvents.push([]);
    }
    foldPrelude(this.voiceTracks[n][section]);
    this.sawChannel = true;
    this.lastDefinedTrack = this.voiceTracks[n][section];
    this.ch = this.channelStateFor(this.voiceTracks[n][section]);
  },

  parseIntroMarker(this: Compiler): void {
    if (this.amyPartList !== null) this.fail("'/' belongs inside #patterns when patterns are used");
    if (this.loopSub !== null) this.fail("'/' inside a loop");
    const ch = this.requireChannel();
    if (!this.sawChannel && ch.track === this.preludeTrack) {
      // Global '/' before any channel: the prelude commands play once as
      // voice 0's intro; the channels that follow are all loop-section data.
      this.voiceTracks[0][0] = this.preludeTrack;
      this.preludeTrack = -1; // consumed — nothing folds into the channels
      this.preludeSplit = true;
      this.hasIntro = true;
      return;
    }
    if (this.channelSection === 1) this.fail("second '/' on the same channel");
    // Which voice is this? (default mode: track ↔ voice via voiceTracks)
    const voice = this.voiceTracks.findIndex(([a]) => a === ch.track);
    if (voice < 0) this.fail("'/' outside a voice channel");
    this.channelSection = 1;
    this.voiceTracks[voice][1] = this.trackEvents.length;
    this.trackEvents.push([]);
    ch.track = this.voiceTracks[voice][1];
    this.hasIntro = true;
    ch.prevTicks = -1;
    ch.prevQ = -1;
  },

  // ── blocks ────────────────────────────────────────────────────────────────

  openBrace(this: Compiler, what: string): void {
    this.skipSpace();
    if (this.peek() !== '{') this.fail(`expected '{' for ${what}`);
    this.next();
  },

  parseSpcBlock(this: Compiler): void {
    this.openBrace('#spc');
    for (;;) {
      this.skipSpace();
      if (this.peek() === '}') {
        this.next();
        return;
      }
      if (this.peek() !== '#') this.fail('expected #field inside #spc');
      this.next();
      let field = '';
      while (this.pos < this.src.length && !isSpace(this.peek())) field += this.next();
      const value = this.readQuoted(`#spc #${field}`);
      const f = field.toLowerCase();
      if (f === 'title') this.meta.title = value;
      else if (f === 'game') this.meta.game = value;
      else if (f === 'author') this.meta.author = value;
      else if (f === 'comment') this.meta.comment = value;
      else if (f === 'length') this.meta.length = value;
      else if (f === 'dumper') { /* ID666 dumper — no home yet */ }
      else this.note('other', `#spc #${field} ignored`);
    }
  },

  parseSamplesBlock(this: Compiler): void {
    this.openBrace('#samples');
    for (;;) {
      this.skipSpace();
      const c = this.peek();
      if (c === '}') {
        this.next();
        return;
      }
      if (c === '#') {
        this.next();
        let group = '';
        while (this.pos < this.src.length && !isSpace(this.peek())) group += this.next();
        // Sample groups prepend the SMW bank's own samples to the list —
        // remember that offset exists so $F3 indexing can refuse loudly.
        this.sampleGroupDeclared = true;
        continue;
      }
      if (c === '"') {
        this.listedSamples.push(this.readQuoted('#samples entry'));
        continue;
      }
      this.fail(`unexpected '${c}' inside #samples`);
    }
  },

  /** 5 hex bytes after a sample ref (both dialects' instrument rows). */
  readRowTail(this: Compiler, first: number, source: string): number {
    const bytes = [first];
    for (let k = 0; k < 5; k++) bytes.push(this.readHexByte(`${source} byte ${k + 2}`));
    return this.addInstrumentRow(bytes, source);
  },

  parseInstrumentsBlock(this: Compiler): void {
    this.openBrace('#instruments');
    for (;;) {
      this.skipSpace();
      const c = this.peek();
      if (c === '}') {
        this.next();
        return;
      }
      if (c === '"') {
        const name = this.readQuoted('#instruments sample');
        const srcn = this.customSrcn(this.addSample(name));
        this.readRowTail(srcn, `custom "${name}"`);
        continue;
      }
      if (c === '#') {
        this.next();
        let set = '';
        while (this.pos < this.src.length && !isSpace(this.peek())) set += this.next();
        const s = set.toLowerCase();
        if (this.dialect !== 'amy') this.fail(`#${set} inside #instruments is AddMusicY syntax`);
        if (s === 'default') {
          const rows = this.opts.defaultInstrumentRows;
          if (!rows || rows.length !== 144) this.fail('#default needs the cart-sourced 24-row default table (internal wiring)');
          for (let r = 0; r < 24; r++) {
            this.addInstrumentRow([...rows.subarray(r * 6, r * 6 + 6)], `#default row ${r}`);
          }
        } else if (s === 'fg_set') {
          const rows = this.opts.fgSetInstrumentRows;
          if (!rows || rows.length !== 24) this.fail('#fg_set needs the cart-sourced 4-row grassland add-on table (internal wiring)');
          for (let r = 0; r < 4; r++) {
            this.addInstrumentRow([...rows.subarray(r * 6, r * 6 + 6)], `#fg_set row ${r}`);
          }
          this.note('instrument', '#fg_set rows reference the grassland add-on samples ($18-$1B) — only valid when the target set carries that bank');
        } else this.fail(`unknown instrument set #${set}`);
        continue;
      }
      if (c === '$') {
        if (this.dialect === 'amy') {
          const first = this.readHexByte('instrument row byte 1');
          this.readRowTail(first, `raw row ${this.instrumentRows.length}`);
        } else {
          this.fail('AMK #instruments rows must start with a "sample.brr" reference (@N stock-derived rows are not supported — YI has no SMW samples)');
        }
        continue;
      }
      if (c === '@') {
        // AMK custom instrument derived from an SMW stock sample: @N + 5
        // bytes (ADSR1 ADSR2 GAIN tune sub) — mapped onto the curated YI
        // sample with the tuning corrected against SMW's base.
        if (this.dialect !== 'amk') this.fail('@N #instruments rows are AddmusicK syntax');
        this.next();
        const id = this.readInt('stock instrument');
        if (id === 19 || id === 20 || id > 29) this.fail(`@${id}: only @0-@18 / @21-@29 can seed a custom instrument`);
        // Percussion-derived customs take the drum's SAMPLE but play written
        // notes normally (the fixed-pitch column applies only to @21-@29
        // themselves — AMK semantics).
        const d = id >= 21 ? SMW_PERC_ROWS[id - 21] : SMW_DEFAULT_ROWS[id];
        const name = id >= 21 ? SMW_PERC_NAMES[id - 21] : SMW_INSTRUMENT_NAMES[id];
        const b: number[] = [];
        for (let k = 0; k < 5; k++) b.push(this.readHexByte(`@${id}-derived row byte ${k + 2}`));
        this.reportStockMapping(`custom instrument(s) derived from SMW @${id} (${name})`, `stock-derived-${id}`, d[0], '');
        // Rows must stay in definition order for the @30+k mapping, so this
        // bypasses stockRow's dedupe cache.
        const { srcn: mapped, tYi } = this.resolveStockSample(d[0], `@${id} row`);
        const tBase = SMW_SAMPLE_BASE_TUNING[d[0]] ?? 1;
        let mult = tYi * ((b[3] + b[4] / 256) / tBase);
        if (mult >= 256) mult = 255.996;
        if (mult < 1 / 256) mult = 1 / 256;
        const hi = Math.floor(mult);
        const lo = Math.round((mult - hi) * 256);
        this.addInstrumentRow(
          lo === 256 ? [mapped, b[0], b[1], b[2], hi + 1, 0] : [mapped, b[0], b[1], b[2], hi, lo],
          `custom @${30 + this.instrumentRows.length} (SMW ${name} → YI ${yiSampleName(mapped)})`
        );
        continue;
      }
      if (c.toLowerCase() === 'n' && this.dialect === 'amk') {
        this.next();
        let clock = '';
        while (isHexDigit(this.peek())) clock += this.next();
        if (clock === '') this.fail('nXX noise instrument needs a hex clock');
        const v = parseInt(clock, 16);
        if (v > 0x1f) this.fail(`noise clock ${clock} out of range 0-1F`);
        this.readRowTail(0x80 | v, `noise n${clock}`);
        continue;
      }
      this.fail(`unexpected '${c}' inside #instruments`);
    }
  },

  parseLocalSamplesBlock(this: Compiler): void {
    this.openBrace('#local_samples');
    for (;;) {
      this.skipSpace();
      const c = this.peek();
      if (c === '}') {
        this.next();
        return;
      }
      if (c !== '"') this.fail(`unexpected '${c}' inside #local_samples`);
      const name = this.readQuoted('#local_samples entry');
      // AMY assigns a NEW slot per listing even for repeated names (aliased
      // dir entries onto the same data).
      const idx = this.addSample(name);
      if (this.dirEntries.length >= MAX_DIR_ENTRIES) this.fail(`too many local samples (max ${MAX_DIR_ENTRIES})`);
      this.dirEntries.push({ sampleIndex: idx });
    }
  },

  parsePatternsBlock(this: Compiler): void {
    if (this.sawChannel) this.fail('#patterns must be defined before any channel data');
    this.openBrace('#patterns');
    const list: number[] = [];
    let loopPart: number | null = null;
    for (;;) {
      this.skipSpace();
      const c = this.peek();
      if (c === '}') {
        this.next();
        break;
      }
      if (c === '/') {
        this.next();
        if (loopPart !== null) this.fail("multiple '/' in #patterns");
        loopPart = list.length;
        continue;
      }
      if (!isDigit(c)) this.fail(`unexpected '${c}' inside #patterns`);
      list.push(this.readInt('pattern number'));
    }
    if (list.length === 0) this.fail('#patterns is empty');
    this.amyPartList = list;
    this.amyLoopPart = loopPart;
    if (this.amyPatterns === null) this.amyPatterns = [];
    return;
  },

  parseTracksBlock(this: Compiler): void {
    if (this.sawChannel) this.fail('#tracks must be defined before any channel data');
    this.openBrace('#tracks');
    const rows: number[][] = [];
    let row: number[] = [];
    for (;;) {
      this.skipSpace0(); // spaces/tabs only — newlines delimit rows
      const c = this.peek();
      if (c === '\n' || c === '\r') {
        this.next();
        if (row.length > 0) {
          if (row.length !== 8) this.fail(`#tracks row has ${row.length} entries (needs exactly 8)`);
          rows.push(row);
          row = [];
        }
        continue;
      }
      if (c === '}') {
        this.next();
        if (row.length > 0) {
          if (row.length !== 8) this.fail(`#tracks row has ${row.length} entries (needs exactly 8)`);
          rows.push(row);
        }
        break;
      }
      if (isDigit(c) || c === '-') {
        row.push(this.readInt('track number', true));
        continue;
      }
      this.fail(`unexpected '${c}' inside #tracks`);
    }
    if (rows.length === 0) this.fail('#tracks is empty');
    this.amyPatterns = rows;
  },

  skipSpace0(this: Compiler): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.next();
  },

  // ── '(' forms: label loops, remote codes, AMK sample load ────────────────

  parseParen(this: Compiler): void {
    this.skipSpace();
    if (this.peek() === '!') {
      this.next();
      return this.parseRemote();
    }
    if (this.peek() === '@') {
      // AMK inline sample load from a stock instrument: (@N, $XX)
      this.next();
      const id = this.readInt('sample-load instrument');
      if (id < 0 || id > 29 || id === 19 || id === 20) this.fail(`(@${id}, …): not a stock instrument`);
      this.skipSpace();
      if (this.peek() === ',') this.next();
      const mult = this.readHexByte('sample-load pitch multiplier');
      this.skipSpace();
      if (this.peek() !== ')') this.fail("expected ')' after sample load");
      this.next();
      const ch = this.requireChannel();
      if (ch.row < 0) {
        this.warnOnce('sample-load-noinst', 'sample load before any instrument — dropped', 'instrument');
        return;
      }
      const d = id >= 21 ? SMW_PERC_ROWS[id - 21] : SMW_DEFAULT_ROWS[id];
      const base = this.instrumentRows[ch.row];
      const { srcn } = this.resolveStockSample(d[0], `(@${id}, …)`);
      const row = this.stockRow(d[0], base.bytes[1], base.bytes[2], base.bytes[3], mult, 0, `(@${id}, $${mult.toString(16)})`);
      void srcn;
      this.vcmd(0xe0, 'setInstrument', [row]);
      ch.row = row;
      this.warnOnce('sample-load', 'inline ("sample", $XX) loads become synthetic instrument rows', 'instrument');
      return;
    }
    if (this.peek() === '"') {
      // AMK inline sample load: ("file.brr", $XX)
      const name = this.readQuoted('sample load');
      this.skipSpace();
      if (this.peek() === ',') this.next();
      const mult = this.readHexByte('sample-load pitch multiplier');
      this.skipSpace();
      if (this.peek() !== ')') this.fail("expected ')' after sample load");
      this.next();
      const srcn = this.customSrcn(this.addSample(name));
      this.syntheticRowFrom((b) => {
        b[0] = srcn;
        b[4] = mult;
        b[5] = 0;
      }, `sample load "${name}"`);
      this.warnOnce('sample-load', 'inline ("sample", $XX) loads become synthetic instrument rows', 'instrument');
      return;
    }
    let label = '';
    while (/[a-z0-9_]/i.test(this.peek())) label += this.next();
    if (label === '') this.fail("expected a label inside '(...)'");
    this.skipSpace();
    if (this.peek() !== ')') this.fail(`bad label '(${label}'`);
    this.next();
    // Existence decides call vs definition (AMK/AMY semantics): a defined
    // label is ALWAYS a call — even when an unrelated '[' loop follows it.
    const sub = this.labelSubs.get(label);
    if (sub !== undefined) {
      let count = 1;
      this.skipSpace0();
      if (isDigit(this.peek())) count = this.readInt('loop count');
      this.requireChannel();
      this.callSub(sub, count);
      return;
    }
    this.skipSpace();
    if (this.peek() !== '[') this.fail(`label loop (${label}) not defined yet`);
    // definition — beginLoop (triggered by the '[' in the main loop) will
    // claim the pending label.
    this.pendingLabel = label;
  },

  parseRemote(this: Compiler): void {
    let id = '';
    while (/[a-z0-9_]/i.test(this.peek())) id += this.next();
    this.skipSpace();
    if (this.peek() === ')') {
      this.next();
      this.skipSpace();
      if (this.peek() === '[') {
        // (!id)[ body ] — capture the body text verbatim.
        this.next();
        let body = '';
        while (this.pos < this.src.length && this.peek() !== ']') body += this.next();
        if (this.peek() !== ']') this.fail(`unterminated remote code (!${id})`);
        this.next();
        this.remoteBodies.set(id, body);
        return;
      }
      this.fail(`remote code (!${id}) needs a body or arguments`);
    }
    if (this.peek() !== ',') this.fail(`expected ',' or ')' in remote call (!${id}`);
    this.next();
    const type = this.readInt('remote event type', true);
    // Optional third arg (timing) — =ticks, hex, or a note-length number.
    // Only consumed for validation: the timed event types drop below.
    this.skipSpace();
    if (this.peek() === ',') {
      this.next();
      this.skipSpace();
      if (this.peek() === '=') {
        this.next();
        this.readInt('remote timing ticks');
      } else if (this.peek() === '$') {
        this.readHexByte('remote timing');
      } else this.readInt('remote timing');
    }
    this.skipSpace();
    if (this.peek() !== ')') this.fail(`expected ')' closing remote call (!${id}`);
    this.next();

    const ch = this.requireChannel();
    if (type === 0) {
      ch.keyOnEvents = null;
      return;
    }
    if (type === -1 || type === 4) {
      const body = this.remoteBodies.get(id);
      if (body === undefined) this.fail(`remote code (!${id}) not defined`);
      const events = this.compileFragment(body, `remote (!${id})`);
      if (type === -1) ch.keyOnEvents = events;
      else for (const ev of events) this.push(structuredClone(ev));
      if (type === -1) this.warnOnce('remote-keyon', 'key-on remote codes are inlined before every note (byte cost scales with note count)');
      return;
    }
    this.warnOnce(`remote-timed:${type}`, `remote event type ${type} (timed/key-off) has no YI hook — dropped`);
  },

  /** Compile a remote-code body in the current channel's context, capturing
   *  the events instead of emitting them. Notes are not allowed (AMK rule). */
  compileFragment(this: Compiler, body: string, what: string): TrackEvent[] {
    const saved = { src: this.src, pos: this.pos, line: this.line };
    const captured: TrackEvent[] = [];
    this.fragmentCapture = captured;
    this.src = body;
    this.pos = 0;
    try {
      this.run();
    } finally {
      this.fragmentCapture = null;
      this.src = saved.src;
      this.pos = saved.pos;
      this.line = saved.line;
    }
    if (captured.some((e) => e.kind === 'note' || e.kind === 'tie' || e.kind === 'rest' || e.kind === 'perc' || e.kind === 'length')) {
      this.fail(`${what}: remote codes cannot contain note data`);
    }
    return captured;
  },

  parseBang(this: Compiler): void {
    let word = '';
    while (/[a-z_]/i.test(this.peek())) word += this.next();
    if (word.toLowerCase() === 'print') {
      const msg = this.readQuoted('!print');
      this.note('other', `print: ${msg}`);
      return;
    }
    this.fail(`unknown !${word}`);
  },

  parseInstrumentCommand(this: Compiler): void {
    if (this.peek() === '@') this.next(); // @@N = direct instrument — same emission for us
    this.skipSpace();
    if (!isDigit(this.peek())) {
      if (this.dialect === 'amy') this.fail('@kitname drum kits are not supported yet — write the instrument switches directly');
      this.fail("expected a number after '@'");
    }
    const id = this.readInt('instrument');
    this.requireChannel();
    this.setInstrument(id);
  },

  // ── letter commands ───────────────────────────────────────────────────────

  parseLetter(this: Compiler, letter: string): void {
    if (letter in NOTE_SEMITONES || letter === 'r' || letter === '^') {
      this.requireChannel();
      return this.parseNote(letter);
    }
    const ch = this.requireChannel();
    switch (letter) {
      case 'o': {
        const o = this.readInt('octave');
        if (o < 1 || o > 6) this.fail(`octave ${o} out of range 1-6`);
        ch.octave = o;
        return;
      }
      case 'l': {
        const l = this.readInt('default length');
        if (l < 1 || l > 192) this.fail(`default length ${l} out of range`);
        ch.defaultLength = l;
        return;
      }
      case 'h': {
        ch.transpose = this.readInt('transpose', true);
        return;
      }
      case 'q': {
        let s = '';
        while (isHexDigit(this.peek()) && s.length < 2) s += this.next();
        if (s.length !== 2) this.fail('q needs two hex digits (gate + velocity)');
        const v = parseInt(s, 16);
        if (v > 0x7f) this.fail(`q${s}: gate digit must be 0-7`);
        ch.q = v;
        ch.prevQ = -1; // explicit q always re-emits, even unchanged (both refs)
        return;
      }
      case 'v': {
        const v = this.readInt('volume');
        ch.volume = Math.min(255, v);
        ch.volumeSet = true;
        this.vcmd(0xed, 'channelVolume', [toByte(amp(this, v), 'volume', this.line)]);
        return;
      }
      case 'w': {
        const v = this.readInt('global volume');
        this.vcmd(0xe5, 'songVolume', [toByte(v, 'global volume', this.line)]);
        return;
      }
      case 't': {
        const v = this.divT(this.readInt('tempo'), 'tempo');
        this.vcmd(0xe7, 'tempo', [toByte(v, 'tempo', this.line)]);
        return;
      }
      case 'y': {
        const pan = this.readInt('pan');
        if (pan > 20) this.note('other', `pan y${pan} out of range 0-20`);
        let val = pan & 0x3f;
        this.skipSpace();
        if (this.peek() === ',') {
          this.next();
          const l = this.readInt('surround L');
          const r = this.readCommaInt('surround R');
          if (l > 1 || r > 1) this.fail('y surround flags must be 0 or 1');
          val |= (l ? 0x40 : 0) | (r ? 0x80 : 0);
        }
        this.vcmd(0xe1, 'pan', [val]);
        return;
      }
      case 'p': {
        const a = this.readInt('vibrato arg');
        const b = this.readCommaInt('vibrato arg');
        let delay = 0, rate = a, depth = b;
        this.skipSpace();
        if (this.peek() === ',') {
          this.next();
          delay = a;
          rate = b;
          depth = this.readInt('vibrato depth');
        }
        // Engine-verified: YI's LFO tick is byte-identical to AMK's (same
        // phase/triangle/depth math incl. the ≥$F1 extended mode) — args
        // pass through exactly.
        this.vcmd(0xe3, 'vibratoOn', [toByte(this.divT(delay, 'delay'), 'vibrato delay', this.line), toByte(this.multT(rate), 'vibrato rate', this.line), toByte(depth, 'vibrato depth', this.line)]);
        return;
      }
      case 'n': {
        if (this.dialect === 'amy') {
          const d = this.readInt('pitch env delay');
          const len = this.readCommaInt('pitch env length');
          const semi = this.readCommaInt('pitch env semitones', true);
          this.vcmd(0xf2, 'pitchEnvelopeFrom', [toByte(d, 'delay', this.line), toByte(len, 'length', this.line), toByte(semi, 'semitones', this.line)]);
          return;
        }
        // AMK noise: nXX (hex clock)
        let s = '';
        while (isHexDigit(this.peek())) s += this.next();
        if (s === '') this.fail('n needs a hex noise clock');
        const clock = parseInt(s, 16);
        if (clock > 0x1f) this.fail(`noise clock ${s} out of range 0-1F`);
        this.syntheticRowFrom((b) => {
          b[0] = 0x80 | clock;
        }, `noise n${s}`);
        return;
      }
      // AMY-only letters
      case 'i': case 'j': case 'k': case 'm': case 's': case 'u': case 'x': case 'z': {
        if (this.dialect !== 'amy') this.fail(`'${letter}' is not an AMK command`);
        return this.parseAmyLetter(letter);
      }
      default:
        this.fail(`unknown command '${letter}'`);
    }
  },

  parseAmyLetter(this: Compiler, letter: string): void {
    switch (letter) {
      case 'i': {
        const v = this.readInt('fine tune');
        this.vcmd(0xf4, 'fineTune', [toByte(v, 'fine tune', this.line)]);
        return;
      }
      case 'j': {
        const v = this.readInt('song key', true);
        this.vcmd(0xe9, 'globalTranspose', [toByte(v, 'song key', this.line)]);
        return;
      }
      case 'k': {
        const v = this.readInt('channel key', true);
        this.vcmd(0xea, 'channelTranspose', [toByte(v, 'channel key', this.line)]);
        return;
      }
      case 'm': {
        const d = this.readInt('pitch env delay');
        const len = this.readCommaInt('pitch env length');
        const semi = this.readCommaInt('pitch env semitones', true);
        this.vcmd(0xf1, 'pitchEnvelopeTo', [toByte(d, 'delay', this.line), toByte(len, 'length', this.line), toByte(semi, 'semitones', this.line)]);
        return;
      }
      case 'u': {
        const a = this.readInt('tremolo arg');
        const b = this.readCommaInt('tremolo arg');
        let delay = 0, rate = a, depth = b;
        this.skipSpace();
        if (this.peek() === ',') {
          this.next();
          delay = a;
          rate = b;
          depth = this.readInt('tremolo depth');
        }
        this.vcmd(0xeb, 'tremoloOn', [toByte(delay, 'delay', this.line), toByte(rate, 'rate', this.line), toByte(depth, 'depth', this.line)]);
        return;
      }
      case 's': {
        const dur = this.readInt('fade duration');
        this.skipSpace();
        if (this.peek() !== ',') this.fail("s fade needs ',subcommand'");
        this.next();
        this.skipSpace();
        const sub = this.next().toLowerCase();
        const d = toByte(dur, 'fade duration', this.line);
        if (sub === 'p') {
          this.vcmd(0xf0, 'vibratoFadeIn', [d]);
          return;
        }
        if (sub === 't') {
          this.vcmd(0xe8, 'tempoFade', [d, toByte(this.readInt('target tempo'), 'target', this.line)]);
          return;
        }
        if (sub === 'v') {
          this.vcmd(0xee, 'channelVolumeFade', [d, toByte(this.readInt('target volume'), 'target', this.line)]);
          return;
        }
        if (sub === 'w') {
          this.vcmd(0xe6, 'songVolumeFade', [d, toByte(this.readInt('target volume'), 'target', this.line)]);
          return;
        }
        if (sub === 'y') {
          this.vcmd(0xe2, 'panFade', [d, toByte(this.readInt('target pan'), 'target', this.line)]);
          return;
        }
        if (sub === 'x') {
          const l = this.readInt('echo L', true);
          const r = this.readCommaInt('echo R', true);
          this.vcmd(0xf8, 'echoVolumeFade', [d, toByte(l, 'echo L', this.line), toByte(r, 'echo R', this.line)]);
          return;
        }
        this.fail(`s fade does not apply to '${sub}'`);
      }
      case 'x': {
        // x<vbits binary>,±L,±R
        this.skipSpace();
        let bits = '';
        while (this.peek() === '0' || this.peek() === '1') bits += this.next();
        if (bits === '' || bits.length > 8) this.fail('x needs 1-8 binary channel bits');
        const l = this.readCommaInt('echo vol L', true);
        const r = this.readCommaInt('echo vol R', true);
        this.vcmd(0xf5, 'echoOn', [parseInt(bits, 2), toByte(l, 'echo L', this.line), toByte(r, 'echo R', this.line)]);
        return;
      }
      case 'z': {
        const delay = this.clampEchoDelay(this.readInt('echo delay'));
        const fb = this.readCommaInt('echo feedback', true);
        let fir = this.readCommaInt('FIR preset');
        if (fir > 3) {
          this.note('echo', `FIR preset ${fir} clamped to 3 (YI has 4 preset banks)`);
          fir = 3;
        }
        this.vcmd(0xf7, 'echoParams', [toByte(delay, 'delay', this.line), toByte(fb, 'feedback', this.line), fir]);
        return;
      }
    }
    this.fail(`unhandled AMY letter '${letter}'`);
  },

  // ── hex commands ──────────────────────────────────────────────────────────

  parseHexCommand(this: Compiler): void {
    this.requireChannel();
    const op = this.readHexByte('hex command');
    if (this.dialect === 'amy') return this.parseAmyHex(op);
    return this.parseAmkHex(op);
  },

  parseAmyHex(this: Compiler, op: number): void {
    // Raw YI-native vcmd (AMY passthrough). $EF is loop machinery; notes/
    // lengths as raw hex are diagnostics — the letter grammar covers them.
    if (op < 0xe0 || op > 0xfa) this.fail(`raw hex $${op.toString(16).toUpperCase()} is not a YI vcmd ($E0-$FA) — use note/command syntax`);
    if (op === 0xef) this.fail('raw $EF subroutine calls are loop machinery — use [ ] loops');
    const info = AMY_VCMD_INFO[op - 0xe0];
    const args: number[] = [];
    for (let i = 0; i < info.argCount; i++) args.push(this.readHexByte(`$${op.toString(16)} arg ${i + 1}`));
    if (op === 0xf7) args[0] = this.clampEchoDelay(args[0]);
    if (op === 0xe0) this.requireChannel().row = args[0] < this.instrumentRows.length ? args[0] : this.requireChannel().row;
    this.vcmd(op, info.name, args);
  },

  parseAmkHex(this: Compiler, op: number): void {
    const hex = (n: number): string => '$' + n.toString(16).toUpperCase().padStart(2, '0');
    const arg = (what: string): number => this.readHexByte(what);
    switch (op) {
      case 0xda: {
        this.setInstrument(arg('instrument'));
        return;
      }
      case 0xdb: {
        this.vcmd(0xe1, 'pan', [arg('pan')]);
        return;
      }
      case 0xdc: {
        this.vcmd(0xe2, 'panFade', [this.divT(arg('ticks'), 'fade'), arg('target')]);
        return;
      }
      case 0xdd: {
        const d = this.divT(arg('bend delay'), 'delay');
        const len = this.divT(arg('bend length'), 'fade');
        const note = this.readHexOrNote('bend target');
        this.vcmd(0xf9, 'pitchSlide', [d, len, note]);
        return;
      }
      case 0xde: {
        this.vcmd(0xe3, 'vibratoOn', [this.divT(arg('delay'), 'delay'), this.multT(arg('rate')), arg('depth')]);
        return;
      }
      case 0xdf: {
        this.vcmd(0xe4, 'vibratoOff', []);
        return;
      }
      case 0xe0: {
        this.vcmd(0xe5, 'songVolume', [arg('volume')]);
        return;
      }
      case 0xe1: {
        this.vcmd(0xe6, 'songVolumeFade', [this.divT(arg('ticks'), 'fade'), arg('target')]);
        return;
      }
      case 0xe2: {
        this.vcmd(0xe7, 'tempo', [this.divT(arg('tempo'), 'tempo')]);
        return;
      }
      case 0xe3: {
        this.vcmd(0xe8, 'tempoFade', [this.divT(arg('ticks'), 'fade'), this.divT(arg('target'), 'tempo')]);
        return;
      }
      case 0xe4: {
        this.vcmd(0xe9, 'globalTranspose', [arg('semitones')]);
        return;
      }
      case 0xe5: {
        this.vcmd(0xeb, 'tremoloOn', [this.divT(arg('delay'), 'delay'), this.multT(arg('rate')), arg('depth')]);
        return;
      }
      case 0xe6: {
        this.warnOnce('raw-e6', 'raw $E6 subloops dropped — use [[ ]] superloop syntax');
        arg('subloop arg');
        return;
      }
      case 0xe7: {
        const v = arg('volume');
        const ch = this.requireChannel();
        ch.volume = v;
        ch.volumeSet = true;
        this.vcmd(0xed, 'channelVolume', [toByte(amp(this, v), 'volume', this.line)]);
        return;
      }
      case 0xe8: {
        const t = this.divT(arg('ticks'), 'fade');
        const target = arg('target');
        const ch = this.requireChannel();
        ch.volume = target;
        ch.volumeSet = true;
        this.vcmd(0xee, 'channelVolumeFade', [t, toByte(amp(this, target), 'target', this.line)]);
        return;
      }
      case 0xe9:
        this.fail('raw $E9 loop commands are compiler machinery — use [ ] loops');
        return;
      case 0xea: {
        this.vcmd(0xf0, 'vibratoFadeIn', [this.divT(arg('ticks'), 'fade')]);
        return;
      }
      case 0xeb: {
        // Engine-verified exact: YI $F1 = (delay, duration, offset), slide
        // to note+offset — AMK $EB verbatim.
        this.vcmd(0xf1, 'pitchEnvelopeTo', [this.divT(arg('delay'), 'delay'), this.divT(arg('length'), 'fade'), arg('semitones')]);
        return;
      }
      case 0xec: {
        // YI $F2 starts each note at note−offset and slides back; AMK $EC
        // starts at note+offset — NEGATE (mod 256, sign-safe).
        const d = this.divT(arg('delay'), 'delay');
        const len = this.divT(arg('length'), 'fade');
        const off = arg('semitones');
        this.vcmd(0xf2, 'pitchEnvelopeFrom', [d, len, (0x100 - off) & 0xff]);
        return;
      }
      case 0xed: {
        const a1 = arg('ADSR/GAIN');
        if (a1 >= 0x80) {
          const gain = arg('GAIN value');
          this.syntheticRowFrom((b) => {
            b[1] &= 0x7f; // ADSR off → GAIN mode
            b[3] = gain;
          }, `gain ${hex(gain)}`);
        } else {
          const sr = arg('sustain/release');
          this.syntheticRowFrom((b) => {
            b[1] = 0x80 | a1;
            b[2] = sr;
          }, `adsr ${hex(a1)} ${hex(sr)}`);
        }
        this.warnOnce('ed-adsr', '$ED ADSR/GAIN overrides become synthetic instrument rows + $E0 (immediate DSP write; SRCN latches at key-on)', 'instrument');
        return;
      }
      case 0xee: {
        this.vcmd(0xf4, 'fineTune', [arg('tuning')]);
        return;
      }
      case 0xef: {
        this.vcmd(0xf5, 'echoOn', [arg('vbits'), arg('vol L'), arg('vol R')]);
        return;
      }
      case 0xf0: {
        this.vcmd(0xf6, 'echoOff', []);
        return;
      }
      case 0xf1: {
        const d = this.clampEchoDelay(arg('echo delay'));
        this.vcmd(0xf7, 'echoParams', [d, arg('feedback'), Math.min(3, arg('FIR index'))]);
        return;
      }
      case 0xf2: {
        this.vcmd(0xf8, 'echoVolumeFade', [this.divT(arg('ticks'), 'fade'), arg('target L'), arg('target R')]);
        return;
      }
      case 0xf3: {
        const n = arg('sample number');
        const mult = arg('pitch multiplier');
        if (this.sampleGroupDeclared) {
          this.fail('$F3 with a #samples group: the index includes the SMW group samples, which have no stable mapping here — use ("file.brr", $XX) instead');
        }
        const name = this.listedSamples[n];
        if (name === undefined) this.fail(`$F3 sample ${hex(n)} is past the #samples list`);
        const srcn = this.customSrcn(this.addSample(name));
        this.syntheticRowFrom((b) => {
          b[0] = srcn;
          b[4] = mult;
          b[5] = 0;
        }, `$F3 load "${name}"`);
        return;
      }
      case 0xf4: {
        const sub = arg('$F4 subcommand');
        if (sub === 0x00 || sub === 0x06) this.warnOnce('yoshi-drums', '$F4 yoshi drums are SMW-specific — dropped');
        else if (sub === 0x01) this.warnOnce('legato', '$F4 $01 legato has no YI equivalent — notes re-key (audible on slides/runs)', 'timing');
        else if (sub === 0x02) {
          if (this.opts.emulateLightStaccato === false) {
            this.warnOnce('staccato', "$F4 $02 light staccato not emulated — full-gate notes ring 1 tick shorter than under AMK's driver", 'timing');
          } else {
            this.lightStaccato = !this.lightStaccato;
            if (this.emittedNotes) this.warnOnce('staccato-mid', "$F4 $02 mid-song — AMK flips light staccato globally at play time; the port applies it from this point in each channel's stream", 'timing');
            this.warnOnce('staccato', '$F4 $02 light staccato emulated — full-gate notes re-emit as note + 2-tick tie and ring 1 tick longer (AMK parity, ~2-3 bytes per note)', 'timing');
          }
        }
        else if (sub === 0x03) this.warnOnce('echo-toggle', '$F4 $03 per-channel echo toggle dropped — set the $EF echo mask instead', 'echo');
        else if (sub === 0x05) this.warnOnce('snes-sync', '$F4 $05 SNES sync is SMW-specific — dropped');
        else if (sub === 0x07) this.warnOnce('tempo-hike', '$F4 $07 tempo-hike immunity ignored — YI has no timer tempo hike', 'timing');
        else if (sub === 0x08) { /* N-SPC velocity table — the YI default */ }
        else if (sub === 0x09) {
          const ch = this.requireChannel();
          if (ch.row >= 0) this.vcmd(0xe0, 'setInstrument', [ch.row]);
        } else this.warnOnce(`f4-${sub}`, `$F4 ${hex(sub)} unknown subcommand — dropped`);
        return;
      }
      case 0xf5: {
        for (let i = 0; i < 8; i++) arg(`FIR coefficient ${i}`);
        this.warnOnce('fir', '$F5 custom FIR coefficients dropped — YI has 4 fixed FIR presets (selected via echo params)', 'echo');
        return;
      }
      case 0xf6: {
        arg('DSP register');
        arg('DSP value');
        this.warnOnce('dsp-write', '$F6 raw DSP writes dropped — no YI vcmd', 'echo');
        return;
      }
      case 0xf8: {
        const clock = arg('noise clock');
        this.syntheticRowFrom((b) => {
          b[0] = 0x80 | (clock & 0x1f);
        }, `noise ${hex(clock)}`);
        return;
      }
      case 0xf9: {
        arg('data byte 1');
        arg('data byte 2');
        this.warnOnce('data-send', '$F9 SNES data send is SMW-specific — dropped');
        return;
      }
      case 0xfa: {
        const sub = arg('$FA subcommand');
        if (sub === 0x00) {
          arg('pitch-mod channels');
          this.warnOnce('pmod', '$FA $00 pitch modulation dropped — no YI vcmd', 'echo');
        } else if (sub === 0x01) {
          const gain = arg('GAIN');
          this.syntheticRowFrom((b) => {
            b[1] &= 0x7f;
            b[3] = gain;
          }, `gain ${hex(gain)}`);
          this.warnOnce('ed-adsr', '$FA $01 GAIN overrides become synthetic instrument rows + $E0', 'instrument');
        } else if (sub === 0x02) {
          this.vcmd(0xea, 'channelTranspose', [arg('semitones')]);
        } else if (sub === 0x03) {
          const ch = this.requireChannel();
          ch.amplify = arg('amplify');
          // AMK's driver rescales the channel's CURRENT volume live, so the
          // usual `v130 $FA$03$40` order needs the already-set volume
          // re-emitted with the fold applied.
          if (ch.volumeSet) this.vcmd(0xed, 'channelVolume', [toByte(amp(this, ch.volume), 'volume', this.line)]);
          this.warnOnce('amplify', "$FA $03 amplify folded into the channel volume at compile time (√-compensated for the driver's squared volume curve)", 'volume');
        } else if (sub === 0x04) {
          const edl = arg('echo buffer EDL');
          if (edl > 2) this.note('echo', `$FA $04 reserves echo delay ${edl} > 2 — unsafe on YI (see echo warnings)`);
        } else if (sub === 0x05) {
          // Legacy (pre-#amk-2) gain command.
          const gain = arg('GAIN');
          this.syntheticRowFrom((b) => {
            b[1] &= 0x7f;
            b[3] = gain;
          }, `gain $${gain.toString(16)}`);
          this.warnOnce('ed-adsr', '$FA $05 legacy GAIN becomes a synthetic instrument row + $E0', 'instrument');
        } else if (sub === 0x06) {
          arg('velocity table');
          this.warnOnce('vtable-switch', '$FA $06 velocity-table switch ignored — YI plays its N-SPC tables', 'volume');
        } else {
          arg(`$FA ${hex(sub)} arg`);
          this.warnOnce(`fa-${sub}`, `$FA ${hex(sub)} unknown subcommand — dropped`);
        }
        return;
      }
      case 0xfb: {
        const first = arg('$FB kind');
        const ch = this.requireChannel();
        if (first === 0x00) {
          ch.arp = null;
          return;
        }
        this.warnOnce('arpeggio', '$FB arpeggio/trill/glissando unrolled into re-keyed short notes (YI has no arpeggio vcmd)', 'timing');
        if (first === 0x80) {
          const dur = this.divT(arg('trill duration'), 'duration');
          const delta = arg('trill offset');
          ch.arp = { stepTicks: dur, offsets: [0, delta], once: false };
        } else if (first === 0x81) {
          const dur = this.divT(arg('glissando duration'), 'duration');
          const delta = arg('glissando step');
          ch.arp = { stepTicks: dur, offsets: [delta], once: true };
        } else {
          const dur = this.divT(arg('arpeggio duration'), 'duration');
          const offsets: number[] = [];
          for (let i = 0; i < first; i++) offsets.push(arg(`arpeggio note ${i + 1}`));
          ch.arp = { stepTicks: dur, offsets: offsets.length ? offsets : [0], once: false };
        }
        return;
      }
      case 0xfc: {
        if (this.amkVersion < 2) {
          // Legacy anticipation-gain: $FC delay gain (2 bytes).
          arg('gain delay');
          arg('gain value');
          this.warnOnce('fc-legacy', '$FC anticipation-gain events (pre-#amk-2) have no YI hook — dropped');
          return;
        }
        for (const what of ['addr lo', 'addr hi', 'event type', 'delay']) arg(what);
        this.warnOnce('fc-raw', 'raw $FC remote command dropped — use (!n)[…] syntax');
        return;
      }
      case 0xf7: {
        for (const what of ['ARAM addr lo', 'ARAM addr hi', 'value']) arg(what);
        this.warnOnce('f7-aram', '$F7 raw ARAM writes dropped — no YI equivalent', 'echo');
        return;
      }
      case 0xfd: {
        this.vcmd(0xec, 'tremoloOff', []);
        return;
      }
      case 0xfe: {
        this.vcmd(0xf3, 'pitchEnvelopeOff', []);
        return;
      }
      default:
        this.fail(`hex ${hex(op)} is not an AMK command`);
    }
  },

  /** $DD's target: hex byte, or an MML note (with optional o/</> prefixes —
   *  they mutate channel state, matching AMK's stream behavior). */
  readHexOrNote(this: Compiler, what: string): number {
    const v = this.tryReadHexByte();
    if (v >= 0) return v;
    const ch = this.requireChannel();
    for (;;) {
      this.skipSpace();
      const c = this.peek();
      if (c === 'o') {
        this.next();
        const o = this.readInt('octave');
        if (o < 1 || o > 6) this.fail('octave out of range');
        ch.octave = o;
      } else if (c === '<') {
        this.next();
        ch.octave--;
      } else if (c === '>') {
        this.next();
        ch.octave++;
      } else break;
    }
    const letter = this.next().toLowerCase();
    if (!(letter in NOTE_SEMITONES)) this.fail(`expected a note or hex byte for ${what}`);
    return this.readNoteByte(letter);
  },

  // ── finish ────────────────────────────────────────────────────────────────

  finish(this: Compiler): CompiledMml {
    if (this.loopSub !== null) this.fail('unterminated [ loop at end of file');
    if (this.superloopStack.length > 0) this.fail('unterminated [[ superloop at end of file');

    let parts: number[];
    let loopPartIndex: number | null;
    let patterns: number[][];

    if (this.amyPatterns !== null && this.amyPartList !== null) {
      patterns = this.amyPatterns.map((row) =>
        row.map((t) => {
          if (t < 0) return -1;
          if (t >= this.trackEvents.length || this.trackEvents[t] === undefined) {
            while (this.trackEvents.length <= t) this.trackEvents.push([]);
          }
          if (!this.usedTrackIds.has(t)) this.note('other', `track ${t} appears in #tracks but has no #${t} body — silent`);
          return t;
        }),
      );
      const list = [...this.amyPartList];
      let noLoop = this.noLoop;
      if (list[list.length - 1] === 0) {
        list.pop();
        noLoop = true;
      }
      parts = list.map((n, i) => {
        if (n < 1 || n > patterns.length) {
          throw new MmlCompileError(`#patterns entry ${n} (position ${i + 1}) is out of range 1-${patterns.length}`, 1);
        }
        return n - 1;
      });
      loopPartIndex = noLoop ? null : (this.amyLoopPart ?? 0);
      if (loopPartIndex !== null && loopPartIndex >= parts.length) loopPartIndex = 0;
    } else if (this.amyPatterns !== null || this.amyPartList !== null) {
      this.fail('#patterns and #tracks must both be defined');
    } else {
      const intro: number[] = [];
      const loop: number[] = [];
      for (let v = 0; v < 8; v++) {
        intro.push(this.voiceTracks[v][0]);
        loop.push(this.voiceTracks[v][1]);
      }
      if (this.hasIntro) {
        patterns = [intro, loop];
        parts = [0, 1];
        loopPartIndex = this.noLoop ? null : 1;
      } else {
        patterns = [intro];
        parts = [0];
        loopPartIndex = this.noLoop ? null : 0;
      }
    }

    if (this.trackEvents.every((t) => t.length === 0)) this.fail('song has no music data');

    const unused = this.listedSamples.filter((n) => !this.sampleIndexByName.has(n));
    if (unused.length > 0) {
      this.note('sample', `#samples entries never referenced (skipped, saves budget): ${unused.join(', ')}`);
    }

    // globalBankCarry safety net: rows that reached the table with a
    // resident global-bank SRCN through paths the curated mapping doesn't
    // cover (AMY #default copies, raw rows) get their sample carried too.
    // Custom SRCNs are ≥ $18 and noise rows carry bit 7, so only true
    // global-bank references (< $18) match.
    if (this.opts.globalBankCarry) {
      for (const row of this.instrumentRows) {
        if (row.bytes[0] >= 0x18) continue;
        const srcn = this.carryGlobalSample(row.bytes[0]);
        if (srcn !== null) row.bytes[0] = srcn;
      }
    }

    return {
      dialect: this.dialect,
      meta: this.meta,
      parts,
      loopPartIndex,
      patterns,
      trackEvents: this.trackEvents.map((t) => t ?? []),
      subEvents: this.subEvents,
      continuations: this.chainLinks,
      instrumentRows: this.instrumentRows,
      dirEntries: this.dirEntries,
      samples: this.samples,
      sampleSrcnBase: this.customSrcnBase,
      usedGrasslandDrums: this.usedGrasslandDrums,
      usedLightStaccato: this.usedLightStaccato,
      usedPackagedSamples: this.usedPackagedSamples,
      usedSmwSamples: this.usedSmwSamples,
      report: REPORT_CATEGORY_ORDER.flatMap((cat) =>
        this.reportEntries.filter((e) => e.cat === cat).map((e) => e.msg)
      ),
    };
  },
});

/** YI vcmd arg counts for AMY raw-hex passthrough (index = op - $E0). */
const AMY_VCMD_INFO: { name: string; argCount: number }[] = [
  { name: 'setInstrument', argCount: 1 }, { name: 'pan', argCount: 1 },
  { name: 'panFade', argCount: 2 }, { name: 'vibratoOn', argCount: 3 },
  { name: 'vibratoOff', argCount: 0 }, { name: 'songVolume', argCount: 1 },
  { name: 'songVolumeFade', argCount: 2 }, { name: 'tempo', argCount: 1 },
  { name: 'tempoFade', argCount: 2 }, { name: 'globalTranspose', argCount: 1 },
  { name: 'channelTranspose', argCount: 1 }, { name: 'tremoloOn', argCount: 3 },
  { name: 'tremoloOff', argCount: 0 }, { name: 'channelVolume', argCount: 1 },
  { name: 'channelVolumeFade', argCount: 2 }, { name: 'subroutine', argCount: 3 },
  { name: 'vibratoFadeIn', argCount: 1 }, { name: 'pitchEnvelopeTo', argCount: 3 },
  { name: 'pitchEnvelopeFrom', argCount: 3 }, { name: 'pitchEnvelopeOff', argCount: 0 },
  { name: 'fineTune', argCount: 1 }, { name: 'echoOn', argCount: 3 },
  { name: 'echoOff', argCount: 0 }, { name: 'echoParams', argCount: 3 },
  { name: 'echoVolumeFade', argCount: 3 }, { name: 'pitchSlide', argCount: 3 },
  { name: 'percussionBase', argCount: 1 },
];

// ── entry points ─────────────────────────────────────────────────────────────

export function compileMmlAs(dialect: MmlDialect, text: string, opts: CompileMmlOptions): CompiledMml {
  const c = new Compiler(dialect, opts);
  let src = stripComments(text.replace(/^﻿/, '').replace(/\r\n/g, '\n'));
  const pre: string[] = [];
  if (dialect === 'amk') {
    src = runAmkPreprocessor(src, pre);
    src = applyReplacements(src, 'amk', pre);
  } else {
    src = applyReplacements(src, 'amy', pre);
    src = expandAmyValueMacros(src, pre);
  }
  for (const msg of pre) c.note('other', msg);
  c.src = src;
  c.pos = 0;
  c.line = 1;
  c.run();
  return c.finish();
}

/** Compile MML text, auto-detecting the dialect. */
export function compileMml(text: string, opts: CompileMmlOptions): CompiledMml {
  const detection = detectMmlDialect(text);
  if (detection.dialect === null) {
    throw new MmlCompileError(`cannot detect the MML dialect (${detection.reasons.join('; ')}) — add #amk N (AMK) or use AMY block syntax`, 1);
  }
  return compileMmlAs(detection.dialect, text, opts);
}

/** The "No echo" import option: drop every echo-enabling vcmd from a
 *  compiled song — $F5 echo on, $F7 echo params, $F8 echo volume fade
 *  ($F6 echo OFF stays; it's what keeps the DSP's buffer writes disabled) —
 *  so the module qualifies for the ECHO_BUFFER_REGION placement window.
 *  Returns the same object when the song is already echo-free; otherwise a
 *  copy with a port-report line. Vcmds are 0-tick, so timing is unchanged. */
export function stripEchoVcmds(compiled: CompiledMml): CompiledMml {
  let removed = 0;
  const strip = (evs: TrackEvent[]): TrackEvent[] =>
    evs.filter((ev) => {
      if (ev.kind === 'vcmd' && (ev.op === 0xf5 || ev.op === 0xf7 || ev.op === 0xf8)) {
        removed++;
        return false;
      }
      return true;
    });
  const trackEvents = compiled.trackEvents.map(strip);
  const subEvents = compiled.subEvents.map((b) => (b ? strip(b) : b));
  if (removed === 0) return compiled;
  return {
    ...compiled,
    trackEvents,
    subEvents,
    report: [
      ...compiled.report,
      `no-echo: ${removed} echo command(s) removed — the song plays dry ("No echo" import setting)`,
    ],
  };
}

export { runAmkPreprocessor as _runAmkPreprocessor, applyReplacements as _applyReplacements, expandAmyValueMacros as _expandAmyValueMacros };
