// Gate: every DYNAMIC_BODY_SOURCES source address must be an ACTUAL FXDATA literal in the yi asm,
// loaded by the sprite's OWN draw-setup — i.e. the source was found the right way (read the asm),
// not guessed from a VRAM capture.
//
// WHY: a guessed `$54-$56` address still decodes to plausible non-empty gfx, so opaque-pixel counts
// and "best %" brute-forces don't catch a wrong source. Worse, a wrong address can be a REAL FXDATA
// literal that belongs to a DIFFERENT sprite — the $098 yoshi-block was mis-set to $54:60C0, which
// is the Wild Piranha's head source (a valid literal, wrong sprite); the true source is $54:E0C0.
// This turns "confirm against the asm" into a test — it checks the SOURCE ADDRESS provenance of every
// entry (the rendered-pixel checker that used to pair with this was removed: its precision-only metric
// repeatedly misled us, scoring wrong models high and correct overlapping composites low; bodies are
// now regression-guarded by the structural pins in sprite-dynamic-gfx.test.ts).
//
// Two tiers:
//   1. (always) the address must be SOME asm FXDATA literal — catches off-grid / invented addresses
//      and stride/offset slips that land between real sources.
//   2. (when the build .sym + codegraph are present) the address must be loaded by a routine
//      REACHABLE from the sprite's own `YI_NorSprNNN_*` handler (calls+refs closure) — catches a
//      valid-but-WRONG-sprite address like the $098/$54:60C0 slip. Skipped (with a note) if the
//      build artifacts are absent.
//
// Run: node snes-framework/scripts/engine/validate-dynbody-asm.ts   (or npm run validate-dynbody-asm)

import * as fs from 'node:fs';
import { DYNAMIC_BODY_SOURCES } from './sprite-dynamic-gfx.ts';
import { scanDynbodyAsmSources } from './dynbody-asm-sources.ts';
import { FRAMEWORK_ROOT, devCartPaths, loadDevCart } from './dev-cart.ts';
import { loadOrBuildGraph, type CodeGraph } from '../codegraph.ts';

const ANCHOR_SNES = 0x548000; // FXDATA_548000 / DATA_gfx_bank54_part2 — deltas are measured from here

// Tier-2 allowlist: sprites whose source is a real FXDATA literal (passes Tier 1) but is loaded via
// a SHARED/INDIRECT path the static call/ref graph can't tie to the sprite's own handler (a family
// draw routine reached through a dispatch the codegraph doesn't follow, etc.). Each is still
// confirmed in the asm. id → reason. Add ONLY after confirming the address in the asm; this is an
// "I checked, it's shared" acknowledgement, not a way to skip the check.
const BIND_ALLOWLIST = new Map<number, string>([
  // 0xNNN: 'why it does not bind to its own handler (and how it was confirmed)',
  [0x0a7, 'Group of Incoming Chomps is a SPAWNER (main_incoming_chomp_flock → CODE_spawn_sprite); it never loads chomp gfx itself. The body is its spawned child $0A6\'s, confirmed via DATA_0E844E in main_incoming_chomp (CODE_0E84BA) — rendered as a representative icon.'],
]);

const tag = (id: number): string => '$' + id.toString(16).toUpperCase().padStart(3, '0');
const hex = (a: number): string => '$' + (a >>> 0).toString(16).toUpperCase().padStart(6, '0');

// scanner: byteAddr -> set of routines that load it
const sources = scanDynbodyAsmSources();
const routinesByAddr = new Map<number, Set<string>>();
for (const s of sources) {
  let r = routinesByAddr.get(s.byteAddr);
  if (!r) routinesByAddr.set(s.byteAddr, (r = new Set()));
  r.add(s.routine);
}
const asmSet = new Set(routinesByAddr.keys()); // Tier 1: every FXDATA byte address (any bank)

// FXDATA_0AAB14 dyntile-source table: the generic Bank03 dyntile uploader CODE_03B631 derives a
// per-sprite bank-$54 source by UNPACKING a packed word from FXDATA_0AAB14[spriteID] — so these
// sources are real + sprite-owned but never appear as a direct `LDA #FXDATA_` literal the scanner
// sees. Decode the table exactly as CODE_03B631 does (bit10→$8000, bit9→+1, bit8→$4000, bit7→$80,
// bits6-4<<7, bits3-0<<3; bank R13 = FXDATA_540000) and register each derived address as loaded by
// CODE_03B631, so DYNAMIC_BODY_SOURCES entries on this path (the Giant Shy Guys $043/$044) validate.
{
  const { rom, symbols } = loadDevCart();
  const tbl = symbols.tryPc('FXDATA_0AAB14') ?? symbols.tryPc('DATA_0AAB14');
  if (tbl !== undefined) for (let id = 0; id < 0x1ba; id++) {
    const w = rom[tbl + id * 2]! | (rom[tbl + id * 2 + 1]! << 8);
    if (!w) continue;
    let o = (w & 0x0400) ? 0x8000 : 0;
    if (w & 0x0200) o += 1;
    if (w & 0x0100) o |= 0x4000;
    o |= (w & 0x0080) | ((w & 0x0070) << 7) | ((w & 0x000f) << 3);
    const byte = (0x540000 + (o & 0xffff)) & ~1; // R13 = FXDATA_540000 bank
    asmSet.add(byte);
    let r = routinesByAddr.get(byte); if (!r) routinesByAddr.set(byte, (r = new Set()));
    r.add('CODE_03B631');
  }
}

// Tier 2: codegraph (optional)
let graph: CodeGraph | null = null;
try {
  const { symPath } = devCartPaths();
  if (fs.existsSync(symPath)) graph = loadOrBuildGraph(symPath, { workRoot: FRAMEWORK_ROOT, asmRoots: ['yi'] });
} catch { graph = null; }

// Reachable-from-handler as a set of ADDRESSES (not names) — so a load attributed to one alias
// (init_chomp_signboard) binds to the handler reached under another alias (YI_NorSpr0D8_…_Init);
// both share an address. Start from the sprite's own Init/Main (not the shared Ride/Stomp shims).
const reachCache = new Map<number, Set<number>>();
function reachableAddrsFromHandler(id: number, g: CodeGraph): Set<number> {
  const cached = reachCache.get(id);
  if (cached) return cached;
  const pref = 'YI_NorSpr' + id.toString(16).toUpperCase().padStart(3, '0');
  const seenNames = new Set<string>();
  const addrs = new Set<number>();
  const stack = Object.keys(g.labels).filter((n) => n.startsWith(pref) && (n.endsWith('_Init') || n.endsWith('_Main')));
  while (stack.length) {
    const n = stack.pop()!;
    if (seenNames.has(n)) continue;
    seenNames.add(n);
    const nd = g.labels[n];
    if (!nd) continue;
    addrs.add(nd.address);
    for (const t of nd.calls) if (!seenNames.has(t)) stack.push(t);
    for (const t of nd.refs) if (!seenNames.has(t)) stack.push(t);
  }
  return (reachCache.set(id, addrs), addrs);
}

interface Fail { id: number; what: string; addr: number; tier: 1 | 2; loaders: string[]; }
const fails: Fail[] = [];
let okTier1 = 0, okTier2 = 0, skipTier2 = 0;

for (const [idStr, src] of Object.entries(DYNAMIC_BODY_SOURCES)) {
  const id = Number(idStr);
  const checks: { what: string; addr: number }[] = [{ what: 'delta', addr: src.delta + ANCHOR_SNES }];
  if (src.centerUnder !== undefined) checks.push({ what: 'centerUnder', addr: src.centerUnder + ANCHOR_SNES });
  // Multi-piece composites: each piece reads its own FXDATA source — validate them too (the
  // tulip $0A0 / Tap-Tap $03C pieces are otherwise unchecked). Dedup repeated piece deltas.
  if (src.pieces) {
    const seen = new Set<number>();
    src.pieces.forEach((p, i) => { if (!seen.has(p.delta)) { seen.add(p.delta); checks.push({ what: `piece[${i}]`, addr: p.delta + ANCHOR_SNES }); } });
  }
  for (const { what, addr } of checks) {
    const byte = addr & ~1;
    if (!asmSet.has(byte)) { fails.push({ id, what, addr, tier: 1, loaders: [] }); continue; }
    okTier1++;
    if (!graph) { skipTier2++; continue; }
    if (BIND_ALLOWLIST.has(id)) { okTier2++; continue; }
    const loaders = [...(routinesByAddr.get(byte) ?? [])];
    const reach = reachableAddrsFromHandler(id, graph);
    const bound = loaders.some((r) => { const a = graph!.labels[r]?.address; return a !== undefined && reach.has(a); });
    if (bound) okTier2++;
    else fails.push({ id, what, addr, tier: 2, loaders });
  }
}

console.log(`scanned ${sources.length} asm FXDATA load(s); ${asmSet.size} distinct source addresses.`);
console.log(`Tier 1 (address is a real FXDATA literal): ${okTier1} ok.`);
if (graph) console.log(`Tier 2 (loaded by the sprite's own handler): ${okTier2} bound, ${BIND_ALLOWLIST.size} allowlisted.`);
else console.log(`Tier 2: SKIPPED (no build .sym — run a build to enable per-sprite binding).${skipTier2 ? ` (${skipTier2} addresses)` : ''}`);

const t1 = fails.filter((f) => f.tier === 1), t2 = fails.filter((f) => f.tier === 2);
if (t1.length) {
  console.error(`\n✗ ${t1.length} source(s) that are NOT any asm FXDATA literal (off-grid / invented address):`);
  for (const f of t1) console.error(`  ${tag(f.id)} ${f.what} = ${hex(f.addr)} → read the sprite's asm draw-setup; \`npm run dynbody-sources -- ${(f.addr & ~1).toString(16)}\``);
}
if (t2.length) {
  console.error(`\n✗ ${t2.length} source(s) that ARE a real FXDATA literal but are NOT loaded by the sprite's own handler (wrong-sprite address?):`);
  for (const f of t2) console.error(`  ${tag(f.id)} ${f.what} = ${hex(f.addr)} — loaded by [${f.loaders.join(', ')}], none reachable from YI_NorSpr${f.id.toString(16).toUpperCase().padStart(3, '0')}_*. If genuinely shared/indirect, add ${tag(f.id)} to BIND_ALLOWLIST with a reason.`);
}
if (fails.length) process.exit(1);
console.log(`\n✓ every dynamic-body source is an asm-cited FXDATA literal${graph ? " loaded by its own sprite's handler" : ''}.`);
