// Byte-extent walk of a level object stream — bit-packed header, object list,
// screen-exit list — exactly as the cart's loader consumes it (Bank10
// `CODE_108BAF` object loop → `CODE_108BDA` exit list). Format only, no decode.
// The one walker shared by the extract (per-level `.bin` sizing), the ROM
// importer (foreign stream slicing) and its anchor validator, so the exit-list
// rules can't drift between them again (they did: see `exitListAbsent`).
//
// Pure (no Node / DOM imports) — the import anchors module stays pure too.

/**
 * Does the cart skip this level's exit list? When the object loop hits the `$FF`
 * terminator it has already read the next byte as the first exit's screen (`$1C`),
 * and if that byte has bit 7 set (`LDA $1C / BMI`) it parses NO exits. So the
 * usual empty list is a lone `$FF`, but ANY `$80+` byte there means "no exits"
 * too; a real list can't start that way (exit screens are 7-bit, `AND #$007F`).
 *
 * Record 0x7D (a 3-6 sub-room) is the one vanilla level that relies on this: its
 * slice `DATA_169D23` ends at the object `$FF` and borrows its gate from the next
 * blob's first byte (`$F4`, 0xA5's header). A parser that only stops on `$FF`
 * reads 0xA5's data as 28 phantom exits, many on screens past `$7F`.
 */
export function exitListAbsent(gateByte: number): boolean {
  return (gateByte & 0x80) !== 0;
}

export interface ObjStreamExtent {
  /** Offset just past the stream's last byte: after the exit-list `$FF`, or after
   *  the object `$FF` when the exit gate is borrowed (`borrowedExitGate`). */
  end: number;
  /** The exit list is gated off by a non-`$FF` `$80+` byte that belongs to the
   *  FOLLOWING data, not this stream — so `[start, end)` alone isn't
   *  self-terminating (a standalone copy needs an explicit `$FF` appended). */
  borrowedExitGate: boolean;
  /** Both lists terminated before `limit`. */
  terminated: boolean;
}

/** Walk the object stream at `start` (stopping at `limit`). `headerBytes` is the
 *  bit-packed header's size in bytes; `standardObjectInfo` is the 256-byte
 *  `DATA_object_property_table` (low 2 bits = which size bytes follow). */
export function walkObjStream(
  bytes: Uint8Array,
  start: number,
  headerBytes: number,
  standardObjectInfo: ArrayLike<number>,
  limit: number
): ObjStreamExtent {
  let p = start + headerBytes;

  // Object list: num + locH + locL + maybe-w + maybe-h; terminator is num == $FF.
  let objTerm = false;
  while (p < limit) {
    const num = bytes[p]!;
    if (num === 0xff) {
      p += 1;
      objTerm = true;
      break;
    }
    p += 3; // num + locH + locL
    if (num === 0x00) {
      p += 1; // extended-object exnum
    } else {
      const flag = standardObjectInfo[num]! & 3;
      if (flag !== 1) p += 1; // width byte
      if (flag !== 0) p += 1; // height byte
    }
  }
  if (!objTerm || p >= limit) return { end: p, borrowedExitGate: false, terminated: false };

  const gate = bytes[p]!;
  if (exitListAbsent(gate)) {
    return gate === 0xff
      ? { end: p + 1, borrowedExitGate: false, terminated: true }
      : { end: p, borrowedExitGate: true, terminated: true };
  }

  // Exit list: 5-byte records (screen, dest_level, dest_X, dest_Y, entry); the
  // loop ends on a lone $FF where the next record's screen byte would be.
  while (p < limit) {
    if (bytes[p] === 0xff) return { end: p + 1, borrowedExitGate: false, terminated: true };
    p += 5;
  }
  return { end: p, borrowedExitGate: false, terminated: false };
}
