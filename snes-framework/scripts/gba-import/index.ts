// Public surface of the GBA cart importer. Reads SMA3 (U) sublevel data out of a
// GBA ROM and transcodes it into shiny-egg LevelData (the SNES YI format), for
// importing GBA levels into a SNES project. The app layer wraps these into the
// import report + applies a selected sublevel onto a target record via the
// editor's save path (saveLevelResource). See sublevel.ts for the conversion.

export {
  identifyGbaCart,
  resolveGbaTables,
  sublevelMainOffset,
  sublevelSpriteOffset,
  GBA_MAX_SUBLEVEL_ID,
  GBA_HEADER_BIT_WIDTHS,
  SMA3_USA_CRC32,
  SMA3_USA_GAME_CODE,
  type GbaCartId,
  type GbaTables
} from './gba-cart.ts';
export {
  gbaSublevelToLevelData,
  type GbaToLevelDataOptions,
  type GbaImportResult,
  type ImportWarning
} from './sublevel.ts';
