// Graphics PNG/Aseprite EXPORT (the "Graphics" panel backend, export half). Renders
// the selected tracks to a folder + a manifest the import side (gfx-png-import.ts)
// reads back. Two tracks (research/graphics-editing/):
//   - SCREENS: the system/title/overworld screens' graphics (screens/) + the title
//     logo/island/map tilemaps + world-map / level icons.
//   - METASPRITES: the editable "meta" view of each sprite — its reconstructed
//     metasprite (the assembled character), under metasprite/ (+ the GSU-rasterized
//     sprites' glyphs under sprite-glyph/).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  exportScreenGfxPngs,
  exportWorldMapIcons,
  buildTitleLogoContext,
  renderTitleLogo,
  titleLogoPng,
  titleLogoAseprite,
  buildTitleIslandContext,
  renderTitleIsland,
  titleIslandPng,
  titleIslandAseprite,
  exportTitleScenery
} from 'snes-framework/screen-gfx'
import { exportWorldMapLevelIcons } from 'snes-framework/world-map-level-icons'
import { exportWorldMapTerrain, exportWorldMapGround } from 'snes-framework/world-map-terrain'
import { exportMetasprites } from 'snes-framework/sprite-metasprite'
import { exportSpriteGlyphs } from 'snes-framework/sprite-glyph'
import type { RenderHeaderRequest, ExportGfxOptions, GfxExportTrack } from '../shared/ipc-types'
import { loadRomAndSymbols } from './render/rom-cache'
import { gfxLiveEdits } from './gfx-live-cache'
import {
  MANIFEST,
  type GfxManifestEntry,
  type MetaspriteManifestEntry,
  type GlyphManifestEntry,
  type MapIconManifestEntry,
  type LevelIconManifestEntry,
  type MapTerrainManifestEntry,
  type MapGroundManifestEntry,
  type TitleLogoManifestEntry,
  type TitleIslandManifestEntry,
  type TitleSceneryManifestEntry
} from './gfx-manifest'

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Export the current level's gfx files to `dir` (PNGs in category folders + manifest).
 *  `spriteNames` (sprite id → friendly name) only NAMES the metasprite PNGs; it
 *  does not limit the set (every loadable cel-rendered sprite is exported). */
export function exportGfxPngsToDir(
  header: RenderHeaderRequest | null,
  dir: string,
  opts: ExportGfxOptions = {}
): { count: number } {
  const { rom, symbols } = loadRomAndSymbols()
  // Limit to the selected track(s); no filter ⇒ both tracks.
  const want = (t: GfxExportTrack): boolean => !opts.tracks || opts.tracks.includes(t)
  // Level-DEPENDENT tracks (metasprites + glyphs) need the loaded level's header +
  // palette; the screens track (system screens, world-map + level icons, the per-world
  // maps, the ground) does NOT. So screens export even with no level loaded
  // (`header == null`), while the metasprites track is gated on a real header.
  const wantLevel = (t: GfxExportTrack): boolean => want(t) && header != null
  mkdirSync(dir, { recursive: true })
  const manifest: GfxManifestEntry[] = []
  const used = new Set<string>()

  // `format: 'aseprite'` writes the assembled screens / metasprites as Aseprite
  // projects (the screens' title logo + island assemble as real tilemaps).
  const aseFmt = opts.format === 'aseprite'

  // System screens (boot / title / map) → PNGs under screens/. They reuse the
  // gfx-file manifest shape (single-row swatch, no perTilePalette), so the import
  // loop handles them with no extra code — a screen file and a level file
  // with the same id are the same compressed blob, round-tripped via saveGfxEdit.
  // `format:'aseprite'` writes the cropped boot-logo region as a single-image `.aseprite`.
  const screens = want('screens') ? exportScreenGfxPngs(rom, symbols, { aseprite: aseFmt }) : []
  for (const e of screens) {
    const useAse = aseFmt && e.aseprite
    const file = useAse ? e.file.replace(/\.png$/, '.aseprite') : e.file
    used.add(file)
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? e.aseprite! : e.png)
    manifest.push({
      file,
      description: e.description,
      format: e.format,
      fileId: e.fileId,
      bpp: e.bpp,
      sizeBytes: e.sizeBytes,
      rowCount: e.rowCount,
      index0Transparent: e.index0Transparent,
      region: e.region, // cropped screens (e.g. boot logo); undefined otherwise
      perTilePalette: e.perTilePalette // flat-map BG (f74/f75) per-tile palette; undefined otherwise
    })
  }

  // Reconstructed metasprites (the editable "meta" view) — every cel-rendered
  // sprite loadable under this level's header. Faithful → editable (metasprite/);
  // the rest preview-only (metasprite/preview/). Edits route to the sprite sheets.
  // `format:'aseprite'` writes each faithful metasprite as a single-image `.aseprite`.
  const metas = wantLevel('metasprites') ? exportMetasprites(rom, symbols, header!, { gfxOverride: gfxLiveEdits(), aseprite: aseFmt }) : []
  const metaManifest: MetaspriteManifestEntry[] = []
  for (const m of metas) {
    const idHex = m.spriteId.toString(16).toUpperCase().padStart(3, '0')
    const nm = opts.spriteNames?.[m.spriteId]
    const useAse = aseFmt && m.aseprite
    const leaf = `${idHex}${nm ? '-' + slug(nm) : ''}.${useAse ? 'aseprite' : 'png'}`
    const file = m.faithful ? `metasprite/${leaf}` : `metasprite/preview/${leaf}`
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? m.aseprite! : m.png)
    metaManifest.push({ file, spriteId: m.spriteId, faithful: m.faithful, hasDynamicBody: m.hasDynamicBody, width: m.width, height: m.height })
  }

  // Dynamic-sprite glyphs (the GSU-rasterized sprites' meta-equivalent) — the
  // byte-validated bank-$54 glyphs as editable PNGs; edits write back to the raw
  // glyph .bin via saveRawChrEdit (the raw-CHR write-back path). Global / level-invariant.
  const glyphs = wantLevel('metasprites') ? exportSpriteGlyphs(rom, symbols, header!) : []
  const glyphManifest: GlyphManifestEntry[] = []
  for (const gl of glyphs) {
    const idHex = gl.spriteNum.toString(16).toUpperCase().padStart(3, '0')
    const nm = opts.spriteNames?.[gl.spriteNum]
    const file = `sprite-glyph/${idHex}${nm ? '-' + slug(nm) : ''}.png`
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, gl.png)
    glyphManifest.push({ file, spriteNum: gl.spriteNum, width: gl.width, height: gl.height, sharedWith: gl.sharedWith })
  }

  // World-map level-slot icons (the editable "meta" view of the overworld's level
  // markers) — the normal marker + boss castle, per world in its tint. Faithful →
  // edits slice back to the shared $74/$75 BG tiles via saveGfxEdit. Level-invariant
  // (always exported). `format:'aseprite'` writes each icon as a single-image `.aseprite`.
  const mapIcons = want('screens') ? exportWorldMapIcons(rom, symbols, { aseprite: aseFmt }) : []
  const mapIconManifest: MapIconManifestEntry[] = []
  for (const ic of mapIcons) {
    const useAse = aseFmt && ic.aseprite
    const file = useAse ? ic.file.replace(/\.png$/, '.aseprite') : ic.file
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? ic.aseprite! : ic.png)
    mapIconManifest.push({ file, world: ic.world, name: ic.name, faithful: ic.faithful, width: ic.width, height: ic.height })
  }

  // Per-level ICONS (the unique overworld level-select pictures) — worlds 0-5, slots
  // L1-L8 + EXTRA + BONUS (10/world). Pixels are GSU-chunky in cart bank $53 (read via
  // the DATA_08DA2E descriptor; the cart DATA_17DBA3 plot-X picks the byte's low/high
  // nibble — two icons per byte). Edits slice back to the $53 .bin via saveRawChrEdit.
  // `format:'aseprite'` writes each level icon as a single-image `.aseprite`.
  const levelIcons = want('screens') ? exportWorldMapLevelIcons(rom, symbols, { aseprite: aseFmt }) : []
  const levelIconManifest: LevelIconManifestEntry[] = []
  for (const ic of levelIcons) {
    const useAse = aseFmt && ic.aseprite
    const file = `screens/map/world-${ic.world}/level-${ic.slot}-${slug(ic.name)}.${useAse ? 'aseprite' : 'png'}`
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? ic.aseprite! : ic.png)
    levelIconManifest.push({ file, world: ic.world, slot: ic.slot, name: ic.name, faithful: ic.faithful, width: ic.width, height: ic.height })
  }

  // Per-world OVERWORLD MAP (the terrain Yoshi paths across) — 6 worlds × 2 halves
  // (levels 1-4 / 5-8). The PNG is the composited view (ground + map); the `.aseprite`
  // is the editable LAYOUT tilemap that round-trips to the $7C/$7D… LZ2 tilemap file
  // via saveGfxEdit. (Map pixels edit via the shared screens/map char sheets.)
  const mapTerrain = want('screens') ? exportWorldMapTerrain(rom, symbols, { aseprite: aseFmt }) : []
  const mapTerrainManifest: MapTerrainManifestEntry[] = []
  for (const m of mapTerrain) {
    const useAse = aseFmt && m.aseprite
    const file = useAse ? m.file.replace(/\.png$/, '.aseprite') : m.file
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? m.aseprite! : m.png)
    mapTerrainManifest.push({ file, world: m.world, half: m.half, fileId: m.fileId, width: m.width, height: m.height })
  }

  // The decorative GROUND behind every map (BG3, world-invariant) — one shared editable
  // layout. PNG = view; .aseprite = the layout tilemap → round-trips to file $7E. Ground
  // pixels edit via the screens/map/common/f56 char sheet.
  let mapGroundManifest: MapGroundManifestEntry | null = null
  if (want('screens')) {
    const g = exportWorldMapGround(rom, symbols, { aseprite: aseFmt })
    const useAse = aseFmt && g.aseprite
    const file = useAse ? g.file.replace(/\.png$/, '.aseprite') : g.file
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? g.aseprite! : g.png)
    mapGroundManifest = { file, fileId: g.fileId, width: g.width, height: g.height }
  }

  // Title "Yoshi's Island" logo (the editable "meta" view of the Mode-0 BG logo) —
  // assembled from the $1D char tiles; faithful edits slice back via saveGfxEdit.
  // `format:'aseprite'` writes the assembled logo as a real Aseprite tilemap.
  let titleLogoManifest: TitleLogoManifestEntry | null = null
  if (want('screens')) {
    const ctx = buildTitleLogoContext(rom, symbols)
    const canvas = renderTitleLogo(ctx)
    const useAse = aseFmt && canvas.faithful
    const file = `screens/title/logo.${useAse ? 'aseprite' : 'png'}`
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? titleLogoAseprite(ctx, canvas) : titleLogoPng(ctx, canvas))
    titleLogoManifest = { file, faithful: canvas.faithful, width: canvas.width, height: canvas.height }
  }

  // Title floating island (Mode-7) — assembled from file $B1 (CPC char) + the
  // DATA_5F9800 tilemap; faithful edits slice back to $B1 via saveGfxEdit.
  // `format:'aseprite'` writes the assembled island as a real Aseprite tilemap whose
  // import is COMBINED (pixels + placement + added tiles); a PNG is pixels-only.
  let titleIslandManifest: TitleIslandManifestEntry | null = null
  if (want('screens')) {
    const ctx = buildTitleIslandContext(rom, symbols)
    const canvas = renderTitleIsland(ctx)
    const useAse = aseFmt && canvas.faithful
    const file = `screens/title/island.${useAse ? 'aseprite' : 'png'}`
    const full = join(dir, file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, useAse ? titleIslandAseprite(ctx, canvas) : titleIslandPng(ctx, canvas))
    titleIslandManifest = { file, faithful: canvas.faithful, width: canvas.width, height: canvas.height }
  }

  // Title island SCENERY — the GSU-billboarded 3D decorations (flags/mountains/
  // castles/trees) as a raw 4bpp atlas; edits slice back to DATA_560000.bin via
  // saveRawChrEdit (the GSU positions/rotates them, so this edits the art only).
  let titleSceneryManifest: TitleSceneryManifestEntry | null = null
  if (want('screens')) {
    const titleScenery = exportTitleScenery(rom, symbols, { aseprite: aseFmt })
    const useAse = aseFmt && titleScenery.aseprite
    const file = useAse ? titleScenery.file.replace(/\.png$/, '.aseprite') : titleScenery.file
    const titleSceneryFull = join(dir, file)
    mkdirSync(dirname(titleSceneryFull), { recursive: true })
    writeFileSync(titleSceneryFull, useAse ? titleScenery.aseprite! : titleScenery.png)
    titleSceneryManifest = { file, width: titleScenery.width, height: titleScenery.height }
  }

  writeFileSync(
    join(dir, MANIFEST),
    JSON.stringify(
      {
        entries: manifest,
        metasprites: { header, sprites: metaManifest },
        glyphs: { header, sprites: glyphManifest },
        mapIcons: mapIconManifest,
        levelIcons: levelIconManifest,
        mapTerrain: mapTerrainManifest,
        mapGround: mapGroundManifest,
        titleLogo: titleLogoManifest,
        titleIsland: titleIslandManifest,
        titleScenery: titleSceneryManifest
      },
      null,
      2
    )
  )
  writeFileSync(join(dir, 'README.txt'), readmeText())
  return {
    count:
      screens.length + metas.length + glyphs.length +
      mapIcons.length + levelIcons.length + mapTerrain.length +
      (mapGroundManifest ? 1 : 0) + (titleLogoManifest ? 1 : 0) + (titleIslandManifest ? 1 : 0) + (titleSceneryManifest ? 1 : 0)
  }
}

/** Human guide dropped alongside the export, explaining the folder layout + the
 *  editing contract. */
function readmeText(): string {
  return [
    'Shiny Egg — exported graphics',
    '=============================',
    '',
    'Each PNG is the tiles (left) plus a palette swatch (right). Edit in any',
    'image editor, eyedropping the swatch as your palette, then re-import the',
    'folder. Off-palette / transparent pixels map to colour index 0. Only files',
    'whose pixels changed are written back.',
    '',
    'META view — the assembled metasprite of each sprite (the recognizable',
    'character); editing a metasprite writes back to the sprite tiles.',
    '',
    'Folders (by usage):',
    '  screens/      the system screens\' graphics — boot ("Nintendo Presents"),',
    '                title (rotating island), storybook (the opening story) and map',
    '                (overworld). The map is per world: screens/map/common/ holds',
    '                tiles shared by all worlds, screens/map/world-0../ hold each',
    '                world\'s own background tiles. The map BG is coloured in each',
    '                world\'s palette "tint" (worlds tint the same tiles different',
    '                colours). screens/map/world-N/icon-marker.png + icon-castle.png',
    '                are the assembled LEVEL-SLOT ICONS (the level marker + boss',
    '                castle) — edit these and the pixels write back to the shared map',
    '                tiles (the same icon tiles are used by EVERY world, so an edit',
    '                applies to all worlds). screens/map/world-N/level-S-NAME.png are the',
    '                10 per-level select pictures (L1-L8 + EXTRA + BONUS) — the unique',
    '                icon shown for each slot; edits write back to the bank-$53 source.',
    '                screens/map/world-N/overworld-1-4 + overworld-5-8 are the per-world',
    '                OVERWORLD MAPS Yoshi paths across (each world has two: levels 1-4 and',
    '                5-8) — the PNG is the composited view; the .aseprite (Aseprite export)',
    '                is the editable LAYOUT (rearrange the tilemap cells → the map\'s path/',
    '                pieces move). Map PIXELS edit via the shared screens/map sheets above.',
    '                screens/map/common/ground is the decorative ground (tan terrain + tree',
    '                line) behind every map — one shared layer; its .aseprite edits the',
    '                ground LAYOUT, its pixels via the common/f56 sheet.',
    '                The boot PNG is cropped to just the',
    '                "Nintendo Presents" logo (the rest of that sheet is in-game',
    '                HUD/sprites — see sprites/global-*). screens/title/logo.png is',
    '                the assembled "Yoshi\'s Island" LOGO (edit it and the pixels',
    '                write back to the title char tiles; its colours animate in-game,',
    '                so the shown frame is just one moment). screens/title/island.png',
    '                is the assembled Mode-7 floating island (edit it and the pixels',
    '                write back to file 0xB1\'s char; its colours animate in-game too).',
    '                NOTE: the island is a tilemap over ~100 SHARED 8x8 tiles (the sky',
    '                tile repeats ~250x), so editing a pixel changes that tile EVERYWHERE',
    '                it repeats — the import reports how many other cells an edit spreads to.',
    '                screens/title/scenery.png is the island 3D decoration ART (flags,',
    '                mountains, castles, trees) the SuperFX billboards on top — a raw 4bpp',
    '                atlas; edit the pixels (the GSU controls 3D placement/rotation, not this).',
    '  metasprite/   each sprite assembled as its recognizable character (the meta',
    '                view). Edit these and re-import — edits write to the sprite',
    '                tiles in sprites/. metasprite/preview/ holds sprites we can\'t',
    '                faithfully reconstruct (dynamic/boss) — VIEW ONLY; edit those',
    '                via sprite-glyph/ (below) or the sprites/ sheets.',
    '  sprite-glyph/ boss / dynamic-tile sprites with no static tiles — their gfx',
    '                streams from a glyph bank. Edit these + re-import; edits write',
    '                to the shared glyph data (some sprites share a glyph — reported).',
    '',
    'gfx-manifest.json ties every PNG path back to its cart file.',
    '',
    'Notes',
    '-----',
    '* Sprite tiles are SHARED + DEDUPLICATED: a tile used by several sprites edits',
    '  for all of them (the metasprite import reports how many others changed).',
    '* The metasprite is a best-effort reconstruction — when correctness matters,',
    '  verify against an emulator, not the editor. Editing is byte-safe regardless.',
    ''
  ].join('\n')
}
