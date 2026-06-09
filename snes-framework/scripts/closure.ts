// scripts/closure.ts
// Subroutine closure extractor — given a label, BFS the call graph from it
// and emit the routine source + every transitively-called routine into a
// single annotated text bundle. Useful for porting / reimplementing a
// self-contained algorithm (e.g. lz16 decompressor) without losing the
// thread three hops deep.
//
// Examples:
//   node scripts/closure.ts build/foo.sym CODE_load_level_gfx
//   node scripts/closure.ts build/foo.sym lz2_decompress --depth 3
//   node scripts/closure.ts build/foo.sym CODE_foo --exclude '^CODE_dma_'
//   node scripts/closure.ts build/foo.sym CODE_foo --no-source     # graph only
//   node scripts/closure.ts build/foo.sym CODE_foo --out closure.s # write to a file
//
// Default output is to stdout (pipe to a file with `>` or `--out`).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadOrBuildGraph, isControlTransferLine, type CodeGraph, type GraphLabel } from './codegraph.ts';

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

interface Args {
  symPath: string;
  entry: string;
  depth: number;
  excludes: RegExp[];
  noSource: boolean;
  noRefs: boolean;
  bodiesOnly: boolean;
  force: boolean;
  out: string | null;
  asmRoots?: string[];
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const excludes: RegExp[] = [];
  const asmRoots: string[] = [];
  let depth = Infinity;
  let noSource = false;
  let noRefs = false;
  let bodiesOnly = false;
  let force = false;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--force') { force = true; continue; }
    if (a === '--no-source') { noSource = true; continue; }
    if (a === '--no-refs') { noRefs = true; continue; }
    if (a === '--bodies-only') { bodiesOnly = true; continue; }
    if (a === '--depth') {
      const v = argv[++i];
      if (v === undefined) fail('--depth requires a number');
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) fail(`bad --depth: ${v}`);
      depth = n;
      continue;
    }
    if (a === '--exclude') {
      const v = argv[++i];
      if (v === undefined) fail('--exclude requires a regex');
      try { excludes.push(new RegExp(v)); } catch (e) { fail(`bad regex ${v}: ${(e as Error).message}`); }
      continue;
    }
    if (a === '--out') {
      const v = argv[++i];
      if (v === undefined) fail('--out requires a path');
      // Resolve relative output paths against the user's invocation dir, not
      // process.cwd() — the cli.ts dispatcher chdirs into the framework
      // workRoot before importing us, so a bare `process.resolve` here would
      // land the file under snes-framework/ (and crash if its parent dir is
      // missing). SHINY_EGG_INVOCATION_CWD carries the pre-chdir dir; absent
      // it (standalone invocation) cwd is already correct.
      out = path.resolve(process.env.SHINY_EGG_INVOCATION_CWD ?? process.cwd(), v);
      continue;
    }
    if (a === '--asm-root') {
      const v = argv[++i];
      if (v === undefined) fail('--asm-root requires a value');
      asmRoots.push(v);
      continue;
    }
    if (a.startsWith('--')) fail(`unknown flag: ${a}`);
    positional.push(a);
  }

  const symPath = positional.shift();
  const entry = positional.shift();
  if (!symPath || !entry) {
    fail('Usage: node scripts/closure.ts <sym-file> <label> [--depth N] [--exclude REGEX]... [--no-source] [--bodies-only] [--out PATH]');
  }
  return {
    symPath: path.resolve(symPath),
    entry,
    depth,
    excludes,
    noSource,
    noRefs,
    bodiesOnly,
    force,
    out,
    asmRoots: asmRoots.length > 0 ? asmRoots : undefined,
  };
}

interface ClosureNode {
  /** Canonical name (the BFS-seen name, often = entry or = the asar canonical alias). */
  name: string;
  /** Depth from the entry label (0 = entry). */
  depth: number;
  /** Resolved graph record. */
  rec: GraphLabel;
}

/**
 * Breadth-first walk from `entry` over `calls`. Visits each ADDRESS once
 * (address-keyed dedupe handles aliases). Records the first-seen label name
 * per address so output uses consistent naming.
 */
function buildClosure(
  graph: CodeGraph,
  entry: string,
  maxDepth: number,
  excludes: RegExp[],
  followRefs: boolean,
): { order: ClosureNode[]; skipped: Array<{ name: string; reason: string }> } {
  const order: ClosureNode[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const visited = new Set<number>();           // by address (so aliases dedupe)
  const queue: Array<{ name: string; depth: number }> = [{ name: entry, depth: 0 }];

  while (queue.length > 0) {
    const { name, depth } = queue.shift()!;
    const rec = graph.labels[name];
    if (!rec) { skipped.push({ name, reason: 'not in sym' }); continue; }
    if (visited.has(rec.address)) continue;
    visited.add(rec.address);
    if (excludes.some((re) => re.test(name))) {
      skipped.push({ name, reason: `matched exclude pattern` });
      continue;
    }
    order.push({ name, depth, rec });
    if (depth >= maxDepth) continue;
    const targets: string[] = [...rec.calls];
    if (followRefs) {
      // Refs include indirect-call targets (LDA #FXCODE_X; JSL trampoline)
      // but also data-table refs. Filter to code-looking labels so closure
      // doesn't drag in dozens of unrelated data tables.
      for (const r of rec.refs) {
        if (/^(CODE_|YI_|FXCODE_)/.test(r) || /_(init|main|decompress|refill|loop|handler)$/.test(r)) {
          targets.push(r);
        }
      }
    }
    for (const t of targets) {
      const targetRec = graph.labels[t];
      if (!targetRec) continue;
      if (visited.has(targetRec.address)) continue;
      queue.push({ name: t, depth: depth + 1 });
    }
  }
  return { order, skipped };
}

/**
 * Extract the literal source body of a routine from its asm file, from the
 * label's line up to (but not including) the next label whose address
 * differs AND has no fall-through from above. This mirrors the routine-
 * boundary heuristic used by codegraph: aliases share a body; intra-routine
 * jump targets are included; the body ends at the first true routine break.
 */
function extractBody(rec: GraphLabel, workRoot: string): string[] {
  if (!rec.source) return [];
  const abs = path.join(workRoot, rec.source.file);
  if (!fs.existsSync(abs)) return [];
  // We re-read the file rather than carrying body text through the graph
  // (which would balloon the cache size by an order of magnitude).
  const text = fs.readFileSync(abs, { encoding: 'latin1' });
  const lines = text.split(/\r?\n/);
  // Routine ends at: the first label whose line > start AND (a) has no
  // fall-through from above OR (b) appears far enough down that it's a
  // separate routine. We use the same NO_FALLTHROUGH rule used by the
  // graph builder, applied locally — and we also keep going past
  // intra-routine branch targets (labels that earlier branches in this
  // body have already jumped to).
  const NO_FT = /^(rts|rtl|rti|jmp|jml|bra|brl)$/i;
  const BRANCH_RE = /^(bra|brl|bcc|bcs|beq|bne|bmi|bpl|bvc|bvs)(?:\.[bwl])?\s+([A-Za-z_]\w*)/i;
  const startIdx = rec.source.line - 1;          // 0-based
  let endIdx = lines.length;
  let lastWasBreak = false;
  const branchedTo = new Set<string>();
  for (let i = startIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const noComment = raw.replace(/;.*$/, '');
    const trimmed = noComment.trim();
    if (trimmed.length === 0) continue;
    const labelM = trimmed.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (labelM) {
      const name = labelM[1]!;
      if (lastWasBreak && !branchedTo.has(name)) { endIdx = i; break; }
      // Intra-routine branch target (or fall-through from above) — we're
      // back in reachable code, reset the break tracker so subsequent
      // regular ops are interpreted as live.
      lastWasBreak = false;
      continue;
    }
    // Data-emitting directives count as flow breaks: bytes from db/dw/dl/
    // incbin / a cursor `org` aren't executable code, so the next label is
    // a fresh routine entry, not a fall-through.
    if (/^d[bwl]\b/i.test(trimmed)) { lastWasBreak = true; continue; }
    if (/^(incbin|org)\b/i.test(trimmed)) { lastWasBreak = true; continue; }
    if (/^(if|else|elseif|endif|while|endwhile|namespace|pushpc|pullpc|warnpc|assert|macro|endmacro|table|cleartable|print|incsrc)\b/i.test(trimmed)) {
      continue;
    }
    const branchM = trimmed.match(BRANCH_RE);
    if (branchM) {
      branchedTo.add(branchM[2]!);
      // Sticky: only set to true on unconditional breaks (BRA/BRL);
      // conditional branches don't reset (they may fall through but the
      // routine continues either way).
      if (NO_FT.test(branchM[1]!)) lastWasBreak = true;
      continue;
    }
    if (isControlTransferLine(trimmed)) { lastWasBreak = true; continue; }
    const tokenM = trimmed.match(/^([A-Za-z]+)(?:\.[bwl])?\b/);
    if (!tokenM) continue;
    // Sticky: only flip to true; regular ops don't reset.
    if (NO_FT.test(tokenM[1]!)) lastWasBreak = true;
  }
  return lines.slice(startIdx, endIdx);
}

function emitClosure(
  graph: CodeGraph,
  entry: string,
  order: ClosureNode[],
  skipped: Array<{ name: string; reason: string }>,
  workRoot: string,
  opts: { noSource: boolean; bodiesOnly: boolean },
): string[] {
  const out: string[] = [];
  out.push('; ' + '='.repeat(72));
  out.push(`; Closure of: ${entry}`);
  out.push(`; Sym file:   ${path.relative(workRoot, graph.symPath) || graph.symPath}`);
  out.push(`; Generated:  ${new Date().toISOString()}`);
  out.push(`; Routines:   ${order.length}`);
  if (skipped.length > 0) {
    out.push(`; Skipped:    ${skipped.length} (excluded or not in sym)`);
    for (const s of skipped) out.push(`;   - ${s.name}  (${s.reason})`);
  }
  out.push('; ' + '='.repeat(72));
  out.push('');

  for (const node of order) {
    // If this label has no source location but one of its aliases does,
    // use that alias's record for both the header label and the body
    // extraction. This matters for SuperFX equates (e.g. `FXCODE_0A8000`
    // is in the equate-defined sym at $0A:8000 but has no file:line; its
    // alias `lz16_decompress` is the real declared label).
    let r = node.rec;
    let displayName = node.name;
    if (!r.source && r.aliases.length > 1) {
      for (const alt of r.aliases) {
        if (alt === node.name) continue;
        const altRec = graph.labels[alt];
        if (altRec?.source) { r = altRec; displayName = alt; break; }
      }
    }
    const src = r.source ? `${r.source.file}:${r.source.line}` : 'no source';

    if (opts.bodiesOnly) {
      // Single-line marker per routine. Designed for downstream grep-style
      // scanning: each body line stays untouched (so a hit's
      // `file:line:body` lookup is still trivial via the preceding
      // marker), and the marker itself is small enough to not dominate
      // the file size on full-closure dumps.
      out.push(`; === [${node.depth}] ${displayName}  @ $${r.addressHex}  (${src}) ===`);
    } else {
      const aliases = r.aliases.filter((a) => a !== displayName);
      out.push('; ' + '─'.repeat(72));
      out.push(`; [${node.depth}] ${displayName}  @ $${r.addressHex}  (${src})`);
      if (aliases.length > 0) out.push(`;   aliases: ${aliases.join(', ')}`);
      if (r.calls.length > 0) out.push(`;   calls:   ${r.calls.join(', ')}`);
      if (r.calledBy.length > 0 && r.calledBy.length <= 8) {
        out.push(`;   callers: ${r.calledBy.join(', ')}`);
      } else if (r.calledBy.length > 8) {
        out.push(`;   callers: ${r.calledBy.length} routines (use xref --callers to see them)`);
      }
      if (r.reads.length > 0) out.push(`;   reads:   ${r.reads.map((d) => '!' + d).join(', ')}`);
      if (r.writes.length > 0) out.push(`;   writes:  ${r.writes.map((d) => '!' + d).join(', ')}`);
      if (r.rmw.length > 0) out.push(`;   rmw:     ${r.rmw.map((d) => '!' + d).join(', ')}`);
      out.push('; ' + '─'.repeat(72));
    }
    if (!opts.noSource) {
      const body = extractBody(r, workRoot);
      if (body.length === 0) {
        out.push('; (no source body available)');
      } else {
        for (const ln of body) out.push(ln);
      }
    }
    out.push('');
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workRoot = process.cwd();
  const graph = loadOrBuildGraph(args.symPath, {
    workRoot,
    force: args.force,
    asmRoots: args.asmRoots,
    onProgress: (m) => console.error(m),
  });

  if (!graph.labels[args.entry]) {
    // Try address resolution.
    const cleaned = args.entry.replace(/^\$/, '').toUpperCase();
    const m = cleaned.match(/^([0-9A-F]{2}):?([0-9A-F]{4})$/);
    if (m) {
      const hex = `${m[1]}:${m[2]}`;
      const names = graph.addressIndex[hex];
      if (names && names.length > 0) {
        args.entry = names[0]!;
        console.error(`▶ resolved address to ${args.entry}`);
      }
    }
  }
  if (!graph.labels[args.entry]) {
    fail(`entry label not found: ${args.entry}`);
  }

  const { order, skipped } = buildClosure(graph, args.entry, args.depth, args.excludes, !args.noRefs);
  const lines = emitClosure(graph, args.entry, order, skipped, workRoot, { noSource: args.noSource, bodiesOnly: args.bodiesOnly });
  const text = lines.join('\n') + '\n';

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, text);
    console.error(`✓ wrote ${args.out}  (${order.length} routines, ${lines.length} lines)`);
  } else {
    process.stdout.write(text);
  }
}

await main();
