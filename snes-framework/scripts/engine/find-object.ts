// Find every (level, cell) where a std-object / ext-object / sprite id appears
// — the CLI counterpart to the editor's ObjectFinder panel. Same data source as
// the panel: the base-cart instance index (`editor-data/yi/instance-index.json`,
// regenerated at extract by `scripts/instance-index.ts`), keyed exactly by
// `(kind, id) → [recordId, x, y, offset]`. (The panel additionally splices the
// active project's saved overlay edits; a dev tool has no project, so this is
// base-cart data only.)
//
// An id is ambiguous across the three kinds (0x12 is a valid std, ext AND
// sprite id), so like `level-lookup` this searches ALL THREE by default; pin one
// with --std / --ext / --sprite:
//
//   node snes-framework/scripts/engine/find-object.ts 0x2A           # std + ext + sprite
//   node snes-framework/scripts/engine/find-object.ts 0x2A --std     # only std objects
//   node snes-framework/scripts/engine/find-object.ts 0x1C2 --sprite # sprite (9-bit, 0x000–0x1FF)
//
// Reads the prebuilt index if present (fast — what the editor uses), else builds
// it in-memory from the extracted `.bin` files. Level friendly names are
// best-effort (need the built V1.0 cart + .sym). Engine-side, no native deps —
// works from WSL.

import * as fs from 'node:fs';
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { levelNameIndex, type LevelNameIndex } from '../level-id.ts';
import {
  buildInstanceIndex,
  instanceIndexKey,
  instanceIndexPath,
  type InstanceIndex
} from '../instance-index.ts';
import { hexN as hex, parseHexId, splitArgs } from './cli-util.ts';

// std/ext ids are 8-bit; sprite ids are 9-bit (0x000–0x1FF).
const KINDS: { flag: string; key: keyof InstanceIndex; label: string; idWidth: number; max: number }[] = [
  { flag: '--std', key: 'std', label: 'STD', idWidth: 2, max: 0xff },
  { flag: '--ext', key: 'ext', label: 'EXT', idWidth: 2, max: 0xff },
  { flag: '--sprite', key: 'sprite', label: 'SPRITE', idWidth: 3, max: 0x1ff }
];

function usage(): void {
  console.error('Usage:');
  console.error('  find-object.ts <id>              # search std, ext AND sprite');
  console.error('  find-object.ts <id> --std        # only standard objects (0x00–0xFF)');
  console.error('  find-object.ts <id> --ext        # only extended objects (0x00–0xFF)');
  console.error('  find-object.ts <id> --sprite     # only sprites (0x000–0x1FF)');
  console.error('  (<id> is hex with 0x, else decimal — e.g. 0x2A or 42)');
}

/** Prefer the prebuilt index (what the editor reads); fall back to building it
 *  in-memory if it's missing/corrupt so the tool works pre-first-extract too. */
function loadIndex(): { index: InstanceIndex; source: string } {
  const p = instanceIndexPath(FRAMEWORK_ROOT);
  if (fs.existsSync(p)) {
    try {
      return { index: JSON.parse(fs.readFileSync(p, 'utf8')) as InstanceIndex, source: p };
    } catch {
      /* fall through to a fresh build */
    }
  }
  return { index: buildInstanceIndex(FRAMEWORK_ROOT), source: 'built in-memory' };
}

const { flags, positionals } = splitArgs(process.argv.slice(2));
const value = parseHexId(positionals[0], { max: 0x1ff, onError: usage });

const selected = KINDS.filter((k) => flags.has(k.flag));
const kinds = selected.length ? selected : KINDS;

const { index, source } = loadIndex();

// Level names are best-effort (need the built cart + .sym) — degrade silently.
let names: LevelNameIndex | null = null;
try {
  const { cart, symbols } = loadDevCart();
  names = levelNameIndex(FRAMEWORK_ROOT, cart, symbols);
} catch {
  /* names unavailable — print record ids alone */
}

console.log(`find-object ${hex(value, value > 0xff ? 3 : 2)}  (searching: ${kinds.map((k) => k.key).join(', ')})`);
console.log(`index: ${source}`);

let total = 0;
for (const k of kinds) {
  const idHex = hex(value, k.idWidth);
  if (value > k.max) {
    console.log(`\n${k.label} ${idHex} — out of range (valid 0x00–${hex(k.max, k.idWidth)}).`);
    continue;
  }
  const rows = index[k.key]?.[instanceIndexKey(value)] ?? [];
  total += rows.length;
  if (rows.length === 0) {
    console.log(`\n${k.label} ${idHex} — no instances.`);
    continue;
  }
  console.log(`\n${k.label} ${idHex} — ${rows.length} instance${rows.length === 1 ? '' : 's'}:`);
  for (const [recordId, x, y, offset] of rows) {
    const name = names?.byRecord.get(recordId);
    console.log(`  record ${hex(recordId)}${name ? `  ${name}` : ''}  @ (${x}, ${y})  off ${hex(offset, 4)}`);
  }
}

console.log(`\n${total} instance${total === 1 ? '' : 's'} total.`);
