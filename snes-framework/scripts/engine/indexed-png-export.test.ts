// Every EDITABLE graphics PNG is color-INDEXED, and its pixels are the assembled view
// itself (no palette swatch stitched beside the art — the palette rides in the PLTE).
// Cross-track by design: the property is one contract shared by all the assembled-view
// exports, and each track's own pin tests its diff/slice, not its PNG bytes. For every
// track here:
//   1. the exported PNG decodes as INDEXED (indices + palette present),
//   2. its RGBA is the rendered canvas BYTE-FOR-BYTE at the canvas size (so import,
//      which reads the canvas region, sees exactly what the renderer drew — including
//      transparent index 0, carried by tRNS),
//   3. re-importing it unedited yields ZERO edits (the round-trip is a no-op).
// The gfx-file sheets + the level-icon / glyph / screen tracks decode their PNGs in
// their own pins (gfx-png-export, world-map-level-icons, sprite-glyph, screen-gfx).
//
// Run: node snes-framework/scripts/engine/indexed-png-export.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { decodePng, type ImageData } from './png.ts';
import {
  buildWorldMapIconContext,
  renderWorldMapIcon,
  worldMapIconPng,
  diffWorldMapIconTiles,
  buildTitleSceneryContext,
  renderTitleScenery,
  titleSceneryPng,
  diffTitleScenery,
  buildTitleIslandContext,
  renderTitleIsland,
  titleIslandPng,
  diffTitleIslandTiles,
  buildTitleLogoContext,
  renderTitleLogo,
  titleLogoPng,
  diffTitleLogoTiles,
  buildStorybookSceneContext,
  renderStorybookScene,
  storybookScenePng,
  diffStorybookSceneTiles
} from './screen-gfx.ts';
import {
  buildMetaspriteContext,
  renderMetasprite,
  metaspritePng,
  diffMetaspriteTiles,
  type MetaspriteHeader
} from './sprite-metasprite.ts';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
};

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) { console.error((e as Error).message); process.exit(2); }
const { rom, symbols } = cart;

/** The top-left `w`×`h` RGBA of a decoded PNG (what the importers read). */
function canvasRegion(img: ImageData, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * img.width + x) * 4, d = (y * w + x) * 4;
      out[d] = img.rgba[s]!; out[d + 1] = img.rgba[s + 1]!; out[d + 2] = img.rgba[s + 2]!; out[d + 3] = img.rgba[s + 3]!;
    }
  }
  return out;
}

/** Pin (1) + (2) for one track; returns the decoded canvas RGBA for the track's diff. */
function pinIndexedCanvas(label: string, png: Uint8Array, canvas: { rgba: Uint8Array; width: number; height: number }): Uint8Array {
  const img = decodePng(Buffer.from(png));
  assert(img.indices !== undefined && img.palette !== undefined && img.palette.length > 0, `${label}: PNG is color-indexed (palette in the file)`);
  assert(img.width === canvas.width && img.height === canvas.height, `${label}: PNG is exactly the canvas (${img.width}×${img.height}, no swatch strip)`);
  const edited = canvasRegion(img, canvas.width, canvas.height);
  // Transparent pixels compare by ALPHA only: a cleared canvas pixel is 0x00000000,
  // while the PNG resolves it to the palette's transparent slot, which keeps that
  // CGRAM color's RGB under alpha 0 (so an editor shows a real color there). Every
  // consumer keys transparency off alpha, so the two are the same pixel.
  let same = edited.length === canvas.rgba.length;
  for (let i = 0; same && i < edited.length; i += 4) {
    const a = edited[i + 3]!;
    if (a !== canvas.rgba[i + 3]!) same = false;
    else if (a !== 0 && (edited[i] !== canvas.rgba[i] || edited[i + 1] !== canvas.rgba[i + 1] || edited[i + 2] !== canvas.rgba[i + 2])) same = false;
  }
  assert(same, `${label}: decoded pixels == the rendered canvas (opaque bytes exact, transparency preserved)`);
  return edited;
}

console.log('=== metasprite ===');
{
  const rec = 0x27;
  const levelMap = loadLevelMapPublic(FRAMEWORK_ROOT);
  const h = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec }).header;
  const header: MetaspriteHeader = {
    bgColor: h[0] ?? 0, bg1Tileset: h[1] ?? 0, bg1Palette: h[2] ?? 0, bg2Tileset: h[3] ?? 0,
    bg2Palette: h[4] ?? 0, bg3Tileset: h[5] ?? 0, bg3Palette: h[6] ?? 0, spriteTileset: h[7] ?? 0,
    spritePalette: h[8] ?? 0, yoshiColor: 0, isWorld6: isWorld6Record(levelMap, rec),
    levelMode: h[9] ?? 0, animationTileset: h[10] ?? 0
  } as MetaspriteHeader;
  const ctx = buildMetaspriteContext(rom, symbols, header);
  let checked = 0;
  for (let id = 0; id < 0x200 && checked < 3; id++) {
    const canvas = renderMetasprite(ctx, id);
    if (!canvas || !canvas.faithful) continue;
    checked++;
    const edited = pinIndexedCanvas(`metasprite 0x${id.toString(16)}`, metaspritePng(ctx, canvas), canvas);
    assert(diffMetaspriteTiles(ctx, canvas, edited).edits.length === 0, `metasprite 0x${id.toString(16)}: unedited PNG → 0 tile edits`);
  }
  assert(checked === 3, `checked 3 faithful metasprites (got ${checked})`);
}

console.log('\n=== world-map slot icons ===');
{
  const ctx = buildWorldMapIconContext(rom, symbols, 0);
  for (const name of ['marker', 'castle'] as const) {
    const canvas = renderWorldMapIcon(ctx, name);
    if (!canvas) { assert(false, `world-map ${name} icon renders`); continue; }
    const edited = pinIndexedCanvas(`world-map ${name}`, worldMapIconPng(ctx, canvas), canvas);
    assert(diffWorldMapIconTiles(ctx, canvas, edited).edits.length === 0, `world-map ${name}: unedited PNG → 0 tile edits`);
  }
}

console.log('\n=== title scenery (GSU billboard atlas) ===');
{
  const ctx = buildTitleSceneryContext(rom, symbols);
  const canvas = renderTitleScenery(ctx);
  const edited = pinIndexedCanvas('title scenery', titleSceneryPng(ctx, canvas), canvas);
  assert(diffTitleScenery(ctx, edited).changed === 0, 'title scenery: unedited PNG → 0 changed bytes');
}

console.log('\n=== title island (Mode-7) ===');
{
  const ctx = buildTitleIslandContext(rom, symbols);
  const canvas = renderTitleIsland(ctx);
  const edited = pinIndexedCanvas('title island', titleIslandPng(ctx, canvas), canvas);
  assert(diffTitleIslandTiles(ctx, canvas, edited).edits.length === 0, 'title island: unedited PNG → 0 char edits');
}

console.log('\n=== title logo (Mode-0 BG2) ===');
{
  const ctx = buildTitleLogoContext(rom, symbols);
  const canvas = renderTitleLogo(ctx);
  const edited = pinIndexedCanvas('title logo', titleLogoPng(ctx, canvas), canvas);
  assert(diffTitleLogoTiles(ctx, canvas, edited).edits.length === 0, 'title logo: unedited PNG → 0 tile edits');
}

console.log('\n=== storybook first scene (BG3) ===');
{
  const ctx = buildStorybookSceneContext(rom, symbols);
  const canvas = renderStorybookScene(ctx);
  const edited = pinIndexedCanvas('storybook scene', storybookScenePng(ctx, canvas), canvas);
  assert(diffStorybookSceneTiles(ctx, canvas, edited).edits.length === 0, 'storybook scene: unedited PNG → 0 tile edits');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all indexed-PNG export pins pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
