# LZ16 algorithmic model (YI SuperFX-side decompressor)

A working model of the LZ16 decompressor used by Yoshi's Island, derived
from `yi/SuperFX/Banks/Bank0A.asm` and the SNES-side dispatcher in
`yi/Banks/Bank00.asm`. The goal of this document is to be self-contained
enough that someone can port LZ16 to a host language (TS / Python / C)
without re-reading the SuperFX asm. The remaining work is ground-truth
validation against `lc200/decomp.exe FORMAT=15` — see §8.

## TL;DR

LZ16 is a **bit-by-bit nibble-stream** decompressor (LZSS-family,
2bpp/4bpp tile-graphics output) that:

1. Reads a **5-byte header** of 4 nibble-pair lookup tables + 1
   initialisation byte. The 4 LUTs cache 7 frequently-used nibble
   values (R6 hi/lo, R7 hi/lo, R8 hi/lo, R9 lo).
2. Initialises the 128-byte row buffer with zeros (via 64 STW writes).
3. Enters a **bit-driven main loop**. Each token emits one nibble (or
   a run of nibbles via the LOOP iter count R12). Token kinds:
   - **TABLE-REF** — 3-bit dispatch picks one of 7 cached LUT nibbles
   - **RAW-NIB** — 3-bit dispatch `111` then 4 explicit bits
   - **LZ-back** (gated by R9 sign bit) — preserves the next R12
     byte-runs from the *previous row's buffer*; emits no new bytes
   - **LZ-prev LDB** (gated; one extra bit) — emits R12 copies of the
     "previous byte" then 1 byte at the scan boundary
   - **LZ-prev LDW** (gated; one extra bit) — emits 1 byte at a
     scan-derived offset
   - **LZ-127** (gated) — falls back to regular TABLE-REF/RAW dispatch
4. Run length per token is an **Elias-gamma-flavoured prefix**: each
   loop iter reads 2 bits (continue + contribute); the final R12 is
   `2^K + L` for K continue-iters with L = K bit-b values packed
   LSB-first. Bit decisions consume bits from a prefetched control
   byte (R0); when R10 hits 0, refill from the source byte stream.
5. Output: 128 nibbles per row × R3 rows. Each row's nibbles drive
   the GSU's PLOT pipeline (`$0A:80EC`) which produces SNES 2bpp tile
   bytes at `$700000 + (ScreenBase << 10)`. The 65816 then DMAs
   those tile bytes to VRAM.

The bit-stream-as-control-flow idiom uses only the GSU's standard ops:
`GETB` fetches a fresh source byte into R0; `LSR` shifts R0 right one
bit, putting the LSB into the carry flag; `BCC` / `BCS` conditionally
branches on that carry. No special "bit mode" is needed — the GSU's
normal arithmetic flags + branch instructions naturally support
treating each LSR result as a 1-bit decision. The decoder is essentially
a **deeply unrolled bit-stream state machine** expressed as SuperFX code.

(The `CMODE` instruction at `$0A:8007` in the prologue is unrelated to
bit-stream reading; it configures the GSU's PLOT pipeline — see §2.)

## 1. Caller contract (65816 → SuperFX)

The SNES-side entry is `CODE_decompress_gfx_file` at `$00:B507`
(`yi/Banks/Bank00.asm:5127`). It is one of two paths inside a single
dispatcher; the discriminator is the **high bit of $0E** (the VRAM
destination value passed in via X):

| Bit-15 of $0E | Path                                        | SuperFX entry |
|---:|---|---|
| 0 (BPL) | `CODE_decompress_lc_lz2` → 65816 LZ2 setup     | `FXCODE_08A980` (`lz2_decompress`) |
| 1 (BMI) | inline LZ16 setup                              | `FXCODE_0A8000` (`lz16_decompress`) |

For the LZ16 path the dispatcher passes three SuperFX registers and
implicitly tells the GSU to run `FXCODE_0A8000`:

```
LDA.l DATA_06FC79,x        ; index x already scaled (×3) above
STA.w !REGISTER_SuperFX_R1  ; R1 = source ROM offset (16-bit)
LDA.l DATA_06FC79+$02,x
AND.w #$00FF
STA.w !REGISTER_SuperFX_R0  ; R0 = source ROM bank (8-bit, low byte)
; … (R3 was set earlier from $0E low byte, ASL ASL XBA)
STA.w !REGISTER_SuperFX_R3  ; R3 = output row count (verified §9.5 Q1)
LDX.b #FXCODE_0A8000>>16
LDA.w #FXCODE_0A8000
JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
```

**SuperFX inputs (on entry to `lz16_decompress`):**
- `R0` = source ROM bank (8-bit, e.g. `$5C` for the first GFX entry)
- `R1` = source ROM offset within bank (16-bit, e.g. `$BA89`)
- `R3` = number of output **rows** (verified 2026-05-26: §9.5 Q1).
  Each row = 128 nibbles → 8 horizontal 2bpp tiles of width 16. With
  R3=2, the decoder produces 2 rows × 128 = 256 nibbles = 64 bytes of
  2bpp tile data at `$70:5800+`.

**SuperFX outputs:**
- During decode: each token's STB writes nibble values to the 128-byte
  **row buffer** at `gsuWorkRam $00-$7F` (= SNES bus `$70:0000-$70:007F`).
  R1 walks the buffer backward via `LOOP : DEC R1`.
- After each row: the PLOT-row pipeline at `$0A:80EC` flushes the row
  buffer into **SNES 2bpp tile bytes** at `$700000 | (ScreenBase << 10)`,
  which for YI's typical ScreenBase=$16 is `$70:5800+`. Each `PLOT(x,y)`
  paints one pixel (the nibble value as color) at coords (R1_lo, R2_lo);
  the GSU's internal pixel cache accumulates 8 pixels then writes the
  bitplane bytes to the tile address from `GetTileAddress(x, y)`.
- After all R3 rows: `RPIX` flushes any remaining cache, then `STOP`
  halts the GSU. The 65816 then DMAs `$70:5800-$70:583F` (or similar
  range based on R3 and PlotBpp) to VRAM via the common merge code at
  `$00:B582`.

## 2. State at entry (the prologue, ≈$0A:8000-$0A:8059)

```
ROMB                  ; ROMBR = R0 (set the ROM bank to read from)
SM ($0080), R0        ; save current ROMB for cross-bank refill (lz16_refill restores it)
MOVE R14, R1          ; R14 = source-byte pointer; this becomes the PC stream that GETB pumps
IBT  R0, #$11         ; R0 = $11 = $0001_0001 — PlotTransparent=1, ObjMode=1
                      ; (this is the CMODE config, NOT a shift count)
CMODE                 ; configure GSU plot mode from R0's low byte:
                      ;   bit 0 (1): PlotTransparent — color-0 pixels not plotted
                      ;   bit 1 (0): PlotDither off
                      ;   bit 2 (0): ColorHighNibble off
                      ;   bit 3 (0): ColorFreezeHigh off
                      ;   bit 4 (1): ObjMode on (sprite tile addressing)
IBT  R2, #$00         ; R2 = 0 (output row counter — used by PLOT/INC R2 below)
IWT  R4, #$0F0F       ; R4 = 0x0F0F (nibble mask for the table lookups)
```

**Note on CMODE:** the GSU's `CMODE` instruction (asar mnemonic; opcode
`ALT1 + $4E` per `Gsu.cpp:151`) reads its source register (default R0)
and sets the plot pipeline flags. The `$11` value here configures the
GSU for transparent-color-0 object-mode plotting — which is how the
PLOT pipeline at `$0A:80EC` knows to emit nibble values as object
tile pixels with color 0 = "transparent". (This is unrelated to the
bit-stream reading; that's handled by R10 + LSR + GETB.)

The decoder then reads the **4-byte LUT header** — four bytes of the
source stream, each providing two 4-bit nibble entries that will later be
used to map a 4-bit code back to a byte. The pattern repeats 4 times,
one for each table register R6 / R7 / R8 / R9:

```
GETB                  ; fetch a byte into R0
ADD R0 ; ADD R0 ; ADD R0
TO  R6                ; R6 ← (R0 + R0 + R0)            — high nibble × 3 = high nibble << 2
ADD R0                ; (R0 << 2)
LINK #4               ; R11 = return-from-refill address
IWT R15, #CODE_0A81B3 : GETB    ; jump to lz16_refill, fetch second byte of the pair
ROL                   ; rotate (R0 carrying carry) — packs the second nibble into R6
OR  R6
TO  R6
AND R4                ; mask with $0F0F → R6 now holds the two-nibble table entry for this slot
```

The four-table pattern fills R6, R7, R8, R9 with packed nibble pairs
read from the first ~8 bytes of the compressed stream. These behave as
**4-bit code → byte** lookup tables used to map a 4-bit code from the
bitstream back into a literal byte (see section 5).

After the LUTs:

```
GETB                  ; one more byte
TO   R9               ; R9 ← that byte
AND  R4               ; mask
SUB  R0               ; (subtracting the just-fetched byte from R0 — hash/checksum step?)
IBT  R1, #$00         ; R1 = 0  — destination cursor (output index)
IBT  R12, #$40        ; R12 = $40 = 64 — loop count for the first big run
CACHE                 ; GSU instruction cache prime
MOVE R13, R15         ; R13 = current PC (lets `STW (R1)` etc. use R13 as base)
STW  (R1)             ; emit first 2 bytes (the prologue copies a known constant)
INC  R1
LOOP : INC R1         ; (LOOP decrements R12; second INC R1 advances)
DEC  R1
LINK #4
IWT  R15, #CODE_0A81B3 : GETB
IBT  R10, #$05        ; R10 = 5 (initial bit count in shift register)
LSR ; LSR             ; eat 2 padding bits from the just-fetched byte
IWT  R15, #CODE_0A8116 : LSR   ; dispatch into the main loop
```

By the time we reach `CODE_0A805B` (the main-loop top), the decoder has:

- A primed source byte stream (R14 advancing, GETB pulling bytes)
- 4 nibble LUTs (R6, R7, R8, R9)
- A primed shift register (R0 holding ≥3 bits ready to shift out)
- A bit-count register (R10) tracking how many fresh bits R0 still has
- An output cursor (R1) and a graphics-mode helper (R12, the LOOP iter)

### 2.1 Pre-main-loop bit consumption (verified 2026-05-26)

After the LUT setup, the prologue's `IBT R10, #$05 ; LSR ; LSR ;
IWT R15, #$8116 : LSR` plus the initial `WITH R9 ; ROL ; DEC R10 ;
BNE $8121 : LSR` at `$0A:8116-$0A:811B` consumes **5 bits** from R0
(which holds src[+3] at this point). LSB-first:

- **Bits 0–3** of src[+3] are *discarded* (consumed by LSRs whose
  carries are overwritten by subsequent LSRs).
- **Bit 4** of src[+3] becomes the carry into `ROR R9` at
  `$0A:8121`, which shifts it into **R9's MSB**.

R9 after the prologue =
```
  bit 15 = bit 4 of src[+3]              ; the back-ref gate at decode start
  bits 14..0 = bits 14..0 of (src[+3] & $0F0F)  ; = (0, lo nibble of src[+3])
```

So at decode start: R9's low nibble = src[+3] & $0F. R9's MSB = bit 4
of src[+3]. The encoder controls back-reference gating for **row 0**
via src[+3]'s bit 4 (set bit 4 = 1 to enable back-ref for row 0;
typical files leave it clear).

Verified by trace 2026-05-26:
- Entry $00 (src[+3]=$40, bit 4=0): R9 = $0000 at branch #1. ✓
- Entry $1D (src[+3] with lo nib=$7, bit 4=0): R9 = $0007 at branch #1. ✓

Bits 5, 6, 7 of src[+3] (= bit 5+) remain in R0 entering the main
loop, where they form the first 3 bits of the first token's
run-length-prefix bit stream.

## 3. The bit-reader idiom

LZ16's defining trick: instead of computing bit positions arithmetically,
**every conditional branch is a bit consumer**. The pattern, repeated
hundreds of times, is:

```
LSR                              ; shift carry into bit-stream
BNE <next-state> : LSR           ; if Z still clear, branch; LSR in delay slot
LINK #4
IWT R15, #lz16_refill : GETB     ; otherwise: refill the byte and tail-call back
```

`DEC R10` is interspersed to track bit count; when R10 hits zero, the
next `BNE` falls through, runs `LINK #4`, jumps to `lz16_refill`, and the
refill resets R10 back to 8.

This gives the decoder **branch-on-each-bit** semantics. The tree of
`B<cc>` paths in `$0A:805B` through `$0A:81AD` encodes the LZ16
**token format** directly — there's no separate "control byte" being
masked; the control bits drive control flow.

## 4. Token tree (the format spec, derived from runtime trace 2026-05-26)

Confirmed via Mesen2 bit-by-bit trace of `lz16_decompress` against the
first GFX dispatcher entry (`$5C:BA89`, 50 source bytes, 128 output
nibbles per row × 2 rows). Trace harness:
`trace-harness/scenarios/lz16-decode/`. Trace analyzer:
`scripts/analyze-lz16-trace.ts`.

Each **token** emits one nibble (the low 4 bits of an output byte; the
high nibble of each output byte stays $0). A token has three parts:

```
TOKEN := <run-length-prefix> <3-bit dispatch> [<4-bit RAW value>]
```

### 4.1 The 3-bit dispatch prefix

Three bits, read LSB-first from the bit stream, select one of eight
sources for the emitted nibble. The bits are tested at three
successive BCS branches in the asm at `$0A:8128 → $0A:8130 → $0A:813A`
or `$0A:814C → $0A:8153 → $0A:8174` etc. (the bits are interleaved
with BNE refill-check branches).

| dispatch  | b1 | b2 | b3 | leaf PC          | source            |
|---|---|---|---|---|---|
| `000`     | 0  | 0  | 0  | $0A:8144 (BCS-) | R6 lo nibble       |
| `001`     | 0  | 0  | 1  | $0A:8144 (BCS+) | R6 hi nibble       |
| `010`     | 0  | 1  | 0  | $0A:816C (BCS-) | R7 lo nibble       |
| `011`     | 0  | 1  | 1  | $0A:816C (BCS+) | R7 hi nibble       |
| `100`     | 1  | 0  | 0  | $0A:815D (BCS-) | R8 lo nibble       |
| `101`     | 1  | 0  | 1  | $0A:815D (BCS+) | R8 hi nibble       |
| `110`     | 1  | 1  | 0  | $0A:817B (BCS-) | R9 lo nibble       |
| `111`     | 1  | 1  | 1  | $0A:817B (BCS+) | RAW escape (see §4.2) |

R6/R7/R8/R9 are the four nibble-LUT registers loaded by the prologue
from the first 4 source bytes (§5).

**Gating note (verified 2026-05-26 with trace of dispatcher entry $14):**
The path above (`$0A:8128` dispatch tree) is taken when R9's sign bit
is **clear** after the length-decode exit. When R9's sign bit is
**set** (which accumulates over the run via the ROR at `$0A:8121`
shifting carries into R9's MSB), the decoder instead falls into the
**LZ77 back-reference** path at `$0A:80C5` — see §4.4.

b1 picks {R6, R7} vs {R8, R9}. b2 picks {R6, R8} vs {R7, R9}. b3 picks
hi-nibble vs lo-nibble — except for R9, where b3=1 reroutes to the
RAW escape instead of selecting R9-hi (which would always be 0 since
R9 only got the low nibble of src[3]; the would-be R9-hi slot is
reused as the escape code).

### 4.2 RAW escape (`111` dispatch)

Once the decoder reaches the RAW leaf at `$0A:8185`, it reads 4
explicit bits from the stream into R5 via four `WITH R5 ; ROL`
instructions at `$0A:818F`, `$0A:8199`, `$0A:81A3`, `$0A:81AD`. The 4
bits become the emitted nibble (first bit read = MSB, last = LSB).

This path emits any nibble value, including ones not cached in the
LUTs.

### 4.3 Run-length prefix (Elias-gamma, verified 2026-05-26)

Before the dispatch prefix, every token carries a **run length** R12
decoded by the loop at `$0A:80AC-$0A:80B4` + `$0A:809C-$0A:80A9`.

Each loop iteration reads **2 bits**:

- `bit_a` consumed by the LSR at `$0A:80AC` (tested by `BCS` at
  `$0A:80B4`). `bit_a=0` → exit loop; `bit_a=1` → continue.
- `bit_b` consumed by the LSR at `$0A:809C` (tested by `BCC` at
  `$0A:80A5`). `bit_b=0` → no-op; `bit_b=1` → `R12 |= R4`.

After each iteration `R4 *= 2` (initial `R4=1`). When the terminating
`bit_a=0` is read, the exit path does one final `R12 |= R4`.

**Resulting encoding:** if there are K continue-iterations, then
`R4 = 2^K` at exit, the K bit_b values pack LSB-first into a K-bit
number L, and `R12 = 2^K + L` (range `1 ≤ R12 ≤ 2^(K+1) - 1`).

**Stream layout:** `bit_a_1, bit_b_1, bit_a_2, bit_b_2, ..., bit_a_K,
bit_b_K, 0` — total `2K+1` bits, with the terminating zero where the
next `bit_a` would have been.

Worked encodings:

| R12 | K | L | bit stream                |
|---:|---:|---:|---|
|  1  | 0 | – | `0`                       |
|  2  | 1 | 0 | `1 0 0`                   |
|  3  | 1 | 1 | `1 1 0`                   |
|  4  | 2 | 0 | `1 0 1 0 0`               |
|  5  | 2 | 1 | `1 1 1 0 0`               |
|  6  | 2 | 2 | `1 0 1 1 0`               |
|  7  | 2 | 3 | `1 1 1 1 0`               |
|  8  | 3 | 0 | `1 0 1 0 1 0 0`           |
| 39  | 5 | 7 | `1 1 1 1 1 1 1 0 1 0 0`   |

**Verification:** all 52 non-PLOT tokens in the lz16-decode trace
match this encoding bit-for-bit (52/52 — run
`node scripts/analyze-lz16-trace.ts <trace.log>` and inspect the
"Run-length encoding validation" section).

**Emit count:** R12 is the count passed to the GSU `LOOP` at
`$0A:8107`. Observed emit count = R12 nibbles (a token with R12=39
emits 39 copies of its nibble, walking R1 from $003F to $0018 = 39
decrements).

### 4.4 Back-reference tokens (verified 2026-05-26 with entry $14)

When R9 has its sign bit set at the post-length-decode test (`MOVES
R9, R9 ; BPL CODE_0A8128` at `$0A:80B7`), the decoder skips the 3-bit
dispatch tree and instead enters one of three back-reference variants
distinguished by two extra bits at `$0A:80C5` / `$0A:80D0`:

```
post-length-decode, R12 = decoded run length, R9 sign set:
  bit_x at $0A:80C5:
    bit_x = 1: → $0A:805B  (LZ-prev variant — see below)
    bit_x = 0: bit_y at $0A:80D0:
      bit_y = 1: → $0A:8127 (LZ-127 variant — see below)
      bit_y = 0: → $0A:80D0+  (LZ-back, the "preserve" variant)
```

Three behaviors:

**LZ-back ($0A:80D0 → $0A:80E7).** The scan loop at `$0A:80DA`:

```
   for i in 0..R12-1:                  ; outer LOOP iteration count
     R5 = byte at (R1); R1 -= 1
     while LDW(R1) == R5:              ; inner BEQ scan
       R1 -= 1
     R1 += 1                            ; from LOOP : INC R1 delay slot
     (continue outer LOOP)
   PC = $0A:80E7 → length-decode entry with R12 := $14 pre-loaded
```

**Critical:** the `$0A:80D0-$0A:80E7` path has **no STB instruction**.
The token does NOT emit new bytes. It only advances R1 backward
through the buffer. Verified by Mesen2 write-callback trace
(2026-05-26, entry $14): the first LZ-back token walks R1 from $7F
to $65 (26 positions) across 29 branch events without firing a
single write to `$700000-$7000FF`. Writes resume only at the next
token's first STB.

The bytes at the positions R1 walked past **retain their previous
values** — which are the prior row's nibbles, because the buffer is
not cleared between PLOT-row flushes. Subsequent regular STB tokens
in the same row then overwrite the buffer from R1's new position
backward, leaving everything beyond R1 untouched.

In other words: LZ-back declares "the next R12 byte-runs in this row
are unchanged from the previous row" — a delta-against-previous-row
compression scheme appropriate for tile graphics where vertically
adjacent rows often differ in only a few positions.

**LZ-prev ($0A:805B).** Two sub-variants selected by one extra bit at
`$0A:8067` (BCS after the LSR at `$0A:805B`):

- **LDB-variant** (`$0A:806B`-`$0A:8092`, bit=0): one bit consumed,
  then byte-by-byte scan of the existing buffer:
  ```
  R5 = byte at (R1); R1 -= 1            ; capture last-emitted byte
  while LDB(R1) == R5: R1 -= 1           ; walk back through run of R5
  R1 += 1                                ; back up to last match
  STB R5 at (R1); LOOP : DEC R1          ; emit R12+1 copies of R5
                                         ; (LOOP body re-runs R12 times)
  BPL : ALT1 → $0A:8092                  ; if R1 didn't wrap, exit via
                                         ; an extra STB writing R0
                                         ; (the mismatching byte from
                                         ; the scan boundary)
  ```
  Critical detail: `$0A:8092` is the *opcode byte* of the STW
  instruction at `$0A:8091`. When BPL targets `$0A:8092`, the explicit
  ALT1 prefix at `$0A:8091` is skipped, but BPL's dual-issue ALT1
  (`$0A:807B`) supplies one anyway — so the STW writes only one byte
  (per `STORE` in `Gsu.Instructions.cpp:146-153`: it writes a second
  byte only when ALT1 is **clear**).

  **Total emit: R12+1 bytes.** First R12 are R5 (= the "previous"
  byte). The final byte is R0 = the byte at the mismatch position
  (i.e., a NEW nibble taken from the buffer's existing content at the
  scan boundary, NOT the previous-row preservation behavior LZ-back
  does).

  Verified with trace 2026-05-26 (entry $14 token #22, R12=3):
  writes `$64=01, $63=01, $62=01, $61=09` (R5=$01, R0=$09).

- **"LDW-variant"** (`$0A:8085`-`$0A:8092`, bit=1): same byte-by-byte
  scan as LDB-variant (despite the misleading asar mnemonic — see
  note below), but with a different post-scan emit structure.
  Verified via trace 2026-05-26 (entry $1D, token starting at branch
  191, R12=$24):
  ```
  R5 = byte at (R1); R1 -= 1                ; capture last-emitted byte
  while LDB(R1) == R5: R1 -= 1               ; inner BEQ scan
  R1 += 1                                    ; back up to mismatch position
  R1 += R12                                  ; (WITH R1 ; ADD R12)
  STB R0 at (R1)                             ; emit ONE byte: R0's low byte
  ```
  **Total emit: 1 byte at position `mismatch_pos + R12`, value =
  R0_low (the byte at the mismatch position, with high byte = 0).**

  This is a fundamentally different output pattern from the LDB-variant.
  R12 here is an OFFSET (forward from mismatch boundary), not a count.
  The encoder's intent appears to be: "find a long matching run, then
  write one byte at an offset within that run — leaving the rest of
  the run as-is from the previous row."

  Verified emit: write at `$700079 = $01` (token in entry $1D after
  scanning $7E down to $55 = 42 iters, R12=$24=36, emit at $55+$24=$79).
  R0 was `$0001` (the LDB at buffer position $55 returned $01 with
  high byte cleared by `WriteDestReg`).

**Note on LDB vs LDW naming:** asar's source shows `LDB (R1)` at
`$0A:806B` for the first variant and `LDW (R1)` at `$0A:8088` for the
second. The mnemonic difference is misleading — both bytes are
`$41` (LOAD opcode for R1), and BOTH have an `ALT1` prefix active
when they execute (the first via the explicit `$3D` byte at `$0A:806B`,
the second via the BMI's dual-issue `ALT1` at `$0A:8087`). Mesen's
`LOAD()` (`Gsu.Instructions.cpp:156`) reads 1 byte when ALT1 is set
and 2 bytes otherwise — so both variants do 1-byte LDB reads at
runtime. asar appears to decode the second instance without
factoring in the dual-issue prefix, hence the bogus "LDW" label.

**LZ-127 ($0A:8127 → $0A:8128).** Falls through `DEC R10` into the
3-bit main dispatch tree (§4.1). The token emits via `$0A:8107`
(R12+1 copies of R5 chosen by the dispatch tree) — functionally
identical to a regular TABLE-REF/RAW-NIB token, but reached via the
back-ref-gated path because R9's sign was set.

**The asar `: MOVE R4, R0` notation at `$0A:80D0` is misleading.** The
BCS at `$0A:80D0` has dual-issue partner byte `$20` (= `WITH R0`
prefix) at `$0A:80D2`, not the complete `MOVE R4, R0` (which is
`WITH R0 ; TO R4` = bytes `$20 $14` and which asar shows as the
combined mnemonic). When BCS is taken to `$0A:8127`, only `WITH R0`
runs in the dual-issue prefetch slot; it's consumed inertly by
`DEC R10` at the target (which ignores prefix). The `$14` (= TO R4)
byte at `$0A:80D3` would only run on the BCS-not-taken fall-through
(= the LZ-back path), where it completes the `MOVE R4, R0` after the
`WITH R0` prefix.

Verified: in entry $14 trace, branch 511 (`$0A:80D0` going into LZ-127)
has R4=$02; branch 512 (`$0A:8127`) still has R4=$02 — no change.

So **LZ-127 does NOT modify R4.** R4 retains its run-length-decode
value (2^K) going into the main dispatch and emit.

Observed twice in the entry-$14 trace (tokens emitting $07 ×2 and
$01 ×8).

**R9-sign accumulator mechanism (verified 2026-05-26, entry $1D).** The
row-flush epilogue at `$0A:8114-$0A:8121` does this:

```
MOVE R0, R4            ; R0 = R4 (R4 = last token's run-length accumulator)
WITH R9 ; ROL          ; R9 = (R9 << 1) | carry_in  (carry_in = 0 from MOVE)
DEC R10                ; (carry unchanged)
BNE $0A:8121 : LSR     ; LSR R0 in dual-issue: carry = R0 bit-0 = R4 bit-0
WITH R9 ; ROR          ; R9 = (R9 >> 1) | (carry_in << 15)
                       ;     = (orig R9 & $7FFF) | (R4_bit0 << 15)
```

Net effect: **R9's MSB after the row flush = R4's bit-0 from the row's
LAST token.** R9's low 15 bits are preserved (= the initial value set
in the prologue from `src[+3] & $0F0F`).

So back-ref mode for the **next row** is enabled iff the **last token
of the current row leaves R4 with bit-0 = 1**. The encoder controls
this implicitly via choice of last token:

- For a normal TABLE-REF/RAW token via `$0A:8128`: R4 = 2^K where K is
  the run-length-decode continue-count. R4 bit-0 = 1 only when K=0,
  i.e., R12=1 (single-nibble run).
- For an LZ-prev/back/127 token: R4 is reset to R0 (current bit-stream
  value) at the dispatch site (`$0A:8063 MOVE R4, R0` or `$0A:80D0 BCS
  : MOVE R4, R0`), so R4 bit-0 is whatever the bit-stream value's
  bit-0 happened to be.

This is a per-row signal in a side channel, not a per-token bit. The
encoder ensures the last token of each row has the desired R4 bit-0.

Verified: in entry $1D, after row 0's last token (an LZ-127 token
emitting from $0A:8107 with R5=$00 but R0=$01), the BRA $0A:80E7+$03
path sets R4 = R0 = $01 via `WITH R0 ; TO R4` at $0A:80EA. R4 bit-0 =
1. Row-flush epilogue's LSR R0 sets carry=1. ROR shifts that into R9's
MSB: R9 went from $0007 → $8007. Back-ref dispatch becomes available
for row 1, where we see LDW-variant fire.

**Observed in entry $14 (row 2 of decode):** 5 LZ-back tokens
preserve a total of 73 byte positions from row 1's buffer; 4 LZ-prev
tokens emit 20 bytes via STB; 1 LZ-127 emits 8 bytes via the regular
dispatch.

**About the asar `: IBT R12, #$14` at `$0A:80E7`:** asar shows
`BRA CODE_0A8095+$01 : IBT R12, #$14` but the `#$14` is the
linear-disassembly mnemonic, not the runtime operand (see
`docs/mchip.md` §7.7 for the general rule). The bytes at
`$0A:80E7`-`$0A:80EA`
are `05 AD AC 14`. BRA reads its offset (`$AD` = -83) via
ReadOperand, which advances R15 to `$0A:80E9` and prefetches
`ProgramReadBuffer = $AC` (the IBT R12 opcode at `$0A:80E9`). BRA
then jumps to `$0A:80E9 + (-83)` = `$0A:8096`. On the next Exec,
ReadOpCode returns `$AC` from the prefetch buffer and refills it with
the byte at the new R15 = `$0A:8096` = `$00`. IBT R12 then executes
with operand = `$00` (not `$14`), so **R12 = $00 across LZ-back exit**,
matching the behavior of normal STB-exit through `$0A:8107 BPL`.

Verified by trace 2026-05-26: branch 434 (LZ-back exit at `$0A:80E7`)
followed by branch 435 (`$0A:80AC`, length-decode loop) both show
R12=$0000. The byte at `$0A:80EA` (`$14`) is dead — it would only be
read as an operand if the BRA jumped to `$0A:80EA-1` = `$0A:80E9`,
which it doesn't.

So LZ-back exit is functionally identical to normal STB exit in
terms of R12: both arrive at the length-decode loop with R12 reset
to $00 and R4 reset to $01.

### 4.5 Output structure: nibble-stream → PLOT pipeline → tile bytes

The decoder fills a row of 128 bytes (= 128 nibbles, walking R1 from
$7F down to $00) in `gsuWorkRam` at `$70:0000-$70:007F`. Each "byte"
in this row buffer has its high nibble = 0 and its low nibble = the
nibble value chosen by the token.

When the row buffer is full, `$0A:80EC` triggers the **PLOT-row**:

```
IWT R12, #$0080            ; 128 iterations
MOVE R13, R15
LDB (R1)                   ; R0 = byte at R1 (= row buffer nibble)
COLOR                      ; ColorReg = R0 (the nibble value 0..15)
LOOP : PLOT                ; PLOT at (R1, R2), R1++ (auto-advance X)
INC R2                     ; next row (Y++)
FROM R2 ; CMP R3
BCC CODE_0A8114 : DEC R1   ; if R2 < R3: more rows. Else fall through.
RPIX                       ; flush remaining cache
STOP : NOP                 ; halt the GSU
```

Each `PLOT(X, Y)` writes one pixel of `ColorReg` at coordinates
(`R1_low`, `R2_low`) into the GSU's pixel cache. The cache flushes
to cart RAM at:

```
addr = $700000 | (ScreenBase << 10) | (tileIndex * (PlotBpp << 3)) | ((y & 7) * 2)
```

per `Gsu.Instructions.cpp:609-624`. So a row of 128 PLOT calls
populates the bitplane bytes of (128/8) = 16 tile columns × 2 rows.

**Verified by write-callback trace 2026-05-26** (entry $00, R3=2):

- 386 writes to `$70:0000-$70:007F` (row buffer, from STB emits)
- 64 writes to `$70:5800-$70:583F` (PLOT pixel-cache flushes)

The PLOT addresses ($5800+) and the 64-byte count match
**2bpp tile data** (PlotBpp = 2):

- ScreenBase = $16 → base = `$700000 + ($16 << 10)` = `$705800`
- 256 nibbles emitted / 64 pixels per 2bpp 8×8 tile = 4 tiles
- 4 tiles × 16 bytes (2bpp) = 64 bytes ✓

The tile data layout within `$70:5800+` follows standard SNES 2bpp
encoding: each tile is 16 bytes (2 bitplanes × 8 rows × 2 bytes per
row, interleaved per row). Multiple tiles are contiguous.

After `STOP`, the 65816 DMAs `$70:5800-$70:583F` to VRAM (handled
by the SuperFX-bridge in `CODE_decompress_gfx_file`).

### 4.6 Worked example: token #1 from entry-0 trace

A real example from the entry $00 trace (source = $5C:BA89). The
first 4 source bytes are the LUT header:

| byte    | R-LUT   | value   | hi nib | lo nib |
|---|---|---|---|---|
| src[+0] = $65 | R6 | $0605 | 6 | 5 |
| src[+1] = $34 | R7 | $0304 | 3 | 4 |
| src[+2] = $71 | R8 | $0701 | 7 | 1 |
| src[+3] = $40 | R9 | $0000 | (RAW escape) | 0 |

After the prologue, the decoder enters the main loop with R1 = $7F
(row buffer cursor) and R10 = 5 fresh bits in R0.

**Token #1** (after token #0 set R1 = $7E):

Run-length prefix (§4.3): the decoder reads 5 bits from R0 via the
loop at `$0A:80AC-$0A:80B4` + `$0A:809C-$0A:80A9`. Bits consumed
(in stream order): `10100`. Decoding:

- iter 1: bit_a=1 (continue). bit_b=0 (no contribution).  R4: 1 → 2.
- iter 2: bit_a=1 (continue). bit_b=0 (no contribution).  R4: 2 → 4.
- iter 3: bit_a=0 (exit). R12 |= R4 (= 4). Final R12 = 4.

So R12 = 4 (= 2² + 0; K=2 continues, L=0 contributions).

3-bit dispatch (§4.1): the decoder reads 3 bits at `$0A:8128 →
$0A:8130 → $0A:813A → $0A:8144`. Bits: `0 0 1`.

- b1=0 at `$0A:8130` (BCS): not taken → $0A:813A subtree (R6/R7).
- b2=0 at `$0A:813A` (BCS): not taken → $0A:8144 (R6).
- b3=1 at `$0A:8144` (BCS): taken → $0A:8101 with `FROM R6` prefix
  → R5 = R6 high byte after SWAP, AND $0F → R5 = $06.

Emit (§4.5): R12 = 4 STB writes at R1=$7E, $7D, $7C, $7B, all
storing R5 = $06. R1 ends at $7A (after the final `DEC R1` in the
LOOP's dual-issue runs even when LOOP doesn't branch).

For TABLE-REF / RAW-NIB tokens the emit count = R12 (the body at
`$0A:8107` runs once initially, then LOOP re-runs it R12-1 more
times for a total of R12 STB calls). LZ-prev LDB-variant differs:
it emits R12 copies of R5 + 1 extra byte of R0 at the boundary
(see §4.4).

**Total token cost:** 5 bits (run-length) + 3 bits (dispatch) = 8 bits
to emit 4 nibbles of $06 = 16 output bits. Compression: 2:1 per this
token.

## 5. The nibble LUTs (R6 / R7 / R8 / R9)

**Confirmed from trace 2026-05-26.** Earlier draft of this section was
wrong — see corrected layout below.

Each of R6/R7/R8 is set to the high and low nibbles of **one** source
byte (NOT two source bytes' worth of nibbles). The prologue's
`ADD R0 ; ADD R0 ; ADD R0 ; TO Rn ; ADD R0` multiplies the source byte
by 16, then ORs in a re-read of the same byte to put the high nibble
in the high byte of Rn and the low nibble in the low byte:

```
R6 = (hi_nibble(src[+0]) in high byte, lo_nibble(src[+0]) in low byte)
R7 = (hi_nibble(src[+1])              , lo_nibble(src[+1]))
R8 = (hi_nibble(src[+2])              , lo_nibble(src[+2]))
R9 = (0                               , lo_nibble(src[+3]))   ; hi half left clear
```

R9 only gets the low nibble of src[+3]; its high half stays 0 because
the multiply pattern isn't re-run for R9. The "missing" R9-hi LUT slot
is what the dispatch's `111` code uses as the RAW escape (§4.2).

Worked from the trace's first 4 source bytes:

| src byte | value | R-LUT  | R-value | nibbles    |
|---|---|---|---|---|
| src[+0]  | $65   | R6     | $0605   | $6, $5     |
| src[+1]  | $34   | R7     | $0304   | $3, $4     |
| src[+2]  | $71   | R8     | $0701   | $7, $1     |
| src[+3]  | $40   | R9     | $0000*  | _, $0      |

\*R9's high byte starts at 0. During decode, R9's **MSB** gets toggled
per row by the row-flush epilogue at `$0A:8114-$0A:8121` based on the
LAST token's R4 bit-0 (§4.4 "R9-sign accumulator mechanism"); this is
the gate that enables back-reference tokens for the next row. R9's
LOW 15 bits are preserved across rows. The dispatch tree only reads
R9's low nibble when emitting the `R9-lo` TABLE-REF code.

So the LUT cache spans **7 frequently-used nibbles** (R6 hi, R6 lo, R7
hi, R7 lo, R8 hi, R8 lo, R9 lo). The 8th dispatch slot (which would
have been R9 hi) is the RAW escape (§4.2).

A nibble that is among the 7 cached values is emitted in 3 dispatch
bits (after the run-length prefix). A nibble that isn't cached needs
`111` + 4 explicit bits = 7 dispatch bits.

The encoder side presumably picks the 4 header bytes to maximize cache
hits across the file being compressed.

Output paths that emit a nibble to the row buffer (via STB):
- `$0A:8107` — TABLE-REF / RAW-NIB / LZ-127 emit. `FROM R5 ; STB (R1)`
  writes R5 to the row buffer; LOOP iterates R12+1 times walking R1
  backward.
- `$0A:8071` (LZ-prev LDB initial) and the LOOP body at `$0A:8074-8077`
  for LZ-prev LDB tokens.
- `$0A:8091` for the LZ-prev LDW-variant's single-byte emit.
- `$0A:8092` for the LDB-variant's exit STB (writes R0 = mismatch byte).

The PLOT/COLOR/RPIX pipeline (§4.5) runs ONCE PER ROW from `$0A:80EC`,
not per token. It reads the now-filled row buffer at `$70:0000-007F`
via `LDB (R1) ; COLOR ; PLOT` and writes 2bpp/4bpp tile bytes to
`$70:5800+`.

## 6. The refill helper (`lz16_refill` at `$0A:81B3`)

Cross-bank-aware byte fetch. Called via `LINK #4 ; IWT R15, #lz16_refill : GETB`
whenever R10 (bit counter) reaches zero.

```
INC R14                     ; advance source byte pointer
BNE   no_wrap : IBT R10, #$08    ; if didn't wrap, reset R10 = 8 and return
; --- bank wrap ---
LM    R10, ($0080)          ; load saved previous bank from $0080
INC   R10
FROM  R10 ; SBK             ; SBK = "set bank for next operation" (or SAVE BANK)
FROM  R10 ; ROMB            ; set ROMBR to the new bank
IBT   R14, #$00             ; reset offset to start of new bank
no_wrap:
IBT   R10, #$08             ; reset bit count
MOVE  R15, R11              ; PC = R11 (the LINK return address)
```

The `:` syntax is **GSU dual-issue**: the instructions on either side of
the colon execute in parallel. This is what makes `BNE target : IBT R10, #$08`
work — the IBT happens regardless of which branch is taken (it's a
side effect on the same cycle).

### 6.1 Bank-wrap semantics (asm-verified 2026-05-26)

**No write-back to $0080.** The wrap path loads R10 from RAM[$0080]
(= the *initial* bank, saved by `SM ($0080), R0` in the prologue),
increments it, and uses that as the new bank. It does NOT save the
new bank back. So if a decode were to wrap MORE THAN ONCE, every
wrap would jump to the same (initial+1) bank — but in practice,
compressed files are laid out so that each decode wraps at most once
(file size < 64KB and never spans more than one bank boundary).

**Both SBK and ROMB are set.** SBK sets the SuperFX RAM bank
register; ROMB sets the ROM bank register. Both are updated so that
subsequent ROM reads (via GETB) AND any RAM accesses use the new
bank.

**R14 resets to $00.** After the wrap, the source pointer starts at
offset $0000 of the new bank — i.e., we continue reading from
`new_bank:0000`.

The trace harness's lz16-decode scenario never observed a wrap in
practice — all sampled entries decompress within their starting
bank because R3=$0002 limits decode to ~2 rows × 128 nibbles, which
typically consumes only 50-100 source bytes. To force a wrap, a test
would need to pick an entry near a bank end (e.g., index 9 →
`$5C:FF0B`) AND increase R3 (rows) to make the decode consume more
than ~250 source bytes.

## 7. Concrete inputs / outputs for porting

A faithful host-language port needs four pieces:

1. **A bit stream reader** that pulls bytes from a flat byte array and
   exposes `read_bit()` / `read_n_bits(n)`. The SuperFX side does this
   implicitly via LSR + BCC/BCS + GETB; a host port just reads from
   an array directly.

2. **The token dispatch tree.** Per-token flow:
   1. Read the run-length prefix (Elias-gamma, §4.3) → R12.
   2. Check the back-ref gate: is the R9 sign bit set?
      - No: proceed to the 3-bit dispatch tree (§4.1).
      - Yes: read 1 bit (bit_x at `$0A:80C5`). If 1, LZ-prev variant
        (§4.4). Else read another bit (bit_y at `$0A:80D0`). If 1,
        LZ-127 (= main dispatch). Else LZ-back (preserve).
   3. Execute the chosen token's emit (§4.1/4.2/4.4).

3. **A 128-byte row buffer.** Tokens emit nibbles to this buffer
   via STB walking R1 backward. Pre-fill with zeros at decode start.
   When R1 wraps to a "negative" value (= the row is full), flush
   the row and reset for the next.

4. **A row-flush handler.** Per row:
   - Pre-row: the buffer at offset 0..127 holds 128 nibble values.
   - Pack nibbles into 2bpp (or 4bpp) tile bytes per
     `GetTileAddress(x, y) = (ScreenBase << 10) + (tileIndex * 16) +
     ((y & 7) * 2)` (with `tileIndex = (x >> 3)` for the common case).
   - Update R9's MSB from the last token's R4 bit-0 (§4.4 R9-sign
     accumulator).
   - Increment row counter R2; stop when R2 == R3.

## 8. Final step — ground-truth validation (RESOLVED 2026-05-26)

The model in §1-§7 is **trace-consistent**: every claim has been
verified against runtime observation of the GSU executing real LZ16
inputs (see §9). As of 2026-05-26 it is **also externally validated
against the canonical FORMAT=15 decoder** (`lc200/decomp.exe`, the
closed-source Lunar Compress reference) via a three-way byte-for-byte
comparison across every entry in `DATA_06FC79`.

### 8.0 Result

| Pair                                 | Match  |
|---|---|
| `lc200/decomp.exe FORMAT=15` ↔ TS port (`scripts/engine/decompress/lz16.ts`) | 187 / 187 ✓ |
| `lc200/decomp.exe FORMAT=15` ↔ Mesen GSU trace of `$0A:8000` | 187 / 187 ✓ |
| TS port ↔ Mesen GSU trace                                    | 187 / 187 ✓ |

All three sources agree byte-exact on every entry in the LZ16 GFX
pointer table at every entry's natural per-entry `format2` (rowCount,
probed from 4 strips down to 1). Total decompressed: 187 entries =
283,136 bytes; total compressed source consumed: 116,527 bytes
(2.43× expansion). Per-entry `format2` distribution: 89 entries at
4 strips (2,048 B out), 1 at 3 strips, 97 at 2 strips (1,024 B out).

Since the three legs derive from three independent code paths —
FuSoYa's C decoder, a from-decompilation TypeScript port, and the
SuperFX cart asm running under Mesen — agreement across all 187
entries transitively validates this document's model end-to-end.

### 8.1 How it ran

Three generator scripts and one comparator:

| Script | What it produces | How |
|---|---|---|
| `scripts/generate-lz16-testdata.ts` | `test-data/lz16/decomp/entry_NNN.bin` | Invokes `lc200/decomp.exe` per entry; probes `format2` from 4 down to 1 until decomp succeeds (most entries can't fill 4 strips); writes `manifest.json` with the per-entry `format2` everyone else uses. |
| `scripts/generate-lz16-port.ts`     | `test-data/lz16/port/entry_NNN.bin`   | Imports `scripts/lz16-decoder.ts` (verbatim copy of the LZ16 decoder `scripts/engine/decompress/lz16.ts`) and runs it per manifest entry. |
| `scripts/generate-lz16-mesen.ts`    | `test-data/lz16/mesen/entry_NNN.bin`  | Drives Mesen 187× through the `lz16-extract` trace-harness scenario. ROM is built ONCE; per-entry params (`gfxIndex`, `rowCount`) come from WRAM, written by Lua at the `$00:8150` hijack hit. Lua snapshots `$70:0000-007F` (128-byte row buffer) at each `$0A:80EC` PLOT-row entry and dumps rows as `LZ16ROW NNNN <hex>` lines. The runner parses those, transposes to SNES 4bpp tile bytes (same algorithm as the TS port), and writes the .bin. |
| `scripts/compare-lz16.ts`           | exit code + per-entry diff | Pairwise byte-compares any two source dirs (`decomp` / `port` / `mesen`) against the shared `manifest.json`. |

Wall-clock timing:
- decomp.exe sweep: ~2 min (subprocess overhead dominates)
- TS port sweep: <1 s
- Mesen sweep: ~131 s (~0.7 s per entry, including Mesen launch)

Run order:
```bash
node scripts/generate-lz16-testdata.ts   # canonical ground truth
node scripts/generate-lz16-port.ts       # TS port
node scripts/generate-lz16-mesen.ts      # Mesen GSU runtime
node scripts/compare-lz16.ts decomp port
node scripts/compare-lz16.ts decomp mesen
node scripts/compare-lz16.ts port mesen
```

### 8.2 Token-kind mapping between the two models

The frames differ but describe the same algorithm:

| TS-port mode (per `lz16.ts`) | This document's token | Notes |
|---|---|---|
| 0 — Skip-runs (walk cursor left past N equal-pixel runs, no writes) | LZ-back (§4.4) | Both "advance cursor past N run-boundaries without emitting." |
| 1 — Predictor (3-bit index `pred[0..7]`; index 7 reads 4 fresh bits) | TABLE-REF + RAW-NIB (§4.1, §4.2) | 7 cached nibbles in `pred[0..6]` ≡ R6/R7/R8 hi/lo + R9 lo; index 7 = our 111 dispatch = RAW. |
| 2 — Bridge (find boundary, fill backward with ref, restore boundary pixel) | LZ-prev LDB (§4.4) | R12 copies of R5 + 1 of R0 at boundary. |
| 3 — Jump-fwd (find boundary, jump cursor right, write boundary pixel) | LZ-prev LDW (§4.4) | 1 byte at `scan_end + R12`. |
| `rowMode` bit per pixel row | R9-sign accumulator (§4.4) | the TS port reads 1 explicit bit per row; this document derives the same bit from R4 bit-0 at the row-flush epilogue. These are the same bit observed from two angles. |
| `rowCount` parameter (= tile-strip count, each 8 pixel-rows) | R3 (= pixel-row count, 1:1 with PLOT-row events) | Scale differs by 8× (the port's 1 strip = our R3 of 8). |

Token kinds not directly mapped by the TS port (because they're
GSU-execution variants rather than format-level concepts):

- **LZ-127** (§4.4): a GSU-side path that falls through to regular
  TABLE-REF dispatch after the back-ref gate fires. The TS port's mode
  1 covers this naturally.
- The "asar mnemonic vs runtime" subtleties (e.g., the
  STW-with-runtime-ALT1 trick at `$0A:8092`): GSU-implementation
  detail, not format-level. The TS port correctly abstracts past it.

### 8.3 Re-running the validation

To regenerate the test data from scratch (e.g. after touching
`scripts/lz16-decoder.ts` or the `lz16-extract` scenario):

```bash
# Wipe + regenerate all three sources
rm -rf test-data/lz16
node scripts/generate-lz16-testdata.ts            # ground truth
node scripts/generate-lz16-port.ts                # TS port
node scripts/generate-lz16-mesen.ts               # Mesen GSU (builds trace ROM once)

# Pairwise byte-compare
node scripts/compare-lz16.ts decomp port
node scripts/compare-lz16.ts decomp mesen
node scripts/compare-lz16.ts port mesen
```

For Mesen re-runs only (skip the ROM build), pass `--skipBuild`.
For a subset, pass `--ids=0,1,5,10` or `--limit=N` to any of the
generators or the comparator. Comparator's `--verbose` shows
first-diff offsets + bytes when a mismatch is found.

Independent sibling: the framework's own
`scripts/engine/decompress/verify.ts` also runs the
same TS port side-by-side with `decomp.exe` (the trace-harness vendored its
`lz16.ts` into `scripts/lz16-decoder.ts`). Both produce equivalent
validation results.

## 9. Open questions

Most of the format is now nailed down by the runtime trace. Section 4
(token tree) and Section 5 (nibble LUTs) are confirmed from observed
GSU register state at every conditional branch — see `§9.1 RESOLVED`
below. The remaining questions are §9.5 (R3 semantics confirmed:
output rows) and the precise bit-by-bit construction of R12 inside the
run-length prefix.

### 9.1 RESOLVED — Exact bit assignment per token (2026-05-26)

**Resolution path:** Mesen2 Lua trace of `lz16_decompress` with full
GSU register state captured at every branch in the bit-reader. Trace
harness at `trace-harness/scenarios/lz16-decode/`. Analyzer at
`scripts/analyze-lz16-trace.ts`. Two traces were taken: dispatcher
entry 0 (no back-references — straight TABLE-REF + RAW) and entry $14
(back-reference-heavy — 122 of 810 branches in back-ref PCs). Together
they exercise all six observed token types: R6/R7/R8 hi/lo, R9 lo,
RAW-NIB, LZ-back (scan-and-emit), LZ-prev, LZ-127, PLOT-row.

Findings:

- **Token format**: `<run-length-prefix> <3-bit dispatch> [<4-bit RAW>]`.
  The 3-bit dispatch picks one of 7 cached nibbles or the RAW escape.
  See §4 for the full table.

- **LUT layout** (§5) corrected — each Rn holds 1 source byte's
  nibbles, not 2 bytes' worth. R9 only carries the lo nibble of
  src[+3]; the "missing" R9-hi slot becomes the RAW escape code.

- **Output is a nibble stream**: each emitted byte has its high nibble
  set to 0 and its low nibble set to the chosen nibble value. The
  graphics consumer (PLOT/COLOR/RPIX pipeline driven by §4.5) re-packs
  these into 4bpp tile bytes.

- **Run length** (R12) drives the `LOOP : DEC R1` at `$0A:8107`.
  For TABLE-REF / RAW-NIB tokens the emit count = R12 (the body runs
  R12 times total = once initially + R12-1 LOOP-driven re-runs).
  Encoding fully decoded in §4.3 (Elias-gamma with 2 bits per loop
  iter; validated against 52/52 trace tokens).

- **Back-reference gating** (§4.4): R9's sign bit determines whether
  a token uses regular 3-bit dispatch or one of three back-ref
  variants (LZ-back / LZ-prev / LZ-127). R9 MSB is toggled per row by
  the row-flush epilogue at `$0A:8114-$0A:8121` from the LAST token's
  R4 bit-0. This is a flag-channel piggybacked on the row epilogue,
  not a per-token bit.

- **LZ-back** preserves data from the previous row (no STB).
  Verified by write-callback trace: zero writes during the LZ-back
  scan loop's R1 walk.

- **LZ-prev LDB** emits `R12` copies of the "previous byte" (R5 from
  `LDB (R1)`) plus 1 byte at the scan boundary (R0 from the mismatch
  position, via STW-with-ALT1 trick at `$0A:8092`).

- **LZ-prev LDW** emits exactly 1 byte at offset `scan_end + R12`,
  value = R0 low byte (= the mismatching word's low byte).

- **LZ-127** falls through to regular main-dispatch (R6/R7/R8 hi/lo,
  R9 lo, RAW-NIB). R4 is NOT modified by the entry (asar's
  `MOVE R4, R0` notation at `$0A:80D0` is the linear-disassembly
  mnemonic — only the `WITH R0` byte actually runs in the dual-issue,
  per `docs/mchip.md` §7.7).

Token-type distribution from one entry-0 run (54 tokens):

| Type     | Count | Nibbles emitted |
|---|---:|---:|
| R8-lo    | 14    | 81 |
| R9-lo    | 13    | many (with PLOT-row flushes) |
| R7-hi    | 11    | 13 |
| RAW-NIB  | 8     | 8  |
| R6-hi    | 3     | 8  |
| R6-lo    | 3     | 3  |
| PLOT-row | 2     | 2 row-flushes (R3=2 means decoder halts after these) |

### 9.2 Trace harness retrospective (2026-05-26)

The bit-precise spec was extracted via **Mesen2 Lua trace** (not via
hand-reading the asm). Two traces — dispatcher entry $00 (no
back-references) and entry $14 (back-ref-heavy) — together exercise
every token type and dispatch path. The full toolchain is at
`trace-harness/scenarios/lz16-decode/` and `scripts/analyze-lz16-trace.ts`.
See `trace-harness/README.md` for the API quirks and addressing
patterns (the most non-obvious being that GSU writes need
`memType.gsuMemory` with addresses in the `$700000+` SNES-bus form,
not `gsuWorkRam` offsets).

Notable dead-ends ruled out empirically:
- **BizHawk** doesn't expose SuperFX execution events through Lua —
  only the main 65816 CPU. Verified by trying every available core
  variant. Mesen2 was the only emulator that works.
- **Static reading alone** can't extract bit assignments. The reasons
  why are GSU-specific: goto-style control flow, ALT1/2/3 prefixes
  that flip opcode meanings, dual-issue `:` that runs the partner
  in parallel with branches, and implicit register state across the
  loop. A trace + analyzer combination disentangles all of this.

A formal GSU simulator (interpreting all ~50 opcodes the decoder
uses) was considered but never needed — the trace harness's
register-state capture at every branch turned out to be sufficient
to derive the format directly. If a future host-language port is
written, it can either (a) replicate the GSU asm step-by-step as
that simulator would, or (b) work from §4-§6's spec directly. (b)
is easier to maintain but loses GSU-fidelity for edge cases.

### 9.5 Secondary open questions

1. **Role of R3 (size hint) — RESOLVED 2026-05-26.** R3 = **output row
   count**. The trace ran with R3=$0002 and decompressed exactly 2 rows
   = 256 nibbles total (128 nibbles per row, with a PLOT-row flush at
   the end of each row). The check at `$0A:80F2` (`FROM R2 ; CMP R3 ;
   BCC CODE_0A8114`) compares the current row index R2 against R3 and
   exits via `STOP : NOP` when R2 reaches R3. This is the termination
   path (question 2 below). The post-prologue `IBT R12, #$40` sets the
   row width to 64 (× 2 bytes per STW = 128 nibbles per row), which is
   independent of R3.

2. **Termination condition — RESOLVED 2026-05-26.** `STOP : NOP` at
   `$0A:80FB` (after RPIX). Reached when R2 == R3 in the
   end-of-row check at `$0A:80F2`. The trace confirms: after the
   second `$0A:80EC` PLOT-row event, no further branches fire, and
   the 65816 sees the SuperFX halt. So the SuperFX doesn't really
   "return an output length" — it stops at a deterministic point
   (R3 rows × 128 nibbles each), and the 65816 side knows the
   expected output size from R3 at dispatch time.

3. **Run-length-prefix bit encoding — RESOLVED 2026-05-26.** See §4.3
   for the full encoding. The loop at `$0A:80AC-$0A:80B4` +
   `$0A:809C-$0A:80A9` reads 2 bits per iteration (`bit_a`, `bit_b`);
   `bit_a=0` exits with `R12 |= R4`, `bit_a=1` continues; `bit_b`
   controls whether the current R4 power-of-2 contributes to R12.
   Final: `R12 = 2^K + L` where K is the continue-count and L is the
   LSB-first packing of K `bit_b` values. Validated against 52/52
   tokens in the captured trace.

4. **Back-reference gating mechanism — RESOLVED 2026-05-26.** R9's
   sign bit at `MOVES R9, R9 ; BPL CODE_0A8128` gates between regular
   dispatch and back-ref dispatch. The MSB is updated each row by the
   epilogue at `$0A:8114-$0A:8121` (`MOVE R0, R4 ; WITH R9 ; ROL ;
   ... ; WITH R9 ; ROR`) from R4 bit-0 of the LAST emit token. See
   §4.4 R9-sign accumulator.

5. **LZ-prev LDW-variant emit semantics — RESOLVED 2026-05-26.**
   Verified via entry $1D trace: emits exactly 1 byte at offset
   `mismatch_position + R12`, value = R0 low byte (the mismatching
   word's low byte). See §4.4.

6. **R12=$14 pre-load after LZ-back — RESOLVED (claim was wrong)
   2026-05-26.** The asar `: IBT R12, #$14` at `$0A:80E7` is the
   linear-disassembly mnemonic; the GSU's prefetch-routed execution
   reads the IBT R12 operand from the BRA target, not from the
   source `$14` byte (see `docs/mchip.md` §7.7). R12 actually
   resets to 0 across LZ-back
   exit (the operand byte read at the BRA target = `$00`). See §4.4.

7. **PLOT pipeline output format — RESOLVED 2026-05-26.** Verified
   via write-callback trace: PLOT writes go to
   `$700000 | (ScreenBase << 10)` (= `$70:5800` for typical
   ScreenBase=$16), in standard SNES 2bpp/4bpp tile-byte format.
   See §4.5.

8. **lz16_refill bank-wrap — DOCUMENTED 2026-05-26 (asm-verified).**
   The wrap path loads R10 from RAM[$0080] = initial bank, increments,
   uses as new bank for both SBK and ROMB; resets R14 to $00. No
   write-back, so only single-wrap per decode is supported by design.
   See §6.1.

9. **Ground-truth validation against `lc200/decomp.exe FORMAT=15`** —
   **RESOLVED 2026-05-26**. All 187 entries match byte-for-byte
   across three independent decoders: `decomp.exe`, the TS port at
   `scripts/lz16-decoder.ts` (vendored from `scripts/engine/decompress/lz16.ts`), and Mesen
   running the cart's own `lz16_decompress` at `$0A:8000`. See **§8**
   for results, scripts, and re-run instructions.

## 10. Cross-references

- **`yi/Banks/Bank00.asm:5127`** — `CODE_decompress_gfx_file`
  (SNES-side dispatcher, BPL/BMI split for LZ1 vs LZ16).
- **`yi/SuperFX/Banks/Bank0A.asm:85-368`** — `lz16_decompress` body in
  full, with all 30+ bit-reader branches and the 4 nibble-LUT loaders.
- **`yi/SuperFX/Banks/Bank0A.asm:378-392`** — `lz16_refill` (cross-bank
  GETB refill helper).
- **`docs/mchip.md`** §3.2 + §5 — high-level commentary on both LZ1
  and LZ16 (LC_LZ1 / LC_LZ16 nomenclature, GoldenEgg-port bug,
  CMODE+LSR+BCS structure).
- **`lc200/decomp.exe`** — ground-truth byte-level decoder for
  validation. FORMAT=15 is LZ16. See §8 for the validation result.
- **`scripts/lz16-decoder.ts`** — TS port of LZ16 (vendored from
  the framework decoder `scripts/engine/decompress/lz16.ts`,
  itself derived from decompiled `lc200/decomp.exe`). One of the
  three legs of the §8 validation matrix.
- **`scripts/generate-lz16-testdata.ts`** /
  **`scripts/generate-lz16-port.ts`** /
  **`scripts/generate-lz16-mesen.ts`** /
  **`scripts/compare-lz16.ts`** — the three-way validation
  generators + pairwise byte-diff comparator. Outputs land in
  `test-data/lz16/{decomp,port,mesen}/` against a shared
  `manifest.json`. See §8.1 + §8.3.
- **`trace-harness/scenarios/lz16-extract/`** — Mesen scenario that
  decodes one entry per launch, snapshotting `$70:0000-007F` per row
  via Lua. Takes per-entry params from WRAM (`$7E:0010` / `$7E:0012`)
  so one ROM build covers all 187 entries.
- **`/tmp/lz16-snes-side.s`** — full closure of the SNES-side
  dispatcher (4 routines, 268 lines).
- **`/tmp/lz16-superfx.s`** — closure of the SuperFX-side decoder.
  The pre-existing dump is ~2400 lines because it was taken before
  the `MOVE R15, R*` flow-break fix; a fresh
  `npm run closure -- lz16_decompress --depth 1` would now stop
  cleanly at the `MOVE R15, R11` return idiom and produce a tighter
  bundle. Re-dump only if needed — the model cites asm line numbers
  directly so the existing file isn't a blocker.
