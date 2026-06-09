// scripts/mem-symbols.ts
//
// Parses the `!NAME = expr` / `!NAME #= expr` memory defines under
// `yi/Memory/*.asm` and resolves each to a 24-bit SNES address. Output is
// a `SymbolTable` keyed by define name (without the leading `!`) — used by
// `codegraph.ts` to map raw `$xxxx` literals in asm to their canonical
// define name when building the call-graph + xref index.
//
// Extracted from yi-shiny's `verify-static.ts` (the parser/resolver half;
// the verification checks themselves are not ported).
//
// Expression grammar (only what shows up in Memory/*.asm):
//   atom      := '$' hex | '!' ident | '(' expr ')'
//   mul       := atom (('*'|'/') atom)*
//   add       := mul (('+'|'-') mul)*
//   shift     := add (('<<'|'>>') add)*
//   bitand    := shift ('&' shift)*
//   bitor     := bitand ('|' bitand)*
//   expr      := bitor
//
// Precedence matches asar 1.91 (and JS): `&` < `<<`, `|` < `+` — see
// CLAUDE.md "asar 1.81 → 1.91 gotchas" for why this matters.

import * as fs from 'node:fs';
import * as path from 'node:path';

const SRAM_BANK_BASE = 0x700000;

export type Region =
  | 'DP'          // $000000-$0000FF — direct page
  | 'WRAM_BANK0'  // $000100-$001FFF — bank-0 mirror of WRAM low (accessed via .w)
  | 'WRAM_LOW'    // $7E0000-$7E1FFF — WRAM low (direct)
  | 'WRAM_MAIN'   // $7E2000-$7FFFFF — WRAM main
  | 'SRAM'        // $700000-$707FFF — SuperFX cart RAM (32 KB)
  | 'OTHER';

export interface MemorySymbol {
  name: string;          // without the leading '!'
  raw: string;           // raw RHS text (post-comment-strip)
  eager: boolean;        // true for `#=`, false for `=`
  addr: number | null;   // resolved 24-bit address; null if label-derived
  region: Region | null;
  file: string;          // relative to repo root
  line: number;          // 1-based
}

export interface SymbolTable {
  byName: Map<string, MemorySymbol>;
  ordered: MemorySymbol[];
  unresolved: MemorySymbol[];
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

interface RawDefine {
  name: string;
  raw: string;
  eager: boolean;
  file: string;
  line: number;
}

const DEFINE_RE = /^!(\w+)\s*(#?=)\s*(.+?)\s*$/;

function parseFile(absPath: string, repoRoot: string): RawDefine[] {
  const rel = path.relative(repoRoot, absPath).replaceAll(path.sep, '/');
  const text = fs.readFileSync(absPath, 'latin1'); // per CLAUDE.md: files may contain Latin-1
  const lines = text.split(/\r?\n/);
  const out: RawDefine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const semi = line.indexOf(';');
    const code = (semi >= 0 ? line.slice(0, semi) : line).trim();
    if (!code.startsWith('!')) continue;
    const m = code.match(DEFINE_RE);
    if (!m) continue;
    const [, name, op, raw] = m as unknown as [string, string, string, string];
    out.push({ name, raw, eager: op === '#=', file: rel, line: i + 1 });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Expression evaluator
// -----------------------------------------------------------------------------

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' | '&' | '|' | '<<' | '>>' | '(' | ')' }
  | { kind: 'def'; name: string }
  | { kind: 'label'; name: string };

function tokenize(s: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '$') {
      let j = i + 1;
      while (j < s.length && /[0-9A-Fa-f]/.test(s[j]!)) j++;
      if (j === i + 1) return null;
      const v = parseInt(s.slice(i + 1, j), 16);
      if (Number.isNaN(v)) return null;
      tokens.push({ kind: 'num', value: v });
      i = j;
      continue;
    }
    if (c === '!') {
      let j = i + 1;
      while (j < s.length && /\w/.test(s[j]!)) j++;
      tokens.push({ kind: 'def', name: s.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /\w/.test(s[j]!)) j++;
      tokens.push({ kind: 'label', name: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '<' && s[i + 1] === '<') { tokens.push({ kind: 'op', op: '<<' }); i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { tokens.push({ kind: 'op', op: '>>' }); i += 2; continue; }
    if ('+-*/&|()'.includes(c)) { tokens.push({ kind: 'op', op: c as never }); i++; continue; }
    return null;
  }
  return tokens;
}

class ExprParser {
  pos = 0;
  toks: Token[];
  defs: Map<string, number>;
  constructor(toks: Token[], defs: Map<string, number>) {
    this.toks = toks;
    this.defs = defs;
  }
  private peek(): Token | undefined { return this.toks[this.pos]; }
  private eat(): Token { return this.toks[this.pos++]!; }
  private isOp(op: string): boolean { const t = this.peek(); return !!t && t.kind === 'op' && t.op === op; }

  parseExpr(): number { return this.parseOr(); }
  private parseOr(): number {
    let v = this.parseAnd();
    while (this.isOp('|')) { this.eat(); v = (v | this.parseAnd()) >>> 0; }
    return v;
  }
  private parseAnd(): number {
    let v = this.parseShift();
    while (this.isOp('&')) { this.eat(); v = (v & this.parseShift()) >>> 0; }
    return v;
  }
  private parseShift(): number {
    let v = this.parseAdd();
    while (this.isOp('<<') || this.isOp('>>')) {
      const t = this.eat() as { kind: 'op'; op: string };
      const r = this.parseAdd();
      v = (t.op === '<<' ? (v << r) : (v >>> r)) >>> 0;
    }
    return v;
  }
  private parseAdd(): number {
    let v = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const t = this.eat() as { kind: 'op'; op: string };
      const r = this.parseMul();
      v = t.op === '+' ? (v + r) : (v - r);
    }
    return v;
  }
  private parseMul(): number {
    let v = this.parseAtom();
    while (this.isOp('*') || this.isOp('/')) {
      const t = this.eat() as { kind: 'op'; op: string };
      const r = this.parseAtom();
      v = t.op === '*' ? (v * r) : Math.floor(v / r);
    }
    return v;
  }
  private parseAtom(): number {
    const t = this.eat();
    if (!t) throw new Error('unexpected end of expression');
    if (t.kind === 'op' && t.op === '(') {
      const v = this.parseExpr();
      const close = this.eat();
      if (!close || close.kind !== 'op' || close.op !== ')') throw new Error('missing )');
      return v;
    }
    if (t.kind === 'op' && t.op === '-') return -this.parseAtom();
    if (t.kind === 'num') return t.value;
    if (t.kind === 'def') {
      if (t.name === 'SRAMBankBaseAddress') return SRAM_BANK_BASE;
      const v = this.defs.get(t.name);
      if (v === undefined) throw new Error(`undefined: !${t.name}`);
      return v;
    }
    // bare label - unresolvable statically
    throw new Error(`label-derived: ${t.kind === 'label' ? t.name : JSON.stringify(t)}`);
  }
}

function tryResolve(raw: string, defs: Map<string, number>): number | null {
  const toks = tokenize(raw);
  if (!toks) return null;
  try {
    const p = new ExprParser(toks, defs);
    const v = p.parseExpr();
    if (p.pos !== toks.length) return null;
    return v >>> 0;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Region classification
// -----------------------------------------------------------------------------

function classifyRegion(addr: number): Region {
  if (addr <= 0x0000FF) return 'DP';
  if (addr <= 0x001FFF) return 'WRAM_BANK0';
  if (addr >= 0x700000 && addr <= 0x707FFF) return 'SRAM';
  if (addr >= 0x7E0000 && addr <= 0x7E1FFF) return 'WRAM_LOW';
  if (addr >= 0x7E2000 && addr <= 0x7FFFFF) return 'WRAM_MAIN';
  return 'OTHER';
}

// -----------------------------------------------------------------------------
// Public: build the table
// -----------------------------------------------------------------------------

export function buildSymbolTable(repoRoot: string): SymbolTable {
  const memDir = path.join(repoRoot, 'yi', 'Memory');
  const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.asm')).sort();
  const raws: RawDefine[] = [];
  for (const f of files) {
    raws.push(...parseFile(path.join(memDir, f), repoRoot));
  }

  // Multi-pass fixpoint: resolve all defines that don't depend on labels.
  const defs = new Map<string, number>();
  for (let pass = 0; pass < 8; pass++) {
    let progressed = false;
    for (const e of raws) {
      if (defs.has(e.name)) continue;
      const v = tryResolve(e.raw, defs);
      if (v !== null) { defs.set(e.name, v); progressed = true; }
    }
    if (!progressed) break;
  }

  const byName = new Map<string, MemorySymbol>();
  const ordered: MemorySymbol[] = [];
  const unresolved: MemorySymbol[] = [];
  for (const e of raws) {
    const addr = defs.has(e.name) ? defs.get(e.name)! : null;
    const sym: MemorySymbol = {
      name: e.name,
      raw: e.raw,
      eager: e.eager,
      addr,
      region: addr !== null ? classifyRegion(addr) : null,
      file: e.file,
      line: e.line,
    };
    byName.set(e.name, sym);
    ordered.push(sym);
    if (addr === null) unresolved.push(sym);
  }
  return { byName, ordered, unresolved };
}
