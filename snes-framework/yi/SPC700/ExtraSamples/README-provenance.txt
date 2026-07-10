Extra instrument samples for the MML (AddmusicK-package) import path —
timbres Yoshi's Island's own banks lack. When an imported SMW port uses a
stock instrument these cover (flute → PanFlute.brr, trumpet/brass →
Brass.brr), the sample is carried into the built song module as a custom
sample; otherwise the import approximates with YI's resident global-bank
instruments (see snes-framework/scripts/audio/mml-compile.ts,
PACKAGED_SAMPLE_OVERRIDES).

Format: AddmusicK-style .brr (2-byte little-endian loop-offset header +
9-byte BRR blocks). Canonical tunings live next to the override table in
mml-compile.ts (sourced from the AddMusicY beta's SM3DW example rows:
Brass %pitch(1200), Pan Flute %pitch(1700)).

Provenance: the AddMusicY beta distribution's community sample library
(samples/local/), by Jimmy — the standard porting-scene sample set. The
original recordings' source is undocumented there; these are the same
files the YI music-porting community has circulated with AMY.
