# Shiny Egg

A Yoshi's Island (SNES) level editor.

Features:
- Full tile and sprite editing with copy/paste, undo, and multiselect
- Palette editing with live preview
- Level header editing with live preview
- World map editor
- Strings editor
- Memory management (migrate levels to free space)
- ASM and binary patches that are resistant to address drift
- Import an existing romhack
- Test framework that supports arbitrary spawn position for level testing
- Hopefully more to come...

This tool is still very much in alpha. There's still a lot of metadata work
to be done, but should be very usable despite that.

## Requirements

- A legally-owned Yoshi's Island ROM — **USA V1.0**.
- Windows (x64).
- [BizHawk](https://tasvideos.org/BizHawk) (EmuHawk) for testing levels in-game.

## Getting started

1. Download the latest installer from the
   [Releases](../../releases) page and run it.
2. On first launch, point the editor at your ROM to extract its data.
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
- **asar**, **BizHawk**, **Mesen**, and **Lunar Compress** - the assembler,
  emulators, and compression reference behind the build, testing, and graphics
  decoding.

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