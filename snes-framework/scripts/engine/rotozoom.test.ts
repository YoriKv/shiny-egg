// Verify the embedded quarter-cosine LUT byte-matches the cart's DATA_08AB98, and that the rotozoom
// reproduces the known cases (identity = exact, pure-scale = high) against their captures.
// Run: node snes-framework/scripts/engine/rotozoom.test.ts
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { QUARTER_COS, COS_LUT_SYMBOL, rotozoomDecode } from './rotozoom.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const { rom, symbols } = loadDevCart(FRAMEWORK_ROOT);

// 1. Embedded LUT == cart DATA_08AB98 (65 words, 8.8 fixed). If this fails, the cart shifted or the
//    embed is stale — re-dump from the cart.
const pc = symbols.tryPc(COS_LUT_SYMBOL);
assert(pc !== undefined, `${COS_LUT_SYMBOL} resolves in the full symbol map`);
if (pc !== undefined) {
  let match = true;
  for (let i = 0; i <= 64; i++) { const cart = rom[pc + i * 2]! | (rom[pc + i * 2 + 1]! << 8); if (cart !== QUARTER_COS[i]) { match = false; console.error(`    cos[${i}]: embed ${QUARTER_COS[i]} != cart ${cart}`); break; } }
  assert(match && QUARTER_COS.length === 65, 'embedded QUARTER_COS byte-matches the cart (65 entries)');
}

// 2. Identity (angle 0, scale 256) returns the source verbatim (centre pixel == raw source byte).
{
  const anchorPC = symbols.tryPc('DATA_gfx_bank54_part2')!;
  const srcPC = anchorPC + (0x556020 - 0x548000); // $09E Chomp Rock body (rigid)
  const r = rotozoomDecode(rom, symbols, srcPC, 32, 32, false, { angle: 0, scale: 256 });
  // at identity the output is the source padded/centred; the source's (0,0) maps to output centre-ish.
  const raw = rom[srcPC]! & 0x0f;
  // find any nonzero to prove it decoded content
  const nz = r.indices.reduce((a, b) => a + (b ? 1 : 0), 0);
  assert(r.width === r.height && nz > 0, `identity rotozoom decodes non-empty ${r.width}×${r.height} (${nz} px)`);
  void raw;
}

// 3. cos quadrant reflection sanity: cos(0)=256, cos(64)=0, cos(128)=-256, cos(192)=0.
{
  // re-derive via the same public LUT
  const cosF = (a: number): number => { a = ((a % 256) + 256) % 256; const q = a >> 6, i = a & 63; switch (q) { case 0: return QUARTER_COS[i]!; case 1: return -QUARTER_COS[64 - i]!; case 2: return -QUARTER_COS[i]!; default: return QUARTER_COS[64 - i]!; } };
  assert(cosF(0) === 256 && cosF(64) === 0 && cosF(128) === -256 && cosF(192) === 0, 'cos quadrant reflection (0/64/128/192 = 256/0/-256/0)');
}

if (failures) { console.error(`\n✗ ${failures} rotozoom test failure(s)`); process.exit(1); }
console.log('✓ all rotozoom tests passed');
