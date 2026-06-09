// Shared arg-parse + hex-format helpers for the engine-side dev CLIs
// (inspect-level, map16-probe, find-object, render-cli, render-snapshot, and the
// level-lookup runner). Each tool used to re-paste a near-identical `parseId`
// (the project's documented dec/hex trap) and a `0x`-hex formatter; consolidated
// here so those rules live in one place. Tools that dump SNES *addresses* keep
// their own `$`/raw-hex asm-style formatting — that's a deliberately different
// convention, not this one.

import { hex0x } from '../hex.ts';

/** `0x` + uppercase hex, zero-padded to `width` (default 2). The canonical
 *  identifier/UI hex form (CLAUDE.md: user-facing hex uses the `0x` prefix).
 *  Thin alias over the shared `hex0x` so this name stays stable for the CLIs. */
export function hexN(n: number, width = 2): string {
  return hex0x(n, width);
}

/** Split argv into `--flags` (a Set) and bare positionals — the split every
 *  multi-arg CLI here open-codes identically. */
export function splitArgs(argv: string[]): { flags: Set<string>; positionals: string[] } {
  return {
    flags: new Set(argv.filter((a) => a.startsWith('--'))),
    positionals: argv.filter((a) => !a.startsWith('--'))
  };
}

export interface ParseHexIdOpts {
  /** Inclusive upper bound (default 0xFF; sprite ids are 9-bit → pass 0x1FF). */
  max?: number;
  /** What the id names, for the default error message (e.g. 'level record id'). */
  label?: string;
  /** Printed instead of the default message before exit — e.g. a usage line. */
  onError?: () => void;
}

/** Parse a CLI id token: `0x`-prefixed = hex, else decimal — matching every dev
 *  tool's prior behaviour (and the documented dec/hex trap). Validates `0..max`;
 *  on a missing/invalid token runs `onError` (or prints a message) then
 *  `process.exit(2)`, so the return is always a valid number. */
export function parseHexId(s: string | undefined, opts: ParseHexIdOpts = {}): number {
  const { max = 0xff, label = 'id', onError } = opts;
  const n = s != null && /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s ?? '', 10);
  if (s == null || Number.isNaN(n) || n < 0 || n > max) {
    if (onError) onError();
    else console.error(`Bad ${label}: ${s} (expect 0x00–${hexN(max)})`);
    process.exit(2);
  }
  return n;
}
