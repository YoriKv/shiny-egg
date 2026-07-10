// N-SPC sequence decoder (read-only) — decode a song out of a composed ARAM
// image (aram.ts) into structured events. YI's driver is the N-SPC "Basic"
// variant; every format fact below is verified against the disassembled
// engine (yi/SPC700/SPC700_Engine_YI.asm), with the SnesLab N-SPC spec as the
// cross-reference. Where the two could disagree, the engine wins.
//
// Song structure (CODE_music_load_song / CODE_music_voice_block_load):
//  - Song = a list of words. CODE_seq_global_read_word returns lo in A, hi in
//    Y, with processor flags on the HI byte (SPC700 POP doesn't set flags) —
//    so the walker branches on hi:
//      hi != 0          → pattern pointer (ARAM addr of 8 track-pointer words)
//      hi == 0, lo != 0 → loop control: lo = count, NEXT word = target addr.
//                         $42 is the counter: first pass reloads it from lo,
//                         then the jump repeats until it hits 0 (count $FF ≈
//                         "loop long/forever" in practice).
//      word == $0000    → end of song (stop + unmute SFX channels).
//  - Pattern (CODE_music_voice_header_apply): 16 bytes = 8 LE track pointers
//    (voice 1..8); 0 = voice silent this pattern.
//
// Track stream (CODE_music_voice_fetch_next_event / note_decode):
//  - $00        end of section: top level → next pattern; in subroutine → return.
//  - $01-$7F    note length in tempo ticks. May be followed by ONE more
//               positive byte = quantize/velocity: hi nibble → gate table
//               ($3FE8, 8 entries), lo nibble → velocity table ($3FF0, 16).
//               After len+qv the next byte is consumed as note/vcmd with NO
//               sign check (engine quirk — a positive byte there keys on as
//               a note).
//  - $80-$C7    note (72 chromatic steps, 6 octaves).
//  - $C8        tie   (keep note keyed; engine skips key-on setup).
//  - $C9        rest  (CODE_spc_channel_note_decode returns before key-on).
//  - $CA-$DF    percussion: instrument := (byte - $CA) + percussion base
//               ($5F, set by vcmd $FA), note forced to $A4.
//  - $E0-$FA    vcmd; arg counts from DATA_seq_voice_opcode_arg_counts
//               (engine line ~1231) — they match the SnesLab Basic table
//               27/27. $EF = subroutine: ptr16 + repeat count.
//  - $FB-$FF    invalid (would index past the 27-entry handler table).
//
// VCMD semantics: VERIFIED per-handler against the engine disassembly
// (2026-07-07, resolving plan §7.1) — every SnesLab Basic-table name held;
// several of the engine's auto-generated CODE_ labels did NOT (the
// "tremolo"/"vibrato" glosses are inverted, the "master vol"/"transpose"
// slide labels actually implement song-volume/tempo fades — trust the state
// written, not the label). Handler map (opcode → ARAM addr, key state):
//   E0 $08B1 instrument ($0211+x id; ×6 into $3D00 recs → DSP SRCN/ADSR/GAIN,
//            pitch mult → $0221/$0220+x; SRCN bit7 = NOISE mode, low 5 bits
//            → FLG noise clock, voice bit → NON shadow $49; ids ≥$CA add the
//            percussion base $5F)
//   E1 $090A pan ($0351 raw byte: bits 6/7 = channel phase-invert, low bits
//            position 0-20 → $0331; also the voice-reset default, A=#$0A
//            center)   E2 $0918 pan fade (ticks $91, target $0350, step $0340/1)
//   E3 $0931 vibrato on (pitch LFO: delay $02B0, rate $02A1, depth $B1/$02C1)
//   E4 $093D vibrato off — a MID-HANDLER ENTRY into E3's tail with A=0
//            (clears depth+counter); same trick as EC
//   E5 $0958 song volume ($59, frac $58; ignored while paused/fading)
//   E6 $0967 song volume fade (ticks $5A, target $5B, step $5C/D)
//   E7 $0979 tempo ($53, frac $52; cached to $03CF — the WRAM-visible tempo.
//            Music ticks fire at 500 Hz × tempo/256: timer0 divider $FA=$10
//            → 500 Hz, accumulator $51 += tempo per timer tick, carry = tick.
//            Default tempo $20 → 62.5 ticks/s)
//   E8 $0981 tempo fade (ticks $54, target $55, step $56/7)
//   E9 $0993 global transpose ($50, signed semitones — added in note decode)
//   EA $0996 channel transpose ($03D0→$02F0+x, signed; deferred while a
//            pitch slide is active via $03A0)
//   EB $09A5 tremolo on (volume LFO: delay $02E0, rate $02D1, depth $C1)
//   EC $09B1 tremolo off — mid-handler entry into EB's tail, A=0
//   ED $09E2 channel volume ($0301+x, frac $0300)
//   EE $09EB channel volume fade (ticks $90, target $0320, step $0310/1)
//   EF $0A13 subroutine (ptr lo/hi → $0240/1, repeat count → $80+x; return
//            addr saved in $0230/1)
//   F0 $0948 vibrato fade-in (ticks $02B1; per-tick depth step = $B1/ticks)
//   F1 $09B4 pitch envelope TO   ($0290=1; args delay $0281, DURATION ticks
//   F2 $09B8 pitch envelope FROM ($0290=0;  $03E1/$0280, semitone OFFSET
//            $0291 — at key-on $A0=dur drives kon_step; FROM subtracts the
//            offset from the working note then slides back, TO slides to
//            note+offset. Re-verified 2026-07-08: arg2 is the duration and
//            arg3 the offset — the original gloss had them swapped.)
//   F3 $09DB pitch envelope off (clears $0280/$03E1)
//   F4 $0A04 fine tune ($03E0→$0381 → pitch fraction $0360, 1/256 semitone)
//   F5 $0A36 echo on (EON mask $4A/$03C3, EVOLL $61, EVOLR $63; CLR5 $48 =
//            enable echo buffer writes)
//   F6 $0A6D echo off — entry into F5-adjacent tail with A=Y=0 + SET5 $48
//   F7 $0A74 echo params (EDL → DSP $7D + ESA=$3C−8·EDL, feedback $4E,
//            FIR preset index ×8 into DATA_fir_coefficient_banks → $x0F)
//   F8 $0A4C echo volume fade (ticks $68, target L $69/R $6A, steps $64-$67)
//   F9 $0ADF pitch slide to note (delay $A1, ticks $A0, target note+transpose
//            → $0380, step $0370/1). Also specially consumed INLINE after a
//            sustaining note (CODE_voice_tie_or_portamento_apply peeks for
//            $F9) — byte grammar is unchanged.
//   FA $0ADC percussion base ($5F, added to note bytes $CA-$DF)

import { aramWord } from './aram.ts';

export interface VcmdInfo {
  op: number;
  name: string;
  argCount: number;
  /** Per-arg display names (verified against the handlers above). */
  argNames: readonly string[];
}

/** Engine-sourced arg counts (DATA_seq_voice_opcode_arg_counts); names
 *  verified per-handler (see the map above). */
export const VCMDS: readonly VcmdInfo[] = [
  { op: 0xe0, name: 'setInstrument', argCount: 1, argNames: ['instrument'] },
  // YI quirk: larger pan position = further LEFT; bits 6/7 invert phase.
  { op: 0xe1, name: 'pan', argCount: 1, argNames: ['pan'] },
  { op: 0xe2, name: 'panFade', argCount: 2, argNames: ['ticks', 'target'] },
  { op: 0xe3, name: 'vibratoOn', argCount: 3, argNames: ['delay', 'rate', 'depth'] },
  { op: 0xe4, name: 'vibratoOff', argCount: 0, argNames: [] },
  { op: 0xe5, name: 'songVolume', argCount: 1, argNames: ['volume'] },
  { op: 0xe6, name: 'songVolumeFade', argCount: 2, argNames: ['ticks', 'target'] },
  { op: 0xe7, name: 'tempo', argCount: 1, argNames: ['tempo'] },
  { op: 0xe8, name: 'tempoFade', argCount: 2, argNames: ['ticks', 'target'] },
  { op: 0xe9, name: 'globalTranspose', argCount: 1, argNames: ['semitones'] },
  { op: 0xea, name: 'channelTranspose', argCount: 1, argNames: ['semitones'] },
  { op: 0xeb, name: 'tremoloOn', argCount: 3, argNames: ['delay', 'rate', 'depth'] },
  { op: 0xec, name: 'tremoloOff', argCount: 0, argNames: [] },
  { op: 0xed, name: 'channelVolume', argCount: 1, argNames: ['volume'] },
  { op: 0xee, name: 'channelVolumeFade', argCount: 2, argNames: ['ticks', 'target'] },
  { op: 0xef, name: 'subroutine', argCount: 3, argNames: ['ptrLo', 'ptrHi', 'count'] },
  { op: 0xf0, name: 'vibratoFadeIn', argCount: 1, argNames: ['ticks'] },
  { op: 0xf1, name: 'pitchEnvelopeTo', argCount: 3, argNames: ['delay', 'ticks', 'semitones'] },
  { op: 0xf2, name: 'pitchEnvelopeFrom', argCount: 3, argNames: ['delay', 'ticks', 'semitones'] },
  { op: 0xf3, name: 'pitchEnvelopeOff', argCount: 0, argNames: [] },
  { op: 0xf4, name: 'fineTune', argCount: 1, argNames: ['cents256'] },
  { op: 0xf5, name: 'echoOn', argCount: 3, argNames: ['voiceMask', 'volL', 'volR'] },
  { op: 0xf6, name: 'echoOff', argCount: 0, argNames: [] },
  { op: 0xf7, name: 'echoParams', argCount: 3, argNames: ['delay', 'feedback', 'firPreset'] },
  { op: 0xf8, name: 'echoVolumeFade', argCount: 3, argNames: ['ticks', 'targetL', 'targetR'] },
  { op: 0xf9, name: 'pitchSlide', argCount: 3, argNames: ['delay', 'ticks', 'note'] },
  { op: 0xfa, name: 'percussionBase', argCount: 1, argNames: ['instrumentBase'] },
] as const;

/** Music ticks per second for a given tempo byte (see E7 above). */
export function ticksPerSecond(tempo: number): number {
  return (500 * tempo) / 256;
}

export type TrackEvent =
  | { kind: 'length'; ticks: number; gate?: number; velocity?: number }
  | { kind: 'note'; note: number }        // $80-$C7 (raw byte)
  | { kind: 'tie' }
  | { kind: 'rest' }
  | { kind: 'perc'; index: number }       // 0-21 (byte - $CA)
  | { kind: 'vcmd'; op: number; name: string; args: number[] };

export interface DecodedTrack {
  addr: number;
  events: TrackEvent[];
  /** Encoded byte length including the $00 terminator. */
  byteLength: number;
  /** Subroutine targets referenced via vcmd $EF. */
  subroutineAddrs: number[];
}

export interface DecodedPattern {
  addr: number;
  /** 8 track addresses (0 = voice silent). */
  trackAddrs: number[];
}

export type SongPart =
  | { kind: 'pattern'; addr: number }
  | { kind: 'loop'; count: number; target: number }
  | { kind: 'end' };

export interface DecodedSong {
  songAddr: number;
  parts: SongPart[];
  /** Pattern addr → pattern (deduped). */
  patterns: Map<number, DecodedPattern>;
  /** Track addr → decoded track, top-level and subroutine streams alike. */
  tracks: Map<number, DecodedTrack>;
  /** Addresses decoded as subroutine bodies (subset of `tracks` keys). */
  subroutineAddrs: Set<number>;
}

const MAX_SONG_PARTS = 256;
const MAX_TRACK_EVENTS = 8192;

/** Decode one track/subroutine byte stream at `addr` until its $00 terminator. */
export function decodeTrack(aram: Uint8Array, addr: number): DecodedTrack {
  const events: TrackEvent[] = [];
  const subroutineAddrs: number[] = [];
  let p = addr;
  for (;;) {
    if (events.length > MAX_TRACK_EVENTS) {
      throw new Error(`track at 0x${addr.toString(16)}: exceeded ${MAX_TRACK_EVENTS} events — runaway decode`);
    }
    let b = aram[p++ & 0xffff];
    if (b === 0) break;

    if (b < 0x80) {
      // Length, with optional quantize/velocity byte.
      const ev: TrackEvent = { kind: 'length', ticks: b };
      const next = aram[p & 0xffff];
      if (next < 0x80) {
        p++;
        ev.gate = (next >> 4) & 0x07;
        ev.velocity = next & 0x0f;
        events.push(ev);
        // Engine consumes the following byte as note/vcmd with no sign check.
        b = aram[p++ & 0xffff];
        if (b === 0) {
          // A $00 here would key on note 0 in the engine, not terminate — but
          // no shipped song does this; treat as corruption.
          throw new Error(`track at 0x${addr.toString(16)}: $00 in note position after len+qv at 0x${(p - 1).toString(16)}`);
        }
      } else {
        events.push(ev);
        continue; // next byte is the note/vcmd; loop re-reads it
      }
    }

    if (b >= 0xe0) {
      if (b > 0xfa) {
        throw new Error(`track at 0x${addr.toString(16)}: invalid opcode 0x${b.toString(16)} at 0x${(p - 1).toString(16)}`);
      }
      const info = VCMDS[b - 0xe0];
      const args: number[] = [];
      for (let i = 0; i < info.argCount; i++) args.push(aram[p++ & 0xffff]);
      events.push({ kind: 'vcmd', op: b, name: info.name, args });
      if (b === 0xef) {
        subroutineAddrs.push(args[0] | (args[1] << 8));
      }
    } else if (b >= 0xca) {
      events.push({ kind: 'perc', index: b - 0xca });
    } else if (b === 0xc9) {
      events.push({ kind: 'rest' });
    } else if (b === 0xc8) {
      events.push({ kind: 'tie' });
    } else if (b >= 0x80) {
      events.push({ kind: 'note', note: b });
    } else {
      // Positive byte in note position (only reachable after len+qv) — the
      // engine keys it on as a note; preserve it as one.
      events.push({ kind: 'note', note: b });
    }
  }
  return { addr, events, byteLength: (p - addr) & 0xffff, subroutineAddrs };
}

/** Decode a full song from a composed ARAM image, starting at the $FF90-slot
 *  pointer `songAddr`. Patterns/tracks/subroutines are deduped by address. */
export function decodeSong(aram: Uint8Array, songAddr: number): DecodedSong {
  const parts: SongPart[] = [];
  const patterns = new Map<number, DecodedPattern>();
  const tracks = new Map<number, DecodedTrack>();
  const subroutineAddrs = new Set<number>();

  const decodeTrackAt = (addr: number, isSub: boolean): void => {
    if (isSub) subroutineAddrs.add(addr);
    if (tracks.has(addr)) return;
    const track = decodeTrack(aram, addr);
    tracks.set(addr, track);
    for (const sub of track.subroutineAddrs) decodeTrackAt(sub, true);
  };

  let p = songAddr;
  for (;;) {
    if (parts.length > MAX_SONG_PARTS) {
      throw new Error(`song at 0x${songAddr.toString(16)}: exceeded ${MAX_SONG_PARTS} parts — runaway walk`);
    }
    const w = aramWord(aram, p);
    p += 2;
    if (w === 0) {
      parts.push({ kind: 'end' });
      break;
    }
    if ((w & 0xff00) === 0) {
      const target = aramWord(aram, p);
      p += 2;
      parts.push({ kind: 'loop', count: w & 0xff, target });
      // A full-count loop never falls through in-engine unless the counter
      // exhausts; the walk continues past it either way (the engine does too
      // when $42 hits 0).
      continue;
    }
    parts.push({ kind: 'pattern', addr: w });
    if (!patterns.has(w)) {
      const trackAddrs: number[] = [];
      for (let v = 0; v < 8; v++) trackAddrs.push(aramWord(aram, w + v * 2));
      patterns.set(w, { addr: w, trackAddrs });
      for (const t of trackAddrs) {
        if (t !== 0) decodeTrackAt(t, false);
      }
    }
  }
  return { songAddr, parts, patterns, tracks, subroutineAddrs };
}
