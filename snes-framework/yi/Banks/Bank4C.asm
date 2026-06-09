;#############################################################################################################
;# Bank4C.asm -- SNES bank $4C (HiROM-mirrored, original cart bank $1C). Mixed bank:
;#   1. First ~54 KB of pre-compiled SuperFX (GSU) code, which ALSO contains the cart's
;#      Map16 page-table data at $4C:33F2-$4C:D619 (167 pages, ~41 KB; consumed by the
;#      SNES Map16 walker in Bank12 -- see docs/leveldataengine.md S3.5). Reachable
;#      from the 65816 at LoROM $18:B3F2 too (same byte, different mapping form).
;#      SMW Central's memory map calls these the "MAP16 page tables".
;#   2. DATA_4CD61A: per-tileset Map16-ID template-slot init table (74 records, $00-terminated).
;#      Consumed by the 65816 (NOT the GSU) at level-load time via CODE_init_per_tileset_template_slots
;#      (Bank10 CODE_init_per_tileset_template_slots), which is JSLed once from CODE_load_level_object_stream
;#      (Bank10 CODE_108B61) to populate the sparse WRAM template-slot region
;#      $00:19DA-$00:1DFC. See the "PER-TILESET MAP16-ID TEMPLATE SLOTS" header
;#      at the top of yi/Banks/Bank13.asm for what the slots are used for at runtime.
;#      Each record is 35 bytes:
;#         db  count                                        ; 1B   how many consecutive WRAM slots this family fills
;#         dw  ram_slot_addr                                ; 2B   first slot of the family ($19DA..$1DFC)
;#         dw  anchor[0], anchor[1], ..., anchor[$F]        ; 32B  16 Map16 anchor IDs, indexed by BG1TYP
;#      The loader stores anchor[BG1TYP], anchor[BG1TYP]+1, anchor[BG1TYP]+2, ...
;#      `count` times into adjacent 16-bit WRAM slots, so an N-slot family
;#      occupies 2*N bytes starting at ram_slot_addr.
;#      NOTE: this is a DIFFERENT structure from the Map16 page tables (#1 above). SMW
;#      Central's "MAP16 page tables" entry over-includes these bytes plus part of Bank4D
;#      enemy data; see yi/SuperFX/Banks/Bank4C.asm header for the full correction.
;#      See also: ys_unit.asm (RUTDATA), ys_bgsc.asm (RUTSET loader),
;#      ys_unit.h (per-family slot-address equates).
;#   3. A run of per-level object/sprite data blobs (DATA_4CExxxx, DATA_4CFxxxx). Most of
;#      these are referenced by the Ptrs: table in
;#      Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm.
;#   4. A V1.0/V1.1-gated tail: V1.1 hoists DATA_10F5xx..DATA_10FFxx level-data blobs up
;#      into this bank and packs garbage; V1.0 keeps DATA_4CF4D9..DATA_4CFE9A here and
;#      pads with $FF.
;#
;# Cross-references:
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm -- Ptrs: consumer for the DATA_4CE*, DATA_4CF* blobs.
;#   yi/SuperFX/                                               -- GSU source that consumes the graphics descriptor table.
;#   Bank4D.asm header                                         -- HiROM/SuperFX bank scheme.
;#############################################################################################################
macro YIBank4CMacros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)

	%InsertNextPreCompiledCodeBlock($4C0000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; ~54 KB of GSU code

;---- Per-tileset Map16-template-slot init table ($4CD61A): 74 records, $00-terminated.
;---- Consumed by CODE_init_per_tileset_template_slots (Bank10) at level-load time. See the
;---- bank header above for the record layout and the Bank13 header for slot semantics.
DATA_4CD61A:
DATA_per_tileset_template_table:                                       ; descriptive alias
	db $04 : dw $0019DA
	dw $0200,$0200,$0200,$0200,$0208,$0200,$0210,$020C
	dw $0204,$0200,$0210,$0200,$0208,$0200,$0210,$020C
	db $05 : dw $0019E2
	dw $0300,$0300,$0300,$0300,$030A,$0300,$0314,$030F
	dw $0305,$0300,$0314,$0300,$030A,$0300,$0314,$030F
	db $01 : dw $0019EC
	dw $0400,$0400,$0400,$0400,$0402,$0400,$0403,$0400
	dw $0401,$0400,$0403,$0400,$0402,$0400,$0403,$0400
	db $04 : dw $0019EE
	dw $0500,$0500,$0500,$0500,$0508,$0500,$0510,$050C
	dw $0504,$0500,$0510,$0500,$0508,$0500,$0510,$050C
	db $05 : dw $0019F6
	dw $0600,$0600,$0600,$0600,$060A,$0600,$0614,$060F
	dw $0605,$0600,$0614,$0600,$060A,$0600,$0614,$060F
	db $01 : dw $001A00
	dw $0700,$0700,$0700,$0700,$0702,$0700,$0703,$0700
	dw $0701,$0700,$0703,$0700,$0702,$0700,$0703,$0700
	db $09 : dw $001A02
	dw $0809,$0800,$0800,$0800,$0812,$0800,$0824,$081B
	dw $0809,$0800,$0824,$082D,$0812,$0836,$0824,$081B
	db $01 : dw $001A14
	dw $0901,$0900,$0900,$0900,$0902,$0900,$0904,$0903
	dw $0901,$0900,$0904,$0900,$0902,$0900,$0904,$0903
	db $09 : dw $001A16
	dw $0A09,$0A00,$0A00,$0A00,$0A12,$0A00,$0A24,$0A1B
	dw $0A09,$0A00,$0A24,$0A2D,$0A12,$0A36,$0A24,$0A1B
	db $01 : dw $001A28
	dw $0B01,$0B00,$0B00,$0B00,$0B02,$0B00,$0B04,$0B03
	dw $0B01,$0B00,$0B04,$0B00,$0B02,$0B00,$0B04,$0B03
	db $05 : dw $001A2A
	dw $0C05,$0C00,$0C00,$0C00,$0C0A,$0C00,$0C14,$0C0F
	dw $0C05,$0C00,$0C14,$0C00,$0C0A,$0C1E,$0C14,$0C0F
	db $06 : dw $001A34
	dw $0D06,$0D00,$0D00,$0D00,$0D0C,$0D00,$0D18,$0D12
	dw $0D06,$0D00,$0D18,$0D00,$0D0C,$0D24,$0D18,$0D12
	db $01 : dw $001A40
	dw $0E01,$0E00,$0E00,$0E00,$0E02,$0E00,$0E04,$0E03
	dw $0E01,$0E00,$0E04,$0E00,$0E02,$0E00,$0E04,$0E03
	db $07 : dw $001A42
	dw $0F07,$0F00,$0F00,$0F00,$0F0E,$0F00,$0F1C,$0F15
	dw $0F07,$0F00,$0F1C,$0F00,$0F0E,$0F2A,$0F1C,$0F15
	db $06 : dw $001A50
	dw $1006,$1000,$1000,$1000,$100C,$1000,$1018,$1012
	dw $1006,$1000,$1018,$1000,$100C,$1024,$1018,$1012
	db $01 : dw $001A5C
	dw $1101,$1100,$1100,$1100,$1102,$1100,$1104,$1103
	dw $1101,$1100,$1104,$1100,$1102,$1100,$1104,$1103
	db $01 : dw $001A5E
	dw $1201,$1200,$1200,$1200,$1202,$1200,$1204,$1203
	dw $1201,$1200,$1204,$1200,$1202,$1200,$1204,$1203
	db $01 : dw $001A60
	dw $1301,$1300,$1300,$1300,$1302,$1300,$1304,$1303
	dw $1301,$1300,$1304,$1300,$1302,$1300,$1304,$1303
	db $BF : dw $001A62
	dw $1A00,$1B00,$1B00,$1B00,$1B00,$1B00,$1B00,$1C00
	dw $1A00,$1B00,$1B00,$1B00,$1B00,$1B00,$1B00,$1C00
	db $32 : dw $001BE0
	dw $1900,$1D00,$1D00,$1D00,$1D00,$1D00,$1D00,$7000
	dw $1900,$1D00,$1D00,$1D00,$1D00,$1D00,$1D00,$7000
	db $01 : dw $001C44
	dw $1E00,$1E01,$1E00,$1E00,$1E00,$1E00,$1E00,$1E01
	dw $1E00,$1E01,$1E00,$1E00,$1E00,$1E00,$1E00,$1E01
	db $02 : dw $001C46
	dw $1F00,$1F02,$1F00,$1F00,$1F00,$1F00,$1F00,$1F02
	dw $1F00,$1F02,$1F00,$1F00,$1F00,$1F00,$1F00,$1F02
	db $01 : dw $001C4A
	dw $2000,$2001,$2000,$2000,$2000,$2000,$2000,$2001
	dw $2000,$2001,$2000,$2000,$2000,$2000,$2000,$2001
	db $01 : dw $001C4C
	dw $2100,$2101,$2100,$2100,$2100,$2100,$2100,$2101
	dw $2100,$2101,$2100,$2100,$2100,$2100,$2100,$2101
	db $01 : dw $001C4E
	dw $2200,$2201,$2200,$2200,$2200,$2200,$2200,$2201
	dw $2200,$2201,$2200,$2200,$2200,$2200,$2200,$2201
	db $01 : dw $001C50
	dw $2300,$2301,$2300,$2300,$2300,$2300,$2300,$2301
	dw $2300,$2301,$2300,$2300,$2300,$2300,$2300,$2301
	db $01 : dw $001C52
	dw $2400,$2401,$2400,$2400,$2400,$2400,$2400,$2401
	dw $2400,$2401,$2400,$2400,$2400,$2400,$2400,$2401
	db $01 : dw $001C54
	dw $2500,$2501,$2500,$2500,$2500,$2500,$2500,$2501
	dw $2500,$2501,$2500,$2500,$2500,$2500,$2500,$2501
	db $01 : dw $001C56
	dw $2600,$2601,$2600,$2600,$2600,$2600,$2600,$2601
	dw $2600,$2601,$2600,$2600,$2600,$2600,$2600,$2601
	db $01 : dw $001C58
	dw $2700,$2701,$2700,$2700,$2700,$2700,$2700,$2701
	dw $2700,$2701,$2700,$2700,$2700,$2700,$2700,$2701
	db $01 : dw $001C5A
	dw $2800,$2801,$2800,$2800,$2800,$2800,$2800,$2801
	dw $2800,$2801,$2800,$2800,$2800,$2800,$2800,$2801
	db $0F : dw $001C5C
	dw $2A0F,$2A00,$2A00,$2A00,$2A1E,$2A00,$2A00,$2A2D
	dw $2A0F,$2A00,$2A00,$2A00,$2A1E,$2A00,$2A00,$2A2D
	db $0C : dw $001C7A
	dw $380C,$3800,$3800,$3800,$3818,$3800,$3800,$3824
	dw $380C,$3800,$3800,$3800,$3818,$3848,$3800,$3824
	db $40 : dw $001C92
	dw $3E00,$3900,$3900,$3900,$3A00,$3900,$3900,$6E00
	dw $3E00,$3900,$3900,$3900,$3A00,$3900,$3900,$6E00
	db $0F : dw $001D12
	dw $3B0F,$3B00,$3B00,$3B00,$3B1E,$3B00,$3B00,$3B2D
	dw $3B0F,$3B00,$3B00,$3B00,$3B1E,$3B00,$3B00,$3B2D
	db $05 : dw $001D30
	dw $3F05,$3F00,$3F00,$3F00,$3F00,$3F00,$3F00,$3F0A
	dw $3F05,$3F00,$3F00,$3F00,$3F00,$3F00,$3F00,$3F0A
	db $01 : dw $001D3A
	dw $4001,$4000,$4000,$4000,$4000,$4000,$3000,$4002
	dw $4001,$4000,$4000,$4000,$4000,$4000,$3000,$4002
	db $01 : dw $001D3C
	dw $4101,$4100,$4100,$4100,$4100,$4100,$4100,$4102
	dw $4101,$4100,$4100,$4100,$4100,$4100,$4100,$4102
	db $01 : dw $001D3E
	dw $4201,$4200,$4200,$4200,$4200,$4200,$4200,$4202
	dw $4201,$4200,$4200,$4200,$4200,$4200,$4200,$4202
	db $01 : dw $001D40
	dw $4301,$4300,$4300,$4300,$4300,$4300,$4300,$4302
	dw $4301,$4300,$4300,$4300,$4300,$4300,$4300,$4302
	db $01 : dw $001D42
	dw $4401,$4400,$4400,$4400,$4400,$4400,$4400,$4402
	dw $4401,$4400,$4400,$4400,$4400,$4400,$4400,$4402
	db $01 : dw $001D44
	dw $4501,$4500,$4500,$4500,$4500,$4500,$4500,$4502
	dw $4501,$4500,$4500,$4500,$4500,$4500,$4500,$4502
	db $01 : dw $001D46
	dw $4601,$4600,$4600,$4600,$4600,$4600,$4600,$4602
	dw $4601,$4600,$4600,$4600,$4600,$4600,$4600,$4602
	db $01 : dw $001D48
	dw $4701,$4700,$4700,$4700,$4700,$4700,$4700,$4702
	dw $4701,$4700,$4700,$4700,$4700,$4700,$4700,$4702
	db $01 : dw $001D4A
	dw $4801,$4800,$4800,$4800,$4800,$4800,$4800,$4802
	dw $4801,$4800,$4800,$4800,$4800,$4800,$4800,$4802
	db $01 : dw $001D4C
	dw $4901,$4900,$4900,$4900,$4900,$4900,$4900,$4902
	dw $4901,$4900,$4900,$4900,$4900,$4900,$4900,$4902
	db $01 : dw $001D4E
	dw $4A01,$4A00,$4A00,$4A00,$4A00,$4A00,$4A00,$4A02
	dw $4A01,$4A00,$4A00,$4A00,$4A00,$4A00,$4A00,$4A02
	db $01 : dw $001D50
	dw $4B01,$4B00,$4B00,$4B00,$4B00,$4B00,$4B00,$4B02
	dw $4B01,$4B00,$4B00,$4B00,$4B00,$4B00,$4B00,$4B02
	db $01 : dw $001D52
	dw $4C01,$4C00,$4C00,$4C00,$4C00,$4C00,$4C00,$4C02
	dw $4C01,$4C00,$4C00,$4C00,$4C00,$4C00,$4C00,$4C02
	db $01 : dw $001D54
	dw $4D01,$4D00,$4D00,$4D00,$4D00,$4D00,$4D00,$4D02
	dw $4D01,$4D00,$4D00,$4D00,$4D00,$4D00,$4D00,$4D02
	db $01 : dw $001D56
	dw $4E01,$4E00,$4E00,$4E00,$4E00,$4E00,$4E00,$4E02
	dw $4E01,$4E00,$4E00,$4E00,$4E00,$4E00,$4E00,$4E02
	db $01 : dw $001D58
	dw $4F01,$4F00,$4F00,$4F00,$4F00,$4F00,$4F00,$4F02
	dw $4F01,$4F00,$4F00,$4F00,$4F00,$4F00,$4F00,$4F02
	db $01 : dw $001D5A
	dw $5001,$5000,$5000,$5000,$5000,$5000,$5000,$5002
	dw $5001,$5000,$5000,$5000,$5000,$5000,$5000,$5002
	db $01 : dw $001D5C
	dw $5101,$5100,$5100,$5100,$5100,$5100,$5100,$5102
	dw $5101,$5100,$5100,$5100,$5100,$5100,$5100,$5102
	db $01 : dw $001D5E
	dw $5201,$5200,$5200,$5200,$5200,$5200,$5200,$5202
	dw $5201,$5200,$5200,$5200,$5200,$5200,$5200,$5202
	db $02 : dw $001D60
	dw $5302,$5300,$5300,$5300,$5300,$5300,$5300,$5304
	dw $5302,$5300,$5300,$5300,$5300,$5300,$5300,$5304
	db $01 : dw $001D64
	dw $5401,$5400,$5400,$5400,$5400,$5400,$5400,$5402
	dw $5401,$5400,$5400,$5400,$5400,$5400,$5400,$5402
	db $02 : dw $001D66
	dw $5502,$5500,$5500,$5500,$5500,$5500,$5500,$5504
	dw $5502,$5500,$5500,$5500,$5500,$5500,$5500,$5504
	db $01 : dw $001D6A
	dw $5601,$5600,$5600,$5600,$5600,$5600,$5600,$5602
	dw $5601,$5600,$5600,$5600,$5600,$5600,$5600,$5602
	db $02 : dw $001D6C
	dw $5702,$5700,$5700,$5700,$5700,$5700,$5700,$5704
	dw $5702,$5700,$5700,$5700,$5700,$5700,$5700,$5704
	db $01 : dw $001D70
	dw $5801,$5800,$5800,$5800,$5800,$5800,$5800,$5802
	dw $5801,$5800,$5800,$5800,$5800,$5800,$5800,$5802
	db $02 : dw $001D72
	dw $5902,$5900,$5900,$5900,$5900,$5900,$5900,$5904
	dw $5902,$5900,$5900,$5900,$5900,$5900,$5900,$5904
	db $01 : dw $001D76
	dw $5A01,$5A00,$5A00,$5A00,$5A00,$5A00,$5A00,$5A02
	dw $5A01,$5A00,$5A00,$5A00,$5A00,$5A00,$5A00,$5A02
	db $04 : dw $001D78
	dw $5B04,$5B00,$5B00,$5B00,$5B00,$5B00,$5B00,$5B08
	dw $5B04,$5B00,$5B00,$5B0C,$5B00,$5B00,$5B00,$5B08
	db $01 : dw $001D80
	dw $5C01,$5C00,$5C00,$5C00,$5C00,$5C00,$5C00,$5C02
	dw $5C01,$5C00,$5C00,$5C00,$5C00,$5C00,$5C00,$5C02
	db $03 : dw $001D82
	dw $5D03,$5D00,$5D00,$5D00,$5D00,$5D00,$5D00,$5D06
	dw $5D03,$5D00,$5D00,$5D09,$5D00,$5D00,$5D00,$5D06
	db $01 : dw $001D88
	dw $5E00,$5E01,$5E00,$5E00,$5E00,$5E00,$5E00,$5E00
	dw $5E00,$5E01,$5E00,$5E00,$5E00,$5E00,$5E00,$5E01
	db $14 : dw $001D8A
	dw $6900,$6800,$6800,$6800,$6800,$6800,$6800,$7100
	dw $6800,$6800,$6800,$6800,$6800,$6800,$6800,$7100
	db $0E : dw $001DB2
	dw $6A0E,$6A00,$6A00,$6A00,$6A1C,$6A00,$6A00,$6A2A
	dw $6A0E,$6A00,$6A00,$6A00,$6A1C,$6A00,$6A00,$6A2A
	db $04 : dw $001DCE
	dw $6B04,$6B00,$6B00,$6B00,$6B08,$6B10,$6B00,$6B0C
	dw $6B04,$6B00,$6B00,$6B00,$6B08,$6B00,$6B00,$6B0C
	db $01 : dw $001DD6
	dw $6C01,$6C00,$6C00,$6C00,$6C02,$6C04,$6C00,$6C03
	dw $6C01,$6C00,$6C00,$6C00,$6C02,$6C00,$6C00,$6C03
	db $08 : dw $001DD8
	dw $9E08,$9E08,$9E08,$9E08,$9E08,$9E08,$9E00,$9E08
	dw $9E08,$9E08,$9E08,$9E08,$9E08,$9E08,$9E00,$9E08
	db $02 : dw $001DE8
	dw $9F00,$9F00,$9F00,$9F00,$9F00,$9F00,$9F00,$9F00
	dw $9F00,$9F00,$9F00,$9F00,$9F00,$9F00,$9F00,$9F00
	db $02 : dw $001DEC
	dw $A000,$A000,$A000,$A000,$A000,$A000,$A000,$A000
	dw $A000,$A000,$A000,$A000,$A000,$A000,$A000,$A000
	db $02 : dw $001DF0
	dw $A100,$A100,$A100,$A100,$A100,$A100,$A100,$A100
	dw $A100,$A100,$A100,$A100,$A100,$A100,$A100,$A100
	db $02 : dw $001DF4
	dw $A200,$A200,$A200,$A200,$A200,$A200,$A200,$A200
	dw $A200,$A200,$A200,$A200,$A200,$A200,$A200,$A200
	db $04 : dw $001DF8
	dw $A304,$A300,$A300,$A300,$A308,$A310,$A300,$A30C
	dw $A304,$A300,$A300,$A300,$A308,$A300,$A300,$A30C
	db $00							; descriptor table terminator

;---- Level-data blobs (object/sprite streams; consumed via Ptrs: table). ----
DATA_level_01_obj:
	incbin "LevelData/DATA_level_01_obj.bin"

DATA_level_3B_obj:
	incbin "LevelData/DATA_level_3B_obj.bin"

DATA_level_01_spr:
	incbin "LevelData/DATA_level_01_spr.bin"

DATA_level_3B_spr:
	incbin "LevelData/DATA_level_3B_spr.bin"

DATA_level_23_obj:
	incbin "LevelData/DATA_level_23_obj.bin"

DATA_level_5A_obj:
	incbin "LevelData/DATA_level_5A_obj.bin"

DATA_level_23_spr:
	incbin "LevelData/DATA_level_23_spr.bin"

DATA_level_5A_spr:
	incbin "LevelData/DATA_level_5A_spr.bin"

;---- Version-gated tail: V1.1 hoists DATA_10Fxxx level data up into this bank. ----
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
DATA_level_30_obj:							; V1.1 only: relocated from low-bank in V1.0
	incbin "LevelData/DATA_level_30_obj.bin"

DATA_level_67_obj:
	incbin "LevelData/DATA_level_67_obj.bin"

DATA_level_93_obj:
	incbin "LevelData/DATA_level_93_obj.bin"

DATA_level_B6_obj:
	incbin "LevelData/DATA_level_B6_obj.bin"

DATA_level_C5_obj:
	incbin "LevelData/DATA_level_C5_obj.bin"

DATA_level_CC_obj:
	incbin "LevelData/DATA_level_CC_obj.bin"

DATA_level_30_spr:
	incbin "LevelData/DATA_level_30_spr.bin"

DATA_level_67_spr:
	incbin "LevelData/DATA_level_67_spr.bin"

DATA_level_93_spr:
	incbin "LevelData/DATA_level_93_spr.bin"

DATA_level_B6_spr:
	incbin "LevelData/DATA_level_B6_spr.bin"

DATA_level_C5_spr:
	incbin "LevelData/DATA_level_C5_spr.bin"

DATA_level_CC_spr:
	incbin "LevelData/DATA_level_CC_spr.bin"

	%InsertGarbageData($4CFEE7, incbin, DATA_4CFEE7_YI_U2.bin)	; V1.1 padding tail
else
DATA_level_2A_obj:							; V1.0 only: stays at original location
	incbin "LevelData/DATA_level_2A_obj.bin"

DATA_level_61_obj:
	incbin "LevelData/DATA_level_61_obj.bin"

DATA_level_8D_obj:
	incbin "LevelData/DATA_level_8D_obj.bin"

DATA_level_B2_obj:
	incbin "LevelData/DATA_level_B2_obj.bin"

DATA_level_2A_spr:
	incbin "LevelData/DATA_level_2A_spr.bin"

DATA_level_61_spr:
	incbin "LevelData/DATA_level_61_spr.bin"

DATA_level_8D_spr:
	incbin "LevelData/DATA_level_8D_spr.bin"

DATA_level_B2_spr:
	incbin "LevelData/DATA_level_B2_spr.bin"

	%FREE_BYTES($4CFEB7, 329, $FF)				; V1.0: 329-byte $FF tail
endif
%BANK_END(<EndBank>)
endmacro
