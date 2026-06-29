# YI sprite neighbour-dependency reference

A level-designer-facing inventory of the normal-sprites whose behaviour depends
on **neighbouring placed level data** -- another object, another sprite, a painted
Map16 tile, or per-screen metadata that the designer must position correctly for
the sprite to work. The motivating example is the line-guided platform ($18D and
its siblings), which has no path of its own: it reads a rail painted from
line-guide objects in the surrounding tilemap and follows it.

For each relationship this doc answers three questions: **what** the sprite reads
(sprite / std-object / Map16 tile / screen-metadata), **where** it reads it from
(data region + key, and the spatial rule), and **which** targets it looks for.

Built by static analysis (every neighbour-reading primitive traced through the
65816 sprite code and the GSU-2 SuperFX disassembly), then **re-derived end to
end by the 2026-06-10 deep audit** (every `FXCODE_0ACE2F` caller classified, a
full level-buffer reader sweep, exit-table + sprite-scan audits, and an
empirical cross-check of every candidate against all shipped placements). The
audit corrected the old Class-B "keyhole snap" reading (it is the **ice-block
snap**), restored a wrongly ruled-out sprite ($1A4), and added a dozen missed
relationships. This doc is the framework-side reference for the corrected
model; the regression gate is `scripts/engine/validate-neighbor-deps.ts`.

This doc complements:

- `docs/spritestateengine.md` -- the per-sprite Init/Main dispatch every entry
  here hangs off.
- `docs/family-platforms.md` -- the platform family in depth.
- `docs/family-collectibles.md` -- the Key / door / flower chain.
- `docs/leveldataengine.md` -- the Map16 tilemap (LDB) these sprites read, and the
  object stampers that paint the rail tiles.
- `docs/family-pipes-signs.md` -- the warp sprites and the screen-exit table.

Source of truth: `yi/Banks/*.asm` (sprite Inits/Mains), `yi/SuperFX/Banks/*.asm`
(GSU scanners), `yi/Constants/{NormalSpriteIDs,ObjectIDs}.asm` (names).

GSU probe conventions (used throughout): the caller stages **probe X in R8,
probe Y in R0** (pixel coords), and the probe returns **R6 = the 16-bit Map16
tile ID**, **R7 = the page collision-attribute word** (`(R7 & $F800) >> 11` =
the 5-bit secondary tag; low bits = shape flags), **R5 != 0 = solid/occupied**.

---

## Summary

| Class | Relationship | Grade | Target kind |
|---|---|---|---|
| A | Rail followers (11 required + 4 rail-optional) | required / enabling | std-object |
| B | Ice-block snap (19 sprites share the prologue) | enabling | Map16 tile (collision tag $17) |
| C | Direct tile reads (slime, icicle, bomb path, cork, wall-holes, falling rock + notes) | required / enabling | Map16 tile |
| D | Sprite-to-sprite co-placement (cloud, switches, doors+key, mouser, slugger) | required / enabling | sprite |
| E | Screen-exit metadata (5 warps + frog-pirate swallow) | required / enabling | screen-metadata |
| F | Tile-conditional behaviour (pipe spawners, dirt diggers, pipe centring) | enabling / cosmetic | Map16 tile / collision tag |

**Grade**: *required* = absence breaks the sprite; *enabling* =
placement adds behaviour, absence is still a valid sprite;
*cosmetic* = alignment only.

---

## Class A -- rail followers (read line-guide rail tiles)

**Sprites (required):** `$185-$18E` (the ten line-guided platforms) and `$18F`
(SpiralPlatform). **Sprites (rail-optional):** `$055`/`$056` (the MANUAL
Yoshi-spun pinwheels). The auto-rotating pinwheels `$064`/`$15E` are **not**
rail followers -- see the correction below.

**Mechanism.** The shared Main calls the SuperFX rail-walker `CODE_0B89E9`
(`yi/SuperFX/Banks/Bank0B.asm:829`) via the 65816 entry points `CODE_04A9FD`
(`Bank04.asm:5758`) and `CODE_04AAA2` (the spiral). The walker's loop body
`CODE_0B8C44` reads the live Map16 tilemap (`!RAM_YI_Level_LevelDataBuffer`) at
the platform's own grid cell and matches any tile whose high byte is `$87`
(i.e. `$87xx`); the low byte indexes a per-cell heading table. The platform
steps tile-to-tile along the connected run of `$87xx` cells.
`main_four_rotating_platforms` (`Bank04.asm:8418`) calls the same entry with
the identical position-delta idiom -- a pinwheel placed on a rail travels it.

> **Corrected 2026-06-11 (was: "off-rail the pinwheels rotate in place").**
> The pinwheel cluster's rail mode is armed ONCE, at the first active frame:
> `CODE_04C530` (`Bank04.asm:8694`) probes the Map16 word at the sprite's
> spawn cell and sets the travel flag (`$77,x`) only when the page is `$87`
> -- and only for the manual variants `$055`/`$056` (`$064`/`$15E` branch
> around the probe entirely). **Off a rail, a manual pinwheel does NOT sit
> still:** `CODE_04C7F4` (`Bank04.asm:9062`) copies the signed rotation speed
> (`$19,x`, driven by Yoshi walking on the platforms) into the engine X-speed
> field every frame, so spinning FREE-ROLLS the whole cluster horizontally
> (it coasts to a stop via `CODE_04C7D1`'s decay when nobody rides it). On a
> rail that conversion is skipped and the spin drives rail travel instead.
> The auto variants `$064`/`$15E` skip both paths -- they are anchored
> constant-speed spinners (`$19,x` preset from `DATA_04C242` at init) and
> never translate. Empirical anchor: the `$056` in level `$26` (5-3) travels
> with no line guide in the level at all.

**What stamps the rail.** The `$87xx` tile family is produced **only** by the
line-guide std-objects `$CE-$D2` -- `$CE` LineGuideDiagonal, `$CF`/`$D0` gradual
variants, `$D1` LineGuideVertical, `$D2` LineGuideHorizontal (Bank13 stampers at
`Bank13.asm:13405-13467`; defines at `ObjectIDs.asm:243-247`). The lift-track
objects `$10-$13` stamp a different, low-ID tile family (`$00xx`) and are
**not** followed by this walker.

**Designer rule.** Paint a connected path of line-guide objects under/along the
platform's spawn cell. The moving variants ($185-$188) travel it continuously,
the stationary variants ($189-$18E) advance only while Yoshi rides, the spiral
($18F) orbits the rail-derived pivot, and the manual pinwheels ($055/$056)
travel it as Yoshi spins them. **If absent:** the eleven line-guided platforms
drift or stall (a real error); the manual pinwheels free-roll horizontally
when spun instead (valid -- only 3 of 40 shipped pinwheel placements sit on a
rail; the rest rely on the free-roll, e.g. the `$056` ferry in 5-3).

---

## Class B -- ice-block snap (collision tag $17)

> Corrected by the 2026-06-10 audit. The old reading -- "snap to a painted
> `$B8xx` keyhole tile page" -- misread the probe's R7 (the page
> collision-attribute word) as a tile ID. There is no `$B8xx` relationship.

**Mechanism.** `CODE_02A007` (`Bank02.asm:3399`) is a shared Init prologue. It
tile-aligns the sprite's own (X,Y) (`X &= $FFF0 | $0008`, same for Y), runs the
GSU single-cell probe `FXCODE_0ACE2F` once at that cell, and tests the
returned **R7 attribute word**: `(R7 & $F800) == $B800` -- i.e. the cell's page
carries collision **secondary-tag `$17` = ice-block** (pages `$89`/`$8C` in the
cart table). On a match it teleports the sprite onto that cell
(`$6000/$6002 -> $70E2/$7182`) and forces a re-init: the sprite is **centred
inside the ice cube** -- the frozen-enemy presentation of 5-3.

**Sprites (19 share the prologue).** Key `$027`, the doors
`$001/$012/$093/$04E/$131/$0CA`, Flowers `$0FA/$110`, SpringBalls
`$06C/$06F/$148`, EggPlant `$0F4`, Bumpty `$184`, Shyguy `$01E`, LanternGhost
`$133` (those two via the respawn/seam sub-path), Watermelons `$005/$007/$009`.

**Designer rule.** Place the sprite **on** an ice-block tile (a page-`$89`/`$8C`
tile, e.g. `$8900`) to encase it in the cube. **If absent:** no snap; the
sprite spawns free-standing -- a perfectly valid placement, so this is an
*enabling* annotation, never an error.

**Shipped usage:** 16 placements fire the snap -- 12 Shyguys, 2 Bumpties, 2
Flowers, all in level `$26` (5-3 "Danger -- Icy Conditions Ahead") + sub-room
`$5D`. The doors/Key never ship on an ice block; they simply share the prologue.

---

## Class C -- direct tile reads

Sprites whose Init/Main compares a probed Map16 tile against specific IDs,
ranges, or collision tags.

| Sprite | Name | Target | Where read | Grade / if absent |
|---|---|---|---|---|
| `$03F` | SlimeBlock | exact tile `$0174` (slime floor) | direct LDB read at (X-$18, Y-$38) -- `init_slime`, `Bank06.asm:54-101` | **required** -- fails to lock; Salvo boss-floor breaks |
| `$190` | FallingIcicle | anchor tiles `$8E00-$8E02` at own cell; `$799D` stems above set length | `CODE_0C80E4` (`Bank0C.asm:199`) + detach-state re-probes | **required** -- init DESPAWNS without an anchor (21/21 shipped placements sit on one) |
| `$105`/`$106` | BooGuysCarryingBomb | marker tiles `$00B6-$00BA` on the own row | init probes a side cell then scans the row (`CODE_0D8370/0D8407`); run length sets chain count + patrol bounds | **required** -- degenerate patrol without the markers (28/28 shipped within +/-2 cells) |
| `$1A4` | KeyholeCork | locked-keyhole tile `$7D24` at own cell (stamped by ext-object `$E0`; rewritten to `$7D22` on unlock) | `CODE_07FEFF` (`Bank07.asm:15982`); unlock also needs the carried Key (Class D) | **required** -- the cork never unlocks (1/1 shipped sits on `$7D24`) |
| `$1E0` | WallLakituGenerator (special sprite) | wall-hole tile `$0010` anywhere on its screens | per-frame camera-relative probes, spawns `$157` only where tile == `$0010` (`CODE_main_wall_lakitu_gen`, `Bank03.asm:11985`) | **required** -- a dead generator without holes (1/1 shipped: level `$0F`, 37 hole cells). NOTE: placed `$157` Wall Lakitus do NOT read the tile -- 85% sit on `$0010` purely by convention |
| `$0DE` | FallingRockPlatform | falling-floor tiles (collision tag `$0E`) at own cell | `FXCODE_0ACD1E` sizes/orients the platform from the contiguous run, despawns on mismatch (`Bank02.asm:2948`) | **required** by mechanism; 0 shipped placements (the `$137-$13A` stones use fixed sizes, no probe) |
| `$1A5-$1A9` | Grinders / monkeys | tree-trunk pages `$99xx`/`$9Axx` near the sprite | init side-snaps to an adjacent trunk (`CODE_02ADC4`); main climb/jump logic keys on the pages (`CODE_02B3E8`) | **enabling** -- ground walker without trees (68/148 shipped adjacent at spawn) |
| `$0A6`/`$0A8` | IncomingChomp | bitable floor `$2A00/$2A01/$2A2D/$2A2E` (+ per-tileset slot `[$1C22]`) | main probes below/anchor (`CODE_0E8A3F`); a match carves 4 cells via `change_map16` | **enabling** -- the bite set-piece; still chases without (14/14 shipped levels contain the tiles) |

---

## Class D -- sprite-to-sprite co-placement

Sprites that read *another placed sprite* (not a child they spawn themselves).

| Sprite | Name | Needs | Mechanism / where | Spatial rule | Grade / if absent |
|---|---|---|---|---|---|
| `$067` | RockRevealedHiddenWingedCloud | `$09E` ChompRock **or** `$0DC` Snowball | per-frame proximity probe `FXCODE_099011` + ID check (`Bank0F.asm:2090-2096`) | **positional** -- the rock must be able to roll into the cloud's box | **required** -- prize unreachable (10/10 shipped levels have one) |
| `$15C` / `$15D` | Green/Red RotatingPlatformSwitch | `$15F` / `$160` platform (same color) | writes global pair-state `$0FD5,y` (`y` = color) on egg-hit (`Bank0D.asm:5509`) | **global by color** -- position irrelevant | **required** -- dead switch |
| `$15F` / `$160` | Green/Red SpikedPlatform | `$15C` / `$15D` switch (same color) | reads global `$0FD1,y` / `$0FD5,y` | **global by color** | **required** -- never flips |
| `$04E` / `$131` / `$0CA` | LockedDoor / BigBossDoor | `$027` Key | door reads the top of Yoshi's egg-inventory stack `$7DF6`, checks ID == `$027` (`Bank02.asm:3811`) | carried (the player brings the key over -- a connected sub-room in every shipped case) | **required** but cross-record -- satisfied in a connected room, informational only |
| `$1A4` | KeyholeCork | `$027` Key | unlock path `CODE_07FE73` checks the carried sprite | carried | as the locked doors |
| `$033` | LittleMouserExitingNest | `$02F` LittleMouserHole | by-ID nearest-sprite probe `FXCODE_098EBF` (`#$002F`) -- homes on the nearest ACTIVE nest | **same cell** -- the mouser pops out of its hole (confirmed in-game; all 22 shipped placements at distance 0) | **required** -- no nest under it; the pop-out visual breaks |
| `$0F5` | Slugger | `$09E` ChompRock | by-ID probe `FXCODE_098EBF` (`#$009E`): bats an approaching rock back (XSpeed +/-$400); `$09E`'s own scan reciprocally excludes Slugger (`Bank0E.asm:8736`) | global | **enabling** -- the Baseball Boys duel; swings at Yoshi/eggs regardless (9/15 shipped placements co-occur) |

The switch/platform pairing is purely color-keyed (`pair-index = (id - base) << 1`,
no position term), so any green switch anywhere controls every green platform in
the level.

---

## Class E -- screen-exit / message metadata

The neighbour is per-screen level metadata, not a placed sprite/object.

| Sprite | Name | Reads | Designer must set |
|---|---|---|---|
| `$042` | VerticalPipeEntrance | Screen-Exit Table `$7F:7E00` (indexed by the screen Yoshi exits on, via `CODE_02A4B5`) | the exit row (dest level / X / Y / entrance type) for the pipe's screen-region |
| `$0D0` / `$147` | Horizontal pipe (right / left) | same | same; facing comes from the sprite ID |
| `$0D1` | SecretPipeEntrance | same, plus a level-event enable flag (`$7E08`) | same + the enable flag |
| `$084` | TeleportSprite | same (invisible trigger) | same |
| `$017` | FrogPirate | fires a screen exit from its swallow state (`CODE_0EEC2C` -> `CODE_02A4B5` -- the Prince Froggy gulp -> belly warp) | an exit row; **spatial rule unresolved** (only 1/7 shipped placements has an exit on its own/adjacent screen -- likely keyed to the player's screen at swallow time). Annotation only until traced. |
| `$0AD` | MessageBox | level ID (`$00:021A`) + its own sub-cell X/Y bit-4 -> one of 4 message slots | the level's four message strings; sub-cell placement picks which. Position-ENCODING, not a neighbour -- not a carried dependency. |

The warp destination is **not** read from the sprite's own coordinates -- it comes
from the screen-exit row.

---

## Class F -- tile-conditional behaviour

Placement on a specific tile *adds* behaviour; absence is always a valid sprite.

| Sprite | Trigger | Behaviour | Where |
|---|---|---|---|
| `$01E` Shyguy / `$133` LanternGhost / `$19A` BooGuy | own cell is a pipe mouth: tile `$79F1`/`$79F2`, or page collision-tag `$14` (page `$7D`) -- gate `CODE_0EB8AE` (`Bank0E.asm:7359`) | becomes a continuous pipe spawner: emits copies of itself (proximity-gated, <7 alive, ~192-frame cooldown) -- 57 shipped placements | shy-guy state 8 (`Bank04.asm:2219`) / `CODE_0C8F5D` |
| `$054` / `$066` WildPiranha | pipe mouth one cell below (gate entry `CODE_0EB8B7`) | +8px auto-centring on the mouth -- cosmetic only (5/87 shipped) | `Bank05.asm:4622` |
| `$0FD` ZeusGuy | breakable soft-dirt (collision tag `$08`) ahead / above | digs and punches through (`change_map16` clears the cell) | `CODE_07D550/07D701` |
| `$154` SharkChomp | tag-`$08` dirt ahead | eats through it while chasing (the 3-4 set-piece) | `CODE_0DA38B` |
| `$00B` Cannonball / `$060` Bomb | tag-`$08` dirt in the explosion's 8-neighbour ring | excavates it | `CODE_0E814D` |
| `$156` CactusJack | calls the same pipe gate but only to orient its emerge | never spawns -- kept as a near-miss | `Bank0E.asm:7317` |

---

## Empirical validation (level data)

Every relationship above was cross-checked against every shipped level's
placement data (decode every backed level, evaluate each placement against the
claimed targets; the standing regression gate is
`scripts/engine/validate-neighbor-deps.ts`, which pins per-class met counts and
zero false errors):

- **Class A** -- all **20/20** levels containing a rail platform ($185-$18F) also
  contain line-guide objects ($CE-$D2); none contain lift-tracks. Pinwheels:
  **3/40** placements sit on a rail (levels `$2A/$58/$7B`) -- rail-optional.
- **Class B** -- **16** placements fire the ice snap (levels `$26`/`$5D`, tile
  `$8900`); 0 doors/keys ever sit on an ice block.
- **Class C** -- icicle **21/21** on `$8E01/$8E02`; boo-bomb markers **28/28**
  within +/-2 cells; cork **1/1** on `$7D24`; wall-lakitu generator **1/1** with
  37 `$0010` cells; falling-rock platform unused (0 placements).
- **Class D** -- cloud **10/10**; switch/platform pairs **2/2 + 2/2** by color;
  mouser->hole **22/22**; slugger+rock **9/15** (interaction, not required).
- **Inverse sweep** -- per-sprite own-cell tile/tag distributions over all
  shipped placements (33 flagged patterns) all resolved: every exact-tile correlation
  not listed above (placed Wall Lakitus on `$0010`, Ravens on `$0005`, the
  maces/firebar anchors, fish in water pages) is **art convention, never
  code-read**.

## Ruled out (kept so the inventory is provably complete)

Mechanisms and sprites that look like neighbour readers but are not:

- **`CODE_0BBCF8`** -- a generic fixed-point vector-math primitive; 83 callers,
  reads neither tiles nor Yoshi.
- **`CODE_098F33`** -- "find nearest active sprite" (any ID); 15 caller groups,
  all runtime collision/trigger scans, none designer pairings. Its by-exact-ID
  sibling **`FXCODE_098EBF`** carries the two real pairings (Slugger, Mouser).
- **`get_map16_above/below/left/right`** + `CODE_1286FD` -- every caller is in
  Bank12/Bank13 (the object-stamp engine); zero sprite-bank callers.
- **SuperFX probes `0ACE2F`/`0ACE3F`/`0ACE92` + the 8 sibling wrappers**
  (`0A81C9/0A8390/0ACD1E/0ACDFA/0AE602/0AE864/0AE921/0AEA19`) -- all ~90
  sprite-side caller routines classified: beyond the relationships above,
  every use is a terrain/solidity/shape probe (wall-ahead, floor-finder, body
  perimeter, spit-destination, spawn-occupancy...). `0ACE3F`/`0ACE92` belong to
  RedCoinBandit `$05B` terrain navigation.
- **Population couplings** -- the caged ghosts `$193`/`$010` cap their spawning
  on the live count of `$0F3` WoozyGuy / `$01E` Shyguy (`FXCODE_0991DB`), and
  the pipe-spawner cap `FXCODE_099204` counts eggs + the shy-guy family: placed
  family members suppress spawner output. Real couplings, 0 shipped
  co-occurrences -- noted, not dependencies.
- **Anchor-art conventions (no code read):** placed `$157` Wall Lakitus on
  `$0010`; Ravens `$135/$136` on `$0005`; maces `$101/$102/$103` on
  `$0183`/`$3D67`; Firebar `$1A1` on `$0029`; ChainedSpikeBall `$10C` /
  SpikedLog `$126` peg tiles (their raycast measures chain length against
  generic solids). Hootie/mini-ravens/Piro-Dangle need an adjacent *solid* to
  orbit (collision flags), never a tile ID.
- **X-parity variant selects** -- `AND #$0010` on the own X coordinate
  (WallLakitu, the maces, Firebar, peeking Mouser): the placement's odd/even
  cell column flips a variant. Position-encoding (like the MessageBox sub-cell),
  not a neighbour.
- **Self-contained / self-encoded sprites:** `$089`/`$08A` moving platforms,
  `$162` (renders its own switch + platforms), `$095`/`$096` checkered blocks;
  the winged-cloud stair/platform builders `$0BA`/`$0BB` (write tiles, no
  designer target).
- **Generators spawning their own children** (Burt `$0E7`, the Lakitus, Dr.
  Freezegood-on-ski-lift `$01D`, etc.) -- the partner is spawned, not placed.
- **Runtime collisions and Yoshi-relative reads** -- e.g. `$014` KeyFromBoss
  warps to Yoshi-relative coords; `$01F` RotatingDoors *writes* the exit table
  from a ROM table. AquaLakitu `$170` (water-surface skim tiles) and
  JeanDeFillet `$104` (page-`$7E` Y-nudge) read tiles at *runtime* positions,
  not at the placement cell (0/3 shipped placement cells match) -- terrain.
