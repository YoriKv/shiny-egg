# Shiny Egg

A Yoshi's Island (SNES) level editor.

Features:
- Full tile and sprite editing with copy/paste, undo, and multiselect
- Palette editing with live preview
- Graphics editing with edit as PNG and export to Aseprite file
- Level header editing with live preview
- World map editor
- Strings editor
- Memory management (migrate levels to free space)
- ASM and binary patches that are resistant to address drift
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
- Windows (x64) or Linux (x64, AppImage).
- [BizHawk](https://tasvideos.org/BizHawk) (EmuHawk) for testing levels in-game
  - on Linux, BizHawk's `EmuHawk.sh` launcher.

## Getting started

1. Download the latest build for your OS - the Windows installer (`.exe`) or the
   Linux `.AppImage` - from the [Releases](../../releases) page and run it.
2. On first launch, use the reference cart menu in the top right corner to
   point the editor at an unedited Yoshi's Island USA 1.0 ROM to extract the base
   assets. You will only have to do this once.
3. Pick a level to start editing.

## Thank You

Shiny Egg is my attempt to give back to a community that I've gotten so much joy
from over many years. It's also built on the work of many others and without that
work this tool couldn't exist. So thank you to these folks and many more.

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

## AI Use Disclaimer

- This tool was created almost entirely through the use of an AI agent. There's
  some text (mostly instructions) that is generated, but I tried to edit and
  proofreed all of the text personally. Besides that, all of the code and asm
  analysis was done by the agent.
- There are a lot of valid negative and complicated feelings about ai use.
  I share many of those negative and complicated feelings. That said, I don't think
  this tool would exist without it and I'm excited to be able to use these tools to
  give back to a community I've followed and watched for years.

## Legal Disclaimers

- The app icon was made with https://game-icons.net/
- Yoshi's Island is © Nintendo. This is an unofficial fan-made tool, not
  affiliated with or endorsed by Nintendo.
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
  sessions. It's a Windows .NET executable, shipped on both the Windows and Linux
  builds: run it natively on Windows, or via [Wine](https://www.winehq.org/) on
  Linux. M1TE2 is licensed under the MIT license; its license text ships with the
  install under `resources/snes-framework/m1te-licenses/`, and the upstream
  source is at https://github.com/nesdoug/M1TE2. It runs separately from the
  editor.