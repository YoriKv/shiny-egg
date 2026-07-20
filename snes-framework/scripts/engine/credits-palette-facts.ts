// credits-palette-facts.ts — the credits screens' live CGRAM, captured from a
// Mesen run of the built V1.0 ROM (2026-07-19, tmp/mesen-cgram-trace.mjs: boot →
// force gm $1B → snapshot through the gm$1C/gm$1D roll; stable from the first
// staff page on). The credits assemble this palette at RUNTIME (no scene palette
// program — doc 08 §9), so a live capture is the only faithful source.
//
// Tilemap-word histogram at capture time (BG2 map @ word $5C00):
//   chars $40-$7F (the lz16 $B3 sheet's staff-LETTERING half) → row 5 (180), row 6 (80)
//   chars $80-$BF (the art/vignette half)                     → row 6 (500), row 4 (264)
// Data: 512-byte CGRAM, BGR-15 LE, bit 15 masked on use. Display-only facts.

const HEX = '40180000a02cff7f1a5bb74e333ed0314c21c810ff7f78776d66c7492431a11c267f00002535797794523146ad354a29c61842087777f06ee55d4041a0282014267f0000ab3df36e0e4aab3d272dc42040100000ef6e68666055c0382020000c267f000031466d6688412535a1244018000800006766e05de04c403000180004267fff7fff67df4bc07da05c6040402c40204018ff7f78776d66c7492431a11c267f00009c56f12806009f5bf62d4d00df6f267f7777f06ee55d4041a0282014267f00009f67511dd96f4421267f267f267f267fef6e68666055c0382020000cff03000042088410c61808216b2dad35ef3d31466766e05de04c403000180004267f0000a02cff7f93633157ae4a2b3aa82d251d765e145291450e358b280818267f0000253579770d5bab4e2842a5312225a014f0558e490b3d882c05200210267f0000ab3df36e87522546a2392029a01c200c6a4d08418534022400180008267f000031466d66014aa03d2031a02020140004e4448238002c001c00100000267f000042088410c61808216b2dad35ef3d3146734ed65a18635a6b9c73ff7f267f00000000000000084010a31ce524272d6935ab3d0e4a5052925ad462376fff03de7b0000de7b0000267f267f267f267f267f267f267f267f267f267f267fff030000de7bde7b0000267f267f267f267f267f267f267f267f267f267f267f';

/** The credits screens' captured CGRAM (512 B). */
export const CREDITS_CGRAM: Uint8Array = Uint8Array.from(
  { length: HEX.length / 2 },
  (_, i) => parseInt(HEX.slice(i * 2, i * 2 + 2), 16)
);

/** Dominant palette row of the staff-lettering chars (lz16 $B3, chars $40-$7F). */
export const CREDITS_TEXT_ROW = 5;
/** Dominant palette row of the credits art / phase-swap chars. */
export const CREDITS_ART_ROW = 6;
