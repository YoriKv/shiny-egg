// In-editor audio playback, backed by our own snes_spc wasm build
// (src/renderer/src/audio/spc-audio.ts). Two paths behind one transport
// surface:
//  - SPC images: the emulated SPC700 runs the real game driver. No
//    end-of-song event (SPC music loops), so `playing` flips only on stop /
//    replace / error.
//  - WAV bytes (the Export tab's decoded BRR samples): AudioBuffer one-shots
//    with a real `onended`.
//
// The player is a MODULE-LEVEL SINGLETON shared by every consumer (the Audio
// panel's transport, the Header panel's music preview): one AudioContext,
// one volume, one mute mask, and starting playback anywhere replaces what's
// playing everywhere. Hook state (playing / label / volume / mute mask /
// error) lives in a tiny external store so all mounted consumers stay in
// sync — UI that shows the mask (the Sequence tab's pills) derives from the
// store, never from local state, so a remounted panel can't drift from what
// the DSP is actually muting. `seq` increments on every successful play so a
// consumer can tell whether the current playback is still ITS OWN (the
// Sequence-inspector playhead keys on it). The volume preference persists in
// its own store so it applies to every consumer even when the Audio panel
// never mounted this session.

import { useMemo, useSyncExternalStore } from 'react'
import { SpcAudioPlayer } from '../audio/spc-audio'
import { persistedState } from '../lib/persisted-state'

export interface SpcPlayerControls {
  /** Load + start an SPC image (replaces whatever is playing). Returns the
   *  playback's `seq` — compare against `seq` later to know it's still live. */
  play: (spc: ArrayBuffer, label?: string) => Promise<number>
  /** Decode + play a WAV file (replaces whatever is playing). */
  playWav: (wav: ArrayBuffer, label?: string) => Promise<number>
  stop: () => void
  /** 0..1 gain (persisted; remembered across plays and sessions). */
  setVolume: (v: number) => void
  /** DSP voice mute mask (bit n = voice n); live + persists across plays. */
  muteVoices: (mask: number) => void
  /** Current SPC song position in seconds (null when no SPC is pumping).
   *  Stable function — poll it (e.g. per animation frame), don't watch it. */
  getPosition: () => number | null
  volume: number
  /** Current DSP voice mute mask (the value `muteVoices` last applied). */
  muteMask: number
  playing: boolean
  /** Display label of what's playing (set by whoever started it). */
  nowLabel: string | null
  /** Monotonic playback id — bumps on every successful play. */
  seq: number
  /** Non-null after a load/playback failure (unsupported env, bad image). */
  error: string | null
}

interface PlayerState {
  playing: boolean
  nowLabel: string | null
  seq: number
  volume: number
  muteMask: number
  error: string | null
}

const VOLUME_STORE = persistedState<{ volume: number }>('shinyEgg.audioVolume.v1', { volume: 1 })

function loadPersistedVolume(): number {
  const v = VOLUME_STORE.load().volume
  return typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 1
}

let player: SpcAudioPlayer | null = null
let state: PlayerState = {
  playing: false,
  nowLabel: null,
  seq: 0,
  volume: loadPersistedVolume(),
  muteMask: 0,
  error: null
}
const listeners = new Set<() => void>()

function setState(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch }
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function ensurePlayer(): SpcAudioPlayer {
  if (!player) {
    player = new SpcAudioPlayer()
    player.setVolume(state.volume)
  }
  return player
}

async function playShared(spc: ArrayBuffer, label?: string): Promise<number> {
  try {
    await ensurePlayer().playSpc(spc)
    setState({ error: null, playing: true, nowLabel: label ?? null, seq: state.seq + 1 })
    return state.seq
  } catch (e) {
    setState({ error: (e as Error).message, playing: false, nowLabel: null })
    throw e
  }
}

async function playWavShared(wav: ArrayBuffer, label?: string): Promise<number> {
  try {
    const p = ensurePlayer()
    const source = await p.playWav(wav)
    source.onended = () => {
      if (p.isWavSource(source)) setState({ playing: false })
    }
    setState({ error: null, playing: true, nowLabel: label ?? null, seq: state.seq + 1 })
    return state.seq
  } catch (e) {
    setState({ error: (e as Error).message, playing: false, nowLabel: null })
    throw e
  }
}

function stopShared(): void {
  player?.stop()
  setState({ playing: false, nowLabel: null })
}

function setVolumeShared(v: number): void {
  const clamped = Math.min(1, Math.max(0, v))
  ensurePlayer().setVolume(clamped)
  VOLUME_STORE.save({ volume: clamped })
  setState({ volume: clamped })
}

function muteVoicesShared(mask: number): void {
  ensurePlayer().muteVoices(mask)
  setState({ muteMask: mask & 0xff })
}

const getPositionShared = (): number | null => player?.getSpcPositionSeconds() ?? null

export function useSpcPlayer(): SpcPlayerControls {
  const snap = useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  )
  // One object per store snapshot — consumers can list `player` in dep
  // arrays without their callbacks re-creating on unrelated renders.
  return useMemo(
    () => ({
      play: playShared,
      playWav: playWavShared,
      stop: stopShared,
      setVolume: setVolumeShared,
      muteVoices: muteVoicesShared,
      getPosition: getPositionShared,
      volume: snap.volume,
      muteMask: snap.muteMask,
      playing: snap.playing,
      nowLabel: snap.nowLabel,
      seq: snap.seq,
      error: snap.error
    }),
    [snap]
  )
}
