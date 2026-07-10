// SFX MML codec — AMY-dialect text ⇄ SFX scripts (sfx-decode.ts events).
// One file per sound id. The language is the AMY letter dialect restricted
// to what the SFX interpreter has (notes/octaves, =N tick durations, ^ tie,
// r rest, @N instrument, & key-on slide, raw $XX passthrough) plus file
// directives (#sfx / #priority / #chain) in place of song structure. Two
// context readings differ from music MML by hardware necessity:
//  - `v L[,R]` writes the DSP voice volume DIRECTLY (0-127 per side; music's
//    v is a 0-255 channel volume through the squared volume curve);
//  - durations are raw ticks at the fixed 109.375/s SFX rate (`=N`) — there
//    is no tempo.
//
// Byte-exactness contract (pinned by sfx-mml.test.ts over every shipped
// script): format → parse → encodeSfxScript reproduces the original bytes.
// The stream's OPTIONAL sticky-duration byte maps to the presence of an
// explicit `=N` suffix on the head token — a bare head token means "no
// duration byte" (reuse), never "default length". Because a volume byte is
// only legal directly after a duration byte, a `v` requires the following
// head to carry `=N`. `@12=6` reads oddly but is faithful: that step's bytes
// are `06 E0 0C` (duration, then instrument-set as the step head).

import {
  encodeSfxScript,
  type SfxEvent,
} from './sfx-decode.ts';

export interface SfxMmlMeta {
  soundId: number;
  /** Full priority byte (high nibble = voice 1-7, low = contention rank). */
  priority: number;
  /** Follow-up sound id armed alongside (multi-voice chain); 0 = none. */
  chain: number;
  /** Display name for the header comment. */
  name?: string;
  /** Other sound ids that share this script's bytes (header comment). */
  sharedWith?: number[];
}

export interface ParsedSfxMml {
  soundId: number;
  /** null = directive absent (keep the existing table byte). */
  priority: number | null;
  /** null = directive absent; 0 = explicitly no chain. */
  chain: number | null;
  events: SfxEvent[];
}

export class SfxMmlError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

const NOTE_NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'] as const;
const NOTE_SEMITONES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const hex2 = (n: number): string => '$' + n.toString(16).toUpperCase().padStart(2, '0');

// ── formatter ────────────────────────────────────────────────────────────────

/** Note byte $80-$C7 → letter token, managing sticky octave state. */
function noteToken(note: number, state: { octave: number }, out: string[]): string {
  const n = note - 0x80;
  const octave = Math.floor(n / 12) + 1;
  if (octave !== state.octave) {
    out.push(`o${octave}`);
    state.octave = octave;
  }
  return NOTE_NAMES[n % 12];
}

/** Render decoded SFX events as an MML file body + directives. */
export function formatSfxMml(events: readonly SfxEvent[], meta: SfxMmlMeta): string {
  const head: string[] = [];
  const voice = (meta.priority >> 4) & 0x0f;
  head.push(`; SFX ${hex2(meta.soundId)}${meta.name ? ` — ${meta.name}` : ''}`);
  head.push(`; voice ${voice}, priority ${hex2(meta.priority)} (high nibble = voice, low = contention rank)`);
  head.push('; durations are =N ticks at the fixed SFX rate (109.375/s); v L[,R] writes');
  head.push('; the DSP voice volume directly (0-127). Drop edited files in audio/import/.');
  if (meta.sharedWith && meta.sharedWith.length > 0) {
    head.push(`; shares its script bytes with ${meta.sharedWith.map(hex2).join(', ')} — an edit here forks them`);
  }
  head.push(`#sfx ${hex2(meta.soundId)}`);
  head.push(`#priority ${hex2(meta.priority)}`);
  if (meta.chain !== 0) head.push(`#chain ${hex2(meta.chain)}`);

  const tokens: string[] = [];
  const state = { octave: 4 };
  let pendingDur: number | null = null;
  const dur = (): string => (pendingDur !== null ? `=${pendingDur}` : '');
  const takeDur = (tok: string): string => {
    const t = tok + dur();
    pendingDur = null;
    return t;
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'duration':
        pendingDur = ev.ticks;
        break;
      case 'volume':
        // Volume bytes sit between the duration and the head — render the v
        // token first; its `=N` rides the head token that follows.
        tokens.push(ev.mono ? `v${ev.left}` : `v${ev.left},${ev.right}`);
        break;
      case 'note':
        if (ev.note >= 0x80 && ev.note <= 0xc7) tokens.push(takeDur(noteToken(ev.note, state, tokens)));
        else tokens.push(takeDur(hex2(ev.note))); // perc-style / post-stereo positive head
        break;
      case 'tie':
        tokens.push(takeDur('^'));
        break;
      case 'rest':
        tokens.push(takeDur('r'));
        break;
      case 'instrument':
        tokens.push(takeDur(`@${ev.index}`));
        break;
      case 'keyOnSlide': {
        const note =
          ev.note >= 0x80 && ev.note <= 0xc7 ? noteToken(ev.note, state, tokens) : hex2(ev.note);
        tokens.push(`${note}${dur()}&${hex2(ev.target)},${ev.delay},${ev.ticks}`);
        pendingDur = null;
        break;
      }
      case 'slide':
        // No letter form — raw passthrough, like AMY's hex escape.
        tokens.push(takeDur('$F1'), hex2(ev.delay), hex2(ev.ticks), hex2(ev.note));
        break;
    }
  }
  if (pendingDur !== null) tokens.push(`=${pendingDur}`); // trailing duration byte (unused-but-present)

  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i += 16) lines.push(tokens.slice(i, i + 16).join(' '));
  return `${head.join('\n')}\n\n${lines.join('\n')}\n`;
}

// ── parser ───────────────────────────────────────────────────────────────────

class Parser {
  readonly src: string;
  pos = 0;
  line = 1;
  octave = 4;
  events: SfxEvent[] = [];
  soundId: number | null = null;
  priority: number | null = null;
  chain: number | null = null;
  /** v awaiting its head (must carry =N — volume bytes require a duration). */
  pendingVolume: { left: number; right: number; mono: boolean } | null = null;

  constructor(src: string) {
    this.src = src;
  }

  fail(message: string): never {
    throw new SfxMmlError(message, this.line);
  }

  peek(): string {
    return this.src[this.pos] ?? '';
  }

  next(): string {
    const c = this.src[this.pos++] ?? '';
    if (c === '\n') this.line++;
    return c;
  }

  skipSpace(): void {
    for (;;) {
      const c = this.peek();
      if (c === ';') {
        while (this.pos < this.src.length && this.peek() !== '\n') this.next();
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.next();
      } else {
        return;
      }
    }
  }

  /** Number literal: $XX, 0xXX, or decimal. */
  readNumber(what: string): number {
    this.skipSpace();
    let s = '';
    if (this.peek() === '$' || (this.peek() === '0' && this.src[this.pos + 1]?.toLowerCase() === 'x')) {
      this.next();
      if (this.peek().toLowerCase() === 'x') this.next();
      while (/[0-9a-f]/i.test(this.peek())) s += this.next();
      if (s === '') this.fail(`expected hex digits for ${what}`);
      return parseInt(s, 16);
    }
    while (/[0-9]/.test(this.peek())) s += this.next();
    if (s === '') this.fail(`expected a number for ${what}`);
    return parseInt(s, 10);
  }

  /** Optional `=N` duration suffix → emits the duration event. */
  readDurationSuffix(): boolean {
    if (this.peek() !== '=') return false;
    this.next();
    const t = this.readNumber('tick count');
    if (t < 1 || t > 0x7f) this.fail(`duration ${t} out of range 1-127`);
    this.events.push({ kind: 'duration', ticks: t });
    return true;
  }

  /** Flush the pending v between the head's duration and the head itself. */
  flushVolume(hadDuration: boolean, headWhat: string): void {
    if (this.pendingVolume === null) return;
    if (!hadDuration) {
      this.fail(`v needs an explicit =N duration on the ${headWhat} that follows (volume bytes ride a duration byte)`);
    }
    this.events.push({ kind: 'volume', ...this.pendingVolume });
    this.pendingVolume = null;
  }

  /** Note letter body after the letter char: accidental + octave state. */
  readNoteByte(letter: string): number {
    let semi = NOTE_SEMITONES[letter];
    if (this.peek() === '+') {
      this.next();
      semi++;
    } else if (this.peek() === '-') {
      this.next();
      semi--;
    }
    const note = 0x80 + (this.octave - 1) * 12 + semi;
    if (note < 0x80 || note > 0xc7) this.fail(`note out of the driver's range (o1c-o6b)`);
    return note;
  }

  /** `&target,delay,ticks` suffix → keyOnSlide (replaces the plain note). */
  readSlideSuffix(note: number): boolean {
    if (this.peek() !== '&') return false;
    this.next();
    this.skipSpace();
    let target: number;
    const c = this.peek().toLowerCase();
    if (c === '$' || /[0-9]/.test(c)) {
      target = this.readNumber('slide target');
    } else if (c in NOTE_SEMITONES) {
      this.next();
      target = this.readNoteByte(c);
    } else {
      this.fail("expected a note or $XX after '&'");
    }
    this.skipSpace();
    if (this.peek() !== ',') this.fail("'&' slide needs ',delay,ticks'");
    this.next();
    const delay = this.readNumber('slide delay');
    this.skipSpace();
    if (this.peek() !== ',') this.fail("'&' slide needs a ticks value after the delay");
    this.next();
    const ticks = this.readNumber('slide ticks');
    this.events.push({ kind: 'keyOnSlide', note, delay, ticks, target });
    return true;
  }

  parseDirective(): void {
    let word = '';
    while (/[a-z]/i.test(this.peek())) word += this.next();
    const w = word.toLowerCase();
    if (w === 'sfx') this.soundId = this.readNumber('#sfx sound id');
    else if (w === 'priority') this.priority = this.readNumber('#priority byte') & 0xff;
    else if (w === 'chain') this.chain = this.readNumber('#chain sound id') & 0xff;
    else this.fail(`unknown directive #${word}`);
  }

  run(): ParsedSfxMml {
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.src.length) break;
      const c = this.next();
      const lc = c.toLowerCase();

      if (c === '#') {
        this.parseDirective();
      } else if (lc === 'o') {
        const n = this.readNumber('octave');
        if (n < 1 || n > 6) this.fail(`octave ${n} out of range 1-6`);
        this.octave = n;
      } else if (c === '<') {
        if (this.octave <= 1) this.fail('octave below o1');
        this.octave--;
      } else if (c === '>') {
        if (this.octave >= 6) this.fail('octave above o6');
        this.octave++;
      } else if (lc === 'v') {
        if (this.pendingVolume !== null) this.fail('two v commands with no note between them');
        const left = this.readNumber('volume');
        if (left > 0x7f) this.fail(`volume ${left} out of range 0-127 (SFX volume writes the DSP directly)`);
        this.skipSpace();
        if (this.peek() === ',') {
          this.next();
          const right = this.readNumber('right volume');
          if (right > 0x7f) this.fail(`volume ${right} out of range 0-127`);
          this.pendingVolume = { left, right, mono: false };
        } else {
          this.pendingVolume = { left, right: left, mono: true };
        }
      } else if (lc in NOTE_SEMITONES) {
        const note = this.readNoteByte(lc);
        const hadDur = this.readDurationSuffix();
        this.flushVolume(hadDur, 'note');
        if (!this.readSlideSuffix(note)) this.events.push({ kind: 'note', note });
      } else if (c === '^') {
        const hadDur = this.readDurationSuffix();
        this.flushVolume(hadDur, 'tie');
        this.events.push({ kind: 'tie' });
      } else if (lc === 'r') {
        const hadDur = this.readDurationSuffix();
        this.flushVolume(hadDur, 'rest');
        this.events.push({ kind: 'rest' });
      } else if (c === '@') {
        // Range-check only the byte: shipped scripts index past the nominal
        // 32-record table (e.g. @32) — the engine's table is the truth.
        const index = this.readNumber('instrument index');
        if (index > 0xff) this.fail(`@${index}: instrument index out of byte range`);
        const hadDur = this.readDurationSuffix();
        this.flushVolume(hadDur, 'instrument');
        this.events.push({ kind: 'instrument', index });
      } else if (c === '=') {
        // Standalone trailing duration byte (present in a few shipped
        // scripts right before the terminator).
        this.pos--; // rewind to reuse the suffix reader
        this.readDurationSuffix();
      } else if (c === '$') {
        this.pos--; // readNumber consumes the '$'
        this.parseRawHead();
      } else {
        this.fail(`unexpected '${c}'`);
      }
    }
    if (this.pendingVolume !== null) this.fail('v at end of file with no note to carry it');
    if (this.soundId === null) this.fail('missing #sfx directive (which sound id this file edits)');
    return { soundId: this.soundId, priority: this.priority, chain: this.chain, events: this.events };
  }

  /** `$XX[=N]` raw head: opcode forms consume their $-arg tokens; anything
   *  else is a note byte (perc-style switch, or the post-stereo positive
   *  head). The `=N` rides the head token because the duration byte
   *  precedes the head in the step's byte order. */
  parseRawHead(): void {
    const b = this.readNumber('raw byte');
    const hadDur = this.readDurationSuffix();
    this.flushVolume(hadDur, 'raw byte');
    if (b === 0xe0) {
      this.events.push({ kind: 'instrument', index: this.readNumber('$E0 instrument index') & 0xff });
    } else if (b === 0xf1) {
      this.events.push({
        kind: 'slide',
        delay: this.readNumber('$F1 delay') & 0xff,
        ticks: this.readNumber('$F1 ticks') & 0xff,
        note: this.readNumber('$F1 note') & 0xff,
      });
    } else if (b === 0xf9) {
      this.events.push({
        kind: 'keyOnSlide',
        note: this.readNumber('$F9 note') & 0xff,
        delay: this.readNumber('$F9 delay') & 0xff,
        ticks: this.readNumber('$F9 ticks') & 0xff,
        target: this.readNumber('$F9 target') & 0xff,
      });
    } else if (b === 0xc8) {
      this.events.push({ kind: 'tie' });
    } else if (b === 0xc9) {
      this.events.push({ kind: 'rest' });
    } else if (b === 0x00) {
      this.fail('$00 is the script terminator — end the file instead');
    } else if (!this.readSlideSuffix(b)) {
      this.events.push({ kind: 'note', note: b });
    }
  }
}

/** Parse an SFX MML file. Grammar errors carry line numbers; byte-level
 *  validity (positional volume rules etc.) is enforced by encodeSfxScript —
 *  call it on the result to validate fully. */
export function parseSfxMml(text: string): ParsedSfxMml {
  return new Parser(text.replace(/^﻿/, '').replace(/\r\n/g, '\n')).run();
}

/** Convenience: parse + encode (full validation). */
export function compileSfxMml(text: string): ParsedSfxMml & { bytes: Uint8Array } {
  const parsed = parseSfxMml(text);
  return { ...parsed, bytes: encodeSfxScript(parsed.events) };
}
