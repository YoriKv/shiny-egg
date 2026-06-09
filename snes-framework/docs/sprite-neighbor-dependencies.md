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

This was built by static analysis: every neighbour-reading primitive was traced
through the 65816 sprite code and the readable GSU-2 SuperFX disassembly
(`yi/SuperFX/Banks/Bank08-0B.asm`), so the matched tile families, scan geometry,
and target sets are all resolved from source rather than observed at runtime.

This doc complements:

- `docs/spritestateengine.md` -- the per-sprite Init/Main dispatch every entry
  here hangs off.
- `docs/family-platforms.md` -- the platform family in depth (rail followers are
  §4 there).
- `docs/family-collectibles.md` -- the Key / door / flower keyhole-snap chain
  (§6) and item-memory write-back.
- `docs/leveldataengine.md` -- the Map16 tilemap (LDB) these sprites read, and the
  object stampers that paint the rail tiles.
- `docs/family-pipes-signs.md` -- the warp sprites and the screen-exit table.

Source of truth: `yi/Banks/*.asm` (sprite Inits/Mains), `yi/SuperFX/Banks/*.asm`
(GSU scanners), `yi/Constants/{NormalSpriteIDs,ObjectIDs}.asm` (names).

---

## Summary

| Class | Relationship | Count | Target kind | Confidence |
|---|---|---|---|---|
| A | Rail followers | 11 | std-object | high |
| B1 | Keyhole / door snap | 9 | Map16 tile | high |
| B2 | Incidental anchor-snap prologue | 10 | Map16 tile | low (intent) |
| C | Direct tile-ID scan | 1 | Map16 tile | high |
| D | Sprite-to-sprite co-placement | 8 | sprite | high / med |
| E | Screen-exit / message metadata | 6 | screen-metadata | high / borderline |

"Confidence" is about *designer intent*, not mechanism: B2 sprites really do run
the snap, but a designer would not normally place them on a keyhole tile.

---

## Class A -- rail followers (read line-guide rail tiles)

**Sprites:** `$185-$18E` (the ten line-guided platforms) and `$18F`
(SpiralPlatform).

**Mechanism.** The shared Main calls the SuperFX rail-walker `CODE_0B89E9`
(`yi/SuperFX/Banks/Bank0B.asm:829`) via the 65816 entry points `CODE_04A9FD`
(`Bank04.asm:5758`, the ten platforms) and `CODE_04AAA2` (`Bank04.asm:5841`, the
spiral). The walker's loop body `CODE_0B8C44` (`Bank0B.asm:1206`) reads the live
Map16 tilemap (`!RAM_YI_Level_LevelDataBuffer`) at the platform's own grid cell
and matches any tile whose high byte is `$87` (i.e. `$87xx`); the low byte indexes
a per-cell heading table. The platform steps tile-to-tile along the connected run
of `$87xx` cells.

**What stamps the rail.** The `$87xx` tile family is produced **only** by the
line-guide std-objects `$CE-$D2` -- `$CE` LineGuideDiagonal, `$CF`/`$D0` gradual
variants, `$D1` LineGuideVertical, `$D2` LineGuideHorizontal (Bank13 stampers at
`Bank13.asm:13405/13422/13441/13461/13467`; defines at `ObjectIDs.asm:243-247`).
The lift-track objects `$10-$13` stamp a different, low-ID tile family (`$00xx`)
and are **not** followed by this walker.

**Designer rule.** Paint a connected path of line-guide objects under/along the
platform's spawn cell. The platform follows that path; the moving variants
($185-$188) travel it continuously, the stationary variants ($189-$18E) advance
only while Yoshi rides, and the spiral ($18F) orbits the rail-derived pivot.

**If absent.** No `$87xx` tile at the walker's cell -> no path; the platform
drifts or stalls in place.

---

## Class B -- keyhole / anchor snap (read a painted `$B8xx` tile)

**Mechanism.** `CODE_02A007` (`Bank02.asm:3399`) is a shared Init prologue. It
tile-aligns the sprite's own (X,Y) (`X &= $FFF0 | $0008`, same for Y), runs the
GSU single-cell Map16 reader `FXCODE_0ACE2F` once at that cell (it is a
single-cell read, **not** an outward radius scan), and if the returned tile ID
falls in the `$B8xx` page (`(id & $F800) == $B800`) it teleports the sprite onto
that cell (`$6000/$6002` -> `$70E2/$7182`) and forces a re-init.

**What the tile is.** `$B8xx` is a designer-**painted** Map16 BG-art tile page
(used most visibly for keyholes). No object stamper writes it -- a Bank12/Bank13
sweep finds no `$B8xx` tile write -- so the designer paints it directly. The test
is page-only (top five bits), so any tile in `$B800-$BFFF` triggers the snap for
any caller.

The 16 Init callers split into two tiers.

### B1 -- deliberate keyhole / door relationship (high)

The keyhole is intentionally painted and the snap is the point of the sprite.

| Sprite | Name | Note |
|---|---|---|
| `$027` | Key | After the snap, caches the resolved cell into `$701900/$701902`; on pickup `CODE_03C640` writes the locked-door item-memory bit at that cell. A key snapped to the wrong cell unlocks nothing. |
| `$001` | ClosedDoor | via the shared door tail `CODE_02A142`. |
| `$012` | BossDoor | shared door init. |
| `$093` | Door | shared door tail. |
| `$04E` / `$131` | LockedDoor | morphs to a door then snaps; also requires a Key (see Class D). |
| `$0CA` | BigBossDoor | as locked door. |
| `$0FA` / `$110` | Flower / Flower (alt) | unconditional snap. |

**Designer rule.** Place the sprite directly **on** a `$B8xx` keyhole tile (same
16x16 cell). **If absent:** no snap; the sprite stays where placed (for a key/door
this breaks the lock relationship).

### B2 -- incidental shared prologue (low designer-intent)

These sprites open with the same `JSL CODE_02A007` (in `init_melon` it is
explicitly commented "shared sprite-Init prologue"). The snap fires identically
and the snapped position is consumed by their setup -- so it is **not** vestigial
-- but a designer would not normally place these on a keyhole tile. Listed for
completeness: they *can* be anchored to a painted `$B8xx` tile, it is just not a
designed relationship. Confirmed by level data -- no shipped level places any of
these within 2 tiles of a keyhole (see Empirical validation below).

| Sprite | Name | Note |
|---|---|---|
| `$06C` / `$06F` / `$148` | (Large/Fall-through) SpringBall | snap consumed (`Y += 8 -> $75E0`, `Bank05.asm:504-509`). |
| `$0F4` | EggPlant | snap consumed, then own X-bit-4 variant select (`Bank07.asm:185-192`). |
| `$184` | Bumpty | prologue + setup (`Bank0C.asm:2543`). |
| `$01E` / `$133` | Shyguy / LanternGhost | conditional -- only the respawn/seam sub-path reaches it (`Bank04.asm:1436`), not a fresh spawn. |
| `$005` / `$007` / `$009` | Watermelons | generic prologue (`Bank04.asm:81`); incidental for thrown/placed melons. |

---

## Class C -- direct tile-ID scan

**Sprite:** `$03F` SlimeBlock (the only sprite-bank reader of the Map16 tilemap
buffer).

**Mechanism.** `init_slime` (`Bank06.asm:54-101`) reads one LDB cell at a fixed
offset from its own position (`X - $18`, `Y - $38`) and compares the tile ID to
the constant `$0174` (the slime-floor tile). On a match it stores the computed
buffer index into `$18,x` to lock onto that tile.

**Designer rule.** In the Salvo-the-Slime boss arena, stamp Map16 tile `$0174` on
the floor cell the SlimeBlock sits over. **If absent:** the block fails to lock
(`$18,x` unset) and the boss-floor behaviour breaks.

---

## Class D -- sprite-to-sprite co-placement

Sprites that require *another placed sprite* (not a child they spawn themselves).

| Sprite | Name | Needs | Mechanism / where | Spatial rule | If absent |
|---|---|---|---|---|---|
| `$067` | RockRevealedHiddenWingedCloud | `$09E` ChompRock **or** `$0DC` Snowball | per-frame proximity probe `FXCODE_099011` + ID check (`Bank0F.asm:2090-2096`) | **positional** -- the rock must be able to roll into the cloud's box | prize is unreachable (dead) |
| `$15C` / `$15D` | Green/Red RotatingPlatformSwitch | `$15F` / `$160` platform (same colour) | writes global pair-state `$0FD5,y` (`y` = colour) on egg-hit (`Bank0D.asm:5509`) | **global by colour** -- position irrelevant | dead switch |
| `$15F` / `$160` | Green/Red SpikedPlatform | `$15C` / `$15D` switch (same colour) | reads global `$0FD1,y` / `$0FD5,y` | **global by colour** | never flips |
| `$04E` / `$131` / `$0CA` | LockedDoor / BigBossDoor | `$027` Key | door reads Yoshi's carried-item slot `$7DF6`, checks ID == `$027` (`Bank02.asm:3815`) | co-placement (player carries the key over) | door unopenable |

The switch/platform pairing is purely colour-keyed (`pair-index = (id - base) << 1`,
no position term), so any green switch anywhere controls every green platform in
the level. The locked-door/key link is mediated by Yoshi carrying the key, not a
positional scan -- included because the door hard-requires a separately placed Key.

---

## Class E -- screen-exit / message metadata

A different relationship *type*: the neighbour is per-screen level metadata, not a
placed sprite/object. Still designer-critical.

| Sprite | Name | Reads | Designer must set |
|---|---|---|---|
| `$042` | VerticalPipeEntrance | Screen-Exit Table `$7F:7E00` (indexed by the screen Yoshi exits on, via `CODE_02A4B5`) | the exit row (dest level / X / Y / entrance type) for the pipe's screen-region |
| `$0D0` / `$147` | Horizontal pipe (right / left) | same | same; facing comes from the sprite ID |
| `$0D1` | SecretPipeEntrance | same, plus a level-event enable flag (`$7E08`) | same + the enable flag |
| `$084` | TeleportSprite | same (invisible trigger) | same |
| `$0AD` | MessageBox | level ID (`$00:021A`) + its own sub-cell X/Y bit-4 -> one of 4 message slots | the level's four message strings; sub-cell placement picks which |

The warp destination is **not** read from the sprite's own coordinates -- it comes
from the screen-exit row. The MessageBox is borderline (its content is selected by
its own sub-cell position plus a global level ID, not a true neighbour), kept here
as the message-box analogue of the warp readers.

---

## Empirical validation (level data)

The index-joinable relationships were cross-checked against every shipped level's
placement data (`docs/level-sprite-index.tsv`, `docs/level-object-index.tsv`),
which both confirms the real relationships and settles the low-confidence tier:

- **Class A** -- all **20/20** levels containing a rail platform ($185-$18F) also
  contain line-guide objects ($CE-$D2); none contain lift-tracks ($10-$13). The
  rail-following target is confirmed to be the line guides. (Level $35 has 40 of
  them; the median rail level has ~7.)
- **Class D, $067** -- all **10/10** levels with a Hidden Winged Cloud contain a
  Chomp Rock or Snowball; two place one within 3 tiles of the cloud. The
  positional dependency holds in practice.
- **Class D, switches** -- green and red switch/platform pairs co-occur **2/2**
  and **2/2** by colour; no orphaned switch or platform.
- **Class B2** -- across every placement of the ten anchor-snap sprites (over 380
  instances), **none** sits within 2 tiles of a keyhole/door (nearest is 3 tiles,
  most far further). The `$B8xx` snap therefore never fires for them in any
  shipped level: the mechanism is real but the relationship is unused. This is why
  B2 is documented for completeness but rated low designer-intent -- a designer
  building new levels has no existing case to imitate.

(The cross-check script is `tmp/level-relationship-check.ts`.)

## Ruled out (kept so the inventory is provably complete)

Mechanisms and sprites that look like neighbour readers but are not:

- **`CODE_0BBCF8`** -- a generic fixed-point vector-math primitive (operates on
  registers + constant ROM tables); 83 callers, reads neither tiles nor Yoshi.
  Despite the "rail-direction" framing it is not a level read.
- **`CODE_098F33`** -- a "find nearest active sprite" runtime proximity primitive
  (collision and OAM placement); 15 callers, none are designer pairings.
- **`get_map16_above/below/left/right`** (`CODE_128719/12875D/1287A1/1287E2`) and
  `CODE_1286FD` -- every caller is in Bank12/Bank13 (the object-stamp engine);
  **zero** sprite-bank callers. These are object-render-time tile reads.
- **SuperFX scanners `0ACE2F` / `0ACE3F` / `0ACE92`** -- terrain/collision
  (solidity/slope) probes, except the `$B8xx` page-test wrapper in Class B. The
  Bandit family ($020/$0A3/$0A4) uses `0ACE3F`/`0ACE92` for terrain navigation.
- **Self-contained / self-encoded sprites:** `$089`/`$08A` moving platforms
  (fixed-limit sweep), `$162` (one slot renders its own switch + two platforms),
  `$095`/`$096` checkered blocks (egg-hit toggle, no partner).
- **Generators spawning their own children** (Burt `$0E7`, the Lakitus, Dr.
  Freezegood-on-ski-lift `$01D`, etc.) -- the partner is spawned, not placed.
- **Runtime collisions** (egg/watermelon/shell hitting a target) and
  **Yoshi-relative reads** (LOS, distance, carried-form gates) -- e.g. `$1A4`
  FortKeyholeCork reads the item-collection bitmap (not a tile), `$014`
  KeyFromBoss warps to Yoshi-relative coords, `$01F` RotatingDoors *writes* the
  exit table from a ROM table rather than reading placed metadata.
