// Music set-table editing — the four byte tables the level header's music
// value resolves through (see research/plan-audio-panel.md §1.10 and the
// audio catalog's readers, scripts/audio/catalog.ts):
//   Bank00 `DATA_spc_block_set_indexes` (;@editable:music-set-indexes) —
//     setting → DATA_spc_data_blocks row (byte = row·4; byte 0 = sentinel,
//     indexing is 1-based on the setting; 20 settings 0x00-0x13).
//   Bank00 `DATA_spc_data_blocks` (;@editable:music-set-rows) — 13 rows ×
//     4 bytes: up to 3 DATA_SPC_ptr block ids in upload order, $FF fill
//     (the last byte stays $FF — the upload loop's terminator).
//   Bank00 `DATA_item_denial_table` (;@editable:music-item-denial) — per
//     setting: 0 items ok / 1 denied / $FF inherit (18 entries, 0x00-0x11).
//   Bank01 `DATA_01B24B` (;@editable:music-init-songs) — per setting: the
//     song slot auto-played on a set change (19 entries, 0x00-0x12; 0 =
//     none — CODE_music_load_song silences a zero-pointer slot safely).
//
// The splice is byte-preserving (dataByteEdits — only a CHANGED byte's hex
// digits are rewritten), so a no-change save round-trips byte-for-byte, and
// the asm's inline SMWC-tweak comments survive. Tables are fixed-size —
// growth is impossible anyway (Bank00's tables sit before address-pinned
// code; assert pc() <= $0085DC).

import { findRegion } from './asm/markers.ts';
import { applyEdits } from './asm/text-literals.ts';
import { dataByteEdits, findRegionDataBytes, type DataByte } from './asm/data-words.ts';
import { SPC_BLOCKS } from './audio/catalog.ts';
import type { MusicSetsModel, MusicSetSettingModel } from './types.ts';

/** The Bank asm files the tables live in (workRoot-relative). */
export const MUSIC_SETS_BANK00_FILE = 'yi/Banks/Bank00.asm';
export const MUSIC_SETS_BANK01_FILE = 'yi/Banks/Bank01.asm';

export const MUSIC_SET_INDEXES_REGION = 'music-set-indexes';
export const MUSIC_SET_ROWS_REGION = 'music-set-rows';
export const MUSIC_ITEM_DENIAL_REGION = 'music-item-denial';
export const MUSIC_INIT_SONGS_REGION = 'music-init-songs';

const SET_INDEXES_LABEL = 'DATA_spc_block_set_indexes';
const SET_ROWS_LABEL = 'DATA_spc_data_blocks';
const ITEM_DENIAL_LABEL = 'DATA_item_denial_table';
const INIT_SONGS_LABEL = 'DATA_01B24B';

/** Music settings the tables address (0x00-0x13). */
export const MUSIC_SET_SETTINGS = 20;
/** DATA_spc_data_blocks rows. */
export const MUSIC_SET_ROWS = 13;
/** Settings the init-song table covers (0x00-0x12). */
export const MUSIC_INIT_SONG_SETTINGS = 19;
/** Settings the item-denial table covers (0x00-0x11). */
export const MUSIC_ITEM_DENIAL_SETTINGS = 18;
/** Highest 1-based song slot the $FF8E table serves. */
export const MUSIC_INIT_SONG_MAX = 0x14;

const VALID_BLOCK_IDS = new Set(SPC_BLOCKS.map((b) => b.blockId));

export type SerializeResult = { ok: true; bank00Text: string; bank01Text: string } | { ok: false; error: string };

function regionBytes(text: string, file: string, region: string, label: string, expected: number): DataByte[] {
  if (!findRegion(text, region)) {
    throw new Error(
      `Missing ;@editable:${region} markers in ${file} — the overlay predates the music-set tables. ` +
      'Upgrade the overlay (Project menu) and retry.'
    );
  }
  const bytes = findRegionDataBytes(text, region, label);
  if (bytes.length !== expected) {
    throw new Error(`${label} has ${bytes.length} bytes; expected ${expected} (out of date?).`);
  }
  return bytes;
}

/** Parse both banks' tables into the structured model. Throws when a marker
 *  pair is missing or a table has an unexpected size. */
export function parseMusicSets(bank00Text: string, bank01Text: string): MusicSetsModel {
  const idx = regionBytes(bank00Text, MUSIC_SETS_BANK00_FILE, MUSIC_SET_INDEXES_REGION, SET_INDEXES_LABEL, MUSIC_SET_SETTINGS + 1);
  const rows = regionBytes(bank00Text, MUSIC_SETS_BANK00_FILE, MUSIC_SET_ROWS_REGION, SET_ROWS_LABEL, MUSIC_SET_ROWS * 4);
  const denial = regionBytes(bank00Text, MUSIC_SETS_BANK00_FILE, MUSIC_ITEM_DENIAL_REGION, ITEM_DENIAL_LABEL, MUSIC_ITEM_DENIAL_SETTINGS);
  const init = regionBytes(bank01Text, MUSIC_SETS_BANK01_FILE, MUSIC_INIT_SONGS_REGION, INIT_SONGS_LABEL, MUSIC_INIT_SONG_SETTINGS);

  const settings: MusicSetSettingModel[] = [];
  for (let s = 0; s < MUSIC_SET_SETTINGS; s++) {
    settings.push({
      blockSetRow: (idx[s + 1]!.value / 4) | 0, // byte 0 = sentinel
      initSongId: s < MUSIC_INIT_SONG_SETTINGS ? init[s]!.value : null,
      itemDenial: s < MUSIC_ITEM_DENIAL_SETTINGS ? denial[s]!.value : null,
    });
  }
  const rowLists: number[][] = [];
  for (let r = 0; r < MUSIC_SET_ROWS; r++) {
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const v = rows[r * 4 + i]!.value;
      if (v !== 0xff) ids.push(v);
    }
    rowLists.push(ids);
  }
  return { settings, rows: rowLists };
}

/**
 * Splice the edited model back into both banks' regions (format-preserving;
 * only changed bytes rewrite, so untouched settings/rows — including odd base
 * values — are never re-validated). Validates only CHANGED values: rows 0-12,
 * block ids from DATA_SPC_ptr (≤3 per row, upload order preserved), init
 * slots 0-0x14, item flags 0/1/$FF.
 */
export function serializeMusicSets(bank00Text: string, bank01Text: string, model: MusicSetsModel): SerializeResult {
  try {
    const idx = regionBytes(bank00Text, MUSIC_SETS_BANK00_FILE, MUSIC_SET_INDEXES_REGION, SET_INDEXES_LABEL, MUSIC_SET_SETTINGS + 1);
    const rows = regionBytes(bank00Text, MUSIC_SETS_BANK00_FILE, MUSIC_SET_ROWS_REGION, SET_ROWS_LABEL, MUSIC_SET_ROWS * 4);
    const denial = regionBytes(bank00Text, MUSIC_SETS_BANK00_FILE, MUSIC_ITEM_DENIAL_REGION, ITEM_DENIAL_LABEL, MUSIC_ITEM_DENIAL_SETTINGS);
    const init = regionBytes(bank01Text, MUSIC_SETS_BANK01_FILE, MUSIC_INIT_SONGS_REGION, INIT_SONGS_LABEL, MUSIC_INIT_SONG_SETTINGS);

    if (model.settings.length !== MUSIC_SET_SETTINGS || model.rows.length !== MUSIC_SET_ROWS) {
      return { ok: false, error: `model shape mismatch (${model.settings.length} settings / ${model.rows.length} rows).` };
    }

    // One change map PER RUN — each run's byteOffsets restart at 0, so the
    // three Bank00 tables must not share a map.
    const idxChanges = new Map<number, number>();
    const rowChanges = new Map<number, number>();
    const denialChanges = new Map<number, number>();
    const initChanges = new Map<number, number>();
    const hexS = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

    for (let s = 0; s < MUSIC_SET_SETTINGS; s++) {
      const m = model.settings[s]!;
      const rowByte = m.blockSetRow * 4;
      if (rowByte !== idx[s + 1]!.value) {
        if (!Number.isInteger(m.blockSetRow) || m.blockSetRow < 0 || m.blockSetRow >= MUSIC_SET_ROWS) {
          return { ok: false, error: `setting ${hexS(s)}: block-set row ${m.blockSetRow} out of range (0-${MUSIC_SET_ROWS - 1}).` };
        }
        idxChanges.set(idx[s + 1]!.byteOffset, rowByte);
      }
      if (s < MUSIC_INIT_SONG_SETTINGS && m.initSongId !== null && m.initSongId !== init[s]!.value) {
        if (!Number.isInteger(m.initSongId) || m.initSongId < 0 || m.initSongId > MUSIC_INIT_SONG_MAX) {
          return { ok: false, error: `setting ${hexS(s)}: init song slot ${m.initSongId} out of range (0-${MUSIC_INIT_SONG_MAX}).` };
        }
        initChanges.set(init[s]!.byteOffset, m.initSongId);
      }
      if (s < MUSIC_ITEM_DENIAL_SETTINGS && m.itemDenial !== null && m.itemDenial !== denial[s]!.value) {
        if (m.itemDenial !== 0 && m.itemDenial !== 1 && m.itemDenial !== 0xff) {
          return { ok: false, error: `setting ${hexS(s)}: item flag ${m.itemDenial} must be 0, 1 or 0xFF.` };
        }
        denialChanges.set(denial[s]!.byteOffset, m.itemDenial);
      }
    }

    for (let r = 0; r < MUSIC_SET_ROWS; r++) {
      const ids = model.rows[r]!;
      if (ids.length > 3) {
        return { ok: false, error: `row ${r}: ${ids.length} blocks — a set uploads at most 3 (the 4th byte is the $FF terminator).` };
      }
      for (let i = 0; i < 4; i++) {
        const v = ids[i] ?? 0xff;
        if (v === rows[r * 4 + i]!.value) continue;
        if (v !== 0xff && !VALID_BLOCK_IDS.has(v)) {
          return { ok: false, error: `row ${r}: 0x${v.toString(16).toUpperCase()} is not a DATA_SPC_ptr block id.` };
        }
        rowChanges.set(rows[r * 4 + i]!.byteOffset, v);
      }
    }

    return {
      ok: true,
      bank00Text: applyEdits(bank00Text, [
        ...dataByteEdits(idx, idxChanges),
        ...dataByteEdits(rows, rowChanges),
        ...dataByteEdits(denial, denialChanges),
      ]),
      bank01Text: applyEdits(bank01Text, dataByteEdits(init, initChanges)),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
