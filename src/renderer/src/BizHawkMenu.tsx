import { type JSX } from 'react'

export interface BizHawkMenuProps {
  selectedLevelRecordId: number | null
  /** Emulator action in flight — disables both buttons. Owned by App so the
   *  Ctrl+R shortcut shares the same guard. */
  busy: boolean
  /** Whether EmuHawk.exe is located (a saved path, or the dev `../bizhawk`
   *  fallback). While false, the menu shows "Locate BizHawk" in place of the
   *  Launch / Test Level buttons. */
  located: boolean
  /** Open the file picker to locate EmuHawk.exe. */
  onLocate: () => void
  /** Cold-boot EmuHawk (save → build → launch). App provides the log sink. */
  onLaunch: () => void
  /** Save → build → ensure EmuHawk → load the selected level. */
  onTestLevel: () => void
}

/**
 * Two toolbar buttons for EmuHawk control. Both flush pending edits into the
 * ROM first (save if dirty, rebuild if any change is unbuilt) so the emulator
 * always boots the latest changes:
 *
 * - **Launch**: cold boot — no savestate, no auto-pause, no level load. The
 *   user navigates the game themselves (world map, intro, …).
 * - **Test Level**: ensure EmuHawk is running, then load the selected
 *   translevel ID via the Lua harness. Also bound to Ctrl+R.
 *
 * The orchestration + busy state live in App (so the keyboard shortcut shares
 * them); these buttons just fire the provided callbacks.
 *
 * Until BizHawk is located (no saved path and no dev fallback), neither action
 * can run, so both buttons are replaced by a one-time **Locate BizHawk** step
 * that points the editor at EmuHawk.exe and persists it.
 */
export function BizHawkMenu({
  selectedLevelRecordId,
  busy,
  located,
  onLocate,
  onLaunch,
  onTestLevel
}: BizHawkMenuProps): JSX.Element {
  if (!located) {
    return (
      <div className="se-bizhawk">
        <button
          type="button"
          className="se-tool se-tool--bizhawk"
          onClick={onLocate}
          title="Find EmuHawk.exe so the editor can run BizHawk. Saved for next time."
        >
          Locate BizHawk
        </button>
      </div>
    )
  }
  return (
    <div className="se-bizhawk">
      <button
        type="button"
        className="se-tool se-tool--bizhawk"
        onClick={onLaunch}
        disabled={busy}
        title="Save (if dirty) → Build (if needed) → cold-boot EmuHawk."
      >
        Launch
      </button>
      <button
        type="button"
        className="se-tool se-tool--bizhawk"
        onClick={onTestLevel}
        disabled={busy || selectedLevelRecordId === null}
        title="Save (if dirty) → Build (if needed) → ensure EmuHawk → load the selected level.  (Ctrl+R)"
      >
        Test Level
      </button>
    </div>
  )
}
