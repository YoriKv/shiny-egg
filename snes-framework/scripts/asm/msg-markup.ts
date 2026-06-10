// Message-text markup codec — converts the YI message byte stream (Bank51
// `;@editable:message-box-text`) to/from an editable markup string and back.
//
// A message interleaves three token kinds (see the font legend at the top of
// Bank51.asm + research notes):
//   • printable glyphs   — one byte, rendered through MSG_FONT. Typeable chars
//     come from the font table (Main.txt); the "unmapped" special glyphs (button
//     icons, arrows, accents, star/switch/d-pad/yoshi) have no Main.txt key and
//     are surfaced as NAMED markup tokens here so they're insertable.
//   • control words      — a 16-bit `$XXFF` (low byte $FF = escape, high byte =
//     command): line positioning, line break, scroll, input-wait, inline graphic.
//   • `$FFFF`            — end-of-message terminator.
//
// Markup syntax: plain text + `[token]`. Named tokens for glyphs (`[B]`, `[star]`)
// and control codes (`[br]`, `[scroll]`, `[gfx 00 00 00 80 30 00 10]`), with a
// `[$XX]` / `[$XXFF]` raw-hex fallback for anything unnamed. Cosmetic newlines are
// inserted before line-break tokens for readability and ignored on encode.
//
// Repeat sugar: a run of one token collapses to `[token_N]` — e.g. eight
// `[scroll]`s ↔ `[scroll_8]`. The decoder emits the compact form; the encoder
// expands it. Works for any space-free token (named or `[$XX]`), not the
// param'd `[gfx ...]`.

// FontTable's home is types.ts (Node/DOM-free), so importing it here doesn't
// drag the node:fs-backed font-table loader into renderer bundles that use this
// codec (e.g. markupByteSize for the live byte budget).
import type { FontTable } from '../types.ts';

/** Upper bound on bytes scanned per message (guards against a missing terminator). */
export const MAX_MESSAGE_BYTES = 0x1000;

export interface GlyphDef {
  /** Canonical markup token, e.g. `B`, `star`, `up`. */
  token: string;
  /** The one-or-more font bytes this glyph encodes to. */
  bytes: number[];
  /** Human description for the editor's glyph guide. */
  label: string;
}

export interface ControlDef {
  token: string;
  /** The control command (high byte of the `$XXFF` word). */
  cmd: number;
  label: string;
  /** Trailing raw param bytes the command consumes (e.g. inline graphic = 7). */
  params?: number;
  /** A line-positioning code — the UI gets a cosmetic newline before it. */
  lineStart?: boolean;
}

// Glyph + control-code tables transcribed from the authoritative Bank51 legend
// (`yi/SuperFX/Banks/Bank51.asm` header comment) cross-checked against
// `yi-shiny/docs/mchip.md` §3.18. Every byte assignment below is verified against
// that legend.
//
// Deliberately NOT named (left to the `[$XX]` hex form): the accented letters
// ($00-$16, $40-$4B) and the small-font duplicates of normal characters
// ($37 comma, $38-$3E e/i/t/r/h/f/n, $3F "period?", $C8 comma, $D3 dot, $D7 x).
// Those alt-font glyphs collide in meaning with the normally-typed character (a
// literal `.` encodes to a *different* byte than the small-font $3F), so naming
// them would mislead; they still round-trip byte-exact via `[$XX]`.

/** Special (unmapped-in-Main.txt) font glyphs. Multi-byte first so the decoder
 *  matches the longest sequence. */
export const SPECIAL_GLYPHS: GlyphDef[] = [
  { token: 'A', bytes: [0x18, 0x19], label: 'A button' },
  { token: 'B', bytes: [0x1a, 0x1b], label: 'B button' },
  { token: 'Y', bytes: [0x1c, 0x1d], label: 'Y button' },
  { token: 'X', bytes: [0x1e, 0x1f], label: 'X button' },
  { token: 'Select', bytes: [0x20, 0x21, 0x22], label: 'Select button' },
  { token: 'L', bytes: [0x23, 0x24, 0x25], label: 'L button' },
  { token: 'R', bytes: [0x28, 0x29, 0x2a], label: 'R button' },
  { token: 'Start', bytes: [0x31, 0x32, 0x33], label: 'Start button' },
  { token: 'cloudarrow', bytes: [0x34, 0x35], label: 'cloud arrow' },
  { token: 'dpad', bytes: [0xca, 0xcb], label: 'D-pad' },
  { token: 'yoshi', bytes: [0xd5, 0xd6], label: 'mini Yoshi' },
  { token: 'qcloud', bytes: [0xf4, 0xf5], label: '"?" cloud' },
  { token: 'star', bytes: [0xf6, 0xf7], label: 'star' },
  { token: 'switch', bytes: [0xf8, 0xf9], label: '"!" switch' },
  { token: 'upoutline', bytes: [0x2c], label: 'up arrow (outline)' },
  { token: 'left', bytes: [0x2d], label: 'left arrow' },
  { token: 'right', bytes: [0x2e], label: 'right arrow' },
  { token: 'up', bytes: [0x2f], label: 'up arrow' },
  { token: 'down', bytes: [0x30], label: 'down arrow' },
  { token: 'down2', bytes: [0xfa], label: 'down arrow (alt)' },
  { token: 'cursorr', bytes: [0xd4], label: 'right cursor' },
  { token: 'cursorl', bytes: [0xf2], label: 'left cursor' },
  { token: 'lquote', bytes: [0xd1], label: 'left curly quote' },
  { token: 'rquote', bytes: [0xd2], label: 'right curly quote / apostrophe' }
];

/** Message control codes (`$XXFF` words — low byte $FF, high byte = command).
 *  Full table per mchip §3.18; existing token names preserved. Only `gfx` consumes
 *  trailing param bytes. Codes mchip marks unused/null ($15-$2F, $3C, $40-$4F,
 *  $53-$5F, $61-$FE) are intentionally omitted → they fall through to `[$XXFF]`.
 *  The font-size sub-split (both / Y-only / X-only × size 0-3) follows mchip's
 *  stated ordering and is best-effort; the byte↔command mapping itself is exact. */
export const CONTROL_CODES: ControlDef[] = [
  { token: 'clear', cmd: 0x00, label: 'clear window' },
  { token: 'clear1', cmd: 0x01, label: 'clear line 1' },
  { token: 'clear2', cmd: 0x02, label: 'clear line 2' },
  { token: 'clear3', cmd: 0x03, label: 'clear line 3' },
  { token: 'clear4', cmd: 0x04, label: 'clear line 4' },
  { token: 'row1', cmd: 0x05, label: 'set line 1', lineStart: true },
  { token: 'row2', cmd: 0x06, label: 'set line 2', lineStart: true },
  { token: 'row3', cmd: 0x07, label: 'set line 3', lineStart: true },
  { token: 'row4', cmd: 0x08, label: 'set line 4', lineStart: true },
  { token: 'nl', cmd: 0x09, label: 'newline', lineStart: true },
  { token: 'wait', cmd: 0x0a, label: 'input checkpoint (blip)' },
  { token: 'fadein', cmd: 0x0b, label: 'fade in (disabled in retail)' },
  { token: 'fadeout', cmd: 0x0c, label: 'fade out (disabled in retail)' },
  { token: 'br2', cmd: 0x0d, label: 'line break', lineStart: true },
  { token: 'br', cmd: 0x0e, label: 'line break (scroll-in)', lineStart: true },
  { token: 'pause', cmd: 0x0f, label: 'page-end pause' },
  { token: 'hscroll', cmd: 0x10, label: 'hard scroll up 1 line' },
  { token: 'scroll1', cmd: 0x11, label: 'scroll up 1px' },
  { token: 'scroll', cmd: 0x12, label: 'scroll up 2px' },
  { token: 'scroll3', cmd: 0x13, label: 'scroll up 3px' },
  { token: 'scroll4', cmd: 0x14, label: 'scroll up 4px' },
  { token: 'font0', cmd: 0x30, label: 'font size 0 (both axes)' },
  { token: 'font1', cmd: 0x31, label: 'font size 1 (both axes)' },
  { token: 'font2', cmd: 0x32, label: 'font size 2 (both axes)' },
  { token: 'font3', cmd: 0x33, label: 'font size 3 (both axes)' },
  { token: 'fonty0', cmd: 0x34, label: 'font Y-size 0' },
  { token: 'fonty1', cmd: 0x35, label: 'font Y-size 1' },
  { token: 'fonty2', cmd: 0x36, label: 'font Y-size 2' },
  { token: 'fonty3', cmd: 0x37, label: 'font Y-size 3' },
  { token: 'fontx0', cmd: 0x38, label: 'font X-size 0' },
  { token: 'fontx1', cmd: 0x39, label: 'font X-size 1' },
  { token: 'fontx2', cmd: 0x3a, label: 'font X-size 2' },
  { token: 'fontx3', cmd: 0x3b, label: 'font X-size 3' },
  { token: 'num0', cmd: 0x3d, label: 'print counter digit' },
  { token: 'num1', cmd: 0x3e, label: 'print counter digit' },
  { token: 'num2', cmd: 0x3f, label: 'print counter digit' },
  { token: 'prompt', cmd: 0x50, label: 'Yes/No prompt' },
  { token: 'prompt1', cmd: 0x51, label: 'Yes/No prompt' },
  { token: 'prompt2', cmd: 0x52, label: 'Yes/No prompt (+toggle A/B)' },
  { token: 'gfx', cmd: 0x60, label: 'inline graphic (7 params)', params: 7 }
];

const GLYPHS_BY_LEN = [...SPECIAL_GLYPHS].sort((a, b) => b.bytes.length - a.bytes.length);
const GLYPH_BY_TOKEN = new Map(SPECIAL_GLYPHS.map((g) => [g.token.toLowerCase(), g]));
const CONTROL_BY_CMD = new Map(CONTROL_CODES.map((c) => [c.cmd, c]));
const CONTROL_BY_TOKEN = new Map(CONTROL_CODES.map((c) => [c.token.toLowerCase(), c]));

const hex2 = (n: number): string => (n & 0xff).toString(16).padStart(2, '0');

function matchGlyph(bytes: Uint8Array | number[], p: number, cap: number): GlyphDef | null {
  for (const g of GLYPHS_BY_LEN) {
    if (p + g.bytes.length > cap) continue;
    let ok = true;
    for (let i = 0; i < g.bytes.length; i++) {
      if (bytes[p + i] !== g.bytes[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return g;
  }
  return null;
}

export interface DecodedMessage {
  markup: string;
  /** Bytes consumed incl. the `$FFFF` terminator. */
  bytesConsumed: number;
  /** True when a `$FFFF` terminator was reached within bounds (a sane message). */
  ok: boolean;
}

/** A space-free bracket token (named like `[scroll]` or hex like `[$3f]`) — i.e.
 *  anything but the param'd `[gfx ...]`, a plain char, or a cosmetic `\n`. */
const SIMPLE_TOKEN_RE = /^\[[^\]\s]+\]$/;

/** Collapse runs of an identical simple token into the `[token_N]` repeat form
 *  (e.g. eight `[scroll]`s → `[scroll_8]`). Param'd tokens, characters, and
 *  cosmetic newlines pass through untouched. */
function collapseRuns(pieces: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < pieces.length) {
    const piece = pieces[i];
    if (SIMPLE_TOKEN_RE.test(piece)) {
      let n = 1;
      while (i + n < pieces.length && pieces[i + n] === piece) n++;
      out.push(n >= 2 ? `[${piece.slice(1, -1)}_${n}]` : piece);
      i += n;
    } else {
      out.push(piece);
      i++;
    }
  }
  return out;
}

/**
 * Decode a message byte stream at `start` into editable markup. Stops at the
 * `$FFFF` terminator. `fontMap` is the byte→char map (Main.txt); bytes that are
 * neither a font char, a known special glyph, nor a control code become `[$XX]`.
 */
export function decodeMessageBytes(
  bytes: Uint8Array | number[],
  start: number,
  fontMap: Map<number, string>
): DecodedMessage {
  const out: string[] = [];
  let p = start;
  const cap = Math.min(bytes.length, start + MAX_MESSAGE_BYTES);
  let ok = false;
  while (p + 1 < cap) {
    const b = bytes[p];
    if (b === 0xff) {
      const cmd = bytes[p + 1];
      if (cmd === 0xff) {
        ok = true;
        p += 2;
        break; // $FFFF terminator
      }
      p += 2;
      const ctrl = CONTROL_BY_CMD.get(cmd);
      if (!ctrl) {
        out.push(`[$${hex2(cmd)}ff]`); // unknown control word
        continue;
      }
      if (ctrl.params) {
        const ps: string[] = [];
        for (let i = 0; i < ctrl.params; i++) ps.push(hex2(bytes[p + i] ?? 0));
        p += ctrl.params;
        out.push(`[${ctrl.token} ${ps.join(' ')}]`);
      } else if (ctrl.lineStart) {
        if (out.length) out.push('\n'); // cosmetic break before a new line
        out.push(`[${ctrl.token}]`);
      } else {
        out.push(`[${ctrl.token}]`);
      }
      continue;
    }
    const g = matchGlyph(bytes, p, cap);
    if (g) {
      out.push(`[${g.token}]`);
      p += g.bytes.length;
      continue;
    }
    const ch = fontMap.get(b);
    out.push(ch !== undefined ? ch : `[$${hex2(b)}]`);
    p += 1;
  }
  return { markup: collapseRuns(out).join(''), bytesConsumed: p - start, ok };
}

export interface EncodeResult {
  bytes: number[];
  error?: string;
}

function encodeToken(tok: string): EncodeResult {
  // Repeat sugar `name_N` / `$XX_N`: the base token's bytes, repeated N times.
  // Only treated as a repeat when the base resolves — otherwise it falls through
  // so the whole token reports the normal "unknown token" error.
  const rep = /^(\S+)_(\d+)$/.exec(tok);
  if (rep) {
    const base = encodeToken(rep[1]);
    if (!base.error) {
      const n = parseInt(rep[2], 10);
      if (n < 1) return { bytes: [], error: `[${tok}]: repeat count must be ≥ 1.` };
      if (n > MAX_MESSAGE_BYTES) return { bytes: [], error: `[${tok}]: repeat count too large.` };
      const out: number[] = [];
      for (let k = 0; k < n; k++) out.push(...base.bytes);
      return { bytes: out };
    }
  }

  const hexCtrl = /^\$([0-9a-f]{2})ff$/i.exec(tok);
  if (hexCtrl) return { bytes: [0xff, parseInt(hexCtrl[1], 16)] };
  const hexByte = /^\$([0-9a-f]{2})$/i.exec(tok);
  if (hexByte) return { bytes: [parseInt(hexByte[1], 16)] };

  const parts = tok.split(/\s+/);
  const name = parts[0].toLowerCase();
  const g = GLYPH_BY_TOKEN.get(name);
  if (g) return { bytes: [...g.bytes] };
  const c = CONTROL_BY_TOKEN.get(name);
  if (c) {
    const out = [0xff, c.cmd];
    const need = c.params ?? 0;
    if (parts.length - 1 !== need) {
      return { bytes: [], error: `[${parts[0]}] expects ${need} hex param(s).` };
    }
    for (let k = 1; k <= need; k++) {
      const v = parseInt(parts[k], 16);
      if (Number.isNaN(v)) return { bytes: [], error: `Bad hex param "${parts[k]}" in [${tok}].` };
      out.push(v & 0xff);
    }
    return { bytes: out };
  }
  return { bytes: [], error: `Unknown markup token "[${tok}]".` };
}

/**
 * Encode markup back into the message byte stream, appending the `$FFFF`
 * terminator. Plain characters encode through the font table; `[token]`s resolve
 * via the glyph/control legends (or the `[$XX]`/`[$XXFF]` hex forms). Cosmetic
 * newlines are ignored. Returns `{ bytes }`, or `{ error }` on an unknown token /
 * unclosed bracket / unmapped character.
 */
export function encodeMessageMarkup(markup: string, fontTable: FontTable): EncodeResult {
  const bytes: number[] = [];
  let i = 0;
  while (i < markup.length) {
    const ch = markup[i];
    if (ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '[') {
      const j = markup.indexOf(']', i);
      if (j < 0) return { bytes: [], error: `Unclosed "[" at position ${i}.` };
      const r = encodeToken(markup.slice(i + 1, j).trim());
      if (r.error) return r;
      bytes.push(...r.bytes);
      i = j + 1;
      continue;
    }
    const byte = fontTable.charToByte.get(ch);
    if (byte === undefined) {
      return { bytes: [], error: `Character ${JSON.stringify(ch)} is not in the font table.` };
    }
    bytes.push(byte);
    i++;
  }
  bytes.push(0xff, 0xff); // $FFFF terminator
  return { bytes };
}

/**
 * Encoded byte size of a markup string — exactly what `encodeMessageMarkup`
 * produces (including the `$FFFF` terminator), but WITHOUT a font table: every
 * plain character is one font byte, so the SIZE never depends on the char→byte
 * map. `[token]`s (and the `[$XX]` / `[token_N]` forms) size via the same
 * `encodeToken` legend as the encoder; cosmetic `\n`/`\r` are free; an
 * unknown/malformed token contributes 0 (the real encode reports it as an error
 * on save). Lets the editor show a live byte usage that matches the on-save
 * budget — unlike a raw character count, which over-counts multi-char tokens
 * (e.g. `[scroll]` = 8 chars but 2 bytes) and cosmetic newlines.
 */
export function markupByteSize(markup: string): number {
  let n = 0;
  let i = 0;
  while (i < markup.length) {
    const ch = markup[i];
    if (ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '[') {
      const j = markup.indexOf(']', i);
      if (j < 0) break; // unclosed bracket — encoder errors; stop counting
      const r = encodeToken(markup.slice(i + 1, j).trim());
      if (!r.error) n += r.bytes.length;
      i = j + 1;
      continue;
    }
    n += 1; // one font byte per plain character
    i++;
  }
  return n + 2; // $FFFF terminator
}
