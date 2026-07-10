// MML module assembler — lays a CompiledMml out in ARAM and serializes it as
// a YI upload-stream song module (the same shape the .spc import writes:
// overlay blob + $FF90 slot patches, ready for the build's re-layout pass and
// the preview composer).
//
// ARAM layout (v1 — the conservative budget model from the plan's §1.11
// addendum; aggressive reclaim of music-only global samples comes later):
//   $3C60+          custom sample directory entries (≤ 40 slots, SRCN $18+)
//   $B960-$CFFF     custom BRR data (the add-on window — 5,792 bytes)
//   $3D00+          instrument table (≤ 48 rows)
//   $D000-$FF8D     part list + patterns + tracks + subroutines (12,174 B)
//   $FF8E+2n        song-pointer patches for every target slot
// Sequence data must stay OUT of $264C-$2C00 (accumulation-resident jingles)
// — trivially true at $D000+.
//
// The bare $B960 window above is only sound when NOTHING resident owns it.
// In practice every music set's sample bank covers some of it (add-ons
// append at $B960; Bowser's bank starts at $A480; Ending's replaces the
// whole bank), the bank's dir entries own the $3C00 page after the global
// bank's 24, and the game's positional-diff upload never re-sends an
// unchanged bank — so clobbering either persists into the module's other
// songs AND into sibling sets sharing the bank. Callers therefore pass the
// set's resident sample banks as `layoutBase` (dodge-only blocks); the
// layout then first-fits seq + samples around them and starts custom dir
// slots after theirs. audio.ts's buildSongImportModule always does this.

import type { CompiledMml, MmlSample, MmlInstrumentRow } from './mml-compile.ts';
import type { TrackEvent } from './sequence.ts';
import { encodeTrack } from './sequence-encode.ts';
import { serializeUploadStream, type UploadStream } from './upload-stream.ts';
import { ECHO_BUFFER_REGION, ENGINE_TAIL_REGION, SONG_TABLE_BASE } from './catalog.ts';
import { decodeBrr } from './brr.ts';
import { encodeBrr } from './brr-encode.ts';

export const MML_SEQ_BASE = 0xd000;
export const MML_SAMPLE_DIR_BASE = 0x3c60;
export const MML_SAMPLE_DATA_BASE = 0xb960;
export const MML_SAMPLE_DATA_LIMIT = 0xd000;
export const MML_INSTRUMENT_BASE = 0x3d00;

/** Placement windows an import's sequence + sample data may claim: the
 *  engine-tail gap ($230E-$264B, truncated by the target's echo-delay
 *  ceiling — the EDL-n buffer floor is $3C00 − n·$800) ahead of the main
 *  $B960-$FF8D span. Both the module builder and aram-usage's import
 *  budgets place into these (dodging resident blocks).
 *
 *  `claimEchoRegion` (the "No echo" option, ECHO_BUFFER_REGION): the caller
 *  has verified every song playable in the module's context is echo-free —
 *  the $2C00-$3C00 retail echo buffer joins the windows and no echo delay
 *  exists, so the tail runs full. */
export function importPlacementWindows(
  echoDelayLimit = 2,
  mainBase: number = MML_SAMPLE_DATA_BASE,
  claimEchoRegion = false
): { base: number; limit: number }[] {
  const ceiling = claimEchoRegion ? 0 : Math.min(3, Math.max(0, echoDelayLimit));
  const tailLimit = Math.min(ENGINE_TAIL_REGION.end, 0x3c00 - ceiling * 0x800);
  return [
    ...(tailLimit > ENGINE_TAIL_REGION.start ? [{ base: ENGINE_TAIL_REGION.start, limit: tailLimit }] : []),
    ...(claimEchoRegion ? [{ base: ECHO_BUFFER_REGION.start, limit: ECHO_BUFFER_REGION.end }] : []),
    { base: mainBase, limit: SONG_TABLE_BASE },
  ];
}

export class MmlModuleError extends Error {
  /** Which budget failed — import fallbacks pick their remedy by kind
   *  (seq → drop light-staccato ties; samples → drop substitute samples). */
  readonly kind: 'seq' | 'samples' | 'structural';
  constructor(message: string, kind: 'seq' | 'samples' | 'structural' = 'structural') {
    super(message);
    this.kind = kind;
  }
}

export interface BuiltMmlModule {
  stream: UploadStream;
  /** Serialized module (the overlay .bin payload). */
  bytes: Uint8Array;
  songAddr: number;
  seqBytes: number;
  sampleBytes: number;
  instrumentBytes: number;
  warnings: string[];
}

/** Halve a BRR sample's rate: decode, average sample pairs, re-encode.
 *  The playback multiplier must be HALVED by the caller to keep pitch
 *  (half the samples per period at the same step = double frequency).
 *  Loop point snaps to the 16-sample block grid (≤ 8-sample drift). */
function downsampleBrr(s: MmlSample): MmlSample {
  const dec = decodeBrr(s.data);
  const half = new Int16Array(Math.ceil(dec.pcm.length / 2));
  for (let i = 0; i < half.length; i++) {
    const a = dec.pcm[2 * i];
    const b = dec.pcm[2 * i + 1] ?? a;
    half[i] = (a + b) >> 1;
  }
  const loopSample = (s.loopOffset / 9) * 16;
  const loopBlocks = Math.min(
    Math.max(0, Math.round(loopSample / 2 / 16)),
    Math.max(0, Math.ceil(half.length / 16) - 1)
  );
  return {
    name: s.name,
    data: encodeBrr(half, { loop: dec.loops }),
    loopOffset: loopBlocks * 9,
  };
}

/** Replace $EF subroutine-id placeholder args with real ARAM addresses.
 *  Events are cloned — the CompiledMml stays reusable. */
function resolveTrack(events: TrackEvent[], subAddrs: Map<number, number>): TrackEvent[] {
  return events.map((ev) => {
    if (ev.kind !== 'vcmd' || ev.op !== 0xef) return ev;
    const id = ev.args[0] | (ev.args[1] << 8);
    const addr = subAddrs.get(id);
    if (addr === undefined) throw new MmlModuleError(`unresolved subroutine id ${id}`);
    return { ...ev, args: [addr & 0xff, addr >> 8, ev.args[2]] };
  });
}

export interface BuildMmlModuleOptions {
  /** Halve oversized samples (max ×4 each, pitch compensated) until the
   *  budget closes (default true). Off = a hard budget error instead. */
  downsampleToFit?: boolean;
  /** Slot-targeted merge: the target module's CURRENT upload stream. The
   *  built module keeps every base block (the other slots' songs keep
   *  playing) and lays the new song out in the leftover space — instrument
   *  rows append after the base table (setInstrument/percussionBase args
   *  shift), custom dir slots continue after the base's, and seq + samples
   *  first-fit into the gaps the base leaves in $B960-$FF8D. targetSlots
   *  should then name only the slot(s) being replaced. */
  base?: UploadStream;
  /** Layout-only merge context: blocks the new song must dodge (same
   *  row/dir/gap math as `base`) but that are NOT copied into the output —
   *  another module uploads them itself. Two users: the title import passes
   *  the driver's stream (the driver stays untouched, our module rides
   *  alongside), and every song-module import passes the target set's
   *  resident sample banks (see the header — clobbering a bank's window or
   *  dir entries persists across sets) plus, on level-set targets, the
   *  MAP_RESIDENT_SEQ_REGION reservation. Composes with `base` (a previous
   *  title import's blocks are embedded AND dodged; dodge-only otherwise). */
  layoutBase?: UploadStream;
  /** Echo-delay ceiling of the import target (default 2; 3 for jingle-free
   *  targets) — truncates the engine-tail placement window, since an EDL-3
   *  echo buffer reaches down to $2400. */
  echoDelayLimit?: number;
  /** Claim the $2C00-$3C00 retail echo buffer as a placement window (the
   *  "No echo" option). ONLY pass true after verifying the compiled song
   *  carries no $F5 (stripEchoVcmds) AND every other song playable in the
   *  module's context is echo-free (moduleSongsUseEcho over the merge
   *  base) — one played $F5 lets the DSP overwrite the region. */
  claimEchoRegion?: boolean;
}

// ── import layers ────────────────────────────────────────────────────────────
// A merged module's block list is [immutable base][layer per imported slot]
// (the base = the retail embed for song modules, empty for title imports).
// The importer records each layer's starting block index; re-importing a
// slot DROPS its old layer from the merge base instead of embedding it —
// without this, every re-import would accrete the previous import's
// orphaned sequence + samples and eat the ARAM budget.

export interface ModuleImportLayer {
  /** Song slot the layer's import repointed. */
  slot: number;
  /** Index of the layer's first block in the composed module's block list. */
  firstBlock: number;
}

/** Decompose a composed module's blocks into the base + per-slot layers,
 *  dropping the layer(s) for `dropSlot` (the slot being re-imported). */
export function sliceModuleLayers(
  blocks: UploadStream['blocks'],
  layers: readonly ModuleImportLayer[],
  dropSlot: number
): { baseBlocks: UploadStream['blocks']; kept: { slot: number; blocks: UploadStream['blocks'] }[] } {
  const sorted = [...layers].sort((a, b) => a.firstBlock - b.firstBlock);
  for (const l of sorted) {
    if (l.firstBlock < 0 || l.firstBlock > blocks.length) {
      throw new MmlModuleError(`import layer for slot ${l.slot} points outside the module (block ${l.firstBlock} of ${blocks.length})`);
    }
  }
  const bounds = [...sorted.map((l) => l.firstBlock), blocks.length];
  return {
    baseBlocks: blocks.slice(0, bounds[0]),
    kept: sorted
      .map((l, i) => ({ slot: l.slot, blocks: blocks.slice(bounds[i], bounds[i + 1]) }))
      .filter((l) => l.slot !== dropSlot),
  };
}

/** Free intervals of [windowStart, windowEnd) not covered by `blocks`.
 *  Exported for aram-usage.ts's import-budget view (same gap math the
 *  merge layout below places into). */
export function freeAramGaps(
  windowStart: number,
  windowEnd: number,
  blocks: UploadStream['blocks']
): { base: number; limit: number }[] {
  const occ = blocks
    .map((b) => [b.dest, b.dest + b.data.length] as const)
    .filter(([s, e]) => e > windowStart && s < windowEnd)
    .sort((a, b) => a[0] - b[0]);
  const gaps: { base: number; limit: number }[] = [];
  let cur = windowStart;
  for (const [s, e] of occ) {
    if (s > cur) gaps.push({ base: cur, limit: Math.min(s, windowEnd) });
    cur = Math.max(cur, Math.min(e, windowEnd));
  }
  if (cur < windowEnd) gaps.push({ base: cur, limit: windowEnd });
  return gaps;
}

/** Merge-layout bases claimed by a set of upload blocks: `rowBase` = $3D00
 *  instrument rows already occupied (a merged song's rows append after),
 *  `srcnBase` = first free $3C00 directory slot after theirs. Shared by the
 *  merge path below and aram-usage.ts's import-budget view. */
export function mergeLayoutBases(blocks: UploadStream['blocks']): { rowBase: number; srcnBase: number } {
  let rowBase = 0;
  let srcnBase = 0;
  for (const b of blocks) {
    const end = b.dest + b.data.length;
    if (b.dest < 0x3e20 && end > MML_INSTRUMENT_BASE) {
      rowBase = Math.max(rowBase, Math.ceil((Math.min(end, 0x3e20) - MML_INSTRUMENT_BASE) / 6));
    }
    if (b.dest < MML_INSTRUMENT_BASE && end > 0x3c00) {
      srcnBase = Math.max(srcnBase, Math.ceil((Math.min(end, MML_INSTRUMENT_BASE) - 0x3c00) / 4));
    }
  }
  return { rowBase, srcnBase };
}

export function buildMmlModule(compiled: CompiledMml, targetSlots: number[], opts: BuildMmlModuleOptions = {}): BuiltMmlModule {
  const downsampleToFit = opts.downsampleToFit ?? true;
  const base = opts.base ?? null;
  /** Blocks the new song's layout must dodge (embedded base + layout-only). */
  const mergeBlocks = [...(opts.layoutBase?.blocks ?? []), ...(base?.blocks ?? [])];
  const mergeMode = mergeBlocks.length > 0 || base !== null || opts.layoutBase !== undefined;
  if (targetSlots.length === 0) throw new MmlModuleError('no target song slots given');
  const warnings: string[] = [];

  // ── merge-mode layout parameters from the base module ─────────────────────
  // rowBase = rows the base's $3D00 table already occupies (ours append
  // after, and every setInstrument arg shifts); srcnBase = first custom dir
  // slot after the base's own entries.
  let rowBase = 0;
  let srcnBase = compiled.sampleSrcnBase;
  if (mergeMode) {
    const bases = mergeLayoutBases(mergeBlocks);
    rowBase = bases.rowBase;
    srcnBase = Math.max(srcnBase, bases.srcnBase);
    if (rowBase + compiled.instrumentRows.length > 48) {
      throw new MmlModuleError(
        `instrument table full: the set's songs already use ${rowBase} of the 48 rows and this song needs ${compiled.instrumentRows.length} more — replace the entire set instead`
      );
    }
    if (srcnBase + compiled.dirEntries.length > 0x40) {
      throw new MmlModuleError(
        `sample directory full: slots $${srcnBase.toString(16)}+ needed for ${compiled.dirEntries.length} custom samples, but the page ends at $3F — fewer samples, or replace the entire set`,
        'samples'
      );
    }
  }

  /** Shift instrument-row references for the merge append (identity when
   *  rowBase = 0). $E0 = setInstrument, $FA = percussionBase — both name a
   *  $3D00 row index. */
  const shiftRows = (events: TrackEvent[]): TrackEvent[] =>
    rowBase === 0
      ? events
      : events.map((ev) =>
          ev.kind === 'vcmd' && (ev.op === 0xe0 || ev.op === 0xfa)
            ? { ...ev, args: [ev.args[0] + rowBase, ...ev.args.slice(1)] }
            : ev
        );
  const trackEventsIn = compiled.trackEvents.map(shiftRows);
  const subEventsIn = compiled.subEvents.map((b) => (b ? shiftRows(b) : b));

  // ── sequence layout ────────────────────────────────────────────────────────
  // Order: part list, patterns, tracks (first-use order), subroutines
  // (deduped by encoded content). Track byte lengths are fixup-independent
  // ($EF args are 3 bytes either way), so sizes come from a placeholder
  // encode and the real encode happens once addresses are known.

  const partListBytes = compiled.parts.length * 2 + (compiled.loopPartIndex !== null ? 4 : 0) + 2;
  const usedTracks: number[] = [];
  for (const pat of compiled.patterns) {
    for (const t of pat) {
      if (t >= 0 && !usedTracks.includes(t) && (trackEventsIn[t]?.length ?? 0) > 0) usedTracks.push(t);
    }
  }
  if (usedTracks.length === 0) throw new MmlModuleError('no non-empty tracks referenced by the patterns');

  // #N=continue chains: members lay out contiguously, terminator only after
  // the last — a continuation track's address points mid-stream, exactly the
  // retail conductor/window shape. Resolve each track's chain successor and
  // make sure every member (even pattern-unreferenced heads) gets laid out.
  const chainNext = new Map<number, number>();
  for (const { track, prev } of compiled.continuations) {
    if (chainNext.has(prev)) throw new MmlModuleError(`track ${prev} is continued by two tracks`);
    chainNext.set(prev, track);
  }
  const chainPrev = new Map<number, number>();
  for (const [prev, track] of chainNext) chainPrev.set(track, prev);
  for (const t of [...usedTracks]) {
    for (let p = chainPrev.get(t); p !== undefined; p = chainPrev.get(p)) {
      if (!usedTracks.includes(p)) usedTracks.push(p);
    }
    for (let s = chainNext.get(t); s !== undefined; s = chainNext.get(s)) {
      if (!usedTracks.includes(s)) usedTracks.push(s);
    }
  }

  const usedSubs: number[] = [];
  for (const t of usedTracks) {
    for (const ev of trackEventsIn[t]) {
      if (ev.kind === 'vcmd' && ev.op === 0xef) {
        const id = ev.args[0] | (ev.args[1] << 8);
        if (!usedSubs.includes(id)) usedSubs.push(id);
      }
    }
  }

  // Chain members drop their $00 terminator except the last (encodeTrack
  // always appends exactly one).
  const trackSizes = new Map<number, number>();
  for (const t of usedTracks) {
    const full = encodeTrack(trackEventsIn[t]).length;
    trackSizes.set(t, chainNext.has(t) ? full - 1 : full);
  }

  // Dedupe subroutine bodies by encoded content.
  const subBytes = new Map<number, Uint8Array>();
  const subCanonical = new Map<number, number>(); // id → canonical id
  const byContent = new Map<string, number>();
  for (const id of usedSubs) {
    const body = subEventsIn[id];
    if (!body) throw new MmlModuleError(`subroutine ${id} missing from the compile output`);
    const bytes = encodeTrack(body);
    const key = bytes.join(',');
    const canon = byContent.get(key);
    if (canon !== undefined) {
      subCanonical.set(id, canon);
    } else {
      byContent.set(key, id);
      subCanonical.set(id, id);
      subBytes.set(id, bytes);
    }
  }

  // Lay out at $D000 first; merge mode relocates the whole image into the
  // first free gap afterwards (addresses shift uniformly — sizes don't).
  let songAddr = MML_SEQ_BASE;
  let patternBase = songAddr + partListBytes;
  const trackBase = patternBase + compiled.patterns.length * 16;
  let cursor = trackBase;
  const trackAddrs = new Map<number, number>();
  const layoutOrder: number[] = [];
  for (const t of usedTracks) {
    if (trackAddrs.has(t)) continue;
    // Walk to the chain head, then lay the whole chain contiguously.
    let head = t;
    while (chainPrev.has(head)) head = chainPrev.get(head)!;
    for (let m: number | undefined = head; m !== undefined; m = chainNext.get(m)) {
      if (trackAddrs.has(m)) continue;
      trackAddrs.set(m, cursor);
      layoutOrder.push(m);
      cursor += trackSizes.get(m) ?? (() => {
        // chain member that wasn't in usedTracks sizing (empty events) —
        // size it now.
        const full = encodeTrack(trackEventsIn[m] ?? []).length;
        const sz = chainNext.has(m) ? full - 1 : full;
        trackSizes.set(m, sz);
        return sz;
      })();
    }
  }
  const subAddrs = new Map<number, number>();
  for (const [id, bytes] of subBytes) {
    subAddrs.set(id, cursor);
    cursor += bytes.length;
  }
  for (const [id, canon] of subCanonical) {
    if (id !== canon) subAddrs.set(id, subAddrs.get(canon)!);
  }

  let seqEnd = cursor;
  const seqBytes = seqEnd - songAddr;

  // Resident-grassland mode keeps the add-on bank's window and dir slots.
  const grassland = compiled.sampleSrcnBase !== 0x18;

  /** Placement windows (engine tail [+ claimed echo region] + main span),
   *  per the target's echo ceiling; grassland-resident mode cedes the $B960
   *  window to the bank. */
  const windows = importPlacementWindows(
    opts.echoDelayLimit,
    grassland ? MML_SEQ_BASE : MML_SAMPLE_DATA_BASE,
    opts.claimEchoRegion ?? false
  );

  /** Merge mode: the free ranges the base module leaves in the placement
   *  windows, minus whatever the sequence claims below. */
  let mergeGaps: { base: number; limit: number }[] | null = null;
  if (mergeMode) {
    mergeGaps = windows.flatMap((w) => freeAramGaps(w.base, w.limit, mergeBlocks));
    const gap = mergeGaps.find((g) => g.limit - g.base >= seqBytes);
    if (!gap) {
      const free = mergeGaps.map((g) => g.limit - g.base).reduce((a, b) => a + b, 0);
      throw new MmlModuleError(
        `sequence data is ${seqBytes} bytes — ${base ? "the module's existing songs and " : ''}the set's resident data leave ${free} free ` +
        `(largest gap ${mergeGaps.reduce((m, g) => Math.max(m, g.limit - g.base), 0)}). ` +
        `Shorten the song, use label loops for repeats, or ${base ? 'replace the entire set instead' : 'pick a roomier target set'}.`,
        'seq'
      );
    }
    const delta = gap.base - songAddr;
    if (delta !== 0) {
      songAddr += delta;
      patternBase += delta;
      seqEnd += delta;
      for (const [k, v] of trackAddrs) trackAddrs.set(k, v + delta);
      for (const [k, v] of subAddrs) subAddrs.set(k, v + delta);
    }
    // Claim the sequence's extent out of the gap list for sample placement.
    mergeGaps = mergeGaps.flatMap((g) => {
      if (g.limit <= songAddr || g.base >= seqEnd) return [g];
      const rest: { base: number; limit: number }[] = [];
      if (g.base < songAddr) rest.push({ base: g.base, limit: songAddr });
      if (g.limit > seqEnd) rest.push({ base: seqEnd, limit: g.limit });
      return rest;
    });
  } else {
    const seqBudget = SONG_TABLE_BASE - MML_SEQ_BASE;
    if (seqEnd > SONG_TABLE_BASE) {
      throw new MmlModuleError(
        `sequence data is ${seqBytes} bytes — over the ${seqBudget}-byte window ($D000-$FF8D). ` +
        `Shorten the song, use label loops for repeats, or reduce superloop counts (they unroll).`,
        'seq'
      );
    }
  }

  // ── emit the sequence image ───────────────────────────────────────────────
  const seq = new Uint8Array(seqBytes);
  const w16 = (off: number, v: number): void => {
    seq[off] = v & 0xff;
    seq[off + 1] = (v >> 8) & 0xff;
  };
  let off = 0;
  for (const p of compiled.parts) {
    w16(off, patternBase + p * 16);
    off += 2;
  }
  if (compiled.loopPartIndex !== null) {
    // Loop entry: count word ($FF = the retail forever-goto idiom) + the
    // ADDRESS OF THE PART-LIST ENTRY to jump to.
    w16(off, 0x00ff);
    w16(off + 2, songAddr + compiled.loopPartIndex * 2);
    off += 4;
  }
  w16(off, 0x0000); // end — keeps decoder walks (and paranoia) terminating
  off += 2;

  for (const pat of compiled.patterns) {
    for (let v = 0; v < 8; v++) {
      const t = pat[v] ?? -1;
      const addr = t >= 0 ? trackAddrs.get(t) : undefined;
      w16(off, addr ?? 0);
      off += 2;
    }
  }

  for (const t of layoutOrder) {
    const full = encodeTrack(resolveTrack(trackEventsIn[t] ?? [], subAddrs));
    const bytes = chainNext.has(t) ? full.subarray(0, full.length - 1) : full;
    seq.set(bytes, off);
    off += bytes.length;
  }
  for (const [, bytes] of subBytes) {
    seq.set(bytes, off);
    off += bytes.length;
  }
  if (off !== seqBytes) throw new MmlModuleError(`layout accounting bug: wrote ${off} of ${seqBytes} sequence bytes`);

  // ── samples ───────────────────────────────────────────────────────────────
  // Placement regions, first-fit per sample:
  //  - plain mode: the engine-tail window, then the add-on window
  //    ($B960-$CFFF; the replaced song was its only consumer), spilling into
  //    the sequence region's free tail;
  //  - resident-grassland mode (sampleSrcnBase $1C): the bank keeps its
  //    window AND its $18-$1B dir slots, so only the engine tail + sequence
  //    tail are free;
  //  - merge mode: whatever gaps the base module + our sequence leave.
  const plainTail = windows.length > 1 ? [windows[0]] : [];
  const makeRegions = (): { base: number; limit: number; cursor: number }[] =>
    mergeGaps
      ? mergeGaps.map((g) => ({ base: g.base, limit: g.limit, cursor: g.base }))
      : grassland
        ? [...plainTail.map((w) => ({ base: w.base, limit: w.limit, cursor: w.base })),
           { base: seqEnd, limit: SONG_TABLE_BASE, cursor: seqEnd }]
        : [
            ...plainTail.map((w) => ({ base: w.base, limit: w.limit, cursor: w.base })),
            { base: MML_SAMPLE_DATA_BASE, limit: MML_SAMPLE_DATA_LIMIT, cursor: MML_SAMPLE_DATA_BASE },
            { base: seqEnd, limit: SONG_TABLE_BASE, cursor: seqEnd },
          ];

  // First-fit placement, with automatic ×2 downsampling of the largest
  // samples (max twice each) when the budget doesn't close — pitch is
  // compensated by halving the referencing rows' multipliers.
  const samples = [...compiled.samples];
  const rows: MmlInstrumentRow[] = compiled.instrumentRows.map((r) => ({ ...r, bytes: [...r.bytes] as MmlInstrumentRow['bytes'] }));
  const halvings = new Map<number, number>();
  const MIN_DOWNSAMPLE_BYTES = 100;

  let regions = makeRegions();
  let sampleAddrs: number[] = [];
  let sampleBytes = 0;
  for (;;) {
    regions = makeRegions();
    sampleAddrs = [];
    sampleBytes = 0;
    let failed = false;
    for (const s of samples) {
      const region = regions.find((r) => r.cursor + s.data.length <= r.limit);
      if (!region) {
        failed = true;
        break;
      }
      sampleAddrs.push(region.cursor);
      region.cursor += s.data.length;
      sampleBytes += s.data.length;
    }
    if (!failed) break;

    let pick = -1;
    if (downsampleToFit) {
      for (let i = 0; i < samples.length; i++) {
        if ((halvings.get(i) ?? 0) >= 2 || samples[i].data.length < MIN_DOWNSAMPLE_BYTES) continue;
        if (pick < 0 || samples[i].data.length > samples[pick].data.length) pick = i;
      }
    }
    if (pick < 0) {
      const free = makeRegions().map((r) => r.limit - r.cursor).reduce((a, b) => a + b, 0);
      throw new MmlModuleError(
        `custom samples total ${samples.reduce((n, x) => n + x.data.length, 0)} bytes — ` +
        `only ${free} fit (${mergeMode ? "the space left by the module's existing songs and the set's resident sample banks" : 'add-on window + sequence tail'})` +
        (downsampleToFit ? ', even after downsampling. ' : '. ') +
        (downsampleToFit
          ? 'Trim/drop instruments (see the plan\'s sample-budget notes).'
          : 'Enable "Downsample samples to fit", or trim/drop instruments.'),
        'samples'
      );
    }
    const before = samples[pick].data.length;
    samples[pick] = downsampleBrr(samples[pick]);
    halvings.set(pick, (halvings.get(pick) ?? 0) + 1);
    // Halve the multiplier of every row referencing this sample's slots.
    for (const [dirIndex, e] of compiled.dirEntries.entries()) {
      if (e.sampleIndex !== pick) continue;
      const srcn = compiled.sampleSrcnBase + dirIndex;
      for (const row of rows) {
        if (row.bytes[0] !== srcn) continue;
        const t = Math.max(1, Math.round((row.bytes[4] * 256 + row.bytes[5]) / 2));
        row.bytes[4] = t >> 8;
        row.bytes[5] = t & 0xff;
      }
    }
    warnings.push(
      `sample ${samples[pick].name} downsampled ×2 (${before} → ${samples[pick].data.length} bytes) to fit the budget — reduced fidelity, pitch compensated`
    );
  }

  // Merge mode: custom dir slots moved from the compile-time base — remap
  // the SRCN byte of every row referencing them (noise rows carry bit 7 and
  // never collide with the shift range).
  const srcnDelta = srcnBase - compiled.sampleSrcnBase;
  if (srcnDelta !== 0) {
    for (const row of rows) {
      const b0 = row.bytes[0];
      if (b0 >= compiled.sampleSrcnBase && b0 < compiled.sampleSrcnBase + compiled.dirEntries.length) {
        row.bytes[0] = b0 + srcnDelta;
      }
    }
  }

  // Merge mode keeps every base block — the other slots' songs, tables and
  // slot patches ride along; our blocks (disjoint dests) and the final slot
  // patch (upload order: later wins) apply on top.
  const stream: UploadStream = { blocks: base ? [...base.blocks] : [], entry: 0x0400 };

  if (compiled.dirEntries.length > 0) {
    const dir = new Uint8Array(compiled.dirEntries.length * 4);
    for (const [i, e] of compiled.dirEntries.entries()) {
      const start = sampleAddrs[e.sampleIndex];
      const loop = start + samples[e.sampleIndex].loopOffset;
      dir[i * 4] = start & 0xff;
      dir[i * 4 + 1] = start >> 8;
      dir[i * 4 + 2] = loop & 0xff;
      dir[i * 4 + 3] = loop >> 8;
    }
    stream.blocks.push({ dest: 0x3c00 + srcnBase * 4, data: dir });
    for (const region of regions) {
      if (region.cursor === region.base) continue;
      const data = new Uint8Array(region.cursor - region.base);
      for (const [i, s] of samples.entries()) {
        if (sampleAddrs[i] >= region.base && sampleAddrs[i] < region.limit) {
          data.set(s.data, sampleAddrs[i] - region.base);
        }
      }
      stream.blocks.push({ dest: region.base, data });
    }
  }

  let instrumentBytes = 0;
  if (rows.length > 0) {
    const table = new Uint8Array(rows.length * 6);
    for (const [i, row] of rows.entries()) table.set(row.bytes, i * 6);
    stream.blocks.push({ dest: MML_INSTRUMENT_BASE + rowBase * 6, data: table });
    instrumentBytes = table.length;
  }

  stream.blocks.push({ dest: songAddr, data: seq });

  // Slot patches — coalesce contiguous slots into single blocks.
  const slots = [...new Set(targetSlots)].sort((a, b) => a - b);
  let run: number[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    const data = new Uint8Array(run.length * 2);
    for (let i = 0; i < run.length; i++) {
      data[i * 2] = songAddr & 0xff;
      data[i * 2 + 1] = songAddr >> 8;
    }
    stream.blocks.push({ dest: SONG_TABLE_BASE + run[0] * 2, data });
    run = [];
  };
  for (const s of slots) {
    if (s < 1 || s > 0x38) throw new MmlModuleError(`song slot ${s} out of range`);
    if (run.length > 0 && s !== run[run.length - 1] + 1) flushRun();
    run.push(s);
  }
  flushRun();
  if (slots.length > 1) {
    warnings.push(`all ${slots.length} slots of the replaced module point at this song`);
  }

  return {
    stream,
    bytes: serializeUploadStream(stream),
    songAddr,
    seqBytes,
    sampleBytes,
    instrumentBytes,
    warnings,
  };
}
