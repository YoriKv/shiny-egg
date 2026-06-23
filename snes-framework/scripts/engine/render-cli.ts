// Dev-time render CLI: run the engine renderers against the built V1.0 ROM and
// write images you can eyeball / diff, without wiring up the editor.
//
//   node snes-framework/scripts/engine/render-cli.ts level 0x1E [--scale 2] [--layers bg1,bg2,bg3,sprite,collision]
//   node snes-framework/scripts/engine/render-cli.ts sprites 0x00 [--range 0,4f]
//   node snes-framework/scripts/engine/render-cli.ts smoke
//
// `level`  — decode a level by record id and write its bg1 / sprite / collision
//            layers as PNGs (the headline "render a level for visual diffing"
//            mode). Shares render-level-layers.ts with render-snapshot.
// `sprites`— grid of every distinct sprite cel in a level (or an id --range),
//            each labeled with its hex id; garbage silhouettes flag a cel-decode
//            or tile-base bug.
// `smoke`  — legacy pipeline smoke test: VRAM tile grid + Map16 gallery + BG2/BG3
//            from a fake header, written as BMPs to /tmp.
//
// PNGs land in tmp/render-cli/ (gitignored). Engine-side, no native deps, runs
// from WSL, targets the built V1.0 ROM.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel } from '../level.ts';
import { renderLevelLayers, type LayerImage } from './render-level-layers.ts';
import { encodePng, scaleAndComposite, type ImageData } from './png.ts';
import { loadLevelGfx, type GfxFileEntry } from './load-graphics.ts';
import { loadLevelPalettes } from './load-palettes.ts';
import { hex } from '../hex.ts';
import { buildSpriteRenderModel } from './render-sprite-layer.ts';
import type { LevelSprite } from '../types.ts';
// smoke-mode renderers
import { renderMap16Gallery, renderVramGrid } from './render-gallery.ts';
import { renderBgLayer } from './render-bg-layers.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { loadBg2Tilemap } from './load-bg-tilemaps.ts';
import { parseHexId } from './cli-util.ts';

const OUT_DIR = path.join(FRAMEWORK_ROOT, '..', 'tmp', 'render-cli');
const pad2 = (n: number) => hex(n, 2);
const idHex = (n: number) => `0x${pad2(n)}`;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseId(s: string | undefined): number {
  if (!s || s.startsWith('--')) {
    console.error('Missing <levelRecordId>.');
    process.exit(2);
  }
  return parseHexId(s, { label: 'level record id' });
}

function usage(): never {
  console.error('Usage: render-cli.ts <level|sprites|smoke> ...');
  console.error('  render-cli.ts level <recordId> [--scale N] [--layers bg1,bg2,bg3,sprite,collision]');
  console.error('  render-cli.ts sprites <recordId> [--range lo,hi]');
  console.error('  render-cli.ts smoke');
  process.exit(2);
}

// ── mode: level ─────────────────────────────────────────────────────────────

function runLevel(): void {
  const id = parseId(process.argv[3]);
  const scale = Math.max(1, Math.floor(Number(flag('--scale') ?? 1)) || 1);
  const layers = (flag('--layers') ?? 'bg1,sprite,collision').split(',').map((s) => s.trim());
  const { rom, symbols } = loadDevCart();
  const level = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });
  const r = renderLevelLayers(rom, symbols, FRAMEWORK_ROOT, level);
  if (!r) {
    console.error(`Level ${idHex(id)} is empty/special/unbacked — nothing to render.`);
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const named: Array<[string, LayerImage | null]> = [
    ['bg1', r.bg1], ['bg2', r.bg2], ['bg3', r.bg3],
    ['bg2front', r.bg2Front], ['bg3front', r.bg3Front],
    ['sprite', r.sprite], ['collision', r.collision]
  ];
  let wrote = 0;
  for (const [name, img] of named) {
    if (!layers.includes(name)) continue;
    if (!img) {
      console.log(`  ${name.padEnd(9)} (none)`);
      continue;
    }
    const out = path.join(OUT_DIR, `level-${pad2(id)}-${name}.png`);
    fs.writeFileSync(out, encodePng(scaleAndComposite(img, scale)));
    console.log(`  ${name.padEnd(9)} ${img.width}x${img.height}${scale > 1 ? ` @${scale}x` : ''} → ${path.relative(process.cwd(), out)}`);
    wrote++;
  }
  if (!wrote) {
    console.error(`No layers matched --layers ${layers.join(',')} (valid: bg1,bg2,bg3,bg2front,bg3front,sprite,collision).`);
    process.exit(2);
  }
}

// ── mode: sprites ───────────────────────────────────────────────────────────

interface SpriteCell {
  id: number;
  res: { rgba: Uint8Array; width: number; height: number } | null;
}

function runSprites(): void {
  const id = parseId(process.argv[3]);
  const rangeArg = flag('--range');
  const { rom, symbols } = loadDevCart();
  const level = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });
  const h = level.header;
  // isWorld6 only affects BG tileset selection, not sprite VRAM, so false is fine.
  const gfxHeader = { bg1Tileset: h[1], bg2Tileset: h[3], bg3Tileset: h[5], spriteTileset: h[7], isWorld6: false, levelMode: h[9] };
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, gfxHeader, vram, manifest);
  loadLevelPalettes(
    rom,
    symbols,
    { bgColor: h[0], bg1Palette: h[2], bg2Palette: h[4], bg3Palette: h[6], spritePalette: h[8], yoshiColor: 0, isWorld6: false, levelMode: h[9] },
    cgram
  );

  let ids: number[];
  if (rangeArg) {
    const [lo, hi] = rangeArg.split(',').map((s) => parseInt(s, 16));
    ids = [];
    for (let i = lo; i <= hi; i++) ids.push(i);
  } else {
    ids = [...new Set(level.sprites.map((s) => s.num))].sort((a, b) => a - b);
  }

  // Render each id through the SAME path the editor uses (buildSpriteRenderModel):
  // restFrame, settled palette, Format-A/B gate, dynamic body, custom renderers,
  // HIDDEN_REVEAL and cell-parity — placed at cell (0,0) for the canonical parity-0
  // variant (matches the picker thumbnails). A bare resolveSpriteCel would render
  // frame 0 with NO body, which for restFrame sprites (morph bubbles, …) is the
  // placeholder frame — the wrong, "missing"-looking image.
  const cells: SpriteCell[] = [];
  for (const sid of ids) {
    const model = buildSpriteRenderModel({
      rom, symbols, header: gfxHeader,
      sprites: [{ index: 0, num: sid, x: 0, y: 0 } satisfies LevelSprite],
      vram, cgram, manifest, levelSpritePaletteId: h[8]
    });
    const p = model.placed[0];
    if (!p) {
      cells.push({ id: sid, res: null });
      continue;
    }
    // PlacedSprite pixels are RGBA-as-u32; alias the same bytes for the grid blitter.
    const rgba = new Uint8Array(p.pixels.buffer, p.pixels.byteOffset, p.pixels.byteLength);
    cells.push({ id: sid, res: { rgba, width: p.width, height: p.height } });
  }

  const img = layoutSpriteGrid(cells);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const suffix = rangeArg ? `-${rangeArg.replace(/[^0-9a-fA-F]/g, '_')}` : '';
  const out = path.join(OUT_DIR, `sprites-${pad2(id)}${suffix}.png`);
  fs.writeFileSync(out, encodePng(img));
  console.log(
    `level ${idHex(id)} spriteTileset=0x${h[7].toString(16)} — ${cells.length} ids, ` +
      `${cells.filter((c) => c.res).length} resolved → ${path.relative(process.cwd(), out)} (${img.width}x${img.height})`
  );
}

// 3×5 hex font for the per-cell id labels.
const FONT: Record<string, number[]> = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111], '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111], '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001], '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111], '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111], '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  'a': [0b111, 0b101, 0b111, 0b101, 0b101], 'b': [0b110, 0b101, 0b110, 0b101, 0b110],
  'c': [0b111, 0b100, 0b100, 0b100, 0b111], 'd': [0b110, 0b101, 0b101, 0b101, 0b110],
  'e': [0b111, 0b100, 0b111, 0b100, 0b111], 'f': [0b111, 0b100, 0b111, 0b100, 0b100],
  'x': [0b000, 0b101, 0b010, 0b101, 0b000], ' ': [0, 0, 0, 0, 0]
};

function drawText(buf: Uint8Array, ow: number, oh: number, text: string, px: number, py: number, rgb: [number, number, number]): void {
  let cx = px;
  for (const ch of text.toLowerCase()) {
    const g = FONT[ch] ?? FONT[' ']!;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (!(g[r]! & (1 << (2 - c)))) continue;
        const x = cx + c;
        const y = py + r;
        if (x < 0 || x >= ow || y < 0 || y >= oh) continue;
        const di = (y * ow + x) * 4;
        buf[di] = rgb[0];
        buf[di + 1] = rgb[1];
        buf[di + 2] = rgb[2];
        buf[di + 3] = 255;
      }
    }
    cx += 4;
  }
}

function layoutSpriteGrid(cells: SpriteCell[]): ImageData {
  const S = 4; // sprite pixel scale
  const CELL = 40; // logical cell size holding the sprite, centered
  const PAD = 2;
  const LABEL_H = 7;
  const cellW = CELL * S + PAD * 2;
  const cellH = CELL * S + PAD * 2 + LABEL_H;
  const COLS = Math.min(8, Math.max(1, cells.length));
  const ROWS = Math.ceil(cells.length / COLS);
  const ow = COLS * cellW;
  const oh = ROWS * cellH;
  const buf = new Uint8Array(ow * oh * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 24;
    buf[i + 1] = 24;
    buf[i + 2] = 34;
    buf[i + 3] = 255;
  }
  cells.forEach((cell, i) => {
    const col = i % COLS;
    const row = (i / COLS) | 0;
    const cellX = col * cellW;
    const cellY = row * cellH;
    const labelColor: [number, number, number] = cell.res ? [200, 220, 160] : [120, 100, 100];
    drawText(buf, ow, oh, '0x' + cell.id.toString(16).padStart(3, '0'), cellX + PAD, cellY + 1, labelColor);
    const r = cell.res;
    if (!r || r.width === 0) return;
    const drawW = r.width * S;
    const drawH = r.height * S;
    const ox = cellX + PAD + ((CELL * S - drawW) >> 1);
    const oy = cellY + PAD + LABEL_H + ((CELL * S - drawH) >> 1);
    for (let y = 0; y < drawH; y++) {
      for (let x = 0; x < drawW; x++) {
        const si = (((y / S) | 0) * r.width + ((x / S) | 0)) * 4;
        if (!r.rgba[si + 3]) continue;
        const dx = ox + x;
        const dy = oy + y;
        if (dx < 0 || dx >= ow || dy < 0 || dy >= oh) continue;
        const di = (dy * ow + dx) * 4;
        buf[di] = r.rgba[si]!;
        buf[di + 1] = r.rgba[si + 1]!;
        buf[di + 2] = r.rgba[si + 2]!;
        buf[di + 3] = 255;
      }
    }
  });
  return { rgba: buf, width: ow, height: oh };
}

// ── mode: smoke (legacy pipeline render) ────────────────────────────────────

function writeBmp(filepath: string, img: ImageData): void {
  const { rgba, width, height } = img;
  const pixelBytes = width * 4 * height;
  const fileSize = 14 + 40 + pixelBytes;
  const out = Buffer.alloc(fileSize);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(fileSize, 2);
  out.writeUInt32LE(54, 10); // pixel data offset
  out.writeUInt32LE(40, 14); // DIB header size
  out.writeInt32LE(width, 18);
  out.writeInt32LE(-height, 22); // top-down
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(32, 28); // bpp
  out.writeUInt32LE(pixelBytes, 34);
  out.writeUInt32LE(2835, 38);
  out.writeUInt32LE(2835, 42);
  for (let i = 0; i < width * height; i++) {
    const src = i * 4;
    const dst = 54 + i * 4;
    out[dst + 0] = rgba[src + 2]!; // B
    out[dst + 1] = rgba[src + 1]!; // G
    out[dst + 2] = rgba[src + 0]!; // R
    out[dst + 3] = rgba[src + 3]!; // A
  }
  fs.writeFileSync(filepath, out);
  console.log(`  wrote ${filepath} (${fileSize} bytes)`);
}

function runSmoke(): void {
  const { rom, symbols } = loadDevCart();
  console.log(`Loaded cart (${rom.length} bytes) + symbols (${symbols.size} labels)`);
  // Fake "level-0-ish" header — just enough for the pipeline to load without a
  // real level parse.
  const header = {
    bgColor: 0, bg1Palette: 0, bg2Palette: 0, bg3Palette: 0, spritePalette: 0, yoshiColor: 0,
    bg1Tileset: 0, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, isWorld6: false
  };

  console.log('Rendering VRAM tile grid...');
  writeBmp('/tmp/yi-vram.bmp', renderVramGrid(rom, symbols, header, { tileCount: 512, cellsPerRow: 16, paletteRow: 0 }));
  console.log('Rendering Map16 gallery...');
  writeBmp('/tmp/yi-map16.bmp', renderMap16Gallery(rom, symbols, header, { firstId: 0x0000, cellCount: 256, cellsPerRow: 16 }));

  console.log('Rendering BG2 + BG3...');
  const vram = new Uint8Array(0x10000);
  const cgram = new Uint8Array(512);
  loadLevelGfx(rom, symbols, header, vram);
  loadTileAnimation(rom, symbols, { animationTileset: 0, bg1Tileset: header.bg1Tileset, levelMode: 0 }, vram);
  loadLevelPalettes(rom, symbols, header, cgram);
  loadBg2Tilemap(rom, symbols, header.bg2Tileset, vram);
  const regs = loadSceneRegs(rom, symbols, 2);
  writeBmp('/tmp/yi-bg2.bmp', renderBgLayer(vram, cgram, { tilemapAddr: regs.bg2TilemapAddr, charAddr: regs.bg2CharAddr, scSize: regs.bg2ScSize, bpp: 4 }));
  writeBmp('/tmp/yi-bg3.bmp', renderBgLayer(vram, cgram, { tilemapAddr: regs.bg3TilemapAddr, charAddr: regs.bg3CharAddr, scSize: regs.bg3ScSize, bpp: 2 }));
  console.log('Done. View /tmp/yi-{vram,map16,bg2,bg3}.bmp');
}

// ── dispatch ────────────────────────────────────────────────────────────────

const mode = process.argv[2];
if (mode === 'level') runLevel();
else if (mode === 'sprites') runSprites();
else if (mode === 'smoke') runSmoke();
else usage();
