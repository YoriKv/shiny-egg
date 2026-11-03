// Codec for the six-file-per-row sprite tileset table in Bank00.asm.
// The assembly stores each pair of file IDs as a little-endian `dw`; edits
// preserve the original source formatting and only replace changed words.

import { applyEdits } from './asm/text-literals.ts';
import { dataWordEdits, findRegionDataWords } from './asm/data-words.ts';
import { findRegion } from './asm/markers.ts';
import type { SpritesetFilesModel } from './types.ts';

export const SPRITESET_FILES_BANK_FILE = 'yi/Banks/Bank00.asm';
export const SPRITESET_FILES_REGION = 'spriteset-files';
export const SPRITESET_COUNT = 128;
export const SPRITESET_FILES_PER_ROW = 6;

const TABLE_LABEL = 'DATA_spriteset_files';
const WORD_COUNT = SPRITESET_COUNT * (SPRITESET_FILES_PER_ROW / 2);

function tableWords(text: string) {
  if (!findRegion(text, SPRITESET_FILES_REGION)) {
    throw new Error(
      `Missing ;@editable:${SPRITESET_FILES_REGION} markers in ${SPRITESET_FILES_BANK_FILE}. ` +
      'Upgrade the project overlay and retry.'
    );
  }
  const words = findRegionDataWords(text, SPRITESET_FILES_REGION, TABLE_LABEL);
  if (words.length !== WORD_COUNT) {
    throw new Error(`${TABLE_LABEL} has ${words.length * 2} bytes; expected ${WORD_COUNT * 2} (out of date?).`);
  }
  return words;
}

/** Parse all 128 six-file sprite tilesets. */
export function parseSpritesetFiles(text: string): SpritesetFilesModel {
  const words = tableWords(text);
  const rows: number[][] = [];
  for (let row = 0; row < SPRITESET_COUNT; row++) {
    const files: number[] = [];
    for (let pair = 0; pair < SPRITESET_FILES_PER_ROW / 2; pair++) {
      const word = words[row * 3 + pair]!.value;
      files.push(word & 0xff, word >>> 8);
    }
    rows.push(files);
  }
  return { rows };
}

/** The table's cart bytes (row-major, slot order) for a model. Throws on a
 *  model that isn't 128 rows × 6 byte-sized file IDs. */
export function spritesetFilesBytes(model: SpritesetFilesModel): Uint8Array {
  if (!Array.isArray(model?.rows) || model.rows.length !== SPRITESET_COUNT) {
    throw new RangeError(`Expected ${SPRITESET_COUNT} sprite tileset rows.`);
  }
  const out = new Uint8Array(SPRITESET_COUNT * SPRITESET_FILES_PER_ROW);
  model.rows.forEach((files, row) => {
    if (!Array.isArray(files) || files.length !== SPRITESET_FILES_PER_ROW) {
      throw new RangeError(`Sprite tileset ${row}: expected ${SPRITESET_FILES_PER_ROW} file IDs.`);
    }
    files.forEach((fileId, slot) => {
      if (!Number.isInteger(fileId) || fileId < 0 || fileId > 0xff) {
        throw new RangeError(`Sprite tileset ${row}, slot ${slot}: file ID ${fileId} is outside 0x00–0xFF.`);
      }
      out[row * SPRITESET_FILES_PER_ROW + slot] = fileId;
    });
  });
  return out;
}

export type SerializeSpritesetFilesResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** Validate and splice the fixed-size six-file rows into Bank00.asm. */
export function serializeSpritesetFiles(
  text: string,
  model: SpritesetFilesModel
): SerializeSpritesetFilesResult {
  try {
    const words = tableWords(text);
    if (model.rows.length !== SPRITESET_COUNT) {
      return { ok: false, error: `Expected ${SPRITESET_COUNT} sprite tileset rows; got ${model.rows.length}.` };
    }

    const changes = new Map<number, number>();
    for (let row = 0; row < SPRITESET_COUNT; row++) {
      const files = model.rows[row]!;
      if (files.length !== SPRITESET_FILES_PER_ROW) {
        return { ok: false, error: `Sprite tileset ${row}: expected ${SPRITESET_FILES_PER_ROW} file IDs; got ${files.length}.` };
      }
      for (let pair = 0; pair < SPRITESET_FILES_PER_ROW / 2; pair++) {
        const low = files[pair * 2]!;
        const high = files[pair * 2 + 1]!;
        for (const [slot, fileId] of [[pair * 2, low], [pair * 2 + 1, high]]) {
          if (!Number.isInteger(fileId) || fileId < 0 || fileId > 0xff) {
            return { ok: false, error: `Sprite tileset ${row}, slot ${slot}: file ID ${fileId} is outside 0x00–0xFF.` };
          }
        }
        const offset = (row * 3 + pair) * 2;
        changes.set(offset, low | (high << 8));
      }
    }

    return { ok: true, text: applyEdits(text, dataWordEdits(words, changes)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
