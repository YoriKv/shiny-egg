// Import-time conversion of a community asar `.asm` hack into the form this
// cart's build accepts. Pure (no node/DOM), framework-side so it tests with
// `node`.
//
// Why convert at all: a typical asar hack hijacks engine code (`org $XXXXXX`)
// and parks its new routine in asar `freespace`/`freecode`, often via
// `autoclean jsl <label>`. On THIS cart asar's freespace scanner first-fits into
// live data ($12 sentinels) and the level-data migration banks, so the build
// bans `freecode`/`freedata`/`freespace`/`autoclean` outright (see build-tree.ts
// `assertNoFreecodeInPatches`). Custom routines must instead go through the
// reserved `%patchcode()`/`%patchdata()` pool (a carved-off tail of the Bank51
// free region). This module rewrites the common asar idioms to that model so an
// imported hack assembles as-is:
//   - strip a leading `asar <ver>` line (can't live inside the hook macro body)
//   - `autoclean jsl/jml X`        → `jsl/jml X`   (no freespace ⇒ nothing to clean)
//   - `freespacebyte $XX`          → dropped       (the pool is pre-reserved $FF)
//   - `freecode` / `freedata`      → `%patchcode()` / `%patchdata()`, with a
//     matching `%endpatchcode()`/`%endpatchdata()` auto-inserted at the next
//     block boundary (`org`/another free*/`pullpc`/EOF)
//   - `org $XXXXXX` (LoROM)        → `org !LABEL+$delta` drift-proofed against the
//     reference symbols (same anchoring the binary-chunk path uses), so the hijack
//     tracks the project's asm drift. Kept raw when not drift-proofable.
// Anything it can't confidently convert is left in place and flagged in `notes`;
// the build guard remains the backstop (it rejects any residual freecode/etc.).

import { snesToPC, type SymbolMap } from '../engine/symbol-map.ts';

export interface AsarConversionResult {
  /** The converted asar source (newline-joined). */
  asm: string;
  /** Human-readable notes: each transform applied + anything left unconverted. */
  notes: string[];
}

/** A statement's leading directive keyword (lowercased), for dispatch. */
function leadingKeyword(code: string): string {
  const m = /^\s*([A-Za-z%][A-Za-z0-9_]*)/.exec(code);
  return m ? m[1].toLowerCase() : '';
}

/** Strip a trailing `;` comment from a line, returning just the code part. */
function codeOf(line: string): string {
  return line.replace(/;.*$/, '');
}

/**
 * Drift-proof one `org $XXXXXX` operand against `refSym`: reverse-look-up the
 * target to its nearest preceding engine label and re-express it as
 * `!LABEL[+$delta]` (resolved to the build's address by asmSymbolDefines). Only
 * LoROM-bank targets ($00–$3F / $80–$BF) anchored to a label IN THE SAME LoROM
 * bank are converted — there the PC-space delta equals the SNES-space delta, so
 * the rewrite is exact. Returns null (keep raw) otherwise.
 */
function driftProofOrg(snes: number, refSym: SymbolMap): string | null {
  const bank = (snes >>> 16) & 0xff;
  const isLoRom = bank <= 0x3f || (bank >= 0x80 && bank <= 0xbf);
  if (!isLoRom) return null; // SuperFX/HiROM: PC↔SNES delta can differ across banks
  const pc = snesToPC(snes);
  const hit = refSym.reverseLookup(pc);
  if (!hit || hit.delta < 0) return null;
  const anchorPc = pc - hit.delta;
  // Same 32 KB LoROM bank ⇒ delta is identical in PC and SNES space.
  if (anchorPc >>> 15 !== pc >>> 15) return null;
  return hit.delta === 0 ? `!${hit.label}` : `!${hit.label}+$${hit.delta.toString(16).toUpperCase()}`;
}

/**
 * Convert a community asar patch into the build-compatible form. `opts.refSym`
 * (the reference/base-build symbols) enables `org` drift-proofing; without it
 * orgs are kept raw. The result is deterministic.
 */
export function convertAsarPatch(src: string, opts: { refSym?: SymbolMap } = {}): AsarConversionResult {
  const notes: string[] = [];
  const noteOnce = (msg: string): void => { if (!notes.includes(msg)) notes.push(msg); };
  const out: string[] = [];

  // Open `%patchcode()`/`%patchdata()` block, if any — so we can auto-close it.
  let open: 'code' | 'data' | null = null;
  const closeBlock = (): void => {
    if (open) { out.push(open === 'code' ? '%endpatchcode()' : '%endpatchdata()'); open = null; }
  };
  const openBlock = (kind: 'code' | 'data'): void => {
    closeBlock();
    out.push(kind === 'code' ? '%patchcode()' : '%patchdata()');
    open = kind;
  };

  const lines = src.split(/\r?\n/);
  let seenContent = false; // for the leading `asar <ver>` line
  for (const raw of lines) {
    const code = codeOf(raw);
    const trimmed = code.trim();
    const kw = leadingKeyword(code);

    // Leading `asar <ver>` version-requirement line (only valid at file top, and
    // illegal inside a macro body) — drop it.
    if (!seenContent && /^asar\s+[\d.]+\s*$/i.test(trimmed)) {
      noteOnce('Dropped the `asar <version>` line (not valid inside the patch hook).');
      continue;
    }
    if (trimmed) seenContent = true;

    switch (kw) {
      case 'freespacebyte':
        noteOnce('Dropped `freespacebyte` (the patch pool is pre-reserved).');
        continue;

      case 'freecode':
      case 'freedata':
      case 'freespace': {
        const kind = kw === 'freedata' ? 'data' : 'code';
        if (trimmed.toLowerCase() !== kw) {
          noteOnce(`Dropped modifiers/size on \`${trimmed}\` — routine placed in the reserved patch pool.`);
        }
        openBlock(kind);
        noteOnce(`Converted \`${kw}\` → \`%patch${kind}()\` (reserved patch pool).`);
        continue;
      }

      case 'org': {
        // org ends any open freespace block in asar; mirror that, then drift-proof.
        closeBlock();
        const m = /^(\s*)org\s+\$([0-9A-Fa-f]{5,6})\b(.*)$/.exec(raw);
        if (m && opts.refSym) {
          const snes = parseInt(m[2], 16);
          const label = driftProofOrg(snes, opts.refSym);
          if (label) {
            out.push(`${m[1]}org ${label}${m[3]}   ; was org $${m[2].toUpperCase()}`);
            continue;
          }
          noteOnce(`Kept \`org $${m[2].toUpperCase()}\` raw (no nearby same-bank label — not drift-proofed).`);
        }
        out.push(raw);
        continue;
      }

      case 'pullpc':
        closeBlock();
        out.push(raw);
        continue;

      case 'autoclean': {
        // `autoclean jsl/jml X` → plain `jsl/jml X`. Standalone autoclean (of a
        // freespace pointer) has no meaning without freespace — drop it.
        const m = /^(\s*)autoclean\s+(jsl|jml)\b(.*)$/i.exec(raw);
        if (m) {
          out.push(`${m[1]}${m[2]}${m[3]}   ; was: autoclean ${m[2]}`);
          noteOnce('Stripped `autoclean` from jsl/jml (no freespace to reclaim).');
        } else {
          noteOnce(`Dropped standalone \`${trimmed}\` (freespace cleanup is N/A here).`);
        }
        continue;
      }

      default:
        out.push(raw);
    }
  }
  closeBlock();

  return { asm: out.join('\n'), notes };
}

export interface AsmPatchMeta {
  name: string;
  description?: string;
  attribution?: string;
  /** The full leading comment block, verbatim (for the JSON `details` reference). */
  details?: string[];
}

/**
 * Best-effort metadata from an imported asar patch: the `name` from the filename
 * stem (matching the IPS importer), and `description`/`attribution`/`details`
 * mined from the leading `;` comment block (the first contiguous run of comment
 * lines, after any `asar <ver>` line). `by …` / URL lines become the attribution.
 */
export function deriveAsmPatchMeta(src: string, fileBaseName: string): AsmPatchMeta {
  const name = fileBaseName.replace(/\.asm$/i, '');
  const comments: string[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const t = raw.trim();
    if (t === '' && comments.length === 0) continue; // skip leading blanks
    if (/^asar\s+[\d.]+\s*$/i.test(t)) continue; // skip the asar version line
    if (t.startsWith(';')) { comments.push(t.replace(/^;+\s?/, '').trim()); continue; }
    break; // first non-comment, non-blank line ends the header block
  }
  const meta: AsmPatchMeta = { name };
  if (comments.length) meta.details = comments;
  const isCredit = (s: string): boolean => /^by\b/i.test(s) || /https?:\/\//i.test(s);
  const desc = comments.find((c) => c && !isCredit(c) && !/^v[\d.]+$/i.test(c));
  if (desc) meta.description = desc;
  const credits = comments.filter(isCredit);
  if (credits.length) meta.attribution = credits.join(' · ');
  return meta;
}
