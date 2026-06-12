macro YIBank03Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;#############################################################################################################
;# Bank03.asm -- bank $03 sprite engine, sprite-state machine, egg/coin/winged-cloud handlers, kamek script.
;#
;# THE SPRITE STATE ENGINE LIVES HERE.  For the full architecture writeup, see:
;#   docs/spritestateengine.md
;#
;# Contents at a glance (by SNES address):
;#   $03:8000-$03:852D  DATA_sprite_inits        Init pointer table  (one 3-byte entry per 0x000-0x1B9 ID)
;#   $03:852E-$03:8A5B  DATA_sprite_mains        Main pointer table  (same length, same ordering)
;#   $03:8A5C-$03:8F89  DATA_head_bops           Head-bopped pointer table  (Yoshi-tongue-stomp handler)
;#   $03:8F8A-$03:94B7  ride_yoshis         Riding-on-Yoshi pointer table  (per-sprite carry behaviour)
;#   $03:94B8-$03:94CE  CODE_clear_all_sprites:  wipe both normal + ambient sprite slot arrays
;#   $03:94CF-$03:954D  CODE_spr_edge_despawn_draw: hand SuperFX a sprite-cull and tile-draw request
;#   $03:954E-$03:9627  CODE_check_newspr_screen + xoffset/yoffset helpers
;#   $03:9628-$03:99CD  CODE_check_new_sprites: load offscreen sprite-list entries that just entered the camera
;#   $03:99CE-$03:9A57  CODE_init_special_sprite + DATA_sprite_state_routines (9-entry state-dispatch table)
;#   $03:9A12          CODE_handle_sprite       per-slot per-frame entry (called from CODE_handle_sprites loop)
;#   $03:9A6E          CODE_spr_state_init      state $02/$04 -- run per-sprite Init then transition to $10
;#   $03:9A90          CODE_spr_state_main      state $10 -- alive, run per-sprite Main (default state)
;#   $03:9AC8          CODE_spr_state_tongued   state $08 -- stuck on Yoshi's tongue
;#   $03:9F8D          CODE_spr_state_die_collision  state $0C -- killed by environment
;#   $03:A00B          CODE_spr_state_die_burning    state $12 -- burning to death
;#   $03:A085          CODE_spr_state_on_head_bop    state $0E -- just bopped by Yoshi
;#   $03:A11D          CODE_spr_state_ride_yoshi     state $0A -- riding on Yoshi's back
;#   $03:A247          CODE_spr_state_turn_star      state $06 -- transforming into a Super Star
;#   $03:A31E          CODE_despawn_sprite_stage_ID  + free_slot + clear_graphics entries
;#   $03:A34C          CODE_spawn_sprite_init  + CODE_spawn_sprite_active  + CODE_spawn_sprite  helpers
;#   $03:A24F-$03:AAE5  more state-helper code (fuzzy_wind, head_bop_* commons, etc.)
;#   $03:AAE6-$03:AEAA  head_bop_* helpers + state-handler shared subroutines
;#   $03:AEAB-$03:B6F9  ride-yoshi physics + turn-star transition + despawn / spawn body
;#   $03:B6FA-$03:C84F  CODE_player_hit + egg-spawn/coin-spawn helpers (CODE_break_green_egg, CODE_spawn_red_coin, ...)
;#   $03:C850-$03:CE32  Egg sprites Init/Main (flashing $022, red $023, yellow $024, green $025, giants $029-02B)
;#   $03:CE33-$03:D4FD  Winged-Cloud sprites (Init/Main for $0B5 hidden, $0B6-$0CC all variants)
;#   $03:D4FE-$03:E04E  Winged-cloud pop scripts: CODE_pop_transform_bubble through CODE_pop_random_item
;#   $03:E04F-$03:E7C3  Cloud Main bodies: transform_bubble, 8_coin, item_clouds, stairs, etc.
;#   $03:E7C4-$03:F084  Special-sprite Init/Main + autoscroller + generator/stopper sprites
;#   $03:F085-$03:F32C  Kamek cutscene sprite ($125) state machine (init/main, ending + chasing variants)
;#   $03:F32D-$03:F564  Mock-Up bubble + Fly-Guy ($08D) + miscellaneous spawns
;#   $03:F565-$03:F6DC  Kaboomba ($00A) helper + Fuzzy ($129) Init/Main
;#   $03:F6DD-$03:FEEE  garbage data + DATA_03FEEE_YI_U2.bin region (U2-only patch slot)
;#
;# Cross-references:
;#   docs/spritestateengine.md  -- THE architecture doc for everything in this bank
;#       (sprite ID catalog, normal vs ambient distinction, EXRAM slot layout, state-byte semantics).
;#   Raidenthequick disassembly/bank03.asm -- best descriptive labels (DATA_sprite_inits, CODE_handle_sprite,
;#                                              CODE_player_hit, pop_*, DATA_kamek_init_ptr, etc.)
;#   Raidenthequick docs/named_main_labels.txt -- bank $03 section
;#   ys_enmy.asm   -- enemy-engine driver code (CODE_handle_sprite mirror; same state-byte dispatch scheme)
;#   ys_enmy*.asm  -- per-family handlers (3=fuzzy, 4=ravens, 9=goonies, etc.)
;#   ys_play.asm   -- CODE_player_hit and player-state transitions invoked from here
;#   ys_chr.asm    -- shared character helpers (CODE_spawn_sprite, CODE_despawn_sprite paths)
;#
;# Conventions in this file:
;#   The first four DATA_sprite_inits/DATA_sprite_mains/DATA_head_bops/DATA_sprite_ridings tables hold dl pointers to the
;#   YI_NorSprXXX_<Name>_Init/_Main/_HeadBopRt/_RideYoshiRt labels for normal sprites 0x000-0x1B9.
;#   IDs 0x1BA+ are "special sprites" handled by the DATA_special_sprite_inits/_mains tables further down.
;#   Many small sprites consolidate their _HeadBopRt: or _RideYoshiRt: into a single shared RTL stub
;#   (visible as long runs of stacked labels just before one RTL/RTS).  asar accepts the duplicate
;#   labels and emits one byte for the routine address.
;#   The state byte for slot X (4-byte stride, 24 slots starting at X=$5C) lives at:
;#     EXRAM[$70:0F00+X] = !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
;#   See SRAM_SpriteSlots.asm for the rest of the per-slot RAM-layout.
;#############################################################################################################

;-------------------------------------------------------------------------
; DATA_sprite_inits: Init pointer table for normal sprites 0x000-0x1B9.
; Index = sprite ID * 3.  Each entry is a 24-bit pointer to the YI_NorSprXXX_<Name>_Init
; handler.  This is the table the sprite-spawn path reads to dispatch Init code.
; Raidenthequick: DATA_sprite_inits
;-------------------------------------------------------------------------
DATA_038000:
DATA_sprite_inits:
	dl YI_NorSpr000_LavaLog_Init
	dl YI_NorSpr001_ClosedDoor_Init
	dl YI_NorSpr002_NavalPiranhaVines_Init
	dl YI_NorSpr003_CrateWithKey_Init
	dl YI_NorSpr004_HitSuperBabyMarioBlock_Init
	dl YI_NorSpr005_IcyWatermelon_Init
	dl YI_NorSpr006_WatermelonFreeze_Init
	dl YI_NorSpr007_Watermelon_Init
	dl YI_NorSpr008_FallingRubble_Init
	dl YI_NorSpr009_FireWatermelon_Init
	dl YI_NorSpr00A_Kaboomba_Init
	dl YI_NorSpr00B_Cannonball_Init
	dl YI_NorSpr00C_RaphaelTheRaven_Init
	dl YI_NorSpr00D_GoalRing_Init
	dl YI_NorSpr00E_GOALLetters_Init
	dl YI_NorSpr00F_BonusChallengeSign_Init
	dl YI_NorSpr010_RoundedCagedGhost_Init
	dl YI_NorSpr011_ItemCard_Init
	dl YI_NorSpr012_BossDoor_Init
	dl YI_NorSpr013_BossExplosion_Init
	dl YI_NorSpr014_KeyFromBoss_Init
	dl YI_NorSpr015_SubmarineTorpedo_Init
	dl YI_NorSpr016_BiggerBoo_Init
	dl YI_NorSpr017_FrogPirate_Init
	dl YI_NorSpr018_WatermelonFlame_Init
	dl YI_NorSpr019_Bubble_Init
	dl YI_NorSpr01A_SkiLift_Init
	dl YI_NorSpr01B_VerticalLavaLog_Init
	dl YI_NorSpr01C_DrFreezegood_Init
	dl YI_NorSpr01D_DrFreezegoodOnSkiLift_Init
	dl YI_NorSpr01E_Shyguy_Init
	dl YI_NorSpr01F_RotatingDoors_Init
	dl YI_NorSpr020_Bandit_Init
	dl YI_NorSpr021_Bucket_Init
	dl YI_NorSpr022_FlashingEgg_Init
	dl YI_NorSpr023_RedEgg_Init
	dl YI_NorSpr024_YellowEgg_Init
	dl YI_NorSpr025_GreenEgg_Init
	dl YI_NorSpr026_BowserFightGiantEgg_Init
	dl YI_NorSpr027_Key_Init
	dl YI_NorSpr028_HuffinPuffin_Init
	dl YI_NorSpr029_GiantEgg_Init
	dl YI_NorSpr02A_RedGiantEgg_Init
	dl YI_NorSpr02B_GreenGiantEgg_Init
	dl YI_NorSpr02C_LungeFish_Init
	dl YI_NorSpr02D_SalvoTheSlime_Init
	dl YI_NorSpr02E_EyesOfSalvoTheSlime_Init
	dl YI_NorSpr02F_LittleMouserHole_Init
	dl YI_NorSpr030_LittleMouser_Init
	dl YI_NorSpr031_PottedSpikedFunGuy_Init
	dl YI_NorSpr032_PeekingLittleMouser_Init
	dl YI_NorSpr033_LittleMouserExitingNest_Init
	dl YI_NorSpr034_RogersPot_Init
	dl YI_NorSpr035_RogerThePottedGhost_Init
	dl YI_NorSpr036_FallingWall_Init
	dl YI_NorSpr037_GrimLeecher_Init
	dl YI_NorSpr038_PottedGhostFlame_Init
	dl YI_NorSpr039_HorizontalRotatingPlank_Init
	dl YI_NorSpr03A_3MiniRavens_Init
	dl YI_NorSpr03B_MiniRaven_Init
	dl YI_NorSpr03C_TapTapTheRedNose_Init
	dl YI_NorSpr03D_LargeSeesaw_Init
	dl YI_NorSpr03E_ThinPlatform_Init
	dl YI_NorSpr03F_SlimeBlock_Init
	dl YI_NorSpr040_BabyLuigi_Init
	dl YI_NorSpr041_Stork_Init
	dl YI_NorSpr042_VerticalPipeEntrance_Init
	dl YI_NorSpr042_RedGiantShyguy_Init
	dl YI_NorSpr043_GreenGiantShyguy_Init
	dl YI_NorSpr045_PrinceFroggy_Init
	dl YI_NorSpr046_BurtTheBashful_Init
	dl YI_NorSpr047_ShyguyPushingRoger_Init
	dl YI_NorSpr048_CutsceneKamek_Init
	dl YI_NorSpr049_ThunderLakituFireBlast1_Init
	dl YI_NorSpr04A_ThunderLakituFireBlast2_Init
	dl YI_NorSpr04B_ThunderLakituFireBlast3_Init
	dl YI_NorSpr04C_UpsidedownBlowHard_Init
	dl YI_NorSpr04D_UnusedSpriteIndex_Init
	dl YI_NorSpr04E_LockedDoor_Init
	dl YI_NorSpr04F_MiddleRing_Init
	dl YI_NorSpr050_GreyRotatingWoodenBoard_Init
	dl YI_NorSpr051_LargeWheel_Init
	dl YI_NorSpr052_BalloonPlatform_Init
	dl YI_NorSpr053_KamekSayingOhMy_Init
	dl YI_NorSpr054_UpsideDownPiranhaPlant_Init
	dl YI_NorSpr055_4GreenRotatingPlatforms_Init
	dl YI_NorSpr056_4PinkRotatingPlatforms_Init
	dl YI_NorSpr057_SewerGhostWithPlatform_Init
	dl YI_NorSpr058_GreenToady_Init
	dl YI_NorSpr059_StationarySuperStar_Init
	dl YI_NorSpr05A_RaphaelSparkAttack_Init
	dl YI_NorSpr05B_RedCoinBandit_Init
	dl YI_NorSpr05C_PinkToady_Init
	dl YI_NorSpr05D_GlitchedSprite_Init
	dl YI_NorSpr05E_BrownWoodenBoard_Init
	dl YI_NorSpr05F_AutoRotateBrownWoodenBoard_Init
	dl YI_NorSpr060_Bomb_Init
	dl YI_NorSpr061_BabyMario_Init
	dl YI_NorSpr062_Goomba_Init
	dl YI_NorSpr063_MuddyBuddy_Init
	dl YI_NorSpr064_4AutoRotatingPinkPlatforms_Init
	dl YI_NorSpr065_RedCoin_Init
	dl YI_NorSpr066_PiranhaPlant_Init
	dl YI_NorSpr067_RockRevealedHiddenWingedCloud_Init
	dl YI_NorSpr068_FlashingEggBlock_Init
	dl YI_NorSpr069_RedEggBlock_Init
	dl YI_NorSpr06A_YellowEggBlock_Init
	dl YI_NorSpr06B_GreenEggBlock_Init
	dl YI_NorSpr06C_LargeSpringBall_Init
	dl YI_NorSpr06D_ClockwiseHootieTheBlueFish_Init
	dl YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_Init
	dl YI_NorSpr06F_SpringBall_Init
	dl YI_NorSpr070_Clawdaddy_Init
	dl YI_NorSpr071_BigBoo_Init
	dl YI_NorSpr072_TrainBandit_Init
	dl YI_NorSpr073_BalloonPump_Init
	dl YI_NorSpr074_Spike_Init
	dl YI_NorSpr075_SpikeBall_Init
	dl YI_NorSpr076_ClockwisePiroDangle_Init
	dl YI_NorSpr077_CounterclockwisePiroDangle_Init
	dl YI_NorSpr078_RedBulletBillShooter_Init
	dl YI_NorSpr079_YellowBulletBillShooter_Init
	dl YI_NorSpr07A_GreenBulletBillShooter_Init
	dl YI_NorSpr07B_RedBulletBill_Init
	dl YI_NorSpr07C_YellowBulletBill_Init
	dl YI_NorSpr07D_GreenBulletBill_Init
	dl YI_NorSpr07E_DentOfSquishyPlatform_Init
	dl YI_NorSpr07F_LogSeesawPlatform_Init
	dl YI_NorSpr080_StraightLavaBubble_Init
	dl YI_NorSpr081_FollowingLavaBubble_Init
	dl YI_NorSpr082_ChainChomp_Init
	dl YI_NorSpr083_BowserFightCloud_Init
	dl YI_NorSpr084_TeleportSprite_Init
	dl YI_NorSpr085_HarryHedgehog_Init
	dl YI_NorSpr086_GlitchedSprite_Init
	dl YI_NorSpr087_MockUpLaidEgg_Init
	dl YI_NorSpr088_SuperStar_Init
	dl YI_NorSpr089_HorizontalMovingRedPlatform_Init
	dl YI_NorSpr08A_VerticalMovingPinkPlatform_Init
	dl YI_NorSpr08B_MockUp_Init
	dl YI_NorSpr08C_YoshiAtGoal_Init
	dl YI_NorSpr08D_Flyguy_Init
	dl YI_NorSpr08E_BowserRoomKamek_Init
	dl YI_NorSpr08F_MonkeySwing_Init
	dl YI_NorSpr090_DanglingGhost_Init
	dl YI_NorSpr091_4RedToadies_Init
	dl YI_NorSpr092_MelonBug_Init
	dl YI_NorSpr093_Door_Init
	dl YI_NorSpr094_ExpandingBlock_Init
	dl YI_NorSpr095_BlueCheckeredBlock_Init
	dl YI_NorSpr096_RedCheckeredBlock_Init
	dl YI_NorSpr097_POWBlock_Init
	dl YI_NorSpr098_EndTransformationBlock_Init
	dl YI_NorSpr099_SpinyEgg_Init
	dl YI_NorSpr09A_SwingingGreenPlatform_Init
	dl YI_NorSpr09B_MaceGuy_Init
	dl YI_NorSpr09C_Mace_Init
	dl YI_NorSpr09D_RedSwitch_Init
	dl YI_NorSpr09E_ChompRock_Init
	dl YI_NorSpr09F_PtooiePiranhaPlant_Init
	dl YI_NorSpr0A0_Tulip_Init
	dl YI_NorSpr0A1_SmallPot_Init
	dl YI_NorSpr0A2_ThunderLakituFireball_Init
	dl YI_NorSpr0A3_LeftHidingBandit_Init
	dl YI_NorSpr0A4_RightHidingBandit_Init
	dl YI_NorSpr0A5_NepEnut_Init
	dl YI_NorSpr0A6_IncomingChomp_Init
	dl YI_NorSpr0A7_GroupOfIncomingChomps_Init
	dl YI_NorSpr0A8_FallingIncomingChomp_Init
	dl YI_NorSpr0A9_IncomingChompShadow_Init
	dl YI_NorSpr0AA_BackgroundShyguy_Init
	dl YI_NorSpr0AB_FullEggSpawner_Init
	dl YI_NorSpr0AC_FallingRockArrowAndShadow_Init
	dl YI_NorSpr0AD_MessageBox_Init
	dl YI_NorSpr0AE_HookbillTheKoopa_Init
	dl YI_NorSpr0AF_CarMorphBubble_Init
	dl YI_NorSpr0B0_MoleMorphBubble_Init
	dl YI_NorSpr0B1_HelicopterMorphBubble_Init
	dl YI_NorSpr0B2_TrainMorphBubble_Init
	dl YI_NorSpr0B3_FuzzyFart_Init
	dl YI_NorSpr0B4_SubmarineMorphBubble_Init
	dl YI_NorSpr0B5_HiddenWingedCloud_Init
	dl YI_NorSpr0B6_WingedCloudWith8Coins_Init
	dl YI_NorSpr0B7_WingedCloudWithBubbled1up_Init
	dl YI_NorSpr0B8_WingedCloudWithFlower_Init
	dl YI_NorSpr0B9_WingedCloudWithPOW_Init
	dl YI_NorSpr0BA_WingedCloudWithStairs_Init
	dl YI_NorSpr0BB_WingedCloudWithPlatform_Init
	dl YI_NorSpr0BC_WingedCloudWithBandit_Init
	dl YI_NorSpr0BD_WingedCloudWithCoin_Init
	dl YI_NorSpr0BE_WingedCloudWith1up_Init
	dl YI_NorSpr0BF_WingedCloudWithKey_Init
	dl YI_NorSpr0C0_WingedCloudWith3Stars_Init
	dl YI_NorSpr0C1_WingedCloudWith5Stars_Init
	dl YI_NorSpr0C2_WingedCloudWithDoor_Init
	dl YI_NorSpr0C3_WingedCloudWithLowerGround_Init
	dl YI_NorSpr0C4_WingedCloudWithWatermelon_Init
	dl YI_NorSpr0C5_WingedCloudWithFireWatermelon_Init
	dl YI_NorSpr0C6_WingedCloudWithIcyWatermelon_Init
	dl YI_NorSpr0C7_WingedCloudWith3LeafSunflower_Init
	dl YI_NorSpr0C8_WingedCloudWith6LeafSunflower_Init
	dl YI_NorSpr0C9_WingedCloudWithCrashGameFeature_Init
	dl YI_NorSpr0CA_BigBossDoor_Init
	dl YI_NorSpr0CB_WingedCloudWithCoinOrStar_Init
	dl YI_NorSpr0CC_WingedCloudWithRedSwitch_Init
	dl YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_Init
	dl YI_NorSpr0CE_BowserFire_Init
	dl YI_NorSpr0CF_BowserRocks_Init
	dl YI_NorSpr0D0_HorizontalEntranceToRight_Init
	dl YI_NorSpr0D1_SecretPipeEntrance_Init
	dl YI_NorSpr0D2_MarchingMilde_Init
	dl YI_NorSpr0D3_LargeMilde_Init
	dl YI_NorSpr0D4_MediumMilde_Init
	dl YI_NorSpr0D5_BackgroundForHookbillFight_Init
	dl YI_NorSpr0D6_FortGhostWithPlatform_Init
	dl YI_NorSpr0D7_SluggyTheUnshaven_Init
	dl YI_NorSpr0D8_ChompWarningSign_Init
	dl YI_NorSpr0D9_FishinLakitu_Init
	dl YI_NorSpr0DA_FlowerPot_Init
	dl YI_NorSpr0DB_SoftBlock_Init
	dl YI_NorSpr0DC_Snowball_Init
	dl YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_Init
	dl YI_NorSpr0DE_FallingRockPlatform_Init
	dl YI_NorSpr0DF_PiscatoryPete_Init
	dl YI_NorSpr0E0_PreyingMantas_Init
	dl YI_NorSpr0E1_LochNestor_Init
	dl YI_NorSpr0E2_BooBlah_Init
	dl YI_NorSpr0E3_BooBlahWithPiroDangle_Init
	dl YI_NorSpr0E4_HeadingCactus_Init
	dl YI_NorSpr0E5_GreenNeedlenose_Init
	dl YI_NorSpr0E6_Gusty_Init
	dl YI_NorSpr0E7_Burt_Init
	dl YI_NorSpr0E8_Goonie_Init
	dl YI_NorSpr0E9_3WinglessGoonies_Init
	dl YI_NorSpr0EA_VerticalCloudDrop_Init
	dl YI_NorSpr0EB_HorizontalCloudDrop_Init
	dl YI_NorSpr0EC_JumpingFlamerGuy_Init
	dl YI_NorSpr0ED_RunningFlamerGuy_Init
	dl YI_NorSpr0EE_EggoDil_Init
	dl YI_NorSpr0EF_EggoDilFace_Init
	dl YI_NorSpr0F0_EggoDilPetal_Init
	dl YI_NorSpr0F1_EggPlantShootingBubbles_Init
	dl YI_NorSpr0F2_ShyguyOnStilts_Init
	dl YI_NorSpr0F3_WoozyGuy_Init
	dl YI_NorSpr0F4_EggPlant_Init
	dl YI_NorSpr0F5_Slugger_Init
	dl YI_NorSpr0F6_MotherHuffinPuffin_Init
	dl YI_NorSpr0F7_BarneyBubble_Init
	dl YI_NorSpr0F8_BlowHard_Init
	dl YI_NorSpr0F9_YellowNeedlenose_Init
	dl YI_NorSpr0FA_Flower_Init
	dl YI_NorSpr0FB_LongSpearGuy_Init
	dl YI_NorSpr0FC_ShortSpearGuy_Init
	dl YI_NorSpr0FD_ZeusGuy_Init
	dl YI_NorSpr0FE_ZeusGuyBlast_Init
	dl YI_NorSpr0FF_Poochy_Init
	dl YI_NorSpr100_Bubbled1up_Init
	dl YI_NorSpr101_RotatingMace_Init
	dl YI_NorSpr102_DoubleRotatingMace_Init
	dl YI_NorSpr103_BooGuysMovingMace_Init
	dl YI_NorSpr104_JeanDeFillet_Init
	dl YI_NorSpr105_BooGuysCarryingBombToLeft_Init
	dl YI_NorSpr106_BooGuysCarryingBombToRight_Init
	dl YI_NorSpr107_WatermelonSeed_Init
	dl YI_NorSpr108_Milde_Init
	dl YI_NorSpr109_BronzeTapTap_Init
	dl YI_NorSpr10A_SilverTapTap_Init
	dl YI_NorSpr10B_HoppingSilverTapTap_Init
	dl YI_NorSpr10C_ChainedSpikeBall_Init
	dl YI_NorSpr10D_BooGuyOperatingPulley_Init
	dl YI_NorSpr10E_CrateWith6Stars_Init
	dl YI_NorSpr10F_BooManBluff_Init
	dl YI_NorSpr110_Flower_Init
	dl YI_NorSpr111_GeorgetteJelly_Init
	dl YI_NorSpr112_GeorgetteJellyGoo_Init
	dl YI_NorSpr113_Snifit_Init
	dl YI_NorSpr114_SnifitBullet_Init
	dl YI_NorSpr115_Coin_Init
	dl YI_NorSpr116_BuoyantRoundPlatform_Init
	dl YI_NorSpr117_DonutLift_Init
	dl YI_NorSpr118_LargeDonutLift_Init
	dl YI_NorSpr119_Spooky_Init
	dl YI_NorSpr11A_GreenGlove_Init
	dl YI_NorSpr11B_Lakitu_Init
	dl YI_NorSpr11C_LakituCloud_Init
	dl YI_NorSpr11D_SpinyEgg_Init
	dl YI_NorSpr11E_BrownArrowWheel_Init
	dl YI_NorSpr11F_BlueArrowWheel_Init
	dl YI_NorSpr120_DoubledSidedArrowLift_Init
	dl YI_NorSpr121_NumberPlatformExplosion_Init
	dl YI_NorSpr122_BucketWithBandit_Init
	dl YI_NorSpr123_BucketWithCoins_Init
	dl YI_NorSpr124_Stretch_Init
	dl YI_NorSpr125_AttackingAndEndingKamek_Init
	dl YI_NorSpr126_SpikedLogOnPulley_Init
	dl YI_NorSpr127_PulleyOfSpikedLog_Init
	dl YI_NorSpr128_GroundRippleInBabyBowerRoom_Init
	dl YI_NorSpr129_Fuzzy_Init
	dl YI_NorSpr12A_ShyGuyBanditTrap_Init
	dl YI_NorSpr12B_FatGuy_Init
	dl YI_NorSpr12C_FlyOrWhirlyGuy_Init
	dl YI_NorSpr12D_PrologueCutsceneYoshi_Init
	dl YI_NorSpr12E_LargePopEffect_Init
	dl YI_NorSpr12F_HorizontalLavaDrop_Init
	dl YI_NorSpr130_VerticalLavaDrop_Init
	dl YI_NorSpr131_LockedDoor_Init
	dl YI_NorSpr132_LemonDrop_Init
	dl YI_NorSpr133_LanternGhost_Init
	dl YI_NorSpr134_BabyBowser_Init
	dl YI_NorSpr135_CirclingRaven_Init
	dl YI_NorSpr136_CirclingRaven_Init
	dl YI_NorSpr137_3x6FallingStone_Init
	dl YI_NorSpr138_3x3FallingStone_Init
	dl YI_NorSpr139_3x9FallingStone_Init
	dl YI_NorSpr13A_6x3FallingStone_Init
	dl YI_NorSpr13B_StomachAcid_Init
	dl YI_NorSpr13C_DownFlippers_Init
	dl YI_NorSpr13D_DanglingFang_Init
	dl YI_NorSpr13E_FlyingFang_Init
	dl YI_NorSpr13F_SwimmingFlopsyFish_Init
	dl YI_NorSpr140_SwimmingAndJumpingFlopsyFish_Init
	dl YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_Init
	dl YI_NorSpr142_3JumpFlopsyFish_Init
	dl YI_NorSpr143_SprayFish_Init
	dl YI_NorSpr144_RightOrLeftFlippers_Init
	dl YI_NorSpr145_BlueSluggy_Init
	dl YI_NorSpr146_PinkSluggy_Init
	dl YI_NorSpr147_HorizontalEntranceToLeft_Init
	dl YI_NorSpr148_LargeSpringBall_Init
	dl YI_NorSpr149_UpArrowCloud_Init
	dl YI_NorSpr14A_UpRightArrowCloud_Init
	dl YI_NorSpr14B_RightArrowCloud_Init
	dl YI_NorSpr14C_DownRightArrowCloud_Init
	dl YI_NorSpr14D_DownArrowCloud_Init
	dl YI_NorSpr14E_DownLeftArrowCloud_Init
	dl YI_NorSpr14F_LeftArrowCloud_Init
	dl YI_NorSpr150_UpLeftArrowCloud_Init
	dl YI_NorSpr151_RotatingArrowCloud_Init
	dl YI_NorSpr152_Flutter_Init
	dl YI_NorSpr153_GoonieWithShyGuy_Init
	dl YI_NorSpr154_SharkChomp_Init
	dl YI_NorSpr155_FatGoonie_Init
	dl YI_NorSpr156_CactusJack_Init
	dl YI_NorSpr157_WallLakitu_Init
	dl YI_NorSpr158_BowlingGoonie_Init
	dl YI_NorSpr159_WalkingGrunt_Init
	dl YI_NorSpr15A_RunningGrunt_Init
	dl YI_NorSpr15B_DancingSpearGuy_Init
	dl YI_NorSpr15C_GreenRotatingPlatformSwitch_Init
	dl YI_NorSpr15D_RedRotatingPlatformSwitch_Init
	dl YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_Init
	dl YI_NorSpr15F_GreenSpikedPlatform_Init
	dl YI_NorSpr160_RedSpikedPlatform_Init
	dl YI_NorSpr161_RewardItemForDefeatingRoomEnemies_Init
	dl YI_NorSpr162_DoubleSpikePlatformWithSwitch_Init
	dl YI_NorSpr163_BouncingNeedlenose_Init
	dl YI_NorSpr164_NipperPlant_Init
	dl YI_NorSpr165_NipperSpore_Init
	dl YI_NorSpr166_ThunderLakitu_Init
	dl YI_NorSpr167_GreenKoopaShell_Init
	dl YI_NorSpr168_RedKoopaShell_Init
	dl YI_NorSpr169_GreenNakedKoopa_Init
	dl YI_NorSpr16A_RedNakedKoopa_Init
	dl YI_NorSpr16B_GreenKoopa_Init
	dl YI_NorSpr16C_RedKoopa_Init
	dl YI_NorSpr16D_GreenParakoopa_Init
	dl YI_NorSpr16E_RedHorizontalParakoopa_Init
	dl YI_NorSpr16F_RedVerticalParakoopa_Init
	dl YI_NorSpr170_AquaLakitu_Init
	dl YI_NorSpr171_NavalPiranha_Init
	dl YI_NorSpr172_NavalPiranhaBuds_Init
	dl YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_Init
	dl YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_Init
	dl YI_NorSpr175_BaronVonZeppelinCarryingBomb_Init
	dl YI_NorSpr176_BaronVonZeppelinCarryingBandit_Init
	dl YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_Init
	dl YI_NorSpr178_BaronVonZeppelinCarrying1up_Init
	dl YI_NorSpr179_BaronVonZeppelinCarryingKey_Init
	dl YI_NorSpr17A_BaronVonZeppelinCarryingCoins_Init
	dl YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_Init
	dl YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_Init
	dl YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_Init
	dl YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_Init
	dl YI_NorSpr17F_BaronVonZeppelin_Init
	dl YI_NorSpr180_SpinningLog_Init
	dl YI_NorSpr181_CrazeeDayzee_Init
	dl YI_NorSpr182_Dragonfly_Init
	dl YI_NorSpr183_Butterfly_Init
	dl YI_NorSpr184_Bumpty_Init
	dl YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_Init
	dl YI_NorSpr186_MovingLineGuidedGreenPlatformRight_Init
	dl YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_Init
	dl YI_NorSpr188_MovingLineGuidedYellowPlatformRight_Init
	dl YI_NorSpr189_LineGuidedGreenPlatformLeft_Init
	dl YI_NorSpr18A_LineGuidedGreenPlatformRight_Init
	dl YI_NorSpr18B_LineGuidedYellowPlatformLeft_Init
	dl YI_NorSpr18C_LineGuidedYellowPlatformRight_Init
	dl YI_NorSpr18D_LineGuidedRedPlatformLeft_Init
	dl YI_NorSpr18E_LineGuidedGreenPlatformRight_Init
	dl YI_NorSpr18F_SpiralPlatform_Init
	dl YI_NorSpr190_FallingIcicle_Init
	dl YI_NorSpr191_Bird_Init
	dl YI_NorSpr192_PetalGuy_Init
	dl YI_NorSpr193_SnakeCagedGhost_Init
	dl YI_NorSpr194_Blargg_Init
	dl YI_NorSpr195_SmallUnstableSnowPlatform_Init
	dl YI_NorSpr196_UnstableSnowPlatform_Init
	dl YI_NorSpr197_ArrowSign_Init
	dl YI_NorSpr198_DiagonalArrowSign_Init
	dl YI_NorSpr199_DizzyDandy_Init
	dl YI_NorSpr19A_BooGuy_Init
	dl YI_NorSpr19B_TacklingBumpty_Init
	dl YI_NorSpr19C_FlyingBumpty_Init
	dl YI_NorSpr19D_SkeletonGoonie_Init
	dl YI_NorSpr19E_WinglessSkeletonGoonie_Init
	dl YI_NorSpr19F_SkeletonGoonieCarryingBomb_Init
	dl YI_NorSpr1A0_DoubleFirebar_Init
	dl YI_NorSpr1A1_Firebar_Init
	dl YI_NorSpr1A2_HealthStar_Init
	dl YI_NorSpr1A3_LittleSkullMouser_Init
	dl YI_NorSpr1A4_KeyholeCork_Init
	dl YI_NorSpr1A5_RunAwayMonkey_Init
	dl YI_NorSpr1A6_MonkeyWithWatermelon_Init
	dl YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_Init
	dl YI_NorSpr1A8_TheifMonkey_Init
	dl YI_NorSpr1A9_HangingMonkeySpittingSeeds_Init
	dl YI_NorSpr1AA_HotLips_Init
	dl YI_NorSpr1AB_BooBalloon_Init
	dl YI_NorSpr1AC_SmallFrog_Init
	dl YI_NorSpr1AD_MagicShootingKamek_Init
	dl YI_NorSpr1AE_MagicShot_Init
	dl YI_NorSpr1AF_FloatingCoin_Init
	dl YI_NorSpr1B0_DeflatingBalloon_Init
	dl YI_NorSpr1B1_CoinCannon_Init
	dl YI_NorSpr1B2_MinigameCoin_Init
	dl YI_NorSpr1B3_GatherCoinsBandit_Init
	dl YI_NorSpr1B4_MinigameCheckeredPlatform_Init
	dl YI_NorSpr1B5_PoppingBalloonsBandit_Init
	dl YI_NorSpr1B6_MinigameBalloon_Init
	dl YI_NorSpr1B7_SeedSpittingMinigameBandit_Init
	dl YI_NorSpr1B8_WatermelonPot_Init
	dl YI_NorSpr1B9_P2SeedSpittingMinigameBandit_Init

;-------------------------------------------------------------------------
; DATA_sprite_mains: Main pointer table for normal sprites 0x000-0x1B9.
; Same length/indexing as DATA_sprite_inits.  Read by CODE_handle_sprite each frame.
; Raidenthequick: DATA_sprite_mains
;-------------------------------------------------------------------------
DATA_03852E:
DATA_sprite_mains:
	dl YI_NorSpr000_LavaLog_Main
	dl YI_NorSpr001_ClosedDoor_Main
	dl YI_NorSpr002_NavalPiranhaVines_Main
	dl YI_NorSpr003_CrateWithKey_Main
	dl YI_NorSpr004_HitSuperBabyMarioBlock_Main
	dl YI_NorSpr005_IcyWatermelon_Main
	dl YI_NorSpr006_WatermelonFreeze_Main
	dl YI_NorSpr007_Watermelon_Main
	dl YI_NorSpr008_FallingRubble_Main
	dl YI_NorSpr009_FireWatermelon_Main
	dl YI_NorSpr00A_Kaboomba_Main
	dl YI_NorSpr00B_Cannonball_Main
	dl YI_NorSpr00C_RaphaelTheRaven_Main
	dl YI_NorSpr00D_GoalRing_Main
	dl YI_NorSpr00E_GOALLetters_Main
	dl YI_NorSpr00F_BonusChallengeSign_Main
	dl YI_NorSpr010_RoundedCagedGhost_Main
	dl YI_NorSpr011_ItemCard_Main
	dl YI_NorSpr012_BossDoor_Main
	dl YI_NorSpr013_BossExplosion_Main
	dl YI_NorSpr014_KeyFromBoss_Main
	dl YI_NorSpr015_SubmarineTorpedo_Main
	dl YI_NorSpr016_BiggerBoo_Main
	dl YI_NorSpr017_FrogPirate_Main
	dl YI_NorSpr018_WatermelonFlame_Main
	dl YI_NorSpr019_Bubble_Main
	dl YI_NorSpr01A_SkiLift_Main
	dl YI_NorSpr01B_VerticalLavaLog_Main
	dl YI_NorSpr01C_DrFreezegood_Main
	dl YI_NorSpr01D_DrFreezegoodOnSkiLift_Main
	dl YI_NorSpr01E_Shyguy_Main
	dl YI_NorSpr01F_RotatingDoors_Main
	dl YI_NorSpr020_Bandit_Main
	dl YI_NorSpr021_Bucket_Main
	dl YI_NorSpr022_FlashingEgg_Main
	dl YI_NorSpr023_RedEgg_Main
	dl YI_NorSpr024_YellowEgg_Main
	dl YI_NorSpr025_GreenEgg_Main
	dl YI_NorSpr026_BowserFightGiantEgg_Main
	dl YI_NorSpr027_Key_Main
	dl YI_NorSpr028_HuffinPuffin_Main
	dl YI_NorSpr029_GiantEgg_Main
	dl YI_NorSpr02A_RedGiantEgg_Main
	dl YI_NorSpr02B_GreenGiantEgg_Main
	dl YI_NorSpr02C_LungeFish_Main
	dl YI_NorSpr02D_SalvoTheSlime_Main
	dl YI_NorSpr02E_EyesOfSalvoTheSlime_Main
	dl YI_NorSpr02F_LittleMouserHole_Main
	dl YI_NorSpr030_LittleMouser_Main
	dl YI_NorSpr031_PottedSpikedFunGuy_Main
	dl YI_NorSpr032_PeekingLittleMouser_Main
	dl YI_NorSpr033_LittleMouserExitingNest_Main
	dl YI_NorSpr034_RogersPot_Main
	dl YI_NorSpr035_RogerThePottedGhost_Main
	dl YI_NorSpr036_FallingWall_Main
	dl YI_NorSpr037_GrimLeecher_Main
	dl YI_NorSpr038_PottedGhostFlame_Main
	dl YI_NorSpr039_HorizontalRotatingPlank_Main
	dl YI_NorSpr03A_3MiniRavens_Main
	dl YI_NorSpr03B_MiniRaven_Main
	dl YI_NorSpr03C_TapTapTheRedNose_Main
	dl YI_NorSpr03D_LargeSeesaw_Main
	dl YI_NorSpr03E_ThinPlatform_Main
	dl YI_NorSpr03F_SlimeBlock_Main
	dl YI_NorSpr040_BabyLuigi_Main
	dl YI_NorSpr041_Stork_Main
	dl YI_NorSpr042_VerticalPipeEntrance_Main
	dl YI_NorSpr043_RedGiantShyguy_Main
	dl YI_NorSpr044_GreenGiantShyguy_Main
	dl YI_NorSpr045_PrinceFroggy_Main
	dl YI_NorSpr046_BurtTheBashful_Main
	dl YI_NorSpr047_ShyguyPushingRoger_Main
	dl YI_NorSpr048_CutsceneKamek_Main
	dl YI_NorSpr049_ThunderLakituFireBlast1_Main
	dl YI_NorSpr04A_ThunderLakituFireBlast2_Main
	dl YI_NorSpr04B_ThunderLakituFireBlast3_Main
	dl YI_NorSpr04C_UpsidedownBlowHard_Main
	dl YI_NorSpr04D_UnusedSpriteIndex_Main
	dl YI_NorSpr04E_LockedDoor_Main
	dl YI_NorSpr04F_MiddleRing_Main
	dl YI_NorSpr050_GreyRotatingWoodenBoard_Main
	dl YI_NorSpr051_LargeWheel_Main
	dl YI_NorSpr052_BalloonPlatform_Main
	dl YI_NorSpr053_KamekSayingOhMy_Main
	dl YI_NorSpr054_UpsideDownPiranhaPlant_Main
	dl YI_NorSpr055_4GreenRotatingPlatforms_Main
	dl YI_NorSpr056_4PinkRotatingPlatforms_Main
	dl YI_NorSpr057_SewerGhostWithPlatform_Main
	dl YI_NorSpr058_GreenToady_Main
	dl YI_NorSpr059_StationarySuperStar_Main
	dl YI_NorSpr05A_RaphaelSparkAttack_Main
	dl YI_NorSpr05B_RedCoinBandit_Main
	dl YI_NorSpr05C_PinkToady_Main
	dl YI_NorSpr05D_GlitchedSprite_Main
	dl YI_NorSpr05E_BrownWoodenBoard_Main
	dl YI_NorSpr05F_AutoRotateBrownWoodenBoard_Main
	dl YI_NorSpr060_Bomb_Main
	dl YI_NorSpr061_BabyMario_Main
	dl YI_NorSpr062_Goomba_Main
	dl YI_NorSpr063_MuddyBuddy_Main
	dl YI_NorSpr064_4AutoRotatingPinkPlatforms_Main
	dl YI_NorSpr065_RedCoin_Main
	dl YI_NorSpr066_PiranhaPlant_Main
	dl YI_NorSpr067_RockRevealedHiddenWingedCloud_Main
	dl YI_NorSpr068_FlashingEggBlock_Main
	dl YI_NorSpr069_RedEggBlock_Main
	dl YI_NorSpr06A_YellowEggBlock_Main
	dl YI_NorSpr06B_GreenEggBlock_Main
	dl YI_NorSpr06C_LargeSpringBall_Main
	dl YI_NorSpr06D_ClockwiseHootieTheBlueFish_Main
	dl YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_Main
	dl YI_NorSpr06F_SpringBall_Main
	dl YI_NorSpr070_Clawdaddy_Main
	dl YI_NorSpr071_BigBoo_Main
	dl YI_NorSpr072_TrainBandit_Main
	dl YI_NorSpr073_BalloonPump_Main
	dl YI_NorSpr074_Spike_Main
	dl YI_NorSpr075_SpikeBall_Main
	dl YI_NorSpr076_ClockwisePiroDangle_Main
	dl YI_NorSpr077_CounterclockwisePiroDangle_Main
	dl YI_NorSpr078_RedBulletBillShooter_Main
	dl YI_NorSpr079_YellowBulletBillShooter_Main
	dl YI_NorSpr07A_GreenBulletBillShooter_Main
	dl YI_NorSpr07B_RedBulletBill_Main
	dl YI_NorSpr07C_YellowBulletBill_Main
	dl YI_NorSpr07D_GreenBulletBill_Main
	dl YI_NorSpr07E_DentOfSquishyPlatform_Main
	dl YI_NorSpr07F_LogSeesawPlatform_Main
	dl YI_NorSpr080_StraightLavaBubble_Main
	dl YI_NorSpr081_FollowingLavaBubble_Main
	dl YI_NorSpr082_ChainChomp_Main
	dl YI_NorSpr083_BowserFightCloud_Main
	dl YI_NorSpr084_TeleportSprite_Main
	dl YI_NorSpr085_HarryHedgehog_Main
	dl YI_NorSpr086_GlitchedSprite_Main
	dl YI_NorSpr087_MockUpLaidEgg_Main
	dl YI_NorSpr088_SuperStar_Main
	dl YI_NorSpr089_HorizontalMovingRedPlatform_Main
	dl YI_NorSpr08A_VerticalMovingPinkPlatform_Main
	dl YI_NorSpr08B_MockUp_Main
	dl YI_NorSpr08C_YoshiAtGoal_Main
	dl YI_NorSpr08D_Flyguy_Main
	dl YI_NorSpr08E_BowserRoomKamek_Main
	dl YI_NorSpr08F_MonkeySwing_Main
	dl YI_NorSpr090_DanglingGhost_Main
	dl YI_NorSpr091_4RedToadies_Main
	dl YI_NorSpr092_MelonBug_Main
	dl YI_NorSpr093_Door_Main
	dl YI_NorSpr094_ExpandingBlock_Main
	dl YI_NorSpr095_BlueCheckeredBlock_Main
	dl YI_NorSpr096_RedCheckeredBlock_Main
	dl YI_NorSpr097_POWBlock_Main
	dl YI_NorSpr098_EndTransformationBlock_Main
	dl YI_NorSpr099_SpinyEgg_Main
	dl YI_NorSpr09A_SwingingGreenPlatform_Main
	dl YI_NorSpr09B_MaceGuy_Main
	dl YI_NorSpr09C_Mace_Main
	dl YI_NorSpr09D_RedSwitch_Main
	dl YI_NorSpr09E_ChompRock_Main
	dl YI_NorSpr09F_PtooiePiranhaPlant_Main
	dl YI_NorSpr0A0_Tulip_Main
	dl YI_NorSpr0A1_SmallPot_Main
	dl YI_NorSpr0A2_ThunderLakituFireball_Main
	dl YI_NorSpr0A3_LeftHidingBandit_Main
	dl YI_NorSpr0A4_RightHidingBandit_Main
	dl YI_NorSpr0A5_NepEnut_Main
	dl YI_NorSpr0A6_IncomingChomp_Main
	dl YI_NorSpr0A7_GroupOfIncomingChomps_Main
	dl YI_NorSpr0A8_FallingIncomingChomp_Main
	dl YI_NorSpr0A9_IncomingChompShadow_Main
	dl YI_NorSpr0AA_BackgroundShyguy_Main
	dl YI_NorSpr0AB_FullEggSpawner_Main
	dl YI_NorSpr0AC_FallingRockArrowAndShadow_Main
	dl YI_NorSpr0AD_MessageBox_Main
	dl YI_NorSpr0AE_HookbillTheKoopa_Main
	dl YI_NorSpr0AF_CarMorphBubble_Main
	dl YI_NorSpr0B0_MoleMorphBubble_Main
	dl YI_NorSpr0B1_HelicopterMorphBubble_Main
	dl YI_NorSpr0B2_TrainMorphBubble_Main
	dl YI_NorSpr0B3_FuzzyFart_Main
	dl YI_NorSpr0B4_SubmarineMorphBubble_Main
	dl YI_NorSpr0B5_HiddenWingedCloud_Main
	dl YI_NorSpr0B6_WingedCloudWith8Coins_Main
	dl YI_NorSpr0B7_WingedCloudWithBubbled1up_Main
	dl YI_NorSpr0B8_WingedCloudWithFlower_Main
	dl YI_NorSpr0B9_WingedCloudWithPOW_Main
	dl YI_NorSpr0BA_WingedCloudWithStairs_Main
	dl YI_NorSpr0BB_WingedCloudWithPlatform_Main
	dl YI_NorSpr0BC_WingedCloudWithBandit_Main
	dl YI_NorSpr0BD_WingedCloudWithCoin_Main
	dl YI_NorSpr0BE_WingedCloudWith1up_Main
	dl YI_NorSpr0BF_WingedCloudWithKey_Main
	dl YI_NorSpr0C0_WingedCloudWith3Stars_Main
	dl YI_NorSpr0C1_WingedCloudWith5Stars_Main
	dl YI_NorSpr0C2_WingedCloudWithDoor_Main
	dl YI_NorSpr0C3_WingedCloudWithLowerGround_Main
	dl YI_NorSpr0C4_WingedCloudWithWatermelon_Main
	dl YI_NorSpr0C5_WingedCloudWithFireWatermelon_Main
	dl YI_NorSpr0C6_WingedCloudWithIcyWatermelon_Main
	dl YI_NorSpr0C7_WingedCloudWith3LeafSunflower_Main
	dl YI_NorSpr0C8_WingedCloudWith6LeafSunflower_Main
	dl YI_NorSpr0C9_WingedCloudWithCrashGameFeature_Main
	dl YI_NorSpr0CA_BigBossDoor_Main
	dl YI_NorSpr0CB_WingedCloudWithCoinOrStar_Main
	dl YI_NorSpr0CC_WingedCloudWithRedSwitch_Main
	dl YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_Main
	dl YI_NorSpr0CE_BowserFire_Main
	dl YI_NorSpr0CF_BowserRocks_Main
	dl YI_NorSpr0D0_HorizontalEntranceToRight_Main
	dl YI_NorSpr0D1_SecretPipeEntrance_Main
	dl YI_NorSpr0D2_MarchingMilde_Main
	dl YI_NorSpr0D3_LargeMilde_Main
	dl YI_NorSpr0D4_MediumMilde_Main
	dl YI_NorSpr0D5_BackgroundForHookbillFight_Main
	dl YI_NorSpr0D6_FortGhostWithPlatform_Main
	dl YI_NorSpr0D7_SluggyTheUnshaven_Main
	dl YI_NorSpr0D8_ChompWarningSign_Main
	dl YI_NorSpr0D9_FishinLakitu_Main
	dl YI_NorSpr0DA_FlowerPot_Main
	dl YI_NorSpr0DB_SoftBlock_Main
	dl YI_NorSpr0DC_Snowball_Main
	dl YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_Main
	dl YI_NorSpr0DE_FallingRockPlatform_Main
	dl YI_NorSpr0DF_PiscatoryPete_Main
	dl YI_NorSpr0E0_PreyingMantas_Main
	dl YI_NorSpr0E1_LochNestor_Main
	dl YI_NorSpr0E2_BooBlah_Main
	dl YI_NorSpr0E3_BooBlahWithPiroDangle_Main
	dl YI_NorSpr0E4_HeadingCactus_Main
	dl YI_NorSpr0E5_GreenNeedlenose_Main
	dl YI_NorSpr0E6_Gusty_Main
	dl YI_NorSpr0E7_Burt_Main
	dl YI_NorSpr0E8_Goonie_Main
	dl YI_NorSpr0E9_3WinglessGoonies_Main
	dl YI_NorSpr0EA_VerticalCloudDrop_Main
	dl YI_NorSpr0EB_HorizontalCloudDrop_Main
	dl YI_NorSpr0EC_JumpingFlamerGuy_Main
	dl YI_NorSpr0ED_RunningFlamerGuy_Main
	dl YI_NorSpr0EE_EggoDil_Main
	dl YI_NorSpr0EF_EggoDilFace_Main
	dl YI_NorSpr0F0_EggoDilPetal_Main
	dl YI_NorSpr0F1_EggPlantShootingBubbles_Main
	dl YI_NorSpr0F2_ShyguyOnStilts_Main
	dl YI_NorSpr0F3_WoozyGuy_Main
	dl YI_NorSpr0F4_EggPlant_Main
	dl YI_NorSpr0F5_Slugger_Main
	dl YI_NorSpr0F6_MotherHuffinPuffin_Main
	dl YI_NorSpr0F7_BarneyBubble_Main
	dl YI_NorSpr0F8_BlowHard_Main
	dl YI_NorSpr0F9_YellowNeedlenose_Main
	dl YI_NorSpr0FA_Flower_Main
	dl YI_NorSpr0FB_LongSpearGuy_Main
	dl YI_NorSpr0FC_ShortSpearGuy_Main
	dl YI_NorSpr0FD_ZeusGuy_Main
	dl YI_NorSpr0FE_ZeusGuyBlast_Main
	dl YI_NorSpr0FF_Poochy_Main
	dl YI_NorSpr100_Bubbled1up_Main
	dl YI_NorSpr101_RotatingMace_Main
	dl YI_NorSpr102_DoubleRotatingMace_Main
	dl YI_NorSpr103_BooGuysMovingMace_Main
	dl YI_NorSpr104_JeanDeFillet_Main
	dl YI_NorSpr105_BooGuysCarryingBombToLeft_Main
	dl YI_NorSpr106_BooGuysCarryingBombToRight_Main
	dl YI_NorSpr107_WatermelonSeed_Main
	dl YI_NorSpr108_Milde_Main
	dl YI_NorSpr109_BronzeTapTap_Main
	dl YI_NorSpr10A_SilverTapTap_Main
	dl YI_NorSpr10B_HoppingSilverTapTap_Main
	dl YI_NorSpr10C_ChainedSpikeBall_Main
	dl YI_NorSpr10D_BooGuyOperatingPulley_Main
	dl YI_NorSpr10E_CrateWith6Stars_Main
	dl YI_NorSpr10F_BooManBluff_Main
	dl YI_NorSpr110_Flower_Main
	dl YI_NorSpr111_GeorgetteJelly_Main
	dl YI_NorSpr112_GeorgetteJellyGoo_Main
	dl YI_NorSpr113_Snifit_Main
	dl YI_NorSpr114_SnifitBullet_Main
	dl YI_NorSpr115_Coin_Main
	dl YI_NorSpr116_BuoyantRoundPlatform_Main
	dl YI_NorSpr117_DonutLift_Main
	dl YI_NorSpr118_LargeDonutLift_Main
	dl YI_NorSpr119_Spooky_Main
	dl YI_NorSpr11A_GreenGlove_Main
	dl YI_NorSpr11B_Lakitu_Main
	dl YI_NorSpr11C_LakituCloud_Main
	dl YI_NorSpr11D_SpinyEgg_Main
	dl YI_NorSpr11E_BrownArrowWheel_Main
	dl YI_NorSpr11F_BlueArrowWheel_Main
	dl YI_NorSpr120_DoubledSidedArrowLift_Main
	dl YI_NorSpr121_NumberPlatformExplosion_Main
	dl YI_NorSpr122_BucketWithBandit_Main
	dl YI_NorSpr123_BucketWithCoins_Main
	dl YI_NorSpr124_Stretch_Main
	dl YI_NorSpr125_AttackingAndEndingKamek_Main
	dl YI_NorSpr126_SpikedLogOnPulley_Main
	dl YI_NorSpr127_PulleyOfSpikedLog_Main
	dl YI_NorSpr128_GroundRippleInBabyBowerRoom_Main
	dl YI_NorSpr129_Fuzzy_Main
	dl YI_NorSpr12A_ShyGuyBanditTrap_Main
	dl YI_NorSpr12B_FatGuy_Main
	dl YI_NorSpr12C_FlyOrWhirlyGuy_Main
	dl YI_NorSpr12D_PrologueCutsceneYoshi_Main
	dl YI_NorSpr12E_LargePopEffect_Main
	dl YI_NorSpr12F_HorizontalLavaDrop_Main
	dl YI_NorSpr130_VerticalLavaDrop_Main
	dl YI_NorSpr131_LockedDoor_Main
	dl YI_NorSpr132_LemonDrop_Main
	dl YI_NorSpr133_LanternGhost_Main
	dl YI_NorSpr134_BabyBowser_Main
	dl YI_NorSpr135_CirclingRaven_Main
	dl YI_NorSpr136_CirclingRaven_Main
	dl YI_NorSpr137_3x6FallingStone_Main
	dl YI_NorSpr138_3x3FallingStone_Main
	dl YI_NorSpr139_3x9FallingStone_Main
	dl YI_NorSpr13A_6x3FallingStone_Main
	dl YI_NorSpr13B_StomachAcid_Main
	dl YI_NorSpr13C_DownFlippers_Main
	dl YI_NorSpr13D_DanglingFang_Main
	dl YI_NorSpr13E_FlyingFang_Main
	dl YI_NorSpr13F_SwimmingFlopsyFish_Main
	dl YI_NorSpr140_SwimmingAndJumpingFlopsyFish_Main
	dl YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_Main
	dl YI_NorSpr142_3JumpFlopsyFish_Main
	dl YI_NorSpr143_SprayFish_Main
	dl YI_NorSpr144_RightOrLeftFlippers_Main
	dl YI_NorSpr145_BlueSluggy_Main
	dl YI_NorSpr146_PinkSluggy_Main
	dl YI_NorSpr147_HorizontalEntranceToLeft_Main
	dl YI_NorSpr148_LargeSpringBall_Main
	dl YI_NorSpr149_UpArrowCloud_Main
	dl YI_NorSpr14A_UpRightArrowCloud_Main
	dl YI_NorSpr14B_RightArrowCloud_Main
	dl YI_NorSpr14C_DownRightArrowCloud_Main
	dl YI_NorSpr14D_DownArrowCloud_Main
	dl YI_NorSpr14E_DownLeftArrowCloud_Main
	dl YI_NorSpr14F_LeftArrowCloud_Main
	dl YI_NorSpr150_UpLeftArrowCloud_Main
	dl YI_NorSpr151_RotatingArrowCloud_Main
	dl YI_NorSpr152_Flutter_Main
	dl YI_NorSpr153_GoonieWithShyGuy_Main
	dl YI_NorSpr154_SharkChomp_Main
	dl YI_NorSpr155_FatGoonie_Main
	dl YI_NorSpr156_CactusJack_Main
	dl YI_NorSpr157_WallLakitu_Main
	dl YI_NorSpr158_BowlingGoonie_Main
	dl YI_NorSpr159_WalkingGrunt_Main
	dl YI_NorSpr15A_RunningGrunt_Main
	dl YI_NorSpr15B_DancingSpearGuy_Main
	dl YI_NorSpr15C_GreenRotatingPlatformSwitch_Main
	dl YI_NorSpr15D_RedRotatingPlatformSwitch_Main
	dl YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_Main
	dl YI_NorSpr15F_GreenSpikedPlatform_Main
	dl YI_NorSpr160_RedSpikedPlatform_Main
	dl YI_NorSpr161_RewardItemForDefeatingRoomEnemies_Main
	dl YI_NorSpr162_DoubleSpikePlatformWithSwitch_Main
	dl YI_NorSpr163_BouncingNeedlenose_Main
	dl YI_NorSpr164_NipperPlant_Main
	dl YI_NorSpr165_NipperSpore_Main
	dl YI_NorSpr166_ThunderLakitu_Main
	dl YI_NorSpr167_GreenKoopaShell_Main
	dl YI_NorSpr168_RedKoopaShell_Main
	dl YI_NorSpr169_GreenNakedKoopa_Main
	dl YI_NorSpr16A_RedNakedKoopa_Main
	dl YI_NorSpr16B_GreenKoopa_Main
	dl YI_NorSpr16C_RedKoopa_Main
	dl YI_NorSpr16D_GreenParakoopa_Main
	dl YI_NorSpr16E_RedHorizontalParakoopa_Main
	dl YI_NorSpr16F_RedVerticalParakoopa_Main
	dl YI_NorSpr170_AquaLakitu_Main
	dl YI_NorSpr171_NavalPiranha_Main
	dl YI_NorSpr172_NavalPiranhaBuds_Main
	dl YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_Main
	dl YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_Main
	dl YI_NorSpr175_BaronVonZeppelinCarryingBomb_Main
	dl YI_NorSpr176_BaronVonZeppelinCarryingBandit_Main
	dl YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_Main
	dl YI_NorSpr178_BaronVonZeppelinCarrying1up_Main
	dl YI_NorSpr179_BaronVonZeppelinCarryingKey_Main
	dl YI_NorSpr17A_BaronVonZeppelinCarryingCoins_Main
	dl YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_Main
	dl YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_Main
	dl YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_Main
	dl YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_Main
	dl YI_NorSpr17F_BaronVonZeppelin_Main
	dl YI_NorSpr180_SpinningLog_Main
	dl YI_NorSpr181_CrazeeDayzee_Main
	dl YI_NorSpr182_Dragonfly_Main
	dl YI_NorSpr183_Butterfly_Main
	dl YI_NorSpr184_Bumpty_Main
	dl YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_Main
	dl YI_NorSpr186_MovingLineGuidedGreenPlatformRight_Main
	dl YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_Main
	dl YI_NorSpr188_MovingLineGuidedYellowPlatformRight_Main
	dl YI_NorSpr189_LineGuidedGreenPlatformLeft_Main
	dl YI_NorSpr18A_LineGuidedGreenPlatformRight_Main
	dl YI_NorSpr18B_LineGuidedYellowPlatformLeft_Main
	dl YI_NorSpr18C_LineGuidedYellowPlatformRight_Main
	dl YI_NorSpr18D_LineGuidedRedPlatformLeft_Main
	dl YI_NorSpr18E_LineGuidedGreenPlatformRight_Main
	dl YI_NorSpr18F_SpiralPlatform_Main
	dl YI_NorSpr190_FallingIcicle_Main
	dl YI_NorSpr191_Bird_Main
	dl YI_NorSpr192_PetalGuy_Main
	dl YI_NorSpr193_SnakeCagedGhost_Main
	dl YI_NorSpr194_Blargg_Main
	dl YI_NorSpr195_SmallUnstableSnowPlatform_Main
	dl YI_NorSpr196_UnstableSnowPlatform_Main
	dl YI_NorSpr197_ArrowSign_Main
	dl YI_NorSpr198_DiagonalArrowSign_Main
	dl YI_NorSpr199_DizzyDandy_Main
	dl YI_NorSpr19A_BooGuy_Main
	dl YI_NorSpr19B_TacklingBumpty_Main
	dl YI_NorSpr19C_FlyingBumpty_Main
	dl YI_NorSpr19D_SkeletonGoonie_Main
	dl YI_NorSpr19E_WinglessSkeletonGoonie_Main
	dl YI_NorSpr19F_SkeletonGoonieCarryingBomb_Main
	dl YI_NorSpr1A0_DoubleFirebar_Main
	dl YI_NorSpr1A1_Firebar_Main
	dl YI_NorSpr1A2_HealthStar_Main
	dl YI_NorSpr1A3_LittleSkullMouser_Main
	dl YI_NorSpr1A4_KeyholeCork_Main
	dl YI_NorSpr1A5_RunAwayMonkey_Main
	dl YI_NorSpr1A6_MonkeyWithWatermelon_Main
	dl YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_Main
	dl YI_NorSpr1A8_TheifMonkey_Main
	dl YI_NorSpr1A9_HangingMonkeySpittingSeeds_Main
	dl YI_NorSpr1AA_HotLips_Main
	dl YI_NorSpr1AB_BooBalloon_Main
	dl YI_NorSpr1AC_SmallFrog_Main
	dl YI_NorSpr1AD_MagicShootingKamek_Main
	dl YI_NorSpr1AE_MagicShot_Main
	dl YI_NorSpr1AF_FloatingCoin_Main
	dl YI_NorSpr1B0_DeflatingBalloon_Main
	dl YI_NorSpr1B1_CoinCannon_Main
	dl YI_NorSpr1B2_MinigameCoin_Main
	dl YI_NorSpr1B3_GatherCoinsBandit_Main
	dl YI_NorSpr1B4_MinigameCheckeredPlatform_Main
	dl YI_NorSpr1B5_PoppingBalloonsBandit_Main
	dl YI_NorSpr1B6_MinigameBalloon_Main
	dl YI_NorSpr1B7_SeedSpittingMinigameBandit_Main
	dl YI_NorSpr1B8_WatermelonPot_Main
	dl YI_NorSpr1B9_P2SeedSpittingMinigameBandit_Main

;-------------------------------------------------------------------------
; DATA_head_bops: pointer table for "Yoshi tongues/stomps this sprite" handler.
; Same length/indexing as DATA_sprite_inits.  Many entries share a single
; stub-RTL routine (see how many labels stack above one RTS in this file).
; Raidenthequick: DATA_head_bops
;-------------------------------------------------------------------------
DATA_038A5C:
DATA_head_bops:
	dl YI_NorSpr000_LavaLog_StompRt
	dl YI_NorSpr001_ClosedDoor_StompRt
	dl YI_NorSpr002_NavalPiranhaVines_StompRt
	dl YI_NorSpr003_CrateWithKey_StompRt
	dl YI_NorSpr004_HitSuperBabyMarioBlock_StompRt
	dl YI_NorSpr005_IcyWatermelon_StompRt
	dl YI_NorSpr006_WatermelonFreeze_StompRt
	dl YI_NorSpr007_Watermelon_StompRt
	dl YI_NorSpr008_FallingRubble_StompRt
	dl YI_NorSpr009_FireWatermelon_StompRt
	dl YI_NorSpr00A_Kaboomba_StompRt
	dl YI_NorSpr00B_Cannonball_StompRt
	dl YI_NorSpr00C_RaphaelTheRaven_StompRt
	dl YI_NorSpr00D_GoalRing_StompRt
	dl YI_NorSpr00E_GOALLetters_StompRt
	dl YI_NorSpr00F_BonusChallengeSign_StompRt
	dl YI_NorSpr010_RoundedCagedGhost_StompRt
	dl YI_NorSpr011_ItemCard_StompRt
	dl YI_NorSpr012_BossDoor_StompRt
	dl YI_NorSpr013_BossExplosion_StompRt
	dl YI_NorSpr014_KeyFromBoss_StompRt
	dl YI_NorSpr015_SubmarineTorpedo_StompRt
	dl YI_NorSpr016_BiggerBoo_StompRt
	dl YI_NorSpr017_FrogPirate_StompRt
	dl YI_NorSpr018_WatermelonFlame_StompRt
	dl YI_NorSpr019_Bubble_StompRt
	dl YI_NorSpr01A_SkiLift_StompRt
	dl YI_NorSpr01B_VerticalLavaLog_StompRt
	dl YI_NorSpr01C_DrFreezegood_StompRt
	dl YI_NorSpr01D_DrFreezegoodOnSkiLift_StompRt
	dl YI_NorSpr01E_Shyguy_StompRt
	dl YI_NorSpr01F_RotatingDoors_StompRt
	dl YI_NorSpr020_Bandit_StompRt
	dl YI_NorSpr021_Bucket_StompRt
	dl YI_NorSpr022_FlashingEgg_StompRt
	dl YI_NorSpr023_RedEgg_StompRt
	dl YI_NorSpr024_YellowEgg_StompRt
	dl YI_NorSpr025_GreenEgg_StompRt
	dl YI_NorSpr026_BowserFightGiantEgg_StompRt
	dl YI_NorSpr027_Key_StompRt
	dl YI_NorSpr028_HuffinPuffin_StompRt
	dl YI_NorSpr029_GiantEgg_StompRt
	dl YI_NorSpr02A_RedGiantEgg_StompRt
	dl YI_NorSpr02B_GreenGiantEgg_StompRt
	dl YI_NorSpr02C_LungeFish_StompRt
	dl YI_NorSpr02D_SalvoTheSlime_StompRt
	dl YI_NorSpr02E_EyesOfSalvoTheSlime_StompRt
	dl YI_NorSpr02F_LittleMouserHole_StompRt
	dl YI_NorSpr030_LittleMouser_StompRt
	dl YI_NorSpr031_PottedSpikedFunGuy_StompRt
	dl YI_NorSpr032_PeekingLittleMouser_StompRt
	dl YI_NorSpr033_LittleMouserExitingNest_StompRt
	dl YI_NorSpr034_RogersPot_StompRt
	dl YI_NorSpr035_RogerThePottedGhost_StompRt
	dl YI_NorSpr036_FallingWall_StompRt
	dl YI_NorSpr037_GrimLeecher_StompRt
	dl YI_NorSpr038_PottedGhostFlame_StompRt
	dl YI_NorSpr039_HorizontalRotatingPlank_StompRt
	dl YI_NorSpr03A_3MiniRavens_StompRt
	dl YI_NorSpr03B_MiniRaven_StompRt
	dl YI_NorSpr03C_TapTapTheRedNose_StompRt
	dl YI_NorSpr03D_LargeSeesaw_StompRt
	dl YI_NorSpr03E_ThinPlatform_StompRt
	dl YI_NorSpr03F_SlimeBlock_StompRt
	dl YI_NorSpr040_BabyLuigi_StompRt
	dl YI_NorSpr041_Stork_StompRt
	dl YI_NorSpr042_VerticalPipeEntrance_StompRt
	dl YI_NorSpr043_RedGiantShyguy_StompRt
	dl YI_NorSpr044_GreenGiantShyguy_StompRt
	dl YI_NorSpr045_PrinceFroggy_StompRt
	dl YI_NorSpr046_BurtTheBashful_StompRt
	dl YI_NorSpr047_ShyguyPushingRoger_StompRt
	dl YI_NorSpr048_CutsceneKamek_StompRt
	dl YI_NorSpr049_ThunderLakituFireBlast1_StompRt
	dl YI_NorSpr04A_ThunderLakituFireBlast2_StompRt
	dl YI_NorSpr04B_ThunderLakituFireBlast3_StompRt
	dl YI_NorSpr04C_UpsidedownBlowHard_StompRt
	dl YI_NorSpr04D_UnusedSpriteIndex_StompRt
	dl YI_NorSpr04E_LockedDoor_StompRt
	dl YI_NorSpr04F_MiddleRing_StompRt
	dl YI_NorSpr050_GreyRotatingWoodenBoard_StompRt
	dl YI_NorSpr051_LargeWheel_StompRt
	dl YI_NorSpr052_BalloonPlatform_StompRt
	dl YI_NorSpr053_KamekSayingOhMy_StompRt
	dl YI_NorSpr054_UpsideDownPiranhaPlant_StompRt
	dl YI_NorSpr055_4GreenRotatingPlatforms_StompRt
	dl YI_NorSpr056_4PinkRotatingPlatforms_StompRt
	dl YI_NorSpr057_SewerGhostWithPlatform_StompRt
	dl YI_NorSpr058_GreenToady_StompRt
	dl YI_NorSpr059_StationarySuperStar_StompRt
	dl YI_NorSpr05A_RaphaelSparkAttack_StompRt
	dl YI_NorSpr05B_RedCoinBandit_StompRt
	dl YI_NorSpr05C_PinkToady_StompRt
	dl YI_NorSpr05D_GlitchedSprite_StompRt
	dl YI_NorSpr05E_BrownWoodenBoard_StompRt
	dl YI_NorSpr05F_AutoRotateBrownWoodenBoard_StompRt
	dl YI_NorSpr060_Bomb_StompRt
	dl YI_NorSpr061_BabyMario_StompRt
	dl YI_NorSpr062_Goomba_StompRt
	dl YI_NorSpr063_MuddyBuddy_StompRt
	dl YI_NorSpr064_4AutoRotatingPinkPlatforms_StompRt
	dl YI_NorSpr065_RedCoin_StompRt
	dl YI_NorSpr066_PiranhaPlant_StompRt
	dl YI_NorSpr067_RockRevealedHiddenWingedCloud_StompRt
	dl YI_NorSpr068_FlashingEggBlock_StompRt
	dl YI_NorSpr069_RedEggBlock_StompRt
	dl YI_NorSpr06A_YellowEggBlock_StompRt
	dl YI_NorSpr06B_GreenEggBlock_StompRt
	dl YI_NorSpr06C_LargeSpringBall_StompRt
	dl YI_NorSpr06D_ClockwiseHootieTheBlueFish_StompRt
	dl YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_StompRt
	dl YI_NorSpr06F_SpringBall_StompRt
	dl YI_NorSpr070_Clawdaddy_StompRt
	dl YI_NorSpr071_BigBoo_StompRt
	dl YI_NorSpr072_TrainBandit_StompRt
	dl YI_NorSpr073_BalloonPump_StompRt
	dl YI_NorSpr074_Spike_StompRt
	dl YI_NorSpr075_SpikeBall_StompRt
	dl YI_NorSpr076_ClockwisePiroDangle_StompRt
	dl YI_NorSpr077_CounterclockwisePiroDangle_StompRt
	dl YI_NorSpr078_RedBulletBillShooter_StompRt
	dl YI_NorSpr079_YellowBulletBillShooter_StompRt
	dl YI_NorSpr07A_GreenBulletBillShooter_StompRt
	dl YI_NorSpr07B_RedBulletBill_StompRt
	dl YI_NorSpr07C_YellowBulletBill_StompRt
	dl YI_NorSpr07D_GreenBulletBill_StompRt
	dl YI_NorSpr07E_DentOfSquishyPlatform_StompRt
	dl YI_NorSpr07F_LogSeesawPlatform_StompRt
	dl YI_NorSpr080_StraightLavaBubble_StompRt
	dl YI_NorSpr081_FollowingLavaBubble_StompRt
	dl YI_NorSpr082_ChainChomp_StompRt
	dl YI_NorSpr083_BowserFightCloud_StompRt
	dl YI_NorSpr084_TeleportSprite_StompRt
	dl YI_NorSpr085_HarryHedgehog_StompRt
	dl YI_NorSpr086_GlitchedSprite_StompRt
	dl YI_NorSpr087_MockUpLaidEgg_StompRt
	dl YI_NorSpr088_SuperStar_StompRt
	dl YI_NorSpr089_HorizontalMovingRedPlatform_StompRt
	dl YI_NorSpr08A_VerticalMovingPinkPlatform_StompRt
	dl YI_NorSpr08B_MockUp_StompRt
	dl YI_NorSpr08C_YoshiAtGoal_StompRt
	dl YI_NorSpr08D_Flyguy_StompRt
	dl YI_NorSpr08E_BowserRoomKamek_StompRt
	dl YI_NorSpr08F_MonkeySwing_StompRt
	dl YI_NorSpr090_DanglingGhost_StompRt
	dl YI_NorSpr091_4RedToadies_StompRt
	dl YI_NorSpr092_MelonBug_StompRt
	dl YI_NorSpr093_Door_StompRt
	dl YI_NorSpr094_ExpandingBlock_StompRt
	dl YI_NorSpr095_BlueCheckeredBlock_StompRt
	dl YI_NorSpr096_RedCheckeredBlock_StompRt
	dl YI_NorSpr097_POWBlock_StompRt
	dl YI_NorSpr098_EndTransformationBlock_StompRt
	dl YI_NorSpr099_SpinyEgg_StompRt
	dl YI_NorSpr09A_SwingingGreenPlatform_StompRt
	dl YI_NorSpr09B_MaceGuy_StompRt
	dl YI_NorSpr09C_Mace_StompRt
	dl YI_NorSpr09D_RedSwitch_StompRt
	dl YI_NorSpr09E_ChompRock_StompRt
	dl YI_NorSpr09F_PtooiePiranhaPlant_StompRt
	dl YI_NorSpr0A0_Tulip_StompRt
	dl YI_NorSpr0A1_SmallPot_StompRt
	dl YI_NorSpr0A2_ThunderLakituFireball_StompRt
	dl YI_NorSpr0A3_LeftHidingBandit_StompRt
	dl YI_NorSpr0A4_RightHidingBandit_StompRt
	dl YI_NorSpr0A5_NepEnut_StompRt
	dl YI_NorSpr0A6_IncomingChomp_StompRt
	dl YI_NorSpr0A7_GroupOfIncomingChomps_StompRt
	dl YI_NorSpr0A8_FallingIncomingChomp_StompRt
	dl YI_NorSpr0A9_IncomingChompShadow_StompRt
	dl YI_NorSpr0AA_BackgroundShyguy_StompRt
	dl YI_NorSpr0AB_FullEggSpawner_StompRt
	dl YI_NorSpr0AC_FallingRockArrowAndShadow_StompRt
	dl YI_NorSpr0AD_MessageBox_StompRt
	dl YI_NorSpr0AE_HookbillTheKoopa_StompRt
	dl YI_NorSpr0AF_CarMorphBubble_StompRt
	dl YI_NorSpr0B0_MoleMorphBubble_StompRt
	dl YI_NorSpr0B1_HelicopterMorphBubble_StompRt
	dl YI_NorSpr0B2_TrainMorphBubble_StompRt
	dl YI_NorSpr0B3_FuzzyFart_StompRt
	dl YI_NorSpr0B4_SubmarineMorphBubble_StompRt
	dl YI_NorSpr0B5_HiddenWingedCloud_StompRt
	dl YI_NorSpr0B6_WingedCloudWith8Coins_StompRt
	dl YI_NorSpr0B7_WingedCloudWithBubbled1up_StompRt
	dl YI_NorSpr0B8_WingedCloudWithFlower_StompRt
	dl YI_NorSpr0B9_WingedCloudWithPOW_StompRt
	dl YI_NorSpr0BA_WingedCloudWithStairs_StompRt
	dl YI_NorSpr0BB_WingedCloudWithPlatform_StompRt
	dl YI_NorSpr0BC_WingedCloudWithBandit_StompRt
	dl YI_NorSpr0BD_WingedCloudWithCoin_StompRt
	dl YI_NorSpr0BE_WingedCloudWith1up_StompRt
	dl YI_NorSpr0BF_WingedCloudWithKey_StompRt
	dl YI_NorSpr0C0_WingedCloudWith3Stars_StompRt
	dl YI_NorSpr0C1_WingedCloudWith5Stars_StompRt
	dl YI_NorSpr0C2_WingedCloudWithDoor_StompRt
	dl YI_NorSpr0C3_WingedCloudWithLowerGround_StompRt
	dl YI_NorSpr0C4_WingedCloudWithWatermelon_StompRt
	dl YI_NorSpr0C5_WingedCloudWithFireWatermelon_StompRt
	dl YI_NorSpr0C6_WingedCloudWithIcyWatermelon_StompRt
	dl YI_NorSpr0C7_WingedCloudWith3LeafSunflower_StompRt
	dl YI_NorSpr0C8_WingedCloudWith6LeafSunflower_StompRt
	dl YI_NorSpr0C9_WingedCloudWithCrashGameFeature_StompRt
	dl YI_NorSpr0CA_BigBossDoor_StompRt
	dl YI_NorSpr0CB_WingedCloudWithCoinOrStar_StompRt
	dl YI_NorSpr0CC_WingedCloudWithRedSwitch_StompRt
	dl YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_StompRt
	dl YI_NorSpr0CE_BowserFire_StompRt
	dl YI_NorSpr0CF_BowserRocks_StompRt
	dl YI_NorSpr0D0_HorizontalEntranceToRight_StompRt
	dl YI_NorSpr0D1_SecretPipeEntrance_StompRt
	dl YI_NorSpr0D2_MarchingMilde_StompRt
	dl YI_NorSpr0D3_LargeMilde_StompRt
	dl YI_NorSpr0D4_MediumMilde_StompRt
	dl YI_NorSpr0D5_BackgroundForHookbillFight_StompRt
	dl YI_NorSpr0D6_FortGhostWithPlatform_StompRt
	dl YI_NorSpr0D7_SluggyTheUnshaven_StompRt
	dl YI_NorSpr0D8_ChompWarningSign_StompRt
	dl YI_NorSpr0D9_FishinLakitu_StompRt
	dl YI_NorSpr0DA_FlowerPot_StompRt
	dl YI_NorSpr0DB_SoftBlock_StompRt
	dl YI_NorSpr0DC_Snowball_StompRt
	dl YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_StompRt
	dl YI_NorSpr0DE_FallingRockPlatform_StompRt
	dl YI_NorSpr0DF_PiscatoryPete_StompRt
	dl YI_NorSpr0E0_PreyingMantas_StompRt
	dl YI_NorSpr0E1_LochNestor_StompRt
	dl YI_NorSpr0E2_BooBlah_StompRt
	dl YI_NorSpr0E3_BooBlahWithPiroDangle_StompRt
	dl YI_NorSpr0E4_HeadingCactus_StompRt
	dl YI_NorSpr0E5_GreenNeedlenose_StompRt
	dl YI_NorSpr0E6_Gusty_StompRt
	dl YI_NorSpr0E7_Burt_StompRt
	dl YI_NorSpr0E8_Goonie_StompRt
	dl YI_NorSpr0E9_3WinglessGoonies_StompRt
	dl YI_NorSpr0EA_VerticalCloudDrop_StompRt
	dl YI_NorSpr0EB_HorizontalCloudDrop_StompRt
	dl YI_NorSpr0EC_JumpingFlamerGuy_StompRt
	dl YI_NorSpr0ED_RunningFlamerGuy_StompRt
	dl YI_NorSpr0EE_EggoDil_StompRt
	dl YI_NorSpr0EF_EggoDilFace_StompRt
	dl YI_NorSpr0F0_EggoDilPetal_StompRt
	dl YI_NorSpr0F1_EggPlantShootingBubbles_StompRt
	dl YI_NorSpr0F2_ShyguyOnStilts_StompRt
	dl YI_NorSpr0F3_WoozyGuy_StompRt
	dl YI_NorSpr0F4_EggPlant_StompRt
	dl YI_NorSpr0F5_Slugger_StompRt
	dl YI_NorSpr0F6_MotherHuffinPuffin_StompRt
	dl YI_NorSpr0F7_BarneyBubble_StompRt
	dl YI_NorSpr0F8_BlowHard_StompRt
	dl YI_NorSpr0F9_YellowNeedlenose_StompRt
	dl YI_NorSpr0FA_Flower_StompRt
	dl YI_NorSpr0FB_LongSpearGuy_StompRt
	dl YI_NorSpr0FC_ShortSpearGuy_StompRt
	dl YI_NorSpr0FD_ZeusGuy_StompRt
	dl YI_NorSpr0FE_ZeusGuyBlast_StompRt
	dl YI_NorSpr0FF_Poochy_StompRt
	dl YI_NorSpr100_Bubbled1up_StompRt
	dl YI_NorSpr101_RotatingMace_StompRt
	dl YI_NorSpr102_DoubleRotatingMace_StompRt
	dl YI_NorSpr103_BooGuysMovingMace_StompRt
	dl YI_NorSpr104_JeanDeFillet_StompRt
	dl YI_NorSpr105_BooGuysCarryingBombToLeft_StompRt
	dl YI_NorSpr106_BooGuysCarryingBombToRight_StompRt
	dl YI_NorSpr107_WatermelonSeed_StompRt
	dl YI_NorSpr108_Milde_StompRt
	dl YI_NorSpr109_BronzeTapTap_StompRt
	dl YI_NorSpr10A_SilverTapTap_StompRt
	dl YI_NorSpr10B_HoppingSilverTapTap_StompRt
	dl YI_NorSpr10C_ChainedSpikeBall_StompRt
	dl YI_NorSpr10D_BooGuyOperatingPulley_StompRt
	dl YI_NorSpr10E_CrateWith6Stars_StompRt
	dl YI_NorSpr10F_BooManBluff_StompRt
	dl YI_NorSpr110_Flower_StompRt
	dl YI_NorSpr111_GeorgetteJelly_StompRt
	dl YI_NorSpr112_GeorgetteJellyGoo_StompRt
	dl YI_NorSpr113_Snifit_StompRt
	dl YI_NorSpr114_SnifitBullet_StompRt
	dl YI_NorSpr115_Coin_StompRt
	dl YI_NorSpr116_BuoyantRoundPlatform_StompRt
	dl YI_NorSpr117_DonutLift_StompRt
	dl YI_NorSpr118_LargeDonutLift_StompRt
	dl YI_NorSpr119_Spooky_StompRt
	dl YI_NorSpr11A_GreenGlove_StompRt
	dl YI_NorSpr11B_Lakitu_StompRt
	dl YI_NorSpr11C_LakituCloud_StompRt
	dl YI_NorSpr11D_SpinyEgg_StompRt
	dl YI_NorSpr11E_BrownArrowWheel_StompRt
	dl YI_NorSpr11F_BlueArrowWheel_StompRt
	dl YI_NorSpr120_DoubledSidedArrowLift_StompRt
	dl YI_NorSpr121_NumberPlatformExplosion_StompRt
	dl YI_NorSpr122_BucketWithBandit_StompRt
	dl YI_NorSpr123_BucketWithCoins_StompRt
	dl YI_NorSpr124_Stretch_StompRt
	dl YI_NorSpr125_AttackingAndEndingKamek_StompRt
	dl YI_NorSpr126_SpikedLogOnPulley_StompRt
	dl YI_NorSpr127_PulleyOfSpikedLog_StompRt
	dl YI_NorSpr128_GroundRippleInBabyBowerRoom_StompRt
	dl YI_NorSpr129_Fuzzy_StompRt
	dl YI_NorSpr12A_ShyGuyBanditTrap_StompRt
	dl YI_NorSpr12B_FatGuy_StompRt
	dl YI_NorSpr12C_FlyOrWhirlyGuy_StompRt
	dl YI_NorSpr12D_PrologueCutsceneYoshi_StompRt
	dl YI_NorSpr12E_LargePopEffect_StompRt
	dl YI_NorSpr12F_HorizontalLavaDrop_StompRt
	dl YI_NorSpr130_VerticalLavaDrop_StompRt
	dl YI_NorSpr131_LockedDoor_StompRt
	dl YI_NorSpr132_LemonDrop_StompRt
	dl YI_NorSpr133_LanternGhost_StompRt
	dl YI_NorSpr134_BabyBowser_StompRt
	dl YI_NorSpr135_CirclingRaven_StompRt
	dl YI_NorSpr136_CirclingRaven_StompRt
	dl YI_NorSpr137_3x6FallingStone_StompRt
	dl YI_NorSpr138_3x3FallingStone_StompRt
	dl YI_NorSpr139_3x9FallingStone_StompRt
	dl YI_NorSpr13A_6x3FallingStone_StompRt
	dl YI_NorSpr13B_StomachAcid_StompRt
	dl YI_NorSpr13C_DownFlippers_StompRt
	dl YI_NorSpr13D_DanglingFang_StompRt
	dl YI_NorSpr13E_FlyingFang_StompRt
	dl YI_NorSpr13F_SwimmingFlopsyFish_StompRt
	dl YI_NorSpr140_SwimmingAndJumpingFlopsyFish_StompRt
	dl YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_StompRt
	dl YI_NorSpr142_3JumpFlopsyFish_StompRt
	dl YI_NorSpr143_SprayFish_StompRt
	dl YI_NorSpr144_RightOrLeftFlippers_StompRt
	dl YI_NorSpr145_BlueSluggy_StompRt
	dl YI_NorSpr146_PinkSluggy_StompRt
	dl YI_NorSpr147_HorizontalEntranceToLeft_StompRt
	dl YI_NorSpr148_LargeSpringBall_StompRt
	dl YI_NorSpr149_UpArrowCloud_StompRt
	dl YI_NorSpr14A_UpRightArrowCloud_StompRt
	dl YI_NorSpr14B_RightArrowCloud_StompRt
	dl YI_NorSpr14C_DownRightArrowCloud_StompRt
	dl YI_NorSpr14D_DownArrowCloud_StompRt
	dl YI_NorSpr14E_DownLeftArrowCloud_StompRt
	dl YI_NorSpr14F_LeftArrowCloud_StompRt
	dl YI_NorSpr150_UpLeftArrowCloud_StompRt
	dl YI_NorSpr151_RotatingArrowCloud_StompRt
	dl YI_NorSpr152_Flutter_StompRt
	dl YI_NorSpr153_GoonieWithShyGuy_StompRt
	dl YI_NorSpr154_SharkChomp_StompRt
	dl YI_NorSpr155_FatGoonie_StompRt
	dl YI_NorSpr156_CactusJack_StompRt
	dl YI_NorSpr157_WallLakitu_StompRt
	dl YI_NorSpr158_BowlingGoonie_StompRt
	dl YI_NorSpr159_WalkingGrunt_StompRt
	dl YI_NorSpr15A_RunningGrunt_StompRt
	dl YI_NorSpr15B_DancingSpearGuy_StompRt
	dl YI_NorSpr15C_GreenRotatingPlatformSwitch_StompRt
	dl YI_NorSpr15D_RedRotatingPlatformSwitch_StompRt
	dl YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_StompRt
	dl YI_NorSpr15F_GreenSpikedPlatform_StompRt
	dl YI_NorSpr160_RedSpikedPlatform_StompRt
	dl YI_NorSpr161_RewardItemForDefeatingRoomEnemies_StompRt
	dl YI_NorSpr162_DoubleSpikePlatformWithSwitch_StompRt
	dl YI_NorSpr163_BouncingNeedlenose_StompRt
	dl YI_NorSpr164_NipperPlant_StompRt
	dl YI_NorSpr165_NipperSpore_StompRt
	dl YI_NorSpr166_ThunderLakitu_StompRt
	dl YI_NorSpr167_GreenKoopaShell_StompRt
	dl YI_NorSpr168_RedKoopaShell_StompRt
	dl YI_NorSpr169_GreenNakedKoopa_StompRt
	dl YI_NorSpr16A_RedNakedKoopa_StompRt
	dl YI_NorSpr16B_GreenKoopa_StompRt
	dl YI_NorSpr16C_RedKoopa_StompRt
	dl YI_NorSpr16D_GreenParakoopa_StompRt
	dl YI_NorSpr16E_RedHorizontalParakoopa_StompRt
	dl YI_NorSpr16F_RedVerticalParakoopa_StompRt
	dl YI_NorSpr170_AquaLakitu_StompRt
	dl YI_NorSpr171_NavalPiranha_StompRt
	dl YI_NorSpr172_NavalPiranhaBuds_StompRt
	dl YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_StompRt
	dl YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_StompRt
	dl YI_NorSpr175_BaronVonZeppelinCarryingBomb_StompRt
	dl YI_NorSpr176_BaronVonZeppelinCarryingBandit_StompRt
	dl YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_StompRt
	dl YI_NorSpr178_BaronVonZeppelinCarrying1up_StompRt
	dl YI_NorSpr179_BaronVonZeppelinCarryingKey_StompRt
	dl YI_NorSpr17A_BaronVonZeppelinCarryingCoins_StompRt
	dl YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_StompRt
	dl YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_StompRt
	dl YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_StompRt
	dl YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_StompRt
	dl YI_NorSpr17F_BaronVonZeppelin_StompRt
	dl YI_NorSpr180_SpinningLog_StompRt
	dl YI_NorSpr181_CrazeeDayzee_StompRt
	dl YI_NorSpr182_Dragonfly_StompRt
	dl YI_NorSpr183_Butterfly_StompRt
	dl YI_NorSpr184_Bumpty_StompRt
	dl YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_StompRt
	dl YI_NorSpr186_MovingLineGuidedGreenPlatformRight_StompRt
	dl YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_StompRt
	dl YI_NorSpr188_MovingLineGuidedYellowPlatformRight_StompRt
	dl YI_NorSpr189_LineGuidedGreenPlatformLeft_StompRt
	dl YI_NorSpr18A_LineGuidedGreenPlatformRight_StompRt
	dl YI_NorSpr18B_LineGuidedYellowPlatformLeft_StompRt
	dl YI_NorSpr18C_LineGuidedYellowPlatformRight_StompRt
	dl YI_NorSpr18D_LineGuidedRedPlatformLeft_StompRt
	dl YI_NorSpr18E_LineGuidedGreenPlatformRight_StompRt
	dl YI_NorSpr18F_SpiralPlatform_StompRt
	dl YI_NorSpr190_FallingIcicle_StompRt
	dl YI_NorSpr191_Bird_StompRt
	dl YI_NorSpr192_PetalGuy_StompRt
	dl YI_NorSpr193_SnakeCagedGhost_StompRt
	dl YI_NorSpr194_Blargg_StompRt
	dl YI_NorSpr195_SmallUnstableSnowPlatform_StompRt
	dl YI_NorSpr196_UnstableSnowPlatform_StompRt
	dl YI_NorSpr197_ArrowSign_StompRt
	dl YI_NorSpr198_DiagonalArrowSign_StompRt
	dl YI_NorSpr199_DizzyDandy_StompRt
	dl YI_NorSpr19A_BooGuy_StompRt
	dl YI_NorSpr19B_TacklingBumpty_StompRt
	dl YI_NorSpr19C_FlyingBumpty_StompRt
	dl YI_NorSpr19D_SkeletonGoonie_StompRt
	dl YI_NorSpr19E_WinglessSkeletonGoonie_StompRt
	dl YI_NorSpr19F_SkeletonGoonieCarryingBomb_StompRt
	dl YI_NorSpr1A0_DoubleFirebar_StompRt
	dl YI_NorSpr1A1_Firebar_StompRt
	dl YI_NorSpr1A2_HealthStar_StompRt
	dl YI_NorSpr1A3_LittleSkullMouser_StompRt
	dl YI_NorSpr1A4_KeyholeCork_StompRt
	dl YI_NorSpr1A5_RunAwayMonkey_StompRt
	dl YI_NorSpr1A6_MonkeyWithWatermelon_StompRt
	dl YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_StompRt
	dl YI_NorSpr1A8_TheifMonkey_StompRt
	dl YI_NorSpr1A9_HangingMonkeySpittingSeeds_StompRt
	dl YI_NorSpr1AA_HotLips_StompRt
	dl YI_NorSpr1AB_BooBalloon_StompRt
	dl YI_NorSpr1AC_SmallFrog_StompRt
	dl YI_NorSpr1AD_MagicShootingKamek_StompRt
	dl YI_NorSpr1AE_MagicShot_StompRt
	dl YI_NorSpr1AF_FloatingCoin_StompRt
	dl YI_NorSpr1B0_DeflatingBalloon_StompRt
	dl YI_NorSpr1B1_CoinCannon_StompRt
	dl YI_NorSpr1B2_MinigameCoin_StompRt
	dl YI_NorSpr1B3_GatherCoinsBandit_StompRt
	dl YI_NorSpr1B4_MinigameCheckeredPlatform_StompRt
	dl YI_NorSpr1B5_PoppingBalloonsBandit_StompRt
	dl YI_NorSpr1B6_MinigameBalloon_StompRt
	dl YI_NorSpr1B7_SeedSpittingMinigameBandit_StompRt
	dl YI_NorSpr1B8_WatermelonPot_StompRt
	dl YI_NorSpr1B9_P2SeedSpittingMinigameBandit_StompRt

;-------------------------------------------------------------------------
; DATA_sprite_ridings: pointer table for "sprite is being carried on Yoshi's back".
; Same length/indexing as DATA_sprite_inits.  Sprite that can be carried set a
; meaningful routine here; most are RTL stubs.
; Raidenthequick: DATA_sprite_ridings
;-------------------------------------------------------------------------
DATA_038F8A:
DATA_sprite_ridings:
	dl YI_NorSpr000_LavaLog_RideYoshiRt
	dl YI_NorSpr001_ClosedDoor_RideYoshiRt
	dl YI_NorSpr002_NavalPiranhaVines_RideYoshiRt
	dl YI_NorSpr003_CrateWithKey_RideYoshiRt
	dl YI_NorSpr004_HitSuperBabyMarioBlock_RideYoshiRt
	dl YI_NorSpr005_IcyWatermelon_RideYoshiRt
	dl YI_NorSpr006_WatermelonFreeze_RideYoshiRt
	dl YI_NorSpr007_Watermelon_RideYoshiRt
	dl YI_NorSpr008_FallingRubble_RideYoshiRt
	dl YI_NorSpr009_FireWatermelon_RideYoshiRt
	dl YI_NorSpr00A_Kaboomba_RideYoshiRt
	dl YI_NorSpr00B_Cannonball_RideYoshiRt
	dl YI_NorSpr00C_RaphaelTheRaven_RideYoshiRt
	dl YI_NorSpr00D_GoalRing_RideYoshiRt
	dl YI_NorSpr00E_GOALLetters_RideYoshiRt
	dl YI_NorSpr00F_BonusChallengeSign_RideYoshiRt
	dl YI_NorSpr010_RoundedCagedGhost_RideYoshiRt
	dl YI_NorSpr011_ItemCard_RideYoshiRt
	dl YI_NorSpr012_BossDoor_RideYoshiRt
	dl YI_NorSpr013_BossExplosion_RideYoshiRt
	dl YI_NorSpr014_KeyFromBoss_RideYoshiRt
	dl YI_NorSpr015_SubmarineTorpedo_RideYoshiRt
	dl YI_NorSpr016_BiggerBoo_RideYoshiRt
	dl YI_NorSpr017_FrogPirate_RideYoshiRt
	dl YI_NorSpr018_WatermelonFlame_RideYoshiRt
	dl YI_NorSpr019_Bubble_RideYoshiRt
	dl YI_NorSpr01A_SkiLift_RideYoshiRt
	dl YI_NorSpr01B_VerticalLavaLog_RideYoshiRt
	dl YI_NorSpr01C_DrFreezegood_RideYoshiRt
	dl YI_NorSpr01D_DrFreezegoodOnSkiLift_RideYoshiRt
	dl YI_NorSpr01E_Shyguy_RideYoshiRt
	dl YI_NorSpr01F_RotatingDoors_RideYoshiRt
	dl YI_NorSpr020_Bandit_RideYoshiRt
	dl YI_NorSpr021_Bucket_RideYoshiRt
	dl YI_NorSpr022_FlashingEgg_RideYoshiRt
	dl YI_NorSpr023_RedEgg_RideYoshiRt
	dl YI_NorSpr024_YellowEgg_RideYoshiRt
	dl YI_NorSpr025_GreenEgg_RideYoshiRt
	dl YI_NorSpr026_BowserFightGiantEgg_RideYoshiRt
	dl YI_NorSpr027_Key_RideYoshiRt
	dl YI_NorSpr028_HuffinPuffin_RideYoshiRt
	dl YI_NorSpr029_GiantEgg_RideYoshiRt
	dl YI_NorSpr02A_RedGiantEgg_RideYoshiRt
	dl YI_NorSpr02B_GreenGiantEgg_RideYoshiRt
	dl YI_NorSpr02C_LungeFish_RideYoshiRt
	dl YI_NorSpr02D_SalvoTheSlime_RideYoshiRt
	dl YI_NorSpr02E_EyesOfSalvoTheSlime_RideYoshiRt
	dl YI_NorSpr02F_LittleMouserHole_RideYoshiRt
	dl YI_NorSpr030_LittleMouser_RideYoshiRt
	dl YI_NorSpr031_PottedSpikedFunGuy_RideYoshiRt
	dl YI_NorSpr032_PeekingLittleMouser_RideYoshiRt
	dl YI_NorSpr033_LittleMouserExitingNest_RideYoshiRt
	dl YI_NorSpr034_RogersPot_RideYoshiRt
	dl YI_NorSpr035_RogerThePottedGhost_RideYoshiRt
	dl YI_NorSpr036_FallingWall_RideYoshiRt
	dl YI_NorSpr037_GrimLeecher_RideYoshiRt
	dl YI_NorSpr038_PottedGhostFlame_RideYoshiRt
	dl YI_NorSpr039_HorizontalRotatingPlank_RideYoshiRt
	dl YI_NorSpr03A_3MiniRavens_RideYoshiRt
	dl YI_NorSpr03B_MiniRaven_RideYoshiRt
	dl YI_NorSpr03C_TapTapTheRedNose_RideYoshiRt
	dl YI_NorSpr03D_LargeSeesaw_RideYoshiRt
	dl YI_NorSpr03E_ThinPlatform_RideYoshiRt
	dl YI_NorSpr03F_SlimeBlock_RideYoshiRt
	dl YI_NorSpr040_BabyLuigi_RideYoshiRt
	dl YI_NorSpr041_Stork_RideYoshiRt
	dl YI_NorSpr042_VerticalPipeEntrance_RideYoshiRt
	dl YI_NorSpr043_RedGiantShyguy_RideYoshiRt
	dl YI_NorSpr044_GreenGiantShyguy_RideYoshiRt
	dl YI_NorSpr045_PrinceFroggy_RideYoshiRt
	dl YI_NorSpr046_BurtTheBashful_RideYoshiRt
	dl YI_NorSpr047_ShyguyPushingRoger_RideYoshiRt
	dl YI_NorSpr048_CutsceneKamek_RideYoshiRt
	dl YI_NorSpr049_ThunderLakituFireBlast1_RideYoshiRt
	dl YI_NorSpr04A_ThunderLakituFireBlast2_RideYoshiRt
	dl YI_NorSpr04B_ThunderLakituFireBlast3_RideYoshiRt
	dl YI_NorSpr04C_UpsidedownBlowHard_RideYoshiRt
	dl YI_NorSpr04D_UnusedSpriteIndex_RideYoshiRt
	dl YI_NorSpr04E_LockedDoor_RideYoshiRt
	dl YI_NorSpr04F_MiddleRing_RideYoshiRt
	dl YI_NorSpr050_GreyRotatingWoodenBoard_RideYoshiRt
	dl YI_NorSpr051_LargeWheel_RideYoshiRt
	dl YI_NorSpr052_BalloonPlatform_RideYoshiRt
	dl YI_NorSpr053_KamekSayingOhMy_RideYoshiRt
	dl YI_NorSpr054_UpsideDownPiranhaPlant_RideYoshiRt
	dl YI_NorSpr055_4GreenRotatingPlatforms_RideYoshiRt
	dl YI_NorSpr056_4PinkRotatingPlatforms_RideYoshiRt
	dl YI_NorSpr057_SewerGhostWithPlatform_RideYoshiRt
	dl YI_NorSpr058_GreenToady_RideYoshiRt
	dl YI_NorSpr059_StationarySuperStar_RideYoshiRt
	dl YI_NorSpr05A_RaphaelSparkAttack_RideYoshiRt
	dl YI_NorSpr05B_RedCoinBandit_RideYoshiRt
	dl YI_NorSpr05C_PinkToady_RideYoshiRt
	dl YI_NorSpr05D_GlitchedSprite_RideYoshiRt
	dl YI_NorSpr05E_BrownWoodenBoard_RideYoshiRt
	dl YI_NorSpr05F_AutoRotateBrownWoodenBoard_RideYoshiRt
	dl YI_NorSpr060_Bomb_RideYoshiRt
	dl YI_NorSpr061_BabyMario_RideYoshiRt
	dl YI_NorSpr062_Goomba_RideYoshiRt
	dl YI_NorSpr063_MuddyBuddy_RideYoshiRt
	dl YI_NorSpr064_4AutoRotatingPinkPlatforms_RideYoshiRt
	dl YI_NorSpr065_RedCoin_RideYoshiRt
	dl YI_NorSpr066_PiranhaPlant_RideYoshiRt
	dl YI_NorSpr067_RockRevealedHiddenWingedCloud_RideYoshiRt
	dl YI_NorSpr068_FlashingEggBlock_RideYoshiRt
	dl YI_NorSpr069_RedEggBlock_RideYoshiRt
	dl YI_NorSpr06A_YellowEggBlock_RideYoshiRt
	dl YI_NorSpr06B_GreenEggBlock_RideYoshiRt
	dl YI_NorSpr06C_LargeSpringBall_RideYoshiRt
	dl YI_NorSpr06D_ClockwiseHootieTheBlueFish_RideYoshiRt
	dl YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_RideYoshiRt
	dl YI_NorSpr06F_SpringBall_RideYoshiRt
	dl YI_NorSpr070_Clawdaddy_RideYoshiRt
	dl YI_NorSpr071_BigBoo_RideYoshiRt
	dl YI_NorSpr072_TrainBandit_RideYoshiRt
	dl YI_NorSpr073_BalloonPump_RideYoshiRt
	dl YI_NorSpr074_Spike_RideYoshiRt
	dl YI_NorSpr075_SpikeBall_RideYoshiRt
	dl YI_NorSpr076_ClockwisePiroDangle_RideYoshiRt
	dl YI_NorSpr077_CounterclockwisePiroDangle_RideYoshiRt
	dl YI_NorSpr078_RedBulletBillShooter_RideYoshiRt
	dl YI_NorSpr079_YellowBulletBillShooter_RideYoshiRt
	dl YI_NorSpr07A_GreenBulletBillShooter_RideYoshiRt
	dl YI_NorSpr07B_RedBulletBill_RideYoshiRt
	dl YI_NorSpr07C_YellowBulletBill_RideYoshiRt
	dl YI_NorSpr07D_GreenBulletBill_RideYoshiRt
	dl YI_NorSpr07E_DentOfSquishyPlatform_RideYoshiRt
	dl YI_NorSpr07F_LogSeesawPlatform_RideYoshiRt
	dl YI_NorSpr080_StraightLavaBubble_RideYoshiRt
	dl YI_NorSpr081_FollowingLavaBubble_RideYoshiRt
	dl YI_NorSpr082_ChainChomp_RideYoshiRt
	dl YI_NorSpr083_BowserFightCloud_RideYoshiRt
	dl YI_NorSpr084_TeleportSprite_RideYoshiRt
	dl YI_NorSpr085_HarryHedgehog_RideYoshiRt
	dl YI_NorSpr086_GlitchedSprite_RideYoshiRt
	dl YI_NorSpr087_MockUpLaidEgg_RideYoshiRt
	dl YI_NorSpr088_SuperStar_RideYoshiRt
	dl YI_NorSpr089_HorizontalMovingRedPlatform_RideYoshiRt
	dl YI_NorSpr08A_VerticalMovingPinkPlatform_RideYoshiRt
	dl YI_NorSpr08B_MockUp_RideYoshiRt
	dl YI_NorSpr08C_YoshiAtGoal_RideYoshiRt
	dl YI_NorSpr08D_Flyguy_RideYoshiRt
	dl YI_NorSpr08E_BowserRoomKamek_RideYoshiRt
	dl YI_NorSpr08F_MonkeySwing_RideYoshiRt
	dl YI_NorSpr090_DanglingGhost_RideYoshiRt
	dl YI_NorSpr091_4RedToadies_RideYoshiRt
	dl YI_NorSpr092_MelonBug_RideYoshiRt
	dl YI_NorSpr093_Door_RideYoshiRt
	dl YI_NorSpr094_ExpandingBlock_RideYoshiRt
	dl YI_NorSpr095_BlueCheckeredBlock_RideYoshiRt
	dl YI_NorSpr096_RedCheckeredBlock_RideYoshiRt
	dl YI_NorSpr097_POWBlock_RideYoshiRt
	dl YI_NorSpr098_EndTransformationBlock_RideYoshiRt
	dl YI_NorSpr099_SpinyEgg_RideYoshiRt
	dl YI_NorSpr09A_SwingingGreenPlatform_RideYoshiRt
	dl YI_NorSpr09B_MaceGuy_RideYoshiRt
	dl YI_NorSpr09C_Mace_RideYoshiRt
	dl YI_NorSpr09D_RedSwitch_RideYoshiRt
	dl YI_NorSpr09E_ChompRock_RideYoshiRt
	dl YI_NorSpr09F_PtooiePiranhaPlant_RideYoshiRt
	dl YI_NorSpr0A0_Tulip_RideYoshiRt
	dl YI_NorSpr0A1_SmallPot_RideYoshiRt
	dl YI_NorSpr0A2_ThunderLakituFireball_RideYoshiRt
	dl YI_NorSpr0A3_LeftHidingBandit_RideYoshiRt
	dl YI_NorSpr0A4_RightHidingBandit_RideYoshiRt
	dl YI_NorSpr0A5_NepEnut_RideYoshiRt
	dl YI_NorSpr0A6_IncomingChomp_RideYoshiRt
	dl YI_NorSpr0A7_GroupOfIncomingChomps_RideYoshiRt
	dl YI_NorSpr0A8_FallingIncomingChomp_RideYoshiRt
	dl YI_NorSpr0A9_IncomingChompShadow_RideYoshiRt
	dl YI_NorSpr0AA_BackgroundShyguy_RideYoshiRt
	dl YI_NorSpr0AB_FullEggSpawner_RideYoshiRt
	dl YI_NorSpr0AC_FallingRockArrowAndShadow_RideYoshiRt
	dl YI_NorSpr0AD_MessageBox_RideYoshiRt
	dl YI_NorSpr0AE_HookbillTheKoopa_RideYoshiRt
	dl YI_NorSpr0AF_CarMorphBubble_RideYoshiRt
	dl YI_NorSpr0B0_MoleMorphBubble_RideYoshiRt
	dl YI_NorSpr0B1_HelicopterMorphBubble_RideYoshiRt
	dl YI_NorSpr0B2_TrainMorphBubble_RideYoshiRt
	dl YI_NorSpr0B3_FuzzyFart_RideYoshiRt
	dl YI_NorSpr0B4_SubmarineMorphBubble_RideYoshiRt
	dl YI_NorSpr0B5_HiddenWingedCloud_RideYoshiRt
	dl YI_NorSpr0B6_WingedCloudWith8Coins_RideYoshiRt
	dl YI_NorSpr0B7_WingedCloudWithBubbled1up_RideYoshiRt
	dl YI_NorSpr0B8_WingedCloudWithFlower_RideYoshiRt
	dl YI_NorSpr0B9_WingedCloudWithPOW_RideYoshiRt
	dl YI_NorSpr0BA_WingedCloudWithStairs_RideYoshiRt
	dl YI_NorSpr0BB_WingedCloudWithPlatform_RideYoshiRt
	dl YI_NorSpr0BC_WingedCloudWithBandit_RideYoshiRt
	dl YI_NorSpr0BD_WingedCloudWithCoin_RideYoshiRt
	dl YI_NorSpr0BE_WingedCloudWith1up_RideYoshiRt
	dl YI_NorSpr0BF_WingedCloudWithKey_RideYoshiRt
	dl YI_NorSpr0C0_WingedCloudWith3Stars_RideYoshiRt
	dl YI_NorSpr0C1_WingedCloudWith5Stars_RideYoshiRt
	dl YI_NorSpr0C2_WingedCloudWithDoor_RideYoshiRt
	dl YI_NorSpr0C3_WingedCloudWithLowerGround_RideYoshiRt
	dl YI_NorSpr0C4_WingedCloudWithWatermelon_RideYoshiRt
	dl YI_NorSpr0C5_WingedCloudWithFireWatermelon_RideYoshiRt
	dl YI_NorSpr0C6_WingedCloudWithIcyWatermelon_RideYoshiRt
	dl YI_NorSpr0C7_WingedCloudWith3LeafSunflower_RideYoshiRt
	dl YI_NorSpr0C8_WingedCloudWith6LeafSunflower_RideYoshiRt
	dl YI_NorSpr0C9_WingedCloudWithCrashGameFeature_RideYoshiRt
	dl YI_NorSpr0CA_BigBossDoor_RideYoshiRt
	dl YI_NorSpr0CB_WingedCloudWithCoinOrStar_RideYoshiRt
	dl YI_NorSpr0CC_WingedCloudWithRedSwitch_RideYoshiRt
	dl YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_RideYoshiRt
	dl YI_NorSpr0CE_BowserFire_RideYoshiRt
	dl YI_NorSpr0CF_BowserRocks_RideYoshiRt
	dl YI_NorSpr0D0_HorizontalEntranceToRight_RideYoshiRt
	dl YI_NorSpr0D1_SecretPipeEntrance_RideYoshiRt
	dl YI_NorSpr0D2_MarchingMilde_RideYoshiRt
	dl YI_NorSpr0D3_LargeMilde_RideYoshiRt
	dl YI_NorSpr0D4_MediumMilde_RideYoshiRt
	dl YI_NorSpr0D5_BackgroundForHookbillFight_RideYoshiRt
	dl YI_NorSpr0D6_FortGhostWithPlatform_RideYoshiRt
	dl YI_NorSpr0D7_SluggyTheUnshaven_RideYoshiRt
	dl YI_NorSpr0D8_ChompWarningSign_RideYoshiRt
	dl YI_NorSpr0D9_FishinLakitu_RideYoshiRt
	dl YI_NorSpr0DA_FlowerPot_RideYoshiRt
	dl YI_NorSpr0DB_SoftBlock_RideYoshiRt
	dl YI_NorSpr0DC_Snowball_RideYoshiRt
	dl YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_RideYoshiRt
	dl YI_NorSpr0DE_FallingRockPlatform_RideYoshiRt
	dl YI_NorSpr0DF_PiscatoryPete_RideYoshiRt
	dl YI_NorSpr0E0_PreyingMantas_RideYoshiRt
	dl YI_NorSpr0E1_LochNestor_RideYoshiRt
	dl YI_NorSpr0E2_BooBlah_RideYoshiRt
	dl YI_NorSpr0E3_BooBlahWithPiroDangle_RideYoshiRt
	dl YI_NorSpr0E4_HeadingCactus_RideYoshiRt
	dl YI_NorSpr0E5_GreenNeedlenose_RideYoshiRt
	dl YI_NorSpr0E6_Gusty_RideYoshiRt
	dl YI_NorSpr0E7_Burt_RideYoshiRt
	dl YI_NorSpr0E8_Goonie_RideYoshiRt
	dl YI_NorSpr0E9_3WinglessGoonies_RideYoshiRt
	dl YI_NorSpr0EA_VerticalCloudDrop_RideYoshiRt
	dl YI_NorSpr0EB_HorizontalCloudDrop_RideYoshiRt
	dl YI_NorSpr0EC_JumpingFlamerGuy_RideYoshiRt
	dl YI_NorSpr0ED_RunningFlamerGuy_RideYoshiRt
	dl YI_NorSpr0EE_EggoDil_RideYoshiRt
	dl YI_NorSpr0EF_EggoDilFace_RideYoshiRt
	dl YI_NorSpr0F0_EggoDilPetal_RideYoshiRt
	dl YI_NorSpr0F1_EggPlantShootingBubbles_RideYoshiRt
	dl YI_NorSpr0F2_ShyguyOnStilts_RideYoshiRt
	dl YI_NorSpr0F3_WoozyGuy_RideYoshiRt
	dl YI_NorSpr0F4_EggPlant_RideYoshiRt
	dl YI_NorSpr0F5_Slugger_RideYoshiRt
	dl YI_NorSpr0F6_MotherHuffinPuffin_RideYoshiRt
	dl YI_NorSpr0F7_BarneyBubble_RideYoshiRt
	dl YI_NorSpr0F8_BlowHard_RideYoshiRt
	dl YI_NorSpr0F9_YellowNeedlenose_RideYoshiRt
	dl YI_NorSpr0FA_Flower_RideYoshiRt
	dl YI_NorSpr0FB_LongSpearGuy_RideYoshiRt
	dl YI_NorSpr0FC_ShortSpearGuy_RideYoshiRt
	dl YI_NorSpr0FD_ZeusGuy_RideYoshiRt
	dl YI_NorSpr0FE_ZeusGuyBlast_RideYoshiRt
	dl YI_NorSpr0FF_Poochy_RideYoshiRt
	dl YI_NorSpr100_Bubbled1up_RideYoshiRt
	dl YI_NorSpr101_RotatingMace_RideYoshiRt
	dl YI_NorSpr102_DoubleRotatingMace_RideYoshiRt
	dl YI_NorSpr103_BooGuysMovingMace_RideYoshiRt
	dl YI_NorSpr104_JeanDeFillet_RideYoshiRt
	dl YI_NorSpr105_BooGuysCarryingBombToLeft_RideYoshiRt
	dl YI_NorSpr106_BooGuysCarryingBombToRight_RideYoshiRt
	dl YI_NorSpr107_WatermelonSeed_RideYoshiRt
	dl YI_NorSpr108_Milde_RideYoshiRt
	dl YI_NorSpr109_BronzeTapTap_RideYoshiRt
	dl YI_NorSpr10A_SilverTapTap_RideYoshiRt
	dl YI_NorSpr10B_HoppingSilverTapTap_RideYoshiRt
	dl YI_NorSpr10C_ChainedSpikeBall_RideYoshiRt
	dl YI_NorSpr10D_BooGuyOperatingPulley_RideYoshiRt
	dl YI_NorSpr10E_CrateWith6Stars_RideYoshiRt
	dl YI_NorSpr10F_BooManBluff_RideYoshiRt
	dl YI_NorSpr110_Flower_RideYoshiRt
	dl YI_NorSpr111_GeorgetteJelly_RideYoshiRt
	dl YI_NorSpr112_GeorgetteJellyGoo_RideYoshiRt
	dl YI_NorSpr113_Snifit_RideYoshiRt
	dl YI_NorSpr114_SnifitBullet_RideYoshiRt
	dl YI_NorSpr115_Coin_RideYoshiRt
	dl YI_NorSpr116_BuoyantRoundPlatform_RideYoshiRt
	dl YI_NorSpr117_DonutLift_RideYoshiRt
	dl YI_NorSpr118_LargeDonutLift_RideYoshiRt
	dl YI_NorSpr119_Spooky_RideYoshiRt
	dl YI_NorSpr11A_GreenGlove_RideYoshiRt
	dl YI_NorSpr11B_Lakitu_RideYoshiRt
	dl YI_NorSpr11C_LakituCloud_RideYoshiRt
	dl YI_NorSpr11D_SpinyEgg_RideYoshiRt
	dl YI_NorSpr11E_BrownArrowWheel_RideYoshiRt
	dl YI_NorSpr11F_BlueArrowWheel_RideYoshiRt
	dl YI_NorSpr120_DoubledSidedArrowLift_RideYoshiRt
	dl YI_NorSpr121_NumberPlatformExplosion_RideYoshiRt
	dl YI_NorSpr122_BucketWithBandit_RideYoshiRt
	dl YI_NorSpr123_BucketWithCoins_RideYoshiRt
	dl YI_NorSpr124_Stretch_RideYoshiRt
	dl YI_NorSpr125_AttackingAndEndingKamek_RideYoshiRt
	dl YI_NorSpr126_SpikedLogOnPulley_RideYoshiRt
	dl YI_NorSpr127_PulleyOfSpikedLog_RideYoshiRt
	dl YI_NorSpr128_GroundRippleInBabyBowerRoom_RideYoshiRt
	dl YI_NorSpr129_Fuzzy_RideYoshiRt
	dl YI_NorSpr12A_ShyGuyBanditTrap_RideYoshiRt
	dl YI_NorSpr12B_FatGuy_RideYoshiRt
	dl YI_NorSpr12C_FlyOrWhirlyGuy_RideYoshiRt
	dl YI_NorSpr12D_PrologueCutsceneYoshi_RideYoshiRt
	dl YI_NorSpr12E_LargePopEffect_RideYoshiRt
	dl YI_NorSpr12F_HorizontalLavaDrop_RideYoshiRt
	dl YI_NorSpr130_VerticalLavaDrop_RideYoshiRt
	dl YI_NorSpr131_LockedDoor_RideYoshiRt
	dl YI_NorSpr132_LemonDrop_RideYoshiRt
	dl YI_NorSpr133_LanternGhost_RideYoshiRt
	dl YI_NorSpr134_BabyBowser_RideYoshiRt
	dl YI_NorSpr135_CirclingRaven_RideYoshiRt
	dl YI_NorSpr136_CirclingRaven_RideYoshiRt
	dl YI_NorSpr137_3x6FallingStone_RideYoshiRt
	dl YI_NorSpr138_3x3FallingStone_RideYoshiRt
	dl YI_NorSpr139_3x9FallingStone_RideYoshiRt
	dl YI_NorSpr13A_6x3FallingStone_RideYoshiRt
	dl YI_NorSpr13B_StomachAcid_RideYoshiRt
	dl YI_NorSpr13C_DownFlippers_RideYoshiRt
	dl YI_NorSpr13D_DanglingFang_RideYoshiRt
	dl YI_NorSpr13E_FlyingFang_RideYoshiRt
	dl YI_NorSpr13F_SwimmingFlopsyFish_RideYoshiRt
	dl YI_NorSpr140_SwimmingAndJumpingFlopsyFish_RideYoshiRt
	dl YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_RideYoshiRt
	dl YI_NorSpr142_3JumpFlopsyFish_RideYoshiRt
	dl YI_NorSpr143_SprayFish_RideYoshiRt
	dl YI_NorSpr144_RightOrLeftFlippers_RideYoshiRt
	dl YI_NorSpr145_BlueSluggy_RideYoshiRt
	dl YI_NorSpr146_PinkSluggy_RideYoshiRt
	dl YI_NorSpr147_HorizontalEntranceToLeft_RideYoshiRt
	dl YI_NorSpr148_LargeSpringBall_RideYoshiRt
	dl YI_NorSpr149_UpArrowCloud_RideYoshiRt
	dl YI_NorSpr14A_UpRightArrowCloud_RideYoshiRt
	dl YI_NorSpr14B_RightArrowCloud_RideYoshiRt
	dl YI_NorSpr14C_DownRightArrowCloud_RideYoshiRt
	dl YI_NorSpr14D_DownArrowCloud_RideYoshiRt
	dl YI_NorSpr14E_DownLeftArrowCloud_RideYoshiRt
	dl YI_NorSpr14F_LeftArrowCloud_RideYoshiRt
	dl YI_NorSpr150_UpLeftArrowCloud_RideYoshiRt
	dl YI_NorSpr151_RotatingArrowCloud_RideYoshiRt
	dl YI_NorSpr152_Flutter_RideYoshiRt
	dl YI_NorSpr153_GoonieWithShyGuy_RideYoshiRt
	dl YI_NorSpr154_SharkChomp_RideYoshiRt
	dl YI_NorSpr155_FatGoonie_RideYoshiRt
	dl YI_NorSpr156_CactusJack_RideYoshiRt
	dl YI_NorSpr157_WallLakitu_RideYoshiRt
	dl YI_NorSpr158_BowlingGoonie_RideYoshiRt
	dl YI_NorSpr159_WalkingGrunt_RideYoshiRt
	dl YI_NorSpr15A_RunningGrunt_RideYoshiRt
	dl YI_NorSpr15B_DancingSpearGuy_RideYoshiRt
	dl YI_NorSpr15C_GreenRotatingPlatformSwitch_RideYoshiRt
	dl YI_NorSpr15D_RedRotatingPlatformSwitch_RideYoshiRt
	dl YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_RideYoshiRt
	dl YI_NorSpr15F_GreenSpikedPlatform_RideYoshiRt
	dl YI_NorSpr160_RedSpikedPlatform_RideYoshiRt
	dl YI_NorSpr161_RewardItemForDefeatingRoomEnemies_RideYoshiRt
	dl YI_NorSpr162_DoubleSpikePlatformWithSwitch_RideYoshiRt
	dl YI_NorSpr163_BouncingNeedlenose_RideYoshiRt
	dl YI_NorSpr164_NipperPlant_RideYoshiRt
	dl YI_NorSpr165_NipperSpore_RideYoshiRt
	dl YI_NorSpr166_ThunderLakitu_RideYoshiRt
	dl YI_NorSpr167_GreenKoopaShell_RideYoshiRt
	dl YI_NorSpr168_RedKoopaShell_RideYoshiRt
	dl YI_NorSpr169_GreenNakedKoopa_RideYoshiRt
	dl YI_NorSpr16A_RedNakedKoopa_RideYoshiRt
	dl YI_NorSpr16B_GreenKoopa_RideYoshiRt
	dl YI_NorSpr16C_RedKoopa_RideYoshiRt
	dl YI_NorSpr16D_GreenParakoopa_RideYoshiRt
	dl YI_NorSpr16E_RedHorizontalParakoopa_RideYoshiRt
	dl YI_NorSpr16F_RedVerticalParakoopa_RideYoshiRt
	dl YI_NorSpr170_AquaLakitu_RideYoshiRt
	dl YI_NorSpr171_NavalPiranha_RideYoshiRt
	dl YI_NorSpr172_NavalPiranhaBuds_RideYoshiRt
	dl YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_RideYoshiRt
	dl YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_RideYoshiRt
	dl YI_NorSpr175_BaronVonZeppelinCarryingBomb_RideYoshiRt
	dl YI_NorSpr176_BaronVonZeppelinCarryingBandit_RideYoshiRt
	dl YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_RideYoshiRt
	dl YI_NorSpr178_BaronVonZeppelinCarrying1up_RideYoshiRt
	dl YI_NorSpr179_BaronVonZeppelinCarryingKey_RideYoshiRt
	dl YI_NorSpr17A_BaronVonZeppelinCarryingCoins_RideYoshiRt
	dl YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_RideYoshiRt
	dl YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_RideYoshiRt
	dl YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_RideYoshiRt
	dl YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_RideYoshiRt
	dl YI_NorSpr17F_BaronVonZeppelin_RideYoshiRt
	dl YI_NorSpr180_SpinningLog_RideYoshiRt
	dl YI_NorSpr181_CrazeeDayzee_RideYoshiRt
	dl YI_NorSpr182_Dragonfly_RideYoshiRt
	dl YI_NorSpr183_Butterfly_RideYoshiRt
	dl YI_NorSpr184_Bumpty_RideYoshiRt
	dl YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_RideYoshiRt
	dl YI_NorSpr186_MovingLineGuidedGreenPlatformRight_RideYoshiRt
	dl YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_RideYoshiRt
	dl YI_NorSpr188_MovingLineGuidedYellowPlatformRight_RideYoshiRt
	dl YI_NorSpr189_LineGuidedGreenPlatformLeft_RideYoshiRt
	dl YI_NorSpr18A_LineGuidedGreenPlatformRight_RideYoshiRt
	dl YI_NorSpr18B_LineGuidedYellowPlatformLeft_RideYoshiRt
	dl YI_NorSpr18C_LineGuidedYellowPlatformRight_RideYoshiRt
	dl YI_NorSpr18D_LineGuidedRedPlatformLeft_RideYoshiRt
	dl YI_NorSpr18E_LineGuidedGreenPlatformRight_RideYoshiRt
	dl YI_NorSpr18F_SpiralPlatform_RideYoshiRt
	dl YI_NorSpr190_FallingIcicle_RideYoshiRt
	dl YI_NorSpr191_Bird_RideYoshiRt
	dl YI_NorSpr192_PetalGuy_RideYoshiRt
	dl YI_NorSpr193_SnakeCagedGhost_RideYoshiRt
	dl YI_NorSpr194_Blargg_RideYoshiRt
	dl YI_NorSpr195_SmallUnstableSnowPlatform_RideYoshiRt
	dl YI_NorSpr196_UnstableSnowPlatform_RideYoshiRt
	dl YI_NorSpr197_ArrowSign_RideYoshiRt
	dl YI_NorSpr198_DiagonalArrowSign_RideYoshiRt
	dl YI_NorSpr199_DizzyDandy_RideYoshiRt
	dl YI_NorSpr19A_BooGuy_RideYoshiRt
	dl YI_NorSpr19B_TacklingBumpty_RideYoshiRt
	dl YI_NorSpr19C_FlyingBumpty_RideYoshiRt
	dl YI_NorSpr19D_SkeletonGoonie_RideYoshiRt
	dl YI_NorSpr19E_WinglessSkeletonGoonie_RideYoshiRt
	dl YI_NorSpr19F_SkeletonGoonieCarryingBomb_RideYoshiRt
	dl YI_NorSpr1A0_DoubleFirebar_RideYoshiRt
	dl YI_NorSpr1A1_Firebar_RideYoshiRt
	dl YI_NorSpr1A2_HealthStar_RideYoshiRt
	dl YI_NorSpr1A3_LittleSkullMouser_RideYoshiRt
	dl YI_NorSpr1A4_KeyholeCork_RideYoshiRt
	dl YI_NorSpr1A5_RunAwayMonkey_RideYoshiRt
	dl YI_NorSpr1A6_MonkeyWithWatermelon_RideYoshiRt
	dl YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_RideYoshiRt
	dl YI_NorSpr1A8_TheifMonkey_RideYoshiRt
	dl YI_NorSpr1A9_HangingMonkeySpittingSeeds_RideYoshiRt
	dl YI_NorSpr1AA_HotLips_RideYoshiRt
	dl YI_NorSpr1AB_BooBalloon_RideYoshiRt
	dl YI_NorSpr1AC_SmallFrog_RideYoshiRt
	dl YI_NorSpr1AD_MagicShootingKamek_RideYoshiRt
	dl YI_NorSpr1AE_MagicShot_RideYoshiRt
	dl YI_NorSpr1AF_FloatingCoin_RideYoshiRt
	dl YI_NorSpr1B0_DeflatingBalloon_RideYoshiRt
	dl YI_NorSpr1B1_CoinCannon_RideYoshiRt
	dl YI_NorSpr1B2_MinigameCoin_RideYoshiRt
	dl YI_NorSpr1B3_GatherCoinsBandit_RideYoshiRt
	dl YI_NorSpr1B4_MinigameCheckeredPlatform_RideYoshiRt
	dl YI_NorSpr1B5_PoppingBalloonsBandit_RideYoshiRt
	dl YI_NorSpr1B6_MinigameBalloon_RideYoshiRt
	dl YI_NorSpr1B7_SeedSpittingMinigameBandit_RideYoshiRt
	dl YI_NorSpr1B8_WatermelonPot_RideYoshiRt
	dl YI_NorSpr1B9_P2SeedSpittingMinigameBandit_RideYoshiRt

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_clear_all_sprites: wipe both normal- and ambient-sprite slot arrays.
; Called by the level loader on level entry and after major mode changes.
; Walks 40 slots (X=$9C..0 in steps of 4); each pass zeroes the "sprite
; exists" flag and writes $00FF to the despawn-timer.
; Caller invariants: enters in any M/X width; sets full 16/16 internally.
; Raidenthequick: CODE_clear_all_sprites
;-------------------------------------------------------------------------
CODE_0394B8:
CODE_clear_all_sprites:                              ; Raidenthequick: CODE_clear_all_sprites
	REP.b #$30                                  ; M=16, X=16
	LDX.w #$009C
	LDA.w #$00FF
CODE_0394C0:
	STZ.w !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag|!EXRAMBankMirror,x
	STA.w $7462,x
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_0394C0
	SEP.b #$30
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_edge_despawn_draw: SuperFX dispatch to FXCODE_098925 -- the chip-side
; routine that draws the per-frame sprite OAM blob AND culls sprites that
; have scrolled past the off-screen edge.  Below entry-points:
;   $0394CF -- short-circuit (R3 = 0 in current level mode)
;   $0394D3 -- main path; checks for two cinematic levels (Welcome / Danger
;              Icy Conditions / Kamek's Revenge) and the skiing form to
;              decide whether to set R3 to 0 or fall through to common.
; Raidenthequick: CODE_spr_edge_despawn_draw
;-------------------------------------------------------------------------
CODE_0394CF:
CODE_spr_edge_despawn_draw:                          ; Raidenthequick: CODE_spr_edge_despawn_draw
	REP.b #$20
	BRA.b CODE_0394F3

CODE_0394D3:
	LDA.w $7E2A
	BNE.b CODE_039505
	REP.b #$20
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w #!Define_YI_LevelID_WelcomeToYoshisIsland
	BEQ.b CODE_0394F6
	CMP.w #!Define_YI_LevelID_DangerIcyConditionsAhead
	BEQ.b CODE_0394EC
	CMP.w #!Define_YI_LevelID_KameksRevenge
	BNE.b CODE_0394F3
CODE_0394EC:
	LDY.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CPY.b #!Define_YI_PlayerForm0E_Skiing
	BEQ.b CODE_0394F6
CODE_0394F3:
	LDA.w #$0000
CODE_0394F6:
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_098925>>16
	LDA.w #FXCODE_098925
	JSL.l !RAM_YI_Global_RT_00DECF
	SEP.b #$20
	RTL

CODE_039505:
	SEP.b #$20
	LDX.b #$17
	LDY.b #$5C
CODE_03950B:
	LDA.w $0C98,x
	BEQ.b CODE_03951A
	LDA.w $7040,y
	STA.b $00,x
	AND.b #$F3
	STA.w $7040,y
CODE_03951A:
	DEY
	DEY
	DEY
	DEY
	DEX
	BPL.b CODE_03950B
	REP.b #$20
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	SEC
	SBC.w #!Define_YI_LevelID_WelcomeToYoshisIsland
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_098925>>16
	LDA.w #FXCODE_098925
	JSL.l !RAM_YI_Global_RT_00DECF
	SEP.b #$20
	LDX.b #$17
	LDY.b #$5C
CODE_03953C:
	LDA.w $0C98,x
	BEQ.b CODE_039546
	LDA.b $00,x
	STA.w $7040,y
CODE_039546:
	DEY
	DEY
	DEY
	DEY
	DEX
	BPL.b CODE_03953C
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_check_newspr_screen: scan the offscreen sprite-list for new entries that
; just entered the camera window and need to be activated.  Walks the camera
; X-position forward in 16-pixel steps from prior position to current, calling
; CODE_check_newspr_xoffset for each step.  Sets up direct-page to
; $7960 so the offscreen sprite list (mapped into DP) is reachable.
; Raidenthequick: CODE_check_newspr_screen
;-------------------------------------------------------------------------
CODE_03954E:
CODE_check_newspr_screen:                            ; Raidenthequick: CODE_check_newspr_screen
	PHB
	PHK
	PLB
	PHD
	REP.b #$20
	LDA.w #$7960                                ; direct page = offscreen sprite list
	TCD
	LDY.b #$3C
	STY.w $7E4A
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.b $0E
	SEC
	SBC.w #$0160
	STA.w !RAM_YI_Global_Layer1XPosLo
	STZ.w $0073
CODE_03956C:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0010
	STA.w !RAM_YI_Global_Layer1XPosLo
	JSR.w CODE_check_newspr_xoffset
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CMP.b $0E
	BNE.b CODE_03956C
	LDA.w #$4000
	STA.w $60A4
	STA.w $60A6
	SEP.b #$20
	PLD
	PLB
	RTL

DATA_03958E:
	dw $0120,$FFD0

DATA_039592:
	dw $0110,$FFE0

;-------------------------------------------------------------------------
; CODE_check_newspr_xoffset / CODE_check_new_sprites helpers: pump the camera-window
; corners into SuperFX R1..R4 (PLOTX/PLOTY/R3/R4 = LMULT) and invoke
; FXCODE_098000 -- the chip-side hit-test that returns a list of offscreen
; sprite-list entries currently overlapping the camera window.  The list is
; written by the chip to $7027CE; we then walk it terminated by negative byte.
; Raidenthequick: CODE_check_newspr_xoffset
;-------------------------------------------------------------------------
CODE_039596:
CODE_check_newspr_xoffset:                           ; Raidenthequick: CODE_check_newspr_xoffset
	LDX.w $0073
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03958E,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$0020
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.w $0075
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w DATA_039592,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w #$0030
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_098000>>16
	LDA.w #FXCODE_098000
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDX.w #$0000
CODE_0395D2:
	LDA.l $7027CE,x
	BPL.b CODE_0395DB
	SEP.b #$10
	RTS

CODE_0395DB:
	SEC
	SBC.w #$01BA
	BCC.b CODE_0395E9
	JSR.w CODE_init_special_sprite
	BCC.b CODE_039640
	JMP.w CODE_03977F

CODE_0395E9:
	LDA.w $7E2A
	BEQ.b CODE_03962F
	TXY
	LDA.l $7027CE,x
	ASL
	TAX
	LDA.l FXDATA_0A971E,x
	TYX
	AND.w #$6000
	BNE.b CODE_03962F
	LDA.w $7E2A
	INC
	BEQ.b CODE_039640
	LDA.l $7027D0,x
	ASL
	ASL
	ASL
	ASL
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C1
	BCS.b CODE_03962F
	LDA.l $7027D2,x
	ASL
	ASL
	ASL
	ASL
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C1
	BCC.b CODE_039640
CODE_03962F:
	LDY.w #$005C
CODE_039632:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_check_new_sprites
	DEY
	DEY
	DEY
	DEY
	CPY.w #$0018
	BCS.b CODE_039632
CODE_039640:
	TXY
	SEP.b #$30
	LDA.l $7027D4,x
	TAX
	LDA.b #$00
	STA.l $7028CA,x
	REP.b #$30
	TYX
	JMP.w CODE_03977F

;-------------------------------------------------------------------------
; CODE_check_new_sprites (entry): allocate a normal-sprite slot and
; activate the offscreen-list entry currently in X.  Reads packed X/Y from
; $7027D0/$7027D2 (4-bit fixed-point cell coords; ASL*4 = *16 to expand to
; pixel coords) and writes them to $70E2,y / $7182,y.  The slot index in Y
; comes from CODE_039632 which scans EXRAM CurrentStatus for the first idle slot.
; Raidenthequick: CODE_check_new_sprites
;-------------------------------------------------------------------------
CODE_039654:
CODE_check_new_sprites:                              ; Raidenthequick: CODE_check_new_sprites
	LDA.l $7027D0,x                             ; packed X cell (0..F * 16)
	ASL
	ASL
	ASL
	ASL
	STA.w $70E2,y                               ; -> pixel X of new slot
	LDA.l $7027D2,x                             ; packed Y cell
	ASL                                         ; \
	ASL                                         ;  | * 16 to pixel coords
	ASL                                         ;  |
	ASL                                         ; /
	STA.w $7182,y                               ; -> pixel Y of new slot
	LDA.w #$0000
	STA.w $7D96,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	STA.w $70E0,y
	STA.w $7D36,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	STA.w $7A36,y
	STA.w $7A38,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	STA.w $7AF8,y
	STA.w $7402,y
	STA.w $7860,y
	STA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,y
	STA.w $7D38,y
	STA.w $7720,y
	STA.w $7680,y
	STA.w $7682,y
	STA.w $7540,y
	STA.w $75E0,y
	STA.w $77C0,y
	DEC
	STA.w $7362,y
	STA.w $7722,y
	LDA.w #$1FFF
	STA.w $7862,y
	LDA.l $7027CE,x
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	PHX
	ASL
	TAX
	SEP.b #$20
	PHY
	LDA.l FXDATA_0AA716,x                        ; sprite's required GFX-file id; searched against the 6 spriteset slots $6EB5 below to set OBJ tile base (see DATA_sprite_gfx_file_table)
	LDY.w #$0006
CODE_0396DF:
	CMP.w $6EB5,y
	BEQ.b CODE_0396EA
	DEY
	BNE.b CODE_0396DF
	TYA
	BRA.b CODE_0396EF

CODE_0396EA:
	TYA
	ADC.b #$06
	ASL
	ASL
CODE_0396EF:
	REP.b #$20
	AND.w #$00FF
	PLY
	STA.w $7180,y
	LDA.l FXDATA_0A9F1A+$01,x
	AND.w #$00FF
	EOR.w #$0020
	STA.w $7042,y
	LDA.l FXDATA_0A9F1A,x
	AND.w #$00FF
	STA.w $74A2,y
	LDA.l FXDATA_0AA318-$01,x
	AND.w #$FF00
	BPL.b CODE_03971B
	ORA.w #$00FF
CODE_03971B:
	XBA
	STA.w $7542,y
	LDA.l FXDATA_0AA318,x
	AND.w #$FF00
	BPL.b CODE_03972B
	ORA.w #$00FF
CODE_03972B:
	XBA
	ASL
	ASL
	ASL
	ASL
	STA.w $75E2,y
	LDA.l FXDATA_0A9B1C,x                        ; init the slot's render-control word $7040 (hi byte = OAMByteCount, lo byte = draw flags; see DATA_sprite_render_control_table)
	STA.w $7040,y
	LDA.l FXDATA_0A971E,x
	STA.w $6FA2,y
	LDA.l FXDATA_0A9320,x
	STA.w $6FA0,y
	AND.w #$001F
	ASL
	ASL
	ASL
	TAX
	LDA.l FXDATA_0A9220,x
	STA.w $7B56,y
	LDA.l FXDATA_0A9220+$02,x
	STA.w $7B58,y
	LDA.l FXDATA_0A9220+$04,x
	STA.w $7BB6,y
	LDA.l FXDATA_0A9220+$06,x
	STA.w $7BB8,y
	PLX
	LDA.w $0073
	STA.w $7400,y
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.l $7027D4,x
	STA.w $74A0,y
CODE_03977F:
	TXA
	CLC
	ADC.w #$0008
	TAX
	JMP.w CODE_0395D2

;---------------------------------------------------------------------------

CODE_039788:
	PHB
	PHK
	PLB
	SEC
	SBC.w #$01BA
	REP.b #$10
	JSR.w CODE_init_special_sprite
	SEP.b #$10
	LDA.w #$00FF
	STA.w $0C0C,y
	PLB
	RTL

CODE_03979E:
CODE_init_special_sprite:                            ; Raidenthequick: CODE_init_special_sprite
	PHX
	LDY.w #$0006
CODE_0397A2:
	LDX.w $0C04,y
	BEQ.b CODE_0397AE
	DEY
	DEY
	BPL.b CODE_0397A2
	PLX
	CLC
	RTS

CODE_0397AE:
	INC
	STA.w $0C04,y
	ASL
	PLX
	PHX
	PHA
	LDA.l $7027D4,x
	STA.w $0C0C,y
	LDA.l $7027D0,x
	STA.w $7960
	LDA.l $7027D2,x
	STA.w $7962
	PLA
	TAX
	JSR.w (DATA_special_sprite_inits-$02,x)
	PLX
	SEC
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_handle_sprites: per-frame top-level sprite update driver.  Called once per
; frame from the game loop in Bank00.  Sets DBR=$03, DP=$7960 (so all sprite
; code reads slots through direct page), then dispatches to per-slot
; CODE_handle_sprite for every active normal-sprite slot.
;
; Two entry points:
;   $0397D3 = CODE_handle_sprites       -- normal entry; skips CODE_check_newspr_xoffset
;   $0397DF = (CODE_0397DF)        -- entry from cinematic sprite spawn paths;
;                                     also runs CODE_check_newspr_xoffset first
; Both share the body at CODE_0397EC.
; Raidenthequick: CODE_handle_sprites
;-------------------------------------------------------------------------
CODE_0397D3:
CODE_handle_sprites:                                 ; Raidenthequick: CODE_handle_sprites
	PHB
	PHK
	PLB
	PHD
	REP.b #$20                                  ; M=16
	LDA.w #$7960                                ; DP = direct-page base for sprite code
	TCD
	BRA.b CODE_0397EC

CODE_0397DF:
	PHB
	PHK
	PLB
	PHD
	REP.b #$20
	LDA.w #$7960
	TCD
	JSR.w CODE_check_newspr_xoffset                           ; also check for new offscreen sprites entering
CODE_0397EC:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_039802
	INC.b $14
	LDX.b #FXCODE_09884C>>16
	LDA.w #FXCODE_09884C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_039802:
	STZ.w $607A
	LDA.w #$29CC
	STA.l $7029CA
	LDX.b #FXCODE_0ACFED>>16
	LDA.w #FXCODE_0ACFED
	JSL.l !RAM_YI_Global_RT_00DECF
	LDA.w #$0008
	STA.w $6120
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $611C
	LDA.w #$000C
	LDX.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CPX.b #!Define_YI_PlayerForm08_Train
	BNE.b CODE_03984D
	LDY.w $6180
	BEQ.b CODE_039855
	LDA.w #$0004
	STA.w $6120
	STA.w $6122
	LDA.w #$00FF
	LDY.w $60C4
	BEQ.b CODE_039843
	LSR
CODE_039843:
	EOR.w $617E
	INC
	TAY
	LDA.w #$0015
	BRA.b CODE_039874

;---------------------------------------------------------------------------

CODE_03984D:
	LDY.w $60C2
	BEQ.b CODE_039855
	LDA.w #$0006
CODE_039855:
	STA.w $6122
	CPX.b #$10
	BNE.b CODE_039886
	LDY.w $6180
	BEQ.b CODE_039886
	INC.w $6122
	LDA.w $617E
	LDY.w $60C4
	BNE.b CODE_039870
	EOR.w #$00FF
	INC
CODE_039870:
	TAY
	LDA.w #$0021
CODE_039874:
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	TYA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_09F83A>>16
	LDA.w #FXCODE_09F83A
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_039895

CODE_039886:
	SEC
	SBC.w #$0020
	EOR.w #$FFFF
	INC
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $611E
CODE_039895:
	LDX.b #FXCODE_098084>>16
	LDA.w #FXCODE_098084
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $607A
	BEQ.b CODE_0398A7
	JSL.l CODE_push_sound_queue
CODE_0398A7:
	JSL.l CODE_handle_ambient_sprites
	LDA.w $7E2A
	DEC
	BMI.b CODE_0398B7
	LDA.w #$FFF8
	STA.w $7E2A
CODE_0398B7:
	STZ.w $0CC2
	STZ.w $61BA
	LDA.w #$FFFF
	STA.w $0D96
	LDX.b #$5C                                  ; start at last slot ($5C = 24th slot * 4-byte stride)
;-------------------------------------------------------------------------
; Per-slot loop: walks the 24 normal-sprite slots from $5C down to $00 in
; 4-byte strides.  For each slot with state != 0, JSLs CODE_handle_sprite which
; dispatches via DATA_sprite_state_routines.  Also runs the random-number mixer
; (XOR's the H-counter with $10 each iteration) for sprite RNG.
;-------------------------------------------------------------------------
CODE_0398C5:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x   ; state byte
	BEQ.b CODE_0398DF                           ; slot empty -- skip
	STX.b $12                                   ; stash slot index in DP for handlers
	PHB                                         ; preserve DBR; handler may change it
	LDY.w !REGISTER_SoftwareLatchForHVCounter   ; \ latch H/V counter
	LDY.w !REGISTER_PPUStatusFlag2              ; / (ack-read of $213F)
	LDA.w !REGISTER_HCounter                    ; \ mix H-counter into the RNG
	ADC.b $10                                   ;  | seed at DP $10
	STA.b $10                                   ; /
	JSL.l CODE_handle_sprite                           ; CODE_handle_sprite for this slot
	PLB
CODE_0398DF:
	DEX                                         ; \ slot -= 4 (4-byte slot stride)
	DEX                                         ;  |
	DEX                                         ;  |
	DEX                                         ; /
	BPL.b CODE_0398C5                           ; loop while slot >= 0
	LDY.w $0C50
	BEQ.b CODE_0398F7
	LDY.w $0C54
	CPY.b #$30
	BMI.b CODE_0398F4
	STZ.w $0C54
CODE_0398F4:
	INC.w $0C54
CODE_0398F7:
	REP.b #$10
	LDY.w #$0006
CODE_0398FC:
	LDA.w $0C04,y
	BEQ.b CODE_039906
	ASL
	TAX
	JSR.w (DATA_special_sprite_mains,x)
CODE_039906:
	DEY
	DEY
	BPL.b CODE_0398FC
	SEP.b #$10
	LDA.w $7E2A
	BPL.b CODE_039953
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_039938
	INC.w $7E2A
	BPL.b CODE_039956
	LDA.w $60B0
	CMP.w #$0038
	BMI.b CODE_039938
	CMP.w #$00B8
	BPL.b CODE_039938
	LDA.w $60B2
	CMP.w #$0040
	BMI.b CODE_039938
	CMP.w #$0080
	BPL.b CODE_039938
	JMP.w CODE_0399BF

CODE_039938:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STA.w $0C1E
	STA.w $0C20
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23
	LDA.w !RAM_YI_Global_Layer1YPosLo
	STA.w $0C27
CODE_039953:
	JMP.w CODE_0399CE

CODE_039956:
	DEC.w $7E2A
	LDA.w $0C94
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $0C96
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0C23
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $0C27
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0600
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $0C2A
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $0C2C
	REP.b #$10
	JSR.w CODE_03D997
	SEP.b #$10
	LDA.w $0C94
	SEC
	SBC.w $0C23
	BEQ.b CODE_0399A7
	EOR.w $0C2A
	BPL.b CODE_0399CE
	LDA.w $0C94
	STA.w $0C23
CODE_0399A7:
	LDA.w $0C96
	SEC
	SBC.w $0C27
	BEQ.b CODE_0399BB
	EOR.w $0C2C
	BPL.b CODE_0399CE
	LDA.w $0C96
	STA.w $0C27
CODE_0399BB:
	JSL.l CODE_04DCF9
CODE_0399BF:
	STZ.w $7E2A
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w $0C1E
	STZ.w $0C20
CODE_0399CE:
	SEP.b #$20
	PLD
	PLB
	RTL

;---------------------------------------------------------------------------

CODE_0399D3:                                    ; flavor: code (opcode at addr); DATA_ name is a documentation bug
	LDA.w $7E35
	AND.w #$FF00
	CLC
	ADC.w $7E32
	STA.w $7E32
	LDA.w $7E36
	AND.w #$FF00
	BPL.b CODE_0399EB
	ORA.w #$00FF
CODE_0399EB:
	XBA
	ADC.w $7E2E
	STA.w $7E2E
	LDA.w $7E37
	AND.w #$FF00
	CLC
	ADC.w $7E34
	STA.w $7E34
	LDA.w $7E38
	AND.w #$FF00
	BPL.b CODE_039A0A
	ORA.w #$00FF
CODE_039A0A:
	XBA
	ADC.w $7E30
	STA.w $7E30
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_handle_sprite: per-frame entry to one normal-sprite slot.  Stashes the
; sprite's current pixel position into the SuperFX shared (X@$6EBC, Y@$6EBE),
; decrements the four per-sprite countdown timers ($7A96/$7A98/$7AF6/$7AF8
; and the engulf/tongued timer $77C1), then dispatches through the sprite
; state table DATA_sprite_state_routines keyed by EXRAM CurrentStatus,x.
; Caller invariants: M=16, X=16, DBR=$03; X holds the slot's 4-byte index.
; Raidenthequick: CODE_handle_sprite
;-------------------------------------------------------------------------
CODE_039A12:
CODE_handle_sprite:                                  ; Raidenthequick: CODE_handle_sprite
	LDA.w $70E2,x                               ; \ stash slot X position
	STA.w $6EBC                                 ; / into SuperFX shared $6EBC
	LDA.w $7182,x                               ; \ and slot Y position
	STA.w $6EBE                                 ; / into SuperFX shared $6EBE
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror   ; \ if global freeze, skip
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo                ;  | fuzzy mosaic, or
	ORA.w !RAM_YI_Level_ItemBeingUsed                            ;  | item-use frame,
	BNE.b CODE_039A49                                            ; / don't tick timers
	LDA.w $7A96,x                               ; \ timer 1 ($7A96,x)
	BEQ.b CODE_039A31                           ;  | if 0 skip, else
	DEC.w $7A96,x                               ; / decrement
CODE_039A31:
	LDA.w $7A98,x                               ; \ timer 2 ($7A98,x)
	BEQ.b CODE_039A39                           ;  |
	DEC.w $7A98,x                               ; /
CODE_039A39:
	LDA.w $7AF6,x                               ; \ timer 3 ($7AF6,x)
	BEQ.b CODE_039A41                           ;  |
	DEC.w $7AF6,x                               ; /
CODE_039A41:
	LDA.w $7AF8,x                               ; \ timer 4 ($7AF8,x)
	BEQ.b CODE_039A49                           ;  |
	DEC.w $7AF8,x                               ; /
CODE_039A49:
	LDY.w $77C1,x                               ; \ swallowed/tongued countdown
	BEQ.b CODE_039A51                           ;  | (counts down even during freeze)
	DEC.w $77C1,x                               ; /
CODE_039A51:
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x   ; Y = state byte
	LDA.w DATA_sprite_state_routines-$02,y                     ; A = DATA_sprite_state_routines[Y/2] (= target-1)
	PHA                                         ; \ PHA/RTS trampoline:
	RTS                                         ; / pops A+1 -> PC, dispatches to handler

;-------------------------------------------------------------------------
; DATA_sprite_state_routines: 9-entry dispatch table for the sprite state machine.
;
; Indexed by EXRAM CurrentStatus,x (slot's state byte at $70:0F00+slot, where
; slot is a 4-byte stride). CODE_handle_sprite loads the state byte into Y, then
; does `LDA DATA_sprite_state_routines-2,y / PHA / RTS` -- a classic PHA/RTS
; trampoline, hence each table entry stores `target-1`.
;
; State byte values are always EVEN and in [$02..$12].  The convention:
;
;   $02 CODE_spr_state_init  newly spawned, run Init handler
;                                                then advance to $10 (alive)
;   $04 CODE_spr_state_init (alias)   (CODE_spr_state_init)  identical to $02; some spawn
;                                                paths set $04 instead of $02
;   $06 CODE_spr_state_turn_star  transforming into a star power-up
;                                                (post-tongue/swallow)
;   $08 CODE_spr_state_tongued  stuck on Yoshi's tongue
;   $0A CODE_spr_state_ride_yoshi  riding on Yoshi's back (carry)
;   $0C CODE_spr_state_die_collision  killed by environmental collision
;                                                (lava log, falling rock, pit)
;   $0E CODE_spr_state_on_head_bop  Yoshi just bopped/stomped this
;                                                sprite (dispatch to head-bop tbl)
;   $10 CODE_spr_state_main  alive / Main handler running
;                                                (the default active state)
;   $12 CODE_spr_state_die_burning  on fire (post fire-watermelon /
;                                                burnt by fire attack)
;
; State lifecycle:
;   - Spawn path writes $02 (or $04) plus the sprite ID -> Init runs once -> $10
;   - Main runs each frame while state == $10
;   - Yoshi-tongue path writes $08 / $0A / $06 depending on swallow outcome
;   - Head-bop / collision / burning paths write $0C / $0E / $12
;   - Despawn writes $00 (slot empty; CODE_handle_sprite skips this slot)
;
; Each handler at $03:9A6E, $03:A247, $03:9AC8, $03:A11D, $03:9F8D, $03:A085,
; $03:9A90, $03:A00B internally re-derives the sprite-ID and indexes one of
; the four per-sprite-ID pointer tables (DATA_sprite_inits, DATA_sprite_mains,
; DATA_head_bops, ride_yoshis at $03:8000 / $03:852E / $03:8A5C / $03:8F8A).
; Naming matches Raidenthequick.  Our state-byte handlers (CODE_spr_state_init,
; _turn_star, _tongued, _ride_yoshi, _die_collision, _on_head_bop, ...) cover
; the equivalent state-machine in ys_enmy.asm.
; See docs/spritestateengine.md for full architecture writeup.
; Raidenthequick: DATA_sprite_state_routines
;-------------------------------------------------------------------------
DATA_039A59:
DATA_sprite_state_routines:                          ; Raidenthequick: DATA_sprite_state_routines
	dw CODE_spr_state_init-$01                          ; $02 CODE_spr_state_init           (newly spawned, run Init)
	dw CODE_spr_state_init-$01                          ; $04 CODE_spr_state_init alias     (same handler as $02)
	dw CODE_spr_state_turn_star-$01                          ; $06 CODE_spr_state_turn_star      (transforming into star)
	dw CODE_spr_state_tongued-$01                          ; $08 CODE_spr_state_tongued        (stuck to Yoshi's tongue)
	dw CODE_spr_state_ride_yoshi-$01                          ; $0A CODE_spr_state_ride_yoshi     (riding on Yoshi's back)
	dw CODE_spr_state_die_collision-$01                          ; $0C CODE_spr_state_die_collision  (killed by environment)
	dw CODE_spr_state_on_head_bop-$01                          ; $0E CODE_spr_state_on_head_bop    (Yoshi just stomped sprite)
	dw CODE_spr_state_main-$01                          ; $10 CODE_spr_state_main           (alive / Main running)
	dw CODE_spr_state_die_burning-$01                          ; $12 CODE_spr_state_die_burning    (on fire)

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Shared RTL stub.  The huge run of labels below (FuzzyFart_Init and ~200
; *_StompRt: aliases) all collapse to the same address: a routine that
; immediately RTLs.  Sprites with no meaningful Init or "head-bopped" action
; point their respective table entries here.  asar allows piling labels
; at one address; each emits a single dl in the appropriate pointer table.
;-------------------------------------------------------------------------
YI_NorSpr0B3_FuzzyFart_Init:
init_unused_rtl_stub:                           ; descriptive alias for the no-op Init

YI_NorSpr000_LavaLog_StompRt:
YI_NorSpr001_ClosedDoor_StompRt:
YI_NorSpr002_NavalPiranhaVines_StompRt:
YI_NorSpr003_CrateWithKey_StompRt:
YI_NorSpr004_HitSuperBabyMarioBlock_StompRt:
YI_NorSpr006_WatermelonFreeze_StompRt:
YI_NorSpr008_FallingRubble_StompRt:
YI_NorSpr00A_Kaboomba_StompRt:
YI_NorSpr00B_Cannonball_StompRt:
YI_NorSpr00C_RaphaelTheRaven_StompRt:
YI_NorSpr00D_GoalRing_StompRt:
YI_NorSpr00E_GOALLetters_StompRt:
YI_NorSpr00F_BonusChallengeSign_StompRt:
YI_NorSpr010_RoundedCagedGhost_StompRt:
YI_NorSpr011_ItemCard_StompRt:
YI_NorSpr012_BossDoor_StompRt:
YI_NorSpr013_BossExplosion_StompRt:
YI_NorSpr014_KeyFromBoss_StompRt:
YI_NorSpr015_SubmarineTorpedo_StompRt:
YI_NorSpr016_BiggerBoo_StompRt:
YI_NorSpr018_WatermelonFlame_StompRt:
YI_NorSpr019_Bubble_StompRt:
YI_NorSpr01A_SkiLift_StompRt:
YI_NorSpr01B_VerticalLavaLog_StompRt:
YI_NorSpr01C_DrFreezegood_StompRt:
YI_NorSpr01D_DrFreezegoodOnSkiLift_StompRt:
YI_NorSpr01F_RotatingDoors_StompRt:
YI_NorSpr021_Bucket_StompRt:
YI_NorSpr026_BowserFightGiantEgg_StompRt:
YI_NorSpr02C_LungeFish_StompRt:
YI_NorSpr02D_SalvoTheSlime_StompRt:
YI_NorSpr02E_EyesOfSalvoTheSlime_StompRt:
YI_NorSpr02F_LittleMouserHole_StompRt:
YI_NorSpr031_PottedSpikedFunGuy_StompRt:
YI_NorSpr032_PeekingLittleMouser_StompRt:
YI_NorSpr034_RogersPot_StompRt:
YI_NorSpr035_RogerThePottedGhost_StompRt:
YI_NorSpr036_FallingWall_StompRt:
YI_NorSpr037_GrimLeecher_StompRt:
YI_NorSpr038_PottedGhostFlame_StompRt:
YI_NorSpr039_HorizontalRotatingPlank_StompRt:
YI_NorSpr03A_3MiniRavens_StompRt:
YI_NorSpr03B_MiniRaven_StompRt:
YI_NorSpr03C_TapTapTheRedNose_StompRt:
YI_NorSpr03D_LargeSeesaw_StompRt:
YI_NorSpr03E_ThinPlatform_StompRt:
YI_NorSpr03F_SlimeBlock_StompRt:
YI_NorSpr040_BabyLuigi_StompRt:
YI_NorSpr041_Stork_StompRt:
YI_NorSpr042_VerticalPipeEntrance_StompRt:
YI_NorSpr045_PrinceFroggy_StompRt:
YI_NorSpr046_BurtTheBashful_StompRt:
YI_NorSpr047_ShyguyPushingRoger_StompRt:
YI_NorSpr048_CutsceneKamek_StompRt:
YI_NorSpr049_ThunderLakituFireBlast1_StompRt:
YI_NorSpr04A_ThunderLakituFireBlast2_StompRt:
YI_NorSpr04B_ThunderLakituFireBlast3_StompRt:
YI_NorSpr04C_UpsidedownBlowHard_StompRt:
YI_NorSpr04D_UnusedSpriteIndex_StompRt:
YI_NorSpr04E_LockedDoor_StompRt:
YI_NorSpr04F_MiddleRing_StompRt:
YI_NorSpr050_GreyRotatingWoodenBoard_StompRt:
YI_NorSpr051_LargeWheel_StompRt:
YI_NorSpr052_BalloonPlatform_StompRt:
YI_NorSpr053_KamekSayingOhMy_StompRt:
YI_NorSpr054_UpsideDownPiranhaPlant_StompRt:
YI_NorSpr055_4GreenRotatingPlatforms_StompRt:
YI_NorSpr056_4PinkRotatingPlatforms_StompRt:
YI_NorSpr057_SewerGhostWithPlatform_StompRt:
YI_NorSpr059_StationarySuperStar_StompRt:
YI_NorSpr05A_RaphaelSparkAttack_StompRt:
YI_NorSpr05D_GlitchedSprite_StompRt:
YI_NorSpr05E_BrownWoodenBoard_StompRt:
YI_NorSpr05F_AutoRotateBrownWoodenBoard_StompRt:
YI_NorSpr060_Bomb_StompRt:
YI_NorSpr061_BabyMario_StompRt:
YI_NorSpr063_MuddyBuddy_StompRt:
YI_NorSpr064_4AutoRotatingPinkPlatforms_StompRt:
YI_NorSpr065_RedCoin_StompRt:
YI_NorSpr066_PiranhaPlant_StompRt:
YI_NorSpr067_RockRevealedHiddenWingedCloud_StompRt:
YI_NorSpr068_FlashingEggBlock_StompRt:
YI_NorSpr069_RedEggBlock_StompRt:
YI_NorSpr06A_YellowEggBlock_StompRt:
YI_NorSpr06B_GreenEggBlock_StompRt:
YI_NorSpr06C_LargeSpringBall_StompRt:
YI_NorSpr06D_ClockwiseHootieTheBlueFish_StompRt:
YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_StompRt:
YI_NorSpr06F_SpringBall_StompRt:
YI_NorSpr070_Clawdaddy_StompRt:
YI_NorSpr071_BigBoo_StompRt:
YI_NorSpr072_TrainBandit_StompRt:
YI_NorSpr073_BalloonPump_StompRt:
YI_NorSpr074_Spike_StompRt:
YI_NorSpr075_SpikeBall_StompRt:
YI_NorSpr076_ClockwisePiroDangle_StompRt:
YI_NorSpr077_CounterclockwisePiroDangle_StompRt:
YI_NorSpr078_RedBulletBillShooter_StompRt:
YI_NorSpr079_YellowBulletBillShooter_StompRt:
YI_NorSpr07A_GreenBulletBillShooter_StompRt:
YI_NorSpr07E_DentOfSquishyPlatform_StompRt:
YI_NorSpr07F_LogSeesawPlatform_StompRt:
YI_NorSpr080_StraightLavaBubble_StompRt:
YI_NorSpr081_FollowingLavaBubble_StompRt:
YI_NorSpr082_ChainChomp_StompRt:
YI_NorSpr083_BowserFightCloud_StompRt:
YI_NorSpr084_TeleportSprite_StompRt:
YI_NorSpr085_HarryHedgehog_StompRt:
YI_NorSpr086_GlitchedSprite_StompRt:
YI_NorSpr087_MockUpLaidEgg_StompRt:
YI_NorSpr088_SuperStar_StompRt:
YI_NorSpr089_HorizontalMovingRedPlatform_StompRt:
YI_NorSpr08A_VerticalMovingPinkPlatform_StompRt:
YI_NorSpr08B_MockUp_StompRt:
YI_NorSpr08C_YoshiAtGoal_StompRt:
YI_NorSpr08D_Flyguy_StompRt:
YI_NorSpr08E_BowserRoomKamek_StompRt:
YI_NorSpr08F_MonkeySwing_StompRt:
YI_NorSpr090_DanglingGhost_StompRt:
YI_NorSpr092_MelonBug_StompRt:
YI_NorSpr093_Door_StompRt:
YI_NorSpr094_ExpandingBlock_StompRt:
YI_NorSpr095_BlueCheckeredBlock_StompRt:
YI_NorSpr096_RedCheckeredBlock_StompRt:
YI_NorSpr097_POWBlock_StompRt:
YI_NorSpr098_EndTransformationBlock_StompRt:
YI_NorSpr099_SpinyEgg_StompRt:
YI_NorSpr09A_SwingingGreenPlatform_StompRt:
YI_NorSpr09B_MaceGuy_StompRt:
YI_NorSpr09C_Mace_StompRt:
YI_NorSpr09D_RedSwitch_StompRt:
YI_NorSpr09E_ChompRock_StompRt:
YI_NorSpr09F_PtooiePiranhaPlant_StompRt:
YI_NorSpr0A0_Tulip_StompRt:
YI_NorSpr0A1_SmallPot_StompRt:
YI_NorSpr0A2_ThunderLakituFireball_StompRt:
YI_NorSpr0A5_NepEnut_StompRt:
YI_NorSpr0A6_IncomingChomp_StompRt:
YI_NorSpr0A7_GroupOfIncomingChomps_StompRt:
YI_NorSpr0A8_FallingIncomingChomp_StompRt:
YI_NorSpr0A9_IncomingChompShadow_StompRt:
YI_NorSpr0AA_BackgroundShyguy_StompRt:
YI_NorSpr0AB_FullEggSpawner_StompRt:
YI_NorSpr0AC_FallingRockArrowAndShadow_StompRt:
YI_NorSpr0AD_MessageBox_StompRt:
YI_NorSpr0AE_HookbillTheKoopa_StompRt:
YI_NorSpr0AF_CarMorphBubble_StompRt:
YI_NorSpr0B0_MoleMorphBubble_StompRt:
YI_NorSpr0B1_HelicopterMorphBubble_StompRt:
YI_NorSpr0B2_TrainMorphBubble_StompRt:
YI_NorSpr0B3_FuzzyFart_StompRt:
YI_NorSpr0B4_SubmarineMorphBubble_StompRt:
YI_NorSpr0B5_HiddenWingedCloud_StompRt:
YI_NorSpr0B6_WingedCloudWith8Coins_StompRt:
YI_NorSpr0B7_WingedCloudWithBubbled1up_StompRt:
YI_NorSpr0B8_WingedCloudWithFlower_StompRt:
YI_NorSpr0B9_WingedCloudWithPOW_StompRt:
YI_NorSpr0BA_WingedCloudWithStairs_StompRt:
YI_NorSpr0BB_WingedCloudWithPlatform_StompRt:
YI_NorSpr0BC_WingedCloudWithBandit_StompRt:
YI_NorSpr0BD_WingedCloudWithCoin_StompRt:
YI_NorSpr0BE_WingedCloudWith1up_StompRt:
YI_NorSpr0BF_WingedCloudWithKey_StompRt:
YI_NorSpr0C0_WingedCloudWith3Stars_StompRt:
YI_NorSpr0C1_WingedCloudWith5Stars_StompRt:
YI_NorSpr0C2_WingedCloudWithDoor_StompRt:
YI_NorSpr0C3_WingedCloudWithLowerGround_StompRt:
YI_NorSpr0C4_WingedCloudWithWatermelon_StompRt:
YI_NorSpr0C5_WingedCloudWithFireWatermelon_StompRt:
YI_NorSpr0C6_WingedCloudWithIcyWatermelon_StompRt:
YI_NorSpr0C7_WingedCloudWith3LeafSunflower_StompRt:
YI_NorSpr0C8_WingedCloudWith6LeafSunflower_StompRt:
YI_NorSpr0C9_WingedCloudWithCrashGameFeature_StompRt:
YI_NorSpr0CA_BigBossDoor_StompRt:
YI_NorSpr0CB_WingedCloudWithCoinOrStar_StompRt:
YI_NorSpr0CC_WingedCloudWithRedSwitch_StompRt:
YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_StompRt:
YI_NorSpr0CE_BowserFire_StompRt:
YI_NorSpr0CF_BowserRocks_StompRt:
YI_NorSpr0D0_HorizontalEntranceToRight_StompRt:
YI_NorSpr0D1_SecretPipeEntrance_StompRt:
YI_NorSpr0D2_MarchingMilde_StompRt:
YI_NorSpr0D5_BackgroundForHookbillFight_StompRt:
YI_NorSpr0D6_FortGhostWithPlatform_StompRt:
YI_NorSpr0D7_SluggyTheUnshaven_StompRt:
YI_NorSpr0D8_ChompWarningSign_StompRt:
YI_NorSpr0DA_FlowerPot_StompRt:
YI_NorSpr0DB_SoftBlock_StompRt:
YI_NorSpr0DC_Snowball_StompRt:
YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_StompRt:
YI_NorSpr0DE_FallingRockPlatform_StompRt:
YI_NorSpr0DF_PiscatoryPete_StompRt:
YI_NorSpr0E0_PreyingMantas_StompRt:
YI_NorSpr0E1_LochNestor_StompRt:
YI_NorSpr0E2_BooBlah_StompRt:
YI_NorSpr0E3_BooBlahWithPiroDangle_StompRt:
YI_NorSpr0E4_HeadingCactus_StompRt:
YI_NorSpr0E5_GreenNeedlenose_StompRt:
YI_NorSpr0E6_Gusty_StompRt:
YI_NorSpr0E7_Burt_StompRt:
YI_NorSpr0E8_Goonie_StompRt:
YI_NorSpr0E9_3WinglessGoonies_StompRt:
YI_NorSpr0EC_JumpingFlamerGuy_StompRt:
YI_NorSpr0ED_RunningFlamerGuy_StompRt:
YI_NorSpr0EE_EggoDil_StompRt:
YI_NorSpr0EF_EggoDilFace_StompRt:
YI_NorSpr0F0_EggoDilPetal_StompRt:
YI_NorSpr0F1_EggPlantShootingBubbles_StompRt:
YI_NorSpr0F4_EggPlant_StompRt:
YI_NorSpr0F5_Slugger_StompRt:
YI_NorSpr0F6_MotherHuffinPuffin_StompRt:
YI_NorSpr0F7_BarneyBubble_StompRt:
YI_NorSpr0F8_BlowHard_StompRt:
YI_NorSpr0F9_YellowNeedlenose_StompRt:
YI_NorSpr0FA_Flower_StompRt:
YI_NorSpr0FB_LongSpearGuy_StompRt:
YI_NorSpr0FC_ShortSpearGuy_StompRt:
YI_NorSpr0FE_ZeusGuyBlast_StompRt:
YI_NorSpr0FF_Poochy_StompRt:
YI_NorSpr100_Bubbled1up_StompRt:
YI_NorSpr101_RotatingMace_StompRt:
YI_NorSpr102_DoubleRotatingMace_StompRt:
YI_NorSpr103_BooGuysMovingMace_StompRt:
YI_NorSpr104_JeanDeFillet_StompRt:
YI_NorSpr105_BooGuysCarryingBombToLeft_StompRt:
YI_NorSpr106_BooGuysCarryingBombToRight_StompRt:
YI_NorSpr108_Milde_StompRt:
YI_NorSpr109_BronzeTapTap_StompRt:
YI_NorSpr10A_SilverTapTap_StompRt:
YI_NorSpr10B_HoppingSilverTapTap_StompRt:
YI_NorSpr10C_ChainedSpikeBall_StompRt:
YI_NorSpr10D_BooGuyOperatingPulley_StompRt:
YI_NorSpr10E_CrateWith6Stars_StompRt:
YI_NorSpr10F_BooManBluff_StompRt:
YI_NorSpr110_Flower_StompRt:
YI_NorSpr111_GeorgetteJelly_StompRt:
YI_NorSpr112_GeorgetteJellyGoo_StompRt:
YI_NorSpr113_Snifit_StompRt:
YI_NorSpr114_SnifitBullet_StompRt:
YI_NorSpr115_Coin_StompRt:
YI_NorSpr116_BuoyantRoundPlatform_StompRt:
YI_NorSpr117_DonutLift_StompRt:
YI_NorSpr118_LargeDonutLift_StompRt:
YI_NorSpr119_Spooky_StompRt:
YI_NorSpr11A_GreenGlove_StompRt:
YI_NorSpr11C_LakituCloud_StompRt:
YI_NorSpr11D_SpinyEgg_StompRt:
YI_NorSpr11E_BrownArrowWheel_StompRt:
YI_NorSpr11F_BlueArrowWheel_StompRt:
YI_NorSpr120_DoubledSidedArrowLift_StompRt:
YI_NorSpr121_NumberPlatformExplosion_StompRt:
YI_NorSpr122_BucketWithBandit_StompRt:
YI_NorSpr123_BucketWithCoins_StompRt:
YI_NorSpr125_AttackingAndEndingKamek_StompRt:
YI_NorSpr126_SpikedLogOnPulley_StompRt:
YI_NorSpr127_PulleyOfSpikedLog_StompRt:
YI_NorSpr128_GroundRippleInBabyBowerRoom_StompRt:
YI_NorSpr129_Fuzzy_StompRt:
YI_NorSpr12A_ShyGuyBanditTrap_StompRt:
YI_NorSpr12B_FatGuy_StompRt:
YI_NorSpr12D_PrologueCutsceneYoshi_StompRt:
YI_NorSpr12E_LargePopEffect_StompRt:
YI_NorSpr12F_HorizontalLavaDrop_StompRt:
YI_NorSpr130_VerticalLavaDrop_StompRt:
YI_NorSpr131_LockedDoor_StompRt:
YI_NorSpr132_LemonDrop_StompRt:
YI_NorSpr134_BabyBowser_StompRt:
YI_NorSpr135_CirclingRaven_StompRt:
YI_NorSpr136_CirclingRaven_StompRt:
YI_NorSpr137_3x6FallingStone_StompRt:
YI_NorSpr138_3x3FallingStone_StompRt:
YI_NorSpr139_3x9FallingStone_StompRt:
YI_NorSpr13A_6x3FallingStone_StompRt:
YI_NorSpr13B_StomachAcid_StompRt:
YI_NorSpr13C_DownFlippers_StompRt:
YI_NorSpr13D_DanglingFang_StompRt:
YI_NorSpr13E_FlyingFang_StompRt:
YI_NorSpr13F_SwimmingFlopsyFish_StompRt:
YI_NorSpr140_SwimmingAndJumpingFlopsyFish_StompRt:
YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_StompRt:
YI_NorSpr142_3JumpFlopsyFish_StompRt:
YI_NorSpr143_SprayFish_StompRt:
YI_NorSpr144_RightOrLeftFlippers_StompRt:
YI_NorSpr147_HorizontalEntranceToLeft_StompRt:
YI_NorSpr148_LargeSpringBall_StompRt:
YI_NorSpr149_UpArrowCloud_StompRt:
YI_NorSpr14A_UpRightArrowCloud_StompRt:
YI_NorSpr14B_RightArrowCloud_StompRt:
YI_NorSpr14C_DownRightArrowCloud_StompRt:
YI_NorSpr14D_DownArrowCloud_StompRt:
YI_NorSpr14E_DownLeftArrowCloud_StompRt:
YI_NorSpr14F_LeftArrowCloud_StompRt:
YI_NorSpr150_UpLeftArrowCloud_StompRt:
YI_NorSpr151_RotatingArrowCloud_StompRt:
YI_NorSpr152_Flutter_StompRt:
YI_NorSpr153_GoonieWithShyGuy_StompRt:
YI_NorSpr154_SharkChomp_StompRt:
YI_NorSpr155_FatGoonie_StompRt:
YI_NorSpr156_CactusJack_StompRt:
YI_NorSpr158_BowlingGoonie_StompRt:
YI_NorSpr159_WalkingGrunt_StompRt:
YI_NorSpr15A_RunningGrunt_StompRt:
YI_NorSpr15B_DancingSpearGuy_StompRt:
YI_NorSpr15C_GreenRotatingPlatformSwitch_StompRt:
YI_NorSpr15D_RedRotatingPlatformSwitch_StompRt:
YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_StompRt:
YI_NorSpr15F_GreenSpikedPlatform_StompRt:
YI_NorSpr160_RedSpikedPlatform_StompRt:
YI_NorSpr161_RewardItemForDefeatingRoomEnemies_StompRt:
YI_NorSpr162_DoubleSpikePlatformWithSwitch_StompRt:
YI_NorSpr163_BouncingNeedlenose_StompRt:
YI_NorSpr164_NipperPlant_StompRt:
YI_NorSpr165_NipperSpore_StompRt:
YI_NorSpr171_NavalPiranha_StompRt:
YI_NorSpr172_NavalPiranhaBuds_StompRt:
YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_StompRt:
YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_StompRt:
YI_NorSpr175_BaronVonZeppelinCarryingBomb_StompRt:
YI_NorSpr176_BaronVonZeppelinCarryingBandit_StompRt:
YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_StompRt:
YI_NorSpr178_BaronVonZeppelinCarrying1up_StompRt:
YI_NorSpr179_BaronVonZeppelinCarryingKey_StompRt:
YI_NorSpr17A_BaronVonZeppelinCarryingCoins_StompRt:
YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_StompRt:
YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_StompRt:
YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_StompRt:
YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_StompRt:
YI_NorSpr17F_BaronVonZeppelin_StompRt:
YI_NorSpr180_SpinningLog_StompRt:
YI_NorSpr182_Dragonfly_StompRt:
YI_NorSpr183_Butterfly_StompRt:
YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_StompRt:
YI_NorSpr186_MovingLineGuidedGreenPlatformRight_StompRt:
YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_StompRt:
YI_NorSpr188_MovingLineGuidedYellowPlatformRight_StompRt:
YI_NorSpr189_LineGuidedGreenPlatformLeft_StompRt:
YI_NorSpr18A_LineGuidedGreenPlatformRight_StompRt:
YI_NorSpr18B_LineGuidedYellowPlatformLeft_StompRt:
YI_NorSpr18C_LineGuidedYellowPlatformRight_StompRt:
YI_NorSpr18D_LineGuidedRedPlatformLeft_StompRt:
YI_NorSpr18E_LineGuidedGreenPlatformRight_StompRt:
YI_NorSpr18F_SpiralPlatform_StompRt:
YI_NorSpr190_FallingIcicle_StompRt:
YI_NorSpr191_Bird_StompRt:
YI_NorSpr192_PetalGuy_StompRt:
YI_NorSpr193_SnakeCagedGhost_StompRt:
YI_NorSpr194_Blargg_StompRt:
YI_NorSpr195_SmallUnstableSnowPlatform_StompRt:
YI_NorSpr196_UnstableSnowPlatform_StompRt:
YI_NorSpr197_ArrowSign_StompRt:
YI_NorSpr198_DiagonalArrowSign_StompRt:
YI_NorSpr199_DizzyDandy_StompRt:
YI_NorSpr19E_WinglessSkeletonGoonie_StompRt:
YI_NorSpr1A0_DoubleFirebar_StompRt:
YI_NorSpr1A1_Firebar_StompRt:
YI_NorSpr1A2_HealthStar_StompRt:
YI_NorSpr1A3_LittleSkullMouser_StompRt:
YI_NorSpr1A4_KeyholeCork_StompRt:
YI_NorSpr1AA_HotLips_StompRt:
YI_NorSpr1AC_SmallFrog_StompRt:
YI_NorSpr1AE_MagicShot_StompRt:
YI_NorSpr1AF_FloatingCoin_StompRt:
YI_NorSpr1B0_DeflatingBalloon_StompRt:
YI_NorSpr1B1_CoinCannon_StompRt:
YI_NorSpr1B2_MinigameCoin_StompRt:
YI_NorSpr1B3_GatherCoinsBandit_StompRt:
YI_NorSpr1B4_MinigameCheckeredPlatform_StompRt:
YI_NorSpr1B5_PoppingBalloonsBandit_StompRt:
YI_NorSpr1B6_MinigameBalloon_StompRt:
YI_NorSpr1B8_WatermelonPot_StompRt:
YI_NorSpr1B9_P2SeedSpittingMinigameBandit_StompRt:
YI_NorSpr000_LavaLog_RideYoshiRt:
YI_NorSpr001_ClosedDoor_RideYoshiRt:
YI_NorSpr002_NavalPiranhaVines_RideYoshiRt:
YI_NorSpr003_CrateWithKey_RideYoshiRt:
YI_NorSpr004_HitSuperBabyMarioBlock_RideYoshiRt:
YI_NorSpr005_IcyWatermelon_RideYoshiRt:
YI_NorSpr006_WatermelonFreeze_RideYoshiRt:
YI_NorSpr007_Watermelon_RideYoshiRt:
YI_NorSpr008_FallingRubble_RideYoshiRt:
YI_NorSpr009_FireWatermelon_RideYoshiRt:
YI_NorSpr00A_Kaboomba_RideYoshiRt:
YI_NorSpr00B_Cannonball_RideYoshiRt:
YI_NorSpr00C_RaphaelTheRaven_RideYoshiRt:
YI_NorSpr00D_GoalRing_RideYoshiRt:
YI_NorSpr00E_GOALLetters_RideYoshiRt:
YI_NorSpr00F_BonusChallengeSign_RideYoshiRt:
YI_NorSpr010_RoundedCagedGhost_RideYoshiRt:
YI_NorSpr011_ItemCard_RideYoshiRt:
YI_NorSpr012_BossDoor_RideYoshiRt:
YI_NorSpr013_BossExplosion_RideYoshiRt:
YI_NorSpr014_KeyFromBoss_RideYoshiRt:
YI_NorSpr015_SubmarineTorpedo_RideYoshiRt:
YI_NorSpr016_BiggerBoo_RideYoshiRt:
YI_NorSpr017_FrogPirate_RideYoshiRt:
YI_NorSpr018_WatermelonFlame_RideYoshiRt:
YI_NorSpr019_Bubble_RideYoshiRt:
YI_NorSpr01A_SkiLift_RideYoshiRt:
YI_NorSpr01B_VerticalLavaLog_RideYoshiRt:
YI_NorSpr01C_DrFreezegood_RideYoshiRt:
YI_NorSpr01D_DrFreezegoodOnSkiLift_RideYoshiRt:
YI_NorSpr01E_Shyguy_RideYoshiRt:
YI_NorSpr01F_RotatingDoors_RideYoshiRt:
YI_NorSpr020_Bandit_RideYoshiRt:
YI_NorSpr021_Bucket_RideYoshiRt:
YI_NorSpr022_FlashingEgg_RideYoshiRt:
YI_NorSpr023_RedEgg_RideYoshiRt:
YI_NorSpr024_YellowEgg_RideYoshiRt:
YI_NorSpr025_GreenEgg_RideYoshiRt:
YI_NorSpr026_BowserFightGiantEgg_RideYoshiRt:
YI_NorSpr027_Key_RideYoshiRt:
YI_NorSpr028_HuffinPuffin_RideYoshiRt:
YI_NorSpr029_GiantEgg_RideYoshiRt:
YI_NorSpr02A_RedGiantEgg_RideYoshiRt:
YI_NorSpr02B_GreenGiantEgg_RideYoshiRt:
YI_NorSpr02C_LungeFish_RideYoshiRt:
YI_NorSpr02D_SalvoTheSlime_RideYoshiRt:
YI_NorSpr02E_EyesOfSalvoTheSlime_RideYoshiRt:
YI_NorSpr02F_LittleMouserHole_RideYoshiRt:
YI_NorSpr030_LittleMouser_RideYoshiRt:
YI_NorSpr031_PottedSpikedFunGuy_RideYoshiRt:
YI_NorSpr032_PeekingLittleMouser_RideYoshiRt:
YI_NorSpr033_LittleMouserExitingNest_RideYoshiRt:
YI_NorSpr034_RogersPot_RideYoshiRt:
YI_NorSpr035_RogerThePottedGhost_RideYoshiRt:
YI_NorSpr036_FallingWall_RideYoshiRt:
YI_NorSpr038_PottedGhostFlame_RideYoshiRt:
YI_NorSpr039_HorizontalRotatingPlank_RideYoshiRt:
YI_NorSpr03A_3MiniRavens_RideYoshiRt:
YI_NorSpr03B_MiniRaven_RideYoshiRt:
YI_NorSpr03C_TapTapTheRedNose_RideYoshiRt:
YI_NorSpr03D_LargeSeesaw_RideYoshiRt:
YI_NorSpr03E_ThinPlatform_RideYoshiRt:
YI_NorSpr03F_SlimeBlock_RideYoshiRt:
YI_NorSpr040_BabyLuigi_RideYoshiRt:
YI_NorSpr041_Stork_RideYoshiRt:
YI_NorSpr042_VerticalPipeEntrance_RideYoshiRt:
YI_NorSpr043_RedGiantShyguy_RideYoshiRt:
YI_NorSpr044_GreenGiantShyguy_RideYoshiRt:
YI_NorSpr045_PrinceFroggy_RideYoshiRt:
YI_NorSpr046_BurtTheBashful_RideYoshiRt:
YI_NorSpr047_ShyguyPushingRoger_RideYoshiRt:
YI_NorSpr048_CutsceneKamek_RideYoshiRt:
YI_NorSpr049_ThunderLakituFireBlast1_RideYoshiRt:
YI_NorSpr04A_ThunderLakituFireBlast2_RideYoshiRt:
YI_NorSpr04B_ThunderLakituFireBlast3_RideYoshiRt:
YI_NorSpr04C_UpsidedownBlowHard_RideYoshiRt:
YI_NorSpr04D_UnusedSpriteIndex_RideYoshiRt:
YI_NorSpr04E_LockedDoor_RideYoshiRt:
YI_NorSpr04F_MiddleRing_RideYoshiRt:
YI_NorSpr050_GreyRotatingWoodenBoard_RideYoshiRt:
YI_NorSpr051_LargeWheel_RideYoshiRt:
YI_NorSpr052_BalloonPlatform_RideYoshiRt:
YI_NorSpr053_KamekSayingOhMy_RideYoshiRt:
YI_NorSpr054_UpsideDownPiranhaPlant_RideYoshiRt:
YI_NorSpr055_4GreenRotatingPlatforms_RideYoshiRt:
YI_NorSpr056_4PinkRotatingPlatforms_RideYoshiRt:
YI_NorSpr057_SewerGhostWithPlatform_RideYoshiRt:
YI_NorSpr058_GreenToady_RideYoshiRt:
YI_NorSpr059_StationarySuperStar_RideYoshiRt:
YI_NorSpr05A_RaphaelSparkAttack_RideYoshiRt:
YI_NorSpr05B_RedCoinBandit_RideYoshiRt:
YI_NorSpr05C_PinkToady_RideYoshiRt:
YI_NorSpr05D_GlitchedSprite_RideYoshiRt:
YI_NorSpr05E_BrownWoodenBoard_RideYoshiRt:
YI_NorSpr05F_AutoRotateBrownWoodenBoard_RideYoshiRt:
YI_NorSpr060_Bomb_RideYoshiRt:
YI_NorSpr062_Goomba_RideYoshiRt:
YI_NorSpr063_MuddyBuddy_RideYoshiRt:
YI_NorSpr064_4AutoRotatingPinkPlatforms_RideYoshiRt:
YI_NorSpr065_RedCoin_RideYoshiRt:
YI_NorSpr066_PiranhaPlant_RideYoshiRt:
YI_NorSpr067_RockRevealedHiddenWingedCloud_RideYoshiRt:
YI_NorSpr068_FlashingEggBlock_RideYoshiRt:
YI_NorSpr069_RedEggBlock_RideYoshiRt:
YI_NorSpr06A_YellowEggBlock_RideYoshiRt:
YI_NorSpr06B_GreenEggBlock_RideYoshiRt:
YI_NorSpr06C_LargeSpringBall_RideYoshiRt:
YI_NorSpr06D_ClockwiseHootieTheBlueFish_RideYoshiRt:
YI_NorSpr06E_CounterclockwiseHootieTheBlueFish_RideYoshiRt:
YI_NorSpr06F_SpringBall_RideYoshiRt:
YI_NorSpr070_Clawdaddy_RideYoshiRt:
YI_NorSpr071_BigBoo_RideYoshiRt:
YI_NorSpr072_TrainBandit_RideYoshiRt:
YI_NorSpr073_BalloonPump_RideYoshiRt:
YI_NorSpr074_Spike_RideYoshiRt:
YI_NorSpr075_SpikeBall_RideYoshiRt:
YI_NorSpr076_ClockwisePiroDangle_RideYoshiRt:
YI_NorSpr077_CounterclockwisePiroDangle_RideYoshiRt:
YI_NorSpr078_RedBulletBillShooter_RideYoshiRt:
YI_NorSpr079_YellowBulletBillShooter_RideYoshiRt:
YI_NorSpr07A_GreenBulletBillShooter_RideYoshiRt:
YI_NorSpr07B_RedBulletBill_RideYoshiRt:
YI_NorSpr07C_YellowBulletBill_RideYoshiRt:
YI_NorSpr07D_GreenBulletBill_RideYoshiRt:
YI_NorSpr07E_DentOfSquishyPlatform_RideYoshiRt:
YI_NorSpr07F_LogSeesawPlatform_RideYoshiRt:
YI_NorSpr080_StraightLavaBubble_RideYoshiRt:
YI_NorSpr081_FollowingLavaBubble_RideYoshiRt:
YI_NorSpr082_ChainChomp_RideYoshiRt:
YI_NorSpr083_BowserFightCloud_RideYoshiRt:
YI_NorSpr084_TeleportSprite_RideYoshiRt:
YI_NorSpr085_HarryHedgehog_RideYoshiRt:
YI_NorSpr086_GlitchedSprite_RideYoshiRt:
YI_NorSpr087_MockUpLaidEgg_RideYoshiRt:
YI_NorSpr088_SuperStar_RideYoshiRt:
YI_NorSpr089_HorizontalMovingRedPlatform_RideYoshiRt:
YI_NorSpr08A_VerticalMovingPinkPlatform_RideYoshiRt:
YI_NorSpr08B_MockUp_RideYoshiRt:
YI_NorSpr08C_YoshiAtGoal_RideYoshiRt:
YI_NorSpr08D_Flyguy_RideYoshiRt:
YI_NorSpr08E_BowserRoomKamek_RideYoshiRt:
YI_NorSpr08F_MonkeySwing_RideYoshiRt:
YI_NorSpr090_DanglingGhost_RideYoshiRt:
YI_NorSpr091_4RedToadies_RideYoshiRt:
YI_NorSpr092_MelonBug_RideYoshiRt:
YI_NorSpr093_Door_RideYoshiRt:
YI_NorSpr094_ExpandingBlock_RideYoshiRt:
YI_NorSpr095_BlueCheckeredBlock_RideYoshiRt:
YI_NorSpr096_RedCheckeredBlock_RideYoshiRt:
YI_NorSpr097_POWBlock_RideYoshiRt:
YI_NorSpr098_EndTransformationBlock_RideYoshiRt:
YI_NorSpr099_SpinyEgg_RideYoshiRt:
YI_NorSpr09A_SwingingGreenPlatform_RideYoshiRt:
YI_NorSpr09B_MaceGuy_RideYoshiRt:
YI_NorSpr09C_Mace_RideYoshiRt:
YI_NorSpr09D_RedSwitch_RideYoshiRt:
YI_NorSpr09E_ChompRock_RideYoshiRt:
YI_NorSpr09F_PtooiePiranhaPlant_RideYoshiRt:
YI_NorSpr0A0_Tulip_RideYoshiRt:
YI_NorSpr0A1_SmallPot_RideYoshiRt:
YI_NorSpr0A2_ThunderLakituFireball_RideYoshiRt:
YI_NorSpr0A3_LeftHidingBandit_RideYoshiRt:
YI_NorSpr0A4_RightHidingBandit_RideYoshiRt:
YI_NorSpr0A5_NepEnut_RideYoshiRt:
YI_NorSpr0A6_IncomingChomp_RideYoshiRt:
YI_NorSpr0A7_GroupOfIncomingChomps_RideYoshiRt:
YI_NorSpr0A8_FallingIncomingChomp_RideYoshiRt:
YI_NorSpr0A9_IncomingChompShadow_RideYoshiRt:
YI_NorSpr0AA_BackgroundShyguy_RideYoshiRt:
YI_NorSpr0AB_FullEggSpawner_RideYoshiRt:
YI_NorSpr0AC_FallingRockArrowAndShadow_RideYoshiRt:
YI_NorSpr0AD_MessageBox_RideYoshiRt:
YI_NorSpr0AE_HookbillTheKoopa_RideYoshiRt:
YI_NorSpr0AF_CarMorphBubble_RideYoshiRt:
YI_NorSpr0B0_MoleMorphBubble_RideYoshiRt:
YI_NorSpr0B1_HelicopterMorphBubble_RideYoshiRt:
YI_NorSpr0B2_TrainMorphBubble_RideYoshiRt:
YI_NorSpr0B3_FuzzyFart_RideYoshiRt:
YI_NorSpr0B4_SubmarineMorphBubble_RideYoshiRt:
YI_NorSpr0B5_HiddenWingedCloud_RideYoshiRt:
YI_NorSpr0B6_WingedCloudWith8Coins_RideYoshiRt:
YI_NorSpr0B7_WingedCloudWithBubbled1up_RideYoshiRt:
YI_NorSpr0B8_WingedCloudWithFlower_RideYoshiRt:
YI_NorSpr0B9_WingedCloudWithPOW_RideYoshiRt:
YI_NorSpr0BA_WingedCloudWithStairs_RideYoshiRt:
YI_NorSpr0BB_WingedCloudWithPlatform_RideYoshiRt:
YI_NorSpr0BC_WingedCloudWithBandit_RideYoshiRt:
YI_NorSpr0BD_WingedCloudWithCoin_RideYoshiRt:
YI_NorSpr0BE_WingedCloudWith1up_RideYoshiRt:
YI_NorSpr0BF_WingedCloudWithKey_RideYoshiRt:
YI_NorSpr0C0_WingedCloudWith3Stars_RideYoshiRt:
YI_NorSpr0C1_WingedCloudWith5Stars_RideYoshiRt:
YI_NorSpr0C2_WingedCloudWithDoor_RideYoshiRt:
YI_NorSpr0C3_WingedCloudWithLowerGround_RideYoshiRt:
YI_NorSpr0C4_WingedCloudWithWatermelon_RideYoshiRt:
YI_NorSpr0C5_WingedCloudWithFireWatermelon_RideYoshiRt:
YI_NorSpr0C6_WingedCloudWithIcyWatermelon_RideYoshiRt:
YI_NorSpr0C7_WingedCloudWith3LeafSunflower_RideYoshiRt:
YI_NorSpr0C8_WingedCloudWith6LeafSunflower_RideYoshiRt:
YI_NorSpr0C9_WingedCloudWithCrashGameFeature_RideYoshiRt:
YI_NorSpr0CA_BigBossDoor_RideYoshiRt:
YI_NorSpr0CB_WingedCloudWithCoinOrStar_RideYoshiRt:
YI_NorSpr0CC_WingedCloudWithRedSwitch_RideYoshiRt:
YI_NorSpr0CD_BaronVonZeppelinCarryingGiantEgg_RideYoshiRt:
YI_NorSpr0CE_BowserFire_RideYoshiRt:
YI_NorSpr0CF_BowserRocks_RideYoshiRt:
YI_NorSpr0D0_HorizontalEntranceToRight_RideYoshiRt:
YI_NorSpr0D1_SecretPipeEntrance_RideYoshiRt:
YI_NorSpr0D2_MarchingMilde_RideYoshiRt:
YI_NorSpr0D3_LargeMilde_RideYoshiRt:
YI_NorSpr0D4_MediumMilde_RideYoshiRt:
YI_NorSpr0D5_BackgroundForHookbillFight_RideYoshiRt:
YI_NorSpr0D6_FortGhostWithPlatform_RideYoshiRt:
YI_NorSpr0D7_SluggyTheUnshaven_RideYoshiRt:
YI_NorSpr0D8_ChompWarningSign_RideYoshiRt:
YI_NorSpr0D9_FishinLakitu_RideYoshiRt:
YI_NorSpr0DA_FlowerPot_RideYoshiRt:
YI_NorSpr0DB_SoftBlock_RideYoshiRt:
YI_NorSpr0DC_Snowball_RideYoshiRt:
YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_RideYoshiRt:
YI_NorSpr0DE_FallingRockPlatform_RideYoshiRt:
YI_NorSpr0DF_PiscatoryPete_RideYoshiRt:
YI_NorSpr0E0_PreyingMantas_RideYoshiRt:
YI_NorSpr0E1_LochNestor_RideYoshiRt:
YI_NorSpr0E2_BooBlah_RideYoshiRt:
YI_NorSpr0E3_BooBlahWithPiroDangle_RideYoshiRt:
YI_NorSpr0E4_HeadingCactus_RideYoshiRt:
YI_NorSpr0E5_GreenNeedlenose_RideYoshiRt:
YI_NorSpr0E6_Gusty_RideYoshiRt:
YI_NorSpr0E7_Burt_RideYoshiRt:
YI_NorSpr0E8_Goonie_RideYoshiRt:
YI_NorSpr0E9_3WinglessGoonies_RideYoshiRt:
YI_NorSpr0EA_VerticalCloudDrop_RideYoshiRt:
YI_NorSpr0EB_HorizontalCloudDrop_RideYoshiRt:
YI_NorSpr0EC_JumpingFlamerGuy_RideYoshiRt:
YI_NorSpr0ED_RunningFlamerGuy_RideYoshiRt:
YI_NorSpr0EE_EggoDil_RideYoshiRt:
YI_NorSpr0EF_EggoDilFace_RideYoshiRt:
YI_NorSpr0F0_EggoDilPetal_RideYoshiRt:
YI_NorSpr0F1_EggPlantShootingBubbles_RideYoshiRt:
YI_NorSpr0F2_ShyguyOnStilts_RideYoshiRt:
YI_NorSpr0F3_WoozyGuy_RideYoshiRt:
YI_NorSpr0F4_EggPlant_RideYoshiRt:
YI_NorSpr0F5_Slugger_RideYoshiRt:
YI_NorSpr0F6_MotherHuffinPuffin_RideYoshiRt:
YI_NorSpr0F7_BarneyBubble_RideYoshiRt:
YI_NorSpr0F8_BlowHard_RideYoshiRt:
YI_NorSpr0F9_YellowNeedlenose_RideYoshiRt:
YI_NorSpr0FA_Flower_RideYoshiRt:
YI_NorSpr0FB_LongSpearGuy_RideYoshiRt:
YI_NorSpr0FC_ShortSpearGuy_RideYoshiRt:
YI_NorSpr0FD_ZeusGuy_RideYoshiRt:
YI_NorSpr0FE_ZeusGuyBlast_RideYoshiRt:
YI_NorSpr0FF_Poochy_RideYoshiRt:
YI_NorSpr100_Bubbled1up_RideYoshiRt:
YI_NorSpr101_RotatingMace_RideYoshiRt:
YI_NorSpr102_DoubleRotatingMace_RideYoshiRt:
YI_NorSpr103_BooGuysMovingMace_RideYoshiRt:
YI_NorSpr104_JeanDeFillet_RideYoshiRt:
YI_NorSpr105_BooGuysCarryingBombToLeft_RideYoshiRt:
YI_NorSpr106_BooGuysCarryingBombToRight_RideYoshiRt:
YI_NorSpr107_WatermelonSeed_RideYoshiRt:
YI_NorSpr108_Milde_RideYoshiRt:
YI_NorSpr109_BronzeTapTap_RideYoshiRt:
YI_NorSpr10A_SilverTapTap_RideYoshiRt:
YI_NorSpr10B_HoppingSilverTapTap_RideYoshiRt:
YI_NorSpr10C_ChainedSpikeBall_RideYoshiRt:
YI_NorSpr10D_BooGuyOperatingPulley_RideYoshiRt:
YI_NorSpr10E_CrateWith6Stars_RideYoshiRt:
YI_NorSpr10F_BooManBluff_RideYoshiRt:
YI_NorSpr110_Flower_RideYoshiRt:
YI_NorSpr111_GeorgetteJelly_RideYoshiRt:
YI_NorSpr112_GeorgetteJellyGoo_RideYoshiRt:
YI_NorSpr113_Snifit_RideYoshiRt:
YI_NorSpr114_SnifitBullet_RideYoshiRt:
YI_NorSpr115_Coin_RideYoshiRt:
YI_NorSpr116_BuoyantRoundPlatform_RideYoshiRt:
YI_NorSpr117_DonutLift_RideYoshiRt:
YI_NorSpr118_LargeDonutLift_RideYoshiRt:
YI_NorSpr119_Spooky_RideYoshiRt:
YI_NorSpr11A_GreenGlove_RideYoshiRt:
YI_NorSpr11B_Lakitu_RideYoshiRt:
YI_NorSpr11C_LakituCloud_RideYoshiRt:
YI_NorSpr11D_SpinyEgg_RideYoshiRt:
YI_NorSpr11E_BrownArrowWheel_RideYoshiRt:
YI_NorSpr11F_BlueArrowWheel_RideYoshiRt:
YI_NorSpr120_DoubledSidedArrowLift_RideYoshiRt:
YI_NorSpr121_NumberPlatformExplosion_RideYoshiRt:
YI_NorSpr122_BucketWithBandit_RideYoshiRt:
YI_NorSpr123_BucketWithCoins_RideYoshiRt:
YI_NorSpr124_Stretch_RideYoshiRt:
YI_NorSpr125_AttackingAndEndingKamek_RideYoshiRt:
YI_NorSpr126_SpikedLogOnPulley_RideYoshiRt:
YI_NorSpr127_PulleyOfSpikedLog_RideYoshiRt:
YI_NorSpr128_GroundRippleInBabyBowerRoom_RideYoshiRt:
YI_NorSpr129_Fuzzy_RideYoshiRt:
YI_NorSpr12B_FatGuy_RideYoshiRt:
YI_NorSpr12C_FlyOrWhirlyGuy_RideYoshiRt:
YI_NorSpr12D_PrologueCutsceneYoshi_RideYoshiRt:
YI_NorSpr12E_LargePopEffect_RideYoshiRt:
YI_NorSpr12F_HorizontalLavaDrop_RideYoshiRt:
YI_NorSpr130_VerticalLavaDrop_RideYoshiRt:
YI_NorSpr131_LockedDoor_RideYoshiRt:
YI_NorSpr132_LemonDrop_RideYoshiRt:
YI_NorSpr133_LanternGhost_RideYoshiRt:
YI_NorSpr135_CirclingRaven_RideYoshiRt:
YI_NorSpr136_CirclingRaven_RideYoshiRt:
YI_NorSpr137_3x6FallingStone_RideYoshiRt:
YI_NorSpr138_3x3FallingStone_RideYoshiRt:
YI_NorSpr139_3x9FallingStone_RideYoshiRt:
YI_NorSpr13A_6x3FallingStone_RideYoshiRt:
YI_NorSpr13B_StomachAcid_RideYoshiRt:
YI_NorSpr13C_DownFlippers_RideYoshiRt:
YI_NorSpr13D_DanglingFang_RideYoshiRt:
YI_NorSpr13E_FlyingFang_RideYoshiRt:
YI_NorSpr13F_SwimmingFlopsyFish_RideYoshiRt:
YI_NorSpr140_SwimmingAndJumpingFlopsyFish_RideYoshiRt:
YI_NorSpr141_SwimmingAndArcJumpingFlopsyFish_RideYoshiRt:
YI_NorSpr142_3JumpFlopsyFish_RideYoshiRt:
YI_NorSpr143_SprayFish_RideYoshiRt:
YI_NorSpr144_RightOrLeftFlippers_RideYoshiRt:
YI_NorSpr145_BlueSluggy_RideYoshiRt:
YI_NorSpr146_PinkSluggy_RideYoshiRt:
YI_NorSpr147_HorizontalEntranceToLeft_RideYoshiRt:
YI_NorSpr148_LargeSpringBall_RideYoshiRt:
YI_NorSpr149_UpArrowCloud_RideYoshiRt:
YI_NorSpr14A_UpRightArrowCloud_RideYoshiRt:
YI_NorSpr14B_RightArrowCloud_RideYoshiRt:
YI_NorSpr14C_DownRightArrowCloud_RideYoshiRt:
YI_NorSpr14D_DownArrowCloud_RideYoshiRt:
YI_NorSpr14E_DownLeftArrowCloud_RideYoshiRt:
YI_NorSpr14F_LeftArrowCloud_RideYoshiRt:
YI_NorSpr150_UpLeftArrowCloud_RideYoshiRt:
YI_NorSpr151_RotatingArrowCloud_RideYoshiRt:
YI_NorSpr152_Flutter_RideYoshiRt:
YI_NorSpr153_GoonieWithShyGuy_RideYoshiRt:
YI_NorSpr154_SharkChomp_RideYoshiRt:
YI_NorSpr155_FatGoonie_RideYoshiRt:
YI_NorSpr156_CactusJack_RideYoshiRt:
YI_NorSpr157_WallLakitu_RideYoshiRt:
YI_NorSpr158_BowlingGoonie_RideYoshiRt:
YI_NorSpr159_WalkingGrunt_RideYoshiRt:
YI_NorSpr15A_RunningGrunt_RideYoshiRt:
YI_NorSpr15B_DancingSpearGuy_RideYoshiRt:
YI_NorSpr15C_GreenRotatingPlatformSwitch_RideYoshiRt:
YI_NorSpr15D_RedRotatingPlatformSwitch_RideYoshiRt:
YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys_RideYoshiRt:
YI_NorSpr15F_GreenSpikedPlatform_RideYoshiRt:
YI_NorSpr160_RedSpikedPlatform_RideYoshiRt:
YI_NorSpr161_RewardItemForDefeatingRoomEnemies_RideYoshiRt:
YI_NorSpr162_DoubleSpikePlatformWithSwitch_RideYoshiRt:
YI_NorSpr163_BouncingNeedlenose_RideYoshiRt:
YI_NorSpr164_NipperPlant_RideYoshiRt:
YI_NorSpr165_NipperSpore_RideYoshiRt:
YI_NorSpr166_ThunderLakitu_RideYoshiRt:
YI_NorSpr167_GreenKoopaShell_RideYoshiRt:
YI_NorSpr168_RedKoopaShell_RideYoshiRt:
YI_NorSpr169_GreenNakedKoopa_RideYoshiRt:
YI_NorSpr16A_RedNakedKoopa_RideYoshiRt:
YI_NorSpr16B_GreenKoopa_RideYoshiRt:
YI_NorSpr16C_RedKoopa_RideYoshiRt:
YI_NorSpr16D_GreenParakoopa_RideYoshiRt:
YI_NorSpr16E_RedHorizontalParakoopa_RideYoshiRt:
YI_NorSpr16F_RedVerticalParakoopa_RideYoshiRt:
YI_NorSpr170_AquaLakitu_RideYoshiRt:
YI_NorSpr171_NavalPiranha_RideYoshiRt:
YI_NorSpr172_NavalPiranhaBuds_RideYoshiRt:
YI_NorSpr173_BaronVonZeppelinCarryingShyGuy_RideYoshiRt:
YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_RideYoshiRt:
YI_NorSpr175_BaronVonZeppelinCarryingBomb_RideYoshiRt:
YI_NorSpr176_BaronVonZeppelinCarryingBandit_RideYoshiRt:
YI_NorSpr177_BaronVonZeppelinCarryingLargeSpringBall_RideYoshiRt:
YI_NorSpr178_BaronVonZeppelinCarrying1up_RideYoshiRt:
YI_NorSpr179_BaronVonZeppelinCarryingKey_RideYoshiRt:
YI_NorSpr17A_BaronVonZeppelinCarryingCoins_RideYoshiRt:
YI_NorSpr17B_BaronVonZeppelinCarryingWatermelon_RideYoshiRt:
YI_NorSpr17C_BaronVonZeppelinCarryingFireWatermelon_RideYoshiRt:
YI_NorSpr17D_BaronVonZeppelinCarryingIcyWatermelon_RideYoshiRt:
YI_NorSpr17E_BaronVonZeppelinCarryingCrateWith6Stars_RideYoshiRt:
YI_NorSpr17F_BaronVonZeppelin_RideYoshiRt:
YI_NorSpr180_SpinningLog_RideYoshiRt:
YI_NorSpr181_CrazeeDayzee_RideYoshiRt:
YI_NorSpr182_Dragonfly_RideYoshiRt:
YI_NorSpr183_Butterfly_RideYoshiRt:
YI_NorSpr184_Bumpty_RideYoshiRt:
YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_RideYoshiRt:
YI_NorSpr186_MovingLineGuidedGreenPlatformRight_RideYoshiRt:
YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_RideYoshiRt:
YI_NorSpr188_MovingLineGuidedYellowPlatformRight_RideYoshiRt:
YI_NorSpr189_LineGuidedGreenPlatformLeft_RideYoshiRt:
YI_NorSpr18A_LineGuidedGreenPlatformRight_RideYoshiRt:
YI_NorSpr18B_LineGuidedYellowPlatformLeft_RideYoshiRt:
YI_NorSpr18C_LineGuidedYellowPlatformRight_RideYoshiRt:
YI_NorSpr18D_LineGuidedRedPlatformLeft_RideYoshiRt:
YI_NorSpr18E_LineGuidedGreenPlatformRight_RideYoshiRt:
YI_NorSpr18F_SpiralPlatform_RideYoshiRt:
YI_NorSpr190_FallingIcicle_RideYoshiRt:
YI_NorSpr191_Bird_RideYoshiRt:
YI_NorSpr192_PetalGuy_RideYoshiRt:
YI_NorSpr193_SnakeCagedGhost_RideYoshiRt:
YI_NorSpr194_Blargg_RideYoshiRt:
YI_NorSpr195_SmallUnstableSnowPlatform_RideYoshiRt:
YI_NorSpr196_UnstableSnowPlatform_RideYoshiRt:
YI_NorSpr197_ArrowSign_RideYoshiRt:
YI_NorSpr198_DiagonalArrowSign_RideYoshiRt:
YI_NorSpr199_DizzyDandy_RideYoshiRt:
YI_NorSpr19A_BooGuy_RideYoshiRt:
YI_NorSpr19B_TacklingBumpty_RideYoshiRt:
YI_NorSpr19C_FlyingBumpty_RideYoshiRt:
YI_NorSpr19D_SkeletonGoonie_RideYoshiRt:
YI_NorSpr19E_WinglessSkeletonGoonie_RideYoshiRt:
YI_NorSpr19F_SkeletonGoonieCarryingBomb_RideYoshiRt:
YI_NorSpr1A0_DoubleFirebar_RideYoshiRt:
YI_NorSpr1A1_Firebar_RideYoshiRt:
YI_NorSpr1A2_HealthStar_RideYoshiRt:
YI_NorSpr1A3_LittleSkullMouser_RideYoshiRt:
YI_NorSpr1A4_KeyholeCork_RideYoshiRt:
YI_NorSpr1A5_RunAwayMonkey_RideYoshiRt:
YI_NorSpr1A6_MonkeyWithWatermelon_RideYoshiRt:
YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_RideYoshiRt:
YI_NorSpr1A8_TheifMonkey_RideYoshiRt:
YI_NorSpr1A9_HangingMonkeySpittingSeeds_RideYoshiRt:
YI_NorSpr1AA_HotLips_RideYoshiRt:
YI_NorSpr1AB_BooBalloon_RideYoshiRt:
YI_NorSpr1AC_SmallFrog_RideYoshiRt:
YI_NorSpr1AD_MagicShootingKamek_RideYoshiRt:
YI_NorSpr1AE_MagicShot_RideYoshiRt:
YI_NorSpr1AF_FloatingCoin_RideYoshiRt:
YI_NorSpr1B0_DeflatingBalloon_RideYoshiRt:
YI_NorSpr1B1_CoinCannon_RideYoshiRt:
YI_NorSpr1B2_MinigameCoin_RideYoshiRt:
YI_NorSpr1B3_GatherCoinsBandit_RideYoshiRt:
YI_NorSpr1B4_MinigameCheckeredPlatform_RideYoshiRt:
YI_NorSpr1B5_PoppingBalloonsBandit_RideYoshiRt:
YI_NorSpr1B6_MinigameBalloon_RideYoshiRt:
YI_NorSpr1B7_SeedSpittingMinigameBandit_RideYoshiRt:
YI_NorSpr1B8_WatermelonPot_RideYoshiRt:
YI_NorSpr1B9_P2SeedSpittingMinigameBandit_RideYoshiRt:
;$039A6B
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_state_init_entry: alternate entry to CODE_spr_state_init that pulls DBR=$03.
; Used by callers that jumped here from a different bank.  Falls through.
;-------------------------------------------------------------------------
CODE_039A6C:
CODE_spr_state_init_entry:
	PHK                                         ; \ DBR = $03 (sprite-engine bank)
	PLB                                         ; /
;-------------------------------------------------------------------------
; CODE_spr_state_init: state $02/$04 handler -- newly spawned sprite needs its
; Init routine to run.  Transitions the slot to state $10 (alive / Main),
; then resolves the per-sprite Init pointer from DATA_sprite_inits:
;
;   offset = sprite_id * 3  (each entry is a 3-byte `dl` pointer)
;   $00..$02 = DATA_sprite_inits[offset..offset+2]  (24-bit pointer)
;   then JML through $0:7960 (= direct-page word holding the pointer)
;
; Entry invariants: M=16, X=16, X=4-byte slot index, DBR=$03 (set by caller
; PHK/PLB), DP=$7960 (set by CODE_handle_sprites).  The PHY/PLB before JML is
; subtle: it pulls the high byte of the resolved pointer (the bank byte
; stashed in $02 then re-pushed via PHY after the X=8 SEP) into DBR.
; Raidenthequick: CODE_spr_state_init
;-------------------------------------------------------------------------
CODE_039A6E:
CODE_spr_state_init:                                 ; Raidenthequick: CODE_spr_state_init
	LDA.w #$0010                                ; \ new status: $10 (alive, Main running)
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x     ; /
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x          ; \
	ASL                                         ;  | id*3 (pointer-table stride)
	ADC.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x          ; /
	REP.b #$10                                  ; X=16 for word-index into table
	TAY
	LDA.w DATA_sprite_inits,y                         ; \ DATA_sprite_inits[id*3] -> $00 (lo,mid)
	STA.b $00                                   ; /
	LDA.w DATA_sprite_inits+$02,y                     ; \ DATA_sprite_inits[id*3+2] -> $02 (bank)
	STA.b $02                                   ; /
	SEP.b #$10                                  ; X=8
	TAY                                         ; \ Y = bank byte (was A's low after STA above)
	PHY                                         ;  | push bank
	PLB                                         ; / DBR = init-routine's bank
	JMP.w [$7960]                               ; tail-JMP through dp $00..$02 (24-bit ptr)

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_state_main: state $10 handler -- sprite is alive.  Resolves the per-
; sprite Main pointer from DATA_sprite_mains and tail-JMPs into it.
; Same trampoline pattern as CODE_spr_state_init, with two differences:
;   - uses LDA.l (not LDA.w) since some callers tail-call from other banks
;   - preserves X via PHX/PLX (X is the 4-byte slot index used by callers,
;     but the table-walk needs X=16 for byte-stride indexing into a 24-bit
;     dl table -- so X is temporarily clobbered).
;
; This routine is ALSO the shared "run Main again" tail call invoked by
; every other state handler in the engine (CODE_spr_state_tongued, _on_head_bop,
; _die_collision, _die_burning, _ride_yoshi, _turn_star ALL begin with
; `JSL CODE_spr_state_main` to keep the sprite's per-frame animation alive,
; then layer their state-specific overlay on top).
; Raidenthequick: CODE_spr_state_main
;-------------------------------------------------------------------------
CODE_039A90:
CODE_spr_state_main:                                 ; Raidenthequick: CODE_spr_state_main
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x          ; \
	ASL                                         ;  | id*3
	ADC.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x          ; /
	REP.b #$10                                  ; X=16
	PHX                                         ; \ stash 4-byte slot index
	TAX                                         ; / X = table offset
	LDA.l DATA_sprite_mains,x                         ; \ DATA_sprite_mains[id*3] -> $00 (lo,mid)
	STA.b $00                                   ; /
	LDA.l DATA_sprite_mains+$02,x                     ; \ DATA_sprite_mains[id*3+2] -> $02 (bank)
	STA.b $02                                   ; /
	PLX                                         ; restore 4-byte slot index
	SEP.b #$10                                  ; X=8
	TAY
	PHY
	PLB                                         ; DBR = main-routine's bank
	JMP.w [$7960]                               ; tail-JMP via dp $00..$02

;---------------------------------------------------------------------------

DATA_039AB0:
	dw $FF00,$0100

DATA_039AB4:
	dw $FFFE,$0002

DATA_039AB8:
	dw $000C,$FFF4,$0000,$0000

DATA_039AC0:
	dw $FFFC,$FFFC,$FFFA,$FFFA

;-------------------------------------------------------------------------
; CODE_spr_state_tongued: state $08 handler -- sprite is stuck on Yoshi's tongue.
; Runs the per-sprite Main first (to keep its animation alive), then masks
; off bits $000C of the slot's render-control word $7040,x (the "draw
; normally" bits) so the sprite is hidden -- the in-mouth render is drawn
; by Yoshi's player code instead.  After that, runs swallow-progress code
; (mouth-bulge animation, watermelon-flavour detection at the BNE chain
; below, transformation to FlashingEgg/RedEgg/etc on swallow).
; Raidenthequick: CODE_spr_state_tongued
;-------------------------------------------------------------------------
CODE_039AC8:
CODE_spr_state_tongued:                              ; Raidenthequick: CODE_spr_state_tongued
	JSL.l CODE_spr_state_main                           ; run per-sprite Main (= CODE_spr_state_main)
	LDA.w $7040,x                               ; \ render-control word
	AND.w #$FFF3                                ;  | clear "draw normally" bits
	STA.w $7040,x                               ; /
	PHK
	PLB
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_039AE3
	RTL

CODE_039AE3:
	LDY.b #$00
	LDA.w $6164
	BEQ.b CODE_039AFD
	BPL.b CODE_039AEE
	LDY.b #$02
CODE_039AEE:
	CLC
	ADC.w DATA_039AB4,y
	STA.w $6164
	EOR.w DATA_039AB4,y
	BMI.b CODE_039AFD
	STZ.w $6164
CODE_039AFD:
	LDY.b #$00
	LDA.w $6166
	BEQ.b CODE_039B17
	BPL.b CODE_039B08
	LDY.b #$02
CODE_039B08:
	CLC
	ADC.w DATA_039AB4,y
	STA.w $6166
	EOR.w DATA_039AB4,y
	BMI.b CODE_039B17
	STZ.w $6166
CODE_039B17:
	LDA.w $615A
	CLC
	ADC.w $6164
	SEC
	SBC.w #$0008
	STA.w $70E2,x
	LDA.w $615C
	CLC
	ADC.w $6166
	SEC
	SBC.w #$0008
	STA.w $7182,x
	LDA.w $6152
	ORA.w $6154
	BEQ.b CODE_039B3C
CODE_039B3B:
	RTL

CODE_039B3C:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	LDA.w $6168
	BNE.b CODE_039B4B
	JMP.w CODE_swallow_complete_or_egg

CODE_039B4B:
	REP.b #$20
	LDA.w $6162
	BNE.b CODE_swallow_check_egg_range
	JMP.w CODE_039BBC

CODE_039B55:
CODE_swallow_check_egg_range:                        ; if swallowed sprite ID is in [FlashingEgg..GreenGiantEgg], jump to egg-swallow handler
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_swallow_classify_ammo
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_swallow_classify_ammo
	JML.l CODE_03BF87

CODE_039B66:
CODE_swallow_classify_ammo:                          ; classify swallowed sprite into AmmoTypeInMouth (1=fire/lava, 2=bubble, 3=melon, 4=icy melon)
	LDY.b #$01
	CMP.w #!Define_YI_NorSpr009_FireWatermelon
	BEQ.b CODE_swallow_store_ammo_type
	CMP.w #!Define_YI_NorSpr0EC_JumpingFlamerGuy
	BEQ.b CODE_039B81
	CMP.w #!Define_YI_NorSpr0ED_RunningFlamerGuy
	BEQ.b CODE_039B81
	CMP.w #!Define_YI_NorSpr080_StraightLavaBubble
	BEQ.b CODE_039B81
	CMP.w #!Define_YI_NorSpr081_FollowingLavaBubble
	BNE.b CODE_039B86
CODE_039B81:
	STZ.w $7402,x
	BRA.b CODE_swallow_store_ammo_type

CODE_039B86:
	INY
	CMP.w #!Define_YI_NorSpr019_Bubble
	BEQ.b CODE_swallow_store_ammo_type
	INY
	CMP.w #!Define_YI_NorSpr007_Watermelon
	BEQ.b CODE_swallow_store_ammo_type
	INY
	CMP.w #!Define_YI_NorSpr005_IcyWatermelon
	BNE.b CODE_039B3B
CODE_039B98:
CODE_swallow_store_ammo_type:                        ; Y = AmmoTypeInMouth value; stash it and prime cheek-puff timer
	STY.w !EXRAM_YI_Level_Player_AmmoTypeInMouthLo|!EXRAMBankMirror
	LDA.w #$001E
	LDY.w $7402,x
	BEQ.b CODE_swallow_freeze_and_despawn
	LDA.w #$000A
CODE_039BA6:
CODE_swallow_freeze_and_despawn:                     ; set cheek-puff timer + freeze player/sprites, JML to CODE_despawn_sprite_free_slot
	STA.w $6170
	STZ.w $616C
	LDA.w #$0010
	STA.w $616E
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	JML.l CODE_despawn_sprite_free_slot

CODE_039BBC:
	LDA.w $61E0
	CMP.w #$0003
	BCC.b CODE_039BC7
	JMP.w CODE_039DA6

CODE_039BC7:
	LDA.w $6150
	DEC
	ASL
	ORA.w $60C4
	TAY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_039AB8,y
	STA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w DATA_039AC0,y
	STA.w $7182,x
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PHY
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	PLY
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0006
	BEQ.b CODE_039C11
	LDA.w $6168
	STA.w $6162
	STZ.w $6150
	RTL

CODE_039C11:
	STZ.w $6150
	STZ.w $6168
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr01E_Shyguy
	BEQ.b CODE_039C2E
	CMP.w #!Define_YI_NorSpr133_LanternGhost
	BEQ.b CODE_039C2E
	CMP.w #!Define_YI_NorSpr12A_ShyGuyBanditTrap
	BEQ.b CODE_039C2E
	CMP.w #!Define_YI_NorSpr074_Spike
	BNE.b CODE_039C58
CODE_039C2E:
	CPY.b #$04
	BCS.b CODE_039C45
	LDA.w $60C4
	EOR.w #$0002
	STA.w $7400,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSL.l CODE_048B73
	JMP.w CODE_spit_out_apply_speeds

CODE_039C45:
	LDA.w #$0E81
	STA.w $6FA2,x
	LDA.w $7042,x
	ORA.w #$0020
	STA.w $7042,x
	STZ.b $76,x
	BRA.b CODE_039CCD

CODE_039C58:
	CMP.w #!Define_YI_NorSpr017_FrogPirate
	BNE.b CODE_039C64
	JSL.l CODE_0EE0DE
	JMP.w CODE_spit_out_apply_speeds

CODE_039C64:
	CMP.w #!Define_YI_NorSpr092_MelonBug
	BNE.b CODE_039C7D
	STZ.w $7D38,x
	LDA.w #$0010
	STA.w $7AF6,x
	LDA.w #$0002
	STA.w $7402,x
	STA.b $76,x
	JMP.w CODE_spit_out_apply_speeds

CODE_039C7D:
	CPY.b #$04
	BCS.b CODE_039CCD
	CMP.w #!Define_YI_NorSpr19A_BooGuy
	BNE.b CODE_039CB0
	PHY
	JSL.l CODE_039D28
	PLY
	STY.b $00
	JSL.l CODE_03AF0D
	JSL.l CODE_03AD24
	LDY.b #$00
	STY.b $78,x
	LDY.b $00
	PHB
	LDA.w #DATA_0C8D4E>>16
	XBA
	PHA
	PLB
	PLB
	PHY
	JSL.l CODE_0C8E07
	PLY
	JSL.l CODE_0C8D6A
	PLB
	RTL

CODE_039CB0:
	CMP.w #!Define_YI_NorSpr0F3_WoozyGuy
	BNE.b CODE_039CCD
	PHY
	JSL.l CODE_039D28
	PLY
	PHB
	LDY.b #DATA_0CFEC1>>16
	PHY
	PLB
	JSL.l CODE_0CFEDD
	PLB
	SEP.b #$20
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	REP.b #$20
	RTL

CODE_039CCD:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	ASL
	TAX
	LDA.l FXDATA_0AAB14,x
	SEP.b #$10
	LDX.b $12
	CMP.w #$0000
	BEQ.b CODE_039D09
	PHP
	JSL.l CODE_03AF0D
	PLP
	BMI.b CODE_039CFA
	JSL.l CODE_03AD24
	BCC.b CODE_039D09
	LDA.w #$0100
	ORA.w $7402,x
	STA.w $7402,x
	BRA.b CODE_039D09

CODE_039CFA:
	JSL.l CODE_03AD74
	BCC.b CODE_039D09
	LDA.w #$0200
	ORA.w $7402,x
	STA.w $7402,x
CODE_039D09:
	STZ.b $18,x
	STZ.b $16,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.w $7540,x
	LDA.w $6FA2,x
	AND.w #$F83F
	ORA.w #$0040
	STA.w $6FA2,x
CODE_039D28:
	LDA.w #$0020
	STA.w $7D38,x
CODE_039D2E:
CODE_spit_out_apply_speeds:                          ; tongued-sprite spit-out: apply Yoshi-shot X/Y speeds, play SoundID $04 SpitOut, set state = $10 alive
	LDX.b $12
	LDA.w $60E4
	EOR.w $60A8
	ASL
	LDA.w $60E4
	BCS.b CODE_039D3F
	ADC.w $60A8
CODE_039D3F:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $60E6
	SEC
	SBC.w #$0300
	BPL.b CODE_039D4E
	LDA.w #$0000
CODE_039D4E:
	SEC
	SBC.w #$0200
	ADC.w $60E6
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $60C4
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
CODE_039D68:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$00FF
	ORA.w $7862,x
	STA.w $7862,x
	TXY
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	ASL
	TAX
	LDA.l FXDATA_0A9F1A,x
	AND.w #$00FF
	STA.w $74A2,y
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr108_Milde
	BNE.b CODE_039D96
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	BNE.b CODE_039D9A
CODE_039D96:
	LDA.l FXDATA_0A9B1C,x
CODE_039D9A:
	AND.w #$000C
	ORA.w $7040,y
	STA.w $7040,y
	SEP.b #$10
	TYX
CODE_039DA6:
	RTL

CODE_039DA7:
CODE_swallow_complete_or_egg:                        ; swallowed for real: check egg/special transforms; if a regular sprite, pop SoundID $3B and become an egg
	REP.b #$20
	LDA.w $0B57
	ORA.w $0B59
	BEQ.b CODE_039DB5
	JML.l CODE_despawn_sprite_free_slot

CODE_039DB5:
	PHB
	PHK
	PLB
	LDA.w $6150
	BEQ.b CODE_039DC5
	CMP.w #$0043
	BCS.b CODE_039DC5
	JMP.w CODE_039ECE

CODE_039DC5:
	LDA.w $6FA2,x
	BPL.b CODE_039DCD
	JMP.w CODE_039E4E

CODE_039DCD:
	JSL.l CODE_04D1B6
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_03B212
	JSL.l CODE_03AF0D
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr08B_MockUp
	BNE.b CODE_039E01
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w #!Define_YI_NorSpr087_MockUpLaidEgg
	TXY
	JSL.l CODE_03A366
	LDY.w $60C4
	LDA.w DATA_039AB0,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_039E36

CODE_039E01:
	CMP.w #!Define_YI_NorSpr129_Fuzzy
	BNE.b CODE_039E09
	JMP.w CODE_swallowed_fuzzy

CODE_039E09:
	CMP.w #!Define_YI_NorSpr12B_FatGuy
	BEQ.b CODE_039E1C
	JSL.l CODE_05AD01
	LDA.w #!Define_YI_NorSpr025_GreenEgg
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$0D
	BNE.b CODE_039E1F
CODE_039E1C:
	LDA.w #!Define_YI_NorSpr02B_GreenGiantEgg
CODE_039E1F:
	STZ.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	TXY
	JSL.l CODE_03A366
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	JSL.l CODE_03BEB9
	LDA.w #$FFA2
	STA.b $76,x
CODE_039E36:
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w $60C4
	STA.w $7400,x
	PLB
	RTL

CODE_039E4E:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr1A2_HealthStar
	BNE.b CODE_039E85
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	LDA.w #$0003
	STA.w $0004
	JSL.l CODE_03A4C3
	LDA.w $0396
	CLC
	ADC.w #$000A
	STA.w $0396
	LDA.w #$0082
	STA.w $0B7F
	BRA.b CODE_039EC6

CODE_039E85:
	CMP.w #!Define_YI_NorSpr115_Coin
	BNE.b CODE_039EB7
	LDA.w $7042,x
	BIT.w #$0002
	BEQ.b CODE_039EA6
	LDA.w #!Define_YI_SoundID93_RedCoin
	INC.w !RAM_YI_Level_RedCoinsCollectedLo
	LDY.w !RAM_YI_Level_RedCoinsCollectedLo
	CPY.b #$14
	BMI.b CODE_039EA0
	INC
CODE_039EA0:
	JSL.l CODE_push_sound_queue
	BRA.b CODE_039EAD

CODE_039EA6:
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
CODE_039EAD:
	JSL.l CODE_03A520
	JSL.l CODE_0CF957
	BRA.b CODE_039ECA

CODE_039EB7:
	CMP.w #!Define_YI_NorSpr1B2_MinigameCoin
	BNE.b CODE_039EC6
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	INC.w $03BA
CODE_039EC6:
	JSL.l CODE_03B288
CODE_039ECA:
	JSL.l CODE_despawn_sprite_free_slot
CODE_039ECE:
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_039ED0:
	dw $FFF8,$0018

CODE_039ED4:
CODE_swallowed_fuzzy:                                ; Raidenthequick: CODE_swallowed_fuzzy
	LDA.w #!Define_YI_SoundID21_Fuzzy
	JSL.l CODE_push_sound_queue
	LDA.w #$0400
	STA.w $7FE8
	LDA.w #$0003
	STA.w $61CA
	LDA.w #$0010
	STA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	JSL.l CODE_03A31E
	LDA.w #!Define_YI_NorSpr0B3_FuzzyFart
	TXY
	JSL.l CODE_03A366
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0001
	STA.w $7D38,x
	LDY.w $60C4
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w DATA_039ED0,y
	STA.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $7CD8,x
	SEC
	SBC.w #$0008
	STA.w $7182,x
	PLB
CODE_039F2B:
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0006
	STA.w $73C2,y
	STA.w $7E4C,y
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Fuzzy Fart (sprite $0B3) Main.  The "puff cloud" that drifts from a Fuzzy
; after Yoshi swallows one.  Despawns + spawns ambient sprite cloud over time.
; See also: ys_enmy3.asm.
;-------------------------------------------------------------------------
YI_NorSpr0B3_FuzzyFart_Main:
main_fuzzy_wind:                                ; Raidenthequick: main_fuzzy_wind
;$039F4E
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_039F5A
	RTL

CODE_039F5A:
	LDA.w $7A96,x
	BNE.b CODE_039F62
	JMP.w CODE_03A31E

CODE_039F62:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_039F8C
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_039F8C
	LDA.w $7D96,y
	BEQ.b CODE_039F7D
	TYX
	JSL.l CODE_03B595
	LDX.b $12
	RTL

CODE_039F7D:
	LDA.w $6FA0,y
	AND.w #$0020
	BNE.b CODE_039F8C
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDX.b $12
CODE_039F8C:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_state_die_collision: state $0C handler -- sprite was killed by an
; environmental collision (lava log, falling rock, off-screen pit, egg-
; shell physics).  Runs the per-sprite Main one last time (for despawn
; glints, score-pop spawn etc.), then despawns the slot via CODE_03A31E
; (CODE_despawn_sprite_stage_ID -- frees the stage-sprite slot AND zeroes the
; sprite state byte), then tail-jumps to CODE_03B4D6 (the death-pop OAM
; spawner in this same bank).
; Raidenthequick: CODE_spr_state_die_collision
;-------------------------------------------------------------------------
CODE_039F8D:
CODE_spr_state_die_collision:                        ; Raidenthequick: CODE_spr_state_die_collision
	JSL.l CODE_spr_state_main                           ; one last Main pass for despawn glints
CODE_039F91:
	JSL.l CODE_03A31E                           ; despawn slot + clear stage ID
	TXY
	JML.l CODE_03B4D6                           ; tail-JML to death-pop OAM spawner

;---------------------------------------------------------------------------

CODE_039F9A:
	RTL

;---------------------------------------------------------------------------

YI_NorSpr022_FlashingEgg_StompRt:
CODE_039F9B:
CODE_head_bop_flashing_egg:                          ; Raidenthequick: CODE_head_bop_flashing_egg
	JSL.l CODE_03B75E
YI_NorSpr005_IcyWatermelon_StompRt:
YI_NorSpr007_Watermelon_StompRt:
YI_NorSpr009_FireWatermelon_StompRt:
YI_NorSpr023_RedEgg_StompRt:
YI_NorSpr024_YellowEgg_StompRt:
YI_NorSpr025_GreenEgg_StompRt:
YI_NorSpr027_Key_StompRt:
YI_NorSpr028_HuffinPuffin_StompRt:
YI_NorSpr029_GiantEgg_StompRt:
YI_NorSpr02A_RedGiantEgg_StompRt:
YI_NorSpr02B_GreenGiantEgg_StompRt:
YI_NorSpr030_LittleMouser_StompRt:
YI_NorSpr033_LittleMouserExitingNest_StompRt:
YI_NorSpr043_RedGiantShyguy_StompRt:
YI_NorSpr044_GreenGiantShyguy_StompRt:
YI_NorSpr058_GreenToady_StompRt:
YI_NorSpr05C_PinkToady_StompRt:
YI_NorSpr0F3_WoozyGuy_StompRt:
YI_NorSpr107_WatermelonSeed_StompRt:
YI_NorSpr124_Stretch_StompRt:
YI_NorSpr184_Bumpty_StompRt:
YI_NorSpr19B_TacklingBumpty_StompRt:
YI_NorSpr19C_FlyingBumpty_StompRt:
YI_NorSpr1A5_RunAwayMonkey_StompRt:
YI_NorSpr1A6_MonkeyWithWatermelon_StompRt:
YI_NorSpr1A7_HangingMonkeyThrowingBombsOrNeedlenoses_StompRt:
YI_NorSpr1A8_TheifMonkey_StompRt:
YI_NorSpr1A9_HangingMonkeySpittingSeeds_StompRt:
YI_NorSpr1B7_SeedSpittingMinigameBandit_StompRt:
CODE_039F9F:
CODE_head_bop_common:                                ; Raidenthequick: CODE_head_bop_common
	JSL.l CODE_spr_state_main
	LDA.w $7040,x
	AND.w #$FFF3
	ORA.w #$0004
	STA.w $7040,x
	LDA.w $7042,x
	ORA.w #$0080
	AND.w #$00CF
	ORA.w #$0020
	LDY.w $7862,x
	DEY
	BPL.b CODE_039FC4
	ORA.w #$0030
CODE_039FC4:
	STA.w $7042,x
	STZ.w $74A2,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w $6FA0,x
	AND.w #$F9FF
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	RTL

;---------------------------------------------------------------------------

DATA_039FE9:
	dw $FF80,$0080

YI_NorSpr091_4RedToadies_StompRt:
head_bop_4_toadies:                             ; Raidenthequick: head_bop_4_toadies (pack-of-4 Toadies stomp handler)
;$039FED
	LDA.w $7682,x
	CMP.w #$00F0
	BMI.b CODE_039FF9
	JML.l CODE_03A31E

CODE_039FF9:
	LDY.b #$00
	LDA.w $70E2,x
	CMP.b $18,x
	BPL.b CODE_03A004
	LDY.b #$02
CODE_03A004:
	LDA.w DATA_039FE9,y
	STA.w $75E0,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_state_die_burning: state $12 handler -- sprite is on fire (post fire-
; watermelon hit, lava-bubble contact, etc.).  Runs Main first to keep the
; sprite's bookkeeping going for one frame, then forces the OAM render
; control words to draw the sprite as an animated flame/burn overlay
; (palette row 3, draw priority lowered, oscillating flicker via the
; $7862,x flicker timer).
; Raidenthequick: CODE_spr_state_die_burning
;-------------------------------------------------------------------------
CODE_03A00B:
CODE_spr_state_die_burning:                          ; Raidenthequick: CODE_spr_state_die_burning
	JSL.l CODE_spr_state_main                           ; run per-sprite Main once more
	LDA.w #$0060
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	LDA.w $7040,x
	AND.w #$FFF3
	ORA.w #$0004
	STA.w $7040,x
	LDA.w $7042,x
	AND.w #$00CF
	ORA.w #$0020
	LDY.w $7862,x
	DEY
	BPL.b CODE_03A03C
	ORA.w #$0030
CODE_03A03C:
	STA.w $7042,x
	STZ.w $74A2,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w $7A96,x
	BNE.b CODE_03A084
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7E4C,y
	LDA.w #$0005
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_03A084:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_state_on_head_bop: state $0E handler -- Yoshi just bopped/stomped
; this sprite.  Same lookup trampoline as CODE_spr_state_init/main but pulls
; from the DATA_head_bops table (DATA_head_bops, 3 bytes per sprite ID).  Per-
; sprite head-bop handlers in this bank typically spawn a "ouch!" cloud,
; bounce the sprite Y-speed (-Y impulse), and either transition the state
; back to $10 (alive but stunned) or to $0C (die_collision) depending on
; the sprite family.  Many small sprites share the single shared RTL stub
; (init_unused_rtl_stub at $03:9A6B above) for their *_StompRt entry.
; Raidenthequick: CODE_spr_state_on_head_bop
;-------------------------------------------------------------------------
CODE_03A085:
CODE_spr_state_on_head_bop:                          ; Raidenthequick: CODE_spr_state_on_head_bop
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x          ; \
	ASL                                         ;  | id*3
	ADC.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x          ; /
	REP.b #$10
	TAY
	LDA.w DATA_head_bops,y                         ; \ DATA_head_bops[id*3] -> $00
	STA.b $00                                   ; /
	LDA.w DATA_head_bops+$02,y                     ; \ DATA_head_bops[id*3+2] -> $02
	STA.b $02                                   ; /
	SEP.b #$10
	TAY
	PHY
	PLB                                         ; DBR = head-bop routine's bank
	JMP.w [$7960]                               ; tail-JMP via dp $00..$02

;---------------------------------------------------------------------------

CODE_03A0A1:
	LDA.w $0CCE
	BNE.b CODE_03A0E4
	LDA.w #$0010
	STA.w $0CCE
	LDA.w #!Define_YI_SoundID0C_ShellHit2
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1BE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7C76,x
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7CD6,x
	SEC
	SBC.w #$0008
	STA.w $70A2,y
	LDA.w $7C78,x
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7CD8,x
	SEC
	SBC.w #$0008
CODE_03A0DB:
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7782,y
CODE_03A0E4:
	RTL

;---------------------------------------------------------------------------

CODE_03A0E5:
	LDY.b #!Define_YI_SoundID0C_ShellHit2
CODE_03A0E7:
	LDA.w $0CCE
	BNE.b CODE_03A0E4
	TYA
	JSL.l CODE_push_sound_queue
	LDA.w #$0010
	STA.w $0CCE
	LDA.w #!Define_YI_AmbSpr1BE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7C16,x
	CMP.w #$8000
	ROR
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70A2,y
	LDA.w $7C18,x
	CMP.w #$8000
	ROR
	CLC
	ADC.w $6122
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BRA.b CODE_03A0DB

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_state_ride_yoshi: state $0A handler -- sprite is currently riding on
; Yoshi's back (eggs being carried, Baby Mario, etc.).  Runs Main first
; (so the sprite keeps animating), then zeroes the slot's X/Y speed (it
; moves with Yoshi, not under its own physics).  The rest of the routine
; tracks Yoshi's animation frame via the !s_player_cur_anim_frame index,
; reads two parallel tables DATA_ride_yoshi_y_carry_offsets/DATA_ride_yoshi_x_carry_offsets for per-frame Y/X
; carry offsets, and stamps them into the slot's pixel-position so the
; carried object follows Yoshi's bobbing.  See also: ys_chr.asm for the
; player-side of the carry interaction.
; Raidenthequick: CODE_spr_state_ride_yoshi
;-------------------------------------------------------------------------
CODE_03A11D:
CODE_spr_state_ride_yoshi:                           ; Raidenthequick: CODE_spr_state_ride_yoshi
	JSL.l CODE_spr_state_main                           ; run per-sprite Main (animation)
	PHK                                         ; \ DBR = $03 (we'll touch bank-03 tables)
	PLB                                         ; /
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x   ; \ zero speed -- sprite
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x   ; / moves with Yoshi
	LDA.w $7AF8,x
	BEQ.b CODE_03A147
	LDA.w #$0010
	SEC
	SBC.w $7AF8,x
	LSR
	INC
	CMP.w #$0004
	BCC.b CODE_03A13F
	LDA.w #$0003
CODE_03A13F:
	CMP.w $60C2
	BCC.b CODE_03A147
	STA.w $60C2
CODE_03A147:
	REP.b #$10
	LDY.w $60BE
	LDA.w DATA_ride_yoshi_y_carry_offsets,y
	AND.w #$FF00
	BPL.b CODE_03A157
	ORA.w #$00FF
CODE_03A157:
	XBA
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7182,x
	LDA.w DATA_ride_yoshi_x_carry_offsets,y
	LDY.w $611A
	DEY
	BMI.b CODE_03A173
	LDY.w #$0004
	AND.w #$0040
	BEQ.b CODE_03A173
	LDY.w #$0002
CODE_03A173:
	SEP.b #$20
	TYA
	STA.w $74A2,x
	REP.b #$20
	LDY.w $60BE
	LDA.w DATA_ride_yoshi_x_carry_offsets-$01,y
	AND.w #$BF00
	BPL.b CODE_03A189
	ORA.w #$40FF
CODE_03A189:
	XBA
	LDY.w $60C4
	BNE.b CODE_03A193
	EOR.w #$FFFF
	INC
CODE_03A193:
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
	LDA.w $60C4
	STA.w $7400,x
	SEP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	ASL
	ADC.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	REP.b #$10
	TAY
	LDA.w DATA_sprite_ridings,y
	STA.b $00
	LDA.w DATA_sprite_ridings+$02,y
	STA.b $02
	SEP.b #$10
	TAY
	PHY
	PLB
	JMP.w [$7960]

;---------------------------------------------------------------------------

CODE_03A1BE:
	LDY.w $7D36,x
	BPL.b CODE_03A1CB
	JSL.l CODE_03D35D
	TYX
	JSR.w (DATA_03A1CC,x)
CODE_03A1CB:
	RTL

DATA_03A1CC:
	dw CODE_03A1D4
	dw CODE_03A1D4
	dw CODE_03A209
	dw CODE_03A22E

CODE_03A1D4:
	LDX.b $12
CODE_03A1D6:
	STZ.w $7540,x
	LDA.w $60A8
	CMP.w #$8000
	ROR
	STA.w $60A8
	LDA.w $60A8
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03A1F3
	EOR.w #$FFFF
	INC
CODE_03A1F3:
	CLC
	ADC.w #$FCC0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_03A1FA:
	LDA.w $7D96,x
	BNE.b CODE_03A204
	JSL.l CODE_03B51F
	RTS

CODE_03A204:
	JSL.l CODE_03B595
	RTS

CODE_03A209:
	LDX.b $12
	STZ.w $7540,x
	LDA.w $7C16,x
	ASL
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $60AA
	BPL.b CODE_03A221
	STZ.w $60AA
CODE_03A221:
	CMP.w #$FC00
	BMI.b CODE_03A229
	LDA.w #$FC00
CODE_03A229:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_03A1FA

CODE_03A22E:
	LDX.b $12
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$8001
	STA.w $60D2
	BRA.b CODE_03A1FA

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spr_state_turn_star: state $06 handler -- sprite was tongued + swallowed
; and is now being TRANSFORMED into a Super Star powerup.  Heavyweight:
;   1. JSL CODE_02808C (SuperFX dyntile uploader helper for the new star)
;   2. JSL CODE_spr_state_main (run the about-to-die sprite's Main one last time)
;   3. play SoundID $3B (sprite-pop)
;   4. JSL CODE_03A31E (despawn the original sprite slot's stage ID)
;   5. fork on $0B91,x (the carry-by-Yoshi flag) -- if set, spawn an ambient
;      score-pop and play SoundID $09 (coin SFX); otherwise spawn a new sprite
;      slot via CODE_03A34E (CODE_spawn_sprite_init), and if the original was a
;      coin (NorSpr115), nudge YSpeed to $FD00 so it pops upward.
; Raidenthequick: CODE_spr_state_turn_star
;-------------------------------------------------------------------------
CODE_03A247:
CODE_spr_state_turn_star:                            ; Raidenthequick: CODE_spr_state_turn_star
	JSL.l CODE_02808C                           ; SuperFX dyntile upload for star
	JSL.l CODE_spr_state_main                           ; run per-sprite Main (= CODE_spr_state_main)
	PHK                                         ; \ DBR = $03
	PLB                                         ; /
	LDA.w #!Define_YI_SoundID3B_Pop             ; \ play sprite-pop SFX
	JSL.l CODE_push_sound_queue                           ; /
	SEP.b #$20
	LDA.w $74A0,x
	PHA
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	JSL.l CODE_03A31E
	LDA.w $0B91,x
	BPL.b CODE_03A27D
	LDA.w #$0004
	JSL.l CODE_03A4E9
	PLY
	LDA.w #!Define_YI_SoundID09_Coin
	JML.l CODE_push_sound_queue

CODE_03A27D:
	TXY
	JSL.l CODE_03A34E
	SEP.b #$20
	PLA
	STA.w $74A0,x
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr115_Coin
	BNE.b CODE_03A298
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_03A298:
	RTL

;---------------------------------------------------------------------------

CODE_03A299:
	LDA.w $7680,x
	CLC
	ADC.w #$0100
	CMP.w #$0300
	BCS.b CODE_03A2AF
	LDA.w $7682,x
	CLC
	ADC.w #$0100
	CMP.w #$02E0
CODE_03A2AF:
	RTL

;---------------------------------------------------------------------------

CODE_03A2B0:
	LDA.w $7680,x
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCS.b CODE_03A2C6
	LDA.w $7682,x
	CLC
	ADC.w #$0080
	CMP.w #$01E0
CODE_03A2C6:
	RTL

;---------------------------------------------------------------------------

CODE_03A2C7:
	LDA.w $7680,x
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCS.b CODE_03A2DD
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	CMP.w #$0160
CODE_03A2DD:
	RTL

;---------------------------------------------------------------------------

CODE_03A2DE:
CODE_despawn_sprite:                                 ; Raidenthequick: CODE_despawn_sprite (off-screen + alt threshold checks)
	LDA.w $7680,x
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCS.b CODE_03A310
	LDA.w $7682,x
	CLC
	ADC.w #$0080
	CMP.w #$01E0
	BCS.b CODE_03A310
	BRA.b CODE_03A34B

CODE_03A2F8:
	LDA.w $7680,x
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCS.b CODE_03A310
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	CMP.w #$0160
	BCC.b CODE_03A34B
CODE_03A310:
	LDA.w $7E2A
	BEQ.b CODE_03A31E
	TXA
	LSR
	LSR
	TAY
	LDA.w $0C98,y
	BNE.b CODE_03A34B
;-------------------------------------------------------------------------
; CODE_despawn_sprite_stage_ID (entry at $03:A31E):
;   Frees the slot's stage-sprite ID record in the per-frame stage table at
;   $70:28CA[stage_id] (so the stage walker doesn't try to re-spawn this
;   slot next frame), then falls through to CODE_despawn_sprite_free_slot.
; CODE_despawn_sprite_free_slot (entry at $03:A32E):
;   Zeroes the state byte so CODE_handle_sprites skips this slot next frame.
; CODE_despawn_sprite_clear_graphics (entry at $03:A331):
;   Doesn't touch state byte; only releases the dyntile slot ($7ECE table)
;   and clears the player-platform pointer ($61B6) if we were riding it.
; Multiple entry points used by callers depending on how much state should
; be torn down.  Raidenthequick: CODE_despawn_sprite (.stage_ID/.free_slot/
; .clear_graphics in their docs).
;-------------------------------------------------------------------------
CODE_03A31E:
CODE_despawn_sprite_stage_ID:                        ; Raidenthequick: CODE_despawn_sprite.stage_ID
	SEP.b #$20                                  ; M=8 for 1-byte stage-table write
	PHX
	LDA.w $74A0,x                               ; A = stage-sprite ID for this slot
	TAX
	LDA.b #$00                                  ; \ clear the stage-sprite slot
	STA.l $7028CA,x                             ; / so it won't re-spawn next frame
	PLX
	REP.b #$20                                  ; M=16
CODE_03A32E:
CODE_despawn_sprite_free_slot:                       ; Raidenthequick: CODE_despawn_sprite.free_slot
	STZ.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x   ; state = 0 (slot empty)
CODE_03A331:
CODE_despawn_sprite_clear_graphics:                  ; Raidenthequick: CODE_despawn_sprite.clear_graphics
	LDA.w #$00FF                                ; \ clear draw priority
	STA.w $74A2,x                               ; /
	LDY.w $7722,x                               ; \ if slot had a dyntile, free it
	BMI.b CODE_03A342                           ;  | (negative = no dyntile)
	LDA.w $7ECE,y                               ;  | A = bitmask for this dyntile slot
	TRB.w $7ECC                                 ; / clear from in-use bitfield $7ECC
CODE_03A342:
	CPX.w $61B6                                 ; \ if we were the player platform,
	BNE.b CODE_03A34A                           ;  |
	STZ.w $61B6                                 ; / clear the platform pointer
CODE_03A34A:
	SEC                                         ; carry set = "we despawned something"
CODE_03A34B:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spawn_sprite_init (entry $03:A34C / $03:A34E):
;   Find a free slot in the normal-sprite slot range [$18..$5C] in 4-byte
;   strides, then call spawn_sprite_full with state=$02 (so the new sprite
;   will run its Init handler on the next CODE_handle_sprite tick).
;   $03:A34C entry starts the search at $5C; $03:A34E entry expects Y to
;   already hold a starting search slot (used by callers that want to
;   restrict spawn to a particular range, e.g. ambient sprites).
; Inputs:  A = sprite ID to spawn (16-bit, M=16)
;          Y = starting search slot (entry at $03:A34E only)
; Outputs: Y = chosen slot; carry SET on success, CLEAR if no free slot.
; Raidenthequick: CODE_spawn_sprite_init.
;-------------------------------------------------------------------------
CODE_03A34C:
CODE_spawn_sprite_init:                              ; Raidenthequick: CODE_spawn_sprite_init
	LDY.b #$5C                                  ; start search at last slot ($5C)
CODE_03A34E:
CODE_spawn_sprite_init_with_Y:                       ; alt entry: Y = starting slot
	PHA                                         ; stash sprite ID
CODE_03A34F:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y   ; state == 0?
	BEQ.b CODE_03A35F                           ; free slot found
	DEY                                         ; \ slot -= 4
	DEY                                         ;  |
	DEY                                         ;  |
	DEY                                         ; /
	CPY.b #$18                                  ; \ keep going while slot >= $18
	BCS.b CODE_03A34F                           ; /
	PLA                                         ; \ failure: restore A,
	CLC                                         ;  | clear carry,
	RTL                                         ; / return.

CODE_03A35F:
	LDA.w #$0002                                ; \ new state = $02 (run Init)
	BRA.b CODE_03A37D                           ; / and fall into spawn_sprite_full

;-------------------------------------------------------------------------
; CODE_spawn_sprite_active (entry $03:A364 / $03:A366):
;   Same as CODE_spawn_sprite_init, but writes state=$10 (alive) directly,
;   SKIPPING the per-sprite Init handler.  Use this only when the caller
;   has already pre-populated all the per-slot fields the Init would have
;   set.  Raidenthequick: CODE_spawn_sprite_active.
;-------------------------------------------------------------------------
CODE_03A364:
CODE_spawn_sprite_active:                            ; Raidenthequick: CODE_spawn_sprite_active
	LDY.b #$5C
CODE_03A366:
CODE_spawn_sprite_active_with_Y:                     ; alt entry: Y = starting slot
	PHA
CODE_03A367:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	BEQ.b CODE_spawn_sprite_active_state
	DEY
	DEY
	DEY
	DEY
	CPY.b #$18
	BCS.b CODE_03A367
	PLA
	CLC
	RTL

;-------------------------------------------------------------------------
; CODE_spawn_sprite (entry $03:A377):
;   Common spawn body.  Caller passes A = sprite ID and Y = target slot.
;   Goes directly to "partial init" (skips the slot-state-write portion),
;   useful for re-purposing an already-active slot to a different sprite.
; Raidenthequick: CODE_spawn_sprite.
;-------------------------------------------------------------------------
CODE_03A377:
CODE_spawn_sprite:                                   ; Raidenthequick: CODE_spawn_sprite
	PHA
	BRA.b CODE_spawn_sprite_clear_slot_fields                           ; skip state-write, jump into shared body

CODE_03A37A:
CODE_spawn_sprite_active_state:                      ; Raidenthequick: CODE_spawn_sprite.active_state
	LDA.w #$0010
CODE_03A37D:
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	LDA.w #$00FF
	STA.w $74A0,y
	LDA.w #$0000
	STA.w $7400,y
	STA.w $7D96,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
CODE_03A395:
CODE_spawn_sprite_clear_slot_fields:                 ; cold-zero ~30 per-slot fields (speeds, scratch tables, timers, OAM defaults) before ID-specific init
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,y
	STA.w $70E0,y
	STA.w $7D36,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	STA.w $7A36,y
	STA.w $7A38,y
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	STA.w $7AF8,y
	STA.w $7402,y
	STA.w $7860,y
	STA.w !EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround|!EXRAMBankMirror,y
	STA.w $7D38,y
	STA.w $7720,y
	STA.w $7680,y
	STA.w $7682,y
	STA.w $7540,y
	STA.w $75E0,y
	STA.w $77C0,y
	DEC
	STA.w $7362,y
	STA.w $7722,y
	LDA.w #$1FFF
	STA.w $7862,y
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	PHX
	ASL
	REP.b #$10
	TAX
	SEP.b #$20
	PHY
	LDA.l FXDATA_0AA716,x
	LDY.w #$0006
CODE_03A400:
	CMP.w $6EB5,y
	BEQ.b CODE_03A40B
	DEY
	BNE.b CODE_03A400
	TYA
	BRA.b CODE_03A410

CODE_03A40B:
	TYA
	ADC.b #$06
	ASL
	ASL
CODE_03A410:
	REP.b #$20
	AND.w #$00FF
	PLY
	STA.w $7180,y
	LDA.l FXDATA_0A9F1A+$01,x
	AND.w #$00FF
	EOR.w #$0020
	STA.w $7042,y
	LDA.l FXDATA_0A9F1A,x
	AND.w #$00FF
	STA.w $74A2,y
	LDA.l FXDATA_0AA318-$01,x
	AND.w #$FF00
	BPL.b CODE_03A43C
	ORA.w #$00FF
CODE_03A43C:
	XBA
	STA.w $7542,y
	LDA.l FXDATA_0AA318,x
	AND.w #$FF00
	BPL.b CODE_03A44C
	ORA.w #$00FF
CODE_03A44C:
	XBA
	ASL
	ASL
	ASL
	ASL
	STA.w $75E2,y
	LDA.l FXDATA_0A9B1C,x                        ; init the slot's render-control word $7040 (hi byte = OAMByteCount, lo byte = draw flags; see DATA_sprite_render_control_table)
	STA.w $7040,y
	LDA.l FXDATA_0A971E,x
	STA.w $6FA2,y
	LDA.l FXDATA_0A9320,x
	STA.w $6FA0,y
	AND.w #$001F
	ASL
	ASL
	ASL
	TAX
	LDA.l FXDATA_0A9220,x
	STA.w $7B56,y
	LDA.l FXDATA_0A9220+$02,x
	STA.w $7B58,y
	LDA.l FXDATA_0A9220+$04,x
	STA.w $7BB6,y
	LDA.l FXDATA_0A9220+$06,x
	STA.w $7BB8,y
	SEP.b #$10
	PLX
	SEC
	RTL

;---------------------------------------------------------------------------

CODE_03A491:
CODE_spawn_3up_score:                                ; A=$0003 -> fall into spawn_score_pop with 3-up score value
	LDA.w #$0003
	BRA.b CODE_03A4A5

CODE_03A496:
CODE_spawn_1up_score:                                ; spawn score-pop ambient sprite at current sprite position
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
CODE_03A4A2:
	LDA.w #$0001
CODE_03A4A5:
	STA.w $0004
	CLC
	ADC.w !RAM_YI_Level_CurrentLifeCountLo
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	LDA.w $0004
	CLC
	ADC.w !RAM_YI_Level_1upsCollectedInCurrentLevelLo
	STA.w !RAM_YI_Level_1upsCollectedInCurrentLevelLo
	LDA.w #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	LSR.w $0004
CODE_03A4C3:
	LDA.w #!Define_YI_AmbSpr1BF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0000
	STA.w $70A2,y
	LDA.w $0002
	STA.w $7142,y
	LDA.w $0004
	STA.w $73C2,y
	LDA.w #$0040
	STA.w $7782,y
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	RTL

;---------------------------------------------------------------------------

CODE_03A4E9:
	STA.w $0006
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
CODE_03A4F5:
	STA.w $0002
	LDA.w #!Define_YI_AmbSpr226
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0000
	STA.w $70A2,y
	LDA.w $0002
	STA.w $7142,y
	LDA.w $7002,y
	ORA.w $0006
	STA.w $7002,y
	LDA.w #$0040
	STA.w $7782,y
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_03A520:
	INC.w !RAM_YI_Level_CurrentCoinCountLo
	LDA.w !RAM_YI_Level_CurrentCoinCountLo
	CMP.w #$0064
	BCC.b CODE_03A538
	JSL.l CODE_03A4A2
	LDA.w #$FE40
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	STZ.w !RAM_YI_Level_CurrentCoinCountLo
CODE_03A538:
	RTL

;---------------------------------------------------------------------------

CODE_03A539:
	LDA.w $70E2,y
	LDY.b #$00
	SEC
	SBC.w $70E2,x
	STA.b $08
	BPL.b CODE_03A54C
	EOR.w #$FFFF
	INC
	LDY.b #$02
CODE_03A54C:
	STA.b $06
	TYA
	RTL

;---------------------------------------------------------------------------

CODE_03A550:
	LDY.b #$00
	LDA.w $7182,y
	SEC
	SBC.w $7182,x
	STA.b $0E
	BPL.b CODE_03A563
	EOR.w #$FFFF
	INC
	LDY.b #$02
CODE_03A563:
	STA.b $0C
	TYA
	RTL

;---------------------------------------------------------------------------

CODE_03A567:
	PHY
	JSL.l CODE_03A550
	STY.b $0A
	PLY
	JSL.l CODE_03A539
	STY.b $04
	LDA.b $06
	CMP.b $0C
	BCS.b CODE_03A581
	LDY.b $0A
	INY
	INY
	INY
	INY
CODE_03A581:
	TYA
	RTL

;---------------------------------------------------------------------------

DATA_03A583:
	dw $FF40,$00C0,$FFA0,$0060

CODE_03A58B:
	TXY
	LDX.b #$04
	BRA.b CODE_03A593

CODE_03A590:
	TXY
	LDX.b #$00
CODE_03A593:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_03A5B0
	BPL.b CODE_03A59C
	INX
	INX
CODE_03A59C:
	CLC
	ADC.l DATA_03A583,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	EOR.l DATA_03A583,x
	BMI.b CODE_03A5B0
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_03A5B0:
	TYX
	RTL

;---------------------------------------------------------------------------

CODE_03A5B2:
	JSL.l CODE_03A5B7
	RTL

CODE_03A5B7:
	LDY.w $7D36,x
	BEQ.b CODE_03A5F0
	BPL.b CODE_03A62E
CODE_03A5BE:
	LDA.w $7D96,x
	BEQ.b CODE_03A5C9
	PLA
	PLY
	JML.l CODE_03B595

CODE_03A5C9:
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF6
	BCC.b CODE_03A5F9
	TXY
	LDX.b #$0C
	LDA.w $60AA
	BMI.b CODE_03A5EA
	LDA.w $6FA1,y
	AND.w #$0038
	LSR
	LSR
	TAX
CODE_03A5EA:
	JSR.w (DATA_03A655,x)
	PLA
	PLY
	RTL

CODE_03A5F0:
	CPX.w $61B6
	BNE.b CODE_03A5F8
	STZ.w $61B6
CODE_03A5F8:
	RTL

CODE_03A5F9:
	LDA.w $6FA0,x
	AND.w #$3800
	CMP.w #$2800
	BEQ.b CODE_03A61D
	LDA.w $60D8
	BNE.b CODE_03A61D
	LDA.w $60A8
	BPL.b CODE_03A612
	EOR.w #$FFFF
	INC
CODE_03A612:
	CMP.w #$0400
	BCC.b CODE_03A61D
	PLA
	PLY
	JSR.w CODE_03A1D6
	RTL

CODE_03A61D:
	LDA.w $6FA0,x
	AND.w #$C000
	ASL
	ROL
	ROL
	ASL
	TAX
	JSR.w (DATA_03A665,x)
	PLA
	PLY
	RTL

CODE_03A62E:
	CPX.w $61B6
	BNE.b CODE_03A636
	STZ.w $61B6
CODE_03A636:
	RTL

CODE_03A637:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_03A64B:
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	RTL

DATA_03A655:
	dw CODE_03A66D
	dw CODE_03A6B5
	dw CODE_03A6B5
	dw CODE_03A6B5
	dw CODE_03A6D6
	dw CODE_03A7A4
	dw CODE_03A6F5
	dw CODE_03A789

DATA_03A665:
	dw CODE_03A7AB
	dw CODE_03A7A4
	dw CODE_03A806
	dw CODE_03A80B

CODE_03A66D:
	LDA.w $60C0
	BNE.b CODE_03A675
	JMP.w CODE_03A7A4

CODE_03A675:
	LDX.b $12
	LDA.w $7C16,x
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$8001
	STA.w $60D2
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	JSL.l CODE_03B288
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$09
	BEQ.b CODE_03A6B4
	JSL.l CODE_03B523
CODE_03A6B4:
	RTS

CODE_03A6B5:
	LDX.b $12
	LDY.b #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_03A0E7
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$8001
	STA.w $60D2
	RTS

CODE_03A6D6:
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$8001
	STA.w $60D2
	LDX.b $12
	JSL.l CODE_03B4D6
	JSL.l CODE_03B288
	JSL.l CODE_03A31E
	RTS

DATA_03A6F1:
	dw $0180,$0060

CODE_03A6F5:
	LDX.b $12
	LDA.w $60D4
	BEQ.b CODE_03A707
	LDA.w $6FA2,x
	AND.w #$6000
	BNE.b CODE_03A707
	JMP.w CODE_03A789

CODE_03A707:
	LDA.w $0D94
	BEQ.b CODE_03A716
	CPX.w $61B6
	BNE.b CODE_03A787
	STZ.w $61B6
	BRA.b CODE_03A787

CODE_03A716:
	LDA.w $6FA0,x
	AND.w #$3800
	CMP.w #$3000
	BNE.b CODE_03A731
	CPX.w $61B6
	BEQ.b CODE_03A72E
	LDA.w $61B6
	AND.w #$00FF
	BNE.b CODE_03A787
CODE_03A72E:
	STX.w $61B6
CODE_03A731:
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_03A759
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	SEC
	SBC.w $6EBE
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03A759:
	LDA.w $60AA
	BMI.b CODE_03A787
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03A766
	LDA.w #$0000
CODE_03A766:
	STA.w $60AA
	LDY.b #$00
	LDA.w $72C0,x
	BMI.b CODE_03A772
	LDY.b #$02
CODE_03A772:
	LDA.w $60FC
	AND.w DATA_03A6F1,y
	BNE.b CODE_03A784
	LDA.w $72C0,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_03A784:
	INC.w $61B4
CODE_03A787:
	PLA
	RTL

CODE_03A789:
	LDX.b $12
	JSL.l CODE_03B51F
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$8001
	STA.w $60D2
CODE_03A79B:                                         ; bare RTS: doubles as the no-op Main for "stop"-type special sprites (19 slots in DATA_special_sprite_mains) and as a local branch-return target
	RTS

CODE_03A79C:
	JSR.w CODE_03A789
	RTL

DATA_03A7A0:
	dw $0100,$FF00

CODE_03A7A4:
	LDX.b $12
	JSL.l CODE_03A858
	RTS

CODE_03A7AB:
	LDX.b $12
	LDA.w $60A8
	ORA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_03A79B
	REP.b #$10
	LDA.w $60A8
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	LDA.w $60A8
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TAY
	EOR.w $7C16,x
	BMI.b CODE_03A7D2
	BCS.b CODE_03A7E1
	STZ.w $60A8
	BRA.b CODE_03A7E1

CODE_03A7D2:
	BCS.b CODE_03A7DE
	TYA
	SEC
	SBC.w $60A8
	EOR.w $60A8
	BMI.b CODE_03A7E1
CODE_03A7DE:
	STY.w $60A8
CODE_03A7E1:
	PLA
	TAY
	EOR.w $7C16,x
	BPL.b CODE_03A7EF
	BCS.b CODE_03A7FF
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_03A7FF

CODE_03A7EF:
	BCS.b CODE_03A7FB
	TYA
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03A7FF
CODE_03A7FB:
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_03A7FF:
	SEP.b #$10
	JSL.l CODE_03A0E5
	RTS

CODE_03A806:
	LDX.b $12
	JMP.w CODE_03A1D6

CODE_03A80B:
	LDX.b $12
	PLA
	RTL

;---------------------------------------------------------------------------

DATA_03A80F:
	dw $0100,$FF00

CODE_03A813:
	LDX.b $12
	LDA.w $61D6
	BNE.b CODE_03A850
	LDA.w $6FA2,x
	AND.w #$6000
	BNE.b CODE_03A84A
	INC.w $7D38,x
	STZ.b $18,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.w $7540,x
	STZ.w $7860,x
	TXY
	LDX.w $77C2,y
	LDA.l DATA_03A7A0,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
CODE_03A84A:
	LDX.b $12
	JSL.l CODE_03A858
CODE_03A850:
	PLA
	PLY
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_player_hit: handler called when the player takes damage.  Two entry points:
;   $03A853 = CODE_player_hit             -- generic hit; zero the "sprite that hit
;                                       us" slot index ($7972) and fall through.
;   $03A858 = CODE_player_hit (sprite)    -- entered with $7972 = slot index of the
;                                       sprite that touched Yoshi.  If we are
;                                       Super Baby Mario form and the sprite is
;                                       the player itself (slot 0), short-out
;                                       to CODE_03A899 (RTL).
; Main path (CODE_03A865) gates on invincibility/freeze/state flags, plays
; SoundID $17 (damage cry), then JSR-indirect through a per-Yoshi-form table
; to apply the form-specific knockback / animation.
; Caller invariants: M=16, X=16, DBR=$03 (set by caller).
; Raidenthequick: CODE_player_hit (label is the first byte; .sprite entry is +5)
;-------------------------------------------------------------------------
CODE_03A853:
CODE_player_hit:                                     ; Raidenthequick: CODE_player_hit
	STZ.w $7972                                 ; no sprite was responsible
	BRA.b CODE_03A865

CODE_03A858:
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	BEQ.b CODE_03A865
	LDY.w $7972
	BEQ.b CODE_03A899
	JMP.w CODE_kill_sprite_by_hit_special_cases

CODE_03A865:
	LDA.w $61D6
	ORA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_FreeMovementFlag
	BNE.b CODE_03A899
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState03
	BCS.b CODE_03A899
	LDA.w $60B2
	CLC
	ADC.w #$0010
	CMP.w #$00E9
	BCS.b CODE_03A899
	LDA.w #!Define_YI_SoundID17_YoshiHurt
	JSL.l CODE_push_sound_queue
	STA.w $607A
	STZ.w $60D4
	LDX.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	JSR.w (DATA_03A89A,x)
	LDX.b $12
CODE_03A899:
	RTL

DATA_03A89A:
	dw CODE_03A8CF
	dw CODE_03A8FC
	dw CODE_03A936
	dw CODE_03A8AE
	dw CODE_03A8C1
	dw CODE_03A94A
	dw CODE_03A940
	dw CODE_03A94B
	dw CODE_03A901
	dw CODE_03A8D3

CODE_03A8AE:
	LDA.w #$0068
	STA.w $61D6
	STZ.w $60A8
	STZ.w $60B4
	LDA.w #$1000
	STA.w $6180
	RTS

CODE_03A8C1:
	LDA.w #$0090
	STA.w $61D6
	STZ.w $618E
	RTS

DATA_03A8CB:
	dw $FE00,$0200

CODE_03A8CF:
	JSL.l CODE_04F74A
CODE_03A8D3:
	LDA.w $61B2
	BMI.b CODE_03A8F7
	LDA.w $0390
	BMI.b CODE_03A8F7
	LDA.w $60A8
	CLC
	ADC.w #$02C0
	CMP.w #$0581
	LDA.w #$0180
	BCC.b CODE_03A8EF
	LDA.w #$0240
CODE_03A8EF:
	STA.w $614A
	LDA.w #$0080
	BRA.b CODE_03A904

CODE_03A8F7:
	LDA.w #$00A0
	BRA.b CODE_03A904

CODE_03A8FC:
	LDA.w #$0040
	BRA.b CODE_03A904

CODE_03A901:
	LDA.w #$0068
CODE_03A904:
	STA.w $61D6
	LDY.w $7972
	BEQ.b CODE_03A917
	LDX.w $77C2,y
	LDA.l DATA_03A8CB,x
	TYX
	STA.w $60B4
CODE_03A917:
	LDY.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	CPY.b #!Define_YI_PlayerForm02_Car
	BEQ.b CODE_03A923
	LDA.w $60C0
	BNE.b CODE_03A92F
CODE_03A923:
	LDA.w #$0008
	STA.w $60C0
	LDA.w #$FC00
	STA.w $60AA
CODE_03A92F:
	LDA.w #$0008
	STA.w $0CCC
	RTS

CODE_03A936:
	LDA.w #$0090
	STA.w $61D6
	STZ.w $6194
	RTS

CODE_03A940:
	LDA.w #$00D0
	STA.w $61D6
	STZ.w $6180
	RTS

CODE_03A94A:
	RTS

CODE_03A94B:
	LDA.w $6180
	BNE.b CODE_03A965
	LDA.w #$0080
	STA.w $6180
	LDA.w #$0080
	STA.w $61F6
	LDA.w #$FE00
	STA.w $60AA
	STZ.w $617E
CODE_03A965:
	RTS

;---------------------------------------------------------------------------

DATA_03A966:
	dw $0000,$8040,$8000,$00C0,$8080,$0040,$0080,$80C0

CODE_03A976:
	PHX
	LDY.b #$00
	LDA.b $00
	BPL.b CODE_03A983
	LDY.b #$04
	EOR.w #$FFFF
	INC
CODE_03A983:
	STA.b $04
	TAX
	LDA.b $02
	BPL.b CODE_03A990
	INY
	INY
	EOR.w #$FFFF
	INC
CODE_03A990:
	CMP.b $04
	BCC.b CODE_03A998
	INY
	TAX
	LDA.b $04
CODE_03A998:
	XBA
	STA.w !REGISTER_DividendLo
	STX.w !REGISTER_Divisor
	TYA
	ASL
	TAX
	NOP #4
	REP.b #$10
	LDA.w !REGISTER_QuotientLo
	ASL
	TAY
	CPY.w #$0202
	BCC.b CODE_03A9B5
	LDY.w #$0200
CODE_03A9B5:
	LDA.l DATA_03A966,x
	ASL
	STA.b $04
	TYX
	LDA.l FXDATA_0BB810,x
	BCC.b CODE_03A9C7
	EOR.w #$FFFF
	INC
CODE_03A9C7:
	CLC
	ADC.b $04
	SEP.b #$10
	PLX
	RTL

;---------------------------------------------------------------------------

DATA_03A9CE:
	dw $0000,$0010,$0000,$0010,$0020,$0030,$0020,$0030
	dw $0040,$0050,$0040,$0050,$0060,$0070,$0060,$0070

DATA_03A9EE:
	dw $0000,$0000,$0010,$0010,$0000,$0000,$0010,$0010
	dw $0000,$0000,$0010,$0010,$0000,$0000,$0010,$0010

;---------------------------------------------------------------------------

DATA_03AA0E:
	dw $01C0,$01C2,$01E0,$01E2,$01C4,$01C6,$01E4,$01E6
	dw $01C8,$01CA,$01E8,$01EA,$01CC,$01CE,$01EC,$01EE

CODE_03AA2E:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_03AA51
	REP.b #$10
	LDY.w $7362,x
	BMI.b CODE_03AA4F
CODE_03AA3C:
	PHX
	LDA.w $7722,x
	TAX
	LDA.w $6004,y
	AND.w #$FE00
	ORA.l DATA_03AA0E,x
	STA.w $6004,y
	PLX
CODE_03AA4F:
	SEP.b #$10
CODE_03AA51:
	RTL

;---------------------------------------------------------------------------

CODE_03AA52:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_03AA9C
	REP.b #$10
	LDY.w $7362,x
	BMI.b CODE_03AA9A
CODE_03AA60:
	PHX
	LDA.w $7722,x
	TAX
	LDA.w $6004,y
	AND.w #$FE00
	ORA.l DATA_03AA0E,x
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$02,x
	STA.w $600C,y
	LDA.w $6014,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$04,x
	STA.w $6014,y
	LDA.w $601C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$06,x
	STA.w $601C,y
	PLX
CODE_03AA9A:
	SEP.b #$10
CODE_03AA9C:
	RTL

;---------------------------------------------------------------------------

CODE_03AA9D:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_03AB1B
	REP.b #$10
	LDY.w $7362,x
	BMI.b CODE_03AB19
CODE_03AAAB:
	PHX
	LDA.w $7722,x
	TAX
	LDA.w $6004,y
	AND.w #$FE00
	ORA.l DATA_03AA0E,x
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$02,x
	STA.w $600C,y
	LDA.w $6014,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$04,x
	STA.w $6014,y
	LDA.w $601C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$06,x
	STA.w $601C,y
	LDA.w $6024,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$08,x
	STA.w $6024,y
	LDA.w $602C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0A,x
	STA.w $602C,y
	LDA.w $6034,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0C,x
	STA.w $6034,y
	LDA.w $603C,y
	AND.w #$FE00
	ORA.l DATA_03AA0E+$0E,x
	STA.w $603C,y
	PLX
CODE_03AB19:
	SEP.b #$10
CODE_03AB1B:
	RTL

;---------------------------------------------------------------------------

CODE_03AB1C:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_03AB1B
	REP.b #$10
	LDY.w $7362,x
	BPL.b CODE_03AB2D
	JMP.w CODE_03ABF7

CODE_03AB2D:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7722,x
	TAX
	LDA.w $6004,y
	AND.w #$FE00
	ORA.w DATA_03AA0E,x
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$02,x
	STA.w $600C,y
	LDA.w $6014,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$04,x
	STA.w $6014,y
	LDA.w $601C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$06,x
	STA.w $601C,y
	LDA.w $6024,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$08,x
	STA.w $6024,y
	LDA.w $602C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$0A,x
	STA.w $602C,y
	LDA.w $6034,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$0C,x
	STA.w $6034,y
	LDA.w $603C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$0E,x
	STA.w $603C,y
	LDA.w $6044,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$10,x
	STA.w $6044,y
	LDA.w $604C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$12,x
	STA.w $604C,y
	LDA.w $6054,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$14,x
	STA.w $6054,y
	LDA.w $605C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$16,x
	STA.w $605C,y
	LDA.w $6064,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$18,x
	STA.w $6064,y
	LDA.w $606C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$1A,x
	STA.w $606C,y
	LDA.w $6074,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$1C,x
	STA.w $6074,y
	LDA.w $607C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$1E,x
	STA.w $607C,y
	PLB
	PLX
CODE_03ABF7:
	SEP.b #$10
CODE_03ABF9:
	RTL

;---------------------------------------------------------------------------

CODE_03ABFA:
	LDY.w $74A2,x
	CPY.b #$FF
	BEQ.b CODE_03ABF9
	REP.b #$10
	LDY.w $7362,x
	BPL.b CODE_03AC0B
	JMP.w CODE_03ACED

CODE_03AC0B:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7722,x
	TAX
	LDA.w $6004,y
	AND.w #$FE00
	ORA.w DATA_03AA0E,x
	STA.w $6004,y
	LDA.w $600C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$02,x
	STA.w $600C,y
	LDA.w $6014,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$04,x
	STA.w $6014,y
	LDA.w $601C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$06,x
	STA.w $601C,y
	LDA.w $6024,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E+$02,x
	STA.w $6024,y
	LDA.w $602C,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E,x
	STA.w $602C,y
	LDA.w $6034,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E+$06,x
	STA.w $6034,y
	LDA.w $603C,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E+$04,x
	STA.w $603C,y
	LDA.w $6044,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$08,x
	STA.w $6044,y
	LDA.w $604C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$0A,x
	STA.w $604C,y
	LDA.w $6054,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$0C,x
	STA.w $6054,y
	LDA.w $605C,y
	AND.w #$FE00
	ORA.w DATA_03AA0E+$0E,x
	STA.w $605C,y
	LDA.w $6064,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E+$0A,x
	STA.w $6064,y
	LDA.w $606C,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E+$08,x
	STA.w $606C,y
	LDA.w $6074,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E+$0E,x
	STA.w $6074,y
	LDA.w $607C,y
	AND.w #$FE00
	EOR.w #$4000
	ORA.w DATA_03AA0E+$0C,x
	STA.w $607C,y
	PLB
	PLX
CODE_03ACED:
	SEP.b #$10
	RTL

;---------------------------------------------------------------------------

DATA_03ACF0:
	dw $FF00,$0FF0,$00FF

DATA_03ACF6:
	dw $F000,$0F00,$00F0,$000F

DATA_03ACFE:
	dw $FA00,$0FA0,$00FA

DATA_03AD04:
	dw $8000,$4000,$2000,$1000,$0800,$0400,$0200,$0100
	dw $0080,$0040,$0020,$0010,$0008,$0004,$0002,$0001

CODE_03AD24:
	PHX
	PHB
	PHK
	PLB
	SEC
	ROR.w $0000
	LDX.b #$06
CODE_03AD2E:
	LDA.w $7ECC
	AND.w DATA_03ACF6,x
	BNE.b CODE_03AD3B
	STX.w $0001
	BRA.b CODE_03AD40

CODE_03AD3B:
	CMP.w DATA_03ACF6,x
	BNE.b CODE_03AD49
CODE_03AD40:
	DEX
	DEX
	BPL.b CODE_03AD2E
	LDX.w $0001
	BMI.b CODE_03AD5C
CODE_03AD49:
	TXA
	ASL
	ASL
	TAX
	LDA.w $7ECC
	LDY.b #$04
CODE_03AD52:
	BIT.w DATA_03AD04,x
	BEQ.b CODE_03AD60
	INX
	INX
	DEY
	BNE.b CODE_03AD52
CODE_03AD5C:
	PLB
	PLX
	CLC
	RTL

CODE_03AD60:
	LDA.w DATA_03AD04,x
	STA.w $7ECE,x
	TSB.w $7ECC
	TXA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	SEC
	RTL

CODE_03AD74:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7ECC
	LDX.b #$06
CODE_03AD7D:
	BIT.w DATA_03ACF6,x
	BEQ.b CODE_03AD8A
	DEX
	DEX
	BPL.b CODE_03AD7D
	PLB
	PLX
	CLC
	RTL

CODE_03AD8A:
	TXA
	ASL
	ASL
	TAY
	LDA.w DATA_03ACF6,x
	STA.w $7ECE,y
	TSB.w $7ECC
	TYA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	SEC
	RTL

CODE_03ADA2:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7ECC
	LDX.b #$04
CODE_03ADAB:
	BIT.w DATA_03ACFE,x
	BEQ.b CODE_03ADB8
	DEX
	DEX
	BPL.b CODE_03ADAB
	PLB
	PLX
	CLC
	RTL

CODE_03ADB8:
	TXA
	ASL
	ASL
	TAY
	LDA.w DATA_03ACFE,x
	STA.w $7ECE,y
	TSB.w $7ECC
	TYA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	SEC
	RTL

CODE_03ADD0:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7ECC
	LDX.b #$04
CODE_03ADD9:
	BIT.w DATA_03ACF0,x
	BEQ.b CODE_03ADE6
	DEX
	DEX
	BPL.b CODE_03ADD9
	PLB
	PLX
CODE_03ADE4:
	CLC
	RTL

CODE_03ADE6:
	TXA
	ASL
	ASL
	TAY
	LDA.w DATA_03ACF0,x
	STA.w $7ECE,y
	TSB.w $7ECC
	TYA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	SEC
	RTL

CODE_03ADFE:
	LDA.w $7ECC
	BNE.b CODE_03ADE4
	LDA.w #$FFFF
	STA.w $7ECE
	STA.w $7ECC
	STZ.w $7722,x
	SEC
	RTL

CODE_03AE11:
	PHX
	PHB
	PHK
	PLB
	SEC
	ROR.w $0000
	LDX.b #$06
CODE_03AE1B:
	LDA.w $7ECC
	AND.w DATA_03ACF6,x
	BNE.b CODE_03AE28
	STX.w $0001
	BRA.b CODE_03AE2D

CODE_03AE28:
	CMP.w DATA_03ACF6,x
	BNE.b CODE_03AE36
CODE_03AE2D:
	DEX
	DEX
	BPL.b CODE_03AE1B
	LDX.w $0001
	BMI.b CODE_03AE49
CODE_03AE36:
	TXA
	ASL
	ASL
	TAX
	LDA.w $7ECC
	LDY.b #$04
CODE_03AE3F:
	BIT.w DATA_03AD04,x
	BEQ.b CODE_03AE4D
	INX
	INX
	DEY
	BNE.b CODE_03AE3F
CODE_03AE49:
	PLB
	PLX
	BRA.b CODE_03AEA1

CODE_03AE4D:
	LDA.w DATA_03AD04,x
	STA.w $7ECE,x
	TSB.w $7ECC
	TXA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	RTL

CODE_03AE60:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7ECC
	LDX.b #$06
CODE_03AE69:
	BIT.w DATA_03ACF6,x
	BEQ.b CODE_03AE76
	DEX
	DEX
	BPL.b CODE_03AE69
	PLB
	PLX
	BRA.b CODE_03AEA1

CODE_03AE76:
	TXA
	ASL
	ASL
	TAY
	LDA.w DATA_03ACF6,x
	STA.w $7ECE,y
	TSB.w $7ECC
	TYA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	RTL

CODE_03AE8D:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7ECC
	LDX.b #$04
CODE_03AE96:
	BIT.w DATA_03ACFE,x
	BEQ.b CODE_03AEA7
	DEX
	DEX
	BPL.b CODE_03AE96
	PLB
	PLX
CODE_03AEA1:
	PLA
	PLY
	JML.l CODE_03A31E

CODE_03AEA7:
	TXA
	ASL
	ASL
	TAY
	LDA.w DATA_03ACFE,x
	STA.w $7ECE,y
	TSB.w $7ECC
	TYA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	RTL

CODE_03AEBE:
	PHX
	PHB
	PHK
	PLB
	LDA.w $7ECC
	LDX.b #$04
CODE_03AEC7:
	BIT.w DATA_03ACF0,x
	BEQ.b CODE_03AED4
	DEX
	DEX
	BPL.b CODE_03AEC7
	PLB
	PLX
	BRA.b CODE_03AEA1

CODE_03AED4:
	TXA
	ASL
	ASL
	TAY
	LDA.w DATA_03ACF0,x
	STA.w $7ECE,y
	TSB.w $7ECC
	TYA
	AND.w #$00FF
	PLB
	PLX
	STA.w $7722,x
	RTL

CODE_03AEEB:
	LDA.w $7ECC
	BNE.b CODE_03AEA1
	LDA.w #$FFFF
	STA.w $7ECE
	STA.w $7ECC
	STZ.w $7722,x
	RTL

;---------------------------------------------------------------------------

CODE_03AEFD:
	LDY.w $7722,x
	LDA.w $7ECE,y
	TRB.w $7ECC
	LDA.w #$FFFF
	STA.w $7722,x
	RTL

;---------------------------------------------------------------------------

CODE_03AF0D:
	LDY.w $7722,x
	BMI.b CODE_03AF1E
	LDA.w $7ECE,y
	TRB.w $7ECC
	LDA.w #$FFFF
	STA.w $7722,x
CODE_03AF1E:
	RTL

;---------------------------------------------------------------------------

DATA_03AF1F:
	dw FXCODE_08867E,FXCODE_088205

CODE_03AF23:
	LDA.w $7D38,x
	BEQ.b CODE_03AF42
	LDY.w $7722,x
	BMI.b CODE_03AF42
	LDA.w $7403,x
	AND.w #$00FF
	BEQ.b CODE_03AF42
	DEC
	BNE.b CODE_03AF3E
	JSL.l CODE_03AA2E
	BRA.b CODE_03AF42

CODE_03AF3E:
	JSL.l CODE_03AA52
CODE_03AF42:
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPY.b #$10
	BNE.b CODE_03AF54
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_03AF57
CODE_03AF54:
	PLA
	PLY
	RTL

CODE_03AF57:
	LDA.w $7D96,x
	BEQ.b CODE_03AFB0
	CMP.w #$0020
	BCS.b CODE_03AF76
	LSR
	BNE.b CODE_03AF6B
	LDA.w #!Define_YI_SoundID77_EnemyJumpingOutOfPipe
	JSL.l CODE_push_sound_queue
CODE_03AF6B:
	AND.w #$0001
	ASL
	DEC
	ADC.w $70E2,x
	STA.w $70E2,x
CODE_03AF76:
	LDA.w $7042,x
	AND.w #$00F1
	ORA.w #$0006
	STA.w $7042,x
	LDA.w $7A98,x
	BNE.b CODE_03AF91
	LDA.w #$000C
	STA.w $7A98,x
	JSL.l CODE_03B5C3
CODE_03AF91:
	LDA.w $7D38,x
	BNE.b CODE_03AFB6
	DEC.w $7D96,x
	BNE.b CODE_03AFA9
	JSL.l CODE_04849E
	JSL.l CODE_03B078
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_03AFA9:
	JSL.l CODE_03A1BE
	PLA
	PLY
	RTL

CODE_03AFB0:
	LDA.w $7D38,x
	BNE.b CODE_03AFB6
	RTL

CODE_03AFB6:
	DEC
	BEQ.b CODE_03AFBC
	DEC.w $7D38,x
CODE_03AFBC:
	LDY.w $7722,x
	BMI.b CODE_03AFF0
	LDA.w $7403,x
	AND.w #$00FF
	BEQ.b CODE_03AFF0
	LDA.b $16,x
	CLC
	ADC.w #$0010
	AND.w #$00FF
	STA.b $16,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	JSL.l CODE_03B631
	LDA.l DATA_03AF1F,x
	LDX.b #FXCODE_088205>>16
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_03AFF0:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_03B02B
	LDA.w $7542,x
	CMP.w #$0040
	BCS.b CODE_03B005
	JSR.w CODE_03B11B
	BRA.b CODE_03B02B

CODE_03B005:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w $7D96,x
	BEQ.b CODE_03B024
	PLA
	PLY
	JML.l CODE_03B595

CODE_03B024:
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_03B212
CODE_03B02B:
	LDA.w $7860,x
	BIT.w #$0001
	BNE.b CODE_03B04D
	AND.w #$0002
	BEQ.b CODE_03B058
	LDA.w $7542,x
	CMP.w #$0040
	BCC.b CODE_03B055
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_03B212
	JMP.w CODE_03B0C1

CODE_03B04D:
	LDA.w $7542,x
	CMP.w #$0040
	BCS.b CODE_03B05B
CODE_03B055:
	JSR.w CODE_03B11B
CODE_03B058:
	JMP.w CODE_03B0C1

CODE_03B05B:
	LDA.w #!Define_YI_SoundID1F_HitHead
	JSL.l CODE_03B212
	JSL.l CODE_03A58B
	LDA.b $18,x
	CMP.w #$0003
	BCC.b CODE_03B0AC
	LDA.w $6FA2,x
	AND.w #$6000
	BNE.b CODE_03B078
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_03B078:
	JSL.l CODE_03AF0D
	TXY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	JSL.l CODE_spawn_sprite
	LDA.w $77C2,x
	AND.w #$00FF
	STA.w $7400,x
	JSL.l CODE_spr_state_init_entry
	LDA.w $7D96,x
	BEQ.b CODE_03B0A5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7042,x
	AND.w #$00F1
	ORA.w #$0006
	STA.w $7042,x
CODE_03B0A5:
	RTL

;---------------------------------------------------------------------------

DATA_03B0A6:
	dw $FD80,$FDC0,$FE00

CODE_03B0AC:
	INC.b $18,x
	LDA.b $18,x
	ASL
	TXY
	TAX
	LDA.l DATA_03B0A6-$02,x
	TYX
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_03B0C1:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_03B118
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03B118
	LDA.w $7D96,y
	BEQ.b CODE_03B0DF
	PHY
	TYX
	JSL.l CODE_03B595
	PLY
	LDX.b $12
	BRA.b CODE_03B0EE

CODE_03B0DF:
	LDA.w $6FA0,y
	AND.w #$0020
	BNE.b CODE_03B118
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	BCS.b CODE_03B118
CODE_03B0EE:
	LDA.w $7542,x
	CMP.w #$0040
	BCS.b CODE_03B10B
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_03B10B
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_03B10B
	LDA.w #$0004
	STA.w $7542,x
	BRA.b CODE_03B118

CODE_03B10B:
	LDA.w $7D96,x
	BEQ.b CODE_03B114
	JML.l CODE_03B595

CODE_03B114:
	JSL.l CODE_kill_sprite_by_hit_checked
CODE_03B118:
	PLA
	PLY
	RTL

CODE_03B11B:
	CMP.w #$0002
	BCS.b CODE_03B123
	LDA.w #!Define_YI_SoundID67_EnemyTumbling-$0099
CODE_03B123:
	ADC.w #!Define_YI_SoundID99_BigExplosion
	CMP.w #!Define_YI_SoundID9E_EggBounce3+$01
	BCC.b CODE_03B12E
	LDA.w #!Define_YI_SoundID9E_EggBounce3
CODE_03B12E:
	JSL.l CODE_03B212
	RTS

CODE_03B133:
	LDY.w $7D36,x
	BPL.b CODE_03B140
	JSL.l CODE_03D35D
	TYX
	JSR.w (DATA_03B141,x)
CODE_03B140:
	RTL

DATA_03B141:
	dw CODE_03B149
	dw CODE_03B149
	dw CODE_03B18B
	dw CODE_03B1C4

CODE_03B149:
	LDX.b $12
	LDA.w $7C16,x
	EOR.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03B18A
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDA.w #$FE00
	LDY.w $77C2,x
	BEQ.b CODE_03B165
	LDA.w #$0200
CODE_03B165:
	STA.w $60B4
	STA.w $60A8
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FD00
	STA.w $60AA
	LDA.w #$0008
	STA.w $60C0
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_03B18A:
	RTS

CODE_03B18B:
	LDX.b $12
	LDA.w $7C18,x
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03B1C3
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03B1A4
	LDA.w #$0000
CODE_03B1A4:
	BIT.w $60AA
	BMI.b CODE_03B1AE
	CMP.w $60AA
	BMI.b CODE_03B1B1
CODE_03B1AE:
	STA.w $60AA
CODE_03B1B1:
	LDA.w #$0005
	STA.w $60C2
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_03B1C3:
	RTS

CODE_03B1C4:
	LDX.b $12
	LDA.w $7C18,x
	EOR.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03B20A
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDA.w $60AA
	BPL.b CODE_03B1DD
	LDA.w #$0000
CODE_03B1DD:
	BIT.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03B1E7
	CMP.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03B1F0
CODE_03B1E7:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_03B1F0:
	LDA.w $60FC
	AND.w #$0018
	BNE.b CODE_03B1FE
	LDA.w #$FC00
	STA.w $60AA
CODE_03B1FE:
	LDA.w #$0008
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
CODE_03B20A:
	RTS

CODE_03B20B:
	STZ.w $60D4
	JSR.w CODE_03B1F0
	RTL

;---------------------------------------------------------------------------

CODE_03B212:
	JSL.l CODE_push_sound_queue
	LDA.w #$0040
	STA.w $61F2
	LDA.w $70E2,x
	STA.w $6EB2
	LDA.w $7182,x
	STA.w $6EB4
	RTL

;---------------------------------------------------------------------------

DATA_03B229:
	dw $0001,$0003,$0005

CODE_03B22F:
	LDY.w $7D36,x
	BEQ.b CODE_03B248
	BPL.b CODE_03B23B
	JSL.l CODE_03A5BE
	RTL

CODE_03B23B:
	LDA.w $6EFF,y
	CMP.w #$0010
	BNE.b CODE_03B248
	LDA.w $7D37,y
	BNE.b CODE_03B249
CODE_03B248:
	RTL

CODE_03B249:
	DEY
	TYX
CODE_kill_sprite_by_hit_checked:                ; guarded entry: bails (carry set) for Shy-Guy-likes (CODE_04906C) and Cactus Jack, which keep their own death paths
CODE_03B24B:
	JSL.l CODE_04906C
	BEQ.b CODE_03B257
	JSL.l CODE_0EBE8D
	BNE.b CODE_kill_sprite_by_hit_special_cases
CODE_03B257:
	LDX.b $12
	SEC
	RTL

CODE_kill_sprite_by_hit_special_cases:          ; per-ID redirects (Huffin Puffin always, Green Giant Egg when $75E2 >= $0401) before the generic kill below
CODE_03B25B:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr028_HuffinPuffin
	BNE.b CODE_03B266
CODE_03B263:
	JMP.w CODE_03B34C

CODE_03B266:
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg
	BNE.b CODE_kill_sprite_by_hit
	LDA.w $75E2,x
	CMP.w #$0401
	BCS.b CODE_03B263
CODE_kill_sprite_by_hit:                        ; canonical die-by-hit: status $0C death-spin, speeds cleared, then the shared tail applies knockback (XSpeed +-$0100 away from the hit, YSpeed $FE00) with per-ID variations
CODE_03B273:
	LDA.w #$000C
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0400
	STA.w $75E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_03B288:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr022_FlashingEgg
	BCC.b CODE_03B2D0
	CMP.w #!Define_YI_NorSpr02B_GreenGiantEgg+$01
	BCS.b CODE_03B2D0
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BCC.b CODE_03B2BF
	CMP.w #!Define_YI_NorSpr027_Key
	BEQ.b CODE_03B2AF
	LDA.w $7542,x
	CMP.w #$0040
	BCC.b CODE_03B313
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BCS.b CODE_03B313
CODE_03B2AF:
	LDA.w #$0001
	STA.b $18,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.w $7D38,x
	BRA.b CODE_03B30B

CODE_03B2BF:
	JSR.w CODE_03B3C2
	LDA.w #$0040
	STA.w $7542,x
CODE_03B2C8:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BRA.b CODE_03B31C

CODE_03B2D0:
	CMP.w #!Define_YI_NorSpr107_WatermelonSeed
	BNE.b CODE_03B2DC
	JSL.l CODE_01AE1E
	JMP.w CODE_03B3BE

CODE_03B2DC:
	LDA.w #$0040
	STA.w $7542,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr1A5_RunAwayMonkey
	BCC.b CODE_03B34E
	CMP.w #!Define_YI_NorSpr1AA_HotLips
	BCS.b CODE_03B34E
	LDA.w $7A98,x
	BNE.b CODE_03B34C
	LDY.b $12
	PHY
	STX.b $12
	JSL.l CODE_02B2BB
	PLY
	STY.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #$0199
	BNE.b CODE_03B30B
	JMP.w CODE_03B3AD

CODE_03B30B:
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BRA.b CODE_03B31C

CODE_03B313:
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $7D38,x
CODE_03B31C:
	LDY.b $12
	LDA.w $7C76,y
	BNE.b CODE_03B328
	CPX.w $7972
	BRA.b CODE_03B331

CODE_03B328:
	CPX.b $12
	BEQ.b CODE_03B330
	EOR.w #$FFFF
	INC
CODE_03B330:
	ASL
CODE_03B331:
	LDA.w #$FF00
	BCC.b CODE_03B339
	LDA.w #$0100
CODE_03B339:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	JSL.l CODE_03A0A1
CODE_03B34C:
	BRA.b CODE_03B3B6

CODE_03B34E:
	CMP.w #!Define_YI_NorSpr115_Coin
	BNE.b CODE_03B380
CODE_03B353:
	LDA.w $7042,x
	BIT.w #$0002
	BEQ.b CODE_03B373
CODE_03B35B:
	JSL.l CODE_03A4E9
	LDA.w #!Define_YI_SoundID93_RedCoin
	INC.w !RAM_YI_Level_RedCoinsCollectedLo
	LDY.w !RAM_YI_Level_RedCoinsCollectedLo
	CPY.b #$14
	BMI.b CODE_03B36D
	INC
CODE_03B36D:
	JSL.l CODE_push_sound_queue
	BRA.b CODE_03B3BE

CODE_03B373:
	JSL.l CODE_03A520
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	BRA.b CODE_03B3BE

CODE_03B380:
	CMP.w #!Define_YI_NorSpr100_Bubbled1up
	BNE.b CODE_03B39C
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	SEC
	SBC.w #$0004
	STA.w $0002
	LDA.b $18,x
	INC
	JSL.l CODE_03A4A5
CODE_03B39C:
	LDY.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr107_WatermelonSeed
	BNE.b CODE_03B3AD
	TXY
	JSR.w CODE_make_star_or_coin
	JMP.w CODE_03B2C8

CODE_03B3AD:
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
CODE_03B3B6:
	CPX.w $61B6
	BNE.b CODE_03B3BE
	STZ.w $61B6
CODE_03B3BE:
	LDX.b $12
	CLC
	RTL

CODE_03B3C2:
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	LDA.w $7042,x
	STA.w $0004
	PHX
	JSL.l CODE_04F88E
	PLX
	TXY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr022_FlashingEgg
	ASL
	TAX
	JSR.w (DATA_break_egg_ptr,x)
	TYX
	RTS

DATA_03B3E9:
DATA_break_egg_ptr:                                  ; Raidenthequick: DATA_break_egg_ptr (4-entry dispatch indexed by egg-type subID)
	dw CODE_spawn_red_coin
	dw CODE_spawn_2_stars
	dw CODE_spawn_coin
	dw CODE_break_green_egg

CODE_03B3F1:
CODE_break_green_egg:                                ; Raidenthequick: CODE_break_green_egg (just despawn, no replacement)
	TYX
	PLA
	PLA
	JSL.l CODE_03A31E
	BRA.b CODE_03B3BE

CODE_03B3FA:
CODE_spawn_red_coin:                                 ; Raidenthequick: CODE_spawn_red_coin (spawn coin then flip palette to red)
	LDA.w #!Define_YI_NorSpr115_Coin
	JSL.l CODE_spawn_sprite
	LDA.w $7042,y
	EOR.w #$0006
	STA.w $7042,y
CODE_03B40A:
CODE_init_coin_timers:                               ; Raidenthequick: CODE_init_coin_timers
	LDA.w #$0100
	STA.w $7A96,y
	LDA.w #$0140
	STA.w $7A98,y
	LDA.w #$0010
	STA.w $7AF6,y
	RTS

CODE_03B41D:
CODE_spawn_coin:                                     ; Raidenthequick: CODE_spawn_coin (regular yellow coin from flashing egg)
	LDA.w #!Define_YI_NorSpr115_Coin
	JSL.l CODE_spawn_sprite
	BRA.b CODE_init_coin_timers

CODE_03B426:
CODE_make_star_or_coin_l:                            ; Raidenthequick: CODE_make_star_or_coin_l (long-call wrapper)
	JSR.w CODE_make_star_or_coin
	RTL

CODE_03B42A:
CODE_spawn_2_stars:                                  ; Raidenthequick: CODE_spawn_2_stars (1 current slot + 1 new)
	LDA.w #$0001
	BRA.b CODE_make_stars_or_coins

CODE_03B42F:
CODE_make_star_or_coin:                              ; Raidenthequick: CODE_make_star_or_coin (1 in current slot, no extras)
	LDA.w #$0000
CODE_03B432:
CODE_make_stars_or_coins:                            ; Raidenthequick: CODE_make_stars_or_coins (A=# extra stars/coins beyond current slot)
	STA.b $08
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_SoftMaxStarTimerThreshold
	LDA.w #!Define_YI_NorSpr1A2_HealthStar
	BCC.b CODE_03B442
	LDA.w #!Define_YI_NorSpr115_Coin
CODE_03B442:
	JSL.l CODE_spawn_sprite
	LDA.w #$0000
	STA.w $7D96,y
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_SoftMaxStarTimerThreshold
	BCC.b CODE_03B459
	JSR.w CODE_init_coin_timers
	BRA.b CODE_03B468

CODE_03B459:
	LDA.w #$0180
	STA.w $7A96,y
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,y
	REP.b #$20
CODE_03B468:
	LDA.b $08
	BEQ.b CODE_03B479
	PHY
	LDA.w !RAM_YI_Level_StarTimerLo
	CLC
	ADC.w #$000A
	JSL.l CODE_03C793
	PLY
CODE_03B479:
	RTS

;---------------------------------------------------------------------------

CODE_03B47A:
	LDY.w $03BA
	CPY.b #$1E
	BCS.b CODE_03B49D
CODE_03B481:
	PHX
	STA.b $04
	ASL
	TAX
	LDA.w $03BA
	CLC
	ADC.l DATA_03B229-$06,x
	CMP.w #$001E
	BCC.b CODE_03B496
	LDA.w #$001E
CODE_03B496:
	STA.w $03BA
	PLX
	JMP.w CODE_03A4C3

CODE_03B49D:
	LDA.w #$0115
	TXY
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03B4D5
	LDA.b $00
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
	LDA.w #$0030
	STA.w $7A96,y
	STA.w $7A98,y
	STA.w $7AF6,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	LDA.w #$FE80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0008
	STA.w $7542,y
	LDA.w $6FA2,y
	AND.w #$FFE0
	STA.w $6FA2,y
CODE_03B4D5:
	RTL

;---------------------------------------------------------------------------

CODE_03B4D6:
	PHY
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_03B212
	PLY
CODE_03B4DF:
	LDA.w $70E2,y
	STA.b $00
	LDA.w $7182,y
	STA.b $02
	LDA.w #!Define_YI_AmbSpr208
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0003
	STA.w $7782,y
	LDA.w #$0016
	STA.w $73C2,y
	RTL

;---------------------------------------------------------------------------

CODE_03B507:
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_03B50B:
	LDA.w $70E2,x
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w #$0008
	STA.b $02
	BRA.b CODE_spawn_ambient_stomp_puff

CODE_03B51F:
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_03B523:
	LDA.w $70E2,x
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$8000
	ROR
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	BRA.b CODE_03B555

CODE_03B53D:
	LDA.w $70E2,x
	CLC
	ADC.w $70E2,y
	CMP.w #$8000
	ROR
	CLC
	ADC.w #$0008
	STA.b $00
	LDA.w $7182,x
	CLC
	ADC.w $7182,y
CODE_03B555:
	CMP.w #$8000
	ROR
	CLC
	ADC.w #$0002
	STA.b $02
	LDA.w $0CCE
	BEQ.b CODE_03B565
	RTL

CODE_03B565:
	LDA.w #$0010
	STA.w $0CCE
; Universal enemy-stomp puff spawner. CODE_03B56B is the entry that
; loads AmbSpr $1E6 then falls into the common body; CODE_03B56E is the
; common body reachable when the caller has already loaded a different
; AmbSpr ID (e.g. $1E7) into A. Plays SoundID1C_StompEnemy, spawns the
; ambient slot, writes position + lifetime ($7782=4, $73C2=7, $7E4C=7).
; CODE_03B56B itself has ZERO JSL callers in the asm; it's the entry
; for ONE of 14 inline copies of the LDA #$01E6 + sound + spawn pattern
; that appear at sprite-handler stomp sites across Bank01/02/03/04/05/06/07/0C/0E/0F.
CODE_03B56B:
CODE_spawn_ambient_stomp_puff:
	LDA.w #!Define_YI_AmbSpr1E6
CODE_03B56E:
CODE_spawn_ambient_stomp_puff_common:
	PHA
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_03B212
	PLA
CODE_03B577:
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0007
	STA.w $73C2,y
	STA.w $7E4C,y
	RTL

;---------------------------------------------------------------------------

CODE_03B595:
	LDA.w #!Define_YI_SoundIDA1_BreakFrozenEnemy
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1F2
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w #$000B
	STA.w $73C2,y
	LDA.w #$0004
	STA.w $7782,y
	JSL.l CODE_03B288
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

CODE_03B5C3:
	JSL.l CODE_random_number_gen
	LDA.w $796F
	AND.w #$FF00
	ORA.w $7BB8,x
	STA.w !REGISTER_Multiplicand
	LDA.w !EXRAM_YI_Global_RNGOutputHi|!EXRAMBankMirror
	LSR
	NOP #2
	LDA.w !REGISTER_ProductOrRemainderHi
	AND.w #$00FF
	BCC.b CODE_03B5E4
	EOR.w #$FFFF
CODE_03B5E4:
	ADC.w $70E2,x
	STA.b $00
	JSL.l CODE_random_number_gen
	LDA.w $796F
	AND.w #$FF00
	ORA.w $7BB6,x
	STA.w !REGISTER_Multiplicand
	LDA.w !EXRAM_YI_Global_RNGOutputHi|!EXRAMBankMirror
	LSR
	NOP #2
	LDA.w !REGISTER_ProductOrRemainderHi
	AND.w #$00FF
	BCC.b CODE_03B60A
	EOR.w #$FFFF
CODE_03B60A:
	ADC.w $7182,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1F0
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $00
	STA.w $70A2,y
	LDA.b $02
	SEC
	SBC.w #$0004
	STA.w $7142,y
	LDA.w #$0006
	STA.w $7E4C,y
	LDA.w #$0004
	STA.w $7782,y
	RTL

;---------------------------------------------------------------------------

CODE_03B631:
	REP.b #$10
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b $12
	LDA.w #FXDATA_540000>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $7403,x
	AND.w #$00FF
	DEC
	ASL
	TAY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	ASL
	TAX
	LDA.l FXDATA_0AAB14,x
	TAX
	AND.w #$0400
	BEQ.b CODE_03B665
	LDA.w #$8000
CODE_03B665:
	STA.b $00
	TXA
	BIT.w #$0200
	BEQ.b CODE_03B66F
	INC.b $00
CODE_03B66F:
	BIT.w #$0100
	BEQ.b CODE_03B67A
	LDA.w #$4000
	TSB.b $00
	TXA
CODE_03B67A:
	AND.w #$0080
	TSB.b $00
	TXA
	AND.w #$0070
	XBA
	LSR
	TSB.b $00
	TXA
	AND.w #$000F
	ASL
	ASL
	ASL
	ORA.b $00
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	SEP.b #$10
	TYX
	RTL

;---------------------------------------------------------------------------

CODE_03B697:
	LDA.w $7860,x
	LSR
	BCS.b CODE_03B6D9
CODE_03B69D:
	LDA.w $75E2,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	ASL
	LDA.w $7542,x
	BCC.b CODE_03B6AE
	EOR.w #$FFFF
	INC
CODE_03B6AE:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	AND.w #$00FF
	XBA
	CLC
	ADC.w $7180,x
	STA.w $7180,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	AND.w #$FF00
	BPL.b CODE_03B6CB
	ORA.w #$00FF
CODE_03B6CB:
	XBA
	ADC.w #$0000
	STA.w $72C2,x
	CLC
	ADC.w $7182,x
	STA.w $7182,x
CODE_03B6D9:
	LDA.w $75E0,x
	SEC
	SBC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	LDA.w $7540,x
	BCC.b CODE_03B6EA
	EOR.w #$FFFF
	INC
CODE_03B6EA:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$00FF
	XBA
	CLC
	ADC.w $70E0,x
	STA.w $70E0,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$FF00
	BPL.b CODE_03B707
	ORA.w #$00FF
CODE_03B707:
	XBA
	ADC.w #$0000
	STA.w $72C0,x
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	RTL

;---------------------------------------------------------------------------

CODE_03B716:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_03B741
	LDA.w $7A96,x
	BEQ.b CODE_03B729
	DEC.w $7A96,x
CODE_03B729:
	LDA.w $7A98,x
	BEQ.b CODE_03B731
	DEC.w $7A98,x
CODE_03B731:
	LDA.w $7AF6,x
	BEQ.b CODE_03B739
	DEC.w $7AF6,x
CODE_03B739:
	LDA.w $7AF8,x
	BEQ.b CODE_03B741
	DEC.w $7AF8,x
CODE_03B741:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Egg sprites Init -- all five egg-projectile flavours share one Init path.
; Flashing egg ($022) sets the flashing-palette bit (CODE_03B75E) and falls
; through to the common path used by red ($023) and yellow ($024) eggs.
; The two giant eggs ($02A red giant, $02B green giant) skip that step and
; fall into the green-egg init below.
; CODE_03D3F8 = "is this egg from a normal source (Yoshi spit) or a generator?";
; CODE_0ED844 = standard egg trail/sparkle queueing.
; see also: ys_enmy.asm.
;-------------------------------------------------------------------------
; See docs/family-eggs.md for the full egg family breakdown (~14 sprites).
; The egg family is one of the densest label-collapsing groups in YI:
; 7 sprite-IDs ($022/$023/$024/$025/$029/$02A/$02B) collapse into 3
; physical Init bodies and 6 Main labels into 2. $022 FlashingEgg
; falls through into $023/$024 generator-guard, which falls through
; into $025/$029/$02A/$02B's no-op RTL. $029 GiantEgg uniquely doubles
; as the "Prince Froggy / Frog Pirate wakeup egg" by arming $7AF8,x
; on spawn -- when the timer expires the slot transmutes back into
; BabyMario via CODE_spawn_sprite.
YI_NorSpr022_FlashingEgg_Init:
init_flashing_egg:                              ; Raidenthequick: init_flashing_egg
;$03B742
	JSL.l CODE_03B75E
YI_NorSpr023_RedEgg_Init:
YI_NorSpr024_YellowEgg_Init:
init_egg:                                       ; Raidenthequick: init_egg
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_init_egg_return
	JSL.l CODE_03D3F8
	BEQ.b CODE_03B755
	JML.l CODE_despawn_sprite_free_slot

CODE_03B755:
	JSL.l CODE_0ED844
YI_NorSpr025_GreenEgg_Init:
YI_NorSpr029_GiantEgg_Init:
YI_NorSpr02A_RedGiantEgg_Init:
YI_NorSpr02B_GreenGiantEgg_Init:
CODE_init_giant_egg_frog:                            ; Raidenthequick: CODE_init_giant_egg_frog
CODE_03B759:
CODE_init_egg_return:                                ; Raidenthequick: CODE_init_egg_return (no-op for green/giant eggs)
	RTL

;---------------------------------------------------------------------------

DATA_03B75A:
	db $00,$02,$04,$08

CODE_03B75E:
	TXY
	LDA.w $0030
	AND.w #$0003
	TAX
	LDA.w $7042,y
	AND.w #$00F1
	ORA.l DATA_03B75A,x
	AND.w #$00FF
	STA.w $7042,y
	TYX
	RTL

;---------------------------------------------------------------------------

DATA_03B778:
	dw $0002,$0018,$002C,$0040,$0054,$0068,$007C

DATA_03B786:
	dw $0002,$FFFE

DATA_03B78A:
	dw $0000,$0000,$FFFF,$FFFE,$FFFE,$FFFD,$FFFD,$FFFD
	dw $FFFD,$FFFE,$FFFE,$FFFF,$FFFF,$0000,$0000,$0000
	dw $0001,$0000,$0002,$0003,$0003

;-------------------------------------------------------------------------
; Giant Egg Main ($029) -- used both as the giant egg projectile and as
; Prince Froggy/Frog Pirate's "wakeup" egg.  Despawns once $7AF8,x (timer)
; expires; otherwise jumps to the standard egg-physics body at CODE_03B83C.
; Raidenthequick: main_giant_egg_frog
;-------------------------------------------------------------------------
YI_NorSpr029_GiantEgg_Main:
main_giant_egg_frog:                            ; Raidenthequick: main_giant_egg_frog
;$03B7B4
	LDA.w $7AF8,x
	BNE.b CODE_03B7BC
	JMP.w CODE_03B83C

CODE_03B7BC:
	DEC.w $7AF8,x
	BEQ.b CODE_03B7CD
	CMP.w #$0002
	BNE.b CODE_03B83B
	LDA.w #$00FF
	STA.w $74A2,x
	RTL

CODE_03B7CD:
	LDX.b #FXCODE_0BC6B7>>16
	LDA.w #FXCODE_0BC6B7
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0010
	TRB.w $7E08
	STZ.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	JSL.l CODE_04EF27
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0004
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w #$0008
	STA.w $60BE
	STA.w $60C0
	LDA.w #$FC00
	STA.w $60AA
	STZ.w $60B4
	STZ.w $60D2
	LDX.b $12
	JSL.l CODE_03BF87
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w #!Define_YI_NorSpr061_BabyMario
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7182
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2
	LDA.w #FXDATA_520000+$BC00
	STA.w $6114
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	STZ.w !RAM_YI_Global_PlayMusicLo
	JSL.l CODE_01B25E
	LDX.b $12
CODE_03B83B:
	RTL

CODE_03B83C:
	JSL.l CODE_03B9DD
	LDA.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	DEC
	BNE.b CODE_03B876
	LDA.w $611C
	CLC
	ADC.w $7CD6
	LSR
	STA.b $00
	LDA.w $611E
	CLC
	ADC.w $7CD8
	LSR
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E7
	JSL.l CODE_spawn_ambient_stomp_puff_common
	LDA.w #$0012
	STA.w $7AF8,x
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Egg Main (shared for all 6 egg sprite IDs).  Flashing egg ($022) re-runs
; the palette-cycling helper CODE_03B75E each frame; the other five fall
; straight into the shared physics path at $03B872 (apply gravity, scan for
; sprite-hit, handle wall bounce, spawn explosion glints).
; see also: ys_enmy.asm.
;-------------------------------------------------------------------------
YI_NorSpr022_FlashingEgg_Main:
main_flashing_egg:                              ; Raidenthequick: main_flashing_egg
;$03B86E
	JSL.l CODE_03B75E
YI_NorSpr023_RedEgg_Main:
YI_NorSpr024_YellowEgg_Main:
YI_NorSpr025_GreenEgg_Main:
YI_NorSpr02A_RedGiantEgg_Main:
YI_NorSpr02B_GreenGiantEgg_Main:
main_egg:                                       ; Raidenthequick: main_egg
;$03B872
	JSL.l CODE_03B9DD
CODE_03B876:
	LDA.b $78,x
	BEQ.b CODE_03B87D
	JMP.w CODE_03B96D

CODE_03B87D:
	LDA.w $7A36,x
	BPL.b CODE_03B883
CODE_03B882:
	RTL

CODE_03B883:
	LSR
	BEQ.b CODE_03B88E
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03B882
	JMP.w CODE_03B95E

CODE_03B88E:
	INC.b $16,x
	STZ.w $7402,x
	LDA.b $18,x
	BNE.b CODE_03B8FE
	LDY.w $7860,x
	BNE.b CODE_03B8DA
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
CODE_03B8A8:
	INC.b $18,x
	LDA.w $7042,x
	ORA.w #$0020
	STA.w $7042,x
	LDA.w $6FA0,x
	AND.w #$FFBF
	ORA.w #$0200
	STA.w $6FA0,x
	LDY.b #$01
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BCC.b CODE_03B8CB
	LDY.b #$1A
CODE_03B8CB:
	TYA
	STA.b $00
	LDA.w $6FA2,x
	AND.w #$FFC0
	ORA.b $00
	STA.w $6FA2,x
	RTL

CODE_03B8DA:
	LDA.w $7042,x
	AND.w #$00CF
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

DATA_03B8E4:
	db $01,$00,$01,$00,$02,$00,$02,$00,$04,$00,$04,$00,$08,$00,$08,$00

DATA_03B8F4:
	db $01,$01,$00,$00,$04,$04,$02,$02,$04,$04

CODE_03B8FE:
	LDA.w $7AF6,x
	BEQ.b CODE_03B92A
	LSR
	BNE.b CODE_03B90F
	TXY
	JSL.l CODE_03B4D6
	JML.l CODE_03A31E

CODE_03B90F:
	CMP.w #$0040
	BCS.b CODE_03B92A
	LSR
	LSR
	AND.w #$000E
	TAY
	LDA.w DATA_03B8E4,y
	LDY.b #$05
	AND.w $7AF6,x
	BEQ.b CODE_03B926
	LDY.b #$FF
CODE_03B926:
	TYA
	STA.w $74A2,x
CODE_03B92A:
	LDA.w $7860,x
	LSR
	BCS.b CODE_03B940
	LDA.w #$000A
	STA.w $7A98,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03B95E
	INC.w $7402,x
	BRA.b CODE_03B96C

CODE_03B940:
	JSL.l CODE_03A590
	LDY.w $7A98,x
	BEQ.b CODE_03B954
	LDA.w DATA_03B8F4,y
	AND.w #$00FF
	STA.w $7402,x
	BRA.b CODE_03B95E

CODE_03B954:
	LDA.b $16,x
	AND.w #$0010
	BEQ.b CODE_03B95E
	INC.w $7402,x
CODE_03B95E:
	LDY.w $7D36,x
	BPL.b CODE_03B96C
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_03B96C
	JSL.l CODE_03BEB9
CODE_03B96C:
	RTL

CODE_03B96D:
	JSL.l CODE_03BB1D
	STZ.w $7402,x
	LDA.w $0812,y
	AND.w #$FF00
	BEQ.b CODE_03B983
	BPL.b CODE_03B9BC
	INC.w $7402,x
	BRA.b CODE_03B9BC

CODE_03B983:
	LDA.w $6EBC
	SEC
	SBC.w $70E2,x
	STA.b $00
	ORA.w $60A8
	BEQ.b CODE_03B9AC
	LDA.b $16,x
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_03B78A,y
	BEQ.b CODE_03B9A0
	INC.w $7402,x
CODE_03B9A0:
	LDA.b $00
	BEQ.b CODE_03B9C3
	BPL.b CODE_03B9C6
	EOR.w #$FFFF
	INC
	BNE.b CODE_03B9C6
CODE_03B9AC:
	LDA.b $16,x
	CLC
	ADC.w #$0010
	STA.b $16,x
	AND.w #$0100
	BEQ.b CODE_03B9BC
	INC.w $7402,x
CODE_03B9BC:
	LDA.b $16,x
	AND.w #$000F
	BEQ.b CODE_03B9C6
CODE_03B9C3:
	LDA.w #$0001
CODE_03B9C6:
	SEP.b #$10
	CLC
	ADC.b $16,x
	STA.b $16,x
	AND.w #$000F
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_03B78A,y
	STA.w $7182,x
	RTL

;---------------------------------------------------------------------------

CODE_03B9DD:
	LDY.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPY.b #$08
	BNE.b CODE_03BA43
	LDA.w $6152
	CLC
	ADC.w $6154
	CLC
	ADC.w #$0010
	CMP.w #$0021
	BCS.b CODE_03BA43
	STZ.w $6168
	LDA.w #$0010
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.w $7D38,x
	STZ.w $7860,x
	STZ.w $7A96,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr027_Key
	BEQ.b CODE_03BA17
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
CODE_03BA17:
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$FBC0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7C16,x
	PHP
	BPL.b CODE_03BA2D
	EOR.w #$FFFF
	INC
CODE_03BA2D:
	CLC
	ADC.w #$0100
	PLP
	BMI.b CODE_03BA38
	EOR.w #$FFFF
	INC
CODE_03BA38:
	CLC
	ADC.w $60A8
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	PLA
	PLA
	PLA
	RTL

CODE_03BA43:
	LDA.w $7D38,x
	BNE.b CODE_03BA57
	LDA.b $78,x
	DEC
	BMI.b CODE_03BA53
	LDA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	BNE.b CODE_03BA53
	RTL

CODE_03BA53:
	JML.l CODE_03AF23

CODE_03BA57:
	LDY.b #$34
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BCC.b CODE_03BA84
	LDA.w $7860,x
	LSR
	BCC.b CODE_03BA82
	LDA.w #$0060
	STA.w $61C6
	JSL.l CODE_0294B4
	JSL.l CODE_kill_sprite_by_hit
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	PLA
	PLY
	RTL

CODE_03BA82:
	LDY.b #$3A
CODE_03BA84:
	TYA
	STA.b $00
	LDA.w $6FA2,x
	AND.w #$FFC0
	ORA.b $00
	STA.w $6FA2,x
	LDA.w $6FA0,x
	ORA.w #$0600
	STA.w $6FA0,x
	LDY.w $7542,x
	CPY.b #$40
	BCS.b CODE_03BA53
	LDA.w $7A36,x
	DEC
	BNE.b CODE_03BAAC
	JSL.l CODE_03B133
CODE_03BAAC:
	LDY.w $77C0,x
	BNE.b CODE_03BADF
	LDA.w $7A96,x
	BNE.b CODE_03BAD0
	LDA.w $60B0
	CMP.w #$FFF8
	BMI.b CODE_03BAD6
	CMP.w #$00F8
	BPL.b CODE_03BAD6
	LDA.w $60B2
	CMP.w #$0000
	BMI.b CODE_03BAD6
	CMP.w #$00C0
	BPL.b CODE_03BAD6
CODE_03BAD0:
	JSL.l CODE_03CD07
	BRA.b CODE_03BADF

CODE_03BAD6:
	SEP.b #$20
	LDA.b #$01
	STA.w $77C0,x
	REP.b #$20
CODE_03BADF:
	LDA.b $14
	AND.w #$0001
	ORA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	BNE.b CODE_03BB19
	LDA.w #!Define_YI_AmbSpr1DF
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w $7042,x
	AND.w #$0030
	ORA.w #$0006
	STA.w $7002,y
	LDA.w #$0006
	STA.w $7462,y
	DEC
	STA.w $7E4C,y
	STA.w $73C2,y
	DEC
	STA.w $7782,y
CODE_03BB19:
	JML.l CODE_03AF23

;---------------------------------------------------------------------------

CODE_03BB1D:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b $78,x
	BMI.b CODE_03BB2A
	JMP.w CODE_03BDA1

CODE_03BB2A:
	PLA
	PLY
	STZ.w $7402,x
	LDA.w $0B57
	BNE.b CODE_03BB39
	LDY.w $60DE
	BNE.b CODE_03BB6B
CODE_03BB39:
	STZ.b $78,x
	INC.b $18,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr028_HuffinPuffin
	BNE.b CODE_03BB62
	LDA.w #$FFFF
	STA.b $18,x
	LDA.w $0B57
	BNE.b CODE_03BB5C
	LDA.b $10
	AND.w #$0003
	BNE.b CODE_03BB62
CODE_03BB5C:
	LDA.w #$0030
	STA.w $7AF6,x
CODE_03BB62:
	LDA.w $7FE8
	BPL.b CODE_03BB6A
	STZ.w $7FE8
CODE_03BB6A:
	RTL

CODE_03BB6B:
	CPY.b #$06
	BCS.b CODE_03BB89
	LDY.b #$00
	LDA.w $60E4
	SEC
	SBC.w $70E2,x
	BEQ.b CODE_03BB82
	BPL.b CODE_03BB7E
	LDY.b #$02
CODE_03BB7E:
	TYA
	STA.w $60C4
CODE_03BB82:
	LDY.w $60DE
	CPY.b #$02
	BEQ.b CODE_03BB8C
CODE_03BB89:
	JMP.w CODE_03BD2E

CODE_03BB8C:
	STZ.w $7A36,x
	STZ.b $78,x
	LDA.w #$0020
	STA.w $7D38,x
	LDA.w $60C4
	EOR.w #$0002
	STA.w $7400,x
	LDY.b #$34
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BCC.b CODE_03BBB4
	LDY.b #$3A
	LDA.w $7FE8
	BPL.b CODE_03BBB4
	STZ.w $7FE8
CODE_03BBB4:
	TYA
	STA.b $00
	LDA.w $6FA2,x
	AND.w #$FFC0
	ORA.b $00
	STA.w $6FA2,x
	STZ.b $18,x
	STZ.b $16,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BCC.b CODE_03BBE4
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$0D
	BEQ.b CODE_03BBE4
	LDA.w #$0060
	STA.w $7542,x
	LDA.w #$0600
	STA.w $75E2,x
	JMP.w CODE_03BCD9

CODE_03BBE4:
	STZ.w $7542,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr028_HuffinPuffin
	BNE.b CODE_03BC53
	LDA.w $70E2,x
	SEC
	SBC.w $60E4
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7182,x
	SEC
	SBC.w $60E6
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0BBCF8>>16
	LDA.w #FXCODE_0BBCF8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $7400,x
	BNE.b CODE_03BC1A
	EOR.w #$00FF
	INC
CODE_03BC1A:
	SEC
	SBC.w #$0018
	AND.w #$01FE
	PHA
	LDY.w $7400,x
	BEQ.b CODE_03BC2A
	ORA.w #$8000
CODE_03BC2A:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	REP.b #$10
	PLX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	ASL
	ASL
	SEP.b #$10
	LDX.b $12
	LDY.w $7400,x
	BNE.b CODE_03BC4E
	EOR.w #$FFFF
	INC
CODE_03BC4E:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BRA.b CODE_03BCBB

CODE_03BC53:
	CMP.w #!Define_YI_NorSpr026_BowserFightGiantEgg
	BNE.b CODE_03BC92
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$000C
	STA.w $7542,x
	LDA.w #$0005
	STA.w $74A2,x
	LDA.w #$0060
	STA.w $6FA0,x
	LDA.w #$2000
	STA.w $6FA2,x
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w $60E4
	SEC
	SBC.w $70E2,x
	BPL.b CODE_03BC92
	EOR.w #$FFFF
	SEC
	ADC.w $70E2,x
	STA.w $60E4
CODE_03BC92:
	LDA.w $60E4
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $60E6
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$07F0
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_03BCBB:
	LDA.w #!Define_YI_SoundID20_SoaringEgg
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.b #$01
	STA.w $77C0,x
	REP.b #$20
	STZ.w $7A96,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BRA.b CODE_03BD27

CODE_03BCD9:
	LDA.w $60E4
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $60E6
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0400
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w $60A8
	ASL
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BCS.b CODE_03BD11
	ADC.w $60A8
CODE_03BD11:
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEC
	SBC.w #$0300
	BPL.b CODE_03BD20
	LDA.w #$0000
CODE_03BD20:
	SEC
	SBC.w #$0100
	ADC.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
CODE_03BD27:
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $60E0
	RTL

CODE_03BD2E:
	CPY.b #$06
	BNE.b CODE_03BD40
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BCC.b CODE_03BD40
	LDA.w #$FFFF
	STA.w $7FE8
CODE_03BD40:
	PHB
	PHK
	PLB
	REP.b #$10
	LDY.w $60BE
	LDA.w DATA_egg_carry_y_offsets,y
	AND.w #$FF00
	BPL.b CODE_03BD53
	ORA.w #$00FF
CODE_03BD53:
	XBA
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7182,x
	LDA.w #$0002
	STA.w $74A2,x
	LDA.w DATA_egg_carry_x_offsets,y
	AND.w #$BF00
	BPL.b CODE_03BD6C
	ORA.w #$40FF
CODE_03BD6C:
	XBA
	LDY.w $60C4
	BNE.b CODE_03BD76
	EOR.w #$FFFF
	INC
CODE_03BD76:
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
	SEP.b #$10
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_03BD81:
	dw $0010,$000D,$000B,$0009,$0008,$0007,$0007,$0006
	dw $0006,$0006,$0007,$0007,$0008,$0009,$000B,$000D

CODE_03BDA1:
	PHB
	PHK
	PLB
	LDA.w $61B8
	BEQ.b CODE_03BDAB
	LDY.b #$00
CODE_03BDAB:
	LDA.w DATA_03B778,y
	STA.b $00
	LDY.b #$00
	CMP.b $76,x
	BEQ.b CODE_03BE1D
	BPL.b CODE_03BDBA
	INY
	INY
CODE_03BDBA:
	LDA.b $76,x
	CLC
	ADC.w DATA_03B786,y
	CMP.w #$0004
	BPL.b CODE_03BDF9
	STA.b $76,x
	DEC
	DEC
	EOR.w #$FFFF
	INC
	CMP.w #$0040
	BCS.b CODE_03BDD5
	JMP.w CODE_03BE48

CODE_03BDD5:
	TAY
	LDA.w DATA_03BD81-$40,y
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7182,x
	LDA.w #$0060
	CLC
	ADC.b $76,x
	LSR
	LDY.w $7400,x
	BNE.b CODE_03BDF0
	EOR.w #$FFFF
	INC
CODE_03BDF0:
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
	PLB
	RTL

CODE_03BDF9:
	CPY.b #$00
	BNE.b CODE_03BE1B
	STA.b $00
	LDA.w $05C0
	SBC.b $00
	BPL.b CODE_03BE0A
	CLC
	ADC.w #$0128
CODE_03BE0A:
	REP.b #$10
	TAY
	LDA.w $0813,y
	AND.w #$00FF
	BNE.b CODE_03BE1D
	LDA.b $00
	STA.b $76,x
	BRA.b CODE_03BE2C

CODE_03BE1B:
	STA.b $76,x
CODE_03BE1D:
	LDA.w $05C0
	SEC
	SBC.b $76,x
	BPL.b CODE_03BE29
	CLC
	ADC.w #$0128
CODE_03BE29:
	REP.b #$10
	TAY
CODE_03BE2C:
	PLB
	LDA.w $05C2,y
	STA.w $70E2,x
	LDA.w $06EA,y
	STA.w $7182,x
	LDA.w $7042,x
	AND.w #$00CF
	ORA.w $0812,y
	STA.w $7042,x
	SEP.b #$10
	RTL

CODE_03BE48:
	ASL
	ASL
	STA.b $02
	LDA.w #$0100
	SEC
	SBC.b $02
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0100
	BCC.b CODE_03BE5E
	LDA.b $00
	STA.b $76,x
CODE_03BE5E:
	LDA.w $05C0
	SEC
	SBC.b $00
	BPL.b CODE_03BE6A
	CLC
	ADC.w #$0128
CODE_03BE6A:
	REP.b #$10
	TAY
	LDA.w $05C2,y
	SEC
	SBC.w $70E2,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $06EA,y
	SEC
	SBC.w $7182,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $70E2,x
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $70E2,x
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $7182,x
	CLC
	ADC.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7182,x
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_03BEB5:
	dw $0100,$FF00

CODE_03BEB9:
	JSL.l CODE_0CF957
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	LDA.w $7DF6
	INC
	INC
	CMP.w #$000E
	BCC.b CODE_03BF15
	PHB
	PHK
	PLB
	LDX.w $7DF8
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	STZ.b $78,x
	STZ.b $18,x
	STZ.b $76,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	STZ.w $7D38,x
	LDY.w $77C2,x
	LDA.w DATA_03BEB5,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	PLB
	LDY.b #$02
CODE_03BF01:
	LDA.w $7DF8,y
	STA.w $7DF6,y
	TAX
	TYA
	STA.b $78,x
	INY
	INY
	CPY.w $7DF6
	BCC.b CODE_03BF01
	LDX.b $12
	TYA
CODE_03BF15:
	STA.w $7DF6
	REP.b #$10
	TAY
	CPY.w #$0004
	BCC.b CODE_03BF40
CODE_03BF20:
	LDX.w $7DF4,y
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr027_Key
	BEQ.b CODE_03BF30
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BNE.b CODE_03BF3E
CODE_03BF30:
	TYA
	STA.b $78,x
	TXA
	STA.w $7DF6,y
	DEY
	DEY
	CPY.w #$0004
	BCS.b CODE_03BF20
CODE_03BF3E:
	LDX.b $12
CODE_03BF40:
	TYA
	SEP.b #$10
	STA.b $78,x
	LDA.w #$0002
	STA.b $76,x
	LDA.b $12
	STA.w $7DF6,y
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w $6FA0,x
	AND.w #$F9FF
	ORA.w #$0040
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$0D
	BNE.b CODE_03BF6B
	ORA.w #$0200
CODE_03BF6B:
	STA.w $6FA0,x
	LDA.w $6FA2,x
	AND.w #$FFC0
	STA.w $6FA2,x
	LDA.w #$0005
	STA.w $74A2,x
	STZ.w $7AF6,x
	STZ.w $7542,x
	STZ.w $7D38,x
	RTL

;---------------------------------------------------------------------------

CODE_03BF87:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	BEQ.b CODE_03BFF6
	BMI.b CODE_03BFF6
CODE_03BF8E:
	PHP
	SEP.b #$10
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr028_HuffinPuffin
	BEQ.b CODE_03BFB4
	LDA.w $6FA0,x
	AND.w #$FFBF
	ORA.w #$0200
	STA.w $6FA0,x
CODE_03BFB4:
	PHY
	LDY.b #$01
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BCC.b CODE_03BFC1
	LDY.b #$1A
CODE_03BFC1:
	TYA
	STA.b $00
	LDA.w $6FA2,x
	AND.w #$FFC0
	ORA.b $00
	STA.w $6FA2,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
	PLY
	PHX
CODE_03BFDA:
	CPY.w $7DF6
	BCS.b CODE_03BFEE
	LDA.w $7DF8,y
	STA.w $7DF6,y
	TAX
	TYA
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	INY
	INY
	BRA.b CODE_03BFDA

CODE_03BFEE:
	DEC.w $7DF6
	DEC.w $7DF6
	PLX
	PLP
CODE_03BFF6:
	RTL

;---------------------------------------------------------------------------

CODE_03BFF7:
	PHX
CODE_03BFF8:
	LDY.w $7DF6
	BEQ.b CODE_03C03E
	LDX.w $7DF8
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr027_Key
	BEQ.b CODE_03C03E
	CMP.w #!Define_YI_NorSpr029_GiantEgg
	BEQ.b CODE_03C03E
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	JSL.l CODE_03BF8E
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	LDA.w #$0200
	STA.w $7AF6,x
	BRA.b CODE_03BFF8

CODE_03C03E:
	PLX
	RTL

;---------------------------------------------------------------------------

CODE_03C040:
	JSL.l CODE_03A31E
	JSL.l CODE_03BF87
	LDA.w $70E2,x
	STA.w $7960
	LDA.w $7182,x
	STA.w $7962
	LDA.w $7042,x
	AND.w #$000E
	STA.w $7964
	LDA.w #!Define_YI_AmbSpr1BE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7960
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w $7962
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$0005
	STA.w $7782,y
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Hidden Winged Cloud (sprite $0B5) -- an invisible winged cloud that
; reveals itself when nearby item-detection conditions trigger.  Init just
; calls CODE_03D406 (the shared cloud-init helper).
; Raidenthequick: init_special_winged_cloud
;-------------------------------------------------------------------------
YI_NorSpr0B5_HiddenWingedCloud_Init:
init_special_winged_cloud:                      ; Raidenthequick: init_special_winged_cloud
;$03C07F
	JSL.l CODE_03D406
	RTL

;---------------------------------------------------------------------------

DATA_03C084:
	dw !Define_YI_NorSpr0BE_WingedCloudWith1up
	dw !Define_YI_NorSpr0C1_WingedCloudWith5Stars
	dw !Define_YI_NorSpr0CC_WingedCloudWithRedSwitch
	dw !Define_YI_NorSpr0C1_WingedCloudWith5Stars

YI_NorSpr0B5_HiddenWingedCloud_Main:
main_winged_cloud:                              ; Raidenthequick: main_winged_cloud (shared body)
;$03C08C
	LDA.w !EXRAM_YI_Level_ShowHiddenItemsFlag|!EXRAMBankMirror
	BNE.b CODE_03C0CC
	LDY.w $7D36,x
	BMI.b CODE_03C0CC
	DEY
	BMI.b CODE_03C0FC
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03C0FC
	LDA.w $7D38,y
	BNE.b CODE_03C0B3
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr018_WatermelonFlame
	BEQ.b CODE_03C0B3
	CMP.w #!Define_YI_NorSpr006_WatermelonFreeze
	BNE.b CODE_03C0FC
CODE_03C0B3:
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	CMP.w #$0101
	BCS.b CODE_03C0FC
	LDA.w $7682,x
	CMP.w #$00CC
	BCS.b CODE_03C0FC
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
CODE_03C0CC:
	LDA.w #!Define_YI_SoundID27_CollectSuperStar
	JSL.l CODE_push_sound_queue
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.w #$0010
	ORA.b $00
	LSR
	LSR
	TAY
	LDA.w DATA_03C084,y
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	INC.w $77C0,x
	JSL.l CODE_03B50B
CODE_03C0FC:
	RTL

;---------------------------------------------------------------------------

DATA_03C0FD:
	db $FF,$00,$FF,$00,$FF,$00,$FF,$00,$00,$00,$FF,$00,$00,$00,$08,$08
	db $08,$08,$08,$08,$FF,$FF,$FF,$FF,$FF,$FF,$08,$08,$FF,$FF,$FF,$FF
	db $FF,$FF,$08,$08,$FF,$FF,$FF,$FF,$FF,$FF,$08,$08,$08,$08,$08,$08
	db $FF,$FF,$FF,$FF,$08,$08,$00,$00,$FF,$FF,$FF

DATA_03C138:
	db $00,$04,$04,$04,$04,$04,$04,$04,$04,$00,$00,$04,$04,$00,$00,$04
	db $04,$04,$04,$04,$04,$04,$04,$08,$08,$08,$08,$04,$04,$04,$04,$04
	db $04,$08,$08,$04,$04,$FF,$FF,$08,$08,$04,$04,$04,$04,$04,$04,$04
	db $04,$08,$08,$08,$08,$04,$04,$00,$00,$04,$04,$04,$04

DATA_03C175:
	dw $FF80,$0080

;-------------------------------------------------------------------------
; Winged-cloud Init (shared by all visible single-item variants).  Calls
; the cloud-setup helper CODE_03D406 then CODE_03C236 (the "register cloud
; with collision tables" routine), then jumps to common Main-aliased path.
; Raidenthequick: init_winged_cloud_item
;
; See docs/family-clouds.md for the full WingedCloud + morph-bubble breakdown
; (~25 variants covering single-item / multi-item / hidden / morph payloads,
; with the 30-entry pop-dispatch table that drives each variant's reveal).
;-------------------------------------------------------------------------
YI_NorSpr0B6_WingedCloudWith8Coins_Init:
YI_NorSpr0B7_WingedCloudWithBubbled1up_Init:
YI_NorSpr0B8_WingedCloudWithFlower_Init:
YI_NorSpr0BD_WingedCloudWithCoin_Init:
YI_NorSpr0BF_WingedCloudWithKey_Init:
YI_NorSpr0C0_WingedCloudWith3Stars_Init:
YI_NorSpr0C1_WingedCloudWith5Stars_Init:
YI_NorSpr0CC_WingedCloudWithRedSwitch_Init:
init_winged_cloud_item:                         ; Raidenthequick: init_winged_cloud_item
;$03C179
	JSL.l CODE_03D406
	JSL.l CODE_03C236
	BRA.b CODE_03C1C0

;-------------------------------------------------------------------------
; Morph-bubble Init (shared by all 5 vehicle/morph transformations).  Skips
; the cloud-setup helper; bubbles use a simpler init path.
; Raidenthequick: init_transform_bubble
;-------------------------------------------------------------------------
YI_NorSpr0AF_CarMorphBubble_Init:
YI_NorSpr0B0_MoleMorphBubble_Init:
YI_NorSpr0B1_HelicopterMorphBubble_Init:
YI_NorSpr0B2_TrainMorphBubble_Init:
YI_NorSpr0B4_SubmarineMorphBubble_Init:
init_transform_bubble:                          ; Raidenthequick: init_transform_bubble
;$$03C183
	JSL.l CODE_03C236
	LDA.w $7182,x
	AND.w #$0010
	BEQ.b CODE_03C1C4
	LDA.w $70E2,x
	AND.w #$0010
	BNE.b CODE_03C1B2
	INC.w $7A38,x
	LDA.w #$00FF
	STA.w $74A2,x
	BRA.b CODE_03C1C4

; 1up cloud has its own Init because the 1up reward path needs a per-axis
; position-snap not shared by other clouds.
YI_NorSpr0BE_WingedCloudWith1up_Init:
init_winged_cloud_1up:                          ; Raidenthequick: init_winged_cloud_1up
	JSL.l CODE_03D406
	JSL.l CODE_03C236
	LDA.w $70E2,x
	AND.w #$0010
	BEQ.b CODE_03C1C4
CODE_03C1B2:
	LDY.w $7400,x
	LDA.w DATA_03C175,y
	STA.w $75E0,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BRA.b CODE_03C1C4

YI_NorSpr0B9_WingedCloudWithPOW_Init:
YI_NorSpr0BA_WingedCloudWithStairs_Init:
YI_NorSpr0BB_WingedCloudWithPlatform_Init:
YI_NorSpr0BC_WingedCloudWithBandit_Init:
YI_NorSpr0C2_WingedCloudWithDoor_Init:
YI_NorSpr0C3_WingedCloudWithLowerGround_Init:
YI_NorSpr0C4_WingedCloudWithWatermelon_Init:
YI_NorSpr0C5_WingedCloudWithFireWatermelon_Init:
YI_NorSpr0C6_WingedCloudWithIcyWatermelon_Init:
YI_NorSpr0C7_WingedCloudWith3LeafSunflower_Init:
YI_NorSpr0C8_WingedCloudWith6LeafSunflower_Init:
YI_NorSpr0C9_WingedCloudWithCrashGameFeature_Init:
CODE_03C1C0:
CODE_init_winged_cloud_B:                            ; Raidenthequick: CODE_init_winged_cloud_B (common cloud-register tail)
	JSL.l CODE_03C236
YI_NorSpr0CB_WingedCloudWithCoinOrStar_Init:
CODE_03C1C4:
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0AF_CarMorphBubble
	ASL
	STA.b $00
	LDA.w $70E2,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	ORA.b $00
	TAY
	LDA.w DATA_03C0FD-$01,y
	BMI.b CODE_03C207
	XBA
	AND.w #$00FF
	BNE.b CODE_03C1FB
	JSR.w CODE_03C271
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.b $18,x
	JML.l CODE_03C476

CODE_03C1FB:
	CLC
	ADC.w $70E2,x
	STA.b $78,x
	LDA.w #$0002
	STA.w $7540,x
CODE_03C207:
	LDA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$0010
	LSR
	LSR
	LSR
	LSR
	ORA.b $00
	TAY
	LDA.w DATA_03C138,y
	BMI.b CODE_03C22C
	XBA
	AND.w #$00FF
	CLC
	ADC.w $7182,x
	STA.b $76,x
	LDA.w #$0002
	STA.w $7542,x
CODE_03C22C:
	STZ.w $7400,x
	LDA.w #$0002
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

CODE_03C236:
	LDA.w $70E2,x
	AND.w #$FFF0
	ORA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	AND.w #$FFF0
	ORA.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	AND.w #$0002
	BEQ.b CODE_03C26A
	LDY.b #$02
	JSL.l CODE_02D985
	PLY
	BRA.b CODE_03C2A5

CODE_03C26A:
	LDA.w #$0002
	STA.w $74A2,x
	RTL

CODE_03C271:
	LDY.w $0BF1
	BEQ.b CODE_03C285
	SEP.b #$20
	LDA.w $74A0,x
CODE_03C27B:
	CMP.w $0BF1,y
	BEQ.b CODE_03C29E
	DEY
	BNE.b CODE_03C27B
	REP.b #$20
CODE_03C285:
	LDY.b $18,x
	BEQ.b CODE_03C29D
	LDA.w $7A96,x
	BNE.b CODE_03C29A
	JSL.l CODE_02808C
	LDA.w #$0040
	STA.w $7A96,x
	BRA.b CODE_03C2A5

CODE_03C29A:
	DEC
	BNE.b CODE_03C2A5
CODE_03C29D:
	RTS

CODE_03C29E:
	REP.b #$20
	LDA.w #$0001
	STA.b $18,x
CODE_03C2A5:
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	PLA
	RTL

;---------------------------------------------------------------------------

DATA_03C2B3:
	dw $FF00,$0100

DATA_03C2B7:
	dw $FFFF,$0001

DATA_03C2BB:
	dw $0002,$0005

YI_NorSpr0AF_CarMorphBubble_Main:
YI_NorSpr0B0_MoleMorphBubble_Main:
YI_NorSpr0B1_HelicopterMorphBubble_Main:
YI_NorSpr0B2_TrainMorphBubble_Main:
YI_NorSpr0B4_SubmarineMorphBubble_Main:
YI_NorSpr0B6_WingedCloudWith8Coins_Main:
YI_NorSpr0B7_WingedCloudWithBubbled1up_Main:
YI_NorSpr0B8_WingedCloudWithFlower_Main:
YI_NorSpr0B9_WingedCloudWithPOW_Main:
YI_NorSpr0BA_WingedCloudWithStairs_Main:
YI_NorSpr0BB_WingedCloudWithPlatform_Main:
YI_NorSpr0BC_WingedCloudWithBandit_Main:
YI_NorSpr0BD_WingedCloudWithCoin_Main:
YI_NorSpr0BE_WingedCloudWith1up_Main:
YI_NorSpr0BF_WingedCloudWithKey_Main:
YI_NorSpr0C0_WingedCloudWith3Stars_Main:
YI_NorSpr0C1_WingedCloudWith5Stars_Main:
YI_NorSpr0C2_WingedCloudWithDoor_Main:
YI_NorSpr0C3_WingedCloudWithLowerGround_Main:
YI_NorSpr0C4_WingedCloudWithWatermelon_Main:
YI_NorSpr0C5_WingedCloudWithFireWatermelon_Main:
YI_NorSpr0C6_WingedCloudWithIcyWatermelon_Main:
YI_NorSpr0C7_WingedCloudWith3LeafSunflower_Main:
YI_NorSpr0C8_WingedCloudWith6LeafSunflower_Main:
YI_NorSpr0C9_WingedCloudWithCrashGameFeature_Main:
YI_NorSpr0CB_WingedCloudWithCoinOrStar_Main:
YI_NorSpr0CC_WingedCloudWithRedSwitch_Main:
;$03C2BF
	LDA.b $18,x
	BEQ.b CODE_03C2C6
	JMP.w CODE_03C3DF

CODE_03C2C6:
	STZ.w $7400,x
	LDA.w $7A38,x
	BEQ.b CODE_03C2DE
	LDY.b #$02
	JSL.l CODE_02D985
	LDY.b #$FF
	BCC.b CODE_03C2DA
	LDY.b #$02
CODE_03C2DA:
	TYA
	STA.w $74A2,x
CODE_03C2DE:
	LDY.w $77C0,x
	BEQ.b CODE_03C2F3
	LDY.b #$02
	LDA.w $0030
	AND.w #$0001
	BEQ.b CODE_03C2EF
	LDY.b #$FF
CODE_03C2EF:
	TYA
	STA.w $74A2,x
CODE_03C2F3:
	JSL.l CODE_03AF23
	LDA.b $76,x
	BEQ.b CODE_03C30A
	LDY.b #$00
	CMP.w $7182,x
	BMI.b CODE_03C304
	LDY.b #$02
CODE_03C304:
	LDA.w DATA_03C2B3,y
	STA.w $75E2,x
CODE_03C30A:
	LDA.b $78,x
	BEQ.b CODE_03C31F
	LDY.b #$00
	LDA.b $78,x
	CMP.w $70E2,x
	BMI.b CODE_03C319
	LDY.b #$02
CODE_03C319:
	LDA.w DATA_03C2B3,y
	STA.w $75E0,x
CODE_03C31F:
	JSR.w CODE_03C4F1
	LDA.w $7A38,x
	BNE.b CODE_03C32D
	LDY.w $7D36,x
	DEY
	BPL.b CODE_03C32E
CODE_03C32D:
	RTL

CODE_03C32E:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03C32D
	LDA.w $7D38,y
	BNE.b CODE_03C348
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr018_WatermelonFlame
	BEQ.b CODE_03C348
	CMP.w #!Define_YI_NorSpr006_WatermelonFreeze
	BNE.b CODE_03C32D
CODE_03C348:
	LDA.w $7680,x
	CLC
	ADC.w #$0018
	CMP.w #$0121
	BCS.b CODE_03C32D
	LDA.w $7682,x
	CLC
	ADC.w #$0010
	CMP.w #$00F1
	BCC.b CODE_03C363
	JMP.w CODE_03C3DE

CODE_03C363:
	TYX
	LDA.w #!Define_YI_SoundID32_HitMessageBox
	JSL.l CODE_03B212
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDA.w #$0002
	STA.w $74A2,x
	JSL.l CODE_03CC6B
	STZ.w $7E36
	STZ.w $7E38
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0BA_WingedCloudWithStairs
	LSR
	BEQ.b CODE_03C398
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	STZ.w $75E2,x
	JSL.l CODE_03C48B
	BRA.b CODE_03C3CF

CODE_03C398:
	LDA.w $7040,x
	SEC
	SBC.w #$2001
	STA.w $7040,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$0010
	EOR.w #$0010
	BNE.b CODE_03C3B9
	LDA.w #$FFF0
CODE_03C3B9:
	STA.b $76,x
CODE_03C3BB:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	INC.b $18,x
CODE_03C3CF:
	LDA.w #$0002
	STA.w $74A2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $75E0,x
	STZ.w $7540,x
CODE_03C3DE:
	RTL

CODE_03C3DF:
	DEC
	BNE.b CODE_03C42D
	JSL.l CODE_03AF23
	JSL.l CODE_03CC6B
	JSR.w CODE_03C4F1
	LDA.w $7860,x
	AND.w #$0001
	ORA.w $7862,x
	AND.w #$00FF
	BNE.b CODE_03C41E
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w $1DAE
	BNE.b CODE_03C42C
CODE_03C41E:
	LDA.w $7040,x
	CLC
	ADC.w #$2001
	STA.w $7040,x
	JSL.l CODE_03C48B
CODE_03C42C:
	RTL

CODE_03C42D:
	DEC
	BNE.b CODE_03C481
	JSL.l CODE_03AA52
	JSL.l CODE_03AF23
	JSL.l CODE_03CC6B
	JSL.l CODE_03C4AE
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A38,x
	CLC
	ADC.w #$0018
	STA.w $7A38,x
	CMP.w #$0370
	BCC.b CODE_03C480
	JSL.l CODE_03AEFD
CODE_03C459:
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	INC.b $18,x
	LDA.w #$0003
	STA.w $7402,x
	LDA.w $7040,x
	CLC
	ADC.w #$0800
	STA.w $7040,x
	JSL.l CODE_04849E
CODE_03C476:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	ASL
	TAX
	JMP.w (DATA_winged_clouds_bubbles_pops-!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys,x)

CODE_03C480:
	RTL

CODE_03C481:
	REP.b #$10
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	ASL
	TAX
	JMP.w (DATA_winged_clouds_bubbles_mains-!Define_YI_NorSpr15E_4PinkRotatingPlatformsWithShyGuys,x)

CODE_03C48B:
	LDA.w #$0002
	STA.b $18,x
	JSL.l CODE_03AD74
	BCS.b CODE_03C49B
	PLA
	PLY
	JMP.w CODE_03C459

CODE_03C49B:
	STZ.w $7402,x
	LDA.w $7040,x
	SEC
	SBC.w #$0800
	STA.w $7040,x
	LDA.w #$0100
	STA.w $7A38,x
CODE_03C4AE:
	LDA.w $7A38,x
	CMP.w #$01F0
	BCC.b CODE_03C4B9
	LDA.w #$01F0
CODE_03C4B9:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #FXDATA_550000+$70E0
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$70E0)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_0882F8>>16
	LDA.w #FXCODE_0882F8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

CODE_03C4F1:
	LDA.w $7A96,x
	BNE.b CODE_03C519
	LDY.w $7A36,x
	LDA.w $7402,x
	CMP.w DATA_03C2BB,y
	BNE.b CODE_03C50C
	TYA
	EOR.w #$0002
	STA.w $7A36,x
	TAY
	LDA.w $7402,x
CODE_03C50C:
	CLC
	ADC.w DATA_03C2B7,y
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A96,x
CODE_03C519:
	RTS

DATA_03C51A:
DATA_winged_clouds_bubbles_pops:                     ; Raidenthequick: DATA_winged_clouds_bubbles_pops (per-variant pop handler dispatch)
	dw CODE_pop_transform_bubble
	dw CODE_pop_transform_bubble
	dw CODE_pop_transform_bubble
	dw CODE_pop_transform_bubble
	dw $0000
	dw CODE_pop_transform_bubble
	dw $0000
	dw CODE_pop_8_coins
	dw CODE_pop_1up_bubbled
	dw CODE_pop_flower
	dw CODE_pop_pow
	dw CODE_pop_stairs
	dw CODE_pop_stairs
	dw CODE_pop_bandit
	dw CODE_pop_one_coin
	dw CODE_pop_1up
	dw CODE_pop_key
	dw CODE_pop_3_stars
	dw CODE_pop_5_stars
	dw CODE_pop_door
	dw CODE_pop_ground_eater
	dw CODE_pop_watermelon
	dw CODE_pop_watermelon
	dw CODE_pop_watermelon
	dw CODE_pop_flower_vine
	dw CODE_pop_flower_vine
	dw $0000
	dw $0000
	dw CODE_pop_random_item
	dw CODE_pop_switch

DATA_03C556:
	dw FXDATA_550000+$6061,FXDATA_550000+$6071,FXDATA_550000+$7061,FXDATA_550000+$7071,FXDATA_550000+$0000,FXDATA_550000+$70F0

CODE_03C562:
CODE_pop_transform_bubble:                           ; Raidenthequick: CODE_pop_transform_bubble (car/mole/heli/train/sub morph)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_03AD24
	BCS.b CODE_03C570
	JML.l CODE_03A31E

CODE_03C570:
	LDA.w $7402,x
	STA.b $78,x
	BEQ.b CODE_03C57D
	LDA.w #$0100
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_03C57D:
	LDA.w #$0007
	STA.w $7402,x
	STZ.w $7A36,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDA.w #$0002
	STA.w $7542,x
	LDA.w #$FFC0
	STA.w $75E2,x
	LDA.w #$0020
	STA.w $7A96,x
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0AF_CarMorphBubble
	ASL
	TAY
	LDA.w DATA_03C556,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_550000+$6061)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDX.b #FXCODE_088619>>16
	LDA.w #FXCODE_088619
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	RTL

CODE_03C5E5:
CODE_pop_ground_eater:                               ; Raidenthequick: CODE_pop_ground_eater (lower-ground winged-cloud)
	LDX.b $12
	LDA.w $7680,x
	SEC
	SBC.w #$0080
	ASL
	LDA.w #$0000
	BCS.b CODE_03C5F7
	LDA.w #$0040
CODE_03C5F7:
	PHA
	CLC
	ADC.w $70E2,x
	STA.w $70E2,x
	PLA
	SEC
	SBC.w #$0020
	STA.b $78,x
	LDA.w #$0090
	BRA.b CODE_03C616

CODE_03C60B:
CODE_pop_8_coins:                                    ; Raidenthequick: CODE_pop_8_coins (winged-cloud 8-coin shower)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_03C640
	LDA.w #$0040
CODE_03C616:
	SEP.b #$10
	STA.w $7A96,x
	LDA.w $7182,x
	AND.w #$FFF0
	STA.w $7182,x
CODE_03C624:
	LDA.w $6FA2,x
	AND.w #$FFE0
	STA.w $6FA2,x
	STZ.w $7040,x
	LDA.w #$00FF
	STA.w $74A2,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

CODE_03C640:
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $04
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JML.l CODE_03D3F3

DATA_03C64C:
	dw $FF80,$0080,$0110,$FFE0

CODE_03C654:
CODE_pop_1up_bubbled:                                ; Raidenthequick: CODE_pop_1up_bubbled (bubble-encased 1up reward)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_despawn_sprite_clear_graphics
	LDA.w #!Define_YI_NorSpr100_Bubbled1up
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7A36,x
	LDA.w #$0002
	LDY.w $03A3
	CPY.b #$03
	BEQ.b CODE_03C67D
	LDA.w #$0000
CODE_03C67D:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
	RTL

CODE_03C681:
CODE_pop_flower:                                     ; Raidenthequick: CODE_pop_flower (winged-cloud flower)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_despawn_sprite_clear_graphics
	LDY.b #$71
	JSL.l CODE_03C878
	LDA.w #!Define_YI_NorSpr110_Flower
	BCC.b CODE_03C697
	LDA.w #!Define_YI_NorSpr0FA_Flower
CODE_03C697:
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	RTL

CODE_03C6A3:
CODE_pop_pow:                                        ; Raidenthequick: CODE_pop_pow (winged-cloud POW block)
	SEP.b #$10
	LDX.b $12
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	JSL.l CODE_0294B4
	JML.l CODE_despawn_sprite_free_slot

CODE_03C6B6:
CODE_pop_stairs:                                     ; Raidenthequick: CODE_pop_stairs (winged-cloud stair-step platform / shared with platform)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_03C624
	LDA.w $7CD6,x
	STA.w $70E2,x
	LDA.w $7860,x
	LSR
	LDA.w $7182,x
	BCS.b CODE_03C6D0
	SBC.w #$0004
CODE_03C6D0:
	AND.w #$FFF0
	SEC
	SBC.w #$0010
	STA.w $7182,x
	LDA.w #$0060
	STA.w $7A96,x
	STZ.b $78,x
	RTL

CODE_03C6E3:
CODE_pop_bandit:                                     ; Raidenthequick: CODE_pop_bandit (winged-cloud bandit reward)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_despawn_sprite_clear_graphics
	LDA.w #!Define_YI_NorSpr020_Bandit
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$000C
	STA.b $76,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0017
	STA.w $7402,x
	RTL

CODE_03C70B:
CODE_pop_one_coin:                                   ; Raidenthequick: CODE_pop_one_coin (single-coin winged-cloud reward)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_03C640
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w $7182,x
	AND.w #$FFF0
	STA.w $7182,x
	JMP.w CODE_03C624

CODE_03C725:
CODE_pop_1up:                                        ; Raidenthequick: CODE_pop_1up (winged-cloud direct 1up)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_03C640
	JSL.l CODE_spawn_1up_score
	JML.l CODE_despawn_sprite_free_slot

CODE_03C735:
CODE_pop_key:                                        ; Raidenthequick: CODE_pop_key (winged-cloud key reward)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_despawn_sprite_clear_graphics
	LDA.w #!Define_YI_NorSpr027_Key
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	RTL

DATA_03C74C:
DATA_pop_x_speeds:                                   ; Raidenthequick: DATA_pop_x_speeds (random horizontal speeds for star/coin scatter)
	dw $0040,$FF00,$0080,$FF80,$00C0,$FF40,$0020,$FFE0

DATA_03C75C:
DATA_pop_y_speeds:                                   ; Raidenthequick: DATA_pop_y_speeds (random vertical speeds for star/coin scatter)
	dw $FE00,$FC00,$FC80,$FE80,$FD00,$FD80,$FF00,$FF80

CODE_03C76C:
CODE_pop_3_stars:                                    ; Raidenthequick: CODE_pop_3_stars (winged-cloud 3-star burst entry)
	LDA.w #$0003
CODE_03C76F:
CODE_pop_stars:                                      ; Raidenthequick: CODE_pop_stars (shared body, A = star count)
	STA.b $08
	LDA.w #!Define_YI_SoundID30_AppearingStars
	JSL.l CODE_push_sound_queue
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_03C640
	LDA.w $70E2,x
	STA.w $0000
	LDA.w $7182,x
	STA.w $0002
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w !RAM_YI_Level_StarTimerLo
CODE_03C793:
	STA.b $04
	CMP.w #!Define_YI_Level_SoftMaxStarTimerThreshold
	LDA.w #$01A2
	BCC.b CODE_03C7A0
	LDA.w #$0115
CODE_03C7A0:
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03C7F2
	LDA.w $0000
	STA.w $70E2,y
	LDA.w $0002
	STA.w $7182,y
	LDA.b $04
	CMP.w #$012C
	BCC.b CODE_03C7BE
	JSR.w CODE_init_coin_timers
	BRA.b CODE_03C7C4

CODE_03C7BE:
	LDA.w #$0180
	STA.w $7A96,y
CODE_03C7C4:
	JSL.l CODE_random_number_gen
CODE_03C7C8:
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$000E
	TAX
	LDA.l DATA_pop_x_speeds,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	LSR
	LSR
	LSR
	LSR
	AND.w #$000E
	TAX
	LDA.l DATA_pop_y_speeds,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.b $04
	CLC
	ADC.w #$000A
	DEC.b $08
	BNE.b CODE_03C793
CODE_03C7F2:
	LDX.b $12
	RTL

CODE_03C7F5:
CODE_pop_5_stars:                                    ; Raidenthequick: CODE_pop_5_stars (winged-cloud 5-star burst)
	LDA.w #$0005
	JMP.w CODE_pop_stars

CODE_03C7FB:
CODE_pop_door:                                       ; Raidenthequick: CODE_pop_door (winged-cloud door reward)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_despawn_sprite_clear_graphics
	LDA.w #!Define_YI_NorSpr093_Door
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
	RTL

DATA_03C818:
	dw !Define_YI_NorSpr007_Watermelon
	dw !Define_YI_NorSpr009_FireWatermelon
	dw !Define_YI_NorSpr005_IcyWatermelon

CODE_03C81E:
CODE_pop_watermelon:                                 ; Raidenthequick: CODE_pop_watermelon (variant-aware: regular/fire/icy)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_despawn_sprite_clear_graphics
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0C4_WingedCloudWithWatermelon
	ASL
	TAY
	LDA.w DATA_03C818,y
	TXY
	JSL.l CODE_spawn_sprite
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	JML.l CODE_048060

CODE_03C83E:
CODE_pop_flower_vine:                                ; Raidenthequick: CODE_pop_flower_vine (winged-cloud sunflower vine reward)
	SEP.b #$10
	LDX.b $12
	STZ.w $7402,x
	LDA.w $7040,x
	SEC
	SBC.w #$2001
	STA.w $7040,x
	LDA.w $6FA2,x
	ORA.w #$0001
	STA.w $6FA2,x
	LDA.w $7042,x
	ORA.w #$0002
	STA.w $7042,x
	LDA.w #$FFFC
	STA.w $7720,x
	LDY.b #$5C
	JSL.l CODE_03C878
	JSL.l CODE_03C3BB
	LDA.w #$0007
	STA.w $74A2,x
	RTL

CODE_03C878:
	SEP.b #$20
	TYA
	LDY.b #$06
CODE_03C87D:
	CMP.w $6EB5,y
	BEQ.b CODE_03C889
	DEY
	BNE.b CODE_03C87D
	SEC
	TYA
	BRA.b CODE_03C88E

CODE_03C889:
	TYA
	ADC.b #$06
	ASL
	ASL
CODE_03C88E:
	STA.w $7180,x
	REP.b #$20
	RTL

DATA_03C894:
	dw $0000,$0002,$0000,$0004,$0000,$0002,$0000,$0000

CODE_03C8A4:
CODE_pop_random_item:                                ; Raidenthequick: CODE_pop_random_item (RNG-selected coin/star/1up)
	SEP.b #$10
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0007
	ASL
	TAY
	LDX.w DATA_03C894,y
	LDY.b $12
	JSR.w (DATA_random_item_inits,x)
	TYX
	RTL

DATA_03C8B8:
DATA_random_item_inits:                              ; Raidenthequick: DATA_random_item_inits (3-entry init dispatch for random item)
	dw CODE_spawn_coin
	dw CODE_make_star_or_coin
	dw CODE_item_1up

CODE_03C8BE:
CODE_item_1up:                                       ; Raidenthequick: CODE_item_1up (1up reward path inside random-item)
	TYX
	JSL.l CODE_spawn_1up_score
	JSL.l CODE_despawn_sprite_free_slot
	TXY
	RTS

CODE_03C8C9:
CODE_pop_switch:                                     ; Raidenthequick: CODE_pop_switch (winged-cloud red switch reward)
	SEP.b #$10
	LDX.b $12
	JSL.l CODE_03C640
	JSL.l CODE_despawn_sprite_clear_graphics
	LDA.w #!Define_YI_NorSpr09D_RedSwitch
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	RTL

DATA_03C8ED:
DATA_winged_clouds_bubbles_mains:                    ; Raidenthequick: DATA_winged_clouds_bubbles_mains (per-variant Main handler dispatch)
	dw CODE_main_transform_bubble
	dw CODE_main_transform_bubble
	dw CODE_main_transform_bubble
	dw CODE_main_transform_bubble
	dw $0000
	dw CODE_main_transform_bubble
	dw $0000
	dw CODE_main_8_coin_cloud
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_stairs
	dw CODE_main_cloud_platform
	dw CODE_main_item_clouds
	dw CODE_main_1_coin_cloud
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_ground_eater
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds
	dw CODE_main_flower_vine
	dw CODE_main_flower_vine
	dw $0000
	dw $0000
	dw CODE_main_item_clouds
	dw CODE_main_item_clouds

DATA_03C929:
	db $07,$06,$08,$06

CODE_03C92D:
CODE_main_transform_bubble:                          ; Raidenthequick: CODE_main_transform_bubble (Yoshi morph bubble per-frame)
	LDX.b $12
	LDA.b $18,x
	CMP.w #$0003
	BEQ.b CODE_03C93B
	SEP.b #$10
	JMP.w CODE_03CA65

CODE_03C93B:
	LDA.w $7362,x
	CLC
	ADC.w #$0020
	TAY
	JSL.l CODE_03AA3C
	LDA.w !RAM_YI_Level_MessageBoxState 
	BEQ.b CODE_03C94D
	RTL

CODE_03C94D:
	JSL.l CODE_03AF23
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CMP.w #$0100
	BPL.b CODE_03C966
	LDA.w $7A36,x
	CLC
	ADC.w #$0020
	AND.w #$03FF
	STA.w $7A36,x
CODE_03C966:
	LDY.w $7A37,x
	LDA.w DATA_03C929,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_03C97D
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_03C97D:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	SEC
	SBC.w $75E2,x
	BEQ.b CODE_03C98B
	EOR.w $75E2,x
	BMI.b CODE_03C995
CODE_03C98B:
	LDA.w $75E2,x
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
CODE_03C995:
	LDA.b $14
	AND.w #$000F
	BNE.b CODE_03C9A3
	LDA.w #$0808
	JSL.l CODE_029BD9
CODE_03C9A3:
	LDA.w $7A96,x
	BNE.b CODE_03C9EC
	LDY.w $7D36,x
	BPL.b CODE_03C9EC
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0AE_HookbillTheKoopa
	ASL
	STA.w $0C88
	LDA.w $0C8A
	BEQ.b CODE_03C9D0
	CMP.w $0C88
	BNE.b CODE_03C9F1
	LDA.w #$0500
	STA.w $61F4
	TXY
	JSL.l CODE_03B4D6
	JMP.w CODE_03CA8B

CODE_03C9D0:
	LDA.w $61B2
	BPL.b CODE_03C9EC
	LDA.w $6150
	BEQ.b CODE_03C9ED
	LDA.w $6162
	BEQ.b CODE_03C9ED
	LDA.w !EXRAM_YI_Level_Player_AmmoTypeInMouthLo|!EXRAMBankMirror
	CMP.w #$0001
	BEQ.b CODE_03C9EC
	CMP.w #$0004
	BNE.b CODE_03C9ED
CODE_03C9EC:
	RTL

CODE_03C9ED:
	JSL.l CODE_04F74A
CODE_03C9F1:
	LDA.w #!Define_YI_SoundID36_CollectFlower
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_PlayerState10_Transforming
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $614E
	LDA.w #$0000
	STA.l $70336C
	LDA.w #$2D6C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$2F6C
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$65E9
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08BC98>>16
	LDA.w #FXCODE_08BC98
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w #$7FFF
	STA.l $703070
	LDX.w #$001C
CODE_03CA35:
	LDA.l DATA_5FCB2C,x
	STA.l $70310E,x
	DEX
	DEX
	BPL.b CODE_03CA35
	SEP.b #$10
	LDX.b $12
	LDA.w $0C8A
	BEQ.b CODE_03CA53
	LDA.w #$0003
	STA.w $614E
	JMP.w CODE_03CA8B

CODE_03CA53:
	INC.b $18,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #$0030
	STA.w $7A96,x
	STZ.w $614E
	RTL

CODE_03CA65:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_03CA72
	LDY.w $614E
	BNE.b CODE_03CA73
	INC.w $614E
CODE_03CA72:
	RTL

CODE_03CA73:
	DEC.w $7A96,x
	BPL.b CODE_03CA8A
	INC.w $614E
	LDA.w #$0164
	STA.w $60BE
	LDA.w #FXDATA_520000+$B800
	STA.w $6114
	JMP.w CODE_03CA8B

CODE_03CA8A:
	RTL

CODE_03CA8B:
	LDA.b $78,x
	BNE.b CODE_03CAC4
	SEP.b #$20
	INC.w $0BF1
	LDY.w $0BF1
	LDA.w $74A0,x
	STA.w $0BF1,y
	REP.b #$20
	JSL.l CODE_03AF0D
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,x
	LDA.w #$00FF
	STA.w $74A2,x
	RTL

CODE_03CAC4:
	JML.l CODE_despawn_sprite_free_slot

DATA_03CAC8:
	dw !Define_YI_SoundID04_SpitOut,!Define_YI_SoundID0C_ShellHit2,!Define_YI_SoundID0D_ShellHit3,!Define_YI_SoundID0E_ShellHit4
	dw !Define_YI_SoundID0F_ShellHit5,!Define_YI_SoundID10_ShellHit6,!Define_YI_SoundID11_ShellHit7,!Define_YI_SoundID12_ShellHit8

DATA_03CAD8:
	dw $FFF0,$0020,$0010,$0000,$FFF0,$FFE0,$FFF0,$0000

DATA_03CAE8:
	dw $FFE0,$0000,$0010,$0020,$0010,$0000,$FFF0,$FFE0

CODE_03CAF8:
CODE_main_8_coin_cloud:                              ; Raidenthequick: CODE_main_8_coin_cloud (8-coin shower Main)
	SEP.b #$10
	LDX.b $12
	LDA.w !RAM_YI_Level_MessageBoxState
	BNE.b CODE_03CB09
	LDA.w $7A96,x
	BEQ.b CODE_03CB0A
	DEC.w $7A96,x
CODE_03CB09:
	RTL

CODE_03CB0A:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #$0004
	STA.w $7A96,x
	LDY.b $18,x
	LDA.w DATA_03CAC8-$03,y
	PHY
	JSL.l CODE_push_sound_queue
	PLY
	LDA.w $70E2,x
	CLC
	ADC.w DATA_03CAD8-$03,y
	STA.w $70E2,x
	STA.w $0091
	LDA.w $7182,x
	CLC
	ADC.w DATA_03CAE8-$03,y
	STA.w $7182,x
	STA.w $0093
	INY
	INY
	STY.b $18,x
	CPY.b #$13
	BCC.b CODE_03CB50
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	JSL.l CODE_despawn_sprite_free_slot
CODE_03CB50:
	LDA.w #$0005
	STA.w $008F
	LDA.w #$6000
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	JML.l CODE_0280AC

CODE_03CB66:
CODE_main_item_clouds:                               ; Raidenthequick: CODE_main_item_clouds (shared no-op-ish Main for static reward clouds)
	SEP.b #$10
	LDX.b $12
CODE_03CB6A:
	RTL

CODE_03CB6B:
CODE_main_stairs:                                    ; Raidenthequick: CODE_main_stairs (winged-cloud stair-step Main)
	SEP.b #$10
	LDX.b $12
	LDA.w !RAM_YI_Level_MessageBoxState
	BNE.b CODE_03CB6A
	LDA.b $18,x
	CMP.w #$0003
	BEQ.b CODE_03CB7E
	JMP.w CODE_03CD5F

CODE_03CB7E:
	LDA.w $7A96,x
	BEQ.b CODE_03CB92
	DEC.w $7A96,x
	CMP.w #$0010
	BCC.b CODE_03CB8F
	JML.l CODE_03CC6B

CODE_03CB8F:
	JMP.w CODE_03CC3C

CODE_03CB92:
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	JSR.w CODE_03CD3F
	BCS.b CODE_03CBCD
	LDA.w $70E2,x
	CLC
	ADC.b $76,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	JSR.w CODE_03CD3F
	BCC.b CODE_03CBD7
CODE_03CBCD:
	INC.b $18,x
	LDA.w #$0030
	STA.w $7A96,x
	BRA.b CODE_03CC3C

CODE_03CBD7:
	JSR.w CODE_03CD23
	LDA.w $70E2,x
	STA.w $0091
	LDA.w $7182,x
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$3D59
	LDY.b $77,x
	BPL.b CODE_03CBF6
	LDA.w #$3D5A
CODE_03CBF6:
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w $0091
	CLC
	ADC.b $76,x
	STA.w $0091
	LDA.w #$6600
	LDY.b $77,x
	BPL.b CODE_03CC12
	LDA.w #$6700
CODE_03CC12:
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w $70E2,x
	CLC
	ADC.b $76,x
	STA.w $70E2,x
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,x
	JSL.l CODE_0280AC
	LDA.w $7142,y
	CLC
	ADC.w #$0010
	STA.w $7142,y
CODE_03CC3C:
	LDA.w $7680,x
	SEC
	SBC.w #$0080
	ASL
	LDA.w #$FF00
	BCS.b CODE_03CC4C
	LDA.w #$0100
CODE_03CC4C:
	STA.w $7E36
	LDA.w $7682,x
	SEC
	SBC.w #$0060
	ASL
	LDA.w #$FF00
	BCS.b CODE_03CC5F
	LDA.w #$0100
CODE_03CC5F:
	STA.w $7E38
CODE_03CC62:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_03CC6B:
	LDA.w $7E2A
	BNE.b CODE_03CCBA
	LDA.w $0C1E
	ORA.w $0C20
	BEQ.b CODE_03CC79
	RTL

CODE_03CC79:
	LDA.w $7680,x
	SEC
	SBC.w #$0010
	CMP.w #$00D1
	BCS.b CODE_03CC91
	LDA.w $7682,x
	SEC
	SBC.w #$0010
	CMP.w #$00B1
	BCC.b CODE_03CD06
CODE_03CC91:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C94
	LDA.w !RAM_YI_Global_Layer1YPosLo
	STA.w $0C96
	SEP.b #$20
	LDY.b #$17
	LDX.b #$5C
CODE_03CCA3:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CPX.b $12
	BNE.b CODE_03CCAC
	LDA.b #$00
CODE_03CCAC:
	STA.w $0C98,y
	DEX
	DEX
	DEX
	DEX
	DEY
	BPL.b CODE_03CCA3
	LDX.b $12
	REP.b #$20
CODE_03CCBA:
	LDA.w #$0001
	STA.w $7E2A
	STX.w $1E2C
	LDA.w $70E2,x
	STA.w $7E2E
	LDA.w $7182,x
	STA.w $7E30
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23
	LDA.w !RAM_YI_Global_Layer1YPosLo
	STA.w $0C27
	LDA.w $60B0
	CMP.w #$0008
	BMI.b CODE_03CCF5
	CMP.w #$00E8
	BPL.b CODE_03CCF5
	LDA.w $60B2
	CMP.w #$0010
	BMI.b CODE_03CCF5
	CMP.w #$00B0
	BMI.b CODE_03CD06
CODE_03CCF5:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	LDA.w #$0002
	CMP.w $61D6
	BCC.b CODE_03CD06
	STA.w $61D6
CODE_03CD06:
	RTL

CODE_03CD07:
	LDA.w $7E2A
	BEQ.b CODE_03CD12
	CPX.w $1E2C
	BEQ.b CODE_03CD12
	RTL

CODE_03CD12:
	JSL.l CODE_03CC6B
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w $7E36
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w $7E38
	RTL

CODE_03CD23:
	LDA.w #$0008
	STA.w $7A96,x
	LDA.b $78,x
	INC
	CMP.w #$0006
	BCC.b CODE_03CD34
	LDA.w #$0001
CODE_03CD34:
	STA.b $78,x
	CLC
	ADC.w #!Define_YI_SoundID4B_StairsAppearing1-$01
	JSL.l CODE_push_sound_queue
	RTS

CODE_03CD3F:
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0000
	CLC
	BEQ.b CODE_03CD4E
	SBC.w #$96D0
	CMP.w #$0009
CODE_03CD4E:
	RTS

CODE_03CD4F:
CODE_main_cloud_platform:                            ; Raidenthequick: CODE_main_cloud_platform (winged-cloud cloud-platform Main)
	SEP.b #$10
	LDX.b $12
	LDA.w !RAM_YI_Level_MessageBoxState
	BNE.b CODE_03CD71
	LDA.b $18,x
	CMP.w #$0003
	BEQ.b CODE_03CD80
CODE_03CD5F:
	LDA.w $7A96,x
	BEQ.b CODE_03CD72
	DEC.w $7A96,x
	JSL.l CODE_03CC62
	STZ.w $7E36
	STZ.w $7E38
CODE_03CD71:
	RTL

CODE_03CD72:
	LDA.w $7E2A
	BNE.b CODE_03CD7D
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_03CD7D:
	JMP.w CODE_despawn_sprite_free_slot

CODE_03CD80:
	LDA.w $7A96,x
	BEQ.b CODE_03CD91
	DEC.w $7A96,x
	CMP.w #$0010
	BCC.b CODE_03CDEF
	JML.l CODE_03CC6B

CODE_03CD91:
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	JSR.w CODE_03CD3F
	BCC.b CODE_03CDB7
	INC.b $18,x
	LDA.w #$0030
	STA.w $7A96,x
	BRA.b CODE_03CDEF

CODE_03CDB7:
	JSR.w CODE_03CD23
	LDA.w $70E2,x
	STA.w $0091
	LDA.w $7182,x
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$1512
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	JSL.l CODE_0280AC
	LDA.w $7142,y
	SEC
	SBC.w #$0004
	STA.w $7142,y
	LDA.w $70E2,x
	CLC
	ADC.b $76,x
	STA.w $70E2,x
CODE_03CDEF:
	JMP.w CODE_03CC3C

CODE_03CDF2:
CODE_main_1_coin_cloud:                              ; Raidenthequick: CODE_main_1_coin_cloud (single-coin winged-cloud Main)
	SEP.b #$10
	LDX.b $12
	LDA.w !RAM_YI_Level_MessageBoxState
	BNE.b CODE_03CE03
	LDA.w $7A96,x
	BEQ.b CODE_03CE04
	DEC.w $7A96,x
CODE_03CE03:
	RTL

CODE_03CE04:
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
	LDA.w $70E2,x
	STA.w $0091
	LDA.w $7182,x
	STA.w $0093
	JSL.l CODE_despawn_sprite_free_slot
	LDA.w #$0005
	STA.w $008F
	LDA.w #$6000
	STA.w $0095
	JSL.l CODE_change_map16
	LDX.b $12
	JML.l CODE_0280AC

;---------------------------------------------------------------------------

DATA_03CE31:
	dw $0000,$0000,$0000,$0000,$0000,$1D24,$1D06,$1D08
	dw $1D06,$1D26,$1D28,$1D0A,$1D02,$1D0C,$1D2A,$1D12
	dw $1C5C,$1C5E,$1C5C,$1D14,$1D16,$1CD0,$1CB6,$1CD2
	dw $1D18,$0000,$1CD4,$1CBA,$1CD6,$0000,$1D12,$1C5C
	dw $1C5E,$1C5C,$1D14,$1D16,$1CD0,$1CB6,$1CD2,$1D18
	dw $1C5C,$1CFE,$1CBA

DATA_03CE87:
	dw $1D00,$1C5C,$1E00,$1E00,$3C00

CODE_03CE91:
CODE_main_ground_eater:                              ; Raidenthequick: CODE_main_ground_eater (winged-cloud lower-ground Main)
	SEP.b #$10
	LDX.b $12
	LDA.w !RAM_YI_Level_MessageBoxState
	BEQ.b CODE_03CE9B
	RTL

CODE_03CE9B:
	LDA.w $7A96,x
	BEQ.b CODE_03CEAF
	DEC.w $7A96,x
	CMP.w #$0040
	BCC.b CODE_03CEAC
	JML.l CODE_03CC6B

CODE_03CEAC:
	JMP.w CODE_03CC3C

CODE_03CEAF:
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w #$0010
	STA.w $7A96,x
	LDA.w #$0010
	STA.w $61C6
	LDA.w $70E2,x
	SEC
	SBC.b $78,x
	STA.b $04
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $0093
	LDY.b $18,x
	INY
	CPY.b #$0A
	BCC.b CODE_03CEE7
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	JML.l CODE_despawn_sprite_free_slot

CODE_03CEE7:
	STY.b $18,x
	LDA.w DATA_03CE87,y
	TAY
	BNE.b CODE_03CEF9
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
CODE_03CEF9:
	PHY
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	PLY
	REP.b #$10
	LDA.w #$0003
	STA.b $00
CODE_03CF09:
	LDA.b $04
	STA.w $0091
	LDA.w #$0005
	STA.b $02
CODE_03CF13:
	LDA.w DATA_03CE31,y
	BEQ.b CODE_03CF1C
	TAX
	LDA.w $0000,x
CODE_03CF1C:
	STA.w $0095
	LDA.w #$0001
	STA.w $008F
	PHY
	JSL.l CODE_change_map16
	PLY
	LDA.w $0091
	CLC
	ADC.w #$0010
	STA.w $0091
	INY
	INY
	DEC.b $02
	BNE.b CODE_03CF13
	LDA.w $0093
	CLC
	ADC.w #$0010
	STA.w $0093
	DEC.b $00
	BNE.b CODE_03CF09
	SEP.b #$10
	LDX.b $12
	JMP.w CODE_03CC3C

;---------------------------------------------------------------------------

DATA_03CF50:
	dw $8802,$E802

DATA_03CF54:
	dw $0060,$00C0

CODE_03CF58:
CODE_main_flower_vine:                               ; Raidenthequick: CODE_main_flower_vine (winged-cloud sunflower vine Main)
	SEP.b #$10
	LDX.b $12
	LDA.b $18,x
	CMP.w #$0004
	BEQ.b CODE_03CF66
	JMP.w CODE_03CFDF

CODE_03CF66:
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_03CF81
	JSL.l CODE_03AF23
	JSL.l CODE_03CC6B
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_03CF82
	LDA.w #$0020
	STA.w $7A96,x
CODE_03CF81:
	RTL

CODE_03CF82:
	LDY.w $7A96,x
	BEQ.b CODE_03CFAB
	CPY.b #$10
	BCS.b CODE_03CFAA
	TYA
	AND.w #$0001
	EOR.w $70E2,x
	STA.w $70E2,x
	CPY.b #$04
	BNE.b CODE_03CFAA
	LDA.w $7CD6,x
	STA.b $00
	LDA.w $7CD8,x
	STA.b $02
	LDA.w #!Define_YI_AmbSpr1E7
	JSL.l CODE_spawn_ambient_stomp_puff_common
CODE_03CFAA:
	RTL

CODE_03CFAB:
	INC.b $18,x
	LDA.w #$0001
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	SEC
	SBC.w #!Define_YI_NorSpr0C7_WingedCloudWith3LeafSunflower 
	ASL
	TAY
	LDA.w $7040,x
	CLC
	ADC.w DATA_03CF50,y
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w DATA_03CF54,y
	STA.b $16,x
	STZ.b $76,x
	STZ.b $78,x
	STZ.w $7A36,x
	STZ.w $7A38,x
	STZ.w $7720,x
	RTL

CODE_03CFDF:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0998B6>>16
	LDA.w #FXCODE_0998B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_03D02A
	LDA.b $18,x
	CMP.w #$0005
	BNE.b CODE_03D040
	LDA.w $7182,x
	PHA
	SEC
	SBC.b $76,x
	STA.w $7182,x
	SEC
	SBC.w !RAM_YI_Global_Layer1YPosLo
	STA.w $7682,x
	JSL.l CODE_03CC3C
	PLA
	STA.w $7182,x
	LDA.b $76,x
	CMP.b $16,x
	BCS.b CODE_03D02B
	INC.b $76,x
	SBC.w #$0015
	AND.w #$001F
	BNE.b CODE_03D02A
	LDA.w #!Define_YI_SoundID05_Powerup
	JSL.l CODE_push_sound_queue
CODE_03D02A:
	RTL

CODE_03D02B:
	LDA.w $7A38,x
	CMP.w #$000F
	BCS.b CODE_03D037
	INC.w $7A38,x
	RTL

CODE_03D037:
	INC.b $18,x
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	RTL

CODE_03D040:
	JSL.l CODE_03AF23
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099B23>>16
	LDA.w #FXCODE_099B23
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $6000
	BEQ.b CODE_03D05A
	JSL.l CODE_push_sound_queue
CODE_03D05A:
	LDX.b $12
	RTL

;---------------------------------------------------------------------------

CODE_03D05D:
	STZ.b $0E
	LDY.w $7D36,x
	BMI.b CODE_03D066
	CLC
	RTL

CODE_03D066:
	LDA.w $6122
	CLC
	ADC.w $7BB8,x
	STA.b $00
	CLC
	ADC.w $7C18,x
	STA.b $08
	LDA.w $7C18,x
	SEC
	SBC.b $00
	STA.b $0A
	LDY.b #$00
	CLC
	ADC.b $08
	BMI.b CODE_03D086
	LDY.b #$02
CODE_03D086:
	STY.b $0C
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	STA.b $00
	CLC
	ADC.w $7C16,x
	STA.b $02
	LDA.w $7C16,x
	SEC
	SBC.b $00
	STA.b $04
	LDY.b #$00
	CLC
	ADC.b $02
	BMI.b CODE_03D0A8
	LDY.b #$02
CODE_03D0A8:
	STY.b $06
	LDA.w $7962,y
	BPL.b CODE_03D0B3
	EOR.w #$FFFF
	INC
CODE_03D0B3:
	STA.b $00
	LDY.b $0C
	LDA.w $7968,y
	BPL.b CODE_03D0C0
	EOR.w #$FFFF
	INC
CODE_03D0C0:
	CMP.b $00
	BCC.b CODE_03D0DD
	LDA.w $7968,y
	BMI.b CODE_03D0DA
	LDA.b $00
	CMP.w #$000A
	BCC.b CODE_03D0DA
	REP.b #$10
	JSL.l CODE_player_death_spike
	SEP.b #$10
	BRA.b CODE_03D111

CODE_03D0DA:
	JMP.w CODE_03D208

CODE_03D0DD:
	LDA.w $7968,y
	BPL.b CODE_03D0E5
	JMP.w CODE_03D1C4

CODE_03D0E5:
	LDA.w $60C2
	BEQ.b CODE_03D0F4
	LDA.w $7968,y
	CLC
	ADC.w #$000C
	STA.w $7968,y
CODE_03D0F4:
	LDA.w $7968,y
	CMP.w #$000A
	BCC.b CODE_03D111
	CMP.w #$0012
	BCC.b CODE_03D10B
	REP.b #$10
	JSL.l CODE_player_death_spike
	SEP.b #$10
	BRA.b CODE_03D111

CODE_03D10B:
	LDA.w #$0005
	STA.w $60C2
CODE_03D111:
	LDA.w $60C0
	BEQ.b CODE_03D120
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w $72C2,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03D120:
	JMP.w CODE_03D1FB

;---------------------------------------------------------------------------

DATA_03D123:
	dw $0001,$FFFF

CODE_03D127:
	STZ.b $0E
CODE_03D129:
	LDY.w $7D36,x
	BMI.b CODE_03D130
	CLC
	RTL

CODE_03D130:
	LDA.w $6122
	CLC
	ADC.w $7BB8,x
	STA.b $00
	CLC
	ADC.w $7C18,x
	STA.b $08
	LDA.w $7C18,x
	SEC
	SBC.b $00
	STA.b $0A
	LDY.b #$00
	CLC
	ADC.b $08
	BMI.b CODE_03D150
	LDY.b #$02
CODE_03D150:
	STY.b $0C
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	STA.b $00
	CLC
	ADC.w $7C16,x
	STA.b $02
	LDA.w $7C16,x
	SEC
	SBC.b $00
	STA.b $04
	LDY.b #$00
	CLC
	ADC.b $02
	BMI.b CODE_03D172
	LDY.b #$02
CODE_03D172:
	STY.b $06
	LDA.w $7962,y
	BPL.b CODE_03D17D
	EOR.w #$FFFF
	INC
CODE_03D17D:
	STA.b $00
	LDY.b $0C
	LDA.w $7968,y
	BPL.b CODE_03D18A
	EOR.w #$FFFF
	INC
CODE_03D18A:
	CMP.b $00
	BCC.b CODE_03D191
	JMP.w CODE_03D208

CODE_03D191:
	LDA.w $7968,y
	BMI.b CODE_03D1C4
	LDA.w $60C2
	BEQ.b CODE_03D1A5
	LDA.w $7968,y
	CLC
	ADC.w #$000C
	STA.w $7968,y
CODE_03D1A5:
	LDA.w $7968,y
	CMP.w #$000A
	BCC.b CODE_03D1B3
	LDA.w #$0005
	STA.w $60C2
CODE_03D1B3:
	BRA.b CODE_03D1FB

CODE_03D1B5:
	LDA.w $7968,y
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60D2
	BRA.b CODE_03D1FB

CODE_03D1C4:
	CMP.w #$FFF5
	BMI.b CODE_03D208
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	SEC
	SBC.w $6EBE
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDY.w $60AB
	BMI.b CODE_03D22B
	LDA.w $70E2,x
	SEC
	SBC.w $6EBC
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	INC.w $61B4
	INC.b $0E
	LDA.w $60AA
	STA.b $0C
CODE_03D1FB:
	SEC
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03D204
	LDA.w #$0000
CODE_03D204:
	STA.w $60AA
	RTL

;---------------------------------------------------------------------------

CODE_03D208:
	LDX.b $06
	LDA.b $00
	LSR
	BEQ.b CODE_03D21A
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.l DATA_03D123,x
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
CODE_03D21A:
	LDA.w $60B4
	EOR.l DATA_03D123,x
	BPL.b CODE_03D229
	STZ.w $60A8
	STZ.w $60B4
CODE_03D229:
	LDX.b $12
CODE_03D22B:
	CLC
	RTL

;---------------------------------------------------------------------------

CODE_03D22D:
	LDY.w $7D36,x
	BMI.b CODE_03D233
CODE_03D232:
	RTL

CODE_03D233:
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.b $00
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF6
	BCC.b CODE_03D232
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.w $7182,x
	SEC
	SBC.w $6EBE
	SEC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.b $00
	CLC
	ADC.w $611E
	STA.w $611E
	LDY.w $60AB
	BMI.b CODE_03D232
	LDA.w $70E2,x
	SEC
	SBC.w $6EBC
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	INC.w $61B4
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BPL.b CODE_03D289
	LDA.w #$0000
CODE_03D289:
	STA.w $60AA
	RTL

;---------------------------------------------------------------------------

DATA_03D28D:
	dw $0001,$FFFF

CODE_03D291:
	STZ.b $0E
	LDA.w $61B2
	AND.w #$C000
	ORA.w $61CC
	BNE.b CODE_03D2D6
	LDA.w $7BB6,x
	CLC
	ADC.w $7BB6
	STA.b $00
	ASL
	STA.b $02
	LDA.w $7CD6,x
	SEC
	SBC.w $7CD6
	STA.b $04
	CLC
	ADC.b $00
	CMP.b $02
	BCS.b CODE_03D2D6
	LDA.w $7BB8,x
	CLC
	ADC.w $7BB8
	STA.b $06
	ASL
	STA.b $08
	LDA.w $7CD8,x
	SEC
	SBC.w $7CD8
	STA.b $0A
	CLC
	ADC.b $06
	CMP.b $08
	BCC.b CODE_03D2D8
CODE_03D2D6:
	CLC
	RTL

CODE_03D2D8:
	LDA.b $0A
	CLC
	ADC.b $06
	STA.b $08
	LDA.b $0A
	SEC
	SBC.b $06
	STA.b $0A
	LDY.b #$00
	CLC
	ADC.b $08
	BMI.b CODE_03D2EF
	LDY.b #$02
CODE_03D2EF:
	STY.b $0C
	LDA.b $04
	CLC
	ADC.b $00
	STA.b $02
	LDA.b $04
	SEC
	SBC.b $00
	STA.b $04
	LDY.b #$00
	CLC
	ADC.b $02
	BMI.b CODE_03D308
	LDY.b #$02
CODE_03D308:
	STY.b $06
	LDA.w $7962,y
	BPL.b CODE_03D313
	EOR.w #$FFFF
	INC
CODE_03D313:
	STA.b $00
	LDY.b $0C
	LDA.w $7968,y
	BPL.b CODE_03D320
	EOR.w #$FFFF
	INC
CODE_03D320:
	CMP.b $00
	BCS.b CODE_03D339
	CMP.w #$0009
	BCS.b CODE_03D339
	LDA.w $7968,y
	PHP
	LDA.w #$0001
	PLP
	BMI.b CODE_03D334
	ASL
CODE_03D334:
	TSB.w $7860
	SEC
	RTL

CODE_03D339:
	LDX.b $06
	LDA.w $70E2
	CLC
	ADC.l DATA_03D28D,x
	STA.w $70E2
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	EOR.l DATA_03D28D,x
	BPL.b CODE_03D359
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror
CODE_03D359:
	LDX.b $12
	CLC
	RTL

;---------------------------------------------------------------------------

CODE_03D35D:
	LDA.w $6122
	CLC
	ADC.w $7BB8,x
	STA.b $00
	CLC
	ADC.w $7C18,x
	STA.b $08
	LDA.w $7C18,x
	SEC
	SBC.b $00
	STA.b $0A
	LDY.b #$04
	CLC
	ADC.b $08
	BMI.b CODE_03D37D
	LDY.b #$06
CODE_03D37D:
	STY.b $0C
	LDA.w $6120
	CLC
	ADC.w $7BB6,x
	STA.b $00
	CLC
	ADC.w $7C16,x
	STA.b $02
	LDA.w $7C16,x
	SEC
	SBC.b $00
	STA.b $04
	LDY.b #$00
	CLC
	ADC.b $02
	BMI.b CODE_03D39F
	LDY.b #$02
CODE_03D39F:
	STY.b $06
	LDA.w $7962,y
	BPL.b CODE_03D3AA
	EOR.w #$FFFF
	INC
CODE_03D3AA:
	STA.b $00
	LDY.b $0C
	LDA.w $7964,y
	BPL.b CODE_03D3B7
	EOR.w #$FFFF
	INC
CODE_03D3B7:
	CMP.b $00
	BCS.b CODE_03D3C0
	CMP.w #$0008
	BCC.b CODE_03D3C2
CODE_03D3C0:
	LDY.b $06
CODE_03D3C2:
	RTL

;---------------------------------------------------------------------------

DATA_03D3C3:
	dw $03C0,$0440,$04C0,$0540

DATA_03D3CB:
	dw $8000,$4000,$2000,$1000,$0800,$0400,$0200,$0100
	dw $0080,$0040,$0020,$0010,$0008,$0004,$0002,$0001

CODE_03D3EB:
	LDA.w $70E2,x
	STA.b $04
	LDA.w $7182,x
CODE_03D3F3:
	STA.b $06
	SEC
	BRA.b CODE_03D415

CODE_03D3F8:
	LDA.w $70E2,x
	STA.b $04
	LDA.w $7182,x
CODE_03D400:
	STA.b $06
	LDY.b #$02
	BRA.b CODE_03D412

CODE_03D406:
	LDA.w $70E2,x
	STA.b $04
	LDA.w $7182,x
CODE_03D40E:
	STA.b $06
	LDY.b #$00
CODE_03D412:
	STY.b $0E
	CLC
CODE_03D415:
	PHP
	REP.b #$10
	PHX
	LDA.b $04
	AND.w #$00F0
	LSR
	LSR
	LSR
	TAX
	LDA.l DATA_03D3CB,x
	STA.b $0C
	PLX
	PHX
	LDA.w !RAM_YI_Level_LevelHeaderItemMemorySettingLo
	ASL
	TAY
	LDA.b $06
	AND.w #$0700
	LSR
	LSR
	LSR
	LSR
	STA.b $00
	LDA.b $05
	AND.w #$000F
	ORA.b $00
	TAX
	LDA.w $6CAA,x
	AND.w #$003F
	ASL
	TYX
	CLC
	ADC.l DATA_03D3C3,x
	STA.b $02
	LDA.b ($02)
	PLX
	SEP.b #$10
	PLP
	BCS.b CODE_03D46A
	AND.b $0C
	BEQ.b CODE_03D469
	LDY.b $0E
	BNE.b CODE_03D469
	JSL.l CODE_despawn_sprite_free_slot
	PLY
	PLA
	LDY.b #$02
CODE_03D469:
	RTL

CODE_03D46A:
	ORA.b $0C
	STA.b ($02)
	RTL

;---------------------------------------------------------------------------

DATA_03D46F:
DATA_special_sprite_inits:                           ; Raidenthequick: DATA_special_sprite_inits (special-sprite Init pointer table, id $1BA+)
	dw CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr
	dw CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr,CODE_init_palette_spr
	dw CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_autoscroller
	dw CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_autoscroller,CODE_init_horizontal_scroll_stop,CODE_init_hscroll_lock,CODE_init_gusty_gen,CODE_init_gusty_stop,CODE_init_lakitu_stop
	dw CODE_init_fuzzy_stop,CODE_init_poochy_stop,CODE_init_bat_gen,CODE_init_fang_stop,CODE_init_bat_gen,CODE_init_fang_stop,CODE_init_wall_lakitu_gen,CODE_init_wall_lakitu_stop
	dw CODE_init_speardance_trigger,CODE_init_speardance_stop,CODE_init_firelakitu_stop,CODE_init_flutter_gen,CODE_init_flutter_stop,CODE_init_spore_gen,CODE_init_spore_stop,CODE_init_balloonpokey_gen
	dw CODE_init_balloonpokey_stop,CODE_init_balloonmissile_gen,CODE_init_balloonmissile_stop,CODE_init_balloon_gen,CODE_init_balloon_stop,CODE_init_yellowplatform_gen,CODE_init_minisalvo_gen,CODE_init_minisalvo_stop
	dw CODE_init_dizzy_stop,CODE_init_goonie_stop

DATA_03D4E3:
DATA_special_sprite_mains:                           ; special-sprite Main pointer table, id $1BA+ (pairs with DATA_special_sprite_inits)
	dw CODE_init_fuzzy_gen,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr
	dw CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr,CODE_main_palette_spr
	dw CODE_main_palette_spr,CODE_main_autoscroller,CODE_main_autoscroller,CODE_main_autoscroller,CODE_main_autoscroller,CODE_main_autoscroller,CODE_main_autoscroller,CODE_main_autoscroller
	dw CODE_main_autoscroller,CODE_main_autoscroller,CODE_main_autoscroller,CODE_main_autoscroller,CODE_03A79B,CODE_03A79B,CODE_main_gusty_gen,CODE_03A79B
	dw CODE_03A79B,CODE_03A79B,CODE_03A79B,CODE_main_bat_gen_r,CODE_03A79B,CODE_main_bat_gen_rl,CODE_03A79B,CODE_main_wall_lakitu_gen
	dw CODE_03A79B,CODE_main_speardance,CODE_03A79B,CODE_03A79B,CODE_main_flutter_gen,CODE_03A79B,CODE_main_spore_gen,CODE_03A79B
	dw CODE_main_balloonpokey_gen,CODE_03A79B,CODE_main_balloonmissile_gen,CODE_03A79B,CODE_main_balloon_gen,CODE_03A79B,CODE_main_yellowplatform_gen,CODE_main_minisalvo_gen
	dw CODE_03A79B,CODE_03A79B,CODE_03A79B,CODE_main_fuzzy_gen

CODE_03D55B:
CODE_init_palette_spr:                               ; Raidenthequick: CODE_init_palette_spr (special-sprite palette swap Init)
	LDA.w $7960
	LSR
	BCS.b CODE_03D57E
	LDA.w $0C04,y
	SEC
	SBC.w #$0001
	CMP.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	BNE.b CODE_03D570
	JMP.w CODE_remove_special_spr

CODE_03D570:
	STA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	JSL.l CODE_03D5E4
	STZ.w $0C14
	STZ.w $0C16
	RTS

CODE_03D57E:
	LDA.w $0C04,y
	SEC
	SBC.w #$0001
	CMP.w !RAM_YI_Level_LevelHeaderBG1PaletteLo
	BEQ.b CODE_03D5E1
	STA.w !RAM_YI_Level_LevelHeaderBG1PaletteLo
	ASL
	TAX
	LDA.l DATA_bg1_palette_ptrs,x
	TAX
	PHY
	PHB
	PEA.w $702038>>8
	PLB
	PLB
	LDY.w #$001C
CODE_03D59E:
	LDA.l DATA_5FA01C,x
	STA.w $702082,y
	STA.w $702DEE,y
	LDA.l DATA_5FA03A,x
	STA.w $7020A2,y
	STA.w $702E0E,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_03D59E
	LDY.w #$0006
CODE_03D5BB:
	LDA.l DATA_5FA060,x
	STA.w $702038,y
	STA.w $702DA4,y
	LDA.l DATA_5FA068,x
	STA.w $702058,y
	STA.w $702DC4,y
	LDA.l DATA_5FA070,x
	STA.w $702078,y
	STA.w $702DE4,y
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_03D5BB
	PLB
	PLY
CODE_03D5E1:
	JMP.w CODE_remove_special_spr

CODE_03D5E4:
	PHX
	PHY
	PHP
	REP.b #$20
	SEP.b #$10
	LDX.b #$5C
CODE_03D5ED:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	BEQ.b CODE_03D5FF
	JSL.l CODE_03AF0D
	LDA.w $7402,x
	AND.w #$00FF
	STA.w $7402,x
CODE_03D5FF:
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_03D5ED
	LDA.w #$FFFF
	STA.w $7ECC
	PLP
	PLY
	PLX
	RTL

DATA_03D60F:
	dw $0000,$0800,$7000

CODE_03D615:
CODE_main_palette_spr:                               ; Raidenthequick: CODE_main_palette_spr (special-sprite palette swap Main)
	PHY
	LDA.w #$0800
	STA.b $00
	LDA.w $0C16
	BNE.b CODE_03D66A
	LDA.w $0C14
	CMP.w #$0003
	BNE.b CODE_03D640
	PLY
	STZ.w $7ECC
CODE_03D62C:
CODE_remove_special_spr:                             ; Raidenthequick: CODE_remove_special_spr (clear special-sprite slot + stage record)
	SEP.b #$30
	LDX.w $0C0C,y
	LDA.b #$00
	STA.l $7028CA,x
	REP.b #$30
CODE_03D639:
	LDA.w #$0000
	STA.w $0C04,y
	RTS

CODE_03D640:
	ASL
	TAX
	LDA.w DATA_03D60F,x
	STA.w $0C18
	LDA.w #$6800
	STA.w $0C1A
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	ASL
	ADC.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	ADC.w $0C14
	TAX
	LDA.l DATA_bg1_tileset_files,x
	AND.w #$00FF
	JSL.l CODE_00B753
	STA.w $0C16
	INC.w $0C14
CODE_03D66A:
	SEC
	SBC.w #$0800
	BCS.b CODE_03D678
CODE_03D670:
	ADC.w #$0800
	STA.b $00
	LDA.w #$0000
CODE_03D678:
	STA.w $0C16
	LDX.w $0C1A
	TXA
	CLC
	ADC.b $00
	STA.w $0C1A
	LDA.w #$0070
	STA.w $0001
	LDY.w $0C18
	LDA.b $00
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDA.b $00
	LSR
	CLC
	ADC.w $0C18
	STA.w $0C18
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_03D6A0:
CODE_main_autoscrolls:                               ; Raidenthequick: CODE_main_autoscrolls (per-frame autoscroll dispatcher)
	PHB
	PHK
	PLB
	LDA.w $0C1C
	ASL
	TAX
	JSR.w (DATA_special_sprite_mains,x)
	PLB
	RTL

DATA_03D6AD:
DATA_autoscroller_indices:                           ; Raidenthequick: DATA_autoscroller_indices (per-track start offsets into values table)
	dw $0000,$000D,$0028,$008C,$00AF,$003E,$0090,$00BC
	dw $00F0,$00F7,$012E,$0138

DATA_03D6C5:
DATA_autoscroller_values:                            ; Raidenthequick: DATA_autoscroller_values (packed autoscroll command stream)
	dw $0020,$3004,$0400,$0040,$8004,$0400,$6EFF,$0660
	dw $6A63,$5B08,$086C,$6C3C,$1E06,$056C,$6916,$1005
	dw $0565,$600C,$0905,$0557,$4D0A,$1005,$0545,$361A
	dw $2105,$052D,$2B30,$4008,$062E,$2F50,$FF05,$300B
	dw $1308,$0836,$371B,$2308,$0839,$3B2A,$4108,$083D
	dw $3E4B,$6008,$084A,$5264,$6608,$085D,$616E,$7108
	dw $0867,$6D6E,$6408,$0870,$7054,$4B06,$0470,$6846
	dw $4104,$045E,$5341,$4304,$044D,$4B48,$5106,$084C
	dw $5161,$7008,$0855,$5882,$8B06,$0459,$59A0,$FF08
	dw $5C11,$1810,$185C,$5D1F,$2320,$1D5F,$6230,$5014
	dw $1269,$6A71,$8F12,$1264,$5FAA,$E012,$155F,$10FF
	dw $0570,$7040,$7007,$0970,$70A0,$FF0B,$501A,$2005
	dw $054E,$502C,$3905,$054E,$4A42,$4D05,$0549,$4858
	dw $6305,$054B,$4E6E,$7E05,$054A,$478A,$9505,$0544
	dw $43A2,$AE05,$0541,$3FB9,$C005,$053E,$3EE0,$FF05
	dw $2002,$0202,$0319,$CBFE,$065A,$5DC0,$B008,$085F
	dw $5DAA,$A608,$085F,$6C98,$8808,$086E,$6780,$7906
	dw $0860,$606B,$4B08,$085A,$5D40,$3008,$085F,$5D2A
	dw $2608,$085F,$6C18,$0808,$086E,$6700,$FE08,$6F20
	dw $8008,$086F,$6FD8,$FF08,$700C,$1408,$086E,$701E
	dw $2A08,$086A,$6A2E,$3B08,$0870,$7053,$710A,$0A70
	dw $708F,$9808,$0467,$5B8F,$9006,$032E,$2C94,$9D08
	dw $082C,$2CA6,$AD08,$0A2F,$36B6,$CA08,$0836,$3AD4
	dw $E204,$0843,$3FF0,$FF08

CODE_03D83D:
CODE_init_autoscroller:                              ; Raidenthequick: CODE_init_autoscroller (autoscroll-region Init)
	LDA.w $0C1C
	BEQ.b CODE_03D845
	JMP.w CODE_03D639

CODE_03D845:
	LDA.w $0C04,y
	STA.w $0C1C
	STA.w $0C1E
	CMP.w #$001B
	BEQ.b CODE_03D85B
	CMP.w #$0011
	BEQ.b CODE_03D85B
	STA.w $0C20
CODE_03D85B:
	SEC
	SBC.w #$0011
	ASL
	TAX
	LDA.w DATA_autoscroller_indices,x
	STA.w $0C2E
	JSR.w CODE_03D639
	LDA.w $6093
	AND.w #$FF00
	STA.w $0C22
	LDA.w $6095
	AND.w #$00FF
	STA.w $0C24
	LDA.w $609B
	AND.w #$FF00
	STA.w $0C26
	LDA.w $609D
	AND.w #$00FF
	STA.w $0C28
	STZ.w $0C2A
	STZ.w $0C2C
	LDX.w $0C2E
CODE_03D897:
	LDA.w DATA_autoscroller_values,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.w $0C30
	SEC
	SBC.w $0C23
	STA.w $0C36
	LDA.w DATA_autoscroller_values+$01,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.w #$001C
	STA.w $0C32
	SEC
	SBC.w $0C27
	STA.w $0C38
	LDA.w DATA_autoscroller_values+$01,x
	AND.w #$FF00
	BPL.b CODE_03D8CE
	ORA.w #$00FF
CODE_03D8CE:
	XBA
	ASL
	ASL
	ASL
	ASL
	STA.w $0C34
	RTS

;---------------------------------------------------------------------------

CODE_03D8D7:
CODE_main_autoscroller:                              ; Raidenthequick: CODE_main_autoscroller (autoscroll-region Main per-frame)
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03D93D
	JSR.w CODE_03D942
	LDA.w $0C23
	SEC
	SBC.w $0C30
	BEQ.b CODE_03D8F9
	EOR.w $0C36
	BMI.b CODE_03D8F9
	LDA.w $0C30
	STA.w $0C23
CODE_03D8F9:
	STA.w $0000
	LDA.w $0C27
	SEC
	SBC.w $0C32
	BEQ.b CODE_03D910
	EOR.w $0C38
	BMI.b CODE_03D910
	LDA.w $0C32
	STA.w $0C27
CODE_03D910:
	ORA.w $0000
	BMI.b CODE_03D93D
	LDX.w $0C2E
	LDA.w DATA_autoscroller_values+$03,x
	AND.w #$00FF
	CMP.w #$00FE
	BCS.b CODE_03D92C
	INX
	INX
	INX
	STX.w $0C2E
	JMP.w CODE_03D897

CODE_03D92C:
	BNE.b CODE_03D934
	STZ.w $0C1E
	STZ.w $0C20
CODE_03D934:
	STZ.w $0C1C
	STZ.w $0C2A
	STZ.w $0C2C
CODE_03D93D:
	RTS

;---------------------------------------------------------------------------

DATA_03D93E:
	dw $FFFF,$0001

CODE_03D942:
	LDA.w $0C30
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $0C32
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0C23
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $0C27
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $0C34
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEP.b #$10
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #$00
	LDA.w $0C2A
	CMP.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BEQ.b CODE_03D980
	BPL.b CODE_03D979
	LDX.b #$02
CODE_03D979:
	CLC
	ADC.w DATA_03D93E,x
	STA.w $0C2A
CODE_03D980:
	LDX.b #$00
	LDA.w $0C2C
	CMP.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	BEQ.b CODE_03D995
	BPL.b CODE_03D98E
	LDX.b #$02
CODE_03D98E:
	CLC
	ADC.w DATA_03D93E,x
	STA.w $0C2C
CODE_03D995:
	REP.b #$10
CODE_03D997:
	LDX.w #$0000
	LDA.w $0C2A
	BPL.b CODE_03D9A0
	DEX
CODE_03D9A0:
	CLC
	ADC.w $0C22
	STA.w $0C22
	TXA
	ADC.w $0C24
	STA.w $0C24
	LDX.w #$0000
	LDA.w $0C2C
	BPL.b CODE_03D9B7
	DEX
CODE_03D9B7:
	CLC
	ADC.w $0C26
	STA.w $0C26
	TXA
	ADC.w $0C28
	STA.w $0C28
	RTS

;---------------------------------------------------------------------------

CODE_03D9C6:
	JSR.w CODE_03D997
	RTL

;---------------------------------------------------------------------------

CODE_03D9CA:
CODE_init_gusty_gen:                                 ; Raidenthequick: CODE_init_gusty_gen (Gusty-spawner Init: arm the gen flag)
	LDA.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
	BEQ.b CODE_03D9D2
	JMP.w CODE_remove_special_spr

CODE_03D9D2:
	INC.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
	RTS

;---------------------------------------------------------------------------

DATA_03D9D6:
	dw $0110,$FFE0

DATA_03D9DA:
	dw $FE00,$0200,$FD00,$0300

DATA_03D9E2:
	dw $0004,$0006

CODE_03D9E6:
CODE_main_gusty_gen:                                 ; Raidenthequick: CODE_main_gusty_gen (Gusty-spawner Main: spawn pattern + timer)
	LDA.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
	BNE.b CODE_03D9EE
	JMP.w CODE_remove_special_spr

CODE_03D9EE:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03DA57
	LDA.w $0CD2
	BNE.b CODE_03DA57
	LDA.w #$0030
	STA.w $0CD2
	SEP.b #$10
	PHY
	LDA.w #$00E6
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03DA54
	LDA.b $10
	AND.w #$001E
	ASL
	ASL
	ASL
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	SEC
	SBC.w #$001B
	STA.w $7182,y
	LDA.b $10
	AND.w #$0001
	ASL
	STA.w $7400,y
	STA.b $00
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03D9D6,x
	STA.w $70E2,y
	LDA.b $10
	AND.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	TAX
	LDA.w DATA_03D9E2,x
	STA.w $7540,y
	TXA
	ASL
	CLC
	ADC.b $00
	TAX
	LDA.w DATA_03D9DA,x
	STA.w $75E0,y
CODE_03DA54:
	PLY
	REP.b #$10
CODE_03DA57:
	RTS

;---------------------------------------------------------------------------

CODE_03DA58:
CODE_init_gusty_stop:                                ; Raidenthequick: CODE_init_gusty_stop (clear gusty-gen flag, free slot)
	STZ.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DA5E:
CODE_init_lakitu_stop:                               ; Raidenthequick: CODE_init_lakitu_stop (clear lakitu-active flag, free slot)
	STZ.w !RAM_YI_Level_NorSpr_LakituActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DA64:
CODE_init_fuzzy_stop:                                ; Raidenthequick: CODE_init_fuzzy_stop (clear fuzzy-gen flag, free slot)
	STZ.w !RAM_YI_Level_NorSpr_FuzzyGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DA6A:
CODE_init_poochy_stop:                               ; Raidenthequick: CODE_init_poochy_stop (clear poochy-exists flag, free slot)
	STZ.w !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DA70:
CODE_init_bat_gen:                                   ; Raidenthequick: CODE_init_bat_gen (Bat-spawner Init: arm the gen flag)
	LDA.w !RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo
	BEQ.b CODE_03DA78
	JMP.w CODE_remove_special_spr

CODE_03DA78:
	INC.w !RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo
	RTS

;---------------------------------------------------------------------------

DATA_03DA7C:
	dw $0110,$FFE0

CODE_03DA80:
CODE_main_bat_gen_r:                                 ; Raidenthequick: CODE_main_bat_gen_r (Bat-spawner Main, right-side variant)
	LDA.w !RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo
	BNE.b CODE_03DA88
	JMP.w CODE_remove_special_spr

CODE_03DA88:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03DAEA
	LDA.w $0CD4
	BNE.b CODE_03DAEA
	LDA.w !RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo
	CMP.w #$0003
	BCS.b CODE_03DAEA
	LDA.w #$0030
	STA.w $0CD4
	SEP.b #$10
	PHY
	LDA.w #$013E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03DAE7
	INC.w !RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo
	LDA.b $10
	AND.w #$000E
	ASL
	ASL
	ASL
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0030
	STA.w $7182,y
	LDA.w $0073
	STA.w $7400,y
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03DA7C,x
	STA.w $70E2,y
	PHB
	LDX.b #DATA_07B1A6>>16
	PHX
	PLB
	TYX
	JSL.l CODE_init_fang_flying
	PLB
	INC.w $7A36,x
CODE_03DAE7:
	PLY
	REP.b #$10
CODE_03DAEA:
	RTS

;---------------------------------------------------------------------------

CODE_03DAEB:
CODE_main_bat_gen_rl:                                ; Raidenthequick: CODE_main_bat_gen_rl (Bat-spawner Main, right+left variant for Big Boo's Fort)
	LDA.w !RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo
	BNE.b CODE_03DAF3
	JMP.w CODE_remove_special_spr

CODE_03DAF3:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03DAEA
	LDA.w $0CD4
	BNE.b CODE_03DAEA
	LDA.w #$0003
	STA.b $00
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w #!Define_YI_LevelID_BiggerBoosFort
	BNE.b CODE_03DB30
	SEP.b #$10
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	REP.b #$10
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0003
	BCC.b CODE_03DB30
	DEC.b $00
	CMP.w #$0005
	BCC.b CODE_03DB30
	DEC.b $00
CODE_03DB30:
	LDA.w !RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo
	CMP.b $00
	BCS.b CODE_03DB84
	LDA.w #$0030
	STA.w $0CD4
	SEP.b #$10
	PHY
	LDA.w #$013E
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03DB81
	INC.w !RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo
	LDA.b $10
	AND.w #$000E
	ASL
	ASL
	ASL
	CLC
	ADC.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0030
	STA.w $7182,y
	LDA.b $10
	AND.w #$0001
	ASL
	STA.w $7400,y
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03DA7C,x
	STA.w $70E2,y
	PHB
	LDX.b #DATA_07B1A6>>16
	PHX
	PLB
	TYX
	JSL.l CODE_init_fang_flying
	PLB
	INC.w $7A36,x
CODE_03DB81:
	PLY
	REP.b #$10
CODE_03DB84:
	RTS

;---------------------------------------------------------------------------

CODE_03DB85:
CODE_init_fang_stop:                                 ; Raidenthequick: CODE_init_fang_stop (clear bat/fang gen flag, free slot)
	STZ.w !RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DB8B:
CODE_init_wall_lakitu_gen:                              ; Wall Lakitu ($157) generator Init: arm gen-latch $0C4C (one active at a time). Formerly unknown2_gen.
	LDA.w $0C4C
	BEQ.b CODE_03DB93
	JMP.w CODE_remove_special_spr

CODE_03DB93:
	INC.w $0C4C
	RTS

;---------------------------------------------------------------------------

DATA_03DB97:
	dw $0020,$0030,$0050,$0060,$0090,$0090,$00C0,$00D0

DATA_03DBA7:
	dw $0030,$0060,$0020,$0050,$0040,$0070,$0060,$0030

CODE_03DBB7:
CODE_main_wall_lakitu_gen:                              ; Wall Lakitu generator Main: spawns one Wall Lakitu ($157) off-screen via CODE_spawn_sprite_active when terrain-gated (FXCODE_0ACE2F); capped by $0C4E. Formerly main_unknown2_gen.
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03DC2D
	LDA.w $0CD6
	BNE.b CODE_03DC2D
	LDA.w $0C4E
	CMP.w #$0001
	BCS.b CODE_03DC2D
	PHY
	SEP.b #$10
	LDA.b $10
	AND.w #$0007
	ASL
	TAY
	LDA.w !RAM_YI_Global_Layer1XPosLo
	AND.w #$FF00
	CLC
	ADC.w DATA_03DB97,y
	CMP.w !RAM_YI_Global_Layer1XPosLo
	BPL.b CODE_03DBEC
	CLC
	ADC.w #$0100
CODE_03DBEC:
	STA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w !RAM_YI_Global_Layer1YPosLo
	AND.w #$FF00
	CLC
	ADC.w DATA_03DBA7,y
	CMP.w !RAM_YI_Global_Layer1YPosLo
	BPL.b CODE_03DC04
	CLC
	ADC.w #$0100
CODE_03DC04:
	STA.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0010
	BNE.b CODE_03DC2A
	LDA.w #$0157
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03DC2A
	INC.w $0C4E
	JSL.l CODE_07C30B
CODE_03DC2A:
	REP.b #$10
	PLY
CODE_03DC2D:
	RTS

;---------------------------------------------------------------------------

CODE_03DC2E:
CODE_init_wall_lakitu_stop:                             ; Wall Lakitu generator stop: clear gen-latch $0C4C, free slot. Formerly unknown2_stop.
	STZ.w $0C4C
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

DATA_03DC34:
	dw $0901,$1911

CODE_03DC38:
CODE_init_speardance_trigger:                        ; Raidenthequick: CODE_init_speardance_trigger (Spear Guy dance trigger Init)
	LDA.b $00
	AND.w #$0001
	STA.b $00
	LDA.b $02
	AND.w #$0001
	ASL
	ORA.b $00
	TAX
	LDA.w DATA_03DC34,x
	AND.w #$00FF
	STA.b $00
	CMP.w $0C50
	BNE.b CODE_03DC58
CODE_03DC55:
	JMP.w CODE_remove_special_spr

CODE_03DC58:
	STA.w $0C50
	LDA.w $0C52
	BNE.b CODE_03DC55
	STZ.w $0C54
	STZ.w $0C5C
	INC.w $0C52
	RTS

;---------------------------------------------------------------------------

DATA_03DC6A:
	db $04,$06,$0E,$08,$0A,$08,$0C,$06,$0C,$0E,$10,$00,$0E,$0C,$10,$02
	db $0A,$04,$0C,$06,$0A,$04,$0E,$08,$0E,$08,$10,$00,$0E,$08,$04,$00

DATA_03DC8A:
	db $0A,$08,$0C,$06,$04,$06,$0E,$08,$0E,$0C,$10,$02,$0C,$0E,$10,$00
	db $0A,$04,$0E,$08,$0A,$04,$0C,$06,$0E,$08,$04,$00,$0E,$08,$10,$00

DATA_03DCAA:
	db $00,$F0,$F0,$00,$00,$10,$10,$00,$00,$00,$00,$E0,$E0,$E0,$E0,$00
	db $00,$00,$00,$F0,$F0,$F0,$F0,$00,$00,$10,$10,$F0,$F0,$00,$00,$E0

DATA_03DCCA:
	db $00,$10,$10,$00,$00,$F0,$F0,$00,$00,$00,$00,$20,$20,$20,$20,$00
	db $00,$00,$00,$10,$10,$10,$10,$00,$00,$10,$10,$F0,$F0,$00,$00,$E0

DATA_03DCEA:
DATA_speardance_sounds:                              ; Raidenthequick: DATA_speardance_sounds (chant1/chant2 SoundIDs)
	db !Define_YI_SoundID68_SpearGuyChant1,!Define_YI_SoundID69_SpearGuyChant2

CODE_03DCEC:
CODE_main_speardance:                                ; Raidenthequick: CODE_main_speardance (Spear Guy dance Main loop)
	LDA.w $0C54
	DEC
	BNE.b CODE_03DD00
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_03DD04
	STA.w $0C56
CODE_03DD00:
	STZ.w $0C66
	RTS

CODE_03DD04:
	LDA.w $0C56
	BEQ.b CODE_03DD0D
	STZ.w $0C56
	RTS

CODE_03DD0D:
	LDA.w $0C5C
	INC
	AND.w #$0007
	STA.w $0C5C
	LDA.w $0C50
	CLC
	ADC.w $0C5C
	TAX
	LDA.w DATA_03DC6A-$01,x
	AND.w #$00FF
	STA.w $0C58
	LDA.w DATA_03DC8A-$01,x
	AND.w #$00FF
	STA.w $0C5A
	PHY
	LDY.w $0C66
	BEQ.b CODE_03DD4E
	LDY.w #$0000
	CMP.w #$000A
	BEQ.b CODE_03DD45
	CMP.w #$0003
	BMI.b CODE_03DD45
	INY
CODE_03DD45:
	LDA.w DATA_speardance_sounds,y
	TAY
	TYA
	JSL.l CODE_push_sound_queue
CODE_03DD4E:
	PLY
	LDA.w DATA_03DCAA-$01,x
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_03DD5D
	ORA.w #$FF00
CODE_03DD5D:
	STA.w $0C5E
	LDA.w DATA_03DCCA-$01,x
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_03DD6E
	ORA.w #$FF00
CODE_03DD6E:
	STA.w $0C60
	TXA
	DEC
	AND.w #$0007
	TAX
	LDA.w DATA_03DCAA-$01,x
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_03DD85
	ORA.w #$FF00
CODE_03DD85:
	STA.w $0C62
	LDA.w DATA_03DCCA-$01,x
	AND.w #$00FF
	CMP.w #$0080
	BMI.b CODE_03DD96
	ORA.w #$FF00
CODE_03DD96:
	STA.w $0C64
	LDX.w #$0002
	STX.w $0CD8
	STZ.w $0C66
	RTS

;---------------------------------------------------------------------------

CODE_03DDA3:
CODE_init_speardance_stop:                           ; Raidenthequick: CODE_init_speardance_stop (clear dance state, free slot)
	STZ.w $0C50
	STZ.w $0C52
	STZ.w $0CD8
	STZ.w $0C58
	STZ.w $0C5A
	STZ.w $0C66
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DDB8:
CODE_init_firelakitu_stop:                           ; Raidenthequick: CODE_init_firelakitu_stop (clear fire-lakitu flag, free slot)
	STZ.w !RAM_YI_Level_NorSpr_FireLakituActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DDBE:
CODE_init_flutter_gen:                               ; Raidenthequick: CODE_init_flutter_gen (Flutter-spawner Init)
	LDA.w $0C6A
	BEQ.b CODE_03DDC6
	JMP.w CODE_remove_special_spr

CODE_03DDC6:
	INC.w $0C6A
	RTS

;---------------------------------------------------------------------------

DATA_03DDCA:
	dw $0120,$0130,$FFD0,$FFC0

DATA_03DDD2:
	dw $0020,$0060,$00A0,$00E0

CODE_03DDDA:
CODE_main_flutter_gen:                               ; Raidenthequick: CODE_main_flutter_gen (Flutter-spawner Main)
	LDA.w $0C6A
	BNE.b CODE_03DDE2
	JMP.w CODE_remove_special_spr

CODE_03DDE2:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03DE59
	LDA.w $0CDA
	BNE.b CODE_03DE59
	LDA.w $0C6C
	CMP.w #$0004
	BCS.b CODE_03DE59
	LDA.w #$0030
	STA.w $0CDA
	SEP.b #$10
	PHY
	LDA.w #$0152
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03DE56
	INC.w $0C6C
	LDA.w $0073
	STA.w $7400,y
	ASL
	STA.b $00
	LDA.b $10
	AND.w #$0001
	ASL
	ORA.b $00
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03DDCA,x
	STA.w $70E2,y
	LDA.b $10
	AND.w #$0003
	ASL
	TAX
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w DATA_03DDD2,x
	STA.w $7182,y
	PHB
	LDX.b #DATA_07BB14>>16
	PHX
	PLB
	TYX
	JSL.l YI_NorSpr152_Flutter_Init
	PLB
	LDA.w $7040,x
	AND.w #$FFF3
	STA.w $7040,x
	LDA.w #$0001
	STA.w $7A36,x
CODE_03DE56:
	PLY
	REP.b #$10
CODE_03DE59:
	RTS

;---------------------------------------------------------------------------

CODE_03DE5A:
CODE_init_flutter_stop:                              ; Raidenthequick: CODE_init_flutter_stop (clear flutter-gen flag, free slot)
	STZ.w $0C6A
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DE60:
CODE_init_spore_gen:                                 ; Raidenthequick: CODE_init_spore_gen (Nipper-spore-spawner Init)
	LDA.w !RAM_YI_Level_NorSpr_NipperSporeGeneratorActiveFlagLo
	BEQ.b CODE_03DE68
	JMP.w CODE_remove_special_spr

CODE_03DE68:
	INC.w !RAM_YI_Level_NorSpr_NipperSporeGeneratorActiveFlagLo
	RTS

;---------------------------------------------------------------------------

DATA_03DE6C:
	dw $0000,$0010,$0020,$0030,$0040,$0050,$0060,$0070
	dw $0080,$0090,$00A0,$00B0,$00C0,$00D0,$00E0,$00F0

DATA_03DE8C:
	dw $FFF0,$FFE0,$FFD0,$FFC0

CODE_03DE94:
CODE_main_spore_gen:                                 ; Raidenthequick: CODE_main_spore_gen (Nipper-spore-spawner Main)
	LDA.w !RAM_YI_Level_NorSpr_NipperSporeGeneratorActiveFlagLo
	BNE.b CODE_03DE9C
	JMP.w CODE_remove_special_spr

CODE_03DE9C:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03DF0B
	LDA.w $0CDC
	BNE.b CODE_03DF0B
	SEP.b #$10
	PHY
	LDA.w #$0165
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0166
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0004
	BCS.b CODE_03DF08
	LDA.w #$0020
	STA.w $0CDC
	LDA.w #$0165
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03DF08
	LDA.b $10
	AND.w #$000F
	ASL
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03DE6C,x
	STA.w $70E2,y
	LDA.b $10
	AND.w #$0003
	ASL
	TAX
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w DATA_03DE8C,x
	STA.w $7182,y
	PHB
	LDX.b #DATA_0F8B2E>>16
	PHX
	PLB
	TYX
	JSL.l YI_NorSpr165_NipperSpore_Init
	PLB
CODE_03DF08:
	PLY
	REP.b #$10
CODE_03DF0B:
	RTS

;---------------------------------------------------------------------------

CODE_03DF0C:
CODE_init_spore_stop:                                ; Raidenthequick: CODE_init_spore_stop (clear spore-gen flag, free slot)
	STZ.w !RAM_YI_Level_NorSpr_NipperSporeGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DF12:
CODE_init_balloonpokey_gen:                          ; Raidenthequick: CODE_init_balloonpokey_gen (Pokey-balloon spawner Init)
	LDA.w !RAM_YI_Level_NorSpr_PokeyBalloonGeneratorActiveFlagLo
	BEQ.b CODE_03DF1A
	JMP.w CODE_remove_special_spr

CODE_03DF1A:
	INC.w !RAM_YI_Level_NorSpr_PokeyBalloonGeneratorActiveFlagLo
	RTS

;---------------------------------------------------------------------------

DATA_03DF1E:
	dw $0110,$0120,$FFE0,$FFD0

DATA_03DF26:
	dw $0010,$0020,$0030,$0040

CODE_03DF2E:
CODE_main_balloonpokey_gen:                          ; Raidenthequick: CODE_main_balloonpokey_gen (Pokey-balloon spawner Main)
	JSL.l CODE_random_number_gen
	LDA.w !RAM_YI_Level_NorSpr_PokeyBalloonGeneratorActiveFlagLo
	BNE.b CODE_03DF3A
	JMP.w CODE_remove_special_spr

CODE_03DF3A:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03DF4A
	LDA.w $0CDE
	BEQ.b CODE_03DF4B
CODE_03DF4A:
	RTS

CODE_03DF4B:
	SEP.b #$10
	PHY
	LDA.w #$0174
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0175
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHA
	LDA.w #$017F
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0180
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLA
	CLC
	ADC.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0004
	BCS.b CODE_03DFEC
	LDA.b $10
	AND.w #$0004
	LSR
	STA.b $00
	LDA.w $0073
	STA.w $7400,x
	ASL
	ORA.b $00
	TAY
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03DF1E,y
	STA.b $00
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w DATA_03DF26,y
	STA.b $02
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	BIT.w #$0002
	BNE.b CODE_03DFEC
	LDA.w #$00C0
	STA.w $0CDE
	LDA.w #$0174
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03DFEC
	TYX
	LDA.b $00
	STA.w $70E2,x
	LDA.b $02
	STA.w $7182,x
	PHB
	LDY.b #DATA_07F10C>>16
	PHY
	PLB
	JSL.l YI_NorSpr174_BaronVonZeppelinCarryingNeedlenose_Init
	PLB
CODE_03DFEC:
	PLY
	REP.b #$10
	RTS

;---------------------------------------------------------------------------

CODE_03DFF0:
CODE_init_balloonpokey_stop:                         ; Raidenthequick: CODE_init_balloonpokey_stop
	STZ.w !RAM_YI_Level_NorSpr_PokeyBalloonGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03DFF6:
CODE_init_balloonmissile_gen:                        ; Raidenthequick: CODE_init_balloonmissile_gen (Bomb-balloon spawner Init)
	LDA.w !RAM_YI_Level_NorSpr_MissileBalloonGeneratorActiveFlagLo
	BEQ.b CODE_03DFFE
	JMP.w CODE_remove_special_spr

CODE_03DFFE:
	INC.w !RAM_YI_Level_NorSpr_MissileBalloonGeneratorActiveFlagLo
	RTS

;---------------------------------------------------------------------------

CODE_03E002:
CODE_main_balloonmissile_gen:                        ; Raidenthequick: CODE_main_balloonmissile_gen (Bomb-balloon spawner Main)
	JSL.l CODE_random_number_gen
	LDA.w !RAM_YI_Level_NorSpr_MissileBalloonGeneratorActiveFlagLo
	BNE.b CODE_03E00E
	JMP.w CODE_remove_special_spr

CODE_03E00E:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03E01E
	LDA.w $0CE0
	BEQ.b CODE_03E01F
CODE_03E01E:
	RTS

CODE_03E01F:
	SEP.b #$10
	PHY
	LDA.w #$0175
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0176
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHA
	LDA.w #$017F
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0180
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLA
	CLC
	ADC.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0004
	BCS.b CODE_03E0A9
	LDA.b $10
	AND.w #$0004
	LSR
	STA.b $00
	LDA.w $0073
	STA.w $7400,x
	ASL
	ORA.b $00
	TAY
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03DF1E,y
	STA.b $00
	LDA.b $10
	AND.w #$0003
	ASL
	TAY
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w DATA_03DF26,y
	STA.b $02
	LDA.w #$00C0
	STA.w $0CE0
	LDA.w #$0175
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03E0A9
	TYX
	LDA.b $00
	STA.w $70E2,x
	LDA.b $02
	STA.w $7182,x
	PHB
	LDY.b #DATA_07F10C>>16
	PHY
	PLB
	JSL.l YI_NorSpr175_BaronVonZeppelinCarryingBomb_Init
	PLB
CODE_03E0A9:
	PLY
	REP.b #$10
	RTS

;---------------------------------------------------------------------------

CODE_03E0AD:
CODE_init_balloonmissile_stop:                       ; Raidenthequick: CODE_init_balloonmissile_stop
	STZ.w !RAM_YI_Level_NorSpr_MissileBalloonGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03E0B3:
CODE_init_balloon_gen:                               ; Raidenthequick: CODE_init_balloon_gen (plain-balloon spawner Init)
	LDA.w !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
	BEQ.b CODE_03E0BB
	JMP.w CODE_remove_special_spr

CODE_03E0BB:
	INC.w !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
	RTS

;---------------------------------------------------------------------------

CODE_03E0BF:
CODE_main_balloon_gen:                               ; Raidenthequick: CODE_main_balloon_gen (plain-balloon spawner Main)
	LDA.w !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
	BNE.b CODE_03E0C7
	JMP.w CODE_remove_special_spr

CODE_03E0C7:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03E123
	LDA.w $0CE2
	BNE.b CODE_03E123
	LDA.w #$0060
	STA.w $0CE2
	LDA.w $0FED
	CMP.w #$000C
	BPL.b CODE_03E123
	SEP.b #$10
	PHY
	LDA.w #$0052
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_03E120
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0110
	STA.w $7182,y
	LDA.w $60A8
	BNE.b CODE_03E108
	LDA.w $60C4
	DEC
	EOR.w #$FFFF
	INC
CODE_03E108:
	BPL.b CODE_03E10F
	LDA.w #$FFA0
	BRA.b CODE_03E112

CODE_03E10F:
	LDA.w #$0060
CODE_03E112:
	STA.b $00
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.b $00
	AND.w #$FFE0
	STA.w $70E2,y
CODE_03E120:
	PLY
	REP.b #$10
CODE_03E123:
	RTS

;---------------------------------------------------------------------------

CODE_03E124:
CODE_init_balloon_stop:                              ; Raidenthequick: CODE_init_balloon_stop
	STZ.w !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

DATA_03E12A:
	dw $0620,$06A0,$0630,$05B0

DATA_03E132:
	dw $0140,$01B0,$0230,$01B0

DATA_03E13A:
	dw $0188,$0188,$0187,$0188

CODE_03E142:
CODE_init_yellowplatform_gen:                        ; Raidenthequick: CODE_init_yellowplatform_gen (autoscroll yellow platform spawner Init)
	LDA.w !RAM_YI_Level_NorSpr_PlatformGeneratorActiveFlagLo
	BEQ.b CODE_03E14A
	JMP.w CODE_remove_special_spr

CODE_03E14A:
	INC.w !RAM_YI_Level_NorSpr_PlatformGeneratorActiveFlagLo
	PHY
	SEP.b #$10
	LDY.b #$00
CODE_03E152:
	STY.b $00
	LDA.w DATA_03E12A,y
	STA.b $02
	LDA.w DATA_03E132,y
	STA.b $04
	LDA.w DATA_03E13A,y
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_03E18C
	LDA.b $02
	STA.w $70E2,y
	LDA.b $04
	STA.w $7182,y
	LDA.w $7040,y
	AND.w #$FFF3
	STA.w $7040,y
	INC.w $0FF7
	INC.w $0FF7
	TYA
	LDY.b $00
	STA.w $0FEF,y
	INY
	INY
	CPY.b #$08
	BMI.b CODE_03E152
CODE_03E18C:
	REP.b #$10
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_03E190:
CODE_main_yellowplatform_gen:                        ; Raidenthequick: CODE_main_yellowplatform_gen (yellow-platform spawner Main / despawn sweep)
	PHY
	SEP.b #$10
	LDY.w $0FF7
CODE_03E196:
	STY.b $00
	LDA.w $0FED,y
	TAY
	LDA.w $7680,y
	CLC
	ADC.w #$0100
	CMP.w #$0300
	BCS.b CODE_03E1B4
	LDA.w $7682,y
	CLC
	ADC.w #$0100
	CMP.w #$0300
	BCC.b CODE_03E1DE
CODE_03E1B4:
	LDY.b $00
	DEY
	DEY
	BNE.b CODE_03E196
	LDY.w $0FF7
CODE_03E1BD:
	STY.b $00
	LDX.w $0FED,y
	JSL.l CODE_03A31E
	LDY.b $00
	LDA.w #$0000
	STA.w $0FED,y
	DEY
	DEY
	BNE.b CODE_03E1BD
	STZ.w !RAM_YI_Level_NorSpr_PlatformGeneratorActiveFlagLo
	STZ.w $0FF7
	REP.b #$10
	PLY
	JMP.w CODE_remove_special_spr

CODE_03E1DE:
	REP.b #$10
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_03E1E2:
CODE_init_minisalvo_gen:                             ; Raidenthequick: CODE_init_minisalvo_gen (Mini Salvo spawner Init)
	LDA.w !RAM_YI_Level_NorSpr_SlimeGeneratorActiveFlagLo
	BEQ.b CODE_03E1EA
	JMP.w CODE_remove_special_spr

CODE_03E1EA:
	INC.w !RAM_YI_Level_NorSpr_SlimeGeneratorActiveFlagLo
	LDA.b $02
	ASL
	ASL
	ASL
	ASL
	STA.w $0C7A
	RTS

;---------------------------------------------------------------------------

DATA_03E1F7:
	dw $0020,$FFE0

CODE_03E1FB:
CODE_main_minisalvo_gen:                             ; Raidenthequick: CODE_main_minisalvo_gen (Mini Salvo spawner Main)
	LDA.w !RAM_YI_Level_NorSpr_SlimeGeneratorActiveFlagLo
	BNE.b CODE_03E203
	JMP.w CODE_remove_special_spr

CODE_03E203:
	PHY
	SEP.b #$10
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03E216
	LDA.w $0CE4
	BEQ.b CODE_03E219
CODE_03E216:
	JMP.w CODE_03E29D

CODE_03E219:
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$0008
	SEC
	SBC.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0005
	BMI.b CODE_03E231
	LDA.w #$0005
CODE_03E231:
	STA.b $00
	LDA.w #$0132
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	INC
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_0991DB>>16
	LDA.w #FXCODE_0991DB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDY.w !REGISTER_SuperFX_R6_MultiplierLo
	CPY.b $00
	BPL.b CODE_03E29D
	LDA.w #$0132
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_03E29D
	PHY
	LDY.b #$00
	LDA.b $10
	AND.w #$007F
	SEC
	SBC.w #$0040
	STA.b $00
	BPL.b CODE_03E268
	INY
	INY
CODE_03E268:
	CLC
	ADC.w DATA_03E1F7,y
	CLC
	ADC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	PLY
	STA.w $70E2,y
	LDA.w $0C7A
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w #$0007
	STA.w $7402,y
	INC
	STA.w $7A98,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	LDA.w #$0002
	STA.w $74A2,y
	LDA.w #$0060
	STA.w $0CE4
CODE_03E29D:
	REP.b #$10
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_03E2A1:
CODE_init_minisalvo_stop:                            ; Raidenthequick: CODE_init_minisalvo_stop
	STZ.w !RAM_YI_Level_NorSpr_SlimeGeneratorActiveFlagLo
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03E2A7:
CODE_init_dizzy_stop:                                ; Raidenthequick: CODE_init_dizzy_stop (clear dizzy effect, return slot)
	LDA.w $7FE8
	BEQ.b CODE_03E2B2
	LDA.w #$0001
	STA.w $7FE8
CODE_03E2B2:
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03E2B5:
CODE_init_hscroll_lock:                              ; Raidenthequick: CODE_init_hscroll_lock (set horizontal-scroll lock from sprite Y)
	LDA.w $7960
	ASL
	ASL
	ASL
	ASL
	SEC
	SBC.w #$0100
	STA.w $7E1A
	JMP.w CODE_03D639

;---------------------------------------------------------------------------

CODE_03E2C6:
CODE_init_goonie_stop:                             ; Goonie-spawn stop: clear $0C7C, the Goonie flock-counter / level-edge respawn latch (set+read by NorSpr $0E8 Goonie Init+Main; see docs/family-goonies.md). Formerly unknown3_stop.
	STZ.w $0C7C
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03E2CC:
CODE_init_fuzzy_gen:                                 ; Raidenthequick: CODE_init_fuzzy_gen (Fuzzy-spawner Init)
	LDA.w !RAM_YI_Level_NorSpr_FuzzyGeneratorActiveFlagLo
	BEQ.b CODE_03E2D4
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

CODE_03E2D4:
	INC.w !RAM_YI_Level_NorSpr_FuzzyGeneratorActiveFlagLo
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C44
	RTS

;---------------------------------------------------------------------------

DATA_03E2DE:
	dw $0120,$FFE0,$0130,$FFD0,$0140,$FFC0,$0150,$FFB0

DATA_03E2EE:
	dw $0000,$0020,$0040,$0060,$0080,$00A0,$00C0,$00E0

DATA_03E2FE:
	dw $0001,$0002,$0004,$0008,$0010,$0020,$0040,$0080

CODE_03E30E:
CODE_main_fuzzy_gen:                                 ; Raidenthequick: CODE_main_fuzzy_gen (Fuzzy-spawner Main)
	LDA.w !RAM_YI_Level_NorSpr_FuzzyGeneratorActiveFlagLo
	BNE.b CODE_03E316
	JMP.w CODE_remove_special_spr

CODE_03E316:
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_03E322
CODE_03E321:
	RTS

CODE_03E322:
	LDA.w $0C40
	CMP.w #$0008
	BCS.b CODE_03E321
	LDA.w $0C44
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_03E33F
	LDA.w $0CEA
	BNE.b CODE_03E3B0
CODE_03E33F:
	LDA.b $10
	AND.w #$0007
	ASL
	TAX
	LDA.w !RAM_YI_Global_Layer1YPosLo
	AND.w #$FFE0
	CLC
	ADC.w DATA_03E2EE,x
	STA.b $02
	LSR
	LSR
	LSR
	LSR
	AND.w #$000E
	TAX
	LDA.w $0C42
	AND.w DATA_03E2FE,x
	BNE.b CODE_03E3B0
	LDA.w DATA_03E2FE,x
	STA.b $00
	JSL.l CODE_random_number_gen
	SEP.b #$10
	PHY
	LDA.w #$0129
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_03E3AD
	LDA.w #$0080
	STA.w $0CEA
	LDA.b $00
	TSB.w $0C42
	INC.w $0C40
	LDA.w $0073
	STA.w $7400,y
	LDA.b $10
	AND.w #$0003
	ASL
	ASL
	ORA.w $7400,y
	TAX
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C44
	CLC
	ADC.w DATA_03E2DE,x
	STA.w $70E2,y
	LDA.b $02
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
CODE_03E3AD:
	PLY
	REP.b #$10
CODE_03E3B0:
	RTS

;---------------------------------------------------------------------------

CODE_03E3B1:
CODE_init_horizontal_scroll_stop:                    ; Raidenthequick: CODE_init_horizontal_scroll_stop (clear hscroll-lock state)
	STZ.w $0C7E
	JMP.w CODE_remove_special_spr

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Attacking/Ending Kamek (sprite $125) -- the Kamek that flies in during
; mid-level cutscenes (to grow shells), and during the ending cinematics.
; Init disambiguates "chasing" vs "ending" mode from the slot's X-position
; low nibble (an editor convention) and stashes the chosen variant in the
; per-slot scratch byte $701900,x for Main to dispatch on.
; Raidenthequick: init_kamek
;-------------------------------------------------------------------------
YI_NorSpr125_AttackingAndEndingKamek_Init:
init_kamek:                                     ; Raidenthequick: init_kamek
;$03E3B7
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_03E3CD
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TAY
	REP.b #$20
CODE_03E3CD:
	DEY
	TYX
	JMP.w (DATA_kamek_init_ptr,x)

DATA_03E3D2:
DATA_kamek_init_ptr:                                 ; Raidenthequick: DATA_kamek_init_ptr (2-entry: chasing | ending)
	dw CODE_init_kamek_ending
	dw CODE_init_kamek_chasing

CODE_03E3D6:
CODE_init_kamek_ending:                              ; Raidenthequick: CODE_init_kamek_ending (ending-cinematic Kamek Init)
	LDX.b $12
	JSL.l CODE_03AE60
	SEP.b #$20
	LDA.b #$3C
	STA.w $7180,x
	LDA.b #$FF
	STA.w $74A2,x
	REP.b #$20
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$0040
	STA.w $7A96,x
	RTL

CODE_03E3F7:
CODE_init_kamek_chasing:                             ; Raidenthequick: CODE_init_kamek_chasing (mid-level chasing Kamek Init)
	LDX.b $12
	LDA.w $6FA0,x
	ORA.w #$6800
	STA.w $6FA0,x
	LDA.w #$0001
	STA.w $7402,x
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Kamek Main: branches via the variant byte ($701900,x) to either the
; chasing-Kamek body (CODE_main_kamek_ending) or the ending-cinematic body (CODE_main_kamek_chasing).
; Raidenthequick: main_kamek + DATA_kamek_main_ptr table
;-------------------------------------------------------------------------
YI_NorSpr125_AttackingAndEndingKamek_Main:
main_kamek:                                     ; Raidenthequick: main_kamek
;$03E409
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	TYX
	JMP.w (DATA_kamek_main_ptr,x)

DATA_03E411:
DATA_kamek_main_ptr:                                 ; Raidenthequick: DATA_kamek_main_ptr
	dw CODE_main_kamek_ending                              ; chasing  variant
	dw CODE_main_kamek_chasing                              ; ending   variant

CODE_03E415:
CODE_main_kamek_ending:                              ; Raidenthequick: CODE_main_kamek_ending (ending-cinematic Kamek Main body)
	LDX.b $12
	LDA.w $7402,x
	BNE.b CODE_03E423
	JSL.l CODE_03AA52
	JSR.w CODE_03E70C
CODE_03E423:
	JSL.l CODE_03AF23
	LDY.b $16,x
	TYX
	JMP.w (DATA_kamek_ending_state_ptr,x)

DATA_03E42D:
DATA_kamek_ending_state_ptr:                         ; 9-entry dispatch for ending-cinematic Kamek Main, indexed by $16,x
	dw CODE_kamek_ending_phase0_spawn                              ; phase 0: spawn off right edge, start fly-in
	dw CODE_kamek_ending_phase2_fly_in                              ; phase 2: fly to x=$F4, then transition to chant pose
	dw CODE_kamek_ending_phase4_chant                              ; phase 4: cycle chant pose frames (DATA_kamek_ending_chant_frames/03E4E0)
	dw CODE_kamek_ending_phase6_cast                              ; phase 6: cast spell, drop down, start music $0009
	dw CODE_kamek_ending_phase8_hold                              ; phase 8: fly to x=$0080, hold position
	dw CODE_03E58B                              ; phase A: present message (toadies + dialog)
	dw CODE_03E67B                              ; phase C: post-dialog wait
	dw CODE_03E6AE                              ; phase E: depart (fly away)
	dw CODE_kamek_ending_phase10_cleanup                              ; phase 10: final cleanup / despawn

CODE_03E43F:
CODE_kamek_ending_phase0_spawn:                      ; phase 0: spawn at (cam_x+$0130, cam_y+$0040), drift left at XSpeed=$FE00
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_03E478
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0130
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0040
	STA.w $7182,x
	STA.w $7A36,x
	SEP.b #$20
	LDA.b #$01
	STA.w $74A2,x
	REP.b #$20
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0004
	STA.w $7A98,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_03E478:
	RTL

CODE_03E479:
CODE_kamek_ending_phase2_fly_in:                     ; phase 2: drift left, flap-cycle anim until x < $00F4
	LDX.b $12
	JSL.l CODE_0CE4E9
	LDA.w $7680,x
	CMP.w #$00F4
	BMI.b CODE_03E49C
	LDA.w $7A98,x
	BNE.b CODE_03E49B
	LDA.w $7402,x
	EOR.w #$0003
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_03E49B:
	RTL

CODE_03E49C:
	LDA.w #$0006
	STA.w $7402,x
	LDA.w #$0020
	STA.w $7540,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03E49B
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	SEP.b #$20
	LDY.b #$13
	STY.b $17,x
	LDA.w DATA_kamek_ending_chant_frames,y
	STA.w $7402,x
	LDA.w DATA_kamek_ending_chant_durations,y
	STA.w $7A98,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	RTL

DATA_03E4CC:
DATA_kamek_ending_chant_frames:                      ; 20-entry chant-pose anim frame sequence (palindromic, played by phase 4)
	db $05,$05,$04,$03,$04,$05,$04,$03,$04,$05,$04,$03,$04,$05,$04,$03
	db $04,$05,$04,$03

DATA_03E4E0:
DATA_kamek_ending_chant_durations:                   ; 20-entry per-pose duration (alternating $02/$06 frames)
	db $02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06,$02,$06
	db $02,$06,$02,$06

CODE_03E4F4:
CODE_kamek_ending_phase4_chant:                      ; phase 4: cycle chant frames via $17,x; play KamekTalk SoundID every 8 frames
	LDX.b $12
	JSL.l CODE_0CE4E9
	LDA.w $7A98,x
	BNE.b CODE_03E526
	LDY.b $17,x
	DEY
	BMI.b CODE_03E527
	STY.b $17,x
	SEP.b #$20
	LDA.w DATA_kamek_ending_chant_frames,y
	STA.w $7402,x
	LDA.w DATA_kamek_ending_chant_durations,y
	STA.w $7A98,x
	REP.b #$20
	TYA
	AND.w #$0007
	CMP.w #$0007
	BNE.b CODE_03E526
	LDA.w #!Define_YI_SoundID5B_KamekTalk
	JSL.l CODE_push_sound_queue
CODE_03E526:
	RTL

CODE_03E527:
	LDA.w #$0004
	STA.w $7402,x
	LDA.w #$0115
	STA.l $704070
	INC.w !RAM_YI_Level_MessageBoxState 
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
	RTL

CODE_03E53E:
CODE_kamek_ending_phase6_cast:                       ; phase 6: cast spell, set XSpeed accel ($F800/$0800), YSpeed=$FF00, start ending music
	LDX.b $12
	LDA.w #$0001
	STA.w $7402,x
	LDA.w #$F800
	STA.w $75E0,x
	LDA.w #$0040
	STA.w $7540,x
	LDA.w #$0800
	STA.w $75E2,x
	LDA.w #$0010
	STA.w $7542,x
	LDA.w #$FF00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0009
	STA.w !RAM_YI_Global_PlayMusicLo
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
	RTL

CODE_03E571:
CODE_kamek_ending_phase8_hold:                       ; phase 8: drift until x < $0080, then settle
	LDX.b $12
	LDA.w $7680,x
	CMP.w #$0080
	BMI.b CODE_03E57E
	JMP.w CODE_03E640

CODE_03E57E:
	LDA.w #$0800
	STA.w $75E0,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
	RTL

CODE_03E58B:
CODE_kamek_ending_phaseA_present:                    ; phase A: when x reaches $0140, swap to ending palette + present toadies/dialog
	LDX.b $12
	LDA.w $7680,x
	CMP.w #$0140
	BCC.b CODE_03E5F1
	LDX.b #$1C
CODE_03E597:
	LDA.l DATA_5FF556,x
	STA.l $702F2E,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	DEX
	DEX
	BPL.b CODE_03E597
	LDX.b $12
	SEP.b #$20
	LDY.w $105E
	LDA.b #$FF
	STA.w $74A2,y
	REP.b #$20
	STZ.w $7402,x
	STZ.w $7400,x
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$000C
	STA.w $7042,x
	LDA.w $7040,x
	AND.w #$07FF
	ORA.w #$2000
	STA.w $7040,x
	LDA.w #$0100
	STA.b $76,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	STZ.w $7542,x
	LDA.w #$0020
	STA.w $7A98,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
	RTL

CODE_03E5F1:
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03E5FA
	INY
	INY
CODE_03E5FA:
	TYA
	STA.w $7400,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03E611
	LDA.w $7682,x
	CMP.w #$0060
	BCC.b CODE_03E611
	LDA.w #$F800
	STA.w $75E2,x
CODE_03E611:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_03E622
	LDA.w #$0007
	BRA.b CODE_03E63C

CODE_03E622:
	CLC
	ADC.w #$0100
	CMP.w #$0300
	BCS.b CODE_03E630
	LDA.w #$0006
	BRA.b CODE_03E63C

CODE_03E630:
	CLC
	ADC.w #$0100
	CMP.w #$0500
	BCS.b CODE_03E640
	LDA.w #$0003
CODE_03E63C:
	STA.w $7402,x
	RTL

CODE_03E640:
	LDA.b $14
	LSR
	LSR
	AND.w #$0001
	INC
	STA.w $7402,x
	LDA.w $7400,x
	BEQ.b CODE_03E67A
	LDY.w $105E
	LDA.w $70E2,x
	CMP.w $70E2,y
	BCC.b CODE_03E67A
	LDA.w #$002F
	STA.w $7402,y
	LDA.w #$0000
	STA.w $7542,y
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
CODE_03E67A:
	RTL

CODE_03E67B:
CODE_kamek_ending_phaseC_wait:                       ; phase C: post-dialog wait timer, advance Y position with arc accel
	LDX.b $12
	LDA.w $7A98,x
	BNE.b CODE_03E6AD
	LDA.b $76,x
	ASL
	ASL
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FFF0
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0110
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0038
	STA.w $7182,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
CODE_03E6AD:
	RTL

CODE_03E6AE:
CODE_kamek_ending_phaseE_depart:                     ; phase E: fly away (XSpeed/YSpeed accel), advance toward off-screen
	LDX.b $12
	LDA.w $7680,x
	CMP.w #$00E0
	BPL.b CODE_03E6E5
	LDA.b $76,x
	SEC
	SBC.w #$0003
	BMI.b CODE_03E6D0
	STA.b $76,x
	ASL
	ASL
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	JSR.w CODE_03E762
	BRA.b CODE_03E6E5

CODE_03E6D0:
	LDA.w $7680,x
	CMP.w #$0020
	BPL.b CODE_03E6E5
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b $16,x
	INY
	INY
	STY.b $16,x
	RTL

CODE_03E6E5:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_03E6EF
	CMP.w #$FFF0
	BCC.b CODE_03E6F5
CODE_03E6EF:
	LDA.w #$FFF0
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_03E6F5:
	RTL

CODE_03E6F6:
CODE_kamek_ending_phase10_cleanup:                   ; phase 10: bump cinematic-stage counter at sprite-slot $105E, despawn Kamek
	LDX.b $12
	LDY.w $105E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7A96,y
	JML.l CODE_03A31E

CODE_03E70C:
	LDY.w $74A2,x
	CMP.w #$00FF
	BEQ.b CODE_03E761
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_03E761
	LDA.w $7722,x
	BMI.b CODE_03E761
	REP.b #$10
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b $76,x
	CMP.w #$0018
	BPL.b CODE_03E730
	LDA.w #$0018
CODE_03E730:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXDATA_548000+$2080
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$2080)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_03E761:
	RTS

CODE_03E762:
	LDA.w #$5574
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #$0000
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0100
	SEC
	SBC.b $76,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$00E1
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08E167>>16
	LDA.w #FXCODE_08E167
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	RTS

CODE_03E78F:
CODE_main_kamek_chasing:                             ; Raidenthequick: CODE_main_kamek_chasing (chasing-Kamek per-frame state machine)
	LDX.b $12
	JSL.l CODE_03AF23
	LDY.b $16,x
	TYX
	JMP.w (DATA_kamek_chasing_state_ptr,x)

DATA_03E79B:
DATA_kamek_chasing_state_ptr:                        ; 4-entry dispatch for chasing-Kamek phase ($16,x)
	dw CODE_kamek_chasing_phase0_fly_in                              ; phase 0: fly in / wait
	dw CODE_kamek_chasing_phase1_cast                              ; phase 1: cast spell
	dw CODE_kamek_chasing_phase2_post_cast                              ; phase 2: post-cast wait
	dw CODE_kamek_chasing_phase3_fly_out                              ; phase 3: fly out

DATA_03E7A3:
	dw $0120,$FFD0

CODE_03E7A7:
CODE_kamek_chasing_phase0_fly_in:                    ; phase 0: spawn off-screen right, set initial position + flip palette
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_03E7F7
	STZ.w $7400,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03E7A3
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$0030
	STA.w $7182,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w #!Define_YI_LevelID_KameksRevenge
	BEQ.b CODE_03E7DE
	LDA.w $7042,x
	EOR.w #$0020
	STA.w $7042,x
	BRA.b CODE_03E7E7

CODE_03E7DE:
	LDA.w $7042,x
	EOR.w #$0020
	STA.w $7042,x
CODE_03E7E7:
	SEP.b #$20
	STZ.w $74A2,x
	LDA.b #$40
	STA.w $70E0,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_03E7F7:
	RTL

CODE_03E7F8:
CODE_kamek_chasing_phase1_cast:                      ; phase 1: stop at x=FFD0, play cast-spell anim, set $003C wait timer
	LDX.b $12
	LDA.b $14
	LSR
	LSR
	AND.w #$0001
	CLC
	ADC.w #$0008
	STA.w $7402,x
	LDA.w $7680,x
	CMP.w #$FFD0
	BPL.b CODE_03E826
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$003C
	STA.w $7A96,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
CODE_03E826:
	RTL

CODE_03E827:
CODE_kamek_chasing_phase2_post_cast:                 ; phase 2: snap to player Y, set $0480 XSpeed for fly-out, play SoundID $9A
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_03E881
	LDA.w #$0002
	STA.w $7400,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03E7A3+$02
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w #$0480
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w #!Define_YI_LevelID_KameksRevenge
	BEQ.b CODE_03E861
	LDA.w $7042,x
	EOR.w #$0020
	STA.w $7042,x
	BRA.b CODE_03E86A

CODE_03E861:
	LDA.w $7042,x
	EOR.w #$0020
	STA.w $7042,x
CODE_03E86A:
	SEP.b #$20
	LDA.b #$02
	STA.w $74A2,x
	STZ.w $70E0,x
	INC.b $16,x
	INC.b $16,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID9A_KamekFlying
	JML.l CODE_push_sound_queue

CODE_03E881:
	CMP.w #$0020
	BNE.b CODE_03E88D
	LDA.w #!Define_YI_SoundID5B_KamekTalk
	JML.l CODE_push_sound_queue

CODE_03E88D:
	RTL

CODE_03E88E:
CODE_kamek_chasing_phase3_fly_out:                   ; phase 3: physics tick, fly off right edge (x >= $0120), then return to phase 0
	LDX.b $12
	JSL.l CODE_03A5B7
	LDA.b $14
	LSR
	LSR
	AND.w #$0001
	INC
	STA.w $7402,x
	LDA.w $7680,x
	CMP.w #$0120
	BMI.b CODE_03E8BB
	LDA.w #$003C
	STA.w $7A96,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A2,x
	STZ.b $16,x
	REP.b #$20
CODE_03E8BB:
	RTL

;---------------------------------------------------------------------------

DATA_03E8BC:
DATA_inflating_balloon_state_ptr:                    ; 8-entry dispatch for Mock-Up/Inflating-Balloon Main, indexed by phase byte $18,x
	dw CODE_inflating_balloon_phase0_wait_proximity                              ; phase 0: wait for player proximity, then advance
	dw CODE_inflating_balloon_phase2_range_check                              ; phase 2: range check; player too far -> phase 4
	dw CODE_inflating_balloon_phase6_inflate                              ; phase 6: inflate (advance opacity byte $701901)
	dw CODE_inflating_balloon_phase8_pop                              ; phase 8: pop/flash effect + score-pop spawn
	dw CODE_03EB50                              ; phase A: cleanup / despawn
	dw CODE_inflating_balloon_phase4_player_gone                              ; phase 4: player-too-far recovery -> set anim, advance to $0C
	dw CODE_03E9E4                              ; phase C: wait until $701901 reaches $80, advance to $0E
	dw CODE_03E9F5                              ; phase E: chase player + inflate

DATA_03E8CC:
	dw $0000,$0002

;-------------------------------------------------------------------------
; Mock-Up / Inflating Balloon (sprite $08B) -- the balloon target that pops
; with sound during the "balloon-shoot" minigame.  CODE_03D3F8 checks "is
; this spawned from a generator?"; if so, JML to CODE_03A31E (despawn handler).
; Raidenthequick: init_inflating_balloon
;-------------------------------------------------------------------------
YI_NorSpr08B_InflatingBalloon_Init:              ; friendly alias of YI_NorSpr08B_MockUp_Init
YI_NorSpr08B_MockUp_Init:
init_inflating_balloon:                         ; Raidenthequick: init_inflating_balloon
;$03E8D0
	JSL.l CODE_03D3F8
	BEQ.b CODE_03E8DA
	JML.l CODE_03A31E

CODE_03E8DA:
	LDA.w $70E2,x
	STA.w $7A36,x
	LDA.w $7182,x
	STA.w $7A38,x
	JSL.l CODE_03AE60
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_03E90A
	SEP.b #$20
	LDA.b #$20
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TAY
	REP.b #$20
CODE_03E90A:
	DEY
	BEQ.b CODE_03E915
	LDY.b #$0A
	STY.b $18,x
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
CODE_03E915:
	LDA.w $7042,x
	ORA.w DATA_03E8CC,y
	STA.w $7042,x
	JSR.w CODE_03EC0B
	RTL

;---------------------------------------------------------------------------

ADDR_03E922:
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

YI_NorSpr08B_InflatingBalloon_Main:              ; friendly alias of YI_NorSpr08B_MockUp_Main
YI_NorSpr08B_MockUp_Main:
;$03E925
	JSL.l CODE_03AA52
	JSR.w CODE_03EC0B
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_03E940
	LDA.w $7A36,x
	STA.b $04
	LDA.w $7A38,x
	JSL.l CODE_03D3F3
CODE_03E940:
	JSL.l CODE_03AF23
	LDY.b $18,x
	CMP.w #$0008
	BEQ.b CODE_03E94E
	JSR.w CODE_03EB95
CODE_03E94E:
	LDY.b $18,x
	TYX
	JMP.w (DATA_inflating_balloon_state_ptr,x)

CODE_03E954:
CODE_inflating_balloon_phase0_wait_proximity:        ; phase 0 Main: wait for player within $C0 range, then advance to phase 2
	LDX.b $12
	JSR.w CODE_03EC91
	LDA.w $7860,x
	AND.w #$0001
	BNE.b CODE_03E98E
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_03E98D
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_03E98D
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
CODE_03E98D:
	RTL

CODE_03E98E:
	LDY.b #$02
	STY.b $18,x
	RTL

CODE_03E993:
CODE_inflating_balloon_phase2_range_check:           ; phase 2 Main: if player out of range, jump to phase 4
	LDX.b $12
	JSR.w CODE_03EC91
	JSR.w CODE_inflating_balloon_player_in_range
	BCS.b CODE_03E9A1
	LDY.b #$04
	STY.b $18,x
CODE_03E9A1:
	RTL

CODE_03E9A2:
CODE_inflating_balloon_phase6_inflate:               ; phase 6 Main: tick opacity byte $701901 by +2; overflow -> phase 8 (pop)
	LDX.b $12
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	CLC
	ADC.b #$02
	BCS.b CODE_03E9B4
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	REP.b #$20
	RTL

CODE_03E9B4:
	LDA.b #$FF
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	LDA.b #$06
	STA.b $18,x
	LDA.b #$08
	STA.w $7A96,x
	REP.b #$20
	LDA.w #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	RTL

CODE_03E9CC:
CODE_inflating_balloon_phase4_player_gone:           ; phase 4 Main: when player back in range, set $0010 X+Y wind speeds, advance to phase $0C
	LDX.b $12
	JSR.w CODE_03EC91
	JSR.w CODE_inflating_balloon_player_in_range
	BCS.b CODE_03E9E3
	LDA.w #$0010
	STA.w $7540,x
	STA.w $7542,x
	LDY.b #$0C
	STY.b $18,x
CODE_03E9E3:
	RTL

CODE_03E9E4:
CODE_inflating_balloon_phaseC_wait_inflate:          ; phase C Main: idle until opacity byte reaches $80, advance to phase $0E
	LDX.b $12
	JSR.w CODE_03EC91
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	CPY.b #$80
	BNE.b CODE_03E9F4
	LDY.b #$0E
	STY.b $18,x
CODE_03E9F4:
	RTL

CODE_03E9F5:
CODE_inflating_balloon_phaseE_chase_inflate:         ; phase E Main: SuperFX-driven chase-player vector update, then fall into phase 6 inflate
	LDX.b $12
	JSR.w CODE_03E9FD
	JMP.w CODE_inflating_balloon_phase6_inflate

CODE_03E9FD:
	LDA.w $611C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $611E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7CD6,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7CD8,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	EOR.w #$FFFF
	INC
	STA.w $75E0,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	EOR.w #$FFFF
	INC
	STA.w $75E2,x
	RTS

CODE_03EA3B:
CODE_inflating_balloon_player_in_range:              ; returns carry set if player is within $C0 px X+Y of the balloon
	LDA.w $70E2,x
	SEC
	SBC.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCS.b CODE_03EA59
	LDA.w $7182,x
	SEC
	SBC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0060
	CMP.w #$00C0
CODE_03EA59:
	RTS

;---------------------------------------------------------------------------

DATA_03EA5A:
DATA_inflating_balloon_pop_priority_mask:            ; 4 priority-bit values to ORA into $7042 (palette select) during pop flash
	dw $0000,$0002,$0004,$0008

CODE_03EA62:
CODE_inflating_balloon_phase8_pop:                   ; phase 8 Main: pop flash sequence (palette flicker + score-pop spawn at timer end)
	LDX.b $12
	LDA.w $7A96,x
	BEQ.b CODE_03EA89
	BIT.w #$000F
	BNE.b CODE_03EA77
	PHA
	LDA.w #!Define_YI_SoundID50_MessageAppears
	JSL.l CODE_push_sound_queue
	PLA
CODE_03EA77:
	AND.w #$000C
	LSR
	TAY
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w DATA_inflating_balloon_pop_priority_mask,y
	STA.w $7042,x
	RTL

CODE_03EA89:
	LDA.w #!Define_YI_AmbSpr1EE
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7CD6,x
	STA.w $70A2,y
	LDA.w $7CD8,x
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$0008
	STA.w $73C2,y
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	REP.b #$20
	LDA.w $7CD6,x
	SEC
	SBC.w $611C
	CLC
	ADC.w #$0028
	CMP.w #$0050
	BCS.b CODE_03EADC
	LDA.w $7CD8,x
	SEC
	SBC.w $611E
	CLC
	ADC.w #$0028
	CMP.w #$0050
	BCS.b CODE_03EADC
	JSL.l CODE_03A858
CODE_03EADC:
	LDA.w $7A36,x
	STA.b $04
	LDA.w $7A38,x
	JSL.l CODE_03D3F3
	JSL.l CODE_03A31E
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	DEY
	LDA.w DATA_03E8CC,y
	INC
	STA.b $00
	LDA.w #$008D
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03EB4B
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	STA.w $7182,y
	LDA.w #$FC00
	STA.w $75E2,y
	LDA.w #$0040
	STA.w $7542,y
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	LDA.w $7040,y
	AND.w #$07FF
	ORA.w #$2800
	STA.w $7040,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	DEC
	ORA.w $7042,y
	STA.w $7042,y
	SEP.b #$20
	LDA.b #$05
	STA.w $74A2,y
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,y
	LDA.b #$02
	STA.w $7AF8,y
	REP.b #$20
CODE_03EB4B:
	RTL

;---------------------------------------------------------------------------

DATA_03EB4C:
	dw $0800,$F800

CODE_03EB50:
CODE_inflating_balloon_phaseA_collide:               ; phase A Main: collision check vs Yoshi-Egg/swallow; if hit, pop; else bounce-off motion
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	EOR.b $76,x
	BMI.b CODE_03EB6B
	LDY.w $7D36,x
	BMI.b CODE_03EB8A
	DEY
	BMI.b CODE_03EB6E
	BEQ.b CODE_03EB6E
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03EB6E
CODE_03EB6B:
	JMP.w CODE_03EA89

CODE_03EB6E:
	SEP.b #$20
	LDA.b #$00
	LDY.w $7221,x
	BMI.b CODE_03EB79
	INC
	INC
CODE_03EB79:
	EOR.w $7400,x
	TAY
	REP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	CLC
	ADC.w DATA_03EB4C,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701976|!EXRAMBankMirror,x
	RTL

CODE_03EB8A:
	JSL.l CODE_03A858
	JMP.w CODE_03EA89

;---------------------------------------------------------------------------

DATA_03EB91:
	dw $FE00,$0200

CODE_03EB95:
	LDY.w $7D36,x
	BPL.b CODE_03EB9B
	RTS

CODE_03EB9B:
	DEY
	BMI.b CODE_03EBE6
	BEQ.b CODE_03EBE6
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03EBE6
	LDA.w $7D38,y
	BEQ.b CODE_03EBE6
	LDA.w $70E2,y
	STA.b $00
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	LDA.w #!Define_YI_SoundID67_EnemyTumbling
	JSL.l CODE_push_sound_queue
	LDY.b #$00
	LDA.w $70E2,x
	SEC
	SBC.b $00
	BMI.b CODE_03EBCC
	INY
	INY
CODE_03EBCC:
	LDA.w DATA_03EB91,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.b $76,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	LDY.b #$08
	STY.b $18,x
	PLA
	RTL

CODE_03EBE6:
	RTS

;---------------------------------------------------------------------------

DATA_03EBE7:
	db $0F,$00,$0F,$00,$0E,$00,$0D,$00,$0C,$00,$0B,$00,$0A,$00,$09,$00
	db $08,$00,$07,$00,$06,$00,$05,$00,$04,$00,$03,$00,$02,$00,$01,$00
	db $00,$00,$00,$00

CODE_03EC0B:
	LDY.w $74A2,x
	BPL.b CODE_03EC11
	RTS

CODE_03EC11:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	TYA
	INC
	LSR
	LSR
	LSR
	AND.w #$00FE
	TAY
	LDA.w DATA_03EBE7,y
	STA.b $00
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6002,y
	CLC
	ADC.b $00
	STA.w $6002,y
	LDA.w $600A,y
	CLC
	ADC.b $00
	STA.w $600A,y
	LDA.w $6012,y
	CLC
	ADC.b $00
	STA.w $6012,y
	LDA.w $601A,y
	CLC
	ADC.b $00
	STA.w $601A,y
	SEP.b #$10
	LDA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_03EC90
	LDY.b $17,x
	TYA
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	TYA
	INC
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	REP.b #$10
	LDY.w $7722,x
	TYX
	LDA.l DATA_03A9EE,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.l DATA_03A9CE,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #FXDATA_548000+$4041
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$4041)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	SEP.b #$10
	LDX.b #FXCODE_088205>>16
	LDA.w #FXCODE_088205
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
CODE_03EC90:
	RTS

;---------------------------------------------------------------------------

CODE_03EC91:
	SEP.b #$20
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	CMP.b #$80
	BCC.b CODE_03ECA1
	LDA.b #$80
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BRA.b CODE_03ECA8

CODE_03ECA1:
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
CODE_03ECA8:
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_03ECAB:
	dw $3000,$3000,$4800,$4800

DATA_03ECB3:
	dw CODE_03EF92
	dw CODE_03EF11
	dw CODE_03EF0A
	dw CODE_03EF0A

DATA_03ECBB:
	dw DATA_03F258>>16,DATA_0CF87B>>16,DATA_03F1A4>>16,DATA_03F1A4>>16

DATA_03ECC3:
	dw DATA_03F258,DATA_0CF87B,DATA_03F1A4,DATA_03F1A4

;-------------------------------------------------------------------------
; Flyguy (sprite $08D) -- the carry-item shyguy with the balloon.  Per-color
; variant index is in $7400,x; uses tables DATA_03ECBB/DATA_03ECC3 to pick the
; right OAM frame data and "carried item" sprite ID per variant.
; See also: ys_enmy3.asm.
;-------------------------------------------------------------------------
YI_NorSpr08D_Flyguy_Init:
init_flyguy:                                    ; Raidenthequick: init_flyguy
;$03ECCB
	JSL.l CODE_03D3F8
	BEQ.b CODE_03ECD5
	JML.l CODE_03A31E

CODE_03ECD5:
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	BNE.b CODE_03ECF6
	SEP.b #$20
	LDA.w $70E2,x
	AND.b #$10
	LSR
	LSR
	LSR
	STA.b $00
	LDA.w $7182,x
	AND.b #$10
	LSR
	LSR
	ORA.b $00
	INC
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	TAY
	REP.b #$20
CODE_03ECF6:
	DEY
	LDA.w $7040,x
	ORA.w DATA_03ECAB,y
	STA.w $7040,x
	LDA.w #$001E
	STA.w $7A96,x
	LDA.w $70E2,x
	STA.w $7A36,x
	LDA.w $7182,x
	STA.w $7A38,x
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7042,x
	STA.w $7042,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr08D_Flyguy_Main:
main_flyguy:                                    ; Raidenthequick: main_flyguy
;$03ED20
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	TYX
	JMP.w (DATA_flyguy_top_state_ptr,x)

DATA_03ED27:
DATA_flyguy_top_state_ptr:                           ; 2-entry: alive | swallowed -- top-level dispatch on $701900,x for Flyguy Main
	dw CODE_03ED2B                              ; alive: normal Flyguy behaviour
	dw CODE_03F0D1                              ; swallowed: in-Yoshi-mouth post-swallow logic

CODE_03ED2B:
	LDX.b $12
	JSR.w CODE_03F183
	JSR.w CODE_03EECA
	JSL.l CODE_03AF23
	JSL.l CODE_03A5B7
	JSR.w CODE_03F07F
	LDA.b $14
	AND.w #$0003
	STA.w $7402,x
	LDY.b $18,x
	TYX
	JMP.w (DATA_flyguy_alive_state_ptr,x)

DATA_03ED4C:
DATA_flyguy_alive_state_ptr:                         ; 5-entry dispatch for alive-Flyguy sub-phase, indexed by $18,x
	dw CODE_03ED5A                              ; sub 0: enter (spawn at screen edge, set drift speed)
	dw CODE_03ED95                              ; sub 2: drift
	dw CODE_03EE0B                              ; sub 4: detect player below
	dw CODE_03EE56                              ; sub 6: drop bomb / item
	dw CODE_03EEB3                              ; sub 8: turn around / leave

DATA_03ED56:
	dw $0120,$FFD0

CODE_03ED5A:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_03ED94
	SEP.b #$20
	INC.b $18,x
	INC.b $18,x
	LDA.b #$05
	STA.w $74A2,x
	REP.b #$20
	LDA.w $0073
	STA.w $7400,x
	TAY
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w DATA_03ED56,y
	STA.w $70E2,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$FFC0
	STA.w $7182,x
	LDA.w #$0020
	STA.w $7540,x
	STA.w $7542,x
	BRA.b CODE_03EDAB

CODE_03ED94:
	RTL

CODE_03ED95:
	LDX.b $12
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03EDA0
	INY
	INY
CODE_03EDA0:
	TYA
	CMP.w $7400,x
	BEQ.b CODE_03EDAB
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03EDE1
CODE_03EDAB:
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7A38,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $70E2,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_09907C>>16
	LDA.w #FXCODE_09907C
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $75E0,x
	LDA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w $75E2,x
	RTL

CODE_03EDE1:
	STZ.w $7540,x
	STZ.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w $7182,x
	STA.b $78,x
	LDA.w #$0078
	STA.w $7A96,x
	LDA.w $7A36,x
	STA.b $04
	LDA.w $7A38,x
	JSL.l CODE_03D3F3
	LDY.b $18,x
	INY
	INY
	STY.b $18,x
	RTL

CODE_03EE0B:
	LDX.b $12
	LDA.w $7A96,x
	BEQ.b CODE_03EE45
	TXY
	REP.b #$10
	LDX.b $76,y
	LDA.l DATA_sine_lut_8bit_radians,x
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable7019D8|!EXRAMBankMirror,y
	STA.w $7182,y
	TXA
	CLC
	ADC.w #$0002
	AND.w #$01FE
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	SEP.b #$10
	TYX
	RTL

CODE_03EE45:
	LDA.w #$0000
	STA.b $76,x
	LDY.w $7400,x
	STY.b $19,x
	LDY.b $18,x
	INY
	INY
	STY.b $18,x
	RTL

CODE_03EE56:
	LDX.b $12
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,x
	CMP.w #$0250
	BCS.b CODE_03EEA2
	TXY
	REP.b #$10
	AND.w #$01FE
	TAX
	LDA.l DATA_sine_lut_8bit_radians,x
	ASL
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	ASL
	PHA
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701979|!EXRAMBankMirror,y
	AND.w #$00FF
	BNE.b CODE_03EE83
	PLA
	EOR.w #$FFFF
	INC
	PHA
CODE_03EE83:
	PLA
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CLC
	ADC.w #$0008
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	SEP.b #$10
	LDX.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	BMI.b CODE_03EE9C
	INX
	INX
CODE_03EE9C:
	TXA
	STA.w $7400,y
	TYX
	RTL

CODE_03EEA2:
	LDA.w #$0010
	STA.w $7A96,x
	LDY.b #$00
	STY.b $19,x
	LDY.b $18,x
	INY
	INY
	STY.b $18,x
	RTL

CODE_03EEB3:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_03EEC9
	LDY.b $19,x
	BNE.b CODE_03EEC9
	LDA.w #!Define_YI_SoundID6E_FlyGuyGettingAway
	JSL.l CODE_push_sound_queue
	LDY.b #$01
	STY.b $19,x
CODE_03EEC9:
	RTL

CODE_03EECA:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_03EEE8
	JSR.w CODE_03EEF6
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7042,x
	STA.w $7042,x
	RTS

CODE_03EEE8:
	CMP.w #$0010
	BEQ.b CODE_03EEF5
	CMP.w #$000E
	BEQ.b CODE_03EEF5
	JSR.w CODE_03EEF6
CODE_03EEF5:
	RTS

CODE_03EEF6:
	LDA.w $7A36,x
	STA.b $04
	LDA.w $7A38,x
	JSL.l CODE_03D3F3
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	DEY
	TYX
	JMP.w (DATA_03ECB3,x)

CODE_03EF0A:
	LDX.b $12
	JSL.l CODE_spawn_1up_score
	RTS

CODE_03EF11:
	LDX.b $12
	LDA.w $7A38,x
	ASL
	ASL
	ASL
	ASL
	AND.w #$FF00
	ORA.w #$8000
	STA.b $00
	LDA.w $7A36,x
	LSR
	LSR
	LSR
	LSR
	AND.w #$00FF
	ORA.b $00
	STA.b $0E
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
	LDA.w #$0115
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_03EF62
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,y
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	RTS

CODE_03EF62:
	JSL.l CODE_0CFF61
	LDA.w #!Define_YI_NorSpr115_Coin
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w $7042,x
	AND.w #$FFF1
	ORA.w #$0002
	STA.w $7042,x
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	PLA
	PLA
	RTL

CODE_03EF92:
	LDX.b $12
	LDA.w #!Define_YI_SoundID30_AppearingStars
	JSL.l CODE_push_sound_queue
	LDA.w !RAM_YI_Level_StarTimerLo
	BEQ.b CODE_03EFB3
	STA.w !REGISTER_DividendLo
	LDY.b #$0A
	STY.w !REGISTER_Divisor
	NOP #8
	LDA.w !REGISTER_QuotientLo
CODE_03EFB3:
	STA.b $00
	LDA.w #$001D
	SEC
	SBC.b $00
	STA.b $00
	LDA.w #$0004
	STA.b $02
CODE_03EFC2:
	LDA.b $00
	BPL.b CODE_03EFDA
	LDA.w #$0100
	STA.b $04
	LDA.w #$0140
	STA.b $06
	LDA.w #$0010
	STA.b $08
	LDA.w #!Define_YI_NorSpr115_Coin
	BRA.b CODE_03EFE6

CODE_03EFDA:
	LDA.w #$0180
	STA.b $04
	STZ.b $06
	STZ.b $08
	LDA.w #!Define_YI_NorSpr1A2_HealthStar
CODE_03EFE6:
	STA.b $0A
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03F038
	LDA.w $70E2,x
	STA.w $70E2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	JSL.l CODE_random_number_gen
	LDA.b $10
	AND.w #$000E
	TAX
	LDA.l DATA_pop_x_speeds,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $10
	LSR
	LSR
	LSR
	LSR
	AND.w #$000E
	TAX
	LDA.l DATA_pop_y_speeds,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
	LDA.b $04
	STA.w $7A96,y
	LDA.b $06
	STA.w $7A98,y
	LDA.b $08
	STA.w $7AF6,y
	DEC.b $00
	DEC.b $02
	BPL.b CODE_03EFC2
	RTS

CODE_03F038:
	JSL.l CODE_0CFF61
	LDA.b $0A
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w $7182,x
	CLC
	ADC.w #$0010
	STA.w $7182,y
	LDA.b $10
	AND.w #$000E
	TAX
	LDA.l DATA_pop_x_speeds,x
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $10
	LSR
	LSR
	LSR
	LSR
	AND.w #$000E
	TAX
	LDA.l DATA_pop_y_speeds,x
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDX.b $12
	LDA.b $04
	STA.w $7A96,y
	LDA.b $06
	STA.w $7A98,y
	LDA.b $08
	STA.w $7AF6,y
	PLA
	PLA
	RTL

CODE_03F07F:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_03F0D0
	BEQ.b CODE_03F0D0
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03F0D0
	LDA.w $7D38,y
	BEQ.b CODE_03F0D0
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	JSR.w CODE_03EEF6
	SEP.b #$20
	LDA.b #$FF
	STA.w $74A0,x
	LDA.b #$02
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b #$02
	STA.w $7AF8,x
	REP.b #$20
	LDA.w #$FE00
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.b $76,x
	LDA.w $7040,x
	AND.w #$07FF
	ORA.w #$2800
	STA.w $7040,x
	PLA
	RTL

CODE_03F0D0:
	RTS

CODE_03F0D1:
	LDX.b $12
	LDY.w $74A2,x
	BMI.b CODE_03F0EF
	LDA.w #DATA_0CF8F3>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_0CF8F3
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_09AEC1>>16
	LDA.w #FXCODE_09AEC1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_03F0EF:
	JSR.w CODE_03F142
	JSL.l CODE_03AF23
	LDA.w $7AF8,x
	CMP.w #$0001
	BNE.b CODE_03F105
	LDA.w #!Define_YI_SoundID6E_FlyGuyGettingAway
	JSL.l CODE_push_sound_queue
CODE_03F105:
	JSL.l CODE_03A5B7
	JSR.w CODE_03F15D
	LDA.b $14
	AND.w #$0003
	STA.w $7402,x
	TXY
	REP.b #$10
	LDX.b $76,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	CLC
	ADC.w #$0002
	AND.w #$01FE
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable7019D6|!EXRAMBankMirror,y
	SEP.b #$10
	TYX
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03F13D
	INY
	INY
CODE_03F13D:
	TYA
	STA.w $7400,x
	RTL

CODE_03F142:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0008
	BNE.b CODE_03F15C
	LDA.w #!Define_YI_NorSpr01E_Shyguy
	TXY
	JSL.l CODE_spawn_sprite
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	DEC
	ORA.w $7042,x
	STA.w $7042,x
CODE_03F15C:
	RTS

CODE_03F15D:
	LDY.w $7D36,x
	DEY
	BMI.b CODE_03F182
	BEQ.b CODE_03F182
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03F182
	LDA.w $7D38,y
	BEQ.b CODE_03F182
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDX.b $12
	JSL.l CODE_0CFF61
	PLA
	JML.l CODE_despawn_sprite_free_slot

CODE_03F182:
	RTS

CODE_03F183:
	LDY.w $74A2,x
	BMI.b CODE_03F1A3
	LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	DEY
	LDA.w DATA_03ECBB,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_03ECC3,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_09AEC1>>16
	LDA.w #FXCODE_09AEC1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
CODE_03F1A3:
	RTS

DATA_03F1A4:
	dw $0002,$8800,$0000,$0E01,$402F,$0600,$2F0E,$0040
	dw $FA08,$402C,$0000,$2CFA,$0000,$16FE,$0249,$0800
	dw $6F16,$0002,$1600,$026E,$0002,$E311,$0206,$0000
	dw $0088,$0100,$2F0E,$0040,$0E06,$402F,$0800,$2DFA
	dw $0040,$FA00,$002D,$FE00,$4916,$0002,$1608,$026F
	dw $0000,$6E16,$0202,$1100,$06E3,$0002,$8800,$0000
	dw $0E01,$402F,$0600,$2F0E,$0040,$FA08,$403C,$0000
	dw $3CFA,$0000,$16FE,$0249,$0800,$6F16,$0002,$1600
	dw $026E,$0002,$E311,$0206,$0000,$0088,$0100,$2F0E
	dw $0040,$0E06,$402F,$0800,$3DFA,$0040,$FA00,$003D
	dw $FE00,$4916,$0002,$1608,$026F,$0000,$6E16,$0202
	dw $1100,$06E3

DATA_03F258:
	dw $0002,$8800,$0000,$0E01,$402F,$0600,$2F0E,$0040
	dw $FA08,$402C,$0000,$2CFA,$0200,$1000,$00EA,$0002
	dw $8800,$0000,$0E01,$402F,$0600,$2F0E,$0040,$FA08
	dw $402D,$0000,$2DFA,$0200,$1000,$00EA,$0002,$8800
	dw $0000,$0E01,$402F,$0600,$2F0E,$0040,$FA08,$403C
	dw $0000,$3CFA,$0200,$1000,$00EA,$0002,$8800,$0000
	dw $0E01,$402F,$0600,$2F0E,$0040,$FA08,$403D,$0000
	dw $3DFA,$0200,$1000,$00EA

;---------------------------------------------------------------------------

DATA_03F2D0:
	db $08,$06,$07,$08,$09,$0C,$0A,$09,$09,$0A,$08,$08,$0B,$0D

DATA_03F2DE:
	dw $FFE8,$FFE6,$FFE7,$FFE8,$FFE9,$FFEC,$FFEA,$FFE9
	dw $FFE9,$FFEA,$FFE8,$FFE8,$FFEB,$FFED

DATA_03F2FA:
	dw $FF80,$0080

;-------------------------------------------------------------------------
; Kaboomba (sprite $00A) -- the cannon-shooting tortoise enemy.  Init seeds
; the state byte $18,x = 7 (initial idle phase) and primes a frame counter
; at $7A96,x from DATA_kaboomba_aim_durations,y.
; Raidenthequick: init_kaboomba
;-------------------------------------------------------------------------
YI_NorSpr00A_Kaboomba_Init:
init_kaboomba:                                  ; Raidenthequick: init_kaboomba
;$03F2FE
	LDA.w #$0007
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_kaboomba_aim_durations,y
	STA.w $7A96,x
	LDA.w DATA_kaboomba_aim_frames,y
	STA.w $7402,x
	TAY
	LDA.w DATA_03F2D0,y
	STA.w $7B58,x
	REP.b #$20
	LDA.w #$0004
	STA.w $7BB8,x
	LDA.w #$0004
	STA.w $7BB6,x
	LDY.w $7400,x
	LDA.w DATA_03F2FA,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr00A_Kaboomba_Main:
main_kaboomba:                                  ; Raidenthequick: main_kaboomba
;$03F331
	JSL.l CODE_03AF23
	LDA.b $16,x
	TAX
	JSR.w (DATA_kaboomba_phase_ptr,x)
	LDA.b $76,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STZ.b $76,x
	JSL.l CODE_03A5B7
	LDY.w $7D36,x
	BPL.b CODE_03F35E
	LDA.w $60C0
	BNE.b CODE_03F35D
	LDA.w $60AA
	BMI.b CODE_03F35D
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_03F35B
	INC
CODE_03F35B:
	STA.b $76,x
CODE_03F35D:
	RTL

CODE_03F35E:
	DEY
	BMI.b CODE_03F35D
	BEQ.b CODE_03F35D
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03F35D
	LDA.w $7D38,y
	BEQ.b CODE_03F35D
	LDA.w $7542,y
	CMP.w #$0040
	BCS.b CODE_03F380
	JSL.l CODE_0CFF61
	JML.l CODE_kill_sprite_by_hit_checked

CODE_03F380:
	PHX
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	PLX
	RTL

DATA_03F388:
DATA_kaboomba_phase_ptr:                             ; 3-entry dispatch for Kaboomba Main, indexed by $16,x
	dw CODE_kaboomba_phase0_aim                              ; phase 0: aim cycle (rotate cannon angle, fire on player Yoshi-shot)
	dw CODE_03F422                              ; phase 2: fire animation
	dw CODE_03F4A9                              ; phase 4: cool-down / recoil

DATA_03F38E:
DATA_kaboomba_aim_frames:                            ; 8-entry: anim frame per cannon angle ($18,x = 7..0 cycle)
	db $07,$06,$05,$04,$03,$02,$01,$00

DATA_03F396:
DATA_kaboomba_aim_durations:                         ; 8-entry: frame count per cannon angle (palindromic)
	db $04,$04,$03,$02,$02,$03,$04,$04

CODE_03F39E:
CODE_kaboomba_phase0_aim:                            ; phase 0 Main: cycle aim angle through 8 positions, fire when Yoshi shoots
	LDX.b $12
	JSR.w CODE_03F531
	LDA.b $10
	AND.w #$003F
	BEQ.b CODE_03F3E3
	LDA.w $7A96,x
	BNE.b CODE_03F3E2
	DEC.b $18,x
	BPL.b CODE_03F3B8
	LDA.w #$0007
	STA.b $18,x
CODE_03F3B8:
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_kaboomba_aim_durations,y
	STA.w $7A96,x
	LDA.w DATA_kaboomba_aim_frames,y
	STA.w $7402,x
	TAY
	LDA.w DATA_03F2D0,y
	STA.w $7B58,x
	REP.b #$20
	LDA.b $76,x
	BEQ.b CODE_03F3E2
	TYA
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_03F2DE,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03F3E2:
	RTS

CODE_03F3E3:
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0005
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_03F49B,y
	STA.w $7A96,x
	LDA.w DATA_03F495,y
	STA.w $7402,x
	TAY
	LDA.w DATA_03F2D0,y
	STA.w $7B58,x
	REP.b #$20
	LDA.b $76,x
	BEQ.b CODE_03F414
	TYA
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_03F2DE,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03F414:
	LDA.w #$0004
	STA.b $16,x
	RTS

DATA_03F41A:
	db $08,$0C,$0D,$0C

DATA_03F41E:
	db $10,$02,$04,$02

CODE_03F422:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_03F457
	DEC.b $18,x
	BMI.b CODE_03F458
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_03F41E,y
	STA.w $7A96,x
	LDA.w DATA_03F41A,y
	STA.w $7402,x
	TAY
	LDA.w DATA_03F2D0,y
	STA.w $7B58,x
	REP.b #$20
	LDA.b $76,x
	BEQ.b CODE_03F457
	TYA
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_03F2DE,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03F457:
	RTS

CODE_03F458:
	LDY.w $7400,x
	LDA.w DATA_03F2FA,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0007
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_kaboomba_aim_durations,y
	STA.w $7A96,x
	LDA.w DATA_kaboomba_aim_frames,y
	STA.w $7402,x
	TAY
	LDA.w DATA_03F2D0,y
	STA.w $7B58,x
	REP.b #$20
	LDA.b $76,x
	BEQ.b CODE_03F48F
	TYA
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_03F2DE,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03F48F:
	LDA.w #$0000
	STA.b $16,x
CODE_03F494:
	RTS

DATA_03F495:
	db $08,$09,$0B,$0A,$09,$08

DATA_03F49B:
	db $10,$04,$04,$02,$10,$20

DATA_03F4A1:
	dw $FFF0,$0010

DATA_03F4A5:
	dw $FE00,$0200

CODE_03F4A9:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_03F494
	DEC.b $18,x
	BMI.b CODE_03F458
	SEP.b #$20
	LDY.b $18,x
	LDA.w DATA_03F49B,y
	STA.w $7A96,x
	LDA.w DATA_03F495,y
	STA.w $7402,x
	TAY
	LDA.w DATA_03F2D0,y
	STA.w $7B58,x
	REP.b #$20
	LDA.b $76,x
	BEQ.b CODE_03F4DE
	TYA
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_03F2DE,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03F4DE:
	LDA.b $18,x
	CMP.w #$0003
	BNE.b CODE_03F530
	LDY.w $7400,x
	LDA.w $70E2,x
	CLC
	ADC.w DATA_03F4A1,y
	STA.b $00
	LDA.w DATA_03F4A5,y
	STA.b $02
	LDA.w #$000B
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_03F529
	LDA.w $7960
	STA.w $70E2,y
	LDA.w $7182,x
	SEC
	SBC.w #$0010
	STA.w $7182,y
	LDA.b $02
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0001
	STA.w $7D38,y
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	BRA.b CODE_03F530

CODE_03F529:
	LDA.w #!Define_YI_SoundID42
	JSL.l CODE_push_sound_queue
CODE_03F530:
	RTS

CODE_03F531:
	LDA.b $76,x
	CMP.w #$0001
	BNE.b CODE_03F571
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0003
	STA.b $18,x
	SEP.b #$20
	TAY
	LDA.w DATA_03F41E,y
	STA.w $7A96,x
	LDA.w DATA_03F41A,y
	STA.w $7402,x
	TAY
	LDA.w DATA_03F2D0,y
	STA.w $7B58,x
	REP.b #$20
	LDA.b $76,x
	BEQ.b CODE_03F569
	TYA
	ASL
	TAY
	LDA.w $7182,x
	CLC
	ADC.w DATA_03F2DE,y
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
CODE_03F569:
	INC.b $76,x
	LDA.w #$0002
	STA.b $16,x
	PLA
CODE_03F571:
	RTS

;---------------------------------------------------------------------------

DATA_03F572:
	dw $FF40,$00C0,$0020,$FFE0

DATA_03F57A:
	dw $FFC0,$0040,$0120,$FFE0,$0130,$FFD0,$0140,$FFC0
	dw $0150,$FFB0,$0020,$0060,$00A0,$00E0,$0000,$0040
	dw $0080,$00C0

;-------------------------------------------------------------------------
; Fuzzy (sprite $129) -- the floating black pollen enemy that causes
; mosaic-effect intoxication if eaten.  Init seeds Y-speed $FF40 (slow drift
; up) and stashes the variant byte from $7400,x to drive the wave-motion
; tables (DATA_03F572 / DATA_03F57A).
; See also: ys_enmy3.asm.
;-------------------------------------------------------------------------
YI_NorSpr129_Fuzzy_Init:
init_fuzzy:                                     ; Raidenthequick: init_fuzzy
;$03F59E
	LDA.w #$FF40
	STA.w $75E2,x
	LDY.w $7400,x
	LDA.w $7182,x
	CLC
	ADC.w #$0020
	STA.b $18,x
	LDA.w DATA_03F57A,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTL

;---------------------------------------------------------------------------

YI_NorSpr129_Fuzzy_Main:
main_fuzzy:                                     ; Raidenthequick: main_fuzzy
;$03F5B7
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_03F5CF
CODE_03F5BF:
	LDA.b $78,x
	BEQ.b CODE_03F5D4
	DEC.w $0C40
	LDA.b $78,x
	TRB.w $0C42
	STZ.b $78,x
	BRA.b CODE_03F604

CODE_03F5CF:
	LDY.w $7D96,x
	BNE.b CODE_03F5BF
CODE_03F5D4:
	LDA.w $7D38,x
	BEQ.b CODE_03F616
	STZ.w $7D38,x
	LDA.w #$0040
	STA.w $7542,x
	STA.w $7540,x
	LDA.w #$0100
	STA.w $75E2,x
	LDA.w #$0100
	LDY.w $7221,x
	BPL.b CODE_03F5F6
	LDA.w #$FF00
CODE_03F5F6:
	STA.w $75E0,x
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_03F616
CODE_03F604:
	LDA.w $6FA0,x
	ORA.w #$0060
	STA.w $6FA0,x
	LDA.w $7040,x
	ORA.w #$0004
	STA.w $7040,x
CODE_03F616:
	JSL.l CODE_03AF23
	LDA.b $78,x
	BEQ.b CODE_03F677
	JSR.w CODE_03F6B8
	LDA.b $76,x
	BEQ.b CODE_03F632
	LDA.w $7A96,x
	BNE.b CODE_03F62F
	STZ.b $76,x
	JMP.w CODE_03F6D2

CODE_03F62F:
	JSR.w CODE_03F6B1
CODE_03F632:
	JSR.w CODE_03F678
	LDY.b #$00
	LDA.b $18,x
	CMP.w $7182,x
	BMI.b CODE_03F640
	LDY.b #$02
CODE_03F640:
	LDA.w DATA_03F572,y
	STA.w $75E2,x
	LDY.b #$00
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	EOR.w $75E2,x
	BMI.b CODE_03F668
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0060
	CMP.w #$00C0
	BCC.b CODE_03F676
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$00A0
	CMP.w #$0140
	BCC.b CODE_03F66F
CODE_03F668:
	INY
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_03F66F
	INY
CODE_03F66F:
	TYA
	AND.w #$00FF
	STA.w $7402,x
CODE_03F676:
	RTL

CODE_03F677:
	RTL

CODE_03F678:
	LDY.w $7D36,x
	BPL.b CODE_03F698
	LDA.w #!Define_YI_SoundID21_Fuzzy
	JSL.l CODE_push_sound_queue
	LDA.w #$0400
	STA.w $7FE8
	LDA.w #$0003
	STA.w $61CA
	LDA.w #$0010
	STA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	BRA.b CODE_03F6B1

CODE_03F698:
	DEY
	BMI.b CODE_03F6B7
	BEQ.b CODE_03F6B7
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_03F6B7
	LDA.w $7D38,y
	BEQ.b CODE_03F6B7
	LDA.w #!Define_YI_SoundID3A_StompShyGuy
	JSL.l CODE_push_sound_queue
CODE_03F6B1:
	JSL.l CODE_039F2B
	BRA.b CODE_03F6D1

CODE_03F6B7:
	RTS

CODE_03F6B8:
	LDA.w $7680,x
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCS.b CODE_03F6D1
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	CMP.w #$0140
	BCS.b CODE_03F6D1
	RTS

CODE_03F6D1:
	PLA
CODE_03F6D2:
	DEC.w $0C40
	LDA.b $78,x
	TRB.w $0C42
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

DATA_03F6DE:
DATA_ride_yoshi_x_carry_offsets:                     ; 256-byte table read by CODE_spr_state_ride_yoshi, indexed by Yoshi's anim frame ($60BE) -- per-frame X carry-attach offset
	db $06,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06
	db $06,$06,$06,$06,$06,$06,$06,$06,$06,$06,$BC,$BC,$BC,$09,$09,$09
	db $09,$04,$04,$04,$04,$04,$04,$04,$05,$05,$05,$06,$03,$BE,$00,$00
	db $03,$01,$07,$00,$00,$01,$00,$00,$BE,$BE,$BE,$01,$01,$01,$02,$02
	db $05,$05,$06,$05,$05,$04,$05,$05,$46,$06,$06,$05,$06,$06,$BC,$BB
	db $BB,$BD,$BD,$BD,$BD,$05,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06
	db $05,$05,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$05,$05,$05,$07,$46,$44,$40
	db $FF,$FF,$40,$40,$40,$40,$40,$40,$06,$06,$07,$06,$08,$08,$08,$08
	db $04,$04,$05,$05,$06,$06,$04,$06,$06,$06,$06,$06,$04,$42,$FD,$FD
	db $FD,$FD,$FD,$FD,$06,$05,$04,$03,$02,$01,$BF,$BD,$BC,$BC,$BC,$BC
	db $BB,$BB,$06,$07,$08,$0A,$0C,$0D,$10,$10,$10,$10,$10,$10,$10,$BC
	db $BB,$BA,$BA,$B9,$B8,$B6,$B4,$B2,$B3,$B5,$B4,$B5,$B5,$BD,$BD,$BD
	db $BF,$00,$00,$01,$02,$02,$02,$02,$02,$02,$00,$00,$00,$00,$00,$00
	db $00,$06,$06,$05,$05,$06,$06,$07,$08,$08,$08,$07,$07,$07,$07,$07
	db $07,$06,$05,$05,$05,$06,$07,$07,$08,$06,$05,$05,$05,$06,$07,$07
	db $08,$03,$03,$03,$02,$01,$02,$02,$03,$04,$04,$03,$04,$02,$01,$04
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$06,$06,$06,$06,$06,$06,$06,$06,$05,$05,$05
	db $06,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$06,$06,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$02,$01,$06,$01,$42,$05,$05,$06,$06,$00,$00,$06,$06,$00,$02
	db $46,$46,$46,$46,$46,$06,$46,$06,$06,$06,$06,$46,$02,$06,$06,$46
	db $46,$46,$06,$06,$02,$02,$02,$06,$06,$BC,$BC,$BC,$49,$49,$49,$49
	db $04,$04,$04,$04,$04,$04,$44,$44,$44,$44,$FC,$FD,$FE,$FD,$FB,$FB
	db $FD,$03,$44,$04,$FC,$FC,$FC,$F7,$F7,$F7,$01,$01,$01,$02,$02,$02
	db $02,$02,$02,$02,$02,$02,$02,$02,$06,$06,$05,$02,$02,$FC,$FB,$FB
	db $FD,$FD,$BD

DATA_03F8E1:
DATA_ride_yoshi_y_carry_offsets:                     ; 256-byte table read by CODE_spr_state_ride_yoshi, indexed by Yoshi's anim frame ($60BE) -- per-frame Y carry-attach offset
	db $FD,$05,$05,$06,$06,$05,$05,$04,$04,$04,$05,$06,$05,$04,$04,$04
	db $04,$03,$06,$08,$04,$04,$04,$04,$04,$03,$04,$00,$FF,$FE,$02,$02
	db $02,$02,$F8,$F8,$F8,$F8,$FB,$FE,$00,$06,$06,$06,$06,$06,$01,$00
	db $FE,$03,$FF,$06,$01,$00,$02,$01,$00,$FF,$FF,$FF,$06,$06,$07,$07
	db $06,$04,$04,$04,$04,$04,$03,$04,$03,$08,$04,$04,$04,$04,$04,$03
	db $03,$04,$05,$05,$05,$04,$04,$04,$04,$04,$04,$04,$04,$05,$04,$04
	db $04,$04,$04,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$04,$FE,$01,$01,$04,$04
	db $07,$07,$05,$06,$07,$05,$06,$07,$00,$04,$04,$04,$04,$04,$04,$05
	db $05,$02,$02,$02,$02,$05,$05,$04,$04,$04,$04,$04,$04,$01,$FD,$FE
	db $FE,$FE,$FE,$FE,$FE,$03,$03,$03,$02,$02,$02,$02,$01,$00,$02,$02
	db $02,$02,$01,$01,$00,$00,$00,$01,$02,$03,$04,$03,$03,$04,$05,$04
	db $05,$06,$06,$07,$07,$06,$04,$04,$04,$03,$02,$03,$05,$04,$04,$03
	db $02,$02,$02,$03,$04,$05,$05,$05,$07,$06,$05,$00,$00,$00,$00,$00
	db $00,$00,$01,$01,$00,$00,$01,$01,$02,$02,$02,$02,$00,$00,$01,$01
	db $01,$01,$05,$05,$04,$04,$04,$04,$06,$06,$05,$05,$04,$04,$05,$05
	db $06,$07,$0A,$09,$0A,$0A,$0B,$0B,$0A,$0A,$0A,$0A,$0A,$06,$0B,$0C
	db $08,$05,$05,$05,$05,$04,$05,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$05,$05,$05,$05,$05,$05,$05,$05,$03,$04
	db $02,$07,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$05,$05,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$01,$FB,$03,$FB,$FE,$04,$04,$04,$04,$00,$00,$06,$08,$00
	db $05,$05,$06,$06,$05,$05,$04,$04,$04,$05,$06,$05,$04,$05,$04,$04
	db $03,$06,$08,$04,$04,$05,$05,$05,$03,$04,$04,$03,$02,$02,$02,$02
	db $01,$F8,$F8,$F8,$F8,$FB,$FE,$00,$05,$07,$09,$04,$00,$03,$03,$04
	db $06,$04,$04,$02,$02,$04,$03,$02,$02,$02,$01,$06,$06,$07,$07,$06
	db $05,$05,$05,$05,$05,$03,$05,$03,$08,$04,$04,$04,$05,$05,$03,$03
	db $04,$05,$05,$04

DATA_03FAE5:
DATA_egg_carry_x_offsets:                            ; 512-byte u16 table indexed by Yoshi anim frame ($60BE) -- carried-egg X offset relative to Yoshi origin (used in main_egg / giant egg)
	db $05,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$0D,$0B
	db $07,$0A,$03,$BA,$AC,$00,$0D,$0D,$0D,$0D,$0D,$0D,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$40,$00,$00,$00,$00,$00,$07
	db $06,$06,$07,$08,$07,$07,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$40,$40
	db $40,$40,$40,$40,$40,$40,$40,$40,$40,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$40,$40
	db $40,$40,$40,$40,$40,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $0A,$09,$08,$07,$06,$05,$04,$02,$00,$01,$03,$03,$03,$03,$0B,$0C
	db $0D,$0E,$0F,$10,$11,$12,$12,$12,$12,$12,$12,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$40,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$40,$40,$40,$40,$40,$00,$40,$00,$00,$00,$00,$40,$00,$00,$00
	db $40,$40,$40,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$40,$40,$40
	db $40,$00,$00,$00,$00,$00,$00,$40,$40,$40,$40,$40,$40,$4D,$4B,$49
	db $4A,$4A,$07,$48,$08,$49,$4B,$4A,$49,$49,$4A,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$47,$46
	db $46,$47,$48,$07

DATA_03FCE9:
DATA_egg_carry_y_offsets:                            ; 512-byte u16 table indexed by Yoshi anim frame ($60BE) -- carried-egg Y offset relative to Yoshi origin (used in main_egg / giant egg)
	db $47,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$0F,$0D
	db $0A,$04,$00,$00,$00,$00,$0A,$09,$08,$04,$04,$04,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$09
	db $09,$0A,$0B,$0A,$0A,$09,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $0B,$0B,$0C,$0C,$0C,$0B,$0A,$0A,$0A,$08,$07,$08,$09,$08,$0A,$09
	db $08,$08,$08,$09,$0A,$0A,$0A,$0B,$0C,$0B,$0A,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$0F,$0D,$0A
	db $03,$F9,$EB,$E2,$D8,$09,$09,$08,$FE,$FF,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$09,$09
	db $0A,$0B,$0A,$0C,$0B

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($03FEEE, incbin, DATA_03FEEE_YI_U2.bin)
else
	%FREE_BYTES($03FEEE, 274, $FF)
endif
%BANK_END(<EndBank>)
endmacro
