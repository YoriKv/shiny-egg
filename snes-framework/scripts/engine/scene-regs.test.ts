// Scene-register decode + BG2/BG3 compositing-descriptor test.
//
// Asserts loadSceneRegs() reproduces the per-LevelMode PPU registers that drive
// BG2/BG3 visibility + color math, and that deriveDescriptors() classifies each
// layer's visibility / role / blend correctly.
//
// The expected per-mode register values are GROUND TRUTH: they were captured
// live at a settled in-level frame for every catalog mode by the yi-shiny
// `bg23-render` trace scenario, and verified byte-for-byte against the static
// scene table (yi-shiny/docs/bg23rendering.md §3). Note TS here is the per-mode
// scene-table value — the only table-vs-live discrepancy (mode $07 level 1-4's
// TS) is a per-LEVEL BG3 hide that rides `bg3Disabled`, not a per-mode value, so
// it's exercised in the descriptor tests below, not the register table.
//
// Run: node snes-framework/scripts/engine/scene-regs.test.ts

import { loadDevCart } from './dev-cart.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { deriveDescriptors } from './bg-layers-compose.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

const { rom, symbols } = loadDevCart();

// ── Per-mode register table (ground truth) ──────────────────────────────────
// [mode, BGMODE, TM, TS, CGWSEL, CGADSUB, bg2TilemapAddr, bg3TilemapAddr,
//  bg2CharAddr, bg3CharAddr]. Tilemap/char addrs are BYTE offsets into VRAM:
// BGxSC's 1K-word units double to bytes (word $3800 → byte $7000), so a value
// of 0x3800/0x3400 here would be the old word-as-byte bug (tilemap clobbering
// the char region) — these are pinned to the byte addresses the capture holds.
const REG_TABLE: Array<[number, number, number, number, number, number, number, number, number, number]> = [
  [0x00, 0x69, 0x17, 0x00, 0x22, 0x20, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x03, 0x22, 0x11, 0x02, 0x22, 0x20, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x05, 0x69, 0x15, 0x02, 0x22, 0x20, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x06, 0x69, 0x15, 0x02, 0x22, 0x24, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x07, 0x69, 0x11, 0x06, 0x22, 0x20, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x08, 0x69, 0x13, 0x00, 0x22, 0x20, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x0b, 0x69, 0x11, 0x06, 0x22, 0x20, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x0e, 0x69, 0x13, 0x04, 0x22, 0xb3, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x02, 0x69, 0x13, 0x04, 0x22, 0xb3, 0x7000, 0x6800, 0xe000, 0x4000],
  [0x0d, 0x59, 0x05, 0x12, 0x22, 0x45, 0xd000, 0x6800, 0xe000, 0x4000],
  [0x0f, 0x69, 0x04, 0x13, 0x22, 0x24, 0x7000, 0x6800, 0xe000, 0x4000]
];

console.log('── scene-register decode ──');
for (const [mode, bgmode, tm, ts, cgwsel, cgadsub, bg2Tm, bg3Tm, bg2Ch, bg3Ch] of REG_TABLE) {
  const r = loadSceneRegs(rom, symbols, mode);
  assert(r.bgmode === bgmode, `mode ${hex(mode)} BGMODE: got ${hex(r.bgmode)}, want ${hex(bgmode)}`);
  assert(r.bgmodeMode === (bgmode & 7), `mode ${hex(mode)} bgmodeMode: got ${r.bgmodeMode}, want ${bgmode & 7}`);
  assert(r.tm === tm, `mode ${hex(mode)} TM: got ${hex(r.tm)}, want ${hex(tm)}`);
  assert(r.ts === ts, `mode ${hex(mode)} TS: got ${hex(r.ts)}, want ${hex(ts)}`);
  assert(r.cgwsel === cgwsel, `mode ${hex(mode)} CGWSEL: got ${hex(r.cgwsel)}, want ${hex(cgwsel)}`);
  assert(r.cgadsub === cgadsub, `mode ${hex(mode)} CGADSUB: got ${hex(r.cgadsub)}, want ${hex(cgadsub)}`);
  assert(r.bg2TilemapAddr === bg2Tm, `mode ${hex(mode)} bg2TilemapAddr: got ${hex(r.bg2TilemapAddr)}, want ${hex(bg2Tm)}`);
  assert(r.bg3TilemapAddr === bg3Tm, `mode ${hex(mode)} bg3TilemapAddr: got ${hex(r.bg3TilemapAddr)}, want ${hex(bg3Tm)}`);
  assert(r.bg2CharAddr === bg2Ch, `mode ${hex(mode)} bg2CharAddr: got ${hex(r.bg2CharAddr)}, want ${hex(bg2Ch)}`);
  assert(r.bg3CharAddr === bg3Ch, `mode ${hex(mode)} bg3CharAddr: got ${hex(r.bg3CharAddr)}, want ${hex(bg3Ch)}`);
}

// ── Compositing descriptors ─────────────────────────────────────────────────
// Each case: mode, bg3Disabled, then the expected {visible, role, blend} for
// BG2 and BG3. These pin the "support BG2/BG3 more fully" behaviour: subscreen
// layers are visible, mode $03 BG3 (offset data) is suppressed, and the
// mode-$0E cave-shadow BG3 reads as a darkening overlay.
console.log('── BG2/BG3 compositing descriptors ──');
function desc(mode: number, bg3Disabled = false) {
  return deriveDescriptors(loadSceneRegs(rom, symbols, mode), mode, bg3Disabled);
}

// mode $00 — both BG2+BG3 on the MAIN screen → background, source-over.
{
  const { bg2Layer, bg3Layer } = desc(0x00);
  assert(bg2Layer.visible && bg2Layer.role === 'background' && bg2Layer.blend === 'source-over', 'mode $00 BG2 = visible background');
  assert(bg3Layer.visible && bg3Layer.role === 'background', 'mode $00 BG3 = visible background');
}
// mode $05 (1-1) — BG3 on main, BG2 on SUBSCREEN. Both visible backgrounds.
{
  const { bg2Layer, bg3Layer } = desc(0x05);
  assert(bg2Layer.visible && bg2Layer.role === 'background', 'mode $05 BG2 (subscreen) = visible background');
  assert(bg3Layer.visible && bg3Layer.role === 'background', 'mode $05 BG3 (main) = visible background');
}
// mode $0B — BOTH BG2+BG3 on the subscreen. The big fix: previously invisible.
{
  const { bg2Layer, bg3Layer } = desc(0x0b);
  assert(bg2Layer.visible && bg2Layer.role === 'background', 'mode $0B BG2 (subscreen) = visible background');
  assert(bg3Layer.visible && bg3Layer.role === 'background', 'mode $0B BG3 (subscreen) = visible background');
}
// mode $07 — BG2+BG3 on the subscreen; BG3 hidden when its tilemap action byte
// disables it (the 1-4 case). With bg3Disabled the BG3 layer is suppressed.
{
  const open = desc(0x07, false);
  assert(open.bg2Layer.visible, 'mode $07 BG2 (subscreen) = visible');
  assert(open.bg3Layer.visible, 'mode $07 BG3 (subscreen) = visible when not disabled');
  const hidden = desc(0x07, true);
  assert(!hidden.bg3Layer.visible, 'mode $07 BG3 = hidden when bg3Disabled (e.g. 1-4)');
  assert(hidden.bg2Layer.visible, 'mode $07 BG2 stays visible when only BG3 disabled');
}
// mode $03 — BG Mode 2 offset-per-tile: BG2 is a normal background, BG3 carries
// per-tile OFFSET data (not pixels) and must stay suppressed.
{
  const { bg2Layer, bg3Layer } = desc(0x03);
  assert(bg2Layer.visible && bg2Layer.role === 'background', 'mode $03 BG2 (3D-rock, subscreen) = visible background');
  assert(!bg3Layer.visible, 'mode $03 BG3 = suppressed (BG Mode 2 offset data, not a tile layer)');
}
// mode $0E — color math SUBTRACTS the subscreen BG3 from BG1+BG2: BG2 is a
// main-screen background, BG3 a darkening overlay (multiply, above BG1).
{
  const { bg2Layer, bg3Layer } = desc(0x0e);
  assert(bg2Layer.visible && bg2Layer.role === 'background', 'mode $0E BG2 (main) = visible background');
  assert(bg3Layer.visible && bg3Layer.role === 'overlay' && bg3Layer.blend === 'multiply', 'mode $0E BG3 (subscreen, subtracted) = darkening overlay');
}
// mode $0A (Kamek cinema) — gm$0C bypasses the normal tilemap loaders; suppress
// both BG2 and BG3 entirely regardless of TM/TS.
{
  const { bg2Layer, bg3Layer } = desc(0x0a);
  assert(!bg2Layer.visible && !bg3Layer.visible, 'mode $0A (cinema) = BG2 + BG3 both suppressed');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
