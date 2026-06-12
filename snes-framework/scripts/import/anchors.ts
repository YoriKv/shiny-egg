// ROM-import anchor resolution (plan-rom-import.md §5). A third-party hack has
// "drifted" — level streams are repointed into expanded ROM — but the editors
// that make YI hacks (GoldenEgg and kin) keep the TOP-LEVEL tables where the
// engine reads them and only move the data those tables point at. Decoding is
// format-driven, so we:
//
//   1. Assume each top-level table is at its unmodified V1.0 address.
//   2. VALIDATE that assumption by following the pointers: a pointer-table entry
//      "is a level" iff it points at a parseable level header + stream. We
//      accept the table iff (nearly) every record that's a level in the base
//      cart still resolves to a valid level here. This is immune to relocated
//      STREAMS (their pointers changed, but still point at valid levels) and
//      needs no asm/signature work.
//
// A cart that relocated the TABLE itself (rare for GoldenEgg-style edits), or
// that isn't V1.0-derived, fails validation → the anchor is reported
// `unresolved` so the UI explains it rather than guessing. `overrides` is the
// escape hatch (a user-supplied address) if that ever shows up.

import { snesToPC, vendoredV10SymbolMap } from '../engine/symbol-map.ts';
import { u24le } from '../engine/rom-read.ts';
import type { AnchorResolution } from '../types.ts';

/** Number of level-data pointer-table entries (data-record indices). */
export const LEVEL_COUNT = 222;

/** Expected V1.0 header bit-widths (15 fields, MSB-first). Used to confirm a
 *  cart is V1.0-derived and to validate the header-bit-widths anchor. */
const EXPECTED_HEADER_WIDTHS = [5, 4, 5, 5, 6, 6, 6, 7, 4, 5, 6, 5, 5, 4, 2];

/** Sentinel stream pointers — vanilla points two record slots at 1-byte/garbage
 *  placeholders, not real streams (see extract.ts). Skipped on read. */
export const SENTINEL_OBJ_SNES = 0x15fcea;
export const SENTINEL_SPR_SNES = 0x15ffd5;

/** Resolved PC offsets for the tables the level-placement importer needs. */
export interface ImportAnchors {
  levelPtrsPc: number;
  headerBitWidthsPc: number;
  objectPropertyTablePc: number;
}

interface AnchorSpec {
  key: string;
  label: string;
  symbol: string;
  /** Required for level-placement import (analysis aborts level diff without it). */
  required: boolean;
}

const ANCHOR_SPECS: AnchorSpec[] = [
  {
    key: 'levelPtrs',
    label: 'Level-data pointer table',
    symbol: 'YI_LevelDataPtrsAndEntranceData_Ptrs',
    required: true
  },
  {
    key: 'headerBitWidths',
    label: 'Header bit-widths',
    symbol: 'DATA_header_bit_length',
    required: true
  },
  {
    key: 'objectPropertyTable',
    label: 'Standard-object property table',
    symbol: 'DATA_object_property_table',
    required: true
  }
  // The world-map entrance tables (DATA_level_entrance_indexes /
  // DATA_map_level_entrances) aren't anchored here. World-map import (the entrance
  // + midway RECORD tables) DID land (plan-rom-import.md P6), but it reads them at
  // their vanilla bank-$17 address gated by `baseDerived` — the same in-place
  // strategy palette / level-name import uses — rather than through this ladder.
  // See src/main/rom-import.ts `analyzeWorldMap` + import/foreign-world-map.ts.
];

/** Vanilla V1.0 PC for each anchor symbol (the rung-A starting address). */
function vanillaPcFor(symbol: string): number {
  return vendoredV10SymbolMap().pc(symbol);
}

/** The unmodified V1.0 anchor addresses — used to read the BASE cart's streams
 *  (its layout is, by definition, vanilla) for the import diff. */
export function vanillaAnchors(): ImportAnchors {
  return {
    levelPtrsPc: vanillaPcFor('YI_LevelDataPtrsAndEntranceData_Ptrs'),
    headerBitWidthsPc: vanillaPcFor('DATA_header_bit_length'),
    objectPropertyTablePc: vanillaPcFor('DATA_object_property_table')
  };
}

/** SNES 24-bit pointer → PC, or null when it doesn't map into `romLen` bytes. */
function safePtrToPc(snes: number, romLen: number): number | null {
  if (snes === 0) return null;
  const pc = snesToPC(snes);
  return pc >= 0 && pc < romLen ? pc : null;
}

/** Bytes the bit-packed header occupies (sum of the 15 widths, rounded up). */
const HEADER_BYTES = Math.ceil(EXPECTED_HEADER_WIDTHS.reduce((a, b) => a + b, 0) / 8);

/** Read the 256-byte standard-object property table at `pc`. */
function readPropertyTable(cart: Buffer, pc: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 256; i++) out.push(cart[pc + i] ?? 0);
  return out;
}

/**
 * Does `objSnes` point at a well-formed level object stream — a bit-packed
 * header followed by an object list terminated by `$FF`, then a screen-exit
 * list terminated by `$FF`, all in-bounds and within a tight cap? This is the
 * whole validation strategy: a pointer-table entry "is a level" iff it points
 * at a parseable level header + stream. It doesn't care WHERE the stream lives,
 * so it's immune to a hack relocating/repointing streams (GoldenEgg writes the
 * pointer table in place + repoints each level's data into free space). A
 * pointer into code/garbage almost never walks to both terminators cleanly.
 */
export function pointsAtValidObjStream(cart: Buffer, objSnes: number, info: number[]): boolean {
  if (objSnes === SENTINEL_OBJ_SNES) return false;
  const start = safePtrToPc(objSnes, cart.length);
  if (start === null) return false;
  // A real obj stream is at most ~2 KB; cap well under the 32 KB bank so a
  // garbage pointer that never hits a terminator is rejected, not walked.
  const cap = Math.min(cart.length, start + 0x2000);
  let p = start + HEADER_BYTES;

  let objTerm = false;
  while (p < cap) {
    const num = cart[p];
    if (num === 0xff) {
      p += 1;
      objTerm = true;
      break;
    }
    p += 3; // num + locH + locL
    if (num === 0x00) {
      p += 1; // extended-object exnum
    } else {
      const flag = info[num]! & 3;
      if (flag !== 1) p += 1; // width byte
      if (flag !== 0) p += 1; // height byte
    }
  }
  if (!objTerm) return false;

  while (p < cap) {
    if (cart[p] === 0xff) return p + 1 <= cart.length;
    p += 5; // 5-byte exit record
  }
  return false; // hit the cap without an exit-list terminator
}

/** Generous sprite-stream cap: 512 records × 3 B (vanilla's largest is ~98). A
 *  real stream terminates far inside this; a clobbered/garbage region doesn't. */
const SPR_VALID_CAP = 0x600;

/**
 * Does `sprSnes` point at a well-formed sprite stream — 3-byte records reaching
 * a `$FFFF` terminator ON the 3-byte stride within a sane cap? A record whose
 * old data region was reused by the hack (GoldenEgg's free-space allocator)
 * over-reads past the real terminator / lands off-stride; this rejects those.
 * Zero / sentinel pointer = "no sprites", which is legitimately valid.
 */
export function pointsAtValidSprStream(cart: Buffer, sprSnes: number): boolean {
  if (sprSnes === 0 || sprSnes === SENTINEL_SPR_SNES) return true;
  const start = safePtrToPc(sprSnes, cart.length);
  if (start === null) return false;
  const cap = Math.min(cart.length, start + SPR_VALID_CAP);
  for (let p = start; p + 1 < cap; p += 3) {
    if ((cart[p] | (cart[p + 1] << 8)) === 0xffff) return true;
  }
  return false; // hit the cap without a stride-aligned terminator
}

interface PtrsScore {
  /** Records that are real levels in the base cart (the denominator). */
  known: number;
  /** Of those, how many the foreign cart's pointer points at a valid level. */
  valid: number;
  /** valid / known (1 = every base level still points at a level). */
  score: number;
}

/**
 * Score the pointer table at `pc` by asking, for every record that is a real
 * level in the BASE cart, whether the FOREIGN cart's same-index pointer also
 * points at a valid level. Restricting the denominator to known-real levels
 * skips the ~95 unbacked/code slots (whose pointers aren't levels in either
 * cart), so the score is just "did the hack keep all the levels parseable" —
 * 1.0 for vanilla and for any in-place GoldenEgg edit, dropping only if a level
 * is corrupted or the table isn't actually here.
 */
function scoreLevelPtrs(cart: Buffer, pc: number, baseCart: Buffer, basePc: number): PtrsScore {
  const propPc = vanillaPcFor('DATA_object_property_table');
  const baseInfo = readPropertyTable(baseCart, propPc);
  const foreignInfo = readPropertyTable(cart, propPc);
  let known = 0;
  let valid = 0;
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const bOff = basePc + i * 6;
    const fOff = pc + i * 6;
    if (bOff + 3 > baseCart.length || fOff + 3 > cart.length) break;
    if (!pointsAtValidObjStream(baseCart, u24le(baseCart, bOff), baseInfo)) continue;
    known++;
    if (pointsAtValidObjStream(cart, u24le(cart, fOff), foreignInfo)) valid++;
  }
  return { known, valid, score: known > 0 ? valid / known : 0 };
}

/** True when `cart`'s header-bit-widths at `pc` match the expected V1.0 set. */
function headerWidthsMatch(cart: Buffer, pc: number): boolean {
  for (let i = 0; i < EXPECTED_HEADER_WIDTHS.length; i++) {
    if (cart[pc + i] !== EXPECTED_HEADER_WIDTHS[i]) return false;
  }
  return cart[pc + EXPECTED_HEADER_WIDTHS.length] === 0; // zero-terminated
}

/** True when the 256-byte property table at `pc` matches the base cart's. */
function propertyTableMatch(cart: Buffer, pc: number, baseCart: Buffer, basePc: number): boolean {
  for (let i = 0; i < 256; i++) {
    if (cart[pc + i] !== baseCart[basePc + i]) return false;
  }
  return true;
}

export interface ResolveAnchorsResult {
  anchors: AnchorResolution[];
  /** Resolved addresses, or null when the required `levelPtrs` anchor failed. */
  resolved: ImportAnchors | null;
  /** Whether the foreign cart looks V1.0-derived (engine constants validate). */
  baseDerived: boolean;
}

/**
 * Resolve every anchor in a foreign cart against the base V1.0 cart. `overrides`
 * (rung D) maps an anchor key → forced PC offset, bypassing the ladder for that
 * table — the hook for the UI's manual-address / `.sym` escape hatch.
 */
export function resolveAnchors(
  cart: Buffer,
  baseCart: Buffer,
  overrides: Record<string, number> = {}
): ResolveAnchorsResult {
  const anchors: AnchorResolution[] = [];
  const byKey = new Map<string, AnchorResolution>();

  for (const spec of ANCHOR_SPECS) {
    const vanillaPc = vanillaPcFor(spec.symbol);
    let res: AnchorResolution;

    if (overrides[spec.key] !== undefined) {
      res = {
        key: spec.key,
        label: spec.label,
        vanillaPc,
        pc: overrides[spec.key],
        method: 'manual',
        confidence: 1,
        required: spec.required,
        note: 'User-supplied address.'
      };
    } else {
      res = resolveOne(spec, vanillaPc, cart, baseCart);
    }
    anchors.push(res);
    byKey.set(spec.key, res);
  }

  const headerOk = byKey.get('headerBitWidths')?.pc !== null;
  const propOk = byKey.get('objectPropertyTable')?.pc !== null;
  const baseDerived = !!headerOk && !!propOk;

  const levelPtrs = byKey.get('levelPtrs');
  let resolved: ImportAnchors | null = null;
  if (levelPtrs?.pc !== null && levelPtrs !== undefined && headerOk && propOk) {
    resolved = {
      levelPtrsPc: levelPtrs.pc as number,
      headerBitWidthsPc: byKey.get('headerBitWidths')!.pc as number,
      objectPropertyTablePc: byKey.get('objectPropertyTable')!.pc as number
    };
  }

  return { anchors, resolved, baseDerived };
}

/** Resolve one anchor: assume it's at the vanilla address and validate there.
 *  Fails to `unresolved` (never guesses an alternate location). */
function resolveOne(
  spec: AnchorSpec,
  vanillaPc: number,
  cart: Buffer,
  baseCart: Buffer
): AnchorResolution {
  const base = (pc: number | null, method: AnchorResolution['method'], confidence: number, note?: string): AnchorResolution => ({
    key: spec.key,
    label: spec.label,
    vanillaPc,
    pc,
    method,
    confidence,
    required: spec.required,
    ...(note ? { note } : {})
  });

  switch (spec.key) {
    case 'headerBitWidths': {
      if (vanillaPc + EXPECTED_HEADER_WIDTHS.length < cart.length && headerWidthsMatch(cart, vanillaPc)) {
        return base(vanillaPc, 'vanilla-addr', 1);
      }
      return base(null, 'unresolved', 0, 'Header bit-widths differ from V1.0 — cart may not be V1.0-derived.');
    }
    case 'objectPropertyTable': {
      if (vanillaPc + 256 < cart.length && propertyTableMatch(cart, vanillaPc, baseCart, vanillaPc)) {
        return base(vanillaPc, 'vanilla-addr', 1);
      }
      return base(null, 'unresolved', 0, 'Object property table differs from V1.0.');
    }
    case 'levelPtrs': {
      // Assume the table is where V1.0 keeps it and validate by following its
      // pointers: accept iff (nearly) every record that's a level in the base
      // still points at a parseable level in this cart. Immune to relocated
      // streams (GoldenEgg edits in place + repoints data into free space); only
      // a moved TABLE or a non-V1.0 cart fails here.
      const s = scoreLevelPtrs(cart, vanillaPc, baseCart, vanillaPc);
      if (s.known >= 40 && s.score >= 0.9) {
        // Confidence == the validated fraction (1.0 = every base level still
        // resolves). No artificial cap — a perfect match should read 100%.
        return base(vanillaPc, 'vanilla-addr', s.score,
          `${s.valid}/${s.known} level pointers resolve to valid level data.`);
      }
      return base(null, 'unresolved', 0,
        `Only ${s.valid}/${s.known} pointers at the V1.0 table address resolve to valid levels — ` +
        'the level table isn’t where V1.0 keeps it, or this isn’t a V1.0-based ROM.');
    }
    default:
      // No other anchors are registered (entrance tables removed — see
      // ANCHOR_SPECS). Defensive: an unexpected key resolves to unresolved.
      return base(null, 'unresolved', 0);
  }
}
