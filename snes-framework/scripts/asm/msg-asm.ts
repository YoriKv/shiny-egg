// Message-region asm ↔ byte bridge. The Bank51 `;@editable:message-box-text`
// region stores each message as `dw $XXFF : db "text",$XX` directives, not raw
// bytes. To edit messages as markup (see msg-markup.ts) the editor must turn
// those directives into the byte stream the codec consumes, and re-emit edited
// messages as directives. This module is that bridge (validated byte-for-byte
// against the cart by msg-markup.test.ts's sibling check).

import { stripComment } from './text-literals.ts';
import type { FontTable } from './font-table.ts';
import { hex } from '../hex.ts';

const hex2 = (n: number): string => hex(n & 0xff, 2);
const LABEL_ONLY_RE = /^([A-Za-z_.][\w.]*):$/;

export interface MessageEntry {
  /** The message body's label (`DATA_51XXXX`). */
  label: string;
  /** Char offset in the region `inner` where this body begins (after the label). */
  bodyStart: number;
  /** Char offset where the body ends (start of the next label / region end). */
  bodyEnd: number;
  /** The directive text between this label and the next. */
  body: string;
}

/** Split a message region body into per-label entries with their body spans (for
 *  the markup parse + the splice-on-save). The leading header comment (before the
 *  first label) is not an entry. */
export function splitMessageEntries(inner: string): MessageEntry[] {
  const entries: MessageEntry[] = [];
  let offset = 0;
  let cur: { label: string; bodyStart: number } | null = null;
  for (const raw of inner.split('\n')) {
    const lineStart = offset;
    offset += raw.length + 1; // + the consumed '\n'
    const lm = LABEL_ONLY_RE.exec(stripComment(raw).trim());
    if (!lm) continue;
    if (cur) {
      entries.push({ label: cur.label, bodyStart: cur.bodyStart, bodyEnd: lineStart, body: inner.slice(cur.bodyStart, lineStart) });
    }
    cur = { label: lm[1], bodyStart: offset }; // body starts on the next line
  }
  if (cur) {
    entries.push({ label: cur.label, bodyStart: cur.bodyStart, bodyEnd: inner.length, body: inner.slice(cur.bodyStart, inner.length) });
  }
  return entries;
}

/** Split on `sep` outside `"…"` quotes (args / `:`-joined directives can't be
 *  split naively because text literals contain commas). */
function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of s) {
    if (ch === '"') {
      q = !q;
      cur += ch;
    } else if (ch === sep && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Assemble a message body's `dw`/`db` directives into its byte stream: `dw $XXXX`
 * → two little-endian bytes, `db "text"` → font bytes (via the font table), `db
 * $XX` → one byte. Returns null on an unparseable directive / unmapped char.
 */
export function messageBodyToBytes(body: string, ft: FontTable): number[] | null {
  const bytes: number[] = [];
  for (const raw of body.split('\n')) {
    const code = stripComment(raw).trim();
    if (!code || LABEL_ONLY_RE.test(code)) continue;
    for (const dseg of splitOutsideQuotes(code, ':')) {
      const d = dseg.trim();
      if (!d) continue;
      const mm = /^(\w+)\s+([\s\S]*)$/.exec(d);
      if (!mm) return null;
      const kw = mm[1];
      for (const arg of splitOutsideQuotes(mm[2], ',')) {
        const a = arg.trim();
        if (!a) continue;
        if (a.startsWith('"') && a.endsWith('"')) {
          for (const ch of a.slice(1, -1)) {
            const b = ft.charToByte.get(ch);
            if (b === undefined) return null;
            bytes.push(b);
          }
        } else {
          const v = parseInt(a.replace(/^\$/, ''), 16);
          if (Number.isNaN(v)) return null;
          if (kw === 'dw') bytes.push(v & 0xff, (v >> 8) & 0xff);
          else bytes.push(v & 0xff);
        }
      }
    }
  }
  return bytes;
}

/**
 * Re-emit a message byte stream as `dw`/`db` directives (for an edited message;
 * unedited ones keep their original text). Printable font chars group into
 * `db "…"`, special glyph bytes become `db $XX`, control words become `dw $XXFF`.
 */
export function bytesToMessageDirectives(bytes: number[], byteToChar: Map<number, string>): string {
  const lines: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length) {
      lines.push(`\tdb "${run.join('')}"`);
      run = [];
    }
  };
  let p = 0;
  while (p < bytes.length) {
    const b = bytes[p];
    if (b === 0xff) {
      flush();
      lines.push(`\tdw $${hex2(bytes[p + 1] ?? 0xff)}FF`);
      p += 2;
      continue;
    }
    const ch = byteToChar.get(b);
    if (ch !== undefined && ch !== '"' && ch !== '\\') {
      run.push(ch);
    } else {
      flush();
      lines.push(`\tdb $${hex2(b)}`);
    }
    p += 1;
  }
  flush();
  return lines.join('\n');
}
