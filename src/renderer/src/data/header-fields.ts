// Level-header field indices by name (LevelData.header order, engine header.ts).
// Its own module so both header-schema and bg-setups can import it without a
// cycle (header-schema reads the recipes to name palette values).

export const HEADER_FIELD = {
  bgColor: 0,
  bg1Tileset: 1,
  bg1Palette: 2,
  bg2Tileset: 3,
  bg2Palette: 4,
  bg3Tileset: 5,
  bg3Palette: 6,
  spriteTileset: 7,
  spritePalette: 8,
  levelMode: 9,
  animTileset: 10,
  animPalette: 11,
  scrollRate: 12,
  music: 13,
  itemMemory: 14
} as const
