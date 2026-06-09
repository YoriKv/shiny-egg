# YI Kamek family reference

Standalone reference for the Yoshi's Island Kamek-the-Magikoopa sprite
family and the shared boss-arena cinematic VFX vocabulary that
accompanies him. Unlike most enemies, Kamek is not a single sprite --
he is a *family* of cinematic and combat variants used across the
game, each tailored to a different theater of action: a flying boss-
foreshadow herald, a leftward-launching "OH MY!" cutscene actor, a
mid-level shell-grower that doubles as the ending-cinematic flyer, and
an in-level combat Kamek who fires magic-shot projectiles in volleys.
The same arenas in which these Kameks appear also use three dedicated
"boss-arena VFX" sprites -- a defeated-boss explosion, the giant key
that drops afterward, and (in Raphael's arena) a spark-burst attack --
all of which share certain low-level conventions (palette-cycle tables,
state-handoff to game-modes, 2048-tick countdowns) with the Kamek
cinematic engine.

This doc complements:

- `docs/bossengine.md` -- the cross-boss state-machine reference.
  In particular §10 Q3 documents the `$1015` 4-state spell-done
  handshake between every boss state machine and the CutsceneKamek
  `$048` sprite that this doc covers; §5 documents `$08E
  BowserRoomKamek` (an in-fight Kamek variant which lives entirely
  inside the Baby Bowser combat loop, so it lives there not here);
  §7.3 explains how `$105C` / `$105E` link Kamek-style boss-helper
  slots to their host boss.
- `docs/family-bowserfight.md` -- the Baby Bowser fight cluster.
  $08E BowserRoomKamek is documented there; this doc references it
  only for cross-comparison.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`, etc.) that runs each Kamek variant's Main body
  every frame.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank0C.asm` (Cutscene Kamek + Magic-Shooting Kamek + Magic
Shot), `yi/Banks/Bank03.asm` (Attacking/Ending Kamek), `yi/Banks/
Bank02.asm` (Boss Explosion + Key-from-Boss), `yi/Banks/Bank0F.asm`
(Raphael Spark Attack), and `yi/Routines/ROUTINE_YI_NorSpr053_
KamekSayingOhMy.asm` (a dedicated bank-agnostic routine file emitted
into bank 00 for V1.0 and bank 0F for V1.1). Cross-verified against
Raidenthequick's descriptive labels (`init_cutscene_kamek`,
`init_kamek_OH_MY`, `init_kamek_shoots_magic`, `init_kamek_magic`,
`init_kamek`, `init_boss_explosion`, `init_boss_key`,
`init_raph_spark`) and the parallel sources `ys_bbbros.asm`
(Kamek / boss-brother attack sprites) and `ys_boss2.asm` (boss
arenas).

---

## 1. Family at a glance

Eight sprites belong to (or directly accompany) the Kamek family.
The four Kamek-shaped sprites are all the same Magikoopa actor reused
in four different theaters of action; the projectile child and three
boss-arena VFX share the cinematic vocabulary.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$048` | `CutsceneKamek` | 0C | `$0C:DB06` `init_cutscene_kamek` | `$0C:DB6C` `main_cutscene_kamek` | shared stub | Boss-foreshadow flying-in Kamek. 15-state cinematic that freezes Yoshi, lands, talks (msgbox), casts a two-burst magic-color spell on the boss arena, then flies off. Drives the `$1015` boss handshake and consults `DATA_kamek_spell_color1_per_boss`, `DATA_kamek_spell_color2_per_boss`, `DATA_boss_music_per_battle`. |
| `$053` | `KamekSayingOhMy` | 00 (V1.0) / 0F (V1.1) | bare `RTL` | 4-state state machine | shared stub | Dedicated `ROUTINE_YI_NorSpr053_KamekSayingOhMy.asm` file emitted at `$00:85DC` (V1.0). Pins camera, blinks/talks, on talk-frame 4 queues `SoundID5B_KamekTalk` and message-box `$82`, then launches leftward and despawns at the right margin. |
| `$125` | `AttackingAndEndingKamek` | 03 | `$03:E3B7` `init_kamek` | `$03:E409` `main_kamek` | shared stub | Dual-personality sprite: spawns as either the **chasing** Kamek (a mid-level shell-grower) or the **ending-cinematic** Kamek. Init disambiguates from X-low-nibble bit 4, stashes the variant in `$701900,x`, then `JMP (DATA_kamek_init_ptr,x)`; Main does the same `JMP (DATA_kamek_main_ptr,x)`. The ending variant runs a 9-state phase machine; the chasing variant runs a 4-state phase machine. |
| `$1AD` | `MagicShootingKamek` | 0C | `$0C:C369` `init_kamek_shoots_magic` | `$0C:C39B` `main_kamek_shoots_magic` | bare `RTL` (immortal) | In-level combat Kamek who appears at a random screen-X (picked via SuperFX `FXCODE_0AE921`), fires 6-shot volleys of `$1AE MagicShot` projectiles, and vanishes. 6-state machine (target / appear / cast / shoot / vanish / despawn). |
| `$1AE` | `MagicShot` | 0C | `$0C:C796` (bare RTL) | `$0C:C797` `main_kamek_magic` | shared stub | Magic projectile spawned by `$1AD`. 2-state main (travel / explode). On spawn computes velocity from cast-position to Yoshi via SuperFX `FXCODE_09907C`; on Map16-hit transforms a tile and spawns one of three "enemy from a tile" sprites picked from `DATA_0CC83C` (Flying Fang / Milde / Shy Guy). |
| `$013` | `BossExplosion` | 02 | `$02:DF55` `init_boss_explosion` | `$02:DF7A` `main_boss_explosion` | -- | White-flash + pop VFX when a boss reaches 0 HP. Init plays `SoundID74_BossExplosion`, arms a 2048-tick (`$0800`) countdown at `$7A38,x`. Main cycles colours from a 4-entry palette table `DATA_02DF68`, runs the flash for `$0140` then `$00C0` then `$0000` frames, then hands off to game-mode `$31` (boss-defeated). |
| `$014` | `KeyFromBoss` | 02 | `$02:D9B8` `init_boss_key` | `$02:DA0E` (no descriptive alias) | -- | Giant key dropped after a fortress boss dies. Init disables Yoshi input by setting `PlayerState1A_DisableInput`, locks the camera (sets `$0C1E = 1`, `$0C20 = 1`), and warps the key sprite to Yoshi-X / Yoshi-Y - $0028. Main runs the 5-state `DATA_key_from_boss_state_ptr` cinematic (emerge -> drift -> glow -> pre-keyhole -> insert-and-clear-level). |
| `$05A` | `RaphaelSparkAttack` | 0F | `$0F:ABE5` bare `RTL` | `$0F:ABE5` `main_raph_spark` | shared stub | Raphael the Raven's spark projectiles. Spawned in volleys of 3 by `CODE_raphael_spawn_spark_volley` (Bank0F:5573). Init = bare RTL; Main animates flicker via `DATA_0FABDC` (9-byte frame table terminated by `$FF`) and walks radius via `DATA_0FABD8` (+3 / -3 stride). Despawns when DATA_0FABDC hits the `$FF` sentinel. |

Cross-referenced only (deep documentation lives in
`docs/bossengine.md` / `docs/family-bowserfight.md`):

| Sprite ID | Constant name | Bank | See |
|-----------|---------------|------|-----|
| `$08E` | `BowserRoomKamek` | 0D | `docs/family-bowserfight.md` §3 (table), `docs/bossengine.md` §5 -- the Kamek in the Baby Bowser room who casts the small-to-giant transformation spell. Uses the same `$1015` handshake from a different code path. |
| `$00DD` | `CloseWallInNavalPiranhaRoom` | 02 | `docs/family-piranhas.md` cross-ref + `docs/bossengine.md` §7.3 -- the post-boss wall closer that runs *after* a Kamek-style boss VFX sequence. |
| `$00D5` | `BackgroundForHookbillFight` | 01 | `docs/bossengine.md` §2 -- the BG decoration sprite for the Hookbill arena where CutsceneKamek $048 first lands. |

The four Kamek-shaped sprites have non-overlapping appearance
contexts:

- **$048 CutsceneKamek** is invisible at level start; it is awakened
  by every boss's "begin Kamek intro" state once the boss has loaded
  its arena assets. One $048 per level, spawned mid-game.
- **$053 KamekSayingOhMy** is a level-data sprite -- placed by the
  designer in specific cutscene rooms (mainly the world-map approach
  to Bowser's castle and select pre-boss vignettes). Self-contained
  4-state body, never interacts with other Kameks.
- **$125 AttackingAndEndingKamek** is the level-data Kamek used both
  by mid-level "Kamek grows the egg-yoshi-bandit-shell" cinematic
  triggers and by the ending sequence. Same sprite ID, behavior
  picked from a placement-position bit.
- **$1AD MagicShootingKamek** is the only Kamek that the player
  fights as an enemy. Appears in "Kamek's Revenge" (the world-5
  bonus) and the W6 Magic Kamek room. Immortal (head-bop is a bare
  RTL).

---

## 2. Kamek variant catalog

A side-by-side comparison of which engine each Kamek uses, which
shared resources it consults, and which gameplay invariants it
respects.

| Trait | $048 CutsceneKamek | $053 KamekSayingOhMy | $125 AttackingAndEndingKamek | $1AD MagicShootingKamek |
|-------|--------------------|----------------------|------------------------------|-------------------------|
| **Engine** | 15-state ptr `DATA_cutscene_kamek_state_ptr` (`$0C:DB79`) dispatched by `JMP ($DATA,x)`; state byte at `$16,x`. | 4-state ptr `DATA_kamek_oh_my_state_table` (`$00:85DD`) dispatched by `JSR ($DATA,x)`; state byte at `$76,x`. | Dual-table dispatch: `DATA_kamek_init_ptr` (2 entries) at init, `DATA_kamek_main_ptr` (2 entries) at main; each variant has its own sub-machine -- 9-state ending (`DATA_kamek_ending_state_ptr`) or 4-state chasing (`DATA_kamek_chasing_state_ptr`). | 6-state ptr `DATA_kamek_shoots_magic_state_ptr` (`$0C:C3AE`); state byte at `$18,x`. |
| **Freezes Yoshi?** | YES -- writes `$0001` to `!EXRAM_YI_Level_FreezeYoshiFlagLo` every frame while Main is running (cleared in state $0D). | YES -- forces `$0C1E = 1` (auto-scroll-X active) every frame so camera locks while talking. | The ending variant freezes player input via state $E (sets `$74A2 = $FF` on linked boss slot and `$7042` color-math bits); the chasing variant doesn't (it just flies past). | NO -- player remains active during the magic-shot encounter. |
| **Fires Magic Shots?** | NO. Casts a *visual* SuperFX spell on the boss arena (FXCODE_08EDAC + DMA queue + HDMA tables) but no projectile sprite spawns. | NO. | NO. | YES -- in state $03 (shoot) iterates a 6-shot sequence via `$19,x` walking down `DATA_0CC466` (frame table) and `DATA_0CC46D` (per-shot frame-duration table). Each shot calls `JSL CODE_spawn_sprite_active` with sprite-ID `$01AE`. |
| **Per-boss tables consulted** | `DATA_kamek_spell_color1_per_boss` (`$0C:DACA`, 12 BGR15 entries), `DATA_kamek_spell_color2_per_boss` (`$0C:DAE2`, 12 BGR15 entries), `DATA_boss_music_per_battle` (`$0C:DAFA`, 12 bytes -- $0A or $0C). Indexed by current world from `!RAM_YI_Level_CurrentWorldLo` ORed with low nibble bit 4 of X (state byte at $76,x doubles as table index). | None. The cinematic is generic and doesn't vary per-boss. | None directly; the chasing variant gates one branch on `!Define_YI_LevelID_KameksRevenge` for a palette/sound tweak. | None directly; the magic-shot child consults `DATA_0CC83C` (3 entries: Flying Fang / Milde / Shy Guy) for the tile-transform spawn. |
| **Speed / despawn convention** | Initial XSpeed `$FE00` (left); ramps to `$0800` ceiling. Despawns via `JML CODE_despawn_sprite_free_slot` after writing music value from `DATA_boss_music_per_battle`. | Initial XSpeed `$FC00` (left), accel `$0040`, ceiling `$0400`. Despawns via tail-call `JML CODE_03A31E` at screen-right margin `$0140`. | Ending variant: XSpeed accel `$F800` / `$0800`, YSpeed `$FF00` arc on cast; chasing variant: XSpeed `$FE00` then `$0480` for fly-out. Despawn handled by the phase-10 cleanup in the ending variant; the chasing variant cycles indefinitely (re-enters phase 0 after fly-out). | XSpeed = 0 (Kamek teleports in / out, no horizontal travel). Despawn happens in the despawn state ($05) which clears `$77C0,x` and returns to state $00 with a 256-frame cooldown ($16,x = $100). |

### 2.1 Why the $125 dual-personality?

The Init at `$03:E3B7` reads bit 4 of the sprite's X-position low
byte, shifts it down 3 bits (so bit 4 -> bit 1), and adds 1:

```
init_kamek:
    LDY !EXRAM_YI_Level_NorSpr_GenericTable701900,x
    BNE .already_set
    SEP #$20
    LDA $70E2,x       ; X-position low byte
    AND #$10          ; isolate bit 4
    LSR : LSR : LSR   ; bit 4 -> bit 1 -> { 0, 2 }
    INC               ; -> { 1, 2 }
    STA !EXRAM_...$701900,x
    TAY
    REP #$20
.already_set:
    DEY              ; -> { 0, 1 }
    TYX              ; -> table index
    JMP (DATA_kamek_init_ptr,x)
```

This is the same "level-data X-position bit-encodes a variant" trick
used by `init_bandit_under_cover` ($0A3 / $0A4) -- see
`docs/family-bandits.md` §5 Pattern A -- but here packed into a single
sprite ID instead of two. The two variants get fully different state
machines but share the head-bop stub and the OAM render priority
($7042 color-math swap on first visit). The Init writes the resolved
variant index into the EXRAM table at `$701900,x` so subsequent
frames (Main is called every frame) avoid recomputing.

### 2.2 The CutsceneKamek $048 state machine in detail

15 states; the first three are setup, states $04..$0A are the talk/
cast sequence, and states $0B..$0E are cleanup. The state byte at
`$16,x` is incremented by 2 each transition (because each state slot
is a word in the dispatch table). Init's variant index (the
boss-music / spell-color table index) lives in `$76,x`.

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CDB97` | **Wait.** Polls `$1015` (the spell-done handshake). On `BNE`, checks if this is a first visit (`!RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo == 0`); if yes, advances to state $02. If `$60C6` or `$60C0` are set (boss prep flags), skips to state $0E (return-RTL). |
| `$02` | `CODE_0CDBD7` | **Fly-in.** Writes `$0001` to `FreezeYoshiFlagLo`, places Kamek at `(CameraX + $0130, CameraY + $0040)` -- off-screen right. Sets XSpeed `$FE00`, animation frame 0, palette `$05`. Advances to state $04. |
| `$04` | `CODE_0CDC1B` | **Approach hover.** Drifts left, blinks animation frame between $00 and $01 every 4 frames (the "Kamek's broom" mid-flight idle). When screen-space X reaches `< $00F4`, halts X-velocity, sets state-frame timer `$18,x = $13` (= 20 = pose count), advances to state $06. |
| `$06` | `CODE_0CDC99` | **Mouth-flap / talk.** Walks `$18,x` from 19 down to 0, indexing `DATA_0CDC71` (anim-frame table) and `DATA_0CDC85` (per-pose-duration alternating $02/$06). On every 8th pose (`AND #$0007 == $0007`), pushes `SoundID5B_KamekTalk` onto the sound queue. On `$18,x` hitting -1, advances to state $08 and triggers msgbox: writes `DATA_0CDA5E[variant]` to `$704070` (the msgbox ID -- one of `$0026,$0024,$0050,$0051,$0080,$0081,...`) and `INC !RAM_YI_Level_MessageBoxState`. |
| `$08` | `CODE_0CDCE8` | **Await msgbox dismiss.** Polls `MessageBoxState`; on zero, palette `$0000`->$0948 round-trip, XSpeed `$FE00`, sets `$18,x = 5` (turn-anim pose count), starts 4-frame timer, advances to state $0A. |
| `$0A` | `CODE_0CDD31` | **Turn-around.** Walks `$18,x` from 5 down, indexing `DATA_0CDD25` (turn-anim frames) and `DATA_0CDD2B` (per-frame facing toggle XOR). On the frame where DATA_0CDD2B is non-zero, EORs `$7400,x` (facing) and negates XSpeed (so Kamek turns and walks the other way). On `$18,x = -1`, advances to state $0C. |
| `$0C` | `CODE_0CDD7B` | **Fly back out.** Drifts right with blink-anim toggle, when screen-X >= `$0150`, advances to state $0E. |
| `$0E` | `CODE_0CDDA5` | **Cast spell 1.** Sets up the first SuperFX magic-effect render. Repositions Kamek at `(CameraX + $0130, CameraY + $0040)` (back to off-screen right), arms a massive HDMA window-mask block via `DATA_0CDB54..DATA_0CDB6B`, fills `$7E5A18` with `DATA_0CDA8E[variant]` ($58 bytes of color), and writes `DATA_kamek_spell_color1_per_boss[variant]` (the BGR15 colour of this boss's first spell) into the SuperFX general-purpose registers as `FXCODE_08EDAC`'s color argument. Plays `SoundID18_CoinSpillage`. Advances to state $10. |
| `$10` | `CODE_0CDF4B` | **Cast spell 2.** Identical to state $0E except (a) initiates music fade via `MusicID_FadeMusicCommand`, (b) reads `DATA_kamek_spell_color2_per_boss[variant]` for the second spell color, (c) does VRAM-DMA via `CODE_00B756` of compressed graphics from `DATA_0CDA9A[variant]`/`DATA_0CDAB2[variant]` (LZ-pointer pairs) into VRAM tile `$6800`. |
| `$12` | `CODE_0CE10E` | **Cast spell hold 1.** Per-frame SuperFX update -- recomputes `$7044F2` from sprite Y-position, calls `FXCODE_08ECEF` (spell-render update). Spawns ambient sprite `AmbSpr220` every 4 frames as the "magic poof" particle. |
| `$14` | `CODE_0CE214` | **Cast spell hold 2.** Mirror of state $12 but with `FXCODE_08EE49` for the second spell. |
| `$16` | `CODE_0CE34D` | **Spell complete.** Sets `$1015 = $0002` (signals boss "spell almost done"), polls `$7044F2 < $9800` (the SuperFX spell-progress counter); on threshold, advances to state $18. |
| `$18` | `CODE_0CE404` | **Spell wind-down 2.** Mirror of state $16 for the second spell. |
| `$1A` | `CODE_0CE4A7` | **Cleanup.** Sets `$1015 = $FFFF` (signals "spell done"), clears `FreezeYoshiFlagLo`, disables HDMA `$36`, restores normal color math, advances to state $1C. |
| `$1C` | `CODE_0CE4CB` | **Despawn.** Polls `$1015 == 0` (waits for boss to consume the handshake), then writes `DATA_boss_music_per_battle[variant]` into `!RAM_YI_Global_PlayMusicLo` (kicks the boss music). When `variant == $0B` (the Hookbill case), skips the music-write. Tail-calls `JML CODE_despawn_sprite_free_slot`. |

The state byte transitions are always `INC $16,x : INC $16,x` (advance
by 2) because the dispatch table is in words. The variant index in
`$76,x` is computed once in Init from the X-position bit-4 trick OR'd
with current world, then preserved throughout the cinematic for table
lookups.

### 2.3 The KamekSayingOhMy $053 state machine in detail

A much simpler 4-state machine in the dedicated routine file. State
byte at `$76,x`. Init is a bare `RTL` (Kamek inherits position and
state-0 from the level-data spawn record). Main pins the camera
auto-scroll active flag (`$0C1E = 1`) every frame so the camera locks
while talking. See `yi/Routines/ROUTINE_YI_NorSpr053_KamekSayingOhMy.
asm` for the fully-commented body; the highlights are:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_kamek_oh_my_state_0_wait_camera` | Hold position until X-speed turns negative (camera has scrolled past spawn). Then freeze motion, set animation frame 2 (idle pose), start the `$0020` (32-frame) blink-talk timer. |
| `$01` | `CODE_kamek_oh_my_state_1_blink_talk` | When both timers `$7A96` + `$7A98` are zero, increment animation frame. On reaching frame 4 (peak of "OH MY!"), push `SoundID5B_KamekTalk` and trigger msgbox $82 (`STA $704070`, `INC MessageBoxState`). Advance to state 2. |
| `$02` | `CODE_kamek_oh_my_state_2_await_msgbox` | Wait for `MessageBoxState == 0`. Then set XSpeed `$FC00`, accel `$0040`, ceiling `$0400`, advance to state 3. |
| `$03` | `CODE_kamek_oh_my_state_3_fly_despawn` | Each frame: pick anim frame from current speed ($0006 / $0005 / $0002 = slow / medium / fast). When screen-X >= `$0140`, walk `$108A` (the Kamek-aux-slot pointer), spawn a poof-of-smoke effect via `CODE_02E1A3`, despawn the aux instance via `CODE_03A31E`, pop our return, tail-JML to `CODE_03A31E` (despawn self). |

A small SMWC-documented design surface: the `JSL CODE_02E1A3` operand
at cart `$00:86D8` controls the poof-of-smoke spawn; patching its low
byte from `$A3` to `$9C` (= JSL `$02:E19C` immediate-RTL stub) skips
the "OH MY!" key-scene ending of Naval Piranha. The framework
preserves the default `$A3` byte. See the inline comment at
`ROUTINE_YI_NorSpr053_KamekSayingOhMy.asm:225`.

### 2.4 The AttackingAndEndingKamek $125 state machines

After the Init dispatch (§2.1), the ending variant runs a 9-state
phase machine indexed by `$16,x` (entry order matches the
cinematic):

| `$16,x` | Phase | Description |
|---------|-------|-------------|
| `$00` | `kamek_ending_phase0_spawn` | Spawn off the right edge at `(CameraX + $0130, CameraY + $0040)`, start XSpeed `$FE00` drift left. |
| `$02` | `kamek_ending_phase2_fly_in` | Flap-anim cycle (frame XOR $0003 every 4 frames) while drifting; on `screen-X < $00F4`, halt and load the 20-entry palindromic chant-pose sequence via `$17,x = $13`. |
| `$04` | `kamek_ending_phase4_chant` | Walk `$17,x` from 19 down, indexing `DATA_kamek_ending_chant_frames` (20 bytes -- alternating $03/$04/$05) and `DATA_kamek_ending_chant_durations` (alternating $02/$06). Every 8th pose (`AND #$0007 == 7`), push `SoundID5B_KamekTalk`. On underflow, set anim frame 4 (cast pose) and trigger msgbox $0115. |
| `$06` | `kamek_ending_phase6_cast` | Cast spell: set XSpeed accel `$F800/$0800`, YSpeed `$FF00` (arc), start ending music `MusicID_9`. |
| `$08` | `kamek_ending_phase8_hold` | Drift until screen-X < $0080. |
| `$0A` | `kamek_ending_phaseA_present` | Once X reaches $0140, swap to ending palette via 14-entry copy from `DATA_5FF556` to `$702F2E` and `YI_Global_PaletteMirror[$E1]`. Mark the boss slot at `$105E` with `$74A2 = $FF` (the "boss has been frozen for cutscene" flag). Set color-math bits in `$7042 / $7040`. |
| `$0C` | (anon `CODE_03E67B`) | Post-dialog wait timer; compute Kamek X-speed from `$76,x` (variant) -- `-($76,x << 2)`, set YSpeed `$FFF0`, snap to `(CameraX + $0110, CameraY + $0038)`. |
| `$0E` | `kamek_ending_phaseE_depart` | Fly away with X-speed walk-down from `$76,x` value -- decrements by 3 each frame until 0, then cleanup at screen-X < $0020. |
| `$10` | `CODE_kamek_ending_phase10_cleanup` | Bump cinematic-stage counter at the linked boss slot `$105E` (writes `INC !EXRAM..._7019D6,y`), arm 64-frame timer there, despawn self. |

The chasing variant has a 4-state cycle that loops back to phase 0
after the fly-out -- so the same sprite can run multiple casts in a
single level. Phase 1 is gated on `!Define_YI_LevelID_KameksRevenge`
for a small palette-swap variant.

### 2.5 The MagicShootingKamek $1AD state machine

6 states, dispatched via `$18,x`. Init sets `$77C0 = 2` (the
remaining-volleys counter) and arms `$76,x = $0100` (re-appear
timer).

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CC3BA` | **Target / appear.** When the re-appear timer `$7A96` expires, picks a screen-X from `DATA_0CC349` (32-byte table) indexed by `$10 AND $0F`. Calls SuperFX `FXCODE_0AE921` for a valid-tile probe; on success, places Kamek at that X / Y, plays `SoundID31_EnterPipe`, sets palette `$05`, arms $0030 frame hold-timer, sets state $02 (`$18,x = 2`). On failure (`R10 != 0`), retries next frame. |
| `$02` | `CODE_0CC53D` | **Appear (rise).** Walks `$16,x` from `<$0100` up by `$0010` each frame, scaling the OAM Y-position by SuperFX `CODE_0CC5F4` (Bank0C:9156). On `$16,x = $0100` (fully visible), arms `$7A96 = $10`, sets initial frame `DATA_0CC466[$06] = $01`, advances to state $04. |
| `$04` | `CODE_0CC478` | **Cast.** Iterates `$19,x` from 6 down, indexing `DATA_0CC466` (7-byte frame-table $01,$06,$05,$04,$03,$02,$01 -- the cast animation sequence) and `DATA_0CC46D` (7-byte per-frame duration $10,$08,$10,$02,$02,$02,$30). When `$19,x = $01`, spawns the magic-shot child: picks side from `$7400,x` via `DATA_0CC474` ({-$10, +$10}), spawns sprite `$01AE` via `CODE_spawn_sprite_active`, stamps position into the child slot. On `$19,x` underflow with `$77C0` still positive, decrements `$77C0` and re-arms cast (a 6-shot volley). When `$77C0` exhausts, picks "vanish forward" or "vanish backward" (state $08 or $0A) via random + `$10 AND $01`. |
| `$06` | `CODE_0CC580` | **Shoot (alt path).** Decrements `$78,x` per frame, scales `$16,x` by `$76,x` AND $003F. Used by some boss-Kameks for a continuous-volley path; on underflow re-arms volley like state $04. |
| `$08` | `CODE_0CC5BC` | **Vanish.** Walks `$16,x` from `$0100` down by `$0010`; on reaching `< $0030`, arms `$7A96 = $20` (next-volley cooldown), zeros `$18,x` -- back to state $00 for the next pop-up. |
| `$0A` | `CODE_0CC5E0` | **Despawn.** Decrements `$78,x`; on underflow, jumps into state $08's tail. |

Head-bop is a bare `RTL` at `$0C:C795` -- Kamek $1AD is immortal.
Yoshi cannot hurt him in this combat mode; the only "win" condition
is to survive the volleys until the level scrolls past.

---

## 3. Magic Shot $01AE

The projectile child of `$1AD MagicShootingKamek`. Init at `$0C:C796`
is a bare `RTL` (the parent stamps the spawn position before
returning). Main at `$0C:C797`:

```
main_kamek_magic:
    JSL CODE_03AF23                ; physics tick
    JSR CODE_0CC844                ; per-frame Map16-overlap probe + transform
    JSR CODE_0CC8D4                ; held-by-sprite cleanup
    LDA $7A96,x : BNE -- ; animation 12-frame loop ($7402 cycles 0..11)
    ...
    LDY $16,x : TYX : JMP (DATA_kamek_magic_state_ptr,x)
```

The 2-state main:

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CC7D7` | **Travel-init.** Plays `SoundID04_SpitOut`. Reads player position from `$611C / $611E` and own target from `$7CD6 / $7CD8` (which the parent stamped at spawn time). Calls SuperFX `FXCODE_09907C` (the "compute vector to target" helper -- normalizes and stores back into R1/R2). Stores the result as XSpeed `$75E0` and YSpeed `$75E2`; computes accel as `abs(speed) >> 4` -- so faster shots accelerate harder. Advances to state $02. |
| `$02` | `CODE_0CC839` | **Travel.** No body -- the projectile is fully driven by physics now (`CODE_03AF23` from the Main entry handles XSpeed/YSpeed accumulation + accel scaling). Just an RTL. |

The interesting behavior is the per-frame `JSR CODE_0CC844`
(`CODE_0CC842` entrypoint variant), which is the **"Map16 overlap +
transform"** probe:

```
CODE_0CC844:
    REP #$10
    LDA !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x  ; overlap-Map16-cell pointer
    TAX
    LDA $700006,x : CMP #$9D8B : BEQ .valid_target
    SEP #$10 : LDX $12 : RTS                                          ; no overlap
.valid_target:
    LDA $700000,x : AND #$FFF0 : STA $00 / $0091                      ; tile X
    LDA $700002,x : AND #$FFF0 : STA $02 / $0093                      ; tile Y
    SEP #$10
    LDA #$0001 : STA $008F                                            ; layer
    LDA #$0000 : STA $0095                                            ; sub
    JSL CODE_change_map16                                             ; rewrite Map16 cell
    LDA #!Define_YI_SoundID15_Growth : JSL CODE_push_sound_queue
    LDX $12
    LDA #!Define_YI_AmbSpr1E6 : JSL CODE_spawn_ambient_sprite         ; transform-effect particle
    ...
    LDA $10 : AND #$0006 : TAY                                        ; random in {0,2,4,6}
    LDA DATA_0CC83C,y                                                  ; { FlyingFang, Milde, Shyguy }
    TXY : JSL CODE_spawn_sprite
    ...
```

`DATA_0CC83C` (`$0C:C83C`) is the 3-entry table:

```
DATA_0CC83C:
    dw !Define_YI_NorSpr13E_FlyingFang
    dw !Define_YI_NorSpr108_Milde
    dw !Define_YI_NorSpr01E_Shyguy
```

So when the magic shot strikes a Map16 cell with the magic word
`$9D8B` at offset `+6` in the engine's per-cell EXRAM mirror (a
"transformable target" tag), the shot:

1. Rewrites the Map16 cell via the engine's `CODE_change_map16`
   helper to whatever the transformation result is (the engine uses
   `$0091`/`$0093` as tile coords, `$008F` = layer, `$0095` = sub).
2. Plays `SoundID15_Growth`.
3. Spawns ambient sprite `$01E6` (the growth-puff effect) at the
   tile.
4. Spawns a NORMAL sprite at the same tile, randomly picked from
   `{ FlyingFang, Milde, Shyguy }` -- the bit-2 + bit-1 of frame
   counter `$10` selects the index.

This is the canonical "Kamek transforms blocks into enemies"
mechanic. The full path is: Kamek $1AD fires $1AE; $1AE flies on a
SuperFX-computed vector to Yoshi; $1AE hits a tagged Map16 cell on
the way; the cell becomes a Flying Fang / Milde / Shy Guy.

The "held-by-sprite cleanup" path at `CODE_0CC8D4` watches `$7D36,x`
(the holding-link slot); on overflow (BMI = -1 = held), runs
`CODE_03A858` (force-detach) then pops the return and despawns via
`JML CODE_03A31E`. This lets Yoshi swallow the shot if he can.

---

## 4. Boss-arena VFX

Three sprites that aren't Kamek but share the cinematic vocabulary --
2048-tick countdowns, palette-cycle tables, palette-mirror writes,
state-hand-off to game-modes.

### 4.1 $013 BossExplosion

Init at `$02:DF55` is short:

```
init_boss_explosion:
    LDA #$0002       ; arm sub-state at $16,x
    STA $16,x
CODE_02DF5A:
    LDA #!Define_YI_SoundID74_BossExplosion
    JSL CODE_push_sound_queue                  ; play the boom
    LDA #$0800
    STA $7A38,x                                ; 2048-tick (= 2048-frame) countdown
    RTL
```

Two interesting points:
- The "$0800 countdown" at `$7A38,x` is the cinematic duration. Each
  frame, Main subtracts `$0040` from it -- so 2048 / 64 = 32 frames
  of "main flash phase", clamping at `$0100`. The countdown drives
  both the palette cycle and the eventual hand-off.
- A 4-entry colour table at `DATA_02DF68` (`$02:DF68`) is the
  palette-cycle source. The four colors are
  `dw $0000,$7F00,$23EC,$22DF` -- black / pure-blue / teal / purple.
  These get written to `YI_Global_PaletteMirror[$00].LowByte` each
  frame as the explosion "pulses".
- At specific countdown checkpoints:
  - `$7A96,x == $0140` -- spawns a final flash, may trigger sub-VFX
    via `CODE_02E195` (the SuperFX-rendered boss-defeat poly).
  - `$7A96,x == $00C0` -- plays `SoundID43_MountYoshi` (the joyful
    fanfare), runs `CODE_04F74A` (a player-disable / wait helper),
    sets `$60BE = $012E` (Yoshi anim frame "victory"), and `$7402 =
    $0032` (Yoshi animation for victory pose).
  - `$7A96,x == 0` (countdown done) -- writes `$0006` to `$00004D`
    (the boot-state slot?), sets `!RAM_YI_Global_CurrentGameMode =
    !Define_YI_GameMode31` (the boss-cleared transition), trims
    color-math, then despawns via `JML CODE_03A31E`.

This is the **canonical handoff-to-game-mode pattern**. The
`GameMode31` is responsible for fading out the boss arena, scrolling
the world map, and queuing the next-level state. Boss explosion's
state machine doesn't return control to the boss's own state machine
-- it owns the transition entirely.

### 4.2 $014 KeyFromBoss

The giant key that drops after a fortress boss dies. Init at
`$02:D9B8`:

```
init_boss_key:
    LDA $61B2                                  ; valid-spawn check
    BPL .bail
    JSL CODE_03AD74                            ; carry-egg check
    BCS .accept
.bail:
    JMP CODE_02AC7B                            ; despawn
.accept:
    JSL CODE_04F74A                            ; player-disable
    LDA #!Define_YI_PlayerState1A_DisableInput
    STA !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
    STZ !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
    STZ $60C4
    LDA !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror : STA $70E2,x
    LDA !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
    SEC : SBC #$0028 : STA $7182,x             ; key spawns at (Yoshi-X, Yoshi-Y - $28)
    LDA #$0002 : STA $74A2,x                   ; OAM palette
    LDA #$0020 : STA $76,x                     ; initial chew-cycle counter
    JSR CODE_02DB37                            ; SuperFX OAM stamp
    JSL CODE_02A4F4                            ; pin camera
    LDA !RAM_YI_Global_Layer1XPosLo : STA $0C23
    LDA !RAM_YI_Global_Layer1YPosLo : STA $0C27
    LDA #$0001 : STA $0C1E : STA $0C20         ; auto-scroll active on both axes
    RTL
```

This is a level-clear cinematic actor, not a hazard. Notable:
- Disables player input (`PlayerState1A_DisableInput`).
- Locks both camera axes.
- Warps the key to Yoshi's hand position.

Main runs the 5-state `DATA_key_from_boss_state_ptr` cinematic:

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_key_from_boss_state_00_emerge` | Emerge from defeated boss; for `LevelMode = $09` (fortress arena), scrolls camera up. Walks `$78,x` through 17 entries of a triple-parallel table (`DATA_02DA25` = timers, `DATA_02DA47` = anim frame IDs $0125..$0130, `DATA_02DA69` = Yoshi pose ID). The 5th timer (`y = $18`) plays `SoundID43_MountYoshi`. |
| `$01` | `CODE_key_from_boss_state_01_drift_to_yoshi` | Drift toward Yoshi's hand via `$7C18,x - $FFE4` accumulator; on positive, snap to `($70E2,x, $7182,x + accumulator)` and zero YSpeed. Continues the table walk. |
| `$02` | `CODE_key_from_boss_state_02_post_pickup_glow` | Post-pickup glow; uses SuperFX `FXCODE_088205` for the spinning-glow render. (Body at `Bank02:10800` onward.) |
| `$03` | `CODE_key_from_boss_state_03_pre_keyhole` | Pre-keyhole cinema. (Body at `Bank02:11000` onward.) |
| `$04` | `CODE_key_from_boss_state_04_insert_key` | Insert / turn key (this is the level-clear trigger -- writes to the next-level pointer and hands off to the world-map game-mode). |

The "$104 sticker" rendering trick: state $02 uses
`FXCODE_088205` to render a rotating-color glow via the SuperFX
loop-counter trick (the same engine call used by Sluggy / Naval
Piranha for their boss-aura). See `docs/bossengine.md` §7.3 for the
broader pattern.

### 4.3 $05A RaphaelSparkAttack

Raphael the Raven's spark projectile, fired in volleys of 3. Init is
a bare `RTL`; Main at `$0F:ABE5`:

```
main_raph_spark:
    JSL CODE_03AF23                            ; physics tick
    SEP #$20
    LDA #$47 : STA $000051                     ; "spark VFX active" flag
    LDA $7A38,x : BEQ .fresh                   ; flicker timer up?
        ; flickering branch (animation phase):
        LDY !EXRAM..._701900,x
        INC !EXRAM..._701900,x
        LDA DATA_0FABDC,y                      ; 9-byte flicker frame table
        BMI .despawn                           ; $FF sentinel -> despawn
        STA $7402,x
        ...
    .fresh:
        LDY $7400,x
        LDA !EXRAM..._7019D6,x
        CLC : ADC DATA_0FABD8,y                ; +3 or -3 stride per frame
        STA !EXRAM..._7019D6,x
        ...
        JSR CODE_raphael_egg_hit_test
```

Two driving data tables:
- `DATA_0FABD8` (`$0F:ABD8`): 2-entry word table `{ +3, -3 }`. The
  spark's "facing" (`$7400,x`) picks which stride to apply -- so the
  spark walks outward from Raphael's center, either clockwise or
  counterclockwise around Raphael's spherical arena.
- `DATA_0FABDC` (`$0F:ABDC`): 9-byte byte table `00,00,00,00,04,04,
  04,04,FF`. This is the flicker animation -- 4 frames of "no
  flicker" (frame 0), 4 frames of "bright flicker" (frame 4), then
  `$FF` sentinel to despawn.

The volley spawner `CODE_raphael_spawn_spark_volley` at
`$0F:AC61` (called from Bank0F:6968 inside Raphael state $09 --
attack-hop-up) fires three sparks:

```
CODE_raphael_spawn_spark_volley:
    LDA #!Define_YI_SoundID47_Explosion : JSL CODE_push_sound_queue
    LDA #$0018 : STA $61C6                     ; camera shake amplitude
    SEP #$20
    STZ $1062 : JSR CODE_0FAC8B                ; spawn spark #0 (center)
    LDA #$02 : STA $1062 : JSR CODE_0FAC8B    ; spawn spark #2 (offset)
    PLA : STA $1062                            ; restore caller's $1062
    RTS
```

Each spark gets:
- Spawn slot via `CODE_spawn_sprite_active` (sprite ID $005A).
- Center-pivot at `$105D` (Raphael's center-X anchor).
- Stride direction from `$1062` (the volley index: 0 = center, 2 =
  offset by `DATA_0FAC59 / DATA_0FAC5D` lookup).
- `$74A2,y = $05` or `$06` (palette).
- `$701900,y = $04` (initial animation frame index -- jump 4 into
  DATA_0FABDC to skip the dim phase, so secondary sparks start
  bright).

This is the only sprite in the boss-VFX cluster that's `actively
fired` (Boss Explosion is triggered by HP-reaches-0, Key-from-Boss
spawns from a defeat handler) -- the Spark is the only one with a
"per-volley dispatch" entry point.

---

## 5. Shared Kamek infrastructure

Resources used across multiple Kamek variants.

### 5.1 Per-boss tables in Bank0C ($0C:DACA, $0C:DAE2, $0C:DAFA)

Three 12-entry tables indexed by a "battle number" that
CutsceneKamek's state $0E / $10 derives from `!RAM_YI_Level_
CurrentWorldLo` ORed with bit 0 of the spawn X-low-nibble:

```
DATA_kamek_spell_color1_per_boss ($0C:DACA) -- 12 BGR15 words:
    $611F, $22DF, $7F00, $23EC,
    $611F, $22DF, $7F00, $5C13,
    $611F, $22DF, $7F00, $23EC

DATA_kamek_spell_color2_per_boss ($0C:DAE2) -- 12 BGR15 words:
    $22DF, $7F00, $23EC, $7F00,
    $7F00, $23EC, $611F, $5D20,
    $23EC, $611F, $22DF, $611F

DATA_boss_music_per_battle ($0C:DAFA) -- 12 bytes:
    $0A, $0C, $0A, $0C, $0A, $0A,
    $0A, $0C, $0A, $0A, $0A, $0C
```

Why 12 entries? Each world has two bosses (a mid-world and a castle
boss), making 6 bosses x 2 = 12 boss-cinematic flavors. The X-bit
trick effectively picks "mid-world Kamek tone" vs "castle Kamek
tone" within the same world entry.

`DATA_boss_music_per_battle` values map to:
- `$0A` = the standard x-4 boss music (with level-header music 7/8
  swapped to the long intro variant used in Naval Piranha and
  Raphael fights).
- `$0C` = the x-8 boss music (the heavier "castle boss" theme).

CutsceneKamek state $1C consults this table immediately before
despawning -- so the boss music is kicked by the herald, not by the
boss itself. This is the cinematic-engine convention: Kamek arrives,
casts, then queues the new music, then leaves.

### 5.2 The $1015 spell-done handshake (4-state)

The single most important Kamek-side global. Documented in detail
in `docs/bossengine.md` §10 Q3 -- the 4-state token protocol:

1. **Boss prep** writes a positive seed (`INC $1015` or `STA #$0001`)
   before spawning CutsceneKamek (sites in Hookbill, Baby Bowser,
   Sluggy, Tap-Tap intros).
2. **CutsceneKamek** state $00 wakes on `$1015 != 0`. State $16 (in
   our numbering above) writes `$1015 = $0002` -- "spell almost
   done". State $1A writes `$1015 = $FFFF` -- "spell done".
3. **Boss "wait for Kamek"** state reads `$1015` with `BPL`; idles
   while positive; when negative, does `STZ $1015 / INC $76,x` to
   consume and advance.
4. **CutsceneKamek** state $1C reads `$1015 == 0`; waits for boss to
   consume; despawns.

The `$1015` slot is shared with `$08E BowserRoomKamek` which uses the
same protocol via a different code path. So at most one Kamek can be
casting at a time -- the slot is a global lock as well as a signal.

### 5.3 The $105C / $105E slot link

Documented in `docs/bossengine.md` §5.2 and §7.3. `$105C` is the
"Kamek spell-done flag" used by Bowser-room Kamek (in-fight variant);
`$105E` is the "linked-host slot" -- when a Kamek sprite is acting on
behalf of a boss, it caches the boss's slot index here so per-frame
updates can reference it. For CutsceneKamek $048, the boss slot is
recorded via the boss's spawn-Kamek path (e.g. Baby Bowser phase
$0E at `Bank0D:9707-9712` writes the spawned Kamek's slot, but the
inverse link via $105E is set by Bowser-room Kamek $08E -- not by
$048 itself).

### 5.4 Sound IDs used by the family

| Sound ID | Constant | Used by |
|----------|----------|---------|
| `$5B` | `KamekTalk` | $048 state $06 (every 8th anim frame), $053 state 1 (on frame 4), $125 ending phase 4 (every 8th frame). |
| `$18` | `CoinSpillage` | $048 states $0E + $10 (spell-cast bursts). |
| `$31` | `EnterPipe` | $1AD state $00 (appear) + $1AD state $04 (vanish). |
| `$04` | `SpitOut` | $1AE state $00 (travel-init). |
| `$15` | `Growth` | $1AE on Map16 transform hit. |
| `$43` | `MountYoshi` | $013 state $00 (victory fanfare), $014 state $00 (key emerge). |
| `$74` | `BossExplosion` | $013 Init (the boom). |
| `$47` | `Explosion` | $05A volley spawn (camera shake + boom). |
| `$9A` | `KamekFlying` | $125 chasing phase 2 (post-cast). |

### 5.5 Ambient sprite spawns

| AmbSpr ID | Used by | Purpose |
|-----------|---------|---------|
| `$0220` | $048 states $12 + $14 | "Magic poof" particle during spell hold; spawned every 4 frames during the cast. |
| `$01E6` | $1AE on Map16 transform | "Growth-puff" particle when a tile becomes an enemy. |

---

## 6. Cross-references

- `docs/bossengine.md` -- §5 (Bowser-room Kamek + the in-fight Kamek
  state machine), §7.3 (Kamek-style boss-helper slot links via
  `$105C`/`$105E`), §10 Q3 (the `$1015` 4-state handshake protocol
  in full).
- `docs/family-bowserfight.md` -- §3 (the Baby Bowser fight cluster
  including $08E BowserRoomKamek; explains how the in-fight Kamek
  reuses CutsceneKamek's handshake from a different code path), §5
  (Bowser-room Kamek's 10-state cinematic).
- `docs/family-piranhas.md` -- Naval Piranha defeat sequence
  (state $08-$0A spawn the boss-explosion equivalent and `$00DD`
  CloseWallInNavalPiranhaRoom; this is where CutsceneKamek $048
  next departs).
- `docs/spritestateengine.md` -- engine-side 9-state dispatcher.
  Every Kamek variant's Main runs through `spr_state_main`; their
  head-bop handlers either no-op (`$1AD` immortal) or fall through
  to `CODE_head_bop_common` in Bank03.
- `yi/Banks/Bank02.asm` -- $013 BossExplosion (`$02:DF55`-`$02:E0FF`),
  $014 KeyFromBoss (`$02:D9B8`-`$02:DB72`+ state handlers through
  `$02:E0FF`).
- `yi/Banks/Bank0C.asm` -- $048 CutsceneKamek (`$0C:DB06`-`$0C:E4FF`),
  $1AD MagicShootingKamek (`$0C:C369`-`$0C:C795`), $1AE MagicShot
  (`$0C:C796`-`$0C:C8DC`), plus the three per-boss tables at
  `$0C:DACA / $0C:DAE2 / $0C:DAFA`.
- `yi/Banks/Bank03.asm` -- $125 AttackingAndEndingKamek (`$03:E3B7`
  through `$03:E8C0` for both variants).
- `yi/Banks/Bank0F.asm` -- $05A RaphaelSparkAttack (`$0F:ABE5`-
  `$0F:AD20`) and the volley spawner `CODE_raphael_spawn_spark_volley`
  at `$0F:AC61` (called from Raphael state $09 at `$0F:B67A`).
- `yi/Routines/ROUTINE_YI_NorSpr053_KamekSayingOhMy.asm` -- the
  V1.0/V1.1-aware routine file for $053. Emit sites in
  `yi/Banks/Bank00.asm:1237` (V1.0) and `yi/Banks/Bank0F.asm:2687`
  (V1.1).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs +
  one-line summaries for `$013`, `$014`, `$048`, `$053`, `$05A`,
  `$125`, `$1AD`, `$1AE`.
- `yoshisisland-disassembly/disassembly/bank0[02CF3].asm` --
  Raidenthequick's descriptive labels: `init_cutscene_kamek`,
  `init_kamek_OH_MY`, `init_kamek_shoots_magic`, `init_kamek_magic`,
  `init_kamek` (the $125 init), `init_boss_explosion`,
  `init_boss_key`, `init_raph_spark`. Verified label-by-label.
- `ys_bbbros.asm` -- parallel asm for the Kamek / boss-brother
  attack sprites (the family role file).
- `ys_boss2.asm` -- parallel boss-2 arena asm where Raphael's spark
  volley is sourced.

---

## 7. Open questions / unclarities

- **Per-boss table layout indexing.** The 12-entry tables at
  `$0C:DACA / $0C:DAE2 / $0C:DAFA` are indexed by `$76,x` (the
  variant byte) which CutsceneKamek's Init computes as `(X.bit4 >>
  3) | CurrentWorld`. With CurrentWorld in $1..$6 and bit4 adding
  $0 or $1, the index ranges $1..$D -- but the tables only have 12
  entries ($0..$B). What happens at index $C / $D? Likely OOB-safe
  because each world has at most 2 boss arenas (one mid, one
  castle), so the valid indices for placed-in-level CutsceneKameks
  are constrained to $1..$B. Worth verifying by reading the
  spawn-Kamek call sites in each boss intro state machine to
  confirm none can produce a $0C/$0D index.

- **The `DATA_kamek_spell_color1` two-color choice.** Two parallel
  tables (color1 + color2) drive the *first* burst (state $0E) and
  *second* burst (state $10). The two-burst structure is consistent
  across all bosses, but why two colors? Looking at the data: every
  pair has one "warm" and one "cool" entry (e.g. entry 0 = `$611F`
  reddish + `$22DF` greenish; entry 2 = `$7F00` pure-blue + `$23EC`
  teal). This suggests the cinematic is a color-cycle dichotomy
  (warm flash then cool flash) rather than random; the visual is
  "magic flashes red-then-green" not "magic flashes one color
  twice".

- **When multiple Kamek variants coexist.** No level in the game
  places more than one Kamek visible at once. But the engine
  technically allows it -- $048 CutsceneKamek (level-data spawn)
  could coexist with $125 AttackingAndEndingKamek (also level-data),
  and both consult `$1015` from different code paths. If both fire
  spells in the same level, the handshake slot becomes contended.
  Empirically this never happens; would be worth confirming by
  searching the level data for any level with both sprite IDs in
  its sprite list.

- **Why is $1AD's head-bop a no-op?** Most enemies route the
  head-bop into `CODE_head_bop_common` which sets the OAM-front bit
  + plays a stomp sound. $1AD's `_StompRt` is a bare RTL -- meaning
  Yoshi physically *can't* stomp Magic Kamek, but the game doesn't
  display a "no, you can't" tone either. Yoshi just passes through.
  This makes Kamek the only "immortal but tangible" enemy in the
  game; the design intent (vs other immortal sprites like
  Brick-Block etc.) is unclear.

- **State $06 of $1AD vs state $04.** Both states call into
  `CODE_0CC679` (the SuperFX OAM stamper) and `CODE_0CC6F3`
  (overlap probe), and both can spawn `$01AE` shots. The only
  difference is state $06 decrements `$78,x` per frame -- a
  separate cooldown -- so state $06 appears to be a "continuous
  fire" mode whereas state $04 is the discrete 6-shot volley. But
  no caller in the codebase ever sets `$18,x = 6` (state $06) --
  the state-table entry is technically dead. Likely a vestigial
  test path or a future-use entry. Worth verifying by checking
  whether any boss-arena Kamek sets `$18,x = 6` programmatically
  (e.g. as part of Hookbill / Naval Piranha pre-fight setup).

- **$1AE's `$701902,x` overlap pointer.** The Map16 overlap probe
  reads `!EXRAM..._701902,x` as a pointer into `$700000` (an EXRAM
  table). Where does this get set? Inspection of $1AD's spawn path
  shows the parent stamps `$7CD6 / $7CD8` (target position) into
  the child slot but not `$701902` -- meaning the engine itself
  must populate this slot in the standard sprite-physics pipeline.
  This is consistent with the SuperFX-side overlap engine: shot
  position is fed to `FXCODE_09907C` and the result is the cell
  pointer. Worth tracing the exact handoff.
