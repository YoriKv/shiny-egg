The Super Mario World instrument samples, for the MML (AddmusicK-package)
import path. When an imported SMW port uses a stock instrument (@0-@18,
@21-@29) or an @N-derived custom row and the "Real SMW samples" import
option is on, the actual SMW sample is carried into the built song module
as a custom sample — AMK-exact timbre and tuning (the instrument rows are
AddmusicK's own InstrumentData.asm values, played verbatim). With the
option off (or a file missing), the import falls back to YI's resident
global-bank approximations / real YI drums / the ExtraSamples timbres.

Format: AddmusicK-style .brr (2-byte little-endian loop-offset header +
9-byte BRR blocks). File names are load-bearing: the SMW-sample-index →
file-name table lives in snes-framework/scripts/audio/mml-compile.ts
(SMW_SAMPLE_FILES), row-matched against this pack's own instrument rows.

Provenance: the community "Super Mario World Samples" pack (SMW Central),
a rip of every sample in Super Mario World; the pack's original readme
ships alongside ("Super Mario World Samples - Readme.txt"). Thunder.brr
is a sound-effect-only sample no stock instrument references.
