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
        block the level uses; <b>Files</b> shows the raw 8&times;8 graphics tiles
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
        it, then drag the color picker to edit it.
      </p>
      <p>
        Rows the level&rsquo;s tiles don&rsquo;t use are dimmed as a hint &mdash;
        you can still edit them. Selecting an object on the canvas highlights the
        palette rows it draws with.
      </p>
      <p>
        Edits preview live on the canvas and ride the normal save / undo flow
        &mdash; nothing is written to the ROM until you Save.
      </p>
    </>
  ),
  props: (
    <>
      <p>
        Properties of the current selection &mdash; an object, sprite, screen
        exit, incoming-warp marker, or the player spawn. The fields shown depend
        on what&rsquo;s selected; editing one mutates that entity on the loaded
        level. A multi-selection shows a summary instead, with a per-type count.
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
        palette, the spriteset, BG color, level mode, tile-animation, plus music,
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
        Edit the game&rsquo;s text, one table per tab: <b>Level&nbsp;Names</b>,{' '}
        <b>Message&nbsp;Text</b> (the intro / message-box bodies), and{' '}
        <b>Message&nbsp;Pointers</b> (which message body each message id shows).
      </p>
      <p>
        Each text table shares a fixed byte budget &mdash; the panel tracks
        characters used and flags entries that go over or use unsupported
        characters.
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
        Place objects, sprites, and screen exits. Switch tabs (<b>Objects</b> /{' '}
        <b>Sprites</b> / <b>Exit&nbsp;/&nbsp;Special</b>), search by name or id, click
        an entry to arm it, then click the canvas to drop it (<b>Esc</b> to stop).
      </p>
      <p>
        <b>Shift-click</b> an entry instead to find everywhere that object or sprite
        is used &mdash; it opens the Object Finder for that id.
      </p>
      <p>
        Each row previews how the entry looks in this level. Filters narrow the
        list: <b>in level tileset</b> hides entries whose graphics aren&rsquo;t
        loaded here, and <b>used here</b> shows only what&rsquo;s already placed.
        Badges flag entries that won&rsquo;t render right (<i>no gfx</i>) or need
        surrounding setup.
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
      <p>
        Tip: <b>Shift-click</b> an entry in the Place panel to search for it here.
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
  exits: (
    <>
      <p>
        The Exits Map draws the whole warp network reachable from the current root
        level as one picture: every room is a small 16&times;8 screen grid, laid
        out left&nbsp;&rarr; right by warp depth, with a line from each warp exit
        to the screen it lands on in its destination. Blue&nbsp;= warp exit, violet&nbsp;= minibattle (no
        line &mdash; it enters a minigame, not a room), amber outline&nbsp;= an
        entrance (a screen some warp lands in &mdash; same amber as the canvas
        markers).
      </p>
      <p>
        Clicking anywhere scrolls the canvas to the clicked screen &mdash; in place
        on the loaded level (accent label), or jumping levels first on any other
        grid. Clicking an exit <i>or</i> an amber entrance on the loaded level also
        selects it in Properties; selecting either end highlights its connection
        line. Compact boxes are destinations outside this cluster (other world-map
        levels). To <i>add</i> an exit, use the Place panel&rsquo;s{' '}
        <b>Exit&nbsp;/&nbsp;Special</b> tab and click a screen.
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
  ),
  validation: (
    <>
      <p>
        Static playability checks &mdash; bugs that look fine in the editor but break,
        glitch, or read garbage once the level runs. The tally at the top counts this
        level&rsquo;s flowers, red coins, and coins.
      </p>
      <p>
        <b>Check this level</b> lints the loaded level (auto-runs on level change);{' '}
        <b>Check all levels</b> sweeps the whole ROM. Click an issue to jump to it.
        Findings are <span style={{ color: '#e6584d' }}>errors</span> (corruption,
        crashes, lost data) or <span style={{ color: '#d9a441' }}>warnings</span> (glitch
        / suspect).
      </p>
      <p>What it checks:</p>
      <ul className="se-help__list">
        <li>
          <b>Sprite &amp; exit limits</b> &mdash; too many sprites or screen exits for the
          engine&rsquo;s tables.
        </li>
        <li>
          <b>Page-pool overflow</b> &mdash; more than 63 screen pages; the level buffer
          corrupts.
        </li>
        <li>
          <b>Corrupt level data</b> &mdash; the object stream aborts mid-parse.
        </li>
        <li>
          <b>Item-memory collision</b> &mdash; a red coin, flower, or key shares one
          collected-bit with another collectible, so taking one despawns the rest. The
          all-levels sweep also catches this <i>across</i> warp-connected sub-rooms.
        </li>
        <li>
          <b>Duplicate screen exit</b> &mdash; two exits on one screen, where the table
          keeps only one.
        </li>
        <li>
          <b>Warp to sentinel slot</b> &mdash; a warp points at an unallocated level slot.
        </li>
        <li>
          <b>Glitched header value</b> &mdash; a header field set to a known garbage value.
        </li>
        <li>
          <b>Render validity</b> (this level only) &mdash; objects or sprites that render
          wrong under this level&rsquo;s tilesets; also shown on the Picker badges.
        </li>
      </ul>
      <p>Every check is tuned to stay silent on the vanilla levels (no false positives).</p>
    </>
  ),
  'world-map': (
    <>
      <p>
        Edit the world map&rsquo;s entrance data. Drill in from <b>Worlds</b> to a
        world&rsquo;s levels, then to one level&rsquo;s details &mdash; where Yoshi
        spawns and the midway / checkpoint re-entry points.
      </p>
      <p>
        Each spawn / checkpoint has a <b>jump</b> button that loads that level and
        centres the camera on the cell. The spawn cell previews live on the canvas
        marker when its level is loaded.
      </p>
      <p>
        The rest of the world-map data has no live preview &mdash; edits save and
        undo here, but take effect only after a rebuild (Test&nbsp;Level / Launch).
      </p>
    </>
  ),
  audio: (
    <>
      <p>
        The game&rsquo;s music and sound effects, playable in the editor &mdash; the
        panel synthesizes the exact audio-CPU image the game uploads and runs it on an
        emulated SPC700, no emulator or rebuild needed.
      </p>
      <p>
        <b>Song&nbsp;Sets</b> groups every track by its music set (the value a level&rsquo;s
        header picks); &#9733; marks what auto-plays on entry. Each set has a sound-RAM
        diagram: the bar is the memory the set swaps in (samples left of the tick,
        song data right &mdash; hover any span), and the gauges track the four budgets
        an imported or edited song spends &mdash; sequence bytes, custom-sample space,
        sample slots, instrument rows. Empty space is what imports can claim; the
        level count expands into clickable chips that open each level.{' '}
        <b>SFX</b> lists every named sound effect &mdash; the <i>v</i> column is the
        voice the one-shot plays on (same-voice sounds interrupt by priority).
      </p>
      <p>
        &#9835; on any song or SFX row opens the <b>sequencer</b> — a piano-roll
        popup showing its patterns, notes, and engine commands on their 8 voice
        lanes, with a live playhead and per-voice mute pills during playback.
        Esc closes it; playback keeps running.
      </p>
      <p>
        <b>Edit&nbsp;Song&nbsp;Sets</b> edits what each header music value does: which modules its
        set uploads, which song starts on entry, and the pause-item flag —
        plus the upload lists themselves. The two unused values are free slots
        for custom picks (selectable in the level header once repointed).
        Edits save into the project and apply on the next build
        (Test&nbsp;Level rebuilds automatically); &#9654; auditions any pick
        immediately. The header panel&rsquo;s <b>Edit&nbsp;sets&hellip;</b>{' '}
        button jumps here.
      </p>
      <p>
        <b>Export/Import</b> writes everything to the project&rsquo;s <code>audio</code> folder
        with one button: sound effects as editable MML <code>.txt</code> scripts,
        instrument samples as raw <code>.brr</code> plus listenable <code>.wav</code>.
        Edit the sample .wavs in any audio editor and <b>Import&nbsp;Samples</b>{' '}
        re-encodes just what changed &mdash; edits preview instantly; a rebuild bakes
        them in. Songs imported into the ROM sit in their own{' '}
        <i>Imported&nbsp;songs</i> section up top, each with play and <b>Reset</b>;
        its budget figure tracks the shared free space imports can use.
      </p>
      <p>
        <b>import/</b> brings songs in from <code>.spc</code> files (emulator
        captures of the game and its hacks) and from MML sources:
        AddmusicK packages (the <code>.txt</code> plus its sample folder) or AddMusicY
        files, detected automatically. SMW&rsquo;s built-in instruments and drums are
        translated onto this game&rsquo;s own sounds, and the <i>port report</i> under
        the file lists every approximation to listen for. Drop a file in the folder,
        pick which song module it replaces, <b>&#9654;</b> previews it over that
        music set, and <b>Import</b> writes it into the project &mdash; every level using
        that music hears it. Each detected song lists its size against the same
        budgets the Song&nbsp;Sets diagram draws (sequence bytes, samples, instrument rows,
        sample slots) next to a <i>space in target</i> line for the chosen module
        &mdash; a highlighted figure exceeds that space. For MML files a second dropdown can target a
        <i> single slot</i> inside the module: the import merges in alongside the
        module&rsquo;s other songs (they keep playing, but share the module&rsquo;s
        space) instead of replacing them all.
      </p>
    </>
  ),
  graphics: (
    <>
      <p>
        Edit the game&rsquo;s graphics in external editors, one tab per pathway:{' '}
        <b>Level&nbsp;BGs</b> for the loaded level&rsquo;s background layers, and three
        fixed per-project folders &mdash; <b>YY-CHR&nbsp;Graphics</b>,{' '}
        <b>M1TE&nbsp;Maps</b>, and <b>Misc&nbsp;Art</b>.
      </p>
      <p>
        <b>Level&nbsp;BGs:</b> <b>Export</b> writes a <b>BG1&nbsp;area</b> (use{' '}
        <b>Select&nbsp;area</b> and shift-drag a rectangle on the canvas) or the whole{' '}
        <b>BG2</b> / <b>BG3</b> layer to a folder you pick; <b>Import</b> reads the
        folder back and saves only what changed. Below the controls: the folders
        you&rsquo;ve exported to (click to open, re-import, or remove &mdash; any{' '}
        <code>.M1</code> files there are clickable to open in M1TE), the graphics this
        project has changed (each shows what it maps back to, with a reset to vanilla),
        and the last import&rsquo;s log.
      </p>
      <p>
        <b>Format:</b> <b>Aseprite</b> writes a configured
        &ldquo;.aseprite&rdquo; file with the palette built in (no Aseprite install
        needed to produce it). <b>M1TE2&nbsp;(.M1)</b> bundles a layer&rsquo;s tilemap,
        tiles, and palette into one session you edit in <b>M1TE</b>, the bundled
        tile/map editor. <b>Locate&nbsp;Aseprite</b> points the app at your install
        (used to check it can open tilemap exports).
      </p>
      <p>
        <b>Palette rows.</b> Each background tile uses a single color row. If you paint
        a pixel with a color that isn&rsquo;t in that tile&rsquo;s own row, the import
        reports it and snaps the pixel to color&nbsp;0 (the transparent / backdrop
        entry) &mdash; stick to the tile&rsquo;s row.
      </p>
      <p>
        The three folder tabs need no dialogs &mdash; each exports to its own fixed
        folder in the project, shows on-disk previews, lights up files you&rsquo;ve
        changed externally, and imports per-file or all at once. <b>Misc&nbsp;Art</b> holds
        the fixed image surfaces (the world map, the boot / title / storybook
        screens, Raphael&rsquo;s arena, the message font) as PNGs or Aseprite projects;{' '}
        <b>YY-CHR&nbsp;Graphics</b> every tile sheet in the game as raw files YY-CHR
        edits in place; <b>M1TE&nbsp;Maps</b> every fixed map (the overworlds, the
        level icons, the tilemap-based screens) as M1TE sessions.
      </p>
      <p>
        Edits preview live on the canvas; a rebuild (Test&nbsp;Level / Launch) bakes
        everything into the ROM.
      </p>
    </>
  )
}

/** The help body for a panel kind, or null if that kind has no help authored. */
export function panelHelp(kind: WindowDef['kind']): ReactNode {
  return PANEL_HELP[kind] ?? null
}
