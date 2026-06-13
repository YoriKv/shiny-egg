// Persistent record of the most recent successful asset extraction. Written
// at the end of extractAssets() and read by the editor at startup so the
// renderer can show "currently extracted: USA V1.1" and so build operations
// can pick up the version without having to re-detect.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtractFreshness, ExtractionState } from './types.ts';
export type { ExtractFreshness, ExtractionState } from './types.ts';

const STATE_FILE = '.extraction-state.json';

function statePath(workRoot: string): string {
  return path.join(workRoot, STATE_FILE);
}

export function readExtractionState(workRoot: string): ExtractionState | null {
  const p = statePath(workRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ExtractionState;
  } catch {
    return null;
  }
}

export function writeExtractionState(workRoot: string, state: ExtractionState): void {
  fs.writeFileSync(statePath(workRoot), JSON.stringify(state, null, 2));
}

export function clearExtractionState(workRoot: string): void {
  const p = statePath(workRoot);
  if (fs.existsSync(p)) fs.rmSync(p);
}

/**
 * Version of the extraction pipeline. Recorded in the extraction state and
 * compared at startup by checkExtractFreshness — a mismatch means the on-disk
 * extract (assets/yi + editor-data/yi) was produced by older code and should
 * be re-run.
 *
 * BUMP THIS whenever a change alters what extract emits: a new/removed output
 * file, a schema change, or a derivation fix in extract.ts / the level-map /
 * levels-catalog / instance-index builders whose result should propagate to
 * existing extracts. (History: 1 = first versioned pipeline, 2026-06-12.)
 */
export const EXTRACT_PIPELINE_VERSION = 1;

/** Editor-derived outputs every complete extract must leave on disk
 *  (workRoot-relative). A missing one ⇒ the extract is stale/partial. */
const EXPECTED_EXTRACT_OUTPUTS = [
  'editor-data/yi/level-map.json',
  'editor-data/yi/levels.json',
  'editor-data/yi/instance-index.json',
];

/**
 * The out-of-date-extract check — the extract-side analogue of the
 * outdated-overlay checker. The app refreshes its asm template on upgrade, but
 * the extract outputs persist; this catches an extract produced by an older
 * pipeline (no/lower pipelineVersion) or with an expected output missing
 * (e.g. a levels.json the producing version didn't emit yet).
 */
export function checkExtractFreshness(workRoot: string): ExtractFreshness {
  const state = readExtractionState(workRoot);
  if (!state) return { status: 'none', reasons: [] };
  const reasons: string[] = [];
  if (state.pipelineVersion !== EXTRACT_PIPELINE_VERSION) {
    reasons.push(
      `extraction pipeline updated (extract is v${state.pipelineVersion ?? 0}, ` +
        `app expects v${EXTRACT_PIPELINE_VERSION})`
    );
  }
  for (const rel of EXPECTED_EXTRACT_OUTPUTS) {
    if (!fs.existsSync(path.join(workRoot, rel))) reasons.push(`missing ${rel}`);
  }
  return reasons.length > 0 ? { status: 'stale', reasons } : { status: 'fresh', reasons: [] };
}
