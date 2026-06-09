// Tests SNES copier-header detection + stripping (rom-header.ts):
//   - the `size % 1024 == 512` rule + the 512-byte strip,
//   - identity (unheadered → the same buffer, no copy),
//   - cart oracle (gated): a 512-byte-headered copy of the reference cart strips
//     back to the exact unheadered bytes + MD5.
// Run: node snes-framework/scripts/rom-header.test.ts

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPIER_HEADER_BYTES, hasCopierHeader, stripCopierHeader } from './rom-header.ts';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failed = 1; }
}

console.log('detection rule (size % 1024 == 512):');
assert(COPIER_HEADER_BYTES === 512, 'copier-header size is 512 bytes');
assert(!hasCopierHeader(0x200000), '2 MB (whole banks) → unheadered');
assert(hasCopierHeader(0x200000 + 512), '2 MB + 512 → headered');
assert(!hasCopierHeader(0x8000), '32 KB → unheadered');
assert(hasCopierHeader(0x8000 + 512), '32 KB + 512 → headered');
assert(!hasCopierHeader(0x8000 + 1024), '32 KB + 1024 → unheadered (only the odd 512 flags it)');

console.log('strip:');
const unh = Buffer.alloc(0x8000, 0xab);
assert(stripCopierHeader(unh) === unh, 'unheadered buffer returned unchanged (same ref, no copy)');
const hdr = Buffer.concat([Buffer.alloc(512, 0xff), Buffer.alloc(0x8000, 0xab)]);
const stripped = stripCopierHeader(hdr);
assert(stripped.length === 0x8000, 'headered buffer stripped to the ROM size (drops 512)');
assert(stripped.every((b) => b === 0xab), 'stripped bytes are the ROM body, not the $FF header');

console.log('cart oracle (gated):');
const here = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(here, '..', 'reference', 'reference.sfc');
if (!fs.existsSync(REF)) {
  console.log(`  SKIP: reference cart not found at ${REF} (run extract first).`);
} else {
  const cart = fs.readFileSync(REF);
  const cartMd5 = crypto.createHash('md5').update(cart).digest('hex');
  assert(!hasCopierHeader(cart.length), `reference.sfc is unheadered (${cart.length} bytes)`);
  // A 512-prefixed copy emulates a copier-headered dump.
  const headeredCopy = Buffer.concat([Buffer.alloc(512, 0xff), cart]);
  assert(hasCopierHeader(headeredCopy.length), 'a 512-prefixed copy is detected as headered');
  const back = stripCopierHeader(headeredCopy);
  assert(
    back.length === cart.length && Buffer.compare(back, cart) === 0,
    'stripping restores the exact unheadered cart bytes'
  );
  assert(
    crypto.createHash('md5').update(back).digest('hex') === cartMd5,
    'stripped MD5 matches the unheadered cart MD5'
  );
}

console.log(failed ? '\nFAIL' : '\nPASS');
process.exit(failed);
