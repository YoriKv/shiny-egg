;#############################################################################################################
;# Bank57.asm -- banks $57-$5F, the SuperFX HiROM-mirrored asset region.
;#
;# Despite the name, this single asar macro emits ~9 full SNES banks of content. The SuperFX co-processor
;# accesses ROM via a HiROM-style mapping (banks $40-$5F each expose a contiguous 64 KB), and this region
;# is where YI parks every asset the SuperFX needs to read directly: the SuperFX program itself, then
;# hundreds of compressed graphic blobs (LZ2 + LZ16; LC_LZ2 + LC_LZ16, see Bank08.asm:CODE_lz2_decompress
;# and Bank0A.asm:CODE_lz16_decompress), tilemaps, palettes, and a few hand-curated tables.
;#
;# Why this is one big macro (not 9 BankXX.asm files):
;#   * `%EnableSuperFXHiROMMirroring(<StartBank>)` flips the bank-mapping mode so that the contained data
;#     spans a continuous PC range, not the standard LoROM 32 KB-per-bank layout.
;#   * `check bankcross off` is required because individual incbin blobs routinely span bank boundaries
;#     in the HiROM mapping. The matching `check bankcross on` (line ~1364 in source order) re-enables
;#     the safety check just for the tail-end title-screen / palette tables, which are bank-aligned.
;#
;# Alternative SNES addressing for the same cart bytes (READ THIS BEFORE FOLLOWING AN EXTERNAL REFERENCE):
;#   Every byte emitted by this macro is reachable from the 65816 via TWO valid SNES addresses,
;#   because the SuperFX HiROM region ($40-$5F) and the LoROM region ($00-$3F) are alternate
;#   addressing schemes for the SAME 2 MB of cart bytes:
;#       SuperFX $5F:0000-$7FFF  ==  LoROM $3E:8000-$FFFF   (PC $1F0000-$1F7FFF)
;#       SuperFX $5F:8000-$FFFF  ==  LoROM $3F:8000-$FFFF   (PC $1F8000-$1FFFFF)
;#       ... and analogously for $5E-$57 vs $3D-$36.
;#   So a label here named `DATA_master_palette_rom_blob` IS THE SAME BYTE as a hypothetical `DATA_3FA000`.
;#   External references that use LoROM addressing (SMW Central's memory map, parts of the
;#   yoshisisland-disassembly wiki) will cite `$3F:xxxx` / `$3E:xxxx` / etc. -- the source for
;#   those bytes lives HERE, just under the SuperFX-side label. The framework chose SuperFX
;#   addressing for source-organization because the SuperFX program itself addresses this region
;#   that way (and so do all the per-blob pointer tables it consumes).
;#
;# Contents at a glance (in source order; SNES banks given for orientation):
;#   $57:0000        SuperFXCode_YI.bin                    -- the entire SuperFX program (`%InsertNextPreCompiledCodeBlock`)
;#   $57:3C00 ..     115 LZ2 graphics blobs                -- (incbin "Graphics/GFX_57xxxx.lz2" etc.)
;#                   spanning $57-$5A roughly              -- standard-format compressed CHR
;#   $5B-$5C ..      150 LZ2 tilemap blobs                 -- (incbin "Tilemaps/DATA_5BxxxxL.lz2" etc.)
;#                                                           BG tilemaps used by the SuperFX renderer
;#   $5D-$5F ..      187 LZ16 graphics blobs               -- (incbin "Graphics/GFX_xxxxxx.lz16")
;#                                                           the bit-15-flagged "second" compression format
;#                                                           (Lunar Compress LC_LZ16)
;#   $5F:9380        Title-screen tilemap                  -- DATA_5F9380 (uncompressed `dw` block; already annotated)
;#   $5F:DA80        Hookbill the Koopa shell palette      -- DATA_5FDA80 (15-color BGR-15 palette; already annotated)
;#   $5F:DA9E..      more uncompressed palette / mode-7    -- many small `dw` blocks (palettes, fade ramps, anim frames)
;#                   support tables                           interleaved through the rest of bank $5F
;#   $5F:FCE4+       garbage data (V1.1) or freespace pad (V1.0)
;#
;# Asset-type tally (from grep at port time, may shift if assets are re-extracted):
;#   - 1   precompiled code block (`SuperFXCode_YI.bin`)
;#   - 302 Graphics/ entries: 115 `.lz2` + 187 `.lz16`
;#   - 150 Tilemaps/ entries (all `.lz2`)
;#   - 0   LevelData / GarbageData / SPC700 entries (those live elsewhere)
;#
;# Cross-references:
;#   docs/mchip.md S4                         -- the 65816 <-> SuperFX bridge and bank-mapping math
;#       (banks $40-$5F = full 64 KB per bank; $C0-$DF are HiROM mirrors; $57-$5F live together
;#       because all SuperFX-mapped banks share the same %EnableSuperFXHiROMMirroring scheme).
;#   docs/mchip.md S3.2                       -- the two LZ formats (lz2 / lz16) and how the
;#       decompressor selects between them.
;#   Raidenthequick bank2F.asm                -- HiROM-mirror counterpart in their layout (different
;#                                               address arithmetic, but same underlying data).
;#   Yoshifanatic v1.4 framework              -- defines %EnableSuperFXHiROMMirroring and the
;#                                               associated bank-mapping macros.
;#############################################################################################################
macro YIBank57Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
check bankcross off

; ---- SuperFX program code (compiled blob loaded at $57:0000). -----------
; Emitted via the framework's pre-compiled-code-block macro; the actual GSU
; opcodes live in SuperFX/SuperFXCode_YI.bin. Everything in the rest of
; this file is read-only DATA that the SuperFX accesses via its HiROM port.
	%InsertNextPreCompiledCodeBlock($570000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")

; ---- Compressed graphics blobs (Lunar Compress LC_LZ2 -- see
; ---- Bank08.asm:CODE_lz2_decompress). ----------------------------------------
; ~115 blobs through approximately the $57-$5A range. Each `DATA_xxxxxx`
; label is the SNES address of the start of that compressed blob; the
; SuperFX engine seeks to these addresses (via the COMPRESSED_TABLE pointer
; arrays in Bank $03) to stream tiles into VRAM.
DATA_573C00:
	incbin "Graphics/GFX_573C00.lz2"

DATA_5748E9:
	incbin "Graphics/GFX_5748E9.lz2"

DATA_57555B:
	incbin "Graphics/GFX_57555B.lz2"

DATA_576234:
	incbin "Graphics/GFX_576234.lz2"

DATA_576EAB:
	incbin "Graphics/GFX_576EAB.lz2"

DATA_5778F9:
	incbin "Graphics/GFX_5778F9.lz2"

DATA_57826C:
	incbin "Graphics/GFX_57826C.lz2"

DATA_578DB8:
	incbin "Graphics/GFX_578DB8.lz2"

DATA_579952:
	incbin "Graphics/GFX_579952.lz2"

DATA_57A56A:
	incbin "Graphics/GFX_57A56A.lz2"

DATA_57AECB:
	incbin "Graphics/GFX_57AECB.lz2"

DATA_57B9B0:
	incbin "Graphics/GFX_57B9B0.lz2"

DATA_57C271:
	incbin "Graphics/GFX_57C271.lz2"

DATA_57CEA1:
	incbin "Graphics/GFX_57CEA1.lz2"

DATA_57DBBA:
	incbin "Graphics/GFX_57DBBA.lz2"

DATA_57E85A:
	incbin "Graphics/GFX_57E85A.lz2"

DATA_57F3C7:
	incbin "Graphics/GFX_57F3C7.lz2"

DATA_57F85E:
	incbin "Graphics/GFX_57F85E.lz2"

DATA_57FDEA:
	incbin "Graphics/GFX_57FDEA.lz2"

DATA_58025D:
	incbin "Graphics/GFX_58025D.lz2"

DATA_5803E1:
	incbin "Graphics/GFX_5803E1.lz2"

DATA_5808D6:
	incbin "Graphics/GFX_5808D6.lz2"

DATA_580C65:
	incbin "Graphics/GFX_580C65.lz2"

DATA_580FCD:
	incbin "Graphics/GFX_580FCD.lz2"

DATA_5814E1:
	incbin "Graphics/GFX_5814E1.lz2"

DATA_581B2C:
	incbin "Graphics/GFX_581B2C.lz2"

DATA_581FDA:
	incbin "Graphics/GFX_581FDA.lz2"

DATA_5822D0:
	incbin "Graphics/GFX_5822D0.lz2"

DATA_58285E:
	incbin "Graphics/GFX_58285E.lz2"

DATA_582FC1:
	incbin "Graphics/GFX_582FC1.lz2"

DATA_5835E2:
	incbin "Graphics/GFX_5835E2.lz2"

DATA_583C34:
	incbin "Graphics/GFX_583C34.lz2"

DATA_584016:
	incbin "Graphics/GFX_584016.lz2"

DATA_58451B:
	incbin "Graphics/GFX_58451B.lz2"

DATA_584A74:
	incbin "Graphics/GFX_584A74.lz2"

DATA_584FBF:
	incbin "Graphics/GFX_584FBF.lz2"

DATA_585A68:
	incbin "Graphics/GFX_585A68.lz2"

DATA_586597:
	incbin "Graphics/GFX_586597.lz2"

DATA_58720F:
	incbin "Graphics/GFX_58720F.lz2"

DATA_587E21:
	incbin "Graphics/GFX_587E21.lz2"

DATA_5883AF:
	incbin "Graphics/GFX_5883AF.lz2"

DATA_5888CD:
	incbin "Graphics/GFX_5888CD.lz2"

DATA_588E8F:
	incbin "Graphics/GFX_588E8F.lz2"

DATA_589574:
	incbin "Graphics/GFX_589574.lz2"

;-------------------------------------------------------------------------
; Orphaned LZ16 graphics (gfx file IDs $2C-$2F) -- NOT LZ2, despite the .lz2
; filenames and their slots in DATA_lz2_compressed_gfx_ptrs (Bank06). These
; four blobs are LZ16-compressed (Lunar Compress FORMAT=15, 8 tile-rows ->
; 4 KB / 128 4bpp tiles each); decoding them as LZ2 overruns past the blob
; with no terminator. They are UNREFERENCED: no loader path ever resolves to
; LZ2 file ID $2C-$2F -- the live $2C-$2F graphics are sprites, loaded via
; DATA_lz16_compressed_gfx_ptrs from different addresses. Decoded content is a
; 2-color diagonal diamond/lattice mesh (a stipple / translucency texture);
; $2C/$2D and $2E/$2F are near-duplicate color-polarity pairs. Left in the
; ROM but never decompressed by any code path. (Bytes are reproduced verbatim
; for MD5-exactness; this note documents the orphan, it does not change data.)
;-------------------------------------------------------------------------
DATA_589AE6:
	incbin "Graphics/GFX_589AE6.lz2"

DATA_589D4F:
	incbin "Graphics/GFX_589D4F.lz2"

DATA_589FC4:
	incbin "Graphics/GFX_589FC4.lz2"

DATA_58A2CD:
	incbin "Graphics/GFX_58A2CD.lz2"

DATA_58A5D2:
	incbin "Graphics/GFX_58A5D2.lz2"

DATA_58B241:
	incbin "Graphics/GFX_58B241.lz2"

DATA_58BE20:
	incbin "Graphics/GFX_58BE20.lz2"

DATA_58C992:
	incbin "Graphics/GFX_58C992.lz2"

DATA_58D774:
	incbin "Graphics/GFX_58D774.lz2"

DATA_58E471:
	incbin "Graphics/GFX_58E471.lz2"

DATA_58EE33:
	incbin "Graphics/GFX_58EE33.lz2"

DATA_58F928:
	incbin "Graphics/GFX_58F928.lz2"

DATA_5902AB:
	incbin "Graphics/GFX_5902AB.lz2"

DATA_590E7D:
	incbin "Graphics/GFX_590E7D.lz2"

DATA_591A64:
	incbin "Graphics/GFX_591A64.lz2"

DATA_592757:
	incbin "Graphics/GFX_592757.lz2"

DATA_593432:
	incbin "Graphics/GFX_593432.lz2"

DATA_5941AC:
	incbin "Graphics/GFX_5941AC.lz2"

DATA_594E69:
	incbin "Graphics/GFX_594E69.lz2"

DATA_595892:
	incbin "Graphics/GFX_595892.lz2"

DATA_5964EC:
	incbin "Graphics/GFX_5964EC.lz2"

DATA_597241:
	incbin "Graphics/GFX_597241.lz2"

DATA_597F14:
	incbin "Graphics/GFX_597F14.lz2"

DATA_598ABB:
	incbin "Graphics/GFX_598ABB.lz2"

DATA_5996AF:
	incbin "Graphics/GFX_5996AF.lz2"

DATA_599C37:
	incbin "Graphics/GFX_599C37.lz2"

DATA_59A7C1:
	incbin "Graphics/GFX_59A7C1.lz2"

DATA_59B3E4:
	incbin "Graphics/GFX_59B3E4.lz2"

DATA_59C08B:
	incbin "Graphics/GFX_59C08B.lz2"

DATA_59CD17:
	incbin "Graphics/GFX_59CD17.lz2"

DATA_59D92C:
	incbin "Graphics/GFX_59D92C.lz2"

DATA_59ED9E:
	incbin "Graphics/GFX_59ED9E.lz2"

DATA_5A05C4:
	incbin "Graphics/GFX_5A05C4.lz2"

DATA_5A1135:
	incbin "Graphics/GFX_5A1135.lz2"

DATA_5A17A3:
	incbin "Graphics/GFX_5A17A3.lz2"

DATA_5A1CED:
	incbin "Graphics/GFX_5A1CED.lz2"

DATA_5A235C:
	incbin "Graphics/GFX_5A235C.lz2"

DATA_5A28D6:
	incbin "Graphics/GFX_5A28D6.lz2"

DATA_5A2EE2:
	incbin "Graphics/GFX_5A2EE2.lz2"

DATA_5A3453:
	incbin "Graphics/GFX_5A3453.lz2"

DATA_5A3944:
	incbin "Graphics/GFX_5A3944.lz2"

DATA_5A4110:
	incbin "Graphics/GFX_5A4110.lz2"

DATA_5A4608:
	incbin "Graphics/GFX_5A4608.lz2"

DATA_5A4C5F:
	incbin "Graphics/GFX_5A4C5F.lz2"

DATA_5A53A6:
	incbin "Graphics/GFX_5A53A6.lz2"

DATA_5A5905:
	incbin "Graphics/GFX_5A5905.lz2"

DATA_5A5E25:
	incbin "Graphics/GFX_5A5E25.lz2"

DATA_5A64A1:
	incbin "Graphics/GFX_5A64A1.lz2"

DATA_5A6952:
	incbin "Graphics/GFX_5A6952.lz2"

DATA_5A6DE8:
	incbin "Graphics/GFX_5A6DE8.lz2"

DATA_5A736D:
	incbin "Graphics/GFX_5A736D.lz2"

DATA_5A7994:
	incbin "Graphics/GFX_5A7994.lz2"

DATA_5A8748:
	incbin "Graphics/GFX_5A8748.lz2"

DATA_5A9257:
	incbin "Graphics/GFX_5A9257.lz2"

DATA_5A97E0:
	incbin "Graphics/GFX_5A97E0.lz2"

DATA_5A9C3D:
	incbin "Graphics/GFX_5A9C3D.lz2"

DATA_5AA0EF:
	incbin "Graphics/GFX_5AA0EF.lz2"

DATA_5AA75A:
	incbin "Graphics/GFX_5AA75A.lz2"

DATA_5AAD40:
	incbin "Graphics/GFX_5AAD40.lz2"

DATA_5AB189:
	incbin "Graphics/GFX_5AB189.lz2"

DATA_5AB630:
	incbin "Graphics/GFX_5AB630.lz2"

DATA_5ABC4D:
	incbin "Graphics/GFX_5ABC4D.lz2"

DATA_5ACAD1:
	incbin "Graphics/GFX_5ACAD1.lz2"

DATA_5AD992:
	incbin "Graphics/GFX_5AD992.lz2"

DATA_5AE7A0:
	incbin "Graphics/GFX_5AE7A0.lz2"

DATA_5AF2D5:
	incbin "Graphics/GFX_5AF2D5.lz2"

DATA_5AFE28:
	incbin "Graphics/GFX_5AFE28.lz2"

DATA_5B03C0:
	incbin "Graphics/GFX_5B03C0.lz2"

DATA_5B08CC:
	incbin "Graphics/GFX_5B08CC.lz2"

DATA_5B0C94:
	incbin "Graphics/GFX_5B0C94.lz2"

DATA_5B121D:
	incbin "Graphics/GFX_5B121D.lz2"

; ---- Compressed BG tilemaps (.lz2) -- LC_LZ2 format, same decompressor as
; ---- the Graphics/ section above; semantic difference is they decode into
; ---- BG tilemap RAM, not CHR/VRAM.
DATA_5B17A1:
	incbin "Tilemaps/DATA_5B17A1.lz2"

DATA_5B1A25:
	incbin "Tilemaps/DATA_5B1A25.lz2"

DATA_5B1CC2:
	incbin "Tilemaps/DATA_5B1CC2.lz2"

DATA_5B2058:
	incbin "Tilemaps/DATA_5B2058.lz2"

DATA_5B2323:
	incbin "Tilemaps/DATA_5B2323.lz2"

DATA_5B25DB:
	incbin "Tilemaps/DATA_5B25DB.lz2"

DATA_5B278F:
	incbin "Tilemaps/DATA_5B278F.lz2"

DATA_5B28B2:
	incbin "Tilemaps/DATA_5B28B2.lz2"

DATA_5B2A43:
	incbin "Tilemaps/DATA_5B2A43.lz2"

DATA_5B2BAB:
	incbin "Tilemaps/DATA_5B2BAB.lz2"

DATA_5B2EA9:
	incbin "Tilemaps/DATA_5B2EA9.lz2"

DATA_5B32B7:
	incbin "Tilemaps/DATA_5B32B7.lz2"

DATA_5B35C3:
	incbin "Tilemaps/DATA_5B35C3.lz2"

DATA_5B3942:
	incbin "Tilemaps/DATA_5B3942.lz2"

DATA_5B3C69:
	incbin "Tilemaps/DATA_5B3C69.lz2"

DATA_5B40C4:
	incbin "Tilemaps/DATA_5B40C4.lz2"

DATA_5B457B:
	incbin "Tilemaps/DATA_5B457B.lz2"

DATA_5B4937:
	incbin "Tilemaps/DATA_5B4937.lz2"

DATA_5B4D88:
	incbin "Tilemaps/DATA_5B4D88.lz2"

DATA_5B51E9:
	incbin "Tilemaps/DATA_5B51E9.lz2"

DATA_5B561D:
	incbin "Tilemaps/DATA_5B561D.lz2"

DATA_5B5A43:
	incbin "Tilemaps/DATA_5B5A43.lz2"

DATA_5B5DE5:
	incbin "Tilemaps/DATA_5B5DE5.lz2"

DATA_5B6042:
	incbin "Tilemaps/DATA_5B6042.lz2"

DATA_5B6270:
	incbin "Tilemaps/DATA_5B6270.lz2"

DATA_5B6446:
	incbin "Tilemaps/DATA_5B6446.lz2"

DATA_5B6718:
	incbin "Tilemaps/DATA_5B6718.lz2"

DATA_5B69A5:
	incbin "Tilemaps/DATA_5B69A5.lz2"

DATA_5B6C06:
	incbin "Tilemaps/DATA_5B6C06.lz2"

DATA_5B6DDC:
	incbin "Tilemaps/DATA_5B6DDC.lz2"

DATA_5B70B5:
	incbin "Tilemaps/DATA_5B70B5.lz2"

DATA_5B7361:
	incbin "Tilemaps/DATA_5B7361.lz2"

DATA_5B75AB:
	incbin "Tilemaps/DATA_5B75AB.lz2"

DATA_5B77F0:
	incbin "Tilemaps/DATA_5B77F0.lz2"

DATA_5B7AA3:
	incbin "Tilemaps/DATA_5B7AA3.lz2"

DATA_5B7B89:
	incbin "Tilemaps/DATA_5B7B89.lz2"

DATA_5B7D18:
	incbin "Tilemaps/DATA_5B7D18.lz2"

DATA_5B7EBC:
	incbin "Tilemaps/DATA_5B7EBC.lz2"

DATA_5B8070:
	incbin "Tilemaps/DATA_5B8070.lz2"

DATA_5B83C7:
	incbin "Tilemaps/DATA_5B83C7.lz2"

DATA_5B85A0:
	incbin "Tilemaps/DATA_5B85A0.lz2"

DATA_5B8C16:
	incbin "Tilemaps/DATA_5B8C16.lz2"

DATA_5B8CE5:
	incbin "Tilemaps/DATA_5B8CE5.lz2"

DATA_5B8D8F:
	incbin "Tilemaps/DATA_5B8D8F.lz2"

DATA_5B8E39:
	incbin "Tilemaps/DATA_5B8E39.lz2"

DATA_5B8F62:
	incbin "Tilemaps/DATA_5B8F62.lz2"

DATA_5B9179:
	incbin "Tilemaps/DATA_5B9179.lz2"

DATA_5B92A1:
	incbin "Tilemaps/DATA_5B92A1.lz2"

DATA_5B92AD:
	incbin "Tilemaps/DATA_5B92AD.lz2"

DATA_5B93BC:
	incbin "Tilemaps/DATA_5B93BC.lz2"

DATA_5B93C8:
	incbin "Tilemaps/DATA_5B93C8.lz2"

DATA_5B94C1:
	incbin "Tilemaps/DATA_5B94C1.lz2"

DATA_5B9588:
	incbin "Tilemaps/DATA_5B9588.lz2"

DATA_5B9669:
	incbin "Tilemaps/DATA_5B9669.lz2"

DATA_5B9A2E:
	incbin "Tilemaps/DATA_5B9A2E.lz2"

DATA_5B9BF5:
	incbin "Tilemaps/DATA_5B9BF5.lz2"

DATA_5B9F48:
	incbin "Tilemaps/DATA_5B9F48.lz2"

DATA_5BA1BE:
	incbin "Tilemaps/DATA_5BA1BE.lz2"

DATA_5BA405:
	incbin "Tilemaps/DATA_5BA405.lz2"

DATA_5BA6A5:
	incbin "Tilemaps/DATA_5BA6A5.lz2"

DATA_5BA99E:
	incbin "Tilemaps/DATA_5BA99E.lz2"

DATA_5BAD4E:
	incbin "Tilemaps/DATA_5BAD4E.lz2"

DATA_5BAE23:
	incbin "Tilemaps/DATA_5BAE23.lz2"

DATA_5BBAC5:
	incbin "Tilemaps/DATA_5BBAC5.lz2"

DATA_5BBE47:
	incbin "Tilemaps/DATA_5BBE47.lz2"

DATA_5BC472:
	incbin "Tilemaps/DATA_5BC472.lz2"

DATA_5BCB3F:
	incbin "Tilemaps/DATA_5BCB3F.lz2"

DATA_5BD161:
	incbin "Tilemaps/DATA_5BD161.lz2"

DATA_5BD781:
	incbin "Tilemaps/DATA_5BD781.lz2"

DATA_5BDC95:
	incbin "Tilemaps/DATA_5BDC95.lz2"

DATA_5BE14B:
	incbin "Tilemaps/DATA_5BE14B.lz2"

DATA_5BE7E6:
	incbin "Tilemaps/DATA_5BE7E6.lz2"

DATA_5BEDDD:
	incbin "Tilemaps/DATA_5BEDDD.lz2"

DATA_5BF3C3:
	incbin "Tilemaps/DATA_5BF3C3.lz2"

DATA_5BF986:
	incbin "Tilemaps/DATA_5BF986.lz2"

DATA_5BFCA8:
	incbin "Tilemaps/DATA_5BFCA8.lz2"

DATA_5C0892:
	incbin "Tilemaps/DATA_5C0892.lz2"

DATA_5C0BEA:
	incbin "Tilemaps/DATA_5C0BEA.lz2"

DATA_5C12CD:
	incbin "Tilemaps/DATA_5C12CD.lz2"

DATA_5C145A:
	incbin "Tilemaps/DATA_5C145A.lz2"

DATA_5C1996:
	incbin "Tilemaps/DATA_5C1996.lz2"

DATA_5C1BFA:
	incbin "Tilemaps/DATA_5C1BFA.lz2"

DATA_5C1DA2:
	incbin "Tilemaps/DATA_5C1DA2.lz2"

DATA_5C1ED3:
	incbin "Tilemaps/DATA_5C1ED3.lz2"

DATA_5C24BA:
	incbin "Tilemaps/DATA_5C24BA.lz2"

DATA_5C2658:
	incbin "Tilemaps/DATA_5C2658.lz2"

DATA_5C28B0:
	incbin "Tilemaps/DATA_5C28B0.lz2"

DATA_5C2A9D:
	incbin "Tilemaps/DATA_5C2A9D.lz2"

DATA_5C340D:
	incbin "Tilemaps/DATA_5C340D.lz2"

DATA_5C3545:
	incbin "Tilemaps/DATA_5C3545.lz2"

DATA_5C3A30:
	incbin "Tilemaps/DATA_5C3A30.lz2"

DATA_5C3D29:
	incbin "Tilemaps/DATA_5C3D29.lz2"

DATA_5C3EDA:
	incbin "Tilemaps/DATA_5C3EDA.lz2"

DATA_5C437B:
	incbin "Tilemaps/DATA_5C437B.lz2"

DATA_5C4711:
	incbin "Tilemaps/DATA_5C4711.lz2"

DATA_5C490A:
	incbin "Tilemaps/DATA_5C490A.lz2"

DATA_5C50AB:
	incbin "Tilemaps/DATA_5C50AB.lz2"

DATA_5C532C:
	incbin "Tilemaps/DATA_5C532C.lz2"

DATA_5C5727:
	incbin "Tilemaps/DATA_5C5727.lz2"

DATA_5C573B:
	incbin "Tilemaps/DATA_5C573B.lz2"

DATA_5C5839:
	incbin "Tilemaps/DATA_5C5839.lz2"

DATA_5C5CA3:
	incbin "Tilemaps/DATA_5C5CA3.lz2"

DATA_5C5D18:
	incbin "Tilemaps/DATA_5C5D18.lz2"

DATA_5C6148:
	incbin "Tilemaps/DATA_5C6148.lz2"

DATA_5C63B8:
	incbin "Tilemaps/DATA_5C63B8.lz2"

DATA_5C654D:
	incbin "Tilemaps/DATA_5C654D.lz2"

DATA_5C6564:
	incbin "Tilemaps/DATA_5C6564.lz2"

DATA_5C6790:
	incbin "Tilemaps/DATA_5C6790.lz2"

DATA_5C69A5:
	incbin "Tilemaps/DATA_5C69A5.lz2"

DATA_5C6C1C:
	incbin "Tilemaps/DATA_5C6C1C.lz2"

DATA_5C6E1A:
	incbin "Tilemaps/DATA_5C6E1A.lz2"

DATA_5C6E26:
	incbin "Tilemaps/DATA_5C6E26.lz2"

DATA_5C6E32:
	incbin "Tilemaps/DATA_5C6E32.lz2"

DATA_5C6E3E:
	incbin "Tilemaps/DATA_5C6E3E.lz2"

DATA_5C7083:
	incbin "Tilemaps/DATA_5C7083.lz2"

DATA_5C7170:
	incbin "Tilemaps/DATA_5C7170.lz2"

DATA_5C7532:
	incbin "Tilemaps/DATA_5C7532.lz2"

DATA_5C7782:
	incbin "Tilemaps/DATA_5C7782.lz2"

DATA_5C7A54:
	incbin "Tilemaps/DATA_5C7A54.lz2"

DATA_5C7C40:
	incbin "Tilemaps/DATA_5C7C40.lz2"

DATA_5C7D9D:
	incbin "Tilemaps/DATA_5C7D9D.lz2"

DATA_5C7FD3:
	incbin "Tilemaps/DATA_5C7FD3.lz2"

DATA_5C84DD:
	incbin "Tilemaps/DATA_5C84DD.lz2"

DATA_5C84EE:
	incbin "Tilemaps/DATA_5C84EE.lz2"

DATA_5C8653:
	incbin "Tilemaps/DATA_5C8653.lz2"

DATA_5C86E9:
	incbin "Tilemaps/DATA_5C86E9.lz2"

DATA_5C8892:
	incbin "Tilemaps/DATA_5C8892.lz2"

DATA_5C8A60:
	incbin "Tilemaps/DATA_5C8A60.lz2"

DATA_5C8DA4:
	incbin "Tilemaps/DATA_5C8DA4.lz2"

DATA_5C8DC6:
	incbin "Tilemaps/DATA_5C8DC6.lz2"

DATA_5C8EF6:
	incbin "Tilemaps/DATA_5C8EF6.lz2"

DATA_5C9024:
	incbin "Tilemaps/DATA_5C9024.lz2"

DATA_5C90C8:
	incbin "Tilemaps/DATA_5C90C8.lz2"

DATA_5C9456:
	incbin "Tilemaps/DATA_5C9456.lz2"

DATA_5C94CD:
	incbin "Tilemaps/DATA_5C94CD.lz2"

DATA_5C97A4:
	incbin "Tilemaps/DATA_5C97A4.lz2"

DATA_5C981D:
	incbin "Tilemaps/DATA_5C981D.lz2"

DATA_5C98D3:
	incbin "Tilemaps/DATA_5C98D3.lz2"

DATA_5C9AC1:
	incbin "Tilemaps/DATA_5C9AC1.lz2"

DATA_5C9D51:
	incbin "Tilemaps/DATA_5C9D51.lz2"

DATA_5CA15C:
	incbin "Tilemaps/DATA_5CA15C.lz2"

DATA_5CA51B:
	incbin "Tilemaps/DATA_5CA51B.lz2"

DATA_5CA62A:
	incbin "Tilemaps/DATA_5CA62A.lz2"

DATA_5CA824:
	incbin "Tilemaps/DATA_5CA824.lz2"

DATA_5CACB2:
	incbin "Tilemaps/DATA_5CACB2.lz2"

DATA_5CAF37:
	incbin "Tilemaps/DATA_5CAF37.lz2"

DATA_5CB2B0:
	incbin "Tilemaps/DATA_5CB2B0.lz2"

DATA_5CB518:
	incbin "Tilemaps/DATA_5CB518.lz2"

DATA_5CB71B:
	incbin "Tilemaps/DATA_5CB71B.lz2"

DATA_5CB929:
	incbin "Tilemaps/DATA_5CB929.lz2"

; ---- Compressed graphics blobs (.lz16 -- Lunar Compress LC_LZ16 format). --
; ---- LZ16 is the "second" format YI uses, selected when bit 15 of the VRAM
; ---- destination is set (see LoadGraphics dispatcher). Different bit-stream
; ---- layout than .lz2; shares the same blob/seek convention.
DATA_5CBA89:
	incbin "Graphics/GFX_5CBA89.lz16"

DATA_5CC342:
	incbin "Graphics/GFX_5CC342.lz16"

DATA_5CCB44:
	incbin "Graphics/GFX_5CCB44.lz16"

DATA_5CD671:
	incbin "Graphics/GFX_5CD671.lz16"

DATA_5CDFC6:
	incbin "Graphics/GFX_5CDFC6.lz16"

DATA_5CE630:
	incbin "Graphics/GFX_5CE630.lz16"

DATA_5CEEE1:
	incbin "Graphics/GFX_5CEEE1.lz16"

DATA_5CF376:
	incbin "Graphics/GFX_5CF376.lz16"

DATA_5CF91E:
	incbin "Graphics/GFX_5CF91E.lz16"

DATA_5CFF0B:
	incbin "Graphics/GFX_5CFF0B.lz16"

DATA_5D04ED:
	incbin "Graphics/GFX_5D04ED.lz16"

DATA_5D0FEB:
	incbin "Graphics/GFX_5D0FEB.lz16"

DATA_5D180F:
	incbin "Graphics/GFX_5D180F.lz16"

DATA_5D1FFF:
	incbin "Graphics/GFX_5D1FFF.lz16"

DATA_5D26DE:
	incbin "Graphics/GFX_5D26DE.lz16"

DATA_5D2F69:
	incbin "Graphics/GFX_5D2F69.lz16"

DATA_5D351B:
	incbin "Graphics/GFX_5D351B.lz16"

DATA_5D3A65:
	incbin "Graphics/GFX_5D3A65.lz16"

DATA_5D3F7A:
	incbin "Graphics/GFX_5D3F7A.lz16"

DATA_5D4050:
	incbin "Graphics/GFX_5D4050.lz16"

DATA_5D46D0:
	incbin "Graphics/GFX_5D46D0.lz16"

DATA_5D4B93:
	incbin "Graphics/GFX_5D4B93.lz16"

DATA_5D511D:
	incbin "Graphics/GFX_5D511D.lz16"

DATA_5D57EE:
	incbin "Graphics/GFX_5D57EE.lz16"

DATA_5D5D3A:
	incbin "Graphics/GFX_5D5D3A.lz16"

DATA_5D6469:
	incbin "Graphics/GFX_5D6469.lz16"

DATA_5D6ACF:
	incbin "Graphics/GFX_5D6ACF.lz16"

DATA_5D6C99:
	incbin "Graphics/GFX_5D6C99.lz16"

DATA_5D6DAC:
	incbin "Graphics/GFX_5D6DAC.lz16"

DATA_5D6EA2:
	incbin "Graphics/GFX_5D6EA2.lz16"

DATA_5D7033:
	incbin "Graphics/GFX_5D7033.lz16"

DATA_5D728B:
	incbin "Graphics/GFX_5D728B.lz16"

DATA_5D7466:
	incbin "Graphics/GFX_5D7466.lz16"

DATA_5D7623:
	incbin "Graphics/GFX_5D7623.lz16"

DATA_5D7810:
	incbin "Graphics/GFX_5D7810.lz16"

DATA_5D79BB:
	incbin "Graphics/GFX_5D79BB.lz16"

DATA_5D7B30:
	incbin "Graphics/GFX_5D7B30.lz16"

DATA_5D7C85:
	incbin "Graphics/GFX_5D7C85.lz16"

DATA_5D7E57:
	incbin "Graphics/GFX_5D7E57.lz16"

DATA_5D80A3:
	incbin "Graphics/GFX_5D80A3.lz16"

DATA_5D82C8:
	incbin "Graphics/GFX_5D82C8.lz16"

DATA_5D845B:
	incbin "Graphics/GFX_5D845B.lz16"

DATA_5D86B4:
	incbin "Graphics/GFX_5D86B4.lz16"

DATA_5D87F8:
	incbin "Graphics/GFX_5D87F8.lz16"

DATA_5D8990:
	incbin "Graphics/GFX_5D8990.lz16"

DATA_5D8B43:
	incbin "Graphics/GFX_5D8B43.lz16"

DATA_5D8D2D:
	incbin "Graphics/GFX_5D8D2D.lz16"

DATA_5D8E69:
	incbin "Graphics/GFX_5D8E69.lz16"

DATA_5D8FC6:
	incbin "Graphics/GFX_5D8FC6.lz16"

DATA_5D90F8:
	incbin "Graphics/GFX_5D90F8.lz16"

DATA_5D9242:
	incbin "Graphics/GFX_5D9242.lz16"

DATA_5D93BD:
	incbin "Graphics/GFX_5D93BD.lz16"

DATA_5D952A:
	incbin "Graphics/GFX_5D952A.lz16"

DATA_5D969C:
	incbin "Graphics/GFX_5D969C.lz16"

DATA_5D98F0:
	incbin "Graphics/GFX_5D98F0.lz16"

DATA_5D9AEC:
	incbin "Graphics/GFX_5D9AEC.lz16"

DATA_5D9C49:
	incbin "Graphics/GFX_5D9C49.lz16"

DATA_5D9DC6:
	incbin "Graphics/GFX_5D9DC6.lz16"

DATA_5D9FFA:
	incbin "Graphics/GFX_5D9FFA.lz16"

DATA_5DA191:
	incbin "Graphics/GFX_5DA191.lz16"

DATA_5DA389:
	incbin "Graphics/GFX_5DA389.lz16"

DATA_5DA536:
	incbin "Graphics/GFX_5DA536.lz16"

DATA_5DA714:
	incbin "Graphics/GFX_5DA714.lz16"

DATA_5DA960:
	incbin "Graphics/GFX_5DA960.lz16"

DATA_5DAB59:
	incbin "Graphics/GFX_5DAB59.lz16"

DATA_5DACF1:
	incbin "Graphics/GFX_5DACF1.lz16"

DATA_5DAE74:
	incbin "Graphics/GFX_5DAE74.lz16"

DATA_5DAFBA:
	incbin "Graphics/GFX_5DAFBA.lz16"

DATA_5DB0F3:
	incbin "Graphics/GFX_5DB0F3.lz16"

DATA_5DB321:
	incbin "Graphics/GFX_5DB321.lz16"

DATA_5DB48B:
	incbin "Graphics/GFX_5DB48B.lz16"

DATA_5DB5F0:
	incbin "Graphics/GFX_5DB5F0.lz16"

DATA_5DB80E:
	incbin "Graphics/GFX_5DB80E.lz16"

DATA_5DBA3E:
	incbin "Graphics/GFX_5DBA3E.lz16"

DATA_5DBC21:
	incbin "Graphics/GFX_5DBC21.lz16"

DATA_5DBDC1:
	incbin "Graphics/GFX_5DBDC1.lz16"

DATA_5DBF2C:
	incbin "Graphics/GFX_5DBF2C.lz16"

DATA_5DC0DF:
	incbin "Graphics/GFX_5DC0DF.lz16"

DATA_5DC1EC:
	incbin "Graphics/GFX_5DC1EC.lz16"

DATA_5DC3EF:
	incbin "Graphics/GFX_5DC3EF.lz16"

DATA_5DC58C:
	incbin "Graphics/GFX_5DC58C.lz16"

DATA_5DC70B:
	incbin "Graphics/GFX_5DC70B.lz16"

DATA_5DC885:
	incbin "Graphics/GFX_5DC885.lz16"

DATA_5DC947:
	incbin "Graphics/GFX_5DC947.lz16"

DATA_5DCA3E:
	incbin "Graphics/GFX_5DCA3E.lz16"

DATA_5DCC2E:
	incbin "Graphics/GFX_5DCC2E.lz16"

DATA_5DCE2B:
	incbin "Graphics/GFX_5DCE2B.lz16"

DATA_5DCFDF:
	incbin "Graphics/GFX_5DCFDF.lz16"

DATA_5DD119:
	incbin "Graphics/GFX_5DD119.lz16"

DATA_5DD286:
	incbin "Graphics/GFX_5DD286.lz16"

DATA_5DD445:
	incbin "Graphics/GFX_5DD445.lz16"

DATA_5DD5FB:
	incbin "Graphics/GFX_5DD5FB.lz16"

DATA_5DD7C6:
	incbin "Graphics/GFX_5DD7C6.lz16"

DATA_5DD930:
	incbin "Graphics/GFX_5DD930.lz16"

DATA_5DDAF4:
	incbin "Graphics/GFX_5DDAF4.lz16"

DATA_5DDCCE:
	incbin "Graphics/GFX_5DDCCE.lz16"

DATA_5DDE10:
	incbin "Graphics/GFX_5DDE10.lz16"

DATA_5DDFB0:
	incbin "Graphics/GFX_5DDFB0.lz16"

DATA_5DE0E8:
	incbin "Graphics/GFX_5DE0E8.lz16"

DATA_5DE1DC:
	incbin "Graphics/GFX_5DE1DC.lz16"

DATA_5DE3A5:
	incbin "Graphics/GFX_5DE3A5.lz16"

DATA_5DE581:
	incbin "Graphics/GFX_5DE581.lz16"

DATA_5DE6E9:
	incbin "Graphics/GFX_5DE6E9.lz16"

DATA_5DE8AE:
	incbin "Graphics/GFX_5DE8AE.lz16"

DATA_5DEA53:
	incbin "Graphics/GFX_5DEA53.lz16"

DATA_5DEC4C:
	incbin "Graphics/GFX_5DEC4C.lz16"

DATA_5DEDF4:
	incbin "Graphics/GFX_5DEDF4.lz16"

DATA_5DEFCA:
	incbin "Graphics/GFX_5DEFCA.lz16"

DATA_5DF13D:
	incbin "Graphics/GFX_5DF13D.lz16"

DATA_5DF2C3:
	incbin "Graphics/GFX_5DF2C3.lz16"

DATA_5DF399:
	incbin "Graphics/GFX_5DF399.lz16"

DATA_5DF4BE:
	incbin "Graphics/GFX_5DF4BE.lz16"

DATA_5DF5A6:
	incbin "Graphics/GFX_5DF5A6.lz16"

DATA_5DF70A:
	incbin "Graphics/GFX_5DF70A.lz16"

DATA_5DF804:
	incbin "Graphics/GFX_5DF804.lz16"

DATA_5E03D3:
	incbin "Graphics/GFX_5E03D3.lz16"

DATA_5E0596:
	incbin "Graphics/GFX_5E0596.lz16"

DATA_5E0750:
	incbin "Graphics/GFX_5E0750.lz16"

DATA_5E0956:
	incbin "Graphics/GFX_5E0956.lz16"

DATA_5E0AB6:
	incbin "Graphics/GFX_5E0AB6.lz16"

DATA_5E0F30:
	incbin "Graphics/GFX_5E0F30.lz16"

DATA_5E16FA:
	incbin "Graphics/GFX_5E16FA.lz16"

DATA_5E1DD1:
	incbin "Graphics/GFX_5E1DD1.lz16"

DATA_5E2450:
	incbin "Graphics/GFX_5E2450.lz16"

DATA_5E2E3F:
	incbin "Graphics/GFX_5E2E3F.lz16"

DATA_5E3939:
	incbin "Graphics/GFX_5E3939.lz16"

DATA_5E3E16:
	incbin "Graphics/GFX_5E3E16.lz16"

DATA_5E42AC:
	incbin "Graphics/GFX_5E42AC.lz16"

DATA_5E4D55:
	incbin "Graphics/GFX_5E4D55.lz16"

DATA_5E57A7:
	incbin "Graphics/GFX_5E57A7.lz16"

DATA_5E5E4B:
	incbin "Graphics/GFX_5E5E4B.lz16"

DATA_5E6583:
	incbin "Graphics/GFX_5E6583.lz16"

DATA_5E6AAE:
	incbin "Graphics/GFX_5E6AAE.lz16"

DATA_5E70E0:
	incbin "Graphics/GFX_5E70E0.lz16"

DATA_5E77FD:
	incbin "Graphics/GFX_5E77FD.lz16"

DATA_5E829F:
	incbin "Graphics/GFX_5E829F.lz16"

DATA_5E9360:
	incbin "Graphics/GFX_5E9360.lz16"

DATA_5EA7C0:
	incbin "Graphics/GFX_5EA7C0.lz16"

DATA_5EBA21:
	incbin "Graphics/GFX_5EBA21.lz16"

DATA_5EC639:
	incbin "Graphics/GFX_5EC639.lz16"

DATA_5ED157:
	incbin "Graphics/GFX_5ED157.lz16"

DATA_5ED7BE:
	incbin "Graphics/GFX_5ED7BE.lz16"

DATA_5EE3D2:
	incbin "Graphics/GFX_5EE3D2.lz16"

DATA_5EE999:
	incbin "Graphics/GFX_5EE999.lz16"

DATA_5EEC88:
	incbin "Graphics/GFX_5EEC88.lz16"

DATA_5EF3B1:
	incbin "Graphics/GFX_5EF3B1.lz16"

DATA_5EF5DC:
	incbin "Graphics/GFX_5EF5DC.lz16"

DATA_5EF845:
	incbin "Graphics/GFX_5EF845.lz16"

DATA_5EFA6E:
	incbin "Graphics/GFX_5EFA6E.lz16"

DATA_5EFCD6:
	incbin "Graphics/GFX_5EFCD6.lz16"

DATA_5EFEFF:
	incbin "Graphics/GFX_5EFEFF.lz16"

DATA_5F01FE:
	incbin "Graphics/GFX_5F01FE.lz16"

DATA_5F0576:
	incbin "Graphics/GFX_5F0576.lz16"

DATA_5F0922:
	incbin "Graphics/GFX_5F0922.lz16"

DATA_5F0BBB:
	incbin "Graphics/GFX_5F0BBB.lz16"

DATA_5F10E1:
	incbin "Graphics/GFX_5F10E1.lz16"

DATA_5F15BA:
	incbin "Graphics/GFX_5F15BA.lz16"

DATA_5F1960:
	incbin "Graphics/GFX_5F1960.lz16"

DATA_5F1D97:
	incbin "Graphics/GFX_5F1D97.lz16"

DATA_5F21AB:
	incbin "Graphics/GFX_5F21AB.lz16"

DATA_5F25FB:
	incbin "Graphics/GFX_5F25FB.lz16"

DATA_5F2948:
	incbin "Graphics/GFX_5F2948.lz16"

DATA_5F2CAC:
	incbin "Graphics/GFX_5F2CAC.lz16"

DATA_5F2EB0:
	incbin "Graphics/GFX_5F2EB0.lz16"

DATA_5F3352:
	incbin "Graphics/GFX_5F3352.lz16"

DATA_5F3A70:
	incbin "Graphics/GFX_5F3A70.lz16"

DATA_5F4013:
	incbin "Graphics/GFX_5F4013.lz16"

DATA_5F45B7:
	incbin "Graphics/GFX_5F45B7.lz16"

DATA_5F4D68:
	incbin "Graphics/GFX_5F4D68.lz16"

DATA_5F5485:
	incbin "Graphics/GFX_5F5485.lz16"

DATA_5F55D7:
	incbin "Graphics/GFX_5F55D7.lz16"

DATA_5F5742:
	incbin "Graphics/GFX_5F5742.lz16"

DATA_5F5942:
	incbin "Graphics/GFX_5F5942.lz16"

DATA_5F5B92:
	incbin "Graphics/GFX_5F5B92.lz16"

DATA_5F5D48:
	incbin "Graphics/GFX_5F5D48.lz16"

DATA_5F5F21:
	incbin "Graphics/GFX_5F5F21.lz16"

DATA_5F6126:
	incbin "Graphics/GFX_5F6126.lz16"

DATA_5F62D2:
	incbin "Graphics/GFX_5F62D2.lz16"

DATA_5F6925:
	incbin "Graphics/GFX_5F6925.lz16"

DATA_5F6E88:
	incbin "Graphics/GFX_5F6E88.lz16"

DATA_5F725C:
	incbin "Graphics/GFX_5F725C.lz16"

DATA_5F7906:
	incbin "Graphics/GFX_5F7906.lz16"

DATA_5F7AC9:
	incbin "Graphics/GFX_5F7AC9.lz16"

DATA_5F7CE1:
	incbin "Graphics/GFX_5F7CE1.lz16"

DATA_5F7EA6:
	incbin "Graphics/GFX_5F7EA6.lz16"

DATA_5F80B8:
	incbin "Graphics/GFX_5F80B8.lz16"

DATA_5F8589:
	incbin "Graphics/GFX_5F8589.lz16"

; ---- End of bank-crossing compressed blobs. The remaining tail of bank $5F
; ---- is uncompressed, bank-aligned tables (tilemaps, palettes, anim frames),
; ---- so re-enable the bank-cross safety check from here on.
check bankcross on

; Per-version freespace pad / garbage block. V1.1 ships explicit garbage
; bytes here (matching the original Nintendo cart); V1.0 reserves the bytes
; as freespace filled with $FF.
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($5F8A36, incbin, DATA_5F8A36_YI_U2.bin)
else
	%FREE_BYTES($5F8A36, 2378, $FF)
endif

; ---- Uncompressed support tables ($5F:9380 onwards) ----------------------
; A mix of tilemaps, palettes, mode-7 fade ramps and miscellaneous helper
; arrays consumed by the title-screen / cinema / boss-render code. Only the
; two big landmarks (title tilemap, Hookbill palette) are positively
; identified; the smaller blocks remain unannotated.
DATA_5F9380:								; Note: Title screen tilemap (sky layer).
	dw $52E8,$52CA,$52E8,$52E8,$52CC,$52E8,$52E8,$52C0
	dw $52E8,$52CE,$52E8,$52C0,$52E8,$52CC,$52E8,$52E8
	dw $52E8,$52CA,$52E8,$52CC,$52E8,$52E8,$52E8,$52CA
	dw $52E8,$52E8,$52E8,$52E8,$52E8,$52CE,$52E8,$52E8
	dw $52E8,$12E0,$12E2,$52E8,$52E8,$52CE,$52E8,$52E8
	dw $52CA,$52EE,$52EC,$52E8,$52E8,$52E8,$52E8,$52CA
	dw $52CC,$52E8,$52E8,$52E8,$52E8,$52C0,$52CE,$52E8
	dw $52CC,$52E8,$52C0,$52E8,$52CC,$52EE,$52EC,$52C0
	dw $52E8,$12E4,$12E6,$52CC,$52CA,$52EE,$52EC,$52CC
	dw $52E8,$52E8,$52CC,$52E8,$52CA,$52E8,$52E8,$52E8
	dw $52E8,$52CE,$52E8,$52E8,$52CC,$52E8,$52EE,$52EC
	dw $52E8,$52E8,$52E8,$52E8,$52CA,$52E8,$52E8,$52E8
	dw $52CA,$52CA,$52E8,$52E8,$52E8,$52E8,$52E8,$52E8
	dw $52C0,$52E8,$52E8,$52CE,$52E8,$52E8,$52C0,$52E8
	dw $52CC,$52EE,$52EC,$52CA,$52E8,$52E8,$52E8,$52E8
	dw $52C0,$52E8,$52CC,$52CE,$52E8,$52E8,$52CC,$52E8
	dw $52E8,$52E8,$52E8,$52E8,$52C0,$52E8,$52E8,$52CA
	dw $52E8,$52E8,$52CC,$52EE,$52EC,$52CE,$52E8,$52E8
	dw $52E8,$52E8,$52CC,$52C0,$52E8,$52CA,$52E8,$52CC
	dw $52E8,$52E8,$52CA,$52EE,$52EC,$52C0,$52E8,$52CE
	dw $52EC,$52E8,$52CC,$52E8,$52E8,$52CA,$52E8,$52E8
	dw $52CC,$52E8,$52CC,$52E8,$52CA,$52EE,$52EC,$52E8
	dw $52CA,$52E8,$52E8,$52E8,$52CC,$52E8,$52E8,$52E8
	dw $52CC,$52CA,$52E8,$52E8,$52CC,$52E8,$52E8,$52EE
	dw $56C4,$56C2,$56C4,$56C2,$56C4,$56C2,$56C4,$56C2
	dw $56C4,$56C2,$56C4,$56C2,$56C4,$56C2,$56C2,$56C2
	dw $56C4,$56C2,$56C4,$56C2,$56C4,$56C2,$56C4,$56C2
	dw $56C4,$56C2,$56C4,$56C2,$56C4,$56C2,$56C4,$56C2
	dw $12C6,$12C8,$12C6,$12C8,$12C6,$12C8,$12C6,$12C8
	dw $12C6,$12C8,$12C6,$12C8,$12C6,$12C8,$12C6,$12C8
	dw $12C6,$12C8,$12C6,$12C8,$12C6,$12C8,$12C6,$12C8
	dw $12C6,$12C8,$12C6,$12C8,$12C6,$12C8,$12C6,$12C8
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA
	dw $12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA,$12EA

;@editable:island-tilemap begin
DATA_5F9800:								; Note: Title screen island tilemap (worlds 1-5 variant).
	dw $0E0E,$0E0E,$0E0E,$0E0E,$0E0E,$0E0E,$0E1E,$0E0E
	dw $000E,$1E01,$000E,$0E01,$0E0E,$0E0E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$0E0E,$0E1E,$0400,$2E05,$1E0E,$020E
	dw $1003,$0111,$1000,$0111,$1E0E,$0E0E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$0E0E,$000E,$1410,$0415,$0205,$1203
	dw $2013,$1121,$2010,$1121,$0E01,$0E0E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$1E0E,$1000,$2420,$1425,$1215,$2213
	dw $4823,$2148,$4820,$2148,$0111,$1E0E,$0E0E,$0E0E
	dw $0E0E,$1E0E,$000E,$2010,$4848,$2448,$2225,$4823
	dw $4848,$4848,$4848,$3148,$5141,$0E1E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$1000,$4820,$4848,$4848,$4848,$4848
	dw $4848,$4848,$4848,$2148,$0411,$2E05,$0E0E,$0E0E
	dw $0E0E,$060E,$0807,$4848,$4848,$4848,$4848,$4848
	dw $4848,$4848,$4848,$4848,$1421,$0115,$0E1E,$0E0E
	dw $0E0E,$161E,$1817,$4848,$4848,$0F48,$4848,$4848
	dw $485F,$4848,$4760,$4848,$2448,$1125,$0E01,$0E0E
	dw $0E0E,$1000,$4820,$0F48,$4848,$4848,$4848,$4848
	dw $4848,$4648,$574A,$4848,$4848,$2A29,$0E2B,$0E0E
	dw $000E,$2010,$4848,$4746,$4848,$4848,$4848,$4848
	dw $4848,$5648,$4A5A,$6564,$4848,$3A39,$1E3B,$0E0E
	dw $1000,$4820,$4848,$5756,$4848,$4848,$4848,$4848
	dw $4848,$7048,$7071,$7574,$4848,$0A09,$0E0B,$0E0E
	dw $4050,$4830,$4848,$6766,$6160,$4848,$4848,$4848
	dw $4848,$6460,$4865,$4848,$4848,$1A19,$2E1B,$0E0E
	dw $500E,$3040,$4848,$7776,$7170,$4848,$4848,$4848
	dw $5F48,$7470,$4875,$4848,$4848,$2148,$0111,$0E2E
	dw $001E,$2010,$4848,$5F5F,$4848,$4848,$6048,$4B4A
	dw $6261,$6463,$4865,$605F,$4861,$4848,$1121,$0E01
	dw $1000,$4808,$4848,$6160,$6160,$6160,$6648,$4A5A
	dw $4B4A,$4A5A,$614A,$4A60,$4871,$4848,$0948,$0B0A
	dw $2726,$4828,$4848,$4A70,$4A4B,$4B4B,$7647,$5A5A
	dw $4A4A,$4D4C,$4A4A,$5E4B,$4861,$4848,$190F,$1B1A
	dw $1716,$4818,$4848,$7248,$4A73,$4A4B,$6057,$4B4B
	dw $4B4B,$6C7C,$4A4D,$5A4B,$474A,$4848,$2948,$2B2A
	dw $4050,$3332,$4848,$6248,$4B63,$4B4A,$4B4B,$5E4B
	dw $4D4C,$5C4C,$4D5D,$4D4C,$575A,$4848,$3948,$3B3A
	dw $500E,$4342,$4830,$7048,$5A5B,$5A5B,$4D4C,$4C4B
	dw $5D5C,$7E5C,$3F3E,$7D6D,$714A,$4848,$4131,$0E51
	dw $0E0E,$5352,$3040,$4848,$5B70,$5B5A,$7D7C,$7C4B
	dw $4F6C,$3F7E,$7E4F,$4D5D,$4871,$2948,$2B2A,$0E0E
	dw $1E0E,$002E,$2010,$480F,$4A60,$4A4B,$4B4B,$4A4B
	dw $6C7C,$3E4F,$6C6D,$7D6D,$4861,$3948,$3B3A,$0E2E
	dw $2E0E,$1000,$4820,$485F,$4B70,$4B4A,$4B4A,$5E4A
	dw $7C4A,$6D6C,$7C7D,$5A7D,$4871,$4131,$0E51,$0E0E
	dw $060E,$0807,$4848,$6160,$7248,$7473,$7275,$5B73
	dw $5B5A,$7D7C,$5B5A,$7574,$3148,$5141,$0E0E,$0E0E
	dw $160E,$1817,$4848,$7170,$4848,$4848,$4848,$6648
	dw $4B4A,$7574,$7170,$4848,$4131,$0E51,$0E1E,$0E0E
	dw $260E,$2827,$4848,$3448,$3035,$4848,$4848,$7648
	dw $7574,$4848,$0F48,$3148,$5141,$0E1E,$0E0E,$0E0E
	dw $360E,$3837,$4848,$4431,$4045,$4830,$480F,$4848
	dw $4848,$3031,$4848,$4131,$0E51,$0E0E,$0E0E,$0E0E
	dw $1E0E,$4050,$3130,$5441,$3655,$3040,$4848,$0F48
	dw $2948,$272A,$2928,$2B2A,$0E0E,$0E1E,$0E0E,$0E0E
	dw $0E0E,$500E,$4140,$2E51,$0E2E,$4050,$4830,$4848
	dw $3948,$373A,$3938,$3B3A,$0E2E,$0E0E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$5150,$0E0E,$1E0E,$500E,$3240,$3031
	dw $4131,$2651,$2A27,$0E2B,$0E0E,$0E0E,$2E0E,$0E0E
	dw $0E0E,$0E1E,$0E1E,$0E1E,$2E0E,$1E0E,$4250,$4041
	dw $5141,$360E,$3A37,$0E3B,$0E1E,$0E1E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$0E0E,$0E0E,$0E0E,$0E0E,$520E,$5051
	dw $1E51,$0E1E,$2B26,$0E0E,$0E0E,$0E0E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$0E0E,$0E0E,$0E0E,$0E2E,$0E0E,$0E0E
	dw $0E0E,$0E0E,$3B36,$0E0E,$0E0E,$0E0E,$0E0E,$0E0E
;@editable:island-tilemap end

DATA_5F9C00:								; Note: Title screen island tilemap (world 6 variant).
	dw $7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$4949
	dw $4949,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$4949,$5959
	dw $5959,$4949,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$4949,$5959,$5858
	dw $5858,$5959,$4949,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$7F7F,$4949,$5959,$5858,$7B7B
	dw $7B7B,$5858,$5959,$4949,$7F7F,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$497F,$5959,$5858,$7B7B,$7A7A
	dw $7A7A,$7B7B,$5858,$5959,$7F49,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$5949,$5858,$7B7B,$7A7A,$7979
	dw $7979,$7A7A,$7B7B,$5858,$4959,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$497F,$5859,$7B7B,$7A7A,$7979,$7878
	dw $7878,$7979,$7A7A,$7B7B,$5958,$7F49,$7F7F,$7F7F
	dw $7F7F,$7F7F,$5949,$7B58,$7A7B,$7979,$7878,$6B6B
	dw $6B6B,$7878,$7979,$7B7A,$587B,$4959,$7F7F,$7F7F
	dw $7F7F,$497F,$5859,$7B7B,$797A,$7879,$6B6B,$6A6A
	dw $6A6A,$6B6B,$7978,$7A79,$7B7B,$5958,$7F49,$7F7F
	dw $7F7F,$497F,$5859,$7A7B,$7979,$6B78,$6A6A,$6969
	dw $6969,$6A6A,$786B,$7979,$7B7A,$5958,$7F49,$7F7F
	dw $7F7F,$5949,$7B58,$797A,$7879,$6A6B,$6969,$0C68
	dw $680D,$6969,$6B6A,$7978,$7A79,$587B,$4959,$7F7F
	dw $7F7F,$5949,$7B58,$797A,$6B78,$696A,$6868,$1C68
	dw $0C1D,$680D,$6A69,$786B,$7A79,$587B,$4959,$7F7F
	dw $497F,$5859,$7A7B,$7879,$6A6B,$6869,$6868,$6868
	dw $5C0C,$0D5D,$6968,$6B6A,$7978,$7B7A,$5958,$7F49
	dw $497F,$5859,$7A7B,$7879,$6A6B,$6869,$6868,$6868
	dw $6C1C,$5D4F,$690D,$6B6A,$7978,$7B7A,$5958,$7F49
	dw $5949,$7B58,$797A,$6B78,$696A,$6868,$6868,$6868
	dw $5C0C,$6D4F,$681D,$6A69,$786B,$7A79,$587B,$4959
	dw $5949,$7B58,$797A,$6B78,$696A,$6868,$0D0C,$0C68
	dw $3E5C,$5D3F,$680D,$6A69,$786B,$7A79,$587B,$4959
	dw $5949,$7B58,$797A,$6B78,$696A,$6868,$1D1C,$1C68
	dw $6D6C,$6D6C,$681D,$6A69,$786B,$7A79,$587B,$4959
	dw $5949,$7B58,$797A,$6B78,$696A,$6868,$6868,$6868
	dw $1D1C,$1D1C,$6868,$6A69,$786B,$7A79,$587B,$4959
	dw $497F,$5859,$7A7B,$7879,$6A6B,$6869,$6868,$6868
	dw $6868,$6868,$6968,$6B6A,$7978,$7B7A,$5958,$7F49
	dw $497F,$5859,$7A7B,$7879,$6A6B,$6869,$6868,$6868
	dw $6868,$6868,$6968,$6B6A,$7978,$7B7A,$5958,$7F49
	dw $7F7F,$5949,$7B58,$797A,$6B78,$696A,$6868,$6868
	dw $6868,$6868,$6A69,$786B,$7A79,$587B,$4959,$7F7F
	dw $7F7F,$5949,$7B58,$797A,$7879,$6A6B,$6969,$6868
	dw $6868,$6969,$6B6A,$7978,$7A79,$587B,$4959,$7F7F
	dw $7F7F,$497F,$5859,$7A7B,$7979,$6B78,$6A6A,$6969
	dw $6969,$6A6A,$786B,$7979,$7B7A,$5958,$7F49,$7F7F
	dw $7F7F,$497F,$5859,$7B7B,$797A,$7879,$6B6B,$6A6A
	dw $6A6A,$6B6B,$7978,$7A79,$7B7B,$5958,$7F49,$7F7F
	dw $7F7F,$7F7F,$5949,$7B58,$7A7B,$7979,$7878,$6B6B
	dw $6B6B,$7878,$7979,$7B7A,$587B,$4959,$7F7F,$7F7F
	dw $7F7F,$7F7F,$497F,$5859,$7B7B,$7A7A,$7979,$7878
	dw $7878,$7979,$7A7A,$7B7B,$5958,$7F49,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$5949,$5858,$7B7B,$7A7A,$7979
	dw $7979,$7A7A,$7B7B,$5858,$4959,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$497F,$5959,$5858,$7B7B,$7A7A
	dw $7A7A,$7B7B,$5858,$5959,$7F49,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$7F7F,$4949,$5959,$5858,$7B7B
	dw $7B7B,$5858,$5959,$4949,$7F7F,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$4949,$5959,$5858
	dw $5858,$5959,$4949,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$4949,$5959
	dw $5959,$4949,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F
	dw $7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$4949
	dw $4949,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F,$7F7F

;-----------------------------------------------------------------------------
; SMWC tweaks: the palette ROM blob below is the target of ~26 SMWC "tweak"
; hex-edits. The PC offset cited on SMWC (e.g. "$3FA064") maps directly to
; (this blob start + ($3FA064 - $3FA000) = +$64 bytes). Notable clusters:
;   $3FA064 / $3FA0D8-$3FA0E6  Yoshi color fixups (Pink, Brown -> map vs game)
;   $3FC876 / $3FC894 / $3FC8B2  World Map hud palette (Worlds 1-3, BGR-15 LE)
;   $3FDAF8 .. $3FDD24            Dynamic-palette HUD colors for Worlds 4-6
;                                 across each currently-visited overworld (W1-W6)
;   $3FED72                       (single tweak; ending/credits palette region)
; Words are BGR-15 little-endian; "written backwards" in SMWC means low byte first.
; DO NOT bulk-edit -- each tweak is a targeted 2-byte palette color swap; use
; the SMWC entry to pick the exact word.
;-----------------------------------------------------------------------------
;@editable:palette-blob begin
DATA_5FA000:
DATA_master_palette_rom_blob:	; Master CGRAM/palette ROM blob ($3F:A000-$3F:FFFF, 24 KB). All level/sprite/UI BGR-15 palettes are emitted as offsets into this base; see Bank00.asm:5415+ for the LoadRegularPalette dispatch.
	dw $0000

DATA_5FA002:
	dw $46EE,$5772,$7FFF,$0000,$291F,$7F33,$03FF,$0000
	dw $7FFF,$0CDF,$03A0,$0000,$7FFF

DATA_5FA01C:
	dw $1A3F,$2BFF,$0000

DATA_5FA022:
	dw $7C1F,$7C10,$7C00,$0000,$7C1F,$7C10,$7C00,$0000
	dw $7C1F,$7C10,$7C00,$0000

DATA_5FA03A:
	dw $7FFF,$53F4,$54DB,$0000,$0180,$0012,$10D2,$02A0
	dw $001F,$467F,$111F,$03E0,$023F,$025F,$271F,$571F
	dw $6B9F,$7FFF,$0000

DATA_5FA060:
	; SMWC tweak $3FA064: bytes at +$4 (words 2-3 here = $4104,$3D55) -- change
	; to [B5 24 55 3D] to fix Pink Yoshi's palette in game (matches map palette).
	dw $188C,$4104,$3D55,$24B5

DATA_5FA068:
	dw $65AA,$467F,$001F,$55BF

DATA_5FA070:
	dw $7E8F,$023F,$031F,$571F,$6B9F,$7FFF,$0000,$00B9
	dw $0165,$0012,$01BF,$02AB,$467F,$001F,$037F,$03F2
	dw $023F,$031F,$571F,$6B9F,$7FFF,$0000,$45A7,$01DF
	dw $0012,$6268,$03FF,$467F,$001F,$7F71,$5FFF,$023F
	dw $031F,$571F,$6B9F,$7FFF,$0000,$450A,$240C,$0012
	dw $6571,$3898,$467F,$001F,$7DF9,$615F,$023F,$031F
	dw $571F,$6B9F,$7FFF,$0000,$1D6F,$0006,$10D2,$29F5
	dw $000C,$467F,$111F,$4ABA,$0012,$023F,$271F,$571F
	dw $6B9F,$7FFF,$0000,$0C6E,$2544,$10D2,$18D7,$4E69
	dw $467F,$111F,$215F,$674E,$023F,$271F,$571F,$6B9F
	dw $7FFF,$0000,$2442,$248C,$0012,$40E7,$38F8,$467F
	dw $001F,$5D6B,$515F,$023F,$031F,$571F,$6B9F,$7FFF
	dw $0000,$1440,$64C2,$7E40,$7F96,$63BE,$38DF,$51A0
	dw $77FC,$7D93,$1463,$7C1F,$7C00,$637D,$4A75,$0000

DATA_5FA150:
	dw $4DA4,$6A88,$7FB2,$7FFF

DATA_5FA158:
	dw $7FFF,$4DA4,$6A88,$7FB2

DATA_5FA160:
	dw $7FB2,$7FFF,$4DA4,$6A88

DATA_5FA168:
	dw $6A88,$7FB2,$7FFF,$4DA4

DATA_5FA170:
	dw $4167,$4E68,$6313,$7FFF

DATA_5FA178:
	dw $7FFF,$4167,$4E68,$6313

DATA_5FA180:
	dw $6313,$7FFF,$4167,$4E68

DATA_5FA188:
	dw $4E68,$6313,$7FFF,$4167

DATA_5FA190:
	dw $0000,$0421,$0421,$0C63,$20C7,$292A,$0421,$1485
	dw $1CC7,$0421,$0421,$1485

DATA_5FA1A8:
	dw $1D09,$31CF,$3E11,$571B,$296D,$39F1,$4A75,$5B3B
	dw $39F1,$4233,$56F9,$5F5C,$4A75,$4A75,$637D,$637D

DATA_5FA1C8:
	dw $0000,$7FFF,$0180,$02A0,$03E0,$36B5,$4B7C,$63BE
	dw $40C0,$65E9,$7F72,$1D5B,$3A3F,$475F,$5BFF

DATA_5FA1E6:
	dw $0000,$7FFF,$000B,$0014,$001F,$01FF,$031F,$03FF
	dw $44EE,$6270,$7FF2,$2A26,$3B13,$57D9,$6BFF

DATA_5FA204:
	dw $0000,$7FFF,$013F,$02BF,$03FF,$76EE,$7756,$7FDC
	dw $38AA,$614F,$7E55,$31A8,$466F,$6336,$77DB,$7FF2
	dw $7FFF,$5400,$7C00,$7E20,$7EE0,$7FE0,$7FF6,$72F0
	dw $7F76,$7FFF,$62EB,$7792,$7FFA,$7FFF,$0000,$7FFF
	dw $140D,$3416,$5C1F,$5951,$7A7B,$7AFF,$1D58,$467F
	dw $633F,$0CEC,$25F3,$3A9A,$573F,$0000,$0180,$40C0
	dw $10D2,$02A0,$65E9,$36B5,$111F,$03E0,$7F0E,$025F
	dw $271F,$4B7C,$63BE,$7FFF,$7FFF,$0000,$0069,$006E
	dw $00B7,$0CDF,$017F,$10A8,$154F,$3235,$573F,$7FFF
	dw $0000,$0151,$01F6,$02BB,$035F,$03FF,$2126,$39EB
	dw $5AF4,$77DB,$7FFF,$0000,$00E0,$0180,$0240,$0320
	dw $03E0,$30E2,$4DA4,$6A88,$7FB2,$0000,$7FFF,$39C4
	dw $56A8,$6F52,$7FFA,$7C18,$0000,$1042,$1884,$2928
	dw $7FB2,$7FF9,$7FFC,$7FFF,$0000,$0842,$1084,$18C6
	dw $2108,$2D6B,$35AD,$3DEF,$4631,$4E73,$5AD6,$6318
	dw $6B5A,$739C,$7FFF,$5E10,$7FFF,$76B6,$7F1E,$7FBF
	dw $7F7A,$7FDF,$7FFF,$7C0E,$7810,$7413,$7016,$6C19
	dw $681C,$641F,$3D26,$7FFF,$352E,$4596,$5E3F,$55F2
	dw $665A,$7EFF,$7FE0,$7FF3,$7FFA,$7F9B,$7FBB,$7FDD
	dw $7FFE,$0000,$7FFF,$5C1F,$5C1F,$5C1F,$5C1F,$1195
	dw $1E3D,$3F1F,$36B5,$4B7C,$63BE,$1D58,$1E3D,$03FF
	dw $0000,$7FFF,$013F,$02BF,$03FF,$5C1F,$000B,$0014
	dw $001F,$01FF,$031F,$03FF,$44EE,$6270,$7FF2,$0000
	dw $7FFF,$013F,$02BF,$03FF,$76EE,$7756,$7FDC,$3502
	dw $49E2,$66C3,$0CF0,$25F7,$3A9D,$573F,$0000,$7FFF
	dw $7806,$7808,$740A,$740C,$740E,$7010,$7012,$7014
	dw $6C16,$31A8,$466F,$6336,$77DB,$0000,$0020,$03FF
	dw $0001,$0040,$0421,$0021,$0003,$0060,$0001,$0022
	dw $0043,$0442,$0863,$0C63,$03FF,$03FF,$03FF,$03FF
	dw $03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF
	dw $03FF,$03FF,$03FF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$0000,$7FFF,$156C,$15F0,$1E75,$26F9,$2B5C
	dw $43DF,$006B,$0134,$025F,$5C1F,$572E,$67B4,$7BFC
	dw $0000,$7FFF,$4800,$6120,$7E00,$562A,$6778,$67DD
	dw $140D,$3416,$5C1F,$7EE7,$7F8E,$7FD6,$7FFA,$0000
	dw $2972,$1A3C,$035F,$43DF,$20CC,$00F3,$001F,$4A54
	dw $5B18,$6B9C,$7FFF,$0000,$0000,$0000,$0000,$20CD
	dw $2972,$1A3C,$02DF,$1066,$20CE,$00F7,$316E,$4A54
	dw $5B18,$52DA,$5F3D,$677F,$6FDF,$7FFF,$0000,$45E9
	dw $566E,$5E94,$5F59,$73DE,$7C1B,$7C1F,$701F,$641F
	dw $501F,$381F,$1C1F,$001F,$7FFF,$0000,$1882,$31A8
	dw $466F,$6336,$77DB,$77B1,$7FFC,$7FFF,$641F,$501F
	dw $381F,$1C1F,$001F,$0000,$7FFF,$0012,$001F,$51A0
	dw $319F,$4A5F,$01FF,$51A0,$51A0,$51A0,$0014,$001F
	dw $7FFF,$7FFF,$0000,$7FFF,$2092,$3139,$399F,$4E5F
	dw $01DB,$02BF,$035F,$03FF,$7FFF,$7EFF,$381F,$1C1F
	dw $001F,$3104,$7FFF,$310F,$3118,$311F,$32FF,$33FF
	dw $33FF,$75F2,$7F74,$7FF6,$5B2A,$6BF7,$7FFD,$7FFF
	dw $0000,$7FFF,$000B,$0014,$001F,$01FF,$031F,$03FF
	dw $44EE,$6270,$7FF2,$2A26,$3B13,$57D9,$6BFF,$0000
	dw $7FFF,$000B,$0014,$001F,$01FF,$3FFF,$031F,$0200
	dw $1F6B,$2FF7,$2A26,$3B13,$57D9

DATA_5FA56E:
	dw $6BFF

DATA_5FA570:
	dw $03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF
	dw $03FF,$03FF,$03FF

DATA_5FA586:
	dw $03FF,$03FF,$03FF,$03FF

DATA_5FA58E:
	dw $0000,$7FFF,$013F,$02BF,$0000,$0000,$0000,$7FFF
	dw $7FFF,$7FFF,$0000,$0000,$0000,$0000,$0000,$03FF
	dw $03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF
	dw $03FF,$03FF,$03FF,$03FF,$03FF,$03FF

DATA_5FA5CA:
	dw $0000,$7FFF,$0013,$0016,$0018,$001B,$0CDC

DATA_5FA5D8:
	dw $475F,$433F,$3EFF,$3ABE,$3208,$3208,$3208,$3208
	dw $0000,$3F5F,$32BF,$261E,$197D,$0CDC,$001B

DATA_5FA5F6:
	dw $2E1D,$325D,$367E,$3ABE,$4188,$4188,$4188,$4188

DATA_5FA606:
	dw $0000,$7FFF,$7B9F,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $140D,$3416,$5C1F,$633F,$7FFF,$7AFF,$7FFF,$0000
	dw $7FFF,$7B9F,$467F,$633F,$69F6,$5951,$7AFF,$3416
	dw $140D,$0C07,$0000,$0000,$7AFF,$7A7B

DATA_5FA642:
	dw $0000,$7FFF,$2566,$35EA,$466F,$5AF4,$6B78,$77DB
	dw $000B,$0014,$013F,$5C1F,$76EE,$7756,$7FDC,$745D
	dw $6C9B,$64D9,$5D17,$5555,$4D93,$45D1,$3E0F,$364D
	dw $2E8B,$26C9,$1F07,$1745,$0F83,$03E0,$7FFF,$0000
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$35D0,$562E,$4EF0,$5FFE,$7FFF,$0000,$7FB2
	dw $7FFF,$4DA4,$6A88,$4EF0,$7C18,$7C18,$7C18,$7C18
	dw $7C18,$7C18,$7C18,$7C18,$3CCE,$5575,$6A99,$7F7F
	dw $39C4,$56A8,$6F52,$7FFA,$2952,$39D8,$4E7B,$6B5F
	dw $7FFF,$0000,$0D66,$1A4B,$32F0,$4B95,$53FD,$010B
	dw $01B2,$0298,$039F,$118A,$2E71,$4B79,$63FE,$77BD
	dw $6F7B,$6739,$5EF7,$56B5,$4E73,$4631,$3DEF,$35AD
	dw $2D6B,$2529,$1CE7,$14A5,$0C63,$0000,$7E00,$03F0
	dw $4F93,$67FB,$118A,$2E71,$4B79,$63FE,$11D6,$2E5E
	dw $4F93,$67FB,$7FFF,$0000,$1565,$19E5,$22AD,$2F72
	dw $43FC,$34E3,$3504,$3DA8,$528E,$314A,$4A2F,$52B4
	dw $5F7D,$7FFF,$0000,$0CA8,$0D51,$21F7,$42FC,$57BF
	dw $3000,$3C84,$4104,$4966,$4DC9,$51EC,$5A71,$5A97
	dw $641F,$501F,$381F,$1C1F,$641F,$501F,$381F,$1C1F
	dw $641F,$501F,$381F,$1C1F,$7FFF,$0000,$0005,$000F
	dw $001F,$15DF,$7C18,$1462,$2906,$49EC,$6B15,$0C87
	dw $10CB,$2978,$15DF,$7FFF,$0000,$7C05,$7C08,$7C0E
	dw $7C13,$7C18,$0C40,$0C41,$1CA3,$3968,$0C43,$1045
	dw $1487,$10CB,$1008,$148F,$3175,$567F,$218C,$3E73
	dw $5F5B,$679D,$2126,$39EB,$5AF4,$77DB,$7FFF,$0000
	dw $1D24,$31C6,$52CC,$6392,$77FA,$258E,$3A55,$4B3D
	dw $6FDF,$7F71,$7FF7,$7FFA,$7FFC,$7FFF,$0000,$7C05
	dw $7C08,$7C0E,$7C13,$7C18,$7C05,$7C08,$7C0E,$7C13
	dw $7C18,$7C05,$7C08,$7C0E,$7EF1,$7FB7,$7FFA,$77FF
	dw $7C08,$7C0E,$7C13,$7C18,$7F71,$7FF7,$7FFA,$7FFC
	dw $7FFF,$0000,$0D04,$1DC8,$3A8B,$5B53,$6B9C,$31F0
	dw $4A95,$577C,$63BF,$1D89,$2A4E,$3732,$4BF9,$7FFF
	dw $0000,$7C05,$7407,$6809,$600B,$540D,$4C0F,$4011
	dw $3414,$2C16,$2018,$181A,$0C1C,$001F,$1DC8,$3A8B
	dw $5B53,$6B9C,$1D46,$2A0A,$46F0,$4F72,$39EB,$5AF4
	dw $5B53,$6B9C,$7FFF,$0000,$08A7,$1970,$3E16,$42BD
	dw $637F,$14E3,$2585,$46AD,$6795,$1D09,$31CF,$3E11
	dw $571B,$7FFF,$0000,$3051,$30F6,$31BB,$325F,$32FF
	dw $1042,$1484,$1CE7,$254A,$298C,$31EF,$3A52,$42B5
	dw $1484,$1CE7,$3A52,$42B5,$501F,$501F,$501F,$501F
	dw $501F,$501F,$501F,$501F,$7FFF,$0000,$2DC0,$3E63
	dw $5B2E,$6FF5,$67FC,$49AF,$6692,$7B76,$7FFB,$3993
	dw $567A,$62FF,$739F,$7FFF,$0000,$45E9,$566E,$5E94
	dw $5F59,$73DE,$026E,$0332,$03B9,$67FC,$14E9,$194B
	dw $2E11,$4AB7,$3993,$567A,$3E63,$5B2E,$3993,$567A
	dw $3E63,$5B2E,$3E63,$5B2E,$6FF5,$67FC,$7FFF,$0000
	dw $1483,$2988,$322D,$3B16,$47BD,$24CE,$2D34,$41FA
	dw $56BF,$34E5,$314A,$3E11,$571B,$7FFF,$0000,$1462
	dw $2548,$3A2F,$4AF5,$5BDC,$0C41,$1061,$18C4,$24E8
	dw $292D,$2130,$2994,$3E57,$1B26,$22E8,$2AAA,$326C
	dw $1B26,$22E8,$2AAA,$326C,$1B26,$22E8,$2AAA,$326C
	dw $7FFF,$0000,$3135,$4E3F,$562D,$6B75,$67BF,$26BF
	dw $335F,$3BFF,$6BFF,$1C8C,$6BFF,$6BFF,$6BFF,$7FFF
	dw $38C1,$0CDF,$464A,$52CC,$6392,$77FA,$562D,$66CF
	dw $6B75,$67BF,$26BF,$335F,$3BFF,$6BFF,$7FF2,$0000
	dw $5F35,$7FFF,$7C08,$7C0E,$7C13,$7C18,$7C08,$7C0E
	dw $7C13,$7C18,$7FFF,$0000,$25DA,$2E3F,$2EFF,$4FFF
	dw $67FC,$49AF,$6692,$7B76,$7FFB,$1CCD,$39B4,$4639
	dw $56D9,$7FFF,$0000,$49AF,$6692,$7B76,$7FFB,$67BF
	dw $01C5,$024B,$0358,$6FF5,$10A8,$154F,$3235,$573F
	dw $1CCD,$39B4,$2E3F,$2EFF,$1CCD,$39B4,$2E3F,$2EFF
	dw $25DA,$2E3F,$2EFF,$4FFF,$7CD9,$0000,$7CD9,$10A7
	dw $214C,$29D0,$2528,$4A50,$7FFE,$0C40,$4EF5,$3E4C
	dw $2D65,$1CE2,$1480,$3104,$0000,$4167,$4E68,$6313
	dw $7FFF,$2528,$4A50,$7FFE,$3E4C,$1480,$1CE2,$2D65
	dw $3E4C,$4EF5,$6738,$6B59,$6F9B,$73BD,$4E71,$56B2
	dw $5F36,$677A,$35AA,$420C,$4ED1,$5B38,$7FFF,$0000
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$35D0,$562E,$4EF0,$5FFE,$7FFF,$0000,$02BF
	dw $037F,$001F,$01FF,$4EF0,$0CC9,$0D11,$0D1B,$467F
	dw $3E2A,$4EAB,$6772,$6FD8,$39C4,$56A8,$6F52,$7FFA
	dw $2952,$39D8,$4E7B,$6B5F,$3CCE,$5575,$6A99,$7F7F
	dw $7FFF,$0000,$1882,$31A8,$466F,$6336,$77DB,$77B1
	dw $7FFC,$7FFF,$774E,$77B1,$7FF8,$7FFC,$7FFF,$7FFF
	dw $0000,$00A8,$116E,$2A34,$42FA,$537E,$641F,$501F
	dw $381F,$641F,$501F,$381F,$1C1F,$001F,$77B1,$7FF8
	dw $7FF8,$7FFC,$774E,$77B1,$7FFF,$7FFF,$39EB,$5AF4
	dw $77B1,$7FFF,$7FFF,$0000,$0CA8,$152D,$1D91,$25D4
	dw $3A9A,$190A,$25AF,$2E33,$4AF9,$0443,$256C,$3612
	dw $4ED9,$7FFF,$0000,$104C,$1890,$1CF3,$2196,$329B
	dw $0422,$0864,$0CA5,$10C7,$10E8,$1509,$192A,$1D6C
	dw $0CA5,$10E8,$192A,$1D6C,$501F,$501F,$501F,$501F
	dw $501F,$501F,$501F,$501F,$7FFF,$0000,$0CDF,$025F
	dw $562D,$6B75,$67BF,$2F32,$3374,$43FA,$53FD,$1C8C
	dw $7FFF,$7FFF,$7FFF,$7FFF,$38C1,$0CDF,$464A,$52CC
	dw $6392,$77FA,$562D,$66CF,$6B75,$67BF,$2F32,$3374
	dw $43FA,$53FD,$7E00,$03F0,$4F93,$67FB,$0C8A,$10F0
	dw $1175,$15DB,$11D6,$2E5E,$4F93,$67FB,$7FFF,$0000
	dw $10AA,$10F0,$1978,$263F,$333F,$0C85,$14C7,$40F0
	dw $14C8,$0D0B,$15B0,$2697,$337F,$7FFF,$7BBE,$737C
	dw $6F1B,$6ADA,$6298,$5E57,$5A16,$51B4,$4D73,$4932
	dw $40F0,$3CAF,$384E,$300C,$7E00,$03F0,$4F93,$67FB
	dw $0863,$0868,$08AF,$1158,$10AA,$10F0,$1978,$263F
	dw $7FFF,$0000,$18E8,$31AE,$46B4,$5F5B,$6FBF,$0044
	dw $00AD,$0CD3,$15D8,$29AE,$29F7,$3E7D,$3F1F,$7FFF
	dw $0000,$02BF,$037F,$001F,$01FF,$4EF0,$20C9,$354F
	dw $49F6,$5E5D,$158E,$2233,$431A,$5BDF,$1DCA,$2A50
	dw $3314,$47BB,$3984,$5648,$6F12,$7FBA,$3552,$4DD8
	dw $627B,$7B5F,$7FFF,$0000,$1061,$2984,$4248,$5F12
	dw $6FBA,$1461,$41A8,$5E8E,$7FB7,$62CC,$7F93,$7FD9
	dw $7FFC,$7FFF,$0000,$7FB2,$7FFF,$4DA4,$6A88,$4EF0
	dw $20C9,$3111,$3D1B,$6E7F,$3968,$564C,$6F15,$7FBC
	dw $39C4,$56A8,$6F52,$7FFA,$2D84,$4648,$5F12,$73BA
	dw $6254,$6ED7,$7F5A,$7FDE,$7FFF,$0000,$008A,$0191
	dw $0259,$031E,$03FF,$1068,$14CF,$31B5,$565F,$118A
	dw $2E71,$4B79,$63FE,$7BBE,$777D,$733C,$6AFA,$66B9
	dw $6278,$5E37,$1068,$14CF,$31B5,$565F,$40F0,$3CAF
	dw $386E,$300C,$7E00,$03F0,$031E,$03FF,$118A,$2E71
	dw $4B79,$63FE,$11D6,$2E5E,$031E,$03FF,$4F5F,$0000
	dw $0888,$10B0,$1516,$25BA,$369F,$0048,$00EF,$0235
	dw $033F,$110D,$2DD4,$4B3C,$63FF,$7BBE,$777D,$733C
	dw $6AFA,$66B9,$6278,$5E37,$55F5,$51B4,$4D73,$4932
	dw $40F0,$3CAF,$386E,$300C,$7E00,$03F0,$25BA,$369F
	dw $110D,$2DD4,$4B3C,$63FF,$11D6,$2E5E,$25BA,$369F
	dw $7FFF,$0000,$0927,$0DAA,$1A4E,$2B33,$27F7,$2126
	dw $39EB,$5AF4,$77DB,$112A,$2E11,$4AF9,$63BE,$7FFF
	dw $0000,$45E9,$566E,$5E94,$5F59,$73DE,$164B,$1B30
	dw $27F4,$27F4,$14E9,$194B,$2E11,$4AB7,$112A,$2E11
	dw $0DAA,$1A4E,$112A,$2E11,$0DAA,$1A4E,$0DAA,$1A4E
	dw $2B33,$27F7,$7FFF,$0000,$3CA7,$498D,$6252,$6EF6
	dw $7F98,$3126,$4DCA,$6A8E,$7FB6,$316F,$41D4,$5279
	dw $6B1F,$7FFF,$0000,$45E9,$566E,$5E94,$5F59,$73DE
	dw $3957,$5E5F,$7F1D,$7F98,$150F,$1D74,$35F9,$4ABF
	dw $316F,$41D4,$498D,$6252,$316F,$41D4,$498D,$6252
	dw $498D,$6252,$6EF6,$7F98,$7FFF,$0000,$18CD,$2D93
	dw $4238,$56BC,$631F,$3574,$4A39,$62DF,$735F,$1D09
	dw $31CF,$3E11,$571B,$7FFF,$0000,$3051,$30F6,$31BB
	dw $325F,$32FF,$0000,$0800,$1040,$20A3,$28E5,$3548
	dw $41AB,$4A0E,$1484,$1CE7,$41AB,$4A0E,$501F,$501F
	dw $501F,$501F,$501F,$501F,$501F,$501F,$7FFF,$0000
	dw $0823,$1CC8,$314E,$41F2,$4E35,$110D,$1DD2,$3EDC
	dw $5F9D,$0821,$20E5,$39AC,$5AB4,$7FFF,$0000,$244A
	dw $30F1,$31B9,$325F,$32FF,$0422,$0864,$0C86,$1D0A
	dw $298D,$39F1,$4675,$56F9,$1484,$1CE7,$4675,$56F9
	dw $501F,$501F,$501F,$501F,$501F,$501F,$501F,$501F
	dw $7FFF,$0000,$1880,$2900,$3D86,$4E2A,$5A6D,$30E2
	dw $4DA4,$6A88,$7FB2,$1D09,$31CF,$3E11,$571B,$7FFF
	dw $0000,$19B0,$2A30,$3EB6,$4F5A,$5B9D,$1080,$1080
	dw $14E0,$2142,$31C5,$3E29,$4EAD,$5F31,$1484,$1CE7
	dw $4EAD,$5F31,$501F,$501F,$501F,$501F,$501F,$501F
	dw $501F,$501F,$7FFF,$0000,$0844,$0C69,$18CF,$2953
	dw $39D6,$0C27,$146D,$24B3,$3D9A,$0488,$08CE,$1197
	dw $267F,$7FFF,$0000,$04F2,$1572,$29F8,$3A99,$46D9
	dw $0022,$0024,$0866,$18EB,$254F,$2DB2,$4258,$56FD
	dw $1484,$1CE7,$4258,$56FD,$501F,$501F,$501F,$501F
	dw $501F,$501F,$501F,$501F,$5F7C,$0000,$10A0,$2124
	dw $29A4,$3A68,$534B,$10A8,$296E,$3E13,$5299,$20E0
	dw $29A2,$3A86,$2F55,$7FFF,$0000,$7C05,$7407,$6809
	dw $600B,$540D,$4C0F,$4011,$3414,$2C16,$2018,$181A
	dw $0C1C,$001F,$2C85,$1C69,$34F1,$4196,$2086,$392A
	dw $456E,$5611,$39EB,$5AF4,$3A68,$5373,$7FFF,$0000
	dw $2820,$4146,$560D,$72D4,$7F79,$6F35,$777F,$7FFF
	dw $6ED2,$6F35,$777C,$777F,$777F,$7FFF,$0000,$1046
	dw $210C,$39D2,$5298,$631C,$641F,$501F,$381F,$641F
	dw $501F,$381F,$1C1F,$001F,$6F35,$777C,$777C,$777F
	dw $6ED2,$6F35,$777F,$777F,$39EB,$5AF4,$6F35,$777F
	dw $7FFF,$0000,$20E5,$3DAB,$5690,$7356,$7FFF,$2D69
	dw $39CE,$4252,$39EF,$0CA5,$29AD,$3E52,$4ED6,$7FFF
	dw $0000,$1928,$218C,$25D0,$2A58,$36DB,$0422,$0C43
	dw $1064,$1885,$1CC7,$24E8,$2929,$316B,$1064,$1CC7
	dw $2929,$316B,$501F,$501F,$501F,$501F,$501F,$501F
	dw $501F,$501F,$03BF,$037F,$033F,$02FF,$02BF,$027F
	dw $023F,$01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F
	dw $001F,$03BF,$037F,$033F,$02FF,$02BF,$027F,$023F
	dw $01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F,$001F
	dw $7C1F,$7C15,$7C0B,$7C00,$7C1F,$7C15,$7C0B,$7C00
	dw $7C1F,$7C15,$7C0B,$7C00,$007F,$00BF,$00FF,$013F
	dw $017F,$01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F
	dw $037F,$03BF,$03FF,$007F,$00BF,$00FF,$013F,$017F
	dw $01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F,$037F
	dw $03BF,$03FF,$03FF,$02BF,$017F,$001F,$03FF,$02BF
	dw $017F,$001F,$03FF,$02BF,$017F,$001F,$7FFF,$0C00
	dw $5B2A,$5750,$5FB2,$5FD5,$77FB,$3E0D,$3EB4,$473A
	dw $67DF,$1860,$7FBB,$1860,$7C7C,$7FFF,$0C00,$7C1B
	dw $1048,$3492,$2634,$7C1F,$7C1B,$7C1B,$701F,$641F
	dw $501F,$381F,$1C1F,$001F,$7FFF,$0000,$3FF9,$08C0
	dw $1D40,$2DC0,$4680,$00A0,$0902,$1166,$2A6C,$04A6
	dw $0508,$116C,$1DD0,$7FFF,$1CA5,$7C00,$3487,$3108
	dw $396C,$4DD0,$4480,$4D00,$5581,$59C5,$5E09,$624D
	dw $6691,$6AD8,$7FFF,$5E44,$76E7,$774E,$77B1,$7FF4
	dw $7FF8,$7FFC,$7BFE,$381F,$571A,$6B9D,$3AAD,$4372
	dw $67FF,$7FFF,$73FB,$3D98,$49FB,$565D,$5EBF,$631F
	dw $6B7F,$2D13,$7C08,$7C08,$7C08,$7C08,$7C08,$77FD
	dw $7FFF,$38C1,$7FB3,$7FD6,$7FD9,$7FFC,$7FFF,$3E0D
	dw $3EB4,$473A,$67DF,$24C0,$7FD9,$7FFF,$7C7C,$7FFF
	dw $38C1,$4DA4,$628D,$6B11,$63B8,$67BF,$7C1B,$7C1F
	dw $701F,$641F,$501F,$381F,$1C1F,$001F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$1ABC,$09D2,$094E
	dw $04EB,$0488,$0443,$7C1F,$7C1F,$7C1F,$098F,$118C
	dw $0929,$04C6,$0464,$7C1F,$73F0,$63EC,$5368,$4AA4
	dw $63FE,$47FA,$4BD2,$4F9F,$3DEA,$2657,$1E15,$475F
	dw $36DB,$2E99,$3F1D,$73DF,$6B9F,$635F,$5B1F,$52DF
	dw $4A9D,$425B,$4F9F,$3A19,$2657,$1E15,$475F,$36DB
	dw $2E99,$3F1D,$501F,$501F,$501F,$501F,$501F,$501F
	dw $501F,$501F,$501F,$501F,$501F,$501F,$501F,$501F
	dw $501F,$14FB,$014A,$11F2,$229B,$2D28,$3569,$49CC
	dw $08CB,$152E,$0865,$14C8,$1D0A,$29AF,$3612,$562C
	dw $6339,$0000,$1465,$1465,$1465,$18A6,$1CC8,$20C7
	dw $501F,$501F,$501F,$501F,$501F,$501F,$501F,$6339
	dw $0000,$1064,$14A6,$18C8,$1D0A,$252B,$296D,$2DAF
	dw $2DF2,$116F,$114D,$0D0B,$0CE9,$08A7,$0C82,$108B
	dw $20EF,$2D95,$2A18,$3EDD,$53FF,$1DA8,$16CD,$2FB5
	dw $53FD,$7FFF,$033F,$43FF,$7FFF,$0C82,$1D46,$7C07
	dw $7C09,$7C0B,$3EDD,$7C0F,$1D46,$0DE5,$26EC,$27D5
	dw $53FD,$2D7F,$465F,$6FFF

DATA_5FB31A:
	dw $7FFF,$0000,$21C5,$46EE,$5772,$1522,$4FFF,$190A
	dw $2991,$3237,$429C,$73F3,$3E5F,$7F33,$03FF,$7FFF

DATA_5FB33A:
	dw $7C00,$7C18,$7C18,$7C18,$7C18,$7C18,$7C1B,$7C1F
	dw $701F,$641F,$501F,$381F,$1C1F,$001F,$7FFF,$1526
	dw $6BF9,$5B32,$4E6B,$3983,$3B96,$3AB0,$31CC,$2569
	dw $337C,$3296,$29B2,$1D7A,$0CCF,$7FFF,$7FFF,$4A8D
	dw $6751,$63F6,$67FD,$1923,$21A8,$2A2B,$2ED3,$5B51
	dw $5B11,$5711,$6791,$67B1,$4254,$0ADC,$065A,$05D6
	dw $0592,$052E,$010C,$128C,$124A,$1209,$11A7,$1166
	dw $1124,$111C,$1A5E,$6AB5,$522E,$41AB,$3529,$3529
	dw $0000,$1124,$354B,$3529,$3529,$41AB,$522E,$6293
	dw $6ED7,$77BD,$7FFF,$49EC,$3E2B,$4EEC,$5772,$6BDB
	dw $7FFF,$3A51,$42B5,$577B,$73DE,$2DF4,$2EB9,$379F
	dw $4FDF,$7FFF,$3D45,$292A,$256E,$3E75,$531C,$6FBF
	dw $2D8C,$4694,$67DF,$73FF,$31E8,$46C9,$57B6,$73FC
	dw $0D00,$1562,$19C5,$1628,$1A8B,$16CD,$0448,$04EB
	dw $114E,$19B1,$20E0,$3580,$4600,$0065,$1736,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$73F0,$63EC
	dw $5368,$4AA4,$63FE,$47FA,$4BD2,$4F9F,$3DEA,$2657
	dw $1E15,$475F,$36DB,$2E99,$3F1D,$7FFF,$73DF,$6B9F
	dw $635F,$5B1F,$52DF,$4A9D,$425B,$4BD2,$2B8E,$2A85
	dw $4DFE,$393E,$6F78,$5F14,$7FFF,$7FF6,$7F72,$730F
	dw $66AC,$631F,$529F,$421F,$63F8,$57F5,$4B92,$3F2F
	dw $32CC,$2669,$1A06,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$221F,$089F,$10EB,$196E,$15D4,$129C
	dw $1888,$20CA,$231F,$1530,$1997,$0CA8,$10EB,$22BF
	dw $227F,$318F,$1465,$1466,$1887,$1888,$1CA9,$20CA
	dw $250B,$292D,$2D4E,$121F,$15FC,$19B8,$2194,$2991
	dw $3148,$2506,$20E5,$18C4,$2D29,$28E7,$24C5,$1C83
	dw $0420,$2968,$2126,$18E5,$1CA4,$1462,$0C41,$5ED0
	dw $566E,$4A0C,$3DCA,$3DA9,$3567,$3147,$2906,$0420
	dw $1D2A,$1D26,$24E6,$18A7,$1883,$0C41,$0000,$0420
	dw $0C62,$1483,$1CC4,$2505,$2D47,$39A9,$4E2D,$6FDF
	dw $7C1B,$7C1B,$7C1B,$7C1B,$7C1B,$0000,$0000,$0000
	dw $0420,$0C62,$1483,$1CC4,$2505,$2D47,$7C1B,$7C1B
	dw $7C1B,$7C1B,$7C1B,$7C1B,$7FFF,$18C6,$28E9,$2D6C
	dw $41AF,$5671,$5F79,$6FBE,$35F0,$4675,$6EF9,$39EC
	dw $4EB1,$6F37,$7C00,$7FFF,$5BDF,$537F,$3EDF,$4F7B
	dw $42F7,$7B77,$66F5,$5E8F,$55EB,$398B,$3DFF,$77DE
	dw $73BD,$7FFF,$0000,$1C23,$3CCA,$1080,$1D01,$3984
	dw $4ACE,$08A0,$1920,$2183,$36AA,$4800,$7C00,$57F5
	dw $7FFF,$0000,$0846,$2CED,$0863,$14E7,$256B,$2E55
	dw $0103,$0D65,$1E09,$26D4,$0000,$0C00,$7C00,$7FFF
	dw $7CD9,$0000,$14A6,$2D6C,$4E74,$6F7D,$2528,$4A50
	dw $7FFE,$0063,$10E9,$216D,$0044,$10C9,$212D,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0886,$4DA7
	dw $4F75,$474B,$36E8,$6313,$6EAB,$5E09,$3D66,$2D04
	dw $539F,$475F,$431F,$369E,$090E,$0886,$7FFF,$7FFF
	dw $7FFF,$7FFF,$4F75,$474B,$36E8,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$2B3F,$0A5D,$05D8,$0131,$10C9
	dw $1885,$7C1F,$7C1F,$7C1F,$09D0,$098D,$092A,$00C7
	dw $0485,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$3B7F,$22BC,$11D6,$112E,$0D0A,$08A6,$7C1F
	dw $7C1F,$7C1F,$2ECD,$1249,$11A7,$08E5,$0882,$7C1F
	dw $67FF,$6B9F,$56BF,$45FD,$3537,$2D31,$24EB,$1CA7
	dw $577F,$2E9D,$25F7,$154F,$1509,$1085,$0C60,$67FF
	dw $4FFB,$2F6D,$26AF,$160C,$2987,$1D25,$18C0,$577F
	dw $2E9D,$25F7,$154F,$1509,$1085,$0C60,$67DF,$3BDF
	dw $3B3E,$367C,$321B,$31B9,$2557,$0C64,$0C86,$10A8
	dw $14CC,$18F0,$1D14,$2558,$7C18,$0C86,$10A8,$14CC
	dw $18F0,$1D14,$2558,$2553,$0C64,$67DF,$3BDF,$3B3E
	dw $367C,$321B,$31B9,$7C18,$7FFF,$7FB8,$7B13,$666E
	dw $61EA,$47F9,$3794,$36F1,$6F3F,$66FF,$5EBF,$567F
	dw $4E3F,$45FF,$399F,$3C1D,$401B,$4019,$4417,$4815
	dw $4C13,$5011,$500F,$540C,$580A,$5C08,$6006,$6004
	dw $6402,$6800,$0C63,$0000,$0000,$0001,$0022,$0400
	dw $0820,$0C41,$0C42,$0042,$0042,$0842,$0842,$0400
	dw $0400,$0C63,$0000,$0001,$0022,$0443,$0020,$0041
	dw $0462,$0C42,$0042,$0463,$0842,$0C63,$0400,$0821
	dw $3C1D,$401B,$4019,$4417,$4815,$4C13,$5011,$500F
	dw $540C,$580A,$5C08,$6006,$6004,$6402,$6800,$3C1D
	dw $401B,$4019,$4417,$4815,$4C13,$5011,$500F,$540C
	dw $580A,$5C08,$6006,$6004,$6402,$6800,$6402,$6004
	dw $6006,$5C08,$580A,$540C,$500F,$5011,$4C13,$4815
	dw $4417,$4019,$401B,$3C1D,$381F,$6402,$6004,$6006
	dw $5C08,$580A,$540C,$500F,$5011,$4C13,$4815,$4417
	dw $4019,$401B,$3C1D,$381F,$3C1D,$401B,$4019,$4417
	dw $4815,$4C13,$5011,$500F,$540C,$580A,$5C08,$6006
	dw $6004,$6402,$6800,$3C1D,$401B,$4019,$4417,$4815
	dw $4C13,$5011,$500F,$540C,$580A,$5C08,$6006,$6004
	dw $6402,$6800,$0C62,$0C83,$10C4,$1D45,$25A5,$31E6
	dw $3E2A,$6F7B,$66F4,$5E6D,$55E6,$6F7B,$0C62,$2D6B
	dw $4E73,$7FFF,$47DF,$2B7E,$02DF,$3379,$32B2,$535F
	dw $469C,$35D9,$3194,$2D50,$01B9,$6FDE,$6BBD,$7FFF
	dw $0863,$0C64,$1086,$14CA,$150D,$194F,$29B1,$025F
	dw $015C,$005A,$0019,$0863,$0863,$0863,$0863,$579F
	dw $579F,$579F,$579F,$579F,$579F,$579F,$579F,$579F
	dw $579F,$579F,$579F,$579F,$579F,$579F,$7FFF,$7FFE
	dw $7FDA,$7F55,$66B1,$4E0D,$3D6C,$290A,$6B7D,$4EB7
	dw $35F1,$212A,$1CE8,$1084,$0C60,$7FFF,$7FFE,$7FDA
	dw $7F55,$66B1,$4E0D,$3D6C,$290A,$6B7D,$4EB7,$35F1
	dw $212A,$1CE8,$1084,$0C60,$67FF,$6FFB,$6FB5,$6F50
	dw $5ACB,$4627,$35A7,$0C22,$1043,$1844,$24A5,$3506
	dw $4187,$45C8,$7C18,$1043,$1844,$24A5,$3506,$4187
	dw $45C8,$41C7,$0C22,$67FF,$6FFB,$6FB5,$6F50,$5ACB
	dw $4627,$55A6,$0C82,$18C9,$252C,$3DF3,$4656,$5AFC
	dw $539F,$18EF,$2197,$2EBF,$53DF,$7FFF,$0C82,$0C82
	dw $0C82,$0C82,$14C9,$7C07,$7C09,$7C0B,$3EDD,$7C0F
	dw $14A9,$2110,$2998,$2EBF,$53DF,$0C82,$0C82,$0C82
	dw $7FFF,$0864,$4997,$49FC,$4A9F,$5B5F,$6BFF,$3E0D
	dw $3EB4,$473A,$67DF,$08A9,$62DF,$08AD,$4A9F,$7FFF
	dw $0864,$7C1B,$0061,$0D48,$1DD1,$7CC0,$7C1B,$7C1B
	dw $325D,$575E,$501F,$381F,$381F,$7C7C,$529C,$1443
	dw $0C22,$1844,$2C88,$492B,$6E13,$2461,$30E1,$4944
	dw $59C4,$0000,$4A14,$0820,$6C0B,$7FFF,$1443,$6C0A
	dw $1085,$14CB,$24B2,$7C1F,$6C0A,$6C0A,$600E,$540E
	dw $400E,$280E,$0C0E,$000E,$67DF,$4F1E,$329C,$21F9
	dw $1976,$1550,$0CEA,$0486,$5F5F,$3E9D,$31F7,$214F
	dw $14E9,$0464,$0022,$679F,$46BF,$2DFE,$197B,$10F7
	dw $08D2,$088B,$0446,$5F5F,$3E9D,$31F7,$214F,$14E9
	dw $0464,$0022,$7FFF,$4D0C,$4D71,$4DB7,$4E3D,$4EDF
	dw $5F3F,$679F,$5B9F,$501F,$567A,$6B3D,$39F1,$4296
	dw $67FF,$7FFF,$7FE0,$7E20,$7C00,$4000,$1C00,$0C00
	dw $43FF,$67FF,$7FFF,$6E40,$634F,$3AFB,$1C1F,$001F
	dw $7FFF,$28C3,$3D25,$51C8,$664C,$6EAC,$7711,$7F75
	dw $570C,$381F,$4A32,$5EF8,$39A9,$424E,$67B7,$223D
	dw $223D,$223D,$223D,$223D,$223D,$223D,$223D,$223D
	dw $223D,$223D,$223D,$223D,$223D,$223D,$7FFF,$2126
	dw $2D89,$39ED,$4650,$56B4,$6317,$6F7B,$4148,$39AD
	dw $5632,$6AF5,$39A9,$424E,$67B7,$223D,$223D,$223D
	dw $223D,$223D,$223D,$223D,$223D,$223D,$223D,$223D
	dw $223D,$223D,$223D,$223D,$6339,$0000,$0441,$0C62
	dw $10A3,$14C4,$1CE5,$2106,$7C1B,$7C1B,$7C1B,$7C1B
	dw $7C1B,$7C1B,$7C1B,$6339,$0000,$0841,$10A3,$18E4
	dw $2125,$2D6A,$3DCD,$460F,$5252,$212A,$1D09,$1CE8
	dw $18A6,$1485,$7FFF,$1526,$475F,$3A3F,$1D5B,$0CB2
	dw $3B96,$3AB0,$31CC,$2569,$337C,$3296,$29B2,$1D7A
	dw $0CCF,$0000,$7FFF,$2573,$39D8,$4E9F,$4F7F,$14C8
	dw $1D4D,$25D0,$2ABF,$41B7,$41B7,$41B7,$41B7,$4E5B
	dw $7FFF,$1526,$475F,$3A3F,$1D5B,$0CB2,$3B96,$3AB0
	dw $31CC,$2569,$337C,$3296,$29B2,$1D7A,$0CCF,$0000
	dw $7FFF,$5A0E,$72B7,$7359,$73FD,$20CD,$3D74,$525A
	dw $4F3F,$6E74,$6E74,$6E74,$6E74,$7AD8,$031F,$0E74
	dw $0D50,$00EB,$0089,$027F,$0137,$00AC,$027F,$0172
	dw $004C,$0009,$0006,$0003,$0000,$7FFF,$7FF6,$7F72
	dw $730F,$66AC,$631F,$529F,$421F,$63F8,$57F5,$4B92
	dw $3F2F,$32CC,$2669,$1A06,$0000,$0001,$0423,$0425
	dw $0C47,$1069,$148B,$1CCE,$20F3,$6F9F,$401F,$401F
	dw $401F,$401F,$401F,$0000,$0000,$0000,$0001,$0423
	dw $0425,$0C47,$1069,$148B,$401F,$401F,$401F,$401F
	dw $401F,$401F,$19B5,$125D,$11F8,$0D94,$0D30,$08EC
	dw $08CA,$2214,$21D2,$2190,$1D4D,$1D0B,$1CEA,$22FF
	dw $33BF,$6AB5,$522E,$41AB,$3529,$3529,$0000,$1124
	dw $354B,$3529,$3529,$41AB,$522E,$6293,$6ED7,$77BD
	dw $63BF,$112A,$220C,$32B1,$3F17,$477C,$4FBF,$2A2F
	dw $3294,$433B,$5FFF,$114E,$1EDE,$15F4,$1A9B,$63BF
	dw $741B,$6C1B,$641C,$581C,$501C,$481C,$401D,$341D
	dw $325D,$4F1E,$1C1E,$141E,$081F,$001F,$03BF,$037F
	dw $033F,$02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F
	dw $013F,$00FF,$00BF,$007F,$001F,$03BF,$037F,$033F
	dw $02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F,$013F
	dw $00FF,$00BF,$007F,$001F,$007F,$00BF,$00FF,$013F
	dw $017F,$01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F
	dw $037F,$03BF,$03FF,$007F,$00BF,$00FF,$013F,$017F
	dw $01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F,$037F
	dw $03BF,$03FF,$03BF,$037F,$033F,$02FF,$02BF,$027F
	dw $023F,$01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F
	dw $001F,$03BF,$037F,$033F,$02FF,$02BF,$027F,$023F
	dw $01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F,$001F
	dw $007F,$00BF,$00FF,$013F,$017F,$01BF,$01FF,$023F
	dw $027F,$02BF,$02FF,$033F,$037F,$03BF,$03FF,$007F
	dw $00BF,$00FF,$013F,$017F,$01BF,$01FF,$023F,$027F
	dw $02BF,$02FF,$033F,$037F,$03BF,$03FF,$03BF,$037F
	dw $033F,$02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F
	dw $013F,$00FF,$00BF,$007F,$001F,$03BF,$037F,$033F
	dw $02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F,$013F
	dw $00FF,$00BF,$007F,$001F,$007F,$00BF,$00FF,$013F
	dw $017F,$01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F
	dw $037F,$03BF,$03FF,$007F,$00BF,$00FF,$013F,$017F
	dw $01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F,$037F
	dw $03BF,$03FF,$03BF,$037F,$033F,$02FF,$02BF,$027F
	dw $023F,$01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F
	dw $001F,$03BF,$037F,$033F,$02FF,$02BF,$027F,$023F
	dw $01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F,$001F
	dw $007F,$00BF,$00FF,$013F,$017F,$01BF,$01FF,$023F
	dw $027F,$02BF,$02FF,$033F,$037F,$03BF,$03FF,$007F
	dw $00BF,$00FF,$013F,$017F,$01BF,$01FF,$023F,$027F
	dw $02BF,$02FF,$033F,$037F,$03BF,$03FF,$03BF,$037F
	dw $033F,$02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F
	dw $013F,$00FF,$00BF,$007F,$001F,$03BF,$037F,$033F
	dw $02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F,$013F
	dw $00FF,$00BF,$007F,$001F,$007F,$00BF,$00FF,$013F
	dw $017F,$01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F
	dw $037F,$03BF,$03FF,$007F,$00BF,$00FF,$013F,$017F
	dw $01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F,$037F
	dw $03BF,$03FF,$03BF,$037F,$033F,$02FF,$02BF,$027F
	dw $023F,$01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F
	dw $001F,$03BF,$037F,$033F,$02FF,$02BF,$027F,$023F
	dw $01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F,$001F
	dw $007F,$00BF,$00FF,$013F,$017F,$01BF,$01FF,$023F
	dw $027F,$02BF,$02FF,$033F,$037F,$03BF,$03FF,$007F
	dw $00BF,$00FF,$013F,$017F,$01BF,$01FF,$023F,$027F
	dw $02BF,$02FF,$033F,$037F,$03BF,$03FF,$03BF,$037F
	dw $033F,$02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F
	dw $013F,$00FF,$00BF,$007F,$001F,$03BF,$037F,$033F
	dw $02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F,$013F
	dw $00FF,$00BF,$007F,$001F,$007F,$00BF,$00FF,$013F
	dw $017F,$01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F
	dw $037F,$03BF,$03FF,$007F,$00BF,$00FF,$013F,$017F
	dw $01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F,$037F
	dw $03BF,$03FF,$77D3,$7FF8,$7BF5,$7FF9,$7FFF,$7FF8
	dw $7FFC,$7FF2,$2585,$5B32,$7FFF,$0000,$2585,$154F
	dw $0CC9,$0000,$4B79,$63FE,$7CD9,$4F7F,$259F,$0007
	dw $7FF2,$2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9
	dw $0840,$1083,$10C6,$639E,$1D6F,$1D6D,$10C8,$639E
	dw $7FFF,$1D2B,$10C8,$639E,$0840,$54E0,$7FFF,$1482
	dw $2904,$45A9,$639E,$7FFF,$7F14,$0444,$639E,$7FF5
	dw $7FFA,$7FFF,$7FFF,$7F4E,$7EAC,$6588,$3E7A,$15B5
	dw $248D,$639E,$2928,$2928,$2928,$639E,$3E11,$314A
	dw $34E5,$0000,$3215,$46D9,$5F9F

DATA_5FC094:
	dw $46EE,$5772,$7FFF,$21C5,$291F,$7F33,$3FFF,$38DF
	dw $7E25,$73F2,$77FB,$38DF,$1CFF,$463F,$43FF,$77F8
	dw $7FFF,$62F0,$0000,$7474,$7D55,$7CD9,$0000,$2585
	dw $5B32,$7FFF,$0000,$2585,$154F,$0CC9,$4FF7,$3EED
	dw $3DAE,$7FF9,$4EFD,$4637,$3DAE,$0000,$2585,$5B32
	dw $7FFF,$0000,$2585,$154F,$0CC9,$0C23,$1465,$1CA7
	dw $7FFF,$08A5,$1508,$216B,$7FF2,$2585,$5B32,$7FFF
	dw $0000,$2585,$154F,$0CC9,$7FFF,$7FFD,$7FB9,$10C3
	dw $7FF2,$7FF8,$7FFC,$10C3,$7FFF,$7FFC,$7FF8,$10C3
	dw $7FFF,$73FC,$6BF9,$7753,$73B6,$7BF7,$7FF9,$7FFF
	dw $73B6,$7BFB,$7FF2

DATA_5FC13A:
	dw $2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9,$7FFF
	dw $6800,$3840,$2C86,$6800,$4AB9,$67FF,$7FF2,$2585
	dw $5B32,$7FFF,$0000,$2585,$154F,$0CC9,$0000,$4FFD
	dw $1773,$7FB2,$0000,$1773,$0DEC,$0000,$2585,$5B32
	dw $7FFF,$0000,$2585,$154F,$0CC9,$0000,$5773,$4235
	dw $30E2,$0000,$77F4,$6A90,$0000,$2585,$5B32,$7FFF
	dw $0000,$2585,$154F,$0CC9,$7FFF,$0000,$420F,$294D
	dw $2949,$0000,$420F,$0000,$2585,$5B32,$7FFF,$0000
	dw $2585,$154F,$0CC9,$7FFF,$0000,$4000,$639E,$3E7F
	dw $3E7D,$0C23,$7FF2,$2585,$5B32,$7FFF,$0000,$2585
	dw $154F,$0CC9,$0000,$4B79,$63FE,$7CD9,$0000,$0000
	dw $0000,$0000,$2585,$5B32,$7FFF,$0000,$2585,$154F
	dw $0CC9,$1152,$0CEB,$0CC8,$0C85,$0C85,$0CEB,$0CC8
	dw $290A,$1152,$0458,$471A,$1A9F,$1152,$0CEB,$63DF
	dw $7FFF,$573B,$027D,$7F26,$7FFF,$6F35,$0000,$420F
	dw $462E,$4E6C,$56AA,$5EE8,$6726,$7383,$7FE0,$0000
	dw $222C,$2357,$7FF9,$0000,$0934,$25DD,$0000,$2585
	dw $5B32,$7FFF,$0000,$2585,$154F,$0CC9,$0000,$0000
	dw $0000,$0000,$01FF,$00FB,$0000,$0000,$2585,$5B32
	dw $7FFF,$0000,$2585,$154F,$0CC9,$0821,$4A15,$7B78
	dw $7C05,$0821,$3570,$62AD,$7C05,$0821,$2633,$1583
	dw $7C05,$0821,$7FFF,$26A6,$0821,$152C,$0CE2,$7C05
	dw $0821,$20CA,$45C8,$7C05,$0821,$5A13,$3ADD,$7C05
	dw $0821,$3CEB,$2152,$3E32,$2DCB,$2148,$1129,$3E2C
	dw $2148,$2DCB,$1129,$3E32,$0CDF,$57BF,$1129,$1404
	dw $2DC8,$7FFF,$439E,$233B,$12FA,$1064,$11CC,$10E6
	dw $1084,$1064,$0843,$0C64,$1084,$1064,$212B,$1CA7
	dw $1485,$6B9F,$7FFF,$5B3F,$7FFF,$0886,$0D87,$0DE9
	dw $7FFF,$0886,$5153,$492E,$7FFF,$4209,$29E9,$0DE9
	dw $4DFF,$3514,$0804,$7C05,$3935,$1C8A,$0000,$420F
	dw $462E,$4E6C,$56AA,$5EE8,$6726,$7383,$7FE0

DATA_5FC328:
	dw $7E0E,$7F9C,$7EF6,$0000,$7E0E,$7EF6,$7E93,$0000
	dw $2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9,$7FFF
	dw $439F,$01BF,$0019,$437F,$01BF,$000C,$0019,$437F
	dw $0A1B,$0CA8,$0019,$335F,$097F,$5114,$7FFF,$4BFF
	dw $5F77,$6EEE,$5FFD,$6B56,$5E2C,$6EEE,$5FFD,$6357
	dw $35E6,$6EEE,$73BC,$5A52,$59F4,$2D6B,$2652,$03FF
	dw $7FF9,$2D6B,$1CE7,$0C63,$0000,$2585,$5B32,$7FFF
	dw $0000,$2585,$154F,$0CC9,$6FFF,$46D8,$190A,$0000
	dw $6FFF,$4F1A,$218E,$0000,$2585,$5B32,$7FFF,$0000
	dw $2585,$154F,$0CC9,$7CD9,$7CD9,$7CD9,$639E,$10EB
	dw $10EB,$10EB,$639E,$1D91,$152D,$0CA8,$7CD9,$7CD9
	dw $7CD9,$7CD9,$77FF,$6FDF,$675F,$7E00,$6FDF,$675F
	dw $5AFF,$0000,$2585,$5B32,$7FFF,$0000,$2585,$154F
	dw $0CC9,$7FFF,$7FDC,$7B98,$7E00,$7FDC,$7B98,$6F55
	dw $0000,$2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9
	dw $62DF,$6F5F,$671F,$6F1F,$7FFF,$6F5F,$779F,$0000
	dw $2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9,$4F9F
	dw $3657,$35AE,$7FF9,$4E9B,$39D3,$35AE,$0000,$2585
	dw $5B32,$7FFF,$0000,$2585,$154F,$0CC9,$62DF,$6F5F
	dw $671F,$6F1F,$7FFF,$6F5F,$779F,$0000,$2585,$5B32
	dw $7FFF,$0000,$2585,$154F,$0CC9,$1152,$252A,$1907
	dw $14A6,$14A6,$252A,$1907,$6E2C,$1152,$0458,$7712
	dw $67D4,$4A53,$252A,$7FB9,$1152,$0C84,$0843,$0822
	dw $0822,$0C84,$0843,$2086,$1152,$0458,$29EF,$396B
	dw $1CE7,$0C84,$3252,$46FE,$0000,$2171,$7C1F,$7C15
	dw $7C0B,$7C00,$7FF2,$2585,$5B32,$7FFF,$0000,$2585
	dw $154F,$0CC9,$7FFF,$0000,$7F79,$7FF2,$46FE,$0000
	dw $2171,$7FF2,$2585,$5B32,$7FFF,$0000,$2585,$154F
	dw $0CC9,$0A1F,$1A9F,$0997,$0000,$0A1F,$0954,$09BA
	dw $0000,$2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9
	dw $1CE7,$4210,$6739,$7C1F,$7C1F,$7C1F,$7C1F,$7FF2
	dw $2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9,$0000
	dw $0000,$0000,$7C1F,$7C1F,$7C1F,$7C1F,$7FF2,$2585
	dw $5B32,$7FFF,$0000,$2585,$154F,$0CC9,$110A,$2E55
	dw $5BBF,$7C1F,$7C1F,$7C1F,$7C1F,$7FF2,$2585,$5B32
	dw $7FFF,$0000,$2585,$154F,$0CC9,$6B7F,$7FFF,$4E3B
	dw $0000,$7474,$7D55,$7CD9,$0000,$2585,$5B32,$7FFF
	dw $0000,$2585,$154F,$0CC9,$7FFF,$0000,$2165,$7C1F
	dw $7C15,$7C0B,$7C00,$7FF2,$2585,$5B32,$7FFF,$0000
	dw $2585,$154F,$0CC9,$4F9F,$3657,$0000,$7FF9,$4E9B
	dw $39D3,$0000,$0000,$2585,$5B32,$7FFF,$0000,$2585
	dw $154F,$0CC9,$0000,$5279,$6B1F,$7CD9,$4F7F,$259F
	dw $0007,$7FF2,$2585,$5B32,$7FFF,$0000,$2585,$154F
	dw $0CC9,$24CE,$2A5F,$2532,$27F4,$27F4,$27F4,$27F4
	dw $0000,$2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9
	dw $0840,$1083,$10C6,$639E,$154F,$0089,$0046,$639E
	dw $7FFF,$1D2B,$10C8,$639E,$0840,$54E0,$7FFF,$0840
	dw $1083,$10C6,$639E,$7EEB,$5945,$1CA0,$639E,$7FFF
	dw $1D2B,$10C8,$639E,$0840,$54E0,$7FFF,$0840,$1083
	dw $10C6,$639E,$573F,$3175,$186B,$639E,$7FFF,$1D2B
	dw $10C8,$639E,$0840,$54E0,$7FFF,$46EE,$5772,$7FFF
	dw $21C5,$3E5F,$7F33,$03FF,$21C5,$2D9F,$7E0F,$7FFF
	dw $21C5,$2D9F,$2529,$03FF,$007F,$00BF,$00FF,$013F
	dw $017F,$01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F
	dw $037F,$03BF,$03FF,$03BF,$037F,$033F,$02FF,$02BF
	dw $027F,$023F,$01FF,$01BF,$017F,$013F,$00FF,$00BF
	dw $007F,$001F,$007F,$00BF,$00FF,$013F,$017F,$01BF
	dw $01FF,$023F,$027F,$02BF,$02FF,$033F,$037F,$03BF
	dw $03FF,$03BF,$037F,$033F,$02FF,$02BF,$027F,$023F
	dw $01FF,$01BF,$017F,$013F,$00FF,$00BF,$007F,$001F
	dw $007F,$00BF,$00FF,$013F,$017F,$01BF,$01FF,$023F
	dw $027F,$02BF,$02FF,$033F,$037F,$03BF,$03FF,$03BF
	dw $037F,$033F,$02FF,$02BF,$027F,$023F,$01FF,$01BF
	dw $017F,$013F,$00FF,$00BF,$007F,$001F,$007F,$00BF
	dw $00FF,$013F,$017F,$01BF,$01FF,$023F,$027F,$02BF
	dw $02FF,$033F,$037F,$03BF,$03FF,$03BF,$037F,$033F
	dw $02FF,$02BF,$027F,$023F,$01FF,$01BF,$017F,$013F
	dw $00FF,$00BF,$007F,$001F,$007F,$00BF,$00FF,$013F
	dw $017F,$01BF,$01FF,$023F,$027F,$02BF,$02FF,$033F
	dw $037F,$03BF,$03FF

DATA_5FC77E:
	dw $3BBF,$1F3F,$027F,$01DF,$027F,$1F3F,$3BBF,$7FFF
	dw $0000,$0100,$2860,$0090,$0220,$4987,$1633,$011A
	dw $0360,$5ECC,$01DD,$2039,$2AFA,$269D,$5F7D,$0000
	dw $0000,$0000,$000C,$0120,$0883,$012F,$0016,$0260
	dw $1DC8,$00D9,$0015,$01F6,$0199,$1E79,$0000,$0000
	dw $0000,$0008,$0020,$0000,$002B,$0012,$0160,$00C4
	dw $0015,$0011,$00F2,$0095,$0175,$0000,$0000,$0000
	dw $0004,$0000,$0000,$0007,$000E,$0060,$0000,$0011
	dw $000D,$000E,$0011,$0071,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0003,$000A,$0000,$0000,$000D,$0009
	dw $000A,$000D,$000D,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0006,$0000,$0000,$0009,$0005,$0006
	dw $0009,$0009,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000

DATA_5FC860:
	dw $3339,$2273,$3B46,$2281,$04DB,$6318,$4E73,$0000
	dw $7FFF,$177F,$063E,$53FC,$7F6D,$6EA7,$5DE2

DATA_5FC87E:
	dw $1A3A,$0995,$1F9F,$095D,$35AD,$7BB4,$7ACF,$0000
	dw $7FFF,$6318,$4E73,$7BB4,$47A9,$2AE4,$1E23,$56B5
	dw $4631,$6739,$4E73,$35AD,$6739,$4E73,$0000,$7FFF
	dw $5EF7,$4E73,$733F,$6739,$4E73,$35AD,$3DFF,$189D
	dw $3B46,$2281,$6716,$4E10,$7FF7,$3DCC,$5692,$1F9F
	dw $063E,$7FFF,$7F31,$7EB9,$0000,$0000,$7EE0,$03E0
	dw $7C08,$0000,$063E,$7FFF,$7C08,$0000,$7EE0,$04DF
	dw $7C08,$0000,$7EE0,$035F,$0013,$0017,$001F,$1CFF
	dw $1916,$35DE,$36DE,$0000,$0006,$0008,$000F,$088C
	dw $0D30,$3DEF,$6739,$73FF,$679F,$5F5F,$52FF,$423B
	dw $2D93,$2930,$007D,$0077,$0051,$002B,$1CE2,$7BFC
	dw $7FB7,$7ACF

DATA_5FC932:
	dw $1152,$1594,$15D6,$19F7,$1A39,$4943,$0000,$7FFF
	dw $0140,$0E20,$22A0,$3DEF,$56B5,$6B5A,$3A33,$52F9
	dw $5F7F,$4943,$55A3,$6A43,$7323,$7F70,$77FA,$7FFF
	dw $4943,$55A3,$6A43,$7FFF,$7C13,$7C1F,$7C1F,$7C1F
	dw $7C13,$7C1F,$7C1F,$7C1F,$0000,$63BF,$575C,$4AF9
	dw $3E75,$31F1,$218D,$152A,$08C6,$0463,$0022,$0000
	dw $1E3F,$1D5D,$0CB2,$7FFF,$1420,$50E7,$5FFF,$22A0
	dw $1420,$0C20,$0420,$7C13,$55A3,$6A43,$7323,$7C13
	dw $7C13,$7C13,$7C13,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0000,$5E0F,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF

DATA_5FCB2C:
	dw $0000,$294A,$318C,$39CE,$4210,$4A52,$5294,$5AD6
	dw $6318,$6739,$6B5A,$6F7B,$739C,$77BD,$7FFF

DATA_5FCB4A:
	dw $0000,$0000,$0000,$0043,$0021,$0021,$0509,$0062
	dw $0042,$0DCE,$00A5,$0084,$1E73,$0509,$00C6,$2F19
	dw $0D8C,$0108,$3FBD,$1631,$014A,$63FF,$26D6,$018C
	dw $0000,$7FFF,$7FFF,$417F,$6B9F,$6B9F,$417F,$6B9F
	dw $7FFF,$427F,$7FFF,$7FFF,$5F3F,$4ABF,$635F,$0000
	dw $7FFF,$6AFF,$521F,$6B9F,$56BF,$4A1F,$73BF,$7BDF
	dw $427F,$6BBF,$7FFF,$635F,$4EBF,$5AFF,$0000,$7FFF
	dw $521F,$6AFF,$6B9F,$4A1F,$56BF,$7BDF,$73BF,$427F
	dw $635F,$7FFF,$6BBF,$5AFF,$4EBF,$0000,$7FFF,$417F
	dw $7FFF,$6B9F,$417F,$6B9F,$7FFF,$6B9F,$427F,$5F3F
	dw $7FFF,$7FFF,$635F,$4ABF

DATA_5FCBF2:
	dw $7FFF,$0000,$001F,$023F,$037F,$03F3,$0327,$7F20
	dw $7E66,$7D77,$7C1F,$44A6,$48C7,$4CE8,$5109

DATA_5FCC10:
	dw $0000,$3B5F,$2ABF,$1A1D,$1192,$7D32,$7D32,$7D32
	dw $7D32,$7D32,$7FFF,$7D32,$7D32,$7D32,$7D32

DATA_5FCC2E:
	dw $021F,$023F,$025F,$027F,$029F,$02BF,$02DF,$02FF
	dw $031F,$033F,$035F,$037F,$039F,$03BF,$03DF,$03FF
	dw $03FE,$03FD,$03FC,$03FB,$03FA,$03F9,$03F8,$03F7
	dw $03F6,$03F5,$03F4,$03F3,$03F2,$03F1,$03F0,$03EF
	dw $03EF,$03F0,$03F1,$03F2,$03F3,$03F4,$03F5,$03F6
	dw $03F7,$03F8,$03F9,$03FA,$03FB,$03FC,$03FD,$03FE
	dw $03FF,$03DF,$03BF,$039F,$037F,$035F,$033F,$031F
	dw $02FF,$02DF,$02BF,$029F,$027F,$025F,$023F,$021F
	dw $0000,$7FFF,$4A45,$6F6A,$0286,$0371,$3BBF,$7FEF
	dw $2112,$319F,$4E73,$6F7B,$1590,$3ABD,$5BBF,$0000
	dw $7FFF,$35F6,$531D,$0286,$0371,$3BBF,$371F,$2112
	dw $359F,$4E73,$6F7B,$4151,$59F2,$6F14

DATA_5FCCEA:
	dw $001F,$14FB,$014A,$11F2,$229B,$2508,$3149,$49CC
	dw $08CB,$152E,$0865,$14C8,$1D0A,$29AF,$3612,$562D
	dw $3EBE,$14FB,$04C7,$094C,$1635,$49CC,$2508,$3149
	dw $08CB,$152E,$0865,$14C8,$1D0A,$29AF,$3612,$49CC
	dw $21DD,$14FB,$0865,$0CE9,$11D1,$3149,$49CC,$2508
	dw $08CB,$152E,$0865,$14C8,$1D0A,$29AF,$3612,$3149
	dw $1D7B,$14FB,$04C7,$094C,$1635,$2508,$3149,$49CC
	dw $08CB,$152E,$0865,$14C8,$1D0A,$29AF,$3612,$2508

DATA_5FCD6A:
	dw $4DA4,$4DC5,$51E7,$5609,$5A2B,$5E6D,$5E8E,$62B0
	dw $66D2,$6F15,$7358,$7799,$7FDC,$7FFF,$5183,$51A4
	dw $55C6,$59E8,$5E0A,$624C,$626D,$668F,$6AB1,$72F4
	dw $7737,$7B78,$7FBB,$7FFE,$5562,$5583,$59A5,$5DC7
	dw $61E9,$662B,$664C,$6A6E,$6E90,$76D3,$7B16,$7F57
	dw $7F9A,$7FDD,$5941,$5962,$5D84,$61A6,$65C8,$6A0A
	dw $6A2B,$6E4D,$726F,$7AB2,$7EF5,$7F36,$7F79,$7FBC
	dw $0000,$0000,$679F,$6FD9,$7FED,$0000,$2144,$1D51
	dw $7FF0,$0CC3,$73FF,$7BFC,$732A,$0000,$41EC,$3DF9
	dw $0000,$5B9F,$569C,$7FED,$0000,$2DF6,$28F1,$7FED
	dw $0000,$004D,$0006,$7FED,$0000,$7FFF,$561F,$1400
	dw $1820,$2061,$2482,$2CC3,$2CC3,$3525,$3D88,$45EB
	dw $4E4E,$56B1,$6777,$73BA,$6371,$73B6,$1400,$1820
	dw $2061,$2482,$2CC3,$2CC3,$3525,$3D88,$45EB,$4E4E
	dw $56B1,$6777,$73BA,$629A,$5F1C,$1400,$1820,$2061
	dw $2482,$2CC3,$2CC3,$3525,$3D88,$45EB,$4E4E,$56B1
	dw $6777,$73BA,$7AB7,$7B17

DATA_5FCE72:
	dw $5C88,$5D0C,$5D90,$5E14,$5E98,$5F1C,$579F,$6FDF
	dw $7FFF,$77FF,$6FFF,$63FF,$7AB7,$7B9B,$63FF

DATA_5FCE90:
	dw $40C6,$4509,$4D6D,$51D0,$5A34,$5B1B,$579F,$6FDF
	dw $7FFF,$77FF,$6FFF,$63FF,$7AB7,$7B9B,$63FF

DATA_5FCEAE:
	dw $2C82,$40E6,$556A,$69F0,$7E76,$6AF9,$579F,$7FFF
	dw $6FDF,$577F,$531A,$4A95,$460F,$3D8A,$3504,$1400
	dw $2402,$3865,$48A7,$498A,$49D1,$3E36,$008E,$0D12
	dw $3DB7,$3E3A,$0EDF,$1B5F,$72D8,$63FF,$3864,$3CA6
	dw $40E8,$456C,$49AE,$4DF0,$5632,$4A76,$52B8,$56FA
	dw $5B3C,$637E,$67BF,$6FFF,$6FFF,$7FFF,$7FFF,$7FFF
	dw $7FFF,$7FFF,$0012,$0494,$0D16,$1198,$1A39,$1EBB
	dw $273D,$7FFF,$7FFF,$2B7F,$7FFF,$42D7,$08AE,$08B7
	dw $08BF,$1144,$15A4,$1A05,$26A8,$332B,$3B6F,$43B3
	dw $577C,$0010,$4FF7,$73FF,$679F,$5F5F,$52FF,$423B
	dw $2D93,$2930,$007D,$0077,$0051,$002B,$1CE2,$7FFF
	dw $6B35,$39F0,$768C,$0071,$3D23,$4D85,$5DE8,$6E4B
	dw $7ECE,$1537,$21B9,$2E3C,$3ABF,$3E56,$5AF9,$6B7C
	dw $7FFF,$000D,$0015,$14BF,$085F,$109F,$211F,$3DFF
	dw $2973,$29DF,$2ABF,$0000,$0442,$0009,$5EFF,$7FFF

DATA_5FCF9E:
	dw $000D,$0015,$14BF,$085F,$109F,$211F,$3DFF,$2973
	dw $29DF,$2ABF,$0000,$0442,$0009,$5EFF,$7FFF

DATA_5FCFBC:
	dw $110B,$0000,$0120,$0983,$11E6,$1649,$1EAC,$1D80
	dw $25C2,$3225,$3A67,$42A9,$00EF,$0152,$0DB5

DATA_5FCFDA:
	dw $110B,$0000,$452C,$3CC9,$3087,$2824,$15E3,$0DA1
	dw $0560,$2512,$2D54,$3596,$00EF,$0152,$0DB5

DATA_5FCFF8:
	dw $0000,$0A01,$1643,$1A64,$22A5,$2AE7,$3328,$3749
	dw $3F8B,$47CC,$53EE,$3238,$42DB,$535E,$63DF

DATA_5FD016:
	dw $110B,$0000,$452C,$3CC9,$3087,$2824,$15E3,$0DA1
	dw $0560,$2512,$2D54,$3596,$00EF,$0152,$0DB5

DATA_5FD034:
	dw $7FFF,$0060,$08C2,$1525,$2188,$2DEB,$3A4E,$46B1
	dw $08AE,$1511,$2174,$00A9,$012D,$0CB8,$26DC

DATA_5FD052:
	dw $5294,$0060,$08C2,$1525,$00A9,$012D,$09B1,$1A35
	dw $3CC3,$4926,$5589,$192B,$1D70,$1DB6,$21FB

DATA_5FD070:
	dw $7FFF,$0000,$5BB2,$6BD5,$77F8,$73CF,$7BF4,$7FFA
	dw $7FB9,$7FFB,$43BF,$57FF,$6FFF,$1E1C,$2E9F

DATA_5FD08E:
	dw $7FFF,$0000,$538F,$5BB2,$32E6,$3B2C,$4372,$4BB8

DATA_5FD09E:
	dw $2A7A,$3ADB,$4B1C,$5B7D,$3289,$0000,$0000,$4000
	dw $4000,$4000,$4000,$4000,$4000,$4000,$4000,$4000
	dw $4000,$4000,$4000,$78E9,$7A30

DATA_5FD0C8:
	dw $7FFF,$4400,$4400,$4400,$4400,$4400,$4400,$4400
	dw $4400,$4400,$4400,$4400,$4400,$790A,$7A51,$7FFF
	dw $4800,$4800,$4800,$4800,$4800,$4800,$4800,$4400
	dw $4400,$4400,$4400,$4400,$792B,$7A72,$7FFF,$4C00
	dw $4C00,$4C00,$4C00,$4800,$4800,$4800,$4400,$4400
	dw $4400,$4400,$4400,$794C,$7A93,$7FFF,$5000,$5000
	dw $5000,$5000,$4C00,$4C00,$4C00,$4800,$4800,$4800
	dw $4800,$4800,$796D,$7AB4,$7FFF,$5400,$5400,$5400
	dw $5000,$5000,$4C00,$4C00,$4801,$4801,$4801,$4801
	dw $4801,$798E,$7AD5,$7FFF,$5800,$5800,$5800,$5400
	dw $5401,$5002,$5003,$4C04,$4C04,$4C04,$4C04,$4C04
	dw $79AF,$7AF6,$7FFF,$5C00,$5C01,$5802,$5803,$5404
	dw $5405,$5006,$4C07,$4C07,$4C07,$4C07,$4C07,$79D0
	dw $7B17,$7FFF,$6002,$6003,$5C04,$5805,$5806,$5407
	dw $5008,$4C0A,$4C0A,$4C0A,$4C0A,$4C0A,$79F1,$7B38
	dw $7FFF,$6404,$6405,$6006,$5C07,$5809,$540A,$502B
	dw $4C8D,$5110,$4C8D,$4C8D,$4C8D,$7A12,$7B59,$7FFF
	dw $6806,$6807,$6408,$600A,$5C0B,$584D,$54AE,$5110
	dw $5193,$5110,$5110,$5110,$7A33,$7B7A,$7FFF,$6C08
	dw $6809,$640B,$600C,$5C6E,$58CF,$5531,$5193,$5216
	dw $5193,$5193,$5193,$7A54,$7B9B,$7FFF,$700A,$6C0B
	dw $680D,$646F,$60D0,$5D32,$5994,$5216,$7FFF,$5699
	dw $5216,$5216,$7A75,$7B9B,$7FFF,$740C,$700D,$6C4F
	dw $68D1,$6533,$61B5,$5E17,$5699,$7FFF,$7FFF,$571C
	dw $5699,$7A96,$7B9B,$7FFF,$780E,$7430,$70B2,$6D34
	dw $6596,$6218,$5E9A,$571C,$7FFF,$7FFF,$7FFF,$571C
	dw $7AB7,$7B9B,$7FFF,$7C10,$7892,$7514,$6D96,$6A18
	dw $629A,$5F1C,$579F,$7FFF,$7FFF,$7FFF,$7FFF,$7AB7
	dw $7B9B,$7FFF,$2000,$2000,$2000,$2000,$2000,$2000
	dw $2000,$2000,$2000,$2000,$2000,$2000,$78E9,$79CD

DATA_5FD2A8:
	dw $6231,$2400,$2400,$2400,$2400,$2400,$2400,$2400
	dw $2400,$2400,$2400,$2400,$2400,$790A,$79EE,$6252
	dw $2800,$2800,$2800,$2800,$2800,$2800,$2800,$2800
	dw $2800,$2800,$2800,$2800,$792B,$7A0F,$6273,$2C00
	dw $2C00,$2C00,$2C00,$2C00,$2C00,$2C00,$2C00,$2C00
	dw $2C00,$2C00,$2C00,$794C,$7A30,$6294,$3000,$3000
	dw $3000,$3000,$3000,$3000,$3000,$3000,$3000,$3000
	dw $3000,$3000,$796D,$7A51,$62B5,$3400,$3400,$3400
	dw $3400,$3400,$3400,$3400,$3400,$3400,$3400,$3400
	dw $3400,$798E,$7A72,$62D6,$3800,$3800,$3800,$3800
	dw $3800,$3800,$3800,$3800,$3800,$3800,$3800,$3800
	dw $79AF,$7A93,$62F7,$3C00,$3C00,$3C00,$3C00,$3C00
	dw $3C00,$3C00,$3C01,$3C01,$3C01,$3C01,$3C01,$79D0
	dw $7AB4,$6318,$4000,$4000,$4000,$4000,$4000,$4001
	dw $4003,$3C45,$3C45,$3C45,$3C45,$3C45,$79F1,$7AD5
	dw $6339,$4400,$4400,$4400,$4400,$4402,$4444,$4486
	dw $40C8,$40C8,$40C8,$40C8,$40C8,$7A12,$7AF6,$635A
	dw $4800,$4800,$4800,$4802,$4845,$4887,$48C9,$452C
	dw $49B0,$452C,$452C,$452C,$7A33,$7B17,$637B,$4C00
	dw $4C00,$4C03,$4C65,$4CA8,$4D0A,$4D4D,$49B0,$4E34
	dw $49B0,$49B0,$49B0,$7A54,$7B38,$639C,$5000,$5002
	dw $5065,$50C8,$510B,$516E,$51D1,$4E34,$7FFF,$5297
	dw $4E34,$4E34,$7A75,$7B59,$63BD,$5402,$5445,$54A8
	dw $550B,$556E,$55D1,$5634,$5297,$7FFF,$7FFF,$571B
	dw $5297,$7A96,$7B7A,$63DE,$5844,$58A7,$590A,$596D
	dw $59D1,$5A34,$5A97,$571B,$7FFF,$7FFF,$7FFF,$571B
	dw $7AB7,$7B9B,$63FF,$5C86,$5CE9,$5D4D,$5DD0,$5A34
	dw $5AB7,$5B1B,$579F,$7FFF,$7FFF,$7FFF,$7FFF,$7AB7
	dw $7B9B,$63FF,$1C00,$1800,$1800,$1800,$1800,$1800
	dw $1800,$0000,$0000,$0000,$0000,$0000,$0000,$0802

DATA_5FD488:
	dw $0000,$2000,$1C00,$1C00,$1C00,$1C00,$1C00,$1C00
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0802,$0000
	dw $2400,$2000,$2000,$2000,$2000,$2000,$2000,$0000
	dw $0000,$0000,$0000,$0000,$0000,$0802,$0000,$2800
	dw $2400,$2400,$2400,$2400,$2400,$2400,$0000,$0000
	dw $0400,$0400,$0000,$0800,$0802,$0000,$2C00,$2800
	dw $2800,$2800,$2800,$2800,$2800,$0000,$0400,$0C00
	dw $0C00,$0800,$1000,$1002,$0000,$3040,$2C00,$2C00
	dw $2C00,$2C00,$2C00,$2C00,$0800,$0C00,$1400,$1400
	dw $1000,$1800,$1C02,$0000,$34A3,$3040,$3020,$3000
	dw $3000,$3000,$3000,$1000,$1400,$2000,$2000,$1C00
	dw $2000,$2C02,$0000,$3907,$34A3,$3481,$3460,$3440
	dw $3420,$3400,$1400,$1800,$2400,$2400,$2000,$2420
	dw $3882,$0000,$3D6A,$3907,$38E5,$38C2,$3880,$3860
	dw $3820,$1800,$1C00,$2C00,$2C00,$2800,$2860,$4128
	dw $0000,$49CD,$3D6A,$3D48,$3D05,$3CE2,$3CA0,$3C60
	dw $1C00,$2000,$3400,$3440,$3080,$2CA0,$516E,$0000
	dw $5230,$41AE,$418B,$4148,$4125,$40E2,$40A0,$2000
	dw $2400,$3C60,$3CC0,$3901,$3924,$5E14,$0400,$5A93
	dw $4611,$45EE,$45AB,$4567,$4524,$44E0,$2440,$2840
	dw $44E3,$4546,$4187,$45AB,$6699,$0800,$66F6,$4A75
	dw $4A32,$49EE,$49AA,$4966,$4922,$2881,$2C80,$4926
	dw $4989,$4A0D,$4E31,$6EFC,$0C00,$6F59,$4ED8,$4E94
	dw $4E50,$4E0C,$4DC8,$4D64,$2CC4,$30C3,$4D69,$4DCC
	dw $4E50,$5AB8,$775F,$1000,$77BC,$533C,$52F8,$52B4
	dw $524F,$520B,$51A6,$2CC4,$3506,$51AC,$520F,$5293
	dw $5EFB,$6F9D,$1402,$7FFF,$577F,$573B,$56F6,$5692
	dw $564D,$55E8,$2CC4,$3949,$55EF,$5652,$56D6,$573B
	dw $77DF,$1845

;@editable:bg-gradients begin
DATA_5FD64C:								; Note: BG "back area" color-gradient table, entry 0 (header byte $10 variant). 24 word BGR-15 entries, ordered bottom-of-sublevel to top, interpolated with 15 scanlines between each color. First entry of the DATA_bg_gradient_ptrs table at DATA_bg_gradient_ptrs; subsequent entries (DATA_5FD67C, $5FD6AC, ...) are sibling gradient palettes.
	dw $0822,$0822,$0822,$0822,$0822,$0822,$0C43,$0C64
	dw $1085,$14C7,$14E8,$1909,$192A,$1D4B,$1D4B,$192A
	dw $1909,$14E8,$14C7,$1085,$0C64,$0C43,$0822,$0822

DATA_5FD67C:
	dw $7FFF,$7F9F,$7F3C,$7EDA,$7E77,$7DF3,$6991,$554D
	dw $48A9,$3C66,$3024,$2024,$1426,$0C28,$186B,$246E
	dw $2CD1,$3D55,$5199,$5DFC,$6A9F,$72DF,$7F5F,$7FBF

DATA_5FD6AC:
	dw $7FFF,$6BBF,$5F7F,$4EFF,$427F,$31DF,$217B,$1916
	dw $10B2,$088E,$086B,$0848,$0845,$1045,$1C45,$2887
	dw $44EA,$516D,$5DF3,$6E55,$7EB7,$7F19,$7F7C,$7FBE

DATA_5FD6DC:
	dw $5ED5,$6717,$6F59,$7BBC,$7FFF,$7BBC,$6F59,$6717
	dw $5ED5,$5692,$4A2F,$41EC,$3989,$2D27,$24E4,$1CA2
	dw $1461,$0C20,$0000,$0000,$0000,$0000,$0000,$0000

DATA_5FD70C:
	dw $0C85,$0C85,$0C85,$0C85,$0C85,$0C85,$0C85,$0C85
	dw $0C85,$0C85,$0C85,$0C85,$18E9,$252D,$1DD6,$125F
	dw $161B,$19D8,$1DB4,$2171,$252D,$1CEA,$14C8,$0C85

DATA_5FD73C:
	dw $7FFF,$777F,$6B1F,$5E9F,$4DFB,$3D55,$30D0,$1C6A
	dw $1006,$1000,$1841,$2441,$2444,$3067,$38CA,$410D
	dw $4152,$4DD7,$5A7D,$62FF,$635F,$63BF,$6FFF,$7BFF

DATA_5FD76C:
	dw $0018,$0039,$005A,$007B,$009C,$00BD,$00DE,$00FF
	dw $017F,$01FF,$025F,$02DF,$035F,$031F,$02DF,$025F
	dw $01FF,$017F,$00FF,$00DE,$009C,$007B,$0039,$0018

DATA_5FD79C:
	dw $001F,$007F,$00BF,$00FF,$013F,$017F,$01BF,$01FF
	dw $023F,$027F,$02BF,$02FF,$033F,$037F,$03BF,$03FF
	dw $001F,$007F,$00BF,$00FF,$013F,$017F,$01BF,$01FF

DATA_5FD7CC:
	dw $5B51,$6397,$6BFC,$6BFF,$7FFF,$6BFF,$73FA,$7FF7
	dw $77B5,$6F52,$6EEE,$6AAC,$624A,$5E08,$55A6,$4D86
	dw $4565,$3D25,$3504,$2CE4,$24A3,$1C83,$1442,$1442

DATA_5FD7FC:
	dw $7BFF,$7BFF,$6BFF,$63BF,$5B7F,$575F,$4F3F,$46FF
	dw $46BF,$467F,$465F,$461F,$45DE,$45BC,$4179,$3957
	dw $4155,$4552,$4950,$4D4E,$514C,$554A,$5948,$5D46

DATA_5FD82C:
	dw $575F,$5F9F,$63BF,$67DF,$6BFF,$73FF,$77FF,$7FFF
	dw $7FFF,$7BFD,$77FC,$77FA,$77F8,$73D7,$6FB5,$6F72
	dw $6F50,$6B2E,$62CB,$5687,$4E45,$45E5,$3D65,$3505

DATA_5FD85C:
	dw $639F,$6FDF,$7FFF,$6FFC,$6FF7,$6FF2,$7FF2,$7F52
	dw $7ED2,$7E96,$76BA,$6A5A,$5E5C,$4E5F,$4EDF,$431F
	dw $537F,$3B5F,$4F9F,$5FDF,$73FF,$73FA,$7793,$7F13

DATA_5FD88C:
	dw $0000,$0823,$1047,$188B,$20AF,$28D3,$3117,$393B
	dw $417F,$419F,$45BF,$45DF,$4A1F,$4A3F,$4E5F,$4E7F
	dw $52BF,$56DF,$5EFF,$633F,$6B5F,$6F9F,$77BF,$7FFF

DATA_5FD8BC:
	dw $7FFF,$7FFE,$7BFD,$7BFC,$77FA,$77F9,$73F8,$6FF6
	dw $6FD6,$6FB5,$6F94,$6F73,$6F53,$6F32,$6F11,$6ED0
	dw $6AAF,$668D,$5E6C,$5A4A,$5628,$4E07,$49E5,$41A3

DATA_5FD8EC:
	dw $039F,$02BF,$01DF,$013F,$013A,$0CD6,$1891,$288E
	dw $3C8E,$4CEB,$5547,$5DA4,$5163,$4101,$28A0,$1840
	dw $1804,$2C88,$388B,$3890,$3896,$451A,$5A1F,$6ABF

DATA_5FD91C:
	dw $125F,$1E7F,$2EBF,$3ADF,$4B1F,$573F,$4F1F,$46FF
	dw $3EDF,$36DF,$2ABF,$229F,$1A7F,$125F,$123F,$121F
	dw $11FF,$11DF,$11BF,$119F,$115E,$0D1D,$0CDC,$089B
;@editable:bg-gradients end

DATA_5FD94C:
	dw $001F,$0012,$0004,$7C1B,$000E,$0007,$0000,$03FF
	dw $0212,$0004,$7C1B,$01CE,$00E7,$0000,$03E0,$0202
	dw $0004,$7C1B,$01C0,$00E0,$0000,$7C00,$4002,$0004
	dw $7C1B,$3800,$1C00,$0000

DATA_5FD984:
	dw $03FF

DATA_5FD986:
	dw $03FF

DATA_5FD988:
	dw $03FF

DATA_5FD98A:
	dw $0000,$0000,$0000,$7E60,$7F2C,$7E60,$7F2C,$7F0A
	dw $7EC6,$7EC6,$7EA4,$7EE8,$7EA4,$7F2C,$7EE8,$7EE8
	dw $7F0A,$7EE8,$7EA4,$7EA4,$7F2C,$7EC6,$7F0A,$7EC6
	dw $7F2C,$7E60,$7E60,$7F2C,$7EA4,$7F2C,$7EA4,$7F2C
	dw $7E60,$7E60,$7F2C,$7EC6,$7F0A,$7EC6,$7EE8,$7EA4
	dw $7EA4,$7F2C,$7EE8,$7EE8,$7F0A,$7EA4,$7EE8,$7EA4
	dw $7F2C,$7F0A,$7EC6,$7EC6,$7E60,$7F2C,$7E60,$7F2C
	dw $7F2C,$7EA4,$7EA4

DATA_5FDA00:
	dw $7375,$6B13,$4A0C,$3DCA,$3DA9,$3567,$3147,$2906
	dw $5ED0,$566E,$5A90,$4E4E,$3DA9,$3567,$3147,$2906
	dw $5ED0,$566E,$4A0C,$3DCA,$45EB,$3DA9,$3147,$2906
	dw $5ED0,$566E,$4A0C,$3DCA,$3DA9,$3567,$3568,$2D27
	dw $5ED0,$566E,$4A0C,$3DCA,$3DA9,$3567,$3147,$2906
	dw $5ED0,$566E,$4A0C,$3DCA,$3DA9,$3567,$3147,$2906
	dw $5ED0,$566E,$4A0C,$3DCA,$3DA9,$3567,$3147,$2906
	dw $5ED0,$566E,$4A0C,$3DCA,$3DA9,$3567,$3147,$2906

DATA_5FDA80:								; Note: Hookbill the Koopa shell palette.
	dw $0000,$7FFF,$591F,$591F,$591F,$591F,$591F,$250C
	dw $2510,$1CF5,$00DA,$001F,$3DD2,$4EF7,$67BD

DATA_5FDA9E:
	dw $7EFB

DATA_5FDAA0:
	dw $0000,$2972,$1A3C,$035F,$43DF,$20CC,$00F3,$001F
	dw $4A54,$5B18,$6B9C,$7FFF,$0000,$0000,$0000

DATA_5FDABE:
	dw $7FFF

DATA_5FDAC0:
	dw $0000,$20CD,$2972,$1A3C,$02DF,$1066,$20CE,$00F7
	dw $316E,$4A54,$5B18,$52DA,$5F3D,$677F,$6FDF,$0000
	dw $4B9F,$4B9F,$3B1C,$25B3,$0000,$4B9F,$63DF,$73FF
	dw $0000,$7FFF,$7FFF,$7FFF,$731B,$7FFF,$7FFF,$7FFF
	dw $30F1,$3E38,$7FFF,$3715,$3B9A,$43FC,$1AFF,$0000
	dw $1BFF,$3958,$49FF,$7737,$66EE,$7374,$7FF9,$254D
	dw $4273,$7FFF,$3127,$45AD,$4613,$5B7E,$0000,$5BFF
	dw $38D8,$493F,$5ADD,$4D26,$7E91,$66F4,$254D,$641F
	dw $641F,$266F,$2F15,$3BBB,$641F,$641F,$641F,$3E34
	dw $52D9,$677D,$641F,$641F,$641F,$0000,$4B9F,$4B9F
	dw $3B1C,$25B3,$0000,$4B9F,$3B1C,$25B3,$0000,$7FFF
	dw $7FFF,$7FFF,$731B,$7FFF,$7FFF,$7FFF,$414A,$4253
	dw $7FFF,$4E07,$5EF0,$5778,$22FF,$0000,$2F7F,$4FFF
	dw $3958,$7737,$4EFB,$575D,$5FBF,$254D,$4273,$7FFF
	dw $3127,$45AD,$4613,$420D,$0000,$56F3,$6375,$38D8
	dw $5ADD,$4E07,$5EF0,$5778,$216E,$2273,$7FFF,$2A27
	dw $3AEA,$5BB1,$32D2,$0000,$4356,$53FE,$67DF,$177F
	dw $2A12,$3A77,$4F3F,$0000,$4B9F,$4B9F,$3B1C,$25B3
	dw $0000,$4B9F,$3B1C,$25B3,$0000,$7FFF,$7FFF,$7FFF
	dw $731B,$7FFF,$7FFF,$7FFF,$414A,$4253,$7FFF,$2EEF
	dw $2F76,$2FFC,$1E4D,$0000,$3B56,$43FC,$3958,$7737
	dw $5A99,$5ADD,$5B3F,$254D,$4273,$7FFF,$3127,$45AD
	dw $4613,$32C9,$0000,$4350,$53F9,$38D8,$5ADD,$4E07
	dw $5EF0,$5778,$150B,$2273,$7FFF,$32C9,$4350,$53F9
	dw $266F,$0000,$2F15,$3BBB,$493F,$177F,$35B2,$4E77
	dw $673D,$0000,$4B9F,$4B9F,$3B1C,$25B3,$1E9F,$2F1F
	dw $43DF,$1F3F,$0000,$2F5F,$53FF,$7FFF,$731B,$7FFF
	dw $7FFF,$7FFF,$414A,$4253,$7FFF,$25D9,$365C,$4B1E
	dw $6E96,$0000,$7F3B,$7FDF,$3958,$7737,$4EAD,$6353
	dw $6399,$254D,$4273,$7FFF,$3127,$45AD,$4613,$3AB4
	dw $0000,$3AF9,$3B7F,$38D8,$5ADD,$3916,$4E1B,$52FF
	dw $216E,$2273,$7FFF,$2539,$35DC,$4A7E,$329A,$0000
	dw $433D,$53DF,$67DD,$177F,$66D9,$6F3B,$7B9E,$0000
	dw $4B9F,$4B9F,$3B1C,$25B3,$26EF,$4353,$5FB9,$3F4F
	dw $0000,$5393,$73F9,$7FFF,$731B,$7FFF,$7FFF,$7FFF
	dw $51F0,$4EB7,$7FFF,$6F14,$7FDA,$7FDD,$6E96,$0000
	dw $7F3B,$7FDF,$3958,$7737,$66AC,$6F14,$7FDA,$254D
	dw $4273,$7FFF,$3127,$45AD,$4613,$66D9,$0000,$6F3B
	dw $7B9E,$38D8,$5ADD,$5667,$6332,$5398,$5E54,$56F9
	dw $7FFF,$7757,$7FDC,$7FDE,$329A,$0000,$433D,$53DF
	dw $67DD,$177F,$4664,$6332,$5398,$0000,$4B9F,$4B9F
	dw $3B1C,$25B3,$26EF,$4353,$5FB9,$3F4F,$0000,$5393
	dw $73F9,$7FFF,$731B,$1902,$19CE,$2E76,$51F0,$4EB7
	dw $6FFF,$35AD,$4E73,$6739,$3127,$0000,$4613,$42FD
	dw $3958,$7737,$4AD3,$4B39,$4BBE,$254D,$4273,$7FFF
	dw $177F,$17BF,$7FFF,$231F,$0000,$2F3F,$3B7F,$4A0C
	dw $5ADD,$15FF,$1A3F,$1F3F,$5E54,$56F9,$7FFF,$4A94
	dw $5B7C,$63FF,$4A6D,$0000,$4AD3,$4B39,$4A0C,$177F
	dw $28A0,$3961,$4A27,$1084,$7FFF,$223A,$338C,$22C8
	dw $09D4,$054E,$110A,$437F,$7C1F,$7C1F,$7C1F,$4B9F
	dw $3B1C,$2E78,$1084,$7FFF,$223A,$231F,$021F,$011F
	dw $0114,$110A,$437F,$7D0A,$7DCE,$7E70,$7FFF,$235D
	dw $127B,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F
	dw $7C1F,$7FFF,$431F,$01DF,$33BF,$33BF,$037F,$4FF0
	dw $4FF0,$67F7,$7F92,$7FB7,$7FFF,$7F7B,$7FFF,$7FFF
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7EFF,$7EFF,$7FFF,$5F1F
	dw $425F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$3DFF
	dw $189D,$3B46,$2281,$5692,$4E10,$6716,$0000,$7FFF
	dw $1F9F,$0ABF,$7FF7,$7F31,$7EB9,$3DCC,$1084,$7FFF
	dw $223A,$7F52,$6E88,$7DD8,$6D94,$6318,$0912,$7C1F
	dw $7C1F,$7C1F,$3388,$2F27,$2686,$1084,$7FFF,$223A
	dw $5992,$452D,$721F,$48DB,$6318,$0912,$7C1F,$7C1F
	dw $7C1F,$185F,$145B,$1032

DATA_5FDF88:
	dw $7F52,$7EED,$7E04

DATA_5FDF8E:
	dw $7DDA,$7DB7,$7D52

DATA_5FDF94:
	dw $3388,$2F27,$2686

DATA_5FDF9A:
	dw $0996,$0553,$00CE

DATA_5FDFA0:
	dw $131F,$0A1F,$0956

DATA_5FDFA6:
	dw $185F,$145B,$1032

DATA_5FDFAC:
	dw $6E1F,$599E,$309C

DATA_5FDFB2:
	dw $514E,$410B,$2086

DATA_5FDFB8:
	dw $7C1F,$7C1F,$7C1F

DATA_5FDFBE:
	dw $7C1F,$7C1F,$7C1F

DATA_5FDFC4:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $7FFF,$431F,$01DF

DATA_5FDFCA:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $33BF,$33BF,$037F

DATA_5FDFD0:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $4FF0,$4FF0,$67F7

DATA_5FDFD6:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $7F92,$7FB7,$7FFF

DATA_5FDFDC:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $7F7B,$7FFF,$7FFF

DATA_5FDFE2:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $7FFF,$7FFF,$7FFF

DATA_5FDFE8:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $7FFF,$7EFF,$7EFF

DATA_5FDFEE:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $7FFF,$5F1F,$425F

DATA_5FDFF4:
	dw $7FFF

DATA_5FDFF6:
	dw $6F35

DATA_5FDFF8:
	dw $1084,$1083

DATA_5FDFFC:
	dw $3339,$2273,$3DFF,$189D,$04DB,$5FF5,$7C0E,$0000
	dw $7FFF,$177F,$063E,$733F,$7F6D,$6EA7,$5DE2,$18C6
	dw $5B1B,$3637,$2592,$18C6,$18C6,$18C6,$18C6,$18C6
	dw $2585,$5B32,$7FFF,$18C6,$2585,$154F,$0CC9,$7FFF
	dw $0000,$001F,$023F,$037F,$03F3,$0327,$7F20,$7E66
	dw $7D77,$7C1F,$44A6,$48C7,$4CE8,$5109,$7FFF,$0000
	dw $5FFF,$7FF7,$7F73,$677F,$5EFF,$57BF,$3F3F,$3DEF
	dw $18C6,$18C6,$18C6,$18C6,$18C6,$7FFF,$0000,$36BA
	dw $2E56,$25F2,$3DF1,$252B,$0C65,$2585,$36BA,$2E56
	dw $25F2,$16FF,$167F,$15FF,$3E34,$2DB0,$1D2C,$18C6
	dw $18C6,$18C6,$18C6,$5AD7,$2585,$5B32,$7FFF,$5AD7
	dw $2585,$154F,$0CC9,$7FFF,$0000,$001F,$023F,$037F
	dw $03F3,$0327,$7F20,$7E66,$7D77,$7C1F,$44A6,$48C7
	dw $4CE8,$5109,$7FFF,$0000,$0180,$02A0,$03E0,$36B5
	dw $4B7C,$63BE,$40C0,$65E9,$7F72,$0014,$001F,$01FF
	dw $031F,$7FFF,$0000,$294A,$7FD7,$7B74,$7711,$72AE
	dw $6E4B,$2585,$259F,$14FA,$0037,$16FF,$167F,$15FF
	dw $5BDF,$3B5D,$2A99,$18C6,$18C6,$18C6,$18C6,$18C6
	dw $2585,$5B32,$7FFF,$18C6,$2585,$154F,$0CC9,$7FFF
	dw $0000,$001F,$023F,$037F,$03F3,$0327,$7F20,$7E66
	dw $7D77,$7C1F,$44A6,$48C7,$4CE8,$5109,$7FFF,$0000
	dw $36B5,$4B7C,$63BE,$7357,$7FBA,$7FBD,$40C0,$65E9
	dw $7F72,$0014,$001F,$01FF,$031F,$7FFF,$0000,$294A
	dw $4E73,$66B3,$7316,$7FBA,$5F9F,$2585,$498B,$4149
	dw $3907,$16FF,$167F,$15FF,$7FF9,$6F75,$5EF1,$18C6
	dw $18C6,$18C6,$18C6,$18C6,$2585,$5B32,$7FFF,$18C6
	dw $2585,$154F,$0CC9,$7FFF,$0000,$001F,$023F,$037F
	dw $03F3,$0327,$7F20,$7E66,$7D77,$7C1F,$44A6,$48C7
	dw $4CE8,$5109,$7FFF,$0000,$7FFD,$0368,$7E27,$087F
	dw $03BF,$5FFF,$2585,$724B,$6A09,$61C7,$001E,$001E
	dw $001E,$7FFF,$0000,$4231,$0240,$5940,$0014,$0233
	dw $0000,$2585,$71A6,$7FD9,$62B0,$16FF,$167F,$15FF
	dw $7FDE,$735A,$62D6,$18C6,$18C6,$18C6,$18C6,$18C6
	dw $2585,$5B32,$7FFF,$18C6,$2585,$154F,$0CC9,$7FFF
	dw $0000,$001F,$023F,$037F,$03F3,$0327,$7F20,$7E66
	dw $7D77,$7C1F,$44A6,$48C7,$4CE8,$5109,$7FFF,$0000
	dw $4A10,$539C,$3EF7,$2E73,$0000,$0000,$7FFF,$4A3F
	dw $7F6D,$6FFD,$5F79,$0000,$0000,$7FFF,$0000,$294A
	dw $565F,$359E,$36BA,$2E56,$579A,$2585,$3EB1,$324B
	dw $25C9,$16FF,$167F,$15FF,$6ADE,$563B,$45B7,$18C6
	dw $18C6,$18C6,$18C6,$18C6,$2585,$5B32,$7FFF,$5AD7
	dw $2585,$154F,$0CC9,$7FFF,$0000,$001F,$023F,$037F
	dw $03F3,$0327,$7F20,$7E66,$7D77,$7C1F,$44A6,$48C7
	dw $4CE8,$5109,$7FFF,$0000,$0180,$02A0,$03E0,$36B5
	dw $4B7C,$63BE,$40C0,$65E9,$7F72,$0014,$001F,$01FF
	dw $031F,$7FFF,$0000,$294A,$76F5,$7F37,$6EB3,$494B
	dw $3CE8,$2585,$38C7,$34A6,$2843,$16FF,$167F,$15FF

DATA_5FE2EC:
	dw $02BF,$037F,$001F,$01FF

DATA_5FE2F4:
	dw $01FF,$02BF,$037F,$001F

DATA_5FE2FC:
	dw $001F,$01FF,$02BF,$037F

DATA_5FE304:
	dw $037F,$001F,$01FF,$02BF

DATA_5FE30C:
	dw $7FFF,$7FFF,$7FFF

DATA_5FE312:
	dw $6B5C,$7FFF,$7FFF

DATA_5FE318:
	dw $4A53,$6B5C,$7FFF

DATA_5FE31E:
	dw $2108,$4A53,$7FFF

DATA_5FE324:
	dw $0000,$2108,$6B5C

DATA_5FE32A:
	dw $0000,$0000,$4A53

DATA_5FE330:
	dw $0000,$0000,$2108

DATA_5FE336:
	dw $0000,$0000,$0000,$7C00

DATA_5FE33E:
	dw $3E7F,$3E7D,$0000

DATA_5FE344:
	dw $7C00,$637D,$4A75,$0000

DATA_5FE34C:
	dw $7C00,$001F,$0014,$0000,$7FFF,$0000,$0CEF,$1D55
	dw $321B,$7E4C,$7F10,$30A6,$416B,$5230,$62F5,$34E5
	dw $314A,$3E11,$571B,$7FFF,$0000,$7C00,$7C00,$7C00
	dw $291F,$599F,$1991,$1A15,$08AC,$00F0,$0173,$01F6
	dw $02BB,$2B7F,$4A52,$0000,$3915,$220C,$1110,$318C
	dw $4A52,$188A,$2086,$0024,$0446,$0C88,$10CB,$14EC
	dw $1990,$4A52,$0000,$2252,$20D0,$41CA,$6336,$77DB
	dw $30CC,$18C8,$0466,$00C8,$04CA,$192B,$7C00,$7C00

DATA_5FE3CC:
	dw $7FFF,$0000,$0345,$51A0,$7FFF,$0000,$001F,$51A0
	dw $3A08,$0000,$03FF,$51A0,$7FFF,$0000,$7C00

DATA_5FE3EA:
	dw $7FFF,$0000,$0CE8,$154D,$1DD1,$2636,$2EBA,$373F
	dw $479F,$5FFF,$7FFF,$24A0,$7E60,$6F7F,$5FFF,$6FFB

DATA_5FE40A:
	dw $6C04,$0000,$7FFF,$24A0,$2CE1,$3529,$416D,$51B1
	dw $5E12,$6692,$6AF2,$6F52,$73B4,$6BF8,$63FC,$5FFF

DATA_5FE42A:
	dw $5C08,$0000,$7FFF,$154D,$1DD1,$2636,$2EBA,$373F
	dw $479F,$5FFF,$55B2,$5E12,$6692,$6AF2,$6F52,$5FFF

DATA_5FE44A:
	dw $480D,$0000,$7FFF,$0CE8,$1DD1,$2EBA,$2E71,$4B79
	dw $24A0,$2CE1,$416D,$5FFF,$7F26,$7F26,$24A0,$24A0

DATA_5FE46A:
	dw $3811,$0000,$7FFF,$6C04,$3231,$42F7,$4F7B,$55EB
	dw $5E8F,$66F5,$7B77,$3EDF,$4F5F,$57BF,$3DCC,$5FFF

DATA_5FE48A:
	dw $7BFF,$042B,$0433,$043D,$05FD,$3FDE,$0B1E,$0602
	dw $1F4C,$2FD7,$2A06,$3AF3,$57B9,$6BDF

DATA_5FE4A6:
	dw $77FF,$084B,$0852,$087B,$09FB,$3FBD,$12FC,$0A04
	dw $230D,$2F97,$29E7,$3AD3,$5799,$67BE

DATA_5FE4C2:
	dw $73FF,$0C6A,$0C71,$0C98,$11F9,$439C,$1AFB,$0DE6
	dw $22EE,$2F57,$29C8,$3AB3,$5379,$639E

DATA_5FE4DE:
	dw $6FDF,$108A,$10AF,$14D6,$15D7,$437B,$22D9,$15E8
	dw $26AF,$3337,$29A8,$3A72,$5359,$637D

DATA_5FE4FA:
	dw $6BDF,$14A9,$14CE,$18F3,$1DD5,$475A,$2AD8,$19CA
	dw $2690,$32F7,$2989,$3A52,$4F39,$5F5D

DATA_5FE516:
	dw $67DF,$18C9,$18ED,$1D31,$21D3,$4739,$32B6,$1DCC
	dw $2A51,$32B7,$296A,$3A32,$4F19,$5B3C

DATA_5FE532:
	dw $5F9F,$1CE8,$212B,$256E,$29B1,$4AF7,$3A94,$25AF
	dw $2E13,$3677,$254B,$35F1,$4AD9,$571B

DATA_5FE54E:
	dw $0000,$7FFF,$7FFF,$7FFF,$7FDF,$7FBF,$7F7D,$773B
	dw $6EB8,$6255,$59D2,$4D6F,$44EC,$3CAA,$7C1F,$7C1F
	dw $0000,$6ADF,$6ABE,$669C,$625A,$5E38,$59F7,$55D5
	dw $51B3,$4D71,$4950,$450E,$40EC,$3CAA,$7C1F

DATA_5FE58C:
	dw $3DCC,$7FFF,$429F,$435F,$3DCC,$3DCC,$3DCC,$7FFF
	dw $7FFF,$7FFF,$3DCC,$3DCC,$3DCC,$3DCC,$3DCC

DATA_5FE5AA:
	dw $24A0,$24A0,$24A0,$24A0,$24A0,$24A0,$24A0,$24A0
	dw $24A0,$24A0,$24A0,$24A0,$24A0,$24A0,$24A0

DATA_5FE5C8:
	dw $24A0,$24A0,$24A0,$24A0,$24A0,$24A0,$24A0,$24A0
	dw $24A0,$24A0,$24A0,$24A0,$24A0,$5FFF,$24A0

DATA_5FE5E6:
	dw $3DCC,$3ACE,$3E19,$4258,$3B4E,$39FF,$633F,$427F
	dw $3FEF,$3F1F,$3F1F,$537F,$6B7F,$73BF,$7FFF

DATA_5FE604:
	dw $0BBF,$137F,$1B3F,$22FF,$2ABF,$327F,$3A3F,$41FF
	dw $49BF,$517F,$593F,$60FF,$68BF,$707F,$7C1F

DATA_5FE622:
	dw $7E60,$7E60,$24A0,$24A0,$24A0,$24A0,$7E60,$7E60
	dw $7E60,$7E60,$24A0,$24A0,$24A0,$5FFF,$24A0

DATA_5FE640:
	dw $0000,$1936,$25BA,$2E1C,$367D,$3ABE,$42FE,$471E
	dw $473E,$4B5E,$4B7E,$4F9E,$53BE,$57DF,$0000,$401F
	dw $0000,$2CE0,$1D6B,$29AD,$4143,$4D85,$5DE9,$4694
	dw $4ED6,$5B18,$768E,$7AD0,$7F31,$7FFF,$0000

DATA_5FE67E:
	dw $0000,$5E32,$5E37,$5EBC,$5F1F,$5F7F,$67BF,$6FFF
	dw $77FF,$7FFF,$7FFF,$7FFF,$7FFE,$7FFD,$501F,$4400
	dw $0000,$2CE2,$3904,$4D46,$5988,$65CB,$724D,$7EB0
	dw $7EF4,$7F36,$7F78,$7FB9,$7FDA,$7FFC,$501F

DATA_5FE6BC:
	dw $0000,$5951,$69F6,$7A7B,$7ABD,$7AFF,$7B3F,$7B9F
	dw $7BBF,$7FDF,$7FFF,$7FFF,$7FFF,$7FFF,$501F

DATA_5FE6DA:
	dw $0000,$7FFF,$013F,$02BF,$0000,$0000,$0000,$7FFF
	dw $7FFF,$7FFF,$0000,$0000,$0000,$0000,$0000

DATA_5FE6F8:
	dw $03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF
	dw $03FF,$03FF,$03FF,$03FF,$03FF,$03FF,$03FF

DATA_5FE716:
	dw $0000,$7FFF,$013F,$02BF,$008D,$00B2,$0067,$00B2
	dw $00B2,$7FFF,$00B2,$7FFF,$7FFF,$00B2,$0067

DATA_5FE734:
	dw $0000,$7FFF,$013F,$02BF,$00B4,$00FF,$7FFF,$00FF
	dw $7FFF,$00FF,$7FFF,$7FFF,$00FF,$00FF,$00AB,$0000
	dw $14D5,$213B,$2D9D,$35DF,$39FF,$3E1F,$423F,$465F
	dw $4E9F,$4EBF,$52DF,$56FF,$571F,$0000,$0893,$14F6
	dw $1919,$215B,$257D,$299E,$2DBE,$31DF,$3A1F,$3A3F
	dw $3E5F,$427F,$469F,$0000,$006F,$0090,$08B2,$10D4
	dw $14F6,$1918,$1D39,$215A,$297B,$299C,$2DBD,$31DE
	dw $35FF

DATA_5FE7A6:
	dw $0000,$004D,$0050,$0053,$0075,$0077,$0078,$0079
	dw $009A,$009B,$009C,$009D,$009E,$009F,$571F,$56FF
	dw $52DF,$4EBF,$469F,$427F,$3E5F,$3A3F,$35FF,$31DE
	dw $2DBD,$299C

DATA_5FE7DA:
	dw $009F,$009E,$009D,$009C,$423F,$465F,$4E9F,$4EBF
	dw $2DBE,$31DF,$3A1F,$3A3F,$1D39,$215A,$297B,$299C

DATA_5FE7FA:
	dw $0079,$009A,$009B,$009C

DATA_5FE802:
	dw $6B1F,$779F,$7FFF,$7FFF,$779F,$6B1F,$5E9F,$4DFF
	dw $45BC,$3958,$2D14,$24B0,$186C,$0C08,$7C00,$7C00
	dw $45D9,$3D97,$3935,$34F4,$30B3,$2C72,$2831,$240F
	dw $200E,$1C0D,$180C,$140B,$100A,$0C08

DATA_5FE83E:
	dw $03FF,$0000,$56D3,$6336,$6B79,$73BB,$77DD,$7BFE
	dw $7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF

DATA_5FE85A:
	dw $7FFF,$0000,$34E9,$416C,$4E0F,$5671,$5AB2,$5EF4
	dw $6335,$6777,$6FBA,$73DC,$77FD,$7BFE,$7FFF

DATA_5FE878:
	dw $0000,$14C4,$18E5,$1D06,$2127,$2127,$2548,$2548
	dw $2548,$2548,$2548,$2548,$2548,$2548

DATA_5FE894:
	dw $0000,$0801,$0C22,$1043,$1063,$14A4,$14C4,$18E5
	dw $1D06,$1D06,$2127,$2127,$2548,$2548

DATA_5FE8B0:
	dw $001A,$001D,$001F,$001F,$001D,$001A,$0017,$0015
	dw $0012,$000F,$000D,$000A,$0007,$0004,$7C1B,$7C18
	dw $0013,$0011,$000F,$000E,$000D,$000C,$000B,$000A
	dw $0009,$0008,$0007,$0006,$0005,$0004,$7C18,$033A
	dw $039D,$03FF,$03FF,$039D,$033A,$02D7,$0275,$0212
	dw $01AF,$014D,$00EA,$0087,$0004,$7C14,$7C10,$0273
	dw $0231,$01EF,$01CE,$01AD,$018C,$016B,$014A,$0129
	dw $0108,$00E7,$00C6,$00A5,$0084,$7C10,$0320,$0380
	dw $03E0,$03E0,$0380,$0320,$02C1,$0261,$0202,$01A2
	dw $0142,$00E3,$0083,$0004,$7C0C,$7C08,$0260,$0220
	dw $01E0,$01C0,$01A0,$0180,$0160,$0140,$0120,$0100
	dw $00E0,$00C0,$00A0,$0080,$7C08,$6400,$7000,$7C00
	dw $7C00,$7000,$6400,$5801,$4C01,$4002,$3402,$2802
	dw $1C03,$1003,$0004,$7C04,$7C00,$4C00,$4400,$3C00
	dw $3800,$3400,$3000,$2C00,$2800,$2400,$2000,$1C00
	dw $1800,$1400,$1000,$7C00

DATA_5FE9A8:
	dw $7FFF,$43FF,$435F,$42BF,$421F,$621F,$7E1F,$7E1A
	dw $7E15,$7E10,$7EB0,$7F50,$7FF0,$63F0,$43F0

DATA_5FE9C6:
	dw $43F8,$0000,$53B8,$5BDB,$67FD,$6FFF,$7FFF,$7FFF
	dw $77FF,$6BFF,$67FE,$63FD,$5FFC,$5BFA

DATA_5FE9E2:
	dw $57F9,$0000,$2525,$2D86,$31E7,$3648,$3A8C,$3ED0
	dw $4312,$4354,$4775,$4B96,$4FB7,$53D8,$57F9

DATA_5FEA00:
	dw $7BDE,$296B,$2D8F,$35D5,$4A77,$522E,$6292,$7758
	dw $7B39,$3E35,$3E35,$6319,$6319,$5E72,$5E72

DATA_5FEA1E:
	dw $7BDE,$296B,$35D6,$4A7C,$5B3F,$4290,$4B13,$5FB8
	dw $7B39,$3E35,$471A,$6319,$7BDF,$5E72,$7B39

DATA_5FEA3C:
	dw $0000,$0180,$0000,$10D2,$02A0,$4A6F,$36B5,$111F
	dw $03E0,$01B9,$025F,$271F,$4B7C,$63BE,$7FFF

DATA_5FEA5A:
	dw $6AB5,$522E,$41AB,$3529,$3529,$0000,$1124,$354B
	dw $3529,$3529,$41AB,$522E,$6293,$6ED7,$77BD

DATA_5FEA78:
	dw $6AB5,$6AB5,$522E,$41AB,$3529,$0000,$1162,$77BD
	dw $354B,$3529,$3529,$41AB,$522E,$6293,$6ED7

DATA_5FEA96:
	dw $6AB5,$6AB5,$6AB5,$522E,$3529,$0000,$1162,$6ED7
	dw $77BD,$354B,$3529,$3529,$41AB,$522E,$6293

DATA_5FEAB4:
	dw $6AB5,$6AB5,$6AB5,$6AB5,$3529,$0000,$1162,$6293
	dw $6ED7,$77BD,$354B,$3529,$3529,$41AB,$522E

DATA_5FEAD2:
	dw $6AB5,$6AB5,$6AB5,$6AB5,$3529,$0000,$1162,$522E
	dw $6293,$6ED7,$77BD,$354B,$3529,$3529,$41AB

DATA_5FEAF0:
	dw $6AB5,$6AB5,$6AB5,$522E,$3529,$0000,$1162,$41AB
	dw $522E,$6293,$6ED7,$77BD,$354B,$3529,$3529

DATA_5FEB0E:
	dw $6AB5,$6AB5,$522E,$41AB,$3529,$0000,$1162,$3529
	dw $41AB,$522E,$6293,$6ED7,$77BD,$354B,$3529

DATA_5FEB2C:
	dw $6AB5,$522E,$41AB,$3529,$3529,$0000,$1162,$3529
	dw $3529,$41AB,$522E,$6293,$6ED7,$77BD,$354B

DATA_5FEB4A:
	dw $1CA1,$3526,$4E0A,$62D3,$7778,$65EE,$76B2,$7718
	dw $7FBB,$24E3,$3DA9,$5692,$7799

DATA_5FEB64:
	dw $1CA1,$3526,$4E0A,$62D3,$77BD,$65EE,$76B2,$7718
	dw $7FBB,$24E3,$3DA9,$5692,$7FFF

DATA_5FEB7E:
	dw $1CA1,$3526,$4E0A,$77BD,$77BC,$65EE,$76B2,$7718
	dw $7FFF,$24E3,$3DA9,$779A,$7FFD

DATA_5FEB98:
	dw $1CA1,$3526,$7754,$7357,$7799,$65EE,$76B2,$7FFF
	dw $7FFF,$24E3,$66F3,$6716,$7FDB

DATA_5FEBB2:
	dw $1CA1,$5E70,$5E8E,$66F4,$7778,$65EE,$7FDB,$7F9C
	dw $7FFD,$45EB,$4E2D,$5ED4,$7799

DATA_5FEBCC:
	dw $45EB,$45AA,$522B,$62D3,$7778,$7F59,$7F36,$7F5A
	dw $7FBB,$3567,$45EB,$5692,$7799

DATA_5FEBE6:
	dw $2D25,$3947,$4E0A,$62D3,$7778,$7672,$7EF4,$7718
	dw $7FBB,$2D25,$3DA9,$5692,$7799

DATA_5FEC00:
	dw $20C2,$3526,$4E0A,$62D3,$7778,$6E30,$76B2,$7718
	dw $7FBB,$24E3,$3DA9,$5692,$7799

DATA_5FEC1A:
	dw $7FFF,$439F,$01BF

DATA_5FEC20:
	dw $7FFF,$335F,$01BF

DATA_5FEC26:
	dw $7FFF,$26FF,$01BF

DATA_5FEC2C:
	dw $7FFF,$16BF,$01BF

DATA_5FEC32:
	dw $7FFF,$4BFF,$5F77

DATA_5FEC38:
	dw $7FFF,$4BDF,$5F77

DATA_5FEC3E:
	dw $7FFF,$4B9F,$5F77

DATA_5FEC44:
	dw $7FFF,$4B7F,$5F77

DATA_5FEC4A:
	dw $0000,$7FFF,$5F7F,$679F,$318A,$2DDF,$36DF,$57FF
	dw $7FF2,$2585,$5B32,$7FFF,$0000,$2585,$154F,$0CC9
	dw $4148,$7FFF,$2108,$2176,$21BF,$2DDF,$36DF,$57FF
	dw $31B0,$3657,$533D,$77FF,$7FFA,$2108,$7FFD,$7FFF
	dw $23FF,$6739,$1084,$110F,$11B4,$1279,$1319,$1175
	dw $7B97,$7FF9,$7FFE,$7FFF,$28E4,$2984,$29E4,$2A64
	dw $23FF,$7FFF,$3148,$6527,$5330,$5BB7,$67FC,$67FF
	dw $52DF,$639F,$6BFF,$73FF,$7B97,$7FF9,$7FFE,$7FFF
	dw $23FF,$6739,$1084,$3959,$4259,$4AD9,$4B39,$1319
	dw $3B14,$51E4,$5AFF,$73FF,$18EB,$2951,$35FA,$5B5F
	dw $23FF,$7FFF,$3988,$23FF,$23FF,$23FF,$47FF,$129F
	dw $7B97,$7FF9,$7FFE,$7FFF,$530F,$63D5,$73F9,$7FFE
	dw $2DDF,$6739,$1084,$3953,$4257,$4AD7,$4B37,$31B9
	dw $3B0E,$51E4,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF,$7FFF
	dw $23FF,$6739,$1084,$5D54,$6658,$6718,$6738,$31B9
	dw $5F0F,$51E4,$7FFF,$7FFF,$5330,$5FB3,$6FF6,$7BFA

DATA_5FED4A:
	dw $3ABB,$0000,$0000,$0006,$10D2,$0CA9,$000C,$467F
	dw $111F,$1570,$0012,$023F,$271F,$571F,$6B9F,$7FFF
	dw $515F,$0000,$188C,$4104,$3D55,$24B5,$65AA,$467F
	dw $001F,$55BF,$7E8F,$023F,$031F,$571F,$6B9F,$7FFF
	dw $47FF,$0000,$00B9,$0165,$0012,$01BF,$02AB,$467F
	dw $001F,$037F,$03F2,$023F,$031F,$571F,$6B9F,$7FFF
	dw $7F6B,$0000,$45A7,$01DF,$0012,$6268,$03FF,$467F
	dw $001F,$7F71,$5FFF,$023F,$031F,$571F,$6B9F,$7FFF
	dw $7E39,$0000,$450A,$240C,$0012,$6571,$3898,$467F
	dw $001F,$7DF9,$615F,$023F,$031F,$571F,$6B9F,$7FFF
	dw $03E0,$0000,$0180,$0012,$10D2,$02A0,$001F,$467F
	dw $111F,$03E0,$023F,$025F,$271F,$571F,$6B9F,$7FFF
	dw $7FFF,$0000,$0C6E,$2544,$10D2,$18D7,$4E69,$467F
	dw $111F,$215F,$674E,$023F,$271F,$571F,$6B9F,$7FFF
	dw $3186,$0000,$2442,$248C,$0012,$40E7,$38F8,$467F
	dw $001F,$5D6B,$515F,$023F,$031F,$571F,$6B9F,$7FFF

DATA_5FEE4A:
	dw $1840,$0000,$2CA0,$7FFF,$5B1A,$4EB7,$3E33,$31D0
	dw $214C,$10C8,$7FFF,$7778,$666D,$49C7,$3124,$1CA1
	dw $7F26,$0000,$3525,$7779,$5294,$4631,$35AD,$294A
	dw $18C6,$0842,$7777,$6EF0,$5DE5,$4140,$28A0,$1420
	dw $7F26,$0000,$3DAB,$6EF3,$4A0E,$3DAB,$2D27,$20C4
	dw $1040,$0000,$6EEF,$6668,$5560,$38C0,$2020,$0C00
	dw $7F26,$0000,$4631,$666D,$4188,$3525,$24A1,$1840
	dw $0800,$0000,$6667,$5DE0,$4CE0,$3040,$1800,$0400
	dw $7F26,$7FFF,$67FF,$4BDF,$7DC0,$5CA0,$4060,$2C40
	dw $2040,$1840,$7FFF,$7778,$666D,$49C7,$3124,$1CA1
	dw $7F26,$0000,$569C,$28F1,$0006,$5B9F,$2DF6,$004D
	dw $6FDF,$7F26,$7777,$6EF0,$5DE5,$4140,$28A0,$1420
	dw $7F26,$0000,$679F,$1D51,$6FD9,$2144,$7F26,$7F26
	dw $7F26,$7F26,$6EEF,$6668,$5560,$38C0,$2020,$0C00
	dw $03FF,$0000,$0842,$1084,$18C6,$2108,$2D6B,$35AD
	dw $3DEF,$4631,$6667,$5DE0,$4CE0,$3040,$1800,$0400
	dw $7F26,$0000,$2CA0,$7FFF,$6393,$5731,$4AAE,$3A2B
	dw $2DA8,$1D25,$5E76,$5214,$4591,$350E,$288B,$1808
	dw $7F26,$0000,$3525,$7779,$5B0D,$4EAB,$4228,$31A5
	dw $2522,$14A0,$55F0,$498E,$3D0B,$2C88,$2005,$1002
	dw $7F26,$0000,$3DAB,$6EF3,$5287,$4625,$39A2,$2920
	dw $1CA0,$0C20,$4D6A,$4108,$3485,$2402,$1800,$0800
	dw $7F26,$0000,$4631,$666D,$4A01,$3DA0,$3120,$20A0
	dw $1420,$0400,$44E4,$3882,$2C00,$1C00,$1000,$0000
	dw $7F26,$0000,$0842,$1084,$18C6,$2108,$2D6B,$35AD
	dw $3DEF,$4631,$4E73,$5AD6,$6318,$6B5A,$739C,$7FFF
	dw $7F26,$0000,$0000,$0000,$0800,$1040,$1CA3,$24E5
	dw $2D27,$3569,$3DAB,$4A0E,$5250,$5A92,$62D4,$6F37
	dw $03FF,$0000,$0000,$0000,$0000,$7F26,$7F26,$7F26
	dw $7F26,$7F26,$7F26,$7F26,$7F26,$7F26,$7F26,$7F26
	dw $03FF,$0000,$0000,$0000,$0000,$7F26,$7F26,$7F26
	dw $7F26,$7F26,$7F26,$7F26,$7F26,$7F26,$7F26,$7F26

DATA_5FF04A:
	dw $1840,$0000,$0842,$1084,$18C6,$2108,$2D6B,$35AD
	dw $3DEF,$4631,$4E73,$5AD6,$6318,$6B5A,$739C,$7FFF
	dw $7F26,$0000,$0400,$0C42,$1484,$1CC6,$2929,$316B
	dw $39AD,$41EF,$4A31,$5694,$5ED6,$6718,$6F5A,$7BBD
	dw $7F26,$0000,$0000,$0800,$1042,$1884,$24E7,$2D29
	dw $356B,$3DAD,$45EF,$5252,$5A94,$62D6,$6B18,$777B
	dw $7F26,$0000,$0000,$0400,$0C00,$1442,$20A5,$28E7
	dw $3129,$396B,$41AD,$4E10,$5652,$5E94,$66D6,$7339
	dw $20A3,$6BBF,$3A9B,$3A36,$39F3,$396D,$2CA8,$1443
	dw $0000,$6398,$3EB0,$3E2D,$3DCA,$2D26,$20A3,$1461
	dw $20A3,$0000,$569C,$28F1,$0006,$5B9F,$2DF6,$004D
	dw $6FDF,$20A3,$1461,$593F,$60FF,$68BF,$707F,$7C1F
	dw $20A3,$0000,$679F,$1D51,$6FD9,$2144,$7FFF,$7C00
	dw $4400,$3DCA,$20A3,$593F,$60FF,$68BF,$707F,$7C1F
	dw $20A3,$0BBF,$137F,$1B3F,$22FF,$2ABF,$327F,$3A3F
	dw $41FF,$49BF,$517F,$593F,$60FF,$68BF,$707F,$7C1F
	dw $20A3,$7FFF,$77DC,$7797,$6F33,$62B0,$5A8C,$564B
	dw $5229,$4E08,$45C6,$3D66,$3965,$3124,$2D03,$28E2
	dw $2060,$7BBD,$739A,$7355,$6AF1,$5E6E,$564A,$5209
	dw $4DE7,$49C6,$4184,$3924,$3523,$2CE2,$28C1,$24A0
	dw $2060,$777B,$6F58,$6F13,$66AF,$5A2C,$5208,$4DC7
	dw $49A5,$4584,$3D42,$34E2,$30E1,$28A0,$2480,$2060
	dw $2060,$7339,$6B16,$6AD1,$626D,$55EA,$4DC6,$4985
	dw $4563,$4142,$3900,$30A0,$2CA0,$2460,$2040,$1C20

DATA_5FF1CA:
	dw $0A1F,$6BBF,$5B5F,$3E9A,$2DF3,$0CA7,$211F,$10B8
	dw $0850,$000A,$0005,$7FFF,$7FBA,$7335,$5A6E,$3966
	dw $0A1F,$6BBF,$5B5F,$3E9A,$2DF3,$0CA7,$23E8,$1308
	dw $0A03,$0140,$00A0,$7FFF,$7FBA,$7335,$5A6E,$3966
	dw $0A1F,$6BBF,$5B5F,$3E9A,$2DF3,$0CA7,$211F,$10B8
	dw $0850,$000A,$0005,$7FFF,$337F,$52FF,$3E5E,$26FF
	dw $0A1F,$6BBF,$5B5F,$3E9A,$2DF3,$0CA7,$23E8,$1308
	dw $0A03,$0140,$00A0,$7FFF,$337F,$52FF,$3E5E,$26FF

DATA_5FF24A:
	dw $5145,$569C,$4A19,$3975,$24F0,$1CAB,$1486,$0C43
	dw $1041,$67BF,$5B3A,$4A95,$3A10,$2D6B,$1CE6,$1041
	dw $2CE4,$5A59,$4DD6,$3D32,$28AD,$2068,$1843,$1000
	dw $1400,$6B7C,$5EF7,$4E52,$3DCD,$3128,$20A3,$1400
	dw $7F26,$5E16,$5193,$40EF,$2C6A,$2425,$1C00,$1400
	dw $1800,$6F39,$62B4,$520F,$418A,$34E5,$2460,$1800
	dw $7F26,$61D3,$5550,$44AC,$3027,$2802,$2000,$1800
	dw $1C00,$72F6,$6671,$55CC,$4547,$38A2,$2820,$1C00
	dw $7F26,$76F6,$45D2,$456D,$452A,$44A4,$3800,$2000
	dw $0C00,$6ECF,$49E7,$4964,$4901,$3860,$2C00,$2000
	dw $7F26,$0000,$569C,$28F1,$0006,$5B9F,$2DF6,$004D
	dw $6FDF,$20A3,$1461,$593F,$60FF,$68BF,$707F,$7C1F
	dw $7F26,$0000,$679F,$1D51,$6FD9,$2144,$7FFF,$7C00
	dw $4400,$3DCA,$20A3,$593F,$60FF,$707F,$707F,$7C1F
	dw $7F26,$5E16,$40EF,$2847,$2843,$2443,$6F39,$66D5
	dw $51EE,$4568,$38E3,$5AF2,$4E2D,$3D67,$2CA3,$2000
	dw $20A3,$47FA,$43B8,$3F56,$3B14,$36B1,$324F,$2A0D
	dw $25AB,$2148,$1D06,$18A4,$1041,$0820,$707F,$7C1F
	dw $4FFF,$4BB7,$4775,$4313,$3ED1,$3A6E,$360C,$2DCA
	dw $2968,$2505,$20C3,$1C61,$1400,$0C00,$707F,$7C1F
	dw $7F26,$4F74,$4B32,$46D0,$428E,$3E2B,$39C9,$3187
	dw $2D25,$28C2,$2480,$2020,$1800,$1000,$707F,$7C1F
	dw $7F26,$5331,$4EEF,$4A8D,$464B,$41E8,$3D86,$3544
	dw $30E2,$2C80,$2840,$2400,$1C00,$1400,$707F,$7C1F
	dw $7F26,$22FF,$22FF,$22FF,$22FF,$1EF0,$1E8E,$1A0C
	dw $1589,$1168,$0D26,$0CE5,$08C4,$0883,$0442,$2FB3
	dw $7F26,$0BBF,$137F,$1B3F,$22FF,$22AD,$224B,$1DC9
	dw $1946,$1525,$10E3,$10A2,$0C81,$0C40,$0800,$3370
	dw $5BBF,$0000,$0000,$0000,$0000,$266A,$2608,$2186
	dw $1D03,$18E2,$14A0,$1460,$1040,$1000,$0C00,$372D
	dw $5BBF,$0000,$0000,$0000,$0000,$2A27,$29C5,$2543
	dw $20C0,$1CA0,$1860,$1820,$1400,$1400,$1000,$3AEA

DATA_5FF44A:
	dw $0C40,$0C40,$67BF,$5B3A,$4A95,$3A10,$2D6B,$1CE6
	dw $1041,$73BF,$673F,$569A,$4E55,$292D,$1065,$7FFF

DATA_5FF46A:
	dw $6FFF,$4F1A,$218E

DATA_5FF470:
	dw $6BBE,$4296,$0000

DATA_5FF476:
	dw $5F9D,$0000,$0000

DATA_5FF47C:
	dw $6BDE,$4296,$0000

DATA_5FF482:
	dw $0000,$0823,$10A6,$150B,$11B1,$6FFF,$004F,$001F
	dw $0131,$10C4,$0D43,$0221,$1CC7,$316C,$4231

DATA_5FF4A0:
	dw $0421,$0863,$0464,$08A7,$0CC9,$212C,$216F,$31D0
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F

DATA_5FF4BE:
	dw $4FFF,$3FBF,$373D,$2EBB,$1E39,$4F18,$3E73,$3610
	dw $29AD,$1D29,$10C6,$0442,$2E6D,$1DA7,$0CC4

DATA_5FF4DC:
	dw $0000,$0863,$08A7,$110C,$1970,$3E16,$42BD,$637F
	dw $7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F,$7C1F

DATA_5FF4FA:
	dw $0000,$0C23,$18E9,$25D4,$1EFF,$6FFF,$009D,$001F
	dw $01FF,$1925,$1643,$03E0,$352C,$5A75,$7FFF

DATA_5FF518:
	dw $0442,$0C43,$1464,$1C86,$24A7,$2CC9,$350A,$3D2D
	dw $354F,$2D92,$25B4,$1E37,$16B9,$175C,$37FF,$0000

DATA_5FF538:
	dw $0000,$10E7,$21EF,$36F7,$3FFF,$3FFF,$3FFF,$3FFF
	dw $3FFF,$36F7,$3FFF,$3FFF,$36F7,$3FFF,$3FFF

DATA_5FF556:
	dw $0000,$7FFF,$0C23,$352C,$5A75,$1925,$1643,$03E0
	dw $34A9,$5DAB,$7FF2,$18E9,$25F4,$1F3F,$001F,$0421
	dw $4210,$0842,$1CA7,$2D4B,$0CA3,$0D42,$0601,$1C65
	dw $30E6,$420A,$0C85,$150B,$11B0,$0430

DATA_5FF592:
	dw $0000,$7FFF,$416A,$51EC,$01FF,$031F,$03FF,$46B1
	dw $5F57,$0180,$02A0,$03E0,$467F,$571F,$6B9F

DATA_5FF5B0:
	dw $2129,$2E4B,$2129,$2D95,$330C,$5AF5,$4B19,$3A1F
	dw $2BEA,$2E7A,$32FF,$437F,$539D,$6BDF,$7FFF

DATA_5FF5CE:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$2106,$2124
	dw $2DA9,$35D0,$562E,$4EF0,$7FFF,$7FFE,$31AF,$30E2
	dw $0000,$6730,$6AD2

DATA_5FF5F4:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$35D0,$562E,$7FFF,$5FFE,$5F75,$31AF,$30E2
	dw $0000,$6730,$5E6F

DATA_5FF61A:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$35D0,$7FBA,$67B6,$5FFE,$5312,$31AF,$30E2
	dw $0000,$6730,$520C

DATA_5FF640:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$6F9E,$6EF4,$5B53,$5FFE,$46AF,$633B,$30E2
	dw $0000,$6730,$520C

DATA_5FF666:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$4E96,$6291,$4EF0,$5FFE,$46AF,$4A75,$30E2
	dw $0000,$6730,$520C

DATA_5FF68C:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$4233,$562E,$4EF0,$5FFE,$46AF,$3E12,$30E2
	dw $0000,$7FFF,$520C

DATA_5FF6B2:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$35D0,$562E,$4EF0,$5FFE,$46AF,$31AF,$30E2
	dw $0000,$7FF6,$520C

DATA_5FF6D8:
	dw $1943,$3A07,$4F0D,$73F6,$7FFB,$0082,$1CE5,$2124
	dw $2DA9,$35D0,$562E,$4EF0,$5FFE,$46AF,$31AF,$30E2
	dw $0000,$7393,$7FFB

DATA_5FF6FE:
	dw $34E3,$3524,$4DE8,$5A6B,$6F0E,$7F93,$7FFC

DATA_5FF70C:
	dw $34E3,$3524,$4DE8,$5A6B,$6F0E,$7FF7,$7FFF

DATA_5FF71A:
	dw $34E3,$3524,$4DE8,$5A6B,$7FD2,$7FFE,$7FFF

DATA_5FF728:
	dw $34E3,$3524,$4DE8,$6B2F,$7FFD,$7FFB,$7FFE

DATA_5FF736:
	dw $34E3,$3524,$4DE8,$7FF9,$7FF6,$7FD5,$7FFC

DATA_5FF744:
	dw $34E3,$3524,$4DE8,$7BB3,$7750,$7F93,$7FFC

DATA_5FF752:
	dw $34E3,$3524,$4DE8,$62AD,$6F0E,$7F93,$7FFC

DATA_5FF760:
	dw $34E3,$3524,$4DE8,$5A6B,$6F0E,$7F93,$7FFC

DATA_5FF76E:
	dw $6F7B,$66F4,$5E6D,$55E6,$6F7B,$0C62,$2D6B,$4E73
	dw $14CA,$150D,$194F,$29B1,$021D,$013A,$0037,$0015

DATA_5FF78E:
	dw $66F4,$5E6D,$55E6,$6F7B,$5EF7,$3DEF,$1CE7,$3DEF
	dw $14CA,$150D,$194F,$29B3,$017A,$0077,$0015,$025D

DATA_5FF7AE:
	dw $5E6D,$55E6,$6F7B,$66F4,$4E73,$6F7B,$0C62,$2D6B
	dw $14CA,$150D,$1951,$29B5,$00B7,$0015,$029D,$01BA

DATA_5FF7CE:
	dw $55E6,$6F7B,$66F4,$5E6D,$3DEF,$5EF7,$3DEF,$1CE7
	dw $14CA,$150F,$1953,$29B7,$0015,$02DD,$01FA,$00F7

DATA_5FF7EE:
	dw $6F7B,$66F4,$5E6D,$55E6,$2D6B,$4E73,$6F7B,$0C62
	dw $14CC,$1511,$1955,$29B9,$031D,$023A,$0137,$0015

DATA_5FF80E:
	dw $66F4,$5E6D,$55E6,$6F7B,$1CE7,$3DEF,$5EF7,$3DEF
	dw $14CA,$150F,$1953,$29B7,$01FA,$00F7,$0015,$02DD

DATA_5FF82E:
	dw $5E6D,$55E6,$6F7B,$66F4,$0C62,$2D6B,$4E73,$6F7B
	dw $14CA,$150D,$1951,$29B5,$00B7,$0015,$029D,$01BA

DATA_5FF84E:
	dw $55E6,$6F7B,$66F4,$5E6D,$3DEF,$1CE7,$3DEF,$5EF7
	dw $14CA,$150D,$194F,$29B3,$0015,$025D,$017A,$0077
	dw $0821,$4A15,$7B78,$1021,$0821,$3570,$62AD,$7C05
	dw $0821,$2633,$1583,$7C05,$0821,$7FFF,$26A6,$0821
	dw $152C,$0CE2,$7C05,$0821,$20CA,$45C8,$7C05,$0821
	dw $5A13,$3ADD,$7C05,$0821,$3CEB,$2152,$0000,$2909
	dw $5A6C,$0821,$0000,$1464,$41A1,$0821,$0000,$0527
	dw $0080,$0821,$0000,$5EF3,$05A0,$0000,$0020,$0000
	dw $0821,$0000,$0000,$24C0,$0821,$0000,$3907,$19D1
	dw $0821,$0000,$1C00,$0046,$0000,$1883,$49E6,$0821
	dw $0000,$0400,$3120,$0821,$0000,$00A1,$0000,$0821
	dw $0000,$4E6D,$0120,$0000,$0000,$0000,$0821,$0000
	dw $0000,$1440,$0821,$0000,$2881,$094B,$0821,$0000
	dw $0C00,$0000,$0000,$0800,$3960,$0821,$0000,$0000
	dw $20A0,$0821,$0000,$0020,$0000,$0821,$0000,$3DE7
	dw $00A0,$0000,$0000,$0000,$0821,$0000,$0000,$0400
	dw $0821,$0000,$1800,$00C5,$0821,$0000,$0000,$0000

DATA_5FF95E:
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0023
	dw $0000,$0000,$0000,$0065,$0000,$0000,$0000,$00A7
	dw $0000,$0000,$0000,$00E9,$0000,$0000,$0001,$092B
	dw $0000,$0000,$0003,$116D,$0000,$0000,$0045,$19AF
	dw $0000,$0000,$0087,$21F1,$0000,$0000,$00C9,$2A33
	dw $0000,$0000,$050B,$3275,$0000,$0002,$0D4D,$3AB7
	dw $0000,$0044,$158F,$42F9,$0000,$0086,$1DD1,$4B3B
	dw $0000,$08C8,$2613,$537D,$0000,$110A,$2E55,$5BBF

DATA_5FF9DE:
	dw $0000,$0000,$0000,$0000,$0000,$0000,$0000,$0421
	dw $0000,$0000,$0000,$0842,$0000,$0000,$0000,$0C63
	dw $0000,$0000,$0000,$1084,$0000,$0000,$0000,$14A5
	dw $0000,$0000,$0000,$1CE7,$0000,$0000,$0000,$2529
	dw $0000,$0000,$0842,$2D6B,$0000,$0000,$1084,$35AD
	dw $0000,$0000,$18C6,$3DEF,$0000,$0000,$2108,$4631
	dw $0000,$0421,$294A,$4E73,$0000,$0C63,$318C,$56B5
	dw $0000,$14A5,$39CE,$5EF7,$0000,$1CE7,$4210,$6739

DATA_5FFA5E:
	dw $0000,$0000,$0000,$401F,$0000,$0000,$0000,$401F
	dw $0000,$0000,$0000,$401F,$0000,$0000,$0000,$401F
	dw $0000,$0000,$0000,$1800,$0000,$0000,$401F,$0000
	dw $0000,$0000,$401F,$0000,$0000,$0000,$401F,$0000
	dw $0000,$0000,$401F,$0000,$0000,$0000,$3000,$1000
	dw $0000,$401F,$0000,$0000,$0000,$401F,$0000,$0000
	dw $0000,$401F,$0000,$0000,$0000,$401F,$0000,$0000
	dw $0000,$3863,$2000,$0000,$401F,$0000,$0000,$0000
	dw $401F,$0000,$0000,$0000,$401F,$0000,$0000,$0000
	dw $401F,$0000,$0000,$0000,$3CA5,$3000,$1000,$401F
	dw $1000,$0000,$0000,$401F,$0000,$0000,$0000,$401F
	dw $0000,$0000,$0000,$401F,$0000,$0000,$0000,$44E7
	dw $3863,$2000,$401F,$2000,$0000,$0000,$401F,$0000
	dw $0000,$0000,$401F,$0000,$0000,$0000,$401F,$0000
	dw $0000,$0000,$4929,$3CA5,$3000,$401F,$3000,$1000
	dw $0000,$401F,$1000,$0000,$0000,$401F,$0000,$0000
	dw $0000,$401F,$0000,$0000,$0000,$518C,$44E7,$3863
	dw $401F,$3863,$2000,$0000,$401F,$2000,$0000,$0000
	dw $401F,$0000,$0000,$0000,$401F,$0000,$0000,$0000
	dw $55CE,$4929,$3CA5,$401F,$3CA5,$3000,$1000,$401F
	dw $3000,$1000,$0000,$401F,$1000,$0000,$0000,$401F
	dw $0000,$0000,$0000,$5A10,$518C,$44E7,$401F,$44E7
	dw $3863,$2000,$401F,$3863,$2000,$0000,$401F,$2000
	dw $0000,$0000,$401F,$0000,$0000,$0000,$5E52,$55CE
	dw $4929,$401F,$4929,$3CA5,$3000,$401F,$3CA5,$3000
	dw $1000,$401F,$3000,$1000,$0000,$401F,$1000,$0000
	dw $0000,$66B5,$5A10,$518C,$401F,$518C,$44E7,$3863
	dw $401F,$44E7,$3863,$2000,$401F,$3863,$2000,$0000
	dw $401F,$2000,$0000,$0000,$6AF7,$5E52,$55CE,$401F
	dw $55CE,$4929,$3CA5,$401F,$4929,$3CA5,$3000,$401F
	dw $3CA5,$3000,$1000,$401F,$3000,$1000,$0000,$7339
	dw $66B5,$5A10,$401F,$5A10,$518C,$44E7,$401F,$518C
	dw $44E7,$3863,$401F,$44E7,$3863,$2000,$401F,$3863
	dw $2000,$0000,$777B,$6AF7,$5E52,$401F,$5E52,$55CE
	dw $4929,$401F,$55CE,$4929,$3CA5,$401F,$4929,$3CA5
	dw $3000,$401F,$3CA5,$3000,$1000,$7BBD,$7339,$66B5
	dw $401F,$66B5,$5A10,$518C,$401F,$5A10,$518C,$44E7
	dw $401F,$518C,$44E7,$3863,$401F,$44E7,$3863,$2000
	dw $7FFF,$777B,$6AF7,$401F,$6AF7,$5E52,$55CE,$401F
	dw $5E52,$55CE,$4929,$401F,$55CE,$4929,$3CA5,$401F
	dw $4929,$3CA5,$3000
;@editable:palette-blob end

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($5FFCE4, incbin, DATA_5FFCE4_YI_U2.bin)
else
	%FREE_BYTES($5FFCE4, 796, $FF)
endif
%BANK_END(<EndBank>)
endmacro
