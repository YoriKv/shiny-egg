; yi/SuperFX/BankDefines.asm -- bank-base address defines used by the %SuperFXBankStart
; macro in each yi/SuperFX/Banks/Bank0X.asm file. These map to the SuperFX-visible
; base (LoROM banks $08-$0B = 32 KB-per-bank; HiROM-mirrored data banks $4C-$57 =
; full 64 KB per bank in SuperFX bank mapping).

!FXBank08 = 088000
!FXBank09 = 098000
!FXBank0A = 0A8000
!FXBank0B = 0B8000
!FXBank4C = 4C0000
!FXBank4D = 4D0000
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
!FXBank51 = 510000
else
!FXBank51 = 5110DB
endif
!FXBank52 = 520000
!FXBank53 = 530000
!FXBank54 = 540000
!FXBank55 = 550000
!FXBank56 = 560000
!FXBank57 = 570000

