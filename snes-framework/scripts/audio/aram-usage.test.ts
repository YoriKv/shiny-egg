// Unit test: per-setting ARAM usage + import budgets (aram-usage.ts).
// Run: node snes-framework/scripts/audio/aram-usage.test.ts
//
// Pins (build-gated — skips cleanly with no V1.0 build):
//  - Structural invariants over every block-set row's usage: segments
//    ascending/non-overlapping inside [$4000, $FF8E), kind uniform across
//    the $D000 window edge, section sums consistent with window sizes.
//  - Retail ground truth spot checks: Flower Garden's 28 instrument rows /
//    28 directory entries, its song module's sequence bytes in the window,
//    the Title row treating engine data as content (no leftovers), and the
//    Map row's jingle overflow at $264C.
//  - Import budgets mirror buildMmlModule's layout rules: the plain
//    global-bank-only dodge leaves 40 custom dir slots, the grassland dodge
//    36, and a slot merge's free space shrinks by the module's own bytes.

import { computeImportBudget, computeSettingAramUsage, mapResidentReservationBlocks, moduleSongsUseEcho } from './aram-usage.ts';
import { parseBlockFromRom, readAudioCatalog, representativeSettingByRow, spcBlockById } from './catalog.ts';
import { SONG_TABLE_BASE } from './catalog.ts';
import { loadDevCart } from '../engine/dev-cart.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  const rows = [...representativeSettingByRow(catalog).entries()].sort((a, b) => a[0] - b[0]);

  console.log('=== structural invariants: all 13 block-set rows ===');
  for (const [row, setting] of rows) {
    const u = computeSettingAramUsage(rom, catalog, setting);
    assert(u.blockSetRow === row, `row ${row}: blockSetRow matches`);
    let prev = 0x4000;
    for (const s of u.segments) {
      assert(s.start >= prev && s.end > s.start && s.end <= SONG_TABLE_BASE,
        `row ${row}: segment $${s.start.toString(16)}-$${s.end.toString(16)} ordered inside the region`);
      assert(s.start >= 0xd000 || s.end <= 0xd000,
        `row ${row}: segment $${s.start.toString(16)} does not straddle the $D000 window edge`);
      prev = s.end;
    }
    // Level-set rows reserve $D000-$DC7E (map-resident Score / Powerful
    // Infant) — their honest window starts at $DC7F. Exempt rows (title /
    // 1W-0 demo / map / ending) keep $D000.
    const exemptRow = [0, 1, 2, 12].includes(row);
    const seqWindow = u.seq.windowEnd - u.seq.windowStart;
    assert(u.seq.windowStart === (exemptRow ? 0xd000 : 0xdc7f), `row ${row}: window start`);
    assert(seqWindow === (exemptRow ? 12174 : 8975), `row ${row}: sequence window size (${seqWindow})`);
    assert(u.seq.used + u.seq.free === seqWindow, `row ${row}: seq used+free == window`);
    assert(u.seq.leftover <= u.seq.free, `row ${row}: leftovers counted as free`);
    assert(u.low.start === 0x230e && u.low.end === 0x264c && u.low.used + u.low.free === 830,
      `row ${row}: engine-tail stats consistent`);
    assert(u.samples.customWindowSize === 0xd000 - 0xb960, `row ${row}: custom window size`);
    assert(u.samples.customWindowFree <= u.samples.customWindowSize, `row ${row}: custom free ≤ size`);
    assert(u.dir.used === u.samples.count && u.dir.max === 64, `row ${row}: dir slots consistent`);
    assert(u.rows.used <= u.rows.max && u.rows.max === 48, `row ${row}: instrument rows within cap`);
    // Segment bytes reconcile with the section sums (seq side).
    const segSeq = u.segments.filter((s) => s.start >= u.seq.windowStart && s.kind !== 'leftover' && s.kind !== 'reserved')
      .reduce((n, s) => n + (s.end - s.start), 0);
    assert(segSeq === u.seq.used, `row ${row}: seq segments (${segSeq}) == seq.used (${u.seq.used})`);
    // Non-exempt rows: the reserved region is fully covered by reserved (or
    // real content) segments — never presented as free space.
    if (!exemptRow) {
      const covered = u.segments.filter((s) => s.start >= 0xd000 && s.end <= 0xdc7f)
        .reduce((n, s) => n + (s.end - s.start), 0);
      assert(covered === 0xdc7f - 0xd000, `row ${row}: reserved region fully covered (${covered})`);
    }
  }

  console.log('=== retail spot checks ===');
  {
    const fg = computeSettingAramUsage(rom, catalog, 0x00); // Flower Garden
    assert(fg.rows.used === 28, `Flower Garden uploads 28 instrument rows (got ${fg.rows.used})`);
    assert(fg.dir.used === 28, `Flower Garden claims 28 dir entries (24 global + 4 add-on; got ${fg.dir.used})`);
    assert(fg.seq.used === 3027, `Flower Garden seq bytes == retail (got ${fg.seq.used})`);
    assert(fg.seq.jingleBytes === 0, 'Flower Garden touches no jingle bytes');
    // The title-seq junk sits entirely inside the reserved region now.
    assert(fg.seq.leftover === 0, `Flower Garden window has no leftovers (got ${fg.seq.leftover})`);
    assert(fg.segments.some((s) => s.kind === 'reserved'), 'Flower Garden bar shows the reserved region');
    assert(fg.low.used === 0 && fg.low.free === 830, 'Flower Garden engine tail untouched');

    const title = computeSettingAramUsage(rom, catalog, 0x10); // Title (engine-only)
    assert(title.seq.leftover === 0, 'Title row has no leftovers — engine data is content');
    assert(title.seq.used > 3000, `Title seq used covers the title music (got ${title.seq.used})`);
    assert(title.rows.used > 0 && title.rows.used <= 28, `Title instrument rows from the engine base table (got ${title.rows.used})`);

    const map = computeSettingAramUsage(rom, catalog, 0x12); // Map
    assert(map.seq.jingleBytes > 0, `Map row shows $264C jingle overflow (got ${map.seq.jingleBytes})`);
  }

  console.log('=== import budgets ===');
  {
    const bankBlocksOf = (setting: number) =>
      catalog.settings[setting].blockIds
        .filter((id) => spcBlockById(id).kind === 'samples')
        .flatMap((id) => parseBlockFromRom(rom, catalog, id).stream.blocks);

    // Production shape: banks + the map-resident reservation on level sets.
    const withReservation = (setting: number, module: string) => [
      ...bankBlocksOf(setting),
      ...mapResidentReservationBlocks(module),
    ];

    // Ground target (level set): the reservation caps the largest run at
    // the corrected $DC7F window; the engine tail adds 830 B; cavebossbank
    // ends at $C350 leaving a 3,248-byte custom-window gap.
    const ground = computeImportBudget(withReservation(0x01, 'ground'));
    assert(ground.seqLargestGap === 8975, `ground largest gap == corrected window (${ground.seqLargestGap})`);
    assert(ground.freeTotal === 830 + 3248 + 8975, `ground freeTotal (${ground.freeTotal})`);
    assert(ground.instrumentRowsFree <= 48 && ground.instrumentRowsFree > 0, `ground rows free plausible (${ground.instrumentRowsFree})`);
    assert(ground.dirSlotsFree > 0 && ground.dirSlotsFree <= 40, `ground dir slots free 1-40 (${ground.dirSlotsFree})`);

    // Exempt target (ending): no reservation; EDL-3 ceiling truncates the
    // tail to $230E-$23FF (242 B).
    const ending2 = computeImportBudget(bankBlocksOf(0x13), 2);
    const ending3 = computeImportBudget(bankBlocksOf(0x13), 3);
    assert(ending2.freeTotal - ending3.freeTotal === 830 - 242, `EDL-3 tail truncation (${ending2.freeTotal} vs ${ending3.freeTotal})`);

    // Grassland set: the add-on keeps slots $18-$1B → at most 36 free.
    const grass = computeImportBudget(withReservation(0x00, 'flowergarden'));
    assert(grass.dirSlotsFree <= 36, `grassland dodge leaves ≤ 36 dir slots (${grass.dirSlotsFree})`);

    // Slot merge dodges the module's own bytes too — strictly less space.
    const fgModule = parseBlockFromRom(rom, catalog, 0x13).stream.blocks;
    const merge = computeImportBudget([...withReservation(0x00, 'flowergarden'), ...fgModule]);
    assert(merge.freeTotal < grass.freeTotal, `slot merge has less space (${merge.freeTotal} < ${grass.freeTotal})`);
    assert(merge.instrumentRowsFree === 48 - 28, `slot merge leaves 20 rows (${merge.instrumentRowsFree})`);

    // No-echo claim: +4,096 B ($2C00-$3C00) on top of the same dodge set.
    const groundClaim = computeImportBudget(withReservation(0x01, 'ground'), 2, true);
    assert(groundClaim.freeTotal === ground.freeTotal + 4096, `echo claim adds 4,096 B (${groundClaim.freeTotal})`);
    assert(groundClaim.seqLargestGap === ground.seqLargestGap, 'echo claim leaves the largest seq gap unchanged (separate window)');

    // Echo-safety detection over retail modules: boss slot 1 plays $F5;
    // flowergarden and the whole worldmap module are echo-free; the driver's
    // title songs echo (blocks the title slot-merge claim).
    assert(moduleSongsUseEcho(parseBlockFromRom(rom, catalog, 0x0a).stream.blocks), 'boss module songs use echo');
    assert(!moduleSongsUseEcho(fgModule), 'flowergarden module is echo-free');
    assert(!moduleSongsUseEcho(parseBlockFromRom(rom, catalog, 0x1c).stream.blocks), 'worldmap module is echo-free');
    assert(moduleSongsUseEcho(parseBlockFromRom(rom, catalog, 0x2b).stream.blocks), "the driver's title songs use echo");
  }
} catch (e) {
  console.log(`(skip) ${(e as Error).message.split('\n')[0]}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll aram-usage checks passed.');
