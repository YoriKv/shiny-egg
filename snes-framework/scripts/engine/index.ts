// Engine module — asm-first ports of YI's graphics + level-data pipeline.
// Replaces the legacy GoldenEgg-derived code under `../gfx/` over time.
//
// Phase 1 (foundation primitives, no level context):
//   - decompress/  : LZ2 + LZ16 decoders (verified vs lc200/decomp.exe)
//   - tile.ts      : 4bpp + 2bpp tile pixel decoders
//   - color.ts     : BGR-15 → RGB888 + ImageData u32 + palette-row builder
//   - map16.ts     : Map16 ID → 4 sub-tile descriptors
//
// Phase 2 (asm-first VRAM/CGRAM loaders):
//   - symbol-map.ts    : parser for asar's WLA-format .sym files. Loaders
//                        resolve table addresses via this rather than
//                        hardcoded constants — survives asm patches.
//   - load-palettes.ts : port of `load_level_palettes` ($00:BA24)
//   - load-graphics.ts : port of `load_level_gfx` ($00:B339)
//
// Phase 3+ (object decode engine + Bank12/13 handlers — pending):
//   - Bank10 parser, Bank12 walker, per-object/per-cell handlers.

export * from './decompress/index.ts';
export * from './tile.ts';
export * from './color.ts';
export * from './map16.ts';
export * from './symbol-map.ts';
export * from './load-palettes.ts';
export * from './load-graphics.ts';
