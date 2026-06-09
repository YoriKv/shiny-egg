// Persistent record of the most recent successful asset extraction. Written
// at the end of extractAssets() and read by the editor at startup so the
// renderer can show "currently extracted: USA V1.1" and so build operations
// can pick up the version without having to re-detect.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtractionState } from './types.ts';
export type { ExtractionState } from './types.ts';

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
