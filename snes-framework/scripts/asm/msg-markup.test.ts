// Round-trip test for the message markup codec: for every base message, decode
// its cart byte stream → markup → encode must reproduce the exact bytes. Targets
// the extracted reference cart; skips cleanly when it isn't present.
// Run: node snes-framework/scripts/asm/msg-markup.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_CODES, SPECIAL_GLYPHS, decodeMessageBytes, encodeMessageMarkup, markupByteSize } from './msg-markup.ts';
import {
  loadFontTable,
  parseLevelNameStrings,
  parseMessageText,
  serializeLevelNameStrings,
  serializeMessageText
} from '../strings.ts';
import { snesToPC } from '../engine/symbol-map.ts';

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
