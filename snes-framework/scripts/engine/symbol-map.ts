// Symbol-map module — parses asar's WLA-format `.sym` files into a
// `{label → PC offset}` lookup table. Used by the engine loaders so they
// resolve table addresses by label name rather than hardcoded V1.0
// constants — surviving any asm patches that shift the cart layout.
//
// # WLA `.sym` format
//
// asar 1.91's `--symbols=wla` emits:
//
//   ; this file was created by asar
//   [labels]
//   00:8000 chip_entry
//   00:8002 message_window_polygon
//   00:b78a DATA_scene_palette_layout
//   ...
//
// One section header `[labels]`, then `BB:OOOO <name>` per line where BB is
// SNES bank (hex, 2 digits) and OOOO is offset within the bank (hex, 4
// digits). Asar may emit additional sections (`[symbols]`, `[breakpoints]`,
// etc.); we only consume `[labels]`.
//
// # SNES → PC conversion
//
// YI uses **LoROM** for banks `$00-$3F` (and `$80-$BF`) and **SuperFX HiROM
// mapping** for banks `$40-$5F` (and `$C0-$DF`). Same byte, two addressings:
//
//   LoROM         `$BB:OOOO`  with BB in $00-$3F → PC = (BB << 15) | (OOOO & $7FFF)
//                                                       (upper 32 KB of bank only)
//   SuperFX HiROM `$BB:OOOO`  with BB in $40-$5F → PC = ((BB - $40) << 16) | OOOO
//                                                       (full 64 KB)
//   HiROM mirror  `$BB:OOOO`  with BB in $80-$BF → same as LoROM BB-$80
//                            `$BB:OOOO`  with BB in $C0-$DF → same as SuperFX BB-$80

/** A reverse-lookup hit: the asm label at or just before a PC offset, plus how
 *  far past it the offset sits (`delta === 0` ⇒ exact label hit). */
export interface ReverseHit {
  label: string;
  delta: number;
}

/**
 * True for a hand-authored, human-readable label; false for asar's
 * **address-derived auto-names** — `CODE_/DATA_/ADDR_/FXCODE_/FXDATA_` followed
 * by 6 hex digits (the original address).
 *
 * NOTE: this is a **readability** distinction, not a stability one. Every entry
 * in the `[labels]` section — auto-named included — is a real symbol in the
 * disassembly source and resolves to its *current* address after the asm
 * drifts; the hex in an auto-name is just the original address, not regenerated
 * on rebuild. So all of them track correctly via `label + delta`. asar emits
 * both a friendly and an auto-name at a location that has a friendly label, so
 * this is used only to **prefer the friendly alias for display** among labels
 * sharing one address — never to reject an auto-name. (`DATA_scene_palette_layout`
 * is friendly; `DATA_0AF7E1` is auto — the 6-hex suffix is the tell.)
 */
export function isFriendlyLabel(label: string): boolean {
  return !/^(CODE|DATA|ADDR|FXCODE|FXDATA)_[0-9A-Fa-f]{6}$/.test(label);
}

/** Map from asar label name (case-sensitive) to PC offset in the cart. */
export interface SymbolMap {
  pc(label: string): number;
  tryPc(label: string): number | undefined;
  /** All labels, useful for diagnostics / autocomplete UIs. */
  labels(): readonly string[];
  /**
   * The **nearest preceding** label to `pc`, with the byte delta. Backs the
   * custom-patch importer: an absolute IPS offset is anchored to the label it
   * falls in so the patch tracks its code/data across rebuilds + ROM versions
   * (`label + delta`). Anchoring to the *nearest* label minimises drift risk
   * (the smaller the delta, the less chance an asm insertion lands between the
   * anchor and the target). Returns `undefined` only when `pc` precedes every
   * label. Multiple labels share one address (LoROM/SuperFX PC-aliasing, and
   * asar's friendly+auto pair): the **friendly** alias is preferred for the
   * returned name, else an auto-name — both resolve to the same PC, so the
   * anchor is identical either way. Deterministic.
   */
  reverseLookup(pc: number): ReverseHit | undefined;
  /** Number of entries. */
  size: number;
}

/**
 * SNES `bank:offset` (24-bit) → cart PC offset. Handles LoROM, SuperFX
 * HiROM ($40-$5F), and the standard $80-$DF mirrors.
 */
export function snesToPC(snes: number): number {
  const bank = (snes >>> 16) & 0xff;
  const off = snes & 0xffff;
  if (bank >= 0x40 && bank <= 0x5f) return ((bank - 0x40) << 16) | off;
  if (bank >= 0xc0 && bank <= 0xdf) return ((bank - 0xc0) << 16) | off;
  // LoROM (banks $00-$3F or $80-$BF; the latter is a mirror)
  return ((bank & 0x7f) << 15) | (off & 0x7fff);
}

/**
 * Parse a WLA `.sym` file's text contents into a `SymbolMap`. Whitespace
 * and `;` comments are tolerated. Unknown section headers cause subsequent
 * lines to be skipped until the next recognised section.
 *
 * Throws on malformed lines (bad bank:offset hex) inside `[labels]`.
 */
export function parseWlaSymbolMap(text: string): SymbolMap {
  const map = new Map<string, number>();
  let inLabels = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // strip comments
    const commentIdx = line.indexOf(';');
    if (commentIdx >= 0) line = line.slice(0, commentIdx);
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      inLabels = line === '[labels]';
      continue;
    }
    if (!inLabels) continue;

    // Expected: "BB:OOOO name" (hex bank, hex offset, then name).
    const m = /^([0-9a-fA-F]{2}):([0-9a-fA-F]{4})\s+(\S+)/.exec(line);
    if (!m) {
      throw new Error(`parseWlaSymbolMap: bad line ${i + 1}: "${line}"`);
    }
    const bank = parseInt(m[1], 16);
    const off = parseInt(m[2], 16);
    const name = m[3];
    map.set(name, snesToPC((bank << 16) | off));
  }

  return makeMap(map);
}

function makeMap(map: Map<string, number>): SymbolMap {
  // Lazily-built PC-sorted index for reverseLookup, memoized on first use.
  // Sorted by (pc asc, label asc) so the binary search lands deterministically
  // and same-PC aliases group together (we pick the first label in the group).
  let sorted: Array<{ pc: number; label: string }> | null = null;
  const index = (): Array<{ pc: number; label: string }> => {
    if (!sorted) {
      sorted = Array.from(map, ([label, pc]) => ({ pc, label }));
      sorted.sort((a, b) => a.pc - b.pc || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    }
    return sorted;
  };

  return {
    size: map.size,
    pc(label: string): number {
      const v = map.get(label);
      if (v === undefined) {
        throw new Error(`SymbolMap: label not found: "${label}"`);
      }
      return v;
    },
    tryPc(label: string): number | undefined {
      return map.get(label);
    },
    labels(): readonly string[] {
      return Array.from(map.keys());
    },
    reverseLookup(pc: number): ReverseHit | undefined {
      const arr = index();
      // Greatest index with arr[i].pc <= pc.
      let lo = 0;
      let hi = arr.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].pc <= pc) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (found < 0) return undefined; // pc precedes every label
      // Within the alias group at this PC (sorted ascending by label): prefer the
      // first friendly name for readability, else fall back to the first label.
      const anchorPc = arr[found].pc;
      let start = found;
      while (start > 0 && arr[start - 1].pc === anchorPc) start--;
      let label = arr[start].label;
      for (let i = start; i <= found; i++) {
        if (isFriendlyLabel(arr[i].label)) { label = arr[i].label; break; }
      }
      return { label, delta: pc - anchorPc };
    },
  };
}

/**
 * Combine two symbol maps into one complete `SymbolMap` (with `reverseLookup`),
 * **first map wins** on name collisions — the canonical way to overlay the
 * SuperFX-side `.sym` on the main `.sym` so FX-only labels fill gaps. Unlike a
 * shallow `{pc, tryPc, labels}` spread, this rebuilds the backing table so the
 * merged map's reverse index spans every label from both.
 */
export function mergeSymbolMaps(primary: SymbolMap, secondary: SymbolMap): SymbolMap {
  const map = new Map<string, number>();
  for (const l of secondary.labels()) map.set(l, secondary.pc(l));
  for (const l of primary.labels()) map.set(l, primary.pc(l)); // primary wins
  return makeMap(map);
}

/**
 * Hardcoded SymbolMap for the V1.0 reference cart. Useful when engine code
 * needs to run against the ORIGINAL Nintendo cart (e.g. `extract.ts`, which
 * runs BEFORE any build has happened and therefore has no `.sym` to parse).
 *
 * Addresses are SNES `bank:offset` and get converted to PC the same way as
 * a real .sym entry, so callers don't need to know which form to use.
 *
 * **Only includes the labels the engine actually looks up.** Adding more
 * is a one-line append. If you need full symbol coverage (e.g. for
 * developer tooling), run a build first and parse `build/*.sym` instead.
 *
 * See memory:rom-address-resolution for the cross-version address table.
 */
export function vendoredV10SymbolMap(): SymbolMap {
  const m = new Map<string, number>();
  // SNES bank:offset (LoROM upper-32K). Converted to PC at insert time.
  const add = (label: string, snes: number): void => {
    m.set(label, snesToPC(snes));
  };

  // Palette pipeline (load_level_palettes consumers)
  add('DATA_scene_palette_layout', 0x00b78a);
  add('DATA_bg1_palette_ptrs', 0x00b874);
  add('DATA_bg1_dark_world_palette_ptrs', 0x00b8b4);
  add('DATA_bg2_palette_ptrs', 0x00b8f4);
  add('DATA_bg3_palette_ptrs', 0x00b974);
  add('DATA_sprite_palette_ptrs', 0x00b9f4);
  add('DATA_yoshi_palette_ptrs', 0x00ba14);
  // Per-level Yoshi-color LUT (Bank02, 72 bytes indexed by translevel slot; each
  // byte = a Yoshi color id that selects a DATA_yoshi_palette_ptrs row). Read at
  // level load (Bank17 CODE_17E729). Used by the ROM importer + diff inventory.
  add('DATA_yoshi_level_colors', 0x028000);

  // Graphics pipeline (load_level_gfx consumers)
  add('DATA_scene_gfx_layout', 0x00ad6d);
  add('DATA_bg1_tileset_files', 0x00af39);
  add('DATA_bg1_dark_tileset_files', 0x00af69);
  add('DATA_bg2_tileset_files', 0x00af99);
  add('DATA_bg3_tilesets_files', 0x00afd9);
  add('DATA_spriteset_files', 0x00b039);

  // Compressed-graphics source-pointer tables (Bank06, SuperFX-mapped)
  add('DATA_lz2_compressed_gfx_ptrs', 0x06f95e); // LZ2 source ptrs (Lunar Compress FORMAT=1)
  add('DATA_lz16_compressed_gfx_ptrs', 0x06fc79); // LZ16 source ptrs

  // Enemy-sprite cel + dynamic-body renderer (sprite-cel / sprite-tile-base /
  // sprite-dynamic-gfx). char-id == sprite-id; see research/notes-sprite-render.md.
  add('DATA_enemy_special_chr_addrs', 0x4d048a); // Bank4D dw cel-ptr table (Format B)
  add('DATA_enemy_object_data_ptrs', 0x4d0000);  // Bank4D dw object_data table (Format A)
  add('DATA_sprite_render_control_table', 0x0a9b1c);                  // $7040 spawn-seed; hi byte = OAMByteCount (frame-0 record count)
  add('DATA_0A9F1A', 0x0a9f1a);                  // $7042 seed; hi byte EOR $20 = per-sprite OAM attr (flip + palette)
  add('DATA_sprite_gfx_file_table', 0x0aa716);                  // sprite-id → required gfx file id (u16 × 442)
  add('DATA_0CE9FE', 0x0ce9fe);                  // Red Coin 0x065 runtime OAM-attr recolor table (YI_NorSpr065_RedCoin_Init)
  add('DATA_gfx_bank54_part2', 0x548000);        // bank-$54 dynamic-body bitmap anchor (DYNAMIC_BODY_SOURCES deltas); main-side alias FXDATA_548000

  // Level-name strings (Bank51, SuperFX-mapped). 72 × 2-byte bank-local
  // pointers indexed by translevel ID; garbage-sentinel string marks unused
  // slots. See levels-catalog.ts.
  add('DATA_level_name_string_ptrs', 0x5149bc);
  add('DATA_level_name_garbage_sentinel', 0x51532f);

  // BG2 tilemap loader (load_bg2_tilemap)
  add('DATA_bg2_tilemap_indices', 0x01e711);
  add('DATA_bg2_tilemap_gfx_entries', 0x01e751);

  // BG3 tilemap loader (load_bg3_tilemap) — 3-byte rows per tileset
  add('DATA_bg3_tilemap_table', 0x01e90a);

  // Backdrop gradient (LoadGradientPalette equivalent)
  // 16 × 4-byte (bank, offset) entries, indexed by (BackgroundColor - $10).
  // Each entry points at 24 BGR-15 colors in Bank57 (SuperFX-mapped).
  add('DATA_bg_gradient_ptrs', 0x01d573);

  // Scene-regs (scene_register_layout) — levelMode → sceneModeByteIdx via
  // levelmode_index, then sceneModeByteIdx → byte-offset-into-layout via
  // scene_layout_indices, then row reads start at scene_register_layout+offset.
  add('DATA_levelmode_index', 0x01af80);
  add('DATA_scene_layout_indices', 0x00bbaf);
  add('DATA_scene_register_layout', 0x00bbea);

  // Object decoder (parser dispatch) — SNES $12:84EC LoROM = PC $0904EC
  add('DATA_object_property_table', 0x1284ec);

  // Per-tileset Map16-ID template-slot init table — SNES $4C:D61A
  // SuperFX HiROM = PC $0CD61A. Consumed by init_per_tileset_template_slots
  // (Bank10 CODE_init_per_tileset_template_slots). 74 records × 35 bytes, $00-terminated.
  add('DATA_per_tileset_template_table', 0x4cd61a);

  // Header bit-widths table — 15 widths, MSB-first, used by extract.ts
  // when reading per-level bit-packed headers.
  add('DATA_header_bit_length', 0x108b05);

  // Level-data pointer table — SNES $17:F7C3 LoROM = PC $0BF7C3. 222 entries
  // × 6 bytes (`dl object_ptr, sprite_ptr`), indexed by **data-record index**
  // (NOT translevel ID directly — translevel IDs go through the
  // DATA_level_entrance_indexes → DATA_map_level_entrances indirection below).
  add('YI_LevelDataPtrsAndEntranceData_Ptrs', 0x17f7c3);

  // World-map → entrance-record indirection (read by gm$0C at Bank01.asm:6080).
  // - YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes ($17:F3E7): 72 u16 entries, indexed by
  //   translevel_id * 2. Each entry is a byte-offset into
  //   YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances. Value 0 for translevel IDs that aren't
  //   reachable from the world map (bonus / mini-game / sub-room slots).
  // - YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances ($17:F471): 4-byte records. Byte 0 =
  //   data_record_idx (used to index YI_LevelDataPtrsAndEntranceData_Ptrs
  //   * 6). Bytes 1-3 = spawn X / Y / tile-icon metadata (scaled << 4 by
  //   the caller for screen coords).
  // The midway variants below mirror this shape but feed the cart's
  // restart-at-midway path (consumed by Bank10 gm$38). They're not used
  // by the editor yet but available for future midway-restart features.
  add('YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes', 0x17f3e7);
  add('YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances', 0x17f471);
  add('YI_LevelDataPtrsAndEntranceData_DATA_level_midway_entrance_indexes', 0x17f551);
  add('YI_LevelDataPtrsAndEntranceData_DATA_map_level_midway_entrances', 0x17f5db);

  // Map16 page tables — SNES $4C:32A4 (index, 167 dw entries) +
  // $4C:33F2 (page data, ~41 KB of 8-byte chunks). SuperFX HiROM mapping.
  add('DATA_bitmap_asset_offset_table', 0x4c32a4); // map16 page-index table
  add('DATA_bitmap_asset_payloads', 0x4c33f2);     // map16 page-data base

  // Palette blob — SNES $5F:A000 SuperFX HiROM = PC $0x1FA000.
  // 8 KB of BGR-15 colors that CODE_load_palettes walks through via
  // byte-offset indirection.
  add('DATA_master_palette_rom_blob', 0x5fa000); // palette blob base

  // Title-screen placement tilemaps (the ROM importer diffs these at fixed
  // vanilla addresses, like the palette blob). Island = Mode-7 char bytes in
  // Bank57; logo = BG words in Bank0F.
  add('DATA_5F9800', 0x5f9800); // title-island tilemap (worlds 1-5), 1024 char bytes
  add('DATA_title_screen_logo_tilemap', 0x0ffc80); // title logo tilemap, 448 BG words

  return makeMap(m);
}
