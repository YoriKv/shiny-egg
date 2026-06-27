import { useEffect, useState, type JSX } from 'react'

// App-level help content (not tied to a panel) shown in the same `HelpDialog`
// as the per-panel help — opened from the Project menu. Per-panel help lives in
// `panel-help.tsx`; this is the editor overview + the About page.

/** "Level Editor" help — the canvas/editing overview. */
export const LEVEL_EDITOR_HELP = (
  <>
    <p>
      The canvas shows the selected level. Each <b>object</b>, <b>sprite</b>,{' '}
      <b>screen exit</b>, and the player <b>spawn</b> is an entity you can select
      and edit.
    </p>
    <p>
      <b>Navigate:</b> scroll to zoom; drag an empty area (or middle-drag) to
      pan.
    </p>
    <p>
      <b>Select:</b> click an entity. Its fields appear in the Properties panel.
      Clicking again at the same spot cycles through anything stacked underneath.
    </p>
    <p>
      <b>Multi-select:</b> shift+drag draws a selection box &mdash; every object
      and sprite inside it is added to the current selection (shift+click adds or
      removes a single entity).
    </p>
    <p>
      <b>Move:</b> drag a selected entity. <b>Place:</b> open the Place panel,
      pick an object or sprite, then click the canvas. <b>Delete:</b> select and
      press Delete, or use the erase tool.
    </p>
    <p>
      <b>Follow warps:</b> double-click a screen exit to jump to its destination;
      double-click an incoming marker to jump back to its source.
    </p>
    <p>
      <b>Saving &amp; testing:</b> edits are in-memory until you Save. Use
      Undo/Redo for level edits. <b>Test&nbsp;Level</b> saves, rebuilds the ROM
      if needed, and boots the level in BizHawk; <b>Launch</b> cold-boots the
      game without loading a level.
    </p>
    <p>
      Each tool panel (Tiles, Palette, Properties, &hellip;) has its own{' '}
      <b>?</b> button with help specific to it.
    </p>
  </>
)

/** About-page body. Fetches the running app version on mount. */
export function AboutBody(): JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.shinyEgg.getAppVersion().then((v) => {
      if (live) setVersion(v)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="se-about">
      <div className="se-about__name">Shiny Egg</div>
      <div className="se-about__tagline">A Yoshi&rsquo;s Island (SNES) level editor</div>
      <div className="se-about__version">{version ? `Version ${version}` : 'Version …'}</div>

      <div className="se-about__thanks">
        <div className="se-about__thanks-title">Thank You</div>
        <p className="se-about__thanks-intro">
            Shiny Egg is my attempt to give back to a community that I've gotten so much joy
            from over many years. It's also built on the work of many others and without that
            work this tool couldn't exist. So thank you to these folks and many more.
        </p>
        <ul className="se-about__credits">
          <li>
            <b>Yoshifanatic</b> - the SNES ROM Framework and YI disassembly
            this editor is built on.
          </li>
          <li>
            <b>Raidenthequick &amp; brunovalads</b> - the descriptively
            labeled YI disassembly and brunovalads&rsquo; BizHawk debugging script.
          </li>
          <li>
            <b>Romi</b> - the GoldenEgg editor and the tile metadata therein.
          </li>
          <li>
            <b>SMW Central</b> - the Yoshi&rsquo;s Island offsets thread and
            community memory map.
          </li>
          <li>
            <b>The Yoshi&rsquo;s Island hacking wiki</b> - ROM, RAM, and
            Super&nbsp;FX maps plus sprite &amp; level lists.
          </li>
          <li>
            <b>The Cutting Room Floor</b> - unused-content and debug
            documentation.
          </li>
          <li>
            <b>Blumiere (Count Bleck) &amp; Yoshis Fan</b> - sprite-set
            compatibility lists.
          </li>
          <li>
            <b>
              <a
                href="https://github.com/KarisaAdvynia/Advynia"
                target="_blank"
                rel="noreferrer"
              >
                Advynia
              </a>
            </b>{' '}
            (KarisaAdvynia) - the GBA Yoshi&rsquo;s Island editor whose pointer
            maps and conversion code make importing levels from the Game&nbsp;Boy
            Advance version possible.
          </li>
          <li>
            <b>asar</b>, <b>BizHawk</b>, <b>Mesen</b>, and <b>Lunar Compress</b>{' '}
            - the assembler, emulators, and compression reference behind the
            build, testing, and graphics decoding.
          </li>
          <li>
            <b>M1TE</b> - the SNES tile/map editor bundled with the app for
            editing exported BG-layer, world-map, and screen graphics; a fork of{' '}
            <b>
              <a
                href="https://github.com/nesdoug/M1TE2"
                target="_blank"
                rel="noreferrer"
              >
                M1TE2
              </a>
            </b>{' '}
            (Doug Fraker / nesdoug).
          </li>
        </ul>
      </div>

      <p className="se-meta se-about__legal">
        Yoshi&rsquo;s Island is &copy; Nintendo. This is an unofficial fan-made
        tool, not affiliated with or endorsed by Nintendo.
      </p>
    </div>
  )
}
