// .spc → song-module import codec — the read half of "importing spc files"
// (research/plan-audio-panel.md).
//
// An .spc file is a 64 KB ARAM snapshot. When that snapshot runs the YI
// driver (retail rips, our own synthesized exports, emulator captures of YI
// hacks), a song in it is fully recoverable:
//
//   $FF8E+2n   song-pointer table (slot n, 1-based) → the song to extract
//   $3D00+168  instrument table (28 6-byte records: SRCN, ADSR1, ADSR2,
//              GAIN, pitch×2; CODE_voice_set_instrument — id<$80 → row=id,
//              else row = id-$CA+percBase($5F); record byte0 bit7 = noise)
//   $3FE8+24   gate/velocity tables (every retail song module re-uploads)
//   sequence   reachable extent of the song walk (parts → patterns → tracks
//              → subroutines). Copied VERBATIM at its source addresses —
//              internal pointers are absolute, so preserving addresses is
//              byte-faithful with zero fixups. Probed: the reachable extent
//              equals the retail modules' sequence blocks exactly, for all
//              12 (tmp/seq-extent-probe.ts → pinned in spc-import.test.ts).
//   samples    only the REFERENCED ones (song → instrument rows → SRCNs →
//              $3C00 directory → BRR runs), and only where the .spc's bytes
//              differ from the import target set's baseline — a pure
//              re-import carries nothing; a hack's song with custom samples
//              carries exactly its own samples.
//
// The output is an UploadStream module in the retail shape ($3D00, $3FE8,
// [dir diffs], [sample diffs], sequence ranges, $FF90 slot patches) that can
// replace one of the 12 song-module blobs, or be applied over a baseline for
// an in-editor preview .spc.

import { serializeUploadStream, type UploadStream, type UploadBlock } from './upload-stream.ts';
import { decodeSong, type DecodedSong } from './sequence.ts';
import { ARAM_SIZE, applyUploadStream, aramWord, composeSettingAram, songSlotPtr } from './aram.ts';
import { SONG_TABLE_BASE, type AudioCatalog } from './catalog.ts';
import { buildSpcFile, findBootPortClearSites, patchBootPortClear, type SpcTags } from './spc.ts';

// ── .spc file parsing ────────────────────────────────────────────────────────

export interface ParsedSpcFile {
  /** 64 KB ARAM image (a copy — safe to keep/mutate). */
  aram: Uint8Array;
  /** 128 DSP registers. */
  dsp: Uint8Array;
  /** ID666 text title/game, when present and printable. */
  title: string | null;
  game: string | null;
}

const SPC_MAGIC = 'SNES-SPC700 Sound File Data';

function readAscii(bytes: Uint8Array, offset: number, len: number): string | null {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = bytes[offset + i];
    if (c === 0) break;
    if (c < 0x20 || c >= 0x7f) return s.length ? s.trim() || null : null;
    s += String.fromCharCode(c);
  }
  const t = s.trim();
  return t.length ? t : null;
}

/** Parse + validate an .spc file (v0.30 layout: ARAM @ 0x100, DSP @ 0x10100). */
export function parseSpcFile(bytes: Uint8Array): ParsedSpcFile {
  if (bytes.length < 0x10180) {
    throw new Error(`not an .spc file: ${bytes.length} bytes (need at least 0x10180)`);
  }
  for (let i = 0; i < SPC_MAGIC.length; i++) {
    if (bytes[i] !== SPC_MAGIC.charCodeAt(i)) throw new Error('not an .spc file: bad header magic');
  }
  return {
    aram: bytes.slice(0x100, 0x100 + ARAM_SIZE),
    dsp: bytes.slice(0x10100, 0x10180),
    title: readAscii(bytes, 0x2e, 32),
    game: readAscii(bytes, 0x4e, 32),
  };
}

// ── driver verification ──────────────────────────────────────────────────────

export interface DriverCheck {
  /** True when the driver code at $0400 is byte-identical to ours (modulo
   *  the synthesized-SPC boot port-clear patch — see spc.ts). */
  ok: boolean;
  /** Per-code-region byte agreement, for diagnostics. */
  regions: Array<{ dest: number; matched: number; total: number }>;
}

/** The engine-stream blocks that are CODE (never touched by music sets):
 *  the driver at $0400, the SFX block at $0EB0, the SFX set-instrument
 *  handler at $3E20 and the remap-chain table at $3EBB. Only $0400 gates
 *  `ok` — a hack with edited SFX still imports songs fine. */
const DRIVER_CODE_DESTS = new Set([0x0400, 0x0eb0, 0x3e20, 0x3ebb]);

export function verifyYiDriverAram(aram: Uint8Array, engineStream: UploadStream): DriverCheck {
  const regions: DriverCheck['regions'] = [];
  let ok = false;
  for (const b of engineStream.blocks) {
    if (!DRIVER_CODE_DESTS.has(b.dest)) continue;
    // Our synthesized .spcs patch the boot's port-clearing MOV A,#$F0 → #$00
    // (spc.ts patchBootPortClear); accept either value at that immediate.
    let skipAddr = -1;
    if (b.dest === 0x0400) {
      const sites = findBootPortClearSites(b.data);
      if (sites.length > 0) skipAddr = b.dest + sites[0] + 1;
    }
    let matched = 0;
    for (let i = 0; i < b.data.length; i++) {
      const addr = b.dest + i;
      if (addr === skipAddr ? (aram[addr] === 0x00 || aram[addr] === 0xf0) : aram[addr] === b.data[i]) matched++;
    }
    regions.push({ dest: b.dest, matched, total: b.data.length });
    if (b.dest === 0x0400) ok = matched === b.data.length;
  }
  return { ok, regions };
}

// ── candidate songs ──────────────────────────────────────────────────────────

export interface SpcSongCandidate {
  /** 1-based $FF8E+2n slot. */
  slot: number;
  ptr: number;
  /** Decodes cleanly AND has at least one audible event. */
  ok: boolean;
  error?: string;
  /** Another listed slot shares this pointer (retail immediate-variants). */
  aliasOf?: number;
  noteEvents: number;
  patterns: number;
  /** Total reachable sequence bytes. */
  seqBytes: number;
  /** Instrument-table rows the song selects (of the 48-row table; retail
   *  modules upload 28 — the import carries the whole 28-row table). */
  instrumentRows: number;
}

/** Enumerate the .spc's populated song slots with a decode health check —
 *  garbage pointers (stale table leftovers in a captured snapshot) decode
 *  empty or throw, and are reported not-ok. */
export function findSpcSongCandidates(aram: Uint8Array): SpcSongCandidate[] {
  const out: SpcSongCandidate[] = [];
  const seen = new Map<number, number>(); // ptr → first slot
  for (let slot = 1; slot <= 0x14; slot++) {
    const ptr = songSlotPtr(aram, slot);
    if (ptr === 0) continue;
    const alias = seen.get(ptr);
    if (alias === undefined) seen.set(ptr, slot);
    try {
      const song = decodeSong(aram, ptr);
      let noteEvents = 0;
      for (const t of song.tracks.values()) {
        for (const ev of t.events) if (ev.kind === 'note' || ev.kind === 'perc') noteEvents++;
      }
      const seqBytes = mergeRanges(songRanges(song)).reduce((n, r) => n + (r.end - r.start), 0);
      out.push({
        slot, ptr, aliasOf: alias,
        ok: noteEvents > 0 && song.patterns.size > 0,
        noteEvents, patterns: song.patterns.size, seqBytes,
        instrumentRows: usedInstrumentRows(song, []).length,
      });
    } catch (e) {
      out.push({ slot, ptr, aliasOf: alias, ok: false, error: (e as Error).message, noteEvents: 0, patterns: 0, seqBytes: 0, instrumentRows: 0 });
    }
  }
  return out;
}

// ── sequence extent ──────────────────────────────────────────────────────────

interface ByteRange { start: number; end: number }

/** Coalesce ranges, merging gaps ≤ 512 bytes (retail songs are contiguous;
 *  small holes are cheaper carried than split — the bytes are re-uploaded to
 *  their own addresses either way). Distant clusters (worldmap's $264C overflow
 *  vs its $D000 body) stay separate blocks. */
const MERGE_GAP = 512;

function mergeRanges(ranges: ByteRange[]): ByteRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: ByteRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + MERGE_GAP) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Byte ranges of everything a decoded song reaches: the part list itself,
 *  each pattern's 8 track words, every track and subroutine body. */
function songRanges(song: DecodedSong): ByteRange[] {
  const ranges: ByteRange[] = [];
  let partBytes = 0;
  for (const p of song.parts) partBytes += p.kind === 'loop' ? 4 : 2;
  ranges.push({ start: song.songAddr, end: song.songAddr + partBytes });
  for (const pat of song.patterns.values()) ranges.push({ start: pat.addr, end: pat.addr + 16 });
  for (const t of song.tracks.values()) ranges.push({ start: t.addr, end: t.addr + t.byteLength });
  return ranges;
}

// ── instrument / sample reachability ─────────────────────────────────────────

const INSTRUMENT_TABLE = 0x3d00;
const INSTRUMENT_TABLE_LEN = 168; // 28 records — what retail song modules carry
const GATE_VELOCITY_TABLE = 0x3fe8;
const GATE_VELOCITY_LEN = 24;
const SAMPLE_DIR = 0x3c00;

/** Instrument rows a song can select (CODE_voice_set_instrument): E0 args
 *  (<$80 → row = id; ≥$80 → row = id-$CA+percBase) and percussion notes
 *  (row = index + percBase). percBase values = every FA arg seen (plus 0
 *  when percussion appears with no FA anywhere — boot zeroes $5F). */
function usedInstrumentRows(song: DecodedSong, warnings: string[]): number[] {
  const e0Ids = new Set<number>();
  const bases = new Set<number>();
  const percIndexes = new Set<number>();
  for (const t of song.tracks.values()) {
    for (const ev of t.events) {
      if (ev.kind === 'vcmd' && ev.op === 0xe0) e0Ids.add(ev.args[0]);
      else if (ev.kind === 'vcmd' && ev.op === 0xfa) bases.add(ev.args[0]);
      else if (ev.kind === 'perc') percIndexes.add(ev.index);
    }
  }
  if (percIndexes.size > 0 && bases.size === 0) {
    warnings.push('percussion used with no percussionBase vcmd — assuming base 0');
    bases.add(0);
  }
  const rows = new Set<number>();
  const addRow = (row: number, what: string): void => {
    if (row < 0 || row >= INSTRUMENT_TABLE_LEN / 6) {
      warnings.push(`${what} resolves to instrument row ${row} (outside the 28-record table) — not carried`);
      return;
    }
    rows.add(row);
  };
  for (const id of e0Ids) {
    if (id < 0x80) addRow(id, `setInstrument 0x${id.toString(16)}`);
    else for (const base of bases.size ? bases : [0]) addRow(id - 0xca + base, `setInstrument 0x${id.toString(16)}`);
  }
  for (const index of percIndexes) {
    for (const base of bases) addRow(index + base, `percussion note ${index}`);
  }
  return [...rows].sort((a, b) => a - b);
}

/** Scan a BRR run from `start` to its end-flag block (inclusive). Returns the
 *  byte length, or null when the run walks out of ARAM. */
function brrRunLength(aram: Uint8Array, start: number): number | null {
  let p = start;
  for (;;) {
    if (p + 9 > ARAM_SIZE) return null;
    const header = aram[p];
    p += 9;
    if (header & 0x01) return p - start;
  }
}

// ── extraction ───────────────────────────────────────────────────────────────

export interface SlotMapping {
  /** Slot to read from the source .spc's $FF8E table. */
  sourceSlot: number;
  /** Slot the emitted module patches. Retail-shaped replacements patch every
   *  slot the module being replaced patched (stale slots hang the driver). */
  targetSlot: number;
}

export interface CarriedSample {
  srcn: number;
  aramStart: number;
  byteLength: number;
  /** True when the $3C00 directory entry differed too (start/loop moved). */
  dirChanged: boolean;
}

export interface ExtractedSongModule {
  stream: UploadStream;
  /** Serialized upload-stream module (the overlay .bin payload). */
  bytes: Uint8Array;
  /** Per-source-slot decoded song addresses (slot → ARAM ptr). */
  songAddrs: Map<number, number>;
  seqRanges: ByteRange[];
  instrumentRows: number[];
  /** Referenced SRCNs (noise instruments excluded). */
  srcns: number[];
  carriedSamples: CarriedSample[];
  warnings: string[];
}

/**
 * Extract song(s) from a YI-driver ARAM image into a replacement song module.
 *
 * `baseline` is the import TARGET's composed ARAM without the module being
 * replaced (composeSettingAram with `excludeBlockId`) — the diff reference
 * that decides which referenced sample/directory bytes must ride along in
 * the module.
 */
export function extractSongModule(
  sourceAram: Uint8Array,
  mappings: SlotMapping[],
  baseline: Uint8Array,
): ExtractedSongModule {
  if (sourceAram.length !== ARAM_SIZE || baseline.length !== ARAM_SIZE) {
    throw new Error('ARAM images must be 64 KB');
  }
  if (mappings.length === 0) throw new Error('no slot mappings given');
  const warnings: string[] = [];

  // Decode each distinct source slot once.
  const songs = new Map<number, DecodedSong>();
  const songAddrs = new Map<number, number>();
  for (const m of mappings) {
    if (songs.has(m.sourceSlot)) continue;
    const ptr = songSlotPtr(sourceAram, m.sourceSlot);
    if (ptr === 0) throw new Error(`source slot 0x${m.sourceSlot.toString(16)} is empty`);
    songs.set(m.sourceSlot, decodeSong(sourceAram, ptr));
    songAddrs.set(m.sourceSlot, ptr);
  }

  // Echo-delay ceiling: the buffer grows down from $3C00 in 2 KB steps, and
  // EDL 2 already bottoms at $2C00 — EDL ≥ 3 overlaps the accumulation-
  // resident jingle sequences at $264C (death/goal/game-over, played
  // in-level) and crashes the driver when one fires (community-pinned; AMY
  // beta docs). The vcmd rides the import verbatim, so warn here.
  for (const [slot, song] of songs) {
    const highEdls = new Set<number>();
    for (const t of song.tracks.values()) {
      for (const ev of t.events) {
        if (ev.kind === 'vcmd' && ev.op === 0xf7 && ev.args[0] > 2) highEdls.add(ev.args[0]);
      }
    }
    for (const edl of [...highEdls].sort((a, b) => a - b)) {
      warnings.push(
        `slot 0x${slot.toString(16)} sets echo delay ${edl} (max safe 2) — the echo buffer would overlap the resident jingle region at $264C and can crash in-game when a jingle plays`
      );
    }
  }

  // Sequence extent = union of every extracted song's reachable ranges.
  const seqRanges = mergeRanges([...songs.values()].flatMap(songRanges));
  for (const r of seqRanges) {
    if (r.start < 0x2000 || (r.start < 0x4000 && r.end > 0x3c00) || r.end > SONG_TABLE_BASE) {
      throw new Error(
        `sequence range $${r.start.toString(16)}..$${r.end.toString(16)} overlaps engine/table/pointer space — not a song?`
      );
    }
    if (r.start < 0xc000 && r.end > 0x4000) {
      warnings.push(
        `sequence range $${r.start.toString(16)}..$${r.end.toString(16)} sits in sample territory ($4000+) — verify the target set leaves it free`
      );
    }
  }

  // Instrument rows → SRCNs → referenced sample runs; carry what differs
  // from the baseline.
  const rows = [...new Set([...songs.values()].flatMap((s) => usedInstrumentRows(s, warnings)))].sort((a, b) => a - b);
  const srcns = new Set<number>();
  for (const row of rows) {
    const rec = INSTRUMENT_TABLE + row * 6;
    const b0 = sourceAram[rec];
    if (b0 & 0x80) continue; // noise instrument — no sample
    if (b0 * 4 >= 0x100) {
      warnings.push(`instrument row ${row} has SRCN 0x${b0.toString(16)} beyond the $3C00 directory page — sample not carried`);
      continue;
    }
    srcns.add(b0);
  }

  const dirDiffSrcns: number[] = [];
  const sampleRanges: ByteRange[] = [];
  const carriedSamples: CarriedSample[] = [];
  for (const srcn of [...srcns].sort((a, b) => a - b)) {
    const dir = SAMPLE_DIR + srcn * 4;
    let dirChanged = false;
    for (let i = 0; i < 4; i++) if (sourceAram[dir + i] !== baseline[dir + i]) dirChanged = true;
    const start = aramWord(sourceAram, dir);
    const len = brrRunLength(sourceAram, start);
    if (len === null) {
      warnings.push(`SRCN 0x${srcn.toString(16)}: BRR run at $${start.toString(16)} never ends — sample not carried`);
      continue;
    }
    let sampleChanged = false;
    for (let i = 0; i < len; i++) {
      if (sourceAram[start + i] !== baseline[start + i]) { sampleChanged = true; break; }
    }
    if (dirChanged) dirDiffSrcns.push(srcn);
    if (sampleChanged) sampleRanges.push({ start, end: start + len });
    if (dirChanged || sampleChanged) {
      carriedSamples.push({ srcn, aramStart: start, byteLength: len, dirChanged });
    }
  }

  // Assemble in the retail block order: instruments, gate/velocity tables,
  // directory diffs, sample diffs, sequence ranges, slot patches.
  const blocks: UploadBlock[] = [
    { dest: INSTRUMENT_TABLE, data: sourceAram.subarray(INSTRUMENT_TABLE, INSTRUMENT_TABLE + INSTRUMENT_TABLE_LEN) },
    { dest: GATE_VELOCITY_TABLE, data: sourceAram.subarray(GATE_VELOCITY_TABLE, GATE_VELOCITY_TABLE + GATE_VELOCITY_LEN) },
  ];
  for (const run of contiguousRuns(dirDiffSrcns)) {
    const dest = SAMPLE_DIR + run[0] * 4;
    blocks.push({ dest, data: sourceAram.subarray(dest, dest + run.length * 4) });
  }
  for (const r of mergeRanges(sampleRanges)) {
    blocks.push({ dest: r.start, data: sourceAram.subarray(r.start, r.end) });
  }
  for (const r of seqRanges) {
    blocks.push({ dest: r.start, data: sourceAram.subarray(r.start, r.end) });
  }
  const slotPtrs = new Map<number, number>();
  for (const m of mappings) {
    if (slotPtrs.has(m.targetSlot)) throw new Error(`target slot 0x${m.targetSlot.toString(16)} mapped twice`);
    slotPtrs.set(m.targetSlot, songAddrs.get(m.sourceSlot)!);
  }
  blocks.push(...slotPatchBlocks(slotPtrs));

  const stream: UploadStream = { blocks, entry: 0x0400 };
  return {
    stream,
    bytes: serializeUploadStream(stream),
    songAddrs,
    seqRanges,
    instrumentRows: rows,
    srcns: [...srcns].sort((a, b) => a - b),
    carriedSamples,
    warnings,
  };
}

/** Split a sorted id list into runs of consecutive ids. */
function contiguousRuns(sorted: number[]): number[][] {
  const runs: number[][] = [];
  for (const v of sorted) {
    const last = runs[runs.length - 1];
    if (last && v === last[last.length - 1] + 1) last.push(v);
    else runs.push([v]);
  }
  return runs;
}

/** $FF8E-table patch blocks for the given slot → ptr map, coalescing
 *  consecutive slots into one block (the retail shape: $FF90+2, $FFA0+4…). */
function slotPatchBlocks(slotPtrs: Map<number, number>): UploadBlock[] {
  const slots = [...slotPtrs.keys()].sort((a, b) => a - b);
  for (const s of slots) {
    if (s < 1 || s > 0x14) throw new Error(`song slot 0x${s.toString(16)} out of range 0x01-0x14`);
  }
  return contiguousRuns(slots).map((run) => {
    const data = new Uint8Array(run.length * 2);
    run.forEach((slot, i) => {
      const ptr = slotPtrs.get(slot)!;
      data[i * 2] = ptr & 0xff;
      data[i * 2 + 1] = (ptr >> 8) & 0xff;
    });
    return { dest: SONG_TABLE_BASE + run[0] * 2, data };
  });
}

// ── preview composition ──────────────────────────────────────────────────────

/** Synthesize a playable preview .spc: target setting's baseline minus the
 *  replaced module, plus the imported module, booted on `playSlot`. */
export function synthesizeImportPreviewSpc(
  rom: Uint8Array,
  catalog: AudioCatalog,
  setting: number,
  excludeBlockId: number | null,
  module: UploadStream,
  playSlot: number,
  tags: SpcTags = {},
): Uint8Array {
  const { aram, entry } = composeSettingAram(rom, catalog, setting, excludeBlockId);
  applyUploadStream(aram, module);
  const ptr = songSlotPtr(aram, playSlot);
  if (ptr === 0) throw new Error(`slot 0x${playSlot.toString(16)} is empty after applying the module`);
  patchBootPortClear(aram);
  aram[0xf4] = playSlot;
  return buildSpcFile(aram, { pc: entry }, { game: "Yoshi's Island", lengthSeconds: 180, fadeMs: 8000, ...tags });
}
