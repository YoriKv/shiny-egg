// Pins the GSU register-indirect RAM-access tracker in codegraph.ts
// (trackGsuIndirectAccesses): the forward constant-propagation pass that lets
// `xref --reads-addr 70:0FA0` surface SuperFX consumers written as
// `IWT R7,#$0FA0 … LDW (R7)` instead of a static `LM`. Every case below is a
// real idiom from yi/SuperFX/Banks (sprite-vs-sprite checker, tongue pass,
// terrain check, OAM pass). Pure, no cart or build needed.
//
// Run: node snes-framework/scripts/codegraph.test.ts

import { trackGsuIndirectAccesses } from './codegraph.ts';

let failures = 0;
const check = (cond: boolean, msg: string): void => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

const flat = (lines: string[]): string[] =>
  [...trackGsuIndirectAccesses(lines).entries()]
    .flatMap(([i, accs]) => accs.map((a) => `${i}:${a.kind}:${a.addr.toString(16).toUpperCase()}${a.indexed ? '+' : ''}`));

console.log('1. base + slot index, read through default R0 (terrain check idiom)');
{
  const r = flat([
    'IWT R0, #$0F62',
    'ADD R1',
    'LDW (R0)',
    'IBT R7, #$1F',
    'AND R7',
  ]);
  check(r.join(' ') === '2:r:F62+', `indexed read of $0F62 on line 2 (got ${r.join(' ')})`);
}

console.log('2. pointer register loaded before the loop label, used after it (tongue pass)');
{
  const r = flat([
    'IWT R7, #$0FA0',
    'IWT R8, #$1040',
    'IBT R14, #$40',
    'WITH R12',
    'CODE_loop_head_is_not_a_body_line',  // a label would be lexed away; a stray identifier must be ignored
    'TO R0',
    'LDB (R0)',          // R0 unknown: no access
    'SUB #3',
    'BCC skip : NOP',
    'LDW (R7)',
    'AND R14',
    'LDW (R8)',
    'BIC #12',
    'SBK',
  ]);
  check(r.includes('9:r:FA0'), `read of $0FA0 via R7 (got ${r.join(' ')})`);
  check(r.includes('11:r:1040'), 'read of $1040 via R8');
  check(r.includes('13:w:1040'), 'SBK re-stores to the last RAM address ($1040)');
  check(!r.some((x) => x.startsWith('6:')), 'LDB through an unknown register yields nothing');
}

console.log('3. WITH prefix: base register advanced by an unknown index keeps its base');
{
  const r = flat([
    'IWT R1, #$0FA1',
    'WITH R1',
    'ADD R12',
    'LDW (R1)',
  ]);
  check(r.join(' ') === '3:r:FA1+', `indexed read of $0FA1 (got ${r.join(' ')})`);
}

console.log('4. known + known adds bases; immediates add/subtract; INC/DEC walk the pointer');
{
  const r = flat([
    'IWT R0, #$0F62',
    'IWT R2, #$0040',
    'ADD R2',           // R0 = $0FA2
    'TO R3',
    'ADD #2',           // R3 = $0FA4
    'INC R3',           // $0FA5
    'DEC R3',           // $0FA4
    'LDW (R3)',
    'FROM R3',
    'SUB #4',           // R0 = $0FA0 (Dreg defaults back to R0)
    'STW (R0)',
  ]);
  check(r.includes('7:r:FA4'), `read of $0FA4 (got ${r.join(' ')})`);
  check(r.includes('10:w:FA0'), 'write of $0FA0 after SUB #4');
}

console.log('5. dual-issue delay slot and store forms');
{
  const r = flat([
    'IWT R10, #$1222',
    'IWT R4, #$11E0',
    'BPL somewhere : LDW (R10)',
    'FROM R2',
    'STW (R4)',
    'STB (R4)',
  ]);
  check(r.includes('2:r:1222'), `delay-slot LDW indexed (got ${r.join(' ')})`);
  check(r.includes('4:w:11E0') && r.includes('5:w:11E0'), 'STW and STB record writes');
}

console.log('6. forgetting: ALU ops and loads clobber Dreg; label-based immediates are unknown');
{
  const r = flat([
    'IWT R0, #$0F62',
    'AND R7',           // R0 forgotten
    'LDW (R0)',         // nothing
    'IWT R14, #DATA_0ACECB-$02',
    'LDW (R14)',        // nothing: ROM pointer, not a RAM constant
    'IWT R5, #$1D36',
    'TO R5',
    'GETB',             // R5 forgotten
    'LDB (R5)',         // nothing
    'MOVE R6, R0',      // R0 is unknown -> R6 unknown
    'LDW (R6)',
  ]);
  check(r.length === 0, `no accesses resolved (got ${r.join(' ')})`);
}

console.log('7. IBT sign-extends; MOVE copies a known value; SBK after a static LMS');
{
  const r = flat([
    'IBT R3, #$F0',     // $FFF0
    'IWT R2, #$1D36',
    'MOVE R9, R2',
    'LDB (R9)',
    'LMS R0, ($152)',
    'INC R0',
    'SBK',              // -> $0152
    'LDW (R3)',         // $FFF0: resolved (not RAM, but the tracker is agnostic)
  ]);
  check(r.includes('3:r:1D36'), `MOVE propagates the constant (got ${r.join(' ')})`);
  check(r.includes('6:w:152'), 'SBK after LMS writes the LMS address');
  check(r.includes('7:r:FFF0'), 'IBT sign-extension');
}

console.log('8. slot loop (IWT R13 + LOOP): stride-advanced pointers keep their pre-loop base');
{
  const lines = [
    'IWT R7, #$0FA0',
    'IWT R8, #$1040',
    'IBT R12, #$18',
    'IWT R13, #loop_head',
    'WITH R12',
    '',                       // loop_head declared here (label-only line)
    'TO R0',
    'LDB (R0)',
    'LDW (R7)',               // first use: still the plain base
    'IBT R0, #$04',
    'WITH R7',
    'ADD R0',                 // stride add inside the loop -> indexed base
    'WITH R8',
    'ADD R0',
    'LOOP : MOVE R0, R12',
    'STOP : NOP',
    'SUB R12',                // R12 is loop-variant -> unknown result
    'TO R1',
    'ADD R0',
    'IWT R0, #$0EFF',
    'TO R5',
    'ADD R1',                 // $0EFF + unknown
    'INC R5',                 // -> $0F00 indexed
    'STW (R5)',
    'LDW (R7)',               // $0FA0 indexed (not $0FA4)
    'INC R7',
    'INC R7',
    'LDW (R7)',               // $0FA2 indexed
    'LDW (R8)',               // $1040 indexed
    'SBK',
  ];
  const r = [...trackGsuIndirectAccesses(lines, new Map([['loop_head', 5]])).entries()]
    .flatMap(([i, accs]) => accs.map((a) => `${i}:${a.kind}:${a.addr.toString(16).toUpperCase()}${a.indexed ? '+' : ''}`));
  check(r.includes('8:r:FA0'), `pre-stride read is the plain base (got ${r.join(' ')})`);
  check(r.includes('23:w:F00+'), 'status write resolves to $0F00 indexed');
  check(r.includes('24:r:FA0+'), 'post-loop read keeps base $0FA0 (not +4)');
  check(r.includes('27:r:FA2+'), 'INC/INC after the loop walks to $0FA2');
  check(r.includes('28:r:1040+') && r.includes('29:w:1040+'), 'R8 read + SBK at $1040');
}

console.log('9. MOVE R13,R15 loop form and a backward Bcc loop');
{
  const lines = [
    'IWT R0, #$1222',
    'IBT R12, #$28',
    'MOVE R13, R15',
    'IWT R1, #$1C76',   // defined inside the loop: normal arithmetic applies
    'WITH R1',
    'ADD #2',
    'TO R2',
    'LDW (R1)',         // $1C78 plain (TO R2 keeps R0 intact)
    'IBT R3, #$04',
    'ADD R3',           // R0: defined before the loop, stride-added inside -> indexed $1222
    'TO R2',
    'LDW (R0)',
    'LOOP : NOP',
    'IWT R9, #$1D36',
    '',                 // back_edge label
    'LDB (R9)',
    'INC R9',
    'BNE back_edge : NOP',
  ];
  const r = [...trackGsuIndirectAccesses(lines, new Map([['back_edge', 14]])).entries()]
    .flatMap(([i, accs]) => accs.map((a) => `${i}:${a.kind}:${a.addr.toString(16).toUpperCase()}${a.indexed ? '+' : ''}`));
  check(r.includes('7:r:1C78'), `in-loop defined pointer uses plain arithmetic (got ${r.join(' ')})`);
  check(r.includes('11:r:1222+'), 'pre-loop pointer modified in loop is indexed at its base');
  check(r.includes('15:r:1D36'), 'backward-branch loop: first read at base');
}

console.log('10. in-loop field walk vs stride: walks are exact for iteration 0, strides reset to the entry base');
{
  const lines = [
    'IWT R6, #$1BB6',
    'IBT R12, #$18',
    'IWT R13, #head',
    '',                  // head
    'TO R2',
    'LDW (R6)',          // $1BB6
    'INC R6',
    'INC R6',
    'TO R3',
    'LDW (R6)',          // $1BB8 (walk)
    'IBT R0, #$04',
    'WITH R6',
    'ADD R0',            // stride -> back to entry base $1BB6, indexed
    'LOOP : NOP',
    'TO R2',
    'LDW (R6)',          // $1BB6+
  ];
  const r = [...trackGsuIndirectAccesses(lines, new Map([['head', 3]])).entries()]
    .flatMap(([i, accs]) => accs.map((a) => `${i}:${a.kind}:${a.addr.toString(16).toUpperCase()}${a.indexed ? '+' : ''}`));
  check(r.includes('5:r:1BB6') && r.includes('9:r:1BB8'), `walk inside the loop is applied (got ${r.join(' ')})`);
  check(r.includes('15:r:1BB6+'), 'stride resets to the loop-entry base, indexed');
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall codegraph tracker checks passed');
