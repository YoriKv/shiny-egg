# snes-framework

A specialized fork of [Yoshifanatic's SNES ROM Framework v1.4.0](https://github.com/Yoshifanatic/SNES-ROM-Framework) carrying his YI disassembly (Yoshi's Island, SMW2). Trimmed to only what YI needs and wrapped in a Node-managed build system so it can serve as the foundation for the **shiny-egg** level editor — while keeping the build byte-identical to the original cart at every step.

It does double duty: a documented, navigable YI source (inline comments, descriptive labels, cross-references), and the asm + build pipeline the editor extracts from and rebuilds.

Source of truth: the `.asm` files in `global/` and `yi/`. Extracted game assets and built ROMs are generated, not committed.

## What's in here

- Targets **USA V1.0** (`reference/YI_USA1.sfc`, MD5 `cb472164c5a71ccd3739963390ec6a50`) for byte-exact verification. **USA V1.1** (`reference/YI_USA2.sfc`) is also supported.
- The original 227,396-line `Routine_Macros_YI.asm` is split into 36 per-bank files under `yi/Banks/` plus cross-bank shared routines in `yi/Routines/`. The 75,026-line SuperFX program is split per-bank under `yi/SuperFX/Banks/`. Defines and memory maps are split per topic under `yi/Constants/` (15 files) and `yi/Memory/` (15 files). The original umbrella files (`Routine_Macros_YI.asm`, `Misc_Defines_YI.asm`, `RAM_Map_YI.asm`, `ExRAM_Map_YI.asm`) are kept as thin wrappers that `incsrc` the split files.
- Every asm file carries a header describing its contents, address ranges, and cross-references. Significant routines have block comments above them and end-of-line annotations on non-obvious instructions. Descriptive English aliases live alongside templated `CODE_xxxxxx` / `YI_NorSpr*` labels at the same address.
- The engine-core banks (Bank00, Bank01, Bank0F, Bank12, Bank13, Bank17), the entire SuperFX program, and the major boss + sprite-engine banks (Bank02, Bank03, Bank05) carry descriptive aliases on hundreds of dispatch-table entries.
- All 442 normal sprites, 121 ambient sprites, and the level set are named in `yi/Constants/` with handler-location pointers; every NormalSpriteIDs entry carries a `See docs/*.md.` cross-ref to its sprite-family or boss-engine doc.
- Content has been cross-validated against three other YI disassemblies and the full SMW Central memory map (which surfaced material framework corrections + verified hundreds of entries).
- The cart's two graphics decompressors are documented as asm: `lz16_decompress` (`yi/SuperFX/Banks/Bank0A.asm`) implements the predictor-coded **LC_LZ16** format, and `lz2_decompress` (`yi/SuperFX/Banks/Bank08.asm`) implements **LC_LZ2** — the framework originally mislabelled the latter `lz1_decompress` (and the files `.lz1`) after a historical misidentification; renamed symbol-by-symbol. See [`docs/lz16-model.md`](docs/lz16-model.md) for the LZ16 algorithm reference.

## Engine reference docs

`docs/` synthesises cross-file knowledge that doesn't fit in any single asm header:

| Doc | Covers |
|---|---|
| `enginecore.md` | Bank00: boot, NMI/IRQ, palette + gfx loaders, SPC700 upload, bank-mapping math |
| `bossengine.md` | Bank01: Hookbill state machine + boss-engine conventions |
| `mchip.md` | SuperFX/GSU-2: register conventions, decompressors, player physics |
| `leveldataengine.md` | Bank12/13: object dispatch, Map16 walker, page-table cart location |
| `levelloader.md` | Bank17/0F: gamemode chain, level-load pipeline, world-map dispatcher |
| `spritestateengine.md` | Bank03: 9-state sprite dispatcher, per-sprite pointer tables |
| `renderingpipeline.md` | How a level's BG/sprite layers are assembled (the model the editor's static render follows) |
| `bg23rendering.md` | BG2/BG3 reconstruction: per-LevelMode PPU config, parallax scroll math, HDMA/SuperFX layer effects |
| `family-*.md` (23) | Per-sprite-family deep-dives covering every regular sprite |
| `sprite-neighbor-dependencies.md` | Designer-facing inventory of sprites whose behaviour depends on neighbouring placed level data |
| `lz16-model.md` | LZ16 decompressor algorithm reference |
| `smwc-memory-map.tsv` | 1427-entry extraction of SMW Central's YI memory map (canonical third-party cart-byte cross-reference) |

(The per-level object/sprite instance index that backs the editor's debug
finder is no longer a committed doc — it's regenerated at extract time into
`editor-data/yi/instance-index.json`; see `scripts/instance-index.ts`.)

## Usage

This package isn't built standalone — the shiny-egg **editor** drives extraction and builds through it (`extract.ts` / `build.ts` are library modules invoked over IPC, not CLI scripts). From the editor: **Workshop → ROM → Extract** populates `assets/yi/` from the reference cart, then **Build** / **Test Level** runs the asar pipeline into `build/`. V1.0 builds byte-identical to the reference cart.

Prereqs: Node 24 (`nvm use` — pinned via `.nvmrc`), `pnpm install` at the repo root, and a headerless reference cart dropped at `reference/` (see below).

The only standalone framework CLI is **asm exploration** (run from the repo root):

```bash
pnpm xref -- <label>                # callers/callees/reads/writes for one label
pnpm closure -- <label>             # a routine + every transitively-called routine
```

Both auto-trigger a symbol-emitting build on first run if no `.sym` exists yet.

## Code exploration

Two read-only tools for tracing how parts of the codebase fit together — useful for understanding a self-contained algorithm (e.g. the LZ2 decompressor) or for finding every site that touches a given memory address. Both run off the `.sym` files emitted by the build.

Both share a cached call-graph + xref index built by `scripts/codegraph.ts`. The build emits two `.sym` files alongside the `.sfc`: `<rom-stem>.sym` (SNES side) and `<rom-stem>-superfx.sym` (SuperFX side — addresses for `CODE_0A8000`, `lz16_decompress`, etc. that otherwise wouldn't be in the SNES sym). codegraph merges both into one unified label map. The cache lives next to the primary `.sym` as `<rom-stem>.graph.json` with a combined MD5 of every `.sym` embedded; rebuild is automatic when any `.sym` changes, otherwise the cache loads in under a second.

### `pnpm xref -- <label>`

Print the call-graph record for one label: callers, callees, and the `!RAM_*` / `!EXRAM_*` / `!REGISTER_*` defines it reads, writes, and read-modify-writes.

| Form | What it does |
|---|---|
| `pnpm xref -- CODE_yi_reset` | Full record (callers + callees + refs + memory accesses) |
| `pnpm xref -- CODE_foo --callers` | Restrict to callers (also `--callees`, `--refs`, `--mem`) |
| `pnpm xref -- --readers !RAM_YI_…` | Every routine that reads a given define |
| `pnpm xref -- --writers !RAM_YI_…` | Every routine that writes it |
| `pnpm xref -- --rmw !RAM_YI_…` | Read-modify-write sites (`INC` / `DEC` / `ASL` etc.) |
| `pnpm xref -- --reads-addr 00:1C92` | Same, keyed on a raw address — for bytes that *have no `!define`* yet (also `--writes-addr`, `--rmw-addr`) |
| `pnpm xref -- --addr 00:8000` | All labels at one SNES address (alias inventory); a range like `00:1C00-00:1D40` also works |
| `pnpm xref -- --search '^CODE_handle_'` | List labels matching a regex (label-name only) |
| `pnpm xref -- --grep 'kamek' --grep-comments` | Asm-text grep with nearest-label context |
| `pnpm xref -- --stats` | Graph-wide summary |
| `pnpm xref -- --json CODE_foo` | Raw JSON record (for tool composition / `jq` chains) |

Memory access matching works through **both styles**: instructions that use a `!define` operand (`STA !RAM_YI_Level_StarTickCounterLo`) AND instructions that use a raw `$XXXX` literal (`INC.w $0394`). At index time the tool resolves every numeric operand to its 24-bit address (with `.b` / `.w` / `.l` width hints + WRAM low-mirror `$00:xxxx` ≡ `$7E:xxxx` bridging), so a `--writers !FOO` query returns every routine touching FOO's address whether the source uses the name or the literal. For addresses with no `!define` yet, use the address-keyed `--reads-addr` / `--writes-addr` / `--rmw-addr` variants.

Indirect calls through the SuperFX WRAM trampoline (`JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt`) are recorded as a `read` of the trampoline define AND as a `refs` edge to the `FXCODE_*` label loaded into A immediately before the JSL — so the closure tool walks into the SuperFX side naturally.

### `pnpm closure -- <label>`

Walks the call graph breadth-first from one entry label and emits the source body of every reachable routine, with an annotated header for each block (address, source `file:line`, aliases, calls, callers, reads, writes). Designed for "show me everything the LZ16 decompressor depends on" — pipe to a file and you have a self-contained bundle.

| Flag | Meaning |
|---|---|
| `--depth N` | Limit BFS depth (default: unlimited) |
| `--exclude REGEX` | Skip any label whose name matches; repeatable |
| `--no-source` | Print only the call-graph headers, not the asm bodies |
| `--no-refs` | Don't follow `refs` edges (skip the SuperFX-trampoline indirect-call expansion) |
| `--bodies-only` | Slim headers — one line per routine for easier grepping |
| `--out PATH` | Write to a file instead of stdout |

The closure dedupes by **address** so multiple aliases of the same physical routine appear once. Routine boundaries follow the graph builder's heuristic (shared via `codegraph.ts`'s `isControlTransferLine`): a label is a fresh routine only when the immediately preceding line is a control-flow break — `RTS` / `RTL` / `RTI` / `JMP` / `JML` / `BRA` / `BRL`, a SuperFX PC-write, or a data-emitting directive (`db` / `dw` / `dl` / `incbin` / `org`). Labels with fall-through from above are treated as internal jump targets of the surrounding routine.

## Reference cart

Place a headerless `.sfc` of the cart you want to build/edit under `reference/`:

| ROM version | Expected filename | MD5 |
|---|---|---|
| YI_U1 (USA V1.0) | `reference/YI_USA1.sfc` | `cb472164c5a71ccd3739963390ec6a50` |
| YI_U2 (USA V1.1) | `reference/YI_USA2.sfc` | `ce1e3e33b6e39d37b43d7de599f9e785` |

ROMs are copyrighted by Nintendo — `reference/` is gitignored and `*.sfc` is blocked by `.gitignore` everywhere as a defensive measure. You supply your own dump.

## ROM version support

Both USA versions build successfully end-to-end:

| Version | Extracted files | Build vs reference cart |
|---|---|---|
| YI_U1 (USA V1.0) | 981 (0 empty placeholders) | **Byte-identical** |
| YI_U2 (USA V1.1) | 1026 (95 deliberately empty) | Known benign diffs in banks `$11`/`$12` (and the header checksum) from upstream garbage-data slots the V1.1 extraction path doesn't yet cover — game still boots and runs |

`E1`/`E2`/`J1`/`J2`/`J3` exist as labels in `scripts/rom-versions.ts` but are flagged `supported: false` — enabling one would require a matching `RomMap/ROM_Map_YI_<V>.asm` file and version-specific data work in `AssetPointersAndFiles.asm` and `Routine_Macros_YI.asm`.

## Layout

```
.
├── asar.exe                 asar 1.91 (the only build-pipeline tool)
│
├── global/                  Shared SNES framework — Yoshifanatic's v1.4.0
│   ├── AssembleFile.asm       multi-phase entry point
│   ├── Global_Macros.asm, Global_Definitions.asm
│   ├── Controllers/           19 controller types
│   ├── HardwareRegisters/     20 coprocessor register sets
│   └── MemoryMap/             13 memory-map presets
│
├── docs/                    Engine reference docs + sprite-family deep-dives
│                              + third-party cross-references (see table above)
│
├── yi/                      YI assembly source (no asset binaries)
│   ├── Banks/                 36 per-bank entry files (Bank00.asm .. Bank57.asm)
│   ├── Routines/              shared cross-bank macros
│   ├── Constants/             15 per-topic define files (SoundIDs, SpriteIDs, etc.)
│   ├── Memory/                15 per-region memory-map files (WRAM_*, SRAM_*)
│   ├── SuperFX/
│   │   ├── Banks/               13 per-bank SuperFX files
│   │   ├── BankDefines.asm, RoutinePointers.asm
│   │   └── SuperFXCode_YI.asm   wrapper + SNES↔FX bridge
│   ├── SPC700/                .asm only — sample data is in assets/
│   ├── RomMap/                ROM_Map_YI_U1.asm, ROM_Map_YI_U2.asm
│   ├── AsarScripts/           AssetPointersAndFiles.asm (extraction master pointer table)
│   ├── Custom/                Asar_Patches_YI.asm (custom-patch macros, disabled by default)
│   ├── Tables/Fonts/          text-encoding table
│   ├── Routine_Macros_YI.asm  wrapper — incsrc's Banks/ + Routines/
│   ├── Misc_Defines_YI.asm    wrapper — incsrc's Constants/
│   ├── RAM_Map_YI.asm         wrapper — incsrc's Memory/WRAM_*
│   └── ExRAM_Map_YI.asm       wrapper — incsrc's Memory/SRAM_*
│
├── assets/yi/               Extracted assets — gitignored, regenerated on extract
│   ├── LevelData/             per-level .bin files (95 are deliberately empty for U2)
│   ├── Graphics/, Graphics/SuperFX/, Tilemaps/, GarbageData/
│   └── SPC700/                .brr samples + music data blobs
│
├── build/                   Output ROMs + .sym files — gitignored
├── reference/               User-supplied cart dumps — gitignored, never committed
└── scripts/                 Node-side TypeScript (Node 24 strips types)
    ├── cli.ts                argv dispatcher for `pnpm xref` / `pnpm closure`
    ├── extract.ts            native bytes-slicing extractor (editor-invoked)
    ├── build.ts              the multi-phase asar build orchestrator (editor-invoked)
    ├── asar.ts               asar.exe wrapper
    ├── rom-versions.ts       ROM version metadata
    ├── state.ts              .extraction-state.json read/write
    ├── codegraph.ts          call-graph + xref index builder (cached next to the .sym)
    ├── xref.ts               query CLI (callers / callees / refs / reads / writes / addr / regex / grep)
    ├── closure.ts            subroutine closure extractor (routine + transitive callees, annotated)
    └── mem-symbols.ts        !RAM/!EXRAM define → address resolution for the xref index

    (scripts/ also holds the editor's level-data + static-render code — engine/,
    level.ts, strings.ts, etc. — which serve the editor, not this standalone
    framework build, and aren't covered here.)
```

## How the build works

1. **Extract** — reads the reference cart, runs asar against `yi/AsarScripts/AssetPointersAndFiles.asm` to get a per-version `(snes_start, snes_end, filename)` table, slices the bytes out of the cart, and writes per-asset `.bin` files into `assets/yi/`.

2. **Build** — runs the framework's multi-phase asar pipeline:
   - Phase 0: ROM header + vectors
   - Phase 5: SuperFX code → intermediate `.bin`
   - Phase 4: SPC700 engine + sample banks → intermediate `.bin`s
   - Phase 1: main SNES code (incbins the SuperFX/SPC700 blobs and the extracted asset `.bin`s)
   - Phase 3: header finalize

   The build emits the `.sfc` plus the `<stem>.sym` / `<stem>-superfx.sym` symbol maps the exploration tools consume. (`yi/Custom/Asar_Patches_YI.asm` is disabled for the byte-exact output.)

3. **Verify** — V1.0 output is MD5-byte-identical to the reference cart; treat any diff as a regression. (See the ROM-version table for V1.1's known benign diffs.)

## Documentation philosophy

Documentation lives **inline in the asm files**, not in a separate tree. Per-file headers describe what's in each file; per-routine block comments describe what each routine does; end-of-line comments annotate non-obvious instructions. Cross-references to other disassemblies and the YI wiki appear as `;` comments at the top of the relevant file. The cross-file `docs/` set above is reserved for knowledge that spans multiple banks.

`yi/Memory/SRAM_SpriteSlots.asm` is a useful entry point: all regular + ambient sprite-slot tables are documented per-byte (state-machine values, OAM flag layouts, hitbox/collision conventions, SuperFX morph values) — useful for understanding any sprite handler in `yi/Banks/`.

## Credits

- **Yoshifanatic** — SNES ROM Framework v1.4.0 + the YI disassembly. This project is built directly on his work.
- **Raidenthequick + brunovalads** — alternative V1.0 disassembly with descriptive labels (used as a Rosetta stone).
- **asar dev team** — asar 1.91.

Yoshi's Island and the original ROM contents are © Nintendo. This repo carries only Yoshifanatic's labeled disassembly source — no cart bytes, no extracted assets.
