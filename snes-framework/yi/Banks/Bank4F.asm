;#############################################################################################################
;# Bank4F.asm -- SNES bank $4F (HiROM-mirrored full 64 KB SPC700 sample/music data bank,
;#               original cart bank $1F). Like Bank4E, all contents are payload for the
;#               SPC700 audio driver -- NOT executable on the 65816.
;#
;# Contents at a glance:
;#   $4F0000  (unlabeled)        -- second half of BowserSampleBank.bin ($13F..EOF), continuation
;#                                  from Bank4E:DATA_4EFEC1.
;#   $4F205D  DATA_4F205D        -- music data blob (anonymous)
;#   $4F33F0  DATA_4F33F0        -- music data blob (anonymous)
;#   $4F4122  DATA_4F4122        -- music data blob (anonymous)
;#   $4F5C48  DATA_4F5C48        -- music data blob (anonymous)
;#   $4F6E5A  DATA_4F6E5A        -- IntroMapCastleFortSampleBank
;#   $4F82E6  DATA_4F82E6        -- GlobalSampleBank (instruments shared across most tracks)
;#   $4FFCB2  DATA_4FFCB2        -- first $34E bytes of DATA_4FFCB2.bin (bank-crossing into $50)
;#
;# Cross-references:
;#   yi/Banks/Bank4E.asm  -- BowserSampleBank starts here.
;#   yi/Banks/Bank50.asm  -- DATA_4FFCB2 continues at $500000, immediately before YI_SPCEngine.
;#   yi/SPC700/SPC700_Engine_YI.bin -- the SPC code that ultimately consumes these samples.
;#############################################################################################################
macro YIBank4FMacros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)

	incbin "SPC700/BowserSampleBank.bin":$13F..filesize("SPC700/BowserSampleBank.bin")	; second half of bank-crossing bin, matches split offset above.

DATA_4F205D:
	incbin "SPC700/DATA_4F205D.bin"

DATA_4F33F0:
	incbin "SPC700/DATA_4F33F0.bin"

DATA_4F4122:
	incbin "SPC700/DATA_4F4122.bin"

DATA_4F5C48:
	incbin "SPC700/DATA_4F5C48.bin"

DATA_4F6E5A:							; IntroMapCastleFortSampleBank
	incbin "SPC700/IntroMapCastleFortSampleBank.bin"

DATA_4F82E6:							; GlobalSampleBank -- shared instruments
	incbin "SPC700/GlobalSampleBank.bin"

DATA_4FFCB2:							; bank-crossing tail; continues at start of $50.
	incbin "SPC700/DATA_4FFCB2.bin":0..$34E	; bank-cross split: $10000-$FCB2 (low word of DATA_4FFCB2).
.End:

%BANK_END(<EndBank>)
endmacro
