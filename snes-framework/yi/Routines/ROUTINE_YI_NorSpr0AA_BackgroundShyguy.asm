;#############################################################################################################
;# ROUTINE_YI_NorSpr0AA_BackgroundShyguy.asm
;#
;# Init/Main handlers for normal sprite ID $0AA -- the "background shyguy" (Raidenthequick:
;# `background_shyguy`). This is the Shy Guy variant that lives on the BG2 plane and walks
;# back-and-forth along a flat floor in the background of certain hill levels (e.g. Welcome
;# To Monkey World, Touch Fuzzy Get Dizzy backdrop). On Init it converts BG1-relative spawn
;# coordinates into BG2-relative coordinates (so its world-position tracks the slower BG2
;# parallax layer); on Main it walks +/-32 pixels then turns around, flipping animation frame
;# every 8 frames.
;#
;# Emit sites (only ONE compiles per build, version-gated by !ROM_YI_U2):
;#   yi/Banks/Bank00.asm:1238    %ROUTINE_YI_NorSpr0AA_BackgroundShyguy($0086E9) -- V1.0 (Init at $00:86E9, Main at $00:872A)
;#   yi/Banks/Bank0F.asm:2688    %ROUTINE_YI_NorSpr0AA_BackgroundShyguy($0F9435) -- V1.1
;#
;# Cross-references:
;#   docs/spritestateengine.md                            -- sprite engine architecture
;#       (sprite ID space and the per-sprite Init/Main pointer-table convention).
;#   yoshisisland-disassembly/disassembly/bank00.asm:934..1011
;#                                                        -- Raidenthequick V1.0 names `init_background_shyguy`
;#                                                           and `main_background_shyguy`.
;#   yoshisisland-disassembly/docs/named_main_labels.txt  -- index entry "init_background_shyguy / main_background_shyguy".
;#
;# Memory map:
;#   $70E2,x   s_spr_x_pixel_pos        -- world-X (gets re-anchored to BG2 in Init)
;#   $7182,x   s_spr_y_pixel_pos        -- world-Y
;#   $7400,x   s_spr_facing_dir         -- 0 or 2; used to look up XSpeed in DATA_shyguy_walk_speed_table
;#   $7402,x   s_spr_anim_frame         -- 0/1 walk cycle
;#   $74A1,x   s_spr_bg_layer           -- BG plane (0 = BG1, 2 = BG2, 3 = BG3); incremented twice => BG2
;#   $7A98,x   s_spr_timer_2            -- 8-frame anim cadence timer
;#   $7AF6,x   s_spr_timer_3            -- random 0x30..0x4F turnaround timer
;#   $0073     r_cam_moving_dir_x       -- camera X-movement flag (nonzero => despawn this frame)
;#   !EXRAM_YI_Level_NorSpr_GenericTable701900/2,x -- wildcard_1_lo / wildcard_2_lo (BG2-anchored ref X/Y)
;#   !EXRAM_YI_Level_NorSpr_XSpeedLo,x  -- signed walk velocity (-$0020 or +$0020 from DATA_shyguy_walk_speed_table)
;#   !RAM_YI_Global_Layer1XPosLo/YPosLo -- BG1 camera origin
;#   !RAM_YI_Global_Layer2XPosLo/YPosLo -- BG2 camera origin (the parallax layer he lives on)
;#############################################################################################################
macro ROUTINE_YI_NorSpr0AA_BackgroundShyguy(Address)
namespace YI_NorSpr0AA_BackgroundShyguy
%InsertMacroAtXPosition(<Address>)

;-------------------------------------------------------------------------
; Init -- run once on sprite spawn.
; Raidenthequick: `init_background_shyguy` at $00:86E9.
; If the camera is mid-scroll on spawn (r_cam_moving_dir_x != 0), bail out
; with a despawn -- otherwise re-project the spawn X/Y from BG1-space into
; BG2-space (so the sprite floats with the slower parallax layer) and bump
; s_spr_bg_layer by 2 (0 -> 2 = BG2 plane).
;-------------------------------------------------------------------------
Init:
init_background_shyguy:           ; Raidenthequick: init_background_shyguy
	LDY.w $0073                   ; r_cam_moving_dir_x
	BEQ.b CODE_0086F2             ; camera idle: do the BG2 re-anchor
	JML.l CODE_03A31E             ; camera moving: despawn immediately (avoid pop-in glitch)

CODE_0086F2:
	LDA.w $70E2,x                 ; \ X-coordinate re-anchor:
	SEC                           ;  | newX = spawnX - BG1cam + BG2cam
	SBC.w !RAM_YI_Global_Layer1XPosLo ;  | (re-projects from BG1 space to BG2 space)
	CLC                           ;  |
	ADC.w !RAM_YI_Global_Layer2XPosLo ;  /
	STA.w $70E2,x                 ; store back as sprite world-X
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x ; remember as wildcard_1 (turn-around anchor)
	LDA.w $7182,x                 ; \ Y-coordinate re-anchor (same idea as X):
	CLC                           ;  | (+8 bias, then align to 8-pixel grid, then +10)
	ADC.w #$0008                  ;  |   used to snap the sprite to a row boundary on BG2
	SEC                           ;  |
	SBC.w !RAM_YI_Global_Layer1YPosLo ;  |
	CLC                           ;  |
	ADC.w !RAM_YI_Global_Layer2YPosLo ;  |
	AND.w #$FFF8                  ;  | align down to multiple of 8
	CLC                           ;  |
	ADC.w #$000A                  ;  / + 10 -> final row Y
	STA.w $7182,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x ; remember as wildcard_2
	INC.w $74A1,x                 ; \ s_spr_bg_layer: 0 (BG1) -> 1 -> 2 (BG2)
	INC.w $74A1,x                 ; / two INCs because the field is a layer-stride count, not a bitfield
	RTL

;-------------------------------------------------------------------------
; DATA_shyguy_walk_speed_table -- two-entry walk-speed table indexed by facing_dir / 2.
;   Y=0: -$0020 (walk left)        Y=2: +$0020 (walk right)
; Raidenthequick stores this as `db $E0,$FF,$20,$00` (same 4 bytes, little-endian).
;-------------------------------------------------------------------------
DATA_008726:
DATA_shyguy_walk_speed_table:          ; descriptive alias
	dw $FFE0,$0020

;-------------------------------------------------------------------------
; Main -- run every frame.
; Raidenthequick: `main_background_shyguy` at $00:872A.
; Each frame:
;   1) Run common BG2-sprite update (CODE_03AF23) + cull check (CODE_03A2C7).
;   2) If sprite has wandered more than 32 pixels from its spawn-X anchor, OR
;      its turn-around timer hit 0, pick a new random turn-around delay and
;      flip facing direction.
;   3) Set X-velocity from the (new) facing direction.
;   4) Every 8 frames, flip anim frame between 0 and 1 (two-frame walk cycle).
;-------------------------------------------------------------------------
Main:
main_background_shyguy:           ; Raidenthequick: main_background_shyguy
	JSL.l CODE_03AF23             ; standard background-sprite frame advance
	JSL.l CODE_03A2C7             ; cull check: returns carry-clear = on-screen
	BCC.b CODE_008738             ; on screen -- continue
	JML.l CODE_despawn_sprite_free_slot             ; off screen -- despawn (CODE_despawn_sprite_free_slot)

CODE_008738:
	LDA.w $7400,x                 ; facing_dir
	DEC                           ; \ DEC to compare-sign trick:
	STA.b $00                     ; / store (facing - 1) as direction "sign" probe ($00)
	LDA.w $70E2,x                 ; \ wandering distance test:
	SEC                           ;  | dx = currentX - spawnAnchorX
	SBC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x ;  |
	CLC                           ;  |
	ADC.w #$0020                  ;  | offset by +32 so [-32..+32] maps to [0..63]
	CMP.w #$0040                  ;  /
	BCC.b CODE_008767             ; within +/- 32px of anchor -- no turnaround
	EOR.b $00                     ; \ moving AWAY from anchor (sign(dx) matches direction)?
	BMI.b CODE_008767             ; / if signs match (BMI), keep walking; else turn around
CODE_008752:
	LDA.b $10                     ; \ pick new turn-around delay:
	AND.w #$001F                  ;  | (frame counter low) & 0x1F  -- random 0..31
	CLC                           ;  |
	ADC.w #$0030                  ;  | + 0x30  -> 0x30..0x4F frames
	STA.w $7AF6,x                 ; / store as timer_3
	LDA.w $7400,x                 ; \ flip facing_dir:
	EOR.w #$0002                  ;  | 0 <-> 2 (the only valid values)
	STA.w $7400,x                 ; /
CODE_008767:
	LDY.w $7AF6,x                 ; turn-around timer
	BEQ.b CODE_008752             ; expired -- pick new random delay + flip (re-enter above)
	LDY.w $7400,x                 ; facing_dir as index (0 or 2)
	LDA.w DATA_shyguy_walk_speed_table,y           ; lookup signed X-speed in table
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDY.w $7A98,x                 ; anim cadence timer
	BNE.b CODE_008789             ; not expired -- skip frame flip
	LDA.w #$0008                  ; \ restart 8-frame timer
	STA.w $7A98,x                 ; /
	LDA.w $7402,x                 ; \ toggle anim_frame between 0 and 1
	EOR.w #$0001                  ;  | (two-frame walk cycle)
	STA.w $7402,x                 ; /
CODE_008789:
	RTL

namespace off
endmacro
