// ARAM composition — build the 64 KB APU RAM image a music setting produces,
// from the same upload-stream modules the game uploads (engine → samples →
// songs). This is the substrate for .spc synthesis (spc.ts) and the sequence
// decoder (sequence.ts): the composed image is what the SPC700 driver sees.
//
// Faithfulness note: at runtime ARAM *accumulates* every block set along the
// player's route (CODE_set_level_music diffs against the last upload only —
// see Bank00.asm's NOTE and the music-$07 residency hang). A from-scratch
// compose can't reproduce a route, so we build the minimal correct baseline:
// engine first, then the global sample bank ($25) unless the set replaces it,
// then the set's blocks in row order. Every song a set's own module patches
// into the $FF90 table is playable from that baseline; cross-set slots (the
// $07 defeat jingle outside the map set) are exactly as unavailable as they
// are in-game after a cold boot.

import type { AudioCatalog } from './catalog.ts';
import { parseBlockFromRom, SONG_TABLE_BASE } from './catalog.ts';
import type { UploadStream } from './upload-stream.ts';

export const ARAM_SIZE = 0x10000;

/** Read a little-endian word out of an ARAM image (addresses wrap at 64 KB). */
export const aramWord = (aram: Uint8Array, addr: number): number =>
  aram[addr & 0xffff] | (aram[(addr + 1) & 0xffff] << 8);

/** Read song slot `n`'s pointer (1-based $FF8E+2n) from an ARAM image. */
export const songSlotPtr = (aram: Uint8Array, slot: number): number =>
  aramWord(aram, SONG_TABLE_BASE + slot * 2);

/** Block id of the SPC700 engine module (DATA_SPC_ptr row 15). */
export const ENGINE_BLOCK_ID = 0x2b;
/** Block id of the global sample bank (globalbank — common SFX + base samples). */
export const GLOBAL_SAMPLES_BLOCK_ID = 0x25;

export function applyUploadStream(aram: Uint8Array, stream: UploadStream): void {
  if (aram.length !== ARAM_SIZE) throw new Error('ARAM image must be 64 KB');
  for (const b of stream.blocks) {
    if (b.dest + b.data.length > ARAM_SIZE) {
      throw new Error(`upload block dest 0x${b.dest.toString(16)} len 0x${b.data.length.toString(16)} overflows ARAM`);
    }
    aram.set(b.data, b.dest);
  }
}

export interface ComposedAram {
  aram: Uint8Array;
  /** Blocks applied, in upload order. */
  blockIds: number[];
  /** Entry point from the engine stream (always $0400). */
  entry: number;
}

/** Compose the baseline ARAM image for an explicit block list (a set-table
 *  row, or a DRAFT row the Sets editor hasn't saved yet). `excludeBlockId`
 *  leaves one block out — the module a song import/overlay will replace
 *  (the import preview/diff baseline). */
export function composeBlocksAram(
  rom: Uint8Array,
  catalog: AudioCatalog,
  blockIds: readonly number[],
  excludeBlockId: number | null = null,
): ComposedAram {
  const order: number[] = [ENGINE_BLOCK_ID];
  // Engine-only sets (title) are self-contained: the engine image carries its
  // own sample directory + BRR bank at $4000 — injecting the global bank
  // AFTER it would clobber the title's samples. Every other set gets the
  // global bank first (its songs' SRCNs reach into it) unless the row
  // replaces it explicitly.
  const nonEngine = blockIds.filter((id) => id !== ENGINE_BLOCK_ID);
  if (nonEngine.length > 0 && !blockIds.includes(GLOBAL_SAMPLES_BLOCK_ID)) {
    order.push(GLOBAL_SAMPLES_BLOCK_ID);
  }
  order.push(...nonEngine.filter((id) => id !== excludeBlockId));

  const aram = new Uint8Array(ARAM_SIZE);
  let entry = 0x0400;
  for (const id of order) {
    const { stream } = parseBlockFromRom(rom, catalog, id);
    applyUploadStream(aram, stream);
    if (id === ENGINE_BLOCK_ID) entry = stream.entry;
  }
  return { aram, blockIds: order, entry };
}

/** Compose the baseline ARAM image for a music setting (0x00-0x13). */
export function composeSettingAram(
  rom: Uint8Array,
  catalog: AudioCatalog,
  setting: number,
  excludeBlockId: number | null = null,
): ComposedAram {
  const cfg = catalog.settings[setting];
  if (!cfg) throw new Error(`unknown music setting 0x${setting.toString(16)}`);
  return composeBlocksAram(rom, catalog, cfg.blockIds, excludeBlockId);
}
