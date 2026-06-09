;#############################################################################################################
;# GameModes.asm -- Top-level game-mode dispatcher values.
;#############################################################################################################

!Define_YI_GameMode00_PrepareNintendoPresents = $0000	; Nintendo Presents prep: boot-sequence stage 0. Resets PPU, clears CGRAM, initialises OAM/BG3, kicks save-file checksum verification, primes a 128-frame display timer, advances to $01.
!Define_YI_GameMode01 = $0001	; Nintendo Presents load: streams the "(c) 1995 Nintendo presents..." text records to BG1 via SuperFX plot calls. On stream-end ($FF) clears sprites and jumps to mode $41; otherwise plays coin SFX and advances to $02.
!Define_YI_GameMode02 = $0002	; Slow fade between Nintendo Presents load ($01) and show ($03) using gm_fade_alt (1 step every 3 frames).
!Define_YI_GameMode03 = $0003	; Nintendo Presents show: holds the splash on-screen by decrementing the $011A timer; when it reaches 0, advances to $04.
!Define_YI_GameMode04 = $0004	; Fade out of the Nintendo Presents splash into the load-cutscene mode $05 (shared gm_fade_screen_in_out).
!Define_YI_GameMode05 = $0005	; Cutscene loader: one-shot setup that decompresses cutscene GFX bundle $0079, palette $50, programs HDMA $03-$07, arms IRQ at HCOUNT=$50/VCOUNT=$C6 and sets the per-scene timer $1405=$3100, then advances to $06.
!Define_YI_GameMode06 = $0006	; Fade-in between the cutscene loader ($05) and the cutscene tick ($07) (shared gm_fade_screen_in_out).
!Define_YI_GameMode07 = $0007	; Cutscene tick: per-frame cutscene script driver. DEC timer $1405; on 0 or Start/Select press, queues music fade and advances to $08. Otherwise ticks the timeline at DATA_0FCF2D and renders via FXCODE_089067/08B1EF.
!Define_YI_GameMode08 = $0008	; Slow fade between cutscene tick ($07) and title-screen load ($09) using gm_fade_alt.
!Define_YI_GameMode09 = $0009	; Title-screen load: one-shot setup that primes BG1-3 scroll mirrors, derives world index from the cursor's save slot, arms HDMA $01-$07 from the title-screen channel-parameter tables, then advances to $0A.
!Define_YI_GameMode0A = $000A	; Title-screen + file-select tick: per-frame handler. Refreshes title OAM, ticks the cursor, polls controller, dispatches into world/file-select substates and runs SuperFX rendering blobs FXCODE_08C7CA et al.
!Define_YI_GameMode0B = $000B	; Fade out of the title/world-map and into the level-load path at $0C (shared gm_fade_screen_in_out).
!Define_YI_GameMode0C = $000C	; Level fade-in with name banner: THE level-data staging point. Loads level pointers/header/gfx/palettes/tilemaps then runs the fade-in. Re-entered with $038C set for screen-exit warps. Advances to $0D/$0E.
!Define_YI_GameMode0D = $000D	; Post-pipe/post-door re-entry fade: runs the "iris-open" reveal at the new entrance via FXCODE_088E48, with FreezeYoshi+FreezeSprites=1; on completion clears window masks and advances to $0E.
!Define_YI_GameMode0E = $000E	; Final level fade-in to control: ticks scrolling + new-row/column streamers + new-sprite spawn checks during the fade. When the fade finishes, hands control to the player and advances to $0F (in-level main).
!Define_YI_GameMode0F = $000F	; In-level main: the big gameplay handler. Drives sprite ticks, collisions, player input, animation, BG layers, exits and pause/message-box checks. Most playtime is spent here.
!Define_YI_GameMode10 = $0010	; Post-boss victory cutscene: 31-entry sub-state machine via $0B57 (fade, score-tile build, time-bonus reveal, star/red-coin/flower count-ups, score total, write-best, perfect, wait-for-button). On done advances to $1F or $29.
!Define_YI_GameMode11 = $0011	; Level-death handler: drives Yoshi's death animation, Baby-Mario rescue cinematic, and the transition back to map mode or the retry path. Also hosts the camera new-row/new-column tile streamers used during the death-scroll.
!Define_YI_GameMode12 = $0012	; Fade between level-death ($11) and retry-screen load ($13) (shared gm_fade_screen_in_out).
!Define_YI_GameMode13 = $0013	; Retry-screen load: one-shot setup. Decompresses retry-screen gfx bundle $006E, loads palette $4A, enables BG1 only, spawns the four heart-balloon letter sprites at hardcoded positions, stops music, advances to $14.
!Define_YI_GameMode14 = $0014	; Fade between retry-screen load ($13) and retry-screen tick ($15) (shared gm_fade_screen_in_out).
!Define_YI_GameMode15 = $0015	; Retry-screen tick: per-frame. Polls controller-2 for player choice. On Yes: 0 lives -> mode $3F (game over); else with mid-rings touched -> $32 (midring restart); otherwise -> $3A (level restart).
!Define_YI_GameMode16 = $0016	; Slowest fade (1 step every 8 frames, reload=8) used for the end-of-world cutscene transition between scenes.
!Define_YI_GameMode17 = $0017	; Final cinema sequence trigger: post-Bowser. Sets $011A=$FF, sets CurrentWorld=FinalCutscene, flips the FinalWorldUnlockedFlag, advances to $18.
!Define_YI_GameMode18 = $0018	; Title-screen re-load after final cinema / game-over: shared gm_load_title_screen entry that re-initialises the title screen for post-credits / post-game-over re-display.
!Define_YI_GameMode19 = $0019	; Fade-to-title-screen tick (shared gm_fade_to_title_screen): ticks the SuperFX title rendering blobs and palette transition while returning to the title from the final cinema path.
!Define_YI_GameMode1A = $001A	; Fade between the post-final title return ($19) and the credits-load mode $1B (shared gm_fade_screen_in_out).
!Define_YI_GameMode1B = $001B	; Credits load: staff-roll one-shot setup. Decompresses credits font bundle $01C3, primes scroller queue and the credits BG tilemap, kicks the credits BGM, arms IRQ, advances to $1C.
!Define_YI_GameMode1C = $001C	; Credits begin: bootstrap-frame for the credits scroll. Primes the first credit line and tilemap HDMA, then advances to $1D once setup ticks complete.
!Define_YI_GameMode1D = $001D	; Credits per-frame driver: advances the scroll position, fades each name line in/out via the per-line handler table, and on completion advances to the post-credits demo path ($1E).
!Define_YI_GameMode1E = $001E	; Start+Select fade-out: special fade that drives the brightness mirror to a limit then forces CurrentGameMode := $20 (overworld prepare) instead of INC -- used when killing the current level via Start+Select.
!Define_YI_GameMode1F = $001F	; Slow fade-alt: bridges between in-level victory ($10) or post-bonus ($28) handlers and the overworld-prepare mode $20.
!Define_YI_GameMode20 = $0020	; Overworld prepare: one-shot world-map setup. Loads world-map gfx, palettes, scene-regs slot $28, OBSEL, BG3, mode-7 matrix, sets HDMA $01-$07 channel parameters, seeds the world-fold state machine. Advances to $21.
!Define_YI_GameMode21 = $0021	; Fade between overworld prepare ($20) and overworld main ($22) (shared gm_fade_screen_in_out).
!Define_YI_GameMode22 = $0022	; Overworld main: THE world-map loop. Polls controller, ticks the world-map state machine via DATA_world_map_state_ptr, animates Yoshi+sparkle. On level-tile select sets CurrentLevelFromMap and advances to $1E (fade out to level).
!Define_YI_GameMode23 = $0023	; Fade between overworld ($22) and overworld-level-progression ($24) (shared gm_fade_screen_in_out).
!Define_YI_GameMode24 = $0024	; Overworld level progression: animates Yoshi walking between map tiles after a level clear. Hands off to gm$26 (score panel) or gm$22 (idle map) when the walk completes.
!Define_YI_GameMode25 = $0025	; Fade between overworld-level-progression ($24) and the score-panel update ($26) (shared gm_fade_screen_in_out).
!Define_YI_GameMode26 = $0026	; Per-level score-panel update: after a perfect/100% run, animates the score tile via a 12-entry sub-state table; updates LevelHighScores. On state 7, advances to $27.
!Define_YI_GameMode27 = $0027	; Fade between score-panel update ($26) and the world-score flip cutscene ($28) (shared gm_fade_screen_in_out).
!Define_YI_GameMode28 = $0028	; World-score flip cutscene: animates the per-tile flip-down score display via DATA_17A91A 7-state dispatch. On completion advances to $29 (fade to bonus) or $22 (back to map).
!Define_YI_GameMode29 = $0029	; Slow fade-alt between the world-score flip cutscene ($28) and the bonus-game loader ($2A).
!Define_YI_GameMode2A = $002A	; Bonus-game loader: one-shot setup for the post-level bonus game. Decompresses bonus-game gfx, palette, primes DMA queue, spawns Baby-Mario sprite, dispatches into the per-variant init via DATA_109C74, advances to $2B.
!Define_YI_GameMode2B = $002B	; Fade between bonus-game loader ($2A) and bonus-game main ($2C) (shared gm_fade_screen_in_out).
!Define_YI_GameMode2C = $002C	; Bonus-game main: per-frame driver for the post-level bonus game (Flip Cards / Match Cards / Slot Machine / Drawing Lots / Scratch & Match / Roulette). Dispatches via DATA_bonus_game_tick_ptrs by CurrentBonusGame.
!Define_YI_GameMode2D = $002D	; Fade between bonus-game main ($2C) and bandit-minigame init ($2E) (shared gm_fade_screen_in_out).
!Define_YI_GameMode2E = $002E	; Bandit minigame loader (gather-coins / pop-balloons / watermelon-spit): dispatches via DATA_bandit_minigame_init_ptrs by $03A7, sets CurrentGameMode := $2F to enter the shared in-level pipeline for the minigame.
!Define_YI_GameMode2F = $002F	; Fade between bandit-minigame loader ($2E) and miniboss-battle main ($30) (shared gm_fade_screen_in_out).
!Define_YI_GameMode30 = $0030	; Miniboss / mini-battle main tick: dispatches into per-variant tick via DATA_mini_battle_main_ptrs by $03A7. Handles message-box ticks via CODE_01DE5A first if open.
!Define_YI_GameMode31 = $0031	; Post-boss fade-to-score: 11-entry sub-state machine (DATA_01E291) drives the score-screen reveal (window-expand, score tilemap, time-bonus, stars/coins/flowers, high-score). On state $16 sets CurrentGameMode := $10.
!Define_YI_GameMode32 = $0032	; Fade-in for midring-restart path: shared gm_fade_screen_in_out reached from gm15 when continuing with mid-rings touched; transitions into the midring restart prompt loader at $33.
!Define_YI_GameMode33 = $0033	; Midring-restart prompt load: one-shot setup for "RESTART FROM MID-RING?" screen. Initialises palette/OAM, loads BG3 tilemap via queue index $1E, arms IRQ, advances to $34.
!Define_YI_GameMode34 = $0034	; Fade between midring-restart prompt load ($33) and the prompt tick ($35) (shared gm_fade_screen_in_out).
!Define_YI_GameMode35 = $0035	; Midring-restart prompt tick: polls A/B; on accept restores midring inventory, computes star/coin/flower partials from StarTimer, seeds $7F:7E00 with the midring entrance pointer and advances to gm$0C with $038C=1.
!Define_YI_GameMode36 = $0036	; Retry-level cutscene select (post-midring-restart): DEC $8F delay; when 0, picks CurrentGameMode from DATA_01E6EE based on $704094: $0B (death cutscene) or $1F (try-again screen).
!Define_YI_GameMode37 = $0037	; Slow fade-alt between the file-select / new-game branch and the prologue intro-cutscene loader $38.
!Define_YI_GameMode38 = $0038	; Prologue ("Once upon a time...") loader: clears states, primes level data, loads gfx $0000, palette+BG3 banks, spawns 15 cutscene Yoshi sprites, sets player state Prologue, music $11, advances to $39.
!Define_YI_GameMode39 = $0039	; Prologue tick (Yoshi-train + stork sequence): per-frame driver dispatching via DATA_intro_cutscene_phase_ptrs by $0D27. Manages BG2 scroll-in, message-box plates, and SuperFX panorama composition.
!Define_YI_GameMode3A = $003A	; Fade out of the prologue / retry path: shared gm_fade_screen_in_out advancing into the retry-screen prompt loader ($3B) -- also reached directly from gm15 (no midrings, lives remain) and gm$3E.
!Define_YI_GameMode3B = $003B	; "Try Again?" retry-prompt load: one-shot setup writing $704070 := $21 (retry prompt char), running the shared retry-screen scaffolding (CODE_01E59A), advances to $3C.
!Define_YI_GameMode3C = $003C	; Fade between retry-prompt load ($3B) and the prompt tick ($3D) (shared gm_fade_screen_in_out).
!Define_YI_GameMode3D = $003D	; "Try Again?" retry-prompt tick: polls A/B; plays the "mount Yoshi" or "clank" SFX based on choice; sets $8F=$10 delay; advances to $3E.
!Define_YI_GameMode3E = $003E	; Retry-prompt cutscene select: DEC $8F delay; when 0, picks CurrentGameMode from DATA_01E6EE based on $704094: $0B (death cutscene) or $1F (try-again to map). Welcome-To-Yoshis-Island special-case resets CurrentLevelFromMap.
!Define_YI_GameMode3F = $003F	; Game Over loader: one-shot setup. Clears states, decompresses GAME OVER letter gfx, primes palette fade, arms gm$40.
!Define_YI_GameMode40 = $0040	; Game Over main: per-frame tick. Animates the falling-letters effect, runs the slow palette fade, listens for Start/Select. On press, plays "mount Yoshi" or "clank" SFX and advances.
!Define_YI_GameMode41 = $0041	; Fade out of game-over ($40) into the controller-error screen ($42) (shared gm_fade_screen_in_out) -- also reached when the gm$01 stream-end triggers a hard-stop.
!Define_YI_GameMode42 = $0042	; Controller-error screen: shows "PLEASE TURN OFF THE POWER" red-text after the controller checksum/handshake fails. Slowly nudges live palette toward white. Mode never advances; only a hard reset escapes.
!Define_YI_GameMode43 = $0043	; Fade between controller-error ($42) and the "unknown" palette nudge ($44) (shared gm_fade_screen_in_out).
!Define_YI_GameMode44 = $0044	; Final palette-nudge mode (raid: gm44_unknown): nudges live PaletteMirror entries toward $8000 (white) similar to gm$42 then returns; advanced into from the controller-error fade ($43). No exit handler.
