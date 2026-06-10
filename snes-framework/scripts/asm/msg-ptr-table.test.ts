// Round-trip + repoint test for the message-pointer-table editor
// (DATA_message_box_text_ptrs). Reads Bank51.asm + the font table only — no
// reference cart needed, so it runs everywhere.
// Run: node snes-framework/scripts/asm/msg-ptr-table.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadFontTable,
  parseMessagePtrTable,
  serializeMessagePtrTable
} from '../strings.ts';

function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  }
}

let pass = 0;
let fail = 0;

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK_ROOT = path.join(here, '..', '..');
const bank51 = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'SuperFX', 'Banks', 'Bank51.asm'), 'utf8');
const ft = loadFontTable(WORK_ROOT);

const model = parseMessagePtrTable(bank51, bank51, ft);

console.log('=== ptr-table: parse shape ===');
assert(model.kind === 'pointer-table', 'model.kind is pointer-table');
assert(model.slots.length === 300, `300 slots (got ${model.slots.length})`);
assert(model.options.length >= 80, `>=80 options (got ${model.options.length})`);
const optionIds = new Set(model.options.map((o) => o.id));
assert(
  model.slots.every((s) => s === '' || optionIds.has(s)),
  'every slot is null or a known option id'
);
assert(
  model.slots.some((s) => s === ''),
  'at least one null ($0000) slot is present'
);
// The watermelon-seed body should be a selectable option, named with its address.
const watermelon = model.options.find((o) => o.id === 'DATA_msg_minigame_watermelon_seed');
assert(!!watermelon, 'watermelon-seed body is an option');
assert(
  !!watermelon && watermelon.name.includes('(0x5140D3)'),
  `option name carries the reference address (got ${watermelon?.name})`
);

console.log('=== ptr-table: unchanged model round-trips byte-for-byte ===');
{
  const r = serializeMessagePtrTable(bank51, bank51, model, ft);
  assert(r.ok, `serialize ok${r.ok ? '' : ': ' + r.error}`);
  assert(r.ok && r.text === bank51, 'an untouched model reproduces the file byte-for-byte');
}

console.log('=== ptr-table: repointing one slot edits only that slot ===');
{
  const slotIdx = 2;
  const before = model.slots[slotIdx];
  const target = model.options.find((o) => o.id !== before && o.id !== '');
  assert(!!target, 'found a different body to repoint to');
  if (target) {
    const edited = { ...model, slots: model.slots.map((s, i) => (i === slotIdx ? target.id : s)) };
    const r = serializeMessagePtrTable(bank51, bank51, edited, ft);
    assert(r.ok, `repoint serialize ok${r.ok ? '' : ': ' + r.error}`);
    if (r.ok) {
      // Exactly one line differs between the base and the edited file.
      const a = bank51.split('\n');
      const b = r.text.split('\n');
      assert(a.length === b.length, 'no lines added/removed');
      const diffs = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
      assert(diffs.length === 1, `exactly one line changed (got ${diffs.length})`);
      assert(b[diffs[0]].includes(target.id), 'the changed line points at the new body');

      // Re-parse: the repointed slot resolves to the new target, others unchanged.
      const re = parseMessagePtrTable(r.text, bank51, ft);
      assert(re.slots[slotIdx] === target.id, 'reparse shows the repointed slot');
      assert(
        re.slots.every((s, i) => i === slotIdx || s === model.slots[i]),
        'all other slots unchanged'
      );
    }
  }
}

console.log('=== ptr-table: clearing a slot writes $0000 ===');
{
  // Find a non-null slot to clear.
  const slotIdx = model.slots.findIndex((s) => s !== '');
  assert(slotIdx >= 0, 'found a non-null slot');
  if (slotIdx >= 0) {
    const edited = { ...model, slots: model.slots.map((s, i) => (i === slotIdx ? '' : s)) };
    const r = serializeMessagePtrTable(bank51, bank51, edited, ft);
    assert(r.ok, `clear serialize ok${r.ok ? '' : ': ' + r.error}`);
    if (r.ok) {
      const re = parseMessagePtrTable(r.text, bank51, ft);
      assert(re.slots[slotIdx] === '', 'cleared slot reparses as null');
      const changed = r.text.split('\n').find((l, i) => l !== bank51.split('\n')[i]);
      assert(!!changed && changed.includes('$0000'), 'the changed line writes $0000');
    }
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
console.log(process.exitCode ? '✗ failures above' : '✓ all message-ptr-table tests pass');
process.exit(fail === 0 ? 0 : 1);
