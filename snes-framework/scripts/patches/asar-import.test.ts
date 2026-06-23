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

// The shared example: Sillymel's "Any level" hack (org hijack + autoclean jsl +
// freecode block running to EOF).
const SILLYMEL = `asar 1.90
; Yoshi's Island: Any level Hack
; by Sillymel
; Fade to credits after beating any number of levels
; v1.03

!current_lvl_index = $021a
!gamemode = $0118

org $01beb8
\tautoclean jsl end_on_level_number
\tnop

freespacebyte $ff
freecode

end_on_level_number:
\tlda !current_lvl_index
\tldx #$1a
\tstx !gamemode
\trtl`;

// Reference symbols: a CODE_ label just before the org target ($01BEB8 = PC
// 0xBEB8) so the org drift-proofs to `!CODE_01BE9F+$19`.
const refSym = parseWlaSymbolMap('[labels]\n01:BE9F CODE_01BE9F\n');

console.log('=== convertAsarPatch: Sillymel example ===');
{
  const { asm, notes } = convertAsarPatch(SILLYMEL, { refSym });
  assert(!/asar\s+1\.90/.test(asm), 'asar version line stripped');
  assert(!/freespacebyte/.test(asm), 'freespacebyte dropped');
  assert(!hasBannedDirective(asm), 'no banned directive survives in code (build guard would pass)');
  assert(asm.includes('%patchcode()'), 'freecode → %patchcode()');
  assert(asm.includes('%endpatchcode()'), '%endpatchcode() auto-inserted at EOF');
  assert(/^\s*jsl end_on_level_number/m.test(asm), 'autoclean jsl → plain jsl');
  assert(asm.includes('org !CODE_01BE9F+$19'), 'org $01beb8 → org !CODE_01BE9F+$19 (drift-proofed)');
  assert(asm.includes('end_on_level_number:'), 'freespace routine label preserved');
  // exactly one open/close pair
  assert((asm.match(/%patchcode\(\)/g) ?? []).length === 1, 'exactly one %patchcode()');
  assert((asm.match(/%endpatchcode\(\)/g) ?? []).length === 1, 'exactly one %endpatchcode()');
  assert(notes.length > 0, 'conversion notes recorded');
}

console.log('=== convertAsarPatch: idempotence ===');
{
  const once = convertAsarPatch(SILLYMEL, { refSym }).asm;
  const twice = convertAsarPatch(once, { refSym }).asm;
  assert(once === twice, 're-converting already-converted asm is a no-op');
}

console.log('=== convertAsarPatch: org kept raw without refSym ===');
{
  const { asm } = convertAsarPatch('org $01beb8\n\tnop');
  assert(asm.includes('org $01beb8'), 'no refSym → org left raw');
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
  const meta = deriveAsmPatchMeta(SILLYMEL, 'end_on_level_number.asm');
  assert(meta.name === 'end_on_level_number', 'name from filename stem');
  assert(meta.description === "Yoshi's Island: Any level Hack", 'description from first header comment');
  assert(meta.attribution === 'by Sillymel', 'attribution from the "by …" line');
  assert(Array.isArray(meta.details) && meta.details.length === 4, 'all 4 header comments captured in details');
}

console.log(`${failures === 0 ? '✓' : '✗'} asar-import: ${failures === 0 ? 'all checks pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
