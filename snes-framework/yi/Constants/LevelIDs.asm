;#############################################################################################################
;# LevelIDs.asm -- Symbolic names for WORLD-MAP SLOT ids (translevels).
;#
;# Each !Define_YI_LevelID_<Name> is a TRANSLEVEL: a world-map slot id, the value space of
;# !RAM_YI_Level_CurrentLevelFromMap ($7E:021A). It is NOT a level-data record id. The engine
;# resolves a slot to its level DATA in two steps (docs/levelloader.md S3):
;#   DATA_level_entrance_indexes[translevel] -> a DATA_map_level_entrances record, whose byte +0
;#   is the level-data RECORD id; record x6 then indexes `Ptrs:` for the object/sprite streams.
;#
;# Where these symbols appear:
;#   - byte +3 of DATA_map_level_entrances records -- the world-map progression target (the
;#     slot the Yoshi token advances to after a clear, stored into CurrentLevelFromMapLo);
;#   - engine CMPs against CurrentLevelFromMap (behaviour gates: ski levels, Welcome, etc.);
;#   - the Bank17 bonus dispatch table DATA_17B4BD (the six FlipCards..SlotMachine values are
;#     the per-world BONUS-TILE slots -- matching one boots the GameMode $2A minigame code
;#     scene; the map minigames have NO level-data records);
;#   - the Bank04 boot (LDA #WelcomeToYoshisIsland -> the engine's hardcoded start slot $0B).
;#
;# !! ID-SPACE WARNING !! Slots and records collide numerically (both start at 0; slots run
;# $00-$47 at 12 per world, records run $00-$DD) and agree only for 1-1..1-7. They diverge from
;# slot $07 on: 1-8's tile plays record $9B, 2-1's tile plays record $09, 5-Extra (Kamek's
;# Revenge, slot $38) plays record $2C, and slots $0A/$0B play records $38/$39 (the intro
;# cutscene / Welcome). Earlier revisions of this file glossed each define with "Ptrs[$XX] =
;# ..." as if the values were record ids -- that conflation is exactly the trap the
;# "two ID spaces" warning above exists for. Per-define "plays record" glosses below are derived from
;# the cart entrance tables (shiny-egg's editor-data/yi/level-map.json).
;#
;# Each world reserves 12 slots: 8 main + Extra (slot 8) + Bonus tile (slot 9, code-scene
;# minigame) + 2 padding -- except World 1, whose slots 10/11 are the engine-loaded intro
;# cutscene ($0A) and Welcome To Yoshi's Island ($0B).
;#
;# Cross-references:
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm -- entrance tables + Ptrs:.
;#   yi/Banks/Bank17.asm DATA_17B4BD -- the bonus-tile dispatch (GameMode $2A).
;#   yi/Banks/Bank04.asm:12365 -- the Welcome boot tweak (SMWC $04E1B4).
;#   docs/levelloader.md S3 -- the full translevel -> record -> Ptrs resolution.
;#   shiny-egg's snes-framework/scripts/types.ts -- the editor's translevelId/recordId contract.
;#############################################################################################################

; --- World 1 map slots $00-$0B: 8 main + Extra ($08) + Bonus tile ($09) + intro-cutscene slot $0A + Welcome slot $0B ---
!Define_YI_LevelID_MakeEggsThrowEggs = $00          ; map slot 1-1 (translevel $00); plays record $00 "Make Eggs, Throw Eggs"
!Define_YI_LevelID_WatchOutBelow = $01              ; map slot 1-2 (translevel $01); plays record $01 "Watch Out Below!"
!Define_YI_LevelID_TheCaveOfChompRock = $02         ; map slot 1-3 (translevel $02); plays record $02 "The Cave Of Chomp Rock"
!Define_YI_LevelID_BurtTheBashfulsFort = $03        ; map slot 1-4 (translevel $03); plays record $03 "Burt The Bashful's Fort"
!Define_YI_LevelID_HopHopDonutLifts = $04           ; map slot 1-5 (translevel $04); plays record $04 "Hop! Hop! Donut Lifts"
!Define_YI_LevelID_ShyGuysOnStilts = $05            ; map slot 1-6 (translevel $05); plays record $05 "Shy-Guys On Stilts"
!Define_YI_LevelID_TouchFuzzyGetDizzy = $06         ; map slot 1-7 (translevel $06); plays record $06 "Touch Fuzzy Get Dizzy"
!Define_YI_LevelID_SalvoTheSlimesCastle = $07       ; map slot 1-8 (translevel $07); plays record $9B "Salvo The Slime's Castle"
!Define_YI_LevelID_PoochyAintStupid = $08           ; map slot 1-Extra (translevel $08); plays record $08 "Poochy Ain't Stupid"
!Define_YI_LevelID_FlipCards = $09                  ; W1 bonus-tile slot $09 (translevel); boots the GameMode $2A minigame code scene -- NO level-data record (Bank17 DATA_17B4BD)
;$0A                                                ; intro-cutscene slot: plays record $38 via the gm38 cutscene; unnamed here

; --- World 2 map slots $0C-$17: 8 main + Extra ($14) + Bonus tile ($15) + padding $16-$17 ---
!Define_YI_LevelID_WelcomeToYoshisIsland = $0B      ; map slot $0B (the pre-W1 Welcome slot; the catalog lists it as "W2 Intro"); plays record $39 "Welcome To Yoshi's Island" -- the engine's hardcoded boot slot (Bank04:12362 SMWC tweak $04E1B4: "change to [$00] to boot straight into 1-1")
!Define_YI_LevelID_VisitKoopaAndParaKoopa = $0C     ; map slot 2-1 (translevel $0C); plays record $09 "Visit Koopa And Para-Koopa"
!Define_YI_LevelID_TheBaseballBoys = $0D            ; map slot 2-2 (translevel $0D); plays record $0A "The Baseball Boys"
!Define_YI_LevelID_WhatsGustyTasteLike = $0E        ; map slot 2-3 (translevel $0E); plays record $0B "What's Gusty Taste Like?"
!Define_YI_LevelID_BiggerBoosFort = $0F             ; map slot 2-4 (translevel $0F); plays record $0C "Bigger Boo's Fort"
!Define_YI_LevelID_WatchOutForLakitu = $10          ; map slot 2-5 (translevel $10); plays record $0D "Watch Out For Lakitu"
!Define_YI_LevelID_TheCaveOfMysteryMaze = $11       ; map slot 2-6 (translevel $11); plays record $0E "The Cave Of The Mystery Maze"
!Define_YI_LevelID_LakitusWall = $12                ; map slot 2-7 (translevel $12); plays record $0F "Lakitu's Wall"
!Define_YI_LevelID_ThePottedGhostsCastle = $13      ; map slot 2-8 (translevel $13); plays record $10 "The Potted Ghost's Castle"
!Define_YI_LevelID_HitThatSwitch = $14              ; map slot 2-Extra (translevel $14); plays record $11 "Hit That Switch!!"
!Define_YI_LevelID_ScratchAndMatch = $15            ; W2 bonus-tile slot $15 (translevel); boots the GameMode $2A minigame code scene -- NO level-data record (Bank17 DATA_17B4BD)
;$16                                                ; padding slot (no map tile)
;$17                                                ; padding slot (no map tile)

; --- World 3 map slots $18-$23: 8 main + Extra ($20) + Bonus tile ($21) + padding $22-$23 ---
!Define_YI_LevelID_WelcomeToMonkeyWorld = $18       ; map slot 3-1 (translevel $18); plays record $12 "Welcome To Monkey World!"
!Define_YI_LevelID_JungleRhythm = $19               ; map slot 3-2 (translevel $19); plays record $13 "Jungle Rhythm ..."
!Define_YI_LevelID_NepEnutsDomain = $1A             ; map slot 3-3 (translevel $1A); plays record $14 "Nep-Enuts' Domain"
!Define_YI_LevelID_PrinceFroggysFort = $1B          ; map slot 3-4 (translevel $1B); plays record $15 "Prince Froggy's Fort"
!Define_YI_LevelID_JamminThroughTheTrees = $1C      ; map slot 3-5 (translevel $1C); plays record $16 "Jammin' Through The Trees"
!Define_YI_LevelID_TheCaveOfHarryHedgehog = $1D     ; map slot 3-6 (translevel $1D); plays record $17 "The Cave Of Harry Hedgehog"
!Define_YI_LevelID_MonkeysFavoriteLake = $1E        ; map slot 3-7 (translevel $1E); plays record $18 "Monkeys' Favorite Lake"
!Define_YI_LevelID_NavalPiranhasCastle = $1F        ; map slot 3-8 (translevel $1F); plays record $19 "Naval Piranha's Castle"
!Define_YI_LevelID_MoreMonkeyMadness = $20          ; map slot 3-Extra (translevel $20); plays record $1A "More Monkey Madness"
!Define_YI_LevelID_DrawingLots = $21                ; W3 bonus-tile slot $21 (translevel); boots the GameMode $2A minigame code scene -- NO level-data record (Bank17 DATA_17B4BD)
;$22                                                ; padding slot (no map tile)
;$23                                                ; padding slot (no map tile)

; --- World 4 map slots $24-$2F: 8 main + Extra ($2C) + Bonus tile ($2D) + padding $2E-$2F ---
!Define_YI_LevelID_GoGoMario = $24                  ; map slot 4-1 (translevel $24); plays record $1B "GO! GO! MARIO!!"
!Define_YI_LevelID_TheCaveOfTheLakitus = $25        ; map slot 4-2 (translevel $25); plays record $1C "The Cave Of The Lakitus"
!Define_YI_LevelID_DontLookBack = $26               ; map slot 4-3 (translevel $26); plays record $1D "Don't Look Back!"
!Define_YI_LevelID_MarchingMildesFort = $27         ; map slot 4-4 (translevel $27); plays record $1E "Marching Milde's Fort"
!Define_YI_LevelID_ChompRockZone = $28              ; map slot 4-5 (translevel $28); plays record $1F "Chomp Rock Zone"
!Define_YI_LevelID_LakeShoreParadise = $29          ; map slot 4-6 (translevel $29); plays record $20 "Lake Shore Paradise"
!Define_YI_LevelID_RideLikeTheWind = $2A            ; map slot 4-7 (translevel $2A); plays record $21 "Ride Like The Wind"
!Define_YI_LevelID_HookbillTheKoopasCastle = $2B    ; map slot 4-8 (translevel $2B); plays record $22 "Hookbill The Koopa's Castle"
!Define_YI_LevelID_TheImpossibleMaze = $2C          ; map slot 4-Extra (translevel $2C); plays record $5A "The Impossible? Maze"
!Define_YI_LevelID_MatchCards = $2D                 ; W4 bonus-tile slot $2D (translevel); boots the GameMode $2A minigame code scene -- NO level-data record (Bank17 DATA_17B4BD)
;$2E                                                ; padding slot (no map tile)
;$2F                                                ; padding slot (no map tile)

; --- World 5 map slots $30-$3B: 8 main + Extra ($38) + Bonus tile ($39) + padding $3A-$3B ---
!Define_YI_LevelID_BLIZZARD = $30                   ; map slot 5-1 (translevel $30); plays record $24 "BLIZZARD!!!"
!Define_YI_LevelID_RideTheSkiLifts = $31            ; map slot 5-2 (translevel $31); plays record $25 "Ride The Ski Lifts"
!Define_YI_LevelID_DangerIcyConditionsAhead = $32   ; map slot 5-3 (translevel $32); plays record $26 "Danger - Icy Conditions Ahead" -- ski-engine behaviour gates CMP this slot id (Bank03)
!Define_YI_LevelID_SluggyTheUnshavensFort = $33     ; map slot 5-4 (translevel $33); plays record $27 "Sluggy The Unshaven's Fort"
!Define_YI_LevelID_GoonieRides = $34                ; map slot 5-5 (translevel $34); plays record $28 "Goonie Rides!"
!Define_YI_LevelID_WelcomeToCloudWorld = $35        ; map slot 5-6 (translevel $35); plays record $29 "Welcome To Cloud World"
!Define_YI_LevelID_ShiftingPlatformsAhead = $36     ; map slot 5-7 (translevel $36); plays record $2A "Shifting Platforms Ahead"
!Define_YI_LevelID_RaphaelTheRavensCastle = $37     ; map slot 5-8 (translevel $37); plays record $2B "Raphael The Raven's Castle"
!Define_YI_LevelID_KameksRevenge = $38              ; map slot 5-Extra (translevel $38); plays record $2C "Kamek's Revenge" -- ski-engine behaviour gates CMP this slot id (Bank03)
!Define_YI_LevelID_Roulette = $39                   ; W5 bonus-tile slot $39 (translevel); boots the GameMode $2A minigame code scene -- NO level-data record (Bank17 DATA_17B4BD)
;$3A                                                ; padding slot (no map tile)
;$3B                                                ; padding slot (no map tile)

; --- World 6 map slots $3C-$47: 8 main + Extra ($44) + Bonus tile ($45) + padding $46-$47 ---
!Define_YI_LevelID_ScareySkeletonGoonies = $3C      ; map slot 6-1 (translevel $3C); plays record $2D "Scary Skeleton Goonies!"
!Define_YI_LevelID_TheCaveOfTheBandits = $3D        ; map slot 6-2 (translevel $3D); plays record $2E "The Cave Of The Bandits"
!Define_YI_LevelID_BewareTheSpinningLogs = $3E      ; map slot 6-3 (translevel $3E); plays record $2F "Beware The Spinning Logs"
!Define_YI_LevelID_TapTapTheRedNosesFort = $3F      ; map slot 6-4 (translevel $3F); plays record $30 "Tap-Tap The Red Nose's Fort"
!Define_YI_LevelID_TheVeryLoooooongCave = $40       ; map slot 6-5 (translevel $40); plays record $31 "The Very Loooooong Cave"
!Define_YI_LevelID_TheDeepUndergroundMaze = $41     ; map slot 6-6 (translevel $41); plays record $32 "The Deep, Underground Maze"
!Define_YI_LevelID_KEEPMOVING = $42                 ; map slot 6-7 (translevel $42); plays record $33 "KEEP MOVING!!!!"
!Define_YI_LevelID_KingBowsersCastle = $43          ; map slot 6-8 (translevel $43); plays record $34 "King Bowser's Castle"
!Define_YI_LevelID_CastlesMasterpieceSet = $44      ; map slot 6-Extra (translevel $44); plays record $35 "Castles - Masterpiece Set"
!Define_YI_LevelID_SlotMachine = $45                ; W6 bonus-tile slot $45 (translevel); boots the GameMode $2A minigame code scene -- NO level-data record (Bank17 DATA_17B4BD)
;$46                                                ; padding slot (no map tile)
;$47                                                ; padding slot (no map tile)

; --- Vestigial: an unreferenced define (note the LevelRecord prefix -- this is a RECORD id) ---
; Level-data records $48..$D9 are sub-rooms / pipe destinations / boss arenas with no slot
; of their own (see the per-row glosses in the DATATABLE Ptrs block); $DA-$DD are the
; engine-reserved seed-contest / final-boss arena block.
!Define_YI_LevelRecord_GoGoMarioDashChainSubRoom = $80 ; VESTIGIAL: no code references this define, and no asm site loads record $80 -- it is reached only via record $52's screen exits (the 4-1 "GO! GO! MARIO!!" Superstar dash chain). Was "!Define_YI_LevelID_PrologueIntro" until 2026-06-12 -- a slot/record conflation; the actual storybook prologue (gm05/07) is a pure GFX/code scene with no level record, and the gm38 prologue cutscene boots map slot $0A (record $38).
