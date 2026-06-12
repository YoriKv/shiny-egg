// Canonical hex formatters for the whole project (Node- AND DOM-free, like
// types.ts, so the engine, the dev CLIs, and the renderer can all import it).
// Replaces the per-file `n.toString(16).toUpperCase().padStart(...)` copies that
// had drifted across scripts/ and the renderer. All editor hex is UPPERCASE,
// zero-padded (CLAUDE.md "Hex display"); prefixed forms use `0x` for
// identifiers/UI and `$` for asm/disassembly addresses.
//
// NB: deliberately NOT for lowercase hex (CSS colours, some asm dumps) — those
// would change output, so they keep their own local formatting.

/** Uppercase hex, zero-padded to `width`, no prefix. e.g. `hex(0x4a)` → `"4A"`. */
export function hex(n: number, width = 2): string {
  return (n >>> 0).toString(16).toUpperCase().padStart(width, '0');
}

/** `0x`-prefixed uppercase hex — the canonical identifier/UI form.
 *  e.g. `hex0x(0x4a)` → `"0x4A"`. */
export function hex0x(n: number, width = 2): string {
  return '0x' + hex(n, width);
}

/** `$`-prefixed uppercase hex — asm/disassembly address style (default 6 digits
 *  = a 24-bit SNES address). e.g. `hexDollar(0x515348)` → `"$515348"`. */
export function hexDollar(n: number, width = 6): string {
  return '$' + hex(n, width);
}

/** 24-bit SNES address as `"BB:AAAA"` (bank:offset, no prefix) — the WLA `.sym`
 *  / disassembly-listing style used by the codegraph cache keys and the xref
 *  CLI output. e.g. `hexAddr24(0x515348)` → `"51:5348"`. */
export function hexAddr24(addr: number): string {
  return hex((addr >>> 16) & 0xff, 2) + ':' + hex(addr & 0xffff, 4);
}
