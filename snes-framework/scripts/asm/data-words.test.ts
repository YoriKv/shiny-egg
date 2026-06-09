// Unit test: the `dw` data-word splice primitive (format-preserving editing of
// inline asm data tables — palette blob, future Map16/collision tables).
// Run: node snes-framework/scripts/asm/data-words.test.ts

import { findDataWords, dataWordEdits, formatWord } from './data-words.ts';
import { applyEdits } from './text-literals.ts';

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

// A synthetic blob: a leading alias label, the base label (with comment), a
// sparse mid-run label + comment (both PART of the run — like the blob's
// `DATA_5FA0xx:` aliases), and a real statement that ENDS the run (mirroring the
// `%FREE_BYTES` directive that terminates the real blob).
const SRC = [
  'DATA_ALIAS:',
  'DATA_blob:\t; the base',
  '\tdw $0000',
  '\tdw $46EE,$5772,$7FFF,$0000',
  'DATA_mid:',
  '\t; a comment line',
  '\tdw $1234,$ABCD',
  '\tRTL', // a real statement ends the run (a bare label would NOT)
  '\tdw $9999', // past the run end — must NOT be parsed
].join('\n');

const words = findDataWords(SRC, 'DATA_blob');

// 1. Parsing: 7 words, byte offsets 0,2,4,…, values in order; the post-run dw
//    is excluded; sparse labels/comments don't shift offsets.
eq(words.length, 7, 'parses 7 words (run ends at CODE_after)');
eq(words.map((w) => w.byteOffset), [0, 2, 4, 6, 8, 10, 12], 'byte offsets contiguous across labels/comments');
eq(words.map((w) => w.value), [0x0000, 0x46ee, 0x5772, 0x7fff, 0x0000, 0x1234, 0xabcd], 'values in order');

// 2. Each word's hex span covers exactly the digits after `$`.
const w1 = words[1]!;
eq(SRC.slice(w1.hexStart, w1.hexEnd), '46EE', 'hex span is the digits after $');

// 3. Round-trip identity: changing a word to its own value yields no edits.
const same = dataWordEdits(words, new Map([[2, 0x46ee]]));
eq(same.length, 0, 'same-value change → no edits');
eq(applyEdits(SRC, same), SRC, 'no-op edits → identical text');

// 4. Single edit: changes exactly that word, format-preserving.
const edited = applyEdits(SRC, dataWordEdits(words, new Map([[2, 0x1357]])));
const re = findDataWords(edited, 'DATA_blob');
eq(re.find((w) => w.byteOffset === 2)!.value, 0x1357, 'edited word reparses to new value');
eq(re.filter((w, i) => w.value !== words[i]!.value).length, 1, 'exactly one word changed');
eq(edited.length, SRC.length, '4-digit format → no length drift');
eq(edited, SRC.replace('46EE', '1357'), 'only the one token differs');

// 5. formatWord canonicalises to 4 upper-hex digits.
eq(formatWord(0x0), '0000', 'formatWord pads to 4');
eq(formatWord(0xabcd), 'ABCD', 'formatWord upper-cases');

// 6. Multiple edits + an unknown offset throws.
const multi = dataWordEdits(words, new Map([[0, 0x1111], [12, 0x2222]]));
eq(multi.length, 2, 'two changed words → two edits');
let threw = false;
try { dataWordEdits(words, new Map([[3, 0x1]])); } catch { threw = true; }
assert(threw, 'non-word-boundary offset throws');

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
