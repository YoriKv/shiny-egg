// Unit test: sequence relocation (seq-relocate.ts).
// Run: node snes-framework/scripts/audio/seq-relocate.test.ts
//
// Pins (build-gated — skips cleanly with no V1.0 build):
//  - Round-trip identity over ALL 13 song-bearing modules (12 song modules +
//    the driver's title songs): relocating every sequence block by +0x100
//    and back is byte-identical to the original module — proof the pointer-
//    site walker finds exactly the pointer words (a missed site corrupts the
//    -delta pass; an extra patch corrupts a non-pointer byte).
//  - Structural equivalence after one-way relocation: every song decodes at
//    its shifted slot pointer with identical parts/patterns/track events,
//    $EF subroutine args shifted with the move (continuation-window tracks
//    included — bowser/ending use them).
//  - repackKeptLayers: a layer forced out of its home first-fits into the
//    remaining windows and still decodes identically; an unfittable layer
//    throws the seq-kind error.

import { parseBlockFromRom, readAudioCatalog, songSlotsOfStream, SPC_BLOCKS } from './catalog.ts';
import { serializeUploadStream, type UploadStream } from './upload-stream.ts';
import { decodeSong, type DecodedSong } from './sequence.ts';
import { relocateModuleStream, repackKeptLayers, type SeqMove } from './seq-relocate.ts';
import { importPlacementWindows } from './mml-module.ts';
import { ARAM_SIZE, composeSettingAram } from './aram.ts';
import { extractSongModule } from './spc-import.ts';
import { loadDevCart } from '../engine/dev-cart.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const imageOf = (stream: UploadStream): Uint8Array => {
  const aram = new Uint8Array(ARAM_SIZE);
  for (const b of stream.blocks) aram.set(b.data, b.dest);
  return aram;
};

/** Deep song comparison: `shifted` must equal `orig` with every address in a
 *  move range displaced by its delta ($EF args included). */
function assertSongShifted(name: string, orig: DecodedSong, shifted: DecodedSong, moves: SeqMove[]): void {
  const map = (a: number): number => {
    const m = moves.find((mv) => a >= mv.start && a < mv.end);
    return m ? a + m.delta : a;
  };
  assert(shifted.songAddr === map(orig.songAddr), `${name}: songAddr maps`);
  assert(shifted.parts.length === orig.parts.length, `${name}: part count`);
  for (let i = 0; i < orig.parts.length; i++) {
    const a = orig.parts[i];
    const b = shifted.parts[i];
    if (a.kind === 'pattern' && b.kind === 'pattern') assert(b.addr === map(a.addr), `${name}: part ${i} pattern addr maps`);
    else if (a.kind === 'loop' && b.kind === 'loop') {
      assert(b.count === a.count && b.target === map(a.target), `${name}: part ${i} loop maps`);
    } else assert(a.kind === b.kind, `${name}: part ${i} kind`);
  }
  for (const [addr, pat] of orig.patterns) {
    const p2 = shifted.patterns.get(map(addr));
    assert(!!p2, `${name}: pattern 0x${addr.toString(16)} maps`);
    if (!p2) continue;
    for (let v = 0; v < 8; v++) {
      const t = pat.trackAddrs[v];
      assert(p2.trackAddrs[v] === (t === 0 ? 0 : map(t)), `${name}: pattern 0x${addr.toString(16)} voice ${v} maps`);
    }
  }
  for (const [addr, track] of orig.tracks) {
    const t2 = shifted.tracks.get(map(addr));
    assert(!!t2, `${name}: track 0x${addr.toString(16)} maps`);
    if (!t2) continue;
    assert(t2.events.length === track.events.length, `${name}: track 0x${addr.toString(16)} event count`);
    for (let i = 0; i < track.events.length; i++) {
      const a = track.events[i];
      const b = t2.events[i];
      if (a.kind === 'vcmd' && b.kind === 'vcmd' && a.op === 0xef) {
        const target = map(a.args[0] | (a.args[1] << 8));
        assert(
          b.op === 0xef && (b.args[0] | (b.args[1] << 8)) === target && b.args[2] === a.args[2],
          `${name}: track 0x${addr.toString(16)} $EF arg maps at event ${i}`
        );
      } else {
        assert(JSON.stringify(a) === JSON.stringify(b), `${name}: track 0x${addr.toString(16)} event ${i} equal`);
      }
    }
  }
}

try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  const songBlocks = SPC_BLOCKS.filter((b) => b.kind === 'songs' || b.kind === 'engine');

  console.log(`=== round-trip + structural shift: ${songBlocks.length} song-bearing modules ===`);
  for (const block of songBlocks) {
    const { stream } = parseBlockFromRom(rom, catalog, block.blockId);
    const original = serializeUploadStream(stream);
    // Move every sequence-side block (not dir/instrument/table/slot blocks)
    // by +0x100 — covers the $264C jingle blocks and $D000/$DC7F bodies.
    const moves: SeqMove[] = stream.blocks
      .filter((b) => b.dest >= 0x4000 || (b.dest >= 0x2000 && b.dest < 0x3c00))
      .filter((b) => b.dest < 0xff8e)
      .map((b) => ({ start: b.dest, end: b.dest + b.data.length, delta: 0x100 }));
    if (moves.length === 0) continue;

    const relocated = relocateModuleStream(stream, moves);
    const back = relocateModuleStream(
      relocated,
      moves.map((m) => ({ start: m.start + m.delta, end: m.end + m.delta, delta: -m.delta }))
    );
    assert(
      bytesEqual(serializeUploadStream(back), original),
      `${block.module}: relocate +0x100 then -0x100 is byte-identical`
    );

    const origImage = imageOf(stream);
    const relocImage = imageOf(relocated);
    const origSlots = songSlotsOfStream(stream);
    const relocSlots = songSlotsOfStream(relocated);
    for (const [slot, ptr] of origSlots) {
      let orig: DecodedSong;
      try {
        orig = decodeSong(origImage, ptr);
      } catch {
        continue; // degenerate slot (cross-module pointer) — skipped by relocation too
      }
      const newPtr = relocSlots.get(slot)!;
      const shifted = decodeSong(relocImage, newPtr);
      assertSongShifted(`${block.module} slot ${slot}`, orig, shifted, moves);
    }
  }

  console.log('=== repackKeptLayers ===');
  {
    // Use flowergarden's whole module as a stand-in "kept layer": force it
    // out of its retail home with a fixed block and check it first-fits
    // beyond, decoding identically.
    const layer = parseBlockFromRom(rom, catalog, 0x13).stream; // flowergarden
    const fixed = [
      { dest: 0xd000, data: new Uint8Array(0xdc7f - 0xd000) }, // reservation
      { dest: 0xdc7f, data: new Uint8Array(0x40) }, // squatter at the retail home
    ];
    const windows = importPlacementWindows(2);
    const [repacked] = repackKeptLayers(fixed, [{ blocks: layer.blocks }], windows);
    const seqBlock = repacked.find((b) => b.dest >= 0x4000 && b.dest < 0xff8e)!;
    // First-fit: the $B960 window is empty in this synthetic fixed set, so
    // the 3,027-byte seq block lands there — a cross-region relocation.
    assert(seqBlock.dest === 0xb960, `repacked seq first-fits at 0xB960 (got 0x${seqBlock.dest.toString(16)})`);
    const origSong = decodeSong(imageOf(layer), songSlotsOfStream(layer).get(1)!);
    const repackedStream = { blocks: repacked, entry: 0x0400 };
    const newPtr = songSlotsOfStream(repackedStream).get(1)!;
    const moved = decodeSong(imageOf(repackedStream), newPtr);
    assertSongShifted('repacked flowergarden', origSong, moved, [
      { start: 0xdc7f, end: 0xdc7f + 3027, delta: 0xb960 - 0xdc7f },
    ]);

    // Unfittable layer: fill the whole main window.
    const wall = [{ dest: 0x4000, data: new Uint8Array(0xff8e - 0x4000) }];
    let threw = false;
    try {
      repackKeptLayers(wall, [{ blocks: layer.blocks }], windows);
    } catch {
      threw = true;
    }
    assert(threw, 'repack throws when a kept layer no longer fits');
  }

  console.log('=== .spc import normalization (AMY-source $D090 layout) ===');
  {
    // Simulate an AMY-source-built .spc: flower garden's song relocated to
    // $D090, inside the map-resident reservation. Extraction + the import
    // path's rigid shift must land it back at $DC7F, decoding identically.
    const fg = parseBlockFromRom(rom, catalog, 0x13).stream;
    const lowFg = relocateModuleStream(fg, [{ start: 0xdc7f, end: 0xdc7f + 3027, delta: 0xd090 - 0xdc7f }]);
    const baseline = composeSettingAram(rom, catalog, 0x00, 0x13); // FG set minus its song module
    const sourceAram = new Uint8Array(baseline.aram);
    for (const b of lowFg.blocks) sourceAram.set(b.data, b.dest);
    const mod = extractSongModule(sourceAram, [{ sourceSlot: 1, targetSlot: 1 }], baseline.aram);
    assert(mod.seqRanges.some((r) => r.start < 0xdc7f && r.end > 0xd000), 'extraction sees the low sequence');

    // The import path's normalization rule (audio.ts buildSongImportModule).
    const shiftRanges = mod.seqRanges.filter((r) => r.end > 0xd000);
    const minStart = shiftRanges.reduce((m, r) => Math.min(m, r.start), 0x10000);
    const delta = 0xdc7f - minStart;
    assert(delta > 0, `normalization shift computed (+0x${delta.toString(16)})`);
    const normalized = relocateModuleStream(mod.stream, shiftRanges.map((r) => ({ start: r.start, end: r.end, delta })));
    const image = new Uint8Array(baseline.aram);
    for (const b of normalized.blocks) image.set(b.data, b.dest);
    const ptr = songSlotsOfStream(normalized).get(1)!;
    assert(ptr >= 0xdc7f, `normalized song pointer ≥ 0xDC7F (0x${ptr.toString(16)})`);
    assert(!normalized.blocks.some((b) => b.dest < 0xdc7f && b.dest + b.data.length > 0xd000),
      'no normalized block touches the reserved region');
    const retail = decodeSong(imageOf(fg), songSlotsOfStream(fg).get(1)!);
    const roundTripped = decodeSong(image, ptr);
    assertSongShifted('normalized flowergarden', retail, roundTripped, [
      { start: 0xdc7f, end: 0xdc7f + 3027, delta: 0 },
    ]);
  }
} catch (e) {
  console.log(`(skip) ${(e as Error).message.split('\n')[0]}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll seq-relocate checks passed.');
