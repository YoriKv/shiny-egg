// scripts/xref.ts
// Query CLI on top of codegraph.
//
// Examples:
//   node scripts/xref.ts build/foo.sym <label>                # full record for one label
//   node scripts/xref.ts build/foo.sym <label> --callers      # only callers
//   node scripts/xref.ts build/foo.sym <label> --callees      # only callees
//   node scripts/xref.ts build/foo.sym <label> --mem          # only reads/writes
//   node scripts/xref.ts build/foo.sym --writers !RAM_FOO     # labels that write a !define
//   node scripts/xref.ts build/foo.sym --readers !RAM_FOO     # labels that read it
//   node scripts/xref.ts build/foo.sym --rmw !RAM_FOO         # labels that rmw it
//   node scripts/xref.ts build/foo.sym --writes-addr 00:1C92  # labels that write a raw address (no define needed)
//   node scripts/xref.ts build/foo.sym --reads-addr 00:1C92   # labels that read a raw address
//   node scripts/xref.ts build/foo.sym --rmw-addr 00:1C92     # labels that rmw a raw address
//   node scripts/xref.ts build/foo.sym --addr 00:8000         # all labels at an address
//   node scripts/xref.ts build/foo.sym --addr 00:1C00-00:1D40 # range form (labels within range)
//   node scripts/xref.ts build/foo.sym --search regex         # labels matching a regex
//   node scripts/xref.ts build/foo.sym --grep regex           # asm-text grep, reports nearest label
//   node scripts/xref.ts build/foo.sym --stats                # summary stats
//   node scripts/xref.ts build/foo.sym --json <label>         # raw JSON for one label
//
// All commands accept --force to rebuild the cache, and --asm-root <dir>
// (repeatable) to override the scan roots. `--grep` additionally accepts
// `--grep-comments` to restrict matches to comment-only lines.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadOrBuildGraph, type CodeGraph, type GraphLabel } from './codegraph.ts';
import { hexAddr24 } from './hex.ts';

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

interface Args {
  symPath: string;
  positional: string[];
  flags: Set<string>;
  values: Map<string, string[]>;
  force: boolean;
  asmRoots?: string[];
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const asmRoots: string[] = [];
  let force = false;

  const valueFlags = new Set([
    '--writers', '--readers', '--rmw',
    '--writes-addr', '--reads-addr', '--rmw-addr',
    '--addr', '--search', '--grep', '--json',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--force') { force = true; continue; }
    if (a === '--asm-root') {
      const v = argv[++i];
      if (!v) fail('--asm-root requires a value');
      asmRoots.push(v);
      continue;
    }
    if (valueFlags.has(a)) {
      const v = argv[++i];
      if (v === undefined) fail(`${a} requires a value`);
      let arr = values.get(a);
      if (!arr) { arr = []; values.set(a, arr); }
      arr.push(v);
      continue;
    }
    if (a.startsWith('--')) { flags.add(a); continue; }
    positional.push(a);
  }

  const symPath = positional.shift();
  if (!symPath) fail('Usage: node scripts/xref.ts <sym-file> [label] [options]');

  return {
    symPath: path.resolve(symPath),
    positional,
    flags,
    values,
    force,
    asmRoots: asmRoots.length > 0 ? asmRoots : undefined,
  };
}

function printLabelRecord(name: string, rec: GraphLabel, opts: { sections?: Set<string> } = {}): void {
  const sections = opts.sections;
  const show = (s: string): boolean => !sections || sections.size === 0 || sections.has(s);

  console.log(`${name}  @ $${rec.addressHex}` + (rec.source ? `  (${rec.source.file}:${rec.source.line})` : '  (no source)'));
  if (rec.aliases.length > 1) {
    const others = rec.aliases.filter((a) => a !== name);
    if (others.length > 0) console.log(`  aliases (${others.length}): ${others.join(', ')}`);
  }
  if (show('callers')) printList('  called by   ', rec.calledBy);
  if (show('callees')) printList('  calls       ', rec.calls);
  if (show('refs')) {
    printList('  refs        ', rec.refs);
    printList('  referenced by', rec.referencedBy);
  }
  if (show('mem')) {
    printList('  reads       ', rec.reads.map((d) => '!' + d));
    printList('  writes      ', rec.writes.map((d) => '!' + d));
    printList('  rmw         ', rec.rmw.map((d) => '!' + d));
  }
}

function printList(label: string, items: string[]): void {
  if (items.length === 0) return;
  if (items.length <= 8) {
    console.log(`${label} (${items.length}): ${items.join(', ')}`);
    return;
  }
  console.log(`${label} (${items.length}):`);
  for (const it of items) console.log(`    ${it}`);
}

/** Parse `BB:AAAA`, `BBAAAA`, or `$BB:AAAA` into a 24-bit address. Returns null on bad input. */
function parseAddr(s: string): number | null {
  const cleaned = s.replace(/^\$/, '').toUpperCase();
  const m = cleaned.match(/^([0-9A-F]{2}):?([0-9A-F]{4})$/);
  if (!m) return null;
  return (parseInt(m[1]!, 16) << 16) | parseInt(m[2]!, 16);
}

/** Parse `BB:AAAA` or `BB:AAAA-BB:BBBB` into [lo, hi] inclusive 24-bit pair. Returns null on bad input. */
function parseAddrRange(s: string): { lo: number; hi: number } | null {
  const parts = s.split('-');
  if (parts.length === 1) {
    const a = parseAddr(parts[0]!);
    return a === null ? null : { lo: a, hi: a };
  }
  if (parts.length === 2) {
    const lo = parseAddr(parts[0]!);
    const hi = parseAddr(parts[1]!);
    if (lo === null || hi === null) return null;
    if (lo > hi) return null;
    return { lo, hi };
  }
  return null;
}

/**
 * Find the label nearest below (or equal to) `addr` in the same bank.
 * Returns the label name + byte distance, or null if no label in-bank
 * exists at or before `addr`. Used by the --addr "inside routine" hint.
 */
function findEnclosingLabel(graph: CodeGraph, addr: number): { name: string; distance: number } | null {
  const bank = (addr >>> 16) & 0xFF;
  let best: { name: string; addr: number } | null = null;
  for (const [hex, names] of Object.entries(graph.addressIndex)) {
    const m = hex.match(/^([0-9A-F]{2}):([0-9A-F]{4})$/);
    if (!m) continue;
    const b = parseInt(m[1]!, 16);
    if (b !== bank) continue;
    const a = (b << 16) | parseInt(m[2]!, 16);
    if (a > addr) continue;
    if (!best || a > best.addr) {
      // Prefer code-flavored labels for the "inside routine" hint when
      // multiple labels share the address.
      const codeName = names.find((n) => /^(CODE_|YI_|FXCODE_)/.test(n)) ?? names[0]!;
      best = { name: codeName, addr: a };
    }
  }
  if (!best) return null;
  return { name: best.name, distance: addr - best.addr };
}

function resolveLabel(graph: CodeGraph, key: string): { name: string; rec: GraphLabel } | null {
  // Direct hit.
  const direct = graph.labels[key];
  if (direct) return { name: key, rec: direct };
  // Try as an address ("00:8000", "008000", "$00:8000").
  const cleaned = key.replace(/^\$/, '').toUpperCase();
  const m = cleaned.match(/^([0-9A-F]{2}):?([0-9A-F]{4})$/);
  if (m) {
    const hex = `${m[1]}:${m[2]}`;
    const names = graph.addressIndex[hex];
    if (names && names.length > 0) {
      const first = names[0]!;
      const rec = graph.labels[first];
      if (rec) return { name: first, rec };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const graph = loadOrBuildGraph(args.symPath, {
    force: args.force,
    asmRoots: args.asmRoots,
    onProgress: (m) => console.error(m),
  });

  // --stats
  if (args.flags.has('--stats')) {
    console.log(`Codegraph: ${args.symPath}`);
    console.log(`  sym md5         : ${graph.symMd5}`);
    console.log(`  generated       : ${graph.generatedAt}`);
    console.log(`  scan roots      : ${graph.asmScanRoots.join(', ')}`);
    console.log(`  asm files       : ${graph.asmFileCount}`);
    console.log(`  labels          : ${graph.stats.labelsTotal}`);
    console.log(`    with source   : ${graph.stats.labelsWithSource}`);
    console.log(`  addresses       : ${graph.stats.addressesUnique}`);
    console.log(`  call edges      : ${graph.stats.callEdges}`);
    console.log(`  mem read edges  : ${graph.stats.memReadEdges}`);
    console.log(`  mem write edges : ${graph.stats.memWriteEdges}`);
    console.log(`  mem rmw edges   : ${graph.stats.memRmwEdges}`);
    console.log(`  unresolved tgt  : ${graph.unresolvedTargets.length}`);
    return;
  }

  // --writers !NAME / --readers !NAME / --rmw !NAME
  const memModes: Array<['--writers' | '--readers' | '--rmw', keyof GraphLabel & ('reads' | 'writes' | 'rmw')]> = [
    ['--writers', 'writes'],
    ['--readers', 'reads'],
    ['--rmw', 'rmw'],
  ];
  for (const [flag, field] of memModes) {
    const vals = args.values.get(flag);
    if (!vals) continue;
    for (const v of vals) {
      const needle = v.replace(/^!/, '');
      const hits: string[] = [];
      for (const [name, rec] of Object.entries(graph.labels)) {
        if ((rec[field] as string[]).includes(needle)) hits.push(name);
      }
      hits.sort();
      console.log(`${flag} !${needle}  →  ${hits.length} routines`);
      for (const h of hits) {
        const rec = graph.labels[h]!;
        console.log(`  ${h}  @ $${rec.addressHex}${rec.source ? `  (${rec.source.file}:${rec.source.line})` : ''}`);
      }
    }
    return;
  }

  // --writes-addr / --reads-addr / --rmw-addr  (address-keyed inverted indexes)
  const addrMemModes: Array<['--writes-addr' | '--reads-addr' | '--rmw-addr', 'addrWritesBy' | 'addrReadsBy' | 'addrRmwBy']> = [
    ['--writes-addr', 'addrWritesBy'],
    ['--reads-addr', 'addrReadsBy'],
    ['--rmw-addr', 'addrRmwBy'],
  ];
  for (const [flag, field] of addrMemModes) {
    const vals = args.values.get(flag);
    if (!vals) continue;
    for (const v of vals) {
      const range = parseAddrRange(v);
      if (!range) { console.log(`(skip) ${v}: not an address or range`); continue; }
      const index = graph[field];
      const hits: Array<{ addr: string; label: string }> = [];
      for (const [hex, labels] of Object.entries(index)) {
        const a = parseAddr(hex);
        if (a === null || a < range.lo || a > range.hi) continue;
        for (const label of labels) hits.push({ addr: hex, label });
      }
      hits.sort((a, b) => a.addr === b.addr ? a.label.localeCompare(b.label) : a.addr.localeCompare(b.addr));
      const rangeLabel = range.lo === range.hi ? `$${hexAddr24(range.lo)}` : `$${hexAddr24(range.lo)}..$${hexAddr24(range.hi)}`;
      console.log(`${flag} ${rangeLabel}  →  ${hits.length} hit(s)`);
      for (const h of hits) {
        const rec = graph.labels[h.label]!;
        console.log(`  $${h.addr}  ${h.label}${rec.source ? `  (${rec.source.file}:${rec.source.line})` : ''}`);
      }
      // If a single-address query came back empty, surface the nearest
      // enclosing label so the caller knows whether the address is inside
      // a routine (case D: the documented data-address-inside-CODE trap).
      if (range.lo === range.hi && hits.length === 0) {
        const enc = findEnclosingLabel(graph, range.lo);
        if (enc) {
          const rec = graph.labels[enc.name];
          const src = rec?.source ? `  (${rec.source.file}:${rec.source.line})` : '';
          console.log(`  (no literal-${field === 'addrWritesBy' ? 'write' : field === 'addrReadsBy' ? 'read' : 'rmw'} sites; nearest preceding label is ${enc.name} @ -${enc.distance} bytes${src})`);
        }
      }
    }
    return;
  }

  // --addr BB:AAAA  or  --addr BB:AAAA-BB:BBBB
  {
    const addrs = args.values.get('--addr');
    if (addrs) {
      for (const a of addrs) {
        const range = parseAddrRange(a);
        if (!range) { console.log(`(skip) ${a}: not an address or range`); continue; }
        if (range.lo === range.hi) {
          const hex = hexAddr24(range.lo);
          const names = graph.addressIndex[hex] ?? [];
          console.log(`$${hex}  →  ${names.length} label(s)`);
          for (const n of names) {
            const rec = graph.labels[n]!;
            console.log(`  ${n}${rec.source ? `  (${rec.source.file}:${rec.source.line})` : ''}`);
          }
          // Inside-routine hint when no labels at this exact address.
          if (names.length === 0) {
            const enc = findEnclosingLabel(graph, range.lo);
            if (enc) {
              const rec = graph.labels[enc.name];
              const src = rec?.source ? `  (${rec.source.file}:${rec.source.line})` : '';
              console.log(`  (no label at this address; nearest preceding label is ${enc.name} @ -${enc.distance} bytes${src})`);
              console.log(`  hint: that address may be inside a routine body, not a data anchor.`);
            }
          }
        } else {
          const hits: Array<{ addr: string; names: string[] }> = [];
          for (const [hex, names] of Object.entries(graph.addressIndex)) {
            const a24 = parseAddr(hex);
            if (a24 === null || a24 < range.lo || a24 > range.hi) continue;
            hits.push({ addr: hex, names });
          }
          hits.sort((a, b) => a.addr.localeCompare(b.addr));
          const totalLabels = hits.reduce((s, h) => s + h.names.length, 0);
          console.log(`$${hexAddr24(range.lo)}..$${hexAddr24(range.hi)}  →  ${hits.length} address(es) with labels (${totalLabels} label(s) total)`);
          for (const h of hits) {
            for (const n of h.names) {
              const rec = graph.labels[n]!;
              console.log(`  $${h.addr}  ${n}${rec.source ? `  (${rec.source.file}:${rec.source.line})` : ''}`);
            }
          }
        }
      }
      return;
    }
  }

  // --search REGEX  (matches label names)
  {
    const patterns = args.values.get('--search');
    if (patterns) {
      for (const p of patterns) {
        let re: RegExp;
        try { re = new RegExp(p); } catch (e) { fail(`bad regex: ${p}: ${(e as Error).message}`); }
        const hits = Object.keys(graph.labels).filter((n) => re.test(n)).sort();
        console.log(`/${p}/  →  ${hits.length} label(s)`);
        for (const h of hits.slice(0, 200)) {
          const rec = graph.labels[h]!;
          console.log(`  ${h}  @ $${rec.addressHex}${rec.source ? `  (${rec.source.file}:${rec.source.line})` : ''}`);
        }
        if (hits.length > 200) console.log(`  ... and ${hits.length - 200} more`);
      }
      return;
    }
  }

  // --grep REGEX  (scans asm body, reports file:line + nearest preceding label)
  // With --grep-comments, only matches against the comment portion of the line.
  // Useful for "find docs that mention 'template' / 'populator'" — things
  // --search can't see because they're not in any label name.
  {
    const patterns = args.values.get('--grep');
    if (patterns) {
      const commentsOnly = args.flags.has('--grep-comments');
      // Build a per-file sorted (line, label) index from labels in the graph.
      // We use the graph's existing source info so we don't re-parse files.
      const labelsByFile = new Map<string, Array<{ line: number; name: string }>>();
      for (const [name, rec] of Object.entries(graph.labels)) {
        if (!rec.source) continue;
        let arr = labelsByFile.get(rec.source.file);
        if (!arr) { arr = []; labelsByFile.set(rec.source.file, arr); }
        arr.push({ line: rec.source.line, name });
      }
      for (const arr of labelsByFile.values()) arr.sort((a, b) => a.line - b.line);

      const workRoot = process.cwd();
      let totalHits = 0;
      for (const p of patterns) {
        let re: RegExp;
        try { re = new RegExp(p); } catch (e) { fail(`bad regex: ${p}: ${(e as Error).message}`); }
        console.log(`grep ${commentsOnly ? '(comments) ' : ''}/${p}/`);
        const fileList = [...labelsByFile.keys()].sort();
        for (const rel of fileList) {
          const abs = path.join(workRoot, rel);
          if (!fs.existsSync(abs)) continue;
          const text = fs.readFileSync(abs, { encoding: 'latin1' });
          const lines = text.split(/\r?\n/);
          const fileLabels = labelsByFile.get(rel)!;
          let labelIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            // Advance the running label pointer.
            while (labelIdx + 1 < fileLabels.length && fileLabels[labelIdx + 1]!.line <= lineNum) {
              labelIdx++;
            }
            const raw = lines[i]!;
            const haystack = commentsOnly
              ? (raw.indexOf(';') >= 0 ? raw.slice(raw.indexOf(';')) : '')
              : raw;
            if (haystack.length === 0) continue;
            if (!re.test(haystack)) continue;
            totalHits++;
            const nearest = labelIdx >= 0 ? fileLabels[labelIdx]! : null;
            const labelStr = nearest ? `  [under ${nearest.name} @ line ${nearest.line}]` : '';
            console.log(`  ${rel}:${lineNum}: ${raw.trim()}${labelStr}`);
          }
        }
        console.log(`/${p}/  →  ${totalHits} match(es)`);
      }
      return;
    }
  }

  // --json LABEL
  {
    const jsonLabels = args.values.get('--json');
    if (jsonLabels) {
      const out: Record<string, GraphLabel> = {};
      for (const l of jsonLabels) {
        const resolved = resolveLabel(graph, l);
        if (!resolved) { console.error(`(skip) ${l}: not found`); continue; }
        out[resolved.name] = resolved.rec;
      }
      console.log(JSON.stringify(out, null, 2));
      return;
    }
  }

  // Positional <label>: print its record (filtered by --callers / --callees / --mem if given).
  const labels = args.positional;
  if (labels.length === 0) {
    console.error('Nothing to do. Pass a label name, or one of:');
    console.error('  --stats                         summary');
    console.error('  --addr BB:AAAA                  labels at an address (suffix `-BB:AAAA` for a range)');
    console.error('  --writers !NAME                 routines that write a define');
    console.error('  --readers !NAME                 routines that read a define');
    console.error('  --rmw !NAME                     routines that read-modify-write a define');
    console.error('  --writes-addr BB:AAAA           routines that write a raw address (no define needed)');
    console.error('  --reads-addr  BB:AAAA           routines that read a raw address');
    console.error('  --rmw-addr    BB:AAAA           routines that read-modify-write a raw address');
    console.error('  --search REGEX                  labels matching a regex (label-name-only)');
    console.error('  --grep   REGEX                  asm-text grep, reports nearest preceding label');
    console.error('                                    (add --grep-comments to limit to comment portion)');
    console.error('  --json LABEL                    raw JSON for one label');
    process.exit(1);
  }
  const sections = new Set<string>();
  if (args.flags.has('--callers')) sections.add('callers');
  if (args.flags.has('--callees')) sections.add('callees');
  if (args.flags.has('--refs')) sections.add('refs');
  if (args.flags.has('--mem')) sections.add('mem');
  // By default, show every section (callers, callees, refs, mem).
  if (sections.size === 0) {
    sections.add('callers'); sections.add('callees'); sections.add('refs'); sections.add('mem');
  }

  for (const l of labels) {
    const resolved = resolveLabel(graph, l);
    if (!resolved) {
      console.log(`${l}: not found in graph`);
      continue;
    }
    printLabelRecord(resolved.name, resolved.rec, { sections });
    console.log('');
  }
}

await main();
