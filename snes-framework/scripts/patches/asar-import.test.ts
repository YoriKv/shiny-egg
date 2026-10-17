// Unit test: asar-style patch import conversion (asar idioms → build-compatible
// form) + leading-comment metadata mining.
// Run: node snes-framework/scripts/patches/asar-import.test.ts

import { parseWlaSymbolMap } from '../engine/symbol-map.ts';
import { convertAsarPatch, deriveAsmPatchMeta } from './asar-import.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

// Mirrors build-tree.ts assertNoFreecodeInPatches — the build-time backstop the
// converter output must satisfy (no banned directive survives in CODE).
function hasBannedDirective(asm: string): boolean {
  const banned = /\b(freecode|freedata|freespace|autoclean)\b/;
  return asm.split('\n').some((raw) => banned.test(raw.replace(/;.*$/, '')));
}

// The shared example: a synthetic asar hack in the common community shape (org
// hijack + autoclean jsl + freecode block running to EOF), with a leading header
// comment block (title / `by` credit / summary / version) for the metadata miner.
const EXAMPLE_PATCH = `asar 1.90
; Yoshi's Island: Example Hijack Patch
; by Shiny Egg tests
; Calls a freespace routine from an engine hijack
; v1.00

!example_flag = $0b55
!example_value = $0b57

org $0d8123
\tautoclean jsl example_hook
\tnop

freespacebyte $ff
freecode

example_hook:
\tlda !example_value
\tinc a
\tsta !example_flag
\trtl`;

// Reference symbols: a CODE_ label just before the org target ($0D8123 = PC
// 0x68123) so the org drift-proofs to `!CODE_0D8100+$23`.
const refSym = parseWlaSymbolMap('[labels]\n0D:8100 CODE_0D8100\n');

console.log('=== convertAsarPatch: example patch ===');
{
  const { asm, notes } = convertAsarPatch(EXAMPLE_PATCH, { refSym });
  assert(!/asar\s+1\.90/.test(asm), 'asar version line stripped');
  assert(!/freespacebyte/.test(asm), 'freespacebyte dropped');
  assert(!hasBannedDirective(asm), 'no banned directive survives in code (build guard would pass)');
  assert(asm.includes('%patchcode()'), 'freecode → %patchcode()');
  assert(asm.includes('%endpatchcode()'), '%endpatchcode() auto-inserted at EOF');
  assert(/^\s*jsl example_hook/m.test(asm), 'autoclean jsl → plain jsl');
  assert(asm.includes('org !CODE_0D8100+$23'), 'org $0d8123 → org !CODE_0D8100+$23 (drift-proofed)');
  assert(asm.includes('example_hook:'), 'freespace routine label preserved');
  // exactly one open/close pair
  assert((asm.match(/%patchcode\(\)/g) ?? []).length === 1, 'exactly one %patchcode()');
  assert((asm.match(/%endpatchcode\(\)/g) ?? []).length === 1, 'exactly one %endpatchcode()');
  assert(notes.length > 0, 'conversion notes recorded');
}

console.log('=== convertAsarPatch: idempotence ===');
{
  const once = convertAsarPatch(EXAMPLE_PATCH, { refSym }).asm;
  const twice = convertAsarPatch(once, { refSym }).asm;
  assert(once === twice, 're-converting already-converted asm is a no-op');
}

console.log('=== convertAsarPatch: org kept raw without refSym ===');
{
  const { asm } = convertAsarPatch('org $0d8123\n\tnop');
  assert(asm.includes('org $0d8123'), 'no refSym → org left raw');
  assert(!asm.includes('!CODE'), 'no label substituted without refSym');
}

console.log('=== convertAsarPatch: SuperFX/HiROM org kept raw ===');
{
  // bank $41 is SuperFX HiROM — not LoROM, so not drift-proofed even with a hit.
  const fxSym = parseWlaSymbolMap('[labels]\n41:8000 FXCODE_418000\n');
  const { asm } = convertAsarPatch('org $418010\n\tnop', { refSym: fxSym });
  assert(asm.includes('org $418010'), 'non-LoROM org left raw');
}

console.log('=== convertAsarPatch: two freecode blocks both close ===');
{
  const src = 'freecode\nlabel_a:\n\trtl\nfreedata\nlabel_b:\n\tdb $00';
  const { asm } = convertAsarPatch(src);
  assert((asm.match(/%patchcode\(\)/g) ?? []).length === 1, 'one %patchcode()');
  assert((asm.match(/%patchdata\(\)/g) ?? []).length === 1, 'one %patchdata()');
  assert((asm.match(/%endpatchcode\(\)/g) ?? []).length === 1, 'first block closed before freedata');
  assert((asm.match(/%endpatchdata\(\)/g) ?? []).length === 1, 'second block closed at EOF');
}

console.log('=== convertAsarPatch: org after freecode closes the block ===');
{
  const src = 'freecode\nmyroutine:\n\trtl\norg $008000\n\tnop';
  const { asm } = convertAsarPatch(src);
  const lines = asm.split('\n');
  const endIdx = lines.findIndex((l) => l.includes('%endpatchcode()'));
  const orgIdx = lines.findIndex((l) => /\borg\b/.test(l));
  assert(endIdx >= 0 && orgIdx >= 0 && endIdx < orgIdx, '%endpatchcode() emitted before the org');
}

console.log('=== deriveAsmPatchMeta ===');
{
  const meta = deriveAsmPatchMeta(EXAMPLE_PATCH, 'example_hook.asm');
  assert(meta.name === 'example_hook', 'name from filename stem');
  assert(meta.description === "Yoshi's Island: Example Hijack Patch", 'description from first header comment');
  assert(meta.attribution === 'by Shiny Egg tests', 'attribution from the "by …" line');
  assert(Array.isArray(meta.details) && meta.details.length === 4, 'all 4 header comments captured in details');
}

console.log(`${failures === 0 ? '✓' : '✗'} asar-import: ${failures === 0 ? 'all checks pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
