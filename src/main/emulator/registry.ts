// Emulator selection registry. The editor supports two interchangeable render
// backends — BizHawk and Mesen (the cross-platform / macOS one) — that speak the
// same harness protocol. Everything downstream (IPC control handlers, live
// palette pushes, build/quit teardown) goes through `getEmulator()` so it always
// drives whichever the user selected, without knowing which that is.

import { getSettings, updateSettings } from '../settings'
import { getBizHawk, resolveBizhawkExe } from '../bizhawk'
import { getMesen, resolveMesenExe } from '../mesen'
import type { EmulatorKind, EmulatorLocation, EmulatorState } from '../../shared/ipc-types'
import type { EmulatorSupervisorBase } from './supervisor-base'

/** The selected backend. Absent setting ⇒ `'bizhawk'` (the original default, so
 *  existing installs keep their behavior). */
export function selectedEmulatorKind(): EmulatorKind {
  return getSettings().emulator === 'mesen' ? 'mesen' : 'bizhawk'
}

/** The supervisor for the currently-selected backend. */
export function getEmulator(): EmulatorSupervisorBase {
  return selectedEmulatorKind() === 'mesen' ? getMesen() : getBizHawk()
}

function locationFor(kind: EmulatorKind): EmulatorLocation {
  const exe = kind === 'mesen' ? resolveMesenExe() : resolveBizhawkExe()
  return { kind, exe, located: exe !== null }
}

/** The toolbar's single source of truth: which backend is selected + each
 *  backend's located status. */
export function getEmulatorState(): EmulatorState {
  return {
    selected: selectedEmulatorKind(),
    bizhawk: locationFor('bizhawk'),
    mesen: locationFor('mesen')
  }
}

/** Persist the selected backend (the right-click switch, or "locating one
 *  selects it"). Returns the fresh state for the toolbar. */
export function setEmulatorKind(kind: EmulatorKind): EmulatorState {
  updateSettings({ emulator: kind })
  return getEmulatorState()
}

/** Whether EITHER backend is running. Used to decide "stop before rebuild" — a
 *  stale non-selected supervisor could still hold the old ROM if the user
 *  switched backends mid-session. */
export function anyEmulatorRunning(): boolean {
  return getBizHawk().isRunning() || getMesen().isRunning()
}

/** Stop BOTH backends. Safe to call when neither is running. Used on build /
 *  project switch / quit so no emulator is left holding a stale ROM or leaked as
 *  a child process. */
export function stopAllEmulators(): void {
  getBizHawk().stop()
  getMesen().stop()
}
