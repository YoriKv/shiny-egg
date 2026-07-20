// Unit test: define-shaped `!` handling across every `db "…"` emit/read path.
// asar expands `!name` defines even inside string literals, so an emitted
// literal like `db "GREEN COINS !They"` fails to assemble ("Define 'They'
// wasn't found" — hit by the EGGCELLENT ROM import). Writers escape (`\!`) via
// escapeDefineBangs, readers unescape; a harmless `!` (followed by space /
// punctuation / end-of-string, as all over the base Bank51) stays readable.
// Covers: msg-asm (messages), glyph-line (intro/ending), findQuotedLiterals +
// serializeLevelNameStrings (level names).
// Run: node snes-framework/scripts/asm/msg-asm.test.ts

import { bytesToMessageDirectives, messageBodyToBytes } from './msg-asm.ts';
import { encodeLineToDbArgs, parseDbArgs, dbArgsToLine } from './glyph-line.ts';
import { escapeDefineBangs, findQuotedLiterals, unescapeDefineBangs } from './text-literals.ts';
import { parseLevelNameStrings, serializeLevelNameStrings } from '../strings.ts';
import type { FontTable } from '../types.ts';

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

// Minimal font table: identity-map the chars these cases use.
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !';
const charToByte = new Map<string, number>();
const byteToChar = new Map<number, string>();
for (let i = 0; i < CHARS.length; i++) {
  charToByte.set(CHARS[i], i + 1);
  byteToChar.set(i + 1, CHARS[i]);
}
const ft: FontTable = { charToByte, byteToChar, chars: [...CHARS] };

const enc = (s: string): number[] => [...s].map((c) => charToByte.get(c)!);

// No literal in emitted asm may contain an UNESCAPED `!` before a define-name char.
function assertNoDefineInStrings(asm: string, msg: string): void {
  for (const m of asm.matchAll(/"([^"]*)"/g)) {
    assert(!/(^|[^\\])!(?=[A-Za-z0-9_{])/.test(m[1]), `${msg}: literal ${JSON.stringify(m[0])} has a define-shaped !`);
  }
}

// ── escape helpers ──────────────────────────────────────────────────────────
eq(escapeDefineBangs('GREEN COINS !They'), 'GREEN COINS \\!They', 'escapes ! before a letter');
eq(escapeDefineBangs('Wait! The baby'), 'Wait! The baby', '! before space untouched');
eq(escapeDefineBangs('the ceiling!!'), 'the ceiling!!', 'trailing !! untouched');
eq(escapeDefineBangs('Go!!They'), 'Go!\\!They', 'only the ! adjacent to a letter escapes');
eq(unescapeDefineBangs(escapeDefineBangs('a !b !! c!d')), 'a !b !! c!d', 'escape/unescape round-trips');

// ── messages (msg-asm) ──────────────────────────────────────────────────────
{
  const bytes = [...enc('GREEN COINS !They'), 0xff, 0x12, ...enc('COINS !'), 0xff, 0x0e];
  const body = bytesToMessageDirectives(bytes, byteToChar);
  assertNoDefineInStrings(body, 'message');
  assert(body.includes('db "GREEN COINS \\!They"'), `message: escaped inline (got ${JSON.stringify(body)})`);
  assert(body.includes('db "COINS !"'), 'message: ! before control word stays readable');
  eq(messageBodyToBytes(body, ft), bytes, 'message: round-trips byte-for-byte');
}

// ── intro/ending lines (glyph-line) ─────────────────────────────────────────
{
  const r = encodeLineToDbArgs('GO !Now[$F6]done!', ft);
  if (!r.ok) {
    assert(false, `glyph-line: encode failed: ${r.error}`);
  } else {
    assertNoDefineInStrings(r.args, 'glyph-line');
    eq(r.bytes, [...'GO !Now'].length + 1 + [...'done!'].length, 'glyph-line: byte count ignores the escape');
    const args = parseDbArgs(r.args);
    eq(args ? dbArgsToLine(args) : null, 'GO !Now[$F6]done!', 'glyph-line: round-trips through parse');
  }
}

// ── level names (findQuotedLiterals + serializeStringTable) ─────────────────
{
  const region = [
    ';@editable:level-name-strings begin',
    'DATA_name_a:',
    '\tdb "OLD NAME",$00',
    ';@editable:level-name-strings end'
  ].join('\n');
  const model = parseLevelNameStrings(region, region, ft);
  model.entries[0].lines[0] = 'GO !Now';
  const out = serializeLevelNameStrings(region, region, model, ft);
  if (!out.ok) {
    assert(false, `level-name: serialize failed: ${out.error}`);
  } else {
    assertNoDefineInStrings(out.text, 'level-name');
    assert(out.text.includes('db "GO \\!Now",$00'), `level-name: escaped in place (got ${JSON.stringify(out.text)})`);
    const back = parseLevelNameStrings(out.text, region, ft);
    eq(back.entries[0].lines[0], 'GO !Now', 'level-name: reader unescapes');
    eq(back.budgetChars, 8, 'level-name: budget counts decoded chars, not the escape');
  }
}

if (failures) {
  console.error(`msg-asm.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log('msg-asm.test.ts: all assertions passed');
