// .spc file synthesis — wrap a composed ARAM image (aram.ts) into a playable
// SPC v0.30 file, cold-booting the YI driver with a pre-poked song request.
// This is the editor's "hear it without an emulator" spine: the same file
// plays in the renderer wasm player, spcplay, or renders to WAV offline.
//
// Boot recipe (verified against SPC700_Engine_YI.asm):
//  - PC = $0400 (CODE_spc_engine_boot). The boot self-initializes everything:
//    CLRP, SP=$CF, clears zp $00-$DF + $0200-$03FF, echo-commit (writes DSP
//    FLG=$20 — unmuted, echo writes off), MVOLL/MVOLR=$60, DIR=$3C, timer0
//    divider $10, control=$01. The .spc DSP template therefore barely
//    matters; we ship power-on-style FLG=$E0 and let boot configure.
//  - Song request: the id is pre-poked into the port-0 input latch (ARAM
//    $F4 — .spc players initialize input ports from the RAM image). The main
//    loop's edge-read (CODE_spc_port_read_edge) compares against last-seen
//    $08, which boot zeroes, so a nonzero id triggers CODE_music_load_song
//    exactly once and never re-triggers.
//  - The one patch: boot writes control=$F0, whose bits 4/5 CLEAR both input
//    port pairs — wiping the poke. We patch the immediate to $00 in the
//    synthesized image only (`MOV A,#$F0` → `MOV A,#$00` before
//    `MOV $00F1,A`). $F0's timer bits are already 0, so $00 is behaviorally
//    identical minus the port clear. Pattern-matched, not offset-hardcoded,
//    so engine edits move it without breaking us.
//
// Same recipe as AddmusicK's generateSPCs() (driver at base, PC at entry,
// song id poked into the $F4-$F7 port mirrors) — the proven architecture for
// synthesized N-SPC-family SPCs.

import { parseBlockFromRom, songSlotsOfStream, type AudioCatalog } from './catalog.ts';
import {
  applyUploadStream,
  ARAM_SIZE,
  composeSettingAram,
  ENGINE_BLOCK_ID,
  GLOBAL_SAMPLES_BLOCK_ID,
  songSlotPtr,
} from './aram.ts';

export const SPC_FILE_SIZE = 0x10200;

export interface SpcTags {
  /** Song title (≤32 chars). */
  title?: string;
  /** Game title (≤32 chars). */
  game?: string;
  /** Dumper name (≤16 chars). */
  dumper?: string;
  /** Comment (≤32 chars). */
  comment?: string;
  /** Artist (≤32 chars). */
  artist?: string;
  /** Playback seconds before fade (ID666 text field, ≤999). */
  lengthSeconds?: number;
  /** Fade length in ms (≤99999). */
  fadeMs?: number;
  /** Date dumped, MM/DD/YYYY. Omitted by default (no Date.now in workflows). */
  date?: string;
}

export interface SpcCpuState {
  pc: number;
  a?: number;
  x?: number;
  y?: number;
  psw?: number;
  sp?: number;
}

function putAscii(out: Uint8Array, offset: number, len: number, text: string | undefined): void {
  if (!text) return;
  for (let i = 0; i < Math.min(len, text.length); i++) {
    const c = text.charCodeAt(i);
    out[offset + i] = c >= 0x20 && c < 0x7f ? c : 0x3f; // non-ASCII → '?'
  }
}

/** Build an SPC v0.30 file from a 64 KB ARAM image + CPU state + tags. */
export function buildSpcFile(aram: Uint8Array, cpu: SpcCpuState, tags: SpcTags = {}, dsp?: Uint8Array): Uint8Array {
  if (aram.length !== 0x10000) throw new Error('ARAM image must be 64 KB');
  if (dsp && dsp.length !== 128) throw new Error('DSP template must be 128 bytes');
  const out = new Uint8Array(SPC_FILE_SIZE);

  putAscii(out, 0x00, 33, 'SNES-SPC700 Sound File Data v0.30');
  out[0x21] = 26;
  out[0x22] = 26;
  out[0x23] = 26; // ID666 present (27 = absent)
  out[0x24] = 30; // version minor

  out[0x25] = cpu.pc & 0xff;
  out[0x26] = (cpu.pc >> 8) & 0xff;
  out[0x27] = cpu.a ?? 0;
  out[0x28] = cpu.x ?? 0;
  out[0x29] = cpu.y ?? 0;
  out[0x2a] = cpu.psw ?? 0;
  out[0x2b] = cpu.sp ?? 0xef;

  // ID666, text variant.
  putAscii(out, 0x2e, 32, tags.title);
  putAscii(out, 0x4e, 32, tags.game);
  putAscii(out, 0x6e, 16, tags.dumper);
  putAscii(out, 0x7e, 32, tags.comment);
  putAscii(out, 0x9e, 11, tags.date);
  putAscii(out, 0xa9, 3, tags.lengthSeconds !== undefined ? String(Math.min(999, Math.max(0, Math.round(tags.lengthSeconds)))) : undefined);
  putAscii(out, 0xac, 5, tags.fadeMs !== undefined ? String(Math.min(99999, Math.max(0, Math.round(tags.fadeMs)))) : undefined);
  putAscii(out, 0xb1, 32, tags.artist);
  out[0xd1] = 0; // default channel disables
  out[0xd2] = 0x30; // "emulator used": '0' = unknown

  out.set(aram, 0x100);
  if (dsp) {
    out.set(dsp, 0x10100);
  } else {
    out[0x10100 + 0x6c] = 0xe0; // FLG: reset|mute|echo-off — boot reconfigures
  }
  return out;
}

// MOV A,#$F0 = E8 F0 ; MOV $00F1,A = C5 F1 00
const BOOT_PORT_CLEAR_PATTERN = [0xe8, 0xf0, 0xc5, 0xf1, 0x00];

/** Offsets of the boot's port-clearing control write in `bytes` (within
 *  [from, to)). One pattern, two consumers: the synthesis patch below and the
 *  import side's driver verify (spc-import.ts), which must accept either
 *  immediate at the patched byte (pattern start + 1). */
export function findBootPortClearSites(bytes: Uint8Array, from = 0, to = bytes.length): number[] {
  const pat = BOOT_PORT_CLEAR_PATTERN;
  const hits: number[] = [];
  for (let p = from; p <= to - pat.length; p++) {
    let ok = true;
    for (let i = 0; i < pat.length; i++) if (bytes[p + i] !== pat[i]) { ok = false; break; }
    if (ok) hits.push(p);
  }
  return hits;
}

/** Patch the boot's port-clearing control write out of a composed ARAM image
 *  (see header comment). Throws unless exactly one match is found. */
export function patchBootPortClear(aram: Uint8Array): void {
  const hits = findBootPortClearSites(aram, 0x0400, 0x2000);
  if (hits.length !== 1) {
    throw new Error(`boot port-clear write: expected exactly 1 match of MOV A,#$F0 / MOV $00F1,A in $0400-$2000, found ${hits.length}`);
  }
  aram[hits[0] + 1] = 0x00;
}

export interface SynthesizedSpc {
  spc: Uint8Array;
  /** Blocks composed into the image, in upload order. */
  blockIds: number[];
}

/** Compose a music setting's ARAM baseline and wrap it as a playable .spc
 *  that boots the driver and plays `songSlotId` (1-based $FF90 slot). */
export function synthesizeSongSpc(
  rom: Uint8Array,
  catalog: AudioCatalog,
  setting: number,
  songSlotId: number,
  tags: SpcTags = {},
): SynthesizedSpc {
  if (songSlotId < 1 || songSlotId > 0x14) {
    throw new Error(`song slot id 0x${songSlotId.toString(16)} out of range 0x01-0x14`);
  }
  const composed = composeSettingAram(rom, catalog, setting);
  // Sanity: the slot must actually be populated in this baseline (a slot the
  // composed modules never patched would read a stale/zero pointer).
  const ptr = songSlotPtr(composed.aram, songSlotId);
  if (ptr === 0) {
    throw new Error(`song slot 0x${songSlotId.toString(16)} is empty in music setting 0x${setting.toString(16)}'s baseline`);
  }
  patchBootPortClear(composed.aram);
  composed.aram[0xf4] = songSlotId; // port-0 input latch
  const spc = buildSpcFile(composed.aram, { pc: composed.entry }, {
    game: "Yoshi's Island",
    lengthSeconds: 180,
    fadeMs: 8000,
    ...tags,
  });
  return { spc, blockIds: composed.blockIds };
}

/** Synthesize a playable .spc that cold-boots the driver and fires one SFX.
 *
 *  Same recipe as songs with two differences: the ARAM baseline is
 *  engine + global sample bank (SFX sequences ship inside the driver image
 *  and their instruments index the global bank — a music set is neither
 *  needed nor wanted), and the id is poked into the port-3 input latch
 *  ($F7, the one-shot SFX mailbox) instead of port 0. CODE_sfx_mailbox_poll
 *  edge-detects against $0B, which boot zeroes, so the SFX fires exactly
 *  once. Ids ≥ $C0 are driver commands (fade/pause/resume), not SFX.
 *  Verified: all sampled ids render real audio via libgme
 *  (tmp/sfx-preview-test.ts). */
export function synthesizeSfxSpc(
  rom: Uint8Array,
  catalog: AudioCatalog,
  sfxId: number,
  tags: SpcTags = {},
): Uint8Array {
  if (!Number.isInteger(sfxId) || sfxId < 1 || sfxId >= 0xc0) {
    throw new Error(`SFX id 0x${sfxId.toString(16)} out of range 0x01-0xBF`);
  }
  const aram = new Uint8Array(ARAM_SIZE);
  let entry = 0x0400;
  for (const blockId of [ENGINE_BLOCK_ID, GLOBAL_SAMPLES_BLOCK_ID]) {
    const { stream } = parseBlockFromRom(rom, catalog, blockId);
    applyUploadStream(aram, stream);
    if (blockId === ENGINE_BLOCK_ID) entry = stream.entry;
  }
  patchBootPortClear(aram);
  aram[0xf7] = sfxId;
  return buildSpcFile(aram, { pc: entry }, {
    game: "Yoshi's Island",
    lengthSeconds: 8,
    fadeMs: 10,
    ...tags,
  });
}

/** Song slots playable from a setting's composed baseline.
 *
 *  Engine-only settings (row 0: title) use the engine's own $FF90 patch (the
 *  title-music slots). For every other setting, ONLY the row's song modules
 *  count: their $D000-region uploads overwrite the engine's title sequence
 *  data, so any engine slot they don't re-patch is a dangling pointer into
 *  foreign bytes — requesting it in-game is the same stale-slot failure mode
 *  as the music-$07 residency hang, and we refuse to enumerate it. */
export function songSlotsOfSetting(rom: Uint8Array, catalog: AudioCatalog, setting: number): Map<number, number> {
  const cfg = catalog.settings[setting];
  if (!cfg) throw new Error(`unknown music setting 0x${setting.toString(16)}`);
  const engineOnly = cfg.blockIds.length === 1 && cfg.blockIds[0] === ENGINE_BLOCK_ID;
  const sourceIds = engineOnly ? [ENGINE_BLOCK_ID] : cfg.blockIds.filter((id) => id !== ENGINE_BLOCK_ID);
  const slots = new Map<number, number>();
  for (const id of sourceIds) {
    const { stream } = parseBlockFromRom(rom, catalog, id);
    for (const [slot, ptr] of songSlotsOfStream(stream)) slots.set(slot, ptr);
  }
  return slots;
}
