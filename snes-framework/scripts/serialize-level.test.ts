// Round-trip oracle for serialize-level.ts.
//
// For every playable level (CATALOG_IDS): load → serialize → compare
// against the source `.bin` byte slices. Pass = serializer is correct
// on the no-op path. Once this passes, edit operations can rely on
// the same emitters to write valid cart bytes.
//
// Run: node --experimental-strip-types snes-framework/scripts/serialize-level.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLevel, levelMapEntry } from './level.ts';
import { CATALOG_IDS } from './levels-slot-shape.ts';
import type { LevelMap } from './extract.ts';
import { serializeLevel } from './serialize-level.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workRoot = frameworkRoot;
const levelDataDir = path.join(workRoot, 'assets', 'yi', 'LevelData');
const levelMapPath = path.join(workRoot, 'editor-data', 'yi', 'level-map.json');

if (!fs.existsSync(levelMapPath)) {
  console.error(
    `serialize-level.test: level-map.json missing at ${levelMapPath}. ` +
    `Extract assets first via the editor (Workshop → ROM → Extract) or by ` +
    `running the extract pipeline.`
  );
  process.exit(2);
}

const levelMap = JSON.parse(fs.readFileSync(levelMapPath, 'utf8')) as LevelMap;

const fileCache = new Map<string, Buffer>();
function readBin(name: string): Buffer {
  let buf = fileCache.get(name);
  if (!buf) {
    buf = fs.readFileSync(path.join(levelDataDir, name));
    fileCache.set(name, buf);
  }
  return buf;
}

// Known cart-data anomalies where the on-disk byte slice is missing the
// canonical terminator. Serializer emits the full terminator (correct);
// the source is truncated at EOF. Tolerate the divergence.
//
// 0x19 sprite (DATA_14C528End.bin@0xeb): file ends mid-`0xFFFF` terminator —
// only 1 of the 2 terminator bytes is on disk. Loader consumes the
// partial. Serializer writes the full terminator (1 byte longer).
const KNOWN_TRUNCATED_TERMINATOR_SPRITES = new Set<number>([0x19]);

// 0x38 (the gm38 intro-cutscene backdrop): the cart's header has a garbage bit
// set in the PADDING past the last packed field (the 15 fields span bits 0-74;
// stream bit 75 — byte 9, mask $10 — is engine-unread slack). The serializer
// writes zero padding, so the round-trip normalizes exactly that one bit.
// Pin the exception precisely: byte 9, $70 → $60, everything else identical.
const KNOWN_HEADER_PADDING_BIT = new Set<number>([0x38]);

/** True if `actual` equals `expected` except byte 9's $10 padding bit cleared. */
function isPaddingBitNormalization(expected: Buffer, actual: Buffer): boolean {
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === actual[i]) continue;
    if (i !== 9 || (expected[i] ^ actual[i]) !== 0x10 || (expected[i] & 0x10) === 0) return false;
  }
  return true;
}

/** True if `actual` equals `expected` plus exactly N trailing `0xFF` bytes
 *  where N ∈ {1,2}. Models the truncated-terminator case. */
function isTruncatedTerminator(expected: Buffer, actual: Buffer): boolean {
  if (actual.length <= expected.length) return false;
  const extra = actual.length - expected.length;
  if (extra > 2) return false;
  if (Buffer.compare(expected, actual.subarray(0, expected.length)) !== 0) return false;
  for (let i = expected.length; i < actual.length; i++) {
    if (actual[i] !== 0xff) return false;
  }
  return true;
}

let failures = 0;
let checked = 0;
let skipped = 0;
let tolerated = 0;

function diffPreview(expected: Buffer, actual: Buffer): string {
  const len = Math.max(expected.length, actual.length);
  for (let i = 0; i < len; i++) {
    if (expected[i] !== actual[i]) {
      const lo = Math.max(0, i - 4);
      const hi = Math.min(len, i + 8);
      const e = Buffer.from(expected.subarray(lo, hi)).toString('hex');
      const a = Buffer.from(actual.subarray(lo, hi)).toString('hex');
      return `first diff at +${i}: expected ${e} actual ${a}`;
    }
  }
  return `lengths differ: expected ${expected.length} actual ${actual.length}`;
}

for (const id of CATALOG_IDS) {
  const level = loadLevel({ workRoot, levelRecordId: id });
  if (level.empty || level.special) {
    skipped++;
    continue;
  }
  checked++;
  // level-map.json is hex-keyed ("0x05"); use the tolerant lookup, not String(id).
  const entry = levelMapEntry(levelMap.levels, id)!;
  const serialized = serializeLevel({
    level,
    headerBitWidths: levelMap.headerBitWidths,
    standardObjectInfo: levelMap.standardObjectInfo
  });

  // Object section: per-level .bin is the full header + objects + exits.
  if (entry.objectFile) {
    const src = readBin(entry.objectFile);
    const lenObj =
      level.diag.headerBytes + level.diag.objectBytes + level.diag.exitBytes;
    const expected = src.subarray(0, lenObj);
    if (Buffer.compare(expected, serialized.objectBytes) !== 0) {
      if (
        KNOWN_HEADER_PADDING_BIT.has(id) &&
        isPaddingBitNormalization(Buffer.from(expected), serialized.objectBytes)
      ) {
        tolerated++;
      } else {
        console.error(
          `  ✗ level 0x${id.toString(16).padStart(2, '0')} object section ` +
            `(${entry.objectFile}): ` +
            diffPreview(Buffer.from(expected), serialized.objectBytes)
        );
        failures++;
      }
    }
  }

  // Sprite section.
  if (entry.spriteFile) {
    const src = readBin(entry.spriteFile);
    const expected = src.subarray(0, level.diag.spriteBytes);
    if (Buffer.compare(expected, serialized.spriteBytes) !== 0) {
      if (
        KNOWN_TRUNCATED_TERMINATOR_SPRITES.has(id) &&
        isTruncatedTerminator(Buffer.from(expected), serialized.spriteBytes)
      ) {
        tolerated++;
      } else {
        console.error(
          `  ✗ level 0x${id.toString(16).padStart(2, '0')} sprite section ` +
            `(${entry.spriteFile}): ` +
            diffPreview(Buffer.from(expected), serialized.spriteBytes)
        );
        failures++;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} mismatch(es) across ${checked} levels (skipped ${skipped})`);
  process.exit(1);
}
console.log(
  `PASS: ${checked} levels round-trip exactly ` +
  `(skipped ${skipped}, tolerated ${tolerated} known cart anomaly)`
);
