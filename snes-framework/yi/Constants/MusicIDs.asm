;#############################################################################################################
;# MusicIDs.asm -- Music engine command bytes + song-slot IDs.
;#
;# The low byte written to !RAM_YI_Global_PlayMusicLo ($00:004D) is consumed by the SPC700 music engine
;# (CODE_music_global_opcode_dispatch). Values $00-$13 load a song; values $F0-$F6 / $FF are control opcodes.
;#
;# Song IDs $01-$14 are *slot selectors* into whatever song/sample bank set is currently resident in ARAM.
;# The level-header music setting drives CODE_set_level_music (Bank00) to upload the matching sample/song
;# blocks (DATA_spc_block_set_indexes -> DATA_spc_data_blocks), and then a song ID selects the sequence to
;# play. Because the resident blocks change with context, the SAME song ID can play different actual tracks
;# in different game modes (e.g. $01 is used for both the world map and several level/cutscene starts).
;# The names below therefore describe each ID by its dominant in-game ROLE, not by one fixed melody.
;# See also: Bank00.asm (CODE_set_level_music / DATA_spc_block_set_indexes), SPC700_Engine_YI.asm.
;#############################################################################################################

; --- Song-slot IDs ($01-$14) ----------------------------------------------------------------------------
!Define_YI_MusicID01_MapAndLevelTheme = $0001          ; world map (Bank17 CODE_1785FC); also most level / cutscene starts (Bank0D, Bank10)
!Define_YI_MusicID02_StoryAndLevelTheme = $0002        ; story/load cutscene (gm05, Bank0F); level/minigame starts (Bank02, Bank10, Bank11)
!Define_YI_MusicID03_CastleAndIntroTheme = $0003       ; castle/level-intro cutscene (Bank01, PlayerState16_LevelIntro); final-world map variant (Bank17)
!Define_YI_MusicID04_GameOver = $0004                  ; Game Over screen (gm40, Bank10 CODE_gm40_game_over)
!Define_YI_MusicID05_BonusAndVictoryTheme = $0005      ; bonus minigames (FlipCards etc, Bank10/Bank11 tables); boss-cleared level-exit (Bank0F Raphael)
!Define_YI_MusicID06_BonusAndBossTheme = $0006         ; bonus minigame + mid-fight cues (Bank10, Bank11; bonus table DATA_1192B3)
!Define_YI_MusicID07_BonusAndDefeatTheme = $0007       ; bonus minigame (bonus tables); player-defeat cutscene (Bank04). Its sequence data lives in SPC block $1C, uploaded ONLY by the overworld's music set -> relies on having passed through the map; a cold warp that skips the overworld hangs the driver on this song (see Bank00 set_level_music NOTE; docs/enginecore.md 2.3)
!Define_YI_MusicID08_CutsceneAndBossTheme = $0008      ; cutscene (gm07, Bank0F); boss-arena transition computed in Bank17 ($08 + world flag)
!Define_YI_MusicID09_BossBattle = $0009                ; main boss battle theme -- kicked by ~8 boss sprites at fight start (Hookbill, Sluggy/Naval, Bigger Boo, Raphael, etc.) and the Kamek ending cutscene
!Define_YI_MusicID0A_BossArenaThemeA = $000A           ; boss-arena music for most battles (per-battle table DATA_boss_music_per_battle, Bank0C)
!Define_YI_MusicID0B_BabyBowserBattlePhase1 = $000B    ; Baby Bowser final battle, phase cue (Bank0D YI_NorSpr134_BabyBowser)
!Define_YI_MusicID0C_BabyBowserAndCastleBossTheme = $000C ; Baby Bowser final battle, second phase cue (Bank0D); also a boss-arena value in DATA_boss_music_per_battle
; IDs $0D-$14 have no direct 65816 caller found; named by the engine's song repertoire and likely set via
; cached values ($0205/$0201) or the SuperFX-driven title/story/ending sequences. Identities are best-effort.
!Define_YI_MusicID0D_BigBabyBowserBattle = $000D       ; Big (giant) Baby Bowser battle; uncertain -- no direct caller located
!Define_YI_MusicID0E_BossArenaThemeB = $000E           ; secondary boss-arena slot; uncertain -- no direct caller located
!Define_YI_MusicID0F_TitleScreen = $000F               ; title screen; uncertain -- no direct caller located
!Define_YI_MusicID10_StoryScene = $0010                ; opening-story scene; uncertain -- no direct caller located
!Define_YI_MusicID11_Introduction = $0011              ; introduction cutscene; uncertain -- no direct caller located
!Define_YI_MusicID12_WelcomeToYoshisIsland = $0012     ; "Welcome to Yoshi's Island" jingle; uncertain -- no direct caller located
!Define_YI_MusicID13_MapAlternate = $0013              ; alternate map/overworld slot; uncertain -- no direct caller located
!Define_YI_MusicID14_EndingCredits = $0014             ; ending / credits roll; uncertain -- no direct caller located

; --- Control opcodes ($F0-$F6 / $FF) --------------------------------------------------------------------
!Define_YI_MusicID_StopMusicCommand = $F0
!Define_YI_MusicID_FadeMusicCommand = $F1
