# YI level-data engine reference

A standalone reference for the Yoshi's Island level-data engine: how a 4-byte
level pointer becomes a stamped Map16 tile grid in WRAM. Covers the routines
in Bank10 (master stream parser), Bank12 (dispatch tables + intra-object
walker + per-object init handlers), and Bank13 (per-cell tile-stamp handlers).

This doc fills in the longstanding "Bank `$12` / `$13` mystery" -- the
combined ~21K lines of those two banks have 1,424 anonymous labels and
zero descriptive names in both the framework and `yoshisisland-disassembly`.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank10.asm`, `yi/Banks/Bank12.asm`, `yi/Banks/Bank13.asm`.
Verified via `yoshisisland-disassembly/disassembly/bank12.asm`.

---

## 1. Pipeline at a glance

Loading a level walks through six stages:

```
1. Game-mode 0E  (Bank01 $01:B084)
   Reads level ID from save state.
   Indexes the LEVEL POINTER TABLE.
   Stores 3-byte object pointer to !RAM_YI_Level_LevelDataPtr* ($32-$34).
   Stores 3-byte sprite pointer to !EXRAM_YI_Level_SpriteDataPtr*.

2. UnpackLevelHeader  (Bank10 $10:8B15)
   Reads 10 bytes of bit-packed header from [LevelDataPtr],y.
   Unpacks into !RAM_YI_Level_LevelHeader* (16 fields).
   Sets up tileset / palette / music / mode for the level.

3. LoadLevelData  (Bank10 $10:8B5D)
   The MASTER OBJECT-STREAM PARSER.
   Loops reading 1 byte at a time from the stream:
     - $00 -> EXTENDED OBJECT  (4-byte record): dispatch via $12:8000
     - $FF -> END OF OBJECTS  (then parse screen-exit list)
     - else -> STANDARD OBJECT (4 or 5 byte record): dispatch via $12:81FE,
               sizing based on $12:84EC property table
   Each dispatched per-object init handler writes Map16 IDs into
   !RAM_YI_Level_LevelDataBuffer ($7F:8000) and returns to the loop.

4. Per-object INIT handler  (Bank12 $12:88xx onward, ~190 routines)
   Sets up walker parameters ($2A, $2E, $15) then tail-calls walker setup
   trampoline CODE_12A3DB with a per-cell handler pointer in (X, A).

5. Walker setup trampoline + intra-object walker  (Bank12 $12:A3DB / $12:85EC)
   Trampoline stashes the per-cell handler in $1F/$22/$25 + bank in $21/$24/$27.
   Walker iterates the object's row x col rectangle, calling Map16-fetch
   primitives at $12:86FD/719/75D/7A1/7E2 to compute the cell offset, then
   calling the per-cell handler.

6. Per-cell STAMP handler  (Bank13 $13:8000 onward, ~600 routines)
   Decides which Map16 ID to write for this cell (often shape-aware: probes
   neighbouring cells via the Map16-fetch primitives) and STAs it into
   !RAM_YI_Level_LevelDataBuffer[X] with X = $1D.
```

After all objects are processed, the screen-exit list and sprite list are
parsed by other code (Bank10's tail logic + a sprite-spawn routine in Bank01).

---

## 2. Data format

The on-disk level-data format (per-level `.bin` blobs in `LevelData/`):

- **Header**: 10 bytes, 80 bits, bit-packed MSB-first across 15 fields
  (background color, BG1/BG2/BG3 tileset+palette, sprite tileset+palette,
  level mode, animation tileset+palette, BG scroll rate, music, item
  memory; plus 5 bits of unused padding). Field bit widths are stored in
  ROM at PC `$080B05` (= `DATA_108B05`, `HeaderBitLengthTable` in Bank10):
  `db $05,$04,$05,$05,$06,$06,$06,$07,$04,$05,$06,$05,$05,$04,$02,$00`
  (15 widths + `$00` sentinel that stops the parser). WRAM destinations
  for the 15 fields are `$7E:0134-$7E:0152`, defined as
  `!RAM_YI_Level_LevelHeader*Lo` in `yi/Memory/RAM_Map_YI.asm`.
- **Object stream**: 4-byte or 5-byte records, terminator `$FF`.
  Position is MAP16 grid units (16x16-pixel cells). X spans 0-255 across
  the level's width (page + sub-screen position, nibble-interleaved);
  Y spans 0-127 vertically. Three variants:
  - **Extended object** (first byte = `$00`, 4 bytes total): marker,
    `XXXXYYYY` (high nibbles), `xxxxyyyy` (low nibbles), `IIIIIIII`
    (extended-object ID 0-255).
  - **Standard object, length-only** (first byte 1-254, table bit 1 = 0):
    `IIIIIIII` (id), `XXXXYYYY`, `xxxxyyyy`, `LLLLLLLL` (length-1, signed).
  - **Standard object, WxH** (first byte 1-254, table bit 1 = 1):
    `IIIIIIII`, `XXXXYYYY`, `xxxxyyyy`, `WWWWWWWW` (width-1, signed),
    `HHHHHHHH` (height-1, signed).
  Variant is selected by `DATA_1284EC[id] & $03` (see §3.3). Negative
  size bytes fold the bounding box left/up rather than right/down.
- **Screen-exit list**: 5-byte records, terminator `$FF`. On-disk records
  are (source-page, dest-level / minibattle ID, dest-X, dest-Y,
  entrance-type). At runtime, the parsed exits are stored in WRAM at
  `$7F:7E00` as 4-byte entries indexed by screen ID (the source page is
  implicit from table position); 512 / 4 = 128 entries fitting the 16x8
  maximum screen grid.
  - **Entrance-type (5th byte) = the player's spawn state on arrival**, *not*
    a jump-table index. The screen-exit re-entry loader copies it straight into
    `!EXRAM_YI_Player_CurrentStateLo` (`CODE_set_player_entrance_from_exit` /
    `CODE_01B05A`, via the live exit table at `$7F:7E03`; see `docs/levelloader.md` §3).
    Across every shipped level the field only ever holds `$00-$0A`; higher values
    appear solely in level `$7D`, whose stream is mis-aligned upstream and decodes
    to junk. The ten meaningful states: `$00` does nothing (already positioned) ·
    `$01` skis in · `$02-$05` emerges from pipe -> right / left / down / up ·
    `$06-$08` walks in -> right / left / down · `$09` jumps in (high) · `$0A`
    flung in (to the moon). Glosses verified against the per-exit value histogram
    over all levels. **Disambiguation:** these entry sub-states are a *different*
    space from the even-valued `!Define_YI_PlayerState__` constants (`$00` Normal,
    `$02` InCutscene, `$0A` EnteringDoor, ...), which describe the broader player
    state machine, not the exit-arrival animation -- don't conflate the two.
- **Sprite stream** (separate pointer, 3 bytes per sprite, `$FFFF`
  terminator): `iiiiiiii YYYYYYYI XXXXXXXX` -- 9-bit sprite ID, 7-bit Y
  tile coord, 8-bit X tile coord.

The **level pointer table** has 222 entries of 6 bytes each
(`dl object_ptr, sprite_ptr`), indexed by the runtime level ID byte at
`!RAM_YI_Level_CurrentLevelFromMapLo` (`$7E:021A`). The table lives at
**`$17:F7C3`** on V1.0 builds and **`$0F:E822`** on V1.1 (the cart bytes
moved between revisions). The framework macro
`%DATATABLE_YI_LevelDataPtrsAndEntranceData` is gated on `!ROM_YI_U2` and
emits the table at exactly one of those addresses. See `docs/levelloader.md`
§3 for the full sub-table layout (entrance indexes, entrance data, midway
indexes, midway entrance data, then `Ptrs:`).

**Special-case levels**: record `$38` is the gm38 **intro-cutscene level**
(played by world-map slot `$0A` — NOT Kamek's Revenge, whose record is
`$2C` via map slot `$38`; the `!Define_YI_LevelID_*` values are map slots,
a different id space than records). Its data is real but minimal (a 66-byte
backdrop stream; the cutscene engine drives the actors). The `$DA`/`$DB`
pointer-table rows are sentinels (not real levels); they hold garbage bytes.
Enumerate levels via the entrance tables, not by walking the pointer table.

The **MAP16 tile system** uses a two-level page + index scheme: each ref
is `pppppppptttttttt` (high byte = page 0x00-0xA7+, low byte = tile
index within page). Pages resolve via `MAP16_INDEX_TABLE` (SNES
`$18:B2A4`, framework `DATA_4CB2A4`) into 4 sub-tile-info words at
`MAP16_TABLE + page_offset + t*8`. The runtime foreground tile grid lives
at `!RAM_YI_Level_LevelDataBuffer = $7F:8000` -- 32 KB total, 2 bytes
per Map16 cell (Bank13 stamps with `STA.l ` under REP #$30, writing the
full 16-bit `page:tile` ref). Up to 64 of the 128 possible screens can
be resolved into the buffer at once; `resolve_screen_page`
(`CODE_128824`, §3.5) allocates a 512-byte screen page on demand.

### 2.1 Foreground vs background -- what Bank13 stamps

> For the **rendering** side (how each layer gets to pixels: PPU
> register pipeline, per-scanline IRQ rewrites, color math, HDMA, and
> SuperFX participation in BG3 effects), see
> [`docs/renderingpipeline.md`](renderingpipeline.md). This section
> covers only **which layer gets which data**.

**Bank13 writes into BG1 only -- the interactive Map16 foreground.** This
is the layer Yoshi physically walks on, climbs, swims through, gets
damaged by, etc. Every Bank13 handler ends with
`STA.l !RAM_YI_Level_LevelDataBuffer,x`; no other destination is ever
used. The full layer model:

| Layer | Role | Loaded by | Bank13's role |
|---|---|---|---|
| **BG1** (foreground / interactive) | Floors, walls, slopes, water, lava, vines, pipes, doors, spikes, clouds, lifts -- everything Yoshi physically interacts with | Stamped cell-by-cell: Bank10 parses object stream -> Bank12 walker -> **Bank13 stamp handlers** | All of it |
| **BG2** (parallax decoration) | Mid-distance scenery -- distant cliffs, fog banks, secondary terrain, room-fill | Pre-rendered tilemap incbins loaded directly at level-load (`docs/levelloader.md` §1) | None |
| **BG3** (deep parallax / overlay) | Far backdrop -- sky, mountains, water surface, gradient stripes; sometimes HDMA-warped | Pre-rendered tilemap incbins; often paired with HDMA scroll/gradient effects | None |
| **OAM** (sprites) | Yoshi, enemies, projectiles, eggs, score popups | Sprite engine (Bank03 normal + Bank00 ambient) | None |

The "BG" in Bank13's named cluster (`CODE_bg_floor_left` etc.) means
"**BG1** Map16 layer." It is *not* a reference to BG2/BG3 parallax
backgrounds, despite the prefix sounding like one. The convention is a
holdover from "BG = background tile layer (as opposed to OAM sprites)"
rather than "BG = decorative background."

**Decoration stamps are still BG1.** Some Bank13 handlers use
`JSL CODE_prng` for randomness (grass tufts, mushroom patches, dirt
clumps). These look like decoration but are stamped into BG1; Yoshi
walks on them. The randomness is purely visual variety; the underlying
Map16 cell is still part of the foreground geometry.

### 2.2 Stamp vs collision -- responsibilities

Bank13 only writes Map16 **tile IDs**. The collision properties of each
tile -- "solid floor", "slope 22deg up", "climbable vine", "damaging
spike", "swimmable water" -- are encoded **per Map16 page** (not per
tile) in a 504-byte SuperFX-side table:

| Item | Address | Size | Role |
|---|---|---|---|
| `DATA_0ABB12 / bg_type_table` | `$0A:BB12-$0A:BD09` | 504 B (168 × 3 B) | One 24-bit entry per Map16 page. Indexed by the **HIGH byte** of the 16-bit tile ID. Encodes shape (NO/MD/AL/SK), surface flags (WT/MG/TN), door bits (DR/BD), 5-bit secondary tag, slope sub-index. |
| `DATA_0ABD0E / slope_panels_table` | `$0A:BD0E+` | 32 × 8 B + extension | Per-slope-shape Y-offset profiles, indexed by byte 2 of the bg_type_table entry. Read by `BG_HDFTCK`. |

The visual page-data tables at `$4C:33F2-$4C:D619` (§3.4.5) contain
**no collision metadata** -- all sub-tile words there are consumed by
the renderer (vflip/hflip/priority/palette/tile-index = 16 bits each,
no spare bits). The "stored attribute byte" lives one architecture
away: when Yoshi's collision routine runs, the GSU pulls the 16-bit
tile ID from `LevelDataBuffer`, shifts the high byte to use as an
index into `bg_type_table`, and reads the 24-bit attribute entry.
See `docs/mchip.md` §3.3.1 + §3.3.2 for the decoder and full encoding.

Two consequences for level-data tooling:

1. **Bank13 doesn't need to "know" collision.** A handler that stamps
   tile `$0A4F` doesn't know whether page `$0A` is solid floor or
   climbable vine -- that's determined by `bg_type_table[$0A]`. All
   256 tiles in one page share the same collision (they're visual
   variants of the same shape).
2. **Re-skinning vs re-shaping are different operations.** Changing
   the *visual* of a floor tile means editing the Map16 page entry's
   sub-tile-info words (`$4C:33F2+`). Changing the *shape* means
   either editing `bg_type_table[page]` on the SuperFX side (changes
   collision for all 256 tiles in that page) or moving the level
   object to a different page entirely via Bank13.

---

## 3. The runtime structure

### 3.1 Master object-stream parser (Bank10)

The level-data stream is parsed by ONE routine: `CODE_108B5D` in
`yi/Banks/Bank10.asm` (= `LoadLevelData`). It is the sole reader of
`[!RAM_YI_Level_LevelDataPtr*],y`. The main loop is `CODE_108BAF`.

| SNES addr | Bank10 label    | Purpose |
|---|---|---|
| `$10:8B15` | `CODE_108B15`   | UnpackLevelHeader -- reads `DATA_108B05` (16-entry bit-width table) and bit-extracts the 10-byte header into 16 RAM fields. |
| `$10:8B5D` | `CODE_108B5D`   | LoadLevelData entry. JSL'd via the level-load chain in Bank01. |
| `$10:8BAF` | `CODE_108BAF`   | Main object-stream loop. Reads stream byte -> `$15`, X-high -> `$1C`, Y-low -> `$1B`. Dispatches based on `$15`: `$00` -> extended, `$FF` -> exits, else -> standard. |
| `$10:8C13` | `CODE_108C13`   | Extended-object dispatch. Reads ext-ID byte -> `$15`, looks up `DATA_128000[ext_id*2]`, indirect-RTL into Bank12 handler. |
| `$10:8C33` | `CODE_108C33`   | Standard-object dispatch. Reads property byte from `DATA_1284EC[id]`, reads 1 or 2 size bytes per property bits 0-1, looks up `DATA_1281FE[id*2]`, indirect-RTL into Bank12 handler. |
| `$10:8C04` | `CODE_108C04`   | Screen-exit parser (entered when `$15 == $FF` from stream). Reads 5-byte records into `$7F:7E00,x` until 16-bit `$FFFF` terminator. |

### 3.2 Bank12 dispatch tables

Three lookup tables at the start of Bank12 drive the per-object dispatch:

| SNES addr | Asm label             | Size | Indexed by | Used by |
|---|---|---|---|---|
| `$12:8000` | `DATA_128000` (`extended_object_init_ptrs`) | 256 entries of 2 bytes = 512 B (~231 active CODE pointers + ~26 `$0000` vestigial slots, mostly in the $C0..$ED hole) | Extended-object byte (`$15` after Bank10 reads ext-ID) | Bank10 `CODE_108C13` |
| `$12:81FE` | `DATA_1281FE` (`standard_object_init_ptrs`) | 247 entries of 2 bytes covering IDs $00..$F6 (494 B). IDs $F7..$FF fall in the UNK_1283EC $FF padding region; valid streams never reference them. | Standard-object ID (`$15` from stream) | Bank10 `CODE_108C33` |
| `$12:84EC` | `DATA_1284EC` (`standard_object_property_table`) | 256 bytes | Standard-object ID | Bank10 `CODE_108C33` (and possibly Bank13 handlers, unverified) |

The two init-pointer tables use the standard 65816 indirect-RTL dispatch
pattern: each entry is `dw CODE_xxxxxx-$01`, so when Bank10 does
`PHA / RTL` the pulled value + 1 lands on the handler entry. Bank10 also
manually sets DB := `$12` so the handler runs with the correct data bank.

### 3.3 Object-property table bit layout

The 256-byte property table `DATA_1284EC` (= cart PC `$0904EC`) encodes
per-object stream-record width. Bank10 `CODE_108C33` reads:

```
LDX $15                ; X = standard-object ID
LDA DATA_1284EC,x      ; A = property byte
AND #$0003             ; bottom 2 bits = width-mode
```

| Bits 0-1 | Width mode | Bytes after the XY pair | Effect |
|---|---|---|---|
| `%00`   | length-only      | 1 byte: length-1 (signed) -> `$2A` (column extent) | 4-byte object record total |
| `%01`   | height-only      | 1 byte: height-1 (signed) -> `$2E` (row extent)   | 4-byte object record total |
| `%10`   | length + height  | 2 bytes: length-1, height-1 -> `$2A`, `$2E`       | 5-byte object record total |
| `%11`   | sentinel         | only seen at entry `[0]` = `$FF` (object ID 0 is invalid) | -- |

Negative values (sign bit set on the length / height byte) fold the
bounding box to the left / up rather than right / down.

**Note on a common documentation error:** the `yoshisisland-disassembly`
wiki claims "top 2 bits of `table[ID]` discriminate the size". This is
INCORRECT -- the actual Bank10 code uses `AND #$0003` (bottom 2 bits).
Bits 2-5 are always zero in this table. Bits 6-7 (values `$40`, `$80`,
`$C0` appear in 33 of 256 entries) are **unused at runtime** -- the
only consumer of this table anywhere in the cart is Bank10's
`CODE_108C33` which masks with `AND.w #$0003`, and Bank13 has zero
absolute reads (Bank13 handlers receive their parameters from Bank10
already-decoded into DP slots `$2A`/`$2E` and never re-fetch). See §7.1
for the full investigation. The 33 non-zero high-bit entries are
pre-shipping engine residue; they could be cleared in the cart with no
behavioural change. The cart bytes at PC `$0904EC` match the
framework's `db` directives byte-for-byte (256 bytes total).

### 3.4 Bank12 intra-object walker

The walker `CODE_1285EC` (= `intra_object_walker` alias) iterates a row x
col rectangle of Map16 cells inside ONE object and calls the per-cell
handler for each. It is NOT the master stream parser (that is Bank10
`CODE_108B5D`). Walker is invoked indirectly via the trampoline:

`CODE_12A3DB` (= `walker_setup_trampoline`): per-object init handlers
tail-call here after setting up `$2A` (col extent), `$2E` (row extent),
`$15` (orientation), `$1B`/`$1C` (start position). The trampoline stashes
the per-cell handler pointer into the walker's 3 dispatch slots:

| Slot       | Purpose                       | Set by trampoline |
|---|---|---|
| `$1F/$20`  | per-col handler (ODD-X cells) | `STA $1F`         |
| `$21`      | bank byte (ODD-X)             | `STX $21`         |
| `$22/$23`  | per-col handler (EVEN-X cells)| `STA $22`         |
| `$24`      | bank byte (EVEN-X)            | `STX $24`         |
| `$25/$26`  | per-row handler (row boundary)| `STA $25`         |
| `$27`      | bank byte (per-row)           | `STX $27`         |

All 3 slots get the SAME pointer from the trampoline (single per-cell
handler called for every cell). Init handlers that want different
behaviour at row boundaries or alternating columns call CODE_12A3DD
(skips the `STZ $17` slope-reset) or write the 3 slot pairs directly
before JMP'ing to CODE_1285EC.

The walker uses extensive zero-page state:

| ZP addr | Purpose |
|---|---|
| `$00, $02` | scratch 16-bit temps |
| `$0A`      | scratch (sign-extend length bytes) |
| `$0E, $0F` | working Map16 position for direction-fetch primitives (handler copies `$1B`/`$1C` here before probing) |
| `$12`      | current cell's Map16 ID (latched by CODE_1286FD) |
| `$14`      | per-column slope accumulator |
| `$15`      | object ID or extended-object byte (set by Bank10) |
| `$17`      | per-row slope advance (added to `$14` on each row step) |
| `$19`      | row-walk end (compare target; trampoline sets to `$7FFF` = unbounded) |
| `$1B`      | current cell low byte (`xxxxyyyy` nibble-interleaved sub-screen coords) |
| `$1C`      | current cell high byte (`XXXXYYYY` screen-page coords) |
| `$1D`      | cell byte offset into `!RAM_YI_Level_LevelDataBuffer` |
| `$28`      | column counter (signed) |
| `$2A`      | column extent (signed; negative grows left) |
| `$2B`      | screen-page hi-nibble carry |
| `$2C`      | row counter (signed) |
| `$2E`      | row extent (signed; negative grows up) |
| `$97`      | total screens allocated this level so far |
| `$99`      | byte cursor into level-data stream (advanced by Bank10) |
| `$9B`      | "rewound" flag (set when walker wraps to a new screen) |
| `$32-$34`  | `!RAM_YI_Level_LevelDataPtr*` (3-byte ROM ptr to current level's object blob) |
| `$0D4D`    | last-allocated screen-page index (page LRU counter) |
| `$0D4E,y`  | LRU chain head pointers |
| `$6CAA,x`  | per-screen page mapping (X = screen # 0..127): low 6 bits = page index; bit 7 = independent Baby-Mario-float-limit flag (see §7 #6) |
| `$6CA9,x`  | per-screen LevelDataBuffer base offset (used by Map16-fetch primitives) |

### 3.4.5 Map16 page-table data — cart location

The fetch primitives (§3.5) ultimately read Map16 sub-tile words out of a
contiguous data region in cart ROM, indexed via an offset table. Both the
offset table and the data live in Bank4C (SuperFX HiROM-mapped):

| Item | Address | Size | Notes |
|---|---|---|---|
| Offset table | `$4C:32A4` (= LoROM `$18:B2A4`) | 334 bytes (167 dw entries) | One offset per Map16 page (`$00`-`$A6`); offsets are relative to the data base below. |
| Page data | `$4C:33F2` (= LoROM `$18:B3F2`) .. `$4C:D619` (= LoROM `$1A:D619`) | ~41 KB | Contiguous run of 8-byte (4-word) chunks. Each chunk is one 16x16 Map16 tile encoded as 4 sub-tile words (YXPP CCCV VVVV VVVV: Y/X flip, palette, VRAM tile index). |

The two valid SNES addresses for the data base reflect YI's HiROM mirror:
the SuperFX-side label `DATA_4C33F2` and the LoROM-side address `$18:B3F2`
refer to the same cart byte (PC `$0C33F2`). External references (SMW
Central's memory map, brunovalads's wiki) typically cite the LoROM form.

**Correction to external sources:** SMW Central describes a single
"MAP16 page tables" region of 74 KB at `$18:B3F2`-`$1A:D619`. That
over-includes the SuperFX BG-stamp graphics descriptor table at
`$4C:D61A+` plus Bank4D's enemy-data pointer tables at `$4D:0000+`.
The real Map16 page-table region is the ~41 KB block above. The framework
labels Bank4D's content correctly as `enemy_object_data_ptrs` (see
`yi/SuperFX/Banks/Bank4D.asm` header).

### 3.5 Map16 fetch primitives

Five routines at the top of Bank12 resolve a Map16 cell coordinate to a
byte offset in `!RAM_YI_Level_LevelDataBuffer`, allocating a fresh
screen page if the requested cell falls in unmapped territory.

| SNES addr | Routine          | Calling convention | Coords source | Purpose |
|---|---|---|---|---|
| `$12:86FD` | `CODE_1286FD` (`get_current_map16_tile`) | JSR.w (RTS) | `$1B`/`$1C` | Used by walker top-of-row. Outputs X, `$12` (tile ID), `$1D` (cached offset). |
| `$12:8719` | `CODE_128719` (`get_map16_above`) | JSL.l (RTL) | `$0E`/`$0F` + `$2C` | Step Y up by 1 within column. Outputs X = buffer offset for cell above. |
| `$12:875D` | `CODE_12875D` (`get_map16_below`) | JSL.l (RTL) | `$0E`/`$0F` + `$2C` | Step Y down by 1 within column. |
| `$12:87A1` | `CODE_1287A1` (`get_map16_left`)  | JSL.l (RTL) | `$0E`/`$0F`         | Step X left by 1 within row. |
| `$12:87E2` | `CODE_1287E2` (`get_map16_right`) | JSL.l (RTL) | `$0E`/`$0F`         | Step X right by 1 within row. |

Common usage from a per-cell handler (Bank13):

```asm
LDA $1B                 ; copy current cell coords to probe pos
STA $0E
JSL.l CODE_1287A1       ; probe cell to the left -> X = its buffer offset
LDA !RAM_YI_Level_LevelDataBuffer,x  ; read its Map16 ID
CMP <reserved_template_addr>          ; matches a known shape?
BEQ ...                 ; yes -> emit a continuation tile
```

The coordinate encoding uses nibble-interleaved positions:

- Low byte (`$1B` or `$0E`): high nibble = sub-screen Y (0..15), low nibble = sub-screen X (0..15). Each screen is 16x16 Map16 cells.
- High byte (`$1C` or `$0F`): high nibble = screen-page Y (0..7), low nibble = screen-page X (0..15). Up to 8x16 = 128 screens.

So a full Map16 cell address is 16 bits = 8 nibbles, interleaved as
`xxxx yyyy XXXX YYYY` where lowercase = sub-screen, uppercase = screen-page.

All five primitives call `CODE_128824` (`resolve_screen_page`) internally
to handle page allocation. If the screen index is `>=$80` (invalid),
the resolver panics: resets the stack to `$01F1` and JMLs back to
`CODE_108B5D` to restart the level-data load from the beginning.
This is the engine's "ran off the screen grid" safety net.

### 3.6 PRNG

`CODE_128875` (= `get_random_byte`) at `$12:8875` returns A = a
pseudo-random 8-bit value by reading the HV-counter software latch
(register `!REGISTER_SoftwareLatchForHVCounter`), shifting right, adding
the live H-counter and V-counter. Cosmetic-only randomness, not seeded.

Callers:
- Bank01 (2 sites): general game logic.
- Bank13 (~50 sites): randomising grass / floor / decoration variants
  inside per-cell handlers.

This is the ONLY routine in Bank12 with verified external callers
outside Bank12/Bank13.

### 3.7 Per-object init handlers (Bank12 body)

Approximately 190 routines at `$12:8891`..`$12:C708`. Common shape
(>70% of handlers):

```asm
CODE_xxxxxx:
    REP #$20
    LDA.w #cols  ; STA $2A          ; column extent for walker
    LDA.w #rows  ; STA $2E          ; row extent for walker
    LDA #orientation                  ; STA $15  (optional, e.g. for variants)
    LDX.b #(BODY-$01)>>16             ; bank byte of per-cell handler
    LDA.w #BODY-$01                   ; ptr-1 of per-cell handler
    JMP CODE_12A3DB                   ; walker setup trampoline
```

A second pattern -- "single-cell stamp without walker":

```asm
CODE_xxxxxx:
    JSR.w CODE_1286FD                 ; fetch cell offset + tile -> $1D, $12
    REP #$30
    JSL.l BODY                        ; per-handler "modify this tile" logic
    SEP #$30
    RTL
```

Categorising the 190+ handlers is detailed in section 4 below. The
per-cell handler bodies they hand off to all live in Bank13.

### 3.8 Per-cell stamp handlers (Bank13 body)

The bulk of Bank13 (~600 routines, `$13:8000`..`~$13:FD00`). These
implement the actual "decide what Map16 ID to write" logic per cell.
Observable categories from inspecting the bank:

| Category | Examples |
|---|---|
| basic floor (flat ground)                  | left/right variants, shape-aware fallback selector, random-variant picker |
| floor edges (left/right caps)              | random-variant left/right caps |
| 22.5-degree slope floors                   | left and right rising variants |
| up/down floor steps                        | two-tile vertical step variants |
| walls                                      | left wall, right wall, vertical block |
| jump-platforms                             | trampoline / bouncy block stamps |
| moving platforms (lift)                    | 30-degree, 45-degree, and static-target lifts |
| tunnels                                    | vertical, horizontal, box-shaped |
| clouds                                     | cloud-block stamps |
| water variants                             | open water, water-meets-ground, water-meets-land, water-on-rock |
| water bridges                              | horizontal and vertical |
| underwater mushroom / flower decor         | combined data table |
| lava                                       | shared lava-stamp routine |
| world 1-1 jungle terrain                   | floor, left wall, right wall, diagonal step variants |
| grass-stalk decorations                    | hanging stalks, overhanging tufts |
| flowers / rocks                            | big and small rock variants |
| pipes                                      | T-junction pipe stamp |
| snow surfaces                              | cloud-snow, bouncy snow drift |
| lava spike                                 | single specialty stamp |
| rail-mounted walls                         | vertical-horizontal hybrid, slope variant |

**Verified Bank13 routine layout** (from the first handler):

| Framework label | Purpose |
|---|---|
| `CODE_138000`     | BG left set floor (left variant) |
| `CODE_138018`     | Left-floor alt path (matched type-3900 template) |
| `CODE_13801D`     | BG right set floor (right variant) |
| `CODE_138035`     | Right-floor alt path |
| `CODE_138038`     | Common epilogue (deref + STA) |
| `CODE_138055`     | "Tile above" shape check |
| `CODE_138073`     | Shape-aware fallback selector |
| `DATA_138045`     | Left-variant 4-entry tile table |
| `DATA_13804D`     | Right-variant 4-entry tile table |

Same structural pattern (opcode-by-opcode confirmed) continues throughout
the bank -- the framework's 600 anonymous CODE_13xxxx labels collectively
implement the full BG-stamp routine set.

### 3.9 Per-tileset Map16-ID template slots

Bank13 handlers extensively compare `$12` (current Map16 ID) against
fixed 16-bit addresses in low-WRAM `$00:19DA`..`$00:1DFC`. These are
NOT hardcoded Map16 IDs -- each slot holds a **per-tileset** Map16 ID
that varies with the level's BG1 tileset byte. They are populated at
level-load time by `init_per_tileset_template_slots` (`CODE_109257`
in Bank10), JSLed once from `CODE_load_level_object_stream` near the
top of every level load.

The slots are grouped into "families" -- each family is a contiguous
block of N slots holding `ANCHOR, ANCHOR+1, ANCHOR+2, ..., ANCHOR+N-1`,
where `ANCHOR` is the per-BG1-tileset base Map16 ID. So the slot at
`anchor + 2*k` always holds the k'th sequential Map16 ID of its family.

#### Source data: `DATA_per_tileset_template_table` (`DATA_4CD61A`)

This Bank4C table drives the loader. **It was previously misdocumented**
as a "SuperFX BG-stamp graphics descriptor table consumed by GSU code";
it is in fact consumed by the 65816 (Bank10 `init_per_tileset_template_slots`),
not the GSU. The format is a `$00`-terminated sequence of 35-byte records:

```
db  count                                       ; 1B   how many slots this family fills
dw  ram_slot_addr                               ; 2B   first WRAM slot of the family ($19DA..$1DFC)
dw  anchor[0], anchor[1], ..., anchor[$F]       ; 32B  16 Map16 anchor IDs, indexed by BG1TYP
```

The loader reads `anchor[BG1TYP]` and writes `anchor, anchor+1, anchor+2, ...`
into `count` consecutive 16-bit WRAM slots starting at `ram_slot_addr`.
74 records total; aggregate WRAM coverage `$00:19DA`..`$00:1DFC`.

#### Families touched by Bank13

| WRAM range | Family code | Slots | Bank13 usage (and corresponding handler family) |
|---|---|---|---|
| `$19DA-$19E1` | $0200 | 4 | small structural |
| `$1A02-$1A13` | $0800 | 9 | small structural |
| `$1A16-$1A27` | $0A00 | 9 | small structural |
| `$1A2A-$1A33` | $0C00 | 5 | small structural |
| `$1A50-$1A5B` | $1000 | 6 | small structural |
| `$1A5E`       | $1200 | 1 | small structural |
| `$1A62-$1BDF` | $1B00 | 191 | large autotile / decoration family, consumer: `CODE_stamp_bg_autotile_decor_lookup` and the 5 decor-lookup tables |
| `$1BE0-$1C43` | $1D00 | 50 | wide/big-floor template page, consumer: `CODE_wide_floor_*_fix`, `CODE_big_floor_*_fix` + the 8 big-floor remap tables, AND `CODE_tunnel_dispatch` + the 14 tunnel-cell tables |
| `$1C5C-$1C79` | $2A00 | 15 | floor-row-0 (top of multi-row floor objects), referenced from FLOOR0DT/FLOOR1DT |
| `$1C7A-$1C91` | $3800 | 12 | horizontal bouncing-post family, consumer: `CODE_post_horizontal_3section` (matches TBOUST/YBOUST in `ys_bgsc1.asm`) |
| `$1C92-$1D11` | $3900 | 64 | flat-floor family, the busiest — see sub-slot detail below |
| `$1D8A-$1DB1` | $6800 | 20 | jungle/auto-connect family |

The flat-floor family is the most-referenced. Its sub-slots map to
specific shape roles (verified by reading Bank13 handlers + the
BG_FLOOR0/1, BG_FLOORSB, FLOR_SUB, FLOOR_RND constants in
`ys_bgsc1.asm`):

| WRAM addr | Slot | Define name (in `yi/Memory/WRAM_LevelTemplateSlots.asm`) | Role |
|---|---|---|---|
| `$1C92` | $00 | `Tpl_FlatFloor_PageAnchor` | "is current tile in the flat-floor page?" check |
| `$1CA0` | $07 | `Tpl_FlatFloor_SlopeCapLeftLo` | tile-above slope-cap marker L; also FLORSB row-1 L |
| `$1CA2` | $08 | `Tpl_FlatFloor_SlopeCapRightLo` | tile-above slope-cap marker R; also FLORSB row-1 R |
| `$1CA8` | $0B | `Tpl_FlatFloor_RndProbeAnchorR` | floor-random right-probe anchor |
| `$1CAA` | $0C | `Tpl_FlatFloor_RndProbeAnchorL` | floor-random left-probe anchor |
| `$1CAC` | $0D | `Tpl_FlatFloor_RndAdjMatch` | floor-random adjacent-cell match value |
| `$1CB6` | $12 | `Tpl_FlatFloor_Row1LeftLo` | FLOOR0DT[1] body row 1 L |
| `$1CB8` | $13 | `Tpl_FlatFloor_Row1RightLo` | FLOOR1DT[1] body row 1 R |
| `$1CBA` | $14 | `Tpl_FlatFloor_Row2LeftLo` | FLOOR0DT[2] body row 2 L |
| `$1CBC` | $15 | `Tpl_FlatFloor_Row2RightLo` | FLOOR1DT[2] body row 2 R |
| `$1CC2` | $18 | `Tpl_FlatFloor_Row3LeftLo` | FLOOR0DT[3] body row 3 L |
| `$1CC4` | $19 | `Tpl_FlatFloor_Row3RightLo` | FLOOR1DT[3] body row 3 R |
| `$1CCA` | $1C | `Tpl_FlatFloor_RndSelfMarkA` | "I am already a random-grass tile" self-check A |
| `$1CCC` | $1D | `Tpl_FlatFloor_RndSelfMarkB` | "I am already a random-grass tile" self-check B |
| `$1CD4` | $21 | `Tpl_FlatFloor_NoSeamCheckA` | `CODE_bg_floor_subbody` $28!=0 tile-self check |
| `$1CD6` | $22 | `Tpl_FlatFloor_NoSeamCheckB` | `CODE_bg_floor_subbody` $28=0  tile-self check |
| `$1CF4` | $31 | `Tpl_FlatFloor_RndBoundA` | `CODE_bg_floor_random` lower bound |
| `$1CF6` | $32 | `Tpl_FlatFloor_RndBoundB` | `CODE_bg_floor_random` upper bound |
| `$1CFE` | $36 | `Tpl_FlatFloor_NoSeamAnchorA` | NoSeamCheckA-matched alt anchor |
| `$1D00` | $37 | `Tpl_FlatFloor_NoSeamAnchorB` | NoSeamCheckB-matched alt anchor |

#### Why most slots inside the larger families aren't individually named

The $1B00 and $1D00 families are consumed by REMAP TABLES
(`DATA_big_floor_remap_*`, `DATA_decor_lookup_*`, `DATA_tunnel_*`)
where each table-entry is a slot address indexed by sub-ID. Each
slot's role inside its family is positional ("the Nth shape variant
of this page"), not behavioral, so individual slot names would be
mechanical (e.g. `WideFloorPage_Slot17`) and add verbosity without
clarity. The table NAMES are the semantic unit; see the contract
comment blocks in `yi/Banks/Bank13.asm` above each remap table for
the dispatch / index conventions.

---

## 4. Per-object handler categorisation

The ~195 init handlers in Bank12 (169 that JMP CODE_12A3DB + 26 that JMP
CODE_12A3DD to keep a non-zero slope) and the ~600 per-cell handlers in
Bank13 together implement the full YI object catalogue. A full per-ID
inventory is now maintained in-repo at `yi/Constants/ObjectIDs.asm`
(247 std-object entries) and `yi/Constants/ExtendedObjectIDs.asm`
(255 ext-object entries) -- those files are authoritative for each ID's
descriptive name + handler binding + behaviour summary.

The broad categories visible from the extended-object dispatch table
(`DATA_128000`):

| Ext-object ID range | DATA_128000 entry pattern | Handler purpose |
|---|---|---|
| `$00-$09` | all -> `CODE_extobj_handler_default_00_09` | Default "common-orientation single tile". Reads `DATA_128887[id]` for extent. |
| `$0A-$0B` | `CODE_extobj_handler_single_tile_variant_2` | Single-tile stamp variant 2 |
| `$0C`     | `CODE_extobj_handler_single_tile_variant_3` | Single-tile stamp variant 3 |
| `$0D-$0E` | `CODE_extobj_handler_8x16_block` | 8x16 block (rare large terrain) |
| `$0F`     | `CODE_extobj_handler_single_cell_dispatch` | Single-tile dispatch |
| `$10`     | `CODE_extobj_handler_16x32_block` | 16x32 block |
| `$11`     | `CODE_extobj_handler_1x1_block` | 1x1 block |
| `$12-$13` | `CODE_extobj_handler_pair_dispatch` | Pair-of-tiles dispatch via `DATA_128920` |
| `$14-$15` | `CODE_extobj_handler_slope_pair` | Slope dispatch (uses `DATA_128943` for +/- direction) |
| `$16-$1F` | various                          | Mixed slopes / decorations |
| `$20-$2F` | all -> `CODE_extobj_handler_null` (`CODE_128A00`) | No-op family (16 IDs share one handler; stamp routine `CODE_12AB55` is a bare RTL, so all stamp nothing -- no per-ID differentiation) |
| `$30-$31` | unique handlers                  | `CODE_extobj_handler_castle_wall_hole_2x2` (2x2 castle-wall breach) and `CODE_extobj_handler_moving_wall_6x7` (2 stand-alone handlers) |
| `$32-$45` | all -> `CODE_extobj_handler_wall_decal_family` (`CODE_128A4E`) | Wall-decal family (20 IDs; `$32-$3A` track decals, `$3B-$45` graffiti decals) |
| `$46-$5F` | various                          | Mixed shapes / decorations / arrow signs |
| `$60-$6F` | various                          | Wall / pipe orientations |
| `$70-$7D` | `CODE_extobj_handler_pipe_shape_family` (13-way pipe family) | Pipe-shape family fans 13 IDs through one handler + DATA_128D10 per-variant table (the table's largest single-handler ID cluster) |
| `$7E-$9F` | various                          | Decorations / vines / fences |
| `$A0-$E0` | various                          | Misc (cloud / lava / water / late decorations) |
| `$E1-$FA` | all `dw $0000`                   | Vestigial / unused slots (26 entries) |
| `$FB-$FE` | various                          | Last 4 active ext handlers: `CODE_extobj_FB_copy_screen_exit` (`$FB`) / `CODE_extobj_FC_vestigial_noop` no-op (`$FC`) / `CODE_extobj_FD_clear_map16_cell` clear-Map16-cell (`$FD`) / `CODE_extobj_FE_set_babymario_float_limit` (`$FE`, sets `$6CAA` bit 7 = Baby-Mario-float-limit flag; see §7 #6). These bypass the walker and operate on per-screen metadata rather than stamping tiles. |
| `$FF`     | n/a -- would index OOB into DATA_1281FE | The table physically ends at row `$FE` (510 bytes total); `$FF` reaching this dispatch would read into the standard-object pointer table. |

**Non-adjacent ID share** worth noting: ext-`$A8` (`ArrowSignSub`) and
ext-`$50` (`ArrowSignWall`) both dispatch to `CODE_extobj_handler_arrow_sign_2x2_overlay`
(`CODE_extobj_handler_arrow_sign_2x2_overlay`), differentiated by `$15 bit 3`
-- the only "non-adjacent-IDs share one handler body" pair in the
extended-object table. The standard-object table has several such
non-adjacent shares (e.g. std-`$57`+`$7E` → `init_seven_segment_decor`;
std-`$68`+`$8A` → `init_alt_state_ground`; std-`$3C`+`$F4` → `init_pipe_vertical`).

The standard-object table `DATA_1281FE` is similarly clustered but with
more variety -- standard objects are the common "small structural
pieces" while extended objects are "specific named decorations". The
std-object table has 247 entries ($00-$F6) with ZERO vestigial slots
-- every ID is wired to a live handler.

### 4.1 Behavioural patterns (a different axis)

The §4 categories above group handlers by **what they stamp** (floor,
wall, slope, decoration, etc.). The complementary axis is **how they
decide what to stamp** -- the *behavioural pattern*. This matters when
re-implementing handlers in an external tool: pattern (1) handlers can
be replayed standalone, but pattern (3) handlers depend on prior LDB
content from other objects already having been stamped.

Five patterns observed across Bank12 init handlers + Bank13 cell stamps:

| Pattern | What it does | Distinctive asm signature | Examples |
|---|---|---|---|
| **(1) Fresh stamper** | Writes a Map16 ID per cell, decided purely from row/column counters and per-tileset template slots. Never reads LDB. | `LDA $2C / ASL / TAY` + `LDA.w DATA_*_tiles,y` + `STA.l !RAM_YI_Level_LevelDataBuffer,x`, no `LDA.l !LevelDataBuffer,x` reads | `CODE_bg_floor_random`, `CODE_lava_stamp`, `CODE_cloud_block_stamp` |
| **(2) Shape-aware stamper** | Fresh stamper that probes one neighbour to pick a *variant* within its own object family. Reads LDB but compares only against `!RAM_YI_Level_TileTpl_*` slots (its own per-tileset family). Always stamps something. | `JSL CODE_get_map16_above/below/left/right` + `LDA.l !LevelDataBuffer,x` + `CMP.w !RAM_YI_Level_TileTpl_*` | `CODE_bg_floor_left`, `CODE_floor_subcheck`, jungle slope continuations |
| **(3) Decorator / context-sensitive** | Reads a neighbour AND compares it against a **literal Map16 ID** (`CMP.w #$XXxx`) to detect a tile family from a *different* object. Result: stamps an overlay / edge-fix only when the surrounding context matches. Needs other objects in the LDB to produce a complete result. | `JSL CODE_get_map16_*` + `LDA.l !LevelDataBuffer,x` + `CMP.w #$LITERAL` | `CODE_stamp_shoreline_slope_left/right` ($79xx water check), `CODE_stamp_fence_probing`, `CODE_wall_corner_*_probe`, ~26 routines in Bank13 |
| **(4) Probe-gated conditional** | Calls a level-state probe (`CODE_01E501`, etc.) before deciding whether to stamp. Conceptually orthogonal to (1)-(3): a fresh stamper can be probe-gated. | `JSL.l CODE_01E501` near the top of the handler; subsequent `BEQ`/`BNE` skips the stamp | `CODE_alt_state_ground` (objects $68/$8A), a handful of switch-state-aware stamps |
| **(5) Orientation-routed dispatcher** | Init handler reads `$15` (orientation byte) and uses it to index a `DATA_*` table of sub-handler pointers. The init itself doesn't stamp; it picks which sub-handler runs. | `LDX.b $15` + `LDA.w DATA_*_subhandlers,x` (or `_stamps`, `_dispatch`, etc.) at top of an init handler | `CODE_init_pole_6variant_aligned`, `CODE_init_floor_edge_or_wall`, `CODE_init_three_segment_row` (left/mid/right selector) |

These patterns are **composable** -- e.g. `CODE_stamp_shoreline_slope_capped`
is a *decorator* (reads neighbour) **routed by orientation** (left vs
right variant via `$15`). And the *init* handler
`CODE_init_alt_state_ground` (pattern 5) dispatches to a *probe-gated*
(pattern 4) stamp.

#### Why this matters for re-implementation

- A consumer tool that re-implements handlers to render abstract level
  views needs to know which pattern each handler follows.
- Pattern (1) and (2) handlers can be replayed in isolation.
- Pattern (3) needs the surrounding LDB to already contain the right
  base tiles (= the upstream object's stamps).
- Pattern (4) needs the same level-state flags the cart engine maintains.
- Pattern (5) needs the orientation byte from the stream record.

For the trace-harness scenario at `trace-harness/scenarios/object-render/`:
*fresh* + *shape-aware* + *probe-gated* handlers all produce complete
output against a one-object test level. *Decorator* handlers still
produce output -- the **base / no-match path** (e.g. `$EB`'s rows 0-2
body-delegate stamp and rows 3+ unconditional $79D6 stamp) -- but
their **conditional / match path** (the actual decoration: substitute
a sand-fill tile when the right-neighbour is water) only fires when
the prerequisite content is present in the LDB. The captured trace
documents the fallback behaviour faithfully; the conditional logic is
visible only in the asm itself (or in a multi-object test that
pre-stamps the prerequisite, not currently supported by the encoder).

#### Identifying decorators from the asm

Useful one-shot grep for "show me every Bank13 routine that does a
neighbour-probe-then-literal-compare" (the decorator signature):

```bash
awk '
  /^CODE_[a-z_][a-zA-Z0-9_]*:/ { cur=$0; sub(/:.*/, "", cur) }
  /LDA\.l !RAM_YI_Level_LevelDataBuffer/ { ldb=1; line=NR; next }
  ldb && /CMP\.w #\$[0-9A-F]/         { print cur; ldb=0; next }
  ldb && /CMP\.w !RAM_YI_Level_TileTpl/{ ldb=0; next }
  ldb && NR - line > 5                { ldb=0 }
' yi/Banks/Bank13.asm | sort -u
```

26 unique decorator-pattern routines as of writing. The heuristic
isn't perfect -- a handler might legitimately hardcode a Map16 ID
that's *known* to be in its own family rather than reading a template
slot -- but the false-positive rate is low. Visual inspection of all
26 hits at the time of writing confirms they all read external context.

---

## 5. Caller pipeline (verified by source reading)

The level-load flow that gets us into Bank12 (compiled from
`Bank01.asm:5380-5470`, `Bank10.asm:1050-1280`, `Bank12.asm:8000+`):

```
Bank01 game-mode 0E entry  $01:B084
   |
   |  LDX  !RAM_YI_Level_CurrentLevelFromMapLo
   |  ASL  ; * 3 (6 bytes per pointer table entry)
   |  ...
   |  LDA  YI_LevelDataPtrsAndEntranceData_Ptrs,x
   |  STA  !RAM_YI_Level_LevelDataPtrLo   ; ($32)
   |  LDA  YI_LevelDataPtrsAndEntranceData_Ptrs+1,x
   |  STA  !RAM_YI_Level_LevelDataPtrHi   ; ($33)
   |  (similar for sprite pointer)
   |
   v
   JSL  CODE_008546   (music upload -- unrelated)
   JSL  CODE_00B339   (palette / VRAM setup -- in Bank00)
   JSL  CODE_00D571   (more setup)
   JSL  CODE_00BA24   (more setup)
   JSL  CODE_00BDA2   (more setup)
   JSL  CODE_01D5B3   (more setup)
   |
   v
   (somewhere in the chain, control reaches Bank10:)
       JSL  CODE_108B5D
        |
        |  Bank10 main: JSL CODE_108B15 (UnpackLevelHeader)
        |               JSL CODE_109257 (init LevelDataBuffer)
        |               ... clear $7F:8000-$7F:FFFF region ...
        |
        v
        CODE_108BAF  (main object-stream loop)
        |
        |  Per iteration:
        |    LDY  $99           ; byte cursor
        |    LDA  [$32],y       ; read stream byte
        |    STA  $15           ; = object ID
        |    INY; LDA [$32],y; STA $1C   ; X-high byte
        |    INY; LDA [$32],y; STA $1B   ; Y-low byte
        |    LDA  $15
        |    BEQ  CODE_108C13   ; extended-object path
        |    CMP  #$FF
        |    BNE  CODE_108C33   ; standard-object path
        |     ; else falls through to screen-exit parser
        |
        |    (extended-object dispatch CODE_108C13):
        |      PHK; PEA CODE_108BAF-1
        |      LDA #$12; PHA; PHA; PLB
        |      INY; LDA [$32],y; STA $15  ; read ext-ID
        |      INY; STY $99
        |      AND #$00FF; ASL; TAX
        |      LDA DATA_128000,x; PHA
        |      RTL                          ; -> Bank12 handler
        |
        |    (standard-object dispatch CODE_108C33):
        |      PHK; PEA CODE_108BAF-1
        |      LDX $15; LDA DATA_1284EC,x   ; property byte
        |      AND #$0003
        |      ...read 1 or 2 size bytes -> $2A, $2E...
        |      LDA $15; ASL; TAX
        |      LDA #$12; PHA; PHA; PLB
        |      LDA DATA_1281FE+1,x; PHA
        |      LDA DATA_1281FE,x; PHA
        |      RTL                          ; -> Bank12 handler
        |
        v
        Bank12 per-object init handler (DB = $12)
        |
        |  Sets up $2A, $2E, $15, then:
        |    LDX.b #(BODY-1)>>16
        |    LDA.w #BODY-1
        |    JMP CODE_12A3DB              ; walker setup trampoline
        |
        v
        CODE_12A3DB  (walker_setup_trampoline)
        |
        |  STZ $17; STX $24/$21/$27;
        |  STA $22/$1F/$25; LDA #$7FFF; STA $19;
        |  JSR CODE_1285EC               ; intra-object walker
        |
        v
        CODE_1285EC  (intra_object_walker)
        |
        |  Per cell of the row x col rectangle:
        |    JSR CODE_1286FD             ; get_current_map16_tile
        |    PHK; PEA CODE_12862F-1
        |    PHX; PHX; PLB; LDA $1F; PHA
        |    RTL                          ; -> per-cell handler in Bank13
        |
        v
        Bank13 per-cell handler  (DB = $13)
        |
        |  STA !RAM_YI_Level_LevelDataBuffer,x   (where X = $1D)
        |  RTL
        |
        v
        Back to walker (CODE_12862F), step to next cell, loop.
        When rectangle done, RTS back to init handler, which RTLs back
        to Bank10's main loop CODE_108BAF.
```

---

## 6. Cross-references

- `docs/levelloader.md` -- the upstream side: gamemode chain that
  populates `!RAM_YI_Level_LevelDataPtr*` and dispatches to Bank10's
  `LoadLevelData`. Covers the level pointer table layout in detail.
- `docs/enginecore.md` -- Bank `$00` engine code: gamemode dispatcher,
  graphics + palette loaders that run before LoadLevelData.
- `docs/bossengine.md` -- how a boss sprite slot allocated from the
  sprite-spawn list runs its per-frame state machine in gamemode `$0F`.
- `docs/spritestateengine.md` -- the per-sprite state engine in Bank03
  that ticks each spawned sprite.
- `yoshisisland-disassembly/disassembly/bank12.asm` -- the only
  descriptive comments on the 5 Map16-fetch primitives + the level
  object table header. Everything else (the dispatch tables, the walker,
  per-object handlers) is anonymous.
- `yoshisisland-disassembly/disassembly/bank13.asm` -- only the
  cinema-yoshi tail tables (at `$13:FD99`/`$13:FDA5`) are annotated.
  The 600 per-cell handlers are all anonymous.
- `yoshisisland-disassembly` wiki -- partial coverage of the level data
  format and object catalogue; has the `DATA_1284EC` upper-bits error
  noted in section 3.3.
- See also:
  - `ys_bgsc.asm` -- BG-scene / level-stream parser reference (parallel
    implementation of the Bank10 master object-stream loop).
  - `ys_bgsc0.asm`, `ys_bgsc1.asm`, `ys_bgsc2.asm` -- per-bank BG-scene
    parser variants (parallel to the per-cell Bank13 stamp handlers and
    the per-object Bank12 init handlers).

---

## 7. Open questions

1. **DATA_1284EC bits 6-7** — **RESOLVED 2026-05-25.** The high bits are vestigial / dead at runtime. The only consumer of this table is Bank10's `CODE_108C33` (`yi/Banks/Bank10.asm:1265`), which immediately masks with `AND.w #$0003`. An exhaustive grep across the cart for any read pattern (`$84EC`, `$1284EC`, `DATA_object_property_table`) returned exactly that one hit. Bank13 has zero absolute reads — the only Bank13 matches are an unrelated local label `CODE_1384EC` that happens to live at PC `$13:84EC`. Bank13 handlers receive parameters from Bank10 already-decoded into DP slots (`$2A`/`$2E`) and never re-fetch the property table. The 33 entries that set `$40`/`$80`/`$C0` are pre-shipping engine residue — they could be cleared in the cart with no behavioural change. §3.3's speculative wording ("Bank13 via `LDA $1284EC,x; AND #$??`") should be tightened to "bits 6-7 unused at runtime".

2. **DATA_1281FE coverage for IDs $B8-$FF**: RESOLVED 2026-05-24. Counting `dw CODE_xxx-$01` lines under DATA_1281FE in `yi/Banks/Bank12.asm` yields exactly 247 entries (covering standard-object IDs $00..$F6). The 9 unused IDs $F7..$FF fall inside the UNK_1283EC padding region (whose final 15 bytes are $FF stripe, the rest $00), so Bank10's `id*2` indexing for $F7..$FF would pull `$FFFF` -- effectively a wild RTL into an invalid handler. Valid streams never reference IDs >= $F7; the engine's "no upper-bound check" matches the rest of YI's "garbage in -> crash" assumption.

3. **CODE_128824's `$0D4E` semantics** — **RESOLVED 2026-05-25, refined 2026-05-26.** Round-robin with wrap-detect plus an optimistic-rewind on free, **not recency-ordered LRU**. The "LRU" naming is a misnomer. `$0D4D` is a 6-bit allocation cursor: bumped (`INC $0D4D` at `Bank12.asm:1425`) on every fresh allocation, never bumped on cache hits, never moved when an in-walk slot is reused. The only `DEC $0D4D` site is `CODE_init_screen_exit_clear` / Object $00 (`Bank12.asm:2765`), which rewinds the cursor by one after freeing the most-recently-allocated slot — a hand-coded "stack-pointer-style" free for the screen-exit-clear command. `$0D4E,y` holds a non-zero page-id marker for occupied slots; zero = free. No timestamps, no usage counters. The walk loop at `CODE_128850` (`INY / TYA / AND #$3F / TAY / CMP $0D4D / BEQ`) is pure linear-probe-for-free with wrap-detect (`Bank12.asm:1444-1453`). **Overflow path is silently broken**: the `BEQ CODE_128874` (`Bank12.asm:1452`) falls into the shared `RTS` at `Bank12.asm:1470` without claiming a slot — X is left holding the original screen index and the caller proceeds with a garbage byte offset. The `CODE_12883A` panic only fires for the orthogonal `X >= $80` invalid-screen precondition. The engine implicitly trusts no shippable level will ever fill all 64 slots.

4. **Cinema-yoshi path data byte 3** — **RESOLVED 2026-05-25, confirmed 2026-05-26.** Byte 3 is a third spatial coordinate ("Z" / vertical-page index), not a timing/speed parameter. The consumer in `yi/Banks/Bank17.asm` (`CODE_178DFE` at line 1739, `CODE_178E42` at 1773, `CODE_178EE0` at 1858) treats all three of byte 1, byte 2, and byte 3 symmetrically as target coordinates and computes a 3-axis straight-line interpolation between waypoints: three signed deltas, dominant-magnitude axis selects denominator, all three get per-frame increments via the SNES hardware divider. Each waypoint's bytes are stored at `$0972`/`$0973`/`$0974` (target X/Y/Z) and integrated into the three 16-bit accumulators at `$6CA4`/`$6CA6`/`$6CA8` (current X/Y/Z) at `Bank17.asm:1858-1898`. World 5 is the only world whose cinema traverses multiple pages — its 17-record list ramps byte 3 monotonically `$00 $00 $00 $10 $20 $30 $33 $34 $37 $3B $43 $45 $4C $53 $55 $5B $5C` across vertical map pages. Worlds 1/2/3/4/6 keep byte 3 = `$00` (single-page cinemas). The "$54/$60" values previously cited as anomalies were a misread of the `dw` little-endian byte order — those are actually byte 2 (Y), not byte 3. See also: `ys_mpmv.asm`, whose `MAPMV*` per-world tables carry the same 4-byte records and label them player-state / X / Y / Z.

5. **Per-handler naming** — **MOSTLY RESOLVED 2026-05-25.** 165 distinct Bank12 init handlers + 533 Bank13 cell-stamp / helper / data-table aliases added in a single 8-agent parallel pass (PLAN.md Phase 3 r3+). Every standard object's init handler now has a `CODE_init_*` descriptive name; per-object families fully cover floors, walls, slopes, pipes, vines, water/lava, decoration, doors, spikes, clouds, lifts, and boss-room geometry. The remaining anonymous CODE_13xxxx labels are intra-family helpers / shared epilogues / inline branch targets that derive meaning from their parent family — left generic by design. The 50-hour estimate was outdated; actual work was ~10 minutes wall-clock at 8-agent parallelism plus a merge pass.

6. **`$6CAA` bit 7 — Baby-Mario bubble float-limiter, not a scroll or page-cache flag** — **RESOLVED 2026-06-01.** The low 6 bits of `$6CAA,x` are the screen->page index; the page allocator (`resolve_screen_page`, `Bank12.asm:1423`) masks `AND #$3F` and never sees bit 7, and allocating a page stores a 1-63 index that also clears it. Bit 7 is an *independent* per-screen flag: the level loader force-sets it on all 128 screens at load (`Bank10.asm:1176-1181`: `LDA #$80 / STA $6CAA,x`), and a page allocation clears it -- so it reads as "this screen has never been page-allocated". It is consumed by exactly two sites, both reading the full byte (no `AND #$3F`): (a) the Baby-Mario sprite ($61) handler `CODE_06C281` (called from `main_baby_mario`), which zeroes the lost-Baby bubble's X/Y speed when the bit is set, capping how far the bubble can drift; and (b) a minor SuperFX render-gate `CODE_0EFE7F` (Bank0E) that skips a polygon merge over not-yet-loaded screens. The camera-scroll, page-cache, item-memory and screen-exit paths all mask bit 7 off. Ext-object `$FE` (`CODE_extobj_FE_set_babymario_float_limit`) `ORA #$80`s the flag without touching the low-6 page index, letting a level designer fence the bubble out of a screen while leaving its rendering and scrolling intact. The widespread "scroll stopper" / "camera unable to scroll into the screen" description (SMW Central `$700CAA` map note; GoldenEgg names `$FE` "Scroll stopper") is the observable *effect* -- the camera follows the halted bubble -- not a direct camera check.
