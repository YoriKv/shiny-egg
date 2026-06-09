// Map16 fetch primitives + screen-page LRU allocator.
//
// Ports of:
//   $12:1286FD  get_current_map16_tile     (RTS-only — walker-internal)
//   $12:128719  get_map16_above            (RTL — Bank13 handlers call)
//   $12:12875D  get_map16_below
//   $12:1287A1  get_map16_left
//   $12:1287E2  get_map16_right
//   $12:128824  resolve_screen_page        (LRU; allocates lazily)
//
// All five fetch primitives compute a byte offset into the levelDataBuffer
// for a Map16 cell coord. The four directional variants read from
// `zp0E`/`zp0F` so callers can probe neighbours without disturbing the
// walker's `zp1B`/`zp1C`. The current-tile primitive reads from
// `zp1B`/`zp1C` directly.
//
// **Coordinate encoding** (nibble-interleaved):
//   - Low byte ($1B/$0E): high nibble = sub-screen Y (0..15),
//                          low nibble = sub-screen X (0..15)
//   - High byte ($1C/$0F): high nibble = screen-page Y (0..7),
//                           low nibble = screen-page X (0..15)
//
// Output convention for all 5 primitives:
//   X register / return value = absolute byte offset into levelDataBuffer
//   `zp1D` and `zp12` also updated for the current-tile primitive.
//
// **Why all the masking** (this is non-obvious): SNES 16-bit operations
// frequently leave high bytes from prior ops in the upper byte of an
// accumulator. The asm uses ORA/AND combinations to:
//   - isolate just the sub-screen-X nibble (& $0F0F means "keep low
//     nibble of each byte"),
//   - propagate carries across nibble boundaries (e.g. ORA #$00F0 + INC
//     forces an overflow that cascades into the screen-X nibble on
//     natural wrap),
//   - merge the result back with the high-nibble screen coord.
// We mirror the asm verbatim — comments below trace the intent.
//
// **Mode-9 ROW PITCH special case** (Bank13 only — applied via $6CA9
// per-screen base): the asm reads `$6CA9,x` (NOT $6CAA) which is the
// per-screen LevelDataBuffer base-offset table. Our `screenBufBase[]`
// is populated lazily by `resolveScreenPage` (mirrors cart's $6CAA write).

import { DecodeState } from './state.ts';

/** Hard-error sentinel return from the LRU panic path. The cart resets
 *  the stack and JMLs back to LoadLevelData; we throw instead. */
export class ScreenOverflowError extends Error {
  constructor() {
    super('Object decoder: screen index >= $80 — level data walked off the 128-screen grid');
    this.name = 'ScreenOverflowError';
  }
}

/**
 * Port of `resolve_screen_page` at $12:8824.
 *
 * Resolves an 8-bit screen index `x` (0..$7F) plus a partial offset in
 * `s.zp00` (already pre-shifted by the calling fetch primitive) to a
 * byte offset into the levelDataBuffer. Allocates a fresh LRU page if
 * the requested screen is not yet mapped, updating `screenPageMap`,
 * `screenBufBase`, `lruChain`, `lastLruPage`, `pageCount`.
 *
 * Throws ScreenOverflowError if `x >= $80` (cart resets + reloads;
 * we throw so caller decides what to do — typically abort the decode).
 */
export function resolveScreenPage(s: DecodeState, x: number): number {
  // CPX #$80 ; BCS overflow
  if (x >= 0x80) {
    throw new ScreenOverflowError();
  }
  // LDA $6CAA,x ; AND #$3F ; BNE existing
  let lruPage = s.screenPageMap[x] & 0x3f;
  if (lruPage === 0) {
    // INC $0D4D ; LDA $0D4D ; AND #$3F ; TAY ; BEQ overflow
    s.lastLruPage = (s.lastLruPage + 1) & 0xff;
    let y = s.lastLruPage & 0x3f;
    if (y === 0) throw new ScreenOverflowError();

    // walk LRU chain looking for a free slot
    while (true) {
      // LDA $0D4E,y ; BEQ claim
      if (s.lruChain[y] === 0) break;
      // INY ; TYA ; AND #$3F ; TAY ; CMP $0D4D ; BEQ bail
      y = (y + 1) & 0x3f;
      if (y === (s.lastLruPage & 0x3f)) {
        // wrapped all the way around — bail (cart calls CODE_128874 which RTS'es
        // without producing a valid X; that means a glitched render. We treat
        // it as overflow.)
        throw new ScreenOverflowError();
      }
    }
    // Claim: TYA ; INC $97 ; STA $6CAA,x ; STA $0D4E,y
    s.pageCount = (s.pageCount + 1) & 0xff;
    s.screenPageMap[x] = y;
    s.lruChain[y] = y;
    // ALSO populate screenBufBase[x] — the per-screen offset that the four
    // directional fetch primitives read via `$6CA9,x`. Per the asm-side
    // layout, $6CA9,x is the same data shifted by one (CODE_get_map16_above's
    // `LDA $6CA9,x ; AND #$3F00 ; ASL` recovers the page index in the
    // high byte). Storing the page in the high byte of screenBufBase[x]
    // matches that fetch path; the high-byte AND $3F0 + ASL produces
    // page*512 = correct byte base.
    s.screenBufBase[x] = y;
    lruPage = y;
  }
  // Final offset: page-index << 9 (= 512-byte page) + intra-screen offset
  return ((lruPage & 0x3f) << 9) | (s.zp00 & 0x1ff);
}

/** Port of `get_current_map16_tile` at $12:86FD. */
export function getCurrentMap16Tile(s: DecodeState): void {
  // LDA $1B ; AND #$00FF ; ASL ; STA $00
  s.zp00 = (s.zp1B & 0xff) << 1;
  // LDX $1C ; JSR resolve_screen_page ; STX $1D
  const x = resolveScreenPage(s, s.zp1C & 0xff);
  s.zp1D = x;
  // LDA !LevelDataBuffer,x ; STA $12  -- 16-bit (REP #$30 caller context)
  const lo = s.levelDataBuffer[x] ?? 0;
  const hi = s.levelDataBuffer[(x + 1) & 0xffff] ?? 0;
  s.zp12 = lo | (hi << 8);
}

// ---------------------------------------------------------------------------
// Directional fetch helpers.
//
// All four follow this shape (asm semantics in comments):
//   1. Compose a 16-bit value from $2C (row counter), $2B (page carry),
//      $0E/$0F (neighbour-probe Map16 coord) — the per-direction math
//      determines whether we step up/down/left/right.
//   2. AND #$F0F0 / #$0F0F / etc. to mask back into the nibble-interleaved
//      coord space.
//   3. Compute X = high byte of computed coord (a screen index 0..$7F).
//   4. Read $6CA9,x (= screenBufBase[x] in our state) — the base offset
//      for that screen. AND #$3F00 ; ASL recovers `page << 9`.
//   5. ADC the intra-screen partial offset (in $00) — final byte index.
//
// `screenBufBase[x]` may be zero if the screen is unallocated; we DON'T
// resolve-or-allocate from these primitives in our port (the cart does
// the same — these are read-side only; allocation happens in the walker
// step path via `resolveScreenPage`).
// ---------------------------------------------------------------------------

/** Common epilogue used by all 4 directional primitives. Returns the final
 *  byte index into levelDataBuffer for the just-computed neighbour coord. */
function finishNeighbourFetch(s: DecodeState, composedCoord: number): number {
  // TAX ; AND #$00FF ; ASL ; STA $00
  s.zp00 = ((composedCoord & 0xff) << 1) & 0xffff;
  // TXA ; XBA ; AND #$00FF ; TAX — high byte of coord = screen index
  const x = (composedCoord >>> 8) & 0xff;
  // LDA $6CA9,x ; AND #$3F00 ; ASL ; ADC $00 ; TAX
  // screenBufBase[x] holds the LRU page in low byte (we store unshifted);
  // recover page << 9 by reading the byte and shifting.
  const page = s.screenBufBase[x] & 0x3f;
  return ((page << 9) | (s.zp00 & 0x1ff)) & 0xffff;
}

/** Port of `get_map16_above` at $12:8719. Steps Y up by 1 within column. */
export function getMap16Above(s: DecodeState): number {
  // $00 = ($2C & $0F) << 4
  let scratch = ((s.zp2C & 0x0f) << 4) & 0xffff;
  // TSB.b $00 with ($2B & $F000) — bitwise OR (test-set-bits has OR effect on $00)
  // Cart `LDA.b $2B ; AND #$F000` reads the WORD $2B:$2C (little-endian) and
  // masks to bits 12-15 — i.e. the HIGH nibble of the row counter $2C, NOT a
  // separate $2B byte. That nibble is the screen-page-row advance (16 rows = 1
  // screen down): it corrects the stale screenY left in $1C/$0E after the walker
  // steps a column across a page boundary (the walker bumps $1D but not $1C).
  // Reading `zp2B` here (a byte that's always 0) dropped the correction, so a
  // neighbour probe from a cell at row >= 16 resolved to the wrong screen-page
  // row — landing the write ~16 cells up. Harmless for row < 16 (high nibble 0).
  scratch = (scratch | ((s.zp2C << 8) & 0xf000)) & 0xffff;
  // LDA $0E ; ORA #$0F00 ; ADC $00 — ADC carries through ORA mask sometimes
  let v = (s.zp0E | 0x0f00) & 0xffff;
  v = (v + scratch) & 0xffff;
  // AND #$70F0 ; SEC ; SBC #$0010 ; AND #$70F0 ; STA $00
  v = (v & 0x70f0) & 0xffff;
  v = (v - 0x0010) & 0xffff;
  v = (v & 0x70f0) & 0xffff;
  scratch = v;
  // LDA $0E ; AND #$0F0F ; ORA $00 ; TAX (final 16-bit coord)
  const composed = ((s.zp0E & 0x0f0f) | scratch) & 0xffff;
  return finishNeighbourFetch(s, composed);
}

/** Port of `get_map16_below` at $12:875D. */
export function getMap16Below(s: DecodeState): number {
  let scratch = ((s.zp2C & 0x0f) << 4) & 0xffff;
  // Cart `LDA.b $2B ; AND #$F000` reads the WORD $2B:$2C (little-endian) and
  // masks to bits 12-15 — i.e. the HIGH nibble of the row counter $2C, NOT a
  // separate $2B byte. That nibble is the screen-page-row advance (16 rows = 1
  // screen down): it corrects the stale screenY left in $1C/$0E after the walker
  // steps a column across a page boundary (the walker bumps $1D but not $1C).
  // Reading `zp2B` here (a byte that's always 0) dropped the correction, so a
  // neighbour probe from a cell at row >= 16 resolved to the wrong screen-page
  // row — landing the write ~16 cells up. Harmless for row < 16 (high nibble 0).
  scratch = (scratch | ((s.zp2C << 8) & 0xf000)) & 0xffff;
  let v = (s.zp0E | 0x0f00) & 0xffff;
  // CLC ; ADC #$0010 ; ORA #$0F00 ; ADC $00 ; AND #$70F0
  v = (v + 0x0010) & 0xffff;
  v = (v | 0x0f00) & 0xffff;
  v = (v + scratch) & 0xffff;
  v = (v & 0x70f0) & 0xffff;
  scratch = v;
  const composed = ((s.zp0E & 0x0f0f) | scratch) & 0xffff;
  return finishNeighbourFetch(s, composed);
}

/** Port of `get_map16_left` at $12:87A1. */
export function getMap16Left(s: DecodeState): number {
  let scratch = ((s.zp2C & 0x0f) << 4) & 0xffff;
  // Cart `LDA.b $2B ; AND #$F000` reads the WORD $2B:$2C (little-endian) and
  // masks to bits 12-15 — i.e. the HIGH nibble of the row counter $2C, NOT a
  // separate $2B byte. That nibble is the screen-page-row advance (16 rows = 1
  // screen down): it corrects the stale screenY left in $1C/$0E after the walker
  // steps a column across a page boundary (the walker bumps $1D but not $1C).
  // Reading `zp2B` here (a byte that's always 0) dropped the correction, so a
  // neighbour probe from a cell at row >= 16 resolved to the wrong screen-page
  // row — landing the write ~16 cells up. Harmless for row < 16 (high nibble 0).
  scratch = (scratch | ((s.zp2C << 8) & 0xf000)) & 0xffff;
  let v = (s.zp0E | 0x0f00) & 0xffff;
  v = (v + scratch) & 0xffff;
  v = (v & 0x70f0) & 0xffff;
  scratch = v;
  // LDA $0E ; AND #$0F0F ; DEC ; AND #$0F0F ; ORA $00 ; TAX
  let lo = (s.zp0E & 0x0f0f) & 0xffff;
  lo = (lo - 1) & 0xffff;
  lo = (lo & 0x0f0f) & 0xffff;
  const composed = (lo | scratch) & 0xffff;
  return finishNeighbourFetch(s, composed);
}

/** Port of `get_map16_right` at $12:87E2. */
export function getMap16Right(s: DecodeState): number {
  let scratch = ((s.zp2C & 0x0f) << 4) & 0xffff;
  // Cart `LDA.b $2B ; AND #$F000` reads the WORD $2B:$2C (little-endian) and
  // masks to bits 12-15 — i.e. the HIGH nibble of the row counter $2C, NOT a
  // separate $2B byte. That nibble is the screen-page-row advance (16 rows = 1
  // screen down): it corrects the stale screenY left in $1C/$0E after the walker
  // steps a column across a page boundary (the walker bumps $1D but not $1C).
  // Reading `zp2B` here (a byte that's always 0) dropped the correction, so a
  // neighbour probe from a cell at row >= 16 resolved to the wrong screen-page
  // row — landing the write ~16 cells up. Harmless for row < 16 (high nibble 0).
  scratch = (scratch | ((s.zp2C << 8) & 0xf000)) & 0xffff;
  let v = (s.zp0E | 0x0f00) & 0xffff;
  v = (v + scratch) & 0xffff;
  v = (v & 0x70f0) & 0xffff;
  scratch = v;
  // LDA $0E ; ORA #$00F0 ; INC ; AND #$0F0F ; ORA $00 ; TAX
  let lo = (s.zp0E | 0x00f0) & 0xffff;
  lo = (lo + 1) & 0xffff;
  lo = (lo & 0x0f0f) & 0xffff;
  const composed = (lo | scratch) & 0xffff;
  return finishNeighbourFetch(s, composed);
}
