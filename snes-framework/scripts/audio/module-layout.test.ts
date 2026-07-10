// Unit test: audio-region layout (module-layout.ts).
// Run: node snes-framework/scripts/audio/module-layout.test.ts
//
// Pins:
//  - The static AUDIO_BLOBS table reproduces retail ground truth: every
//    label's encoded address, the engine at $500342, the two bank-cross
//    splits ($13F / $34E), and the $50B3FA/19462 free tail; identities and
//    sizes agree with catalog.ts SPC_BLOCKS.
//  - Piece math: pieces are flush against bank boundaries, sum to blob
//    sizes, and boundary migration into a DIFFERENT blob is handled.
//  - Text emission: unchanged sizes pass the real base bank files through
//    byte-exact; a changed layout regenerates parseable bodies with the
//    expected splits + shifted %FREE_BYTES; over-budget throws.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AUDIO_BLOBS,
  AUDIO_REGION_END,
  AUDIO_REGION_START,
  audioBlobSizes,
  planAudioLayout,
  renderAudioBankText,
  renderEngineTitleImport,
  songBlobFileOfLabel,
  type AudioBlobSize,
} from './module-layout.ts';
import { SPC_BLOCKS } from './catalog.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
const throws = (fn: () => void, msg: string): void => {
  let threw = false;
  try { fn() } catch { threw = true }
  assert(threw, msg);
};

const retailSizes = (): AudioBlobSize[] => AUDIO_BLOBS.map((b) => ({ ...b, bytes: b.retailBytes }));

console.log('=== static table vs retail ground truth ===');
{
  // Cross-check against SPC_BLOCKS (same 20 modules, same sizes/kinds).
  assert(AUDIO_BLOBS.length === SPC_BLOCKS.length, '20 blobs');
  for (const blob of AUDIO_BLOBS) {
    const cat = SPC_BLOCKS.find((b) => b.label === blob.label);
    assert(!!cat, `${blob.label} exists in SPC_BLOCKS`);
    if (!cat) continue;
    assert(cat.retailBytes === blob.retailBytes, `${blob.label} retail size matches catalog (${cat.retailBytes} vs ${blob.retailBytes})`);
    assert(
      (cat.kind === 'songs') === (blob.kind === 'song') && (cat.kind === 'engine') === (blob.kind === 'engine'),
      `${blob.label} kind matches catalog`
    );
  }

  const layout = planAudioLayout(retailSizes());
  assert(!layout.changed, 'retail sizes → unchanged');
  // Every DATA_XXXXXX label encodes its own retail address.
  for (const p of layout.placements) {
    const m = /^DATA_([0-9A-F]{6})$/.exec(p.label);
    if (!m) continue;
    const encoded = parseInt(m[1], 16);
    assert(p.start === encoded, `${p.label} placed at ${p.start.toString(16)} (label encodes ${m[1]})`);
  }
  const engine = layout.placements.find((p) => p.label === 'YI_SPCEngine')!;
  assert(engine.start === 0x500342, `engine at $500342 (got $${engine.start.toString(16)})`);
  assert(layout.freeStart === 0x50b3fa && layout.freeBytes === 19462, `free tail $50B3FA/19462 (got $${layout.freeStart.toString(16)}/${layout.freeBytes})`);
  // Retail splits: Bowser crosses 4E→4F at file offset $13F; 4FFCB2 crosses
  // 4F→50 at $34E.
  const bowser = layout.placements.find((p) => p.label === 'DATA_4EFEC1')!;
  assert(0x4f0000 - bowser.start === 0x13f, 'Bowser split at $13F');
  const fccb2 = layout.placements.find((p) => p.label === 'DATA_4FFCB2')!;
  assert(0x500000 - fccb2.start === 0x34e, '4FFCB2 split at $34E');
  assert(songBlobFileOfLabel('DATA_4ED5D0') === 'DATA_4ED5D0.bin', 'song blob file name');
}

console.log('=== piece math: growth + boundary migration ===');
{
  // Grow Flower Garden (DATA_4ED5D0, bank 4E) by 4000 bytes: cumulative 4E
  // content before Bowser grows past the retail $13F split allowance, so the
  // 4E→4F boundary migrates INTO BonusCastleBossGrasslandSampleBank.
  const sizes = retailSizes().map((s) => (s.label === 'DATA_4ED5D0' ? { ...s, bytes: s.bytes + 4000 } : s));
  const layout = planAudioLayout(sizes);
  assert(layout.changed, 'growth → changed');
  assert(layout.freeBytes === 19462 - 4000, `free tail absorbs growth (${layout.freeBytes})`);
  const bonus = layout.placements.find((p) => p.label === 'DATA_4EEC85')!;
  const bowser = layout.placements.find((p) => p.label === 'DATA_4EFEC1')!;
  assert(bonus.start < 0x4f0000 && bonus.end > 0x4f0000, 'boundary migrated into BonusCastle bank blob');
  assert(bowser.start > 0x4f0000, 'Bowser fully in bank 4F now');
  // Placements are gapless and end where free space begins.
  let addr = AUDIO_REGION_START;
  for (const p of layout.placements) {
    assert(p.start === addr, `${p.label} gapless placement`);
    addr = p.end;
  }
  assert(addr === layout.freeStart, 'placements end at freeStart');
}

console.log('=== bank text emission (real base files) ===');
{
  const yiRoot = path.join(import.meta.dirname, '..', '..', 'yi');
  const bankText = (f: string): string => fs.readFileSync(path.join(yiRoot, 'Banks', f), 'utf8');

  // Changed layout: grow Flower Garden by 100 (boundary stays inside Bowser:
  // split becomes $13F-100) and shrink Castle (DATA_4FFCB2) by 30.
  const sizes = retailSizes().map((s) =>
    s.label === 'DATA_4ED5D0' ? { ...s, bytes: s.bytes + 100 } : s.label === 'DATA_4FFCB2' ? { ...s, bytes: s.bytes - 30 } : s
  );
  const layout = planAudioLayout(sizes);
  const t4e = renderAudioBankText(bankText('Bank4E.asm'), layout, 0x4e);
  const t4f = renderAudioBankText(bankText('Bank4F.asm'), layout, 0x4f);
  const t50 = renderAudioBankText(bankText('Bank50.asm'), layout, 0x50);

  assert(t4e.includes('incbin "SPC700/BowserSampleBank.bin":$0..$DB'), `4E: Bowser low split $13F-100 = $DB\n${t4e.split('\n').slice(-8).join('\n')}`);
  assert(t4f.includes('incbin "SPC700/BowserSampleBank.bin":$DB..filesize("SPC700/BowserSampleBank.bin")'), '4F: Bowser continuation from $DB');
  // 4FFCB2 shifted by +100 (Flower Garden growth): retail split $34E → $2EA.
  assert(t4f.includes('incbin "SPC700/DATA_4FFCB2.bin":$0..$2EA'), '4F: 4FFCB2 low split $34E-100 = $2EA');
  assert(t50.includes('incbin "SPC700/DATA_4FFCB2.bin":$2EA..filesize("SPC700/DATA_4FFCB2.bin")'), '50: 4FFCB2 continuation from $2EA');
  // Engine shifts by net +70; free tail shrinks by 70.
  assert(t50.includes('%FREE_BYTES($50B440, 19392, $FF)'), `50: shifted free tail\n${t50.split('\n').slice(-8).join('\n')}`);
  assert(t4e.includes('DATA_4ED5D0:') && t4e.includes('%BANK_START(<StartBank>)') && t50.includes('YI_SPCEngine:'), 'labels + anchors preserved');
  // No stale retail split literals in the regenerated bodies (the header
  // comments above the anchors still mention them — inert).
  const body = (t: string): string => t.slice(t.indexOf('%EnableSuperFXHiROMMirroring'));
  assert(!body(t4e).includes('$13F') && !body(t4f).includes('$34E'), 'no stale retail split literals remain');

  // Over-budget: grow past the free tail.
  const over = retailSizes().map((s) => (s.label === 'DATA_4ED5D0' ? { ...s, bytes: s.bytes + 20000 } : s));
  throws(() => renderAudioBankText(bankText('Bank50.asm'), planAudioLayout(over), 0x50), 'overflow throws');
}

console.log('=== audioBlobSizes (synthetic tree) ===');
{
  // Base assets: every song blob at retail size; one overlaid song grows by
  // 12; one overlaid sample shrinks its bank by 9.
  const tmp = fs.mkdtempSync(path.join(import.meta.dirname, '.layout-test-'));
  try {
    const base = path.join(tmp, 'base');
    const overlay = path.join(tmp, 'overlay');
    for (const b of AUDIO_BLOBS) {
      if (b.kind !== 'song') continue;
      const p = path.join(base, b.file);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, new Uint8Array(b.retailBytes));
    }
    const baseSample = path.join(base, 'SPC700', 'Samples', 'Global', '00.brr');
    fs.mkdirSync(path.dirname(baseSample), { recursive: true });
    fs.writeFileSync(baseSample, new Uint8Array(18));

    const oSong = path.join(overlay, 'SPC700', 'DATA_4ED5D0.bin');
    fs.mkdirSync(path.dirname(oSong), { recursive: true });
    fs.writeFileSync(oSong, new Uint8Array(3241 + 12));
    const oSample = path.join(overlay, 'SPC700', 'Samples', 'Global', '00.brr');
    fs.mkdirSync(path.dirname(oSample), { recursive: true });
    fs.writeFileSync(oSample, new Uint8Array(9));

    const sizes = audioBlobSizes(base, overlay);
    const fg = sizes.find((s) => s.label === 'DATA_4ED5D0')!;
    const global = sizes.find((s) => s.label === 'DATA_4F82E6')!;
    const other = sizes.find((s) => s.label === 'DATA_4E169C')!;
    assert(fg.bytes === 3241 + 12, `overlay song size used (${fg.bytes})`);
    assert(global.bytes === 31180 - 9, `bank size reflects sample delta (${global.bytes})`);
    assert(other.bytes === other.retailBytes, 'non-overlaid song at base size');
    assert(sizes.find((s) => s.kind === 'engine')!.titleImportBytes === undefined, 'no title rider without its overlay');

    // The overlay-only title blob rides inside the engine bin.
    const oTitle = path.join(overlay, 'SPC700', 'TitleImport.bin');
    fs.writeFileSync(oTitle, new Uint8Array(5000));
    const withTitle = audioBlobSizes(base, overlay);
    const engine = withTitle.find((s) => s.kind === 'engine')!;
    assert(engine.titleImportBytes === 5000, 'title rider recorded on the engine');
    assert(engine.bytes === engine.retailBytes + 5000, `engine bytes = retail + title rider (${engine.bytes})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('=== title-import layout (engine-stream splice) ===');
{
  // Layout: the engine grows by the blob; the free tail shrinks; Bank50
  // re-renders with the bigger engine incbin (unlabeled continuation math
  // unchanged — the engine is the last blob).
  const sizes = retailSizes().map((s) => (s.kind === 'engine' ? { ...s, bytes: s.bytes + 5000, titleImportBytes: 5000 } : s));
  const layout = planAudioLayout(sizes);
  assert(layout.freeBytes === 19462 - 5000, `free tail shrinks by the blob (${layout.freeBytes})`);
  assert(layout.changed, 'title import marks the layout changed');
  const yiRoot = path.join(import.meta.dirname, '..', '..', 'yi');
  const t50 = renderAudioBankText(fs.readFileSync(path.join(yiRoot, 'Banks', 'Bank50.asm'), 'utf8'), layout, 0x50);
  assert(t50.includes('%FREE_BYTES($50C782, 14462, $FF)'), 'free tail shifted past the grown engine');

  // Engine asm splice: the incbin lands right before the stream terminator,
  // exact-anchored; a drifted source throws.
  const engineAsm = fs.readFileSync(path.join(yiRoot, 'SPC700', 'SPC700_Engine_YI.asm'), 'utf8');
  const spliced = renderEngineTitleImport(engineAsm);
  assert(/incbin "SPC700\/TitleImport\.bin"\n%EndSPCUploadAndJumpToEngine/.test(spliced), 'incbin spliced before the terminator');
  assert(spliced.length > engineAsm.length, 'splice adds text');
  throws(() => renderEngineTitleImport('no anchors here'), 'drifted engine asm throws');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll module-layout checks passed.');
