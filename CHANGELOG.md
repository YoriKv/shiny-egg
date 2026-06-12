# Changelog

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
