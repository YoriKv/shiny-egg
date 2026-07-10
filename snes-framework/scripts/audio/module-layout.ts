// Build-time audio-region layout — the write half of song import (and the
// size-integrity guard for resized sample imports). Mirrors relocate.ts's
// reconcile-from-clean-source model: every tree build re-derives Bank4E/4F/50's
// blob layout from the CURRENT (overlay-aware) file sizes and writes the build
// tree; with every size at retail the clean source passes through byte-exact,
// so an unedited V1.0 build stays byte-identical to the reference cart.
//
// Ground truth (yi/Banks/Bank4E.asm / Bank4F.asm / Bank50.asm):
//  - The audio region is the 20 upload modules laid out back-to-back across
//    SNES $4E0000..$50FFFF (three org-anchored full-64KB banks; %BANK_START
//    orgs each bank, so banks never "flow" into each other).
//  - Blobs are position-labeled `incbin`s. SNES-side pointers are `dl <label>`
//    (Bank00 DATA_SPC_ptr), so pointers follow a re-layout automatically; the
//    editor's readers resolve labels via the build's .sym.
//  - The SNES upload code streams each module CONTIGUOUSLY through the HiROM
//    mirror, so a blob crossing a bank boundary must sit flush against it:
//    banks $4E and $4F must be filled to exactly 64 KB. Retail does this with
//    two hardcoded split incbins (`:0..$13F` / `:0..$34E` + continuations —
//    asar 1.91 disallows label arithmetic in incbin ranges). A size change
//    ANYWHERE before a boundary moves the split — and can move it into a
//    different blob — so the layout pass regenerates the whole piece list
//    instead of patching literals.
//  - The engine tail's `%FREE_BYTES($50B3FA, 19462, $FF)` (V1.0) pads to the
//    region end ($510000) and is the growth budget. V1.1 pins garbage data at
//    $50B3FA (%InsertGarbageData), so size changes are V1.0-only for now.
//  - Sample-bank .bins are per-build intermediates assembled from the
//    Samples/<dir>/NN.brr assets; their size = retail + Σ(sample size deltas)
//    (each sample is a plain `incbin`, container overhead fixed). A resized
//    sample import therefore ALSO moves the splits — the pass models it.
//
// Pinned by module-layout.test.ts: the static table reproduces every label
// address + both retail splits + the retail free tail; regenerated layouts
// keep pieces flush + sum to blob sizes; unchanged sizes pass the clean
// source through untouched.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RomVersion } from '../types.ts';
import { SPC_BLOCKS, SPC_BLOCK_SAMPLE_DIRS, TITLE_IMPORT_BLOB_FILE } from './catalog.ts';

export const AUDIO_REGION_START = 0x4e0000;
export const AUDIO_REGION_END = 0x510000;
const BANK_SIZE = 0x10000;

export type AudioBlobKind = 'song' | 'bank' | 'engine';

export interface AudioBlobDef {
  /** asar label at the blob's start (referenced by Bank00's DATA_SPC_ptr). */
  label: string;
  /** incbin path under yi/, as written in the bank asm. */
  file: string;
  /** Encoded size in the retail/pristine build. */
  retailBytes: number;
  kind: AudioBlobKind;
  /** Samples/<dir> whose .brr sizes feed this assembled bin (bank/engine). */
  samplesDir?: string;
}

/** Physical ROM order of the 20 blobs (the banks' incbin order, concatenated
 *  from $4E0000) — the one fact block-id order doesn't give. Identities,
 *  retail sizes, and sample dirs come from catalog.ts (SPC_BLOCKS +
 *  SPC_BLOCK_SAMPLE_DIRS); the derivation below is pinned against the built
 *  ROM's label addresses by module-layout.test.ts. */
const AUDIO_BLOB_ORDER: readonly string[] = [
  'DATA_4E0000', 'DATA_4E169C', 'DATA_4E23BF', 'DATA_4E2C39', 'DATA_4E38D2',
  'DATA_4E3E90', 'DATA_4EBBEC', 'DATA_4ED0FE', 'DATA_4ED5D0', 'DATA_4EE279',
  'DATA_4EEC85', 'DATA_4EFEC1', 'DATA_4F205D', 'DATA_4F33F0', 'DATA_4F4122',
  'DATA_4F5C48', 'DATA_4F6E5A', 'DATA_4F82E6', 'DATA_4FFCB2', 'YI_SPCEngine',
];

/** The 20 upload modules in ROM order, derived from the catalog tables.
 *  Song blobs incbin as `SPC700/<label>.bin`; sample banks assemble from
 *  their Samples/<dir> as `SPC700/<dir>SampleBank.bin`; the engine is the
 *  one special-cased file name. */
export const AUDIO_BLOBS: readonly AudioBlobDef[] = AUDIO_BLOB_ORDER.map((label): AudioBlobDef => {
  const block = SPC_BLOCKS.find((b) => b.label === label);
  if (!block) throw new Error(`audio layout: no SPC_BLOCKS entry labeled ${label}`);
  const samplesDir = SPC_BLOCK_SAMPLE_DIRS[block.blockId];
  if (block.kind === 'engine') {
    return { label, file: 'SPC700/SPC700_Engine_YI.bin', retailBytes: block.retailBytes, kind: 'engine', samplesDir };
  }
  if (block.kind === 'samples') {
    if (!samplesDir) throw new Error(`audio layout: sample bank ${label} has no SPC_BLOCK_SAMPLE_DIRS entry`);
    return { label, file: `SPC700/${samplesDir}SampleBank.bin`, retailBytes: block.retailBytes, kind: 'bank', samplesDir };
  }
  return { label, file: `SPC700/${label}.bin`, retailBytes: block.retailBytes, kind: 'song' };
});
if (AUDIO_BLOB_ORDER.length !== SPC_BLOCKS.length) {
  throw new Error('audio layout: AUDIO_BLOB_ORDER and SPC_BLOCKS disagree on the module count');
}

/** Blob file name (under assets/yi/SPC700/) for a song-module blob label. */
export function songBlobFileOfLabel(label: string): string {
  const def = AUDIO_BLOBS.find((b) => b.label === label && b.kind === 'song');
  if (!def) throw new Error(`no song blob with label ${label}`);
  return def.file.replace(/^SPC700\//, '');
}


// ── sizes (overlay-aware) ────────────────────────────────────────────────────

export interface AudioBlobSize extends AudioBlobDef {
  /** Effective size for THIS build (overlay-aware). */
  bytes: number;
  /** Engine only: a title-import overlay blob's size, riding INSIDE the
   *  assembled engine bin (spliced into its upload stream — see
   *  renderEngineTitleImport). Included in `bytes`. */
  titleImportBytes?: number;
}

const fileSize = (p: string): number | null => (fs.existsSync(p) ? fs.statSync(p).size : null);

/**
 * Effective per-blob sizes: a song blob is its overlay `.bin` (if present)
 * else the base asset; an assembled bank/engine bin is retail plus the net
 * size delta of its overlaid samples (each `.brr` is one plain incbin, so the
 * assembled size moves 1:1 with the sample files).
 */
export function audioBlobSizes(baseAssetsYi: string, overlayAssetsYi: string | null): AudioBlobSize[] {
  const sizes = audioBlobSizesBase(baseAssetsYi, overlayAssetsYi);
  // Title import: overlay-only, spliced into the engine's upload stream at
  // build time — the assembled engine bin grows by the blob's size.
  const titleBytes = overlayAssetsYi
    ? fileSize(path.join(overlayAssetsYi, 'SPC700', TITLE_IMPORT_BLOB_FILE))
    : null;
  if (titleBytes !== null) {
    const engine = sizes.find((s) => s.kind === 'engine')!;
    engine.bytes += titleBytes;
    engine.titleImportBytes = titleBytes;
  }
  return sizes;
}

function audioBlobSizesBase(baseAssetsYi: string, overlayAssetsYi: string | null): AudioBlobSize[] {
  return AUDIO_BLOBS.map((def) => {
    if (def.kind === 'song') {
      const rel = def.file; // "SPC700/<name>.bin"
      const overlay = overlayAssetsYi ? fileSize(path.join(overlayAssetsYi, rel)) : null;
      const base = fileSize(path.join(baseAssetsYi, rel));
      const bytes = overlay ?? base;
      if (bytes === null) {
        throw new Error(`audio layout: missing base asset ${rel} — run extract first`);
      }
      return { ...def, bytes };
    }
    // bank/engine: retail + Σ(overlay sample − base sample) over the bank's
    // base sample set (sample import never adds indexes; extras are ignored).
    let delta = 0;
    if (def.samplesDir && overlayAssetsYi) {
      const baseDir = path.join(baseAssetsYi, 'SPC700', 'Samples', def.samplesDir);
      const overlayDir = path.join(overlayAssetsYi, 'SPC700', 'Samples', def.samplesDir);
      if (fs.existsSync(baseDir) && fs.existsSync(overlayDir)) {
        for (const name of fs.readdirSync(baseDir)) {
          if (!name.toLowerCase().endsWith('.brr')) continue;
          const o = fileSize(path.join(overlayDir, name));
          if (o === null) continue;
          const b = fileSize(path.join(baseDir, name));
          if (b !== null) delta += o - b;
        }
      }
    }
    return { ...def, bytes: def.retailBytes + delta };
  });
}

// ── placement ────────────────────────────────────────────────────────────────

export interface AudioPlacement extends AudioBlobSize {
  /** SNES start address ($4E0000-based region). */
  start: number;
  end: number;
}

export interface AudioLayout {
  placements: AudioPlacement[];
  /** SNES address where the engine tail's free space begins. */
  freeStart: number;
  /** Bytes to $510000 — negative = over budget. */
  freeBytes: number;
  /** True when any blob's size differs from retail (layout must be emitted). */
  changed: boolean;
}

export function planAudioLayout(sizes: AudioBlobSize[]): AudioLayout {
  let addr = AUDIO_REGION_START;
  const placements: AudioPlacement[] = sizes.map((s) => {
    const p = { ...s, start: addr, end: addr + s.bytes };
    addr += s.bytes;
    return p;
  });
  return {
    placements,
    freeStart: addr,
    freeBytes: AUDIO_REGION_END - addr,
    changed: sizes.some((s) => s.bytes !== s.retailBytes),
  };
}

// ── bank text emission ───────────────────────────────────────────────────────

/** One incbin piece of a bank's body: a whole blob or a boundary slice. */
interface BankPiece {
  placement: AudioPlacement;
  /** Byte range within the blob's file. */
  from: number;
  to: number;
  /** The blob starts here (emit its label). */
  labeled: boolean;
}

function bankPieces(layout: AudioLayout, bank: number): BankPiece[] {
  const lo = bank << 16;
  const hi = lo + BANK_SIZE;
  const pieces: BankPiece[] = [];
  for (const p of layout.placements) {
    const start = Math.max(p.start, lo);
    const end = Math.min(p.end, hi);
    if (end <= start) continue;
    pieces.push({ placement: p, from: start - p.start, to: end - p.start, labeled: start === p.start });
  }
  return pieces;
}

const hexU = (n: number): string => '$' + n.toString(16).toUpperCase();
const snesHex = (n: number): string => '$' + n.toString(16).toUpperCase().padStart(6, '0');

function pieceText(piece: BankPiece): string {
  const { placement: p, from, to } = piece;
  const whole = from === 0 && to === p.bytes;
  const range = whole
    ? ''
    : to === p.bytes
      ? `:${hexU(from)}..filesize("${p.file}")`
      : `:${hexU(from)}..${hexU(to)}`;
  const incbin = `\tincbin "${p.file}"${range}`;
  return piece.labeled ? `${p.label}:\n${incbin}` : incbin;
}

/**
 * Regenerate one bank file's blob body for a changed layout: everything
 * between the `%EnableSuperFXHiROMMirroring(...)` line and the
 * `%BANK_END(...)` line is replaced with the bank's pieces (plus, for the
 * last bank, the shifted `%FREE_BYTES` tail). Anchors and everything outside
 * them — the macro wrapper, header comments — pass through untouched.
 */
export function renderAudioBankText(cleanText: string, layout: AudioLayout, bank: number): string {
  const nl = cleanText.includes('\r\n') ? '\r\n' : '\n';
  const startRe = /^.*%EnableSuperFXHiROMMirroring\([^)]*\).*$/m;
  const endRe = /^.*%BANK_END\([^)]*\).*$/m;
  const startM = startRe.exec(cleanText);
  const endM = endRe.exec(cleanText);
  if (!startM || !endM || endM.index <= startM.index) {
    throw new Error(`audio layout: bank $${bank.toString(16)} asm is missing its mirroring/%BANK_END anchors`);
  }
  const bodyStart = startM.index + startM[0].length;
  const bodyEnd = endM.index;

  const parts = bankPieces(layout, bank).map(pieceText);
  if (bank === (AUDIO_REGION_END >> 16) - 1) {
    if (layout.freeBytes < 0) {
      throw new Error(
        `audio layout: modules overflow the region by ${-layout.freeBytes} byte(s) (free space is 19462 in the pristine build)`
      );
    }
    if (layout.freeBytes > 0) {
      parts.push(`%FREE_BYTES(${snesHex(layout.freeStart)}, ${layout.freeBytes}, $FF)`);
    }
  }
  const body = `\n${parts.join('\n\n')}\n\n`.replace(/\n/g, nl);
  return cleanText.slice(0, bodyStart) + body + cleanText.slice(bodyEnd);
}

// ── engine-stream splice (title import) ──────────────────────────────────────

/** The engine asm's stream terminator — the splice anchor. */
const ENGINE_STREAM_END = /^.*%EndSPCUploadAndJumpToEngine\([^)]*\).*$/m;
const ENGINE_ASM_FILE = 'SPC700/SPC700_Engine_YI.asm';

/**
 * Splice the title-import blob into the engine's upload stream: an `incbin`
 * right before the asm's `%EndSPCUploadAndJumpToEngine` terminator. The blob
 * is a complete serialized module (its own terminator+entry included), so
 * the upload ends there and the macro's 4 bytes become dead tail — every
 * reader keeps seeing one module (block $2B), and the Title setting (plus
 * reset, which uploads the driver) carries the import with ZERO table edits.
 * (Bank00's DATA_SPC_ptr can't grow — address-pinned code follows it.)
 */
export function renderEngineTitleImport(cleanText: string): string {
  const m = ENGINE_STREAM_END.exec(cleanText);
  if (!m) {
    throw new Error("audio layout: the engine asm's %EndSPCUploadAndJumpToEngine anchor drifted — can't splice the title import");
  }
  const nl = cleanText.includes('\r\n') ? '\r\n' : '\n';
  const splice =
    `; title song import (song-import overlay; emitted by the audio layout pass)${nl}` +
    `\tincbin "SPC700/${TITLE_IMPORT_BLOB_FILE}"${nl}`;
  return cleanText.slice(0, m.index) + splice + cleanText.slice(m.index);
}

// ── apply (reconcile the build tree) ─────────────────────────────────────────

const BANK50_FILE = 'Banks/Bank50.asm';
/** The pristine V1.0 tail — its presence proves nothing else (level-data
 *  relocation into FreeRegion50, gfx overflow spill) claimed the region. */
const PRISTINE_TAIL = '%FREE_BYTES($50B3FA, 19462, $FF)';

export interface ApplyAudioLayoutOptions {
  /**
   * True when the level-data layout pass already reconciled Bank50.asm into
   * the tree this build. Bank50 is SHARED: its free tail is also the level
   * pass's FreeRegion50 (and the gfx overflow spill target), and that pass
   * reconciles the file from clean source every tree build — so this pass
   * must run AFTER it, leave Bank50 alone when the audio layout is
   * unchanged, and refuse (loudly) when both want the tail.
   */
  bank50AlreadyReconciled: boolean;
}

/**
 * Reconcile the audio bank files into the build tree. Banks $4E/$4F are
 * audio-owned and reconcile from clean source (overlay-if-present else base)
 * every build — unchanged layout passes them through byte-exact, clearing
 * any stale layout from a previous build. Bank $50 is shared (see options).
 * Changed layout on V1.1 throws — its garbage-data blob is pinned at $50B3FA.
 */
export function applyAudioModuleLayout(
  baseYiRoot: string,
  overlayYiRoot: string | null,
  treeYiRoot: string,
  sizes: AudioBlobSize[],
  romVersion: RomVersion,
  opts: ApplyAudioLayoutOptions
): AudioLayout {
  const layout = planAudioLayout(sizes);
  if (layout.changed && romVersion !== 'YI_U1') {
    const changedBlobs = sizes.filter((s) => s.bytes !== s.retailBytes).map((s) => s.label);
    throw new Error(
      `audio layout: module sizes changed (${changedBlobs.join(', ')}) but re-layout is V1.0-only ` +
        `(V1.1 pins garbage data at $50B3FA)`
    );
  }
  if (layout.freeBytes < 0) {
    throw new Error(
      `audio layout: modules overflow the region by ${-layout.freeBytes} byte(s) — shrink or revert an imported song`
    );
  }
  const cleanSource = (rel: string): string => {
    const overlaid = overlayYiRoot ? path.join(overlayYiRoot, rel) : null;
    const src = overlaid && fs.existsSync(overlaid) ? overlaid : path.join(baseYiRoot, rel);
    return fs.readFileSync(src, 'utf8');
  };
  const write = (rel: string, text: string): void => {
    const dest = path.join(treeYiRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, 'utf8');
  };

  for (const [bank, rel] of [
    [0x4e, 'Banks/Bank4E.asm'],
    [0x4f, 'Banks/Bank4F.asm'],
  ] as const) {
    const clean = cleanSource(rel);
    write(rel, layout.changed ? renderAudioBankText(clean, layout, bank) : clean);
  }

  if (layout.changed) {
    // Regenerate Bank50's body over whatever the level/gfx passes produced —
    // legal only while the free tail is still pristine (both passes rewrite
    // the %FREE_BYTES line when they claim it).
    const treeCopy = path.join(treeYiRoot, BANK50_FILE);
    const source =
      opts.bank50AlreadyReconciled && fs.existsSync(treeCopy)
        ? fs.readFileSync(treeCopy, 'utf8')
        : cleanSource(BANK50_FILE);
    if (!source.includes(PRISTINE_TAIL)) {
      throw new Error(
        'audio layout: the $50 free tail is already claimed (relocated level data or gfx overflow) — ' +
          'free up region $51 space (un-migrate a level / shrink graphics) or revert the imported song'
      );
    }
    write(BANK50_FILE, renderAudioBankText(source, layout, 0x50));
  } else if (!opts.bank50AlreadyReconciled) {
    // No level pass ran this build (no pool map yet) — reconcile Bank50 from
    // clean source ourselves so a previous build's audio layout can't go stale.
    write(BANK50_FILE, cleanSource(BANK50_FILE));
  }

  // The engine asm is audio-owned — reconcile it every build: spliced when a
  // title import is in effect, clean otherwise (clears a stale splice).
  const titleImport = sizes.find((s) => s.kind === 'engine')?.titleImportBytes !== undefined;
  const engineClean = cleanSource(ENGINE_ASM_FILE);
  write(ENGINE_ASM_FILE, titleImport ? renderEngineTitleImport(engineClean) : engineClean);
  return layout;
}
