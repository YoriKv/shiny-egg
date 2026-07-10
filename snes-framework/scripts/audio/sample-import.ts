// Sample import pipeline (the write half of the Export tab's samples story)
// — the graphics-pipeline model applied to audio (plan §4): the manifest
// written at export time carries per-sample checksums, and import is
// BASE-AWARE: a .wav whose bytes still match its export-time checksum is
// skipped (and any stale overlay for it is reverted so the base's original
// BRR bytes win again); only genuinely edited .wavs re-encode. Re-encoding
// is lossy, so this gate is what keeps untouched samples byte-exact.
//
// Everything here is dir-parameterized (plain node:fs on caller-supplied
// paths) so the whole pipeline is testable outside Electron; the app's main
// process wraps it with the real project paths + atomic writes + change
// metadata (src/main/audio.ts).
//
// Size rule (Phase 2 scope): an edited sample must fit within its base .brr
// byte length. Shrinking is allowed (the asar wrapper relayouts the bank —
// labels shift, the ARAM window only shrinks); growth needs the bank-budget
// work planned for later. Loop STARTS live in the bank wrapper asm's sample
// directory (`dw DATA_x : dw DATA_x+$off`), not in the .brr — imports
// preserve the base loop flag and warn when the directory's loop offset
// points past the new end.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeBrr } from './brr.ts';
import { encodeBrr } from './brr-encode.ts';
import { parseWavPcm16 } from './wav.ts';

export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export interface SampleManifestEntry {
  /** Bank directory name (e.g. "Global"). */
  bank: string;
  /** Base .brr file name (e.g. "07.brr"). */
  file: string;
  /** sha256 of the base .brr bytes at export time. */
  brrSha256: string;
  /** sha256 of the exported .wav at export time — the unchanged gate. */
  wavSha256: string;
  brrBytes: number;
  /** End-block loop flag of the base sample. */
  loop: boolean;
  /** Loop start as a byte offset into the sample (from the bank wrapper's
   *  sample directory), null when the directory entry has no offset. */
  loopOffset: number | null;
}

export interface SampleManifest {
  version: 1;
  entries: SampleManifestEntry[];
}

export const SAMPLE_MANIFEST_NAME = 'manifest.json';

/** Parse per-sample loop byte offsets from a bank wrapper asm: joins the
 *  ARAM sample directory's `dw DATA_x : dw DATA_x+$off` entries to the
 *  `DATA_x: incbin "Samples/<Bank>/NN.brr"` lines BY LABEL (positional
 *  mapping breaks on the Bowser bank, whose directory holds `$FFFF`
 *  placeholders and duplicate entries — two SRCNs sharing one sample).
 *  Directory matching is scoped to `%SPCDataBlockStart(3Cxx)` blocks so it
 *  also works on SPC700_Engine_YI.asm (the TitleScreen bank).
 *  Returns .brr file name → loop byte offset (null = entry has no offset). */
export function parseSampleLoopOffsets(asmText: string): Map<string, number | null> {
  const offsetByLabel = new Map<string, number | null>();
  const blockRe = /%SPCDataBlockStart\(3[Cc]\w*\)([\s\S]*?)%SPCDataBlockEnd\(/g;
  for (const block of asmText.matchAll(blockRe)) {
    for (const m of block[1].matchAll(/dw\s+(DATA_\w+)\s*:\s*dw\s+\1(?:\s*\+\s*\$([0-9A-Fa-f]+))?/g)) {
      offsetByLabel.set(m[1], m[2] !== undefined ? parseInt(m[2], 16) : null);
    }
  }
  const out = new Map<string, number | null>();
  for (const m of asmText.matchAll(/(DATA_\w+):\s*\r?\n\s*incbin\s+"Samples\/[^/"]+\/([^"]+\.brr)"/gi)) {
    if (offsetByLabel.has(m[1])) out.set(m[2], offsetByLabel.get(m[1])!);
  }
  return out;
}

export interface SampleImportItem {
  bank: string;
  /** .wav file name the item was driven by. */
  wav: string;
  /** Base .brr file name. */
  file: string;
  action: 'unchanged' | 'reverted' | 'import' | 'rejected';
  /** Human-readable detail (rejection reason, warnings). */
  message?: string;
  warnings: string[];
  baseBytes?: number;
  newBytes?: number;
  /** True when the re-encoded sample is byte-length-equal to base (the
   *  composer can live-splice it; others preview after a rebuild). */
  sameSize?: boolean;
}

export interface SampleImportPlan {
  items: SampleImportItem[];
  /** Overlay writes to apply (bankRel = "<bank>/<file>"). */
  writes: Array<{ bankRel: string; bytes: Uint8Array }>;
  /** Overlay files to remove (wav restored to its export-time bytes). */
  reverts: string[];
}

export interface SampleImportDirs {
  /** The export folder's samples root (`<projectRoot>/audio/samples`). */
  exportSamplesDir: string;
  /** Project overlay samples root
   *  (`<overlayRoot>/assets/yi/SPC700/Samples`) — read-only here; the
   *  caller applies `writes`/`reverts`. Base sizes/checksums come from the
   *  manifest, so the base samples dir itself isn't consulted. */
  overlaySamplesDir: string;
}

/** Walk every `<bank>/NN.wav` under the export dir and decide, per sample,
 *  whether to skip (checksum unchanged), revert a stale overlay, re-encode
 *  and import, or reject (with why). Pure planning — no writes. */
export function planSampleImport(dirs: SampleImportDirs, manifest: SampleManifest): SampleImportPlan {
  const items: SampleImportItem[] = [];
  const writes: SampleImportPlan['writes'] = [];
  const reverts: string[] = [];
  const byKey = new Map<string, SampleManifestEntry>();
  for (const e of manifest.entries) byKey.set(`${e.bank}/${e.file}`, e);

  if (!fs.existsSync(dirs.exportSamplesDir)) return { items, writes, reverts };
  for (const bank of fs.readdirSync(dirs.exportSamplesDir).sort()) {
    const bankDir = path.join(dirs.exportSamplesDir, bank);
    if (!fs.statSync(bankDir).isDirectory()) continue;
    for (const wavName of fs.readdirSync(bankDir).filter((f) => f.toLowerCase().endsWith('.wav')).sort()) {
      const file = wavName.replace(/\.wav$/i, '.brr');
      const bankRel = `${bank}/${file}`;
      const entry = byKey.get(bankRel);
      const overlayPath = path.join(dirs.overlaySamplesDir, bank, file);
      const item: SampleImportItem = { bank, wav: wavName, file, action: 'unchanged', warnings: [] };
      items.push(item);
      if (!entry) {
        item.action = 'rejected';
        item.message = 'not in the export manifest — re-run Export Samples first';
        continue;
      }
      const wavBytes = new Uint8Array(fs.readFileSync(path.join(bankDir, wavName)));
      if (sha256Hex(wavBytes) === entry.wavSha256) {
        // Untouched since export. If an overlay exists from an earlier
        // import, the user has restored the file — revert to base bytes.
        if (fs.existsSync(overlayPath)) {
          item.action = 'reverted';
          item.message = 'restored to the exported waveform — project override removed, base bytes back in effect';
          reverts.push(bankRel);
        }
        continue;
      }

      let pcm: Int16Array;
      let sampleRate: number;
      try {
        const parsed = parseWavPcm16(wavBytes);
        pcm = parsed.pcm;
        sampleRate = parsed.sampleRate;
      } catch (e) {
        item.action = 'rejected';
        item.message = (e as Error).message;
        continue;
      }
      if (sampleRate !== 32000) {
        item.warnings.push(`WAV is ${sampleRate} Hz — BRR carries no rate, so the content plays at DSP pitch (expect a speed/pitch shift); export at 32000 Hz to keep pitch`);
      }
      const encoded = encodeBrr(pcm, { loop: entry.loop });
      item.baseBytes = entry.brrBytes;
      item.newBytes = encoded.length;
      if (encoded.length > entry.brrBytes) {
        item.action = 'rejected';
        item.message =
          `too long: ${encoded.length} bytes BRR vs the sample's ${entry.brrBytes}-byte slot ` +
          `(${Math.floor((entry.brrBytes / 9) * 16)} PCM samples max) — trim the waveform; bank growth comes in a later phase`;
        continue;
      }
      if (entry.loop && entry.loopOffset !== null && entry.loopOffset >= encoded.length) {
        item.warnings.push(
          `loop start (byte 0x${entry.loopOffset.toString(16)}) is past the new end — in-game the loop will read stale bank data; keep the sample longer or wait for loop-point editing`
        );
      }
      item.sameSize = encoded.length === entry.brrBytes;
      item.action = 'import';
      writes.push({ bankRel, bytes: encoded });
    }
  }
  return { items, writes, reverts };
}
