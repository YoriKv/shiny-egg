// scripts/codegraph.ts
// Cross-bank call graph + xref index for any asar .sym file.
//
// Builds (or loads from cache) a JSON sidecar that maps every label in the
// .sym to:
//   - its 24-bit SNES address
//   - the .asm file + line where it's defined
//   - the other labels sharing its address (aliases)
//   - the labels it calls / is called by (via JSL/JSR/JML/JMP)
//   - the `!RAM_*` / `!EXRAM_*` / `!s_*` defines it reads / writes
//
// Cache lives next to the .sym as `<sym-basename>.graph.json` with an
// embedded `symMd5`. If the MD5 of the .sym at load time matches the cache,
// the JSON is returned as-is; otherwise the graph is rebuilt and rewritten.
//
// Usage:
//   import { loadOrBuildGraph } from './codegraph.ts';
//   const g = loadOrBuildGraph('build/foo.sym');     // workRoot defaults to cwd
//   const g = loadOrBuildGraph('build/foo.sym', { workRoot, asmRoots });

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSymbolTable, type SymbolTable } from './mem-symbols.ts';
import { hex } from './hex.ts';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SourceLoc {
  /** Path relative to workRoot, forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
}

export interface GraphLabel {
  /** 24-bit SNES address. */
  address: number;
  /** "BB:AAAA" uppercase hex. */
  addressHex: string;
  /** Where this name is declared in the asm. null if not found in any scanned file. */
  source: SourceLoc | null;
  /** Other labels at the same address, including this one, in source order. */
  aliases: string[];
  /** Labels this routine calls via strict control transfer (JSL/JSR/JML/JMP). */
  calls: string[];
  /** Labels that call this routine (deduped, sorted). */
  calledBy: string[];
  /**
   * Labels REFERENCED by this routine via non-call instructions
   * (e.g. `LDA #FXCODE_0A8000`, `LDA DATA_bar,x`). Catches the SuperFX-
   * trampoline indirect-call pattern: the actual SuperFX target is loaded
   * into A immediately before the JSL through the WRAM dispatcher.
   * Excludes labels already in `calls`.
   */
  refs: string[];
  /** Labels that reference this one (inverse of `refs`). */
  referencedBy: string[];
  /** !NAME defines this routine reads from (LDA/CMP/AND/etc.). */
  reads: string[];
  /** !NAME defines this routine writes to (STA/STX/STY/STZ). */
  writes: string[];
  /** !NAME defines this routine read-modify-writes (INC/DEC/ASL/etc.). */
  rmw: string[];
}

export interface CodeGraph {
  /** Schema version — bump when the JSON shape changes. */
  version: number;
  /** ISO timestamp the cache was written. */
  generatedAt: string;
  /** MD5 of the .sym file at build time. Used to invalidate the cache. */
  symMd5: string;
  /** Absolute path to the .sym file. */
  symPath: string;
  /** Roots scanned for .asm files, relative to workRoot. */
  asmScanRoots: string[];
  /** Number of .asm files scanned. */
  asmFileCount: number;
  /** label-name -> record. */
  labels: Record<string, GraphLabel>;
  /** "BB:AAAA" -> list of label names at that address (source order). */
  addressIndex: Record<string, string[]>;
  /**
   * Address-keyed inverted indexes: "BB:AAAA" → labels that read/write/rmw
   * that address. Includes raw-literal sites that have NO matching !define
   * (the codegraph's define-name index can't surface those). For 16-bit
   * absolute operands the literal is recorded under BOTH the $00 and the
   * $7E forms (DBR is ambiguous in source), so a query for either form
   * matches the other; long (24-bit) operands are recorded under only the
   * exact bank. Keys are sorted strings in graph order; values are sorted
   * label-name arrays.
   */
  addrReadsBy: Record<string, string[]>;
  addrWritesBy: Record<string, string[]>;
  addrRmwBy: Record<string, string[]>;
  /** Call targets seen in JSL/JSR operands that didn't resolve to a known label. */
  unresolvedTargets: string[];
  /** Stats counters. */
  stats: {
    labelsTotal: number;
    labelsWithSource: number;
    addressesUnique: number;
    callEdges: number;
    refEdges: number;
    memReadEdges: number;
    memWriteEdges: number;
    memRmwEdges: number;
  };
}

export interface LoadOrBuildOptions {
  /** Project root (defaults to cwd). */
  workRoot?: string;
  /** Directories (relative to workRoot) to recurse for .asm files. Defaults to ['yi', 'global']. */
  asmRoots?: string[];
  /** Force rebuild even when MD5 matches. */
  force?: boolean;
  /** Optional progress callback (one line per major step). */
  onProgress?: (msg: string) => void;
}

const SCHEMA_VERSION = 5;
const DEFAULT_ASM_ROOTS = ['yi', 'global'];

// -----------------------------------------------------------------------------
// Top-level loader
// -----------------------------------------------------------------------------

export function loadOrBuildGraph(symPath: string, opts: LoadOrBuildOptions = {}): CodeGraph {
  const workRoot = opts.workRoot ?? process.cwd();
  const asmRoots = opts.asmRoots ?? DEFAULT_ASM_ROOTS;
  const onProgress = opts.onProgress ?? (() => {});

  if (!fs.existsSync(symPath)) {
    throw new Error(`sym file not found: ${symPath}`);
  }
  // Pick up any auxiliary .sym files emitted alongside the main one. For
  // YI: `<base>-superfx.sym` carries the SuperFX-side labels (emitted by
  // the SuperFX assembly pass when build.ts gets emitSymbols=true). Using
  // those authoritative addresses sidesteps name-based synthesis drift.
  const auxSymPaths = findAuxSymFiles(symPath);
  const allSymPaths = [symPath, ...auxSymPaths];
  const symBytes = allSymPaths.map((p) => fs.readFileSync(p));
  const symMd5 = crypto.createHash('md5')
    .update(allSymPaths.map((p, i) => path.basename(p) + ':' + symBytes[i]!.length + ':' + crypto.createHash('md5').update(symBytes[i]!).digest('hex')).join('|'))
    .digest('hex');

  const cachePath = cachePathFor(symPath);
  if (!opts.force && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CodeGraph;
      if (cached.version === SCHEMA_VERSION && cached.symMd5 === symMd5) {
        onProgress(`✓ codegraph cache hit  (${cachePath})`);
        return cached;
      }
      onProgress(`▶ codegraph cache stale (sym md5 ${cached.symMd5} → ${symMd5}); rebuilding`);
    } catch (e) {
      onProgress(`▶ codegraph cache unreadable (${(e as Error).message}); rebuilding`);
    }
  }

  const graph = buildGraph({
    symPath,
    symPaths: allSymPaths,
    symBytes,
    symMd5,
    workRoot,
    asmRoots,
    onProgress,
  });

  fs.writeFileSync(cachePath, JSON.stringify(graph));
  onProgress(`✓ codegraph written      (${cachePath})`);
  return graph;
}

/**
 * Find .sym files emitted by auxiliary assembly passes (e.g. SuperFX).
 * Convention: `<basename>-<suffix>.sym` in the same directory as the
 * primary .sym.
 */
function findAuxSymFiles(primarySymPath: string): string[] {
  const dir = path.dirname(primarySymPath);
  const base = path.basename(primarySymPath, '.sym');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.sym')) continue;
    if (name === path.basename(primarySymPath)) continue;
    if (name.startsWith(base + '-')) out.push(path.join(dir, name));
  }
  return out.sort();
}

/** Returns the path to the cache JSON for a given .sym, without creating it. */
export function cachePathFor(symPath: string): string {
  const dir = path.dirname(symPath);
  const base = path.basename(symPath).replace(/\.sym$/i, '');
  return path.join(dir, `${base}.graph.json`);
}

// -----------------------------------------------------------------------------
// .sym parsing  (BB:AAAA NAME under [labels])
// -----------------------------------------------------------------------------

interface ParsedSym {
  /** name -> 24-bit address */
  byName: Map<string, number>;
  /** address -> names (insertion order). */
  byAddr: Map<number, string[]>;
}

function parseSym(text: string): ParsedSym {
  const byName = new Map<string, number>();
  const byAddr = new Map<number, string[]>();
  let inLabels = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length === 0) continue;
    if (raw[0] === '[') {
      inLabels = raw.trim().toLowerCase() === '[labels]';
      continue;
    }
    if (!inLabels) continue;
    const m = raw.match(/^\s*([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4})\s+(\S+)/);
    if (!m) continue;
    const addr = (parseInt(m[1]!, 16) << 16) | parseInt(m[2]!, 16);
    const name = m[3]!;
    if (byName.has(name)) continue;            // dupes shouldn't happen; first wins
    byName.set(name, addr);
    let bucket = byAddr.get(addr);
    if (!bucket) { bucket = []; byAddr.set(addr, bucket); }
    bucket.push(name);
  }
  return { byName, byAddr };
}

// -----------------------------------------------------------------------------
// .asm scanning
// -----------------------------------------------------------------------------

/** Mnemonics that transfer control to a code label and should produce call edges. */
const CALL_MNEMONICS = new Set([
  'JSL', 'JSR', 'JML', 'JMP',
]);
/**
 * Mnemonics that terminate fall-through. If the last instruction before a
 * label is one of these, the label is a fresh routine entry; otherwise the
 * label is an internal branch target (and gets folded into the previous
 * routine's body for call-attribution purposes).
 */
const NO_FALLTHROUGH_MNEMONICS = new Set([
  'RTS', 'RTL', 'RTI', 'JMP', 'JML', 'BRA', 'BRL',
]);
/** Mnemonics that read from their memory operand. */
const READ_MNEMONICS = new Set([
  'LDA', 'LDX', 'LDY', 'CMP', 'CPX', 'CPY', 'BIT',
  'AND', 'ORA', 'EOR', 'ADC', 'SBC', 'PEI',
]);
/** Mnemonics that write their memory operand. */
const WRITE_MNEMONICS = new Set([
  'STA', 'STX', 'STY', 'STZ',
]);
/** Mnemonics that read-modify-write their memory operand. */
const RMW_MNEMONICS = new Set([
  'INC', 'DEC', 'ASL', 'LSR', 'ROL', 'ROR', 'TSB', 'TRB',
]);
/**
 * Branches that take a label operand and stay within a routine boundary.
 * Conditional branches (Bcc) almost always do; the unconditional BRA/BRL
 * usually do too (loop-back, dispatch fan-in). They're used as a signal
 * that a label appearing after a control-flow break is still an internal
 * jump target of the surrounding routine, not a fresh routine entry.
 *
 * JMP/JML/JSR/JSL are deliberately excluded: those are more often
 * tail-call-flavored or unconditional cross-routine transfers.
 */
const BRANCH_MNEMONICS = new Set([
  'BRA', 'BRL', 'BCC', 'BCS', 'BEQ', 'BNE', 'BMI', 'BPL', 'BVC', 'BVS',
]);

/** Capture all `!IDENT` tokens from a string. */
function extractDefineRefs(s: string): string[] {
  const out: string[] = [];
  const re = /!([A-Za-z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1]!);
  return out;
}

/**
 * Address → defines reverse map, built from the verify-static symbol table.
 * One address can map to multiple defines (intentional aliases like Lo/Hi
 * pairs at adjacent bytes, or savefile vs in-level scratch reuse). Keys
 * include both the canonical resolved address and its low-RAM mirror so
 * `LDA $0394` (DBR=$00, 16-bit) catches defines stored under $7E:0394 and
 * vice versa.
 */
type AddressIndex = Map<number, string[]>;

function buildAddressIndex(table: SymbolTable): AddressIndex {
  const idx: AddressIndex = new Map();
  const add = (addr: number, name: string): void => {
    let bucket = idx.get(addr);
    if (!bucket) { bucket = []; idx.set(addr, bucket); }
    if (!bucket.includes(name)) bucket.push(name);
  };
  for (const sym of table.ordered) {
    if (sym.addr === null) continue;
    const addr = sym.addr >>> 0;
    const bank = (addr >>> 16) & 0xFF;
    const off = addr & 0xFFFF;
    add(addr, sym.name);
    // WRAM low mirror: $7E:0000-$7E:1FFF == $00:0000-$00:1FFF (and on every
    // SNES bank $00-$3F + $80-$BF, but $00 / $7E are the two we see in
    // YI source most). Bridge so 16-bit literals match defines stored
    // under either form.
    if (bank === 0x7E && off < 0x2000) add(0x000000 | off, sym.name);
    if (bank === 0x00 && off < 0x2000) add(0x7E0000 | off, sym.name);
  }
  return idx;
}

/**
 * Extract memory-access addresses from an instruction operand. Returns
 * one or more 24-bit candidate addresses that the instruction touches,
 * along with whether the operand is direct-page (8-bit, DP-relative),
 * absolute (16-bit, DBR-relative), or long (24-bit, exact).
 *
 * Handles forms:
 *   "$94"          → DP byte → $00:0094 (assumes DP=$0000)
 *   "$0394"        → absolute → both $00:0394 and $7E:0394 (DBR ambiguous)
 *   "$7E0394"      → long → $7E:0394 only
 *   "$0394,x"      → absolute with index → same as plain $0394
 *   "($0394)"      → indirect → same as $0394 (the pointer's address)
 *   "(!FOO,x)"     → indexed-indirect through define — no literal here
 *
 * The width hint from the mnemonic (.b / .w / .l) takes priority over the
 * digit count of the literal, because asar accepts ambiguous widths (e.g.
 * `LDA.b $94` is DP even if asar might widen to `$0094`).
 */
function extractLiteralAddresses(
  operand: string,
  widthHint: 'b' | 'w' | 'l' | null,
): number[] {
  const out: number[] = [];
  // Match a $-prefixed hex literal anywhere in the operand. We do NOT match
  // hex inside parentheses-with-comma (X-indexed indirect) any differently —
  // asar resolves the parenthesized address the same way.
  const re = /\$([0-9A-Fa-f]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(operand)) !== null) {
    const digits = m[1]!;
    const v = parseInt(digits, 16) >>> 0;
    // The number of HEX digits + the width hint together decide which
    // candidate addresses this represents.
    const n = digits.length;
    const width = widthHint
      ?? (n <= 2 ? 'b' : n <= 4 ? 'w' : 'l');
    if (width === 'l' || n >= 5) {
      out.push(v & 0xFFFFFF);
    } else if (width === 'w' || n >= 3) {
      const off = v & 0xFFFF;
      out.push(off);                 // bank $00
      out.push(0x7E0000 | off);      // bank $7E mirror
    } else {
      // DP byte: assumes DP=$0000 (the YI engine's normal state). The
      // verify-static table already places DP defines at $00:00xx.
      out.push(v & 0xFF);
    }
  }
  return out;
}

/** First identifier-looking token in an operand string (skipping `#`, `(`, addressing-mode prefixes). */
function extractCallTarget(operand: string): string | null {
  const m = operand.match(/[A-Za-z_][\w]*/);
  if (!m) return null;
  // Skip 65816 register letters used as index suffixes (`,x` / `,y`) — those
  // only appear AFTER the address, never as the first token.
  return m[0];
}

interface AsmLine {
  /** 1-based line number in the file. */
  line: number;
  /** Trimmed instruction text (no comment, no leading whitespace). Empty for label-only or blank/comment lines. */
  body: string;
  /** Labels declared on this line (asar allows multiple `name:` on consecutive lines, but only one per line). */
  labels: string[];
}

/** Strip an inline `;` comment without dropping the body that precedes it. */
function stripComment(line: string): string {
  // The codebase has occasional Latin-1 bytes, but `;` is always literal here.
  // We do NOT honor `;` inside quoted strings, but asar asm rarely has those.
  const i = line.indexOf(';');
  return i < 0 ? line : line.slice(0, i);
}

/** Tokenize a single .asm line. */
function lexLine(rawLine: string, line: number): AsmLine {
  const noComment = stripComment(rawLine);
  const trimmed = noComment.replace(/[\r\n]/g, '').trimEnd();
  // Label form: `name:` at start of line, optionally followed by code.
  const labelMatch = trimmed.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
  if (labelMatch) {
    const name = labelMatch[1]!;
    const rest = labelMatch[2]!.trim();
    return { line, body: rest, labels: [name] };
  }
  return { line, body: trimmed.trim(), labels: [] };
}

interface ScannedFile {
  /** Path relative to workRoot, forward slashes. */
  relPath: string;
  /** Label declarations in source order. */
  labelDecls: Array<{ name: string; line: number }>;
  /** Instruction lines in source order. */
  body: AsmLine[];
  /** Branch-target name -> source line numbers branching to it. Used by
   * the grouping logic to detect intra-routine forward jumps so a label
   * appearing after a BRA / Bcc is folded into the surrounding routine
   * rather than starting a fresh one. */
  branchTargets: Map<string, number[]>;
}

function listAsmFiles(workRoot: string, asmRoots: string[]): string[] {
  const out: string[] = [];
  for (const root of asmRoots) {
    const abs = path.join(workRoot, root);
    if (!fs.existsSync(abs)) continue;
    walk(abs);
  }
  return out;

  function walk(dir: string): void {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.asm')) out.push(p);
    }
  }
}

/**
 * Walk backwards from `untilLine` (exclusive) looking for the last actual
 * instruction at or after `afterLine`. Return true if that instruction is
 * one of RTS/RTL/RTI/JMP/JML/BRA/BRL (i.e. control doesn't fall through to
 * `untilLine`). Comments, blank lines, and `if/else/endif`/`%macro` lines
 * are skipped.
 *
 * Data-emitting directives (`db/dw/dl/incbin`) and `org` count as flow
 * breaks: the bytes between aren't executable code, so the next label
 * cannot be a fall-through from a previous code label. This is what stops
 * `DATA_*` labels followed by many `db` lines from incorrectly absorbing
 * the calls of the next real code label below them.
 */
/**
 * Did any branch instruction between (exclusive) lines `fromLine` and
 * `toLine` target `name`? Used to detect intra-routine jump targets so
 * a label appearing after a control-flow break isn't mis-classified as
 * a fresh routine when an earlier branch in the same routine jumps to it.
 */
function isIntraRoutineBranchTarget(
  branchTargets: Map<string, number[]>,
  name: string,
  fromLine: number,
  toLine: number,
): boolean {
  const lines = branchTargets.get(name);
  if (!lines || lines.length === 0) return false;
  for (const l of lines) {
    if (l > fromLine && l < toLine) return true;
  }
  return false;
}

function lastInstructionBreaksFlow(body: AsmLine[], afterLine: number, untilLine: number): boolean {
  // Walk the WHOLE range, not just back to the first instruction. Once we
  // see a flow break, anything after it (until the next label) is dead
  // code that doesn't restore fall-through. This is what catches the
  // SuperFX delay-slot pattern:
  //   MOVE R15, R11      ; return
  //   LSR                ; unreachable, but a regular op
  //   next_label:        ; should be fresh routine, not fall-through
  for (let i = afterLine; i <= untilLine - 2 && i < body.length; i++) {
    const ln = body[i];
    if (!ln) continue;
    const txt = ln.body;
    if (txt.length === 0) continue;
    if (txt[0] === '%' || txt[0] === '!') continue;
    if (/^d[bwl]\b/i.test(txt)) return true;
    if (/^incbin\b/i.test(txt)) return true;
    if (/^org\b/i.test(txt)) return true;
    if (/^(if|else|elseif|endif|while|endwhile|incsrc|namespace|pushpc|pullpc|warnpc|assert|macro|endmacro|table|cleartable|print)\b/i.test(txt)) continue;
    if (isControlTransferLine(txt)) return true;
    const m = txt.match(/^([A-Za-z]+)(?:\.[bwl])?\b/);
    if (!m) continue;
    if (NO_FALLTHROUGH_MNEMONICS.has(m[1]!.toUpperCase())) return true;
  }
  return false;
}

/**
 * Recognise unconditional control transfers in either 65816 or SuperFX
 * idiom. The 65816 mnemonics also live in `NO_FALLTHROUGH_MNEMONICS`,
 * but the SuperFX ones (`JMP Rn`, `LJMP Rn`, `MOVE R15, Rn`, `IWT R15, #imm`,
 * `STOP`) need operand-aware matching because they overload existing
 * mnemonics (`MOVE` / `IWT`) with a destination of PC (R15). Also note
 * the SuperFX dual-issue colon syntax (`MOVE R15, R11 : NOP`) — the
 * presence of the parallel op doesn't change the control-transfer
 * semantics of the primary instruction.
 */
export function isControlTransferLine(txt: string): boolean {
  // SuperFX: any *write* to R15 (the PC) is a jump.
  //   MOVE R15, R*       — return idiom paired with LINK / a stored R*
  //   IWT  R15, #imm     — load PC immediate (jump to label)
  //   LM   R15, ($addr)  — load PC from memory (jump-via-pointer)
  //   LMS  R15, ($addr)  — short-form variant of the above
  //   TO   R15           — sets dest of the next op to R15 → next op writes PC
  //   WITH R15           — alias for TO+FROM R15 (next op reads AND writes R15)
  // `FROM R15` and `MOVE R*, R15` (reading R15) are NOT breaks.
  if (/^(MOVE|IWT|LM|LMS|TO|WITH)\s+R15\b/i.test(txt)) return true;
  // SuperFX: unconditional register jumps.
  if (/^L?JMP\s+R\d+\b/i.test(txt)) return true;
  // SuperFX: STOP halts GSU execution.
  if (/^STOP\b/i.test(txt)) return true;
  return false;
}

function scanFile(absPath: string, workRoot: string): ScannedFile {
  // The codebase uses Latin-1 for legacy bytes; opening as latin1 round-trips
  // safely without garbling either the ASCII source or rare non-ASCII comments.
  const text = fs.readFileSync(absPath, { encoding: 'latin1' });
  const relPath = path.relative(workRoot, absPath).split(path.sep).join('/');
  const lines = text.split(/\r?\n/);
  const labelDecls: Array<{ name: string; line: number }> = [];
  const body: AsmLine[] = [];
  const branchTargets = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const tok = lexLine(lines[i]!, i + 1);
    if (tok.labels.length > 0) labelDecls.push({ name: tok.labels[0]!, line: tok.line });
    body.push(tok);
    // Index any conditional/unconditional branch (BRA/BRL/Bcc) by its
    // target label name. We don't have the sym at this point so we
    // can't validate the target — we just record what the asm asks for.
    if (tok.body.length > 0) {
      const m = tok.body.match(/^([A-Za-z]+)(?:\.[bwl])?(?:\s+(.*))?$/);
      if (m && BRANCH_MNEMONICS.has(m[1]!.toUpperCase())) {
        const target = extractCallTarget((m[2] ?? '').trim());
        if (target) {
          let arr = branchTargets.get(target);
          if (!arr) { arr = []; branchTargets.set(target, arr); }
          arr.push(tok.line);
        }
      }
    }
  }
  return { relPath, labelDecls, body, branchTargets };
}

/** Merge `src` into `dst` (in-place). Same-name conflicts: dst wins. */
function mergeSym(dst: ParsedSym, src: ParsedSym): void {
  for (const [name, addr] of src.byName) {
    if (dst.byName.has(name)) continue;
    dst.byName.set(name, addr);
    let bucket = dst.byAddr.get(addr);
    if (!bucket) { bucket = []; dst.byAddr.set(addr, bucket); }
    if (!bucket.includes(name)) bucket.push(name);
  }
}

// -----------------------------------------------------------------------------
// Graph construction
// -----------------------------------------------------------------------------

interface BuildArgs {
  symPath: string;
  symPaths: string[];
  symBytes: Buffer[];
  symMd5: string;
  workRoot: string;
  asmRoots: string[];
  onProgress: (msg: string) => void;
}

function buildGraph(args: BuildArgs): CodeGraph {
  const { symPath, symPaths, symBytes, symMd5, workRoot, asmRoots, onProgress } = args;

  onProgress(`▶ codegraph parse sym    (${symPaths.length} file${symPaths.length === 1 ? '' : 's'})`);
  const sym: ParsedSym = { byName: new Map(), byAddr: new Map() };
  for (let i = 0; i < symPaths.length; i++) {
    const p = symPaths[i]!;
    const rel = path.relative(workRoot, p) || p;
    mergeSym(sym, parseSym(symBytes[i]!.toString('utf-8')));
    onProgress(`  ${rel}`);
  }
  onProgress(`  ${sym.byName.size} labels, ${sym.byAddr.size} unique addresses`);

  onProgress(`▶ codegraph list asm     (roots: ${asmRoots.join(', ')})`);
  const asmFilePaths = listAsmFiles(workRoot, asmRoots);
  onProgress(`  ${asmFilePaths.length} .asm files`);

  onProgress(`▶ codegraph scan files`);
  const scanned = asmFilePaths.map((p) => scanFile(p, workRoot));

  onProgress(`▶ codegraph build define index   (literal $XXXX → define lookups)`);
  const memTable = buildSymbolTable(workRoot);
  const addrIndex = buildAddressIndex(memTable);
  onProgress(`  ${memTable.ordered.length} defines, ${addrIndex.size} unique addresses (incl. WRAM mirrors)`);

  // Per-label aggregation buffers.
  const callsOf = new Map<string, Set<string>>();
  const refsOf = new Map<string, Set<string>>();
  const readsOf = new Map<string, Set<string>>();
  const writesOf = new Map<string, Set<string>>();
  const rmwOf = new Map<string, Set<string>>();
  /** Per-label address-keyed sets of memory accesses (raw 24-bit literal
   * addresses, possibly with no matching !define). Stored as Set<number>
   * for compactness; inverted at the end into top-level addr* maps. */
  const addrReadsOf = new Map<string, Set<number>>();
  const addrWritesOf = new Map<string, Set<number>>();
  const addrRmwOf = new Map<string, Set<number>>();
  const sourceOf = new Map<string, SourceLoc>();
  const unresolvedTargets = new Set<string>();
  let callEdges = 0;

  const ensure = (m: Map<string, Set<string>>, k: string): Set<string> => {
    let v = m.get(k);
    if (!v) { v = new Set(); m.set(k, v); }
    return v;
  };
  const ensureNum = (m: Map<string, Set<number>>, k: string): Set<number> => {
    let v = m.get(k);
    if (!v) { v = new Set(); m.set(k, v); }
    return v;
  };

  onProgress(`▶ codegraph analyze asm`);
  let analyzed = 0;
  for (const file of scanned) {

    // Find every label that's in the sym, with its source line. Record the
    // source location now; we'll attribute calls/reads/writes below.
    const knownEntries: Array<{ name: string; addr: number; line: number }> = [];
    for (const decl of file.labelDecls) {
      const addr = sym.byName.get(decl.name);
      if (addr === undefined) continue;
      sourceOf.set(decl.name, { file: file.relPath, line: decl.line });
      knownEntries.push({ name: decl.name, addr, line: decl.line });
    }
    if (knownEntries.length === 0) { analyzed++; continue; }

    // Walk known labels and group them into "routine blocks". Two labels
    // belong to the same block when:
    //   - they're at the same address (aliases), OR
    //   - the second label has fall-through from above (the last actual
    //     instruction before it is NOT one of RTS/RTL/RTI/JMP/JML/BRA/BRL
    //     and not a db/dw/dl/incbin/org line), OR
    //   - the second label is the target of a forward branch (BRA/BRL/Bcc)
    //     from somewhere within the block's body so far — i.e. an
    //     intra-routine jump target reached after an unconditional break.
    // Each block has one or more entries (each entry is a label with its
    // own body-start line); the block extends until the next block's first
    // entry's line.
    interface Block { entries: Array<{ name: string; line: number; addr: number }>; firstLine: number; }
    const blocks: Block[] = [];
    let cur: Block = { entries: [knownEntries[0]!], firstLine: knownEntries[0]!.line };
    blocks.push(cur);
    for (let k = 1; k < knownEntries.length; k++) {
      const prev = knownEntries[k - 1]!;
      const here = knownEntries[k]!;
      const sameAddr = prev.addr === here.addr;
      const fallThrough = !sameAddr && !lastInstructionBreaksFlow(file.body, prev.line, here.line);
      const intraTarget = !sameAddr && !fallThrough &&
        isIntraRoutineBranchTarget(file.branchTargets, here.name, cur.firstLine, here.line);
      if (sameAddr || fallThrough || intraTarget) {
        cur.entries.push(here);
      } else {
        cur = { entries: [here], firstLine: here.line };
        blocks.push(cur);
      }
    }

    // For each block: compute the block's body line range, then for each
    // entry attribute calls from entry.line+1 .. blockEnd.
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi]!;
      const firstEntry = block.entries[0]!;
      const nextBlock = blocks[bi + 1];
      // Clamp the end line to the file's actual body length so the
      // backwards walk below has a finite upper bound when this is the
      // last block in the file.
      const blockEnd = nextBlock ? nextBlock.entries[0]!.line - 1 : file.body.length;

      // Aggregate calls/refs/reads/writes/rmw per entry. We accumulate
      // per-line into a tail-cached set so different entries (with
      // different start lines) can share work.
      const accumCalls = new Set<string>();
      const accumRefs = new Set<string>();
      const accumReads = new Set<string>();
      const accumWrites = new Set<string>();
      const accumRmw = new Set<string>();
      const accumAddrReads = new Set<number>();
      const accumAddrWrites = new Set<number>();
      const accumAddrRmw = new Set<number>();

      // Sort entries by line descending so we can walk the block body once
      // and snapshot the accumulator at each entry boundary.
      const entriesByLineDesc = block.entries.slice().sort((a, b) => b.line - a.line);
      interface Snap {
        calls: Set<string>; refs: Set<string>;
        reads: Set<string>; writes: Set<string>; rmw: Set<string>;
        addrReads: Set<number>; addrWrites: Set<number>; addrRmw: Set<number>;
      }
      const snapshots = new Map<string, Snap>();
      const snapshotHere = (): Snap => ({
        calls: new Set(accumCalls),
        refs: new Set(accumRefs),
        reads: new Set(accumReads),
        writes: new Set(accumWrites),
        rmw: new Set(accumRmw),
        addrReads: new Set(accumAddrReads),
        addrWrites: new Set(accumAddrWrites),
        addrRmw: new Set(accumAddrRmw),
      });

      let entryIdx = 0;
      for (let ln = blockEnd; ln >= firstEntry.line + 1; ln--) {
        const line = file.body[ln - 1];
        if (line && line.body.length > 0) {
          analyzeInstruction(line.body, accumCalls, accumRefs, accumReads, accumWrites, accumRmw, accumAddrReads, accumAddrWrites, accumAddrRmw, unresolvedTargets, sym, addrIndex);
        }
        while (entryIdx < entriesByLineDesc.length && entriesByLineDesc[entryIdx]!.line + 1 === ln) {
          snapshots.set(entriesByLineDesc[entryIdx]!.name, snapshotHere());
          entryIdx++;
        }
      }
      // Any entries not captured (because no body line at line+1) get the
      // accumulator's current state — typically empty same-address aliases
      // share with another alias via the block-merge below.
      while (entryIdx < entriesByLineDesc.length) {
        snapshots.set(entriesByLineDesc[entryIdx]!.name, snapshotHere());
        entryIdx++;
      }

      // Same-address aliases in the block share an entry line (the alias
      // declared FIRST has a body that starts the next line; the alias
      // declared SECOND has the next line too but with no instruction in
      // between). Merge their snapshots so both see the full set.
      const byAddr = new Map<number, typeof block.entries>();
      for (const ent of block.entries) {
        let arr = byAddr.get(ent.addr);
        if (!arr) { arr = []; byAddr.set(ent.addr, arr); }
        arr.push(ent);
      }
      for (const group of byAddr.values()) {
        if (group.length < 2) continue;
        const merged: Snap = {
          calls: new Set(), refs: new Set(),
          reads: new Set(), writes: new Set(), rmw: new Set(),
          addrReads: new Set(), addrWrites: new Set(), addrRmw: new Set(),
        };
        for (const ent of group) {
          const snap = snapshots.get(ent.name);
          if (!snap) continue;
          for (const x of snap.calls) merged.calls.add(x);
          for (const x of snap.refs) merged.refs.add(x);
          for (const x of snap.reads) merged.reads.add(x);
          for (const x of snap.writes) merged.writes.add(x);
          for (const x of snap.rmw) merged.rmw.add(x);
          for (const x of snap.addrReads) merged.addrReads.add(x);
          for (const x of snap.addrWrites) merged.addrWrites.add(x);
          for (const x of snap.addrRmw) merged.addrRmw.add(x);
        }
        for (const ent of group) snapshots.set(ent.name, {
          calls: new Set(merged.calls),
          refs: new Set(merged.refs),
          reads: new Set(merged.reads),
          writes: new Set(merged.writes),
          rmw: new Set(merged.rmw),
          addrReads: new Set(merged.addrReads),
          addrWrites: new Set(merged.addrWrites),
          addrRmw: new Set(merged.addrRmw),
        });
      }

      for (const ent of block.entries) {
        const snap = snapshots.get(ent.name);
        if (!snap) continue;
        const cs = ensure(callsOf, ent.name); for (const t of snap.calls) cs.add(t);
        const fs2 = ensure(refsOf, ent.name); for (const t of snap.refs) fs2.add(t);
        const rs = ensure(readsOf, ent.name); for (const t of snap.reads) rs.add(t);
        const ws = ensure(writesOf, ent.name); for (const t of snap.writes) ws.add(t);
        const ms = ensure(rmwOf, ent.name); for (const t of snap.rmw) ms.add(t);
        const ars = ensureNum(addrReadsOf, ent.name); for (const t of snap.addrReads) ars.add(t);
        const aws = ensureNum(addrWritesOf, ent.name); for (const t of snap.addrWrites) aws.add(t);
        const ams = ensureNum(addrRmwOf, ent.name); for (const t of snap.addrRmw) ams.add(t);
        callEdges += snap.calls.size;
      }
    }

    analyzed++;
    if (analyzed % 25 === 0) onProgress(`  ${analyzed}/${scanned.length} files`);
  }

  // Invert calls -> calledBy.
  const calledByOf = new Map<string, Set<string>>();
  for (const [caller, targets] of callsOf) {
    for (const t of targets) {
      let v = calledByOf.get(t);
      if (!v) { v = new Set(); calledByOf.set(t, v); }
      v.add(caller);
    }
  }

  // Invert refs -> referencedBy.
  const referencedByOf = new Map<string, Set<string>>();
  for (const [referrer, targets] of refsOf) {
    for (const t of targets) {
      let v = referencedByOf.get(t);
      if (!v) { v = new Set(); referencedByOf.set(t, v); }
      v.add(referrer);
    }
  }

  // Build the final per-label records, plus address index.
  const labels: Record<string, GraphLabel> = {};
  const addressIndex: Record<string, string[]> = {};
  let labelsWithSource = 0;
  let refEdges = 0;
  let memReadEdges = 0;
  let memWriteEdges = 0;
  let memRmwEdges = 0;

  for (const [addr, names] of sym.byAddr) {
    addressIndex[fmtAddr(addr)] = names.slice();
  }

  for (const [name, addr] of sym.byName) {
    const calls = sortSet(callsOf.get(name));
    const refs = sortSet(refsOf.get(name));
    const reads = sortSet(readsOf.get(name));
    const writes = sortSet(writesOf.get(name));
    const rmw = sortSet(rmwOf.get(name));
    const calledBy = sortSet(calledByOf.get(name));
    const referencedBy = sortSet(referencedByOf.get(name));
    const aliasGroup = sym.byAddr.get(addr) ?? [name];
    const source = sourceOf.get(name) ?? null;
    if (source) labelsWithSource++;
    refEdges += refs.length;
    memReadEdges += reads.length;
    memWriteEdges += writes.length;
    memRmwEdges += rmw.length;
    labels[name] = {
      address: addr,
      addressHex: fmtAddr(addr),
      source,
      aliases: aliasGroup.slice(),
      calls,
      calledBy,
      refs,
      referencedBy,
      reads,
      writes,
      rmw,
    };
  }

  // Invert per-label addr* sets into top-level "BB:AAAA" → labels maps.
  // This is what powers xref --writes-addr / --reads-addr / --rmw-addr,
  // including for addresses that have NO matching !define (the
  // motivating case: template-area writes at $00:1C90..1D40 where the
  // define-name index returns nothing).
  const addrReadsBy: Record<string, string[]> = {};
  const addrWritesBy: Record<string, string[]> = {};
  const addrRmwBy: Record<string, string[]> = {};
  const invertAddrMap = (src: Map<string, Set<number>>, dst: Record<string, string[]>): void => {
    const accum = new Map<number, Set<string>>();
    for (const [label, addrs] of src) {
      for (const a of addrs) {
        let bucket = accum.get(a);
        if (!bucket) { bucket = new Set(); accum.set(a, bucket); }
        bucket.add(label);
      }
    }
    const keys = [...accum.keys()].sort((a, b) => a - b);
    for (const a of keys) dst[fmtAddr(a)] = [...accum.get(a)!].sort();
  };
  invertAddrMap(addrReadsOf, addrReadsBy);
  invertAddrMap(addrWritesOf, addrWritesBy);
  invertAddrMap(addrRmwOf, addrRmwBy);

  // Cross-alias union pass. Two labels at the same 24-bit address point at
  // the same physical code/data, so queries on one should return the same
  // edges as queries on the other. Without this pass, `xref friendly_alias
  // --callers` returns 0 callers while `xref CODE_xxxxxx --callers` returns
  // the real list — because the asm literally writes `JSL CODE_xxxxxx` and
  // the inversion attributes the calledBy entry to that name only.
  // Block-stacked aliases (e.g. `friendly:` over `CODE_xxxxxx:`) already
  // share calls/refs/reads/writes/rmw via the block-merge in the analyze
  // loop; this pass extends that symmetry to calledBy/referencedBy AND
  // covers cross-file equate-style aliases (e.g. `FXCODE_xxxx = $xxxxxx`
  // in an equate file paired with the source-declared `lz16_decompress:`).
  const seenAddrs = new Set<number>();
  const aliasFields = ['calls', 'calledBy', 'refs', 'referencedBy', 'reads', 'writes', 'rmw'] as const;
  for (const [, addr] of sym.byName) {
    if (seenAddrs.has(addr)) continue;
    seenAddrs.add(addr);
    const names = sym.byAddr.get(addr);
    if (!names || names.length < 2) continue;
    const merged: Record<typeof aliasFields[number], Set<string>> = {
      calls: new Set(), calledBy: new Set(), refs: new Set(), referencedBy: new Set(),
      reads: new Set(), writes: new Set(), rmw: new Set(),
    };
    for (const n of names) {
      const r = labels[n]; if (!r) continue;
      for (const f of aliasFields) for (const x of r[f]) merged[f].add(x);
    }
    for (const n of names) {
      const r = labels[n]; if (!r) continue;
      for (const f of aliasFields) r[f] = [...merged[f]].sort();
    }
  }

  return {
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    symMd5,
    symPath: path.resolve(symPath),
    asmScanRoots: asmRoots.slice(),
    asmFileCount: scanned.length,
    labels,
    addressIndex,
    addrReadsBy,
    addrWritesBy,
    addrRmwBy,
    unresolvedTargets: [...unresolvedTargets].sort(),
    stats: {
      labelsTotal: sym.byName.size,
      labelsWithSource,
      addressesUnique: sym.byAddr.size,
      callEdges,
      refEdges,
      memReadEdges,
      memWriteEdges,
      memRmwEdges,
    },
  };
}

function analyzeInstruction(
  body: string,
  calls: Set<string>,
  refs: Set<string>,
  reads: Set<string>,
  writes: Set<string>,
  rmw: Set<string>,
  addrReads: Set<number>,
  addrWrites: Set<number>,
  addrRmw: Set<number>,
  unresolved: Set<string>,
  sym: ParsedSym,
  addrIndex: AddressIndex,
): void {
  // Pull the mnemonic and operand. Skip `if`/`endif`/`!`-prefixed defines,
  // and macro calls (`%Foo(...)`) — none of those are control-flow or
  // RAM-access in the sense we care about for the call graph.
  if (body[0] === '%' || body[0] === '!') return;
  const m = body.match(/^([A-Za-z]+)(\.[bwl])?(?:\s+(.*))?$/);
  if (!m) return;
  const mnem = m[1]!.toUpperCase();
  const widthSuffix = m[2] ? (m[2]!.slice(1).toLowerCase() as 'b' | 'w' | 'l') : null;
  const operand = (m[3] ?? '').trim();
  let callTarget: string | null = null;

  /** Resolve each numeric literal in the operand to defines via the
   * reverse address index, AND record the raw 24-bit address into
   * `addrDest` so xref --writes-addr / --reads-addr / --rmw-addr can
   * surface literal-store sites even when no !define exists at the
   * address. */
  const addLiterals = (defineDest: Set<string>, addrDest: Set<number>): void => {
    if (operand.length === 0) return;
    for (const addr of extractLiteralAddresses(operand, widthSuffix)) {
      addrDest.add(addr);
      // WRAM low-mirror bridging: a DP byte `$94` resolves to $00:0094 but
      // the same physical byte is also accessible as $7E:0094. Mirror so
      // querying either form returns the same hits. Absolute 16-bit
      // operands already emit both candidates via extractLiteralAddresses.
      const bank = (addr >>> 16) & 0xFF;
      const off = addr & 0xFFFF;
      if (bank === 0x00 && off < 0x2000) addrDest.add(0x7E0000 | off);
      else if (bank === 0x7E && off < 0x2000) addrDest.add(off);
      const bucket = addrIndex.get(addr);
      if (!bucket) continue;
      for (const name of bucket) defineDest.add(name);
    }
  };

  if (CALL_MNEMONICS.has(mnem)) {
    callTarget = extractCallTarget(operand);
    if (callTarget) {
      if (sym.byName.has(callTarget)) calls.add(callTarget);
      else if (/^(CODE_|YI_|DATA_|FXCODE_|UNK_|ADDR_)/.test(callTarget)) unresolved.add(callTarget);
    }
    // Indirect calls through a RAM trampoline (e.g. `JSL.l !RAM_YI_Global_..Rt`)
    // — record the define as a read so xref --readers surfaces these call sites.
    for (const d of extractDefineRefs(operand)) reads.add(d);
    addLiterals(reads, addrReads);
  } else if (READ_MNEMONICS.has(mnem)) {
    for (const d of extractDefineRefs(operand)) reads.add(d);
    addLiterals(reads, addrReads);
  } else if (WRITE_MNEMONICS.has(mnem)) {
    for (const d of extractDefineRefs(operand)) writes.add(d);
    addLiterals(writes, addrWrites);
  } else if (RMW_MNEMONICS.has(mnem)) {
    for (const d of extractDefineRefs(operand)) rmw.add(d);
    addLiterals(rmw, addrRmw);
  }

  // Indirect / non-call references: any bare label identifier appearing in
  // the operand that resolves to a known sym entry goes into `refs`. This
  // catches the SuperFX-trampoline indirect-call pattern (`LDA #FXCODE_X;
  // JSL trampoline`) — the FXCODE_X load gets a refs edge so closure can
  // walk into the SuperFX side without us having to model the trampoline.
  // The JSL target itself is already in `calls`; don't duplicate it here.
  for (const ref of extractLabelRefs(operand, sym)) {
    if (ref !== callTarget) refs.add(ref);
  }
}

/** Extract every identifier in the operand that resolves to a sym label. */
function extractLabelRefs(operand: string, sym: ParsedSym): string[] {
  if (operand.length === 0) return [];
  const out: string[] = [];
  // Skip the part immediately following `!` (those are defines, handled
  // separately) by removing them from consideration.
  // We do a simple scan: identifier tokens not preceded by `!` and present
  // in the sym are real label refs.
  const re = /(^|[^!\w])([A-Za-z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(operand)) !== null) {
    const name = m[2]!;
    if (sym.byName.has(name)) out.push(name);
  }
  return out;
}

function sortSet(s: Set<string> | undefined): string[] {
  if (!s || s.size === 0) return [];
  return [...s].sort();
}

function fmtAddr(addr: number): string {
  return hex((addr >>> 16) & 0xff, 2) + ':' + hex(addr & 0xffff, 4);
}

// -----------------------------------------------------------------------------
// Tiny CLI: `node scripts/codegraph.ts <sym> [--force]`
// Builds (or refreshes) the cache and prints a summary.
// -----------------------------------------------------------------------------

async function cliMain(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const symArg = args.find((a) => !a.startsWith('--'));
  if (!symArg) {
    console.error('Usage: node scripts/codegraph.ts <sym-file> [--force]');
    process.exit(1);
  }
  const symPath = path.resolve(symArg);
  const g = loadOrBuildGraph(symPath, {
    force,
    onProgress: (m) => console.log(m),
  });
  console.log('');
  console.log(`labels          : ${g.stats.labelsTotal}`);
  console.log(`  with source   : ${g.stats.labelsWithSource}`);
  console.log(`addresses (uniq): ${g.stats.addressesUnique}`);
  console.log(`call edges      : ${g.stats.callEdges}`);
  console.log(`ref edges       : ${g.stats.refEdges}`);
  console.log(`mem reads       : ${g.stats.memReadEdges}`);
  console.log(`mem writes      : ${g.stats.memWriteEdges}`);
  console.log(`mem rmw         : ${g.stats.memRmwEdges}`);
  console.log(`unresolved tgt  : ${g.unresolvedTargets.length}`);
  console.log(`cache           : ${cachePathFor(symPath)}`);
}

// Run the CLI only when invoked directly (not when imported by xref/closure).
const isDirect = (() => {
  try {
    const thisFile = path.resolve(import.meta.filename);
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return thisFile === invoked;
  } catch { return false; }
})();
if (isDirect) await cliMain();
