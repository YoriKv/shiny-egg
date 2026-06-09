;#############################################################################################################
;# ARAM_Map_YI.asm -- SPC700 sound-engine ARAM ($00:0000-$00:FFFF) memory map.
;#
;# This file documents the ARAM layout used by the YI sound engine at
;# `yi/SPC700/SPC700_Engine_YI.asm`. ARAM is the 64 KB working memory of
;# the S-SMP (Sony SPC700 CPU + S-DSP). The engine + active song + samples
;# all live here; the SNES side fills it via the IPL-ROM upload protocol
;# (see `yi/Banks/Bank50.asm` for `YI_SPCEngine` + the per-bank upload
;# code in `yi/SPC700/*SampleBank.asm`).
;#
;# Region map at a glance:
;#   $0000-$00DF   Engine zero-page (work registers + per-channel state head).
;#   $00E0-$00EF   Reserved (cleared at boot; not used by engine).
;#   $00F0-$00FF   S-SMP hardware regs (TEST/CONTROL/DSPADDR/DSPDATA/CPUIO/TIMER/COUNTER).
;#                 Already defined in global/HardwareRegisters/SPC700.asm; not duplicated here.
;#   $0100-$01FF   Engine stack + page-1 channel state (tremolo accumulator).
;#   $0200-$02FF   Per-channel state table 1 (16 fields x 8 voices x 2 bytes).
;#   $0300-$03FF   Per-channel state table 2 (more per-voice state + engine flags).
;#   $0400-$1FE3   Engine code (the main body of SPC700_Engine_YI.asm).
;#   $1FE4-$202C   Voice-7 instrument-preset table + per-low-nibble instrument LUT.
;#   $3C00-$3CFF   DSP sample directory (BRR start/loop pointers, 4 bytes per entry).
;#   $3D00-$3D41   Voice patch table (66 bytes; format unverified).
;#   $3EBB-$3F89   Sound-command-to-sequence-id remap (207 bytes).
;#   $3FE8-$3FFF   Volume/envelope curve table (24 bytes).
;#   $4000-$FFFF   Song data + BRR samples; hot-swapped per song.
;#                 Layout varies per sample bank (see *SampleBank.asm).
;#
;# Lookup conventions in this file:
;#   !ARAM_SPC_*    SPC engine zero-page work bytes, page-0 ($00-$FF) scratch
;#   !ARAM_SPC_Ch*  Per-channel state (indexed with X = 2*voice; X = 0..$E)
;#   !ARAM_SPC_Tbl* ARAM data tables (instrument patches, curves, etc.)
;#
;# Note: SPC700 engine asm uses bare hex addresses (`MOV $43, A`) for these
;# regions; the defines below are reference/documentation symbols. They are
;# safe to !-eval (asar evaluates them at assembly time, but the SPC700
;# code stream is incbin'd as `.bin` so the defines don't affect emitted
;# bytes).
;#############################################################################################################

;-------------------------------------------------------------------------
; Page 0: engine zero-page work registers ($0000-$00DF).
;-------------------------------------------------------------------------

; $0000-$0003: previously-seen value of SNES->SPC ports 0-3 (echoed back as ACK).
!ARAM_SPC_PortInPrev0 = $0000
!ARAM_SPC_PortInPrev1 = $0001
!ARAM_SPC_PortInPrev2 = $0002
!ARAM_SPC_PortInPrev3 = $0003

; $0004-$0007: current shadow of SNES->SPC ports 0-3 ($04 = music command,
; $05/$06 = SFX low/priority, $07 = volume / aux).
!ARAM_SPC_PortInCurr0 = $0004
!ARAM_SPC_PortInCurr1 = $0005
!ARAM_SPC_PortInCurr2 = $0006
!ARAM_SPC_PortInCurr3 = $0007

; $0008-$000B: last-dispatched snapshot of ports 0-3 (used for edge-detect
; on port 0 music-command mailbox in CODE_spc_port_read_edge).
!ARAM_SPC_PortInLastDispatched0 = $0008
!ARAM_SPC_PortInLastDispatched1 = $0009
!ARAM_SPC_PortInLastDispatched2 = $000A
!ARAM_SPC_PortInLastDispatched3 = $000B

!ARAM_SPC_SongStartCountdown   = $000C
!ARAM_SPC_PitchWorkLo          = $0010
!ARAM_SPC_PitchWorkHi          = $0011
!ARAM_SPC_BitFlagScratch_12    = $0012
!ARAM_SPC_BitFlagScratch_13    = $0013
!ARAM_SPC_DspWriteScratch_14   = $0014
!ARAM_SPC_DspWriteScratch_15   = $0015
!ARAM_SPC_DspWriteScratch_16   = $0016
!ARAM_SPC_DspWriteScratch_17   = $0017
!ARAM_SPC_FadeResidualLo       = $0018
!ARAM_SPC_FadeResidualHi       = $0019
!ARAM_SPC_SfxLockMask          = $001A    ; bitmask of channels currently locked by SFX

!ARAM_SPC_GlobalSeqPtrLo       = $0040
!ARAM_SPC_GlobalSeqPtrHi       = $0041
!ARAM_SPC_GlobalLoopCount      = $0042
!ARAM_SPC_SubTickAccum         = $0043    ; +=  $38 * Y each loop; overflow drives music-tick
!ARAM_SPC_XSave                = $0044
!ARAM_SPC_FlushRequestA        = $0045
!ARAM_SPC_FlushRequestB        = $0046
!ARAM_SPC_CurrentChannelBit    = $0047    ; rotating ($01, $02, ..., $80) inside 8-voice walk
!ARAM_SPC_EngineFlags          = $0048    ; bit-5 = "engine initialized"
!ARAM_SPC_DspKonShadow         = $0049
!ARAM_SPC_EchoEonShadow        = $004A    ; echo-enable channel mask (committed to DSP $4D = EON; see CODE_music_voice_release_echo_slot)
!ARAM_SPC_EchoEfbShadow        = $004B
!ARAM_SPC_KeyOnPending         = $004C    ; bit-7 = "music paused" override
!ARAM_SPC_KeyOnCommitted       = $004D
!ARAM_SPC_EchoEvolShadow       = $004E

!ARAM_SPC_GlobalTranspose      = $0050
!ARAM_SPC_TempoAccum           = $0051    ; $51 += $53 * Y per loop
!ARAM_SPC_TempoAccumHi         = $0052
!ARAM_SPC_TempoMaster          = $0053    ; $10 at boot

; $0054-$0057: master-volume slide state.
!ARAM_SPC_MasterVolSlideCounter = $0054
!ARAM_SPC_MasterVolSlideTarget = $0055
!ARAM_SPC_MasterVolSlideStepLo = $0056
!ARAM_SPC_MasterVolSlideStepHi = $0057

!ARAM_SPC_MasterVolL = $0058
!ARAM_SPC_MasterVolR = $0059
!ARAM_SPC_MasterVolSlideRateLo = $005A
!ARAM_SPC_MasterVolSlideRateHi = $005B
!ARAM_SPC_MasterVolSlideAcc = $005C
!ARAM_SPC_MasterVolSlideEnv = $005D
!ARAM_SPC_KonEdgeFiredAny = $005E
!ARAM_SPC_DrumInstBase = $005F          ; added to instruments >= $CA

!ARAM_SPC_EchoVolLLo = $0060
!ARAM_SPC_EchoVolLHi = $0061
!ARAM_SPC_EchoVolRLo = $0062
!ARAM_SPC_EchoVolRHi = $0063
!ARAM_SPC_EchoVolSlideStepLo = $0064
!ARAM_SPC_EchoVolSlideStepHi = $0065
!ARAM_SPC_EchoVolSlideCounter = $0068

; -- Per-channel state head -- $30..$C1 (X = 0..$E for voices 0..7).
;
;   $30+x, $31+x   sequence pointer (lo/hi)
;   $70+x          duration remaining (ticks)
;   $71+x          gate remaining (MUL YA hi byte; KOFF when 0)
;   $80+x          track-loop DBNZ counter
;   $90+x          volume-envelope ramp counter
;   $91+x          pitch-envelope ramp counter
;   $A0+x, $A1+x   portamento state (steps remaining + pre-delay)
;   $B0+x, $B1+x   tremolo phase / depth
;   $C0+x, $C1+x   vibrato phase / depth
;   $0100+x        tremolo phase accumulator (page-1, indexed via SETP/CLRP)
;
; (These are not given individual !-defines to keep the file readable; the
; engine asm uses `$30+x`-style direct indexing.)

;-------------------------------------------------------------------------
; Page 2 ($0200-$02FF): per-channel state table 1.
;
; Each row holds one field across all 8 voices (X = 0..$E in stride 2).
; Cleared by CODE_spc_clear_shadow_table_0200_loop at boot.
;-------------------------------------------------------------------------

!ARAM_SPC_ChNoteDurLo              = $0200
!ARAM_SPC_ChGateFactor             = $0201
!ARAM_SPC_ChNoteVolume             = $0210
!ARAM_SPC_ChInstrument             = $0211
!ARAM_SPC_ChPanL                   = $0220
!ARAM_SPC_ChPanR                   = $0221
!ARAM_SPC_ChTrackLoopTargetPtrLo   = $0230
!ARAM_SPC_ChTrackLoopTargetPtrHi   = $0231
!ARAM_SPC_ChSubroutineReturnPtrLo  = $0240
!ARAM_SPC_ChSubroutineReturnPtrHi  = $0241
!ARAM_SPC_ChVibratoSample          = $0250
!ARAM_SPC_ChPortamentoTarget       = $0280
!ARAM_SPC_ChPortamentoPostDelay    = $0281
!ARAM_SPC_ChPortamentoMode         = $0290    ; $00 = tie, $01 = slide
!ARAM_SPC_ChPortamentoLength       = $0291
!ARAM_SPC_ChTremoloAccum           = $02A0
!ARAM_SPC_ChTremoloIncrement       = $02A1
!ARAM_SPC_ChTremoloDelay           = $02B0
!ARAM_SPC_ChTremoloRange           = $02B1
!ARAM_SPC_ChTremoloStep            = $02C0
!ARAM_SPC_ChTremoloInit            = $02C1
!ARAM_SPC_ChVibratoAccum           = $02D0
!ARAM_SPC_ChVibratoIncrement       = $02D1
!ARAM_SPC_ChVibratoDelay           = $02E0
!ARAM_SPC_ChDetune                 = $02F0

;-------------------------------------------------------------------------
; Page 3 ($0300-$03FF): per-channel state table 2 + engine flags.
;
; Cleared by CODE_spc_clear_shadow_table_0300_loop at boot.
;-------------------------------------------------------------------------

!ARAM_SPC_ChBasePitchLo            = $0360
!ARAM_SPC_ChBasePitchHi            = $0361
!ARAM_SPC_ChPitchInterpLo          = $0370
!ARAM_SPC_ChPitchInterpHi          = $0371
!ARAM_SPC_ChPendingBasePitchLo     = $0380
!ARAM_SPC_ChPendingBasePitchHi     = $0381
!ARAM_SPC_EngineFadeCounter        = $03C7
!ARAM_SPC_EngineDisableSfx         = $03CA
!ARAM_SPC_EngineQueuedSfxBitmap    = $03CE
!ARAM_SPC_EngineSavedTempo         = $03F1
!ARAM_SPC_EngineFadeDirection      = $03F8

;-------------------------------------------------------------------------
; High ARAM ($3C00-$3FFF): static-resident data tables.
;
; These are written by the engine-upload step at boot and remain valid
; across song swaps. They live just above the engine code region.
;-------------------------------------------------------------------------

!ARAM_SPC_TblSampleDir = $3C00     ; DSP sample directory: 4 bytes per entry
                                   ; (start_lo, start_hi, loop_lo, loop_hi).
                                   ; Bank-specific dirs APPEND from $3C60.

!ARAM_SPC_TblVoicePatch = $3D00    ; 66 bytes (DATA_3D00); voice patch table
                                   ; (likely 11 records x 6 bytes; format unverified)

!ARAM_SPC_TblSoundCmdRemap = $3EBB ; 207 bytes (DATA_3EBB); SFX command-byte ->
                                   ; sequence-id remap

!ARAM_SPC_TblVolumeCurve = $3FE8   ; 24 bytes (DATA_3FE8); volume / envelope
                                   ; curve table

;-------------------------------------------------------------------------
; High ARAM ($4000-$FFFF): song-data + BRR samples; hot-swapped per song.
;
; Layout varies per sample bank; the resident engine looks them up via
; DATA_FF90 (song-pointer table) and the sample directory at $3C00.
; See per-bank `yi/SPC700/*SampleBank.asm` files for the upload contents.
;-------------------------------------------------------------------------
