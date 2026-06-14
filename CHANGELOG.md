# Changelog

## v0.3.8 - Unreleased

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
