// Scan the yi asm for GSU dynamic-body texture-source loads — the STATIC `FXDATA_<addr>` literals
// each sprite's draw-setup wires into R12/R13 (single-frame) or a `dw FXDATA_…` frame table.
//
// THIS is the authoritative way to find a DYNAMIC_BODY_SOURCES source (see that table's header):
// the source is a literal in the sprite's asm, NOT something to brute-force from a VRAM capture.
//
// Each `FXDATA_NNNNNN` symbol is the ABSOLUTE 6-hex SNES address of the bitmap sheet base, so
// `FXDATA_548000+$60C0` = $54:8000 + $60C0 = $54:E0C0. (The earlier tmp/ scanner's regex
// `FXDATA_5[456]0000` silently skipped the `…8000` bases — so $54:8000+/$55:8000+ sources like the
// $098 yoshi block were ABSENT from its table, which read as "no asm source exists" → guessing.)
//
// Run:  npm run dynbody-sources            → all $54-$56 (dynbody region) sources
//                   npm run dynbody-sources -- 54e0c0  → filter to an address (confirm a candidate)
//                   npm run dynbody-sources -- yoshi   → filter by routine substring
//                   npm run dynbody-sources -- --all   → every FXDATA_5xxxxx load (incl. BG/$52)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../yi/Banks');

export interface DynbodyAsmSource {
  /** Absolute SNES address from the FXDATA literal (may be odd = high-nibble flag). */
  snes: number;
  /** Even byte address (`snes & ~1`) — the bitmap top-left; matches a table `delta`. */
  byteAddr: number;
  routine: string;
  file: string;
  line: number;
  /** `lda` = an `LDA #FXDATA_…` source-address immediate (any plotter register); `dw` = a
   *  `dw FXDATA_…` frame-table entry. (Plotters differ — the LOOP uploader takes the source in
   *  R12/R13, the door/mirror plotter `FXCODE_08D317` in R9/R11 — so we key on the FXDATA literal
   *  itself, not the destination register, to stay idiom-independent.) */
  kind: 'lda' | 'dw';
}

const reLabel = /^([A-Za-z_][\w]*):/;
const reFX = /FXDATA_([0-9A-Fa-f]{6})(?:\s*\+\s*\$([0-9A-Fa-f]+))?/g;
const code = (ln: string): string => ln.split(';')[0]!; // strip line comment

function fxAddr(baseHex: string, offHex: string | undefined): number {
  return parseInt(baseHex, 16) + (offHex ? parseInt(offHex, 16) : 0);
}

/** Scan every `Bank??.asm` for FXDATA source references. Returns one row per literal found —
 *  EVERY `FXDATA_…` immediate that is a full source address (the `>>16` bank-byte halves are
 *  skipped), plus every `dw FXDATA_…` table entry. Register/plotter agnostic. */
export function scanDynbodyAsmSources(asmDir: string = ASM_DIR): DynbodyAsmSource[] {
  const out: DynbodyAsmSource[] = [];
  const files = fs.readdirSync(asmDir).filter((f) => /^Bank[0-9A-Fa-f]{2}\.asm$/.test(f)).sort();
  for (const f of files) {
    const lines = fs.readFileSync(path.join(asmDir, f), 'utf8').split('\n');
    let routine = '?';
    for (let i = 0; i < lines.length; i++) {
      const lm = lines[i]!.match(reLabel);
      if (lm) routine = lm[1]!;
      const c = code(lines[i]!);
      if (!/FXDATA_/i.test(c)) continue;
      const isDw = /^\s*d[wl]\s+/i.test(c);
      // A non-table line that takes the high byte (`>>16`) is the R13/R11 bank half of a pointer
      // already counted from its low-immediate sibling — skip so we don't log a bogus `…>>16` addr.
      if (!isDw && /(>>|>>>)\s*16/.test(c)) continue;
      reFX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = reFX.exec(c))) {
        const snes = fxAddr(m[1]!, m[2]);
        out.push({ snes, byteAddr: snes & ~1, routine, file: f, line: i + 1, kind: isDw ? 'dw' : 'lda' });
      }
    }
  }
  return out;
}

/** Set of even byte addresses ($54-$56 dynbody region by default) seen as an asm FXDATA source. */
export function dynbodyAsmSourceSet(asmDir?: string, banksLo = 0x54, banksHi = 0x56): Set<number> {
  const set = new Set<number>();
  for (const s of scanDynbodyAsmSources(asmDir)) {
    const bank = (s.byteAddr >> 16) & 0xff;
    if (bank >= banksLo && bank <= banksHi) set.add(s.byteAddr);
  }
  return set;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const all = arg === '--all';
  let rows = scanDynbodyAsmSources();
  if (!all) rows = rows.filter((s) => { const b = (s.byteAddr >> 16) & 0xff; return b >= 0x54 && b <= 0x56; });
  if (arg && !all) {
    const hex = arg.replace(/^\$/, '').toLowerCase();
    const isHex = /^[0-9a-f]{4,6}$/.test(hex);
    rows = rows.filter((s) => isHex ? s.snes.toString(16).includes(hex) || s.byteAddr.toString(16).includes(hex) : s.routine.toLowerCase().includes(arg.toLowerCase()));
  }
  rows.sort((a, b) => a.byteAddr - b.byteAddr || a.routine.localeCompare(b.routine));
  // de-dup identical (addr,routine) rows from repeated dw frames
  const seen = new Set<string>();
  const uniq = rows.filter((s) => { const k = `${s.byteAddr}|${s.routine}|${s.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  console.log(`# ${uniq.length} dynamic-body FXDATA source load(s)${all ? ' (ALL banks)' : ' (banks $54-$56)'}, by source addr:\n`);
  for (const s of uniq) {
    const a = '$' + s.byteAddr.toString(16).toUpperCase().padStart(6, '0');
    const nib = (s.snes & 1) ? ' [HIGH-nib]' : '';
    console.log(`  ${a}${nib}  ${s.kind === 'dw' ? 'dw ' : '   '}${s.routine.padEnd(40)} ${s.file}:${s.line}`);
  }
}
