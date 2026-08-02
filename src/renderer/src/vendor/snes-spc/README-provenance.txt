snes_spc 0.9.x — Blargg's SNES SPC-700 APU emulator (© Shay Green, LGPL-2.1;
upstream http://www.slack.net/~ant/libs/audio.html).

OUR OWN WebAssembly build, compiled from the unmodified library sources at
../snes_spc (wasm/build.sh — Emscripten, MODULARIZE ES module, full public C
API exported incl. spc_mute_voices / spc_set_tempo / SPC_Filter):
  dist/snes_spc.mjs          Emscripten ES-module glue (build output)
  dist/snes_spc.d.mts        hand-maintained module types (from the wasm repo)
  dist/snes-spc-wasm-b64.ts  GENERATED base64 of dist/snes_spc.wasm (embedded
                             because fetch() cannot read file:// in the
                             packaged app; passed via the wasmBinary option)
  snes-spc.ts                first-party high-level wrapper (from the wasm repo)
  LICENSE                    LGPL-2.1 text

The Web Audio pump that drives it is first-party editor code
(src/renderer/src/audio/spc-audio.ts). The editor is GPL-3.0 with public source
(LGPL-2.1 section 3 permits the library's use in a GPL-3 work), so the
combination can be rebuilt with a modified library; attribution
lives in the top-level README's Legal Disclaimers.

To upgrade: re-run ../snes_spc/wasm/build.sh, re-copy dist/snes_spc.mjs +
.d.mts + snes-spc.ts, regenerate the b64 module (same JSON-string encoding),
run tmp/snes-spc-core-check.ts, and retest the Audio panel.
