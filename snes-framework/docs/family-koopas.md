# YI Koopa / Goomba family reference

Standalone reference for the Yoshi's Island Koopa / Goomba family --
the classic Mario-roster shell wearers and the lone walking mushroom-
foot that they share aesthetic real-estate with. Two Goomba slots
(one regular, the head-bop variant in its own state), four "shelled"
slots (Green / Red Koopa, Green / Red Naked Koopa), two "loose shell"
slots (Green / Red), and three Parakoopa variants (Green hopper,
Red horizontal cruiser, Red vertical cruiser) -- ten Init/Main pairs
total, all built on a tight cluster of shared bodies and four shared
helper routines in Bank07.

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  every entry here layers its own sub-state machine on top of.
- `docs/family-shyguys.md` -- the Koopa shelled / naked / Parakoopa
  cluster mirrors the Shy Guy walk-and-stomp pattern (different code,
  same observable feel). When in doubt about the "what does a 6-state
  walk/turn/fall/squash/kick/despawn machine look like in YI" pattern
  the Goomba's `DATA_goomba_state_ptr` is the cleanest reference.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank07.asm` (Koopa Shells $167/$168, Naked Koopas
$169/$16A, shelled Koopas $16B/$16C, all three Parakoopas
$16D/$16E/$16F, plus the four shared helpers `CODE_07E250`,
`CODE_07E2A1`, `CODE_07E303`, `CODE_07E336`/`CODE_07E35B` and the
on-stomp dispatcher `CODE_07E399`) and `yi/Banks/Bank0C.asm` (Goomba
$062 Init/Main/StompRt). Bank03 wiring + StompRt pointer-table entries.
Cross-verified against `yoshisisland-disassembly/disassembly/bank07.asm`
and `bank0C.asm` (Raidenthequick's descriptive labels: `init_goomba`,
`main_goomba`, `head_bop_goomba`, `init_koopa_shell`, `main_koopa_shell`,
`init_beach_koopa`, `main_beach_koopa` (= Naked Koopa), `init_koopa`,
`main_koopa`, `head_bop_koopa_naked`, `head_bop_koopa_green`,
`head_bop_koopa_red`, `init_parakoopa_green`,
`init_parakoopa_red_horizontal`, `init_parakoopa_red_vertical`,
`main_parakoopa_green`, `main_parakoopa_red_horizontal`,
`main_parakoopa_red_vertical`, `head_bop_parakoopa_green`,
`head_bop_parakoopa_red`) and the parallel sources `ys_enmy*.asm`.

---

## 1. Family at a glance

Ten sprites belong to the family across two banks. The shelled-Koopa
+ Parakoopa cluster is one of the most tightly fused groups in the
sprite engine: six Init labels collapse to two physical bodies; six
Main labels collapse to two physical bodies; two head-bop labels
share their body with the Koopa Shell head-bop body. The Goomba and
the Parakoopas sit on their own state machines but reuse the Koopa
helpers and (for the Goomba head-bop) reuse the family animation
tables.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$062` | `Goomba` | 0C | `$0C:8364` `init_goomba` | `$0C:8369` `main_goomba` | `$0C:858D` `head_bop_goomba` (own body) | The classic walk-turn-on-wall foe. 6-state main (walk / turn / fall / squashed / kicked / despawn) + 2-state head-bop (squish-anim / score-popup). |
| `$167` | `GreenKoopaShell` | 07 | `$07:D956` `init_koopa_shell` (shared with $168) | `$07:D964` `main_koopa_shell` (shared with $168) | `$07:E3C8` shared with $168 + Naked Koopa head-bop tail | Loose Koopa shell. Bounces, breaks Map16 blocks at impact corner, plays the 7-step ascending shell-impact sound chain, wakes back into a Naked Koopa after $7A36 cycles. |
| `$168` | `RedKoopaShell` | 07 | `$07:D956` shared | `$07:D964` shared | `$07:E3C8` shared | Red palette, V1.1-only OAM priority bit forced via `ORA #$0600` at top of `main_koopa_shell`. Otherwise byte-identical to $167. |
| `$169` | `GreenNakedKoopa` | 07 | `$07:DD52` `init_koopa_naked` (shared with $16A) | `$07:DDA1` `main_koopa_naked` (shared with $16A) | `$07:E3BD` `head_bop_koopa_naked` (shared with $16A; tails into the shell-stomp body) | The Koopa minus its shell -- what you get after stomping a $16B. 4-state main (walk / turn / on-shell-pickup / squashed). Uses GSU ground probe `FXCODE_08949D` for edge-stop. When near a stopped shell, sucks it onto its back via `CODE_07DE7F` (state $00 detection block). |
| `$16A` | `RedNakedKoopa` | 07 | `$07:DD52` shared | `$07:DDA1` shared | `$07:E3BD` shared | Red palette + 1 different SpriteID stop ($7A36 cycle initialised to $010A vs Koopa's $000A -- 256-frame initial respawn-shield) but the rest of the body is shared. |
| `$16B` | `GreenKoopa` | 07 | `$07:DD78` `init_koopa` (shared with $16C) | `$07:DDD9` `main_koopa` (shared with $16C) | `$07:E3DF` `head_bop_koopa_green` (own dispatch) -- spawns $169 Naked Koopa + $167 free Shell on stomp | The shelled-Koopa walker. 3-state main (walk / turn / panic) -- panic is the alarm state when something is hovering over its head and it can convert into a free shell. |
| `$16C` | `RedKoopa` | 07 | `$07:DD78` shared | `$07:DDD9` shared | `$07:E3F9` `head_bop_koopa_red` -- spawns $16A + $168 instead | Red palette. Same Main as $16B; head-bop dispatch is its own body but mirrors the green-side flow with red-tinted sprite IDs (it's literally the same code with two CMP/LDA constants flipped). |
| `$16D` | `GreenParakoopa` | 07 | `$07:E487` `init_parakoopa_green` | `$07:E55A` `main_parakoopa_green` | `$07:E730` `head_bop_parakoopa_green` -- spawns Green Koopa $16B or routes to Naked-form fallback | Hopping winged Koopa. 2-state main (hop / stomped). On every ground touch re-launches via `init_parakoopa_green` (so it loops forever); stomped state waits $7A96 then re-arms. |
| `$16E` | `RedHorizontalParakoopa` | 07 | `$07:E4D1` `init_parakoopa_red_horizontal` | `$07:E5D9` `main_parakoopa_red_horizontal` | `$07:E74D` `head_bop_parakoopa_red` (shared with $16F) -- spawns Red Koopa $16C | Horizontal cruiser. Init picks initial facing from spawn-X bit $0010 (level-byte flag), seeds Y-anchor in `$76,x` and X-anchor in `$18,x`; flies back-and-forth between two X-extremes derived from $7400 facing + $75E0/$75E2 accel ceilings. |
| `$16F` | `RedVerticalParakoopa` | 07 | `$07:E520` `init_parakoopa_red_vertical` | `$07:E64F` `main_parakoopa_red_vertical` | `$07:E74D` shared with $16E -- spawns Red Koopa $16C | Vertical cruiser. Same shape as $16E but flies up-and-down between Y bounds; pause-timer at each pole picked from `DATA_07E593` keyed by facing. |

There are two notable structural observations from this table:

- **All four "naked" + "shelled" Koopa variants converge on two bodies
  apiece** (one Init body, one Main body, one StompRt body for each of
  the two states). The four green-and-red SpriteID branches in
  `head_bop_koopa_green` vs `head_bop_koopa_red` are the *only* place
  in the entire family where green vs red is encoded -- everywhere else
  it's a shared body with no branching. The cosmetic palette difference
  is encoded in the OAM palette bits selected from the sprite-ID
  rendering tables in Bank03 (and the V1.1-only `ORA #$0600` priority
  bit for the Red Koopa Shell at `main_koopa_shell` line 11187).
- **All three Parakoopa StompRt entries share a head-of-body
  in `head_bop_parakoopa_*`** that immediately spawns a feather-poof
  ambient sprite ($AmbSpr211) via `CODE_07FD34` (Bank07 line 15724), then
  transmutes the slot in-place into the underlying shelled Koopa
  (Green for $16D, Red for $16E/$16F). The wing-loss effect is the
  family's tell.

---

## 2. The Koopa lifecycle (state transition graph)

The full lifecycle of a green-side Koopa, from spawn through every
intermediate state to despawn:

```
   level-data spawn
          |
          v
   $16B GreenKoopa  ----(panic, state $02)------> $16C panic anim
       |
   Yoshi stomp ($16B StompRt)
       |
       +--> spawn $169 GreenNakedKoopa (in-slot)
       |    + spawn $167 GreenKoopaShell (paired free sprite)
       v
   $169 GreenNakedKoopa  --(walks; on touching a stopped shell)
       |                       picks it up: $76,x advances to
       |                       state $04, sucks the shell into a
       |                       new $16B GreenKoopa slot
       |
   Yoshi stomp ($169 StompRt)
       |
       v
   $167 GreenKoopaShell (free) ---(rolling / breaking blocks)
       |
   Yoshi tongue-eat (CODE_07E336): $0E status + JMPs to CODE_03B273
                                   (eat-sprite consumed-by-yoshi path)
       |
   OR Yoshi kicks it (CODE_07DAA8): X-speed set from DATA_07DAA4
                                    ($0200/$FE00) -- now a projectile
       |
   OR shell sits still ($7A36 counts up to 9; on 8 spawns 1up;
       block-impact chain: 7-step DATA_07DA9C sounds escalate)
       |
   shell collides with Naked Koopa (CODE_07DB5D)
       v
   re-puts shell on Koopa's back: $16B back from $169
   (or shell hits Yoshi: CODE_03B20B side-knockback)
```

Red-side is identical with $16C / $16A / $168 substituted for $16B / $169 / $167.

For the Parakoopas, the cycle truncates: on stomp they morph
into the corresponding shelled Koopa, and the rest of the graph
re-applies:

```
   $16D GreenParakoopa ---stomp---> $16B GreenKoopa (then full
                                              shelled-Koopa graph)
   $16E RedHorizontalParakoopa  --stomp---> $16C RedKoopa
   $16F RedVerticalParakoopa    --stomp---> $16C RedKoopa
```

The Goomba is its own thing and does not participate in the
Koopa lifecycle. It walks, can fall off edges, can be stomped (-> kicked
state), can be re-stomped while kicked, and despawns.

---

## 3. The shared helpers in Bank07

Five helper routines in Bank07 are shared across the shelled / naked
Koopa + Parakoopa bodies. Three of them (`CODE_07E303`, `CODE_07E2A1`,
`CODE_07E250`) implement contact mechanics between Yoshi and a Koopa /
Naked Koopa, and the other two (`CODE_07E336`, `CODE_07E35B`) handle
the in-mouth case where Yoshi has the sprite on his tongue.

### 3.1 The Yoshi-collision dispatcher pattern

Each Main routine in the family follows the same five-helper sequence:

```
LDX.b #FXCODE_08949D>>16
LDA.w #FXCODE_08949D
JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt  ; GSU ground probe
LDX.b $12
JSL.l CODE_03AF23                              ; common gravity/OAM
JSL.l CODE_07E35B                              ; tongue / mouth contact
JSL.l CODE_03A5B7                              ; carried-item contact
JSL.l CODE_07E2A1                              ; held-shell linkage
                                                ; (only for shelled & Parakoopa)
LDA.b $16,x  : TAX  : JSR (state-ptr-table,x)  ; sub-state dispatch
```

`FXCODE_08949D` is the **GSU sprite ground probe** -- a SuperFX
routine in Bank08 (`yi/SuperFX/Banks/Bank08.asm:4040`) that reads
`$1972` (a slot-index input register), looks up the sprite slot's
floor mask, and writes a sprite-floor flag back into the slot. This
is the routine that gives the Koopa family its "stops at the edge of
a platform" behaviour -- without it, a Naked Koopa would walk straight
off the edge. The Goomba does NOT call this routine (the Goomba walks
off ledges in classic Goomba style).

`CODE_07E336` and `CODE_07E35B` are nearly identical:

- `CODE_07E336` is called by the **Goomba's** Main (and by other non-Koopa sprites
  that share Bank0C). It checks if Yoshi has tongued the sprite (`$7D36,x`
  in mouth-link tagged), and if so JMPs into `CODE_03B273` (eat-sprite-routine).
  Used for: Goomba.
- `CODE_07E35B` is called by the **shelled / naked Koopa + Parakoopa**
  Mains. Same mouth-link test, plus if Yoshi is *stomping while the
  sprite is in mouth* it routes through `CODE_03B20B` (Yoshi-knockback)
  instead -- the "I had a Koopa in my mouth but Yoshi got hit" failsafe.

### 3.2 `CODE_07E2A1` -- held-shell linkage check

The Naked Koopa's "I just walked over a stopped shell, pick it up" path.
Called from `main_koopa` (the shelled Koopa). Walks the $7D36,x
"held-by" pointer to a stopped shell, and on match:

1. Despawns the shell via `CODE_03B24B`.
2. Spawns a `$16B` GreenKoopa or `$16C` RedKoopa in the Naked Koopa's
   slot via `CODE_spawn_sprite`.
3. Re-arms the shell-respawn-shield counter $7A36 = $0020 (32 frames).
4. Sets the global "shell wake" indicator at `$7019D6` (slot EXRAM).

This is the "naked Koopa re-shells" mechanism. Visually you see the
Koopa duck down and pop back up in its shell.

### 3.3 `CODE_07E250` -- panic-state trigger

Called from `main_koopa` state $00 (walk). Checks whether the current
slot's $7D36,x ($7D36 holds a "this sprite is held by sprite [Y]"
link) points at a sprite-ID in the range $169..$16E (i.e. a Naked
Koopa or another Koopa) that has gone into status $0010 (alive but
inactive). If so, transitions the current Koopa to state $02 (panic
animation), sets timer $7A96 = $05, zero's X-speed.

This is "another Koopa near me is stunned, I should panic."

### 3.4 `CODE_07E303` -- Yoshi-proximity panic trigger

Called from `main_koopa` state $00 (walk). When Yoshi is held-by-the-slot
(`$7D36,x` BMI test) AND Yoshi's facing in `$77C2,x` differs from the
sprite's `$7400,x`, transition to state $02 (panic).

This is "Yoshi is behind me / approaching from behind, I should panic."

---

## 4. Per-sprite breakdown

### 4.1 $062 Goomba (Bank0C)

Init is trivial -- delegate to `CODE_0C83DF` which zeros $16 (state),
arms $7A96 = $04, zero's $7402 (anim frame), and reads $7400 facing.

Main runs:

```
main_goomba:
    JSL CODE_03AF23     ; gravity / OAM
    JSL CODE_07E336     ; tongue-eat check (in Bank07!)
    JSL CODE_03A5B7     ; carried-item touch
    LDY $16,x : TYX
    JMP (DATA_goomba_state_ptr,x)
```

State pointer table `DATA_goomba_state_ptr` (6 entries):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C83EE` | **Walk.** Zero's X-speed at top, then dispatches based on floor flags: no floor -> `CODE_0C8397` (fall); side-wall hit ($000C) -> `CODE_0C83BF` (turn); otherwise advance anim frame `$7402` mod 8 every $7A96=$04 frames; if anim hits frame $01, write per-facing X-speed from `DATA_0C83DB = $FF00,$0100`. |
| `$02` | `CODE_0C8425` | **Turn.** Inner 5-step pose cycle from `DATA_0C83B3` poses $00/$00/$08/$00/$08/$00 ; on counter==0 EORs $7400 facing by $02 (reverse direction); on counter underflow returns to state $00 via `CODE_0C83DF`. |
| `$04` | `CODE_0C8450` | **Fall.** Mid-air pose cycle from `DATA_0C8387 / DATA_0C838F`; on land sets Y-speed = $FD00 (small bounce), X-speed = $FFC0 / $0040 from `DATA_0C844C` (slow walk on land); on counter==2 disables floor-bit via `AND #$FFFE` (skip-one-frame-of-ground for the bounce). |
| `$06` | `CODE_0C84E6` | **Squashed.** The head-bop animation continuation; cycles through `DATA_0C84A7 = $00,$09,$0A,$0B,$0C` (compress pose frames). Uses helper `CODE_07FC2A` to detect Yoshi-jump-on-head; on second bounce moves to state $08 (kicked). Bonus: plays `SoundID1B_MaceTick` every $7A96 cycle for that signature "shell-spin" sound. |
| `$08` | `CODE_0C856D` | **Kicked.** After 2 stomps. Animation from `DATA_0C8565 = $0C,$0B,$0A,$0B` cycle; despawns via `CODE_0C8606` which immediately routes to `CODE_0C85B3` (the second head-bop state). |
| `$0A` | `CODE_0C84B1` | **Despawn.** Final cleanup pose. Iterates `DATA_0C84A7` backwards; on completion calls `CODE_0C84CF` which respawns the slot via `CODE_spawn_sprite` (status $0002 alive) -- effectively restarts the Goomba unless the level scrolls away. |

Head-bop dispatcher `head_bop_goomba` at $0C:858D runs a 2-state
mini-machine in `$76,x` (different state byte from $16,x!):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C8593` | Squish-frame: zero X-speed, set $18 = $04, pull anim from `DATA_0C8634 = $0C,$0B,$0A,$09,$00` ; increment $76 to $02. |
| `$02` | `CODE_0C85B3` | Score-popup: walks the same DATA_0C8634/DATA_0C8639 timer pair; on completion sets CurrentStatus = $0010 (alive-but-inactive), advances $7400 to $77C2-facing, jumps to the "kicked" exit at `CODE_0C8606` (which arms the kick-bounce velocity from `DATA_0C84E2 = $FF80,$0080`). |

Surprising detail: the Goomba can be kicked sideways into a "rolling
goomba" by being stomped a second time. The kicked-state has a real
1Px X-velocity, escalates Y on bounce, and shells the goomba forward
into other enemies (one of the few non-Koopa-family enemies that
exhibits shell-like collision behaviour).

### 4.2 $167 Green Koopa Shell + $168 Red Koopa Shell (Bank07)

`init_koopa_shell` at $07:D956:

```
init_koopa_shell:
    LDA #$0002     ; the "respawn-from-stopped-shell" counter starts at 2
    STA $78,x
    RTL
```

`main_koopa_shell` at $07:D964 is one of the longest single-sprite
Mains in the bank (~190 lines). High-level flow:

1. (V1.1 only) `ORA #$0600` on $6FA0,x -- forces sprite-priority bits.
2. If CurrentStatus is $0010 (alive) AND $7D38,x is set ("recently kicked"),
   skip gravity (the shell is in mid-flight from a kick). Otherwise run
   the standard gravity + tongue-eat (`CODE_07E336`).
3. Decrement $7D38,x ("just-kicked" cooldown). On landing bit ($7860 & $1),
   increment $7019D8 counter (bounce-on-ground tracker, capped at 2).
4. If $7019D8 == 1 (just landed), play `SoundID1D_ObjectLanding`. If
   $76,x < 2 (early bounce phase), pick a Y-speed from `DATA_07D960 =
   $FE40,$FF00` (decaying bounce). After 2 bounces it stops bouncing.
5. If X-speed >= $0301 in magnitude (rolling fast), branch to the
   "fast roller" code at `CODE_07DA52` -- this is the projectile
   state. Plays `SoundID1C_StompEnemy` on wall-hit; cycles anim mod 4;
   calls `CODE_07DAA8` (shell-Yoshi contact: if Yoshi-touch via
   `CODE_07FC2F` returns BCS, knock Yoshi back via `CODE_03B20B`).
6. Otherwise (slow / stopped), check the "Yoshi-trigger" path
   `CODE_07DA7A` which awakens the shell on Yoshi-touch.
7. If $7D38,x >= 2 (recently kicked), defer to `CODE_07DC8C` which
   does the **Map16 block-break** test: probe the 8-pixel offset
   in the facing direction; if the tile palette-mask matches $4000
   (a breakable block bit), STA the tile coords to $00/$02 and
   call `CODE_change_map16` to crack the block.
8. The shell sprite-collision path at `CODE_07DAA8 / CODE_07DADC`
   walks sprite-link pointer $7D36,x and checks if the linked sprite
   is in the breakable range $167-$170 (i.e. another shell or a Lakitu).
   If so, increment $7A36,x; at $7A36 == 8 the shell spawns a 1up;
   at $7A36 == 7 the shell plays the 7-step ascending sound chain
   from `DATA_koopa_shell_hit_sound_ids` (`DATA_07DA9C`):
   `ShellHit2 / ShellHit3 / ShellHit4 / ShellHit5 / ShellHit6 / ShellHit7 / ShellHit8 / ShellHit8`.

Notable detail: **the 8th sound entry pins at `ShellHit8` rather than
escalating further** (the last two bytes of `DATA_07DA9C` are
identical) -- by design the ascending chain caps at 7 distinct rises,
then plateaus, then the 1up triggers at the 9th cycle. This is the
classic "stomp 8 enemies with one shell to earn a 1up" mechanic.

Notable detail 2: the shell, when rolling and contacting another Naked
Koopa, **re-shells the Naked Koopa** at `CODE_07DB5D / CODE_07DBB9`:
sets the Naked Koopa's CurrentStatus to $000E (in-air kick state),
arms a Y-speed = $FC00 + the X-speed from `DATA_07DAA4 = $0200/$FE00`,
and writes the wake flag $701900,y = 1. The "re-shelling" is
implemented as "kick the Naked Koopa hard, then let it land as a
shelled Koopa." So a stopped shell + a Naked Koopa + a rolling shell
produces a new shelled Koopa.

### 4.3 $169 Green Naked Koopa + $16A Red Naked Koopa (Bank07)

`init_koopa_naked` at $07:DD52:

```
init_koopa_naked:
    LDY $7400,x           ; facing
    LDA DATA_07DD4E,y     ; { $FFA0, $0060 } pick per-facing X-speed
    STA NorSpr_XSpeedLo,x
    LDA #$010A            ; respawn-shield = 266 frames
    STA $7A36,x
    LDA $7860,x           ; cache current floor flags as "prev-floor"
    STA $7A38,x
    SEP #$20 : STZ $7402,x  ; anim frame 0
    LDA #$05 : STA $7A96,x  ; anim timer 5
    LDA #$00 : STA $16,x   ; state $00 (walk)
    REP #$20
    RTL
```

Note: $7A36 = $010A is the **respawn-shield timer** that prevents
the Naked Koopa from immediately morphing back into a shelled Koopa
right after a stomp. The Naked Koopa starts walking, this counter
ticks down, and only after it expires can the Naked Koopa pick up a
shell.

`main_koopa_naked` at $07:DDA1 dispatches:

```
DATA_koopa_naked_state_ptr (4 entries):
$00 -> CODE_07DE7F  walk
$02 -> CODE_07DFFF  turn
$04 -> CODE_07E12D  on-shell-pickup
$06 -> CODE_07E1B4  squashed
```

State $00 (walk) at `CODE_07DE7F` does the **shell-pickup probe**:

1. Read $7019D8 (the "shell-pickup-in-progress" flag). If non-zero,
   skip to default walk.
2. If $7AF6 (respawn-shield) is non-zero, skip pickup.
3. Otherwise call `FXCODE_099856` (the GSU "nearest-shell-finder")
   which returns a slot index in `R9` (or BMI = "no shell nearby").
4. If a shell is within $20 Y-pixels AND $20 X-pixels in the facing
   direction (sign-check via XOR with $7400-DEC), arm the pickup:
   set X-speed from the slope-of-approach (scaled `<< 3`), Y-speed
   = $FE00 (small jump), state $04 (on-shell-pickup), anim frame $0C
   (ducking-to-shell).

State $04 (on-shell-pickup) at `CODE_07E12D` is unusually short:
checks for facing-vs-X-speed sign mismatch (a "I bounced off a wall
mid-jump"), spawns ambient sprite `!Define_YI_AmbSpr1E0` (the
shell-pickup poof), then sets state $06 (squashed -- the final
animation before re-shelling).

State $06 (squashed) at `CODE_07E1B4` ticks down $7A96, fires anim
frame $0D, then on counter underflow falls into `CODE_07E1DD` ->
`CODE_07E042` (back to state $00 walk via re-init of facing speed
from `DATA_07DD4E`).

### 4.4 $16B Green Koopa + $16C Red Koopa (Bank07)

`init_koopa` at $07:DD78 is virtually identical to `init_koopa_naked`
above except:

- `$7A36` = $000A (10 frames, not $010A = 266) -- shelled Koopa has
  a much shorter "respawn shield" because there's nothing to recover
  from.
- Adds `STZ $701900,x` at the bottom -- the **"already-stomped" flag**
  that the head-bop dispatcher uses to differentiate first stomp (drop
  shell) vs second stomp (instant kill via `CODE_07E399`).

`main_koopa` at $07:DDD9:

```
main_koopa:
    LDA CurrentStatus,x
    CMP #$0008             ; status $0008 = "stomped"
    BNE CODE_07DDE4
    JMP CODE_07E234        ; in-slot morph to GreenKoopaShell or RedKoopaShell
CODE_07DDE4:
    [GSU ground-probe FXCODE_08949D]
    [JSL CODE_03AF23 gravity]
    [JSL CODE_07E35B tongue-eat]
    [JSL CODE_03A5B7 carried-item]
    [JSL CODE_07E2A1 held-shell linkage -- the "I'm holding a
                                          shell that's about to be
                                          re-launched as a free $167"
                                          mechanism]
    LDA $16,x : TAX
    JSR (DATA_koopa_shelled_state_ptr,x)
    RTL
```

State pointer table `DATA_koopa_shelled_state_ptr` (3 entries):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_07DE2A` | **Walk.** Per-facing X-speed from `DATA_07DD4E`; cycle anim mod 8 every $7A96=$05 frames; calls `CODE_07E303` (Yoshi-behind panic test) + `CODE_07E250` (nearby-Naked-Koopa panic test). |
| `$02` | `CODE_07DFFF` | **Turn.** Same pose-cycle pattern as Naked Koopa $02 -- read floor bit + animate `DATA_07DFF9 = $08,$09,$0A,$0A,$09,$08` indexed by $18,x counter. |
| `$04` | `CODE_07E0C6` | **Panic.** A more elaborate cycle of `DATA_07E05C / DATA_07E061` (panic-pose-frames + panic-dwell-times), with a brief jitter from `DATA_07E066` (a 192-byte $FFFE/$0002 wobble table indexed by $7A96-LSR'd anim frame -- the Koopa visually shakes back and forth). Counter underflow at $03 sets Y-position += $0008 (sink back down); at $02 fires Y-speed $FE00 (jump up); falls back to state $00 walk. |

The notable thing about the shelled Koopa is that **status $0008
(stomped) bypasses the whole state machine** and JMPs directly to
`CODE_07E234`, which morphs the slot in-place via `CODE_spawn_sprite`:

```
CODE_07E234:
    LDY #$02
    LDA SpriteID,x
    CMP DATA_07E230,y      ; { $16B, $16D }
    BEQ CODE_07E247        ; -> spawn Green Shell
    DEY : DEY
    BPL ...                ; loop checks
    LDA #$0168             ; not green, spawn Red Shell
    BRA CODE_07E24A
CODE_07E247:
    LDA #$0167
CODE_07E24A:
    TXY
    JSL CODE_spawn_sprite
    RTL
```

The funny bit: `DATA_07E230` is `{ $16B, $16D }` -- this table is
checked by *both* Green Koopa $16B AND Green Parakoopa $16D, and the
"not in this list" branch falls through to RedKoopaShell $168. So the
green-vs-red dispatch for "what shell do I leave behind on stomp" is
shared between the shelled Koopa and the Parakoopa. Whichever path
enters `CODE_07E234`, if its SpriteID is in `{ $16B, $16D }` it leaves
a green shell; otherwise red.

### 4.5 Head-bop dispatchers $16B / $16C

`head_bop_koopa_green` at $07:E3DF:

```
head_bop_koopa_green:
    LDA $701900,x          ; "already-stomped" flag
    BNE CODE_07E399        ; non-zero -> second-stomp = instant kill
    [GSU ground-probe]
    LDA #$0167 : STA $00   ; remember "shell ID" for spawn_sprite_active
    LDA #$0169             ; ID for spawn_sprite (Green Naked Koopa)
    BRA CODE_07E411
```

So the first stomp:

1. Transmutes the slot in-place via `CODE_spawn_sprite` into a
   Green Naked Koopa.
2. Spawns a *separate* free Green Koopa Shell via
   `CODE_spawn_sprite_active`, with launch vector from
   `DATA_07E3DB = $0400/$FC00` (per-facing X-speed for the new shell;
   the shell flies out away from the Naked Koopa).
3. Sets $701976 = $0004 (a per-slot table byte), $7AF6 = $0020
   ("respawn-shield"), $7540 = $0020 (Yoshi-knockback cooldown), $7042
   palette-bits cleared, status = $0010.

`head_bop_koopa_red` at $07:E3F9 is the same logic with `$0168` and
`$016A` swapped in (Red Shell + Red Naked Koopa).

`CODE_07E399` (the "second-stomp" path branch) drops the slot's
$7402 = $0000 (still-frame) and arms a single GSU init pass; the
slot is effectively about to be killed by the framework engine.

### 4.6 $16D Green Parakoopa (Bank07)

`init_parakoopa_green` at $07:E487 sets:

- $7A36 = $002A (42-frame initial cycle)
- $7542 = $0010 (Y-accel cooldown)
- $75E2 = $0100 (Y accel)
- Then falls through to `CODE_07E499` (label still callable directly):
  - X-speed from `DATA_07E483 = $FF80,$0080` per-facing
  - Y-speed = $FE00 (jump up)
  - $7402 = $0008 (jump-pose anim frame)
  - $7A96 = $0002, state $00 (hop), $701900 = 0 (un-stomped)

`main_parakoopa_green` at $07:E55A:

```
main_parakoopa_green:
    LDA CurrentStatus,x
    CMP #$0008             ; stomped?
    BNE CODE_07E56A
    STZ $00 : JSR CODE_07FD34   ; spawn feather-poof ambient ($AmbSpr211)
    JMP CODE_07E234        ; SAME morph-to-shell-on-status-$0008 path as $16B!
```

This is the family's cleanest reuse: when the Parakoopa is stomped
via the standard "status $0008" path, it routes through the same
`CODE_07E234` dispatcher that the shelled Koopa uses -- and since
$16D is in `DATA_07E230` it gets a Green Shell. (But this path is
*only* used if the Parakoopa is currently "alive in shell form" --
during normal hop it goes through the StompRt head-bop body instead.)

The normal Main runs:

```
CODE_07E56A:
    [GSU ground-probe]
    [JSL CODE_03AF23 gravity]
    [JSL CODE_07E35B tongue-eat]
    [JSL CODE_03A5B7 carried-item]
    [JSL CODE_07E6B7 -- the "kick into knockback" helper specific
                       to Parakoopas]
    JSR CODE_07E6E9 -- the "Yoshi-behind-me wall-turnaround" helper
    LDA $16,x : TAX
    JSR (DATA_parakoopa_green_state_ptr,x)
    RTL
```

2-state main pointer table:

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_07E597` | **Hop.** If on ground ($7860 & $1), transition to state $02 (stomped); otherwise tick anim frame `$7402` DECrement (resetting at 8 on underflow), arm $7A96 = $2 cycle. |
| `$02` | `CODE_07E5CD` | **Stomped (on ground).** Wait $7A96 = 0, then JSL `CODE_07E499` (re-init -- launches another hop). This is the perpetual-bounce loop. |

So the Parakoopa is **infinitely re-hopping**: every time it lands
it goes to state $02 (brief pause), then re-runs its init
to relaunch. The only way to break the cycle is Yoshi-stomp from
above, which routes through the StompRt head-bop body instead.

### 4.7 $16E Red Horizontal Parakoopa + $16F Red Vertical Parakoopa

`init_parakoopa_red_horizontal` at $07:E4D1 and
`init_parakoopa_red_vertical` at $07:E520 are structurally
identical, with horizontal vs vertical motion axes:

```
init_parakoopa_red_horizontal:
    LDA #$002A : STA $7A36,x         ; common 42-frame cycle
    LDA $70E2,x : STA $18,x          ; cache X-position as X-anchor
    AND #$0010 : LSR : LSR : LSR     ; extract bit-4 (level-data flag)
    EOR #$0002                       ; flip = encode facing as { 0, 2 }
    STA $7400,x                      ; facing
    TAY
    LDA DATA_07E4C5,y                ; { $FEE0, $0120 } X-speed per facing
    STA NorSpr_XSpeedLo,x
    LDA DATA_07E4CD,y                ; { $F800, $0800 } X-accel ceiling
    STA $75E0,x : STA $75E2,x        ; Y-accel ceiling too
    LDA #$0004 : STA $7540,x         ; X-vel jitter cooldown
    LDA #$0008 : STA $7542,x         ; Y-vel cooldown
    LDA $7182,x : STA $76,x          ; cache Y-position as Y-anchor (!)
    CLC : ADC DATA_07E4C1,y          ; { $0004, $FFFC } -- offset Y by +/-4
    STA $7182,x
    LDA #$0008 : STA $7402,x         ; anim frame 8 (wing-flap pose 1)
    LDA #$0003 : STA $7A96,x         ; anim timer
    STZ $701900,x                    ; not-stomped-yet flag
    RTL
```

Both variants share the level-data spawn-X bit pattern: bit 4 of the
spawn-X byte ($70E2 first frame after init) encodes facing -- bit clear
means "right-going", bit set means "left-going". The cached anchors
`$18,x` (X-anchor) and `$76,x` (Y-anchor) are then used in the Main
to drive the back-and-forth motion against the anchor.

`main_parakoopa_red_horizontal` at $07:E5D9:

```
main_parakoopa_red_horizontal:
    LDA CurrentStatus,x
    CMP #$0008                  ; same stomp -> shell pattern
    BNE CODE_07E5E9
    STZ $00 : JSR CODE_07FD34   ; feather-poof
    JMP CODE_07E234             ; -> spawn Red Shell ($168)
CODE_07E5E9:
    [standard helper sequence]
    [JSL CODE_07E6B7 -- kick-into-knockback]
    
    ; X-anchor pull:
    LDY #$00
    LDA $70E2,x
    CMP $18,x                   ; current X vs X-anchor
    BPL CODE_07E60F             ; positive -> right of anchor
    INY : INY                   ; left of anchor -> Y=$02
CODE_07E60F:
    LDA DATA_07E4CD,y           ; { $F800, $0800 } X-accel toward anchor
    STA $75E0,x                 ; opposing accel = pendulum motion

    ; turn-around on facing-vs-speed sign mismatch:
    LDA $7400,x : DEC
    EOR XSpeedLo,x
    BPL CODE_07E627
    LDA $7400,x : EOR #$0002 : STA $7400,x  ; flip facing
CODE_07E627:
    ; Y-anchor pull (same shape as X-anchor):
    LDY #$00
    LDA $7182,x
    CMP $76,x                   ; current Y vs Y-anchor
    BPL CODE_07E632
    INY : INY
CODE_07E632:
    LDA DATA_07E4CD,y
    STA $75E2,x                 ; Y-accel toward anchor

    ; anim cycle:
    LDA $7A96,x : BNE CODE_07E64E
    DEC $7402,x : BPL CODE_07E648
    LDA #$0008 : STA $7402,x
CODE_07E648:
    LDA #$0003 : STA $7A96,x    ; anim timer reset
CODE_07E64E:
    RTL
```

So the Red Horizontal Parakoopa runs a 2-axis spring-back motion
toward its spawn point: X-accel pulls toward the X-anchor in $18,x,
Y-accel pulls toward the Y-anchor in $76,x. The "back and forth"
motion is purely emergent from the velocity + the spring-back; no
explicit "turn at the edge" code is needed because the accel
gradient handles it naturally.

`main_parakoopa_red_vertical` at $07:E64F is similar but only does
the Y-axis spring-back; the X-direction is unset (it stays where
it spawned with X-speed = 0 from init). It also has a
`DATA_07E593 = $0002,$0004` pause-timer table indexed by velocity
sign -- so it pauses 2 frames at one extreme and 4 frames at the
other, producing the asymmetric vertical pendulum.

### 4.8 The Parakoopa head-bop dispatchers

`head_bop_parakoopa_green` at $07:E730:

```
head_bop_parakoopa_green:
    LDA $7AF8,x
    BNE CODE_07E740
    STZ $00 : JSR CODE_07FD34       ; spawn feather-poof
    LDA #$FFFF : STA $7AF8,x        ; mark "feather already spawned"
CODE_07E740:
    LDA $701900,x : BEQ CODE_07E748
    JMP CODE_07E399                 ; "already-stomped" -> instant kill
CODE_07E748:
    LDA #!Define_YI_NorSpr16B_GreenKoopa
    BRA CODE_07E768                 ; -> spawn Green shelled Koopa in-slot
```

`head_bop_parakoopa_red` at $07:E74D is the same with $16C (Red Koopa).

The shared morph at `CODE_07E768`:

```
CODE_07E768:
    PHA
    [GSU ground-probe]
    PLA
    LDX $12 : TXY
    JSL CODE_spawn_sprite           ; in-slot morph to $16B/$16C
    LDA #$0010 : STA CurrentStatus,x
    LDA #$000A : STA $7A36,x        ; respawn-shield = 10 frames
    LDA $7860,x : STA $7A38,x       ; cache floor flags
    RTL
```

So Parakoopa stomp = "lose your wings, become a shelled Koopa."
The shelled Koopa then runs its own state machine, which can itself
be stomped to drop a shell, which produces the Naked Koopa, etc.

---

## 5. Green vs Red differences

For a family this large, the green-vs-red split is remarkably
**cosmetic-only at the code level**. The differences (and they are
all encoded as small data-table forks, not behaviour forks):

| Difference | Where | What |
|------------|-------|------|
| Sprite ID space split | spawn / despawn helpers | $167/$169/$16B/$16D = green; $168/$16A/$16C/$16E/$16F = red. Encoded as range-tests `CMP #$167 BCC` vs `CMP #$169 BCC` and as 2-entry dispatch tables (`DATA_07E1E0 = { $16A, $16C }`, `DATA_07E230 = { $16B, $16D }`) that branch on "is this the green list?" |
| Initial cycle counter $7A36 | `init_koopa_naked` vs `init_koopa` | Naked Koopa starts at $010A; shelled Koopa starts at $000A. The Naked Koopa's longer counter is the **respawn-shield** that prevents instant re-shelling after a stomp. Green vs red is NOT a factor here; both colors have both initial values for their respective forms. |
| OAM priority bits | `main_koopa_shell` $07:D964 line 11187 | V1.1-only: `LDA $6FA0,x : ORA #$0600 : STA $6FA0,x` -- the **Red Shell** gets forced layer-priority bits in V1.1 to fix a V1.0 z-order bug where the red shell would render behind certain background tiles. |
| Vertical Parakoopa anim-pace | `DATA_07E593` | Used only by $16F to pick pause timer $7A96 = 2 or 4 based on Y-velocity sign. No green-side equivalent (the green Parakoopa doesn't pause). |
| Init position offsets | `DATA_07E4C1 = { $0004, $FFFC }` | Red Horizontal Parakoopa init applies a 4-pixel-vertical anchor offset; this is read with the same facing-as-index pattern, so it depends on facing but not on red-vs-green. |

What does NOT differ: walk speed, panic-state mechanics, shell-rolling
speeds, shell-block-break radius, head-bop response, sprite-tongue
behaviour. The green-side and red-side Koopa lines run on byte-identical
code paths inside the state handlers.

The "what differs in gameplay" answer is therefore:

- Red shells and red Naked Koopas spawn in different levels (level-data
  difference, not code difference).
- Red horizontal/vertical Parakoopas are unique to red because the
  green Parakoopa has no horizontal/vertical-cruise mode -- the green
  Parakoopa only has the infinite-hop pattern. (This is a sprite-roster
  asymmetry, encoded purely as: $16D = green hopper, $16E + $16F = red
  cruisers. There is no green-side cruiser.)

---

## 6. Parakoopa flight patterns

The three Parakoopas use three structurally different flight controllers:

### 6.1 $16D Green Parakoopa -- infinite-bounce hopper

State $00 (hop) waits for ground-contact, then state $02 (stomped-on-ground)
re-initialises and re-launches via `JSL CODE_07E499`. The hop arc is:

- Initial Y-speed = $FE00 (small upward kick)
- Initial X-speed from `DATA_07E483 = { $FF80, $0080 }` per facing
- Gravity applies (`CODE_03AF23` in the standard helper chain)
- Anim cycles through frames $08 / $07 / $06 / $05 (DEC from $08
  then wrap) -- the four wing-flap poses

The hop loops forever; the only thing that stops it is a stomp or
a tongue-eat.

### 6.2 $16E Red Horizontal Parakoopa -- X-Y spring-anchor

Anchor-based motion. Init caches X-position in `$18,x` and Y-position
in `$76,x`. Main applies symmetric X- and Y-accel toward those anchors
every frame via `$75E0,x` / `$75E2,x`. This produces a **damped 2D
oscillation** around the spawn point.

The X-extreme is whenever the X-accel ceiling ($F800 / $0800) balances
the X-velocity sign; this happens automatically without explicit
"check if past the edge, turn around" code. The wing-flap cycles
the same 4-frame DEC-loop as the green hopper.

### 6.3 $16F Red Vertical Parakoopa -- Y-only spring with asymmetric pause

Init only caches Y in `$18,x` (note: $18,x, NOT $76,x -- the vertical
variant uses a different slot field for its Y-anchor!). Main pulls
toward the Y-anchor with the same `DATA_07E4CD = $F800/$0800` accel
ceiling, but additionally consults `DATA_07E593 = $0002,$0004` to
pick a pause timer based on Y-velocity sign:

- Going down -> pause 2 frames at bottom extreme
- Going up -> pause 4 frames at top extreme

This makes the vertical Parakoopa visibly "hesitate" at the top of
its arc more than at the bottom -- a small asymmetry that distinguishes
it from a pure sinusoidal up-down.

The X-velocity is never set in `main_parakoopa_red_vertical` so the
sprite stays exactly on its spawn-X column.

---

## 7. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` lines 118, 389-397 -- canonical
  sprite IDs and one-line summaries for $062, $167-$16F.
- `yi/Banks/Bank0C.asm`:
  - $062 Goomba: Init at line 495, Main at 506,
    `DATA_goomba_state_ptr` at 517, state handlers at 576/603/627/706/778/675,
    StompRt at 800, `DATA_goomba_stomp_state_ptr` at 878.
- `yi/Banks/Bank07.asm`:
  - $167 / $168 Koopa Shells: `init_koopa_shell` at 11168,
    `main_koopa_shell` at 11184; helpers `CODE_07DAA8` (Yoshi-contact
    + shell-roll-on-Koopa) at 11359, `CODE_07DC8C` (Map16 block-break)
    at 15593+ (in helper area).
  - $169 / $16A Naked Koopas: `init_koopa_naked` at 11681,
    `main_koopa_naked` at 11726, `DATA_koopa_naked_state_ptr` at 11749,
    state handlers `CODE_07DE7F` (walk + shell-pickup) at 11840,
    `CODE_07DFFF` (turn) at 12023, `CODE_07E0C6` (panic) at 12082,
    `CODE_07E12D` (on-shell-pickup) at 12135, `CODE_07E1B4` (squashed)
    at 12192.
  - $16B / $16C shelled Koopas: `init_koopa` at 11703,
    `main_koopa` at 11757, `DATA_koopa_shelled_state_ptr` at 11788,
    state handlers `CODE_07DE2A` (walk) at 11796, `CODE_07DFFF`
    (turn, shared with naked) at 12023, `CODE_07E0C6` (panic, shared)
    at 12082; head-bop dispatchers `head_bop_koopa_green` at 12490
    and `head_bop_koopa_red` at 12504.
  - $16D / $16E / $16F Parakoopas: `init_parakoopa_green` at 12564,
    `init_parakoopa_red_horizontal` at 12605,
    `init_parakoopa_red_vertical` at 12642, `main_parakoopa_green`
    at 12671, `main_parakoopa_red_horizontal` at 12739,
    `main_parakoopa_red_vertical` at 12796,
    `head_bop_parakoopa_green` at 12907,
    `head_bop_parakoopa_red` at 12926.
  - Shared helpers: `CODE_07E234` (in-slot morph to shell) at 12268,
    `CODE_07E250` (nearby-naked-Koopa panic) at 12287,
    `CODE_07E2A1` (held-shell linkage) at 12326,
    `CODE_07E303` (Yoshi-behind panic) at 12375,
    `CODE_07E336` (Goomba/non-Koopa tongue-eat) at 12400,
    `CODE_07E35B` (Koopa-side tongue-eat) at 12420,
    `CODE_07E399` (second-stomp instant-kill) at 12451,
    `CODE_07E6B7` (Parakoopa kick-knockback) at 12847,
    `CODE_07E6E9` (Yoshi-behind wall-flip for Parakoopas) at 12873,
    `CODE_07FD34` (feather-poof ambient spawner) at 15724.
  - Data tables: `DATA_07D95C` $0380/$FC80, `DATA_07D960` $FE40/$FF00
    (shell bounce-Y picks) at 11176-11181; `DATA_07DA9C`
    `DATA_koopa_shell_hit_sound_ids` (8-byte ascending sound chain)
    at 11352; `DATA_07DAA4 = $0200,$FE00` (shell kick-X) at 11357;
    `DATA_07DD4E = $FFA0,$0060` (Naked + shelled Koopa walk-X) at
    11675; `DATA_07DFF9` (turn-pose cycle bytes) at 11793;
    `DATA_07E05C` / `DATA_07E061` (panic-pose / panic-dwell) at
    12068/12071; `DATA_07E066` (192-byte panic-wobble offsets) at
    12074; `DATA_07E129 = $FFE0,$0020` (shell-pickup Y-offset) at
    12132; `DATA_07E1E0 = $16A,$16C` (red-side dispatch list) at
    12216; `DATA_07E230 = $16B,$16D` (green-side dispatch list) at
    12264; `DATA_07E3DB = $0400,$FC00` (Koopa-stomp new-shell launch X)
    at 12486; `DATA_07E483 = $FF80,$0080` (Parakoopa hop X) at 12560;
    `DATA_07E4BD/4C1/4C5/4C9/4CD = $0030/$FFD0 / $0004/$FFFC /
    $FEE0/$0120 / $FED0/$0130 / $F800/$0800` (Parakoopa init params)
    at 12589-12603; `DATA_07E593 = $0002,$0004` (vertical Parakoopa
    pause-timer) at 12700.
- `yi/Banks/Bank03.asm`:
  - Init / Main / StompRt pointer-table entries -- StompRt dispatch at
    lines 1075 ($062 Goomba) and 1336-1344 ($167-$16F Koopa cluster).
  - `CODE_head_bop_common` at line 4304 -- the no-kill StompRt body
    that many family members chain to as a tail. (Note: $062, $167-$16F
    do NOT chain to head_bop_common -- they have their own dispatch
    routines `CODE_07E3C8` etc. The Bumpty family is the head_bop_common
    consumer; see `docs/family-bumpties.md`.)
- `yi/SuperFX/Banks/Bank08.asm` line 4040 -- `FXCODE_08949D`, the GSU
  sprite ground-probe routine that gives every member of this family
  the "stops at the edge of a platform" behaviour. Reads the slot
  index from $1972, computes the floor mask from $14A2/$1041/$1362
  tile-lookup tables, writes a per-slot floor flag back. The Naked
  Koopa, shelled Koopa, and all three Parakoopas all call this every
  frame; the Goomba does NOT (which is why Goombas walk off ledges).
- `yi/SuperFX/Banks/Bank09.asm` line 4056 -- `FXCODE_099856`, the GSU
  "nearest-shell-finder" used by the Naked Koopa's pickup probe in
  state $00 to locate a stopped shell within reach. Returns a slot
  index in R9 (BMI = no shell).
- `yoshisisland-disassembly/disassembly/bank07.asm` -- Raidenthequick's
  descriptive labels: `init_koopa_shell`, `main_koopa_shell`,
  `init_beach_koopa` (= our Naked Koopa), `main_beach_koopa`,
  `init_koopa`, `main_koopa`, `init_green_parakoopa`,
  `init_red_parakoopa_horizontal`, `init_red_parakoopa_vertical`,
  `main_green_parakoopa`, `main_red_parakoopa_horizontal`,
  `main_red_parakoopa_vertical`. Verified label-by-label.
- `yoshisisland-disassembly/disassembly/bank0C.asm` -- Raidenthequick's
  `init_goomba`, `main_goomba`, `head_bop_goomba`. Verified.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  that routes alive sprites to `_Main` and Yoshi-stomped sprites to
  `_StompRt`. Status $0008 (just-stomped) drives the
  `CODE_07E234` morph-to-shell path for $16B/$16C/$16D/$16E/$16F.
- `docs/leveldataengine.md` -- sprite-list stream format. The "facing"
  bit and the bit-4 spawn-X flag (encoding Parakoopa direction) come
  from the sprite-list byte format documented there.
- `docs/family-shyguys.md` -- the Shy Guy 6-state walk-and-stomp
  pattern is the closest sibling to the Goomba's 6-state walk-and-stomp
  pattern. Different code, same template.
- `docs/family-bumpties.md` S3 -- the per-sprite collision-helper
  pattern that's analogous to (but simpler than) the Koopa-family's
  `CODE_07E2A1` / `CODE_07E250` / `CODE_07E303` per-Main collision
  trio.
- `ys_enmy.asm` / `ys_enmy*.asm` / `ys_koopa.asm` -- parallel asm for
  the Koopa family. Shares the multi-state-table pattern of
  `DATA_koopa_shelled_state_ptr` + `DATA_koopa_naked_state_ptr` and
  the on-stomp slot-morph mechanism.

---

## 8. Open questions

- **Why does the Green Koopa Shell ($167) have a 7-step ascending
  sound chain that plateaus at the 8th step?** `DATA_07DA9C` has 8
  entries but entries 7 and 8 are both `SoundID12_ShellHit8`. The
  9th cycle (counter == 9 in `CODE_07DB31`) is gated to a 1up via
  `CODE_spawn_1up_score` at line 11431. Reading the structure suggests
  the design is "escalate sound 7 times, then plateau for the 8th
  hit, then on the 9th yield the 1up" -- but it would be cleaner to
  use a 9-entry table with the last entry being the 1up trigger.
  Possibly the plateau-then-1up was an iterative tuning choice (early
  drafts may have had 8 ascending sounds + a separate 1up logic; the
  plateau is the artefact of "drop the 8th, but the table still has
  8 entries").

- **Why does `head_bop_parakoopa_green` test `$7AF8,x` rather than
  `$701900,x`?** All three Parakoopa head-bop dispatchers use $7AF8
  as the "feather-already-spawned" lock-out, while the shelled-Koopa
  head-bop dispatchers use $701900 as the "already-stomped" lock-out.
  These are different slot-field semantics for similar lock-outs.
  Inference: $7AF8 is a generic per-slot timer pool that the Parakoopas
  use because their head-bop is one-shot per Parakoopa-lifetime (they
  morph away before they can be re-stomped); $701900 is an EXRAM byte
  used by the shelled Koopas because they need a persistent
  "has-been-stomped-before-on-this-life" marker that survives across
  the head-bop -> Naked-Koopa morph.

- **`CODE_07E2A1` (held-shell linkage) is only called by `main_koopa`
  (shelled), not by `main_koopa_naked` (Naked Koopa).** This is
  surprising because the "I'm carrying a shell" mechanism is the
  Naked Koopa's signature ability -- but the actual *pickup* happens
  in the Naked Koopa's state $00 via `CODE_07DE7F` + GSU
  `FXCODE_099856`, and the actual *re-spawn* of the shelled form is
  triggered when the Naked Koopa's state $00 spawn-block resolves.
  `CODE_07E2A1` is the **shelled** Koopa's "I'm about to throw my
  shell" path, called every frame to check whether the linkage has
  fired. Naming would be clearer if it were called something like
  `CODE_koopa_shell_throw_linkage`.

- **The Red Horizontal Parakoopa uses `$76,x` for Y-anchor; the Red
  Vertical Parakoopa uses `$18,x` for Y-anchor.** Both also use `$18,x`
  for X-anchor (horizontal only). This slot-field overload is
  fragile -- two different Parakoopa variants store anchors at
  different addresses without an explicit "anchor base" register.
  In the in-game code this is fine because the Parakoopas never
  share state -- but a richer per-slot field aliasing convention
  (per `docs/family-bandits.md` S6) could disambiguate.

- **The Goomba's head-bop "kicked" sprite at state $08 has its
  own state-machine separate from the head-bop state-machine.** The
  Goomba uses **two** state bytes: `$16,x` for normal main states and
  `$76,x` for head-bop sub-states. After the head-bop completes,
  control transfers back into `$16,x = $08` ("kicked") via
  `CODE_0C8606`. This is the only sprite in the family that uses
  two distinct state-byte slots; everyone else uses one or the other.
  Inference: the Goomba's "rolled into a sideways-shell" kicked
  state needed to coexist with the head-bop's own state, hence the
  byte split.
