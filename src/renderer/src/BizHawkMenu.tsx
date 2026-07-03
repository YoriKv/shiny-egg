import { useState, type JSX } from 'react'
import type { EmulatorKind, EmulatorState, TestInventory } from '../../preload/api'
import { ContextMenu } from './ContextMenu'

/** Display names for the two backends. */
const EMULATOR_LABELS: Record<EmulatorKind, string> = { bizhawk: 'BizHawk', mesen: 'Mesen' }

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
  /** Selected backend + each backend's located status. Null until the first
   *  `emulator.getState()` resolves (then the menu renders nothing). While the
   *  selected backend isn't located, the menu shows two side-by-side Locate
   *  buttons (BizHawk + Mesen) in place of Launch / Test Level. */
  emulatorState: EmulatorState | null
  /** Open the file picker to locate the given backend (locating one selects it). */
  onLocate: (kind: EmulatorKind) => void
  /** Switch the selected backend (the right-click menu). */
  onSelectKind: (kind: EmulatorKind) => void
  /** Cold-boot the selected emulator (save → build → launch). App provides the log sink. */
  onLaunch: () => void
  /** Save → build → ensure the selected emulator → load the selected level. */
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
 * Toolbar buttons for emulator control (BizHawk or Mesen — whichever is
 * selected). Launch / Test Level both flush pending edits into the ROM first
 * (save if dirty, rebuild if any change is unbuilt) so the emulator always boots
 * the latest changes:
 *
 * - **Launch**: cold boot — no savestate, no auto-pause, no level load. The
 *   user navigates the game themselves (world map, intro, …).
 * - **Test Level**: ensure the selected emulator is running, then load the
 *   selected translevel ID via the Lua harness. Also bound to Ctrl+R.
 *
 * The orchestration + busy state live in App (so the keyboard shortcut shares
 * them); these buttons just fire the provided callbacks.
 *
 * Alongside them, two stacked `− value +` steppers (eggs over keys) seed
 * Yoshi's egg trail on the next Test Level boot. Their combined total is
 * capped at {@link MAX_TEST_INVENTORY_ITEMS} (a key occupies one egg slot), so
 * the `+` buttons disable once the trail is full.
 *
 * Until the **selected** backend is located, Launch / Test Level are replaced by
 * two side-by-side **Locate BizHawk** / **Locate Mesen** buttons — locating one
 * selects it (BizHawk is Windows/Linux; Mesen also runs on macOS). Once located,
 * right-clicking the area opens a menu to **switch to the other emulator** or
 * **change the selected install** (re-runs that picker — the deliberate way to
 * re-point at a different install; the automatic clear only fires when a launch
 * fails).
 */
export function BizHawkMenu({
  selectedLevelRecordId,
  busy,
  emulatorState,
  onLocate,
  onSelectKind,
  onLaunch,
  onTestLevel,
  testInventory,
  onTestInventoryChange
}: BizHawkMenuProps): JSX.Element | null {
  // Right-click menu (located state) to switch emulator or re-point the selected
  // one — reachable without waiting for a launch to fail. Viewport coords; the
  // fixed-position ContextMenu handles outside-click / Escape dismissal.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  if (!emulatorState) return null
  const selected = emulatorState.selected
  const selectedLocated = emulatorState[selected].located

  if (!selectedLocated) {
    // Two side-by-side Locate buttons; locating one selects that backend.
    return (
      <div className="se-bizhawk">
        <button
          type="button"
          className="se-tool se-tool--bizhawk"
          onClick={() => onLocate('bizhawk')}
          title="Find EmuHawk.exe so the editor can run BizHawk (Windows / Linux)."
        >
          Locate BizHawk
        </button>
        <button
          type="button"
          className="se-tool se-tool--bizhawk"
          onClick={() => onLocate('mesen')}
          title="Find Mesen so the editor can run it (Windows / Linux / macOS)."
        >
          Locate Mesen
        </button>
      </div>
    )
  }
  const other: EmulatorKind = selected === 'bizhawk' ? 'mesen' : 'bizhawk'
  const label = EMULATOR_LABELS[selected]
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
        title={`Save (if dirty) → Build (if needed) → Launch ${label}.  (Right-click to switch emulator / change install)`}
      >
        Launch
      </button>
      <button
        type="button"
        className="se-tool se-tool--bizhawk"
        onClick={onTestLevel}
        disabled={busy || selectedLevelRecordId === null}
        title={`Save (if dirty) → Build (if needed) → Launch ${label} → Load the current level.  (Ctrl+R)`}
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
          items={[
            { label: `Use ${EMULATOR_LABELS[other]}`, onClick: () => onSelectKind(other) },
            { label: `Change ${label} installation…`, onClick: () => onLocate(selected) }
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
