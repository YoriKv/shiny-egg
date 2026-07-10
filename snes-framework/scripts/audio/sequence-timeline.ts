// Song timeline expansion — turns a DecodedSong (structural: patterns →
// track byte streams) into per-voice TIMED events for the sequence
// inspector: absolute tick positions, note durations (ties extend their
// note), subroutines inlined with engine-accurate single-return-slot
// semantics, pattern spans, and the song's loop point.
//
// Engine timing facts this encodes (verified in sequence.ts's handler map):
//  - A `length` event sets the running duration; notes/percussion/rests
//    advance time by it. Ties extend the previous note instead of re-keying.
//  - All 8 voices resync at pattern boundaries, and the FIRST voice to hit
//    its terminator advances the whole song — the pattern's span is the
//    MINIMUM voice length. Several shipped songs (Bowser, Luigi's Rescue,
//    the Ending medley) exploit this deliberately: voices 2-8 are windows
//    into one long continuous stream (each pattern pointing further into
//    it) with voice 1 as a short "conductor" track that cuts the pattern —
//    so expansion CLAMPS every voice's events to the pattern span, exactly
//    like the engine's mid-stream repoint. (Editors must preserve the
//    conductor-voice length as the pattern clock.)
//  - Subroutines ($EF) have ONE return slot and ONE repeat counter per
//    voice ($0230/$80+x): a nested call inside a subroutine overwrites the
//    return point (the engine never comes back to the outer caller). The
//    walker reproduces exactly that, warning when shipped data exercises it.
//  - Ticks → seconds: 500 Hz × tempo/256 (see ticksPerSecond); tempo changes
//    mid-song via vcmd $E7, driver boot default is $10.

import { ticksPerSecond, type DecodedSong, type TrackEvent } from './sequence.ts';
import type {
  PatternSpan,
  SongTimeline,
  TimedNote,
  TimedVcmd,
  VoiceTimeline
} from '../types.ts';

// The timeline SHAPES live on the Node-free types island
// (scripts/types.ts) so the renderer can type the audio:decodeSong envelope
// without compiling this Node-flavored module; re-exported here for
// framework-side consumers.
export type { PatternSpan, SongTimeline, TimedNote, TimedVcmd, VoiceTimeline };

const DRIVER_DEFAULT_TEMPO = 0x10;

/** Walk one voice's stream for one pattern, inlining subroutines with the
 *  engine's single-slot semantics. Returns the voice-local tick length. */
function expandVoice(
  song: DecodedSong,
  trackAddr: number,
  startTick: number,
  voice: VoiceTimeline,
  warnings: string[]
): number {
  const track = song.tracks.get(trackAddr);
  if (!track) {
    warnings.push(`pattern track @0x${trackAddr.toString(16)} missing from decode`);
    return 0;
  }
  let events: readonly TrackEvent[] = track.events;
  let i = 0;
  // Single return slot + repeat counter, exactly like $0230/$80+x.
  let ret: { events: readonly TrackEvent[]; index: number } | null = null;
  let repeat = 0;
  let subEvents: readonly TrackEvent[] | null = null;

  let tick = startTick;
  let curTicks = 0;
  let curGate: number | undefined;
  let curVelocity: number | undefined;
  let lastNote: TimedNote | null = null;
  let guard = 0;

  for (;;) {
    if (++guard > 100000) {
      warnings.push(`voice stream @0x${trackAddr.toString(16)}: runaway expansion aborted`);
      break;
    }
    if (i >= events.length) {
      // End of a stream body ($00 in the bytes). Subroutine return/repeat.
      if (subEvents && repeat > 1) {
        repeat--;
        events = subEvents;
        i = 0;
        continue;
      }
      if (subEvents && ret) {
        events = ret.events;
        i = ret.index;
        ret = null;
        subEvents = null;
        continue;
      }
      break; // top-level terminator: pattern done for this voice
    }
    const ev = events[i++];
    switch (ev.kind) {
      case 'length':
        curTicks = ev.ticks;
        curGate = ev.gate;
        curVelocity = ev.velocity;
        break;
      case 'note':
      case 'perc': {
        const note: TimedNote = {
          startTick: tick,
          ticks: curTicks,
          note: ev.kind === 'note' ? ev.note : 0xca + ev.index,
          kind: ev.kind === 'note' ? 'note' : 'perc',
          ...(ev.kind === 'perc' ? { percIndex: ev.index } : {}),
          ...(curGate !== undefined ? { gate: curGate } : {}),
          ...(curVelocity !== undefined ? { velocity: curVelocity } : {})
        };
        voice.notes.push(note);
        lastNote = note;
        tick += curTicks;
        break;
      }
      case 'tie':
        if (lastNote && lastNote.startTick + lastNote.ticks === tick) {
          lastNote.ticks += curTicks;
        }
        tick += curTicks;
        break;
      case 'rest':
        lastNote = null;
        tick += curTicks;
        break;
      case 'vcmd': {
        voice.vcmds.push({ tick, op: ev.op, name: ev.name, args: [...ev.args] });
        if (ev.op === 0xef) {
          const target = ev.args[0] | (ev.args[1] << 8);
          const sub = song.tracks.get(target);
          if (!sub) {
            warnings.push(`subroutine @0x${target.toString(16)} missing from decode`);
            break;
          }
          if (subEvents) {
            warnings.push(
              `nested subroutine call @tick ${tick} — engine's single return slot means the outer caller is never resumed`
            );
          } else {
            ret = { events, index: i };
          }
          repeat = Math.max(1, ev.args[2]);
          subEvents = sub.events;
          events = sub.events;
          i = 0;
        }
        break;
      }
    }
  }
  return tick - startTick;
}

export function buildSongTimeline(song: DecodedSong): SongTimeline {
  const warnings: string[] = [];
  const voices: VoiceTimeline[] = Array.from({ length: 8 }, () => ({
    used: false,
    notes: [],
    vcmds: []
  }));
  const patterns: PatternSpan[] = [];
  let loop: SongTimeline['loop'] = null;
  let tick = 0;

  for (const [partIndex, part] of song.parts.entries()) {
    if (part.kind === 'end') break;
    if (part.kind === 'loop') {
      // Loop target points back into the part-list words.
      const rel = part.target - song.songAddr;
      const targetPartIndex = rel >= 0 && rel % 2 === 0 ? rel / 2 : -1;
      if (targetPartIndex < 0 || targetPartIndex > partIndex) {
        warnings.push(`loop target 0x${part.target.toString(16)} is not a preceding part`);
      }
      loop = { targetPartIndex: Math.max(0, targetPartIndex), count: part.count };
      continue;
    }
    const pattern = song.patterns.get(part.addr);
    if (!pattern) {
      warnings.push(`pattern @0x${part.addr.toString(16)} missing from decode`);
      continue;
    }
    const voiceTicks: number[] = new Array(8).fill(0);
    // Remember each voice's event counts so the post-span clamp below can
    // trim exactly what this pattern added.
    const marks = voices.map((v) => ({ notes: v.notes.length, vcmds: v.vcmds.length }));
    for (let v = 0; v < 8; v++) {
      const trackAddr = pattern.trackAddrs[v];
      if (trackAddr === 0) continue;
      voices[v].used = true;
      voiceTicks[v] = expandVoice(song, trackAddr, tick, voices[v], warnings);
    }
    // Span = the engine's cut point: the shortest stream among voices that
    // HAVE a track this pattern. Zero-length streams are real (vcmd-only
    // "conductor" patterns — e.g. a lone tempo change that immediately
    // advances the song); their vcmds still execute, so a zero span keeps
    // boundary-tick vcmds.
    const tracked = voiceTicks.filter((_, v) => pattern.trackAddrs[v] !== 0);
    const span = tracked.length ? Math.min(...tracked) : 0;
    if (!tracked.length) {
      warnings.push(`pattern @0x${part.addr.toString(16)}: no voice has a track`);
    }
    const end = tick + span;
    for (let v = 0; v < 8; v++) {
      const voice = voices[v];
      voice.notes.splice(
        marks[v].notes,
        voice.notes.length - marks[v].notes,
        ...voice.notes.slice(marks[v].notes).filter((n) => n.startTick < end)
      );
      for (let i = marks[v].notes; i < voice.notes.length; i++) {
        const n = voice.notes[i];
        if (n.startTick + n.ticks > end) n.ticks = end - n.startTick;
      }
      voice.vcmds.splice(
        marks[v].vcmds,
        voice.vcmds.length - marks[v].vcmds,
        ...voice.vcmds
          .slice(marks[v].vcmds)
          .filter((c) => c.tick < end || (span === 0 && c.tick === end))
      );
    }
    patterns.push({ addr: part.addr, startTick: tick, ticks: span, voiceTicks });
    tick += span;
  }

  const firstTempo = voices
    .flatMap((v) => v.vcmds)
    .filter((c) => c.op === 0xe7)
    .sort((a, b) => a.tick - b.tick)[0];
  const initialTempo = firstTempo ? firstTempo.args[0] : null;

  // Integrate tempo changes into seconds + a piecewise tick↔seconds map
  // (the playhead inverts it).
  const tempoChanges = voices
    .flatMap((v) => v.vcmds)
    .filter((c) => c.op === 0xe7)
    .sort((a, b) => a.tick - b.tick);
  const tempoSegments: SongTimeline['tempoSegments'] = [];
  let seconds = 0;
  let cursor = 0;
  let tempo = initialTempo ?? DRIVER_DEFAULT_TEMPO;
  tempoSegments.push({ tick: 0, seconds: 0, ticksPerSecond: ticksPerSecond(tempo) });
  for (const change of tempoChanges) {
    const t = Math.min(change.tick, tick);
    if (t > cursor) seconds += (t - cursor) / ticksPerSecond(tempo);
    cursor = t;
    if (change.args[0] !== tempo) {
      tempo = change.args[0];
      tempoSegments.push({ tick: cursor, seconds, ticksPerSecond: ticksPerSecond(tempo) });
    }
  }
  if (tick > cursor) seconds += (tick - cursor) / ticksPerSecond(tempo);

  return { totalTicks: tick, patterns, loop, voices, initialTempo, seconds, tempoSegments, warnings };
}
