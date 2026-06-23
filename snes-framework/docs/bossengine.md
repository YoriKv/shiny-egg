# YI boss engine reference

A standalone reference for the Yoshi's Island boss state-machine engine: how
a single sprite slot in normal-sprite RAM ticks through a multi-step combat
state machine, integrates with the gamemode `$0F` per-frame dispatcher, and
drives boss-only HDMA / SuperFX / Mode-7 / palette tricks.

This doc uses **Hookbill the Koopa** (sprite `$0AE`, World 4-8 castle boss) as the
canonical template because it is the most-named boss in the
`yoshisisland-disassembly` repo (~70 descriptive labels) and resides
end-to-end in Bank01 -- one file, easy to read top-to-bottom.

This doc complements `docs/enginecore.md` (ROM layout, gamemode dispatcher)
and `docs/leveldataengine.md` (level-data parsing). Cross-references inline.

Source of truth for all addresses: framework asm at
`yi/Banks/Bank01.asm` (Hookbill, Naval Piranha closer, in-level gamemode
`$0F` dispatcher, HDMA setup) and the per-boss banks listed in section 7.
Verified against `yoshisisland-disassembly/disassembly/bank01.asm`
(28.3 percent descriptive coverage).

---

## 1. Engine conventions at a glance

YI bosses are normal-sprite-table entries with a private state machine on
top of the generic normal-sprite tick. The engine has six layered
conventions, applied by EVERY boss:

```
1. Slot in normal-sprite table  (sprite "X" register = base offset into
   $7Exxx tables)
   - Allocated by the level's sprite-spawn list (3-byte records:
     locH, locL, sprite-ID; see docs/leveldataengine.md sec. 2).
   - !EXRAM_YI_Level_NorSpr_CurrentStatus,x = 2 means "active and
     handled this frame".
   - The slot owns the boss's X/Y position, X/Y velocities, sprite-ID,
     animation frame, palette row, etc. -- same convention as ANY
     normal sprite.

2. Init handler  (called once when slot transitions to status = 2)
   - Reached via the per-sprite Init/Main dispatch table in Bank03
     (see docs/spritestateengine.md for the full Bank03 dispatch model).
   - For Hookbill: YI_NorSpr0AE_HookbillTheKoopa_Init at $01:8002.
   - Typically: read $18,x (sub-state byte), index a small init-state
     pointer table, dispatch via JSR (table,x), advance $18,x by 2.

3. Main handler  (called every frame the slot is status = 2)
   - For Hookbill: YI_NorSpr0AE_HookbillTheKoopa_Main at $01:8A14.
   - Typically: read $76,x (combat state byte), double, JSR via
     state pointer table, then run shared housekeeping (CODE_03AF23
     in Bank03 -- gravity/animation/collision).
   - State transitions happen inside per-state handlers: each handler
     can write a new state byte to $76,x to jump elsewhere on the
     next frame.

4. Timers + sub-state  (in WRAM, per sprite slot)
   - $7A36,x : "animation frame timer" -- main per-state countdown
   - $7A96,x : "wait counter"           -- secondary timer
   - $7A98,x : "animation cycle"        -- tertiary / cosmetic
   - $16,x   : "sub-state byte"         -- nested step counter
   - $18,x   : "state-of-state byte"    -- init-only state index
   - $76,x   : "main state byte"        -- combat-phase state index

   Bosses (and many regular sprites) DEC these per-frame from inside
   the state handler. A typical handler reads "is timer 0?" first; if
   not, just returns (still in this state). If yes, performs the
   transition.

5. HP / damage  (no explicit HP byte for most bosses -- counters
   instead)
   - Egg-hit count: $107A    (Hookbill -- 3 hits before final phase)
   - Player-on-head count: $107C, $107E  (ground-pound counter)
   - Both are 16-bit WRAM words shared between the boss-Main code
     and the shared damage detector CODE_03B24B (Bank03).
   - The damage detector reads sprite-on-sprite Y overlap from
     $7860,x (collision flags), checks $60AB (player-headstomp
     window), and if a hit is detected, CALLS the boss's "I got hit"
     state by writing $76,x to a new state and clearing timers.
   - Some bosses do hold a direct HP byte (Tap-Tap: $7A98,x or $16,x
     by family).

6. Boss-end transition  (when defeated)
   - State handler at end of death sequence JMLs to CODE_03A32E
     (Bank03 "remove sprite + queue closer"), then closes the boss
     room via NorSpr `$0DD` (CloseWallInNavalPiranhaRoom) which IS
     the universal "boss closer cinematic" (see section 5).

7. Boss music + cinematic herald  (the music is NOT kicked by the boss)
   - The level's boss music change is read from
     `DATA_boss_music_per_battle` and queued by NorSpr `$0048`
     CutsceneKamek in state `$1C` -- the LAST state of the foreshadow
     fly-in cinematic, just before the slot despawns.
   - This means CutsceneKamek is a *herald*: it announces the fight
     and owns the music transition. If a level (theoretically) did
     not spawn `$0048`, it would never get the boss music change.
     No vanilla level does this, but the architecture allows it.
   - The mid-fight Kamek variants (`$1AD` MagicShootingKamek, the
     in-room cutscene Kameks documented in `docs/family-kamek.md`
     and `docs/family-bowserfight.md`) do NOT kick boss music; they
     run combat-AI and spell-cast logic only.
   - Concurrent with the music kick, CutsceneKamek also reads the
     2-pass spell-color tables (`DATA_kamek_spell_color1_per_boss` +
     `..._color2_per_boss`) -- every per-boss color pair is one
     warm + one cool, a deliberate warm-then-cool dichotomy.
   - See `docs/family-kamek.md` for the full Kamek-variants family.
```

Boss state machines are dispatched per-frame on a **single state byte**
(`$76,x` for Hookbill / Tap-Tap / Raphael / Salvo; `$18,x` for the
closer-wall and for some smaller-state bosses; some bosses use both with
distinct meanings). The dispatch is always:

```asm
TXY                 ; preserve sprite index in Y
LDA  $76,x          ; load state byte (or $18,x or $16,x)
ASL                 ; * 2 for word table
TAX                 ; X = table offset
JSR  (DATA_xxxxxx,x); indirect call to per-state handler
```

The handler runs in DB = $01 (set by `JSL` from the shared
Init/Main dispatcher) so it can address state-pointer tables and
boss-local data via `dw CODE_xxxx` 2-byte entries (no bank byte
needed for intra-bank jumps).

---

## 2. Hookbill case study (the canonical boss)

Hookbill is the World 4-8 castle boss. He arrives via a fog cinematic,
spawns as a giant Koopa (after Kamek grows him), then runs a 50-state
combat loop until 3 egg-hits send him into a "final phase" hop-and-rage,
then 1-2 more hits crush him.

### 2.1 Two-phase architecture

Hookbill is **two state machines glued together**:

- **Init phase** (sprite status transitions 0->2): 8-entry table at
  DATA_018015 (`hookbill_init_state_ptr`), indexed by `$18,x`.
  Drives the pre-fight fog cinematic and boss spawn.
- **Main phase** (per-frame while alive): 55-entry table at
  DATA_0189A4 (`hookbill_state_ptr`), indexed by `$76,x`. Drives
  every combat behaviour.

Both tables are `dw` 16-bit pointers (the routines all live in
Bank01 so the bank byte is implicit). Both use the standard
`(table,x)` indirect-JSR dispatch pattern.

### 2.2 Init-phase state diagram

```
$18,x state index    Routine                         Behaviour
  $00 = 0          CODE_018025 hookbill_init_fog        Start fog: clear BG3, enable color-math subtract
                                                      Then JMP CODE_01819F (INC $18,x by 2)
  $02 = 1          CODE_018041 hookbill_init_fog_left   Move fog left over screen; per-line SuperFX raster.
                                                      Reads BG1XPos ($7680,x); each frame, REP/SEP $10, advance fog
                                                      column count; when column count hits $E0/$E0 (covered),
                                                      writes color-math enable bits and HDMA channel 8 enable.
  $04 = 2          CODE_018103 hookbill_init_fog_stay   Hold the fog opaque for a while.
                                                      Counts $14 frames (LSL 3); when $7E:336C >= $20,
                                                      transitions to fade.
  $06 = 3          CODE_018174 hookbill_init_fog_fade   Fade the fog back; on completion clears HDMA channel 8
                                                      and animation tile/palette, then JMP CODE_01819F.
  $08 = 4          CODE_0181A8 hookbill_init_graphics   Decompress gfx ID $4D to VRAM $2800. Then INC $18 by 2.
  $0A = 5          CODE_0181B2 hookbill_init_graphics_2 Decompress gfx ID $4E to VRAM $2C00. Then INC $18 by 2.
  $0C = 6          CODE_0181C5 hookbill_init_sprites    JSL CODE_0181FB (decompress shell + load palette).
                                                      Issue music fade, spawn Kamek (sprite $DD via CODE_03A364).
                                                      Set Kamek X-vel $7C0, init Kamek "throwing magic" state.
                                                      Play sound $48, JSL CODE_04F74A.
  $0E = 7          CODE_018236 hookbill_init_boss       Spawn Hookbill (this sprite itself activates fully).
                                                      Position Hookbill at BG1XPos + $0120.
                                                      Snapshot player Y -> $7182,x. Reset Mode7 / SuperFX
                                                      parameters. Set MainScreen = $15 (BG1 + sprites + BG4).
                                                      Play music $09 (the boss theme). Write $76,x = $2B
                                                      (= 0x2B / 2 = state 21.5 hookbill_walk_forward... actually
                                                      the dispatch is on $76,x DOUBLED, so $2B is bypassed and
                                                      the next path uses $1080 setup -- see "intro" below).
                                                      PLA / RTL (consumes return address, terminates entire stack
                                                      frame so the engine immediately starts the Main path).
```

### 2.3 Main-phase state diagram

Each entry below is dispatched via `JSR (DATA_0189A4,x)` with
`X = $76,x * 2`. After return, shared housekeeping fires and the
state byte may have been changed by the handler (transition).

The notation `S->T` means the handler at state S CAN transition to T
(by writing $76,x = T*2).

```
State  Label                                  Next-state transitions
$00 hookbill_start_crawl                  -> $08 (start the crawl walk cycle)
                                          -> stay (no walk yet)
$02 hookbill_crawl_forward                -> $16 (turn) on collision wall  (via CODE_0193BA)
                                          -> $18 (jump-fall) on collision wall variant
                                          -> $00 (back to start) when complete
$04 hookbill_head_spit_egg                -> $05 (next slot, indirectly $0A=shell_spit)
$06 hookbill_head_nudge_up                -> $07 ($08 in actual table) keep alternating
$08 hookbill_head_back                    -> $01 (= state $02 in raw byte)
$0A hookbill_shell_spit_egg               -> next (head_nudge)
$0C hookbill_shell_nudge_up               -> $07 ($08)
$0E (re-uses head_back)
$10 hookbill_stand_up                     -> next ($12) when timer done
$12 hookbill_stare_forward                -> next ($14) when wait done; sets anim frame
$14 (re-uses stand_up)
$16 hookbill_walk_forward                 -> $0B then $0C path; or $18 via $7A98 path
                                          -> $17 via CODE_0193BA collision (state $1A egg_hit_running)
$18 hookbill_hunch_forward                -> $0E (head_back) when timer done
$1A hookbill_egg_hit_while_running        -> JMP CODE_01947B (writes $76,x = $0A)
$1C hookbill_run_forward                  -> $0D (writes $76,x = $0D) and sets $7AF6,x = $20 (i-frames)
                                          -> $1E via JMP CODE_019669 (Hookbill dives!)
$1E hookbill_dive                         -> next ($20) on $7860&1 (ground hit)
$20 hookbill_dive_land                    -> next ($22) when timer done
$22 hookbill_dive_land_2                  -> next ($24) on $7860&1 (full land)
$24 hookbill_dive_land_3                  -> next ($26) when timer done (zeros X-vel)
$26 hookbill_dive_land_4                  -> next ($28) sets $16,x = $08 (count blinks)
$28 hookbill_dive_blink                   -> next ($2A) when blinks exhausted
$2A hookbill_dive_get_up                  -> $01 (state $02 -- back to crawl)
$2C hookbill_turnaround_retract           -> next ($2E)
$2E hookbill_turnaround_jump              -> next ($30) on $7860&1 (jump landed)
                                          -> $01 (crawl) if grounded already
$30 hookbill_turnaround_stand_retract     -> next ($32)
$32 hookbill_turnaround_stand_rotate      -> next ($34) and toggles facing direction
$34 (re-uses stand_rotate)
$36 hookbill_turnaround_fall              -> $09 (state $12)
$38 hookbill_egg_hit_init                 -> next ($3A) when timer done
$3A hookbill_egg_hit_cry                  -> next ($3C) when timer done
$3C hookbill_egg_hit_not_egged_again      -> $09 (state $12)
$3E hookbill_egg_hit_final_init           -> next ($40) on $7860&1
$40 hookbill_egg_hit_final_hop            -> next ($42)
$42 hookbill_egg_hit_final_fall           -> next ($44) when X-vel decays to 0
$44 hookbill_egg_hit_final_lean           -> next ($46)
$46 hookbill_egg_hit_final_wobble         -> next ($48) when timer done
$48 hookbill_egg_hit_final_freeze         -> next ($4A) when $7A36 done
$4A hookbill_hop_wobble                   -> next ($4C) when $16,x done
$4C hookbill_hop_one                      -> $26 ($4D in table -- ground-pound) on $7860&1
                                          -> next ($4E) on initial wobble end
$4E hookbill_hop_two                      -> $0F state ($1E) -- ground pound!
$50 hookbill_ground_pound_and_body_out    -> $01 (back to crawl) for 1st few
                                          -> next ($52) on terminal collision
$52 hookbill_ground_pounded_init          -> next ($54) on $7A36 done
$54 hookbill_ground_pounded_flash         -> $24 ($48 in table, = hop_wobble) on completion;
                                            for terminal hit, plays explosion sound and triggers death.
$56 hookbill_begin_koopa_walking          -> next ($58) when koopa-form at X=$A0
$58 hookbill_begin_kamek                  -> next ($5A) when $1015 finally signed-positive
$5A hookbill_begin_init1                  -> $5C ($5C = next) when both gfx pages done
$5C hookbill_begin_init2                  -> $5E (next) after 32 KB of VRAM upload done
$5E hookbill_begin_koopa_crouch           -> $60 (next); PLA/RTL on completion (terminates frame)
$60 hookbill_begin_shell_init             -> next ($62) on $7860&1
$62 hookbill_begin_shell_grow             -> $32 (state $30 = ground_pound) -- the moment Kamek
                                            finishes growing him, the actual Hookbill state machine
                                            engages.
$64 (re-uses ground_pound_and_body_out)
$66 (re-uses ground_pounded_init)
$68 hookbill_dead_squish_down             -> next ($6A) when squish done
$6A hookbill_dead_pancake                 -> next ($6C) -- spawns 16 AmbSpr $223 (debris stars)
$6C hookbill_dead_shell_break             -> next ($6E) on hit-floor
$6E hookbill_final                        -> JML CODE_03A32E (terminates boss, queues closer)
```

### 2.4 Hookbill timer semantics

| Timer  | Decremented by    | Reset by                              | Used by states |
|---|---|---|---|
| `$7A36,x` | Shared housekeeping (Bank03 CODE_03AF23) per frame | Each handler that needs it | All states (most read "BNE return") |
| `$7A96,x` | Same | Handler-specific | dive, egg_hit, hop_wobble, etc. |
| `$7A98,x` | Same | Handler-specific | start_crawl, dive_blink, etc. |
| `$16,x`   | Handler-side `DEC $16,x`         | Set by handler | hop, dive_blink (used as count) |
| `$18,x`   | (counts as anim-progress fold)   | Set by handler | start_crawl: $20 freezes anim |

### 2.5 Hookbill Main entry-point logic

`YI_NorSpr0AE_HookbillTheKoopa_Main` at `$01:8A14`:

```
$1080 = 0?  -> CODE_018CD8  (idle path: just refresh OAM)
$1080 = 1?  -> CODE_018CC7  (intro tail: shape Kamek's OAM)
otherwise   -> CODE_018D1C (full SuperFX boss draw) then CODE_018A50 (Mode-7 matrix)

Then:
  JSL CODE_03AF23  (shared sprite housekeeping)
  TXY; LDA $76,x; ASL; TAX
  JSR (DATA_0189A4,x)  ; dispatch combat state

If $1080 >= 2:
  JSR CODE_0191BB   (post-state collision check 1)
  JSR CODE_01922A   (post-state collision check 2)
  JSR CODE_018A95   (per-frame SuperFX draw call selector)
  JSR CODE_01924D   (palette mirror update)
  JSR CODE_0192DA   (camera/pos clamp)
RTL
```

`$1080` is the "phase token" -- `$00` during the Kamek-growing intro,
`$01` between Kamek-throw and boss-active, `>= $02` during combat. This
lets the boss tick AT ALL during the cinematic without running combat
state transitions yet.

---

## 3. HP / damage handling pattern

### 3.1 Detecting a hit

Hookbill is hit via the egg/projectile collision detector at the start
of CODE_018D1C (after the SuperFX draw):

```
LDY $7402,x          ; current sprite-anim frame
CPY #$28
BPL +
CPY #$21
BPL CODE_018EBE      ; egg-hit accepted ONLY in animation frames 0x21..0x27
                     ; (this is how the "windows of vulnerability" work)
+: JMP CODE_018F38   ; out-of-window: jelly-bounce path
```

Then CODE_018EBE handles the "egg hit accepted" branch:

```
CLC
ADC #$0003
ADC !EXRAM_YI_Player_YPosLo
STA !EXRAM_YI_Player_YPosLo  ; player bounces up off Hookbill
STZ $60AA / $60C0            ; clear player y-velocity / collision
INC $61B4                    ; player hit-frame counter
LDY $76,x
CPY #$29 / $2A: BEQ +        ; already in egg-hit -> noop
CPY #$33: BMI ++             ; in pre-koopa init phase -> noop
+: write final state and play CODE_0085D2 sound $80 (BossDefeated)
++: hit-count logic at CODE_018EE7:
       LDY $107E             ; number of egg-hits this kamek round
       CPY $107C
       BNE +                 ; partial -- noop
       ; full -- write big timer, increment $107C
       LDA #$60
       STA $7AF6,x           ; invincibility timer
       INC $107C
       INC $107C
       LDY $107C
       CPY #$06              ; 3rd hit (counts by 2's)?
       BNE +
       ; YES, 3rd hit: trigger ground-pounded state
       JSL CODE_02A982
       INC $0B7B
       LDA #$0033            ; -> state hookbill_ground_pounded
+: STA $76,x                  ; write new state
```

So Hookbill's "HP" is implicit: `$107C / $107E` form a 2-step
egg-hit counter. The 3rd accepted hit (`$107C == 6` because it
increments by 2) jumps Hookbill into the death sequence.

### 3.2 Generic "ground-pound" hit

A second damage path: the player ground-pounds on top of the boss.
This is detected via `$7223,x` (sprite-on-sprite-stomp flag) and
`$60D4` (ground-pound active). When Hookbill is ground-pounded:

- State transitions to $52 (hookbill_ground_pounded_init)
- $7A36,x = 1 (kick off the squash timer)
- $1078 (boss Y-scale or related Mode-7 height) goes from current to
  `$00C0` (compressed)
- Player Y-position is forced to bounce up

When the timer expires, the boss enters $54 (flash) and either
returns to combat (early hits) or transitions to death ($56+).

### 3.3 Boss-engine generic helpers

These live in Bank03 and are JSL'd by Hookbill (and most bosses):

| Address       | Purpose                                  |
|---|---|
| `$03:A31E`    | Remove this sprite (status = 0)          |
| `$03:A32E`    | Boss "final" terminator: removes sprite, queues closer-wall sprite ($0DD) at boss room exit |
| `$03:A34C`    | Spawn ambient sprite (by ID), returns Y = slot |
| `$03:A364`    | Spawn normal sprite (by ID), returns Y = slot |
| `$03:A377`    | Spawn normal sprite at offset            |
| `$03:A858`    | Hit-flash sprite handler                 |
| `$03:AF23`    | "Shared sprite housekeeping" -- gravity / fall / anim-tick / damage-flash; called every frame by every boss Main |
| `$03:B24B`    | Sprite-collision hit handler             |
| `$03:B25B`    | Kill-sprite-by-collision                 |
| `$00:85D2`    | Play sound ID in A.b                     |

---

## 4. Boss-specific HDMA / graphics tricks

Bosses lean heavily on three SNES hardware features for their effects:

### 4.1 HDMA channels (allocated at level-load via `hdma_and_gradient_init` at `$01:D5B3`)

The level loader pre-arms HDMA channels 1, 2, 3, 4, 5, 6, 7 with
indirect-source data in WRAM banks $7E/$7F. The init code reads from
seven 5-byte `DATA_01D6xx` blocks (one per channel) and writes them to
the HDMA register file at `$4310..$437F`:

| Channel | Destination register                        | Purpose                                       |
|---|---|---|
| 1   | `!REGISTER_FixedColorData` (`$2132`)           | BG3 gradient color (top-of-screen tint)       |
| 2   | `!REGISTER_FixedColorData` (`$2132`)           | BG3 gradient color (continuation)             |
| 3   | `!REGISTER_BG3HorizScrollOffset` (`$210F`)     | Wavy/sun BG3 horizontal scroll mod            |
| 4   | `!REGISTER_BG3VertScrollOffset` (`$2110`)      | Wavy/sun BG3 vertical scroll mod (or BG2)     |
| 5   | `!REGISTER_Window1LeftPositionDesignation`     | Window-mask effects (fog, etc.)               |
| 6   | (channel 6 init data unused in most levels)    | Reserved for boss-only effects                |
| 7   | `!REGISTER_BG3HorizScrollOffset` ($210F)       | BG3 horizontal mod (sun, mist)                |

After the writes, `!RAM_YI_Global_HDMAEnable` (`$420C` mirror, WRAM
`$0D40` or similar) gets the channel bits set per level.

For BG3 gradient: the SuperFX routine `FXCODE_0890E7` runs first and
generates a 256-entry gradient table at `$70:5800`, then a DMA copies
it to WRAM `$7F:56DE` where HDMA channels 1+2 stream it to `$2132`
per scanline.

### 4.2 Hookbill-specific HDMA: fog cinematic

State 2 (`hookbill_init_fog_left`, $01:8041 onwards) sets up the
fog overlay using:

- BG3 cleared, then re-rendered via SuperFX routine `FXCODE_08AA7F`
  with parameters in `$702F8C..$702FA0` (the per-scanline fog density
  table for one column).
- Color-math enable = $24 (BG3 subtract).
- HDMA channel 4 enabled (`TSB $0008` into HDMAEnable) to stream the
  fog gradient.
- SuperFX `FXCODE_089208` runs each frame to advance the fog column
  pointer and update the on-screen fog density.

When the fog fades (state $06 `hookbill_init_fog_fade`), `TRB $0008`
into HDMAEnable disables the channel, and `TRB $0002` clears
SubScreenLayers BG2. Color-math returns to default.

### 4.3 Hookbill-specific Mode-7: boss body rendering

Hookbill's body is rendered via Mode-7. The Mode-7 matrix A/B/C/D is
computed each frame by `CODE_018A50`:

```
LDA $1060           ; Hookbill X-tilt parameter
ASL                 ; (rotates back to negative if needed)
STA !REGISTER_SuperFX_R1_PLOTXCoordinateLo
LDA $1076           ; Mode-7 scale numerator
ASL
STA !REGISTER_SuperFX_R6_MultiplierLo
LDA $1078           ; Mode-7 scale denominator
ASL
STA !REGISTER_SuperFX_R2_PLOTYCoordinateLo
LDX.b #FXCODE_08A000>>16
LDA.w #FXCODE_08A000
JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
; SuperFX populates R3 = matrix B, R5 = matrix A, R7 = C, R8 = D
LDA !REGISTER_SuperFX_R3_GeneralPurposeLo
STA !RAM_YI_Global_Mode7MatrixParameterBLo
... A, C, D analogous ...
```

So the boss's tilt / shrink / squish is driven by `$1060` (tilt) and
`$1076 / $1078` (X-scale / Y-scale), all of which are written by
individual state handlers (e.g. `hookbill_hop_two` modifies $1076 to
make him grow back after wobbling).

### 4.4 Hookbill-specific SuperFX: shadow / body OAM

`CODE_018D1C` is the full "draw Hookbill" routine, called every
frame by Main (when $1080 != 0/1). It packs ~16 sprite-table
parameters into the SuperFX scratch RAM at `$6000..$6052`:

- $6000 = DATA_018B46 bank byte (sprite tile-info table base)
- $6002 = facing direction ($7402,x)
- $6004 = sprite anim frame ($78,x)
- $6006/$6008 = BG-relative X/Y position
- $600E/$6010 = on-screen X/Y position (BG1Pos + offset)
- $6012..$601E = pointers to 8 DATA_018Bxx tile-info tables
  (animations: walk, crawl, head, shell, etc.)
- $6026, $6028 = `$106A`, `$106C` (per-frame anim offsets)
- $602A, $602C = `$105C`, `$105E` (current frame indices)
- $602E = DATA_018927 (rotation/sin table for tilt)
- $6030 = Hookbill mood/anim state ($701902,x extension)

Then SuperFX routine `FXCODE_08A3BA` reads all of this and
emits the actual OAM tiles + Mode-7 matrix updates + body squashes.

Return values flow back the other way: `$6026/8` -> `$106A/C`,
`$6034..603C` -> `$1064 / $1062 / $1066 / $1068 / $1060` so the
animation state advances.

This is the boss-rendering equivalent of the per-frame Mode-7
approach used by Raphael, and is the most expensive sprite render
in the game (uses ~30 percent of the SuperFX time per frame
during the Hookbill fight).

---

## 5. The boss-closer cinematic (`$01:A248` onwards)

After ANY major boss is defeated, the boss room transitions out via
a single shared sprite: **`!Define_YI_NorSpr0DD_CloseWallInNavalPiranhaRoom`**.
Init at `$01:A248` (trivial RTL), Main at `$01:A2D5`.

The closer is itself a small state machine with 8 entries
(`boss_closer_ptr` at `DATA_01A249`):

```
$00 closer_wait         pause N frames (timer in $78,x; writes $617A/$617C)
$02 closer_camera_1     pan camera step 1 (slides Layer1XPos toward $60B0)
$04 closer_camera_2     pan camera step 2 (advances $701900,x scroll target)
$06 closer_arena        arrived at arena (camera locks to $78,x / $7A36,x)
$08 closer_finish       JML CODE_03A31E (kill sprite)
$0A closer_salvo        spawn map16 "salvo" effect (3 tile-stamp + AmbSpr $1E6)
$0C closer_naval        Naval Piranha-specific (28-byte tile sequence at DATA_01A478)
$0E closer_hookbill     Hookbill-specific (spawns AmbSpr $20C for the rising platform)
```

The closer is driven by a sequence table at `DATA_01A259` (54 words,
indexed by `$18,x`). Each row holds (state, wait, X, Y, dir, etc.)
for ONE step of the cinematic. After the wait expires, the closer
reads the next row, advances `$18,x` by `DATA_01A2CD[state]` (6 or 8
bytes typically), and dispatches via `boss_closer_ptr`.

Different bosses re-use different subsets of the rows: Naval Piranha
gets rows 0-7, Hookbill gets rows 7-13 (with `closer_hookbill` at
the end). Salvo uses the `closer_salvo` state. Raphael bypasses this
system entirely (its death is on-canvas star-formation).

---

## 6. The gamemode `$0F` per-frame dispatcher (Bank01)

Bosses are sprites; sprites are ticked from gamemode `$0F` (the
in-level run-loop). This is the parent dispatcher that makes
boss state machines run each frame.

### 6.1 Entry point: `gm0f_run_level` at `$01:C0D9`

The shell:

```asm
CODE_01C0CE:        ; CALLED FROM gm0f_dispatch
    PHB / PHK / PLB     ; set DB = Bank01
    STZ $35/$36/$37/$38 ; clear input-edge state
CODE_01C0D9:        ; gm0f_run_level
    LDA #$10
    STA $0B83           ; sprite-throttle slot (16)
    STZ $0B84
    LDA !RAM_YI_Level_MessageBoxState  ($000D0F)
    BEQ +
    JSL CODE_01DE5A     ; message-box sub-dispatcher
    JMP CODE_01C16E     ; skip pause check, into main_gamemode_0F
+: LDA !RAM_YI_Level_CurrentPauseScreenState ($000B0F)
    BNE check_pause
    LDA $38
    AND #$10
    BEQ go_main
    ; ... pause-button-edge logic ...
go_main:
    JMP CODE_01CA9B     ; main_pause
check_pause:
    JMP CODE_01C16E     ; main_gamemode_0F path with item handling
```

### 6.2 main_gamemode_0F at `$01:C18B`

This is the per-frame in-level pipeline (after message-box and
pause are handled). Each `JSL` call is one stage of the per-frame
update:

```
JSL CODE_008259      ; ($00:8259) DMA queue flush
JSL CODE_04FD28      ; (Bank04) ?? probably level-flow
JSL CODE_109058      ; (Bank10) per-frame level update
JSL CODE_108C9A      ; (Bank10) per-frame sprite update / spawn
; ... shake-offset application (DATA_01C098 / DATA_01C0A8) ...
JSR.w (DATA_01D916-$01,x)  ; per-tile-mode sub-handler (fuzzy / moving / unused)
JSL CODE_0394D3      ; (Bank03) sprite-state advance
JSL CODE_04FA67      ; (Bank04) player update
JSL CODE_04DD9E      ; (Bank04) player tail
JSL CODE_0397DF      ; (Bank03) sprite list traversal
JSR CODE_01D6B1      ; HDMA-active processing
; animation-palette dispatch via DATA_01C454 (21 entries)
; mosaic ticking via DATA_01C0B8
; star-timer / message-box trigger checks
JSL CODE_109295      ; (Bank10) sprite spawn from list
; ... item dispatch via DATA_01C0ED if item being used ...
RTL
```

The two critical calls for boss ticking are:

- `JSL CODE_0397DF` (Bank03 sprite list traversal) -- iterates active
  sprite slots, calls each sprite's Main handler. THIS is where
  `YI_NorSpr0AE_HookbillTheKoopa_Main` is invoked.
- `JSL CODE_108C9A` (Bank10 sprite spawn / despawn) -- handles slot
  allocation when a sprite enters the screen window (so the boss is
  spawned the first time the camera reaches its position from the
  level data stream).

### 6.3 Sub-dispatchers reached from gamemode 0F

| Address       | Reached when                                       | Purpose |
|---|---|---|
| CODE_01DE5A (`message_box_handler`)  | `$0D0F != 0`             | 7-state message-box state machine |
| CODE_01CA9B (`main_pause`)            | pause button pressed     | 20-state pause/fade machine |
| CODE_01DBD5 (`pause_handle_item_menu`)| inside pause + items     | item-cursor + apply-item handler |
| Sub-handlers per `$0D2D / $0D45 / ...`| Per-frame HDMA effects   | fuzzy (CODE_01D7CD), wavy (CODE_01D81D), sun (CODE_01D86D), cloud (CODE_01D8C6) |
| DATA_01D916                            | Per tile-mode             | (CODE_01DA69 / CODE_01D92C / CODE_01DA98) opt_moving / opt_fuzzied / opt_unused |
| DATA_01C0ED                            | `!RAM_YI_Level_ItemBeingUsed != 0` | dispatch the 9 player-item handlers |
| DATA_01C454 (animation_palette_ptr)    | `!RAM_YI_Level_LevelHeaderAnimationPaletteLo != 0` | dispatch the 21 per-frame palette animations (mechanism in `enginecore.md` §5.6) |

---

## 7. Cross-reference: other bosses (`Bank` -> file)

Each YI boss has the same Init/Main structure (per-sprite state
machine, integrates via NorSpr dispatch + gamemode $0F). The bank in
which each boss lives is recorded in
`yi/Constants/NormalSpriteIDs.asm` (annotated in Phase 3) as
`Init Bank0X:line; Main Bank0X:line`.

| Boss                          | Sprite ID | Init Bank   | Notes |
|---|---|---|---|
| **Hookbill the Koopa**         | `$0AE`    | Bank01:8002 | World 4-8 castle. The canonical -- see above |
| **Background-for-Hookbill**    | `$0D5`    | Bank02:2749 | BG3 platform that paints under Hookbill |
| **Naval Piranha** (mother)     | `$171`    | Bank02:11227| World 3-8 castle. Stalk/plant; closer uses Naval-specific path. |
| **Naval Piranha buds**         | `$172`    | Bank02:13046| Smaller mouths |
| **Naval Piranha vines**        | `$002`    | Bank02:13791| Vines that fight back |
| **Salvo the Slime**            | `$02D`    | Bank06:322  | World 1-8 castle. Separate "eyes" sprite `$02E` + slime-block terrain `$03F`. Init/main use 8-state `salvo_init_state_ptr` / `salvo_main_state_ptr`. |
| **Salvo eyes**                 | `$02E`    | Bank06:2292 | Spawned by Salvo |
| **Slime Block**                | `$03F`    | Bank06:53   | Floor/ceiling tile Salvo oozes onto. Init scans LDB for tile id $0174 + locks slot via $18,x; shares ground/wall probe with Salvo. |
| **Burt the Bashful**           | `$046`    | Bank06:2926 | World 1-4 fort. Pants-falling boss; shares some helpers with Tap-Tap (`init_burt`). |
| **Mini-Burt**                  | `$0E7`    | Bank05:6134 | Spawned from defeated Burt (see `docs/family-misc.md` §14.9). |
| **Nep-Enut / Gargantua Blargg**| `$0A5`    | Bank02:7230 | World 3-3 mid-boss (Nep-Enut underwater variant) / W6 Gargantua. Init captures spawn-tile parity; Main steers home-X (DATA_02BF89) + rise/snap/retreat state machine. |
| **Prince Froggy**              | `$045`    | Bank02:7799 | World 3-4 fort. Yoshi swallowed; fights from stomach. Init snaps Yoshi to PlayerState $0E + spawns interior `$017` Frog Pirate + aligns palette E1<-D1. |
| **Stomach Acid**               | `$13B`    | Bank02:8822 | Prince Froggy hazard. Rising-acid sprite; Init empty (parent seeds), Main hit-tests Yoshi +/-8 px, rises Y-vel $0100, spawns ambient $221 splash on hit. |
| **Marching Milde**             | `$0D2`    | Bank06:5118 | World 4-4 fort. Init spawns sub-sprite via `CODE_03A366`, mirrors pos, loads palette $2A. Main is 8-entry phase JMP on boss-phase word $105C (roll/jump/split/defeat). |
| **Large Milde**                | `$0D3`    | Bank0F:2688 | Marching Milde split product (giant). Init `CODE_03ADD0` alloc + seeds render-scale $0100 in slot tables. Main+StompRt aliased; stomp splits into Medium Mildes (`$0D4`) via shared StompRt. |
| **Medium Milde**               | `$0D4`    | Bank0F:3314 | Marching Milde split product (medium-after-Large-split). Init = bare RTL (parent seeds slot). 4-state inner machine (walk/turn/squash/separate) via DATA_0F9943; further stomp triggers final dissolve. |
| **Blargg**                     | `$194`    | Bank0C:2160 | Lava hazard. 4-state main (submerged/rise/attack/sink); submerged alternates idle/approach via DATA_blargg_substate_ptr; rise plays 14-frame emerge anim via DATA_0C91D2/_0C91E0 + lava-splash sound $48. |
| **Sluggy the Unshaven**        | `$0D7`    | Bank02:8948 | World 5-4 fort. Slime body via GSU dyntile; section 7.3. |
| **Roger / Roger's pot**        | `$034 / $035` | Bank02:545 / 721 | Mini-boss "potted ghost"; full deep-dive in `docs/family-misc.md` §17. |
| **Bigger Boo**                 | `$016`    | Bank04:6876 | World 2-5 fort. 8-state machine; `$7A98` swap palettes. See `docs/family-boos.md`. |
| **Frog Pirate**                | `$017`    | Bank0E:12256 | World 5 mid-boss (large hopping pirate-frog). 21-state pointer table; three main-branches by state. Damage by egg-feed. |
| **Slugger** (yellow baseball)  | `$0F5`    | Bank07:1144 | Mini-boss enemy |
| **Tap-Tap the Red Nose**       | `$03C`    | Bank0F:3705 | World 6-4 fort. Full 18-state machine. Detailed below + `docs/family-taptaps.md`. |
| **Bronze/Silver/Hopping Tap-Tap** | `$109/A/B` | Bank0D:8390/1/2 | Smaller Tap-Tap variants |
| **Raphael the Raven**          | `$00C`    | Bank0F:5575 | World 5-8 castle. Mode-7 rotation for the moon-stomping arena. See section 7.1. |
| **Raphael spark attack**       | `$05A`    | Bank0F:5408 | Star projectiles |
| **Baby Bowser** (claw form)    | `$134`    | Bank0D:8862 | World 6-8 castle (final boss). 39-entry `DATA_baby_bowser_phase_ptrs`. |
| **Bowser-room Kamek**          | `$08E`    | Bank0D:11568| Casts magic during Bowser fight |
| **Bowser fight giant egg**     | `$026`    | Bank0D:13081| The egg you ride to fight Bowser |
| **Bowser fire**                | `$0CE`    | Bank0D:13308| Fire breath projectile |
| **Bowser rocks**               | `$0CF`    | Bank0D:12758| Falling debris |
| **Bowser fight cloud**         | `$083`    | Bank04:11428| BG cloud effect |
| **Kamek (boss-throw form)**    | `$008E`-related | Bank0D:11568 etc. | Several Kamek variants -- see `docs/named_main_labels.txt:555-558,1081,1084` |

### 7.1 Raphael the Raven (Mode-7 boss)

Raphael lives in Bank0F (`init_raphael` / `main_raphael` /
`raphael_init_ptr` / `raphael_main_ptr` -- two-table state machine
like Hookbill, also dispatched via `$76,x` and `$18,x`).

What makes Raphael unique: the **entire arena rotates in Mode-7**
because you fight on top of a spherical moon. The rotation matrix is
set up by two routines IN BANK01 (despite Raphael being in Bank0F),
because gamemode `$0F` calls them on entry to the boss room:

- **`raphael_set_rotation_player_pos`** at `$01:B403` -- updates
  player X to wrap around the moon's circumference (`#$0120` wide,
  fold at `#$0260`), then computes the screen-center / rotation
  angle from the player X position via two multiplies through
  `!REGISTER_Multiplicand / Multiplier`. Computes `$0D05` (rotation
  angle byte 0..$FF), then sets Layer1/Mode7 center to the rotated
  position.
- **`raphael_set_mode7_rotation`** at `$01:B47C` -- looks up
  Mode7 matrix A and B from `DATA_00E954` (cos table) and
  `DATA_00E9D4` (sin table), respectively, using `$0D05 << 1` as the
  index. Writes A/D = cos, B = sin, C = -sin into the Mode-7
  registers.

Together these run every frame of the Raphael fight, transforming
the world into a rotating sphere.

The level-mode 09 ("Raphael / Mode-7 arena") path in Bank01 is
`load_levelmode_09_settings` at `$01:B335`. It's invoked from
`gm0c_level_fadein_and_name` when `!RAM_YI_Level_LevelHeaderLevelModeLo == 9`.
This is the boss-specific level-load path: it sets BG mode to Mode-7,
loads the Raphael palette tables (DATA_5FE3EA, 5FE40A, etc.), sets
window-mask byte, etc.

Level-mode `$0A` (`!RAM_YI_Level_LevelHeaderLevelModeLo == $0A`) is
another special-case loader, calling `CODE_00B4D3 / CODE_00BB90`
instead of the regular palette/VRAM init -- but it is not the Baby
Bowser fight room. It is used by level `$6B` (the Kamek-combat
autoscroll level; `CODE_00B4D3` hardcodes its spriteset
`{$67,$3C,$55,$1A,$1A,$29}`) and by the Bowser-approach rooms
`$DA`/`$DB`. The actual Baby Bowser fight room `$DD` is a plain
header-mode `$00` room with spriteset row `$7B`. Mode `$09`, for
its part, is used only by level `$CB` (the Raphael Mode-7 arena
sub-room; the Raphael sprite itself is placed in `$C4`).

### 7.2 Tap-Tap the Red Nose (Bank0F)

Tap-Tap (Bank0F:3705) has a 17-state machine documented in
`docs/named_main_labels.txt:1296-1315`. It mirrors Hookbill's
two-phase structure: a Kamek intro phase (`tap_tap_intro_kamek/growing/falling/wait`),
then a combat phase (`tap_tap_walking/turning/preparing_jump/jumping/landing/knocked_back`),
then a death phase (`tap_tap_init_egg_hit/falling/hobbling/death_sinking/rising/submerging/explode`).

`tap_tap_ai_pointers` is the equivalent of Hookbill's
`hookbill_state_ptr` -- the per-state dispatch table. Tap-Tap also
re-uses some helper routines (`tap_tap_collision_x_knockback`,
`tap_tap_tongue_x_knockback`, `tap_tap_check_yoshi_dir`).

The same egg-hit counter pattern applies: `tap_tap_init_egg_hit` is
the entry into the death sequence. The walk/turn/jump cycle is the
main combat loop.

### 7.3 Sluggy + Naval Piranha (GSU-dyntile boss family in Bank02)

Both Bank02 bosses share two architectural traits that distinguish them
from the Hookbill canonical template, and are worth pinning here as a
cross-boss synthesis. All concrete state-by-state, table-by-table
details are inline in `yi/Banks/Bank02.asm` (391 `sluggy_*` /
`naval_pir_*` aliases); this section captures only the cross-boss
patterns.

**Pattern 1: GSU-driven body rendering (not Mode-7).** Hookbill is
Mode-7; Sluggy and Naval Piranha both use pure-SuperFX dyntile
rendering with per-segment OAM builders.

- **Sluggy** is broken into 7 segments per frame, each pumped through
  one of two GSU routines: `FXCODE_088619` (vertical body slice) for
  segments 0..3, `FXCODE_088293` (standard dyntile-decode helper) for
  segments 4..6. Per-segment parameters live in 6 parallel 7-entry
  tables at `DATA_02D782 / DATA_02D790 / DATA_02D79E / DATA_02D7AC /
  DATA_02D7BA / DATA_02D7C8` (Bank02.asm:9947-9966). The build loop
  walks them backward in steps of 4 so segment 6 (head) draws last on
  top.
- **Sluggy's** state-1 enlarge cinematic invokes `FXCODE_0A8F57`
  ("body-enlarge with palette ramp") indexed by the body-scale word at
  `$76,x`. The defeat-state fall (state 4) uses `FXCODE_0A90FF`
  ("roll-and-fade body draw"). Two palette gradients drive these:
  `DATA_02D109` (enlarge ramp) and `DATA_02D129` (fall ramp).
- **Naval Piranha** drives body OAM through `FXCODE_08A062` per frame
  with GSU scratch reg inputs pumped from the boss slot's WRAM words
  (see `CODE_naval_pir_body_oam_setup`, Bank02.asm:11721-11737).

The pure-GSU approach is more flexible than Mode-7 (arbitrary body
shapes, per-segment palette swaps) but more expensive per frame --
which is why these bosses ship with reduced background detail.

**Pattern 2: Multi-slot orchestration via global linker words.** The
Hookbill convention is "one boss = one slot." Sluggy generalises this
to "one boss + one transient Kamek (ambient sprite $0048)" -- still
boss-driven but with a scripted helper. Naval Piranha pushes the
pattern hardest: "one boss + 2 buds + 2 vines + 1 chompable child
piranha plant," coordinated by **four global WRAM words**:

| Word    | Purpose |
|---------|---------|
| `$1072` | **Boss-slot pointer.** Buds and vines read this every frame to find their parent. |
| `$1076` | **Bud 0 slot index.** Seeded in `CODE_naval_pir_spawn_buds_and_vines`. |
| `$1078` | **Bud 1 slot index.** Same. |
| `$108A` | **Child Piranha Plant ($066) slot index.** The chompable graphic that triggers the real intro cinematic when Yoshi eats it. |

The "bud spawn-list chain" is 2-slot **fixed**: `$1076` always holds
bud 0's slot, `$1078` always holds bud 1's, even when only one bud is
active. Inactive slots have `$7019D6 == 0` (bud sub-state byte) as the
idle marker. The chain is read by the boss state machine, by bud Main
(buds read `$1072` to sync animation), and by vine Main (vines also
read `$1072`, then chain through their `$701978` field to find the
paired bud).

A separate pair `$107C / $107E` caches each bud's `$7019D6` at the
moment of an egg-hit, so state $1E (`naval_pir_state_bud_second_wave`)
can restore them. Bud spawning is bottlenecked through
`CODE_naval_pir_spawn_buds_and_vines` (Bank02.asm:12398) to keep the
chain consistent. Bud Init is a no-op precisely because the parent
populates every field at spawn time.

**Vine-depth threshold dispatch.** Vines don't run on their own state
machine alone -- they sample the boss's "stalk depth" word
`$7019D6,$1072` every frame and pick behaviour based on the global
depth (`DATA_naval_pir_vine_state_ptr` at Bank02.asm:14593-14615):

| boss `$7019D6` | vine response                                                |
|---|---|
| `$00..$1B`     | **Retract**: reload `$7542` from `$78,x`, zero X/Y velocity  |
| `$1F` + both buds idle | **Wait at perch**: Y-vel = $0000                       |
| `$20..`        | **Extend**: pick Y-vel from `naval_pir_vine_yvel_selector` by Y delta |

This synchronises all vines with the bud spawn cycle without each vine
needing its own copy of the bud-cap counter. The chain pattern is
reusable -- any future boss that needs paired spawned children can use
a similar list of global words.

**Defeat exit convention.** Both bosses follow the universal
boss-closer hand-off via `CODE_03A32E`. Sluggy state $04 (`fall`) and
Naval Piranha state $25 (`defeat_finish`) are the only state handlers
in either machine that `PLA` the Main return address and `JML` to the
closer. This matches Hookbill's defeat-exit pattern and is the
canonical "boss done, hand off to closer" idiom.

---

## 8. Source-of-truth notes

- **`$76,x`** is the canonical "main combat state" address for
  Hookbill, Salvo (mostly), Burt, Marching Milde, and the closer.
- **`$18,x`** is the canonical "init state" address for Hookbill.
  Some bosses (Raphael, Tap-Tap) use `$18,x` instead of `$76,x` for
  combat state -- look at the per-boss Main routine's dispatch line
  to confirm.
- **`$16,x`** is a "sub-state counter" used by hand-rolled per-state
  logic (countdown, animation phase).
- Boss-room cinematic flag: `$1080`. When `>= 2`, combat is live;
  when `0`, the boss is invisible; when `1`, the Kamek-growing intro
  is mid-animation.
- **Egg-hit counter** (Hookbill): `$107C`, `$107E` (increment by 2,
  3rd hit = $06).
- **Player invincibility** (after boss bounce): `$7AF6,x` =
  countdown, set by hit handler.
- **Shake**: `DATA_01C098` (small) / `DATA_01C0A8` (large) tables.
  `$61C6` / `$61C8` are the X / Y shake-timer countdowns. A boss
  triggers a shake by writing a count to those locations and letting
  gamemode `$0F` apply the offset table.

---

## 9. Cross-references

- `docs/enginecore.md` -- game-mode dispatcher (69 modes), NMI/IRQ flow,
  fade modes; covers gamemode-index meanings consumed by boss code.
- `docs/leveldataengine.md` section 1, 3 -- how the level pointer table
  and sprite-spawn list cause a boss sprite to be allocated when the
  camera reaches its position.
- `docs/spritestateengine.md` -- the lower-layer per-sprite state engine
  in Bank03 (sprite_inits/mains/head_bops/sprite_ridings tables) that
  every boss layers its own state machine on top of.
- `yoshisisland-disassembly/disassembly/bank01.asm` -- the most-named
  source for boss code.
- `yoshisisland-disassembly/docs/named_main_labels.txt:148-244` -- Hookbill
  label index. Lines 1294-1315 -- Tap-Tap. Lines 1320-1353 -- Raphael.
- See also:
  - `ys_play.asm` -- player-state transitions invoked by boss handlers
    (e.g. the bounce-off-head response, the egg-hit recoil).
  - `ys_game.asm` -- gamemode-state dispatcher structure (mirrors the
    framework's gm$0F per-frame in-level pipeline).
  - `ys_boss1.asm`, `ys_boss2.asm` -- boss state-machine handlers
    (parallel structures to Hookbill's `$76,x` / `$18,x` dispatch).
  - `ys_bbbros.asm` -- Baby Bowser / final boss handler reference.
  - `ys_koopa.asm` -- Hookbill ("Koopa") state-machine reference.
  - `ys_dorobo.asm` -- thief / mini-boss handler reference.

---

## 10. Open questions

1. **Hookbill state $5E PLA/RTL trick** — **RESOLVED 2026-05-25.** Confirmed and sharpened. The `PLA/RTL` is on the **transition-frame branch only** (`CODE_019ED2` at `Bank01.asm:3624-3674`) — the branch that does `INC $1080` (line 3633) promoting the boss from phase 1 to phase ≥2. The other state-$5E exit path (`CODE_019ED1` at line 3622, still ticking the crouch animation) uses a normal `RTS`, so the trick is scoped exactly to the transition frame. The conflict it solves: the dispatcher in `main_hookbill` (`Bank01.asm:759`) calls each state via `JSR.w (DATA_hookbill_state_ptr,x)`, then lines 760-768 run 5 post-state routines (`CODE_0191BB` collision, `CODE_01922A` hit detection, `CODE_018A95` SuperFX draw selector, `CODE_01924D` palette mirror, `CODE_0192DA` camera/X clamp) — gated on `$1080 >= 2`. State $5E itself does `INC $1080` inside this branch, so without the PLA/RTL the just-incremented value would pass the gate and fire all 5 against a slot that has just been heavily re-initialised for the shell phase (Mode-7 OAM extension words, four matrix-setup JSRs, slot Y nudged, etc.). Running collision + draw + palette + camera against that half-built transitional state would corrupt the freshly-prepared Mode-7 sprite or register spurious collisions. `PLA` discards the dispatcher's return address; `RTL` returns directly to `main_hookbill`'s `JSL` caller, bypassing the entire post-JSR tail.

2. **Hookbill states $00 and $14** — **RESOLVED 2026-05-25.** Both states are **LIVE**, not vestigial. The doc note was wrong.
   - **State $00 (`CODE_hookbill_start_crawl`)** is the canonical reset destination of state $02 (`CODE_hookbill_crawl_forward`). At `Bank01.asm:1779`, after the three crawl timers all expire, the handler does `STZ.b $76,x` (writing $00) and `RTS` — putting Hookbill back into `start_crawl` to re-seed the next crawl cycle. So state $00 is the loop entry, not a dead slot.
   - **State $14 (`CODE_hookbill_stand_up`)** is reached by sequential `INC.b $76,x` from state $12 (`CODE_hookbill_stare_forward`, "looking at player" hold). Because Main dispatches in M=16 mode (`LDA.b $76,x; ASL; TAX`), `INC.b` advances the state by 2: state $12 → $14. State $14's handler (which serves both entries $10 and $14 — intentional code reuse) waits on `$7A36,x` then `INC.b $76,x` again, advancing to state $16 (`CODE_hookbill_walk_forward`). So $14 is a deliberate one-frame post-stare wait reusing the same wait+INC primitive as state $10.

   The handler-aliasing in the dispatch table (`stand_up` at $10 and $14, `start_crawl` at $00) is intentional code reuse for transition glue, not a vestige.

3. **`$1015` — Kamek spell handshake** — **RESOLVED 2026-05-25.** Not a frame counter. `$1015` is a 16-bit **bidirectional handshake signal** between boss state machines and the CutsceneKamek sprite (`$048`, dispatched from `Bank0C:11905` via `DATA_cutscene_kamek_state_ptr`). 4-state protocol:
   1. **Boss prep** writes a positive seed (`INC $1015` or `STA #$0001`) before the Kamek cutscene is scheduled. Sites: Hookbill state $56 (`hookbill_begin_koopa_walking`, `Bank01:3347`), Baby Bowser phase $0E (`Bank0D:9697` after spawning sprite $48), Sluggy pre-enlarge (`Bank02:9387`), Tap-Tap intro (`Bank0F:4043`).
   2. **CutsceneKamek** state $00 (`Bank0C:11927`) reads `$1015` with `BEQ` — wakes only when signaled. State $0D writes `LDA #$FFFF / STA $1015` (`Bank0C:12856`) once the magic-throw animation completes.
   3. **Boss "wait for Kamek"** state reads `$1015` with `BPL`, idles while positive; when it goes negative (`$FFFF`), does `STZ $1015 / INC $76,x` to consume and advance. Sites: `hookbill_begin_kamek` (`Bank01:3373-3375`), Baby Bowser phase $0F (`Bank0D:9706-9707`), etc.
   4. **CutsceneKamek** state $0E (`Bank0C:12872`) reads with `BEQ` — waits for boss to zero the signal before despawning.

   The Bank01:3334 comment "Kamek-magic completed counter" is misleading — it's not a counter at all, it's a 4-state token where the sign bit is the "spell done" flag and zero is "channel idle." **Proposed name:** `!RAM_YI_Level_KamekSpellHandshake = $001015` (free slot in `WRAM_RuntimeEffects.asm`).

4. **Hookbill vs boss-closer table stride** — **RESOLVED 2026-05-25.** Both Hookbill's `DATA_hookbill_state_ptr` (`Bank01:651`) and the closer's `DATA_boss_closer_ptr` (`Bank01:4094`) are **flat 2-byte `dw` jump tables**. The 6-byte stride alluded to in the question refers not to the pointer table itself but to the **parallel parameter-row table** `DATA_01A259` (`Bank01:4105`), indexed in lockstep with the dispatch. `DATA_01A2CD` (`Bank01:4115`) holds the per-state stride array `$06,$06,$0A,$08,$04,$0A,$0A,$06` — each closer state advances `$18,x` by a different amount, enabling variable-width script rows.

   The design difference: Hookbill's handlers are per-frame state functions with a uniform calling convention (just be a function reading `$7Axx,x` scratch), so a 2-byte/entry table is sufficient and minimal. The closer is a **cinematic script** where each beat needs different parameter data (wait-N-frames vs camera pan vs arena clamp), so a variable parallel-row encoding is cheaper than fixed-width rows that would either waste bytes or overflow. Sentinel: `$701902,x` marks end-of-script; on match the closer JMLs to `CODE_03A31E` (kill self).

5. **`$107E / $107C` boss-hit pair** — **RESOLVED 2026-05-25.** Hypothesis confirmed, with a refinement. `$107C` is the **cumulative** ground-pound hit counter (advances 0 → 2 → 4 → 6 = defeat). `$107E` is a **one-shot latch snapshot** of `$107C` taken at the moment Hookbill becomes grounded and vulnerable — not a static "expected hits" threshold.

   Mechanism:
   - **Setup** at `Bank01.asm:3190-3191`: `LDY $107C ; STY $107E` arms the comparator when the body-out phase opens.
   - **Hit gate** at `CODE_018EE7` (`Bank01.asm:1184-1201`): egg-collision path does `LDY $107E ; CPY $107C ; BNE skip`. Only when `$107C` still matches the snapshot does the hit register. On a registered hit, `INC $107C` runs twice (advance by 2); `CPY #$06 BNE` triggers the defeat path on the third accepted body-pound.

   `$107E` is NOT incremented in the hit path — so the next collision check fails (unequal) until Hookbill re-arms by becoming grounded again. The pair acts as a **one-shot-per-phase latch** preventing a single body-pound from registering as multiple egg hits while Hookbill is still grounded and the egg lingers in the hitbox. The Bank02/Bank06 occurrences of these addresses are unrelated (Naval Piranha bud cache, VRAM/DMA scratch). **Proposed names:** `$107C` → `hookbill_bodypound_hits`, `$107E` → `hookbill_bodypound_hits_at_phase_start`.

6. **Naval Piranha phase-RNG ordering (`$1086`, seeds at `DATA_02E8FF`)** — **RESOLVED 2026-05-26.** The seed order is meaningful: it encodes a per-HP-tier attack-mix bias, not three "random-looking" patterns. Decode requires noting that the runtime-indexed table is `DATA_02E8FD` (Bank02.asm:12118), one word earlier than `DATA_02E8FF` (Bank02.asm:12125) — `DATA_02E8FD` holds `$FF80, $6D65, $D8ED, $62D9` (with `$FF80` aliased as `naval_pir_init_phase_bias`). The boss-egg-collision path at Bank02.asm:11946-11953 loads `DATA_02E8FD + (($1082 - 1) << 1)` then `DEC $1082`, so with `$1082` initialised to `$0003` (Bank02.asm:11548) the reseed sequence is: hit 1 → `$D8ED`, hit 2 → `$6D65`, hit 3 → `$FF80` (but the defeat branch skips RNG so this is never consumed). The Phase 1 seed is `$62D9`, hardcoded in `naval_pir_intro_commit` at Bank02.asm:12390.

   State $00's dispatch (Bank02.asm:12175-12243) consumes 2 bits per attack cycle via two `SEC/ROR` pairs (LSB first). Mapping `(bit0, bit1) -> $76,x`: `(0,0)` → $0C `watch_buds` (cooldown), `(0,1)` → $07 `retract_near` (tongue lunge), `(1,0)` → $15 (bud-spawn RIGHT), `(1,1)` → $0D (bud-spawn LEFT). [Note: the inline asm comments at Bank02.asm:12133-12136 and 12185 invert the bit-1 polarity — the BCS at Bank02.asm:12184 means bit-1 = 1 keeps the just-loaded `$0D` LEFT and bit-1 = 0 falls through to override with `$15` RIGHT. Worth fixing in a future asm-comment cleanup.] After all 16 bits are consumed `$1086 = $FFFF` (each rotation shifts a `1` in at the top from SEC), and the next state-$00 entry triggers a reseed via the cooling/idle branch at Bank02.asm:12167-12169.

   Decoding the three seeds into their 8 attack-cycle sequence (counts of {watch, lunge, RIGHT-bud, LEFT-bud}):
   - Phase 1 (`$62D9` = `0110 0010 1101 1001`): 1, 3, 3, 1 — balanced opener.
   - Phase 2 (`$D8ED` = `1101 1000 1110 1101`): 1, 2, 2, 3 — more bud-spawns, slightly LEFT-leaning.
   - Phase 3 (`$6D65` = `0110 1101 0110 0101`): 0, 2, 5, 1 — heavy bud-RIGHT pressure (no cooldown frames at all).

   The escalation is unambiguous: Phase 1 mixes all four action types; Phase 2 trades cooldowns for bud-spawns; Phase 3 eliminates cooldowns entirely and front-loads the right-side bud emergence pattern. The bit patterns themselves all have ~8 set bits (so it's not the popcount that varies), but the *arrangement* of `(1,0)` pairs vs other pairs shifts the attack-action histogram across the three HP tiers. This is hand-tuned difficulty ramping disguised as a one-byte RNG, not random data.

7. **Naval Piranha bud sub-state `$0E` (`bud_state_anchored`) world-space anchoring** — **RESOLVED 2026-05-26.** Not "snapshotting world position" — `$0E` is a **physics-cancelling freeze**. The mechanism uses the engine's standard per-frame sprite-velocity-delta cache. The earlier framing ("snapshots world-space position relative to the camera") was wrong.

   **What `$72C0,x` / `$72C2,x` are.** Every-sprite scratch words holding the X / Y *delta this frame* applied to `$70E2,x` / `$7182,x` by the generic physics tick. Written by `CODE_03B6D9` (Bank03.asm:7479 stores Y delta, Bank03.asm:7508 stores X delta) just before the matching position update; the value is the high byte of `XSpeedLo` / `YSpeedLo` plus a one-bit carry-propagation step. So `pos_new = pos_prev + delta` and `$72C0,x = delta_x`, `$72C2,x = delta_y`. Other sprites that need to ride or compensate for this delta consume it the same frame — Bank04.asm:5414-5463 (moving platforms re-anchor the player after the platform moves) and Bank05.asm:3271-3287 (Chain Chomp scroll-compensates its world-anchor cache) document the canonical usage in inline comments.

   **What state `$0E` does with that delta.** Bud Main at Bank02.asm:13851 dispatches the per-state handler (noop for $0E); then Bank02.asm:13853-13863 checks `$76,x == $0E` and, if so, subtracts `$72C0,x` from `$70E2,x` and `$72C2,x` from `$7182,x`. That undoes the exact delta the engine's physics tick (`JSL CODE_03AF23` at Bank02.asm:13846) just applied — so the bud's *world position is frozen for this frame* while its velocity slot retains whatever value it had at $0E entry. Animation still ticks (the boss's `$7042` byte is copied into the bud at Bank02.asm:13843-13845 every frame). The bud appears stationary in world space; if a later handler ever overrides `$76,x`, the retained velocity immediately takes effect again.

   **When buds enter `$0E`.** Only via the `idle_at_boss` $0D→$0E transition at Bank02.asm:14225-14238: state $0D's `$7402,x` decrement underflows from 0 to $FFFF (BPL fails), the handler resets bud Y to `$1074 + $0010`, zeros YSpeed, and runs `INC $76,x` to $0E. Once in $0E nothing in the bud's own state machine advances it — no `INC $76,x` is reachable from the $0E noop. The boss writes new sub-states to buds' `$7019D6,y` (the vine-visible state), never to bud `$76,x` directly. So the bud stays in $0E persistently — anchored mid-air in front of the boss — until it goes off-screen (despawn JSL at Bank02.asm:13935) or the boss is defeated and the slot is reclaimed. The state is the bud's "hang in place after the LEFT/RIGHT spawn cycle" rest pose; the trick keeps the slot's velocity intact (cheap) without zeroing it on entry (which would cost two extra `STZ`s every frame the bud was anchored).
