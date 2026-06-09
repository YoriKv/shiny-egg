// Shared hex formatters for user-facing identifiers (level/object/sprite/exit
// ids). All editor hex is UPPERCASE, zero-padded, and — when prefixed — uses
// `0x` (see CLAUDE.md "Hex display").
//
// Re-exported from the canonical engine module (`snes-framework/hex`) so the
// renderer and the engine/CLIs share ONE implementation. NOTE: this is for
// *identifiers*; the 6-digit lowercase CSS-colour helper in PalettePanel
// deliberately renders lowercase and keeps its own formatting.

export { hex, hex0x } from 'snes-framework/hex'
