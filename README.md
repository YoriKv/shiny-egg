# Shiny Egg

A Yoshi's Island (SNES) level editor.

Features:
- Full tile and sprite editing with copy/paste, undo, and multiselect
- Palette editing with live preview
- Level header editing with live preview
- World map editor
- Strings editor
- Full graphics editing pipeline with export/import of PNG, Aesprite, M1TE, and YYCHR
- Full audio editing pipeline with export/import of AMK and AMY style MML files
- Memory management (migrate levels to free space)
- ASM and binary patches that are resistant to address drift and import existing patches
- Import an existing romhack
- Import levels from GBA
- Integrated help and documentation for every panel and tool as well as
  tooltips for various pieces of game data
- Test framework that supports arbitrary spawn position for level testing
- Hopefully more to come...

This tool is in alpha and a work in progress, but improving steadily. Check
the changelog for the latest updates.

## Requirements

- A legally-owned Yoshi's Island ROM - **USA V1.0**.
- Windows (x64), Linux (x64, AppImage), or macOS (universal - Apple Silicon + Intel).
- [BizHawk](https://tasvideos.org/BizHawk) or [Mesen](https://www.mesen.ca/) for testing levels in-game

## Getting started

1. Download the latest build for your OS - the Windows installer (`.exe`), the
   Linux `.AppImage`, or the macOS `.dmg` - from the [Releases](../../releases)
   page and run it.
2. On first launch, use the reference cart menu in the top right corner to
   point the editor at an unedited Yoshi's Island USA 1.0 ROM to extract the base
   assets. You will only have to do this once.
3. Pick a level to start editing.

A full **Getting Started** guide is available on the **[wiki](../../wiki)**.

### macOS

The macOS build is not signed - you'll see *"Shiny Egg is damaged and can't be
opened"* or *"cannot be opened because the developer cannot be verified"*.

**Drag the app to Applications, then clear the quarantine flag from Terminal:**

```
xattr -dr com.apple.quarantine "/Applications/Shiny Egg.app"
```

Make sure to include the `-r` (recursive) flag matters. The editor builds ROMs by
running a bundled `asar` assembler *inside* the app, and that nested tool is
quarantined too. The command above clears the whole bundle in one shot.

You only need to do this once per install.

## Thank You

Shiny Egg is my attempt to give back to a community that I've gotten so much joy
from over many years. It's also built on the work of many others and without that
work this tool couldn't exist. So thank you to these folks and many more.

- **Thoss** - the Shiny Egg Logo.
- **Yoshifanatic** - the SNES ROM Framework and YI disassembly this editor is
  built on.
- **Raidenthequick & brunovalads** - the YI disassembly and brunovalads' BizHawk
  debugging script.
- **Romi** - the GoldenEgg editor and the tile metadata therein.
- **SMW Central** - the Yoshi's Island offsets thread and community memory map.
- **The Yoshi's Island hacking wiki** - ROM, RAM, and Super FX maps plus sprite
  & level lists.
- **The Cutting Room Floor** - unused-content and debug documentation.
- **Blumiere (Count Bleck) & Yoshis Fan** - sprite-set compatibility lists.
- **[Advynia](https://github.com/KarisaAdvynia/Advynia)** (KarisaAdvynia) - the
  GBA Yoshi's Island editor whose pointer maps and conversion code make
  importing levels from the Game Boy Advance version possible.
- **asar**, **BizHawk**, **Mesen**, and **Lunar Compress** - the assembler,
  emulators, and compression reference behind the build, testing, and graphics
  decoding.
- **M1TE** - the SNES tile/map editor bundled with the app for editing exported
  BG-layer graphics sessions; a fork of
  **[M1TE2](https://github.com/nesdoug/M1TE2)** (Doug Fraker / nesdoug).
- **AddmusicK** (Kipernal and its community maintainers) - the MML song format
  for the music importer, and the documented instrument/percussion tables
  that make translating SMW ports to Yoshi's Island's sound driver possible.
- **AddMusicY** (Jimmy) - the MML importer dialect, documentation, song
  transcriptions used for references, and the included community sample library.

## AI Use Disclaimer

- This tool was created almost entirely through the use of an AI agent. There's
  some text (mostly instructions) that is generated, but I tried to edit and
  proofreed all of the text personally. Besides that, all of the code and asm
  analysis was done by the agent.
- There are a lot of valid negative and complicated feelings about ai use.
  I share many of those negative and complicated feelings. That said, I don't think
  this tool would exist without it and I'm excited to be able to use these tools to
  give back to a community I've followed and watched for years.

## License

Copyright (C) 2026 Yori Kvitchko.

Shiny Egg is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License, version 3, as published by the Free
Software Foundation.

Shiny Egg is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details. The
full text ships with every install (`resources/LICENSE`) and is at
<https://www.gnu.org/licenses/gpl-3.0.html>.

The editor is GPL-3.0 rather than a permissive license because it is built on,
and distributes, our fork of Yoshifanatic's SNES ROM Framework and Yoshi's
Island disassembly — itself GPL-3.0. That covers both the asm sources shipped
under `resources/snes-framework/` and the engine ported out of them into the
editor.

Complete corresponding source for any release — editor, framework fork, and the
scripts that build the installers — is at https://github.com/YoriKv/shiny-egg.

## Legal Disclaimers

- Yoshi's Island is © Nintendo. This is an unofficial fan-made tool, not
  affiliated with or endorsed by Nintendo.
- The asm sources, build pipeline, and rendering engine are our **modified fork
  of Yoshifanatic's SNES ROM Framework v1.4.0 + YI disassembly**, licensed under
  the GNU GPL v3.0 — which is why the editor as a whole is GPL-3.0 (see
  [License](#license)). Our modifications are recorded in
  `resources/snes-framework/NOTICE`, the license text in
  `resources/snes-framework/LICENSE`, and upstream is at
  https://github.com/Yoshifanatic1/SNES-ROM-Framework.
- No game ROM is included or distributed with this editor. You must supply your
  own legally-obtained copy.
- This editor bundles the **asar** assembler (© Alcaro and contributors) to
  build ROMs. Asar is licensed under the GNU LGPL v3.0; its full license text
  ships with the install under `resources/snes-framework/asar-licenses/`, and the
  upstream source is at https://github.com/RPGHacker/asar. Asar is run as a
  separate program (not linked into the editor) and can be replaced with your own
  copy of the binary.
- This editor also bundles **M1TE**, our fork of **M1TE2** (© 2020 Doug Fraker /
  nesdoug) — a SNES tile/map editor — for editing exported `.M1` graphics
  sessions. It's a Windows .NET executable, shipped on the Windows, Linux, and
  macOS builds: run it natively on Windows, or via [Wine](https://www.winehq.org/)
  on Linux/macOS. M1TE2 is licensed under the MIT license; its license text ships with the
  install under `resources/snes-framework/m1te-licenses/`, and the upstream
  source is at https://github.com/nesdoug/M1TE2. It runs separately from the
  editor.
- The Audio panel's in-editor playback uses **snes_spc** (Blargg's SNES
  SPC-700 APU emulator, © Shay Green), licensed under the GNU LGPL v2.1 and
  compiled to WebAssembly by us from its unmodified sources (build script in
  our snes_spc fork's `wasm/` directory). The wasm core ships embedded in the
  app bundle; its full license text and provenance/rebuild notes ship with
  the install under `resources/snes-spc-licenses/`. This editor is
  GPL-3.0-licensed with public source, so the combination can be rebuilt with a
  modified copy of the library. Upstream:
  http://www.slack.net/~ant/libs/audio.html.
- The warp exit / entrance marker icons are by **Delapouite**
  ([game-icons.net](https://game-icons.net)), recolored, under
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).