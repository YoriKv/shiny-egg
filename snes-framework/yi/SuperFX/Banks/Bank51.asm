;#############################################################################################################
;# yi/SuperFX/Banks/Bank51.asm -- SuperFX data bank $51 ($51:0000-$51:FFFF, 64 KB).
;#
;# This bank is almost entirely message-system TEXT DATA -- pointer tables plus
;# the message strings themselves. (The font glyph *bitmaps* are NOT here; they
;# live in the GSU program as a fixed 12-byte-per-character table.) The first
;# ~50 lines below catalog the non-ASCII glyph *codes* used inline in the text
;# (European accented letters, controller button icons, arrow glyphs, etc.).
;#
;# Per !FXBank51 in yi/SuperFX/BankDefines.asm: in USA V1.1 builds, FXBank51 =
;# $510000 (this file lives at the bank start); in V1.0 builds, FXBank51 starts
;# at $5110DB (the data is shifted up by 4315 bytes). This is one of the few
;# per-version positional differences in the SuperFX banks.
;#
;# Contents at a glance:
;#   $51:0000 / $51:10DB             -- DATA_message_box_text_ptrs: message-ID -> 16-bit
;#                                      pointer table for the cinematic message-box /
;#                                      tutorial text system. Consumed by FXCODE_09B03E
;#                                      via CODE_show_message_box. (NOT glyph bitmaps.)
;#                                      See docs/mchip.md section 3.18 for the full
;#                                      stream format + control-code table.
;#   $51:1333+                       -- Intro-cutscene + message-box TEXT STRINGS,
;#                                      authored via `table "Tables/Fonts/Main.txt"` +
;#                                      `db "..."` lines (asar encodes to the YI font
;#                                      byte codes shown in the glyph table above).
;#                                      Visible from the 65816 at LoROM addresses
;#                                      $22:9333+ (Yoshi's intro paradise speech),
;#                                      $22:9825 (Hovering Jump tutorial),
;#                                      $22:98C7 (Making Eggs tutorial),
;#                                      $22:C20B (Try this stage again? prompt),
;#                                      $22:C248 (Restart from middle ring? prompt).
;#                                      Search this file for the `DATA_msg_*` /
;#                                      `DATA_msg_minigame_*` aliases for the exact
;#                                      English source strings.
;#
;# See also:
;#   chip/ys_chip0.asm through chip/ys_chip7.asm  -- chip program files; font glyph data
;#                                                   here is consumed by the message system
;#
;# Cross-references:
;#   yi/SuperFX/BankDefines.asm                            -- per-version FXBank51 base
;#############################################################################################################

%SuperFXBankStart(!FXBank51)

; Note: Unmapped Font characters:
; $00 = a, with grave accent
; $01 = a, with acute accent
; $02 = c, with cedille accent
; $03 = e, with grave accent
; $04 = e, with acute accent
; $05 = e, with circumflex accent
; $06 = i, with circumflex accent
; $07 = o, with circumflex accent
; $08 = u, with grave accent
; $09 = u, with circumflex accent
; $10 = a, with umlaut accent
; $11 = o, with umlaut accent
; $12 = u, with umlaut accent
; $13 = Sharp S/Double S (It looks more like a B)
; $14 = A, with umlaut accent
; $15 = O, with umlaut accent
; $16 = U, with umlaut accent
; $18-$19 = Piece of A Button Icon
; $1A-$1B = Piece of B Button Icon
; $1C-$1D = Piece of Y Button Icon
; $1E-$1F = Piece of X Button Icon
; $20-$22 = Piece of Select Button Icon
; $23-$25 = Piece of L Button Icon
; $28-$2A = Piece of R Button Icon
; $2C = Up arrow outline
; $2D = Left arrow
; $2E = Right arrow
; $2F = Up arrow
; $30 = Down arrow
; $31-$33 = Piece of Start Button Icon
; $34-$35 = Piece of Cloud arrow Icon
; $37 = Comma
; $38 = e
; $39 = i
; $3A = t
; $3B = r
; $3C = h
; $3D = f
; $3E = n
; $3F = Period?
; $40 = A, with grave accent
; $41 = A, with circumflex accent
; $42 = C, with cedille accent
; $43 = E, with grave accent
; $44 = E, with acute accent
; $45 = E, with circumflex accent
; $46 = I, with circumflex accent
; $47 = O, with circumflex accent
; $48 = U, with acute accent
; $49 = U, with grave accent
; $4A = I, with umlaut accent
; $4B = i, with umlaut accent
; $C4 = Upper left Japanese quotation mark
; $C5 = Lower right Japanese quotation mark
; $C8 = Comma?
; $CA-$CB = Piece of D-pad icon
; $CC = 3 dots?
; $CD = small circle
; $D1 = Left quotation marks
; $D2 = Right quotation marks
; $D3 = Dot
; $D4 = Right Cursor
; $D5-$D6 = Mini Yoshi
; $D7 = x
; $F2 = Left Cursor
; $F4-$F5 = ? Cloud
; $F6-$F7 = Star
; $F8-$F9 = ! Switch
; $FA = Down Arrow
; $XXFF = Control codes

table "Tables/Fonts/Main.txt"

DATA_5110DB:
DATA_message_box_text_ptrs:              ; message-ID -> message-text pointer (consumed by FXCODE_09B03E via CODE_show_message_box; see docs/mchip.md 3.18)
;@editable:message-box-text-ptrs begin
; message-ID (slot index, 0-based) -> message-body label. 300 fixed-size slots;
; the Shiny Egg editor repoints each `dw <body>`, never adds/removes slots.
; `dw $0000` = null slot (no message). Format-preserving: only changed slots are
; re-emitted on save (see scripts/strings.ts parseMessagePtrTable).
	dw DATA_msg_tutorial_making_eggs
	dw DATA_msg_tutorial_throwing_eggs_tap
	dw DATA_511D15
	dw DATA_msg_tutorial_chomp_rock
	dw DATA_511E96
	dw DATA_511F64
	dw DATA_51203B
	dw DATA_message_box_empty
	dw DATA_msg_tutorial_pound_the_ground
	dw DATA_5121A2
	dw DATA_512256
	dw DATA_512256
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_512256
	dw DATA_512256
	dw DATA_512316
	dw DATA_512316
	dw DATA_512316
	dw DATA_5123C0
	dw DATA_512409
	dw DATA_msg_tutorial_pound_the_ground
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_512456
	dw DATA_51249E
	dw DATA_51249E
	dw DATA_51249E
	dw DATA_51203B
	dw DATA_msg_prompt_try_stage_again
	dw DATA_msg_intro_paradise
	dw DATA_msg_intro_baby_bond
	dw DATA_5133AE
	dw DATA_msg_intro_countdown_timer
	dw DATA_51335D
	dw DATA_513CE0
	dw DATA_msg_minigame_flip_cards
	dw DATA_msg_exit
	dw DATA_msg_tutorial_making_eggs
	dw DATA_msg_tutorial_making_eggs
	dw DATA_513D2B
	dw DATA_msg_tutorial_special_flower
	dw DATA_msg_prompt_restart_from_ring
	dw DATA_msg_tutorial_hovering_jump
	dw DATA_5124EB
	dw DATA_5124EB
	dw DATA_5125F7
	dw DATA_5126A0
	dw DATA_5126A0
	dw DATA_5126F5
	dw DATA_5127C7
	dw DATA_512806
	dw DATA_5128DC
	dw DATA_512918
	dw DATA_512918
	dw DATA_512958
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_51299A
	dw DATA_51299A
	dw DATA_512A3A
	dw DATA_512A3A
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_512A3A
	dw DATA_512A3A
	dw DATA_512A83
	dw DATA_512A83
	dw DATA_512A83
	dw DATA_512B3A
	dw DATA_512BE5
	dw DATA_512BE5
	dw DATA_513464
	dw DATA_513524
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_msg_minigame_scratch_and_match
	dw DATA_msg_exit
	dw DATA_5124EB
	dw DATA_5124EB
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_512BE5
	dw DATA_512BE5
	dw DATA_512CB0
	dw DATA_512CB0
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_512CB0
	dw DATA_512D47
	dw DATA_512E14
	dw DATA_512ED5
	dw DATA_5135EA
	dw DATA_513635
	dw DATA_51367F
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_msg_minigame_slot_machine
	dw DATA_msg_exit
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_512ED5
	dw DATA_5126F5
	dw DATA_512ED5
	dw DATA_512ED5
	dw DATA_512ED5
	dw DATA_512FB6
	dw DATA_512FB6
	dw DATA_512FB6
	dw DATA_512FB6
	dw DATA_513082
	dw DATA_513082
	dw DATA_513082
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_513082
	dw DATA_5130D0
	dw DATA_5130D0
	dw DATA_5130D0
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_513694
	dw DATA_5136DD
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_msg_minigame_roulette
	dw DATA_msg_exit
	dw DATA_512ED5
	dw DATA_512ED5
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_5130D0
	dw DATA_51311F
	dw DATA_51311F
	dw DATA_51311F
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_51311F
	dw DATA_513250
	dw DATA_513250
	dw DATA_513250
	dw DATA_513250
	dw DATA_5132F8
	dw DATA_5132F8
	dw DATA_5132F8
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_5132F8
	dw DATA_513342
	dw DATA_513342
	dw DATA_513342
	dw DATA_51372B
	dw DATA_5137B9
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_msg_minigame_drawing_lots
	dw DATA_msg_exit
	dw DATA_5130D0
	dw DATA_5130D0
	dw $0000
	dw $0000
	dw $0000
	dw $0000
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_513342
	dw DATA_51335D
	dw DATA_51335D
	dw DATA_51335D
	dw DATA_513879
	dw DATA_513936
	dw DATA_513980
	dw DATA_5139C2
	dw DATA_513A05
	dw DATA_513B10
	dw DATA_513BD2
	dw $0000
	dw DATA_msg_minigame_match_cards
	dw DATA_msg_exit
	dw DATA_message_box_empty
	dw DATA_message_box_empty
	dw DATA_msg_tutorial_throwing_eggs_hold
	dw $0000
	dw $0000
	dw $0000
	dw DATA_msg_minigame_throwing_balloons
	dw DATA_msg_minigame_throwing_balloons
	dw DATA_msg_minigame_throwing_balloons
	dw DATA_msg_prompt_try_stage_again
	dw DATA_msg_minigame_gather_coins
	dw DATA_msg_minigame_popping_balloons
	dw DATA_msg_minigame_popping_balloons
	dw DATA_msg_prompt_try_stage_again
	dw DATA_msg_prompt_try_stage_again
	dw DATA_msg_minigame_watermelon_seed
	dw DATA_msg_minigame_watermelon_seed
	dw DATA_msg_minigame_throwing_balloons
;@editable:message-box-text-ptrs end

;@editable:message-box-text begin
; Intro-cutscene + message-box / prompt TEXT STRINGS, edited by the Shiny Egg
; string editor. Interleaved with glyph-bitmap payloads (raw db bytes) which the
; editor skips — only quoted `"..."` text is mutable. Each line is
; `dw $XXFF : db "text"` with optional inline glyph bytes ($F6,$F7,$D4,…) that
; are preserved. Messages are pointer-referenced (DATA_5110DB) so they relocate
; freely; total text bytes must not grow past the original (shared bank budget,
; enforced by the editor).
DATA_511333:
DATA_msg_intro_paradise:                    ; "This paradise is Yoshi's Island..." -- intro cutscene
	dw $05FF : db "This paradise is"
	dw $06FF : db "Yoshi's Island,"
	dw $07FF : db "where all the"
	dw $08FF : db "Yoshies live."
	dw $0EFF : db "They are all in an"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "uproar over the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "baby that fell"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "from the sky."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5113FE:
DATA_msg_intro_baby_bond:                   ; "Wait! The baby seems to know..." -- intro cutscene
	dw $05FF : db "Wait! The baby"
	dw $06FF : db "seems to know"
	dw $07FF : db "where he wants to"
	dw $08FF : db "go ..."
	dw $0EFF : db "The bond between"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the twins informs"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "each of them where"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the other one is."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "The Yoshies decide"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to carry the baby"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to his destination"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "via a relay system",$3F
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Now begins a new"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "adventure for the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Yoshies and baby"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Mario."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5115DD:
DATA_msg_intro_countdown_timer:             ; "If baby Mario falls off..." -- Countdown Timer tutorial
	dw $05FF : db "If baby Mario falls"
	dw $06FF : db "off Yoshi's back,"
	dw $07FF : db "the Countdown"
	dw $08FF : db "Timer will begin."
	dw $0EFF : db "When it reaches 0,"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Kamek's toadies"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "will kidnap baby"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Mario!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "The more Stars ",$F6,$F7
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "you collect, the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "safer you are."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "The Countdown"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Timer will slowly"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "count back up to"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "10."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Complete a stage"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "by passing baby"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Mario to the next"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Yoshi."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_511820:
DATA_msg_tutorial_hovering_jump:            ; "Hovering Jump:" tutorial
	dw $05FF : db "   Hovering Jump:"
	dw $06FF : db "By holding ",$1A,$1B
	dw $07FF : db "down, you can"
	dw $08FF : db "hover in the air"
	dw $0EFF : db "for a short time."
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Make the extra"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "effort!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5118C5:
DATA_msg_tutorial_making_eggs:              ; "Making eggs:" tutorial (uses the $60 inline-graphic demo)
	dw $05FF : db "    Making eggs:"
	dw $60FF : db $00,$00,$00,$80,$30,$00,$10
	dw $0EFF : db "Grab an enemy with"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db $1C,$1D,",then press ",$30
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "on ",$CA,$CB," to make an"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "egg."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Now try throwing"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the egg,"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "press ",$18,$19,"!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5119BC:
DATA_msg_tutorial_throwing_eggs_tap:        ; "Throwing eggs: Press [B] once and..." tutorial
	dw $05FF : db "   Throwing eggs:"
	dw $60FF : db $00,$80,$00,$80,$30,$00,$10
	dw $0EFF : db "Press ",$18,$19," once and"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the aiming cursor"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "will begin to move."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Press ",$18,$19," again to"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "throw the egg!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "When you find ",$F4,$F5
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "hit it with an egg."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Cool stuff will"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "happen! To cancel"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the throw, press"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db $30," on ",$CA,$CB,"."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_511B69:
DATA_msg_tutorial_throwing_eggs_hold:       ; "Throwing eggs: Press and hold [B]..." tutorial
	dw $05FF : db "   Throwing eggs:"
	dw $60FF : db $00,$80,$00,$80,$30,$00,$10
	dw $0EFF : db "Press and hold ",$18,$19
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "and the aiming"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "cursor will begin"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to move."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Release ",$18,$19," to"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "throw the egg!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "When you find ",$F4,$F5
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "hit it with an egg."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Cool stuff will"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "happen! To cancel"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the throw, press"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db $30," on ",$CA,$CB,"."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_511D15:
	dw $05FF : db "In each level,"
	dw $06FF : db "20 red coins are"
	dw $07FF : db "hidden among the"
	dw $08FF : db "yellow ones."
	dw $0EFF : db "They each add 1"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "point to your"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "score."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_511DB5:
DATA_msg_tutorial_chomp_rock:               ; "Chomp Rock is a…" tutorial
	dw $05FF : db "Chomp Rock is a"
	dw $06FF : db "useful object."
	dw $07FF : db "Push it and it will"
	dw $08FF : db "roll, bowling over"
	dw $0EFF : db "your enemies. If it"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "gets stuck, stand"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "on one edge and it"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "will start rolling!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_511E96:
	dw $05FF : db "Press ",$D2,"Start",$D2," to"

	dw $06FF : db "display your"
	dw $07FF : db "score. To use"
	dw $08FF : db "special items, use"
	dw $0EFF : db $2D," and ",$2E," on ",$CA,$CB," to"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "choose an item"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "and press ",$18,$19,"."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "To exit, press ",$1A,$1B,$3F
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_511F64:
	dw $05FF : db "You can morph"
	dw $06FF : db "into a helicopter"
	dw $07FF : db "by touching the"
	dw $08FF : db "helicopter bubble."
	dw $0EFF : db "Touch the Yoshi"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Block in time and"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "baby Mario will be"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "warped to Yoshi."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_51203B:
	dw $05FF : db "Do you remember?"
	dw $06FF : db "Press ",$1C,$1D," and ",$30
	dw $07FF : db "on ",$CA,$CB," to make an"
	dw $08FF : db "egg."
	dw $0EFF : db "Press ",$18,$19," to throw"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "an egg."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5120B7:
DATA_msg_tutorial_pound_the_ground:         ; "Pound The Ground:" tutorial
	dw $05FF : db "Pound The Ground:"
	dw $60FF : db $00,$30,$00,$80,$30,$00,$10
	dw $0EFF : db "Press ",$30," on ",$CA,$CB
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "while in the air."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Yoshi will ",$D2,"Pound"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "The Ground.",$D2," This"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "has many uses,"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "and it rocks!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5121A2:
	dw $05FF : db "There are two"
	dw $06FF : db "Controller"
	dw $07FF : db "Configurations"
	dw $08FF : db "for egg throwing",$3F
	dw $0EFF : db "Would you like to"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "switch?"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "  ",$D4,"No        Yes"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $52FF,$FFFF

DATA_512256:
	dw $05FF : db "There are very"
	dw $06FF : db "dangerous Donut"
	dw $07FF : db "Lifts in this"
	dw $08FF : db "stage."
	dw $0EFF : db "They will fall"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "shortly after you"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "stand on them."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Step lightly!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512316:
	dw $05FF : db "Yellow eggs create"
	dw $06FF : db "coins. Red eggs"
	dw $07FF : db "create 2 Stars ",$F6,$F7,$3F
	dw $08FF : db "Flashing eggs???"
	dw $0EFF : db "Hit an enemy to"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "receive these"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "prizes."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5123C0:
	dw $05FF : db "Morph into the"
	dw $06FF : db "Mole Tank here."
	dw $07FF : db "Dig like mad to"
	dw $08FF : db "find 2 red coins!"
	dw $0FFF,$FFFF

DATA_512409:
	dw $05FF : db "Step on ",$F8,$F9," when"
	dw $06FF : db "you find them."
	dw $07FF : db "Here you will find"
	dw $08FF : db "a secret entrance",$3F
	dw $0FFF,$FFFF

DATA_512456:
	dw $05FF : db "Top Secret - Tell"
	dw $06FF : db "no one. Aim"
	dw $07FF : db "directly at the"
	dw $08FF : db "top right corner!"
	dw $0FFF,$FFFF

DATA_51249E:
	dw $05FF : db "Hit the Block to"
	dw $06FF : db "the right with an"
	dw $07FF : db "egg and some"
	dw $08FF : db "platforms will flip!"
	dw $0FFF,$FFFF

DATA_5124EB:
	dw $05FF : db "First, touch a"
	dw $06FF : db "Super Star and"
	dw $07FF : db "become Powerful"
	dw $08FF : db "Mario!"
	dw $0EFF : db "Hold ",$2D," or ",$2E," on ",$CA,$CB,","
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "you can run up a"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "wall and across"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the ceiling!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Hold ",$1A,$1B," to float!"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Hold ",$1C,$1D," to dash!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5125F7:
	dw $05FF : db "This dog's name is"
	dw $06FF : db $D2,"Poochy.",$D2," He is"
	dw $07FF : db "cute, isn't he?"
	dw $08FF : db "Hitch a ride!"
	dw $0EFF : db "He runs in the"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "direction that"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Yoshi faces."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5126A0:
	dw $05FF : db "Hit ",$34,$35," with an egg"
	dw $06FF : db "and it will fly off"
	dw $07FF : db "in the direction ",$34,$35
	dw $08FF : db "currently points."
	dw $0FFF,$FFFF

DATA_5126F5:
	dw $05FF : db "Touch a Super"
	dw $06FF : db "Star and become"
	dw $07FF : db "Powerful Mario!"
	dw $08FF : db "This is super!!"
	dw $0EFF : db "Dash with ",$1C,$1D,"!"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Float in the air!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Run up a wall!!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "You are invincible!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5127C7:
	dw $05FF : db "      Warning:"
	dw $06FF : db "Only someone small"
	dw $07FF : db "can go on from"
	dw $08FF : db "here."
	dw $0FFF,$FFFF

DATA_512806:
	dw $05FF : db "Throw an enemy or"
	dw $06FF : db "an egg into the"
	dw $07FF : db "tulip to receive"
	dw $08FF : db "some Stars ",$F6,$F7,"."
	dw $0EFF : db "To make it easier,"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "throw upwards by"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "holding ",$2F," on ",$CA,$CB
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "when pressing ",$1C,$1D,"."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5128DC:
	dw $05FF : db "Grab a green"
	dw $06FF : db "watermelon and"
	dw $07FF : db "press ",$1C,$1D," to fire"
	dw $08FF : db "seeds."
	dw $0FFF,$FFFF

DATA_512918:
	dw $05FF : db "These types of"
	dw $06FF : db "walls may be"
	dw $07FF : db "destroyed by"
	dw $08FF : db "throwing eggs."
	dw $0FFF,$FFFF

DATA_512958:
	dw $05FF : db "Morph into the"
	dw $06FF : db "Mole Tank here."
	dw $07FF : db "Dig through the"
	dw $08FF : db "dirt wall!"
	dw $0FFF,$FFFF

DATA_51299A:
	dw $05FF : db "The train can"
	dw $06FF : db "travel along the"
	dw $07FF : db "tracks drawn on"
	dw $08FF : db "the walls!"
	dw $0EFF : db "Accelerate to"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "dodge enemies by"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "using ",$1C,$1D,"."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512A3A:
	dw $05FF : db "Are you a good"
	dw $06FF : db "driver? It is easy!"
	dw $07FF : db "Use ",$1A,$1B," to avoid"
	dw $08FF : db "your enemies."
	dw $0FFF,$FFFF

DATA_512A83:
	dw $05FF : db "Do not touch the"
	dw $06FF : db "thorns. They will"
	dw $07FF : db "knock you out!"
	dw $08FF : db ""
	dw $0EFF : db "You can destroy"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the thorns by"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "hitting them with"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "eggs."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512B3A:
	dw $05FF : db "When throwing,"
	dw $06FF : db "you may stop the"
	dw $07FF : db "aiming cursor by"
	dw $08FF : db "holding ",$23,$24,$25," or ",$28,$29,$2A,$3F
	dw $0EFF : db "This can greatly"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "increase your"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "accuracy."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512BE5:
	dw $05FF : db "We, the Mario team"
	dw $06FF : db "poured our hearts"
	dw $07FF : db "and souls into"
	dw $08FF : db "creating this game"
	dw $0EFF : db "for your"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "entertainment."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "It is full of"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "secrets. Enjoy!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512CB0:
	dw $05FF : db "Try to throw an"
	dw $06FF : db "egg at the arrow,"
	dw $07FF : db "and ..."
	dw $08FF : db "Hello!"
	dw $0EFF : db "You can get the"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "coins placed"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "underneath!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512D47:
	dw $05FF : db "Roses are red,"
	dw $06FF : db "Violets are blue,"
	dw $07FF : db "Never forget,"
	dw $08FF : db "What I say to you."
	dw $0EFF : db "Timing is all,"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "And aim true,"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Measure the angle",$37
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "And win, do!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512E14:
	dw $05FF : db "You can get these"
	dw $06FF : db "coins directly,"
	dw $07FF : db "but let's use an"
	dw $08FF : db "egg!"
	dw $0EFF : db "It will skip on the"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "surface of the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "water to get the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "coins."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512ED5:
	dw $05FF : db "If Yoshi begins to"
	dw $06FF : db "fall after hovering"
	dw $07FF : db "press ",$1A,$1B," again to"
	dw $08FF : db "hover some more."
	dw $0EFF : db "Use this technique"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "and the Magnifying"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Glass to get all 5"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "red coins here."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_512FB6:
	dw $05FF : db "When you jump off"
	dw $06FF : db "one of these"
	dw $07FF : db "platforms, the"
	dw $08FF : db "number shown is"
	dw $0EFF : db "reduced by one."
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "If the number"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "reaches 0, the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "platform vanishes",$3F
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513082:
	dw $05FF : db "This is a Chomp"
	dw $06FF : db "Rock. Roll it as"
	dw $07FF : db "far as you can and"
	dw $08FF : db "see what happens!"
	dw $0FFF,$FFFF

DATA_5130D0:
	dw $05FF : db "Hit this ",$F4,$F5," with an"
	dw $06FF : db "egg and morph into"
	dw $07FF : db "a helicopter."
	dw $08FF : db "Find 5 red coins."
	dw $0FFF,$FFFF

DATA_51311F:
	dw $05FF : db "This is an icy"
	dw $06FF : db "stage. Be careful"
	dw $07FF : db "it is slippery and"
	dw $08FF : db "difficult to walk."
	dw $0EFF : db "Grab a red"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "watermelon and"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "you can breathe"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "fire three times."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Use it to melt ice"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "or attack your"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "enemies."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513250:
	dw $05FF : db "This is Top Secret"
	dw $06FF : db "so LISTEN UP!"
	dw $07FF : db "On the Level"
	dw $08FF : db "Selection screen,"
	dw $0EFF : db "hold ",$20,$21,$22," and press"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db $1E,$1F,", ",$1E,$1F,", ",$1C,$1D,", ",$1A,$1B
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "and ",$18,$19,"!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5132F8:
	dw $05FF : db "You may grab an"
	dw $06FF : db "Arrow Lift and use"
	dw $07FF : db "it at another"
	dw $08FF : db "location. WAY!!!"
	dw $0FFF,$FFFF

DATA_513342:
	dw $05FF,$31FF : db "RUN AWAY," 
	dw $07FF : db "HURRY!!!"
	dw $0FFF,$FFFF

DATA_51335D:
	dw $05FF : db "So you're still on"
	dw $06FF : db "the baby's side,"
	dw $07FF : db "Yoshi-baby? Then"
	dw $08FF : db "get a load of this!"
	dw $0FFF,$FFFF

DATA_5133AE:
	dw $05FF : db "Hi there cute lil'"
	dw $06FF : db "Yoshi! Does baby"
	dw $07FF : db "Mario wanna go to"
	dw $08FF : db "Bowser's Castle?"
	dw $0EFF : db "I'll take him there"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "in a hurry!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Tee, hee, hee ..."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513464:
	dw $05FF : db "Oh yes, we have"
	dw $06FF : db "baby Mario's twin"
	dw $07FF : db "brother at"
	dw $08FF : db "Bowser's Castle,"
	dw $0EFF : db "but we're not"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "handing him over"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to the likes of"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "you!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513524:
	dw $05FF : db "Yoshi-dear, that"
	dw $06FF : db "baby is going to"
	dw $07FF : db "cause disaster to"
	dw $08FF : db "befall the Koopas."
	dw $0EFF : db "So give him here"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "before you"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "accidently get"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "hurt!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5135EA:
	dw $05FF : db "Great job, Yoshi!"
	dw $06FF : db "Now, you will be"
	dw $07FF : db "Froggy's lunch!!"
	dw $08FF : db "Hee, hee, hee!"
	dw $0FFF,$FFFF

DATA_513635:
	dw $05FF : db "Give it up Yoshi,"
	dw $06FF : db "you cutie without"
	dw $07FF : db "a navel! Ooopp-"
	dw $08FF : db "forget it ..."
	dw $0FFF,$FFFF

DATA_51367F:
	dw $06FF,$31FF : db "OH, MY" : dw $35FF,$38FF : db "!!!"
	dw $0FFF,$FFFF

DATA_513694:
	dw $05FF : db "Yoshi! Oh dear ..."
	dw $06FF : db "Well, Marching"
	dw $07FF : db "Milde will pound"
	dw $08FF : db "you to bits!!"
	dw $0FFF,$FFFF

DATA_5136DD:
	dw $05FF : db "Little Koopa come"
	dw $06FF : db "through for me"
	dw $07FF : db "now! Go forth and"
	dw $08FF : db "rock Yoshi's world"
	dw $0FFF,$FFFF

DATA_51372B:
	dw $05FF : db "Aaaaah, Yoshi! To"
	dw $06FF : db "get this far you"
	dw $07FF : db "must be powerful,"
	dw $08FF : db "but remember:"
	dw $0EFF : db "This slug has no"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "weak points!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5137B9:
	dw $05FF : db "You can, ah, will,"
	dw $06FF : db "aaah, never enter"
	dw $07FF : db "the Koopa"
	dw $08FF : db "Kingdom!"
	dw $0EFF : db "I banish you to"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "forever twinkle in"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the heavens,"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "BE GONE!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513879:
	dw $05FF : db "Eeeeek!! How did"
	dw $06FF : db "you? You-- I never"
	dw $07FF : db "expected you to"
	dw $08FF : db "get this far!"
	dw $0EFF : db "EEEEEE!"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Now it's over!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Your game ends"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "HERE!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513936:
	dw $05FF : db "YOU! are n-n-not"
	dw $06FF : db "welcome HERE!!!"
	dw $07FF : db "Yoshi,please hand"
	dw $08FF : db "OVER THE BABY!"
	dw $0FFF,$FFFF

DATA_513980:
	dw $05FF : db "Oh, dear ..."
	dw $06FF : db "What to do ..."
	dw $07FF : db "Young Master"
	dw $08FF : db "Bowser wakes ..."
	dw $0FFF,$FFFF

DATA_5139C2:
	dw $05FF : db "Kamek, it's too"
	dw $06FF : db "noisy in here!!"
	dw $07FF : db "I wanna go"
	dw $08FF : db "sweepy-byyye!!!"
	dw $0FFF,$FFFF

DATA_513A05:
	dw $05FF : db "Huh??"
	dw $06FF : db "Hmm?!!?"
	dw $07FF : db "Mmmmm!!!!?!"
	dw $08FF : db ""
	dw $0EFF : db "What kind of gween"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "donkey is dat?"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Looks wyke fun!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Me wanna ri-ide!!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $08FF,$31FF : db "MINE!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $08FF : db "MINE!!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513B10:
	dw $05FF : db "How dare you?!"
	dw $06FF : db "It's not fair ..."
	dw $07FF : db "You are such a"
	dw $08FF : db "meanie ..."
	dw $0EFF : db "Someday ..."
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "We will be back ..."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "You'll see!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Waaaaaah ..."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513BD2:
	dw $05FF : db "Yoshi, why did you"
	dw $06FF : db "do this???"
	dw $07FF : db "Young Master, let"
	dw $08FF : db "me help you! Here!"
	dw $0FFF,$FFFF

DATA_513C1D:
DATA_msg_tutorial_special_flower:           ; "Special Flower:" tutorial
	dw $05FF : db "  Special Flower:"
	dw $06FF : db "Gather 5 for a"
	dw $07FF : db "1UP! They add to"
	dw $08FF : db "your point total."
	dw $0EFF : db "They also add"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "flowers to the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Goal Ring"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "roulette!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513CE0:
	dw $05FF : db "This is the"
	dw $06FF : db "Middle-Ring for"
	dw $07FF : db "this level. You may"
	dw $08FF : db "continue from here"
	dw $0FFF,$FFFF

DATA_513D2B:
	dw $05FF : db "Grab baby Mario!"
	dw $06FF : db "Jump or even use"
	dw $07FF : db "your tongue to"
	dw $08FF : db "touch him."
	dw $0EFF : db "Throw eggs at him!"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "If the Timer drops"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to 0, he will be"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "kidnapped!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513DF8:
DATA_message_box_empty:                     ; empty message (bare $FFFF) -- every unused/padding message-ID slot points here
	dw $FFFF

DATA_513DFA:
DATA_msg_minigame_throwing_balloons:        ; minigame title card: THROWING BALLOONS
	dw $05FF : db ""
	dw $06FF : db "        THROWING"
	dw $07FF : db "        BALLOONS"
	dw $08FF : db ""
	dw $0EFF : db "To throw the"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "balloon, key in the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "button sequences"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "as shown."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "The game time is"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "limited. If the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "balloon pops on"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "you, then you lose"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db ""
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Collect an item"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "if you win!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_513F84:
DATA_msg_minigame_gather_coins:             ; minigame title card: GATHER COINS
	dw $05FF : db ""
	dw $06FF : db "     GATHER COINS"
	dw $07FF : db ""
	dw $08FF : db ""
	dw $0EFF : db "Grab more coins"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "than your enemy"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "before the time"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "reaches 0."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_514022:
DATA_msg_minigame_popping_balloons:         ; minigame title card: POPPING BALLOONS
	dw $05FF : db ""
	dw $06FF : db "         POPPING"
	dw $07FF : db "        BALLOONS"
	dw $08FF : db ""
	dw $0EFF : db "Pound the ground"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to pop balloons."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Find the correct"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "one to win!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5140D3:
DATA_msg_minigame_watermelon_seed:          ; minigame title card: WATERMELON SEED SPITTING CONTEST
	dw $05FF : db ""
	dw $06FF : db "  WATERMELON SEED"
	dw $07FF : db " SPITTING CONTEST"
	dw $08FF : db ""
	dw $0EFF : db "Grab a watermelon"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "and shoot your"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "enemy as quickly"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "as you can."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Reduce your"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "enemy's power"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "meter to 0"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to win!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5141F8:
DATA_msg_prompt_try_stage_again:            ; "Try this stage again?" Yes/No prompt
	dw $05FF : db "      ",$D5,$D6,$D7 : dw $3DFF,$3EFF,$3FFF
	dw $06FF : db "Try this stage"
	dw $07FF : db "again?"
	dw $08FF : db "  ",$D4,"Yes      No"
	dw $50FF,$FFFF

DATA_514235:
DATA_msg_prompt_restart_from_ring:          ; "Re-start from the middle ring?" Yes/No prompt
	dw $05FF : db "      ",$D5,$D6,$D7 : dw $3DFF,$3EFF,$3FFF
	dw $06FF : db "Re-start from the"
	dw $07FF : db "Middle-Ring?"
	dw $08FF : db "  ",$D4,"Yes      No"
	dw $50FF,$FFFF

DATA_51427B:
DATA_msg_minigame_flip_cards:               ; minigame title card: FLIP CARDS
	dw $05FF : db "      FLIP CARDS"
	dw $06FF : db ""
	dw $07FF : db "     Item Chance!"
	dw $08FF : db ""
	dw $0EFF : db "Aim with the"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "cursor and press"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db $18,$19,". Collect the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "item shown."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "If you get Kamek,"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "you lose all the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "items. Hit ",$D2,"Exit",$D2
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "to quit."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5143AC:
DATA_msg_minigame_scratch_and_match:        ; minigame title card: SCRATCH AND MATCH
	dw $05FF : db "     SCRATCH AND"
	dw $06FF : db "          MATCH"
	dw $07FF : db ""
	dw $08FF : db "    1 UP  Chance!"
	dw $0EFF : db "Scratch 3 boxes!"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Uncover Marios to"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "gain 1 UPs!!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Scratch On!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "3 Toadies - 0 UP"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "1 Mario     - 1 UP"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "2 Marios   - 2 UP"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "3 Marios   - 5 UP"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5144F8:
DATA_msg_minigame_slot_machine:             ; minigame title card: SLOT MACHINE
	dw $05FF : db "     SLOT MACHINE"
	dw $06FF : db ""
	dw $07FF : db "     1 UP  Chance!"
	dw $08FF : db ""
	dw $0EFF : db "A chance to earn"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "extra lives. Press"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db $18,$19," to stop each"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "tumbler!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_5145AA:
DATA_msg_minigame_roulette:                 ; minigame title card: ROULETTE
	dw $05FF : db "         ROULETTE"
	dw $06FF : db ""
	dw $07FF : db "      1 UP Chance!"
	dw $08FF : db ""
	dw $0EFF : db "Set the number of"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Yoshies with ",$CA,$CB,"."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Press ",$18,$19," to start"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "and ",$18,$19," to stop."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "The combination of"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the 2 tumblers and"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "number of Yoshies"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "give you 1 UPs!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "You can not play"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "this game if you"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "have only 1 Yoshi"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "remaining."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_514777:
DATA_msg_minigame_drawing_lots:             ; minigame title card: DRAWING LOTS
	dw $05FF : db "    DRAWING LOTS"
	dw $06FF : db ""
	dw $07FF : db "    Item  Chance!"
	dw $08FF : db ""
	dw $0EFF : db "A chance to gain"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "an item. Flip only"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "1 card. Receive"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "the item shown!"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_51482E:
DATA_msg_minigame_match_cards:              ; minigame title card: MATCH CARDS
	dw $05FF : db "    MATCH  CARDS"
	dw $06FF : db ""
	dw $07FF : db "    Item  Chance!"
	dw $08FF : db ""
	dw $0EFF : db "Flip cards over in"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "pairs. Receive the"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "items shown on"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "matched pairs only"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "Continue flipping"
	dw $0AFF
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "until you have"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "failed to match"
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0EFF : db "twice."
	dw $12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF,$12FF
	dw $0FFF,$FFFF

DATA_514967:
DATA_msg_exit:                              ; "Exit"
	dw $05FF : db ""
	dw $06FF : db " ",$D4," Continue"
	dw $07FF : db "    Exit"
	dw $08FF : db ""
	dw $51FF,$FFFF

DATA_514986:
DATA_msg_prompt_continue:                   ; "Would you like to continue?" Yes/No prompt
	dw $05FF : db "Would you like to"
	dw $06FF : db "continue?"
	dw $07FF : db ""
	dw $08FF : db "    Yes      No"
	dw $0EFF : db $D4
	dw $FFFF
;@editable:message-box-text end

;-------------------------------------------------------------------------
; LEVEL-NAME / STAGE-INTRO STRING POINTER TABLE (72 entries, 144 bytes).
; Indexed by !RAM_YI_Level_CurrentLevelFromMapLo ($00:021A) by
; CODE_render_stage_intro_level_name (set up as R0:R10 to the GSU and consumed by FXCODE_09E92F,
; which streams characters from the chosen string out to BG3 tilemap
; VRAM for the "1-1 Make Eggs, Throw Eggs" stage-intro overlay).
;
; Each string is `db $FF, x_col, <chars> [, $FE, y_off, x_col, <chars>] : db $FD`
; where text uses the YI font encoding from `table "Tables/Fonts/Main.txt"`.
;
; Layout is 12 slots per world × 6 worlds = 72 slots:
;   slot $00..$07   levels N-1..N-8           (8 main levels)
;   slot $08        Extra N                   (the secret level)
;   slot $09..$0B   3 padding slots, all -> DATA_level_name_garbage_sentinel
;                   EXCEPT world 1's slot $0B which holds
;                   DATA_welcome_to_yoshis_island (the world-map splash).
;
; The 21 padding slots are unreachable from normal gameplay -- the world-
; map only sets CurrentLevelFromMapLo to valid level IDs -- so the garbage
; sentinel string at DATA_51532F is never rendered during a normal play.
;-------------------------------------------------------------------------
DATA_5149BC:
DATA_level_name_string_ptrs:                                       ; descriptive alias (consumer: CODE_render_stage_intro_level_name -> FXCODE_09E92F)
	dw DATA_514A73
	dw DATA_514A9E
	dw DATA_514ACA
	dw DATA_514AF8
	dw DATA_514B21
	dw DATA_514B4C
	dw DATA_514B78
	dw DATA_514BA4
	dw DATA_514BCC
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_514A4C
	dw DATA_514BF9
	dw DATA_514C23
	dw DATA_514C47
	dw DATA_514C6C
	dw DATA_514C90
	dw DATA_514CBD
	dw DATA_514CE7
	dw DATA_514D0E
	dw DATA_514D38
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_514D5D
	dw DATA_514D88
	dw DATA_514DB3
	dw DATA_514DDC
	dw DATA_514E04
	dw DATA_514E2A
	dw DATA_514E55
	dw DATA_514E7F
	dw DATA_514EA6
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_514ECD
	dw DATA_514EF5
	dw DATA_514F23
	dw DATA_514F4F
	dw DATA_514F78
	dw DATA_514FA5
	dw DATA_514FD4
	dw DATA_514FFF
	dw DATA_51502C
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_515052
	dw DATA_515067
	dw DATA_515091
	dw DATA_5150BC
	dw DATA_5150E4
	dw DATA_51510A
	dw DATA_515138
	dw DATA_515161
	dw DATA_51518D
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_5151BA
	dw DATA_5151DE
	dw DATA_51520C
	dw DATA_515239
	dw DATA_515264
	dw DATA_51528C
	dw DATA_5152B4
	dw DATA_5152DD
	dw DATA_515304
	dw DATA_51532F
	dw DATA_51532F
	dw DATA_51532F

;@editable:level-name-strings begin
; Level-name display strings (2 centered lines each), edited by the Shiny Egg
; string editor. Bodies are pointer-table-indexed (DATA_5149BC above), so they
; relocate freely; only the text inside the quotes is editor-mutable. The total
; byte size must not grow past its original (fixed asm budget before the GSU
; blob) — the editor enforces this. The garbage sentinel is preserved verbatim.
DATA_514A4C:
DATA_welcome_to_yoshis_island:                                     ; world-1 splash, slotted into level-name-ptrs table at index $0B
	db $FF,$00,"      Welcome To"
	db $FE,$10,$00,"   Yoshi's Island"
	db $FD

DATA_514A73:
	db $FF,$00,"1 - 1:  Make Eggs,"
	db $FE,$10,$00,"         Throw Eggs"
	db $FD

DATA_514A9E:
	db $FF,$00,"1 - 2:   Watch Out"
	db $FE,$10,$00,"              Below!"
	db $FD

DATA_514ACA:
	db $FF,$00,"1 - 3:  The Cave Of"
	db $FE,$10,$00,"          Chomp  Rock"
	db $FD

DATA_514AF8:
	db $FF,$00,"1 - 4:  Burt The"
	db $FE,$10,$00,"     Bashful's Fort"
	db $FD

DATA_514B21:
	db $FF,$00,"1 - 5:   Hop! Hop!"
	db $FE,$10,$00,"        Donut Lifts"
	db $FD

DATA_514B4C:
	db $FF,$00,"1 - 6:   Shy-Guys"
	db $FE,$10,$00,"           On  Stilts"
	db $FD

DATA_514B78:
	db $FF,$00,"1 - 7: Touch Fuzzy"
	db $FE,$10,$00,"           Get Dizzy"
	db $FD

DATA_514BA4:
	db $FF,$00,"1 - 8: Salvo The"
	db $FE,$10,$00,"    Slime's Castle"
	db $FD

DATA_514BCC:
	db $FF,$00,"Extra 1:   Poochy"
	db $FE,$10,$00,"          Ain't Stupid"
	db $FD

DATA_514BF9:
	db $FF,$00,"2 - 1: Visit Koopa"
	db $FE,$10,$00,"    And Para-Koopa"
	db $FD

DATA_514C23:
	db $FF,$00,"2 - 2:    The"
	db $FE,$10,$00,"    Baseball Boys"
	db $FD

DATA_514C47:
	db $FF,$00,"2 - 3:  What's"
	db $FE,$10,$00,"Gusty Taste Like?"
	db $FD

DATA_514C6C:
	db $FF,$00,"2 - 4:  Bigger"
	db $FE,$10,$00,"      Boo's Fort"
	db $FD

DATA_514C90:
	db $FF,$00,"2 - 5:   Watch Out"
	db $FE,$10,$00,"           For Lakitu"
	db $FD

DATA_514CBD:
	db $FF,$00,"2 - 6: The Cave Of"
	db $FE,$10,$00,"  The Mystery Maze"
	db $FD

DATA_514CE7:
	db $FF,$00,"2 - 7:  Lakitu's"
	db $FE,$10,$00,"             Wall"
	db $FD

DATA_514D0E:
	db $FF,$00,"2 - 8: The Potted"
	db $FE,$10,$00,"     Ghost's Castle"
	db $FD

DATA_514D38:
	db $FF,$00,"Extra 2:  Hit"
	db $FE,$10,$00,"     That Switch!!"
	db $FD

DATA_514D5D:
	db $FF,$00,"3 - 1: Welcome To"
	db $FE,$10,$00,"      Monkey  World!"
	db $FD

DATA_514D88:
	db $FF,$00,"3 - 2:     Jungle"
	db $FE,$10,$00,"          Rhythm ..."
	db $FD

DATA_514DB3:
	db $FF,$00,"3 - 3: Nep-Enuts'"
	db $FE,$10,$00,"            Domain"
	db $FD

DATA_514DDC:
	db $FF,$00,"3 - 4:    Prince"
	db $FE,$10,$00,"     Froggy's Fort"
	db $FD

DATA_514E04:
	db $FF,$00,"3 - 5:  Jammin'"
	db $FE,$10,$00,"Through The Trees"
	db $FD

DATA_514E2A:
	db $FF,$00,"3 - 6: The Cave Of"
	db $FE,$10,$00,"     Harry Hedgehog"
	db $FD

DATA_514E55:
	db $FF,$00,"3 - 7:   Monkeys'"
	db $FE,$10,$00,"      Favorite Lake"
	db $FD

DATA_514E7F:
	db $FF,$00,"3 - 8:    Naval"
	db $FE,$10,$00,"  Piranha's Castle"
	db $FD

DATA_514EA6:
	db $FF,$00,"Extra 3:   More"
	db $FE,$10,$00,"    Monkey Madness"
	db $FD

DATA_514ECD:
	db $FF,$00,"4 - 1:       GO!"
	db $FE,$10,$00,"       GO! MARIO!!"
	db $FD

DATA_514EF5:
	db $FF,$00,"4 - 2:  The Cave Of"
	db $FE,$10,$00,"          The Lakitus"
	db $FD

DATA_514F23:
	db $FF,$00,"4 - 3:      Don't"
	db $FE,$10,$00,"          Look  Back!"
	db $FD

DATA_514F4F:
	db $FF,$00,"4 - 4:  Marching"
	db $FE,$10,$00,"       Milde's Fort"
	db $FD

DATA_514F78:
	db $FF,$00,"4 - 5:  Chomp  Rock"
	db $FE,$10,$00,"                Zone"
	db $FD

DATA_514FA5:
	db $FF,$00,"4 - 6:   Lake  Shore"
	db $FE,$10,$00,"             Paradise"
	db $FD

DATA_514FD4:
	db $FF,$00,"4 - 7:   Ride Like"
	db $FE,$10,$00,"           The Wind"
	db $FD

DATA_514FFF:
	db $FF,$00,"4 - 8:  Hookbill The"
	db $FE,$10,$00,"     Koopa's Castle"
	db $FD

DATA_51502C:
	db $FF,$00,"Extra 4:  The"
	db $FE,$10,$00,"   Impossible? Maze"
	db $FD

DATA_515052:
	db $FF,$00,"5 - 1: BLIZZARD!!!"
	db $FD

DATA_515067:
	db $FF,$00,"5 - 2:   Ride The"
	db $FE,$10,$00,"          Ski Lifts"
	db $FD

DATA_515091:
	db $FF,$00,"5 - 3: Danger - Icy"
	db $FE,$10,$00,"  Conditions Ahead"
	db $FD

DATA_5150BC:
	db $FF,$00,"5 - 4: Sluggy The"
	db $FE,$10,$00,"  Unshaven's Fort"
	db $FD

DATA_5150E4:
	db $FF,$00,"5 - 5:   Goonie"
	db $FE,$10,$00,"           Rides!"
	db $FD

DATA_51510A:
	db $FF,$00,"5 - 6:   Welcome To"
	db $FE,$10,$00,"          Cloud World"
	db $FD

DATA_515138:
	db $FF,$00,"5 - 7:   Shifting"
	db $FE,$10,$00,"   Platforms Ahead"
	db $FD

DATA_515161:
	db $FF,$00,"5 - 8:  Raphael The"
	db $FE,$10,$00,"     Raven's Castle"
	db $FD

DATA_51518D:
	db $FF,$00,"Extra 5:  Kamek's"
	db $FE,$10,$00,"               Revenge"
	db $FD

DATA_5151BA:
	db $FF,$00,"6 - 1:  Scary"
	db $FE,$10,$00,"Skeleton Goonies!"
	db $FD

DATA_5151DE:
	db $FF,$00,"6 - 2:  The Cave Of"
	db $FE,$10,$00,"          The Bandits"
	db $FD

DATA_51520C:
	db $FF,$00,"6 - 3:  Beware The"
	db $FE,$10,$00,"        Spinning Logs"
	db $FD

DATA_515239:
	db $FF,$00,"6 - 4: Tap-Tap The"
	db $FE,$10,$00,"    Red Nose's Fort"
	db $FD

DATA_515264:
	db $FF,$00,"6 - 5:  The Very"
	db $FE,$10,$00,"    Loooooong Cave"
	db $FD

DATA_51528C:
	db $FF,$00,"6 - 6:  The Deep,"
	db $FE,$10,$00," Underground Maze"
	db $FD

DATA_5152B4:
	db $FF,$00,"6 - 7:      KEEP"
	db $FE,$10,$00,"         MOVING!!!!"
	db $FD

DATA_5152DD:
	db $FF,$00,"6 - 8:     King"
	db $FE,$10,$00,"   Bowser's Castle"
	db $FD

DATA_515304:
	db $FF,$00,"Extra 6: Castles -"
	db $FE,$10,$00,"    Masterpiece Set"
	db $FD

; Garbage-byte sentinel for the 21 unreachable padding slots in
; DATA_level_name_string_ptrs (3 trailing slots per world × 6 worlds,
; minus the 1 slot world 1 reuses for "Welcome To Yoshi's Island").
; The bytes here aren't valid font encoding -- if the world map ever
; sets CurrentLevelFromMap to a padding slot, the renderer would emit
; random-looking tiles into the BG3 stage-intro overlay. In a normal
; game this string is never reached.
DATA_51532F:
DATA_level_name_garbage_sentinel:                                  ; padding-slot target for unreachable level IDs
	db $FF,$1E,$57,$9A,$61,$C9,$50,$51,$88,$5F,$87
	db $FE,$10,$19,$C4,$00,$20,$41,$0C,$14,$02,$1D,$0F,$C5
	db $FD
;@editable:level-name-strings end

cleartable
%SuperFXBankEnd(!FXBank51)
