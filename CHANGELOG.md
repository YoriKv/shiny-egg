# Changelog

## v0.7.3 - 2026-08-02

- Corrected license to GNU GPL v3.0, matching the SNES ROM
  Framework and disassembly it is built on, also better license compliance

## v0.7.2 - 2026-07-29

- Message text and level names can now extend beyond byte limit by using freespace
- Importing a ROM text that extended beyond vanilla byte limit import correctly

## v0.7.1 - 2026-07-19

- Lots of fixes and improvements to the graphics editing pipeline
- Credits text now editable in strings panel

## v0.7.0 - 2026-07-09

- Bug fixes and performance improvements.
- World map Yoshi path editor.
- BPS patch support.
- Export as patch option added.
- New audio panel with a complete audio editing pipeline including...
- Preview audio in editor.
- Sequencer view in editor (read only).
- Song sets tab with complete ARAM visualization and list of songs.
- SFX tab with list of sound effects and preview.
- Song sets editor tab that allows editing which music header value maps to which song set and song.
- Song set editor also lets you see and edit the song set data (what it loads and in what order).
- Music, SFX, and Samples export/import.
- Import AMK and AMY compatible music.
- Export, edit, and import SFX via MML.
- Export, edit, and import samples via brr or wav.

## v0.6.1 - 2026-07-04

- Add a zoom percent view and dropdown.
- Screen exit outline.

## v0.6.0 - 2026-07-03

- New "basic" sprite and object outline mode that mimics Advynia editing style.
- Added keyboard shortcuts for the hide/show outline/bg buttons.
- Cleaned up exit/entrance visuals.
- Added room list help entry.
- M1TE map export panel similar to YYCHR.

## v0.5.12 - 2026-07-03

- Improved placement tool and panel UX.
- Improved selection UX. Level tiles are now selectable and draggable by their drawn tiles.
- World map level mappings can now correctly map to any record id.
- Camera preview now locks panning to level bounds.
- Fixed a data corruption bug caused by erasing many tiles quickly in a row.

## v0.5.11 - 2026-07-03

- Dedicated YYCHR export panel with file browser, thumbnail previews, and in project storage.
- Mesen added to emulator selection for MacOS.
- Right click -> reset position added to panels.

## v0.5.10 - 2026-07-02

- Ycompress style graphics export and YYCHR integration for those exported files.
- More color palette editing options.
- MacOS support, experimental.

## v0.5.9 - 2026-07-01

- Doc cleanup and some fixes.

## v0.5.8 - 2026-07-01

- Fixed graphics import error due to lz2/lz16 mislabeling.
- Added level -> yoshi color mapping editor and import to world map panel.
- Other small improvements to import from rom UI.

## v0.5.7 - 2026-07-01

- Automatic backups of open project taken every 10 minutes stored as zip files.
- Getting Started guide in github wiki.

## v0.5.6 - 2026-06-30

- New version of M1TE with a bunch more UX updates, fixes, and improvements.
- Graphics export adjustments and bug fixes.

## v0.5.5 - 2026-06-30

- Even more graphics export adjustments and bug fixes.

## v0.5.4 - 2026-06-30

- More M1TE improvements.
- More graphics export bug fixes.

## v0.5.3 - 2026-06-29

- New version of M1TE with shortcuts for changing BG views and preview mode is now a toggle that keeps your current layer editable.
- Graphics export bug fixes.
- ASM overlay cleanup and fixes.

## v0.5.2 - 2026-06-29

- New Camera Preview overlay. A movable in-game viewport that simulates the SNES camera with accurate parallax of background layers and the sky gradient.
- ROM import fixes and updates. Now imports changed GFX sheets, the overworld island tilemap, and the title-screen logo tilemap.
- New project name popup.
- Message font and message box graphics extract/import for editing pipeline.
- Palette "Sync to Emulator" with Auto Sync. Color edits can now update the running emulator live as you edit them.
- Backdrop gradient visuals now match in game visuals.

## v0.5.1 - 2026-06-28

- Color palette editing for non-level scenes.
- Level gradient editing.
- Push palette edits to emulator via CGRAM (experimental).
- Graphics import/export cleanup.

## v0.5.0 - 2026-06-26

- New Validation panel. Runs checks against level data looking for issues that may not be apparent in the editor, but can show up during gameplay.
- New graphics export path using a bundled tile editor: the app now ships M1TE, a SNES Mode 1 tile/map editor, modified with some UX improvements. Harder to use than Aseprite, but has more accurate editing especially for 16x16 tile placement and support for placing the same tiles in different palettes.
- Palette editing through export/import.
- Graphics export now supports the overworld map graphics, in addition to the boot, title, and selection of storybook screens.
- All sprite names reviewed and cleaned up.
- New built-in patch, Unlock All Worlds and Levels.

## v0.4.2 - 2026-06-23

- Better getting started readme and clearer first use pointing the user to extract reference assets.
- Cleaned up initial size and position of all panels.

## v0.4.1 - 2026-06-23

- String now editor supports intro story and ending text.
- On screen keyboard for inserting special glyphs into the string editor.
- Color picker for setting the color of grid lines.

## v0.4.0 - 2026-06-22

- Level object/tile rendering is now a byte exact match with the base rom running in an emulator, except for 2 boss levels.
- Place object/sprite panel is now much more responsive and quick to load.
- Almost all sprites have an in editor render.
- Minimap view for levels.
- World map editing.
- Exits map graph that shows all subrooms and their exit connections.
- Sprite specific properties and rendering for sprites that change based on x/y odd/even position.
- Neighbor relationship and other sprite specific hints such as showing the contents of the hidden winged clouds, platforms that attach to guides, and exits connecting to their pipes.
- Shift click on an object in the place panel to auto-fill the find box to search for instances of it.
- New Graphics panel: export a level's background and sprite graphics to PNG or Aseprite tilemaps, edit them in your own image editor, and import them straight back. Changes preview live on the canvas without a rebuild and persist when you reopen the project.
- Import levels from the Game Boy Advance version (Super Mario Advance 3): the editor reads its cartridge, transcodes each sub-level into the SNES level format, and reports anything that couldn't be carried over.
- Background layers now render correctly across more level types and scene set-ups.

## v0.3.8 - 2026-06-14

- Linux support: the editor now ships as a Linux AppImage (x64) alongside the Windows build. In-game testing on Linux uses BizHawk's EmuHawk.sh launcher.
- The Add picker flags runtime-spawned sprites - projectiles, thrown children, boss parts, event actors - with a "spawn-only" badge, so it's clear which sprites the game creates on its own rather than ones you place by hand.
- ROM import now rejects abandoned or clobbered level slots that decode to garbage instead of importing them as real levels, and explains why in the report.
- Fix: Testing a level in-game no longer hangs the music — the loader warms up the overworld first so death/defeat jingles and the bonus theme play correctly.
- Fix: Removing a level no longer leaves phantom checkpoint restart points on a neighbouring level in the world map.
- Fix: Saving a level now verifies its data survives a clean round-trip and refuses to write corrupt data, guarding against phantom objects and broken builds.
- Fix: The Object Finder refreshes its results after switching projects or importing a ROM.
- Fix: Pressing Escape, or finishing a placement, now clears the Place tool so its toolbar button de-highlights.

## v0.3.7 - 2026-06-12

- Vanilla levels can now be removed from the game with a preview of the impact before confirming (freed space, world-map slots, warps that would be stranded). Removed levels can be restored later, and new blank levels can be created in freed or unused slots.
- ROM import can optionally remove all remaining vanilla levels after the import, for hacks that fully replace the original game.
- Minibattle exits offer a named list of minigame variants instead of a raw value.
- The editor now detects when previously extracted data is out of date after an update and prompts a re-extract.
- Fix: Fixed some world map and level id mapping issues.

## v0.3.6 - 2026-06-12

- ROM import upgrades: hacks that add brand-new levels now import into unused slots, relocated levels that no longer fit their original banks are migrated to free space automatically, world-map slot remaps carry over, and the report includes a full inventory of everything the hack changed.
- Screen exits can now be placed, not just duplicated. Properties can convert an exit between warp and minibattle.
- New Exits Map panel: the level's whole warp network drawn as linked screen grids, with exits, entrance landings, and the connections between them.
- Fix: Entrance markers stay in sync while editing: placing or retargeting a warp exit moves the matching entrance marker immediately, and markers in other levels refresh after a save or import.
- Fix: Level Banks: the sprite-data de-couple control now stays available for levels migrated to free space.

## v0.3.5 - 2026-06-11

- Add picker: per-entry thumbnails rendered from the cart graphics, plus render-validity badges. Entries whose art can't render under the current level's header are flagged and hidden by the "In Level Tileset" filter.
- Sprite behavior overlays on selection: trigger/wake zones, patrol extents, orbit rings, and runtime-snap ghosts, each with a matching read-only Properties row.
- Placement-parity variant rows + on-outline badges showing what a sprite's placement cell selects (direction, orbit size, spawn behavior, prizes), with corrected parity mappings.
- Sprite neighbour-dependency pass: corrected rules, designer-rule tooltips, and a "needs setup" picker filter + badge.
- New built-in patches
- Collision layer and exit-trigger data fixes; tileset/palette-changer region rendering.
