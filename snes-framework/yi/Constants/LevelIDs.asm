;#############################################################################################################
;# LevelIDs.asm -- Symbolic names for the 222-entry level pointer table.
;#
;# Each !Define_YI_LevelID_<Name> is the BYTE that indexes into the `Ptrs:` block of the
;# DATATABLE_YI_LevelDataPtrsAndEntranceData macro (yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm;
;# see docs/levelloader.md S3 for the table semantics). Ptrs: holds 222 `dl object_ptr, sprite_ptr`
;# rows (6 bytes per entry).
;# The level ID byte is used directly as the row index: e.g. level ID $00 selects the first
;# `dl` line (`dl DATA_1681C7,DATA_168583`).
;#
;# These same symbols ALSO appear in byte +3 of the `map_level_entrances` records (DATA_17F471),
;# but there they are the world-map PROGRESSION TARGET (the next tile-slot to advance to after a
;# clear, read by Bank17 CODE_17A871), NOT the Ptrs: key for that record -- the Ptrs: key is the
;# record's byte +0. So the symbol written on each entrance `db` line names the level you advance
;# TO, not the level that record loads. Editing a !Define here therefore shifts both the Ptrs: row
;# it selects (byte +0 of some record) AND the progression target wherever it appears (byte +3).
;# The midway table `map_level_midway_entrances` (DATA_17F5DB) does NOT use these symbols (its
;# byte +3 is a player entrance-state, written as raw values).
;#
;# World groupings (10-slot blocks: 8 main levels + 1 secret extra + 1 mini-game, then 2 unused):
;#   $00-$09   World 1 (Make Eggs...Throw Eggs through Flip Cards) + gaps at $0A
;#   $0B       WelcomeToYoshisIsland (special intro; engine boot-default per Bank04:12362 SMWC tweak,
;#             never reached from any world-map tile or midway entrance; title text has no W-N prefix)
;#   $0C-$15   World 2 (Visit Koopa And Para-Koopa through Scratch and Match) + gaps at $16-$17
;#   $18-$21   World 3 (Welcome to Monkey World through Drawing Lots) + gaps at $22-$23
;#   $24-$2D   World 4 (Go! Go! Mario through Match Cards) + gaps at $2E-$2F
;#   $30-$39   World 5 (BLIZZARD through Roulette) + gaps at $3A-$3B
;#   $3C-$45   World 6 (Scary Skeleton Goonies through Slot Machine) + gaps at $46-$47
;#   $80       PrologueIntro (story scroll preceding World 1-1)
;# The 222-entry pointer table also reserves IDs $48..$7F, $81..$D9 for sub-rooms /
;# pipe destinations / boss arenas / mini-game rooms not named here, plus $DA-$DD for the
;# seed-spitting contests and final boss arena. See docs/levelloader.md S3 for the full
;# layout. Special-case note: 95 of the 222 pointer-table entries reference empty `.bin`
;# files (vestigial slots from the upstream extractor not reaching certain cart addresses);
;# additionally, level `$38` (Kamek's Revenge) is engine-hardcoded and its slot points at
;# no real data. A level editor should filter by `!Define_YI_LevelID_*` membership rather
;# than enumerating all 222 entries.
;#
;# The per-line data-pointer hints below ("Ptrs[$XX] = DATA_YYYY,DATA_ZZZZ") were verified
;# against the actual row data in the DATATABLE file. Both the !Define values and the
;# data-pointer hints are now consistent with the engine's runtime lookup (Ptrs[!Define value]).
;#
;# Cross-references:
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm
;#       -- the macro body containing Ptrs: + the 4 entrance sub-tables.
;#   yi/Banks/Bank17.asm:13424                     -- V1.0 emit site %DATATABLE_YI_LevelDataPtrsAndEntranceData($17F3E7).
;#   yi/Banks/Bank0F.asm:11249                     -- V1.1 emit site %DATATABLE_YI_LevelDataPtrsAndEntranceData($0FE446).
;#   docs/levelloader.md S3                        -- table semantics + V1.0/V1.1 version gate notes.
;#############################################################################################################

; --- World 1: levels (8 main + extra + mini-game), gap at $0A ---
!Define_YI_LevelID_MakeEggsThrowEggs = $00          ; 1-1 main; Ptrs[$00] = DATA_1681C7,DATA_168583 (bank $16)
!Define_YI_LevelID_WatchOutBelow = $01              ; 1-2 main; Ptrs[$01] = DATA_4CE0A2,DATA_4CE976 (SuperFX bank $4C)
!Define_YI_LevelID_TheCaveOfChompRock = $02         ; 1-3 main; Ptrs[$02] = DATA_168671,DATA_1690B5 (bank $16)
!Define_YI_LevelID_BurtTheBashfulsFort = $03        ; 1-4 fort; Ptrs[$03] = DATA_148000,DATA_14869D (bank $14)
!Define_YI_LevelID_HopHopDonutLifts = $04           ; 1-5 main; Ptrs[$04] = DATA_10F262,DATA_10F4FA (bank $10)
!Define_YI_LevelID_ShyGuysOnStilts = $05            ; 1-6 main; Ptrs[$05] = DATA_11CA15,DATA_11D2BB (bank $11)
!Define_YI_LevelID_TouchFuzzyGetDizzy = $06         ; 1-7 main; Ptrs[$06] = DATA_12C709,DATA_12CF07 (bank $12)
!Define_YI_LevelID_SalvoTheSlimesCastle = $07       ; 1-8 castle; Ptrs[$07] = DATA_158000,DATA_15866B (bank $15)
!Define_YI_LevelID_PoochyAintStupid = $08           ; 1-Extra secret; Ptrs[$08] = DATA_1691D5,DATA_1694A5 (bank $16)
!Define_YI_LevelID_FlipCards = $09                  ; 1-MiniGame; Ptrs[$09] = DATA_12D00A,DATA_12D8E2 (bank $12)
;$0A                                                ; gap -- pointer-table slot reserved/unused for world 1

; --- World 2: levels (8 main + extra + mini-game), gaps at $16-$17 ---
!Define_YI_LevelID_WelcomeToYoshisIsland = $0B      ; Special pre-W1 intro level; Ptrs[$0B] = DATA_15876C,DATA_159245 (bank $15). Engine boot-default (Bank04:12362 SMWC tweak: "change to [$00] to skip Welcome and boot straight into 1-1"). NOT reached from any world-map tile or midway entrance. Title text is just "Welcome To Yoshi's Island" with no W-N prefix, so it sits in the W2 LevelID block but is NOT W2-1 (= $0C VisitKoopaAndParaKoopa).
!Define_YI_LevelID_VisitKoopaAndParaKoopa = $0C     ; 2-1 main; Ptrs[$0C] = DATA_1593F5,DATA_159D95 (bank $15) -- reached from W1 map tile $9B (record 7 in DATA_map_level_entrances) -- crosses W1->W2 boundary
!Define_YI_LevelID_TheBaseballBoys = $0D            ; 2-2 main; Ptrs[$0D] = DATA_159F1A,DATA_15AB8E (bank $15)
!Define_YI_LevelID_WhatsGustyTasteLike = $0E        ; 2-3 main; Ptrs[$0E] = DATA_15AD93,DATA_15B8F5 (bank $15)
!Define_YI_LevelID_BiggerBoosFort = $0F             ; 2-4 fort; Ptrs[$0F] = DATA_14960E,DATA_14A39B (bank $14)
!Define_YI_LevelID_WatchOutForLakitu = $10          ; 2-5 main; Ptrs[$10] = DATA_00EBD4,DATA_00F614 (bank $00)
!Define_YI_LevelID_TheCaveOfMysteryMaze = $11       ; 2-6 main; Ptrs[$11] = DATA_12DA6C,DATA_12DD4A (bank $12) -- in-game title is "The Cave Of The Mystery Maze" (label drops the second "The")
!Define_YI_LevelID_LakitusWall = $12                ; 2-7 main; Ptrs[$12] = DATA_14A5BC,DATA_14AD4A (bank $14)
!Define_YI_LevelID_ThePottedGhostsCastle = $13      ; 2-8 castle; Ptrs[$13] = DATA_14AEA8,DATA_14B123 (bank $14)
!Define_YI_LevelID_HitThatSwitch = $14              ; 2-Extra secret; Ptrs[$14] = DATA_14B23B,DATA_14BAE3 (bank $14)
!Define_YI_LevelID_ScratchAndMatch = $15            ; 2-MiniGame; Ptrs[$15] = DATA_11D3EF,DATA_11DE77 (bank $11)
;$16                                                ; gap -- pointer-table slot reserved/unused
;$17                                                ; gap -- pointer-table slot reserved/unused

; --- World 3: levels (8 main + extra + mini-game), gaps at $22-$23 ---
!Define_YI_LevelID_WelcomeToMonkeyWorld = $18       ; 3-1 main; Ptrs[$18] = DATA_169F7F,DATA_16A7C0 (bank $16)
!Define_YI_LevelID_JungleRhythm = $19               ; 3-2 main; Ptrs[$19] = DATA_14BD23,DATA_14C6C6-$02 (bank $14; sprite ptr biased -2)
!Define_YI_LevelID_NepEnutsDomain = $1A             ; 3-3 main; Ptrs[$1A] = DATA_15C307,DATA_15C4E2 (bank $15)
!Define_YI_LevelID_PrinceFroggysFort = $1B          ; 3-4 fort; Ptrs[$1B] = DATA_14C711,DATA_14D2C1 (bank $14)
!Define_YI_LevelID_JamminThroughTheTrees = $1C      ; 3-5 main; Ptrs[$1C] = DATA_14D488,DATA_14DE8F (bank $14)
!Define_YI_LevelID_TheCaveOfHarryHedgehog = $1D     ; 3-6 main; Ptrs[$1D] = DATA_15C59E,DATA_15CA77 (bank $15)
!Define_YI_LevelID_MonkeysFavoriteLake = $1E        ; 3-7 main; Ptrs[$1E] = DATA_12DDE1,DATA_12E8A7 (bank $12)
!Define_YI_LevelID_NavalPiranhasCastle = $1F        ; 3-8 castle; Ptrs[$1F] = DATA_14E035,DATA_14E794 (bank $14)
!Define_YI_LevelID_MoreMonkeyMadness = $20          ; 3-Extra secret; Ptrs[$20] = DATA_16A998,DATA_16B3C1 (bank $16)
!Define_YI_LevelID_DrawingLots = $21                ; 3-MiniGame; Ptrs[$21] = DATA_11E01E,DATA_11E767 (bank $11)
;$22                                                ; gap -- pointer-table slot reserved/unused
;$23                                                ; gap -- pointer-table slot reserved/unused

; --- World 4: levels (8 main + extra + mini-game), gaps at $2E-$2F ---
!Define_YI_LevelID_GoGoMario = $24                  ; 4-1 main; Ptrs[$24] = DATA_15CC16,DATA_15D759 (bank $15)
!Define_YI_LevelID_TheCaveOfTheLakitus = $25        ; 4-2 main; Ptrs[$25] = DATA_14E920,DATA_14EFF2 (bank $14)
!Define_YI_LevelID_DontLookBack = $26               ; 4-3 main; Ptrs[$26] = DATA_15D90D,DATA_15E689 (bank $15)
!Define_YI_LevelID_MarchingMildesFort = $27         ; 4-4 fort; Ptrs[$27] = DATA_16C17D,DATA_16CBDA (bank $16)
!Define_YI_LevelID_ChompRockZone = $28              ; 4-5 main; Ptrs[$28] = DATA_16CDF5,DATA_16DD21 (bank $16)
!Define_YI_LevelID_LakeShoreParadise = $29          ; 4-6 main; Ptrs[$29] = DATA_12EB8A,DATA_12EEC2 (bank $12)
!Define_YI_LevelID_RideLikeTheWind = $2A            ; 4-7 main; Ptrs[$2A] = DATA_4CF4D9,DATA_4CFD2F (SuperFX bank $4C)
!Define_YI_LevelID_HookbillTheKoopasCastle = $2B    ; 4-8 castle; Ptrs[$2B] = DATA_16DF78,DATA_16EF27 (bank $16)
!Define_YI_LevelID_TheImpossibleMaze = $2C          ; 4-Extra secret; Ptrs[$2C] = DATA_12F04E,DATA_12F77D (bank $12)
!Define_YI_LevelID_MatchCards = $2D                 ; 4-MiniGame; Ptrs[$2D] = DATA_11E8B1,DATA_11F1E1 (bank $11)
;$2E                                                ; gap -- pointer-table slot reserved/unused
;$2F                                                ; gap -- pointer-table slot reserved/unused

; --- World 5: levels (8 main + extra + mini-game), gaps at $3A-$3B ---
!Define_YI_LevelID_BLIZZARD = $30                   ; 5-1 main; Ptrs[$30] = DATA_10F595,DATA_10FCE5 (bank $10)
!Define_YI_LevelID_RideTheSkiLifts = $31            ; 5-2 main; Ptrs[$31] = DATA_16F0FE,DATA_16FEC6 (bank $16)
!Define_YI_LevelID_DangerIcyConditionsAhead = $32   ; 5-3 main; Ptrs[$32] = DATA_510000,DATA_510EEC (SuperFX bank $51)
!Define_YI_LevelID_SluggyTheUnshavensFort = $33     ; 5-4 fort; Ptrs[$33] = DATA_14F13E,DATA_14FCB8 (bank $14)
!Define_YI_LevelID_GoonieRides = $34                ; 5-5 main; Ptrs[$34] = DATA_15F196,DATA_15FD47 (bank $15)
!Define_YI_LevelID_WelcomeToCloudWorld = $35        ; 5-6 main; Ptrs[$35] = DATA_11F3DE,DATA_11FB9F (bank $11)
!Define_YI_LevelID_ShiftingPlatformsAhead = $36     ; 5-7 main; Ptrs[$36] = DATA_14FEC4,DATA_14FF83 (bank $14)
!Define_YI_LevelID_RaphaelTheRavensCastle = $37     ; 5-8 castle; Ptrs[$37] = DATA_14FF1F,DATA_14FF91 (bank $14)
!Define_YI_LevelID_KameksRevenge = $38              ; 5-Extra secret; Ptrs[$38] = DATA_168000,DATA_16855E (engine-hardcoded; data-shaped but engine overrides -- see docs/levelloader.md S3)
!Define_YI_LevelID_Roulette = $39                   ; 5-MiniGame; Ptrs[$39] = DATA_168042,DATA_168560 (bank $16)
;$3A                                                ; gap -- pointer-table slot reserved/unused
;$3B                                                ; gap -- pointer-table slot reserved/unused

; --- World 6: levels (8 main + extra + mini-game), gaps at $46-$47 ---
!Define_YI_LevelID_ScareySkeletonGoonies = $3C      ; 6-1 main; Ptrs[$3C] = DATA_16873E,DATA_1690D5 (bank $16) -- in-game title is "Scary Skeleton Goonies!" (label has the historical "Scarey" spelling)
!Define_YI_LevelID_TheCaveOfTheBandits = $3D        ; 6-2 main; Ptrs[$3D] = DATA_1484B6,DATA_14878F (bank $14)
!Define_YI_LevelID_BewareTheSpinningLogs = $3E      ; 6-3 main; Ptrs[$3E] = DATA_11CC89,DATA_11D34D (bank $11)
!Define_YI_LevelID_TapTapTheRedNosesFort = $3F      ; 6-4 fort; Ptrs[$3F] = DATA_12CE48,DATA_12CFBD (bank $12)
!Define_YI_LevelID_TheVeryLoooooongCave = $40       ; 6-5 main; Ptrs[$40] = DATA_158250,DATA_1586C7 (bank $15)
!Define_YI_LevelID_TheDeepUndergroundMaze = $41     ; 6-6 main; Ptrs[$41] = DATA_12D150,DATA_12D91D (bank $12)
!Define_YI_LevelID_KEEPMOVING = $42                 ; 6-7 main "KEEP MOVING!!!!"; Ptrs[$42] = DATA_148D0D,DATA_1494B7 (bank $14)
!Define_YI_LevelID_KingBowsersCastle = $43          ; 6-8 castle (final boss); Ptrs[$43] = DATA_1589F7,DATA_1592B0 (bank $15)
!Define_YI_LevelID_CastlesMasterpieceSet = $44      ; 6-Extra secret; Ptrs[$44] = DATA_159527,DATA_159DC4 (bank $15)
!Define_YI_LevelID_SlotMachine = $45                ; 6-MiniGame; Ptrs[$45] = DATA_15A301,DATA_15AC4A (bank $15)
;$46                                                ; gap -- pointer-table slot reserved/unused
;$47                                                ; gap -- pointer-table slot reserved/unused

; --- Special: out-of-band ID for the storybook prologue scene ---
; Pointer-table slots $48..$7F, $81..$D9, $DA..$DD hold sub-rooms / pipe destinations /
; boss arenas / seed-contest rooms; the engine accesses them by numeric ID without
; symbolic names. !Define_YI_LevelID_PrologueIntro = $80 is the lone non-main-world entry
; that has a friendly name here, because the prologue is invoked from a distinct game-mode
; path (yi-reference S22.1 mode $00-$04 "Nintendo Presents intro") rather than the normal
; overworld -> level-entry pipeline.
!Define_YI_LevelID_PrologueIntro = $80              ; Storybook prologue scene; Ptrs[$80] = DATA_14CD2E,DATA_14D3B8 (bank $14)
