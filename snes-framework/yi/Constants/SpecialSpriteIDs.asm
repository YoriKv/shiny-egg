;#############################################################################################################
;# SpecialSpriteIDs.asm -- Special-sprite IDs ($1BA-$1F3): the level-placeable controllers and generators.
;#
;# Special sprites are the THIRD sprite system, alongside normal sprites ($000-$1B9, NormalSpriteIDs.asm) and
;# ambient sprites (AmbientSpriteIDs.asm). The level designer places them in the sprite stream exactly like
;# normal sprites; the spawn loop branches on `SBC #$01BA` -- IDs below go to the normal 24-slot table, IDs
;# $1BA+ come here. They live in their OWN small table, NOT the normal one:
;#
;#   Slot table : !RAM_YI_Level_NorSpr_ActiveSpecialSpritesTable = $7E:0C04 (4 word entries;
;#                stored value = SprID - $01B9, so $0000 = empty slot).
;#   Init table : DATA_special_sprite_inits ($03:D46F), dispatched by CODE_init_special_sprite ($03:979E).
;#   Main table : DATA_special_sprite_mains  ($03:D4E3), dispatched once per active slot per frame.
;#
;# Index skew: Init reads inits[SprID-$1BA]; Main reads mains[SprID-$1B9] (the main table's entry 0 is an
;# unused filler), so the two tables are offset by one word.
;#
;# Generator / stop pairing: most creature generators come as a "_gen" sprite (active -- a real Main that
;# spawns the creature on a timer/terrain gate, plus a gen-flag) and a "_stop" sprite (Init clears the
;# gen-flag and frees the slot; Main is the shared no-op RTS at CODE_03A79B). The designer drops the _gen at
;# a region's start and the _stop where generation should end.
;#
;# *** ID-NAMESPACE OVERLAP (read this) ***
;# These IDs ($1BA-$1F4) reuse the SAME numbers as ambient sprites (AmbientSpriteIDs.asm), but they are NOT
;# the same sprites. In LEVEL DATA an ID >= $1BA is ALWAYS the special sprite defined here -- e.g. level-data
;# $1BA is the graphic/palette changer, NOT the "water splash" ambient of the same number. The ambient
;# meaning is reachable only at runtime via CODE_spawn_ambient_sprite. See docs/spritestateengine.md S4.1.
;#
;# The [in level data] / [unused in shipped levels] tag is from the V1.0 cart sprite streams
;# (docs/level-sprite-index.tsv). Level data places the range $1BA-$1F4.
;#
;# See also: docs/spritestateengine.md S4.1 (three sprite systems), docs/renderingpipeline.md S1.1 (the
;# graphic/palette changers), docs/levelloader.md S1 (sprite-stream spawn), Bank03.asm (handler bodies).
;#############################################################################################################

!Define_YI_SpecialSpr1BA_GraphicPaletteChanger0 = $01BA	; [unused in shipped levels] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 0. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1BB_GraphicPaletteChanger1 = $01BB	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 1. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1BC_GraphicPaletteChanger2 = $01BC	; [unused in shipped levels] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 2. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1BD_GraphicPaletteChanger3 = $01BD	; [unused in shipped levels] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 3. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1BE_GraphicPaletteChanger4 = $01BE	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 4. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1BF_GraphicPaletteChanger5 = $01BF	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 5. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C0_GraphicPaletteChanger6 = $01C0	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 6. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C1_GraphicPaletteChanger7 = $01C1	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 7. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C2_GraphicPaletteChanger8 = $01C2	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 8. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C3_GraphicPaletteChanger9 = $01C3	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 9. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C4_GraphicPaletteChanger10 = $01C4	; [unused in shipped levels] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 10. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C5_GraphicPaletteChanger11 = $01C5	; [unused in shipped levels] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 11. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C6_GraphicPaletteChanger12 = $01C6	; [unused in shipped levels] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 12. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C7_GraphicPaletteChanger13 = $01C7	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 13. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C8_GraphicPaletteChanger14 = $01C8	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 14. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1C9_GraphicPaletteChanger15 = $01C9	; [in level data] handlers: init=CODE_init_palette_spr, main=CODE_main_palette_spr | BG1 graphic/palette changer; swaps the live BG1 tileset (even cell-X) or palette (odd cell-X) to value 15. See docs/renderingpipeline.md S1.1.
!Define_YI_SpecialSpr1CA_AutoScroller0 = $01CA	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 0); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1CB_AutoScroller1 = $01CB	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 1); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1CC_AutoScroller2 = $01CC	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 2); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1CD_AutoScroller3 = $01CD	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 3); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1CE_AutoScroller4 = $01CE	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 4); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1CF_AutoScroller5 = $01CF	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 5); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1D0_AutoScroller6 = $01D0	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 6); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1D1_AutoScroller7 = $01D1	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 7); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1D2_AutoScroller8 = $01D2	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 8); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1D3_AutoScroller9 = $01D3	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 9); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1D4_AutoScroller10 = $01D4	; [in level data] handlers: init=CODE_init_autoscroller, main=CODE_main_autoscroller | Autoscroll-region controller (variant 10); CODE_main_autoscroller drives the camera per-frame.
!Define_YI_SpecialSpr1D5_HorizontalScrollStop = $01D5	; [in level data] handlers: init=CODE_init_horizontal_scroll_stop, main=CODE_03A79B | Init: clear hscroll-lock state; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1D6_HorizontalScrollLock = $01D6	; [in level data] handlers: init=CODE_init_hscroll_lock, main=CODE_03A79B | Init: set horizontal-scroll lock from sprite Y; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1D7_GustyGenerator = $01D7	; [in level data] handlers: init=CODE_init_gusty_gen, main=CODE_main_gusty_gen | Init: Gusty-spawner Init: arm the gen flag; Main: Gusty-spawner Main: spawn pattern + timer.
!Define_YI_SpecialSpr1D8_GustyGeneratorStop = $01D8	; [in level data] handlers: init=CODE_init_gusty_stop, main=CODE_03A79B | Init: clear gusty-gen flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1D9_LakituStop = $01D9	; [in level data] handlers: init=CODE_init_lakitu_stop, main=CODE_03A79B | Init: clear lakitu-active flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1DA_FuzzyGeneratorStop = $01DA	; [in level data] handlers: init=CODE_init_fuzzy_stop, main=CODE_03A79B | Init: clear fuzzy-gen flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1DB_PoochyStop = $01DB	; [unused in shipped levels] handlers: init=CODE_init_poochy_stop, main=CODE_03A79B | Init: clear poochy-exists flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1DC_FangGeneratorRight = $01DC	; [in level data] handlers: init=CODE_init_bat_gen, main=CODE_main_bat_gen_r | Init: Bat-spawner Init: arm the gen flag; Main: Bat-spawner Main, right-side variant.
!Define_YI_SpecialSpr1DD_FangGeneratorStop = $01DD	; [in level data] handlers: init=CODE_init_fang_stop, main=CODE_03A79B | Init: clear bat/fang gen flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1DE_FangGeneratorRightLeft = $01DE	; [in level data] handlers: init=CODE_init_bat_gen, main=CODE_main_bat_gen_rl | Init: Bat-spawner Init: arm the gen flag; Main: Bat-spawner Main, right+left variant for Big Boo's Fort.
!Define_YI_SpecialSpr1DF_FangGeneratorStop2 = $01DF	; [unused in shipped levels] handlers: init=CODE_init_fang_stop, main=CODE_03A79B | Init: clear bat/fang gen flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1E0_WallLakituGenerator = $01E0	; [in level data] handlers: init=CODE_init_wall_lakitu_gen, main=CODE_main_wall_lakitu_gen | Init: Wall Lakitu ($157) generator Init: arm gen-latch $0C4C (one active at a time). Formerly unknown2_gen.; Main: Wall Lakitu generator Main: spawns one Wall Lakitu ($157) off-screen via CODE_spawn_sprite_active when terrain-gated (FXCODE_0ACE2F); capped by $0C4E. Formerly main_unknown2_gen..
!Define_YI_SpecialSpr1E1_WallLakituGeneratorStop = $01E1	; [unused in shipped levels] handlers: init=CODE_init_wall_lakitu_stop, main=CODE_03A79B | Init: Wall Lakitu generator stop: clear gen-latch $0C4C, free slot. Formerly unknown2_stop.; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1E2_SpearGuyDanceTrigger = $01E2	; [in level data] handlers: init=CODE_init_speardance_trigger, main=CODE_main_speardance | Init: Spear Guy dance trigger Init; Main: Spear Guy dance Main loop.
!Define_YI_SpecialSpr1E3_SpearGuyDanceStop = $01E3	; [unused in shipped levels] handlers: init=CODE_init_speardance_stop, main=CODE_03A79B | Init: clear dance state, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1E4_FireLakituStop = $01E4	; [in level data] handlers: init=CODE_init_firelakitu_stop, main=CODE_03A79B | Init: clear fire-lakitu flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1E5_FlutterGenerator = $01E5	; [unused in shipped levels] handlers: init=CODE_init_flutter_gen, main=CODE_main_flutter_gen | Init: Flutter-spawner Init; Main: Flutter-spawner Main.
!Define_YI_SpecialSpr1E6_FlutterGeneratorStop = $01E6	; [unused in shipped levels] handlers: init=CODE_init_flutter_stop, main=CODE_03A79B | Init: clear flutter-gen flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1E7_NipperSporeGenerator = $01E7	; [unused in shipped levels] handlers: init=CODE_init_spore_gen, main=CODE_main_spore_gen | Init: Nipper-spore-spawner Init; Main: Nipper-spore-spawner Main.
!Define_YI_SpecialSpr1E8_NipperSporeGeneratorStop = $01E8	; [unused in shipped levels] handlers: init=CODE_init_spore_stop, main=CODE_03A79B | Init: clear spore-gen flag, free slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1E9_PokeyBalloonGenerator = $01E9	; [unused in shipped levels] handlers: init=CODE_init_balloonpokey_gen, main=CODE_main_balloonpokey_gen | Init: Pokey-balloon spawner Init; Main: Pokey-balloon spawner Main.
!Define_YI_SpecialSpr1EA_PokeyBalloonGeneratorStop = $01EA	; [unused in shipped levels] handlers: init=CODE_init_balloonpokey_stop, main=CODE_03A79B | Init: stop marker (clear the paired generator flag, free the slot); Main: no-op (shared RTS).
!Define_YI_SpecialSpr1EB_BombBalloonGenerator = $01EB	; [in level data] handlers: init=CODE_init_balloonmissile_gen, main=CODE_main_balloonmissile_gen | Init: Bomb-balloon spawner Init; Main: Bomb-balloon spawner Main.
!Define_YI_SpecialSpr1EC_BombBalloonGeneratorStop = $01EC	; [in level data] handlers: init=CODE_init_balloonmissile_stop, main=CODE_03A79B | Init: stop marker (clear the paired generator flag, free the slot); Main: no-op (shared RTS).
!Define_YI_SpecialSpr1ED_BalloonGenerator = $01ED	; [in level data] handlers: init=CODE_init_balloon_gen, main=CODE_main_balloon_gen | Init: plain-balloon spawner Init; Main: plain-balloon spawner Main.
!Define_YI_SpecialSpr1EE_BalloonGeneratorStop = $01EE	; [in level data] handlers: init=CODE_init_balloon_stop, main=CODE_03A79B | Init: stop marker (clear the paired generator flag, free the slot); Main: no-op (shared RTS).
!Define_YI_SpecialSpr1EF_YellowPlatformGenerator = $01EF	; [in level data] handlers: init=CODE_init_yellowplatform_gen, main=CODE_main_yellowplatform_gen | Init: autoscroll yellow platform spawner Init; Main: yellow-platform spawner Main / despawn sweep.
!Define_YI_SpecialSpr1F0_MiniSalvoGenerator = $01F0	; [in level data] handlers: init=CODE_init_minisalvo_gen, main=CODE_main_minisalvo_gen | Init: Mini Salvo spawner Init; Main: Mini Salvo spawner Main.
!Define_YI_SpecialSpr1F1_MiniSalvoGeneratorStop = $01F1	; [in level data] handlers: init=CODE_init_minisalvo_stop, main=CODE_03A79B | Init: stop marker (clear the paired generator flag, free the slot); Main: no-op (shared RTS).
!Define_YI_SpecialSpr1F2_DizzyStop = $01F2	; [in level data] handlers: init=CODE_init_dizzy_stop, main=CODE_03A79B | Init: clear dizzy effect, return slot; Main: no-op (shared RTS).
!Define_YI_SpecialSpr1F3_GoonieSpawnStop = $01F3	; [unused in shipped levels] handlers: init=CODE_init_goonie_stop, main=CODE_03A79B | Init: Goonie-spawn stop: clear $0C7C, the Goonie flock-counter / level-edge respawn latch (set+read by NorSpr $0E8 Goonie Init+Main; see docs/family-goonies.md). Formerly unknown3_stop.; Main: no-op (shared RTS).
