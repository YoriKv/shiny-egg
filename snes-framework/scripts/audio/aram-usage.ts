// ARAM usage + import budgets — the numbers behind the Songs-tab per-set
// diagram and the song-import size gauges.
//
// `computeSettingAramUsage` paints a music setting's composed baseline
// (engine → global bank → row blocks, optional overlay module last — the
// in-game upload order, later blocks owning contested bytes) and reads the
// section usage off the painted image:
//   $D000-$FF8D   sequence window (capped by the $FF8E song-pointer table)
//   $4000-$CFFF   BRR sample space; $B960+ = the custom/add-on window
//   $3C00 page    sample-directory entries (4 bytes each, 64 max)
//   $3D00-$3E1F   instrument table (6-byte rows, 48 max — $3E20 is code)
//   $264C-$2C00   accumulation-resident jingles (worldmap/welcome overflow)
// Engine-owned bytes ≥ $4000 in a non-title set are stale title-screen data
// ("leftover") — visible in the bar but counted as free, since imports may
// overwrite them (buildMmlModule's layout only dodges the resident banks).
//
// `computeImportBudget` is the availability view of the same rules: the free
// gaps an import's sequence + samples can claim around a set of resident
// blocks, plus the directory-slot / instrument-row headroom
// (mml-module.ts's freeAramGaps + mergeLayoutBases — the exact math
// buildMmlModule places with).

import type { AramImportBudget, AramSegment, SettingAramUsage } from '../types.ts';
export type { AramImportBudget, AramSegment, SettingAramUsage };
import type { AudioCatalog } from './catalog.ts';
import {
  ENGINE_TAIL_REGION,
  MAP_RESIDENT_FREE_SONG_MODULES,
  MAP_RESIDENT_SEQ_REGION,
  parseBlockFromRom,
  SONG_TABLE_BASE,
  songSlotsOfStream,
  SPC_BLOCK_DISPLAY_NAMES,
  spcBlockById,
} from './catalog.ts';
import { composeSettingAram } from './aram.ts';
import { decodeSong } from './sequence.ts';
import type { UploadStream } from './upload-stream.ts';
import {
  freeAramGaps,
  importPlacementWindows,
  mergeLayoutBases,
  MML_INSTRUMENT_BASE,
  MML_SAMPLE_DATA_BASE,
  MML_SEQ_BASE,
} from './mml-module.ts';

const SAMPLE_REGION_START = 0x4000;
const DIR_PAGE = 0x3c00;
const DIR_SLOT_MAX = 0x40;
const INSTRUMENT_END = 0x3e20;
const INSTRUMENT_ROW_MAX = 48;
const JINGLE_START = 0x264c;
const JINGLE_END = 0x2c00;

export interface AramUsageOverlay {
  /** Block id the overlay replaces (TITLE_IMPORT_BLOCK_ID for title imports —
   *  excluded from the baseline like the preview composer does). */
  blockId: number;
  stream: UploadStream;
  /** Song title for the segment label, when known. */
  label?: string;
}

export function computeSettingAramUsage(
  rom: Uint8Array,
  catalog: AudioCatalog,
  setting: number,
  overlay?: AramUsageOverlay,
): SettingAramUsage {
  const cfg = catalog.settings[setting];
  if (!cfg) throw new Error(`unknown music setting 0x${setting.toString(16)}`);
  const { blockIds } = composeSettingAram(rom, catalog, setting, overlay?.blockId ?? null);

  // Level-set rows reserve $D000-$DC7E for the map-resident Score /
  // Powerful Infant sequences (see MAP_RESIDENT_SEQ_REGION) — their honest
  // window starts at $DC7F. Exempt rows keep $D000 (retail precedent).
  const songModule = cfg.blockIds.map((id) => spcBlockById(id)).find((b) => b.kind === 'songs')?.module ?? 'driver';
  const reserved = !MAP_RESIDENT_FREE_SONG_MODULES.has(songModule);
  const RESERVED_LABEL = 'Score + invincibility music (map-resident — imports must not touch)';

  interface Applied {
    blockId: number;
    kind: 'engine' | 'samples' | 'songs' | 'import';
    label: string;
  }
  const applied: Applied[] = [];
  // Byte owner = 1-based index into `applied` (0 = never uploaded).
  const owner = new Uint8Array(0x10000);
  const paint = (stream: UploadStream): void => {
    const idx = applied.length; // 1-based (applied entry pushed first)
    for (const b of stream.blocks) owner.fill(idx, b.dest, b.dest + b.data.length);
  };
  for (const id of blockIds) {
    const info = spcBlockById(id);
    applied.push({ blockId: id, kind: info.kind, label: SPC_BLOCK_DISPLAY_NAMES[id] ?? info.module });
    paint(parseBlockFromRom(rom, catalog, id).stream);
  }
  if (overlay) {
    applied.push({
      blockId: -1,
      kind: 'import',
      label: overlay.label ? `imported song — ${overlay.label}` : 'imported song',
    });
    paint(overlay.stream);
  }

  // Engine-only settings (title): the engine image IS the content — its
  // title bank + title sequence are real, not leftovers.
  const engineOnly = applied.every((a) => a.kind === 'engine' || a.kind === 'import');
  const segKind = (a: Applied, addr: number): AramSegment['kind'] => {
    if (a.kind === 'import') return 'import';
    if (a.kind === 'engine' && !engineOnly) return 'leftover';
    return addr >= MML_SEQ_BASE ? 'seq' : 'samples';
  };

  // Segment runs over the swappable region, split at the $D000 window edge
  // so each segment's kind is uniform.
  const segments: AramSegment[] = [];
  let runStart = -1;
  let runOwner = 0;
  const flush = (end: number): void => {
    if (runStart < 0 || runOwner === 0) return;
    const a = applied[runOwner - 1];
    let kind = segKind(a, runStart);
    let label = a.label;
    let blockId = a.blockId;
    // Leftovers inside the reserved region aren't reclaimable like other
    // leftovers — in-game the worldmap module's Score/Powerful Infant data
    // lives here (the composed baseline shows title junk instead).
    if (reserved && kind === 'leftover' && runStart >= MAP_RESIDENT_SEQ_REGION.start && runStart < MAP_RESIDENT_SEQ_REGION.end) {
      kind = 'reserved';
      label = RESERVED_LABEL;
      blockId = 0x1c; // worldmap — the in-game owner
    }
    segments.push({ start: runStart, end, blockId, label, kind });
  };
  for (let addr = SAMPLE_REGION_START; addr < SONG_TABLE_BASE; addr++) {
    const o = owner[addr];
    if (o !== runOwner || addr === MML_SEQ_BASE || (reserved && addr === MAP_RESIDENT_SEQ_REGION.end)) {
      flush(addr);
      runStart = addr;
      runOwner = o;
    }
  }
  flush(SONG_TABLE_BASE);
  // Unpainted bytes in the reserved region are NOT free either — synthesize
  // reserved segments for them so the bar doesn't read as claimable space.
  if (reserved) {
    let freeStart = -1;
    for (let addr = MAP_RESIDENT_SEQ_REGION.start; addr <= MAP_RESIDENT_SEQ_REGION.end; addr++) {
      const isFree = addr < MAP_RESIDENT_SEQ_REGION.end && owner[addr] === 0;
      if (isFree && freeStart < 0) freeStart = addr;
      if (!isFree && freeStart >= 0) {
        segments.push({ start: freeStart, end: addr, blockId: 0x1c, label: RESERVED_LABEL, kind: 'reserved' });
        freeStart = -1;
      }
    }
    segments.sort((a, b) => a.start - b.start);
  }

  // Section stats off the same paint.
  const isContent = (o: number): boolean => o !== 0 && applied[o - 1].kind !== 'engine';
  const isOwn = (o: number): boolean => isContent(o) || (o !== 0 && engineOnly);
  const windowStart = reserved ? MAP_RESIDENT_SEQ_REGION.end : MML_SEQ_BASE;
  let seqUsed = 0;
  let seqLeftover = 0;
  for (let addr = windowStart; addr < SONG_TABLE_BASE; addr++) {
    const o = owner[addr];
    if (isOwn(o)) seqUsed++;
    else if (o !== 0) seqLeftover++;
  }
  let lowUsed = 0;
  for (let addr = ENGINE_TAIL_REGION.start; addr < ENGINE_TAIL_REGION.end; addr++) {
    if (isOwn(owner[addr])) lowUsed++;
  }
  let jingleBytes = 0;
  for (let addr = JINGLE_START; addr < JINGLE_END; addr++) {
    if (isContent(owner[addr])) jingleBytes++;
  }
  let sampleUsed = 0;
  for (let addr = SAMPLE_REGION_START; addr < MML_SEQ_BASE; addr++) {
    if (isOwn(owner[addr])) sampleUsed++;
  }
  let customFree = 0;
  for (let addr = MML_SAMPLE_DATA_BASE; addr < MML_SEQ_BASE; addr++) {
    if (!isOwn(owner[addr])) customFree++;
  }
  let dirUsed = 0;
  for (let slot = 0; slot < DIR_SLOT_MAX; slot++) {
    const base = DIR_PAGE + slot * 4;
    if (isOwn(owner[base]) || isOwn(owner[base + 1]) || isOwn(owner[base + 2]) || isOwn(owner[base + 3])) dirUsed++;
  }
  let rowsEnd = MML_INSTRUMENT_BASE;
  for (let addr = MML_INSTRUMENT_BASE; addr < INSTRUMENT_END; addr++) {
    if (isOwn(owner[addr])) rowsEnd = addr + 1;
  }

  const seqWindow = SONG_TABLE_BASE - windowStart;
  return {
    setting,
    blockSetRow: cfg.blockSetRow,
    segments,
    seq: {
      windowStart,
      windowEnd: SONG_TABLE_BASE,
      used: seqUsed,
      free: seqWindow - seqUsed,
      leftover: seqLeftover,
      jingleBytes,
    },
    low: {
      start: ENGINE_TAIL_REGION.start,
      end: ENGINE_TAIL_REGION.end,
      used: lowUsed,
      free: ENGINE_TAIL_REGION.end - ENGINE_TAIL_REGION.start - lowUsed,
    },
    samples: {
      used: sampleUsed,
      count: dirUsed,
      customWindowSize: MML_SEQ_BASE - MML_SAMPLE_DATA_BASE,
      customWindowFree: customFree,
    },
    dir: { used: dirUsed, max: DIR_SLOT_MAX },
    rows: { used: Math.ceil((rowsEnd - MML_INSTRUMENT_BASE) / 6), max: INSTRUMENT_ROW_MAX },
  };
}

/** True when any song reachable from the blocks' $FF8E slot patches plays
 *  an $F5 (echo on) — the disqualifier for the "No echo" option's
 *  ECHO_BUFFER_REGION claim (a played $F5 enables the DSP's buffer writes;
 *  $F7/$F8 alone commit with writes still disabled). Undecodable slots
 *  count as echo-using — unknown content is unsafe to claim around. */
export function moduleSongsUseEcho(blocks: UploadStream['blocks']): boolean {
  const aram = new Uint8Array(0x10000);
  for (const b of blocks) aram.set(b.data, b.dest);
  for (const ptr of new Set(songSlotsOfStream({ blocks }).values())) {
    try {
      const song = decodeSong(aram, ptr);
      for (const t of song.tracks.values()) {
        for (const ev of t.events) {
          if (ev.kind === 'vcmd' && ev.op === 0xf5) return true;
        }
      }
    } catch {
      return true;
    }
  }
  return false;
}

/** Free space an import can claim around `residentBlocks` (the target set's
 *  sample banks — plus the map-resident reservation on level-set targets —
 *  for a whole-module replace; plus the module's current content for a slot
 *  merge: buildMmlModule's dodge set). Windows = engine tail + main span,
 *  truncated by the target's echo-delay ceiling; `claimEchoRegion` adds the
 *  $2C00-$3C00 window (the caller has verified echo-safety). */
export function computeImportBudget(
  residentBlocks: UploadStream['blocks'],
  echoDelayLimit = 2,
  claimEchoRegion = false
): AramImportBudget {
  const gaps = importPlacementWindows(echoDelayLimit, undefined, claimEchoRegion).flatMap((w) =>
    freeAramGaps(w.base, w.limit, residentBlocks)
  );
  const bases = mergeLayoutBases(residentBlocks);
  return {
    seqLargestGap: gaps.reduce((m, g) => Math.max(m, g.limit - g.base), 0),
    freeTotal: gaps.reduce((n, g) => n + (g.limit - g.base), 0),
    dirSlotsFree: DIR_SLOT_MAX - Math.max(0x18, bases.srcnBase),
    instrumentRowsFree: INSTRUMENT_ROW_MAX - bases.rowBase,
  };
}

/** Synthetic dodge block covering the map-resident $D000-$DC7E reservation —
 *  passed in `layoutBase`/budget block lists for level-set song targets. */
export function mapResidentReservationBlocks(targetModule: string): UploadStream['blocks'] {
  if (MAP_RESIDENT_FREE_SONG_MODULES.has(targetModule)) return [];
  return [
    {
      dest: MAP_RESIDENT_SEQ_REGION.start,
      data: new Uint8Array(MAP_RESIDENT_SEQ_REGION.end - MAP_RESIDENT_SEQ_REGION.start),
    },
  ];
}
