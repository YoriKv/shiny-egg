# YI Boo / ghost family reference

Standalone reference for the Yoshi's Island Boo / ghost sprite family --
the white, vaguely conical, perpetually-grinning spirits (and a couple
of caged-Boo variants where the ghost is hidden inside a different
container sprite). The family is unusually heterogeneous: ten in-scope
sprites spread across four banks (Bank04, Bank05, Bank06, Bank0C,
Bank0E), each with its own Init/Main pair and its own state machine.
There is no single shared `init_boo` body the way the Bandit family
shares `init_bandit`. What unites the family is visual identity (a Boo
graphic), facing-Yoshi shame-dynamics (used by both the BigBoo $071 and
the BooManBluff $10F), and heavy SuperFX collaboration for the masking
/ cage / platform variants.

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  every entry here layers its own sub-state machine on top of. Most of
  the boos use the dispatcher's `head_bop_common` (in `Bank03.asm`) as
  their `_StompRt`, so stomping a Boo merely bounces Yoshi off --
  ghosts can only be killed by eggs (or, for some, not at all).
- `docs/family-shyguys.md` -- covers the **Boo-Guy** sub-family
  (sprites `$0103` / `$0105` / `$0106` / `$010D` / `$019A`) which is a
  shy-guy-under-a-sheet rendered with Boo-flavoured AI. Those are
  shy-guys, not Boos; they appear in a separate file.
- `docs/bossengine.md` -- covers the Bigger Boo `$016` boss
  (World 1-4 castle). That state machine is documented there; this
  file only carries a one-section pointer back.
- `docs/family-bandits.md` and `docs/family-clouds.md` reuse the
  "common dispatcher + per-sprite state-ptr table" pattern; readers
  familiar with those docs will find this one structurally similar.

Source of truth for all addresses: framework asm at `yi/Banks/Bank06.asm`
(Dangling Ghost, both caged-ghost variants, both platform-ghost
variants), `Bank0C.asm` (BigBoo, BooBalloon), `Bank0E.asm` (BooBlah +
piro-dangle variant), `Bank05.asm` (BooManBluff), `Bank04.asm`
(BiggerBoo cross-reference). Cross-checked against
`yoshisisland-disassembly/disassembly/bank0{4,5,6,C,E}.asm` for the
Raidenthequick descriptive labels which are already mirrored as
aliases in our asm (`init_dangling_ghost`, `init_caged_ghost_round`,
`init_caged_ghost_snake`, `init_platform_ghost_fort`,
`init_platform_ghost_sewer`, `init_big_boo`, `init_boo_balloon`,
`init_boo_blah`, `init_boo_man_bluff`, `init_bigger_boo`). Parallel
sibling reference files `ys_enmy*.asm` carry equivalent behaviours
under different label conventions; consulted here at the file level
only.

---

## 1. Family at a glance

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$010` | `RoundedCagedGhost` | 06 | `$06:E02B` `init_caged_ghost_round` | `$06:E047` `main_caged_ghost_round` | `head_bop_common` | Round-cage Boo that spits Shy Guys at Yoshi. 5-entry state ptr; SuperFX intersection probe selects facing + ambush trigger. |
| `$016` | `BiggerBoo` (boss) | 04 | `$04:B354` `init_bigger_boo` | `$04:B4EA` `main_bigger_boo` | `head_bop_common` | World 1-4 castle boss. 8-state main + 2-state Init dispatch. **Documented in `docs/bossengine.md`** -- this doc only summarises. |
| `$057` | `SewerGhostWithPlatform` | 06 | `$06:F08F` `init_platform_ghost_sewer` | `$06:F0C2` `main_platform_ghost_sewer` | `head_bop_common` | Boo holding a rideable platform, sewer BG variant. SuperFX mask blit (`FXCODE_08E800`) + HDMA/color-math for the see-through translucency. Spawns an `AmbSpr1BA` companion. |
| `$071` | `BigBoo` | 0C | `$0C:D4F5` `init_big_boo` | `$0C:D545` `main_big_boo` | `head_bop_common` | Massive Boo with 13-segment trailing tail. Init picks one of 7 visible bits from a level-wide flag bank `$0CC4`; only one BigBoo at a time. Two-stage state machine: facing-Yoshi (cover/pause) vs facing-away (chase via `FXCODE_09907C` angle math). |
| `$090` | `DanglingGhost` | 06 | `$06:D1A1` `init_dangling_ghost` | `$06:D1C7` `main_dangling_ghost` | `head_bop_common` | Boo Guy hanging from a sewer ceiling on a stretchy filament. Pendulum physics + lunge-at-Yoshi; kidnap sound on contact. |
| `$0D6` | `FortGhostWithPlatform` | 06 | `$06:E517` `init_platform_ghost_fort` | `$06:E530` `main_platform_ghost_fort` | `head_bop_common` | Boo holding a rideable platform, fort/castle BG variant of `$057`. Different SuperFX path (`FXCODE_0ACE2F` mask + `FXCODE_08E93B` blit), 13-step (handler,arg) state table, idle-bob sequencing. |
| `$0E2` | `BooBlah` | 0E | `$0E:8E91` `init_boo_blah` | `$0E:8F79` `main_boo_blah` | `head_bop_common` | Pulsing ghostly blob. 7-state machine (`DATA_boo_blah_state_ptrs`) driving expand/contract pulse + hit-by-egg / death paths. Tilemap-aligns spawn position. |
| `$0E3` | `BooBlahWithPiroDangle` | 0E | `$0E:8E91` shared `init_boo_blah` | `$0E:8F79` shared `main_boo_blah` | `head_bop_common` | Composite variant of `$0E2`: on init spawns a `$076` Piro Dangle sub-sprite linked via `$18,x`. Shares all code with `$0E2`; the difference is one Init branch that allocates the partner slot. |
| `$10F` | `BooManBluff` | 05 | `$05:DC74` `init_boo_man_bluff` | `$05:DCBE` `main_boo_man_bluff` | `head_bop_common` | Slope-skating Boo Guy. 11-state main (`DATA_boo_man_bluff_state_ptr`) for invisible-follow / become-visible / pursue / lunge / hit-stun / defeat. Visibility gated on `$61F2` "Yoshi is looking away" check. |
| `$193` | `SnakeCagedGhost` | 06 | `$06:D9C0` `init_caged_ghost_snake` | `$06:D9CD` `main_caged_ghost_snake` | `head_bop_common` | Boo in a cage rigged to a snake-block train. Init zeros track accumulators `$6040`/`$6042`. Main loads one of 6 frame-pose tables (`DATA_06DA61..06DB6F`) into SuperFX + runs cage blit `FXCODE_08E8CA`. |
| `$1AB` | `BooBalloon` | 0C | `$0C:BE98` `init_boo_balloon` | `$0C:BED6` `main_boo_balloon` | `$0C:C2A4` own body | Boo riding a balloon. 4-state main + 3-state drift sub-state. Egg-hits pop the balloon and spawn one of three enemies (`DATA_0CC83C`: Shy Guy / Milde / Flying Fang). Has its own StompRt body that also pops the balloon. |

Eleven sprite IDs total. Of these, `$016` is a boss documented elsewhere
and `$0E2` / `$0E3` share their entire implementation (one Init / one
Main body, two sprite-ID labels). The remaining nine are independent.

### Banks-at-a-glance

| Bank | Boo sprites in scope |
|------|----------------------|
| 04   | `$016` (boss, cross-ref only) |
| 05   | `$10F` BooManBluff |
| 06   | `$010` Rounded caged, `$057` Sewer platform, `$090` Dangling, `$0D6` Fort platform, `$193` Snake caged |
| 0C   | `$071` BigBoo, `$1AB` BooBalloon |
| 0E   | `$0E2` BooBlah, `$0E3` BooBlah + Piro Dangle (shared Init/Main) |

Bank06 carries half the family because that bank is where YI's "sewer
/ fort interior" sprite handlers cluster -- ghosts and the platform/
cage variants that share SuperFX mask + HDMA color-math infrastructure
live near each other in the bank (see `Bank06.asm` "Contents at a
glance" header).

---

## 2. Shared infrastructure across the family

Before walking through each sprite individually, a few engine-level
contracts they all observe:

### 2.1 No-kill stomp via `head_bop_common`

Eight of the ten in-scope sprites (all except `$1AB` BooBalloon) have
their `_StompRt` pointer in `yi/Banks/Bank03.asm`'s
`Init_StompRt_Ptr_Table` aliased to the shared body
`CODE_head_bop_common` at `Bank03.asm:4304`:

```
CODE_head_bop_common:
    JSL CODE_spr_state_main         ; resume regular Main this frame
    LDA $7040,x  AND #$FFF3  ORA #$0004  STA $7040,x
    LDA $7042,x  ORA #$0080  AND #$00CF  ORA #$0020  ...
    STA $7042,x
    STZ $74A2,x                     ; clear "in-mouth" link
    LDA #$0040 : STA $7542,x        ; arm Yoshi vertical bounce
    LDA #$0400 : STA $75E2,x        ; "kick Yoshi up" Y-velocity
    LDA $6FA0,x  AND #$F9FF  STA $6FA0,x  ; OAM priority bits
    LDA $6FA2,x  AND #$FFE0  STA $6FA2,x
    RTL
```

The two lines that matter: `STA $7542` arms the Yoshi-bounce-back kick,
and the priority adjustments put the Boo behind Yoshi for the half-
frame of the bop. The Boo state byte (`$76,x` / `$16,x` / `$18,x`
depending on sprite) is **not** modified, so the Boo keeps doing
whatever it was doing. In-game: "you can't stomp a Boo".

BooBalloon (`$1AB`) is the one exception with its own
`YI_NorSpr1AB_BooBalloon_StompRt` body at `$0C:C2A4` -- it does kill
the balloon, but only as a side effect of "pop the balloon" rather
than a real head-bop semantic (see §3.10).

### 2.2 SuperFX mask + HDMA color-math (translucent-Boo trick)

Four sprites use the same five-line setup to make their boo-graphic
appear translucent on top of the BG:

```
LDA.b #$13 : STA !RAM_YI_Global_MainScreenLayers     ; OBJ+BG1+BG2 on main
LDA.b #$04 : STA !RAM_YI_Global_SubScreenLayers      ; BG3 on sub
LDA.b #$22 : STA !RAM_YI_Global_ColorMathInitialSettings
LDA.b #$63 : STA !RAM_YI_Global_ColorMathSelectAndEnable
LDA.b #$18 : TSB !RAM_YI_Global_HDMAEnable           ; arm two HDMA channels
```

The five-line block appears verbatim in:

- `$06:D9CD` (Snake caged ghost main, after `FXCODE_08E8CA`).
- `$06:E5AA` (Fort ghost main, after `FXCODE_08E93B`).
- `$06:F08F` area (Sewer ghost main, after `FXCODE_08E800`).
- And similar setups in nearby boss-tier ghosts.

This is the family's signature visual: the ghost is rendered to a
small offscreen buffer via SuperFX, then DMA-fanned into BG3 and
color-math-blended with BG1+BG2 to produce the "you can see the BG
through me" effect. The `JSL CODE_queue_dma_4args : dl $7E5040,$703372 : dw $0348`
that follows each FXCODE call is the queued DMA back to VRAM
($703372 is the staging area, $7E5040 is the inline DMA descriptor
constructor in the queue).

### 2.3 The `$0E` shadow byte and bit conventions

Bank06's five boos (Dangling, both caged, both platform) all share
a "shadow state byte" convention: at the start of every Main they
do `LDA EXRAM_*_GenericTable701902,x / STA $0E` and at the end
`LDA $0E / STA EXRAM_*_GenericTable701902,x`. The byte is treated
like a packed flag word during the frame:

- **low nibble** -- a small sub-state number (0..F) used by per-
  variant dispatchers.
- **bit `$0010`** -- "lunge / kidnap-armed" flag. Set when the boo
  is in striking range; consumed by the contact handler that calls
  `CODE_06BEF1` (the baby-Mario detach routine) + plays sound 0x3D
  (`MarioKidnapped`).
- **bit `$0200`** -- "in-cage / hidden render" flag. Used by both
  caged-ghost variants.
- **bit `$0400`** -- "cage damage" flag. Set when an egg has cracked
  the cage open; cleared on respawn.
- **bit `$0800`** -- "star-Yoshi pass-through" flag. Tested against
  `$0078` (`RAM_YI_Level_StarTimerLo`); when invincibility is active
  the ghost stops the lunge.
- **bit `$4000`** / `$8000` -- per-sprite transient flags (e.g., fort
  ghost uses `$8000` for "first-frame-of-state".

So when the asm reads `LDA $0E / BIT #$0010` mid-handler, that's the
"Yoshi-in-range" check; `BIT #$0800` is the "star-blocked" check.
Same convention in all five Bank06 boos.

### 2.4 Off-screen despawn band

Every Bank06 boo Main has the same off-screen guard pattern just
before the per-state dispatcher:

```
LDA $7680,x  CLC : ADC #$0090
CMP #$0220 : BCS .despawn
LDA $7682,x  CLC : ADC #$00C8
CMP #$019A : BCC .despawn      ; bands differ per sprite
JSR <per-state body>
.despawn:
    JSL CODE_03A31E    ; free slot
```

The `+$0090` / `+$00C8` constants form a generous off-screen window:
the ghost lives only while it's roughly within +/-$220 of camera-relative
zero in X and within $19A in Y. Outside that band the slot is freed
unconditionally -- ghosts don't respawn at scroll-back. (Contrast
with most enemies which can be re-spawned by the level loader.)

### 2.5 Sound usage

The family makes three distinctive sound effects, all pushed through
`CODE_push_sound_queue`:

- `!Define_YI_SoundID3D_MarioKidnapped` (`$3D`) -- played when a boo
  contacts Yoshi and ejects baby Mario. Dangling Ghost only plays
  this in the lunge handler at `$06:D284`.
- `!Define_YI_SoundID79_HurtGhost` (`$79`) -- played when an egg-hit
  forces the round caged ghost out of its idle (`$06:E14F`).
- `!Define_YI_SoundID3B_Pop` (`$3B`) -- played when BooBalloon's
  balloon pops in its StompRt body (`$0C:C2EF`).
- `!Define_YI_SoundID34_BurtJump` (`$34`, the "jump" SFX) -- BooBlah
  uses this when state $0 expands to state $1 (`$0E:90F0`). The
  Burt-named SFX is shared as a generic "soft jump" sound.

---

## 3. Per-sprite breakdown

### 3.1 $010 RoundedCagedGhost (Bank06)

A Boo sealed inside a circular cage that periodically spits a Shy
Guy at Yoshi. The cage is the visible thing; the Boo is the
projectile-source. Egg hits crack the cage and free the Boo (which
then despawns rather than turn into a free-floating $071 BigBoo --
caged ghosts are one-shot encounters).

Init at `$06:E02B`:

```
init_caged_ghost_round:
    LDA #$0020 : STA $18,x                ; cage scale (initial)
    LDA #$0118 : STA $76,x                ; cage scale target
    LDA #$0003 : STA EXRAM_..._701902,x   ; $0E shadow = $0003 (sub-state $3)
    LDA #$0008 : STA $7A96,x              ; per-frame anim pace
    LDA #$0008 : STA $16,x                ; secondary counter
    RTL
```

Main at `$06:E047` runs five subroutines in sequence:

1. `CODE_06E42F` -- per-frame cage SuperFX render.
2. `CODE_06E48B` -- shy-guy projectile spawning + dispatch.
3. `CODE_06E0A5` -- cage cap renderer (Y-offset paint into OAM page
   `$6000+`).
4. Off-screen guard + `JSL CODE_03AF23` (standard gravity/OAM refresh).
5. `CODE_06E123` -- dispatches through 5-entry state ptr.

`DATA_caged_ghost_round_state_ptr` (`$06:E13B`, 5 entries):

| `$0E & $0F` | Handler | Role |
|-------------|---------|------|
| `$00` | `CODE_06E195` | **Idle.** Pick a random ambush direction from `DATA_06E145`; arm `$7AF8` for the next spit. |
| `$01` | `CODE_06E225` | **Damaged.** Cage shrinking after an egg-hit; on size-zero free the slot. |
| `$02` | `CODE_06E258` | **Pre-spit.** Set up the shy-guy spawn position; ASL the cage open-angle. |
| `$03` | `CODE_06E274` | **Spit.** Calls `CODE_spawn_sprite_init` for `!Define_YI_NorSpr01E_Shyguy`; positions the shy-guy at the cage center; transfers Y-velocity. |
| `$04` | `CODE_06E2A2` | **Cool-down.** Wait for `$7A98` to elapse then return to `$00`. |

The cage-render subroutine (`CODE_06E102` + `CODE_06E0DD`) walks 12
OAM entries off `$7362,x` and applies an X-offset of `$FFF8` from the
SuperFX result + Y-offset of `$7044C8 + $0010`. So the "cage" is
really 12 OAM tiles fanned around a center point, not a static map16.

`CODE_06E147` is the egg-hit reactor: tests `$0E` bit `$0800`; on hit,
shrinks `$18,x` by `$20`, clamps to `$30`, marks `$0E` low bits to
the damaged state $1, and plays sound `$79` (HurtGhost). It also
samples a target X-delta from `EXRAM_YI_Player_XPosLo - $70E2,x` to
choose the spit direction (`DATA_06E145 = {$00, $02}`).

**Surprising detail**: the round caged ghost uses SuperFX
`FXCODE_0991DB` + `FXCODE_0991D5` (in `CODE_06E1CD`) as line-of-sight
probes against Yoshi. These are the same FXCODE entries the goal-ring
intersection uses; here they're being repurposed to "is there a clear
line for the spit". The result is in `!REGISTER_SuperFX_R6_MultiplierLo`
and gates whether the spit fires this frame.

### 3.2 $016 BiggerBoo (boss, Bank04) -- cross-reference only

World 1-4 castle boss. Kamek casts a "grow" spell on a small Boo
which then enlarges into a massive rotating Boo that chases Yoshi.

Documented in detail in `docs/bossengine.md` (boss table row); the
full state machine lives at `Bank04.asm:6940-8200`. Headline facts
relevant for the family:

- **Init dispatch table** at `DATA_bigger_boo_init_ptr` (`$04:B350`,
  2 entries): `CODE_04B363` = fresh-spawn (Kamek-cinematic), `CODE_04B467`
  = growing-resume.
- **Main dispatch table** `DATA_bigger_boo_state_ptr` (`$04:B4DA`,
  8 entries, named `CODE_bigger_boo_state_00_spawn_appear` through
  `CODE_bigger_boo_state_07_post_defeat`).
- **State $03 facing-away invincible**: Main tests `LDY $76,x / CPY #$03 / BEQ` and
  skips the normal sprite-update -- when BiggerBoo is facing away
  from Yoshi it cannot be hit. This is the same "shame-Boo" mechanic
  that the $071 BigBoo uses at a smaller scale (§3.4).
- **StompRt** aliased to `head_bop_common` -- boss must be killed by
  egg hits during state $02 (chase).

See `docs/bossengine.md` for the full state-by-state breakdown.

### 3.3 $057 SewerGhostWithPlatform (Bank06)

A Boo carrying a rideable platform. The sewer-BG variant. Yoshi
stands on the platform and gets carried around the room. The Boo
itself is the platform-mover; the platform is rendered separately
via SuperFX mask.

Init at `$06:F08F`:

```
init_platform_ghost_sewer:
    LDA $70449E (cam Y-base)
    CLC : ADC $70E2,x : ADC #$0018
    STA EXRAM_..._7019D6,x          ; remembered Y-anchor (rest)
    LDA $7044A8 (cam X-base)
    CLC : ADC $7182,x : SBC #$0008
    STA EXRAM_..._7019D8,x          ; remembered X-anchor (rest)
    LDA #$0600 : STA $18,x          ; ghost "size" / blit scale
    STZ $7400,x                     ; facing
    STZ EXRAM_..._701900,x          ; secondary state
    STZ EXRAM_..._701902,x          ; primary $0E shadow
    STZ $7A96,x  STZ $7A98,x
    RTL
```

Main at `$06:F0C2` is the standard four-subroutine chain plus
`JSL CODE_03AF23`:

1. `CODE_06F0EF` -- SuperFX `FXCODE_08E800` mask blit. The
   `DATA_06F40B` graphics blob is uploaded via
   `!REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo`; the result is
   DMA'd to `$703372` and HDMA'd to the BG layers.
- `CODE_06F1A4` -- `$18,x` scale animation (cycles through 16-pixel
  steps; resets at $0D00).
- `CODE_06F1C6` -- platform mask via `FXCODE_08EB9D` (eight-table
  picker over `DATA_06F3EF`).
- `CODE_06F23F` -- per-frame Yoshi-overlap test that arms the
  "carrying Yoshi" flag bits in `$7400`.

The platform position is *computed* from the ghost's anchor by
applying a sinusoidal offset (`DATA_06F23B = {$FF80, $0080}` -- a
+/-$80 per-frame X-jitter table indexed by `$7400 & $0002`). The
`$7A36` accumulator is the phase angle.

This sprite spawns an `!Define_YI_AmbSpr1BA` ambient sprite on first
frame (`CODE_06F32B`) -- the "rest position" anchor that pins the
ghost to its initial level-data position even after several seconds
of motion. The `$7A96` timer is set to `$002E` after the spawn so
the anchor isn't double-spawned.

The translucent-Boo rendering (§2.2) is set up at `$06:F15E` after
the SuperFX call: BG3 main-screen disable + sub-screen enable +
color-math + HDMA channels `$08` and `$10`.

### 3.4 $071 BigBoo (Bank0C)

A massive Boo with a 13-segment trailing body. Each segment is a
small Boo OAM block that lags behind the head's position; the tail
gives the impression of a vapour stream. BigBoo has the iconic
"covers eyes when looked at" behaviour, doubled with movement: it
only chases Yoshi while Yoshi is looking away.

Init at `$0C:D4F5`:

```
init_big_boo:
    SEP #$20
    LDA $70E2,x  AND #$10  LSR LSR LSR  STA $76,x   ; bit-4 of X-pos picks variant
    REP #$20
    BNE .followup
    ; bit-4 of X clear -> primary BigBoo:
    TXY  LDX #$0C
    LDA $0CC4                              ; level-wide BigBoo flag bank
.find_slot:
    BIT DATA_0CD4C3,x                      ; { $0001, $0002, $0004, $0008, $0010, $0020, $0040 }
    BEQ .have_slot
    DEX DEX
    BPL .find_slot
    TYX
    JML CODE_03A31E                        ; bail -- no BigBoo slot
.have_slot:
    SEP #$20  TXA  TYX  STA $18,x  REP #$20
    JSR CODE_0CD6A2                        ; tail-spawn
    RTL
```

This is **the only sprite in the family that uses a level-wide flag
bank to limit instances**. `$0CC4` is a 7-bit field at WRAM that
tracks which of seven BigBoo "slots" is alive; the init walks the bit
positions and picks the lowest free one. If all 7 are taken, the
slot is freed via `CODE_03A31E`. The 13-segment tail is then
spawned (each segment lives in the `$7E5DA6+` extension space,
indexed by the slot bit via `DATA_0CD4DF`).

**The `.followup` (bit-4-of-X set) branch.** The Init code above derives
`$76,x` from pixel-X bit-4 (`$70E2 AND #$10`): bit clear -> `$76 = 0`
(the primary path traced above); bit set -> `$76 = 2` and `BNE .followup`
into `CODE_0CD525` (`$0C:D525`). That branch is a **spawn-position render
variant** keyed by the *other* axis: it reads pixel-Y bit-4 (`$7182 AND
#$10`) as a 0/2 index into two 2-entry tables and rewrites the OAM
render-control pair:
- `DATA_0CD4ED` (`dw $FFFF,$FFE0`) is AND-masked into `$6FA0,x`. On an
  even row (`$FFFF`) it is a no-op; on an odd row (`$FFE0`) it clears
  `$6FA0`'s low-5 bits -- the **OAM draw-sub-priority subfield** (the same
  `AND #$FFE0` idiom `head_bop_common` and `spr_state_die_burning` use to
  "lower draw priority"; family-spikes.md §… documents the sibling
  `$6FA2` low-5 as the "OAM sub-priority subfield").
- `DATA_0CD4F1` (`dw $2005,$0804`) is merged into `$7040,x` (`AND #$07F0 :
  ORA`), the OAM tile/anim template word.

So an X-bit-4-set BigBoo's OAM draw attributes (sub-priority + tile
template) flip with its Y-row parity. **Caveat / open question:** this
branch leaves `$76 = 2`, and the Main state table (below) routes `$76 =
2` straight to the despawn handler `CODE_0CD926`. So statically the
followup config sets render attrs and then frees its slot on the next
off-screen check; its practical role (a decorative/secondary BigBoo, or a
config no shipped level actually places) needs a level-data / runtime
check to confirm.

Main at `$0C:D545` dispatches a **2-entry primary state ptr**:

`DATA_big_boo_state_ptr` (`$0C:D54B`, 2 entries):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CD54F` | **Active.** Per-frame full update: gravity, body update, then dispatch one of three facing sub-states. |
| `$02` | `CODE_0CD926` | **Despawning.** Off-screen handler; clears the flag bit in `$0CC4` and frees the slot. |

Inside state $00, secondary dispatch on `$77,x`:

`DATA_big_boo_facing_substate_ptr` (`$0C:D569`, 3 entries, Yoshi facing-toward sub-states):

| `$77,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CD5FD` | **Advance.** Yoshi is facing away -- BigBoo charges. SuperFX `FXCODE_09907C` computes the angle-to-Yoshi and writes velocity components to `XSpeedLo` / `YSpeedLo`. |
| `$02` | `CODE_0CD56F` | **Cover.** Yoshi is facing toward -- BigBoo halts and "covers eyes"; freezes velocity + cycles between frames $00 and $01 randomly. |
| `$04` | `CODE_0CD5CE` | **Pause.** Just-transitioned-to-cover; runs a `$77C0,x` countdown then arms 4 anim timers ($7A96/$7A98/$7AF6/$7AF8 = {$04, $08, $0C, $10}). |

And a **3-entry back-facing sub-state** when state $02 is selected
(`DATA_big_boo_back_substate_ptr` at `$0C:D936`): drift / charge /
pause -- symmetric to the facing-toward set.

The "is Yoshi facing me" check is `$77C2,x AND #$00FF / CMP $7400,x`
and a separate `CMP $60C4` (`$60C4` is the global Yoshi-face-cache).
Both must match for the cover state to engage.

The 13-segment tail update lives in `CODE_0CD6A2`: each tail segment
is identified by its bit-index into `$0CC4` (re-used as the slot
identifier) and a 4-byte stride within `$7E5DA6+`. Per frame, each
segment's position is copied from `$70E2,y / $7182,y` (the head's
position) to the segment's slot offset. The tail "lags" because the
copy is staggered by `$7A98` ticks.

### 3.5 $090 DanglingGhost (Bank06)

Sewer-ceiling Boo Guy hanging from a stretchy filament. Performs a
pendulum swing; on Yoshi-overlap, snaps down and kidnaps baby Mario.

Init at `$06:D1A1`:

```
init_dangling_ghost:
    LDA #$4000 : STA $18,x          ; pendulum amplitude (initial)
    LDA #$2000 : STA $76,x          ; pendulum phase (mid-arc)
    LDY #$00
    LDA $70E2,x  SEC : SBC $611C    ; ghost-X minus camera-X
    BMI .left_side
    LDY #$02
.left_side:
    LDA DATA_06D19D,y               ; { $0400, $FC00 } -- initial swing direction
    STA $78,x
    STZ $7A36,x
    STZ EXRAM_..._701902,x          ; $0E shadow cleared
    STZ $7AF6,x
    RTL
```

The pendulum picks its initial swing-direction by which side of the
camera the ghost is on -- this avoids the "ghost swings off-screen"
look on first frame. The swing-Y-velocity is +$0400 or -$0400, which
combined with the `$78,x` accumulator gives a 60-frame full swing.

Main at `$06:D1C7` runs four subroutines + standard gravity. The key
ones:

- `CODE_06D2AC` -- the **pendulum-segment renderer**. Walks 18
  filament beads (the visible "string") from
  `DATA_06D2E3` (an 18-pair signed table); each pair `(dx, dy)`
  is stored to `$7049C6,x` / `$7049C8,x` (the SuperFX
  scratch table offsets). The +ASL'd indices target alternating
  scratch slots -- 18 beads share two scratch banks.
- `CODE_06D307` -- a per-frame SuperFX call to `FXCODE_0B8595`.
  The Multiplier register gets `$76,x` (current phase), and the
  result feeds into a +/- delta added to every bead via the
  `CODE_06D33A` loop. This is the actual pendulum math: SuperFX
  does the cos/sin in hardware, the SNES side just applies the
  output deltas.
- `CODE_06D234` -- **lunge / kidnap logic**. Tests `$61B2` (Yoshi-
  vulnerable flag) and `$0E & $0010` (lunge-armed). On lunge:
  shifts ghost X by `$7049EA + DATA_06D230[direction]`; teleports
  the ghost down by `$7049E8 + $0070`. Then `JSL CODE_06BEF1`
  (baby-Mario detach), set sound `$3D` (MarioKidnapped). The lunge
  is the only kidnap path for this sprite.
- `CODE_06D297` -- **star-Yoshi pass-through**: tests
  `RAM_YI_Level_StarTimerLo`; while invincibility is active, sets
  `$0800` and clears `$0410` in `$0E` so the ghost stops the
  lunge but keeps swinging.

**Surprising detail**: the filament is **rendered, not collision-
tested**. Yoshi can walk under the dangling rope all day and nothing
happens; the kidnap is gated on the ghost's bbox alone (CMP +
`#$00C8`). The rope is for visual identification, not hitbox.

### 3.6 $0D6 FortGhostWithPlatform (Bank06)

The fort/castle BG variant of $057. Same idea -- Boo carries a
rideable platform -- but uses different SuperFX paths and a more
elaborate state machine, presumably because the fort areas have more
elaborate level layouts (slopes, narrow corridors).

Init at `$06:E517`:

```
init_platform_ghost_fort:
    LDA #$0100 : STA $18,x          ; sway amplitude
    LDA #$0040 : STA $76,x          ; initial state byte (matches $7019D6)
              ; (note: this is a 16-bit STA so it also writes $77,x)
    STA EXRAM_..._701900,x          ; mirror to shadow
    STZ EXRAM_..._7019D8,x
    STZ $16,x
    LDA #$8000                      ; "first frame" flag
    STA EXRAM_..._701902,x          ; $0E shadow with $8000 set
    RTL
```

Main at `$06:E530` runs:

1. `CODE_06E562` -- per-frame `FXCODE_0ACE2F` invocation (water-tile
   bottom-probe; here repurposed for ceiling-distance) + result is
   ORed into `$0E` as bit `$0002` for "blocked above".
2. `CODE_06E65D` -- state-table dispatcher (`DATA_platform_ghost_fort_state_ptr`).
3. `CODE_06E58E` -- off-screen guard + main-screen blit setup. Bypass
   the SuperFX call if off-screen (`$7680 + $28 >= $150`).
4. `CODE_06E7E0` + `CODE_06E85A` -- Yoshi-overlap test, platform-attach.
5. `JSL CODE_03AF23` (gravity), then re-apply `$0E` shadow.
6. `CODE_06E894` -- final position writeback to platform anchor.

`DATA_platform_ghost_fort_state_ptr` (`$06:E627`, 13 entries x 2
words each = (handler, arg) pairs). The state byte `$78,x << 2`
indexes the table; when the handler entry is `$0000` the dispatch
wraps to entry 0 with the `$8000` "first frame" bit set in `$0E`.

| Entry | Handler | Role |
|-------|---------|------|
| 0 | `CODE_06E6D1` | **Init.** Arm `$7A96 = $F0`, set anim frame $02. |
| 1, 5, 9 | `CODE_06E708` | **Drift left.** X-velocity = `$0180`; facing = left. |
| 2, 6, 10 | `CODE_06E760` | **Pose A** (idle, anim $00). |
| 3, 7, 11 | `CODE_06E7BB` | **Float pause.** Wait for `$7A96` and read camera. |
| 4, 8, 12 | `CODE_06E78C` | **Drift right.** Symmetric. |

The (handler, arg) format is unique among the boos -- each entry pair
is 4 bytes (a `dw handler` + `dw arg`). The arg is loaded into `$18,x`
(amplitude) at dispatch. This lets one handler do all the symmetric
direction work without explicit branch logic. The state index wraps
around the 13 entries by going back to entry 0 and setting `$0E |= $8000`.

The bob frame-table `DATA_06E692` (11 entries, picked by `$7A98 >> 1`)
sequences the platform's idle wiggle: frame $00 → $01 → $02 → $01
→ $02 → $00 → $00 → $01 → $02 → $01 → $02.

Translucent-Boo setup (§2.2) is at `$06:E5DE` -- BG3 + color-math +
HDMA channels `$08` and `$10`.

### 3.7 $0E2 BooBlah + $0E3 BooBlahWithPiroDangle (Bank0E)

Two sprite IDs sharing every byte of code. The Init handler is one
body labelled by both IDs:

```
YI_NorSpr0E2_BooBlah_Init:
YI_NorSpr0E3_BooBlahWithPiroDangle_Init:
init_boo_blah:
    LDY $7400,x : LDA DATA_0E8E8D,y      ; X-speed by facing { $FF80, $0080 }
    STA EXRAM_..._XSpeedLo,x
    LDA $70E2,x  AND #$0010  LSR x4
    PHP : INC : STA $00 : PLP            ; carry = bit-4 of $70E2
    BEQ .normal_orientation
    ; Inverted (ceiling-mounted) BooBlah:
    LDA $7042,x  EOR #$00C0  STA $7042,x  ; flip OAM V-flip bit
    LDA $7182,x  DEC : AND #$FFF0 : ORA #$000F : STA $7182,x  ; snap to tile bottom
    LDA $75E2,x  EOR #$FFFF : INC : STA $75E2,x               ; invert Y-velocity
    LDA $7400,x  EOR #$0002  STA $7400,x                      ; flip facing
.normal_orientation:
    LDA EXRAM_..._SpriteID,x
    SEC : SBC #!Define_YI_NorSpr0E2_BooBlah    ; 0 for $0E2, 1 for $0E3
    ASL : ASL                                  ; 0 or 4
    PHP : CLC : ADC $00                        ; add orientation bit (0/1)
    STA EXRAM_..._701902,x                     ; $0E shadow with $0..$5
    PLP
    BEQ .no_piro_partner
    ; $0E3 only: spawn the piro dangle partner
    LDA #$0076                                 ; sprite ID for Piro Dangle
    JSL CODE_spawn_sprite_active
    BCS .have_partner
    LDA #!Define_YI_NorSpr0E2_BooBlah
    STA EXRAM_..._SpriteID,x                   ; demote to plain $0E2 on failure
    BRA .no_piro_partner
.have_partner:
    STY $18,x                                  ; remember partner slot
    ; copy position + setup partner state ...
.no_piro_partner:
    LDY #$03 : STY $16,x
    RTL
```

This is the **most elegant variant-encoding in the family**:
`SpriteID - $0E2` produces {0, 1} which is ASL'd twice for {0, 4}
and added to a 0/1 ceiling-bit to form the initial $0E shadow:

- $0 = $0E2 on floor
- $1 = $0E2 on ceiling
- $4 = $0E3 on floor (with piro partner)
- $5 = $0E3 on ceiling (with piro partner)

Two sprite IDs x two orientations = 4 combinations, all dispatched
through one `$0E` shadow. The partner spawn for $0E3 is conditional
on a slot being free; if no slot is available the sprite is silently
demoted to a plain $0E2.

`DATA_boo_blah_state_ptrs` (`$0E:8F2E`, 7 entries):

| `$76,x >> 1` | Handler | Role |
|--------------|---------|------|
| 0 | `CODE_0E90D8` | **Idle expand.** Cycle anim frames $0..$3 via `DATA_0E90D4`; on expiry (cycle complete, `$16,x` decremented to 0) play sound `$34`, halt X-velocity, advance to state 1. |
| 1 | `CODE_0E9138` | **Expanded bob.** 21-frame anim run from `DATA_0E910E`; on completion go back to state 0 (re-contract). |
| 2 | `CODE_0E9194` | **Hit-by-egg / shrink.** Picks per-frame anim from `DATA_0E917E`; on `$76,x == 2` resets and advances. |
| 3 | `CODE_0E916E` | **Touch-recovery.** Continuation of state 2 after a soft touch; jumps to state 5 (despawn). |
| 4 | `CODE_0E9194` | **(same handler as 2)** -- additional state index for sequence step. |
| 5 | `CODE_0E91E0` | **Death animation.** Plays a falling-and-shrinking sequence; arms Y-velocity from `DATA_0E91F0` (11-entry deceleration table). |
| 6 | `CODE_0E9206` | **Final pop.** Sets `$60AA = DATA_0E91F0[$7A38 << 1]` to kick Yoshi up, then resets. **Also handles `$0E3`'s piro-dangle despawn** by walking `$18,x` and clearing the partner's flags. |

The `$0E3` variant's piro-dangle is despawned in main at
`$0E:8FAB` when the partner's `$7019D6 >= 5` (which is the piro's
"detached" sub-state). This is the only cross-sprite slot link in
the entire family -- BooBlah-with-piro is two slots, two main
handlers, glued by `$18,x` on the boo side and an opaque
`!EXRAM_YI_Level_NorSpr_GenericTable701900` reference on the piro
side.

### 3.8 $10F BooManBluff (Bank05)

Slope-skating Boo Guy. The only Boo that's actually mobile across
terrain; uses Yoshi's "is looking away" check (`$61F2`) to gate
visibility, just like BigBoo $071 but for the inverse purpose --
this one is *invisible* when seen, *visible* when not.

Init at `$05:DC74`:

```
init_boo_man_bluff:
    LDY $7400,x : LDA DATA_05DC6A,y       ; X-speed { $FFC0, $0040 }
    STA $75E0,x                            ; (slope-skid base velocity)
    LDA #$0006 : STA $7540,x
    LDY #$00
    LDA EXRAM_YI_Player_YPosLo
    CMP $7182,x                            ; Yoshi above the boo?
    BMI .higher_y                          ;   no -> Y idx = $00
    INY : INY                              ;   yes -> Y idx = $02
.higher_y:
    LDA DATA_05DC6E,y                      ; Y-velocity init {$0100, $FF00, $0100}
    STA $75E2,x
    LDA DATA_05DC6E+$02,y                  ; XSpeed step {$FF00, $0100}
    STA EXRAM_..._YSpeedLo,x
    LDA $7182,x                            ; remember slope-spawn Y
    STA EXRAM_..._701902,x                 ; $0E shadow holds anchor Y
    LDA #$0026 : STA $7042,x               ; OAM priority bits
    RTL
```

`DATA_boo_man_bluff_state_ptr` (`$05:DCA8`, 11 entries):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_05DF60` | **Invisible follow.** Sprite is rendered as fully transparent ($7402 = $7); tracks Yoshi at a fixed offset by computing `$70E2,x = $611C + ofs`. |
| `$01` | `CODE_05DF9B` | **Prep visible.** Becoming-visible animation. Arms `$7AF6` to dictate the transition cycle. |
| `$02` | `CODE_05DFCC` | **Become visible / charge.** Sets anim frame, starts X-velocity push. |
| `$03` | `CODE_05DFDE` | **Pursue Yoshi.** Sets target X to `$6EB2` (Yoshi X-target). Slope skid math here. |
| `$04` | `CODE_05E010` | **Pause / about-to-pounce.** Decel + anim-frame switch to "tense" pose. |
| `$05` | `CODE_05E027` | **Lunge.** Apply slope-skid X+Y vels from `$7C16` / `$7C18` divided by 8 (LSR x3). |
| `$06` | `CODE_05E04A` | **Post-lunge recover.** Set X-vel to 0; advance to state 7. |
| `$07` | `CODE_05E069` | **Prepare to vanish.** Anim frame = $05; arms `$7A98 = $04`; decrements visibility counter `$701900`. |
| `$08` | `CODE_05E087` | **Vanish-back-to-invisible.** Wait for `$701900` to hit 0; reset state to $00 (invisible). |
| `$09` | `CODE_05E0B3` | **Hit-stun.** Brief flash when Yoshi-egg lands; reuses state $07's anim. |
| `$0A` | `CODE_05E0DC` | **Defeat.** Falls off-screen with Y-vel $FC00; freeze X-velocity. |

The "Yoshi-looking-away" check is `$61F2 == 0` (test at `CODE_05DD27`).
On true (Yoshi not looking), the sprite **prepares to become visible**
by transitioning $76 from $00 → $07 → $08 → re-loop. On false
(Yoshi looking), the BooManBluff is in the loop $07 → $08 → $00. The
two paths cross every $30-ish frames on the visibility hand-off; in
practice this means the Boo appears for ~1 second whenever Yoshi
turns his back.

Distinctive bits:

- The slope-skid X-vels come from `$7C16` / `$7C18` (the per-frame
  X-collision response from `CODE_03AF23` -- ground normal in tile
  coordinates) rather than a static table. This lets the Boo
  actually slide on slopes.
- The post-lunge "recover" calculates a slope-adjusted X-position
  using `$6EB2` (Yoshi-x-target) vs `$70E2,x` and re-arms the
  approach.
- `$701900` is repurposed as the visibility-decrement countdown
  during state $08; once it hits zero the sprite is invisible again.

### 3.9 $193 SnakeCagedGhost (Bank06)

A Boo trapped inside a cage rigged to a snake-block train. The cage
itself isn't a real sprite -- it's a 6-pose rendering driven by the
snake-block's segment array, which means it moves wherever the snake
takes it.

Init at `$06:D9C0` is minimal:

```
init_caged_ghost_snake:
    LDA #$0000 : STA $6040            ; SnakeBlock track-X accumulator
    LDA #$0000 : STA $6042            ; SnakeBlock track-Y accumulator
    RTL
```

The init only clears the snake-block accumulators because the Boo's
position will be derived from them every frame. (No `$16,x` / `$18,x`
/ `$76,x` setup -- the snake block owns those.)

Main at `$06:D9CD` runs three subs + gravity:

- `CODE_06DA01` -- Per-frame cage-pose rendering. The `$18,x XBA AND
  $00FF ASL` picks one of 6 pose-pointer entries from `DATA_06DA55`
  (six 36-byte tables `DATA_06DA61..06DB6F`). Each entry is 18 (dx,dy)
  pairs that paint the cage outline; the rendered bytes are written
  to `$7049F6,x` / `$704B36,x` (the two SuperFX scratch banks for
  the snake-cage). The result is a cage that morphs through 6 visual
  poses as the snake-block train accelerates/decelerates.
- `CODE_06DBA5` -- SuperFX blit via `FXCODE_08E8CA`. Triggers the
  translucent-Boo setup (§2.2) and DMA's the rendered cage into BG3.
- `CODE_06DC4D` -- Per-frame OAM pose paint (12 OAM entries off
  `$7362,x`).
- `CODE_06DC84` -- Off-screen guard + status update.

`DATA_06DA55` is the **6-pose dispatch table** -- (table, table) pairs
that feed the per-frame `$00` / `$02` pair into the cage-paint loop.
The six pose tables are 54 bytes each; visually they capture
"cage closing tightly" (`DATA_06DA61`) through "cage wide open"
(`DATA_06DB6F`) by progressively widening the corner offsets.

The Boo itself is invisible during normal play (rendered only inside
the cage). On egg-hit, the dispatching code at `CODE_06D91A` (called
from `$06:D9F8`) frees the cage and sets the slot's `$78,x` field
to redirect through `CODE_03B25B` (detach + cleanup) which marks
the cage as "broken" and despawns.

### 3.10 $1AB BooBalloon (Bank0C)

A Boo floating inside a balloon. Hovers in air drifting toward Yoshi;
egg-hits pop the balloon and spawn one of three enemies. Has its own
StompRt body (the only one in the family).

Init at `$0C:BE98`:

```
init_boo_balloon:
    LDA #$0001 : STA $0C7E             ; "Boo Balloon is alive" global flag
    LDA DATA_0CBE8C : STA $75E0,x      ; { $0100, $FF00 }  -- X drift
    LDA #$0008 : STA $7540,x
    LDA DATA_0CBE88 : STA $75E2,x      ; { $0100, $FF00 }  -- Y drift
    LDA #$0008 : STA $7542,x
    LDA #$0090 : STA $16,x             ; size (current balloon scale)
    LDA $70E2,x  AND #$0010  LSR x3
    STA EXRAM_..._701900,x             ; pop-payload selector (bit-4 of spawn-X)
    SEP #$20
    STZ $76,x                          ; main state
    REP #$20
    RTL
```

`DATA_boo_balloon_phase_ptr` (`$0C:BF8F`, 4 entries):

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CBF9D` | **Intact.** Standard hover + drift. |
| `$02` | `CODE_0CBFA6` | **Popping.** Balloon-scale expands from $90 to $E0; on full, INC `$78,x`, on second pass shrinks back to $CC. |
| `$04` | `CODE_0CBFD6` | **Shrinking.** Balloon size expanded toward $0120; on completion (`$78,x` non-zero), shrinks toward $0100. |
| `$06` | `CODE_0CC006` | **Despawn.** Final frame; clear `$0C7E` flag. |

`DATA_boo_balloon_drift_substate_ptr` (`$0C:BF97`, 3 entries):

| `$77,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CC11F` | **Free drift.** Random small wobbles via `$7400` XOR cycle. |
| `$02` | `CODE_0CC156` | **Approach Yoshi.** Sets X-vel toward Yoshi. |
| `$04` | `CODE_0CC1AA` | **Pursuit.** Tighter Y-tracking; pivots when Yoshi is below. |

`YI_NorSpr1AB_BooBalloon_StompRt` at `$0C:C2A4` is the unique custom
StompRt body in the family. Steps:

1. Render the (now popping) balloon via `FXCODE_0898C1`.
2. Play `!Define_YI_SoundID3B_Pop`.
3. `JSL CODE_04849E` (the "balloon-pop particle effect" routine).
4. `JSL CODE_despawn_sprite_free_slot` (clear the slot).
5. Read `$701900,x` (the pop-payload selector); dispatch through
   `DATA_boo_balloon_pop_payload_ptr` (2-entry table).

`DATA_boo_balloon_pop_payload_ptr` (`$0C:C306`):

| Selector | Handler | Role |
|----------|---------|------|
| `$00` (bit-4 clear) | `CODE_0CC32B` | **Spawn a $115 coin** -- the gift balloon. |
| `$02` (bit-4 set) | `CODE_0CC30A` | **Spawn a $09D head-bonk effect** + position the bonk where the balloon was. |

And the *real* payload pick happens further on -- the routine
`CODE_0CC842` looks at `$70:0006,X` (a per-slot "linked" word) and
walks `DATA_0CC83C` (3 entries: `!Define_YI_NorSpr13E_FlyingFang`,
`!Define_YI_NorSpr108_Milde`, `!Define_YI_NorSpr01E_Shyguy`) using
the low bits of `$10` (a frame-timer entropy source) to pick which
of the three to spawn. So **the balloon can produce four different
outcomes**: gift coin, no-coin pop, or one of three enemies, chosen
by a combination of spawn-X bit-4 and the frame-counter low bits at
pop-time.

`$0C7E` is a level-wide "any Boo Balloon present" flag tested in the
Boo Balloon main update routines (`CODE_0CBF21`, `CODE_0CC220`,
`CODE_0CC275`). It's set to 1 by every BooBalloon Init and cleared
when the balloon despawns -- letting other sprites in the level know
"there's still a balloon up". The exact downstream consumer is
unclear (see open questions).

---

## 4. Cross-bank shared infrastructure

### 4.1 SuperFX entry points used

| FXCODE | Where called | Purpose |
|--------|--------------|---------|
| `FXCODE_0898C1` | `$0C:BF15` (BooBalloon Main), `$0C:C2DD` (BooBalloon StompRt) | Balloon graphic blit. |
| `FXCODE_08E800` | `$06:F178` (SewerGhostWithPlatform main) | Sewer-Boo mask blit. |
| `FXCODE_08E8CA` | `$06:DBE7` (SnakeCagedGhost main) | Snake-cage cage blit. |
| `FXCODE_08E93B` | `$06:E605` (FortGhostWithPlatform main) | Fort-Boo blit. |
| `FXCODE_08EB9D` | `$06:F20A` (SewerGhostWithPlatform platform-mask) | Platform mask. |
| `FXCODE_0991D5` / `FXCODE_0991DB` | `$06:E1DA`/`$06:E1FF` (RoundedCagedGhost) | Line-of-sight probes. |
| `FXCODE_09907C` | `$0C:D689` (BigBoo facing-substate), `$0C:D9E5` (BigBoo back-substate) | Angle-to-Yoshi math + velocity components. |
| `FXCODE_0ACE2F` | `$06:E56C` (FortGhostWithPlatform), and §4 of `docs/family-clouds.md` for other callers | Ceiling/water-tile probe (bottom-distance). |
| `FXCODE_0B8595` | `$06:D318`, `$06:D356` (DanglingGhost) | Pendulum cos/sin math. |
| `FXCODE_0B86B6` | `$0E:9085` (BooBlah) | Per-frame piro-dangle X-offset. |

The four mask blits (`08E800`, `08E8CA`, `08E93B`, `08EB9D`) and the
two angle/LOS pairs (`0991D5/0991DB`, `09907C`) are the family's
"signature" SuperFX use. Most other enemies render via map16 + OAM
copy; ghosts uniquely need SuperFX to layer their translucency on top
of the BG. See `docs/mchip.md §1` for the underlying SuperFX
architecture.

### 4.2 EXRAM slot fields

The 10 ghosts share a small set of EXRAM (slot extension) fields:

| Field | Used by | Meaning |
|-------|---------|---------|
| `!EXRAM_..._GenericTable701900,x` | `$010`, `$057`, `$0D6`, `$10F`, `$0E3` partner, `$1AB` | Per-sprite "state-shadow B" -- typically a secondary state byte or anchor reference. Reused as the pop-payload selector for $1AB. |
| `!EXRAM_..._GenericTable701902,x` | All 10 boos | **The `$0E` shadow.** Reloaded into `$0E` at the start of every Main and saved back at the end. Top half is flag bits (§2.3); bottom nibble is sub-state. |
| `!EXRAM_..._GenericTable7019D6,x` | `$057`, `$0D6`, `$0E3` partner | "Anchor Y" or partner sub-state. Bank06 uses it as the rest-Y for the platform ghosts; Bank0E uses it as the piro-dangle sub-state. |
| `!EXRAM_..._GenericTable7019D8,x` | `$057`, `$0D6` | "Anchor X" for platform ghosts. |
| `!EXRAM_..._XSpeedLo,x`, `_YSpeedLo,x` | All 10 boos | Standard velocity fields; updated by SuperFX or by handler math each frame. |
| `!EXRAM_..._CurrentStatus,x` | `$0E2`, `$0E3`, `$1AB` | Standard 9-state engine-side status byte; tested for `#$0010` to gate certain handler paths. |

### 4.3 WRAM globals

| Address | Used by | Meaning |
|---------|---------|---------|
| `$0C7E`  | `$1AB` BooBalloon | "Boo Balloon present in level" flag (Init=1, despawn=0). |
| `$0CC4`  | `$071` BigBoo | 7-bit BigBoo slot allocation bank. Each bit corresponds to one BigBoo instance; cleared when the BigBoo despawns. |
| `$0E` (DP) | All 10 boos | Per-frame shadow of `701902,x`. See §2.3. |
| `$60AA`, `$60C0`, `$60D2` | $0E2/$0E3 final pop | Standard "kick Yoshi upward" registers (also used by `head_bop_common`). |
| `$60C4` | `$071` BigBoo | Yoshi facing-direction cache; tested against `$77C2,x AND #$00FF` to confirm Yoshi is looking at the boo. |
| `$61F2` | `$10F` BooManBluff | Yoshi "is looking forward" flag; tested at `$05:DD27` to gate visibility transition. |
| `$61B2` | `$090` DanglingGhost | Yoshi-vulnerable / pinned flag; gates the kidnap lunge. |
| `RAM_YI_Level_StarTimerLo` | `$010`, `$090` | Star-power active flag; gates lunge/spit attacks. |
| `$6040` / `$6042` | `$193` SnakeCagedGhost | Snake-block train track accumulators (X/Y). |
| `!RAM_YI_Global_MainScreenLayers`, `_SubScreenLayers`, `_ColorMathInitialSettings`, `_ColorMathSelectAndEnable`, `_HDMAEnable` | $057, $0D6, $193 + non-family boss ghosts | The translucent-Boo write-block (§2.2). |

### 4.4 Spawn relationships

| Spawner | Spawnee | When | Mechanism |
|---------|---------|------|-----------|
| `$0E3` BooBlah-with-piro Init | `$076` ClockwisePiroDangle | First frame | `JSL CODE_spawn_sprite_active` + slot link via `$18,x`. |
| `$0E3` BooBlah Main (death) | (none) | piro $7019D6 >= 5 | Despawns linked piro slot. |
| `$010` RoundedCagedGhost state $03 | `$01E` Shyguy | "Spit" sub-state | `JSL CODE_spawn_sprite_init`; positions shy-guy in cage center. |
| `$016` BiggerBoo state $00 | `$048` (boss cinematic effect) | Spawn / first-appear | `JSL CODE_spawn_sprite_init`. |
| `$057`/`$0D6` PlatformGhosts | `$1BA` AmbSpr (rest anchor) | First frame | `JSL CODE_spawn_ambient_sprite`. |
| `$1AB` BooBalloon StompRt path A | `$115` Coin | Pop with bit-4 clear | `JSL CODE_spawn_sprite_init`. |
| `$1AB` BooBalloon StompRt path B | `$09D` head-bonk | Pop with bit-4 set | `JSL CODE_spawn_sprite_init`. |
| `$1AB` BooBalloon late-pop dispatch | `$13E` FlyingFang or `$108` Milde or `$01E` Shyguy | Per frame entropy in `$10` | `DATA_0CC83C` 3-entry lookup. |

**Cross-family observation**: only one in-scope boo (BigBoo $071) is
*receivable* from another spawner -- but actually it isn't:
`$0CC4`-managed BigBoos are spawned only by the level-data sprite list.
The family has no winged-cloud/bucket/zeppelin "produces a Boo"
analog of the Bandit family's $0BC / $122 / $176 spawners. Boos appear
only directly from level data, and they can spawn things (shy guys,
piro dangle, milde, flying fang, coin, head-bonk) but nothing spawns
them.

---

## 5. Variant-encoding patterns

The family uses three of the YI engine's standard variant-encoding
patterns:

**Pattern A: SpriteID-as-key.** `$0E2` / `$0E3` (`init_boo_blah`, §3.7).
`SpriteID - $0E2` produces {0, 1} which is ASL'd twice and added to a
0/1 orientation bit to form a 4-state initial $0E shadow. The most
elegant in the family.

**Pattern B: SpriteID-as-conditional-branch.** `$0E2` / `$0E3`
(`main_boo_blah`, e.g. `$0E:8FAB` `CMP #!Define_YI_NorSpr0E3 / BNE`).
Used to gate the piro-dangle despawn cleanup on $0E3 only.

**Pattern C: Shared label, fall-through Init.** $0E2 and $0E3 both
attach to `init_boo_blah` (`Bank0E.asm:1941-1942`):

```
YI_NorSpr0E2_BooBlah_Init:
YI_NorSpr0E3_BooBlahWithPiroDangle_Init:
init_boo_blah:
    ...
    RTL
```

Same for `_Main`:

```
YI_NorSpr0E2_BooBlah_Main:
YI_NorSpr0E3_BooBlahWithPiroDangle_Main:
main_boo_blah:
    ...
```

This is exactly the pattern used by the bandit family's hidden
variants ($020 / $0A3 / $0A4 sharing `main_bandit`).

The other Boo variants don't use these patterns -- each has its own
distinct Init and Main entry. The family is structurally fragmented
(no shared body across multiple banks) compared to bandits or shy-
guys. This makes sense given the variety: a caged Boo, a platform
Boo, a sniper Boo, and a balloon Boo have very different physics.

---

## 6. Common-thread observations

Reading all ten sprite bodies together, a few cross-cutting facts:

- **No "true Boo" exists in the family.** None of these is the
  free-floating, eye-covering, no-physics Boo that the Mario series
  is famous for. The closest is BigBoo ($071) -- which is enormous,
  multi-segmented, and only spawns one at a time -- and BiggerBoo
  ($016) -- which is the boss. YI deliberately doesn't have a
  generic Boo: every ghost in the game has a unique role.
- **Egg-hits are the universal weapon.** Stomp doesn't kill any
  in-scope sprite (all `_StompRt` are `head_bop_common` aliases or
  the BooBalloon's pop-only body). Eggs are the only way through
  except for the boss, which dies on egg hits via its own state
  machine.
- **SuperFX is non-optional.** Eight of the ten boos call into
  SuperFX every frame. The two that don't -- $0E2/$0E3 BooBlah -- are
  the "blob" variants that don't need translucency; they render via
  the normal map16+OAM path.
- **The kidnap mechanic is rare.** Only DanglingGhost ($090)
  routes to `CODE_06BEF1` (baby-Mario detach) + plays sound `$3D`
  (MarioKidnapped). The other ghosts that touch Yoshi mostly just
  bump him; the dangling ghost is the only "they take baby Mario"
  ghost in the family.
- **The "facing-away" shame mechanic is two-tier.** Both BigBoo
  ($071) and BooManBluff ($10F) gate behaviour on Yoshi's facing,
  but with *opposite* polarities: BigBoo *chases* when Yoshi looks
  away, BooManBluff *appears* when Yoshi looks away. BiggerBoo
  ($016) flips the polarity again -- it's *invincible* when facing
  away. So the family has three different applications of the same
  facing-cache (`$60C4` / `$77C2,x` / `$61F2`).
- **Slot-extension EXRAM use is heavy.** The $0E shadow (`$701902,x`)
  is reloaded/saved every Main on six of the ten boos. The "two
  scratch banks" pattern (`$7049C6+` and `$704B36+`) used by the
  pendulum and snake-cage rendering is unique to this family and
  the boss-tier ghosts in Bank04.

---

## 7. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs:
  `$010`, `$016`, `$057`, `$071`, `$090`, `$0D6`, `$0E2`, `$0E3`,
  `$10F`, `$193`, `$1AB`.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher.
- `docs/bossengine.md` -- contains the full BiggerBoo ($016) state
  machine.
- `docs/family-shyguys.md` -- covers the Boo-Guy sub-family (`$0103`,
  `$0105`, `$0106`, `$010D`, `$019A` -- shy-guys masquerading as
  ghosts).
- `docs/family-clouds.md` -- documents `FXCODE_0ACE2F` and shares
  the "ghost-spawned-from-cloud" speculation context (no cloud
  spawns a true Boo in YI, but the FXCODE is shared with cloud water-
  probe usage).
- `docs/mchip.md §4` -- the 65816<->SuperFX bridge; explains the FXCODE
  call convention used throughout this family.
- `yi/Banks/Bank04.asm:6940-8200` -- BiggerBoo ($016) Init/Main +
  8-state machine.
- `yi/Banks/Bank05.asm:12426-12700+` -- BooManBluff ($10F) Init/Main
  + 11-state machine.
- `yi/Banks/Bank06.asm:9277-9420` -- DanglingGhost ($090) Init/Main.
- `yi/Banks/Bank06.asm:10300-10550` -- SnakeCagedGhost ($193) +
  6-pose cage rendering tables.
- `yi/Banks/Bank06.asm:10970-11200` -- RoundedCagedGhost ($010) +
  5-state machine.
- `yi/Banks/Bank06.asm:11570-11850` -- FortGhostWithPlatform ($0D6)
  + 13-step (handler,arg) state table.
- `yi/Banks/Bank06.asm:13000-13400+` -- SewerGhostWithPlatform ($057)
  + ambient-sprite anchor.
- `yi/Banks/Bank0C.asm:8170-8800` -- BooBalloon ($1AB) full
  implementation including custom StompRt.
- `yi/Banks/Bank0C.asm:11080-11700` -- BigBoo ($071) Init/Main +
  facing/back substate tables.
- `yi/Banks/Bank0E.asm:1932-2400` -- BooBlah ($0E2/$0E3) shared
  Init/Main + 7-state machine.
- `yi/Banks/Bank03.asm:993-1404` -- ghost StompRt pointer entries
  (all aliases to `head_bop_common` except `$1AB`).
- `yi/Banks/Bank03.asm:4304` -- the shared `CODE_head_bop_common`
  body used by 9 of 10 boo StompRt entries.
- `yoshisisland-disassembly/disassembly/bank{04,05,06,0C,0E}.asm` --
  Raidenthequick's descriptive labels (`init_dangling_ghost`,
  `init_caged_ghost_round`, `init_platform_ghost`, `init_big_boo`,
  `init_boo_blah`, `init_boo_man_bluff`, `init_bigger_boo`,
  `init_boo_balloon`) -- all already mirrored as aliases in our
  asm at the same addresses.
- Parallel sibling reference: `ys_enmy*.asm` -- enemy-handler files
  carrying equivalent behaviours under different label conventions
  (consulted at file-name level only).

---

## 8. Open questions / follow-up

1. **`$0C7E` "Boo Balloon present" flag downstream consumer.**
   BooBalloon's Init sets `$0C7E = 1`; it's tested in its own Main
   (`CODE_0CBF21`, `CODE_0CC220`). Is anything outside the BooBalloon
   handler watching this flag? A grep of `yi/Banks/` finds no other
   readers, but the flag's persistence-across-frames pattern (set
   in init, cleared in despawn) suggests it was intended as a level-
   wide gate -- perhaps for a "freeze gravity while balloon exists"
   effect that didn't survive into V1.0.

2. **BigBoo `$0CC4` 7-bit cap.** Why exactly 7 slots? The 7-bit table
   `DATA_0CD4C3 = { $0001, $0002, $0004, $0008, $0010, $0020, $0040 }`
   could trivially be 8 bits (full byte). The constraint is likely
   tied to the segment-data layout (each BigBoo has 13 tail segments
   at `$7E5DA6 + slot * $0400`; 7 slots * $0400 = $1C00 bytes which
   fits in the extension bank). Confirm by checking the
   `$7E5DA6..$7E79A6` region against the segment-rendering math.

3. **FortGhost ($0D6) vs SewerGhost ($057) feature divergence.** The
   sewer variant uses `FXCODE_08E800`; the fort variant uses
   `FXCODE_0ACE2F + FXCODE_08E93B`. They are *visually* similar (Boo
   carrying platform) but the rendering paths are completely
   different. Is the fort variant's `FXCODE_0ACE2F` ceiling-probe
   handling slopes / overhangs that the sewer's flat-cave levels
   don't have? Or is the divergence purely cosmetic (palette /
   tileset variation)? A side-by-side capture in BizHawk of the
   two sprites at the same camera position would clarify.

4. **The piro-dangle composite ($0E3) -- two-sprite slot link.** The
   BooBlah-with-piro is two separate slots glued by `$18,x` (boo
   remembers piro slot) and an opaque
   `!EXRAM_YI_Level_NorSpr_GenericTable701900` reference (piro
   remembers boo). On boo death, the boo's main walks `$18,x` to
   despawn the partner. **What happens on piro-side death first?**
   (e.g., egg-hits the piro: is the piro's death path supposed to
   clear the boo's `$18,x` reference?) A grep of `$076` piro-dangle
   handlers in Bank0E for `$701900` writes would resolve this.

5. **BooManBluff slope skid via `$7C16` / `$7C18`.** The lunge math
   uses the per-frame collision-response vector from `CODE_03AF23`
   directly. This couples the sprite to slope geometry in a way no
   other in-scope boo does. Is this a one-off, or is there a
   shared "slope-aware enemy" pattern elsewhere in the codebase
   that uses the same fields? Spot-checking other Bank05 enemies
   for `$7C16` reads would clarify.

6. **Snake-Caged-Ghost ($193) 6-pose dispatch -- which is which?**
   The `DATA_06DA61..06DB6F` tables are 54 bytes each, and the
   dispatcher picks via `$18,x XBA AND #$00FF`. The selection
   pattern looks like "speed of the snake-block train" but the
   actual mapping from speed-band to pose-table isn't documented
   in the asm. A short BizHawk trace recording `$18,x` against
   snake-block velocity over a sample level would establish the
   mapping conclusively.
