// Wrapper around the asar assembler (asar.exe on Windows, asar on Linux,
// asar-macos on macOS). Surfaces non-zero exits as exceptions.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import type { RomVersion } from './rom-versions.ts';
import type { AsarDiagnostic } from './types.ts';

// Platform binary name. asar is a native executable, so each OS needs its own
// build — a Windows PE, a Linux ELF, and a macOS Mach-O can't run on each
// other's platform (no WSL interop on a real Linux box / CI runner). We ship one
// committed prebuilt binary per platform (all LGPL): asar.exe, asar, and
// asar-macos (a universal arm64+x86_64 Mach-O, since upstream ships no mac
// build). electron-builder bundles the matching one per OS (extraResources).
// The Linux `asar` is FULLY STATICALLY LINKED (no libc/libstdc++ deps): a
// dynamic build inherits its build host's glibc floor (Ubuntu 24.04 → 2.38),
// and ROM builds then fail on older distros with "GLIBC_2.38 not found".
// Rebuild from the asar 1.91 source with
//   cmake -S src -B build -DCMAKE_EXE_LINKER_FLAGS=-static
//   cmake --build build --target asar-standalone
// and check `file` reports "statically linked".
export function asarBinName(): string {
  switch (process.platform) {
    case 'win32':
      return 'asar.exe';
    case 'darwin':
      return 'asar-macos';
    default:
      return 'asar';
  }
}

export interface RunAsarOptions {
  asarBin: string;
  args: string[];
  cwd: string;
  /** Phase name for the failure message (e.g. "Assemble main SNES"). */
  label?: string;
}

// `<file>:<line>[ (called from …)]: error: (<code>): <message>`. Warnings share
// the shape with `warning:`, and asar prints many of them on every build.
const ASAR_ERROR_RE = /^(.+?):(\d+)(?: \(called from [^)]*\))?: error: \((\w+)\): (.*)$/;

/** The `error:` lines in asar's output, parsed and de-duplicated (asar repeats an
 *  error once per pass that reaches it). */
export function parseAsarErrors(output: string): AsarDiagnostic[] {
  const seen = new Set<string>();
  const out: AsarDiagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const m = ASAR_ERROR_RE.exec(raw.trim());
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push({ file: m[1]!, line: Number(m[2]), code: m[3]!, message: m[4]! });
  }
  return out;
}

/** A failed asar run. `diagnostics` carries asar's parsed errors so a host can
 *  translate them (map an assert address to the region that overflowed, a hook
 *  line to the patch it came from); `message` already includes the raw lines. */
export class AsarError extends Error {
  readonly phase: string;
  readonly diagnostics: AsarDiagnostic[];
  constructor(summary: string, phase: string, diagnostics: AsarDiagnostic[]) {
    const lines = diagnostics.slice(0, 5).map((d) => `${d.file}:${d.line}: ${d.message}`);
    super([summary, ...lines].join('\n'));
    this.name = 'AsarError';
    this.phase = phase;
    this.diagnostics = diagnostics;
  }
}

/** Echo captured asar output to this process's stdout (the dev console). In a
 *  packaged console-less GUI build process.stdout may be a dead/invalid handle,
 *  so never let a logging failure take down a build. */
function echoOutput(out: string): void {
  if (!out) return;
  try { process.stdout.write(out); } catch { /* no console attached */ }
}

/** Ensure the asar binary is executable on POSIX. The exec bit can be lost when
 *  the template is copied from read-only AppImage resources into userData
 *  (fs.cp doesn't always preserve it), or on a fresh clone where git didn't
 *  restore it. Called at every asar chokepoint rather than at each call site.
 *  No-op cost on Windows (skipped). */
function ensureExecutable(asarBin: string): void {
  if (process.platform !== 'win32') {
    try { chmodSync(asarBin, 0o755); } catch { /* best-effort */ }
  }
}

export function runAsar({ asarBin, args, cwd, label = 'asar' }: RunAsarOptions): void {
  ensureExecutable(asarBin);
  // windowsHide passes CREATE_NO_WINDOW so the packaged (console-less GUI) main
  // process doesn't flash a fresh cmd window for every asar phase. Output is
  // CAPTURED (not inherited) so a failure can carry asar's error lines: with
  // stdio:'inherit' they only reached a dev terminal, and the packaged app showed
  // a bare exit status. Echoed afterwards so the dev console still gets the log.
  // stderr is folded into the same text after stdout; asar prints the errors
  // there, so their position relative to the progress lines doesn't matter.
  const result = spawnSync(asarBin, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`;
  echoOutput(output);
  if (result.status !== 0) {
    throw new AsarError(`asar exited with status ${result.status} during "${label}"`, label, parseAsarErrors(output));
  }
}

/**
 * Cap on concurrent asar processes. asar is a single-threaded native binary, so
 * the only parallelism available is running independent *phases* as separate
 * processes. Held at 4 deliberately: the parallelizable phases are short and
 * I/O-heavy (each re-reads the same ROM-map + definitions asm), so past ~4 the
 * shared page cache and disk stop rewarding more workers, and the packaged
 * Electron main process shouldn't monopolize a user's machine mid-build.
 */
export const MAX_ASAR_PARALLELISM = 4;

/** One independent asar invocation within a parallel group. */
export interface AsarTask {
  /** Human-readable phase name, echoed through onDone for progress reporting. */
  label: string;
  args: string[];
}

export interface RunAsarParallelOptions {
  asarBin: string;
  cwd: string;
  /** Tasks MUST be mutually independent: no task may read another's output, and
   *  no two may write the same file. See build.ts for the phase analysis. */
  tasks: AsarTask[];
  concurrency?: number;
  /** Fired once per task, in completion order. */
  onDone?: (label: string) => void;
}

/** Run one asar invocation, capturing its output instead of inheriting stdio.
 *  Capture is required for parallel runs — concurrent children writing to an
 *  inherited console interleave into unreadable garbage, and a failing phase's
 *  diagnostics would be lost among the others'. */
function runAsarCaptured(
  asarBin: string,
  args: string[],
  cwd: string
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(asarBin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    // One buffer for both streams so asar's interleaved stdout/stderr stays in
    // roughly the order it was emitted (it reports errors on stderr between
    // stdout progress lines).
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output: Buffer.concat(chunks).toString() }));
  });
}

/**
 * Run mutually independent asar phases concurrently, at most `concurrency` at a
 * time, and replay their captured output to this process's stdout **in task
 * order** once the whole group finishes (so a build log reads the same as the
 * serial one regardless of which phase happened to finish first).
 *
 * Rejects with the first failing task's label + captured output. Tasks already
 * in flight are allowed to finish rather than being killed: they're pure
 * assemblies into their own output files, so letting them complete costs a
 * second and avoids leaving a half-written .bin behind for the next build.
 */
export async function runAsarParallel(opts: RunAsarParallelOptions): Promise<void> {
  const { asarBin, cwd, tasks, onDone } = opts;
  const limit = Math.max(1, Math.min(opts.concurrency ?? MAX_ASAR_PARALLELISM, tasks.length));
  ensureExecutable(asarBin);

  const outputs: string[] = new Array(tasks.length).fill('');
  const failures: { index: number; message: string; label: string }[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      const task = tasks[i]!;
      let result: { status: number | null; output: string };
      try {
        result = await runAsarCaptured(asarBin, task.args, cwd);
      } catch (err) {
        failures.push({ index: i, label: task.label, message: `asar failed to start for "${task.label}": ${(err as Error).message}` });
        continue;
      }
      outputs[i] = result.output;
      if (result.status !== 0) {
        failures.push({ index: i, label: task.label, message: `asar exited with status ${result.status} during "${task.label}"` });
      } else {
        onDone?.(task.label);
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));

  for (const out of outputs) echoOutput(out);

  if (failures.length > 0) {
    failures.sort((a, b) => a.index - b.index);
    const first = failures[0]!;
    // Only the parsed error lines: the full output is mostly warnings.
    throw new AsarError(first.message, first.label, parseAsarErrors(outputs[first.index] ?? ''));
  }
}

/**
 * Common --define and --include flags applied to every YI build phase.
 *
 * --include paths are kept relative to asar's cwd (workRoot/yi) so they match
 * the layout the framework was authored against. Callers must therefore set
 * cwd to <workRoot>/yi when invoking asar.
 *
 * Two include paths because asar resolves incbin paths relative to the file
 * containing the directive, then falls back to include paths:
 *   - ../assets/yi          for incbin "LevelData/x.bin" from Routine_Macros_YI.asm
 *   - ../assets/yi/SPC700   for incbin "Samples/x/y.brr" from SPC700/*.asm
 */
export function commonYIDefines(romID: RomVersion): string[] {
  return [
    '--define', 'MainFolder=yi',
    '--define', 'GameID=YI',
    '--define', `ROMID=${romID}`,
    '--include', '../assets/yi',
    '--include', '../assets/yi/SPC700',
  ];
}
