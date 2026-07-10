// N-SPC track encoder — the write half of the sequence codec. Serializes a
// TrackEvent stream back to bytes, mirroring decodeTrack's grammar exactly:
// encode(decode(bytes)) is byte-identical for every track in the shipped
// songs (pinned by sequence-encode.test.ts — the byte-identity gate the
// sequence editor builds on).
//
// Grammar notes the encoder enforces (see sequence.ts for the decode side):
//  - length events emit the ticks byte, plus the quantize/velocity byte when
//    present (gate 0-7 high nibble, velocity 0-15 low nibble — always <$80).
//  - A `note` with note < $80 is only legal DIRECTLY after a length event
//    that carried gate/velocity (the engine consumes that position without a
//    sign check); anywhere else it would re-parse as a length byte. The
//    encoder validates this so an edited stream can't silently corrupt.
//  - vcmd args must match the engine's arg counts.

import { VCMDS, type TrackEvent } from './sequence.ts';

const VCMD_BY_OP = new Map(VCMDS.map((v) => [v.op, v]));

/** Serialize one track/subroutine body, INCLUDING the $00 terminator.
 *  Consumed only by the byte-identity gate (sequence-encode.test.ts) until
 *  the song-edit milestone lands. */
export function encodeTrack(events: readonly TrackEvent[]): Uint8Array {
  const out: number[] = [];
  let afterLenQv = false;
  for (const [i, ev] of events.entries()) {
    switch (ev.kind) {
      case 'length': {
        if (ev.ticks < 1 || ev.ticks > 0x7f || !Number.isInteger(ev.ticks)) {
          throw new Error(`event ${i}: length ticks ${ev.ticks} out of range 1-127`);
        }
        out.push(ev.ticks);
        const hasQv = ev.gate !== undefined || ev.velocity !== undefined;
        if (hasQv) {
          const gate = ev.gate ?? 0;
          const velocity = ev.velocity ?? 0;
          if (gate < 0 || gate > 7 || velocity < 0 || velocity > 15) {
            throw new Error(`event ${i}: gate ${gate}/velocity ${velocity} out of range`);
          }
          out.push((gate << 4) | velocity);
          afterLenQv = true;
        } else {
          afterLenQv = false;
        }
        continue;
      }
      case 'note': {
        if (ev.note < 0x80 && !afterLenQv) {
          throw new Error(
            `event ${i}: note byte 0x${ev.note.toString(16)} < 0x80 is only valid directly after a length+quantize event`
          );
        }
        if (ev.note < 0 || ev.note > 0xc7) {
          throw new Error(`event ${i}: note byte 0x${ev.note.toString(16)} out of range`);
        }
        out.push(ev.note);
        break;
      }
      case 'tie':
        out.push(0xc8);
        break;
      case 'rest':
        out.push(0xc9);
        break;
      case 'perc': {
        if (ev.index < 0 || ev.index > 0x15) {
          throw new Error(`event ${i}: percussion index ${ev.index} out of range 0-21`);
        }
        out.push(0xca + ev.index);
        break;
      }
      case 'vcmd': {
        const info = VCMD_BY_OP.get(ev.op);
        if (!info) throw new Error(`event ${i}: unknown vcmd 0x${ev.op.toString(16)}`);
        if (ev.args.length !== info.argCount) {
          throw new Error(
            `event ${i}: ${info.name} takes ${info.argCount} arg(s), got ${ev.args.length}`
          );
        }
        out.push(ev.op);
        for (const a of ev.args) {
          if (a < 0 || a > 0xff || !Number.isInteger(a)) {
            throw new Error(`event ${i}: ${info.name} arg ${a} out of byte range`);
          }
          out.push(a);
        }
        break;
      }
    }
    afterLenQv = false;
  }
  out.push(0x00);
  return new Uint8Array(out);
}
