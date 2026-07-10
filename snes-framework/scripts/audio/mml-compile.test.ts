// Unit test: MML compiler (AMK + AMY dialects) → YI song module.
// Run: node snes-framework/scripts/audio/mml-compile.test.ts
//
// Pins (fully synthetic — no cart needed):
//  - dialect detection (directives, fingerprints, ambiguity)
//  - AMK front end: notes/lengths/q/loops/superloop-unroll/label loops/'/',
//    replacements, remote codes (key-on inline, timed drop), the hex
//    translation table ($DD/$E8/$ED/$FA$02/$FD/$FE/$EF/$F1…), synthetic
//    instrument rows (GAIN override, noise), '&' portamento, stock-@ fatal
//  - AMY front end: #patterns/#tracks/#local_samples/#instruments, letter
//    commands (j/k/m/s/x/z/~/&), ?vars, %bpm/%adsr, raw YI hex passthrough
//  - module assembly: the built module applies onto a zeroed ARAM and
//    decodeSong round-trips the structure (parts/patterns/tracks/loop),
//    slot patches, budget failures, subroutine dedupe
//  - sticky length emission + >127-tick tie splitting

import { compileMml, compileMmlAs, detectMmlDialect, MmlCompileError, stripEchoVcmds, type CompileMmlOptions } from './mml-compile.ts';
import { buildMmlModule, MmlModuleError, sliceModuleLayers, MML_SEQ_BASE, MML_SAMPLE_DATA_BASE } from './mml-module.ts';
import { decodeSong, type TrackEvent } from './sequence.ts';
import { applyUploadStream, ARAM_SIZE, songSlotPtr } from './aram.ts';
import { parseUploadStream } from './upload-stream.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗ ${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failures++;
  }
}
function throwsWith(fn: () => void, needle: string, msg: string): void {
  try {
    fn();
    assert(false, `${msg} (did not throw)`);
  } catch (e) {
    const s = (e as Error).message;
    assert(s.includes(needle), `${msg} (threw "${s}", wanted "${needle}")`);
  }
}

/** Minimal valid AMK-format .brr: 2-byte loop header + N 9-byte blocks,
 *  last block carries the end flag. */
function fakeBrr(blocks: number, loopOffset = 0): Uint8Array {
  const out = new Uint8Array(2 + blocks * 9);
  out[0] = loopOffset & 0xff;
  out[1] = loopOffset >> 8;
  out[2 + (blocks - 1) * 9] = 0x01; // end flag
  return out;
}

function optsWith(files: Record<string, Uint8Array>): CompileMmlOptions {
  return { readFile: (rel) => files[rel] ?? null };
}

/** Fake cart default table: row[srcn] = srcn, $FF $E0 $B8, tuning 3.0. */
function fakeDefaultRows(): Uint8Array {
  const rows = new Uint8Array(144);
  for (let r = 0; r < 24; r++) rows.set([r, 0xff, 0xe0, 0xb8, 3, 0], r * 6);
  return rows;
}

function optsWithStock(files: Record<string, Uint8Array>): CompileMmlOptions {
  return { readFile: (rel) => files[rel] ?? null, defaultInstrumentRows: fakeDefaultRows() };
}

/** Compile + build + apply onto zeroed ARAM; returns the decoded song. */
function roundTrip(text: string, files: Record<string, Uint8Array>, slots = [1]) {
  const compiled = compileMml(text, optsWith(files));
  const built = buildMmlModule(compiled, slots);
  const { stream, byteLength } = parseUploadStream(built.bytes);
  eq(byteLength, built.bytes.length, 'module bytes parse to their full length');
  const aram = new Uint8Array(ARAM_SIZE);
  applyUploadStream(aram, stream);
  const ptr = songSlotPtr(aram, slots[0]);
  eq(ptr, MML_SEQ_BASE, 'slot patch points at the sequence base');
  return { compiled, built, aram, song: decodeSong(aram, ptr) };
}

const flat = (events: TrackEvent[]): string[] => events.map((e) =>
  e.kind === 'vcmd' ? `${e.name}(${e.args.join(',')})`
  : e.kind === 'length' ? `len${e.ticks}${e.gate !== undefined ? `q${e.gate}${e.velocity}` : ''}`
  : e.kind === 'note' ? `n${e.note.toString(16)}`
  : e.kind);

console.log('=== detection ===');
{
  eq(detectMmlDialect('#amk 2\n#0 c4').dialect, 'amk', '#amk → amk');
  eq(detectMmlDialect('#am4\nstuff').dialect, 'amk', '#am4 → amk family');
  eq(detectMmlDialect('#patterns\n{\n1\n}').dialect, 'amy', '#patterns → amy');
  eq(detectMmlDialect('#instruments\n{\n#default\n}').dialect, 'amy', '#default → amy');
  eq(detectMmlDialect('#0 v200 ~p c4').dialect, 'amy', '~p → amy');
  eq(detectMmlDialect('#0 s24,t60 c4').dialect, 'amy', 's-fade → amy');
  eq(detectMmlDialect('#spc\n{\n#title "x"\n}\n#0 c4').dialect, 'amk', '#spc fingerprint → amk');
  eq(detectMmlDialect('#0 [[c4]]2').dialect, 'amk', 'superloop fingerprint → amk');
  eq(detectMmlDialect('#0 c4 d4 e4').dialect, null, 'bare MML → ambiguous');
}

console.log('=== AMK: notes, sticky lengths, structure ===');
{
  const { song, compiled } = roundTrip('#amk 2\n#0 t65 l8 o4 c c c d16 r4 ^8\n', {});
  assert(compiled.report.length === 0, `clean song has empty report (got: ${compiled.report.join(' | ')})`);
  eq(song.parts.map((p) => p.kind), ['pattern', 'loop', 'end'], 'no-intro song loops to itself');
  const pat = song.patterns.get(song.parts[0].kind === 'pattern' ? (song.parts[0] as { addr: number }).addr : 0)!;
  const track = song.tracks.get(pat.trackAddrs[0])!;
  eq(
    flat(track.events),
    ['tempo(65)', 'len24q715', 'na4', 'na4', 'na4', 'len12', 'na6', 'len72', 'rest'],
    'voice 0 event stream (sticky lengths, r4^8 merges into one event)',
  );
  eq(pat.trackAddrs.slice(1), [0, 0, 0, 0, 0, 0, 0], 'unused voices are silent');
}

console.log('=== AMK: intro/loop split + noloop ===');
{
  const { song } = roundTrip('#amk 2\n#0 c4 / d4\n#1 e4 / f4\n', {});
  eq(song.parts.map((p) => p.kind), ['pattern', 'pattern', 'loop', 'end'], 'intro song part kinds');
  const loopPart = song.parts[2] as { kind: 'loop'; count: number; target: number };
  eq(loopPart.count, 0xff, 'loop count $FF (goto idiom)');
  eq(loopPart.target, MML_SEQ_BASE + 2, 'loop target = second part entry');
  const { song: once } = roundTrip('#amk 2\n#option noloop\n#0 c4\n', {});
  eq(once.parts.map((p) => p.kind), ['pattern', 'end'], 'noloop song ends');
}

console.log('=== AMK: loops, label loops, *, superloop unroll ===');
{
  const { song } = roundTrip('#amk 2\n#0 l8 (intro)[c d]2 e *3 (intro)4 [[f g]]2\n', {});
  const pat = song.patterns.get((song.parts[0] as { addr: number }).addr)!;
  const track = song.tracks.get(pat.trackAddrs[0])!;
  const subs = track.events.filter((e) => e.kind === 'vcmd' && e.op === 0xef);
  eq(subs.length, 4, 'four subroutine calls (def-play, *, label call, packed superloop)');
  eq((subs[0] as { args: number[] }).args[2], 2, 'first call count 2');
  eq((subs[1] as { args: number[] }).args[2], 3, '* recall count 3');
  eq((subs[2] as { args: number[] }).args[2], 4, 'label call count 4');
  const subAddr = (subs[0] as { args: number[] }).args[0] | ((subs[0] as { args: number[] }).args[1] << 8);
  const sub = song.tracks.get(subAddr)!;
  assert(song.subroutineAddrs.has(subAddr), 'loop body decoded as a subroutine');
  eq(flat(sub.events), ['len24q715', 'na4', 'na6'], 'loop body events');
  // Call-free superloops pack as a subroutine called ×count instead of
  // unrolling — same replayed bytes, fraction of the size.
  const sl = subs[3] as { args: number[] };
  eq(sl.args[2], 2, 'packed superloop count 2');
  const slBody = song.tracks.get(sl.args[0] | (sl.args[1] << 8))!;
  // No length byte: the preceding (intro)4 call leaves the driver's
  // length/qv registers at the body's tail (len24 q715), which f/g inherit —
  // sticky state flows THROUGH subroutine calls instead of re-syncing after.
  eq(flat(slBody.events), ['na9', 'nab'], 'packed superloop body');
  assert(track.events[track.events.length - 1] === subs[3], 'the call is the last event (segment replaced)');
}

console.log('=== AMK: hex translation ===');
{
  const src = `#amk 2
#0 o3 v200 y10 c4 $DD $06 $18 d $E8 $30 $80 $FA $02 $F4 $FD $FE $EF $7F $60 $60 $F1 $01 $40 $01 $DF
`;
  const { song, compiled } = roundTrip(src, {});
  const pat = song.patterns.get((song.parts[0] as { addr: number }).addr)!;
  const names = flat(song.tracks.get(pat.trackAddrs[0])!.events);
  assert(names.includes('pitchSlide(6,24,154)'), `$DD → $F9 with note arg (got ${names.join(' ')})`);
  assert(names.includes('channelVolumeFade(48,128)'), '$E8 → $EE');
  assert(names.includes('channelTranspose(244)'), '$FA $02 → $EA');
  assert(names.includes('tremoloOff()'), '$FD → $EC');
  assert(names.includes('pitchEnvelopeOff()'), '$FE → $F3');
  assert(names.includes('echoOn(127,96,96)'), '$EF → $F5');
  assert(names.includes('echoParams(1,64,1)'), '$F1 → $F7');
  assert(names.includes('vibratoOff()'), '$DF → $E4');
  assert(compiled.report.length === 0, `no warnings for clean translations (got: ${compiled.report.join(' | ')})`);
}

console.log('=== AMK: synthetic rows (GAIN override, noise, sample load) ===');
{
  const files = { 'snd/kick.brr': fakeBrr(2), 'snd/lead.brr': fakeBrr(3, 9) };
  const src = `#amk 2
#path "snd"
#samples
{
  #optimized
  "kick.brr"
  "lead.brr"
}
#instruments
{
  "kick.brr" $FF $E0 $B8 $03 $00
  "lead.brr" $8F $C0 $7F $06 $00
}
#0 @30 c4 $ED $80 $50 d4 $ED $80 $50 e4 n1F f4 @31 g4
`;
  const { compiled, built } = roundTrip(src, files);
  // rows: 2 customs + 1 gain-override clone (deduped across the two $ED) + 1 noise clone
  eq(compiled.instrumentRows.length, 4, 'row count: customs + deduped gain + noise');
  eq(compiled.instrumentRows[2].bytes[3], 0x50, 'gain override row has the new GAIN');
  eq(compiled.instrumentRows[2].bytes[1] & 0x80, 0, 'gain override row disables ADSR');
  eq(compiled.instrumentRows[3].bytes[0], 0x80 | 0x1f, 'noise row SRCN = noise mode | clock');
  eq(compiled.samples.length, 2, 'both samples loaded');
  eq(compiled.samples[1].loopOffset, 9, 'loop header parsed');
  assert(built.sampleBytes === 2 * 9 + 3 * 9, 'BRR payloads packed (headers stripped)');
}

console.log('=== AMK: remote codes ===');
{
  const src = `#amk 2
(!7)[$FA $02 $02]
#0 o4 (!7,-1) c4 d4 (!7,0) e4 (!9,1,=4) f4
(!9)[$FA $02 $00]
`;
  const compiled = compileMml(src, optsWith({}));
  const track = compiled.trackEvents[0];
  const transposes = track.filter((e) => e.kind === 'vcmd' && e.op === 0xea);
  eq(transposes.length, 2, 'key-on remote inlined before c and d only');
  assert(compiled.report.some((r) => r.includes('timed/key-off')), 'timed remote event reported as dropped');
}

console.log('=== AMK: & portamento + arpeggio unroll + stock-@ fatal ===');
{
  const { compiled } = roundTrip('#amk 2\n#0 o4 c4&d4\n', {});
  const names = flat(compiled.trackEvents[0]);
  assert(names.includes('pitchSlide(0,48,166)'), `& → note + $F9 + tie (got ${names.join(' ')})`);
  assert(names[names.length - 1] === 'tie', '& target rides a tie');

  const { compiled: gliss } = roundTrip('#amk 2\n#0 o4 $FB $81 $06 $FF c=18\n', {});
  const notes = gliss.trackEvents[0].filter((e) => e.kind === 'note');
  eq(notes.map((n) => (n as { note: number }).note), [0xa4, 0xa3, 0xa2], 'glissando starts on the base note, stepping down');

  throwsWith(() => compileMml('#amk 2\n#0 @0 c4\n', optsWith({})), 'internal wiring', 'stock mapping without the cart table is actionable');
  const amk1 = compileMml('#amk 1\n#0 c4\n', optsWith({}));
  assert(amk1.report.some((r) => r.includes('quieter velocity table')), '#amk 1 accepted with the vtable note');
  // #halvetempo: durations + tempo halve, LFO rates double.
  const halved = compileMml('#amk 2\n#halvetempo\n#0 t100 c4 p10,20,30 $DD $08 $10 c $E3 $20 $60\n', optsWith({}));
  const hn = flat(halved.trackEvents[0]);
  assert(hn.includes('tempo(50)'), 't100 → 50 under #halvetempo');
  assert(hn.includes('len24q715'), 'c4 → 24 ticks');
  assert(hn.includes('vibratoOn(5,40,30)'), 'vibrato delay ÷2, rate ×2, depth kept');
  assert(hn.includes('pitchSlide(4,8,164)'), '$DD delay/length ÷2');
  assert(hn.includes('tempoFade(16,48)'), '$E3 fade ticks and target tempo ÷2');
  throwsWith(() => compileMml('#amk 2\n#0 c4\n#halvetempo\n', optsWith({})), 'precede channel data', '#halvetempo after channels rejected');
}

console.log('=== AMK: SMW stock-instrument mapping ===');
{
  const src = `#amk 2
#instruments
{
	@3 $FB $F0 $B8 $06 $00
}
#0 @0 c4 @2 c4 @30 c4 @21 c4 d4
`;
  const compiled = compileMml(src, optsWithStock({}));
  // @30 = derived from @3 (marimba): port tuning 6.0 over SMW base 3.0,
  // fake YI tuning 3.0 → 6.0; sample mapped to Vibraphone ($03).
  eq(compiled.instrumentRows[0].bytes, [0x03, 0xfb, 0xf0, 0xb8, 6, 0], '@3-derived row maps to Vibraphone with corrected tuning');
  const rows = compiled.instrumentRows.map((r) => r.bytes.join(','));
  assert(rows.includes([0x10, 0xfe, 0x6a, 0xb8, 3, 0].join(',')), '@0 flute → Recorder at YI tuning');
  // @2 xylophone: AMK subtracts tmpTrans 5 from emitted notes; our verbatim
  // notes need the row tuned DOWN: 3.0 × 2^(-5/12) ≈ 2.2472 → [2, 63]
  assert(rows.includes([0x0e, 0xae, 0x2f, 0xb8, 2, 63].join(',')), '@2 → Glock with the -5 semitone fold');
  const notes = compiled.trackEvents[0].filter((e) => e.kind === 'note').map((e) => (e as { note: number }).note);
  eq(notes.slice(-2), [0xa8, 0xa8], 'percussion @21 notes play the fixed pitch');
  assert(compiled.report.some((r) => r.includes('mapped to YI')), 'every mapping lands in the port report');
}

console.log('=== AMK: grassland real drums (resident + carried) ===');
{
  const files = { 'x.brr': fakeBrr(2) };
  const src = `#amk 2
#samples
{
"x.brr"
}
#instruments
{
"x.brr" $FF $E0 $B8 $03 $00
}
#0 @21 c4 @30 c4
`;
  // Plain compile: approximation + the availability tip.
  const plain = compileMml(src, optsWithStock(files));
  assert(plain.report.some((r) => r.includes('tip:')), 'plain mode hints at the real-drum upgrade');
  eq(plain.instrumentRows[0].bytes[0], 0x18, 'plain custom SRCN base $18');

  const fgRows = new Uint8Array(24);
  for (let r = 0; r < 4; r++) fgRows.set([0x18 + r, 0xff, 0xe0, 0xb8, 2, 0], r * 6);

  // Resident mode: real Kick referenced, customs shift to $1C, samples after the seq.
  const g = compileMml(src, {
    readFile: (rel) => files[rel as keyof typeof files] ?? null,
    defaultInstrumentRows: fakeDefaultRows(),
    grasslandBank: { rows: fgRows, resident: true },
  });
  assert(g.usedGrasslandDrums, 'resident: grassland drums used');
  assert(g.report.some((r) => r.includes('real Kick') && r.includes('add-on bank')), 'resident report names the bank');
  eq(g.sampleSrcnBase, 0x1c, 'resident: custom SRCN base shifts to $1C');
  eq(g.instrumentRows[0].bytes[0], 0x1c, 'resident: custom row references $1C');
  const kickRow = g.instrumentRows.find((r) => r.bytes[0] === 0x18)!;
  eq(kickRow.bytes, [0x18, 0x0f, 0x6a, 0x7f, 2, 0], 'resident: Kick row uses the fg_set tuning');
  const gBuilt = buildMmlModule(g, [1]);
  const gDir = gBuilt.stream.blocks.find((b) => b.dest >= 0x3c00 && b.dest < 0x3d00)!;
  eq(gDir.dest, 0x3c70, 'resident: dir entries start at $3C70 (add-on keeps $18-$1B)');
  // Small samples first-fit into the engine-tail window ($230E-$264B) ahead
  // of the sequence tail since the placement windows landed (2026-07-09).
  const gData = gBuilt.stream.blocks.find((b) => b.data.length === 18)!;
  eq(gData.dest, 0x230e, 'resident: custom BRR first-fits into the engine tail');

  // Carry mode: the drum BRR rides the module as a custom sample at $B960.
  const kickBrr = fakeBrr(3, 9);
  const c = compileMml(src, {
    readFile: (rel) => files[rel as keyof typeof files] ?? null,
    defaultInstrumentRows: fakeDefaultRows(),
    grasslandBank: { rows: fgRows, resident: false, kick: { data: kickBrr.slice(2), loopOffset: 9 } },
  });
  assert(c.usedGrasslandDrums, 'carry: grassland drums used');
  assert(c.report.some((r) => r.includes('real Kick') && r.includes('carried into the module')), 'carry report says carried');
  eq(c.sampleSrcnBase, 0x18, 'carry: custom SRCN base stays $18');
  eq(c.samples.length, 2, 'carry: kick BRR joins the custom samples');
  eq(c.samples[1].name, '(YI Kick)', 'carry: synthetic sample name');
  const cKick = c.instrumentRows.find((r) => r.source.includes('kick'))!;
  eq(cKick.bytes.slice(0, 4), [0x19, 0x0f, 0x6a, 0x7f], 'carry: Kick row references the carried slot ($18+1)');
  eq(cKick.bytes.slice(4), [2, 0], 'carry: Kick row keeps the fg tuning');
  const cBuilt = buildMmlModule(c, [1]);
  const cDir = cBuilt.stream.blocks.find((b) => b.dest >= 0x3c00 && b.dest < 0x3d00)!;
  eq(cDir.dest, 0x3c60, 'carry: dir entries start at $3C60');
  eq(cDir.data.length, 8, 'carry: two dir entries (custom + kick)');
  assert(cBuilt.stream.blocks.some((b) => b.dest === 0x230e && b.data.length === 18 + 27), 'carry: BRR data (custom + kick) first-fits into the engine tail');
}

console.log('=== AMK: packaged extra samples (Pan Flute / Brass) ===');
{
  const flute = fakeBrr(4, 18);
  const brass = fakeBrr(3, 9);
  const src = '#amk 2\n#0 @0 c4 @6 d4\n';
  const c = compileMml(src, {
    readFile: () => null,
    defaultInstrumentRows: fakeDefaultRows(),
    packagedSamples: {
      panFlute: { data: flute.slice(2), loopOffset: 18 },
      brass: { data: brass.slice(2), loopOffset: 9 },
    },
  });
  assert(c.usedPackagedSamples, 'packaged samples used');
  assert(c.report.some((r) => r.includes('packaged Pan Flute')), 'flute report line');
  assert(c.report.some((r) => r.includes('packaged Brass')), 'brass report line');
  eq(c.samples.map((x) => x.name), ['(Pan Flute)', '(Brass)'], 'both carried once');
  // @0: canonical %pitch(1700) = round(768×2^(17/12)) = 2050 → 8.0078 ×(6/6) → [8, 2].
  const fluteRow = c.instrumentRows.find((r) => r.bytes[0] === 0x18)!;
  eq(fluteRow.bytes.slice(4), [8, 2], 'flute tuning from the canonical %pitch(1700), 768-based');
  // @6: %pitch(1200) = 1536 → 6.0 ×(3/3) → [6, 0].
  const brassRow = c.instrumentRows.find((r) => r.bytes[0] === 0x19)!;
  eq(brassRow.bytes.slice(4), [6, 0], 'brass tuning from the canonical %pitch(1200), 768-based');
  // Without the option: global approximations (Recorder / Trumpet).
  const plain = compileMml(src, optsWithStock({}));
  assert(!plain.usedPackagedSamples && plain.samples.length === 0, 'plain mode carries nothing');
}

console.log('=== AMK: replacements + preprocessor ===');
{
  const src = `#amk 2
"FOO = v100 y5"
#define LOUD 1
#0 FOO c4
#ifdef LOUD
w220
#endif
#ifndef LOUD
w10
#endif
`;
  const compiled = compileMml(src, optsWith({}));
  const names = flat(compiled.trackEvents[0]);
  assert(names.includes('channelVolume(100)') && names.includes('pan(5)'), 'replacement expands');
  assert(names.includes('songVolume(220)'), '#ifdef branch taken');
  assert(!names.includes('songVolume(10)'), '#ifndef branch skipped');
}

console.log('=== AMY: letters, ?vars, %macros, hex passthrough ===');
{
  const src = `#0 :?vol = "v180":
%bpm(100) ?vol y10,0,1 k-2 m12,24,-3 s48,v90 x10000001,-32,32 z2,-69,1 ~m ~x &0,24,36 $E7 $41 c4 d4 / e4
`;
  const compiled = compileMmlAs('amy', src, optsWith({}));
  const names = flat(compiled.trackEvents[0]);
  assert(names.includes('tempo(41)'), '%bpm(100) → t41');
  assert(names.includes('channelVolume(180)'), '?var expands');
  assert(names.includes('pan(138)'), 'y10,0,1 → pan | surround-R bit');
  assert(names.includes('channelTranspose(254)'), 'k-2 signed');
  assert(names.includes('pitchEnvelopeTo(12,24,253)'), 'm → $F1');
  assert(names.includes('channelVolumeFade(48,90)'), 's48,v → $EE');
  assert(names.includes('echoOn(129,224,32)'), 'x binary vbits + signed vols');
  assert(names.includes('echoParams(2,187,1)'), 'z → $F7');
  assert(names.includes('pitchEnvelopeOff()'), '~m → $F3');
  assert(names.includes('echoOff()'), '~x → $F6');
  assert(names.includes('pitchSlide(0,24,164)'), '& delay,dur,note');
  assert(names.includes('tempo(65)'), 'raw $E7 passthrough');
  // '/' default-mode split still works in AMY
  eq(compiled.parts.length, 2, 'AMY default-mode intro split');
  eq(compiled.loopPartIndex, 1, 'loops to the post-/ pattern');
}

console.log('=== AMY: #patterns/#tracks/#local_samples/#instruments ===');
{
  const files = { 'samples/tom.brr': fakeBrr(2, 9) };
  const src = `
#local_samples
{
  "tom.brr"
  "tom.brr"
}
#instruments
{
  $18 $FF $E0 $B8 $03 $00
  "tom.brr" $8F $C0 $7F $04 $00
}
#patterns
{
  1 / 2 2
}
#tracks
{
  0 1 -1 -1 -1 -1 -1 -1
  2 -1 -1 -1 -1 -1 -1 -1
}
#0 @0 o4 c4 d4
#1 @1 o3 g2
#2 @0 o4 e4 [f4]2
`;
  const { compiled, song } = roundTrip(src, files);
  eq(compiled.dirEntries.length, 2, 'aliased local sample gets two dir entries');
  eq(compiled.samples.length, 1, '…but one payload');
  eq(compiled.instrumentRows.length, 2, 'raw row + sample row');
  eq(compiled.instrumentRows[1].bytes[0], 0x18, 'sample row SRCN = first local slot');
  eq(song.parts.map((p) => p.kind), ['pattern', 'pattern', 'pattern', 'loop', 'end'], 'parts follow #patterns');
  const loop = song.parts[3] as { target: number };
  eq(loop.target, MML_SEQ_BASE + 2, "'/' loop lands on the second entry");
  const pat0 = song.patterns.get((song.parts[0] as { addr: number }).addr)!;
  assert(pat0.trackAddrs[0] !== 0 && pat0.trackAddrs[1] !== 0, 'pattern 1 has tracks 0+1');
  eq(pat0.trackAddrs.slice(2), [0, 0, 0, 0, 0, 0], 'rest silent');
  const pat1 = song.patterns.get((song.parts[1] as { addr: number }).addr)!;
  assert(pat1.trackAddrs[0] !== 0 && pat1.trackAddrs[1] === 0, 'pattern 2 has only track 2 on voice 0');
  assert(song.parts[1] !== song.parts[2] && (song.parts[1] as { addr: number }).addr === (song.parts[2] as { addr: number }).addr, 'repeated pattern deduped by address');
}

console.log('=== AMY: #N=continue chains ===');
{
  const src = `
#patterns
{
  1 2
}
#tracks
{
  0 -1 -1 -1 -1 -1 -1 -1
  1 -1 -1 -1 -1 -1 -1 -1
}
#0 o4 c4 d4
#1=continue e4 f4
`;
  const { song, aram } = roundTrip(src, {});
  const pat0 = song.patterns.get((song.parts[0] as { addr: number }).addr)!;
  const pat1 = song.patterns.get((song.parts[1] as { addr: number }).addr)!;
  const t0 = song.tracks.get(pat0.trackAddrs[0])!;
  const t1 = song.tracks.get(pat1.trackAddrs[0])!;
  // Track 0's stream runs THROUGH track 1's window to the single terminator.
  eq(flat(t0.events), ['len48q715', 'na4', 'na6', 'len48q715', 'na8', 'na9'], 'head stream flows into the continuation');
  eq(flat(t1.events), ['len48q715', 'na8', 'na9'], 'continuation window starts mid-stream');
  eq(pat1.trackAddrs[0], pat0.trackAddrs[0] + 4, 'window address = head + head-bytes (no terminator between)');
  assert(aram[pat1.trackAddrs[0] - 1] !== 0x00, 'no terminator before the window');
}

console.log('=== AMY: unsupported constructs are actionable ===');
{
  throwsWith(() => compileMmlAs('amy', '#0 @kit1 c4', optsWith({})), 'drum kits', '@kitname diagnostic');
  throwsWith(() => compileMmlAs('amy', '#0 %scale(1,2,3)', optsWith({})), '%scale', 'unsupported macro diagnostic');
  throwsWith(() => compileMmlAs('amy', '#5=continue\nc4', optsWith({})), 'continue', '#N=continue diagnostic');
  throwsWith(() => compileMmlAs('amy', '#instruments\n{\n#default\n}\n#0 c4', optsWith({})), '#default needs', '#default without cart rows');
}

console.log('=== tick math: >127 split, =ticks, triplets, dots ===');
{
  const compiled = compileMml('#amk 2\n#0 o4 c=150 {d4 e4 f4} g4..\n', optsWith({}));
  const names = flat(compiled.trackEvents[0]);
  eq(names.slice(0, 4), ['len96q715', 'na4', 'len54', 'tie'], 'c=150 splits 96+54');
  assert(names.includes('len32'), 'triplet quarter = 32 ticks');
  assert(names.includes('len84'), 'double-dotted quarter = 84 ticks');
}

console.log('=== budgets ===');
{
  // A single sample too big for the window AND tail — now downsamples to fit.
  const big = { 'x.brr': fakeBrr(1400, 9 * 700) }; // 12600 B, loop mid-sample
  const bigSrc2 = `#amk 2
#samples
{
"x.brr"
}
#instruments
{
"x.brr" $FF $E0 $B8 $06 $00
}
#0 @30 c4
`;
  const fitted = buildMmlModule(compileMml(bigSrc2, optsWith(big)), [1]);
  assert(fitted.warnings.some((w) => w.includes('downsampled ×2')), 'oversize sample downsampled to fit');
  throwsWith(
    () => buildMmlModule(compileMml(bigSrc2, optsWith(big)), [1], { downsampleToFit: false }),
    'Enable "Downsample samples to fit"',
    'downsampling off = hard budget error with guidance'
  );
  assert(fitted.sampleBytes <= 6300, `downsampled size (${fitted.sampleBytes})`);
  const dsRow = new Uint8Array(fitted.stream.blocks.find((b) => b.dest === 0x3d00)!.data);
  eq([dsRow[4], dsRow[5]], [3, 0], 'tuning halved to compensate (6.0 → 3.0)');
  const dsDir = new Uint8Array(fitted.stream.blocks.find((b) => b.dest >= 0x3c00 && b.dest < 0x3d00)!.data);
  const dsStart = dsDir[0] | (dsDir[1] << 8);
  const dsLoop = dsDir[2] | (dsDir[3] << 8);
  assert((dsLoop - dsStart) % 9 === 0 && dsLoop - dsStart <= fitted.sampleBytes, 'loop stays block-aligned inside the sample');

  // Even downsampling can't rescue 8 huge samples (min ~3.15 KB each).
  const manyFiles: Record<string, Uint8Array> = {};
  let manySrc = '#amk 2\n#samples\n{\n';
  for (let i = 0; i < 8; i++) {
    manyFiles[`h${i}.brr`] = fakeBrr(1400);
    manySrc += `"h${i}.brr"\n`;
  }
  manySrc += '}\n#instruments\n{\n';
  for (let i = 0; i < 8; i++) manySrc += `"h${i}.brr" $FF $E0 $B8 $03 $00\n`;
  manySrc += '}\n#0 @30 c4\n';
  throwsWith(() => buildMmlModule(compileMml(manySrc, optsWith(manyFiles)), [1]), 'even after downsampling', 'sample budget still enforced past the downsample floor');

  // Sequence over $D000-$FF8D — superloops CONTAINING loop calls must
  // unroll (packing is impossible), so this still overflows.
  const longSrc = '#amk 2\n#0 o4 l16 (x)[c d e f]1\n' + '[[(x)2 c d e f g a b > c d e f g a b <]]99\n'.repeat(12);
  throwsWith(() => buildMmlModule(compileMml(longSrc, optsWith({})), [1]), 'sequence data', 'sequence budget enforced');

  // Instrument table cap
  let rows = '#amk 2\n#samples\n{\n"x.brr"\n}\n#instruments\n{\n';
  for (let i = 0; i < 49; i++) rows += '"x.brr" $FF $E0 $B8 $03 $00\n';
  rows += '}\n#0 @30 c4\n';
  throwsWith(() => compileMml(rows, optsWith({ 'x.brr': fakeBrr(1) })), 'instrument table overflow', 'row cap enforced');
}

console.log('=== slot patches + subroutine dedupe ===');
{
  const compiled = compileMml('#amk 2\n#0 l8 [c d]2 e [c d]3\n', optsWith({}));
  const built = buildMmlModule(compiled, [1, 2, 3, 9]);
  const slotBlocks = built.stream.blocks.filter((b) => b.dest >= 0xff8e);
  eq(slotBlocks.length, 2, 'contiguous slots coalesce (1-3, 9)');
  eq(slotBlocks[0].data.length, 6, 'slots 1-3 in one block');
  assert(built.warnings.some((w) => w.includes('slots')), 'multi-slot warning');
  // identical loop bodies share one subroutine body in ARAM
  const aram = new Uint8Array(ARAM_SIZE);
  applyUploadStream(aram, built.stream);
  const song = decodeSong(aram, songSlotPtr(aram, 9));
  eq(song.subroutineAddrs.size, 1, 'identical loop bodies deduped');
}

console.log('=== EDL clamp + auto-detect entry ===');
{
  const compiled = compileMml('#amk 2\n#0 c4 $F1 $05 $40 $01\n', optsWith({}));
  assert(compiled.report.some((r) => r.includes('echo delay 5 clamped to 2')), 'EDL 5 reported as clamped');
  const echo = compiled.trackEvents[0].find((e) => e.kind === 'vcmd' && e.op === 0xf7) as { args: number[] };
  eq(echo.args[0], 2, 'emitted echoParams delay actually clamped');
  const amy = compileMmlAs('amy', '#0 z4,-69,1 $F7 $03 $10 $00 c4', optsWith({}));
  const echoes = amy.trackEvents[0].filter((e) => e.kind === 'vcmd' && e.op === 0xf7) as { args: number[] }[];
  eq(echoes.map((e) => e.args[0]), [2, 2], 'AMY z + raw $F7 both clamp');
  const safe = compileMml('#amk 2\n#0 c4 $F1 $02 $40 $01\n', optsWith({}));
  assert(!safe.report.some((r) => r.includes('echo delay')), 'EDL 2 imports silently');
  // Jingle-free targets (echoDelayLimit 3): EDL 3 passes silently, EDL ≥ 4
  // still clamps (to 3), and limits above 3 are ignored.
  const relaxed = compileMml('#amk 2\n#0 c4 $F1 $03 $40 $01\n', { ...optsWith({}), echoDelayLimit: 3 });
  const relaxedEcho = relaxed.trackEvents[0].find((e) => e.kind === 'vcmd' && e.op === 0xf7) as { args: number[] };
  eq(relaxedEcho.args[0], 3, 'EDL 3 kept under limit 3');
  assert(!relaxed.report.some((r) => r.includes('echo delay')), 'EDL 3 under limit 3 imports silently');
  const relaxedHigh = compileMml('#amk 2\n#0 c4 $F1 $05 $40 $01\n', { ...optsWith({}), echoDelayLimit: 3 });
  const relaxedHighEcho = relaxedHigh.trackEvents[0].find((e) => e.kind === 'vcmd' && e.op === 0xf7) as { args: number[] };
  eq(relaxedHighEcho.args[0], 3, 'EDL 5 clamps to 3 under limit 3');
  assert(relaxedHigh.report.some((r) => r.includes('echo delay 5 clamped to 3')), 'EDL 5 → 3 reported');
  const overLimit = compileMml('#amk 2\n#0 c4 $F1 $04 $40 $01\n', { ...optsWith({}), echoDelayLimit: 9 });
  const overLimitEcho = overLimit.trackEvents[0].find((e) => e.kind === 'vcmd' && e.op === 0xf7) as { args: number[] };
  eq(overLimitEcho.args[0], 3, 'limit above 3 is capped at 3');
  throwsWith(() => compileMml('c4 d4', optsWith({})), 'cannot detect', 'ambiguous input names the problem');
}

console.log('=== audit batch: tie chains, #amk1 forms, bar, @@, AMY tolerance ===');
{
  // c4^8 under a gate = ONE event (the gate fraction applies to all 72 ticks).
  const tied = compileMml('#amk 2\n#0 o4 q3a c4^8 d4\n', optsWith({}));
  eq(flat(tied.trackEvents[0]).slice(0, 3), ['len72q310', 'na4', 'len48'], 'c4^8 merges into one 72-tick event');

  // '|' bars are no-ops; AMK keeps per-track o/l across #N re-entry.
  const multi = compileMml('#amk 2\n#0 o5 l16 | c\n#1 c4\n#0 c |\n', optsWith({}));
  const pitches = multi.trackEvents[0].filter((e) => e.kind === 'note').map((e) => (e as { note: number }).note);
  eq(pitches, [0xb0, 0xb0], "#0 re-entry keeps o5 (AMK per-track state; '|' ignored)");

  // @@N emits like @N; @19/@20 are warned no-ops; #amk=2 with '=' parses.
  const at = compileMml('#amk=2\n#samples\n{\n"x.brr"\n}\n#instruments\n{\n"x.brr" $FF $E0 $B8 $03 $00\n}\n#0 @@30 c4 @19 d4\n', optsWith({ 'x.brr': fakeBrr(1) }));
  assert(at.trackEvents[0].some((e) => e.kind === 'vcmd' && e.op === 0xe0), '@@30 emits setInstrument');
  assert(at.report.some((r) => r.includes('@19')), '@19 warned as a no-op');

  // #amk 1: accepted with the SMW-vtable note; legacy $FC is 2 bytes.
  const amk1 = compileMml('#amk 1\n#0 c4 $FC $10 $50 d4\n', optsWith({}));
  assert(amk1.report.some((r) => r.includes('anticipation-gain')), 'legacy 2-byte $FC consumed + dropped');
  eq(amk1.trackEvents[0].filter((e) => e.kind === 'note').length, 2, 'stream not mis-framed by legacy $FC');

  // AMY tolerance: junk chars skip with a note; FIR clamps; @N row warn.
  const amy = compileMmlAs('amy', '#0 _ z2,-69,9 @9 c4', optsWith({}));
  assert(amy.report.some((r) => r.includes("stray '_'")), 'AMY skips junk characters');
  assert(amy.report.some((r) => r.includes('FIR preset 9 clamped')), 'FIR clamps to 3');
  assert(amy.report.some((r) => r.includes('@9 is past')), 'AMY @N past the table warns, still emits');
}

console.log('=== slot-targeted merge (base module preserved) ===');
{
  const files = { 'a.brr': fakeBrr(2), 'b.brr': fakeBrr(3) };
  const mmlA = '#amk 2\n#samples\n{\n"a.brr"\n}\n#instruments\n{\n"a.brr" $FF $E0 $B8 $03 $00\n}\n#0 @30 c4 d4\n';
  const mmlB = '#amk 2\n#samples\n{\n"b.brr"\n}\n#instruments\n{\n"b.brr" $FF $E0 $B8 $02 $00\n}\n#0 @30 e4 f4 g4\n';
  const baseBuilt = buildMmlModule(compileMml(mmlA, optsWith(files)), [1]);
  const merged = buildMmlModule(compileMml(mmlB, optsWith(files)), [2], { base: baseBuilt.stream });

  const aram = new Uint8Array(ARAM_SIZE);
  applyUploadStream(aram, parseUploadStream(merged.bytes).stream);

  // Slot 1 keeps the base song; slot 2 plays the merged one elsewhere.
  const ptrA = songSlotPtr(aram, 1);
  const ptrB = songSlotPtr(aram, 2);
  eq(ptrA, baseBuilt.songAddr, 'slot 1 still points at the base song');
  assert(ptrB !== 0 && ptrB !== ptrA, 'slot 2 points at the merged song');
  const notesOf = (ptr: number) =>
    [...decodeSong(aram, ptr).tracks.values()].flatMap((t) => t.events.filter((e) => e.kind === 'note')).length;
  eq(notesOf(ptrA), 2, 'base song decodes intact (2 notes)');
  eq(notesOf(ptrB), 3, 'merged song decodes (3 notes)');

  // The new song's instrument row appends after the base's 1-row table and
  // its setInstrument arg shifts to match; its sample takes the next free
  // dir slot ($19 — the base custom took $18).
  const e0 = [...decodeSong(aram, ptrB).tracks.values()]
    .flatMap((t) => t.events)
    .find((e) => e.kind === 'vcmd' && e.op === 0xe0) as { args: number[] };
  eq(e0.args[0], 1, "merged song's setInstrument arg shifted past the base row");
  eq(aram[0x3d00 + 6], 0x19, 'appended row references the next free dir slot');
  assert(aram[0x3c64] !== 0 || aram[0x3c65] !== 0, "the new sample's dir entry landed at $3C64");
  assert(merged.bytes.length > baseBuilt.bytes.length, 'merged blob carries the base blocks');

  // Import layers: re-importing a slot drops its old layer from the merge
  // base — repeated imports stay byte-stable instead of accreting the
  // orphaned data (the double-import budget bug). Simulates the importer's
  // decompose→rebuild cycle over three imports.
  const compiledB2 = compileMml(mmlB, optsWith(files));
  const first = buildMmlModule(compiledB2, [2], { base: baseBuilt.stream });
  const layers1 = [{ slot: 2, firstBlock: baseBuilt.stream.blocks.length }];
  const sliced = sliceModuleLayers(first.stream.blocks, layers1, 2);
  eq(sliced.kept.length, 0, "the replaced slot's old layer is dropped");
  eq(sliced.baseBlocks.length, baseBuilt.stream.blocks.length, 'the immutable base is preserved');
  const second = buildMmlModule(compiledB2, [2], {
    base: { blocks: [...sliced.baseBlocks, ...sliced.kept.flatMap((l) => l.blocks)], entry: 0x0400 },
  });
  eq([...second.bytes], [...first.bytes], 're-import of the same song is byte-identical (no accretion)');
  // A second slot stacks; replacing the first keeps the second's layer.
  const third = buildMmlModule(compileMml(mmlA, optsWith(files)), [3], { base: second.stream });
  const layers3 = [
    { slot: 2, firstBlock: sliced.baseBlocks.length },
    { slot: 3, firstBlock: second.stream.blocks.length },
  ];
  const sliced3 = sliceModuleLayers(third.stream.blocks, layers3, 2);
  eq(sliced3.kept.map((l) => l.slot), [3], "the other slot's layer survives the replacement");
  const fourth = buildMmlModule(compiledB2, [2], {
    base: { blocks: [...sliced3.baseBlocks, ...sliced3.kept.flatMap((l) => l.blocks)], entry: 0x0400 },
  });
  const aram3 = new Uint8Array(ARAM_SIZE);
  applyUploadStream(aram3, parseUploadStream(fourth.bytes).stream);
  const notes3 = (slot: number) =>
    [...decodeSong(aram3, songSlotPtr(aram3, slot)).tracks.values()]
      .flatMap((t) => t.events.filter((e) => e.kind === 'note')).length;
  eq([notes3(1), notes3(2), notes3(3)], [2, 3, 2], 'all three slots decode after the layered rebuild');

  // layoutBase: same dodge math as base, but the blocks are NOT embedded —
  // the other module uploads itself (the title import vs the driver).
  const layoutOnly = buildMmlModule(compileMml(mmlB, optsWith(files)), [2], { layoutBase: baseBuilt.stream });
  assert(!layoutOnly.stream.blocks.some((b) => baseBuilt.stream.blocks.includes(b)), 'layoutBase blocks not embedded');
  assert(layoutOnly.bytes.length < merged.bytes.length, 'layout-only module is just the new song');
  const rowBlock = layoutOnly.stream.blocks.find((b) => b.dest >= 0x3d00 && b.dest < 0x3e20)!;
  assert(rowBlock.dest === 0x3d00 + 6, 'rows still append past the base table');
  const aram2 = new Uint8Array(ARAM_SIZE);
  applyUploadStream(aram2, baseBuilt.stream); // the "driver" uploads itself…
  applyUploadStream(aram2, parseUploadStream(layoutOnly.bytes).stream); // …then ours
  eq(notesOf(songSlotPtr(aram2, 1)) + 0, 2, 'base song intact under layout-only merge');
  assert(songSlotPtr(aram2, 2) !== 0, 'merged slot patched');

  // .spc-shaped base too: the merge only reads dest/data extents, so a base
  // with a retail-shaped 28-row table shifts new rows past row 28.
  const bigTable = buildMmlModule(compileMml(mmlB, optsWith(files)), [3], {
    base: { entry: 0x0400, blocks: [{ dest: 0x3d00, data: new Uint8Array(168) }] },
  });
  const tableBlock = bigTable.stream.blocks.find((b) => b.dest === 0x3d00 + 28 * 6);
  assert(tableBlock !== undefined, 'rows append after a retail-shaped 28-row base table');
}

console.log('=== resident sample banks dodged (layoutBase) ===');
{
  // A mapcastlebank-shaped resident bank: dir slots $18-$1B + BRR filling
  // $B960-$CDD0, passed dodge-only. The import must leave both intact —
  // clobbering a resident bank persists into sibling sets (positional-diff
  // uploads never re-send an unchanged bank; the Spider Dance import that
  // spilled sequence bytes over mapcastlebank corrupted the world map).
  const bank = {
    entry: 0x0400,
    blocks: [
      { dest: 0x3c60, data: new Uint8Array(16) },
      { dest: 0xb960, data: new Uint8Array(0x1470) },
    ],
  };
  const files = { 'a.brr': fakeBrr(2) };
  const mml = '#amk 2\n#samples\n{\n"a.brr"\n}\n#instruments\n{\n"a.brr" $FF $E0 $B8 $03 $00\n}\n#0 @30 c4 d4\n';
  const built = buildMmlModule(compileMml(mml, optsWith(files)), [1], { layoutBase: bank });
  for (const b of built.stream.blocks) {
    for (const bb of bank.blocks) {
      assert(
        b.dest >= bb.dest + bb.data.length || bb.dest >= b.dest + b.data.length,
        `module block $${b.dest.toString(16)} dodges the resident bank at $${bb.dest.toString(16)}`
      );
    }
  }
  assert(!built.stream.blocks.some((b) => b.dest === 0xb960), 'bank blocks are dodge-only, not embedded');
  const dir = built.stream.blocks.find((b) => b.dest >= 0x3c00 && b.dest < 0x3d00)!;
  eq(dir.dest, 0x3c00 + 0x1c * 4, "custom dir slots start after the bank's $18-$1B");
  const aram = new Uint8Array(ARAM_SIZE);
  applyUploadStream(aram, built.stream);
  eq(aram[0x3d00], 0x1c, 'instrument row SRCN shifted to the relocated dir slot');
  // Tiny sequences first-fit into the engine-tail window; the dodge loop
  // above already proves nothing lands on the bank.
  eq(built.songAddr, 0x230e, 'tiny sequence first-fits into the engine tail');
  const song = decodeSong(aram, songSlotPtr(aram, 1));
  eq(
    [...song.tracks.values()].flatMap((t) => t.events.filter((e) => e.kind === 'note')).length,
    2,
    'dodged-layout song still decodes'
  );
}

console.log('=== port-report grouping ===');
{
  // Source order emits echo → timing → instrument lines; the assembled
  // report groups by category with instruments first.
  const r = compileMml('#amk 2\n#0 $F1 $05 $30 $01 $F4 $02 q7f @6 c4\n', optsWithStock({})).report;
  const at = (needle: string) => r.findIndex((l) => l.includes(needle));
  assert(at('mapped to') >= 0 && at('staccato') >= 0 && at('echo delay') >= 0, 'all three categories present');
  assert(at('mapped to') < at('staccato'), 'instrument lines precede timing lines');
  assert(at('staccato') < at('echo delay'), 'timing lines precede echo lines');
}

console.log('=== global-bank carry (sets without the global bank) ===');
{
  // Curated stock mappings carry the referenced global-bank sample instead
  // of emitting a resident SRCN (deduped; @6 twice reads 0x0a once).
  const reads: number[] = [];
  const carry = { read: (srcn: number) => { reads.push(srcn); return { data: fakeBrr(2), loopOffset: 9 }; } };
  const c = compileMml('#amk 2\n#0 @6 c4 @6 d4 @1 e4\n', { ...optsWithStock({}), globalBankCarry: carry });
  eq(reads, [0x0a, 0x12], 'each referenced global sample read once (deduped)');
  eq(c.samples.length, 2, 'two carried samples');
  assert(c.samples.every((s) => s.name.startsWith('(YI ')), 'carried samples named after the bank');
  assert(c.instrumentRows.every((r) => r.bytes[0] >= 0x18), 'no row references a resident global-bank SRCN');
  assert(c.report.some((r) => r.includes('lacks the global sample bank')), 'carry reported');

  // AMY #default rows (copied verbatim from the cart table) sweep too.
  const amy = compileMmlAs('amy', '#instruments\n{\n#default\n}\n#0 @9 c4',
    { ...optsWithStock({}), globalBankCarry: { read: () => ({ data: fakeBrr(1), loopOffset: 0 }) } });
  assert(amy.instrumentRows.length >= 24 && amy.instrumentRows.every((r) => r.bytes[0] >= 0x18),
    '#default rows remapped onto carried samples');

  // Unavailable slice: warn, keep the resident reference as a last resort.
  const miss = compileMml('#amk 2\n#0 @6 c4\n', { ...optsWithStock({}), globalBankCarry: { read: () => null } });
  eq(miss.samples.length, 0, 'nothing carried when the slice is unavailable');
  assert(miss.instrumentRows.some((r) => r.bytes[0] === 0x0a), 'resident reference kept as last resort');
  assert(miss.report.some((r) => r.includes('could not be carried')), 'missing slice reported');
}

console.log('=== AMK real SMW samples (smwSamples library) ===');
{
  const lib = (present: Set<number>) => ({
    read: (i: number) => (present.has(i) ? { data: fakeBrr(2), loopOffset: 0 } : null),
  });
  const stock = (extra: Partial<CompileMmlOptions>) => ({ ...optsWithStock({}), ...extra });

  // @6 trumpet (SMW sample $08): carried with AMK's own row verbatim
  // (tYi = tBase cancels the tuning correction), reported as real.
  const t = compileMml('#amk 2\n#0 @6 c4 @6 d4\n', stock({ smwSamples: lib(new Set([0x08])) }));
  eq(t.samples.map((s) => s.name), ['(SMW Trumpet)'], 'trumpet carried once (deduped across uses)');
  eq(t.instrumentRows[0].bytes, [t.sampleSrcnBase + 0, 0xfa, 0x6a, 0xb8, 0x03, 0x00],
    'row = AMK InstrumentData values verbatim, SRCN repointed at the carried sample');
  assert(t.report.some((r) => r.includes('the real SMW Trumpet sample')), 'real-sample mapping reported');
  assert(t.usedSmwSamples, 'usedSmwSamples set');

  // Priority: the real SMW flute beats the packaged Pan Flute; the real SMW
  // kick sample beats the resident grassland drums. Percussion keeps its
  // fixed pitch.
  const flute = compileMml('#amk 2\n#0 @0 c4\n', stock({
    smwSamples: lib(new Set([0x00])),
    packagedSamples: { panFlute: { data: fakeBrr(1), loopOffset: 0 } },
  }));
  eq(flute.samples.map((s) => s.name), ['(SMW Flute)'], 'SMW library outranks packaged timbres');
  assert(!flute.usedPackagedSamples, 'packaged flute not used');
  const kick = compileMml('#amk 2\n#0 @21 c4\n', stock({
    smwSamples: lib(new Set([0x0f])),
    grasslandBank: { rows: new Uint8Array(24), resident: true },
  }));
  eq(kick.samples.map((s) => s.name), ['(SMW Bass Drum)'], 'SMW library outranks grassland drums');
  assert(!kick.usedGrasslandDrums, 'grassland kick not used');

  // A missing file degrades to the usual approximation (no sample carried).
  const miss = compileMml('#amk 2\n#0 @6 c4\n', stock({ smwSamples: lib(new Set()) }));
  eq(miss.samples.length, 0, 'missing file falls back to the global bank');
  assert(!miss.usedSmwSamples, 'usedSmwSamples clear on fallback');

  // @N-derived custom rows keep the port's own tuning bytes verbatim.
  const custom = compileMml(
    '#amk 2\n#instruments\n{\n@6 $FF $E0 $B8 $04 $80\n}\n#0 @30 c4\n',
    stock({ smwSamples: lib(new Set([0x08])) })
  );
  eq(custom.instrumentRows[0].bytes, [custom.sampleSrcnBase + 0, 0xff, 0xe0, 0xb8, 0x04, 0x80],
    '@N-derived custom row plays its own tuning on the real sample');
}

console.log('=== AMK $FA $03 amplify fold ===');
{
  const volsOf = (events: TrackEvent[]) =>
    events.filter((e) => e.kind === 'vcmd' && (e.op === 0xed || e.op === 0xee)).map((e) => (e as { args: number[] }).args.at(-1));

  // √-compensation: both drivers square the volume product; AMK's driver
  // amplifies the squared result by 1+n/256 — the folded byte scales by
  // √(1+n/256). The `v128 $FA$03$40` order (the AMK idiom, live-rescaled
  // by its driver) re-emits the current volume folded.
  const after = compileMml('#amk 2\n#0 v128 $FA $03 $40 c4\n', optsWith({}));
  eq(volsOf(after.trackEvents[0]), [128, 143], 'amplify re-emits the current volume folded (128·√1.25 = 143)');

  // Volumes after the amplify fold directly; $E8 fade targets fold too.
  const forward = compileMml('#amk 2\n#0 v100 $FA $03 $40 v100 $E8 $10 $80 c4\n', optsWith({}));
  eq(volsOf(forward.trackEvents[0]), [100, 112, 112, 143], 'v and $E8 targets fold by √1.25 (100→112, $80→143)');

  // Amplify persists across the '/' intro→loop split (AMK driver state is
  // per-channel, not per-track).
  const split = compileMml('#amk 2\n#0 v100 $FA $03 $40 c4 / v100 d4\n', optsWith({}));
  eq(volsOf(split.trackEvents.flat()), [100, 112, 112], "amplify survives '/' (loop-section v100 → 112)");

  // $FA $03 $00 re-emits unscaled and stops folding; over-max folds clip
  // with a report; amplify before any explicit v skips the retro-emit.
  const reset = compileMml('#amk 2\n#0 v100 $FA $03 $40 $FA $03 $00 v100 c4\n', optsWith({}));
  eq(volsOf(reset.trackEvents[0]), [100, 112, 100, 100], 'amplify $00 restores unscaled emission');
  const clip = compileMml('#amk 2\n#0 v255 $FA $03 $40 c4\n', optsWith({}));
  eq(volsOf(clip.trackEvents[0]), [255, 255], 'over-max fold clips at 255');
  assert(clip.report.some((r) => r.includes('clips at the driver max')), 'clipped amplify reported');
  const pre = compileMml('#amk 2\n#0 $FA $03 $40 v128 c4\n', optsWith({}));
  eq(volsOf(pre.trackEvents[0]), [143], 'amplify-first emits no boot-default volume; v folds');
}

console.log('=== AMK light staccato ($F4 $02) ===');
{
  // Full-gate (q7) note under light staccato re-emits as note + 2-tick tie:
  // the tie defeats YI's hard 2-tick slot-end cut and the tie slot's own
  // 1-tick gate keys off — the note rings L−1, matching AMK's WaitTime=1.
  const on = compileMml('#amk 2\n#0 $F4 $02 q7f c4 d4\n', optsWith({}));
  eq(flat(on.trackEvents[0]).slice(0, 6), ['len46q715', 'na4', 'len2', 'tie', 'len46', 'na6'],
    'light staccato splits q7 notes into (L−2)-tick note + 2-tick tie');
  assert(on.report.some((r) => r.includes('light staccato emulated')), 'emulation reported');

  // Gate-dominated notes (gate keys off before the slot-end cut in both
  // drivers) are untouched — staccato depth never reaches them.
  const low = compileMml('#amk 2\n#0 $F4 $02 q3f c4 d4\n', optsWith({}));
  eq(flat(low.trackEvents[0]).slice(0, 3), ['len48q315', 'na4', 'na6'],
    'low-gate notes do not split');

  // Second $F4 $02 toggles it back off; ≤2-tick notes cannot split.
  const off = compileMml('#amk 2\n#0 $F4 $02 $F4 $02 q7f c4 d4\n', optsWith({}));
  eq(flat(off.trackEvents[0]).slice(0, 3), ['len48q715', 'na4', 'na6'],
    'toggling twice restores plain emission');
  const tiny = compileMml('#amk 2\n#0 $F4 $02 q7f c=2 d=2\n', optsWith({}));
  eq(flat(tiny.trackEvents[0]).slice(0, 3), ['len2q715', 'na4', 'na6'],
    '2-tick notes are too short to split');

  // Rests never split; a >127-tick chain splits only its final component.
  const restsAndChain = compileMml('#amk 2\n#0 $F4 $02 q7f r4 c=200\n', optsWith({}));
  eq(flat(restsAndChain.trackEvents[0]).slice(0, 7),
    ['len48q715', 'rest', 'len96', 'na4', 'len102', 'tie', 'len2'],
    'rest untouched; chain final component splits');

  // '&' slide head is continued by the slide tie — no split on the head;
  // the slide's trailing tie (the true note end) still splits.
  const slide = compileMml('#amk 2\n#0 $F4 $02 q7f c4&d4 e4\n', optsWith({}));
  const names = flat(slide.trackEvents[0]);
  eq(names.slice(0, 3), ['len48q715', 'na4', 'pitchSlide(0,48,166)'], "'&' head keeps its full slot");
  eq(names.slice(3, 6), ['len46', 'tie', 'len2'], "'&' slide tail tie splits");

  // Mid-song toggle (after notes) adds the per-channel approximation note.
  const mid = compileMml('#amk 2\n#0 c4 $F4 $02 d4\n', optsWith({}));
  assert(mid.report.some((r) => r.includes('mid-song')), 'mid-song toggle warned');

  // usedLightStaccato marks real splits; the budget-fallback opt-out drops
  // the command with an accurate report instead.
  assert(on.usedLightStaccato, 'usedLightStaccato set when notes split');
  assert(!low.usedLightStaccato, 'usedLightStaccato clear when nothing splits');
  const disabled = compileMml('#amk 2\n#0 $F4 $02 q7f c4 d4\n', { ...optsWith({}), emulateLightStaccato: false });
  eq(flat(disabled.trackEvents[0]).slice(0, 3), ['len48q715', 'na4', 'na6'], 'opt-out emits plain notes');
  assert(!disabled.usedLightStaccato, 'opt-out leaves usedLightStaccato clear');
  assert(disabled.report.some((r) => r.includes('not emulated')), 'opt-out reported');
}

console.log('=== no-echo strip (stripEchoVcmds) ===');
{
  // AMK hex echo family: $EF on / $F1 params / $F0 off / $F2 vol-fade →
  // YI $F5 / $F7 / $F6 / $F8.
  const src = '#amk 2\n#0 $EF $FF $20 $20 $F1 $02 $30 $01 c4 $F0 $F2 $10 $00 $00 d4\n';
  const c = compileMml(src, optsWith({}));
  const ops = (cc: typeof c): number[] =>
    cc.trackEvents.flat().filter((e) => e.kind === 'vcmd').map((e) => (e as { op: number }).op);
  assert(ops(c).includes(0xf5) && ops(c).includes(0xf7) && ops(c).includes(0xf8), 'echo vcmds compiled');
  const echoOffCount = ops(c).filter((op) => op === 0xf6).length;
  const s = stripEchoVcmds(c);
  assert(!ops(s).some((op) => op === 0xf5 || op === 0xf7 || op === 0xf8), 'echo on/params/fade stripped');
  eq(ops(s).filter((op) => op === 0xf6).length, echoOffCount, '$F6 (echo off) preserved');
  assert(s.report.some((r) => r.includes('no-echo')), 'strip adds a report line');
  eq(
    s.trackEvents.flat().filter((e) => e.kind === 'note').length,
    c.trackEvents.flat().filter((e) => e.kind === 'note').length,
    'notes untouched'
  );
  assert(stripEchoVcmds(s) === s, 'idempotent — an echo-free song returns the same object');

  // The claim window: with the main span walled off, a tiny song lands in
  // the $2C00-$3C00 echo region (after the 830-byte tail fills).
  const clean = stripEchoVcmds(compileMml('#amk 2\n#0 c4 d4 e4 f4\n', optsWith({})));
  const wall = { entry: 0x0400, blocks: [
    { dest: 0x230e, data: new Uint8Array(0x264c - 0x230e) }, // tail occupied
    { dest: 0xb960, data: new Uint8Array(0xff8e - 0xb960) }  // main span occupied
  ] };
  const built = buildMmlModule(clean, [1], { layoutBase: wall, claimEchoRegion: true });
  assert(built.songAddr >= 0x2c00 && built.songAddr < 0x3c00, `claimed sequence lands in the echo region (0x${built.songAddr.toString(16)})`);
  let threw = false;
  try {
    buildMmlModule(clean, [1], { layoutBase: wall });
  } catch {
    threw = true;
  }
  assert(threw, 'without the claim the same walls leave no room');
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAll mml-compile checks passed.');
