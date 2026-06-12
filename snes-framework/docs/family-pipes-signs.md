# YI Pipe, Sign, and Teleport family reference

Standalone reference for the Yoshi's Island sprite family that covers
all level-transition entry points plus the signage that depends on
level-data placement for its orientation. Four pipe-entrance variants
(vertical, horizontal-right, horizontal-left, secret-vertical), one
invisible Teleport trigger, one hit-from-below dialog box, and three
visual sign sprites (cardinal arrow, diagonal arrow, Chomp warning).

What groups them together: every member of this family is **placed
deliberately by the level designer** at a specific tile position, and
its *behaviour or appearance is encoded in either the sprite ID itself
(pipe direction, sign type) or the low bits of its placement
coordinates (arrow direction)*. None of them spawn dynamically -- you
never see a "Vertical Pipe Entrance" appear mid-level. They are static
level furniture whose only run-time job is to detect Yoshi-contact and
either trigger a screen-exit, a dialog, or a graphics stamp.

This doc complements:

- `docs/levelloader.md` -- the GameMode `$0B` -> `$0C` -> `$0D` ->
  `$0E` -> `$0F` re-entry chain that pipes and the teleport all kick
  off (§1 in that file). Read here for how `$038E` is consumed.
- `docs/leveldataengine.md` -- how each of these sprites is placed
  in the level-data sprite stream (3-byte records: 9-bit ID,
  7-bit Y, 8-bit X) so the variant-encoded position bits actually
  reach the Init handler.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  that wraps every Init/Main pair below.
- `docs/family-misc.md §1` -- the door family ($001 / $012 / $04E /
  $093 / $0CA / $131); pipes are the analogous transition primitive
  but use `PlayerState06` instead of `PlayerState0A`, and route
  through a much smaller animation state machine.

Source of truth for all addresses below: framework asm in
`yi/Banks/Bank02.asm` (pipes + Teleport + Chomp sign),
`yi/Banks/Bank05.asm` (Message Box), `yi/Banks/Bank0F.asm` (arrow
signs). Cross-verified against `yoshisisland-disassembly` for
descriptive labels (`init_vertical_entrance`,
`main_vertical_entrance`, `init_horizontal_entrance_left/right`,
`main_horizontal_entrance`, `main_hidden_vertical_entrance`,
`init_teleport_sprite`, `main_teleport_sprite`, `init_hint_block`,
`main_hint_block`, `init_arrow_sign`, `init_diagonal_arrow_sign`,
`init_chomp_signboard`) and against `ys_enmy*.asm` for parallel
implementations of the pipe entry-distance check.

---

## 1. Family at a glance

Nine sprites, three roles. The pipe set is mechanically the most
complex (all four share the same screen-exit + freeze-sprites + warp
sound payload via `CODE_02CDB9` / `CODE_02A4B5`). The signage set is
visually identical to its peers but the cardinal-vs-diagonal arrow
split + the Chomp warning live in three different banks. The
Message Box is the only family member that opens a dialog; everything
else either warps Yoshi or just decorates.

| Sprite ID | Constant name                  | Bank | Init handler                                       | Main handler                                       | Role                                                                                                |
|-----------|--------------------------------|------|----------------------------------------------------|----------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `$0042`   | `VerticalPipeEntrance`         | 02   | `$02:10127` `init_vertical_entrance`               | `$02:10154` `main_vertical_entrance`               | Down-pipe (the most common entry). Detect Yoshi-on-mouth + D-pad-down, set FreezeSprites=$06, warp. |
| `$00D0`   | `HorizontalEntranceToRight`    | 02   | `$02:10201` `init_horizontal_entrance_right`       | `$02:10232` `main_horizontal_entrance`             | Pipe facing right (Yoshi walks into it from the left).                                              |
| `$0147`   | `HorizontalEntranceToLeft`     | 02   | `$02:10196` `init_horizontal_entrance_left`        | `$02:10232` shared with $00D0                      | Pipe facing left. Init pre-increments `$18,x` twice (direction selector), then falls into $00D0.   |
| `$00D1`   | `SecretPipeEntrance`           | 02   | `$02:10127` shared with $0042 `init_vertical_entrance` | `$02:10144` `main_hidden_vertical_entrance`        | Hidden down-pipe. Same Init as $0042, but Main gates the warp behind a sniff/proximity check.       |
| `$0084`   | `TeleportSprite`               | 02   | `$02:4024` `init_teleport_sprite` (empty RTL)      | `$02:4031` `main_teleport_sprite`                  | Invisible warp trigger. No render. Fires the screen-exit purely from Yoshi-on-mouth + form check.   |
| `$00AD`   | `MessageBox`                   | 05   | `$05:12216` `init_hint_block`                      | `$05:12246` `main_hint_block`                      | Bouncing "?" sprite. 3-state idle/bounce/dialog-dispatch. Opens text via `!RAM_YI_Level_MessageBoxState`. |
| `$0197`   | `ArrowSign`                    | 0F   | `$0F:1328` `init_arrow_sign`                       | `$0F:1371` `main_arrow_sign` (bare RTL)            | Cardinal arrow (up/down/left/right). 4 directions encoded in placement-X-bit-4 + Y-bit-4.           |
| `$0198`   | `DiagonalArrowSign`            | 0F   | `$0F:1298` `init_diagonal_arrow_sign`              | `$0F:1372` shared (bare RTL)                       | Diagonal arrow (NE/NW/SE/SW). Same 2-bit position-derived encoding, different frame + flip rule.    |
| `$00D8`   | `ChompWarningSign`             | 02   | `$02:2900` `init_chomp_signboard`                  | `$02:2928` `main_chomp_signboard` (`JML CODE_03AA52`) | Static "!" sign telegraphing a nearby Chomp. SuperFX-stamped tilemap; no per-frame logic.           |

Of these, the four pipe variants are the only ones that share Main
code (`CODE_02D8E7` aka `CODE_main_vertical_entrance` is reused as
the shared warp path; horizontal pipes use a parallel
`main_horizontal_entrance` but call into the same `CODE_02CDB9`
warp-setup). The arrow signs share their (RTL-only) Main but
diverge in Init by 2 bytes (XOR vs ORA) and one frame table. The
Teleport sprite has its own non-shared Main. The Message Box
shares no code with anyone in this family. The Chomp warning is a
pure decoration -- the actual Chomp sprites that justify the warning
are documented in `docs/family-fish.md` (Chomp Shark $154 and its
SuperFX rendering brethren).

**Source-of-confusion in the dispatch table**: at
`yi/Banks/Bank03.asm:142-144`, the `DATA_sprite_inits` table has
`YI_NorSpr042_VerticalPipeEntrance_Init` at slot $042 and
`YI_NorSpr042_RedGiantShyguy_Init` at slot $043 -- the latter is
**mis-named**: it's the Red Giant Shyguy Init at sprite slot $043,
not $042. The shared body at `$02:8776` labels both
`YI_NorSpr042_RedGiantShyguy_Init` and
`YI_NorSpr043_GreenGiantShyguy_Init`, and the constants file
(`yi/Constants/NormalSpriteIDs.asm:87-88`) correctly declares $043
= RedGiantShyguy, $044 = GreenGiantShyguy. No actual sprite-ID
collision exists; only the label name on the Bank02 init handler
preserves the historical mis-numbering. This is documentation noise,
not a runtime bug, and it does not affect `$042 =
VerticalPipeEntrance`. Flagged here so future archaeologists don't
chase a phantom dual-meaning $042.

---

## 2. The pipe-entry mechanic

> **Sprites are only ONE of the two pipe-entry roads.** An earlier revision
> of this note claimed entry is "entirely sprite-driven, never a collision
> tag" -- **wrong** (counterexample: level `$3B` obj[279], an Enterable
> vertical pipe with no sprite anywhere in the level -- it warps). The
> tile-driven road: the GSU player collision probes (Bank0B, head/foot/side)
> accept a tile whose page collision tag is `$14` `pipe-mouth` AND whose
> per-tile `DATA_0AEBBC` byte carries the pressed direction's entry bit;
> `CODE_0BDC20` then writes PipeTransitionType (`$0106`) + PlayerState `$06`
> directly from the GSU (`SMS` -- invisible to 65816 grep). That's how the
> "Enterable" pipe objects (`$3C`/`$A5`/`$A6`, sewage entrances ext
> `$6D-$70`, keyed `$E0`) warp with no sprite. The SPRITE road below exists
> for everything else -- the un-enterable `$79`-family pipes (`$F4` ...) and
> bare walls. The same `$14` tag independently feeds the enemy-generator
> gate (Shy Guy & co. spawned on it emit enemies out of the pipe,
> `docs/family-shyguys.md` §2.4). Canonical editor-side reference:
> `src/renderer/src/data/exit-triggers.ts`; full tag note:
> `docs/mchip.md` §3.3.2.

All four pipe variants ($042, $0D0, $0D1, $147) plus the invisible
Teleport ($084) trigger the same engine-side handoff: from "sprite
detects Yoshi-contact" -> "screen fades out" -> "level-loader
re-enters with `!r_level_load_type > 0`" -> "Yoshi spawns at the
destination entrance". The pipe sprites supply two pieces of state
on the way out: the **pipe-transition byte** at
`!EXRAM_YI_Level_PipeTransitionTypeLo` (`$06:0106`) which encodes
the direction/orientation, and the **screen-exit index** at `$038E`
which the level-loader uses to look up the destination.

This is the same broad mechanism as the door family
(`docs/family-misc.md §1.4`) but the per-sprite state machine is
*much* smaller: pipes don't run an open-animation, they don't
freeze Yoshi during a multi-tick cinematic, they don't have a
locked variant. The pipe immediately commits to the warp the moment
contact + direction-press is detected.

### 2.1 Shared RAM the family writes

Drawn from `yi/Memory/SRAM_Player.asm` lines 155-167 and the
level-loader docs:

```
$00:0036          Controller1 byte 2 mirror (D-pad bits in low nibble:
                  $01=right, $02=left, $04=down, $08=up). Read every
                  frame by all four pipe Mains.
$70:01AE  (16b)   !EXRAM_YI_Level_FreezeYoshiFlag -- non-zero = freeze
                  player movement (set by warp).
$70:01B0  (16b)   !EXRAM_YI_Level_FreezeSpritesFlag -- non-zero = freeze
                  every other sprite while the pipe-warp commits.
                  Pipes write $06 here (vertical) or $8002/$8004
                  (horizontal, see below).
$70:01D8  (16b)   !EXRAM_YI_Player_CurrentState -- the pipe sets
                  $0006 (= !Define_YI_PlayerState06, the pipe-entry /
                  pipe-traversal state) via CODE_02CDB9.
$70:0106  (16b)   !EXRAM_YI_Level_PipeTransitionType -- the byte
                  CODE_02CDB9 stores ($8006 vertical, or $8002/$8004
                  via the horizontal Main's add-$8002 trick).
$70:0108  (16b)   !EXRAM_YI_Level_PipeTransitionDist -- distance
                  travelled in transition. Cleared by CODE_02CDB9.
$70:010A          PipeAnimState (zeroed)
$70:010C          PipeEnterAccel  (set to 1)
$70:010E          PipeXPosRel     (set to player X for horizontal pipes)
$00:60A8 / 60AA   $0/$0 (cleared) -- player X/Y velocity zeroed
$00:60DE          $0 (cleared)    -- carry-state / facing
$00:038E  (16b)   Screen-exit row index. CODE_02A4B5 writes here,
                  computed as (PlayerXHi & $0F) << 2 | (PlayerYLo & $0F00) >> 6.
$00:038C  (16b)   1 (level-transition active flag)
$00:000B  (8b)    !RAM_YI_Global_CurrentGameMode -- set to $0B to
                  start the fade-out chain.
```

The pipe-transition-type word is annotated in `SRAM_Player.asm`
as:
> low byte = direction ($02/$04/$06/$08), high byte =
> orientation ($00/$40 vertical in/out, $80/$C0 horizontal in/out).

This annotation is *approximate*. The actual code-observed values
are:

| Pipe variant      | Writes to PipeTransitionType    | Caller path                             |
|-------------------|----------------------------------|-----------------------------------------|
| `$042` vertical    | `$0006`                         | `LDA #$0006` then `JSR CODE_02CDB9`     |
| `$0D1` secret vert | `$0006` (same path)             | `JSL CODE_02D985` (sniff) -> same path  |
| `$0D0` horiz right | `$8002`                         | `TYA + ADC #$8002` (y=0) then `JSR CDB9`|
| `$147` horiz left  | `$8004`                         | same body but y=2 (set by Init)         |
| `$084` teleport    | --                              | uses `CODE_02A4B5` only -- writes only `$038E` + GameMode |

Note that the **vertical pipes do NOT actually set the high-byte
bit $80** -- they store `$0006`, not `$8006`. The
`SRAM_Player.asm:155-156` comment's "$80/$C0 horizontal" mapping
holds for the horizontal pipe path (which writes `$8002`/`$8004`),
but the vertical pipe path writes pure-low-byte `$0006`. So the
high byte may encode "is-horizontal" rather than "is-out". Worth
runtime-verifying (open question 1 in §8).

### 2.2 The shared warp helper (`CODE_02CDB9`, `$02:CDB9`)

This is the routine that all three "pipe enter" code paths jump to
once they've decided Yoshi is going through. Body:

```
CODE_02CDB9:
    STA.w $6106                      ; PipeTransitionType (caller pre-loaded A)
    LDA.w #!Define_YI_PlayerState06  ; pipe-entry / traversal state
    STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
    STZ.w $6108                      ; PipeTransitionDist
    STZ.w $610A                      ; PipeAnimState
    STZ.w $61F6                      ; (unknown -- velocity-related)
    LDA.w #$0001
    STA.w $610C                      ; PipeEnterAccel = 1
    STZ.w $60A8                      ; player X-velocity
    STZ.w $60AA                      ; player Y-velocity
    STZ.w $60DE                      ; (facing / carry-state)
    RTS
```

Caller pre-loads A with the PipeTransitionType word. Vertical
pipes load `#$8006` directly before falling into CDB9 from CDB1;
horizontal pipes do `TYA + CLC + ADC #$8002 + STA EXRAM_Level_FreezeSpritesFlagLo
+ JSR CODE_02CDB9` (the FreezeSprites write at $1B0 happens to land
adjacent to the PipeTransitionType, which is suggestive of a
shared-block layout convention).

After CDB9 returns, the vertical-pipe path also writes
`!EXRAM_YI_Player_XPosLo` into `$610E` (PipeXPosRel), aligning
Yoshi's column to the pipe's mouth for the descent animation.

### 2.3 The contact-detect helper (`CODE_02D908`, `$02:D908`)

The pipe's "is Yoshi on the mouth tile right now?" check, called
by both vertical and horizontal Mains:

```
CODE_02D908:
    LDY.w $7D36,x        ; Yoshi-overlap sprite index (BPL = none)
    BPL.b CODE_02D91C
    LDA.w $61B2          ; player on-ground / face-down (BPL = airborne)
    BPL.b CODE_02D91C
    LDA.w $60C0          ; (player walk-anim phase?)
    ORA.w $6150          ; (player slope-Y or similar)
    BNE.b CODE_02D91C
    SEC                  ; "yes, contact"
    RTS
CODE_02D91C:
    CLC                  ; "no contact"
    RTS
```

The carry flag is the contact result. `$7D36,x` is the
sprite-engine's "which slot is Yoshi standing on / overlapping?"
back-link, with the sign bit indicating "none". `$61B2` is the
on-ground flag (must be on ground -- you can't enter a pipe while
mid-jump). `$60C0` and `$6150` together filter out "Yoshi is
moving" -- the pipe only accepts entry from a clean stand.

### 2.4 One complete entry-to-exit trace (vertical pipe)

Frame-by-frame from Yoshi pressing down on a pipe mouth to the
destination level loading:

1. **Frame N**: pipe slot `$042`'s Main (`CODE_02D8E7`) runs in
   `gm0f_run_level`. It calls `CODE_02D908` (returns carry-set),
   then checks `$0036 & #$0004` (D-pad-down). Both true.
2. **Same frame**: writes `!EXRAM_YI_Level_FreezeSpritesFlag = $0006`
   and calls `CODE_02CDB9` with `A=$8006`. CDB9 sets
   `PipeTransitionType = $8006`, `PlayerCurrentState = $0006`,
   zeros pipe-traversal counters, zeros player velocities.
3. **Same frame, last step**: stores
   `!EXRAM_YI_Player_XPosLo -> $610E` (`PipeXPosRel`).
4. **Frame N+1 ... N+k**: `PlayerState06` (the pipe traversal state,
   handled in Bank04 around `$04:E437/$E43B/$E43F` per
   `PlayerStates.asm:9`) runs the per-direction Yoshi-into-pipe
   animation, advancing `PipeTransitionDist` ($6108) by the
   `PipeEnterAccel` ($610C) each tick until it reaches `$1F00`.
5. **At distance threshold**: PlayerState06 transitions Yoshi to
   PlayerState08 (pipe exit / under-block emergence) per the
   PlayerStates comment.
6. **At PlayerState08 completion / exit-distance**: the player code
   computes the screen-exit index for Yoshi's current position via
   `CODE_02A4B5` (`$02:A4B5`):
   ```
   LDA.w !EXRAM_YI_Player_XPosHi   ; 16-bit read (M=0) of XPos high word
   AND.w #$000F                    ; X column = (XPos >> 8) & $0F = 0..15
   ASL : ASL                       ; * 4 (pre-multiplied for table indexing)
   STA.w $0000
   LDA.w !EXRAM_YI_Player_YPosLo   ; 16-bit read of YPos full word
   AND.w #$0F00                    ; Y row in bits 8-11 of result
   LSR : LSR                       ; shift right 2 -> Y row in bits 6-9
   ORA.w $0000                     ; merge: result = (YRow << 6) | (XCol << 2)
   STA.w $038E                     ; -> byte-offset into the 4-byte-per-screen exit table
                                   ;    at $7F:7E00,x. Each screen has 16 cols, so the index
                                   ;    is (row*16 + col) * 4 = byte-offset for direct LDA-,x
   LDA.w #!Define_YI_SoundID22_EndFuzzyDistortedMusic
   STA.w !RAM_YI_Global_PlaySoundHighPriorityLo
   LDA.w #$0001
   STA.w $038C              ; level-transition active
   LDA.w #!Define_YI_GameMode0B
   STA.w !RAM_YI_Global_CurrentGameMode
   JSL.l CODE_save_egg_inventory
   ```
   The exit index is **derived from Yoshi's position when he
   reaches the exit, not from the pipe-sprite's position**.
   This means two pipes in the same column lead to the same
   destination -- the level designer relies on this when laying
   out pipes; the screen-exit table at `$7F:7E00,x` is indexed
   by `screen_id` not by sprite slot.
7. **GameMode $0B**: Bank04 / Bank01 fade-out + screen-clear, then
   advances to `$0C`. See `docs/levelloader.md §1 step 4` for the
   `gm0c_level_fadein_and_name` re-entry; it reads
   `$7F:7E00,(screen_id * $200)` for the 4-byte destination record
   (destination level ID, entrance X, entrance Y, entrance type).
8. **GameMode $0D**: per-pipe-or-door re-entry; uses the entrance
   type byte from step 7 to drive `PlayerCurrentState` in the
   destination level (e.g. "emerging from down-pipe = $0008
   PlayerState08", etc.).
9. **GameMode $0E**: fade-in tick.
10. **GameMode $0F**: in-level play resumes. Yoshi visually pops
    out of the destination pipe according to the entrance-type
    selection in step 8.

### 2.5 What does NOT happen during pipe entry (vs door entry)

Important contrasts with `docs/family-misc.md §1.4`:

- **No open-animation**: the pipe does not have a "door is opening"
  multi-tick state. The moment contact + direction is detected,
  `CODE_02CDB9` runs and PlayerState06 takes over. The pipe-mouth
  graphic stays still; it's the *Yoshi* animation that sells the
  transition.
- **No locked variant**: there's no "pipe with key" (yet there is
  a "door with key" at sprite $04E LockedDoor). Hidden pipes use
  proximity gating, not a key-consumption gate.
- **No form-zero check**: doors check
  `EXRAM_Player_CurrentForm` (only Form 0 = regular Yoshi can
  enter); pipes don't. The pipe will accept entry from Yoshi-with-
  Train-form, Yoshi-Helicopter, etc., subject only to the
  on-ground + still-standing filter in `CODE_02D908`. (Exception:
  the Teleport sprite $084 *does* check form-zero, see §4.)
- **No key-consumption side effect**: doors despawn the held Key
  sprite ($027) and play `SoundID64_UnlockDoor`; pipes have no
  analog because no pipe in the game accepts a key.

---

## 3. Per-pipe variants

### 3.1 $0042 VerticalPipeEntrance

The most-encountered variant. Down-pipe; Yoshi enters by pressing
D-pad-down while standing on the mouth tile.

**Init** (`init_vertical_entrance`, shared with $0D1, `$02:D8C8`):
```
LDA.w $70E2,x          ; sprite X position
ORA.w #$0008            ; set contact-bit $0008 on sprite-X word
STA.w $70E2,x
LDA.w #$0001
STA.w $7BB6,x           ; pipe-entry cooldown counters = 1
STA.w $7BB8,x
STZ.w $7B58,x           ; (sprite-flag scratch -- zero)
RTL
```

The `ORA #$0008` on `$70E2,x` (sprite X) is interesting -- the
sprite engine apparently uses bit 3 of the X-low byte as a
"this slot is a pipe entrance" flag for collision detection
purposes. (Open question 2 in §8.) The two cooldown counters at
`$7BB6,x` and `$7BB8,x` are seeded to 1 and presumably decrement
each tick.

**Main** (`main_vertical_entrance`, `$02:D8E7`):
```
JSL.l CODE_03AF23       ; engine-side per-frame housekeeping (anim, render setup)
JSR.w CODE_02D908       ; is Yoshi on mouth + standing still?
BCC.b CODE_02D907       ; no contact -- early-out
LDA.w $0036             ; controller D-pad
AND.w #$0004            ; bit $04 = down
BEQ.b CODE_02D907       ; not pressing down -- early-out
LDA.w #$0006
STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
JSR.w CODE_02CDB9       ; warp setup; A=$0006 persists into CDB9's first STA
```

CDB9's first instruction is `STA $6106` (PipeTransitionType) --
the *same A value* the caller just stored to FreezeSprites is
also what gets stored to PipeTransitionType. So for vertical
pipes: PipeTransitionType = `$0006`, FreezeSprites = `$0006`.

This contrasts with `CODE_02CDB1` (a sibling entry that falls
through into CDB9), which is reached only from the
giant-shyguy swallow-exit path and pre-loads A with `$8006`.
The two callers of CDB9 share the body but supply different
PipeTransitionType values; the `$8006` you may see attributed
to "pipe entry" is actually the giant-shyguy variant. (See
open question 1 about the resulting impact on the
`SRAM_Player.asm` annotation.)

After CDB9, the vertical pipe does:
```
LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
STA.w $610E             ; PipeXPosRel = player X
RTL
```

### 3.2 $00D1 SecretPipeEntrance

Identical Init to $042 (the labels alias the same address). The
divergence is the Main, which inserts a proximity / sniff check
before falling through to the shared warp body.

**Main** (`main_hidden_vertical_entrance`, `$02:D8DE`):
```
LDY.b #$02              ; sniff-radius arg
JSL.l CODE_02D985       ; sniff-detect helper
BCS.b CODE_main_vertical_entrance   ; carry-set -> proceed to warp
RTL                     ; carry-clear -> nothing happens this frame
```

**Sniff-detect helper** (`CODE_02D985`):
```
LDA.w $7E08             ; level-event/permanent-flags word
AND.w #$0008            ; bit 3 -- "sniff-enabled this level" flag?
BEQ.b CODE_02D9B6       ; not enabled -- carry-clear return
LDA.w $0030             ; frame counter (low byte)
AND.w #$0018            ; bits 3-4 -- every 8 frames within an 8-frame cycle
BEQ.b CODE_02D9B4       ; off-phase -- skip spawn, but return carry-set
; on-phase: spawn warp-sparkle AmbSpr224 at pipe's position
CODE_02D995:
    TYA : PHA
    LDA.w #!Define_YI_AmbSpr224
    JSL.l CODE_spawn_ambient_sprite
    PLA : STA.w $73C2,y           ; bind sparkle's parent slot
    LDA.w $70E2,x : STA.w $70A2,y ; sparkle X = pipe X
    LDA.w $7182,x : STA.w $7142,y ; sparkle Y = pipe Y
    LDA.w #$0001 : STA.w $7782,y  ; sparkle lifetime / spawn-flag
CODE_02D9B4:
    SEC                 ; carry-set: pipe is allowed to accept entry
    RTL
CODE_02D9B6:
    CLC                 ; carry-clear: secret pipe is dormant
    RTL
```

The sniff check is two-fold: (a) the level-permanent flag at
`$7E08` bit 3 must be set, and (b) on the on-phase of an 8-frame
duty cycle the helper spawns ambient sprite `$224`
(warp-sparkle) anchored to the pipe's coordinates. Both phases
allow the warp to proceed; the spawn is purely cosmetic
(the "sparkle pulses around hidden pipes").

The flag at `$7E08 bit $0008`: this is part of the level's
permanent-state bitfield. From context elsewhere (Bank02:2615-
2622, Super Baby Mario transformation TSBs bit $0010 into the
same word), `$7E08` looks like a per-level event flag word.
Bit 3 ($0008) appears to be set as a side-effect of some
sniff-related Yoshi-action (the manual / wiki describes the
"Yoshi sniffing to find hidden pipes" mechanic). The bit's
*setter* is not in this family's code; runtime tracing would
pin it down. (Open question 3.)

**Surprising finding**: the AmbSpr224 ("Horizontal-pipe-entrance
warp sparkle") in `yi/Constants/AmbientSpriteIDs.asm:224` is
documented as having its spawn site in
"Bank02:10267 in HorizontalEntranceToRight/Left_Main". The
actual spawn is in `CODE_02D995` which is called *only* from
`main_hidden_vertical_entrance` ($0D1), not from the horizontal
pipe Mains. The constant's note is misleading on both the bank
line (it's $02:D995 = $02:10271 in our file, not :10267) and the
caller (it's secret-pipe-vertical, not horizontal-pipe-either-side).
**LABEL-LIKELY-WRONG**: the AmbSpr224 comment should be updated.
The constant name itself ("Horizontal-pipe-entrance warp sparkle")
may also be a misnomer -- it's the *secret-pipe* sparkle, not a
horizontal-pipe sparkle.

### 3.3 $00D0 HorizontalEntranceToRight / $0147 HorizontalEntranceToLeft

Two sprite IDs sharing a single Init body and a single Main body.
The level designer picks the orientation by choosing the ID; the
Init detects which one and sets the per-slot direction byte
accordingly.

**Init pair** (`init_horizontal_entrance_left/right`, `$02:D922`):
```
YI_NorSpr147_HorizontalEntranceToLeft_Init:
    INC.b $18,x         ; direction selector += 2
    INC.b $18,x
YI_NorSpr0D0_HorizontalEntranceToRight_Init:
    LDY.b $18,x         ; y = 0 (right) or 2 (left)
    LDA.w $70E2,x       ; sprite X
    CLC
    ADC.w DATA_02D91E,y ; y=0: +$0008; y=2: -$0008 (FFF8 sign-extended)
    STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
    LDA.w $7182,x       ; sprite Y
    SEC
    SBC.w #$0008
    STA.w $7182,x       ; bump Y up by 8 to centre on mouth row
    STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
    LDX.b #FXCODE_0ACE2F>>16
    LDA.w #FXCODE_0ACE2F  ; SuperFX hitbox registration (used by 100+ sprites)
    JSL.l !RAM_YI_Global_RT_00DE91
    LDX.b $12
    LDA.b $18,x         ; reload direction selector
    LDY.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo  ; SuperFX return value
    BEQ.b CODE_02D954
    EOR.w #$0002        ; if SuperFX said "flip", flip direction
CODE_02D954:
    STA.w $7400,x       ; store final direction byte (0 or 2)
    RTL

DATA_02D91E: dw $0008,$FFF8    ; +8 / -8 X-offset for hitbox centre
```

Key observations:

- The "to-left" variant's Init merely pre-loads `$18,x` with 2
  (two `INC.b $18,x` in a row) then falls through. No code
  duplication.
- After hitbox setup, `$7400,x` holds the per-slot direction
  (`$0000` = right, `$0002` = left).
- The SuperFX `FXCODE_0ACE2F` is the same general-purpose
  hitbox-registration routine used by ~100 sprites in YI. It
  reads R8 (Y), R0 (X-byte) and returns the registered slot
  bookkeeping in R5. The post-Init `EOR #$0002` allows the
  SuperFX side to flip the pipe direction (e.g. for mirrored
  level / Naval Piranha rev-fight contexts -- exact trigger
  unclear, see Open question 4).

**Shared Main** (`main_horizontal_entrance`, `$02:D95C`):
```
JSL.l CODE_03AF23       ; per-frame housekeeping
JSR.w CODE_02D908       ; Yoshi-on-mouth + still?
BCC.b CODE_02D984       ; no -- early-out
LDA.w $77C2,x           ; per-slot held-direction byte (?)
AND.w #$00FF
CMP.w $7400,x           ; compare against pipe's direction
BNE.b CODE_02D984       ; mismatch -- early-out
TAY                     ; y = 0 (right) or 2 (left)
LDA.w $0036             ; controller D-pad
AND.w DATA_02D958,y     ; y=0: $0001 (R); y=2: $0002 (L)
BEQ.b CODE_02D984
TYA
CLC
ADC.w #$8002            ; y=0: $8002; y=2: $8004
STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
JSR.w CODE_02CDB9       ; warp setup (PipeTransitionType = the $8002 / $8004 we just stored to FreezeSprites flag, by virtue of A persisting into CDB9)
CODE_02D984:
    RTL

DATA_02D958: dw $0001,$0002    ; D-pad bit masks (right / left)
```

Two further observations:

- The `LDA $77C2,x ... CMP $7400,x` test means the engine needs
  the per-frame "what direction is Yoshi pressing" snapshot to
  match the pipe's stored direction. `$77C2,x` is some kind of
  per-slot Yoshi-input mirror (probably the engine-stored
  D-pad-held register). (Open question 5.)
- The clever ADC trick: `y + $8002` lands in A *before* the
  `STA FreezeSprites + JSR CDB9` sequence. CDB9's first
  instruction is `STA $6106` (PipeTransitionType), so the same
  value gets stored to both addresses. For horizontal pipes,
  PipeTransitionType = `$8002` (right) or `$8004` (left).
  The "$80 = horizontal" annotation in `SRAM_Player.asm:155-156`
  is consistent with this. (And inconsistent with the vertical
  pipe path -- see §3.1 nuance above; revising the
  `SRAM_Player.asm` comment is the right fix.)

---

## 4. The Teleport sprite ($0084)

An *invisible* warp trigger. Placed at any position in level data;
when Yoshi crosses it under specific conditions, the screen-exit
fires.

**Init** (`init_teleport_sprite`, `$02:A517`):
```
RTL
```
Empty. No graphics setup, no per-slot state, no SuperFX hitbox
registration -- the teleport is a pure logic sprite. The engine
will still register the slot in the standard sprite pool, but
nothing renders from it.

**Main** (`main_teleport_sprite`, `$02:A518`):
```
JSL.l CODE_03AF23       ; per-frame housekeeping (drives status -> render gates; the rest is no-op since no render data)
LDY.w $7D36,x           ; Yoshi-overlap sprite index
BPL.b CODE_02A52B       ; sign-bit set when no overlap -- early-out
LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
BNE.b CODE_02A4B5       ; form-zero only -- if Yoshi is in Train/Helicopter/etc, branch to fire
LDA.w $61B2             ; player on-ground?
BMI.b CODE_02A4B5       ; airborne (sign-bit set) -- branch to fire
CODE_02A52B:
    RTL
```

The branch logic is inverted-looking but unambiguous:

- Yoshi must be overlapping the sprite slot (`$7D36,x` sign-bit clear).
- **Either** Yoshi is in a non-zero form (Train, Helicopter, Mole,
  Sub, etc.) -- the teleport fires regardless of ground state;
- **Or** Yoshi is in form $00 and airborne (sign-bit set on
  `$61B2`, meaning "in the air, not on ground").

The teleport does **not** fire while Yoshi is form-$00 and on
ground -- because the same overlap could also be a pipe entrance
or a door, and the engine needs to differentiate. The condition
"airborne form-zero" is what flying-through-an-arch level segments
exploit; the condition "any non-zero form" is what mid-form
auto-transition uses (e.g. the Train-Yoshi auto-exit at the end
of a Train segment).

When the conditions hold, the Teleport calls `CODE_02A4B5` -- the
**same screen-exit-from-position routine** that the door family
uses (see `docs/family-misc.md §1.4 step 4`). This:

1. Computes `$038E` from Yoshi's `(XHi & $0F):(YLo & $0F00>>6)`
   nibbles -- screen-row * 16 + screen-column.
2. Plays `SoundID22_EndFuzzyDistortedMusic`.
3. Sets `$038C = 1` (level-transition active).
4. Sets `CurrentGameMode = $0B`.
5. Saves egg inventory.

From here the chain is identical to the pipe path from §2.4 step
6 onward. The destination is again read from `$7F:7E00,(screen *
$200)` in the live exit table.

**Level-data marking**: the Teleport is placed via the standard
sprite stream (3-byte record, ID $0084). No special object-stream
marker; the level designer just drops a $0084 wherever they want
the trigger. The trigger area is the **standard sprite hitbox**
since the Init never registers a custom one -- which is small
(roughly 16x16 pixels around the sprite's nominal position).
This explains why Teleport sprites are typically placed at
narrow choke-points (the end of a Train-Yoshi track, or under a
ledge a Helicopter-Yoshi must fly through).

---

## 5. Hint Message Box ($00AD)

Bouncing "?" sprite that opens a dialog when Yoshi hits it from
below (head-bump) or hits it with an egg. Visually a 16x16 yellow
"?" block. Unlike SMW's message blocks, YI's hint blocks **bounce**
when struck (cinematic pop up + fall back) before dispatching to
the dialog gamemode.

### 5.1 Init

`init_hint_block` (`$05:DA98`):
```
JSL.l CODE_03AE60       ; standard sprite setup helper (sets render scale, OAM defaults)
LDA.w #$0100
STA.w $7A36,x           ; scale-related register seed (matches Goal Ring / others)
LDA.w $7182,x
STA.b $78,x             ; cache initial Y position (the "rest" height; restored after bounce)
LDA.w #$0001
STA.w $7402,x           ; OAM priority / palette nibble seed (?)
JSR.w CODE_05DB79       ; one-shot SuperFX tilemap stamp at the rest position
RTL
```

The cached initial Y at `$78,x` is what state $01 (bounce) reverts
to after the bounce arc completes.

### 5.2 The 3-state Main

`main_hint_block` (`$05:DAC3`) dispatches via
`DATA_05DAB1` (= `DATA_hint_block_state_ptr`):

| State `$76,x` | Pointer       | Handler  | Behaviour                                                   |
|---------------|---------------|----------|-------------------------------------------------------------|
| `0`           | `CODE_0580C2` | (`gsu_delta_facing_stub`) | Idle. Engine bounce-render only; Main detects hit conditions. |
| `1`           | `CODE_05DBC8` | `bounce_arc` | Animate vertical bounce-arc: Yoshi-applied Y velocity $FC00 upward, ticks downward via DATA_05DABB ($+18 / $-18), clamp to original Y; on landing, advance to state 2. |
| `2`           | `CODE_05DC05` | `dispatch_dialog` | Compute message-ID, set `!RAM_YI_Level_MessageBoxState = 1`, despawn (state -> 0). |

The state-0 hit-detection logic (in the body of `main_hint_block`
just after the dispatch) is a 4-way OR:

```
; check 1: head-bop from below
LDY.w $60AB            ; player Y-velocity (sign-bit clear = upward)
BPL.b CODE_05DB46      ; falling -- not a head-bop
LDY.w $60C0            ; player ducking / form-state byte
BEQ.b CODE_05DB46
LDA.w $7C16,x          ; sprite-X relative-to-player (signed)
CLC : ADC.w #$000C
CMP.w #$0018
BCS.b CODE_05DB46      ; out of horizontal range -- not a head-bop
LDA.w $7C18,x          ; sprite-Y relative-to-player
CMP.w #$FFE8 : BMI.b CODE_05DB46
CMP.w #$FFF0 : BPL.b CODE_05DB46  ; player must be JUST below
STZ.w $60AA            ; halt player Y-velocity
STZ.w $60D2            ; (player jump cancel?)

CODE_05DB24:           ; the bounce-init body
    DEC.w $7182,x      ; sprite Y -= 1 (the visual lift)
    LDA.w #$FC00       ; (Y velocity, upward, applied to sprite)
    STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
    LDA.w #$0034
    STA.w $7542,x      ; bounce duration timer (~52 frames)
    STZ.w $7A38,x      ; reset scale-anim phase
    INC.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
    INC.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
    LDA.w #!Define_YI_SoundID32_HitMessageBox
    JSL.l CODE_push_sound_queue
    INC.b $76,x        ; -> state 1 (bounce)
    RTL

CODE_05DB46:           ; check 2: hit by an egg
    LDY.w $7D36,x      ; Yoshi-on-mouth (egg-as-attacker is also recorded here)
    DEY
    BMI.b CODE_05DB60
    LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
    CMP.w #$0010       ; status $10 = in-flight egg
    BNE.b CODE_05DB60
    LDA.w $7D38,y      ; egg's parent-link
    BEQ.b CODE_05DB60
    TYX
    JSL.l CODE_03B25B  ; mark egg as consumed by hit
    BRA.b CODE_05DB24  ; ... and fall into the bounce-init
```

So the hint box accepts hits from **two sources**: Yoshi
head-bopping it from below (the classic "tap from beneath"
trigger), **or** an egg-throw connecting. Both paths go through
the same `CODE_05DB24` bounce-init.

### 5.3 The message-ID computation (state $02)

The most interesting per-sprite logic in this family is how the
Message Box determines *which* dialog to show.

`CODE_05DC05` (state $02):
```
TYX
LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
LDA.w $7A36,x
CLC
ADC.w DATA_05DABF,y   ; ramp scale up/down depending on phase
CPY.b #$00
BEQ.b CODE_05DC58     ; sub-state "closing back to idle" -- skip dialog
CMP.w #$0100           ; sub-state "open peak" reached?
BPL.b CODE_05DC66      ; not yet -- keep ramping
; AT OPEN-PEAK: compute message ID, kick off MessageBoxState
LDA.w $70E2,x : AND.w #$0010 : LSR : LSR : LSR : LSR  ; X bit-4 -> bit 0
TAY
LDA.w $7182,x : AND.w #$0010                          ; Y bit-4
BEQ.b CODE_05DC2E
INY : INY                                              ; ... -> bit 1
CODE_05DC2E:
    TYA
    STA.b $00                                          ; $00 = X-bit-4 | (Y-bit-4 << 1) = 0..3
    LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
    ASL : ASL                                          ; level_id * 4
    CLC : ADC.b $00                                    ; + per-position offset
    STA.l $704070                                      ; message-ID -> SuperFX text data pointer
    CMP.w #$0001
    BNE.b CODE_05DC4E
    LDA.w !EXRAM_YI_Global_EggThrowSetting|!EXRAMBankMirror
    BEQ.b CODE_05DC4E
    LDA.w #$011C                                       ; egg-throw setting changes msg ID 1
    STA.l $704070
CODE_05DC4E:
    INC.w !RAM_YI_Level_MessageBoxState                ; kick off dialog gamemode (Bank01 §12121+)
    STZ.b $76,x                                        ; return to idle
    LDA.w #$0100
    BRA.b CODE_05DC66
```

The **message ID = `(level_id * 4) + (X-bit-4 << 0) + (Y-bit-4
<< 1)`**. So each level has 4 distinct message slots, addressable
by placing the hint block on one of 4 sub-positions within a
$20-tile super-cell:

| Y-bit-4 | X-bit-4 | Index | Per-level slot |
|---------|---------|-------|----------------|
| 0       | 0       | 0     | "north-west" sub-cell  |
| 0       | $10     | 1     | "north-east" sub-cell  |
| $10     | 0       | 2     | "south-west" sub-cell  |
| $10     | $10     | 3     | "south-east" sub-cell  |

This is the **same 2-bit position-derived encoding pattern** that
the arrow signs use (§6 below) -- a hallmark of Yoshi's Island's
"the sprite ID is generic, the placement bits carry the variant"
design.

The special-case at the bottom (`CMP #$0001 / EXRAM_EggThrowSetting`)
overrides message ID $01 of level 0 (the Welcome Level) with
message $011C when the global egg-throw difficulty setting is
non-default. This is the "alternate tutorial message" that some
SNES re-release versions toggle. (Open question 6: confirm
$011C indexing.)

### 5.4 The dialog gamemode

`!RAM_YI_Level_MessageBoxState` at `$00:0D0F` is the entry point
into the in-level dialog state machine, documented in
`yi/Banks/Bank01.asm` lines 12121-12300 (`message_box_handler` /
`message_box_handler_entry`). It's a 7-state pointer table
(`DATA_01DE85`, indexed by `(MessageBoxState >> 1)`):

| State | Pointer       | Phase                                                                     |
|-------|---------------|---------------------------------------------------------------------------|
| $01   | `CODE_01DE93` | Opening SFX, init counters (`message_box_01`).                            |
| $03   | `CODE_01DEA9` | Horizontal-expand sub-state (the window expands $0010/-$0010 per frame). |
| $05   | `CODE_01DED0` | Vertical iris-open via `CODE_show_message_box` (SuperFX text + icon render).        |
| $07   | `CODE_01DEA9` | Closing horizontal contract (same handler as $03, direction flipped via `$10`). |
| $09   | `CODE_01DEE0` | Text-display + frame-skip on button press.                                |
| $0B   | `CODE_01DEB9` | Text-clear closing (the "fade-out before final close").                   |
| $0D   | `CODE_01DEB9` | Final closing.                                                            |

Terminal state `$0F` clears window masks and FreezeYoshi /
FreezeSprites flags, optionally clears `$038C` if not in a
cutscene context, and exits the state machine. The dialog
gamemode is **entered every frame from `gm0f_run_level`** when
`MessageBoxState != 0`, so it sits on top of the regular level
loop -- no special gamemode swap required.

The text data is sourced from `FXDATA_5110DB` (SuperFX bank
$51), indexed by the message ID written to `$704070`. The
SuperFX side handles the actual character glyph rasterisation
into the message-window OAM tiles.

---

## 6. Arrow signs and Chomp warning

### 6.1 The position-derived variant encoding ($0197 / $0198)

Both arrow-sign sprites use the **same 2-bit position-derived
selector** that the Message Box uses for its message-ID slot
(§5.3). The X-bit-4 and Y-bit-4 of the placement coordinate index
into per-sign frame + flip-flag tables.

Shared encoding (from `init_arrow_sign` / `init_diagonal_arrow_sign`
in Bank0F.asm at `$0F:8972` and `$0F:89A0`):

```
SEP #$20                ; 8-bit accumulator
LDA $70E2,x : AND #$10 : LSR : LSR : LSR : LSR  ; bit 4 of X-low -> bit 0
STA $00
LDA $7182,x : AND #$10 : LSR : LSR : LSR        ; bit 4 of Y-low -> bit 1
ORA $00
TAY                     ; Y = 0..3 (position-derived variant index)
```

Then for **$0197 (cardinal arrows, `init_arrow_sign`)**:
```
LDA DATA_0F8962,y : STA $7402,x      ; frame number
LDA $7042,x : EOR DATA_0F896E,y : STA $7042,x   ; XOR flip flags
```

For **$0198 (diagonal arrows, `init_diagonal_arrow_sign`)**:
```
LDA DATA_0F896A,y : STA $7402,x      ; frame number (always 2)
LDA $7042,x : ORA DATA_0F896E,y : STA $7042,x   ; OR flip flags
```

Per-variant data tables (8-bit, in Bank0F):

```
DATA_0F8962:    db $00,$01,$01,$00    ; cardinal frame numbers (2 distinct tiles: horiz + vert)
DATA_0F896A:    db $02,$02,$02,$02    ; diagonal frame numbers (single diagonal tile)
DATA_0F896E:    db $00,$40,$80,$C0    ; flip flags (X-flip $40 / Y-flip $80 / both $C0)
```

The cardinal arrow uses two tiles (frame $00 = horizontal
right-pointing, frame $01 = vertical up-pointing) and four flip
combinations to make all four directions:

| Index | Frame | Flip | Result          |
|-------|-------|------|-----------------|
| 0     | $00   | $00  | arrow-right     |
| 1     | $01   | $40  | arrow-down (vertical tile, X-flipped is a no-op; the actual rotation must be via tile $01 being the vertical pre-rotated form -- worth runtime-verify, open question 7) |
| 2     | $01   | $80  | arrow-up (vertical tile, Y-flipped) |
| 3     | $00   | $C0  | arrow-left (horizontal tile, XY-flipped) |

The diagonal arrow uses ONE tile (frame $02 = NE-pointing
diagonal) and the same four flip combinations to make NE/NW/SE/SW.

The **XOR vs ORA distinction** matters because the level designer
may pre-place sprites with non-zero `$7042` initial values
(e.g. inherited palette nibble bits). Cardinal-arrow EOR cleans
into the existing flip; diagonal-arrow ORA stacks on top
(diagonal flips are added, not toggled).

### 6.2 The tile-grid snap

After the variant-decoding branch, both arrow Inits fall into
the shared snap-and-render code at `CODE_0F89C6`:

```
LDA $70E2,x : AND #$FFE0 : CLC : ADC #$0008 : STA $70E2,x  ; snap X to $20-grid + $8 offset
LDA $7182,x : AND #$FFE0 : CLC : ADC #$0008 : STA $7182,x  ; snap Y to $20-grid + $8 offset
STZ $7400,x             ; clear per-slot direction byte
RTL
```

The `AND #$FFE0` clears the low 5 bits (snap to $20-tile
granularity), then `+ $0008` centres within the $20-cell. This
means the *sub-cell position* (bit 4) that drove the variant
encoding is **discarded immediately after being read** -- the
sign visually lands on the cell centre regardless of where the
level designer placed it within the cell. The placement bit is
purely a variant signal, not an offset.

### 6.3 Both Mains are bare RTL

```
YI_NorSpr197_ArrowSign_Main:
YI_NorSpr198_DiagonalArrowSign_Main:
main_arrow_sign:
    RTL
```

Arrow signs do no per-frame work. The Init runs once, stamps the
tile + flip into the slot's render slots ($7402 / $7042), and the
sprite engine handles rendering each frame via the standard
`CODE_03AA52` housekeeping. No state machine, no contact
detection, no animation -- the sign is pure level furniture.

(They do still get `JSL CODE_03AA52` from the engine wrapper
ahead of the Main dispatch, so the slot's render OAM gets
updated each frame. The Main just doesn't have anything to add.)

### 6.4 $00D8 ChompWarningSign

Visually similar to the arrow signs but mechanically different.
The Chomp sign is a **single-frame "!" tile** stamped onto the BG3
layer (not OAM) via SuperFX rasterisation, and unlike the arrow
signs has **no position-derived variant** -- there's only one Chomp
sign tile.

`init_chomp_signboard` (`$02:9C47`):
```
JSL.l CODE_03AE60       ; standard sprite setup
LDA.w #$0100
STA.w !REGISTER_SuperFX_R6_MultiplierLo   ; scale = 1.0
LDY.w $7722,x           ; per-slot OAM-tile lookup index
TYX
LDA.l DATA_03A9CE,x : STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo  ; X coordinate
LDA.l DATA_03A9EE,x : STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo ; Y coordinate
LDA.w #$0010 : STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
              : STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
LDA.w #FXDATA_548000+$00C1
STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
LDA.w #(FXDATA_548000+$00C1)>>16
STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
LDX.b #FXCODE_088293>>16
LDA.w #FXCODE_088293     ; SuperFX rasteriser (the standard tile-stamp FX entry)
JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
INC.w $0CF9              ; mark BG3 tilemap dirty
LDX.b $12
RTL
```

`$0CF9` is the **BG3 tilemap dirty flag**, also written by
`CODE_bg3_tilemap_flush` in Bank00 (`$00:9485`). The flush
routine fires once per NMI window when dirty, copying the
SRAM staging buffer at `$70:5800` into VRAM. So the Chomp
sign's Init runs *once*, stamps a tile into the BG3 staging
buffer, sets the dirty bit, and the engine's BG3 flush picks
it up the next NMI. No per-frame work, no Main-loop overhead.

`main_chomp_signboard` (`$02:9C87`):
```
JML.l CODE_03AA52       ; bare housekeeping call; the sprite engine handles all the actual work
```

The `JML` (jump-long, not JSL) means the Main is a tail-call into
the engine's standard "sprite is alive, do nothing special"
handler. Even cheaper than the arrow-sign's `RTL` because there's
no return path setup. The Chomp sign exists exclusively to:

1. Stake out a tile-grid position via level-data placement.
2. Stamp its tile into the BG3 layer on Init.
3. Persist its slot for the duration of the screen (so the
   stamp isn't blown away by a later sprite-slot reuse).

**Related family**: the actual Chomps that the warning sign
telegraphs (Chomp Shark $154 etc.) live in `docs/family-fish.md
§3.5`. The two ARE deliberately co-placed by level designers
(the sign at the start of the level, the Chomp Shark off-screen
to the left), but there is **no runtime coupling** -- the Chomp
warning doesn't know about the Chomp, and vice versa. It's a
purely visual heads-up.

---

## 7. Cross-references

### 7.1 Framework asm (source of truth)

- `yi/Banks/Bank02.asm` lines 10119-10283 -- the pipe cluster
  (`init_vertical_entrance`, `main_vertical_entrance`,
  `main_hidden_vertical_entrance`, `init_horizontal_entrance_*`,
  `main_horizontal_entrance`, `CODE_02CDB9` shared warp,
  `CODE_02D908` contact test, `CODE_02D985` sniff helper).
- `yi/Banks/Bank02.asm` lines 4019-4042 -- the Teleport sprite
  (`init_teleport_sprite`, `main_teleport_sprite`,
  `CODE_02A4B5` the shared screen-exit-from-position helper).
  Note CODE_02A4B5 is also called by the door family's "open"
  termination path (see `docs/family-misc.md §1.4 step 4`).
- `yi/Banks/Bank02.asm` lines 2895-2931 -- Chomp Warning Sign
  (`init_chomp_signboard`, `main_chomp_signboard`).
- `yi/Banks/Bank05.asm` lines 12210-12447 -- Message Box
  (`init_hint_block`, `main_hint_block`,
  `DATA_hint_block_state_ptr`, the three sub-state handlers).
- `yi/Banks/Bank01.asm` lines 12121-12300 -- the in-level
  dialog state machine (`message_box_handler`,
  `message_box_state_ptr` 7-entry dispatch). Consumes
  `!RAM_YI_Level_MessageBoxState` and `$704070` (message ID).
- `yi/Banks/Bank0F.asm` lines 1283-1376 -- arrow signs
  (`init_arrow_sign`, `init_diagonal_arrow_sign`,
  `main_arrow_sign`, `DATA_0F8962`/`DATA_0F896A`/`DATA_0F896E`).
- `yi/Banks/Bank03.asm` lines 142-143, 208, 249, 284-285,
  292, 403, 483-484 -- dispatch-table entries for all eight
  sprites. (Stomp / Headbop / RideYoshi entries are at the
  shared-RTL alias positions and don't merit individual lines.)

### 7.2 Memory addresses (defines from `yi/Memory/`)

- `!EXRAM_YI_Level_PipeTransitionTypeLo` (`$70:0106`) -- the
  pipe-direction word; see `yi/Memory/SRAM_Player.asm:155-167`.
  The 4 adjacent fields (PipeTransitionDist, PipeAnimState,
  PipeEnterAccel, PipeXPosRel) are the PlayerState06 traversal
  block.
- `!EXRAM_YI_Level_FreezeYoshiFlagLo` (`$70:01AE`),
  `!EXRAM_YI_Level_FreezeSpritesFlagLo` (`$70:01B0`) -- the
  freeze flags. Pipes / Message Box write directly; the door
  family writes them too. See `SRAM_Player.asm:283-285`.
- `!RAM_YI_Level_MessageBoxState` (`$00:0D0F`) -- 7-state
  dialog dispatcher. Defined in `WRAM_RuntimeEffects.asm:147`.
- `!RAM_YI_Global_CurrentGameMode` (`$00:0B`) -- the
  destination is `$0B` (fade-out start). See
  `yi/Constants/GameModes.asm:16`.

### 7.3 Sibling docs in this folder

- `docs/levelloader.md` -- the GameMode $0B / $0C / $0D / $0E /
  $0F re-entry chain that pipe-warps and the Teleport sprite
  trigger. §1 step 4 onward.
- `docs/leveldataengine.md` -- how the sprite stream parses
  `$0042` / `$00D0` / `$00D1` / `$0084` / `$00AD` / `$0147` /
  `$0197` / `$0198` / `$00D8` records into sprite slots, plus
  the per-screen exit table at `$7F:7E00,x` that the warp
  targets.
- `docs/spritestateengine.md` -- the 9-state engine dispatcher
  underneath every Init / Main here.
- `docs/family-misc.md §1` -- the door family. Same broad
  "Yoshi-contact triggers screen-exit" mechanic, much larger
  per-sprite animation state machine.
- `docs/family-fish.md §3.5` -- Chomp Shark ($154) and Chomp
  cousins. The actual sprites the Chomp warning sign $0D8
  exists to telegraph.

### 7.4 Constants (`yi/Constants/`)

- `NormalSpriteIDs.asm` lines 86, 158, 199, 238, 239, 246,
  357, 437, 438 -- the canonical defines for $0042, $0084,
  $00AD, $00D0, $00D1, $00D8, $0147, $0197, $0198.
- `AmbientSpriteIDs.asm:224` -- `!Define_YI_AmbSpr224`
  (the warp-sparkle ambient sprite spawned by the
  secret-pipe sniff path). The constant's comment is
  out of date; see §3.2 finding.
- `PlayerStates.asm:9-10` -- `!Define_YI_PlayerState06`
  (pipe entry / traversal) and `!Define_YI_PlayerState08`
  (pipe exit / under-block emergence).
- `GameModes.asm:16` -- `!Define_YI_GameMode0B`.

### 7.5 External references

- `yoshisisland-disassembly/disassembly/bank02.asm` --
  Raidenthequick descriptive labels: `init_vertical_entrance`,
  `main_vertical_entrance`, `main_hidden_vertical_entrance`,
  `init_horizontal_entrance_left/right`,
  `main_horizontal_entrance`, `init_teleport_sprite`,
  `main_teleport_sprite`, `init_chomp_signboard`,
  `main_chomp_signboard`.
- `yoshisisland-disassembly/disassembly/bank05.asm` --
  `init_hint_block`, `main_hint_block`.
- `yoshisisland-disassembly/disassembly/bank0F.asm` --
  `init_arrow_sign`, `init_diagonal_arrow_sign`,
  `main_arrow_sign`.
- `yoshisisland-disassembly/wiki` -- the per-screen exit
  table format documentation (the `$7F:7E00,x` consumer side).
- `ys_enmy*.asm` -- parallel asm for the pipe / sign family
  with the same overall shape.

---

## 8. Open questions

1. **Pipe-transition-type high byte semantics**.
   `SRAM_Player.asm:155-156` documents the high byte as
   `$00/$40 vertical in/out, $80/$C0 horizontal in/out`. Verified
   the horizontal pipes write `$8002` (right) / `$8004` (left),
   matching the `$80` annotation. But the **vertical pipe writes
   `$0006` not `$8006`** (verified at Bank02:10163 -- the
   `LDA #$0006 ... JSR CDB9` path). The "$8006" comment in
   the constant block was a misread of CODE_02CDB1's giant-shyguy
   carry path. Recommend updating `SRAM_Player.asm:155-156` to
   distinguish: vertical = `$0006`, horizontal-right = `$8002`,
   horizontal-left = `$8004`, exit-out = `$40NN` / `$C0NN`. The
   exit-out write site is presumably in Bank04 PlayerState06's
   transition into PlayerState08; not in this family.

2. **Sprite-X bit-3 ($0008) significance**. Both vertical-pipe
   Inits set `$70E2,x |= $0008`. This is the sprite's X-position
   word -- setting bit 3 would mean the pipe sprite is at an
   odd-pixel X coordinate, which is unusual for grid-aligned
   pipes. More likely, the engine repurposes bit 3 of $70E2 as a
   "this slot is a pipe / accepts directional D-pad contact"
   flag, consumed by `CODE_02D908` or `CODE_03AF23`. Needs
   tracing through the engine's sprite-X reader to confirm.

3. **`$7E08 bit $0008` (sniff-enabled flag)**. The secret-pipe
   sniff helper `CODE_02D985` gates on `$7E08 & $0008`. The
   setter for that bit isn't in this family. It's plausibly tied
   to "Yoshi has performed a sniff (down + B?) in this level",
   making secret pipes findable only after the player has
   initiated sniffing. Runtime trace of bit-3 setters on $7E08
   would confirm.

4. **SuperFX-side direction flip on horizontal pipes**. The Init
   shared body at `$02:D922` does `EOR #$0002` on the direction
   byte if `R5 != 0` after `FXCODE_0ACE2F`. R5 is the FX-side
   return; what condition makes it non-zero for pipes
   specifically? Possibly the FX-side hitbox-registration
   detected a "this slot is on a mirrored screen segment" flag.
   Worth tracing FXCODE_0ACE2F's exit conditions.

5. **`$77C2,x` semantic**. The horizontal pipe Main reads
   `$77C2,x` and compares its low byte to the stored direction
   `$7400,x`. The shape (per-slot, indexed by sprite slot X)
   suggests it's a Yoshi-controller-direction snapshot the
   engine maintains for the sprite Yoshi is overlapping. Verify
   in SRAM_SpriteSlots.asm (page 14 / $1740 region?).

6. **Message Box `$011C` egg-throw-setting override**. The
   special-case at `CODE_05DC2E` overrides message ID 1 with
   $011C when `EggThrowSetting != 0`. This is presumably the
   "advanced egg-aim" tutorial alternative. The message-data
   table at `FXDATA_5110DB` would have the corresponding string
   at offset $011C * sizeof(message). Verify by reading the
   table around offset $238.

7. **Cardinal arrow frame mapping**. Tile $00 is horizontal
   (right-pointing); tile $01 must be a vertical-pointing tile
   for the index-1/index-2 flips to produce arrow-down /
   arrow-up. The flip flags ($40 X-flip / $80 Y-flip) need to
   actually produce the expected visual outcomes given the
   chosen base tile orientations. Runtime trace (the
   SuperFX-side text/tile cache referenced via `$7402`) would
   confirm whether tile $01 is vertical-up or vertical-down.

8. **Chomp sign as level-data marker**. Does any sprite or
   level-mode code *read* the presence of a $0D8 to enable
   special behaviour? E.g. does the Chomp Shark $154's Init
   look for nearby $0D8 slots to gate its "appear" trigger?
   `docs/family-fish.md §3.5` doesn't suggest this, but the
   inverse (level designer always pairs them) is suggestive. If
   no runtime coupling, the doc-pairing convention is purely
   editorial.

9. **VerticalPipe / RedGiantShyguy label collision**. The
   misnamed label `YI_NorSpr042_RedGiantShyguy_Init` at
   `Bank02:8776` (which actually serves slot $043) is benign
   but confusing. A future pass could rename it to
   `YI_NorSpr043_RedGiantShyguy_Init` (correct slot) without
   affecting any dispatch pointer (the table at Bank03:143
   would need its label reference updated too). MD5 should be
   byte-exact after; the relabel is purely lexical.
