// Round-trip test for the message markup codec: for every base message, decode
// its cart byte stream → markup → encode must reproduce the exact bytes. Targets
// the extracted reference cart; skips cleanly when it isn't present.
// Run: node snes-framework/scripts/asm/msg-markup.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_CODES, SPECIAL_GLYPHS, decodeMessageBytes, encodeMessageMarkup, markupBodyByteSize, markupByteSize } from './msg-markup.ts';
import {
  loadFontTable,
  parseEndingText,
  parseIntroStory,
  parseLevelNameStrings,
  bank51SpillBytes,
  levelNameSpillBytes,
  messageSpillBytes,
  parseMessageText,
  serializeEndingText,
  serializeIntroStory,
  serializeLevelNameStrings,
  serializeMessageText
} from '../strings.ts';
import { snesToPC } from '../engine/symbol-map.ts';
import type { StringTableModel } from '../types.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK_ROOT = path.join(here, '..', '..');
const BASE = path.join(WORK_ROOT, 'reference', 'reference.sfc');

if (!fs.existsSync(BASE)) {
  console.log(`SKIP: reference cart not found at ${BASE} (run extract first).`);
  process.exit(0);
}

const cart = fs.readFileSync(BASE);
const bank51 = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'SuperFX', 'Banks', 'Bank51.asm'), 'utf8');
const ft = loadFontTable(WORK_ROOT);
const model = parseMessageText(bank51, bank51, ft);

let pass = 0;
let fail = 0;
const fails: string[] = [];
let totalGlyphTokens = 0;
let totalCtrlTokens = 0;
const CTRL_TOKENS = new Set(CONTROL_CODES.map((c) => c.token.toLowerCase()));
const GLYPH_TOKENS = new Set(SPECIAL_GLYPHS.map((g) => g.token.toLowerCase()));

/** Tally named glyph/control tokens in a markup string (ignores `[$XX]` hex),
 *  expanding the `[token_N]` repeat sugar so the count reflects real instances. */
function tallyTokens(markup: string): { glyphs: number; ctrls: number } {
  let glyphs = 0;
  let ctrls = 0;
  for (const tok of markup.match(/\[[^\]]*\]/g) ?? []) {
    let inner = tok.slice(1, -1);
    let mult = 1;
    const rep = /^(\S+)_(\d+)$/.exec(inner);
    if (rep) {
      inner = rep[1];
      mult = parseInt(rep[2], 10);
    }
    const name = inner.split(/\s+/)[0].toLowerCase();
    if (CTRL_TOKENS.has(name)) ctrls += mult;
    else if (GLYPH_TOKENS.has(name)) glyphs += mult;
  }
  return { glyphs, ctrls };
}

for (const e of model.entries) {
  const m = /DATA_51([0-9A-Fa-f]{4})/.exec(e.label);
  if (!m) continue;
  const addr = snesToPC(0x510000 | parseInt(m[1], 16));
  const dec = decodeMessageBytes(cart, addr, ft.byteToChar);
  if (!dec.ok) {
    fail++;
    fails.push(`${e.label}: no $FFFF terminator within bounds`);
    continue;
  }
  // The font-table-free byte-size estimate (drives the editor's live budget)
  // must equal the real consumed size, so a pristine cart never reads as over.
  assert(
    markupByteSize(dec.markup) === dec.bytesConsumed,
    `${e.label}: markupByteSize ${markupByteSize(dec.markup)} ≠ bytesConsumed ${dec.bytesConsumed}`
  );
  const orig = cart.subarray(addr, addr + dec.bytesConsumed);
  const enc = encodeMessageMarkup(dec.markup, ft);
  if (enc.error) {
    fail++;
    fails.push(`${e.label}: encode error — ${enc.error}`);
    continue;
  }
  const same = enc.bytes.length === orig.length && enc.bytes.every((b, i) => b === orig[i]);
  if (same) {
    pass++;
    const t = tallyTokens(dec.markup);
    totalGlyphTokens += t.glyphs;
    totalCtrlTokens += t.ctrls;
  } else {
    fail++;
    let diff = -1;
    for (let i = 0; i < Math.max(orig.length, enc.bytes.length); i++) {
      if (orig[i] !== enc.bytes[i]) {
        diff = i;
        break;
      }
    }
    fails.push(
      `${e.label}: bytes differ @${diff} (orig ${orig.length}B vs enc ${enc.bytes.length}B) markup=${JSON.stringify(dec.markup.slice(0, 60))}`
    );
  }
}

console.log(`message markup round-trip: ${pass} pass, ${fail} fail (of ${model.entries.length} messages)`);
console.log(`  decoded ${totalGlyphTokens} special-glyph + ${totalCtrlTokens} control tokens across all messages`);
for (const f of fails.slice(0, 10)) console.log(`  ✗ ${f}`);

console.log('\n=== strings: parse → serialize round-trips the region byte-for-byte ===');
{
  const m = parseMessageText(bank51, bank51, ft);
  assert(m.markup === true && m.entries.length > 0, 'message model is markup with entries');
  const out = serializeMessageText(bank51, bank51, m, ft);
  assert(out.ok, `unedited serialize ok${out.ok ? '' : ': ' + out.error}`);
  if (out.ok) assert(out.text === bank51, 'serialize(parse(base)) === base (unedited identity)');
}

console.log('=== strings: a markup edit re-emits only that message ===');
{
  const baseModel = parseMessageText(bank51, bank51, ft);
  const idx = baseModel.entries.findIndex((e) => (e.markup ?? '').includes('paradise'));
  assert(idx >= 0, 'found the intro message to edit');
  if (idx >= 0) {
    const after = baseModel.entries[idx].markup!.replace('paradise', 'paradiso'); // same byte length
    const edited = {
      ...baseModel,
      entries: baseModel.entries.map((e, i) => (i === idx ? { ...e, markup: after } : e))
    };
    const out = serializeMessageText(bank51, bank51, edited, ft);
    assert(out.ok, `edited serialize ok${out.ok ? '' : ': ' + out.error}`);
    if (out.ok) {
      assert(out.text !== bank51, 'edited output differs from base');
      const re = parseMessageText(out.text, bank51, ft);
      for (let i = 0; i < baseModel.entries.length; i++) {
        if (i === idx) assert(re.entries[i].markup === after, 'edited message updated');
        else assert(re.entries[i].markup === baseModel.entries[i].markup, `message ${i} unchanged`);
      }
    }
  }
}

// The message region is the one GROWABLE region: past its base size the text
// spills into bank $51's `$FF` tail, which the build claims by moving that tail's
// `%FREE_BYTES` boundary (relocate.ts `shiftRegionStart`). Pins the three things
// that has to get right: the fixed budget still bites with no headroom, headroom
// admits exactly that many extra bytes, and `messageSpillBytes` reports exactly
// what the build must shift by — an under-report would fire asar's
// `assert pc() <= $515348`.
console.log('\n=== strings: message-text free-tail headroom + spill accounting ===');
{
  const model = parseMessageText(bank51, bank51, ft);
  const base = model.budgetChars;
  const idx = model.entries.findIndex((e) => (e.markup ?? '').length > 20);
  assert(idx >= 0, 'found a message to grow');
  const GROW = 700;
  const grow = (n: number): StringTableModel => ({
    ...model,
    entries: model.entries.map((e, i) =>
      i === idx ? { ...e, markup: (e.markup ?? '') + 'A'.repeat(n) } : e
    )
  });

  assert(messageSpillBytes(bank51, bank51, ft) === 0, 'unedited region spills nothing');

  const noRoom = serializeMessageText(bank51, bank51, grow(GROW), ft);
  assert(!noRoom.ok, 'without headroom the fixed budget still rejects growth');

  const withRoom = serializeMessageText(bank51, bank51, grow(GROW), ft, { headroomBytes: GROW });
  assert(withRoom.ok, `headroom admits the growth${withRoom.ok ? '' : ': ' + withRoom.error}`);
  if (withRoom.ok) {
    const spill = messageSpillBytes(withRoom.text, bank51, ft);
    assert(spill === GROW, `spill is exactly the grown bytes (got ${spill}, want ${GROW})`);
    assert(
      parseMessageText(withRoom.text, bank51, ft, { headroomBytes: GROW }).budgetChars === base,
      'budgetChars stays the BASE region size — headroom is reported separately'
    );
    assert(
      parseMessageText(withRoom.text, bank51, ft, { headroomBytes: GROW }).headroomBytes === GROW,
      'the model carries the headroom for the editor readout'
    );
  }

  // One byte past the headroom is still rejected, and the error names the split.
  const tooMuch = serializeMessageText(bank51, bank51, grow(GROW + 1), ft, { headroomBytes: GROW });
  assert(!tooMuch.ok, 'one byte past base+headroom is rejected');
  assert(
    !tooMuch.ok && tooMuch.error.includes('free space'),
    `over-budget error mentions the free space${tooMuch.ok ? '' : ': ' + tooMuch.error}`
  );

  // A SHRUNK region never reports a negative spill (the boundary only moves
  // forward; asar re-fills the slack).
  // (Trim inside a run of plain letters — slicing the tail could cut a `[token]`
  // in half and fail the codec for an unrelated reason.)
  const si = model.entries.findIndex((e) => /[A-Za-z]{6}/.test(e.markup ?? ''))
  assert(si >= 0, 'found a message to shrink');
  const shrunk = {
    ...model,
    entries: model.entries.map((e, i) =>
      i === si ? { ...e, markup: (e.markup ?? '').replace(/[A-Za-z]{6}/, '') } : e
    )
  };
  const sr = serializeMessageText(bank51, bank51, shrunk, ft);
  assert(sr.ok, `shrinking a message serializes${sr.ok ? '' : ': ' + sr.error}`);
  if (sr.ok) assert(messageSpillBytes(sr.text, bank51, ft) === 0, 'a shrunk region spills nothing');
}

// Level names are the SECOND growable bank $51 region — the bank's last data
// before the `$FF` tail, so its growth adds straight onto the message region's.
// Its budget is counted in CHARACTERS, but the splice only rewrites `"…"` contents
// and the font is one byte per char, so the char delta IS the byte delta the build
// must shift the tail boundary by.
console.log('\n=== strings: level-name free-tail headroom + combined bank $51 spill ===');
{
  const names = parseLevelNameStrings(bank51, bank51, ft);
  const ni = names.entries.findIndex((e) => e.lines.some((l) => l.length >= 3));
  assert(ni >= 0, 'found a level name to grow');
  const li = names.entries[ni].lines.findIndex((l) => l.length >= 3);
  const GROW = 40;
  const grown = {
    ...names,
    entries: names.entries.map((e, i) =>
      i === ni ? { ...e, lines: e.lines.map((l, j) => (j === li ? l + 'A'.repeat(GROW) : l)) } : e
    )
  };

  assert(levelNameSpillBytes(bank51, bank51) === 0, 'unedited name region spills nothing');

  const noRoom = serializeLevelNameStrings(bank51, bank51, grown, ft);
  assert(!noRoom.ok, 'without headroom the fixed char budget still rejects growth');

  const withRoom = serializeLevelNameStrings(bank51, bank51, grown, ft, { headroomBytes: GROW });
  assert(withRoom.ok, `headroom admits the longer name${withRoom.ok ? '' : ': ' + withRoom.error}`);
  if (withRoom.ok) {
    assert(
      levelNameSpillBytes(withRoom.text, bank51) === GROW,
      `name spill is exactly the added chars (got ${levelNameSpillBytes(withRoom.text, bank51)})`
    );
    assert(
      parseLevelNameStrings(withRoom.text, bank51, ft, { headroomBytes: GROW }).headroomLabel ===
        'bank $51 free space',
      'the name model carries the headroom label for the editor readout'
    );

    // Both regions grown in the SAME file: the bank's total claim is their sum —
    // this is what the build shifts the free-tail boundary by.
    const msgs = parseMessageText(withRoom.text, bank51, ft, { headroomBytes: 500 });
    const mi = msgs.entries.findIndex((e) => (e.markup ?? '').length > 20);
    const both = serializeMessageText(
      withRoom.text,
      bank51,
      {
        ...msgs,
        entries: msgs.entries.map((e, i) =>
          i === mi ? { ...e, markup: (e.markup ?? '') + 'B'.repeat(500) } : e
        )
      },
      ft,
      { headroomBytes: 500 }
    );
    assert(both.ok, `both regions grown serializes${both.ok ? '' : ': ' + both.error}`);
    if (both.ok) {
      assert(
        levelNameSpillBytes(both.text, bank51) === GROW,
        'the name edit survives the sibling message save'
      );
      assert(
        bank51SpillBytes(both.text, bank51, ft) === GROW + 500,
        `combined spill is both regions' growth (got ${bank51SpillBytes(both.text, bank51, ft)}, want ${GROW + 500})`
      );
    }
  }
}

// Both editable Bank51 regions (level names + message text) live in ONE file, so
// the save path must splice onto the overlay-first content — editing one region
// then the other must keep BOTH edits. This pins that sibling-region preservation
// (the serializers' content-vs-budget split), independent of the app save layer.
console.log('\n=== strings: editing one Bank51 region preserves the other (overlay-first splice) ===');
{
  const nameModel = parseLevelNameStrings(bank51, bank51, ft);
  const ni = nameModel.entries.findIndex((e) => e.lines.some((l) => l.length >= 3));
  assert(ni >= 0, 'found a level-name entry to edit');
  const li = ni >= 0 ? nameModel.entries[ni].lines.findIndex((l) => l.length >= 3) : -1;
  const editedName = ni >= 0 ? nameModel.entries[ni].lines[li].slice(0, -1) : ''; // drop one char (in budget)

  const msgIdx = parseMessageText(bank51, bank51, ft).entries.findIndex((e) =>
    (e.markup ?? '').includes('paradise')
  );
  assert(msgIdx >= 0, 'found a message to edit');

  if (ni >= 0 && msgIdx >= 0) {
    // 1) edit a name onto pristine base → overlay1 (messages still pristine).
    const editedNames = {
      ...nameModel,
      entries: nameModel.entries.map((e, i) =>
        i === ni ? { ...e, lines: e.lines.map((l, j) => (j === li ? editedName : l)) } : e
      )
    };
    const r1 = serializeLevelNameStrings(bank51, bank51, editedNames, ft);
    assert(r1.ok, `name serialize ok${r1.ok ? '' : ': ' + r1.error}`);

    if (r1.ok) {
      // 2) edit a message onto overlay1 (NOT base) → overlay2.
      const msgModel = parseMessageText(r1.text, bank51, ft);
      const editedMarkup = msgModel.entries[msgIdx].markup!.replace('paradise', 'paradiso');
      const editedMsgs = {
        ...msgModel,
        entries: msgModel.entries.map((e, i) =>
          i === msgIdx ? { ...e, markup: editedMarkup } : e
        )
      };
      const r2 = serializeMessageText(r1.text, bank51, editedMsgs, ft);
      assert(r2.ok, `message serialize onto name-overlay ok${r2.ok ? '' : ': ' + r2.error}`);

      if (r2.ok) {
        // overlay2 must carry BOTH edits — the name change is NOT clobbered.
        const finalNames = parseLevelNameStrings(r2.text, bank51, ft);
        assert(finalNames.entries[ni].lines[li] === editedName, 'name edit survived the message save');
        const finalMsgs = parseMessageText(r2.text, bank51, ft);
        assert(finalMsgs.entries[msgIdx].markup === editedMarkup, 'message edit applied');
      }
    }
  }
}

// Intro storybook (Bank0F) + ending (Bank0D) reuse the level-name in-place
// quoted-literal splice: only `"..."` contents change, every control byte
// ($FE/$FD/$FC line layout, $FF terminators, the `dw` row-advance words)
// survives byte-for-byte. Pins the unedited identity + a shorten-a-line edit.
console.log('\n=== strings: intro (Bank0F) + ending (Bank0D) cutscene text round-trip ===');
{
  const bank0F = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'Banks', 'Bank0F.asm'), 'utf8');
  const bank0D = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'Banks', 'Bank0D.asm'), 'utf8');

  // The editor's live byte count (sum of per-line markupBodyByteSize — NO per-line
  // terminator) must equal the budget on vanilla data, else a pristine cart reads
  // as over budget. (Regression: markupByteSize's +2 $FFFF terminator over-counted
  // every glyph line.)
  const glyphUsed = (m: ReturnType<typeof parseIntroStory>): number =>
    m.entries.reduce((s, e) => s + e.lines.reduce((t, l) => t + markupBodyByteSize(l), 0), 0);

  const intro = parseIntroStory(bank0F, bank0F, ft);
  assert(intro.entries.length > 1, `intro parsed multiple pages (got ${intro.entries.length})`);
  assert(glyphUsed(intro) === intro.budgetChars, `intro vanilla used (${glyphUsed(intro)}) === budget (${intro.budgetChars})`);
  assert(intro.entries[0].name.startsWith('Page 1'), `intro pages named "Page N" (got ${JSON.stringify(intro.entries[0].name)})`);
  const introOut = serializeIntroStory(bank0F, bank0F, intro, ft);
  assert(introOut.ok, `intro unedited serialize ok${introOut.ok ? '' : ': ' + introOut.error}`);
  if (introOut.ok) assert(introOut.text === bank0F, 'intro serialize(parse(base)) === base (identity)');

  // Shorten one line (in budget) → round-trips, every other page untouched.
  const ei = intro.entries.findIndex((e) => e.lines.some((l) => l.length >= 3));
  assert(ei >= 0, 'found an intro line to shorten');
  if (ei >= 0) {
    const li = intro.entries[ei].lines.findIndex((l) => l.length >= 3);
    const shortened = intro.entries[ei].lines[li].slice(0, -1);
    const edited = {
      ...intro,
      entries: intro.entries.map((e, i) =>
        i === ei ? { ...e, lines: e.lines.map((l, j) => (j === li ? shortened : l)) } : e
      )
    };
    const r = serializeIntroStory(bank0F, bank0F, edited, ft);
    assert(r.ok, `intro edited serialize ok${r.ok ? '' : ': ' + r.error}`);
    if (r.ok) {
      assert(r.text !== bank0F, 'intro edited output differs from base');
      const re = parseIntroStory(r.text, bank0F, ft);
      assert(re.entries[ei].lines[li] === shortened, 'intro edit applied');
      for (let i = 0; i < intro.entries.length; i++) {
        if (i === ei) continue;
        assert(
          JSON.stringify(re.entries[i].lines) === JSON.stringify(intro.entries[i].lines),
          `intro page ${i} unchanged`
        );
      }
    }
  }

  // Insert a glyph: net-zero bytes (drop 2 chars, add the 2-byte [star]). The
  // line round-trips with [star], the raw bytes land in the asm, and exceeding
  // the byte budget (add [star] without freeing space) is rejected.
  {
    const gi = intro.entries.findIndex((e) => e.lines.some((l) => l.length >= 4));
    assert(gi >= 0, 'found an intro line for a glyph insert');
    if (gi >= 0) {
      const gl = intro.entries[gi].lines.findIndex((l) => l.length >= 4);
      const withGlyph = intro.entries[gi].lines[gl].slice(0, -2) + '[star]';
      const edited = {
        ...intro,
        entries: intro.entries.map((e, i) =>
          i === gi ? { ...e, lines: e.lines.map((l, j) => (j === gl ? withGlyph : l)) } : e
        )
      };
      const r = serializeIntroStory(bank0F, bank0F, edited, ft);
      assert(r.ok, `intro glyph insert serialize ok${r.ok ? '' : ': ' + r.error}`);
      if (r.ok) {
        assert(/\$F6,\$F7/.test(r.text), 'star glyph emitted as raw bytes $F6,$F7');
        const re = parseIntroStory(r.text, bank0F, ft);
        assert(re.entries[gi].lines[gl] === withGlyph, 'glyph line round-trips as [star]');
      }
      const over = {
        ...intro,
        entries: intro.entries.map((e, i) =>
          i === gi ? { ...e, lines: e.lines.map((l, j) => (j === gl ? l + '[star]' : l)) } : e
        )
      };
      assert(!serializeIntroStory(bank0F, bank0F, over, ft).ok, 'over-budget glyph insert rejected');
    }
  }

  const ending = parseEndingText(bank0D, bank0D, ft);
  assert(ending.entries.length === 1, `ending is a single entry (got ${ending.entries.length})`);
  assert(ending.entries[0].lines.length > 1, `ending has several lines (got ${ending.entries[0].lines.length})`);
  assert(glyphUsed(ending) === ending.budgetChars, `ending vanilla used (${glyphUsed(ending)}) === budget (${ending.budgetChars})`);
  const endOut = serializeEndingText(bank0D, bank0D, ending, ft);
  assert(endOut.ok, `ending unedited serialize ok${endOut.ok ? '' : ': ' + endOut.error}`);
  if (endOut.ok) assert(endOut.text === bank0D, 'ending serialize(parse(base)) === base (identity)');
}

console.log('\n=== markup repeat sugar: [token_N] expands ↔ collapses ===');
{
  // encode: [scroll_3] === [scroll][scroll][scroll]
  const sugar = encodeMessageMarkup('[scroll_3]', ft);
  const longhand = encodeMessageMarkup('[scroll][scroll][scroll]', ft);
  assert(!sugar.error && !longhand.error, 'both forms encode ok');
  assert(JSON.stringify(sugar.bytes) === JSON.stringify(longhand.bytes), '[scroll_3] expands to 3× scroll');

  // decode: a run of identical control words collapses to the compact form.
  const run = decodeMessageBytes([0xff, 0x12, 0xff, 0x12, 0xff, 0x12, 0xff, 0xff], 0, ft.byteToChar);
  assert(run.ok && run.markup === '[scroll_3]', `3× scroll → [scroll_3] (got ${JSON.stringify(run.markup)})`);

  // a single occurrence is left alone (no [scroll_1]).
  const one = decodeMessageBytes([0xff, 0x12, 0xff, 0xff], 0, ft.byteToChar);
  assert(one.markup === '[scroll]', 'single scroll stays [scroll]');

  // hex tokens collapse too, and round-trip.
  const hex = decodeMessageBytes([0xd7, 0xd7, 0xff, 0xff], 0, ft.byteToChar);
  assert(hex.markup === '[$d7_2]', `2× $d7 → [$d7_2] (got ${JSON.stringify(hex.markup)})`);
  assert(JSON.stringify(encodeMessageMarkup('[$d7_2]', ft).bytes) === JSON.stringify([0xd7, 0xd7, 0xff, 0xff]), '[$d7_2] round-trips');

  // validation.
  assert(!!encodeMessageMarkup('[scroll_0]', ft).error, '[scroll_0] is rejected (count < 1)');
  assert(!!encodeMessageMarkup('[bogus_2]', ft).error, '[bogus_2] is rejected (unknown base)');
}

console.log(`\n${process.exitCode ? '✗ failures above' : '✓ all message-markup tests pass'}`);
process.exit(fail === 0 && !process.exitCode ? 0 : 1);
