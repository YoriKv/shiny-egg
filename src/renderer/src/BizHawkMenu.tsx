import { useState, type JSX } from 'react'
import type { TestInventory } from '../../preload/api'
import { ContextMenu } from './ContextMenu'

/** Egg-trail capacity: eggs + keys can't exceed this (the cart's between-level
 *  snapshot holds 6 items). Shared with App's persisted-state clamp. */
export const MAX_TEST_INVENTORY_ITEMS = 6

/** Clamp an inventory to valid counts: each ≥ 0 and `eggs + keys` ≤ the cap.
 *  Eggs take priority; keys fill whatever slots remain. Tolerates corrupt
 *  persisted values (non-numbers → 0). Used on the persisted-state load path
 *  and whenever a stepper changes a value. */
export function clampInventory(inv: TestInventory): TestInventory {
  const eggs = Math.max(0, Math.min(MAX_TEST_INVENTORY_ITEMS, Math.trunc(inv.eggs) || 0))
  const keys = Math.max(0, Math.min(MAX_TEST_INVENTORY_ITEMS - eggs, Math.trunc(inv.keys) || 0))
  return { eggs, keys }
}

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
  /** Items Test Level seeds into Yoshi's egg trail (persisted in App). */
  testInventory: TestInventory
  onTestInventoryChange: (inv: TestInventory) => void
}

/**
 * One labelled `− value +` stepper row. The caller computes `canInc` (so the
 * shared eggs + keys ≤ 6 cap is enforced across both rows) and `−` is disabled
 * at zero.
 */
function InvStepper({
  label,
  value,
  canInc,
  busy,
  onStep
}: {
  label: string
  value: number
  canInc: boolean
  busy: boolean
  onStep: (delta: number) => void
}): JSX.Element {
  const noun = label.toLowerCase()
  return (
    <div className="se-bizhawk__stepper">
      <span className="se-bizhawk__stepper-label">{label}</span>
      <button
        type="button"
        className="se-bizhawk__step"
        onClick={() => onStep(-1)}
        disabled={busy || value <= 0}
        title={`One fewer ${noun}`}
      >
        −
      </button>
      <span className="se-bizhawk__step-val">{value}</span>
      <button
        type="button"
        className="se-bizhawk__step"
        onClick={() => onStep(1)}
        disabled={busy || !canInc}
        title={`One more ${noun}`}
      >
        +
      </button>
    </div>
  )
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
 * Alongside them, two stacked `− value +` steppers (eggs over keys) seed
 * Yoshi's egg trail on the next Test Level boot. Their combined total is
 * capped at {@link MAX_TEST_INVENTORY_ITEMS} (a key occupies one egg slot), so
 * the `+` buttons disable once the trail is full.
 *
 * Until BizHawk is located (no saved path and no dev fallback), neither action
 * can run, so both buttons are replaced by a one-time **Locate BizHawk** step
 * that points the editor at EmuHawk.exe and persists it. Once located,
 * right-clicking the area opens a **Change BizHawk installation…** menu that
 * re-runs that same picker — the deliberate way to re-point BizHawk at a
 * different install (the automatic clear only fires when a launch fails).
 */
export function BizHawkMenu({
  selectedLevelRecordId,
  busy,
  located,
  onLocate,
  onLaunch,
  onTestLevel,
  testInventory,
  onTestInventoryChange
}: BizHawkMenuProps): JSX.Element {
  // Right-click menu (located state) to re-point BizHawk at a different install
  // — the same picker as "Locate BizHawk", reachable without waiting for a
  // launch to fail. Viewport coords; the fixed-position ContextMenu handles
  // outside-click / Escape dismissal.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  if (!located) {
    return (
      <div className="se-bizhawk">
        <button
          type="button"
          className="se-tool se-tool--bizhawk"
          onClick={onLocate}
          title="Find EmuHawk.exe so the editor can run BizHawk."
        >
          Locate BizHawk
        </button>
      </div>
    )
  }
  const canAdd = testInventory.eggs + testInventory.keys < MAX_TEST_INVENTORY_ITEMS
  return (
    <div
      className="se-bizhawk"
      onContextMenu={(e) => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button
        type="button"
        className="se-tool se-tool--bizhawk"
        onClick={onLaunch}
        disabled={busy}
        title="Save (if dirty) → Build (if needed) → Launch Emulator.  (Right-click to change BizHawk install)"
      >
        Launch
      </button>
      <button
        type="button"
        className="se-tool se-tool--bizhawk"
        onClick={onTestLevel}
        disabled={busy || selectedLevelRecordId === null}
        title="Save (if dirty) → Build (if needed) → Launch Emulator → Load the current level.  (Ctrl+R)"
      >
        Test Level
      </button>
      <div
        className="se-bizhawk__inv"
        title="Items to give Yoshi when Test Level loads (eggs + keys ≤ 6)."
      >
        <InvStepper
          label="Eggs"
          value={testInventory.eggs}
          canInc={canAdd}
          busy={busy}
          onStep={(d) =>
            onTestInventoryChange(
              clampInventory({ eggs: testInventory.eggs + d, keys: testInventory.keys })
            )
          }
        />
        <InvStepper
          label="Keys"
          value={testInventory.keys}
          canInc={canAdd}
          busy={busy}
          onStep={(d) =>
            onTestInventoryChange(
              clampInventory({ eggs: testInventory.eggs, keys: testInventory.keys + d })
            )
          }
        />
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[{ label: 'Change BizHawk installation…', onClick: onLocate }]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
