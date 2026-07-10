// Unit test: .spc → song-module import codec.
// Run: node snes-framework/scripts/audio/spc-import.test.ts
//
// Pins:
//  - Synthetic: .spc header validation; candidate enumeration filters
//    garbage/empty slots; extraction carries a custom sample + directory
//    diff and rebuilding the target baseline reproduces the source song.
//  - (Build-gated) THE identity gate: for every retail song module,
//    extracting its song(s) from the setting's own composed ARAM reproduces
//    the module — full serialized byte identity for 10 of 12 (ending carries
//    a 72-byte instrument table and welcome's slot-patch run spans zero-ptr
//    slots, so those two pin sequence-block identity + applied-ARAM
//    equivalence instead). Also: our own synthesized .spc passes the driver
//    check (port-clear patch tolerated), and a cross-set extraction carries
//    exactly the sample bytes the target baseline lacks.

import { parseSpcFile, verifyYiDriverAram, findSpcSongCandidates, extractSongModule, synthesizeImportPreviewSpc } from './spc-import.ts';
import { parseUploadStream } from './upload-stream.ts';
import { applyUploadStream, ARAM_SIZE, composeSettingAram } from './aram.ts';
import { decodeSong } from './sequence.ts';
import { synthesizeSongSpc, songSlotsOfSetting } from './spc.ts';
import { parseBlockFromRom, readAudioCatalog, songSlotsOfStream, SPC_BLOCKS } from './catalog.ts';
import { loadDevCart } from '../engine/dev-cart.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
const throws = (fn: () => void, msg: string): void => {
  let threw = false;
  try { fn() } catch { threw = true }
  assert(threw, msg);
};
function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── synthetic ARAM with one song + one custom sample ─────────────────────────
// Song at $D000: part list → pattern → 1 track using instrument 3 and a
// percussion note (base 5, index 2 → row 7). Instrument rows 3/7 → SRCNs
// 0x18/0x19. Sample 0x18's BRR + dir entry differ from the baseline; 0x19
// matches it.
function buildSyntheticAram(): { aram: Uint8Array; baseline: Uint8Array } {
  const baseline = new Uint8Array(ARAM_SIZE);
  // Baseline sample 0x18 @ $5000 (2 BRR blocks), 0x19 @ $5100 (1 block).
  const dir = (srcn: number, start: number, loop: number, into: Uint8Array): void => {
    into[0x3c00 + srcn * 4] = start & 0xff;
    into[0x3c00 + srcn * 4 + 1] = start >> 8;
    into[0x3c00 + srcn * 4 + 2] = loop & 0xff;
    into[0x3c00 + srcn * 4 + 3] = loop >> 8;
  };
  dir(0x18, 0x5000, 0x5000, baseline);
  dir(0x19, 0x5100, 0x5100, baseline);
  baseline.set([0x10, 1, 2, 3, 4, 5, 6, 7, 8, 0x13, 9, 9, 9, 9, 9, 9, 9, 9], 0x5000); // 2 blocks, end flag on 2nd
  baseline.set([0x0b, 7, 7, 7, 7, 7, 7, 7, 7], 0x5100); // 1 block, end+loop
  const aram = new Uint8Array(baseline);
  // Custom sample 0x18: moved to $6000, 1 block, loop differs.
  dir(0x18, 0x6000, 0x6004, aram);
  aram.set([0x0d, 1, 1, 2, 2, 3, 3, 4, 4], 0x6000);
  // Instrument rows: row 3 → SRCN 0x18, row 7 → SRCN 0x19.
  aram.set([0x18, 0x8e, 0xe0, 0x7f, 0x04, 0x00], 0x3d00 + 3 * 6);
  aram.set([0x19, 0x8e, 0xe0, 0x7f, 0x03, 0x80], 0x3d00 + 7 * 6);
  // Gate/velocity tables.
  for (let i = 0; i < 24; i++) aram[0x3fe8 + i] = 0x30 + i;
  // Track @ $D040: setInstrument 3, percBase 5, len $18, note, perc idx 2, end.
  aram.set([0xe0, 0x03, 0xfa, 0x05, 0x18, 0x8c, 0xcc, 0x00], 0xd040);
  // Pattern @ $D010: voice 0 → $D040, rest silent.
  aram[0xd010] = 0x40; aram[0xd011] = 0xd0;
  // Song @ $D000: pattern $D010, end.
  aram[0xd000] = 0x10; aram[0xd001] = 0xd0;
  aram[0xd002] = 0x00; aram[0xd003] = 0x00;
  // Slot 1 → $D000; slot 2 → garbage (points at zeros → degenerate).
  aram[0xff90] = 0x00; aram[0xff91] = 0xd0;
  aram[0xff92] = 0x00; aram[0xff93] = 0xe8;
  return { aram, baseline };
}

console.log('=== synthetic: .spc parsing ===');
{
  throws(() => parseSpcFile(new Uint8Array(0x200)), 'short file rejected');
  const bad = new Uint8Array(0x10200);
  throws(() => parseSpcFile(bad), 'bad magic rejected');
}

console.log('=== synthetic: candidates + extraction ===');
{
  const { aram, baseline } = buildSyntheticAram();
  const candidates = findSpcSongCandidates(aram);
  assert(candidates.length === 2, `2 populated slots, saw ${candidates.length}`);
  const c1 = candidates.find((c) => c.slot === 1);
  const c2 = candidates.find((c) => c.slot === 2);
  assert(!!c1 && c1.ok && c1.noteEvents === 2 && c1.patterns === 1, `slot 1 healthy: ${JSON.stringify(c1)}`);
  assert(!!c2 && !c2.ok, `slot 2 degenerate: ${JSON.stringify(c2)}`);

  const mod = extractSongModule(aram, [{ sourceSlot: 1, targetSlot: 1 }, { sourceSlot: 1, targetSlot: 9 }], baseline);
  assert(mod.instrumentRows.join(',') === '3,7', `instrument rows 3,7 — saw ${mod.instrumentRows.join(',')}`);
  assert(mod.srcns.join(',') === `${0x18},${0x19}`, `SRCNs 0x18,0x19 — saw ${mod.srcns.map((s) => '0x' + s.toString(16)).join(',')}`);
  assert(mod.carriedSamples.length === 1 && mod.carriedSamples[0].srcn === 0x18 && mod.carriedSamples[0].dirChanged,
    `only the changed sample carried: ${JSON.stringify(mod.carriedSamples)}`);
  // Applying the module to the baseline must reproduce the song + its sample.
  const rebuilt = new Uint8Array(baseline);
  applyUploadStream(rebuilt, mod.stream);
  const src = decodeSong(aram, 0xd000);
  const dst = decodeSong(rebuilt, 0xd000);
  assert(JSON.stringify([...dst.tracks.values()]) === JSON.stringify([...src.tracks.values()]), 'rebuilt song decodes identically');
  assert(bytesEq(rebuilt.subarray(0x6000, 0x6009), aram.subarray(0x6000, 0x6009)), 'custom sample bytes carried');
  assert(bytesEq(rebuilt.subarray(0x3c60, 0x3c64), aram.subarray(0x3c60, 0x3c64)), 'directory diff carried');
  // Slot patches: slots 1 and 9 both point at $D000.
  const slots = songSlotsOfStream(mod.stream);
  assert(slots.get(1) === 0xd000 && slots.get(9) === 0xd000 && slots.size === 2, `slot patches: ${JSON.stringify([...slots])}`);

  // Round-trip through serialization.
  const reparsed = parseUploadStream(mod.bytes, 0).stream;
  assert(reparsed.blocks.length === mod.stream.blocks.length && reparsed.entry === 0x0400, 'serialized module reparses');
}

// ── build-gated: identity over the retail modules ────────────────────────────
try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  const engineStream = parseBlockFromRom(rom, catalog, 0x2b).stream;

  console.log('\n=== driver check on our own synthesized .spc ===');
  {
    const { spc } = synthesizeSongSpc(rom, catalog, 0x00, 1);
    const parsed = parseSpcFile(spc);
    const check = verifyYiDriverAram(parsed.aram, engineStream);
    assert(check.ok, `driver check ok on synthesized spc: ${JSON.stringify(check.regions)}`);
    const pristine = composeSettingAram(rom, catalog, 0x00);
    assert(verifyYiDriverAram(pristine.aram, engineStream).ok, 'driver check ok on pristine composition');
    const broken = new Uint8Array(parsed.aram);
    broken[0x0500] ^= 0xff;
    assert(!verifyYiDriverAram(broken, engineStream).ok, 'driver check fails on patched driver');
  }

  console.log('\n=== retail module reconstruction identity ===');
  // A representative setting per song-module block.
  const settingOf: Record<number, number> = {
    0x04: 0x0a, 0x07: 0x06, 0x0a: 0x03, 0x0d: 0x04, 0x10: 0x01, 0x13: 0x00,
    0x1c: 0x12, 0x1f: 0x07, 0x28: 0x02, 0x2e: 0x11, 0x34: 0x0c, 0x3a: 0x13,
  };
  // ending ships a 72-byte instrument table (we always carry 168) and
  // welcome's $FF90+16 block spans zero-ptr slots 5/6 (we emit runs of the
  // populated ones) — framing differs, content is pinned via ARAM
  // equivalence below.
  const FULL_IDENTITY_EXEMPT = new Set(['ending', 'welcome']);
  for (const info of SPC_BLOCKS.filter((b) => b.kind === 'songs')) {
    const setting = settingOf[info.blockId];
    const source = composeSettingAram(rom, catalog, setting);
    const retail = parseBlockFromRom(rom, catalog, info.blockId);
    const retailSlots = songSlotsOfStream(retail.stream);
    const baseline = composeSettingAram(rom, catalog, setting, info.blockId);
    const mod = extractSongModule(
      source.aram,
      [...retailSlots.keys()].map((slot) => ({ sourceSlot: slot, targetSlot: slot })),
      baseline.aram,
    );
    assert(mod.carriedSamples.length === 0, `${info.module}: no sample diffs vs own baseline (saw ${mod.carriedSamples.length})`);

    if (!FULL_IDENTITY_EXEMPT.has(info.module)) {
      const retailBytes = rom.subarray(catalog.blockPc.get(info.blockId)!, catalog.blockPc.get(info.blockId)! + retail.byteLength);
      assert(bytesEq(mod.bytes, retailBytes), `${info.module}: full module byte identity`);
    } else {
      // Sequence blocks still byte-identical.
      const retailSeq = retail.stream.blocks.filter((b) => b.dest !== 0x3d00 && b.dest !== 0x3fe8 && b.dest < 0xff8e);
      const modSeq = mod.stream.blocks.filter((b) => (b.dest >= 0x4000 && b.dest < 0xff8e) || (b.dest >= 0x2000 && b.dest < 0x3c00));
      assert(
        retailSeq.length === modSeq.length &&
          retailSeq.every((rb, i) => rb.dest === modSeq[i].dest && bytesEq(rb.data, modSeq[i].data)),
        `${info.module}: sequence block identity`,
      );
    }

    // Applied-ARAM equivalence: baseline + extracted == the full composition.
    const rebuilt = new Uint8Array(baseline.aram);
    applyUploadStream(rebuilt, mod.stream);
    assert(bytesEq(rebuilt, source.aram), `${info.module}: baseline + extracted module == full composition`);
  }

  console.log('\n=== cross-set extraction carries the sample delta ===');
  {
    // Flower Garden's song (grasslandbank-resident samples) extracted against the
    // Ground set's baseline (cavebossbank-resident): the differing referenced
    // sample bytes must ride along, and the preview must reproduce them.
    const source = composeSettingAram(rom, catalog, 0x00);
    const baseline = composeSettingAram(rom, catalog, 0x01, 0x10);
    const mod = extractSongModule(source.aram, [{ sourceSlot: 1, targetSlot: 1 }], baseline.aram);
    assert(mod.carriedSamples.length > 0, `cross-set extraction carries samples (saw ${mod.carriedSamples.length})`);
    const preview = parseSpcFile(synthesizeImportPreviewSpc(rom, catalog, 0x01, 0x10, mod.stream, 1));
    for (const s of mod.carriedSamples) {
      assert(
        bytesEq(preview.aram.subarray(s.aramStart, s.aramStart + s.byteLength), source.aram.subarray(s.aramStart, s.aramStart + s.byteLength)),
        `carried sample 0x${s.srcn.toString(16)} present in preview`,
      );
    }
    const srcSong = decodeSong(source.aram, songSlotsOfSetting(rom, catalog, 0x00).get(1)!);
    const dstSong = decodeSong(preview.aram, songSlotsOfStream(mod.stream).get(1)!);
    assert(
      JSON.stringify([...dstSong.tracks.values()]) === JSON.stringify([...srcSong.tracks.values()]),
      'imported song decodes identically in the preview',
    );
  }

  console.log('\n=== candidates on a synthesized retail .spc ===');
  {
    const { spc } = synthesizeSongSpc(rom, catalog, 0x12, 1); // map set — 15 slots
    const cands = findSpcSongCandidates(parseSpcFile(spc).aram);
    const ok = cands.filter((c) => c.ok && c.aliasOf === undefined);
    assert(ok.length >= 8, `map-set spc yields ≥8 healthy distinct songs, saw ${ok.length}`);
    assert(cands.some((c) => c.aliasOf !== undefined), 'alias slots detected');
  }
} catch (e) {
  if ((e as Error).message.includes('Missing build artifact')) {
    console.log(`\n(skip) build-gated pins: ${(e as Error).message.split('\n')[0]}`);
  } else {
    console.error(`  ✗ build-gated pins threw: ${(e as Error).stack}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll spc-import checks passed.');
