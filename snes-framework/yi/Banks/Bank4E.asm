;#############################################################################################################
;# Bank4E.asm -- SNES bank $4E (HiROM-mirrored full 64 KB SPC700 sample/music data bank,
;#               original cart bank $1E). NOT executable on the 65816 -- all contents are raw
;#               sample/music payload that the SPC700 driver (uploaded from Bank50:YI_SPCEngine)
;#               streams up to ARAM at run time.
;#
;# Contents at a glance:
;#   $4E0000  DATA_4E0000  -- AthleticSampleBank             (full athletic-track instruments)
;#   $4E169C  DATA_4E169C  -- music data blob (per Yoshifanatic split, anonymous)
;#   $4E23BF  DATA_4E23BF  -- music data blob (anonymous)
;#   $4E2C39  DATA_4E2C39  -- music data blob (anonymous)
;#   $4E38D2  DATA_4E38D2  -- music data blob (anonymous)
;#   $4E3E90  DATA_4E3E90  -- EndingSampleBank               (credits/ending instruments)
;#   $4EBBEC  DATA_4EBBEC  -- music data blob (anonymous)
;#   $4ED0FE  DATA_4ED0FE  -- music data blob (anonymous)
;#   $4ED5D0  DATA_4ED5D0  -- music data blob (anonymous)
;#   $4EE279  DATA_4EE279  -- CaveFortBossSampleBank         (underground/boss instruments)
;#   $4EEC85  DATA_4EEC85  -- BonusCastleBossGrasslandSampleBank (mixed bank used by several tracks)
;#   $4EFEC1  DATA_4EFEC1  -- first $13F bytes of BowserSampleBank.bin (bank-crossing into $4F)
;#
;# Cross-references:
;#   yi/SPC700/                     -- the .bin sample/music sources (per-instrument BRR samples
;#       grouped by music context: Athletic, Bowser, CaveFortBoss, Ending,
;#       BonusCastleBossGrassland, IntroMapCastleFort, Global -- 7 sample banks + the engine,
;#       each compiled separately during the SPC700 build phase).
;#   yi/SPC700/SPC700_Macros_YI.asm -- defines the upload pipeline (v1.2-style stream:
;#       `dw size; dw dest; payload` per block, terminator `dw 0; dw jump_target`).
;#   yi/Banks/Bank4F.asm            -- continues BowserSampleBank from offset $13F.
;#############################################################################################################
macro YIBank4EMacros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)

DATA_4E0000:							; AthleticSampleBank -- per-instrument BRR samples
	incbin "SPC700/AthleticSampleBank.bin"

DATA_4E169C:
	incbin "SPC700/DATA_4E169C.bin"

DATA_4E23BF:
	incbin "SPC700/DATA_4E23BF.bin"

DATA_4E2C39:
	incbin "SPC700/DATA_4E2C39.bin"

DATA_4E38D2:
	incbin "SPC700/DATA_4E38D2.bin"

DATA_4E3E90:							; EndingSampleBank
	incbin "SPC700/EndingSampleBank.bin"

DATA_4EBBEC:
	incbin "SPC700/DATA_4EBBEC.bin"

DATA_4ED0FE:
	incbin "SPC700/DATA_4ED0FE.bin"

DATA_4ED5D0:
	incbin "SPC700/DATA_4ED5D0.bin"

DATA_4EE279:							; CaveFortBossSampleBank
	incbin "SPC700/CaveFortBossSampleBank.bin"

DATA_4EEC85:							; BonusCastleBossGrasslandSampleBank
	incbin "SPC700/BonusCastleBossGrasslandSampleBank.bin"

DATA_4EFEC1:							; BowserSampleBank split: low half lives at end of $4E,
							; high half continues at start of $4F. The literal $13F is
							; (filesize - bytes_remaining_in_bank).
	incbin "SPC700/BowserSampleBank.bin":0..$13F	; bank-cross split: $10000-$FEC1 (low word of DATA_4EFEC1). asar 1.91 disallows label arithmetic in incbin ranges.
.End:

%BANK_END(<EndBank>)
endmacro
