;#############################################################################################################
;# DATATABLE_YI_LevelDataPtrsAndEntranceData.asm
;#
;# THE level-data pointer table for Yoshi's Island. This macro emits five back-to-back data
;# blocks. The most important is `Ptrs:` -- 222 entries of `dl object_ptr, sprite_ptr`
;# (6 bytes per level), keyed by the runtime level ID byte. Any editor or any code that
;# touches per-level object/sprite data lands in this table eventually.
;#
;# Emit sites (version-gated -- see docs/levelloader.md S3 for the full story):
;#   yi/Banks/Bank17.asm:13424   %DATATABLE_YI_LevelDataPtrsAndEntranceData($17F3E7)   -- V1.0 (Ptrs: at $17:F7C3)
;#   yi/Banks/Bank0F.asm:11249   %DATATABLE_YI_LevelDataPtrsAndEntranceData($0FE446)   -- V1.1 (Ptrs: at $0F:E822)
;# Only ONE of these compiles per build, gated by !ROM_YI_U2 in the surrounding Bank file.
;# V1.0 ships from Bank17; V1.1 hoisted the entire table to bank $0F and pads $17:F7C3 with
;# `FF FE FE ...`. The MD5 cb472164c5a71ccd3739963390ec6a50 gate validates the V1.0 emit.
;#
;# Block layout (offsets are relative to the macro's <Address> argument):
;#   +$000 (e.g. $17F3E7)  DATA_level_entrance_indexes        (138 bytes = 69 word entries)
;#   +$08A (e.g. $17F471)  DATA_map_level_entrances           (224 bytes = 56 records x 4 bytes)
;#   +$16A (e.g. $17F551)  DATA_level_midway_entrance_indexes (138 bytes = 69 word entries)
;#   +$1F4 (e.g. $17F5DB)  DATA_map_level_midway_entrances    (488 bytes = 122 records x 4 bytes)
;#   +$3DC (e.g. $17F7C3)  Ptrs: (level_pointer_table)         (222 entries x 6 bytes = dl obj_ptr, spr_ptr)
;#
;# The translevel-ID -> level-data resolution is a TWO-STAGE indirection (verified against
;# the engine: Bank01 CODE_01AFA4 + CODE_load_level_data_pointers stage-intro path, Bank10 CODE_10DA33 gm38):
;#   !RAM_YI_Level_CurrentLevelFromMapLo ($021A)   = world-map tile-slot ("translevel") index
;#     -> DATA_level_entrance_indexes[translevel x2]   = byte offset into DATA_map_level_entrances
;#       -> DATA_map_level_entrances record byte +0    = level-data ID; (x6) indexes Ptrs:
;# So Ptrs: is indexed by record-byte-0 (the level-data ID), NOT directly by $021A, and NOT
;# by the !Define_YI_LevelID_* symbol that sits in record byte +3 (that byte is the progression
;# target -- see the DATA_map_level_entrances header below).
;#
;# Ptrs: layout -- each row is `dl object_data, sprite_data` for one playable level slot.
;# Level ID groupings (the runtime level-ID byte indexes Ptrs: directly, NOT positionally
;# through the entrance tables -- see yi/Constants/LevelIDs.asm for the canonical name<->ID
;# mapping). Worlds are organized as 10-slot blocks (8 main + 1 secret extra + 1 mini-game),
;# with 2 unused gap slots between worlds:
;#   $00-$09   World 1 main + Extra + MiniGame                       (gap at $0A)
;#   $0B-$15   World 2 main + Extra + MiniGame                       (gaps at $16-$17)
;#   $18-$21   World 3 main + Extra + MiniGame                       (gaps at $22-$23)
;#   $24-$2D   World 4 main + Extra + MiniGame                       (gaps at $2E-$2F)
;#   $30-$39   World 5 main + Extra + MiniGame                       (gaps at $3A-$3B)
;#   $3C-$45   World 6 main + Extra + MiniGame                       (gaps at $46-$47)
;#   $48-$7F   Sub-rooms / pipe destinations / midway-entry rooms (no friendly names)
;#   $80       PrologueIntro (storybook scroll preceding W1-1; reached via gamemode chain)
;#   $81-$D9   More sub-rooms (no friendly names)
;#   $DA-$DD   Seed-spitting contests, final boss arena
;# Total = 222 entries. Slots labeled "(unnamed slot; not in LevelIDs.asm)" are reached
;# numerically by the engine (via DATA_map_level_midway_entrances / pipe entries), not via
;# world-map tile selection. Some entries reuse the same DATA_* labels (vestigial / shared rooms).
;#
;# Cross-references:
;#   docs/levelloader.md S3                       -- table semantics, V1.0/V1.1 emit gate, sub-table semantics.
;#   yoshisisland-disassembly/disassembly/bank17.asm:13360..13700+
;#                                                -- Raidenthequick's V1.0-only disassembly. Source for the
;#                                                   `DATA_level_entrance_indexes`, `DATA_map_level_entrances`,
;#                                                   `DATA_level_midway_entrance_indexes`, `DATA_map_level_midway_entrances`,
;#                                                   `level_object_pointers`, `level_sprite_pointers` labels.
;#   yoshisisland-disassembly/docs/named_main_labels.txt -- index of named labels.
;#   yi/Routine_Macros_YI.asm                     -- single incsrc of this file (the emit happens at the
;#                                                   per-bank %DATATABLE_YI_LevelDataPtrsAndEntranceData call
;#                                                   inside Bank17 (V1.0) or Bank0F (V1.1)).
;#   yi/Constants/LevelIDs.asm                    -- !Define_YI_LevelID_* enumeration used as record key.
;#
;# WARNING -- the byte that keys the Ptrs: lookup is record byte +0 (the level-data ID),
;# NOT the !Define_YI_LevelID_* symbol you see written on each `db` line. That symbol sits in
;# record byte +3, which is a DIFFERENT field (the world-map progression target for the entrance
;# table, the player entrance-state for the midway table -- see the per-table headers below).
;# Because byte +0 is a raw number while byte +3 carries the symbol, the symbol on each line
;# names the *next* level (the progression target), not the level that line's record loads.
;# Edit byte +0 to repoint a tile at a different level's object/sprite data; edit byte +3 to
;# change progression / entrance-state. Keep both consistent with LevelIDs.asm.
;#############################################################################################################
macro DATATABLE_YI_LevelDataPtrsAndEntranceData(Address)
namespace YI_LevelDataPtrsAndEntranceData
%InsertMacroAtXPosition(<Address>)

;-------------------------------------------------------------------------
; DATA_level_entrance_indexes -- 138-byte word-index table.
; Maps world-map TILE positions to a byte offset into `DATA_map_level_entrances`
; (DATA_map_level_entrances) below. Each world reserves 12 entries (8 playable + 3 zero
; padding + 1 score-screen slot); entries that read $0000 are unused tiles.
; Raidenthequick: bank17.asm `DATA_level_entrance_indexes`.
;-------------------------------------------------------------------------
DATA_17F3E7:
DATA_level_entrance_indexes:
	dw $0000,$0004,$0008,$000C,$0010,$0014,$0018,$001C
	dw $0020,$0000,$00D8,$00DC,$0024,$0028,$002C,$0030
	dw $0034,$0038,$003C,$0040,$0044,$0000,$0000,$0000
	dw $0048,$004C,$0050,$0054,$0058,$005C,$0060,$0064
	dw $0068,$0000,$0000,$0000,$006C,$0070,$0074,$0078
	dw $007C,$0080,$0084,$0088,$008C,$0000,$0000,$0000
	dw $0090,$0094,$0098,$009C,$00A0,$00A4,$00A8,$00AC
	dw $00B0,$0000,$0000,$0000,$00B4,$00B8,$00BC,$00C0
	dw $00C4,$00C8,$00CC,$00D0,$00D4

;-------------------------------------------------------------------------
; DATA_map_level_entrances -- 56 records, 4 bytes each. Selected by the index table above
; (DATA_level_entrance_indexes[translevel] gives the byte offset to a record).
; Record fields (byte +0, +1, +2, +3):
;   +0 -- level-data ID. (x6) indexes Ptrs: below for this tile's object/sprite data. This is
;         the !Define_YI_LevelID_* VALUE of the level this tile plays (read by gm0c CODE_load_level_data_pointers).
;   +1 -- entrance X position (x16 -> Player.X)
;   +2 -- entrance Y position (x16 -> Player.Y)
;   +3 -- world-map progression target: the tile-slot the Yoshi token advances to after this
;         level is cleared. Read by Bank17 CODE_17A871 (stored into CurrentLevelFromMapLo, used
;         to index LevelClearFlags). This is the field that carries the !Define_YI_LevelID_*
;         symbol written on each `db` line below -- so that symbol names the NEXT level, not the
;         level loaded by this record's byte +0.
; Raidenthequick: bank17.asm `DATA_map_level_entrances`.
;-------------------------------------------------------------------------
DATA_17F471:
DATA_map_level_entrances:
	; editor-owned span (Shiny Egg world-map editor); see snes-framework/scripts/asm/entrance-table.ts
	;@editable:world-map-entrances begin
	db $00,$07,$77,!Define_YI_LevelID_WatchOutBelow
	db $01,$07,$7A,!Define_YI_LevelID_TheCaveOfChompRock
	db $02,$03,$7A,!Define_YI_LevelID_BurtTheBashfulsFort
	db $03,$07,$7A,!Define_YI_LevelID_HopHopDonutLifts
	db $04,$77,$6A,!Define_YI_LevelID_ShyGuysOnStilts
	db $05,$07,$7A,!Define_YI_LevelID_TouchFuzzyGetDizzy
	db $06,$07,$7A,!Define_YI_LevelID_SalvoTheSlimesCastle
	db $9B,$68,$4A,!Define_YI_LevelID_VisitKoopaAndParaKoopa
	db $08,$09,$7A,!Define_YI_LevelID_FlipCards
	db $09,$07,$5A,!Define_YI_LevelID_TheBaseballBoys
	db $0A,$07,$7A,!Define_YI_LevelID_WhatsGustyTasteLike
	db $0B,$07,$7A,!Define_YI_LevelID_BiggerBoosFort
	db $0C,$07,$7A,!Define_YI_LevelID_WatchOutForLakitu
	db $0D,$07,$7A,!Define_YI_LevelID_TheCaveOfMysteryMaze
	db $0E,$07,$18,!Define_YI_LevelID_LakitusWall
	db $0F,$F8,$2A,!Define_YI_LevelID_ThePottedGhostsCastle
	db $10,$04,$2A,!Define_YI_LevelID_WelcomeToMonkeyWorld
	db $11,$0E,$7A,!Define_YI_LevelID_HitThatSwitch
	db $12,$07,$7A,!Define_YI_LevelID_JungleRhythm
	db $13,$07,$7A,!Define_YI_LevelID_NepEnutsDomain
	db $14,$04,$6A,!Define_YI_LevelID_PrinceFroggysFort
	db $15,$07,$3A,!Define_YI_LevelID_JamminThroughTheTrees
	db $16,$07,$7A,!Define_YI_LevelID_TheCaveOfHarryHedgehog
	db $17,$07,$4A,!Define_YI_LevelID_MonkeysFavoriteLake
	db $18,$48,$7A,!Define_YI_LevelID_NavalPiranhasCastle
	db $19,$05,$7A,!Define_YI_LevelID_GoGoMario
	db $1A,$07,$7A,!Define_YI_LevelID_MoreMonkeyMadness
	db $1B,$07,$7A,!Define_YI_LevelID_TheCaveOfTheLakitus
	db $1C,$08,$7A,!Define_YI_LevelID_DontLookBack
	db $1D,$07,$5A,!Define_YI_LevelID_MarchingMildesFort
	db $1E,$07,$7A,!Define_YI_LevelID_ChompRockZone
	db $1F,$06,$1A,!Define_YI_LevelID_LakeShoreParadise
	db $20,$07,$6A,!Define_YI_LevelID_RideLikeTheWind
	db $21,$07,$6A,!Define_YI_LevelID_HookbillTheKoopasCastle
	db $22,$07,$6A,!Define_YI_LevelID_BLIZZARD
	db $5A,$7D,$1A,!Define_YI_LevelID_TheImpossibleMaze
	db $24,$07,$7A,!Define_YI_LevelID_RideTheSkiLifts
	db $25,$07,$6A,!Define_YI_LevelID_DangerIcyConditionsAhead
	db $26,$07,$3A,!Define_YI_LevelID_SluggyTheUnshavensFort
	db $27,$07,$7A,!Define_YI_LevelID_GoonieRides
	db $28,$07,$5A,!Define_YI_LevelID_WelcomeToCloudWorld
	db $29,$05,$5A,!Define_YI_LevelID_ShiftingPlatformsAhead
	db $2A,$97,$6A,!Define_YI_LevelID_RaphaelTheRavensCastle
	db $2B,$38,$5A,!Define_YI_LevelID_ScareySkeletonGoonies
	db $2C,$07,$4A,!Define_YI_LevelID_KameksRevenge
	db $2D,$07,$7A,!Define_YI_LevelID_TheCaveOfTheBandits
	db $2E,$07,$5A,!Define_YI_LevelID_BewareTheSpinningLogs
	db $2F,$07,$4A,!Define_YI_LevelID_TapTapTheRedNosesFort
	db $30,$07,$7A,!Define_YI_LevelID_TheVeryLoooooongCave
	db $31,$07,$39,!Define_YI_LevelID_TheDeepUndergroundMaze
	db $32,$07,$4A,!Define_YI_LevelID_KEEPMOVING
	db $33,$05,$7A,!Define_YI_LevelID_KingBowsersCastle
	db $34,$03,$7A,!Define_YI_LevelID_KEEPMOVING
	db $35,$07,$7A,!Define_YI_LevelID_CastlesMasterpieceSet
	db $38,$08,$7A,!Define_YI_LevelID_MakeEggsThrowEggs
	db $39,$08,$76,!Define_YI_LevelID_MakeEggsThrowEggs
	;@editable:world-map-entrances end

;-------------------------------------------------------------------------
; DATA_level_midway_entrance_indexes -- 138-byte word index (69 entries).
; Same shape as DATA_level_entrance_indexes but for MIDPOINT (post-checkpoint)
; warp data. Indexes into DATA_map_level_midway_entrances below. The midway lookup adds
; (CheckpointReentryPage x4) to this base offset (Bank01 CODE_01E652) so a level can have one
; midway record per checkpoint page.
; Raidenthequick: bank17.asm `DATA_level_midway_entrance_indexes`.
;-------------------------------------------------------------------------
DATA_17F551:
DATA_level_midway_entrance_indexes:
	dw $0000,$0004,$000C,$0014,$001C,$0020,$0024,$0028
	dw $0000,$0000,$0000,$0000,$0038,$003C,$0044,$004C
	dw $005C,$0064,$0074,$0084,$0000,$0000,$0000,$0000
	dw $0094,$009C,$00A0,$00AC,$00B8,$00BC,$00C0,$00C8
	dw $0000,$0000,$0000,$0000,$00D0,$00DC,$00E4,$00EC
	dw $00FC,$0100,$0108,$0110,$0000,$0000,$0000,$0000
	dw $011C,$0124,$0130,$0140,$014C,$0158,$0160,$0168
	dw $0178,$0000,$0000,$0000,$0188,$0194,$01A0,$01A8
	dw $01B8,$01C4,$01C8,$01D0,$01E0

;-------------------------------------------------------------------------
; DATA_map_level_midway_entrances -- 122 records, 4 bytes each (written here as 2-word dw rows).
; Fields +0..+2 match DATA_map_level_entrances; field +3 DIFFERS:
;   +0 -- level-data ID (x6 indexes Ptrs: -- the re-entry destination level)
;   +1 -- entrance X position (x16 -> Player.X)
;   +2 -- entrance Y position (x16 -> Player.Y)
;   +3 -- player entrance state (NOT a progression target). Bank01 CODE_01E652 (gm35 midring
;         restart) stages bytes +0/+1/+2/+3 into the live exit table $7F:7E00..03; the gm0c
;         re-entry path (CODE_set_player_entrance_from_exit) then consumes $7F:7E03 as !EXRAM_YI_Player_CurrentStateLo.
; Records appear here as word-pairs (`dw lohi, lohi`) because the raw bytes group naturally into
; a u16/u16 layout; cross-reference bank17.asm:13571+ for the byte-by-byte breakdown.
; Raidenthequick: bank17.asm `DATA_map_level_midway_entrances`.
;-------------------------------------------------------------------------
DATA_17F5DB:
DATA_map_level_midway_entrances:
	; editor-owned span (Shiny Egg world-map editor); see snes-framework/scripts/asm/entrance-table.ts
	;@editable:world-map-midway-entrances begin
	dw $7800,$0076,$8201,$007B,$093B,$0049,$0000,$0000
	dw $753C,$0068,$F703,$0078,$EC6E,$0068,$0E04,$005B
	dw $6105,$0070,$7006,$0075,$0907,$0037,$0000,$0000
	dw $0000,$0000,$E99B,$003F,$7809,$0053,$AD0A,$004B
	dw $0C42,$0029,$0000,$0000,$0B43,$002A,$5A44,$0061
	dw $0000,$0000,$0000,$0000,$06CE,$0076,$0000,$0000
	dw $0B45,$007A,$0000,$0000,$3246,$006C,$0000,$0000
	dw $08BD,$007A,$9E0F,$0024,$0000,$0000,$0000,$0000
	dw $0377,$005A,$A448,$0077,$0478,$0027,$0CC8,$0039
	dw $1FBE,$0034,$0000,$0000,$3A4A,$0058,$AB13,$007A
	dw $F214,$0078,$864C,$0078,$057A,$006B,$ED4D,$0038
	dw $0000,$0000,$09A3,$007A,$3D4E,$006A,$624F,$0059
	dw $0000,$0000,$F150,$006B,$0000,$0000,$7151,$006B
	dw $0000,$0000,$0F52,$0067,$1D80,$006E,$0000,$0000
	dw $3D81,$004A,$6B1D,$003F,$0354,$003A,$0000,$0000
	dw $7855,$0061,$73AA,$007A,$76C1,$0079,$411F,$0052
	dw $0000,$0000,$1457,$0073,$0000,$0000,$0358,$003A
	dw $0000,$0000,$CB59,$0070,$2C86,$0059,$0000,$0000
	dw $305B,$0040,$5888,$0044,$935C,$0038,$8A25,$005E
	dw $0000,$0000,$1A5D,$0034,$0000,$0000,$04AF,$000A
	dw $B627,$0049,$085E,$004A,$44B0,$007A,$0000,$0000
	dw $0B5F,$004A,$148B,$0046,$0000,$0000,$0260,$006A
	dw $0000,$0000,$098D,$0039,$0000,$0000,$3762,$0015
	dw $0000,$0000,$4FB3,$006B,$0000,$0000,$0000,$0000
	dw $0000,$0000,$0563,$002A,$0000,$0000,$1264,$0079
	dw $0A90,$007A,$0000,$0000,$0E65,$007A,$0891,$0078
	dw $0000,$0000,$0766,$004A,$0000,$0000,$5593,$0027
	dw $52B6,$0027,$C8C5,$0071,$0000,$0000,$0568,$0068
	dw $0A94,$0076,$4E32,$0055,$E133,$000A,$436A,$001E
	dw $F734,$007A,$756B,$000A,$0000,$0000,$04DD,$007A
	dw $D735,$001C,$676C,$004B
	;@editable:world-map-midway-entrances end

;-------------------------------------------------------------------------
; Ptrs: -- THE 222-entry per-level data pointer table. Six bytes per level:
; `dl object_data_ptr, sprite_data_ptr` (two 3-byte 24-bit LoROM addresses).
; Indexed by the level-data ID byte (0..221) x6. That byte is NOT $021A directly -- it is
; record byte +0 of a DATA_map_level_entrances / DATA_map_level_midway_entrances record (fresh
; entry / midring restart), or byte +0 of the live exit table $7F:7E00,x (screen-exit warp).
; See docs/levelloader.md S3 for the full translevel -> level-data resolution.
;
; Raidenthequick splits this into two parallel labels at adjacent addresses
; (`level_object_pointers` + `level_sprite_pointers`), but every line here
; defines BOTH pointers for one level, so a single descriptive alias suffices.
;
; Layout note -- pointers reach into many different banks:
;   $00:xxxx  (LoROM banks 00..17)  worlds 1 main objects/sprites
;   $4C-51:xxxx  (HiROM/SuperFX banks)  some bonus rooms and world 6
; The order BELOW IS THE LEVEL-ID ORDER. Each `dl` is one level slot.
; Level IDs are the index into this table -- e.g. level $00 = first dl,
; level $35 = entry 54 (last main-world entry), etc. See LevelIDs.asm.
;-------------------------------------------------------------------------
Ptrs:
level_pointer_table:              ; Raidenthequick: level_object_pointers / level_sprite_pointers
;$17F7C3
	; --- World 1: 8 main + Extra + MiniGame (IDs $00-$09), gap at $0A ---
	dl DATA_level_00_obj,DATA_level_00_spr    ; $00 MakeEggsThrowEggs            -- W1-1 main
	dl DATA_level_01_obj,DATA_level_01_spr    ; $01 WatchOutBelow                -- W1-2 main (SuperFX bank $4C)
	dl DATA_level_02_obj,DATA_level_02_spr    ; $02 TheCaveOfChompRock           -- W1-3 main
	dl DATA_level_03_obj,DATA_level_03_spr    ; $03 BurtTheBashfulsFort          -- W1-4 fort
	dl DATA_level_04_obj,DATA_level_04_spr    ; $04 HopHopDonutLifts             -- W1-5 main
	dl DATA_level_05_obj,DATA_level_05_spr    ; $05 ShyGuysOnStilts              -- W1-6 main
	dl DATA_level_06_obj,DATA_level_06_spr    ; $06 TouchFuzzyGetDizzy           -- W1-7 main
	dl DATA_level_07_obj,DATA_level_07_spr    ; $07 SalvoTheSlimesCastle         -- W1-8 castle
	dl DATA_level_08_obj,DATA_level_08_spr    ; $08 PoochyAintStupid             -- W1-Extra (secret)
	dl DATA_level_09_obj,DATA_level_09_spr    ; $09 FlipCards                    -- W1-MiniGame
	dl DATA_level_0A_obj,DATA_level_0A_spr    ; $0A (unnamed slot; not in LevelIDs.asm -- sub-room / pipe destination)
	; --- World 2 intro + 8 main + Extra + MiniGame (IDs $0B-$15), gaps at $16-$17 ---
	dl DATA_level_0B_obj,DATA_level_0B_spr    ; $0B WelcomeToYoshisIsland        -- pre-W1 intro (NOT W2-1; engine boot-default per Bank04:12362)
	dl DATA_level_0C_obj,DATA_level_0C_spr    ; $0C VisitKoopaAndParaKoopa       -- W2-1 main
	dl DATA_level_0D_obj,DATA_level_0D_spr    ; $0D TheBaseballBoys              -- W2-2 main
	dl DATA_level_0E_obj,DATA_level_0E_spr    ; $0E WhatsGustyTasteLike          -- W2-3 main
	dl DATA_level_0F_obj,DATA_level_0F_spr    ; $0F BiggerBoosFort               -- W2-4 fort
	dl DATA_level_10_obj,DATA_level_10_spr    ; $10 WatchOutForLakitu            -- W2-5 main (bank $00 -- early bank)
	dl DATA_level_11_obj,DATA_level_11_spr    ; $11 TheCaveOfMysteryMaze         -- W2-6 main
	dl DATA_level_12_obj,DATA_level_12_spr    ; $12 LakitusWall                  -- W2-7 main
	dl DATA_level_13_obj,DATA_level_13_spr    ; $13 ThePottedGhostsCastle        -- W2-8 castle
	dl DATA_level_14_obj,DATA_level_14_spr    ; $14 HitThatSwitch                -- W2-Extra (secret)
	dl DATA_level_15_obj,DATA_level_15_spr    ; $15 ScratchAndMatch              -- W2-MiniGame
	dl DATA_level_16_obj,DATA_level_16_spr    ; $16 (unnamed slot; not in LevelIDs.asm)
	dl DATA_level_17_obj,DATA_level_17_spr    ; $17 (unnamed slot; not in LevelIDs.asm)
	; --- World 3: 8 main + Extra + MiniGame (IDs $18-$21), gaps at $22-$23 ---
	dl DATA_level_18_obj,DATA_level_18_spr    ; $18 WelcomeToMonkeyWorld         -- W3-1 main
	dl DATA_level_19_obj,DATA_14C6C6-$02    ; $19 JungleRhythm                 -- W3-2 main (sprite ptr biased -2; vestigial header anomaly)
	dl DATA_level_1A_obj,DATA_level_1A_spr    ; $1A NepEnutsDomain               -- W3-3 main
	dl DATA_level_1B_obj,DATA_level_1B_spr    ; $1B PrinceFroggysFort            -- W3-4 fort
	dl DATA_level_1C_obj,DATA_level_1C_spr    ; $1C JamminThroughTheTrees        -- W3-5 main
	dl DATA_level_1D_obj,DATA_level_1D_spr    ; $1D TheCaveOfHarryHedgehog       -- W3-6 main
	dl DATA_level_1E_obj,DATA_level_1E_spr    ; $1E MonkeysFavoriteLake          -- W3-7 main
	dl DATA_level_1F_obj,DATA_level_1F_spr    ; $1F NavalPiranhasCastle          -- W3-8 castle
	dl DATA_level_20_obj,DATA_level_20_spr    ; $20 MoreMonkeyMadness            -- W3-Extra (secret)
	dl DATA_level_21_obj,DATA_level_21_spr    ; $21 DrawingLots                  -- W3-MiniGame
	dl DATA_level_22_obj,DATA_level_22_spr    ; $22 (unnamed slot; not in LevelIDs.asm)
	dl DATA_level_23_obj,DATA_level_23_spr    ; $23 (unnamed slot; not in LevelIDs.asm; SuperFX bank $4C)
	; --- World 4: 8 main + Extra + MiniGame (IDs $24-$2D), gaps at $2E-$2F ---
	dl DATA_level_24_obj,DATA_level_24_spr    ; $24 GoGoMario                    -- W4-1 main
	dl DATA_level_25_obj,DATA_level_25_spr    ; $25 TheCaveOfTheLakitus          -- W4-2 main
	dl DATA_level_26_obj,DATA_level_26_spr    ; $26 DontLookBack                 -- W4-3 main
	dl DATA_level_27_obj,DATA_level_27_spr    ; $27 MarchingMildesFort           -- W4-4 fort
	dl DATA_level_28_obj,DATA_level_28_spr    ; $28 ChompRockZone                -- W4-5 main
	dl DATA_level_29_obj,DATA_level_29_spr    ; $29 LakeShoreParadise            -- W4-6 main
	dl DATA_level_2A_obj,DATA_level_2A_spr    ; $2A RideLikeTheWind              -- W4-7 main (SuperFX bank $4C)
	dl DATA_level_2B_obj,DATA_level_2B_spr    ; $2B HookbillTheKoopasCastle      -- W4-8 castle
	dl DATA_level_2C_obj,DATA_level_2C_spr    ; $2C TheImpossibleMaze            -- W4-Extra (secret)
	dl DATA_level_2D_obj,DATA_level_2D_spr    ; $2D MatchCards                   -- W4-MiniGame
	dl DATA_level_2E_obj,DATA_level_2E_spr    ; $2E (unnamed slot; not in LevelIDs.asm)
	dl DATA_level_2F_obj,DATA_level_2F_spr    ; $2F (unnamed slot; not in LevelIDs.asm)
	; --- World 5: 8 main + Extra + MiniGame (IDs $30-$39), gaps at $3A-$3B ---
	dl DATA_level_30_obj,DATA_level_30_spr    ; $30 BLIZZARD                     -- W5-1 main
	dl DATA_level_31_obj,DATA_level_31_spr    ; $31 RideTheSkiLifts              -- W5-2 main
	dl DATA_level_32_obj,DATA_level_32_spr    ; $32 DangerIcyConditionsAhead     -- W5-3 main (SuperFX bank $51)
	dl DATA_level_33_obj,DATA_level_33_spr    ; $33 SluggyTheUnshavensFort       -- W5-4 fort
	dl DATA_level_34_obj,DATA_level_34_spr    ; $34 GoonieRides                  -- W5-5 main
	dl DATA_level_35_obj,DATA_level_35_spr    ; $35 WelcomeToCloudWorld          -- W5-6 main
	dl DATA_level_36_obj,DATA_level_36_spr    ; $36 ShiftingPlatformsAhead       -- W5-7 main
	dl DATA_level_37_obj,DATA_level_37_spr    ; $37 RaphaelTheRavensCastle       -- W5-8 castle
	; $38 KameksRevenge (W5-Extra) -- this row is data-shaped but engine code paths
	; override the lookup at this index (Kamek's Revenge intro is hardcoded).
	dl DATA_level_38_obj,DATA_level_38_spr    ; $38 KameksRevenge                -- W5-Extra (engine-hardcoded; row is shadowed)
	dl DATA_level_39_obj,DATA_level_39_spr    ; $39 Roulette                     -- W5-MiniGame
	dl DATA_level_3A_obj,DATA_level_3A_spr    ; $3A (unnamed slot; not in LevelIDs.asm)
	dl DATA_level_3B_obj,DATA_level_3B_spr    ; $3B (unnamed slot; not in LevelIDs.asm; SuperFX bank $4C)
	; --- World 6: 8 main + Extra + MiniGame (IDs $3C-$45), gaps at $46-$47 ---
	dl DATA_level_3C_obj,DATA_level_3C_spr    ; $3C ScareySkeletonGoonies        -- W6-1 main
	dl DATA_level_3D_obj,DATA_level_3D_spr    ; $3D TheCaveOfTheBandits          -- W6-2 main
	dl DATA_level_3E_obj,DATA_level_3E_spr    ; $3E BewareTheSpinningLogs        -- W6-3 main
	dl DATA_level_3F_obj,DATA_level_3F_spr    ; $3F TapTapTheRedNosesFort        -- W6-4 fort
	dl DATA_level_40_obj,DATA_level_40_spr    ; $40 TheVeryLoooooongCave         -- W6-5 main
	dl DATA_level_41_obj,DATA_level_41_spr    ; $41 TheDeepUndergroundMaze       -- W6-6 main
	dl DATA_level_42_obj,DATA_level_42_spr    ; $42 KEEPMOVING                   -- W6-7 main ("KEEP MOVING!!!!")
	dl DATA_level_43_obj,DATA_level_43_spr    ; $43 KingBowsersCastle            -- W6-8 castle (final boss)
	dl DATA_level_44_obj,DATA_level_44_spr    ; $44 CastlesMasterpieceSet        -- W6-Extra (secret)
	dl DATA_level_45_obj,DATA_level_45_spr    ; $45 SlotMachine                  -- W6-MiniGame
	dl DATA_level_46_obj,DATA_level_46_spr    ; $46 (unnamed slot; not in LevelIDs.asm)
	dl DATA_level_47_obj,DATA_level_47_spr    ; $47 (unnamed slot; not in LevelIDs.asm)
	; --- Sub-rooms / pipe destinations / midway-entry rooms (IDs $48-$7F + $80 PrologueIntro + $81-$D9) ---
	; These slots are reached via DATA_map_level_midway_entrances and per-level
	; pipe/door entries, NOT via direct world-map selection. They have no
	; friendly names in LevelIDs.asm (except $80 PrologueIntro) and are accessed
	; numerically by the engine.
	dl DATA_level_48_obj,DATA_level_48_spr    ; $48
	dl DATA_level_49_obj,DATA_level_49_spr    ; $49
	dl DATA_level_4A_obj,DATA_level_4A_spr    ; $4A
	dl DATA_level_4B_obj,DATA_level_4B_spr    ; $4B
	dl DATA_level_4C_obj,DATA_level_4C_spr    ; $4C
	dl DATA_level_4D_obj,DATA_level_4D_spr    ; $4D
	dl DATA_level_4E_obj,DATA_level_4E_spr    ; $4E
	dl DATA_level_4F_obj,DATA_level_4F_spr    ; $4F
	dl DATA_level_50_obj,DATA_level_50_spr    ; $50
	dl DATA_level_51_obj,DATA_level_51_spr    ; $51
	dl DATA_level_52_obj,DATA_level_52_spr    ; $52
	dl DATA_level_53_obj,DATA_level_53_spr    ; $53
	dl DATA_level_54_obj,DATA_level_54_spr    ; $54
	dl DATA_level_55_obj,DATA_level_55_spr    ; $55
	dl DATA_level_56_obj,DATA_level_56_spr    ; $56
	dl DATA_level_57_obj,DATA_level_57_spr    ; $57
	dl DATA_level_58_obj,DATA_level_58_spr    ; $58
	dl DATA_level_59_obj,DATA_level_59_spr    ; $59
	dl DATA_level_5A_obj,DATA_level_5A_spr    ; $5A (SuperFX bank $4C)
	dl DATA_level_5B_obj,DATA_level_5B_spr    ; $5B
	dl DATA_level_5C_obj,DATA_level_5C_spr    ; $5C
	dl DATA_level_5D_obj,DATA_level_5D_spr    ; $5D
	dl DATA_level_5E_obj,DATA_level_5E_spr    ; $5E
	dl DATA_level_5F_obj,DATA_level_5F_spr    ; $5F
	dl DATA_level_60_obj,DATA_level_60_spr    ; $60
	dl DATA_level_61_obj,DATA_level_61_spr    ; $61 (SuperFX bank $4C)
	dl DATA_level_62_obj,DATA_level_62_spr    ; $62
	dl DATA_level_63_obj,DATA_level_63_spr    ; $63
	dl DATA_level_64_obj,DATA_level_64_spr    ; $64
	dl DATA_level_65_obj,DATA_level_65_spr    ; $65
	dl DATA_level_66_obj,DATA_level_66_spr    ; $66
	dl DATA_level_67_obj,DATA_level_67_spr    ; $67
	dl DATA_level_68_obj,DATA_level_68_spr    ; $68
	dl DATA_level_69_obj,DATA_level_69_spr    ; $69 (SuperFX bank $51)
	dl DATA_level_6A_obj,DATA_level_6A_spr    ; $6A
	dl DATA_level_6B_obj,DATA_level_6B_spr    ; $6B
	dl DATA_level_6C_obj,DATA_level_6C_spr    ; $6C
	dl DATA_level_6D_obj,DATA_level_6D_spr    ; $6D
	dl DATA_level_6E_obj,DATA_level_6E_spr    ; $6E
	dl DATA_level_6F_obj,DATA_level_6F_spr    ; $6F
	dl DATA_level_70_obj,DATA_level_70_spr    ; $70
	dl DATA_level_71_obj,DATA_level_71_spr    ; $71
	dl DATA_level_72_obj,DATA_level_72_spr    ; $72
	dl DATA_level_73_obj,DATA_level_73_spr    ; $73
	dl DATA_level_74_obj,DATA_level_74_spr    ; $74
	dl DATA_level_75_obj,DATA_level_75_spr    ; $75
	dl DATA_level_76_obj,DATA_level_76_spr    ; $76
	dl DATA_level_77_obj,DATA_level_77_spr    ; $77
	dl DATA_level_78_obj,DATA_level_78_spr    ; $78
	dl DATA_level_79_obj,DATA_level_79_spr    ; $79
	dl DATA_level_7A_obj,DATA_level_7A_spr    ; $7A
	dl DATA_level_7B_obj,DATA_level_7B_spr    ; $7B
	dl DATA_level_7C_obj,DATA_level_7C_spr    ; $7C
	dl DATA_169D23,DATA_level_7D_spr    ; $7D
	dl DATA_level_7E_obj,DATA_level_7E_spr    ; $7E
	dl DATA_level_7F_obj,DATA_level_7F_spr    ; $7F
	dl DATA_level_80_obj,DATA_level_80_spr    ; $80 PrologueIntro                -- storybook scroll preceding World 1-1
	dl DATA_level_81_obj,DATA_level_81_spr    ; $81
	dl DATA_level_82_obj,DATA_level_82_spr    ; $82
	dl DATA_level_83_obj,DATA_level_83_spr    ; $83
	dl DATA_level_84_obj,DATA_level_84_spr    ; $84
	dl DATA_level_85_obj,DATA_level_85_spr    ; $85
	dl DATA_level_86_obj,DATA_level_86_spr    ; $86
	dl DATA_level_87_obj,DATA_level_87_spr    ; $87
	dl DATA_level_88_obj,DATA_level_88_spr    ; $88
	dl DATA_level_89_obj,DATA_level_89_spr    ; $89
	dl DATA_level_8A_obj,DATA_level_8A_spr    ; $8A
	dl DATA_level_8B_obj,DATA_level_8B_spr    ; $8B
	dl DATA_level_8C_obj,DATA_level_8C_spr    ; $8C
	dl DATA_level_8D_obj,DATA_level_8D_spr    ; $8D (SuperFX bank $4C)
	dl DATA_level_8E_obj,DATA_level_8E_spr    ; $8E
	dl DATA_level_8F_obj,DATA_level_8F_spr    ; $8F
	dl DATA_level_90_obj,DATA_level_90_spr    ; $90
	dl DATA_level_91_obj,DATA_level_91_spr    ; $91
	dl DATA_level_92_obj,DATA_level_92_spr    ; $92
	dl DATA_level_93_obj,DATA_level_93_spr    ; $93
	dl DATA_level_94_obj,DATA_level_94_spr    ; $94
	dl DATA_level_95_obj,DATA_level_95_spr    ; $95 (SuperFX bank $51)
	dl DATA_level_96_obj,DATA_level_96_spr    ; $96
	dl DATA_level_97_obj,DATA_level_97_spr    ; $97
	dl DATA_level_98_obj,DATA_level_98_spr    ; $98
	; (Sub-rooms continued.)
	dl DATA_level_99_obj,DATA_level_99_spr    ; $99
	dl DATA_level_9A_obj,DATA_level_9A_spr    ; $9A
	dl DATA_level_9B_obj,DATA_level_9B_spr    ; $9B
	dl DATA_level_9C_obj,DATA_level_9C_spr    ; $9C
	dl DATA_level_9D_obj,DATA_level_9D_spr    ; $9D
	dl DATA_level_9E_obj,DATA_level_9E_spr    ; $9E
	dl DATA_level_9F_obj,DATA_level_9F_spr    ; $9F
	dl DATA_level_A0_obj,DATA_level_A0_spr    ; $A0
	dl DATA_level_A1_obj,DATA_level_A1_spr    ; $A1
	dl DATA_level_A2_obj,DATA_level_A2_spr    ; $A2
	dl DATA_level_A3_obj,DATA_level_A3_spr    ; $A3
	dl DATA_level_A4_obj,DATA_level_A4_spr    ; $A4
	dl DATA_level_A5_obj,DATA_level_A5_spr    ; $A5
	dl DATA_level_A6_obj,DATA_level_A6_spr    ; $A6
	dl DATA_level_A7_obj,DATA_level_A7_spr    ; $A7
	dl DATA_level_A8_obj,DATA_level_A8_spr    ; $A8
	dl DATA_level_A9_obj,DATA_level_A9_spr    ; $A9
	dl DATA_level_AA_obj,DATA_level_AA_spr    ; $AA
	dl DATA_level_AB_obj,DATA_level_AB_spr    ; $AB
	dl DATA_level_AC_obj,DATA_level_AC_spr    ; $AC
	dl DATA_level_AD_obj,DATA_level_AD_spr    ; $AD
	dl DATA_level_AE_obj,DATA_level_AE_spr    ; $AE
	dl DATA_level_AF_obj,DATA_level_AF_spr    ; $AF
	dl DATA_level_B0_obj,DATA_level_B0_spr    ; $B0
	dl DATA_level_B1_obj,DATA_level_B1_spr    ; $B1
	dl DATA_level_B2_obj,DATA_level_B2_spr    ; $B2 (SuperFX bank $4C)
	dl DATA_level_B3_obj,DATA_level_B3_spr    ; $B3
	dl DATA_level_B4_obj,DATA_level_B4_spr    ; $B4
	dl DATA_level_B5_obj,DATA_level_B5_spr    ; $B5
	dl DATA_level_B6_obj,DATA_level_B6_spr    ; $B6
	dl DATA_level_B7_obj,DATA_level_B7_spr    ; $B7
	dl DATA_level_B8_obj,DATA_level_B8_spr    ; $B8
	dl DATA_level_B9_obj,DATA_level_B9_spr    ; $B9
	dl DATA_level_BA_obj,DATA_level_BA_spr    ; $BA
	dl DATA_level_BB_obj,DATA_level_BB_spr    ; $BB
	dl DATA_level_BC_obj,DATA_level_BC_spr    ; $BC
	dl DATA_level_BD_obj,DATA_level_BD_spr    ; $BD
	dl DATA_level_BE_obj,DATA_level_BE_spr    ; $BE
	dl DATA_11DC0F,DATA_level_BF_spr    ; $BF
	dl DATA_level_C0_obj,DATA_level_C0_spr    ; $C0
	dl DATA_level_C1_obj,DATA_level_C1_spr    ; $C1
	dl DATA_level_C2_obj,DATA_level_C2_spr    ; $C2
	dl DATA_level_C3_obj,DATA_level_C3_spr    ; $C3
	dl DATA_level_C4_obj,DATA_level_C4_spr    ; $C4
	dl DATA_level_C5_obj,DATA_level_C5_spr    ; $C5
	dl DATA_level_C6_obj,DATA_level_C6_spr    ; $C6
	dl DATA_level_C7_obj,DATA_level_C7_spr    ; $C7
	dl DATA_level_C8_obj,DATA_level_C8_spr    ; $C8
	; (Sub-rooms continued.)
	dl DATA_level_C9_obj,DATA_level_C9_spr    ; $C9
	dl DATA_level_CA_obj,DATA_level_CA_spr    ; $CA
	dl DATA_level_CB_obj,DATA_16F097-$02    ; $CB sprite ptr biased by -2 (header anomaly, same pattern as $19)
	dl DATA_level_CC_obj,DATA_level_CC_spr    ; $CC
	dl DATA_level_CD_obj,DATA_level_CD_spr    ; $CD
	dl DATA_level_CE_obj,DATA_level_CE_spr    ; $CE
	dl DATA_level_CF_obj,DATA_level_CF_spr    ; $CF
	dl DATA_11DC0F,DATA_level_D0_spr    ; $D0 (note: object ptr reused from $BF)
	dl DATA_level_D1_obj,DATA_level_D1_spr    ; $D1
	dl DATA_level_D2_obj,DATA_level_D2_spr    ; $D2
	dl DATA_level_D3_obj,DATA_level_D3_spr    ; $D3
	dl DATA_level_D4_obj,DATA_level_D4_spr    ; $D4
	dl DATA_level_D5_obj,DATA_level_D5_spr    ; $D5
	dl DATA_level_D6_obj,DATA_level_D6_spr    ; $D6
	dl DATA_level_D7_obj,DATA_level_D7_spr    ; $D7
	dl DATA_level_D8_obj,DATA_level_D8_spr    ; $D8
	dl DATA_level_D9_obj,DATA_level_D9_spr    ; $D9
	; --- Seed-spitting contests / final boss arena (IDs $DA-$DD) ---
	; The last four slots correspond to the seed-contest mini-game rooms
	; and the final Bowser boss arena. See docs/levelloader.md S3 groupings.
	dl DATA_15FCEA,DATA_15FFD5    ; $DA seed contest A
	dl DATA_15FCEA,DATA_15FFD5    ; $DB seed contest B (duplicate -- shared room data)
	dl DATA_level_DC_obj,DATA_level_DC_spr    ; $DC unused / placeholder
	dl DATA_level_DD_obj,DATA_level_DD_spr    ; $DD final-boss arena

namespace off
endmacro
