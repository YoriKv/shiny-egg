;#############################################################################################################
;# WRAM_HardwareRegs.asm -- Shadow copies of SNES hardware register values ($00093C-$00096C).
;#############################################################################################################

; --- Global controller state (the canonical "this frame's input"; mirrored to DP $35-$38) ---
; Data1 layout: AXLR----  Data2 layout: byetUDLR (b=B y=Y e=Select t=Start)
!RAM_YI_Global_Controller1Data1 = $00093C
!RAM_YI_Global_Controller1Data2 = $00093D
!RAM_YI_Global_Controller1Data1Press = $00093E
!RAM_YI_Global_Controller1Data2Press = $00093F
!RAM_YI_Global_Controller2Data1 = $000940
!RAM_YI_Global_Controller2Data2 = $000941
!RAM_YI_Global_Controller2Data1Press = $000942
!RAM_YI_Global_Controller2Data2Press = $000943
!RAM_YI_Global_Controller1Data1Prev = $000944			; previous frame, used to compute next frame's press
!RAM_YI_Global_Controller1Data2Prev = $000945
!RAM_YI_Global_Controller2Data1Prev = $000946
!RAM_YI_Global_Controller2Data2Prev = $000947

!RAM_YI_Global_FixedColorDataMirrorLo = $000948			; 0bbbbbgg gggrrrrr fixed-color intensity (mirrors $2132 packed)
!RAM_YI_Global_FixedColorDataMirrorHi = !RAM_YI_Global_FixedColorDataMirrorLo+$01

!RAM_YI_Global_HDMAEnable = $00094A
!RAM_YI_Global_OAMSizeAndDataAreaDesignation = $00094B
!RAM_YI_Global_BGWindowLogicSettings = $00094C
!RAM_YI_Global_ColorAndObjectWindowLogicSettings = !RAM_YI_Global_BGWindowLogicSettings+$01
!RAM_YI_Global_Mode7TilemapSettings = $00094E
!RAM_YI_Global_Mode7MatrixParameterALo = $00094F
!RAM_YI_Global_Mode7MatrixParameterAHi = !RAM_YI_Global_Mode7MatrixParameterALo+$01
!RAM_YI_Global_Mode7MatrixParameterBLo = $000951
!RAM_YI_Global_Mode7MatrixParameterBHi = !RAM_YI_Global_Mode7MatrixParameterBLo+$01
!RAM_YI_Global_Mode7MatrixParameterCLo = $000953
!RAM_YI_Global_Mode7MatrixParameterCHi = !RAM_YI_Global_Mode7MatrixParameterCLo+$01
!RAM_YI_Global_Mode7MatrixParameterDLo = $000955
!RAM_YI_Global_Mode7MatrixParameterDHi = !RAM_YI_Global_Mode7MatrixParameterDLo+$01
!RAM_YI_Global_Mode7CenterXLo = $000957
!RAM_YI_Global_Mode7CenterXHi = !RAM_YI_Global_Mode7CenterXLo+$01
!RAM_YI_Global_Mode7CenterYLo = $000959
!RAM_YI_Global_Mode7CenterYHi = !RAM_YI_Global_Mode7CenterYLo+$01
!RAM_YI_Global_MosaicSizeAndBGEnable = $00095B
;Empty $00095C-$00095D
!RAM_YI_Global_BGModeAndTileSizeSetting = $00095E
!RAM_YI_Global_BG1AddressAndSize = $00095F
!RAM_YI_Global_BG2AddressAndSize = $000960
!RAM_YI_Global_BG3AddressAndSize = $000961
!RAM_YI_Global_BG1And2TileDataDesignation = $000962
!RAM_YI_Global_BG3And4TileDataDesignation = !RAM_YI_Global_BG1And2TileDataDesignation+$01
!RAM_YI_Global_BG1And2WindowMaskSettings = $000964
!RAM_YI_Global_BG3And4WindowMaskSettings = !RAM_YI_Global_BG1And2WindowMaskSettings+$01
!RAM_YI_Global_ObjectAndColorWindowSettings = $000966
!RAM_YI_Global_MainScreenLayers = $000967
!RAM_YI_Global_SubScreenLayers = $000968
!RAM_YI_Global_MainScreenWindowMask = $000969
!RAM_YI_Global_SubScreenWindowMask = $00096A
!RAM_YI_Global_ColorMathInitialSettings = $00096B
!RAM_YI_Global_ColorMathSelectAndEnable = $00096C
