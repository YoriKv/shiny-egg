;#############################################################################################################
;# Bank50.asm -- SNES bank $50 (HiROM-mirrored full 64 KB SPC700 bank, original cart bank $20).
;#               This is the home of the SPC700 driver binary itself (YI_SPCEngine), plus the
;#               tail of the bank-crossing sample blob that started in Bank4F.
;#
;# Contents at a glance:
;#   $500000  (unlabeled)   -- tail of DATA_4FFCB2.bin ($34E..EOF), continued from Bank4F.
;#   $500342  YI_SPCEngine  -- assembled SPC700_Engine_YI.bin; the audio CPU's program image.
;#                              Uploaded to the SPC700 at boot by the main-CPU SPC bootstrap.
;#   $50B3FA+ -- V1.1 garbage data (only when !ROM_YI_U2); freespace otherwise.
;#
;# Cross-references:
;#   yi/Banks/Bank4F.asm   -- DATA_4FFCB2 begins there.
;#   yi/SPC700/SPC700_Engine_YI.bin -- the compiled SPC code.
;#   yi/SPC700/SPC700_Macros_YI.asm -- the upload pipeline that copies YI_SPCEngine into ARAM.
;#       Upload model (v1.2-style stream): each block emits `dw size; dw dest; payload`
;#       chained per block, terminated by `dw 0; dw jump_target`. The whole assembled stream
;#       becomes a `.bin` that the SNES main ROM uploads to the SPC700 at boot.
;#############################################################################################################
macro YIBank50Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)

	incbin "SPC700/DATA_4FFCB2.bin":$34E..filesize("SPC700/DATA_4FFCB2.bin")	; second half of bank-crossing bin, matches split offset above.

YI_SPCEngine:							; SPC700 driver image -- uploaded to ARAM at boot.
;$500342
	incbin "SPC700/SPC700_Engine_YI.bin"

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($50B3FA, incbin, DATA_50B3FA_YI_U2.bin)	; V1.1: holds extra padding
else
	%FREE_BYTES($50B3FA, 19462, $FF)			; V1.0: ~19 KB of free space at end of bank
endif
%BANK_END(<EndBank>)
endmacro
