// Little-endian ROM word reads. The cart stores pointers/addresses LE, so every
// loader pulls 16- and 24-bit words out of the raw `Uint8Array`. Single source
// for these one-liners — load-graphics / load-palettes / load-bg-tilemaps /
// load-tile-animation / sprite-tile-base each used to re-declare them.

/** Read a little-endian unsigned 16-bit word at byte offset `pc`. */
export const u16le = (rom: Uint8Array, pc: number): number =>
  rom[pc]! | (rom[pc + 1]! << 8);

/** Read a little-endian unsigned 24-bit value (e.g. a long pointer) at `pc`. */
export const u24le = (rom: Uint8Array, pc: number): number =>
  rom[pc]! | (rom[pc + 1]! << 8) | (rom[pc + 2]! << 16);
