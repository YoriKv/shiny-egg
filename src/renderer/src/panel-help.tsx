import type { ReactNode } from 'react'
import type { WindowDef } from './hooks/useFloatingWindows'

/**
 * Per-panel help content, keyed by floating-window `kind`. `FloatingWindow`
 * renders a help (?) button next to a panel's title whenever an entry exists
 * here, and shows it in a `HelpDialog`. To document a new panel, add a `kind`
 * entry — no other wiring needed (App passes `PANEL_HELP[w.kind]` through).
 *
 * Content is JSX so it can hold lists and emphasis; keep it short and factual —
 * a paragraph on what the panel is for, then the few things worth knowing.
 */
export type PanelHelp = Partial<Record<WindowDef['kind'], ReactNode>>

export const PANEL_HELP: PanelHelp = {
  tiles: (
    <>
      <p>
        The current level&rsquo;s tileset. <b>Map16 Blocks</b> shows every 16&times;16
        block the level can stamp; <b>Files</b> shows the raw 8&times;8 graphics tiles
        loaded into VRAM.
      </p>
      <p>
        Selecting an object in the canvas outlines the Map16 blocks it stamps, so
        you can see which tiles a given object draws with.
      </p>
      <p>
        <b>Header</b> decodes the level header: per-layer tileset &amp; palette,
        the spriteset, palette rows in use, and the graphics files this level
        loads into VRAM.
      </p>
    </>
  ),
  palette: (
    <>
      <p>
        The current level&rsquo;s color palette (CGRAM). Click a swatch to select
        it, then use the color picker to edit it. Only swatches the level
        actually uses are editable.
      </p>
      <p>
        Edits preview live on the canvas. They&rsquo;re part of the normal
        save/undo flow &mdash; nothing is written to the ROM until you Save.
      </p>
    </>
  ),
  props: (
    <>
      <p>
        Properties of the current selection &mdash; an object, sprite, screen
        exit, or the player spawn. The fields shown depend on what&rsquo;s
        selected; editing one mutates that entity on the loaded level.
      </p>
      <p>
        Click an item in the canvas to select it. Clicking again at the same spot
        cycles through anything stacked underneath.
      </p>
    </>
  ),
  header: (
    <>
      <p>
        The loaded level&rsquo;s 15 header fields &mdash; per-layer tileset &amp;
        palette, the spriteset, BG colour, level mode, tile-animation, plus music,
        scroll, and item-memory. Editing one mutates the level like any other edit
        (undo / save included).
      </p>
      <p>
        <b>Visual</b> fields re-skin the canvas live. <b>Gameplay</b> fields (scroll
        rate, music, item memory) have no live preview &mdash; rebuild and
        Test&nbsp;Level to verify them. Each value is clamped to its field&rsquo;s
        size.
      </p>
    </>
  ),
  strings: (
    <>
      <p>
        Edit the game&rsquo;s level-name and message text. Each entry maps to a
        string in the ROM&rsquo;s text tables.
      </p>
      <p>
        Text shares a fixed byte budget &mdash; the panel tracks characters used
        and flags entries that go over or use unsupported characters.
      </p>
      <p>
        These edits don&rsquo;t render live: a save marks the build dirty, so
        Test&nbsp;Level / Launch will rebuild the ROM before booting.
      </p>
    </>
  ),
  picker: (
    <>
      <p>
        Pick an object or sprite to place. Search by name or id, click an entry
        to arm it, then click the canvas to drop it.
      </p>
      <p>
        Standard objects, extended objects, and sprites are all listed; the id
        column shows which kind each entry is.
      </p>
    </>
  ),
  finder: (
    <>
      <p>
        Find every place an object or sprite id appears across all levels. Choose
        a kind (standard object, extended object, or sprite), type an id, and
        step through the matches with Prev / Next to jump to each one.
      </p>
      <p>
        Results come from the base-cart index merged with your <i>saved</i>{' '}
        overlay edits &mdash; unsaved in-canvas changes aren&rsquo;t reflected
        yet.
      </p>
    </>
  ),
  patches: (
    <>
      <p>
        Manage this project&rsquo;s custom IPS patches. Toggle your local patches
        on/off, or <b>Add</b> one from the editor&rsquo;s prepackaged catalog
        (grouped by category) &mdash; added patches are enabled by default.
      </p>
      <p>
        Patches apply <i>top &rarr; bottom</i>, so where two patches write the
        same bytes the lower one wins. Use the <b>&#9650;</b> / <b>&#9660;</b>{' '}
        arrows to order them so a stack lands the way you intend.
      </p>
      <p>
        Patches apply <i>after</i> the build, so changing them marks the build
        dirty &mdash; rebuild before testing. Actions here save immediately and
        are outside the level undo history.
      </p>
    </>
  ),
  banks: (
    <>
      <p>
        The level-data byte budget per bank pool, plus the free-space regions levels
        can be moved into. Each pool lists its used / free bytes (free includes any
        boundary-move headroom) and a per-level breakdown; the <b>Free space</b>{' '}
        section shows the spare ROM tails. Click a level to jump to it.
      </p>
      <p>
        <b>&rarr; free space</b> migrates a level out of its cramped home bank into a
        free region, reclaiming its slot for the bank&rsquo;s other levels;{' '}
        <b>&larr; return</b> moves it back. For the two borrowed-sprite levels
        (0x19&nbsp;/&nbsp;0xCB), <b>de-couple</b> gives the level its own sprite data
        so it can be edited &mdash; and frees its partner to migrate too.
      </p>
      <p>
        A pool tagged <i>movable</i> can grow; <i>reclaimable</i> can&rsquo;t grow but
        its levels can still migrate out; <i>fixed</i> can do neither. These are
        build-layout changes, so they don&rsquo;t render live: a toggle marks the
        build dirty and Test&nbsp;Level / Launch rebuilds first. The open level&rsquo;s
        size reflects your live unsaved edits.
      </p>
    </>
  )
}

/** The help body for a panel kind, or null if that kind has no help authored. */
export function panelHelp(kind: WindowDef['kind']): ReactNode {
  return PANEL_HELP[kind] ?? null
}
