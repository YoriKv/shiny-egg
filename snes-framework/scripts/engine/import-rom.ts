// Dev CLI for the ROM-import analyzer (plan-rom-import.md). Headless, no native
// deps, runs from WSL against raw cart files:
//
//   node snes-framework/scripts/engine/import-rom.ts <foreign.sfc> [base.sfc]
//
// Defaults base to the stashed reference cart (snes-framework/reference/
// reference.sfc, written by extract). Prints the resolved anchors + the
// per-changed-record diff. A self-check: run with foreign == base and expect
// zero changed levels with every anchor at 'vanilla-addr'.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeForeignRom } from '../import/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE = path.join(here, '..', '..', 'reference', 'reference.sfc');

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase()}`;
}

function main(): void {
  const foreignPath = process.argv[2];
  const basePath = process.argv[3] ?? DEFAULT_BASE;
  if (!foreignPath) {
    console.error('usage: import-rom <foreign.sfc> [base.sfc]');
    process.exit(2);
  }
  if (!fs.existsSync(foreignPath)) {
    console.error(`foreign cart not found: ${foreignPath}`);
    process.exit(2);
  }
  if (!fs.existsSync(basePath)) {
    console.error(`base cart not found: ${basePath}\n(pass it explicitly, or run extract to stash reference.sfc)`);
    process.exit(2);
  }

  const foreign = fs.readFileSync(foreignPath);
  const base = fs.readFileSync(basePath);
  const { analysis, items } = analyzeForeignRom(foreign, base);

  console.log(`foreign: ${path.basename(foreignPath)}  md5=${analysis.foreignMd5}`);
  console.log(`base:    ${path.basename(basePath)}`);
  console.log(`baseDerived=${analysis.baseDerived}  levelPtrsResolved=${analysis.levelPtrsResolved}`);
  console.log('\nanchors:');
  for (const a of analysis.anchors) {
    const at = a.pc === null ? '—' : hex(a.pc);
    const conf = a.pc === null ? '' : ` conf=${a.confidence.toFixed(2)}`;
    console.log(`  ${a.label.padEnd(34)} ${a.method.padEnd(14)} @${at}${conf}${a.note ? `  — ${a.note}` : ''}`);
  }

  if (!analysis.levelPtrsResolved) {
    console.log('\nLevel pointer table unresolved — no level diff. See anchor note above.');
    return;
  }

  const byKind = { full: 0, 'raw-only': 0, blocked: 0 } as Record<string, number>;
  for (const l of analysis.levels) byKind[l.importability]++;
  console.log(
    `\nchanged levels: ${analysis.levels.length}  (full=${byKind.full} raw-only=${byKind['raw-only']} blocked=${byKind.blocked})  applyItems=${items.length}`
  );
  for (const l of analysis.levels) {
    const o = l.objChanged ? 'obj' : '   ';
    const s = l.sprChanged ? 'spr' : '   ';
    const f = l.foreign;
    const summary = f ? `obj=${f.objects} spr=${f.sprites} exit=${f.exits}` : '(empty)';
    console.log(
      `  ${hex(l.recordId).padEnd(6)} ${o} ${s}  ${l.importability.padEnd(9)} ${summary}${l.blockedReason ? `  — ${l.blockedReason}` : ''}`
    );
  }
}

main();
