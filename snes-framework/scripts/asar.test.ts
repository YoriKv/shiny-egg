// Pins parseAsarErrors + AsarError (asar.ts) on real asar 1.91 output: error
// lines (with and without a `called from` chain) parse into file/line/code/
// message, warnings and progress lines are ignored, repeats are de-duplicated,
// and the AsarError message carries the phase summary plus the error lines.
// No cart, no asar binary.
//
// Run: node snes-framework/scripts/asar.test.ts

import { AsarError, parseAsarErrors } from './asar.ts';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failed = 1; }
}

const ASSERT_LINE =
  '../global/HardwareRegisters/SNES.asm:651 (called from ../global/AssembleFile.asm:10): error: (Eassertion_failed): Assertion failed. [assert pc() <= $5110DB|$000000|$000000]';
const PATCH_LINE =
  '../yi/Custom/Asar_Patches_YI.asm:10 (called from ../global/AssembleFile.asm:14): error: (Eunknown_command): Unknown command. [LDQ #$01]';
const OUTPUT = [
  'Code Alignment Disabled: No',
  '',
  '../yi/Banks/Bank57.asm:1620 (called from ../global/AssembleFile.asm:10): warning: (Wfeature_deprecated): DEPRECATION NOTIFICATION: ...',
  ASSERT_LINE,
  ASSERT_LINE, // asar repeats an error once per pass that reaches it
  PATCH_LINE,
  'plain.asm:3: error: (Emissing_org): Missing org or freespace command. [db $00]',
  'Errors were detected while assembling the patch. Assembling aborted. Your ROM has not been modified.',
].join('\r\n');

console.log('parseAsarErrors:');
const diags = parseAsarErrors(OUTPUT);
assert(diags.length === 3, `3 distinct errors (warning ignored, repeat folded), got ${diags.length}`);
assert(
  diags[0]!.file === '../global/HardwareRegisters/SNES.asm' && diags[0]!.line === 651 && diags[0]!.code === 'Eassertion_failed',
  'assert: file, line and code parsed past the called-from chain'
);
assert(diags[0]!.message === 'Assertion failed. [assert pc() <= $5110DB|$000000|$000000]', 'assert: message keeps the source echo');
assert(diags[1]!.file === '../yi/Custom/Asar_Patches_YI.asm' && diags[1]!.line === 10, 'patch hook line parsed');
assert(diags[2]!.file === 'plain.asm' && diags[2]!.line === 3 && diags[2]!.code === 'Emissing_org', 'error without a called-from chain parsed');
assert(parseAsarErrors('all good\nwarning only').length === 0, 'no error lines → empty');

console.log('AsarError:');
const err = new AsarError('asar exited with status 1 during "Apply patches"', 'Apply patches', diags);
assert(err.phase === 'Apply patches' && err.diagnostics === diags, 'carries phase + diagnostics');
assert(err.message.startsWith('asar exited with status 1 during "Apply patches"\n'), 'message leads with the summary');
assert(err.message.includes('../yi/Custom/Asar_Patches_YI.asm:10: Unknown command. [LDQ #$01]'), 'message lists the error lines');

process.exit(failed);
