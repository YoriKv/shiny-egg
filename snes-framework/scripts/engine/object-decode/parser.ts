// Bank10 LoadLevelData port — the master object-stream parser.
//
// Ports of:
//   $10:8B61  CODE_load_level_object_stream    LoadLevelObjectStream (entry after header unpack)
//   $10:8BAF  CODE_108BAF    main object-stream loop
//   $10:8C13  CODE_108C13    extended-object dispatch
//   $10:8C33  CODE_108C33    standard-object dispatch
//   $10:8BDA  CODE_108BDA    screen-exit parser
//
// **Stream record shapes** (per docs/leveldataengine.md §2):
//
//   Extended object (first byte = $00, 4 bytes total):
//     [$00, XXXXYYYY, xxxxyyyy, ext-ID]
//
//   Standard object, length-only (first byte 1..$FE, property bits 0..1 == %00):
//     [id, XXXXYYYY, xxxxyyyy, length-1 (signed)]
//
//   Standard object, height-only (property %01):
//     [id, XXXXYYYY, xxxxyyyy, height-1 (signed)]
//
//   Standard object, length + height (property %10):
//     [id, XXXXYYYY, xxxxyyyy, length-1, height-1]
//
//   Terminator: first byte = $FF, followed by the screen-exit list:
//     [page-byte, dest-level/minibattle, dest-X, dest-Y, entrance-type] × N
//     terminated by 16-bit $FFFF (page=$FF + dest-level=$FF).
//
// The property byte is `DATA_object_property_table[id] & $03`. Bits 6/7 of that table
// have no Bank10 consumer (see docs §3.3 open question).

import {
  getExtObjectHandler,
  getStdObjectHandler,
  handlerCoverage
} from './handlers/index.ts';
import { ScreenOverflowError } from './fetch.ts';
import type { DecodeState, DecodedScreenExit } from './state.ts';
import type { SymbolMap } from '../symbol-map.ts';

/** Diagnostics from a single decode run. */
export interface DecodeStats {
  objectsParsed: number;
  extObjectsParsed: number;
  stdObjectsParsed: number;
  unregisteredObjects: number;
  exitsParsed: number;
  bytesConsumed: number;
  /** True if we aborted on an unrecognized object — partial Map16 buffer. */
  aborted: boolean;
  /** True if `ScreenOverflowError` thrown — Map16 buffer is partial. */
  overflowed: boolean;
}

/**
 * Run the master object-stream parser. Caller should have already:
 *   1. Called `state.reset(src, header)` with the level's object .bin
 *      bytes (post-header — the parser starts reading at offset 0 of `src`).
 *   2. Optionally populated `state.templates` (Phase 4 dependency).
 *
 * On return, `state.levelDataBuffer` holds the stamped Map16 IDs and
 * `state.exits` holds the parsed screen-exit list.
 */
export function loadLevelObjectStream(
  state: DecodeState,
  objectPropertyTable: Uint8Array
): DecodeStats {
  const stats: DecodeStats = {
    objectsParsed: 0,
    extObjectsParsed: 0,
    stdObjectsParsed: 0,
    unregisteredObjects: 0,
    exitsParsed: 0,
    bytesConsumed: 0,
    aborted: false,
    overflowed: false
  };

  // Initial state: $2A = $2E = 1 (default 1×1 rectangle if handler doesn't override),
  // $15 = 0 (object ID), zp99 = 0 (byte cursor). Cart sets these at the top of
  // each iteration of CODE_108BAF, but our zp slots persist so we just reset.

  try {
    while (true) {
      // CODE_108BAF: REP #$30; A = $0001; STA $2A; STA $2E; STZ $15
      state.zp2A = 1;
      state.zp2E = 1;
      state.zp15 = 0;

      // SEP #$20; LDY $99 — refresh byte cursor. The cart reads three
      // bytes ($15/$1C/$1B) from contiguous RAM, but the $FF terminator
      // only consumes $15 (plus $1C, to gate exit parsing — `LDA $1C ; BMI`
      // skips exits when the page byte's high bit is set). A stream whose
      // terminator lands in its final 1-2 bytes (e.g. level 0x04 ends
      // `… FF FF` = terminator + high-bit page sentinel) has no third byte;
      // demanding all three here spuriously "aborts" a perfectly
      // terminated stream. Require only the $15 byte; default the lookahead
      // operands and let the ext/std paths below bounds-check their own.
      const y0 = state.ptrOffset;
      if (y0 >= state.src.length) {
        // Stream ran out without ever reaching a terminator — genuine abort.
        stats.aborted = true;
        break;
      }
      // Read byte 0 -> $15; byte 1 -> $1C; byte 2 -> $1B. $1C defaults to
      // $FF (high bit set ⇒ "no exits") when absent, so a terminator at the
      // very last byte still ends the level cleanly rather than aborting.
      state.zp15 = state.src[y0];
      state.zp1C = y0 + 1 < state.src.length ? state.src[y0 + 1] : 0xff;
      state.zp1B = y0 + 2 < state.src.length ? state.src[y0 + 2] : 0x00;

      // LDA $15 ; BEQ extended ($00 = extended object)
      if (state.zp15 === 0) {
        // CODE_108C13: extended-object dispatch
        const yExt = y0 + 3;
        if (yExt >= state.src.length) { stats.aborted = true; break; }
        const extId = state.src[yExt];
        state.zp15 = extId;
        state.ptrOffset = yExt + 1;

        // NOTE: $1D (the anchor cell offset) is NOT resolved here. Std objects
        // get it from the walker (intra_object_walker → get_current_map16_tile),
        // as do walker-based ext handlers. But a WALKER-LESS ext handler that
        // stamps directly via `stampCell` (= state.zp1D) MUST call
        // getCurrentMap16Tile itself first — exactly as the cart's such handlers
        // open with `JSR get_current_map16_tile`. Skip it and the stamp lands at
        // the PREVIOUS object's stale $1D. See bank12-ext-line-guide-stopper-family.ts.

        // Provenance: stream index of this object (= its index in
        // `level.objects`), latched before dispatch so per-cell writes can be
        // attributed. `objectsParsed` is incremented AFTER the handler, so it
        // is this object's 0-based index here. No-op unless a target is armed.
        state.currentObjectIndex = stats.objectsParsed;
        const handler = getExtObjectHandler(extId);
        if (handler === null) {
          stats.unregisteredObjects++;
        } else {
          try {
            handler(state);
          } catch (e) {
            if (e instanceof ScreenOverflowError) {
              // Cart behavior: when the walker exhausts its 64-page
              // LRU pool or steps off the 128-screen grid, the cart's
              // overflow path (CODE_128874) silently RTSes without a
              // stamp ("glitched render"); the master parser continues
              // with the next object. We mirror that by setting the
              // diagnostic flag and continuing rather than aborting
              // the whole decode — dense levels with many bbox-
              // expanding objects (slopes that shift origin + bump
              // $2E) would otherwise lose the back half of their
              // object stream.
              stats.overflowed = true;
            } else {
              throw e;
            }
          }
        }
        stats.extObjectsParsed++;
        stats.objectsParsed++;
        continue;
      }

      // CMP #$FF ; BEQ exits
      if (state.zp15 === 0xff) {
        // $1C BMI ? — exit-parser dispatch is gated on $1C high bit.
        //   if ($1C & $80) == 0: parse exits
        //   else: skip to exit-list cleanup
        if ((state.zp1C & 0x80) === 0) {
          parseScreenExits(state, stats, y0);
        }
        // Either way, fall through to "level done" — cart copies $6CAA to
        // $6D6A (we don't need that for offline render).
        break;
      }

      // CODE_108C33: standard-object dispatch
      const id = state.zp15;
      const propByte = objectPropertyTable[id] ?? 0;
      const widthMode = propByte & 0x03;

      let cursorAfterSize = y0 + 3;
      if (widthMode === 0x00) {
        // length-only, 1 extra byte (signed) → $2A
        if (cursorAfterSize >= state.src.length) { stats.aborted = true; break; }
        const lenByte = state.src[cursorAfterSize];
        state.zp0A = lenByte;
        // Special case in cart: if length high bit set AND BG1 tileset != 2,
        // sign-extend (negative = grows left). Else: AND $00FF + INC.
        const bg1 = state.header[1]; // BG1 tileset is field index 1
        if (lenByte & 0x80) {
          if (bg1 !== 2) {
            // ORA #$FF00 ; DEC — i.e. signed-extend the negative value then -1
            state.zp2A = ((lenByte | 0xff00) - 1) & 0xffff;
          } else {
            state.zp2A = (lenByte + 1) & 0xffff;
          }
        } else {
          state.zp2A = (lenByte + 1) & 0xffff;
        }
        cursorAfterSize++;
      } else if (widthMode === 0x01) {
        // height-only, 1 extra byte → $2E (and re-uses default $2A=1)
        if (cursorAfterSize >= state.src.length) { stats.aborted = true; break; }
        const hByte = state.src[cursorAfterSize];
        if (hByte & 0x80) {
          state.zp2E = ((hByte | 0xff00) - 1) & 0xffff;
        } else {
          state.zp2E = (hByte + 1) & 0xffff;
        }
        cursorAfterSize++;
      } else if (widthMode === 0x02) {
        // length + height, 2 extra bytes → $2A, $2E
        if (cursorAfterSize + 1 >= state.src.length) { stats.aborted = true; break; }
        const lenByte = state.src[cursorAfterSize];
        state.zp0A = lenByte;
        const bg1 = state.header[1];
        if (lenByte & 0x80) {
          if (bg1 !== 2) {
            state.zp2A = ((lenByte | 0xff00) - 1) & 0xffff;
          } else {
            state.zp2A = (lenByte + 1) & 0xffff;
          }
        } else {
          state.zp2A = (lenByte + 1) & 0xffff;
        }
        cursorAfterSize++;
        const hByte = state.src[cursorAfterSize];
        if (hByte & 0x80) {
          state.zp2E = ((hByte | 0xff00) - 1) & 0xffff;
        } else {
          state.zp2E = (hByte + 1) & 0xffff;
        }
        cursorAfterSize++;
      } else {
        // widthMode == $03 — only seen at id=$00 (which is the extended-
        // object path anyway); valid streams never reach here.
        stats.aborted = true;
        break;
      }

      state.ptrOffset = cursorAfterSize;

      // Provenance: this object's stream index (see the ext branch note).
      state.currentObjectIndex = stats.objectsParsed;
      const handler = getStdObjectHandler(id);
      if (handler === null) {
        stats.unregisteredObjects++;
      } else {
        try {
          handler(state);
        } catch (e) {
          if (e instanceof ScreenOverflowError) {
            // See ext-object handler block above for rationale —
            // overflow is per-object; the parser continues.
            stats.overflowed = true;
          } else {
            throw e;
          }
        }
      }
      stats.stdObjectsParsed++;
      stats.objectsParsed++;
    }
  } finally {
    stats.bytesConsumed = state.ptrOffset;
  }

  void handlerCoverage; // suppress unused warning if no handlers registered
  return stats;
}

/**
 * Port of CODE_108BDA — parses 5-byte screen-exit records from the
 * stream after the $FF terminator, until 16-bit $FFFF (= $FF, $FF) is hit.
 *
 * Records: [page-byte (= $1C from terminator), dest-level, dest-X, dest-Y,
 *           entrance-type].
 * The first byte (page) was already read into state.zp1C above when the
 * terminator was hit; subsequent records are read from src+ptrOffset.
 */
function parseScreenExits(
  state: DecodeState,
  stats: DecodeStats,
  terminatorOffset: number
): void {
  // First exit's source-page is in state.zp1C (read with the terminator at
  // terminatorOffset+1). Cart CODE_108BDA reads the record fields starting at
  // terminatorOffset+2 (destLevelRecordId) — Y sits at y0+2 when the exit loop begins
  // (main loop read $15@y0, $1C@y0+1, $1B@y0+2). Using +3 skipped destLevelRecordId and
  // mis-read destX as the destination.
  let cursor = terminatorOffset + 2;
  let firstPage = state.zp1C;

  while (true) {
    if (cursor + 4 > state.src.length) break;
    const destLevelRecordId = state.src[cursor];
    const destX = state.src[cursor + 1];
    const destY = state.src[cursor + 2];
    const entranceType = state.src[cursor + 3];
    cursor += 4;

    const exit: DecodedScreenExit = {
      sourceScreen: firstPage & 0x7f,
      destLevelRecordId,
      destX,
      destY,
      entranceType
    };
    state.exits.push(exit);
    stats.exitsParsed++;

    // Read next page-byte
    if (cursor >= state.src.length) break;
    const nextPage = state.src[cursor];
    cursor++;
    if (nextPage === 0xff) break; // exit list terminated by a lone $FF page byte
    firstPage = nextPage;
  }

  state.ptrOffset = cursor;
}

/** Helper: load the object property table once from the cart at startup.
 *  Asm label `DATA_object_property_table` (raw alias `DATA_object_property_table`). */
export function loadObjectPropertyTable(
  rom: Uint8Array,
  symbols: SymbolMap
): Uint8Array {
  const pc = symbols.pc('DATA_object_property_table');
  return rom.subarray(pc, pc + 256);
}
