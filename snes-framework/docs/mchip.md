# YI SuperFX (GSU-2) reference

A standalone reference for the Yoshi's Island SuperFX program: what it does,
how it's called from the 65816, what routines live in it, and what the
framework's anonymous `CODE_xxxxxx`/`FXCODE_xxxxxx` labels do.

It is the SuperFX counterpart to `docs/leveldataengine.md`. Bridges the
biggest gap in the public disassemblies — neither the framework nor the
`yoshisisland-disassembly` repo names the SuperFX routines descriptively;
both leave them as anonymous `CODE_*` / `FXCODE_*` labels.

Source of truth for addresses below: framework asm at
`yi/SuperFX/Banks/Bank08.asm`, `Bank09.asm`, `Bank0A.asm`, `Bank0B.asm`,
`Bank4C.asm`, `Bank4D.asm`, `Bank51.asm`.

---

## 1. What the SuperFX does in YI and why it matters

YI ships with a **GSU-2** (the second-revision SuperFX) on-cart. Three reasons
the GSU is more important than the community usually claims:

1. **It owns a large part of the player movement logic.** The GSU
   implements:
   - Player physics main: a primary player-calc routine with jump-active
     and no-jump paths, a coordinate-update step, D-pad input handling,
     and X-speed decay (friction).
   - Background collision: a main `bg_collision_check` routine with two
     alt-entry variants and a conditional-skip path; plus side-collision
     check (with internal helper + zero-context entry) and head+foot
     collision check (with zero-context entry).
   - Surface checks: water-in/out detection, foot-collision result reader,
     and a clear-on-read variant.
   - Sprite collision: side, head, and foot sprite-hit checks.
   - Pipe handling: pipe enter/exit transition handler (with a variant).
   - Cross-checks: coin pickup, fall-off-screen, past-boundary,
     coin-pickup-clear, and a combined BG+sprite collision check.

   The 65816 has to run a JSR-into-SuperFX-routine every frame to get Yoshi's
   physics state. This contradicts the widely-held model that "SuperFX in YI
   is only for visual effects".

2. **It owns the LZ16-style decompressor.** Compressed graphics in YI use two
   formats:
   - `.lz2` files -> `LC_LZ2` (Lunar Compress **FORMAT=1**; see §6.2 for
     the three-way byte-exact validation). Decoded by the SuperFX routine
     at `$08:A980` (`lz2_decompress`).
   - `.lz16` files -> `LC_LZ16` (Lunar Compress FORMAT=15). Decoded by the
     SuperFX routine at `$0A:8000` (a CMODE-bit-reader).

   Both decoders live on the GSU, not on the 65816. The 65816's
   `LoadGraphics` script dispatches per-graphic-ID by inspecting bit 15 of
   the `vramDest` field, then calls the appropriate SuperFX entry.

3. **It owns sprite scaling / rotation / Mode-7 transforms** (this is the
   well-known part). The whole `C_*_ROTZOM` / `C_*_ZOOM` / `R_*_ROTZOM` /
   `R_*_ZOOM` family of rasterisers lives here, plus the boss-specific
   Mode-7 setups (Hookbill, giant Baby Bowser, etc.).

**Implication for porting work:** any LZ16 port (whether to JS, TS, Python,
or another language) must follow the SuperFX routine at `$0A:8000` directly.
Third-party LZ16 implementations derived from GoldenEgg's C# bit-reader
diverge from Lunar Compress's output on the very first byte. The
authoritative source is the SuperFX routine, not 65816 code or any C#
port. Cross-check against `lc200/decomp.exe` (FORMAT=15) as ground truth.

---

## 2. GSU-2 register conventions

Brief reference for reading SuperFX assembly. The GSU-2 has **16 general-
purpose 16-bit registers** (R0-R15) plus several special registers:

| Reg | Convention / Role |
|---|---|
| R0  | Default source/destination for arithmetic + scratch |
| R1  | Loop counter or argument 1 |
| R2  | Loop counter or argument 2 |
| R3  | Argument / multiplier source |
| R4  | ROM bank (writes via `FROM R4 / ROMB`) |
| R5  | Often "ROM RAM bank" or constant holder |
| R6, R7 | Scratch / arguments |
| R8  | Constant holder (often $00FF terminator) |
| R9  | Source address (low 16 bits) - paired with R4 for full 24-bit addr |
| R10 | Destination address (low 16 bits) - paired with destination bank |
| R11 | Loop-target / branch hint register |
| R12 | LOOP counter (decremented by `LOOP`, branches on non-zero) |
| R13 | LINK / inner-loop target (set by `LINK #n` to PC+n) |
| R14 | Memory pointer for GETB/GETBH (auto-incremented by `INC R14`) |
| R15 | Program counter (writing R15 = jump) |

Special registers:

| Reg     | Name | Purpose |
|---|---|---|
| ROMBR   | ROM bank register   | Source bank for `GETB`/`GETBS`/`GETBH`. Set via `FROM Rn / ROMB`. |
| RAMBR   | RAM bank register   | Source/dest bank for `LDB(Rn)`/`STB(Rn)`. Set via `FROM Rn / RAMB`. |
| SBR     | Screen base register | Mode-7 / character mode screen address. |
| SCBR    | Screen char base    | Per-tile character data base. |
| SCMR    | Screen mode register | Resolution / colour-depth selection. |
| CFGR    | Configuration reg   | Multiplier mode / interrupt enable. |
| CBR     | Cache base register | Read-only: where the 512-byte CACHE was last filled from. |

Operand prefixes that recur in the framework asm:

- `IBT Rn, #x`      Load 8-bit immediate (sign-extended) into Rn.
- `IWT Rn, #x`      Load 16-bit immediate into Rn.
- `MOVE Ra, Rb`     `Ra := Rb`. (Note: register-aliased "TO Ra"/"FROM Rb"/"WITH Rb" modifiers
                    on the NEXT instruction reroute source/dest as well.)
- `STB (Rn)`        Store byte to RAM[RAMBR:Rn].
- `LDB (Rn)`        Load byte from RAM[RAMBR:Rn].
- `STW (Rn)`        Store 16-bit word to RAM[RAMBR:Rn..Rn+1].
- `LDW (Rn)`        Load 16-bit word.
- `SM (addr), Rn`   Store Rn to absolute SuperFX RAM address.
- `SMS (addr), Rn`  Short-store: `addr` is 8-bit, prefixed by some default page.
- `LMS Rn, (addr)`  Short-load.
- `GETB`            Read byte at ROM[ROMBR:R14] into R0. (Doesn't auto-inc R14.)
- `GETBS`           Sign-extending GETB.
- `GETBH`           Read high byte of an aligned 16-bit ROM word.
- `CACHE`           Refill the 512-byte instruction cache from current PC.
- `LOOP`            Decrement R12; if non-zero, branch to address in R13.
- `LINK #n`         Set R11 := PC+n (return-address generator).
- `STOP : NOP`      Halt the GSU (returns control to 65816). The NOP is
                    mandatory and runs after the host re-reads GO bit.

The `:` between two opcodes (e.g. `STOP : NOP` or `LOOP : INC R10`) is asar's
"pipelining" syntax -- two GSU instructions per source line, the second
running in the GSU's pipeline slot after the first.

---

## 3. Per-purpose routine catalog grouped by function family

The GSU program splits into ~370 distinguishable routines and data tables.
This section groups them by behavioural function. High-confidence matches
(verified by behaviour/signature) are marked "verified"; the rest are
positional / by-elimination.

### 3.1 Math and trig tables

All in Bank08, contiguous data block at `$08:AB90`-`$08:B157`. Framework
labels are at the same physical address; each gets an alias in
`yi/SuperFX/Banks/Bank08.asm`.

See: `chip/ys_chip0.asm`, `chip/ys_chip.inc` (trig-table base definitions).

| Framework label | SuperFX addr | Type | Size |
|---|---|---|---|
| `DATA_08AB90 / wavy_amplitude_map` | `$08:AB90` | wave-amplitude lookup (for sprite distortion) | 10 bytes |
| `DATA_08AB98 / cos_table`          | `$08:AB98` | 16-bit cosine, 1/4 turn | 65 entries (130 B) |
| `DATA_08AC18 / sin_table`          | `$08:AC18` | 16-bit sine, full turn | 256 entries (512 B) |
| `DATA_08AE18 / lcos_table`         | `$08:AE18` | 8-bit cosine | 64 entries (64 B; stored as 32 dw) |
| `DATA_08AE58 / lsin_table`         | `$08:AE58` | 8-bit sine | 256 entries (256 B; stored as 128 dw) |
| `DATA_08AF58 / lcos_s_table`       | `$08:AF58` | 8-bit slow-attack cosine | 128 entries |
| (block continues at $08:B058)      | `$08:B058` | 8-bit slow-attack sine | 128 entries |

All **verified by byte-for-byte table value comparison**. The dw-packed
storage means a SuperFX `LDB(Rn)` indexed by angle reads one byte; consumers
of the 16-bit tables use `LDW(Rn)`.

The "slow-attack" variants are flatter-peaked sines/cosines (more entries
near $40 max, $00 min) -- used by interpolated zoom routines that need to
slow at the endpoints. The standard 8-bit cosine/sine are 64-step quarter-
turns; the slow-attack variants are 128-step.

Other math routines (in Bank09 / Bank0A / Bank0B):

| Likely framework location | Purpose |
|---|---|
| `DATA_0B8000` (top of Bank0B)  | Wide / weighted 16-bit cosine table (256 B) |
| `DATA_0B8100` (Bank0B)         | Wide / weighted 16-bit sine (256 B) |
| Late Bank09                    | General 16x16 multiply with rounding |
| Bank0A                         | Tangent lookup |
| Bank0A                         | Arctangent for angle calculation |
| Bank0A                         | Angle check / quadrant decode |
| Bank0A                         | Get radius/length (short form) |

### 3.2 Decompression

Two distinct decompressors live in the SuperFX program. They share
nothing structurally; they exist as separate routines because they
serve different purposes:

| Framework label | SuperFX addr | Source file | Format | Purpose |
|---|---|---|---|---|
| `CODE_08A980 / lz2_decompress`   | `$08:A980` | `chip/ys_chip0.asm` (entry $5 bytes into the bank's `ys_chip0` segment per the link map) | LC_LZ2 (Lunar Compress FORMAT=1) — cart labels it "lz1" but the format is LZ2 | **Format-agnostic byte stream.** Stages output as raw bytes — caller decides what to do with them. Used for 4bpp tile graphics AND for BG1/BG2 tilemap-index arrays. |
| `CODE_0A8000 / lz16_decompress`  | `$0A:8000` | `chip/Gdefchr.asm` (filename = "Get-Define-CHR"; the whole 457-byte file is this single decompressor — bank `$0A` starts with it) | LC_LZ16 (FORMAT=15) | **Tile-graphics-only.** Has CGRAM-aware 4bpp tile setup folded in: opens with `CMODE` (configures GSU bit-fetch from prefetch) and `IWT R4,#$0F0F` (4bpp colour mask), reads a 3-byte palette/control header, then writes tiles straight through the GSU plot pipeline. Wired for 16-colour CHR data end-to-end. |

The format split in YI: 115 tile-graphics files + 150 tilemap files
are LC_LZ2; 187 tile-graphics files are LC_LZ16. Tile-graphics files
were apparently assigned to whichever format compressed that asset
better. See `docs/enginecore.md` §6.

**`CODE_08A980` (LZ2 decompressor, cart calls it "lz1")** is verified
end-to-end by the three-way validation suite — see
`scripts/{generate-lz2-{testdata,port,mesen},compare-lz2}.ts` and
`trace-harness/scenarios/lz2-extract/`. 261/265 entries byte-match
across `lc200/decomp.exe FORMAT=1`, the TS port at
`scripts/lz2-decoder.ts`, and the cart's live runtime. Structurally:
same
constants (R5=$03FF, R6=$1F, R7=$00E0, R8=$FF), same 4-way dispatch on the
top 3 bits of each control byte. INPUTS:
- R4 = ROM bank (banks $40-$5F)
- R9 = source byte address (within bank R4)
- R10 = destination address (typically SRAM `$70:5800`)
OUTPUTS:
- R10 = post-decompress destination end
MODIFIES: R0-R7, R9-R15.

**`CODE_0A8000` (LZ16)** opens with `CMODE` (sets the GSU to read branch
operands as bits from a prefetched byte) and immediately sets up a 4bpp
palette mask, then reads the file's 3-byte palette/control header.
INPUTS:
- R0 = ROM bank
- R1 = source byte address
- R3 = decompress tile count (1-128 dots)

The whole bank-`$0A` head is a nested LSR/ROL/BCS bit reader with
`LINK #4` chains to a shared GETB refill. The output destination isn't
a parameter — it's wherever the GSU's PLOT context is configured to
deposit pixels (typically the active CHR slot in VRAM). Any port of
this format must match this routine exactly; the bit-level format spec
exists only in the GSU code.

The two routines should NOT be confused as "version 1 vs version 16
of one algorithm" — they're two independent compression schemes with
different purposes, packaged in adjacent SuperFX banks.

### 3.3 Player physics routines

See: `chip/ys_mplay.asm`, `chip/ys_mplay0.asm`, `chip/ys_mplay3.asm`
(player-physics main + jump / no-jump / coord-update entry points),
`chip/ys_mpldt.asm`, `chip/ys_mpldt0.asm` (player physics data tables --
speed limits, accel/decel constants, walk-pattern timing).

These are the "big revision to community understanding" routines -- they
live on the GSU, not on the 65816. The framework hides them inside Bank0A's
anonymous CODE_0Axxxx labels. Locating each one precisely requires more
cross-referencing than was practical for this pass, but the high-confidence
position is the post-LZ16 region (`$0A:8200` onward).

| Inferred SuperFX range | Routine | Notes |
|---|---|---|
| `$0A:9xxx`-`$0A:Axxx` | player physics main | Reads jump flag, Y speed, move speed, then dispatches to jump-active / no-jump paths. |
| within physics body   | jump-active path | Taken when jump-flag indicates active. |
| within physics body   | no-jump path | Sets ROMB to BANK LCOS, reads player angle, indexes LCOS table -- this is the "ground-walking horizontal speed via cos(angle)" calc. |
| continues from physics| coordinate update | Updates X/Y from speed registers. |
| called from no-jump   | D-pad input | D-pad to acceleration delta. |
| helper                | X-speed decay | Friction. |
| `$0A:D08C`            | `bg_unit_read` (`CODE_0AD08C`)         | BGUNIT_READ -- one-cell BG probe. Pre-reads (X, Y) offsets from `(R14)`, adds R9/R10 (player base XY), then falls into the cache + decode chain. See §3.3.1. |
| `$0A:D095`            | `bg_unit_read_short` (`CODE_0AD095`)   | BGUNIT_READ_S -- short-form entry; caller already set R8/R0 = absolute (X, Y) probe coords. Most heavily used (12+ call sites in Bank0A alone). |
| `$0A:D0A1`            | (cache-hit path) (`CODE_0AD0A1`)       | BGUNIT_READ_000. Bounds-checks against `($A4)` / `($A6)` (live BG2 origin), reads the cached 16-bit tile word from `BGCHECK_BUF` at `$0A:409E`. |
| `$0A:D0C8`            | `bg_unit_fetch_wram_cell` (`CODE_0AD0C8`) | BGUNIT_READ_002 -- cache-miss path. Computes the cell offset in `$7F:8000` (`!RAM_YI_Level_LevelDataBuffer`) and invokes `mRAM_READ` (`STOP:NOP`) so the 65816 fetches the 16-bit tile ID. |
| `$0A:D0F2`            | `bg_unit_decode_attrs` (`CODE_0AD0F2`) | BGUNIT_READ_010 -- **the Map16-page attribute decoder.** Indexes the per-page table by `(tile_id >> 8) * 3`, reads the 3-byte entry, applies the switchable-block override. See §3.3.1 + §3.3.2. |
| `$0A:D12F`            | `bg_unit_offscreen_default` (`CODE_0AD12F`) | BGUNIT_READ_020 -- off-screen safety: returns a fixed unit no. (`$0001`) instead of indexing past the buffer. |
| `$0A:D134`            | `bg_unit_read_neg_y_offset` (`CODE_0AD134`) | BGUNIT_READ_O -- "negative Y" entry: when the probe Y is above screen top, reads from the per-row Y-offset table at `($1F30)` (CBG2OFF + offset) and re-enters the standard path. |
| side-collision check  | BG_SIDECK / BG_SIDECK_IN | Side-collision; consumes the BGUNIT_READ output. Bank0A late `$D2xx`. |
| alt-entry             | BG_SIDECK_0000 (zero-context) | |
| head + foot collision | BG_HDFTCK | Head + foot collision. Probes one cell, then for slope shapes (`SK` bit) re-probes with `BGUNIT_READ_S` and indexes SAKA_DATA (`DATA_0ABD0E` = `slope_panels_table`, see §3.3.2) for per-X-pixel Y offset. |
| alt-entry             | BG_HDFTCK_0000 (zero-context) | |
| foot result reader    | FOOT_RESULT | Reads the latched foot-collision result. |
| foot result + clear   | FOOT_RESULT_C | Clear-on-read variant. |
| water in/out          | WATR_CHECK | Reads player vertical position, water level. |
| `$0A:Cxxx`            | enemy/object list insert | Insert into GSU-side enemy/object list. |
| `$0A:Cxxx`            | enemy/object list extract | Remove from list. |
| `$0A:Cxxx`            | coin-pickup cross-check | |
| `$0A:Cxxx`            | fall-off-screen cross-check | Detects Yoshi falling off-screen. |
| `$0A:Cxxx`            | past-boundary cross-check | |
| `$0A:Cxxx`            | clear coin-pickup flag | |
| `$0A:Cxxx`            | combined BG+sprite collision check | |
| `$0A:Cxxx`            | pipe enter/exit transition | |
| `$0A:Cxxx`            | pipe enter/exit transition #2 | Variant. |

#### 3.3.1 Map16 collision decoder -- the `BGUNIT_READ` chain

Yoshi's collision against the level grid is decoded entirely on the GSU.
The 65816's job is to stamp Map16 tile IDs (16-bit words) into the
foreground grid at `$7F:8000` (`!RAM_YI_Level_LevelDataBuffer`,
2 bytes per cell); the GSU pulls each cell on demand and translates
the tile ID into shape + surface flags.

Entry: `bg_unit_read_short` (`CODE_0AD095` @ `$0A:D095`). Inputs are
the absolute probe coords (R8 = X, R0 = Y); inside-screen vs off-screen
dispatch picks the cache path or the WRAM fetch path. Either way the
fetched 16-bit Map16 tile ID lands in R0 and execution continues at
the decoder (`CODE_0AD0F2`).

The decoder is essentially:

```
MOVE R6, R0           ; R6 = full 16-bit tile ID
HIB                   ; R0 = (tile_id >> 8) = Map16 PAGE index (0..167)
UMULT #3              ; R0 = page * 3  (3-byte entries)
IWT R14, #DATA_0ABB12 ; base of bg_type_table (see §3.3.2)
TO R14 / ADD R14      ; R14 = entry address
GETB                  ; R0[7:0] = byte 0
INC R14
GETBH                 ; R0[15:8] = byte 1  (R0[7:0] preserved)
INC R14
MOVE R7, R0           ; R7 = (byte1 << 8) | byte0

; -- switchable-block path (tags 0..15) ----------------------
HIB / AND #$F8        ; isolate tag-bits-shifted-up (bits 3..7 of byte 1)
SUB #$72 / SUB #$0F   ; threshold = $81; BCS skips switch logic for tags >= 16
ADD #$11
LM R8, ($1E08)        ; CSWITCH_1 -- the in-level switch state byte
AND R8
BEQ skip
WITH R7 / OR #$02     ; set AL bit (force "solid-all") when switch is active

GETB                  ; R8 = byte 2 (slope sub-index, if SK bit set)
MOVE R0, R7           ; R0 = R7 = composite (byte1 << 8) | byte0
mRTS                  ; return: R6=tile_id, R7/R0=attrs, R8=slope_idx
```

Bank13's `STA.l !RAM_YI_Level_LevelDataBuffer,x` writes 16-bit tile IDs
(REP #$30 active throughout the stamp handlers). The HIGH byte of that
word is the Map16 PAGE (cell-shape family); the LOW byte is the
within-page tile index (visual variant). All visual variants of one
page share the same collision -- that's why a single 168-entry table
suffices for ~5K Map16 tiles.

#### 3.3.2 The per-page attribute encoding (`DATA_0ABB12`)

`DATA_0ABB12 / bg_type_table` at `$0A:BB12-$0A:BD09` is the
**only authoritative source of Map16 collision behaviour** in the
cart. 504 bytes total = 168 entries × 3 bytes; the high byte of any
Map16 tile ID is the index. The visual-data tables at
`$4C:33F2-$4C:D619` (`docs/leveldataengine.md` §3.4.5) contain no
collision metadata; all sub-tile words there are consumed by the
graphics renderer (vflip/hflip/priority/palette/tile-index = 16 bits
each, no spare bits).

Each 3-byte entry is a packed 24-bit value:

```
Byte 0 -- shape + surface flags
  bit 0   MD   partial-solid (head/foot collidable, sides pass through)
  bit 1   AL   solid-all
  bit 2   SK   slope (see byte 2 + slope_panels_table)
  bit 3   WT   water
  bit 4   MG   lava
  bit 5   TN   tunnel
  bit 6-7      unused

Byte 1 -- door bits + 5-bit secondary tag
  bit 0   DR   door
  bit 1   BD   bonus door (key-locked entry)
  bit 2        unused
  bits 3-7     secondary tag (5-bit, 0..31; 28 values defined)
               0=none            1=YK  snow/grass floor 2=SP  soap
               3=HK  dented floor 4=DO  mud              5=YG  lava
               6=CO  coin         7=QB  ? block          8=ET  edible-BG
               9=SN  rail        10=FL  damage          11=KU  stake
               12=KL stairs-left 13=KR  stairs-right    14=OD  falling-floor
               15=CB switch block 16=MB Mario block     17=TK  tube block
               18=CT countdown   19=WF  waterfall floor 20=DK  pipe
               21=SG cedar tree  22=CC  switch coin     23=IC  ice block
               24=GG wobbly rock 25=HR  damage(slope)   26=TR  damage(icicle)
               27=DE knockdown    (28..31 unused)

Byte 2 -- slope sub-index (only when SK bit set in byte 0)
  $00..$1F  → slope_panels_table[idx * 128], 32 static slope profiles
            (128 B / panel = 16 in-tile pixel rows x 8 B / row)
  $80..$81  → "RAM-supplied" runtime slope (for moving / boss slopes)
```

**Note on tag `$14` (DK "pipe") -- the pipe-mouth marker, with TWO
consumers.** Only one Map16 page carries this tag: page `$7D` (also flagged
`AL` solid). An earlier revision of this note claimed the tag "is NOT a
player-warp marker" and that enterable/un-enterable pipes stamp it
identically -- **both claims were wrong** (counterexample: level `$3B`
obj[279], an Enterable vertical pipe that warps with no sprite on its
screen). The verified model:

1. **Player pipe entry (tile-driven).** The GSU player collision probes
   (Bank0B: head probe near `CODE_0BA3CE`, foot probe near `CODE_0BD032`,
   third site near `$0B:DC0D`) accept a tile when its collision word passes
   `R7 & $F800 == $A000` (= tag `$14`) AND the per-tile byte
   `DATA_0AEBBC[tile & $FF]` carries the pressed direction's entry bit
   (low nibble: `$01`/`$02` horizontal, `$04` down, `$08` up). On accept,
   `CODE_0BDC20` derives the transition orientation from the tile id
   (>= `$7D0B` = horizontal family), writes PipeTransitionType (`$0106`)
   and sets PlayerState `$06` via GSU `SMS` -- invisible to 65816-side
   greps. So enterability is per-TILE: `$3C` Enterable vertical pipe stamps
   mouth `$7D08`/`$7D09` (entry bytes `$04`/`$84`) while `$F4` Un-enterable
   stamps the *untagged* page-`$79` family -- those pipes warp only via a
   co-located entrance sprite (`docs/family-pipes-signs.md`).
2. **Enemy-generator gate.** `CODE_0EB8AE` (`$0E:B8AE`): Shy Guy (`$1E`),
   Lantern Ghost (`$133`), Cactus Jack (`$156`) and Boo Guy (`$19A`) call it
   at Init and, if standing on a DK tile (or the hardcoded `$79`-family
   mouth tiles `$79F1`/`$79F2`), switch themselves into proximity-triggered
   generators that emit enemies *out* of the pipe. See
   `docs/family-shyguys.md` §2.

The `BG_HDFTCK` head/foot consumer tests `MD+SK` ($05) for head probes
and `SK` ($04) for foot probes. On an SK hit, it indexes
`DATA_0ABD0E / slope_panels_table` at

```
addr = DATA_0ABD0E + slope_idx * 128 + (probe_x & $0F) * 8
                   + 0 if going "down" (R3 >= 0)
                   + 2 if going "up"   (R3 <  0)
```

reads two GETBs (low + sign-extended high) from that address, and
produces the per-pixel Y offset of the slope surface within the
16×16 tile. So each 8-byte row pair within a panel holds **two**
signed-Y values -- one per direction.

`DATA_0ABD0A`, 4 bytes earlier, is **not** dead data -- it's the
sibling entry point used by the side-collision routines `BG_SIDECK`
in Bank0A (`CODE_0AD8AC` @ `$0A:D8AC`) and Bank0B (`CODE_0BA85F`
@ `$0B:A85F`). Same formula, but probe Y (`LMS R0, ($02)`) replaces
probe X and the base sits 4 bytes earlier so its in-cell reads
land at offsets 4,5 / 6,7 of each DATA_0ABD0E-cell (and into the
4-byte preamble when slope_idx=0, x=0). The 8 bytes of every row
are partitioned between foot-collision (offsets 0..3) and
side-collision (offsets 4..7) lookups. Total table size: 32 panels
× 128 B = 4096 B at `$0A:BD0A-$0A:CD09`.

The switchable-block path (tags 0..15) reads `CSWITCH_1` at GSU RAM
`($1E08)` and bit-ANDs it with the tag's bit pattern; matches force
the cell's shape to AL. Different tags carry different bit signatures,
so a single switch byte can selectively solidify subsets of the
24 switch-eligible tags simultaneously.

See also: `chip/ys_msub0.asm` (macro-form definitions of the
EN_BGTYPE table reproduced byte-for-byte here, and the SAKA_DATA
slope panels); `union/ys_bgcheck.h` (the NO/AL/MD/SK/WT/MG/TN +
secondary-tag constants reproduced above); `chip/ys_mplay.asm`
(BGUNIT_READ / BG_HDFTCK / BG_SIDECK consumers).

### 3.4 Effect spawns

See: `chip/ys_chip3.asm` (effect-spawn routines: water bubble / splash,
dust, particle, dash-smoke trigger).

| Purpose |
|---|
| Spawn water-bubble effect (two variants). |
| Spawn water-splash-up #0 (two variants). |
| Spawn water-splash-up #1 (two variants). |
| Spawn "broken background" particle. |
| Dash-smoke spawn check (when Yoshi runs fast). |
| Ground-pound landing check (sound + dust trigger). |

These all live in the `$0A:C000-$0A:CFFF` range based on internal ordering
(effect-spawn block comes after BG collision, before the rasterisers).

### 3.5 BG-data reads

See: `chip/ys_chip3.asm` (BG-tile fetch by map coord), `chip/ys_mplay.asm`
(BG-collision probe consumer).

| Purpose |
|---|
| Read 1 BG tile-unit (16x16) given map coords. |
| Short-form variant of above (cached lookup). |

### 3.6 Sprite collision

See: `chip/ys_chip4.asm` (sprite-on-sprite hit checks: side / head / foot).

| Purpose |
|---|
| Side sprite-hit check. |
| Head sprite-hit check. |
| Foot sprite-hit check. |

### 3.7 Specialty movement (vehicle / mount modes)

See: `chip/ys_mplay0.asm`, `chip/ys_mplay3.asm` (per-mount-mode physics
dispatchers + tongue states), `chip/ys_mpldt0.asm` (per-mount data tables).

Each is a vehicle / mount mode dispatcher. All live in Bank0A or Bank0B.

| Mode |
|---|
| Yoshi-on-car (Mt. Wickol race). |
| Helicopter Yoshi. |
| Submarine Yoshi. |
| Mole Yoshi (digging). |
| Baby Mario when off Yoshi. |
| Train Yoshi. |
| Ski Yoshi. |
| Eggless intermediate (between dismount and remount). |
| Baby Mario "particle / push hose" effect (the cry-out splash). |
| Tongue states (extend / retract / end). |

### 3.8 Surface flags -- DATA, not code

See: `chip/ys_mpldt.asm`, `chip/ys_mpldt0.asm` (per-surface flag tables
indexed by Map16 ID).

Exported as DATA labels (tables), not subroutines, in Bank0A or Bank0B.
They classify which surface Yoshi is on:

| Surface |
|---|
| Soap (slippery boss-1 floor). |
| Water. |
| Ice block. |
| Snow. |
| Mud. |
| Skis. |

Each is a 1-byte flag-per-tile-type table indexed by current Map16 ID.

### 3.9 Player animation / pattern tables

See: `chip/ys_mpldt.asm`, `chip/ys_mpldt0.asm` (animation pattern tables,
per-state frame timings, mount-mode animation data).

The longest table cluster in the GSU program. These are all data tables for
state-driven player animation. Each is referenced from the player-physics
state-machine code in Bank0A. Examples:

- Master player struct layout reference table.
- Per-walk-frame sound trigger.
- Ground-pound animation phases (windup / down / end).
- Swim animation (normal + downward).
- Staircase walk patterns.
- Pipe-type lookup.
- Walk / dash speed constants.
- Speed limits (max walk / max dash / accel / min / decel).
- Tongue-eat animation (offset position, shot data, frame pattern).
- Fire-spit XY + state pointers.
- Soap-spawn state (XY + state pointers).
- Watermelon fruit XY.
- Idle-twitch animations (blink, look-around, etc.).
- Per-step walk animation timing (10 entries) and walk-sound trigger.
- Wobbly-effect timing + frame pattern + egg pattern.
- Swinging-effect pattern.
- Mole-mode tables.
- Mario-rider mode tables.
- Helicopter mode tables.
- Submarine mode tables.
- Train mode tables (with rail-tracking sub-tables).
- Car-mode tables.
- Collision-probe offset lookups per surface type.

### 3.10 Mode-7 / boss rendering

See: `chip/ys_chip5.asm`, `chip/ys_chip6.asm` (boss OAM packing, Mode-7
matrix solves, per-boss render dispatchers).

All in Bank08 / Bank09:

| Framework label | Purpose |
|---|---|
| `CODE_08AA5F / boss_mode7_init` | Mode-7 tilemap init for Hookbill's shell and giant Baby Bowser. **Verified.** |
| Bank08 mid-bank | "M-Pack" boss OAM packing. |
| Bank08 mid-bank | "SB" boss OAM packing. |
| Bank08 mid-bank | "M-Pach" boss OAM packing. |
| Bank08 mid-bank | "D-Tele" effect OAM packing. |
| Bank08 mid-bank | "Geroz" OAM packing. |
| Bank08 mid-bank | Boss 1-player morph. |
| Bank08 mid-bank | Enemy 1-pixel rotation. |
| Bank08 mid-bank | Enemy 1-pixel rotation variant. |
| Bank08 mid-bank | Boss-0 (Hookbill) OAM packing. |
| Bank08 mid-bank | Boss-0 X-position reverse. |
| Bank09 / Bank0B | Floating-floor check. |
| Bank09 / Bank0B | Floating-floor position calc. |
| Bank09 / Bank0B | Zoom-mode player check. |
| Bank09 / Bank0B | Mill-style boss OAM calc. |
| Bank09 / Bank0B | Maruth check. |

### 3.11 Sprite rendering / OAM

See: `chip/ys_chip1.asm` (enemy-data shifted-read + sprite OAM packing).

| Framework label | Purpose |
|---|---|
| `CODE_098000`     | Enemy-data shifted-read (pixel->tile coord convert). |
| `CODE_09xxxx`     | Enemy cross-check. |
| `CODE_08B1Dx`     | Player sprite OAM packing. |
| (data label)      | Enemy character bank pointer table. |
| (data label)      | Secondary asset table ("etc" address). |

### 3.12 Rotation/zoom rasterisers

See: `chip/ys_chip5.asm`, `chip/ys_chip6.asm`, `chip/ys_chip7.asm`
(C_*_ROTZOM / C_*_ZOOM / R_*_ROTZOM / R_*_ZOOM rasteriser families).

The C_ family lives in Bank08; the R_ family lives in Bank0A / Bank0B.
These are the bulk of the SuperFX entry points in
`yi/SuperFX/RoutinePointers.asm` -- 50+ of the table's 306 entries are one
of these rasterisers, each specialised for a different source-bitmap size /
destination-stride / clipping behaviour.

C_ family (character renderers, in Bank08):
- `C_16_ROTZOM`, `C_16_ROTZOM_C` -- 16x16 rotation-and-zoom (with clip).
- `C_16_ZOOM`, `C_16_ZOOM_XY`, `C_16_RTZ_16_XY` -- 16x16 zoom variants.
- `C_32_ROTZOM`, `C_32_ROTZOM_C`, `C_32_ROTZOM_16`, `C_32_ROTZOM_C16`.
- `C_32_ZOOM`, `C_32_ZOOM_XY`, `C_32_ZOOM_XY_C`, `C_32_ZOOM_16`, `C_32_ZOOM_XY_16`.
- `C_32_RTZ_16_XY`, `C_32_RTZ_32_XY`.
- `C_64_ZOOM_16`, `C_64_ZOOM_32`, `C_64HZOOM_32`.

R_ family (result renderers, in Bank0A / Bank0B):
- `R_32_ZOOM_16`, `R_32_ZOOM_16_XY`.
- `R_32_RTZ_32`, `R_32_RTZ_32_XY`, `R_32_RTZ_C32_XY`, `R_32_RTZ_32_XY_C`.
- `R_32_ZOOM`, `R_32_ZOOM_XY`, `R_32_ZOOM_XY_C`.

Plus a small "push-table" helper used by R_ variants.

The framework's per-routine pointers for these all start at the
`CODE_0880xx`-`CODE_08A8xx` range (head of Bank08) for C_ variants, and
the late Bank0A / Bank0B for R_ variants.

### 3.13 Message-window polygon rasteriser

See: `chip/ys_chip0.asm` (message-window polygon rasteriser at head-of-bank).

`CODE_088002 / mswin_poly` is the message-window-polygon rasteriser at
the very head of Bank08. It is one of the most heavily called SuperFX
routines -- the cinematic message-window animation and the Mode-7 boss
intro both call into it.

INPUTS (register conventions):
- R1 = X rotation angle
- R2 = Y coord
- R3 = Y identifier
- R4 = scale factor (zoom)
- R5 = center X
- R6 = ID Y

OUTPUTS: HDMA window-mask buffer at `$7E2400`.

### 3.14 Special bitmap data tables

See: `chip/ys_chip.inc`, `chip/ys_chip2.inc` (bitmap-object include
definitions referenced by the rasterisers).

Pure data, lives entirely in Bank4C and Bank4D:

| Addr | Purpose |
|---|---|
| `$4C:32A4`         | Pointer table for compressed bitmap asset payloads. |
| `$4C:33F2`         | The bitmap asset payloads themselves. |
| (Bank4C / 4D area) | Per-enemy bitmap dispatch table. |
| (Bank4C / 4D area) | Bitmap-object lookup table. |
| (Bank4D)           | Bird (world 5) bitmap-object entries 00-12. |
| (Bank4D)           | Mountain bitmap-object entries 0-2+. |

The bitmap-object tables are bitmap-fragment descriptors for the SuperFX
rasterisers -- each describes a chunk of source bitmap (offset, dimensions,
clip flags) to feed into a C_*_ROTZOM call.

### 3.15 Per-enemy data

See: `chip/ys_chip1.asm` (enemy-data pointer-table consumer),
`chip/ys_chip.mac` (per-enemy bitmap-asset macros).

| Addr | Purpose |
|---|---|
| `$4D:0000` (= `DATA_4D0000 / enobj_data_ptrs`) | Per-enemy asset pointer table -- one dw per enemy ID, most are $0000. |
| `$4D:048A`        | Enemy special-character address table. |
| `$4D:0914`        | Enemy sprite-pointer character address table. |
| (Bank0B?)         | Enemy data address pointer (used by the enemy-data shifted-read routine). |

### 3.16 Spark effects (data tables)

See: `chip/ys_chip3.asm` (spark-effect spawner + per-pattern data tables).

These are data tables only:

- Spark X/Y speed + angle tables.
- Spark X/Y reverse-flag tables.
- Triple-spark variants (X speed, Y speed, angle).
- Spark BG-collision probe positions (two pairs).
- Spark BG-collision-data skip flag.
- Spark return-bounce reverse-flag tables.

All data tables; live somewhere in Bank0A or Bank0B.

### 3.17 Stage-intro level-name overlay renderer

The "1-1 Make Eggs, Throw Eggs"-style overlay that fades in at level
entry is rendered by `FXCODE_09E92F` (GSU side) driven once per ~4
IRQs from `render_stage_intro_level_name` (`CODE_00C778`, Bank00) --
which itself is gated by the stage-intro flag `$0121` from irq_1
(see `docs/enginecore.md` §4.7 for the per-frame gating).

INPUTS:
- R0:R10 = `DATA_level_name_string_ptrs` (Bank51 `DATA_5149BC`),
           a 72-entry `dw` pointer table indexed by level ID.
- R14   = `!RAM_YI_Level_CurrentLevelFromMapLo` (the level ID).
- R11   = LINK destination + state byte from `$0D21 & $003F`.
- R8/R9 = vertical / horizontal scratch positions (`$0D1F` / `$0D1D`).

The chosen string is `db $FF, x_col, <chars>` and optional
`db $FE, y_off, x_col, <chars>` lines using the YI font encoding from
`Tables/Fonts/Main.txt`, terminated by `db $FD`. The GSU streams
character glyphs out to BG3 tilemap VRAM.

The 72-entry pointer table is 12 slots × 6 worlds: 8 main levels + 1
Extra + 3 padding per world (world 1's slot $0B holds the special
`DATA_welcome_to_yoshis_island` splash, the other 21 padding slots
all point at `DATA_level_name_garbage_sentinel` which is unreachable
during normal gameplay because the world map never sets
`CurrentLevelFromMap` to a padding-slot ID).

See also: `chip/ys_chip2.asm` and following for the GSU side. The font
glyph *bitmaps* are a fixed 12-byte-per-character table inside the GSU
program (not in Bank51); the head of `yi/SuperFX/Banks/Bank51.asm` holds
the two text-data systems (this level-name overlay table at `$51:49BC`,
and the message-box system at `$51:10DB` -- see §3.18).

### 3.18 Cinematic message-box / tutorial text system

A **second, separate** Bank51 text system, distinct from the level-name
overlay (§3.17) in both data format and renderer. It drives the intro
cutscene speech, in-level tutorial pop-ups, boss / Kamek dialogue,
bonus-minigame title cards, and the Yes/No prompts ("Try this stage
again?", "Re-start from the middle ring?").

**Data layout (head of `Bank51.asm`):**

| Addr | Label | Purpose |
|---|---|---|
| `$51:10DB` | `DATA_message_box_text_ptrs` | Message-ID -> 16-bit pointer table (low word of a `$51:xxxx` address). ~300 slots; unused IDs point at `DATA_message_box_empty` or are `$0000`. |
| `$51:1333`-`$51:4986` | `DATA_msg_intro_paradise` … `DATA_msg_*` | The message payloads (English text + markup; each now individually named `DATA_msg_*` / `DATA_msg_minigame_*`). |
| `$51:3DF8` | `DATA_message_box_empty` | The empty message: a bare `dw $FFFF`. Every unused / padding message-ID slot points here. |

Note the head of Bank51 is this pointer table + message text, **not**
font glyph bitmaps (a common mislabel -- the glyphs live in the GSU
program). The character *encoding* legend (which byte renders which
icon/accent) is catalogued in the comment block at the top of `Bank51.asm`.

**Invocation:** `CODE_show_message_box` (Bank01, cart `$01:E180`) reads the
message ID from GSU SRAM `$70:4070`, doubles it (`ASL`), indexes
`DATA_message_box_text_ptrs`, writes the resulting pointer + bank `$51` to the
GSU input block (`$70:4096` / `$70:4098`), passes the current life count
(`$70:409A`), and launches GSU routine **`FXCODE_09B03E`** -- the message
renderer. (`FXCODE_09B03E` is also entered for the game-over screen and a
couple of other call sites.)

**Message-stream format** -- a byte stream mixing three token kinds,
authored with `table "Tables/Fonts/Main.txt"`:

1. **Literal characters** -- `db "..."` / `db $XX`, one byte per glyph.
   Most are ASCII; the non-ASCII slots are printable icons / accents
   (button icons `$18-$2B`, arrows `$2C-$30` / `$FA`, star `$F6$F7`,
   D-pad `$CA$CB`, accented letters, etc.). These are *glyphs*, not
   control codes -- they render exactly like letters.
2. **Control words** -- `dw $XXFF`. The renderer reads a 16-bit word and
   tests its **low byte**: `$FF` flags a control code, and the **high
   byte selects the command** through a 256-entry jump table. A word
   whose low byte != `$FF` is printed as glyph #low-byte. Control words
   consume 2 bytes; literal glyphs consume 1.
3. **Terminator** -- `dw $FFFF` (command `$FF`) ends the message.

**Control codes** (✓ = emitted by the shipped US text):

| Word | Cmd | Behaviour |
|---|---|---|
| `$00FF`-`$04FF` | 00-04 | Clear the message window (whole window / line 0 / 1 / 2 / 3). |
| `$05FF`-`$08FF` ✓ | 05-08 | Move cursor to absolute row 1/2/3/4 (Ypos `$10`/`$20`/`$30`/`$40`, Xpos 0). A box's first four lines. |
| `$09FF` | 09 | Newline -- advance one row, wrapping to the top row past the bottom. |
| `$0AFF` ✓ | 0A | Input/pacing checkpoint: poll the controller, play a blip (SFX `$5C`) on input, then fall into `$0F`. |
| `$0BFF` / `$0CFF` | 0B / 0C | Fade-in / fade-out -- **disabled** in the shipped game (handler bodies commented out; fall through to the line-break handler). |
| `$0DFF` / `$0EFF` ✓ | 0D / 0E | Clear the incoming (bottom) line buffer and newline to row 5. The workhorse line break between body lines. |
| `$0FFF` ✓ | 0F | Input/pacing checkpoint: gate advancing on controller input (the page-end pause). |
| `$10FF` | 10 | Rotate the four line buffers up one text line (hard scroll). |
| `$11FF`-`$14FF` ✓(`$12`) | 11-14 | Smooth-scroll the window up by 1/2/3/4 pixels. The `$12FF`x8 runs = 16px = one line of smooth upward scroll. |
| `$30FF`-`$3BFF` | 30-3B | Set font size -- both axes / Y only / X only, to size 0-3. |
| `$3DFF`-`$3FFF` | 3D-3F | Print a numeric counter digit by digit (minigame scores). |
| `$50FF`-`$52FF` | 50-52 | Interactive **Yes/No prompt** -- reads the D-pad, draws/moves the answer cursor, sets the answer flag; `$52` also toggles the A/B config. The engine behind "Try this stage again?" and "Re-start from the middle ring?". |
| `$60FF` ✓ | 60 | Draw an inline bitmap/graphic; consumes the **following `db` bytes** as parameters (X/Y position, X/Y size, plot pos) -- e.g. the egg-throw demo image in the "Making eggs" tutorial. |
| `$FFFF` ✓ | FF | End of message. |

**Unused / null codes.** `$15`-`$2F`, `$40`-`$4F`, `$53`-`$5F`, and the
entire `$61`-`$FE` block are **not** meaningful commands:

- `$15`-`$1F` fall into the scroll routine with an uninitialised pixel count.
- `$20`-`$2F` fall through into the font-size handlers.
- `$40`-`$4F` and `$53`-`$5F` jump to the renderer's exit (would stall the message).
- `$61`-`$FE` are bare labels that fall straight into the `$FF` terminator -- i.e. they all behave as "end of message".

In practice only ~10 codes (`$05`-`$08`, `$0A`, `$0E`, `$0F`, `$12`, `$60`,
`$FF`) are ever emitted by the actual data; the engine simply *defines* a
much larger opcode space, most of it dead.

---

## 4. The 65816 <-> SuperFX bridge

Here is how a 65816 call lands on a SuperFX routine. The wiring is in three
files:

```
yi/SuperFX/SuperFX_Macros_YI.asm      (the macro definitions)
yi/SuperFX/RoutinePointers.asm        (one %YI_SuperFXRoutinePointer call
                                       per entry point; emits the pointer
                                       table at the head of the bin)
yi/SuperFX/SuperFXPtrs_YI.asm         (mirrored list of
                                       %YI_SetNextPreCompiledCodePointer
                                       calls, one per entry; each reads
                                       a 3-byte pointer back from the bin
                                       and binds it to an FXCODE_xxxxxx
                                       label visible to the 65816)
```

### 4.1 The two namespaces

The bridge maintains two parallel naming conventions:

- **SuperFX side** (inside `yi/SuperFX/Banks/Bank0X.asm`): `CODE_088000`,
  `CODE_088002`, `DATA_088xxx`, etc. These are real GSU program addresses
  thanks to `%SuperFXBankStart(!FXBank08)` issuing `base $088000`.
- **65816 side** (after `SuperFXPtrs_YI.asm` is `incsrc`'d): `FXCODE_088000`,
  `FXCODE_088002`, `FXDATA_4D0000`, etc. The `FX` prefix is added by the
  `%YI_SetNextPreCompiledCodePointer` macro and the value resolves to
  whatever PC offset the SuperFX code landed at inside the final ROM image.

A 65816 caller does:

```asm
    LDX.b #FXCODE_08A980>>16        ; bank byte of the SuperFX entry
    LDA.w #FXCODE_08A980            ; offset within bank
    ; ... write to SuperFX FXR0/FXR15 etc. to set up registers
    ; ... write GO bit
```

and the GSU starts executing at `CODE_08A980` (the LZ2 decompressor — cart calls it "lz1").

### 4.2 Why the split is necessary

asar can't share labels across CPU architectures (the 65816 pass and the
SuperFX pass are separate `--ftype=` invocations). The
`%YI_SetNextPreCompiledCodePointer` macro reads the pre-assembled `.bin`
file's pointer table to recover each SuperFX-side label's final address,
then binds it to an `FXCODE_xxxxxx` label visible to the 65816 pass.

Adding a new SuperFX entry point requires:
1. Add the routine code in `yi/SuperFX/Banks/Bank0X.asm` (`CODE_xxxxxx:`).
2. Add `%YI_SuperFXRoutinePointer(CODE_xxxxxx)` to `yi/SuperFX/RoutinePointers.asm`
   (must appear BEFORE the `%SuperFXBankStart` line, since the pointer table
   is emitted at the head of each bank).
3. Add `%YI_SetNextPreCompiledCodePointer(FXCODE_xxxxxx, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")`
   to `yi/SuperFX/SuperFXPtrs_YI.asm` (matching position in the list).

Removing one requires removing the entry from all three; mis-aligning the
pointer/binding lists corrupts every later entry by one.

### 4.3 Why label aliases don't break the bridge

This doc and the inline annotations add `lz2_decompress:` aliases at the
same address as `CODE_08A980:`. asar handles this fine: both labels resolve
to the same SuperFX address. The bridge's `%YI_SuperFXRoutinePointer`
references `CODE_xxxxxx` by name -- the alias is invisible to it -- so the
bridge keeps working.

The CRITICAL constraint: don't RENAME `CODE_xxxxxx` (only add aliases),
because both `RoutinePointers.asm` and `SuperFXPtrs_YI.asm` reference the
templated name. Renaming would require coordinated changes across both
bridge files.

---

## 5. Porting the GSU LZ16 decompressor

The GSU implements two decompressors (see §3.2). Porting them out of GSU
asm to a host language (TypeScript, Python, C, etc.) is needed if you want
to preview compressed graphics without running the cart on real hardware
or an emulator.

- **LZ2 (`CODE_08A980`)** ports cleanly. The dispatch byte + 4-way path
  structure maps to a straightforward state machine. Validated implementations
  exist in multiple host languages, all matching `lc200/decomp.exe FORMAT=0`
  output byte-for-byte.
- **LZ16 (`CODE_0A8000`)** is the harder one. Existing ports derived from
  GoldenEgg's C# bit-reader (`GE/Decompress.cs`) are broken: output diverges
  from `lc200/decomp.exe FORMAT=15` starting at byte 1. GoldenEgg's decoder
  has its own pre-existing bug for this format, so any port that uses it as
  the reference will inherit the bug.

**Recommended port path for LZ16:**
1. Read `CODE_0A8000` and its called-back helpers (`CODE_0A805B`,
   `CODE_0A8063`, ..., `CODE_0A81B3`) in full. The whole inner state
   machine fits in ~440 lines of SuperFX asm.
2. Port the state machine literally, preserving the CMODE pre-shifted-byte
   assumption and the LINK-based call/return structure.
3. Validate against `lc200/decomp.exe` for every `.lz16` file produced by
   the framework's asset extraction step.

The SuperFX routine is the only authoritative source for this format.
GoldenEgg has it wrong; the `yoshisisland-disassembly` repo doesn't name
it; there is no published bit-level format spec.

---

## 6. Recommended porting paths (per route)

For anyone wanting to extract SuperFX behaviour to a different language:

### 6.1 Trig tables -- TRIVIAL

The four COS/SIN/LCOS/LSIN tables are pure data. Read the byte arrays at
`$08:AB98` / `$08:AC18` / `$08:AE18` / `$08:AE58` directly from the cart
(or from `Graphics/SuperFX/DATA_*.bin` if you have the framework's
extracted output). They're already in standard 8-bit and 16-bit two's-
complement encoding.

### 6.2 LZ2 decompressor (cart calls it "lz1") -- SIMPLE

Port `CODE_08A980` as a straight state machine. The dispatch byte's top 3
bits (after AND R7=$E0) select one of 4 paths. Each path reads a length
operand (5 or 10 bits) and either copies literal bytes or back-references.
Validate output against `lc200/decomp.exe FORMAT=0` byte-for-byte.

### 6.3 LZ16 decompressor -- MEDIUM

Port `CODE_0A8000` as a bit-by-bit state machine. The CMODE prefix at
entry means every branch decision is one bit of a prefetched control byte
(not a flag check). LINK / LSR / ROL / BCS chains build the bit reader.
~440 lines of SuperFX => ~250 lines of TS / Python.

### 6.4 Player physics -- HARD

The player-physics routines read player state from SuperFX RAM via `LM`/`SM`
absolute-address ops. Those addresses are mirrored to 65816 RAM (specifically
to the `!RAM_YI_*` zero-page block) via the SuperFX "shared RAM" mode.
Porting requires:
1. Map every player-state RAM address (jump flag, angle, X/Y speed, water
   level, etc.) to its 65816 RAM equivalent (a table in
   `yi/Memory/SRAM_Player.asm` would need building).
2. Port the LCOS-indexed velocity math (the inner loop is small: ~20 SuperFX
   ops, mostly MULT / SEX / HIB / SWAP for fixed-point).
3. Port the BG-collision probe, which indexes a per-surface offset table to
   decide where to sample the level grid.
4. Port the surface-state machine that transitions Yoshi through
   walk/run/swim/jump/slip/ride states.

Probably 1-2 weeks of work for a faithful port. Worth it only if you need
an emulator-free physics preview or a save-state-driven test runner.

### 6.5 BG collision -- HARD (depends on physics)

The BG-collision routine reads from the Map16 tile grid at `$7F:8000`
(the live foreground tilemap; see `docs/leveldataengine.md` §3.5 and
`docs/enginecore.md` §11.4). The probe positions come from per-surface
offset tables (4-6 byte offsets in (x, y) pairs). Algorithm is "sample
these 4 cells, decode their Map16 IDs through the per-tileset-tagged
behaviour bit, return composite result".

### 6.6 Rotation / zoom rasterisers -- EXTREMELY HARD

These are tightly hand-coded for the GSU's specific instruction
characteristics (LMULT in 1 cycle, SCMR-based addressing, etc.). Porting
to a non-GSU target essentially means writing a software rasteriser from
scratch using the trig tables as your interpolation source. Not
recommended unless you need cycle-accurate boss rendering.

---

## 7. Common GSU asm idioms

A grab-bag of GSU encoding tricks that recur across the YI SuperFX banks
and are easy to misread the first time you encounter them. The
meta-rule (§7.7) is the most important one: the asar mnemonic is what
the bytes spell when read left-to-right as one instruction, but the
GSU's prefetch + prefix state can route those same bytes to different
"virtual" interpretations at runtime. When the two disagree, trust the
bytes + Mesen's interpretation, not the disassembly.

### 7.1 BRA target+$N : dual-issue (jump-into-mid-instruction)

The GSU has a one-byte program-read prefetch buffer (Mesen
`Gsu.cpp:300-305` `ReadOpCode`). Each `ReadOpCode` returns the *prior*
buffered byte and refills the buffer from the new R15. A dual-issue
pair `BRA target : <opcode>` is encoded as four bytes
`<BRA-opcode> <offset> <opcode-byte> <operand-byte>`; the GSU
executes `BRA`, then dispatches the *third* byte (the dual-issue
partner) from the prefetch buffer as the next opcode while reading
its operand from the byte at the new R15.

So when asar writes `BRA target+$N : <opcode>`, the encoder is
crafting the situation: the dual-issue partner's *opcode byte* runs
verbatim, but its *operand byte* is whatever lives at the BRA
destination's actual address. By targeting `label+$N` instead of
`label`, the encoder picks which byte at the destination becomes
that operand.

Concrete example, `lz16_decompress` LZ-back exit (`Bank0A.asm:235`):

```
$0A:80E7   BRA CODE_0A8095+$01 : IBT R12, #$14
```

Bytes at `$0A:80E7-$0A:80EA`: `05 AD AC 14`. `05` = BRA, offset `AD` =
-83, partner opcode `AC` = IBT R12. asar's mnemonic shows
`IBT R12, #$14` because $14 is the next byte in the *source order*
— but at runtime the BRA jumps to `$0A:8096`, the prefetch refills
from `$0A:8096` (= `$00`), and the IBT R12 executes with operand
`$00`, not `$14`. The `$14` byte at `$0A:80EA` is dead code (it
would only ever be reached if a branch landed at `$0A:80E9`, which
nothing does). See `docs/lz16-model.md` §4.4 "About the asar
`: IBT R12, #$14`" for the full trace verification.

There are 27 BRA-into-mid-instruction sites across `Bank08-0B`
(check with `grep -n "BRA .*+\$" yi/SuperFX/Banks/Bank0*.asm`).
The encoder uses this to:

- Skip an opcode byte at the target but reuse its operand position
  to supply an immediate.
- Coerce STW→STB by injecting an ALT1 prefix via the partner slot
  (see §7.5 for the related `db $XX` escape hatch).
- Inject a "virtual" instruction that doesn't appear in the source
  order at the destination.

### 7.2 `WITH Rs ; TO Rd` = `MOVE Rd, Rs`

asar disassembles these as two separate prefix instructions, but at
runtime they are one logical "register copy". Mesen's `TO()` handler
(`Gsu.Instructions.cpp:112-122`):

```
void Gsu::TO(uint8_t reg) {
    if(_state.SFR.Prefix) {
        //MOVE
        WriteRegister(reg, ReadSrcReg());
        ...
    } else {
        //TO
        _state.DestReg = reg;
    }
}
```

`WITH` (`Gsu.Instructions.cpp:139-144`) sets both SrcReg and DestReg
to its operand AND sets the Prefix flag. So when `TO Rd` runs with
Prefix already set, it acts as `Rd := SrcReg` (= `Rs`, just set by
WITH).

Example, `lz16_decompress` prologue (`Bank0A.asm:104`):

```
OR R6          ; (R0 |= R6) — leaves the OR result in R0, doesn't touch R6
TO R6          ; here SFR.Prefix is clear → DestReg := 6 (a plain prefix)
AND R4         ; (R0 := R0 & R4) but DestReg=6, so the AND's result lands in R6
```

vs. the `WITH ... TO` flavor (`Bank0A.asm:255-260`):

```
WITH R5        ; SrcReg = DestReg = 5, Prefix = true
AND #15        ; (R5 := R5 & 15), Prefix cleared
```

Same idea but using `WITH` as the prefix so it acts on the same
register both as source and destination of the AND. The third
variant — explicit `MOVE` — is the case `Gsu::TO` writes about: if
the previous instruction was `WITH Rs`, then `TO Rd` writes
`Rd := Rs` and resets flags, exactly like a register-to-register
move. asar can disassemble this as a single `MOVE Rd, Rs` mnemonic
when it recognises the WITH+TO pair, or as two separate prefixes
otherwise.

The takeaway: read `MOVE`, `TO`, `FROM`, `WITH` as *prefix-state
modifiers on the next opcode*, not as instructions in their own
right. Whether a given prefix line acts as a one-shot move vs.
configures the next arithmetic depends entirely on what opcode
follows.

### 7.3 `LINK #N ; IWT R15, #helper : GETB` refill idiom

Used 476 times across `Bank08-0B` (mostly Bank0A/0B). The pattern is
a structured tail-call into a stream-refill helper:

```
LINK #4                              ; R11 := R15 + 4  (the return address)
IWT R15, #CODE_0A81B3 : GETB         ; jump to lz16_refill (or any helper);
                                     ; GETB runs in the dual-issue slot,
                                     ; reading the byte at the CURRENT R14
                                     ; into R0 before the jump takes effect
```

Per Mesen's `LINK(value)` (`Gsu.Instructions.cpp:354-358`),
`R11 := R15 + value`. Because R15 is the address of the
*next-to-decode* opcode (already advanced past LINK), `LINK #4`
captures "skip 4 bytes from there" — which lines up with the next
instruction being `IWT R15, #<addr> : GETB` (4 bytes: opcode + 16-bit
immediate + partner byte) and the byte after that being the natural
return point.

The helper does its work and exits with `MOVE R15, R11` — a register-
to-PC move that lands at LINK's stored return address. See
`lz16_refill` at `$0A:81B3` (`docs/lz16-model.md` §6).

The `GETB` in the dual-issue slot reads from the *current* R14
before the IWT changes anything, so the helper sees a freshly
fetched byte in R0 on entry. This is how bit-stream consumers like
the LZ16 decoder achieve "read next byte and call refill" in a
single dual-issue pair without writing the byte to a temporary.

The pattern is general: any GSU routine that consumes a byte stream
(graphics decoder, the level-name overlay renderer's font streamer
at `FXCODE_09E92F`, the per-tile data walkers) uses some variant of
LINK + IWT R15 + GETB for fetch-and-call.

### 7.4 `MOVE R13, R15` + `LOOP` — setting the loop back-edge

R13 is the LOOP target register. `LOOP` (`Gsu.Instructions.cpp:167-179`)
decrements R12, and on non-zero result writes R13 into R15 — i.e.,
jumps to R13.

Setting R13 = "the start of the loop body" is done by `MOVE R13, R15`
*at* the loop body's start, because R15 at that point is already
pointing at the *next* instruction (the prefetch is one byte ahead).
asar emits this on 302 lines across `Bank08-0B`.

Pattern, from the LZ16 PLOT-row pipeline (`Bank0A.asm:240-246`,
`docs/lz16-model.md` §4.5):

```
CODE_0A80EC:
    IWT R12, #$0080            ; loop count = 128
    MOVE R13, R15              ; R13 := PC of next instruction (loop body top)
    LDB (R1)                   ; \
    COLOR                      ;  > loop body (3 ops)
    LOOP : PLOT                ; / decrements R12, branches back to R13 if non-zero
```

Important: `MOVE R13, R15` itself is a `WITH R15 ; TO R13` pair (§7.2),
and the dual-issue `LOOP : PLOT` runs PLOT in parallel with the
LOOP's decrement-and-branch. So this whole 4-instruction sequence is
"128 iterations of [LDB; COLOR; PLOT]" expressed in 4 source lines.

GSU loops without an explicit `MOVE R13, R15` use a previously-set
R13 (e.g. from a CACHE-prep block). When debugging a loop that
"doesn't loop", check what last wrote R13.

### 7.5 `db $XX` — manual dual-issue partner (escape hatch)

When the encoder wants a specific byte in the dual-issue partner
position and no asar mnemonic fits cleanly, the partner can be
written as a raw byte directive. The byte still gets dispatched as
an opcode at the post-branch PC.

Example, `lz16_decompress` `$0A:8121` (`Bank0A.asm:279`):

```
IWT R15, #CODE_0A8095+$01 : db $AC
```

The IWT jumps to `$0A:8096`. The dual-issue partner `$AC` is the
opcode byte for `IBT R12, #imm`. So at runtime the next opcode after
IWT is `IBT R12` with its operand byte read from `$0A:8096`. asar
can't spell "IBT R12 reading its operand from a *post-jump* address"
as a clean mnemonic — `db $AC` is the encoder's way of saying "I
want the byte 0xAC sitting in the partner slot; the next-opcode
dispatch will route it correctly."

Compare against the `BRA target+$N : IBT R12, #$14` example in §7.1
— same trick, but in §7.1 asar found a mnemonic that *happens* to
have $AC as its opcode byte, so it spells out `IBT R12, #$14` (and
the $14 is dead). The `db $AC` form is what you use when the
following bytes aren't a clean IBT-style "opcode + immediate" pair.

Other instances: `Bank0A.asm:4160`, `Bank0B.asm:5160` — both
`BRA target+$01 : db $F5`. The $F5 there is the OR-immediate opcode
under ALT2, so the prefix state at the jump target matters for
decoding what the partner actually does.

### 7.6 CMODE prologue setup

`CMODE` (`Gsu.Instructions.cpp:592-606`) reads its source register
(default R0) low byte and configures the plot pipeline flags:

| bit | flag                                                         |
|---:|---|
| 0   | `PlotTransparent` (color-0 pixels are not plotted)            |
| 1   | `PlotDither`                                                  |
| 2   | `ColorHighNibble` (`COLOR` writes high nibble of ColorReg)    |
| 3   | `ColorFreezeHigh`                                             |
| 4   | `ObjMode` (use sprite tile addressing in `GetTileIndex`)      |

A CMODE prologue is the standard setup for any routine that drives
`PLOT` / `RPIX`. The pattern is `IBT R0, #<flags> ; CMODE`.

Examples:

```
$0A:8004   IBT R0, #$11    ; PlotTransparent + ObjMode
$0A:8006   CMODE
```

`lz16_decompress` uses `$11` = PlotTransparent + ObjMode for tile-
graphics decompression with transparent color 0. See
`docs/lz16-model.md` §2.

```
$08:825A   FROM R1         ; CMODE source = R1 instead of R0
$08:825B   CMODE
```

A C_*_ROTZOM rasteriser in Bank08 dynamically picks its plot flags
from R1, which the caller set up before invoking the rasteriser.
The `FROM R1` prefix reroutes CMODE's source.

CMODE flags persist across the whole routine; you'll see one CMODE
per routine, near the head, in any code that uses PLOT.

Note: `CMODE` is the ALT1-prefixed opcode pair-sibling of `COLOR`.
`COLOR` (no ALT1) sets `ColorReg` from its source register's low
byte; `CMODE` (with ALT1) sets the plot flags. Both share opcode
`$4E`. So when asar disassembles a `$4E` byte, whether it shows
`COLOR` or `CMODE` depends on whether an ALT1 prefix is in scope
at that PC.

### 7.7 Asar mnemonic vs runtime semantics — the meta-rule

The big one: **asar disassembles the bytes as if they were read
sequentially in source order as one instruction. The GSU at runtime
reads the same bytes through its prefetch + ALT/TO/FROM/WITH prefix
state, which can route them to different "virtual" instructions.**

**This is not an asar quirk.** The bytes are correct in every sense:
the cart contains them, asar emits them byte-for-byte from our
source, and the GSU executes them correctly. The divergence between
"what the mnemonic spells" and "what the GSU does" is intentional —
it's how the original developers achieved encoding density on a
chip with expensive ROM. Multiple GSU assemblers (asar and the
chip's contemporaneous assemblers) all use the same `+N` branch-into-
mid-instruction syntax for this idiom, and they all emit the same
correct bytes. The "trick" is at the GSU's hardware level (the
prefetch + dual-issue pipeline interaction with ALT prefixes), not
at the source or compile layer.

Therefore: when a routine includes patterns like §7.1 / §7.5 / the
LZ-prev variants, do not try to "clean them up" in your head. They
are deliberate. Trust the bytes and Mesen's runtime model; treat
asar's mnemonic as a linear-disassembly hint.

Concrete failure modes when reading asar output as gospel:

- A `BRA target+$N : IBT R12, #$14` (§7.1) shows the `#$14` as the
  IBT's immediate — but at runtime the IBT runs *after* the BRA, so
  its operand byte is read from wherever R15 points after the
  branch. The $14 you see in the asar output is dead code in
  source-order land.
- `TO R6` (§7.2) doesn't write to R6 by itself. It sets a prefix.
  Whether R6 actually gets written depends on the *next* opcode.
- `LDW (R1)` (`docs/lz16-model.md` §4.4) can read 1 byte at runtime
  if an ALT1 prefix is active when it dispatches — even though the
  asar mnemonic says "16-bit word". Mesen's `LOAD()`
  (`Gsu.Instructions.cpp:156-165`) reads a second byte ONLY when
  ALT1 is clear.
- `STW (R1)` is the symmetric case: Mesen's `STORE()`
  (`Gsu.Instructions.cpp:146-154`) writes a second byte ONLY when
  ALT1 is clear. With ALT1 set, STW becomes STB.

How to read GSU asm robustly:

1. Treat asar's mnemonic as a *hint* about what bytes are there.
2. For any branch / dual-issue / prefix-heavy sequence, work out
   what bytes the GSU's prefetch actually dispatches. The prefetch
   model is one byte ahead of R15; a branch invalidates the
   prefetch and refills from the new R15.
3. Track prefix state (`Prefix`, `Alt1`, `Alt2`) across the trace.
   Every non-prefix opcode resets all three to false (via
   `ResetFlags()` at the end of most Mesen instruction handlers).
4. For load/store width and ADD/SUB carry-vs-no-carry semantics,
   look up the Mesen handler — its `if (Alt1) ...` branches encode
   the runtime variant selection.
5. When the trace and the mnemonic disagree, the bytes + Mesen are
   right.

This is the rule that unblocks every LZ16-style "asar says one
thing, the cart does another" mystery — see `docs/lz16-model.md`
§4.4 for three resolved cases (asar's `: MOVE R4, R0` at
`$0A:80D0`, asar's `: IBT R12, #$14` at `$0A:80E7`, asar's
`LDW (R1)` at `$0A:8088`). All three were "asar mnemonic
misleading, bytes + Mesen authoritative".

---

## 8. Open questions

1. **Exact addresses for the player-physics family.** PARTIALLY
   RESOLVED -- the BG-collision chain is fully pinned:
   `bg_unit_read` (`CODE_0AD08C` @ `$0A:D08C`) / `bg_unit_read_short`
   (`CODE_0AD095`) / `bg_unit_decode_attrs` (`CODE_0AD0F2`) +
   `bg_unit_fetch_wram_cell` (`CODE_0AD0C8`) + `bg_unit_offscreen_default`
   (`CODE_0AD12F`) + `bg_unit_read_neg_y_offset` (`CODE_0AD134`).
   The per-page attribute table is `DATA_0ABB12` (= `bg_type_table`,
   504 B / 168 × 3 B); the slope-panel data is `DATA_0ABD0E`
   (= `slope_panels_table`). See §3.3.1 + §3.3.2 for the decode
   algorithm and encoding.

   STILL OPEN: the player-physics main + jump/no-jump split + coord
   update + D-pad input + X-speed decay (all in `$0A:8xxx-$0A:Cxxx`),
   and BG_SIDECK / BG_HDFTCK / FOOT_RESULT / WATR_CHECK address
   pins. Estimate: ~3-4 hours to pin down by control-flow shape
   matching against `chip/ys_mplay.asm`.

2. **General multiply routine location in Bank09.** A general 16x16
   multiply lives somewhere in the late Bank09 area; not pinned.

3. **Tangent / arctangent routine locations in Bank0A.** These should be
   near the head of the trig-routine block. Translating to framework
   address requires reading the first ~500 lines of Bank0A code that
   comes after `lz16_decompress`.

4. **Bank4C/4D table cataloguing.** The two HiROM-mirrored data banks
   contain dozens of pointer-table heads referenced from SuperFX code as
   external symbols. A full inventory would name each `DATA_4Cxxxx` /
   `DATA_4Dxxxx` with its consumer.

5. **R_32_* vs C_32_* exact distinctions.** Both are 32x32 transformed
   bitmap renderers. The "R_" prefix appears to mean "uses result/state
   from a prior C_ call" vs "C_" meaning "primary renderer", but the
   distinction isn't formally documented. Reading the body of one
   C_32_ROTZOM and one R_32_ROTZOM side-by-side would confirm.

6. **HiROM mirroring nuances.** Bank4C/4D are in the HiROM block; the
   GSU sees them at native bank addressing while the 65816 sees them
   via HiROM mapping. This means the GSU can `IBT R0, #$4D / ROMB`
   and reach the per-enemy pointer table directly. Documentation of which
   65816 banks mirror to which GSU-visible regions would help anyone
   tracing cross-architecture data flow.

---

## 9. Cross-references

- `docs/leveldataengine.md` -- parallel reference for the Bank10/12/13
  level-data engine (same documentation pattern, different subsystem).
- Framework asm references (read these for code):
  - `yi/SuperFX/Banks/Bank08.asm` -- math tables + message-window
    rasteriser + LZ2 decoder + Mode-7 boss init.
  - `yi/SuperFX/Banks/Bank09.asm` -- enemy-data shifted-read + per-effect
    rasterisers.
  - `yi/SuperFX/Banks/Bank0A.asm` -- LZ16 decoder + player physics +
    BG/sprite collision.
  - `yi/SuperFX/Banks/Bank0B.asm` -- wide cosine/sine tables + R_
    rasterisers + pipe transitions.
  - `yi/SuperFX/Banks/Bank4C.asm` / `Bank4D.asm` -- per-enemy bitmap data.
  - `yi/SuperFX/Banks/Bank51.asm` -- European-locale font glyphs.
  - `yi/SuperFX/Banks/Bank52.asm`-`Bank57.asm` -- pure bitmap chunks.
  - `yi/SuperFX/SuperFX_Macros_YI.asm` -- the macros that build the v1.2
    bin-format pointer table.
  - `yi/SuperFX/RoutinePointers.asm` -- the entry-point list (306 entries).
  - `yi/SuperFX/SuperFXPtrs_YI.asm` -- the FXCODE_xxxxxx binding list.
- `yoshisisland-disassembly` (Raidenthequick + brunovalads) -- mostly
  anonymous on SuperFX side:
  - `yoshisisland-disassembly/disassembly/bank08.asm`-`bank0B.asm`
    -- the SuperFX banks are present but routines stay anonymous.
  - `yoshisisland-disassembly/docs/gsu_routines.txt` -- ~200 SuperFX
    routine ADDRESSES (no names). This doc supplies the function-family
    grouping.
- `yoshisisland-disassembly` wiki -- partial coverage of the SuperFX role;
  treats it primarily as a graphics coprocessor (this doc documents the
  physics role too).
- `lc200/decomp.exe` (Lunar Compress) -- ground-truth reference for both
  LZ2 and LZ16 decoded output.
- See also (parallel SuperFX program files):
  - `chip/ys_chip0.asm` -- head-of-bank: message-window polygon
    rasteriser + trig-table base + LZ2 decoder.
  - `chip/ys_chip1.asm` -- enemy-data shifted-read + sprite OAM
    packing + per-enemy bitmap dispatch.
  - `chip/ys_chip2.asm` -- LZ16 bit-reader decoder.
  - `chip/ys_chip3.asm` -- effect spawns (water bubble, splash, dust,
    dash-smoke), BG-tile fetch by map coord, spark effects.
  - `chip/ys_chip4.asm` -- sprite-on-sprite collision (side / head /
    foot).
  - `chip/ys_chip5.asm` -- C_* family rotation/zoom rasterisers,
    boss OAM packing.
  - `chip/ys_chip6.asm` -- R_* family rotation/zoom rasterisers,
    Mode-7 boss matrix solves.
  - `chip/ys_chip7.asm` -- specialised rasteriser variants
    (large bitmaps, clip flags).
  - `chip/ys_mplay.asm` -- player physics main: jump-active path,
    no-jump path, coordinate-update step, X-speed decay.
  - `chip/ys_mplay0.asm` -- mount-mode physics dispatchers
    (helicopter / submarine / mole / ski / car / train / tongue).
  - `chip/ys_mplay3.asm` -- secondary player-physics + Baby Mario
    off-Yoshi state.
  - `chip/ys_mpldt.asm` -- player physics data tables: speed limits,
    accel/decel, animation patterns, per-state frame timings.
  - `chip/ys_mpldt0.asm` -- per-surface flag tables + per-mount
    animation data + collision-probe offsets.
  - `chip/ys_chip.inc` -- shared GSU register/constant definitions.
  - `chip/ys_chip2.inc` -- bitmap-object include definitions.
  - `chip/ys_chip.mac` -- per-enemy bitmap-asset macro definitions.
