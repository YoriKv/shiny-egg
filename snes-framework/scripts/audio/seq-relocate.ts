// Sequence relocation — move a song module's data to different ARAM
// addresses without re-encoding a byte. N-SPC song data is riddled with
// absolute pointers (part-list pattern/goto entries, each pattern's 8 track
// words, $EF subroutine args, the $FF8E slot table, $3C00-page directory
// start/loop words), so a move is: shift the blocks, then patch exactly the
// known pointer words whose VALUE falls in a moved range. Rigid per-range
// shifts preserve continuation-window tracks (voices that alias a suffix of
// another voice's stream) and every byte that isn't a patched pointer.
//
// Pointer-site discovery walks the decoded song; event byte sizes are exact
// because encode(decode(x)) is byte-identical (sequence-encode's 1,447-track
// identity gate), so $EF arg offsets are derivable without decoder changes.
//
// Two consumers (audio.ts):
//  - .spc import normalization: extracted modules whose sequences sit in the
//    map-resident $D000-$DC7E region (AMY-source layouts use $D090) shift up
//    to $DC7F on level-set targets.
//  - slot-merge repacking: previously imported layers first-fit back into
//    the placement windows so free space stays contiguous for the next song.

import { ARAM_SIZE, aramWord } from './aram.ts';
import { SONG_TABLE_BASE, songSlotsOfStream } from './catalog.ts';
import { decodeSong, type DecodedSong } from './sequence.ts';
import { freeAramGaps, MmlModuleError } from './mml-module.ts';
import type { UploadStream } from './upload-stream.ts';

export interface SeqMove {
  /** Source ARAM range [start, end) — must cover whole blocks. */
  start: number;
  end: number;
  /** Signed shift applied to the range's blocks and to every pointer word
   *  whose value lands in the range. */
  delta: number;
}

/** ARAM addresses of every absolute-pointer WORD a decoded song carries:
 *  part-list pattern entries + goto targets, pattern track words, and $EF
 *  subroutine ptr args inside track/subroutine streams. */
export function collectSongPointerSites(song: DecodedSong): Set<number> {
  const sites = new Set<number>();
  let p = song.songAddr;
  for (const part of song.parts) {
    if (part.kind === 'pattern') {
      sites.add(p);
      p += 2;
    } else if (part.kind === 'loop') {
      sites.add(p + 2); // count word, then the target (a part-list address)
      p += 4;
    } else {
      p += 2; // end word
    }
  }
  for (const pat of song.patterns.values()) {
    for (let v = 0; v < 8; v++) {
      if (pat.trackAddrs[v] !== 0) sites.add(pat.addr + v * 2);
    }
  }
  for (const t of song.tracks.values()) {
    let off = t.addr;
    for (const ev of t.events) {
      if (ev.kind === 'length') off += ev.gate !== undefined ? 2 : 1;
      else if (ev.kind === 'vcmd') {
        if (ev.op === 0xef) sites.add(off + 1);
        off += 1 + ev.args.length;
      } else off += 1; // note / tie / rest / perc
    }
  }
  return sites;
}

const inMove = (moves: SeqMove[], a: number): SeqMove | undefined =>
  moves.find((m) => a >= m.start && a < m.end);

/** Relocate a module stream's data per `moves`. Every block inside a move
 *  range shifts by its delta; pointer words (song structure, discovered by
 *  decoding every populated slot; the $FF8E slot table; $3C00-page directory
 *  entries) remap when their value falls in a move range. Bytes are
 *  otherwise preserved verbatim. Throws when a move splits a block or the
 *  relocated blocks would overlap. */
export function relocateModuleStream(stream: UploadStream, moves: SeqMove[]): UploadStream {
  const active = moves.filter((m) => m.delta !== 0 && m.end > m.start);
  if (active.length === 0) return stream;
  const mapAddr = (a: number): number => {
    const m = inMove(active, a);
    return m ? a + m.delta : a;
  };

  // Source image for pointer-site discovery (this stream's bytes only —
  // songs reference nothing outside their own module's data).
  const aram = new Uint8Array(ARAM_SIZE);
  for (const b of stream.blocks) aram.set(b.data, b.dest);
  const sites = new Set<number>();
  for (const ptr of new Set(songSlotsOfStream(stream).values())) {
    let song: DecodedSong;
    try {
      song = decodeSong(aram, ptr);
    } catch {
      continue; // stale/degenerate slot — its data relocates unpatched
    }
    for (const s of collectSongPointerSites(song)) sites.add(s);
  }

  const blocks = stream.blocks.map((b) => {
    const end = b.dest + b.data.length;
    const m = active.find((mv) => b.dest < mv.end && mv.start < end);
    if (m && (b.dest < m.start || end > m.end)) {
      throw new MmlModuleError(
        `relocation range 0x${m.start.toString(16)}-0x${m.end.toString(16)} splits an upload block at 0x${b.dest.toString(16)}+${b.data.length}`
      );
    }
    return { dest: m ? b.dest + m.delta : b.dest, data: new Uint8Array(b.data) };
  });
  const sorted = [...blocks].sort((a, b) => a.dest - b.dest);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].dest < sorted[i - 1].dest + sorted[i - 1].data.length) {
      throw new MmlModuleError(
        `relocation would overlap blocks at 0x${sorted[i - 1].dest.toString(16)} and 0x${sorted[i].dest.toString(16)}`
      );
    }
  }

  const patchWord = (blk: { dest: number; data: Uint8Array }, off: number, v: number): void => {
    blk.data[off] = v & 0xff;
    blk.data[off + 1] = (v >> 8) & 0xff;
  };
  // Song-structure sites: patch at the site's (possibly moved) new location.
  for (const site of sites) {
    const value = aramWord(aram, site);
    const mapped = mapAddr(value);
    if (mapped === value) continue;
    const newSite = mapAddr(site);
    const blk = blocks.find((b) => newSite >= b.dest && newSite + 1 < b.dest + b.data.length);
    if (!blk) {
      throw new MmlModuleError(`pointer site 0x${site.toString(16)} left the module's blocks after relocation`);
    }
    patchWord(blk, newSite - blk.dest, mapped);
  }
  // Slot-table + sample-directory words: value remap in place (these blocks
  // never move — dir/table positions are fixed).
  for (const blk of blocks) {
    const isSlotTable = blk.dest >= SONG_TABLE_BASE;
    const isDirPage = blk.dest >= 0x3c00 && blk.dest < 0x3d00;
    if (!isSlotTable && !isDirPage) continue;
    for (let off = 0; off + 1 < blk.data.length; off += 2) {
      const v = blk.data[off] | (blk.data[off + 1] << 8);
      const mv = mapAddr(v);
      if (mv !== v) patchWord(blk, off, mv);
    }
  }
  return { blocks, entry: stream.entry };
}

/** A block an import layer may relocate: sequence/sample payload — NOT the
 *  $3C00-page directory, the $3D00 instrument rows, or the slot patches
 *  (their positions encode SRCN/row indices baked into the layer). */
const isMovableLayerBlock = (b: { dest: number; data: Uint8Array }): boolean =>
  b.dest < 0x3c00 || (b.dest >= 0x4000 && b.dest < SONG_TABLE_BASE);

/** First-fit repack of a slot merge's kept layers: each layer's movable
 *  blocks (sequence + sample data) relocate into the earliest free space the
 *  fixed context leaves, biggest block first, so the free space left for the
 *  incoming song stays contiguous. Layers re-place in order; block counts
 *  and order within each layer are preserved (layer bookkeeping stays
 *  valid). Throws a seq-kind MmlModuleError when a kept layer no longer
 *  fits (e.g. one imported before the map-resident reservation existed). */
export function repackKeptLayers(
  fixedBlocks: UploadStream['blocks'],
  layers: { blocks: UploadStream['blocks'] }[],
  windows: { base: number; limit: number }[]
): UploadStream['blocks'][] {
  const occupied: { dest: number; data: Uint8Array }[] = [...fixedBlocks];
  const out: UploadStream['blocks'][] = [];
  for (const layer of layers) {
    const movable = layer.blocks
      .filter(isMovableLayerBlock)
      .sort((a, b) => b.data.length - a.data.length || a.dest - b.dest);
    const gaps = windows
      .flatMap((w) => freeAramGaps(w.base, w.limit, occupied))
      .map((g) => ({ ...g, cursor: g.base }));
    const moves: SeqMove[] = [];
    for (const b of movable) {
      const gap = gaps.find((g) => g.cursor + b.data.length <= g.limit);
      if (!gap) {
        throw new MmlModuleError(
          `an existing imported song no longer fits the corrected layout while merging — Reset the module and re-import its songs`,
          'seq'
        );
      }
      if (gap.cursor !== b.dest) moves.push({ start: b.dest, end: b.dest + b.data.length, delta: gap.cursor - b.dest });
      gap.cursor += b.data.length;
    }
    const relocated = relocateModuleStream({ blocks: layer.blocks, entry: 0x0400 }, moves);
    out.push(relocated.blocks);
    occupied.push(...relocated.blocks.filter(isMovableLayerBlock));
  }
  return out;
}
