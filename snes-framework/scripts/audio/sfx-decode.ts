// SFX script codec + chain resolver — the one-shot sound effects are NOT
// music-track data: they run on a separate fixed-rate interpreter
// (CODE_music_voice_script_step / CODE_2238, verified 2026-07-07) with its
// own tiny grammar. Facts this file encodes:
//
//  - Dispatch: sound id → priority-group table ($0EB0 block, 1-based: entry
//    at $0EAF+id). HIGH nibble = the voice pair index the SFX owns (SFX live
//    on voices 1-7; voice 8 is never assigned); the full byte is the
//    priority compared against whatever currently owns that voice. The id's
//    sequence pointer comes from the word tables at $0F7D (ids < $80) /
//    $107D (ids ≥ $80), indexed by id*2 (mod $100).
//  - MULTI-VOICE SFX are remap CHAINS: after arming, the engine reads
//    $3EBA+id; a nonzero value re-dispatches as a NEW sound id (on its own
//    priority voice). resolveSfxChain follows that.
//  - Ticks: the SFX interpreter runs off the 500 Hz timer through the ×56/256
//    accumulator → 109.375 steps/s, INDEPENDENT of music tempo. There's a
//    3-step arm delay before the first event (modeled as timeline offset 0 —
//    constant across all SFX, so omitted).
//  - Stream grammar (linear; duration is sticky). IMPORTANT: $00 terminates
//    ONLY in step-head position — the volume reads use BMI, so a $00 after a
//    duration is a VOLUME-ZERO WRITE (several shipped scripts fade a voice
//    this way), and after a stereo volume pair the head byte is consumed
//    with no checks at all (a positive byte there keys on as a note):
//      step := $00                                   (end of script)
//            | head                                  (reuse last duration)
//            | dur head                              (dur 1-$7F, head ≥ $80)
//            | dur volL head                         (mono: volL 0-$7F, head ≥ $80)
//            | dur volL volR anyByte-as-head         (stereo: 0-$7F each)
//    Volume bytes are written STRAIGHT to the voice's DSP VOL_L/VOL_R (mono
//    = same byte both sides), and `head` is:
//      $E0 idx            set SFX instrument (6-byte record at $1D97+6·idx:
//                         SRCN/ADSR1/ADSR2/GAIN + pitch multiplier — the
//                         $3E20 code block is this handler)
//      $F1 dly len note   pitch slide setup (no key-on; keeps ticking)
//      $F9 note dly len target   key-on + pitch slide (consumes duration)
//      anything else      note byte (same note space as music: $C8 tie-ish,
//                         $C9 rest — no key-on; ≥$CA percussion-style
//                         instrument switch; else key-on)
//    $E0 consumes no time and continues the same step; notes/slides end the
//    step and tick for the current duration.

import type { SongTimeline, TimedNote, TimedVcmd } from '../types.ts';

/** Fixed SFX interpreter rate (500 Hz × 56/256). */
export const SFX_TICKS_PER_SECOND = 109.375;

// ARAM homes (engine block $0EB0 layout; validated wholesale by the
// identity sweep in sfx-decode.test.ts).
export const SFX_PRIORITY_TABLE = 0x0eb0; // entry for id at $0EAF+id (1-based)
export const SFX_PTR_TABLE_LO = 0x0f7d; // ids $01-$7F
export const SFX_PTR_TABLE_HI = 0x107d; // ids $80+
export const SFX_REMAP_TABLE = 0x3eba; // chain: next sound id at $3EBA+id

export type SfxEvent =
  | { kind: 'duration'; ticks: number }
  | { kind: 'volume'; left: number; right: number; mono: boolean }
  | { kind: 'note'; note: number }
  | { kind: 'tie' }
  | { kind: 'rest' }
  | { kind: 'instrument'; index: number }
  | { kind: 'slide'; delay: number; ticks: number; note: number }
  | { kind: 'keyOnSlide'; note: number; delay: number; ticks: number; target: number };

export interface DecodedSfxScript {
  addr: number;
  events: SfxEvent[];
  /** Encoded byte length including the $00 terminator. */
  byteLength: number;
}

const MAX_SFX_EVENTS = 4096;

export function decodeSfxScript(aram: Uint8Array, addr: number): DecodedSfxScript {
  const events: SfxEvent[] = [];
  let p = addr;
  const next = (): number => aram[p++ & 0xffff];

  for (;;) {
    if (events.length > MAX_SFX_EVENTS) {
      throw new Error(`sfx script @0x${addr.toString(16)}: runaway decode`);
    }
    let b = next();
    if (b === 0) break; // $00 ends the script ONLY here (step head)

    let afterStereo = false;
    if (b < 0x80) {
      events.push({ kind: 'duration', ticks: b });
      b = next();
      if (b < 0x80) {
        // Volume-L (zero allowed — BMI, not BEQ, guards this read).
        const left = b;
        b = next();
        if (b < 0x80) {
          events.push({ kind: 'volume', left, right: b, mono: false });
          b = next(); // head — consumed unconditionally by the engine
          afterStereo = true;
        } else {
          events.push({ kind: 'volume', left, right: left, mono: true });
        }
      }
    }

    if (afterStereo && b < 0x80) {
      // Post-stereo head with bit7 clear: the engine keys it on as a note
      // (channel_note_decode gets it verbatim) — even $00 is a "note" here.
      events.push({ kind: 'note', note: b });
      continue;
    }

    if (b === 0xe0) {
      events.push({ kind: 'instrument', index: next() });
    } else if (b === 0xf1) {
      events.push({ kind: 'slide', delay: next(), ticks: next(), note: next() });
    } else if (b === 0xf9) {
      events.push({ kind: 'keyOnSlide', note: next(), delay: next(), ticks: next(), target: next() });
    } else if (b === 0xc8) {
      events.push({ kind: 'tie' });
    } else if (b === 0xc9) {
      events.push({ kind: 'rest' });
    } else {
      events.push({ kind: 'note', note: b });
    }
  }
  return { addr, events, byteLength: (p - addr) & 0xffff };
}

/** Serialize an SFX event stream, INCLUDING the $00 terminator. Enforces the
 *  positional grammar: volume only directly after a duration; a positive
 *  (< $80) note byte only directly after a STEREO volume pair (the one spot
 *  the engine reads with no sign check); a mono volume must be followed by a
 *  negative head, or it would re-parse as a stereo pair.
 *
 *  Consumed only by the byte-identity gate (sfx-decode.test.ts) until the
 *  SFX-edit milestone lands — the write half the editor will build on. */
export function encodeSfxScript(events: readonly SfxEvent[]): Uint8Array {
  const out: number[] = [];
  let afterDuration = false;
  let afterStereo = false;
  let afterMono = false;
  for (const [i, ev] of events.entries()) {
    if (afterMono && ev.kind === 'note' && ev.note < 0x80) {
      throw new Error(`event ${i}: a positive head after a mono volume would re-parse as a stereo pair`);
    }
    switch (ev.kind) {
      case 'duration':
        if (ev.ticks < 1 || ev.ticks > 0x7f) throw new Error(`event ${i}: duration ${ev.ticks} out of range`);
        out.push(ev.ticks);
        afterDuration = true;
        afterStereo = false;
        afterMono = false;
        continue;
      case 'volume': {
        if (!afterDuration) throw new Error(`event ${i}: volume must directly follow a duration`);
        if (ev.left < 0 || ev.left > 0x7f) throw new Error(`event ${i}: volL ${ev.left} out of range`);
        out.push(ev.left);
        if (!ev.mono) {
          if (ev.right < 0 || ev.right > 0x7f) throw new Error(`event ${i}: volR ${ev.right} out of range`);
          out.push(ev.right);
        } else if (ev.right !== ev.left) {
          throw new Error(`event ${i}: mono volume must have right === left`);
        }
        afterDuration = false;
        afterStereo = !ev.mono;
        afterMono = ev.mono;
        continue;
      }
      case 'instrument':
        out.push(0xe0, ev.index & 0xff);
        break;
      case 'slide':
        out.push(0xf1, ev.delay & 0xff, ev.ticks & 0xff, ev.note & 0xff);
        break;
      case 'keyOnSlide':
        out.push(0xf9, ev.note & 0xff, ev.delay & 0xff, ev.ticks & 0xff, ev.target & 0xff);
        break;
      case 'tie':
        out.push(0xc8);
        break;
      case 'rest':
        out.push(0xc9);
        break;
      case 'note':
        if (ev.note < 0x80 && !afterStereo) {
          throw new Error(`event ${i}: note 0x${ev.note.toString(16)} < 0x80 is only valid directly after a stereo volume pair`);
        }
        if (ev.note < 0 || ev.note > 0xff) throw new Error(`event ${i}: note 0x${ev.note.toString(16)} out of range`);
        if (ev.note === 0xe0 || ev.note === 0xf1 || ev.note === 0xf9 || ev.note === 0xc8 || ev.note === 0xc9) {
          throw new Error(`event ${i}: byte 0x${ev.note.toString(16)} is an opcode, not a note`);
        }
        out.push(ev.note);
        break;
    }
    afterDuration = false;
    afterStereo = false;
    afterMono = false;
  }
  out.push(0x00);
  return new Uint8Array(out);
}

export interface SfxChainEntry {
  soundId: number;
  /** Voice index 0-7 (from the priority table's high nibble). */
  voice: number;
  priority: number;
  scriptAddr: number;
}

/** Follow a sound id's remap chain: each entry owns one voice + script. */
export function resolveSfxChain(aram: Uint8Array, soundId: number): SfxChainEntry[] {
  const chain: SfxChainEntry[] = [];
  const seen = new Set<number>();
  let id = soundId;
  while (id !== 0 && !seen.has(id)) {
    seen.add(id);
    const priority = aram[SFX_PRIORITY_TABLE - 1 + id];
    const voice = (priority >> 4) & 0x0f;
    const tableBase = id >= 0x80 ? SFX_PTR_TABLE_HI : SFX_PTR_TABLE_LO;
    const off = (id * 2) & 0xff;
    const scriptAddr = aram[tableBase + off] | (aram[tableBase + off + 1] << 8);
    chain.push({ soundId: id, voice, priority, scriptAddr });
    id = aram[SFX_REMAP_TABLE + id];
  }
  return chain;
}

/** Expand a sound id (chain included) into the shared SongTimeline shape so
 *  the Sequence view renders SFX unchanged: each chained script lands on its
 *  ACTUAL assigned voice lane; fixed 109.375 ticks/s. */
export function buildSfxTimeline(aram: Uint8Array, soundId: number): SongTimeline {
  const chain = resolveSfxChain(aram, soundId);
  const voices: SongTimeline['voices'] = Array.from({ length: 8 }, () => ({
    used: false,
    notes: [],
    vcmds: []
  }));
  const warnings: string[] = [];
  let totalTicks = 0;

  for (const entry of chain) {
    if (entry.scriptAddr === 0) {
      warnings.push(`sound 0x${entry.soundId.toString(16)}: null script pointer`);
      continue;
    }
    const voice = voices[entry.voice] ?? voices[0];
    const notes: TimedNote[] = voice.notes;
    const vcmds: TimedVcmd[] = voice.vcmds;
    const script = decodeSfxScript(aram, entry.scriptAddr);
    // Chains include empty placeholder scripts (arm + immediate end) — don't
    // claim a lane for those.
    if (script.events.length > 0) voice.used = true;
    let tick = 0;
    let duration = 1;
    let lastNote: TimedNote | null = null;
    for (const ev of script.events) {
      switch (ev.kind) {
        case 'duration':
          duration = ev.ticks;
          break;
        case 'volume':
          vcmds.push({ tick, op: -1, name: 'volume', args: ev.mono ? [ev.left] : [ev.left, ev.right] });
          break;
        case 'instrument':
          vcmds.push({ tick, op: 0xe0, name: 'sfxInstrument', args: [ev.index] });
          break;
        case 'slide':
          vcmds.push({ tick, op: 0xf1, name: 'pitchSlide', args: [ev.delay, ev.ticks, ev.note] });
          tick += duration;
          lastNote = null;
          break;
        case 'keyOnSlide': {
          const n: TimedNote = { startTick: tick, ticks: duration, note: ev.note, kind: 'note' };
          notes.push(n);
          vcmds.push({ tick, op: 0xf9, name: 'keyOnSlide', args: [ev.delay, ev.ticks, ev.target] });
          lastNote = n;
          tick += duration;
          break;
        }
        case 'tie':
          if (lastNote && lastNote.startTick + lastNote.ticks === tick) lastNote.ticks += duration;
          tick += duration;
          break;
        case 'rest':
          lastNote = null;
          tick += duration;
          break;
        case 'note': {
          if (ev.note >= 0xca) {
            const n: TimedNote = { startTick: tick, ticks: duration, note: ev.note, kind: 'perc', percIndex: ev.note - 0xca };
            notes.push(n);
            lastNote = n;
          } else {
            const n: TimedNote = { startTick: tick, ticks: duration, note: ev.note, kind: 'note' };
            notes.push(n);
            lastNote = n;
          }
          tick += duration;
          break;
        }
      }
    }
    totalTicks = Math.max(totalTicks, tick);
  }

  return {
    totalTicks,
    patterns: chain
      .filter((c) => c.scriptAddr !== 0)
      .map((c) => ({ addr: c.scriptAddr, startTick: 0, ticks: totalTicks, voiceTicks: [] })),
    loop: null,
    voices,
    initialTempo: null,
    seconds: totalTicks / SFX_TICKS_PER_SECOND,
    tempoSegments: [{ tick: 0, seconds: 0, ticksPerSecond: SFX_TICKS_PER_SECOND }],
    warnings
  };
}
