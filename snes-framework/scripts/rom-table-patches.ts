// Registry of cart data tables that can be patched straight into a built ROM
// image, so a consumer can see an edited table without reassembling.
//
// Each entry is a fixed-size table inside one `;@editable` region of an asm
// file. It knows the label the table starts at and how to produce the table's
// exact cart bytes from either source:
//
//   • fromAsm   — the region text of an (overlay) asm file;
//   • fromModel — the editor-side model of that table (the same shape the
//                 table's resource loads/saves).
//
// Patching is valid only for tables whose size never changes and that the
// assembler copies verbatim (no pointers or computed values derived from them),
// so `bytes` written at `symbols.pc(label)` equal what a rebuild would emit.
// A new fixed-size table editor whose edits affect rendering enrols here.

import { findRegion } from './asm/markers.ts';
import type { SymbolMap } from './engine/symbol-map.ts';
import {
  SPRITESET_COUNT,
  SPRITESET_FILES_BANK_FILE,
  SPRITESET_FILES_PER_ROW,
  SPRITESET_FILES_REGION,
  parseSpritesetFiles,
  spritesetFilesBytes,
} from './spriteset-files.ts';
import {
  OBJECT_PROPERTIES_BANK_FILE,
  OBJECT_PROPERTIES_LABEL,
  OBJECT_PROPERTIES_REGION,
  OBJECT_PROPERTIES_SIZE,
  objectPropertiesBytes,
  objectPropertiesFromAsm,
} from './object-properties.ts';
import {
  SPRITE_PROPERTIES_BANK_FILE,
  SPRITE_PROPERTY_COUNT,
  spritePropertyTableBytes,
  spritePropertyTableDef,
  spritePropertyTableFromAsm,
} from './sprite-property-tables.ts';
import type {
  ObjectPropertiesModel,
  RomTablePatchKind,
  SpritePropertiesModel,
  SpritePropertyTableKey,
  SpritesetFilesModel,
} from './types.ts';

/** A render-affecting sprite property table (sprite-property-tables.ts): the
 *  sprite renderer reads the palette/flip attr, the gfx-file id and the OAM
 *  record count straight from the ROM, so their drafts preview live. */
function spritePropertyPatch(kind: RomTablePatchKind, key: SpritePropertyTableKey, label: string): RomTablePatch {
  const def = spritePropertyTableDef(key);
  return {
    kind,
    file: SPRITE_PROPERTIES_BANK_FILE,
    region: def.region,
    label,
    size: SPRITE_PROPERTY_COUNT * 2,
    fromAsm: (text) => {
      const words = spritePropertyTableFromAsm(text, key);
      return words ? spritePropertyTableBytes({ tables: { [key]: words } } as unknown as SpritePropertiesModel, key) : null;
    },
    fromModel: (model) => spritePropertyTableBytes(model as SpritePropertiesModel, key),
  };
}

export interface RomTablePatch {
  kind: RomTablePatchKind;
  /** workRoot-relative asm file holding the table. */
  file: string;
  /** The `;@editable` region wrapping the table. */
  region: string;
  /** Label at the table's first byte. */
  label: string;
  /** Table size in bytes (fixed). */
  size: number;
  /** Table bytes from asm text, or null when the file lacks the region (an
   *  overlay saved before the region existed can't hold an edit to it). */
  fromAsm: (text: string) => Uint8Array | null;
  /** Table bytes from the editor model. Throws on a malformed model. */
  fromModel: (model: unknown) => Uint8Array;
}

export const ROM_TABLE_PATCHES: readonly RomTablePatch[] = [
  {
    kind: 'spriteset-files',
    file: SPRITESET_FILES_BANK_FILE,
    region: SPRITESET_FILES_REGION,
    label: 'DATA_spriteset_files',
    size: SPRITESET_COUNT * SPRITESET_FILES_PER_ROW,
    fromAsm: (text) =>
      findRegion(text, SPRITESET_FILES_REGION) ? spritesetFilesBytes(parseSpritesetFiles(text)) : null,
    fromModel: (model) => spritesetFilesBytes(model as SpritesetFilesModel),
  },
  {
    // Has no editor of its own: enrolled so a hand edit to a project's overlay
    // Bank12.asm reaches the object decode (which sizes each record from this
    // table) and the editor's object size/placement checks without a rebuild.
    kind: 'object-properties',
    file: OBJECT_PROPERTIES_BANK_FILE,
    region: OBJECT_PROPERTIES_REGION,
    label: OBJECT_PROPERTIES_LABEL,
    size: OBJECT_PROPERTIES_SIZE,
    fromAsm: objectPropertiesFromAsm,
    fromModel: (model) => objectPropertiesBytes(model as ObjectPropertiesModel),
  },
  // Labels the vendored symbol map carries (engine/symbol-map.ts).
  spritePropertyPatch('sprite-priority-attr', 'priorityAttr', 'DATA_0A9F1A'),
  spritePropertyPatch('sprite-gfx-files', 'gfxFile', 'DATA_sprite_gfx_file_table'),
  spritePropertyPatch('sprite-render-control', 'render', 'DATA_sprite_render_control_table'),
];

export function romTablePatch(kind: RomTablePatchKind): RomTablePatch {
  const patch = ROM_TABLE_PATCHES.find((p) => p.kind === kind);
  if (!patch) throw new Error(`Unknown ROM table patch: ${kind}`);
  return patch;
}

/** Write a table's bytes into `rom` at its label. Throws if the size is wrong or
 *  the table doesn't fit in the image. */
export function applyRomTablePatch(
  rom: Uint8Array,
  symbols: SymbolMap,
  patch: RomTablePatch,
  bytes: Uint8Array
): void {
  if (bytes.length !== patch.size) {
    throw new RangeError(`${patch.label}: expected ${patch.size} bytes, got ${bytes.length}.`);
  }
  const pc = symbols.pc(patch.label);
  if (pc < 0 || pc + bytes.length > rom.length) {
    throw new RangeError(`${patch.label} does not fit within the ROM image.`);
  }
  rom.set(bytes, pc);
}
