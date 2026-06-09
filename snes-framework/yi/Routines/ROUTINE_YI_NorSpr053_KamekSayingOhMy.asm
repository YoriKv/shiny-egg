;#############################################################################################################
;# ROUTINE_YI_NorSpr053_KamekSayingOhMy.asm
;#
;# Init/Main handlers for normal sprite ID $053 -- "Kamek saying Oh My". This is the
;# cutscene Kamek that appears on the world map and inside select stages (notably the
;# end-of-level Bowser arena intro) to deliver his "OH MY!" line before the camera locks
;# and the message box pops up. The sprite drives a 4-state per-frame state machine and
;# triggers the !RAM_YI_Level_MessageBoxState handshake when the line completes.
;#
;# Emit sites (only ONE compiles per build, version-gated by !ROM_YI_U2):
;#   yi/Banks/Bank00.asm:1237    %ROUTINE_YI_NorSpr053_KamekSayingOhMy($0085DC) -- V1.0 (Init at $00:85DC, Main at $00:85E5)
;#   yi/Banks/Bank0F.asm:2687    %ROUTINE_YI_NorSpr053_KamekSayingOhMy($0F9328) -- V1.1
;#
;# Cross-references:
;#   docs/spritestateengine.md                            -- sprite engine architecture
;#       (sprite ID space and the per-sprite Init/Main pointer-table convention).
;#   yoshisisland-disassembly/disassembly/bank00.asm:792..932
;#                                                        -- Raidenthequick V1.0 names `init_kamek_OH_MY`
;#                                                           and `main_kamek_OH_MY`.
;#   yoshisisland-disassembly/docs/named_main_labels.txt  -- index entry "init_kamek_OH_MY / main_kamek_OH_MY".
;#
;# State machine ($76,x = state index, 0..3):
;#   0 -- CODE_kamek_oh_my_state_0_wait_camera: hold position until X-speed turns negative (camera scrolled past
;#                     spawn). When it does, zero motion, set anim frame 2, start timer.
;#   1 -- CODE_kamek_oh_my_state_1_blink_talk: idle blink/talk. After timer expires, advance frame; on frame 4,
;#                     queue sound $5B (Kamek talk) + spawn message-box state.
;#   2 -- CODE_kamek_oh_my_state_2_await_msgbox: wait for message-box state to clear, then accelerate left.
;#   3 -- CODE_kamek_oh_my_state_3_fly_despawn: in-flight. Pick anim frame based on speed, fly off-screen, then
;#                     despawn (JML to CODE_03A31E).
;-------------------------------------------------------------------------
;# Memory map (s_spr_* notation from Raidenthequick):
;#   $76,x   wildcard_5_lo_dp  -- state index (0..3); doubles as DATA_kamek_oh_my_state_table jump-table index
;#   $78,x   wildcard_6_lo_dp  -- spawn-X reference / camera-X anchor
;#   $7402,x s_spr_anim_frame  -- current animation frame
;#   $7400,x s_spr_facing_dir  -- 2 when flying right (state 3)
;#   $7540,x s_spr_x_accel     -- per-frame X acceleration
;#   $75E0,x s_spr_x_accel_ceiling -- terminal X speed
;#   $7680,x s_spr_cam_x_pos   -- screen-space X (used to detect off-screen)
;#   $7A96,x s_spr_timer_1     -- talk-blink timer
;#   $7A98,x s_spr_timer_2     -- general timer (frame hold)
;#   !EXRAM_YI_Level_NorSpr_XSpeedLo,x  -- signed X velocity
;#   !RAM_YI_Level_MessageBoxState      -- engine handshake: nonzero = box visible
;#   !RAM_YI_Global_Layer1XPosLo        -- BG1 camera X
;#############################################################################################################
macro ROUTINE_YI_NorSpr053_KamekSayingOhMy(Address)
namespace YI_NorSpr053_KamekSayingOhMy
%InsertMacroAtXPosition(<Address>)

;-------------------------------------------------------------------------
; Init -- run once on sprite spawn. Nothing to set up (Kamek inherits his
; placement and state-0 from the level-data spawn record).
; Raidenthequick: `init_kamek_OH_MY` at $00:85DC.
;-------------------------------------------------------------------------
Init:
init_kamek_OH_MY:                 ; Raidenthequick: init_kamek_OH_MY
	RTL

;-------------------------------------------------------------------------
; DATA_kamek_oh_my_state_table -- state-dispatch table. Indexed via ($76,x)*2 by Main below.
; Each word is the address of one state handler (CODE_kamek_oh_my_state_0_wait_camera..CODE_kamek_oh_my_state_3_fly_despawn).
;-------------------------------------------------------------------------
DATA_0085DD:
DATA_kamek_oh_my_state_table:          ; descriptive alias
	dw CODE_kamek_oh_my_state_0_wait_camera                ; state 0 -- wait for camera, start talking
	dw CODE_kamek_oh_my_state_1_blink_talk                ; state 1 -- blink/talk anim, then queue sound + msgbox
	dw CODE_kamek_oh_my_state_2_await_msgbox                ; state 2 -- wait for msgbox close, then launch
	dw CODE_kamek_oh_my_state_3_fly_despawn                ; state 3 -- fly off, despawn when off-screen

;-------------------------------------------------------------------------
; Main -- run every frame. Pins camera (sets auto-scroll active), then dispatches
; to one of four state handlers via DATA_kamek_oh_my_state_table.
; Raidenthequick: `main_kamek_OH_MY` at $00:85E5.
;-------------------------------------------------------------------------
Main:
main_kamek_OH_MY:                 ; Raidenthequick: main_kamek_OH_MY
	LDY.b #$01                    ; \ force auto-scroll-X active = 1
	STY.w $0C1E                   ; / (camera locks while Kamek is talking)
	LDA.b $78,x                   ; spawn-X anchor
	SEC
	SBC.w !RAM_YI_Global_Layer1XPosLo ; distance camera has scrolled past anchor
	CMP.w #$00F0                  ; less than 240px past anchor?
	BMI.b CODE_0085F8             ; yes -- don't advance camera
	INC.w !RAM_YI_Global_Layer1XPosLo ; no  -- push BG1 camera right by 1 per frame
CODE_0085F8:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23                   ; mirror to autoscroll-target X
	TXY                           ; preserve sprite-slot X in Y for the state handler
	LDA.b $76,x                   ; state index
	ASL                           ; *2 for word table
	TAX                           ; X = table offset
	JSR.w (DATA_kamek_oh_my_state_table,x)         ; dispatch to one of the 4 state handlers
	RTL

;-------------------------------------------------------------------------
; CODE_kamek_oh_my_state_0_wait_camera -- STATE 0: wait for camera. When X-speed turns negative (camera
; has scrolled past Kamek's spawn so he'd appear off to the right), freeze
; motion, set the "ready to talk" animation and the 32-frame ($20) initial
; idle timer, then advance to state 1.
;-------------------------------------------------------------------------
CODE_008607:
CODE_kamek_oh_my_state_0_wait_camera:  ; STATE 0: hold until camera scrolls past spawn, then queue talk
	TYX                           ; restore X = sprite slot
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_008622             ; speed still positive? handle blink/talk loop
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0002
	STA.w $7402,x
	LDA.w #$0020
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_008622:
	CMP.w #$FF00
	BMI.b CODE_00862C
	LDA.w #$0005
	BRA.b CODE_00863D

CODE_00862C:
	LDA.w $7A98,x
	BNE.b CODE_008640
	LDA.w #$0002
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
CODE_00863D:
	STA.w $7402,x
CODE_008640:
	RTS

;-------------------------------------------------------------------------
; CODE_kamek_oh_my_state_1_blink_talk -- STATE 1: blinking-eye-while-quiet loop, then "OH MY!" trigger.
; Wait until BOTH timers are zero, then increment anim frame. On the 4th
; increment (frame == 4), queue the !Define_YI_SoundID5B_KamekTalk SFX,
; signal the message-box layer, and advance to state 2.
;-------------------------------------------------------------------------
CODE_008641:
CODE_kamek_oh_my_state_1_blink_talk:   ; STATE 1: blink/talk loop, on frame 4 push OH MY sound + msgbox
	TYX                           ; restore X = sprite slot
	LDA.w $7A96,x                 ; \ timer_1 OR timer_2 nonzero?
	ORA.w $7A98,x                 ; /
	BNE.b CODE_00866F             ; yes -- still waiting, RTS
	INC.w $7402,x                 ; bump animation frame
	LDA.w $7402,x
	CMP.w #$0004                  ; reached frame 4 (peak of "OH MY")?
	BNE.b CODE_008669             ; not yet -- restart timer_2 and exit
	LDA.w #!Define_YI_SoundID5B_KamekTalk
	JSL.l CODE_push_sound_queue             ; push sound onto sound queue (CODE_push_sound_queue)
	LDA.w #$0082
	STA.l $704070                 ; trigger message-box ID $82 (the OH MY text)
	INC.w !RAM_YI_Level_MessageBoxState ; engine handshake: 0 -> 1 = box visible
	INC.b $76,x                   ; advance to state 2
	RTS

CODE_008669:
	LDA.w #$0008
	STA.w $7A98,x
CODE_00866F:
	RTS

;-------------------------------------------------------------------------
; CODE_kamek_oh_my_state_2_await_msgbox -- STATE 2: wait for the player to dismiss the message box,
; then launch leftward (Kamek vanishes off-screen). Sets X-speed = $FC00
; (signed -$0400 LE = ~-4 pixels/frame), acceleration $0040, ceiling $0400.
;-------------------------------------------------------------------------
CODE_008670:
CODE_kamek_oh_my_state_2_await_msgbox: ; STATE 2: wait for player to dismiss msgbox, then launch leftward
	TYX                           ; restore X = sprite slot
	LDA.w !RAM_YI_Level_MessageBoxState
	BNE.b CODE_008690             ; box still up -- RTS
	LDA.w #$0002
	STA.w $7402,x                 ; idle anim frame for liftoff
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x ; initial leftward velocity
	LDA.w #$0040
	STA.w $7540,x                 ; x acceleration
	LDA.w #$0400
	STA.w $75E0,x                 ; terminal-velocity ceiling
	INC.b $76,x                   ; advance to state 3
CODE_008690:
	RTS

;-------------------------------------------------------------------------
; CODE_kamek_oh_my_state_3_fly_despawn -- STATE 3: flight + despawn. Pick anim frame from current
; speed (slow/medium/fast => $0006/$0005/$0002). When sprite has flown past
; X = $0140 (off-screen-right margin), despawn via JML CODE_03A31E.
;-------------------------------------------------------------------------
CODE_008691:
CODE_kamek_oh_my_state_3_fly_despawn:  ; STATE 3: pick anim frame from current speed, despawn off-screen
	TYX                           ; restore X = sprite slot
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_0086A3             ; speed >= $0080? medium/fast branch
	LDA.w #$0006                  ; slow -- frame 6
	BRA.b CODE_0086B4

CODE_0086A3:
	CLC
	ADC.w #$0080
	CMP.w #$0200
	BCS.b CODE_0086B1
	LDA.w #$0005
	BRA.b CODE_0086B4

CODE_0086B1:
	LDA.w #$0002
CODE_0086B4:
	STA.w $7402,x
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_0086C2
	LDA.w #$0002
	STA.w $7400,x
CODE_0086C2:
	LDA.w $7680,x                 ; screen-space X
	CMP.w #$0140                  ; past right margin?
	BMI.b CODE_008690             ; not yet -- RTS (still on screen)
	LDX.w $108A                   ; \ Kamek-aux-slot pointer
	LDA.w $70E2,x                 ;  | grab his pixel position
	STA.b $00                     ;  | (X = lo word)
	LDA.w $7182,x                 ;  |
	STA.b $02                     ; / (Y)
	JSL.l CODE_02E1A3             ; spawn poof-of-smoke effect at saved location
                                  ; SMWC tweak target: the JSL operand's low byte
                                  ; emits at cart $00:86D8 (default $A3). Change to
                                  ; $9C -> JSL $02:E19C (immediate RTL stub) skips the
                                  ; key-scene ending of Naval Piranha when the player
                                  ; uses the "OH MY!" trick. Verified cart byte: $A3.
	LDX.w $108A                   ; reload aux-slot index
	JSL.l CODE_03A31E             ; despawn the aux Kamek instance (CODE_despawn_sprite_stage_ID)
	LDX.b $12                     ; restore original X = our sprite slot
	PLA                           ; pop caller return (we tail-call)
	JML.l CODE_03A31E             ; tail-despawn ourselves
namespace off
endmacro
