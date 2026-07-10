// First-party Web Audio playback over our own snes_spc wasm build (the
// vendored, self-compiled Blargg core — see vendor/snes-spc/). One player
// instance app-wide, two source kinds behind one gain:
//  - SPC images: the emulated SPC700 runs the game driver; a
//    ScriptProcessorNode pumps `spc.play()` output into the graph.
//    (ScriptProcessorNode is deprecated but reliable in Electron; an
//    AudioWorklet port is a contained future task — its module URL needs
//    CSP/file:// care that isn't worth it yet.)
//  - WAV bytes (decoded BRR samples from the Export tab): a plain
//    AudioBuffer one-shot.
//
// The AudioContext is requested at the core's native 32 kHz; when the
// browser declines (rare), the pump linearly resamples. The blargg
// SPC_Filter runs inside play() at its "authentic SNES sound" defaults.

import { SnesSpc, SPC_SAMPLE_RATE } from '../vendor/snes-spc/snes-spc'
import { SNES_SPC_WASM_B64 } from '../vendor/snes-spc/dist/snes-spc-wasm-b64'

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Frames per ScriptProcessor callback (per channel). */
const PUMP_FRAMES = 2048

export class SpcAudioPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private spc: SnesSpc | null = null
  private node: ScriptProcessorNode | null = null
  private wavSource: AudioBufferSourceNode | null = null
  private volume = 1
  private muteMask = 0
  /** Stereo pairs generated since the current SPC was loaded — the exact
   *  song position (÷32000 = seconds), a hair ahead of what's audible
   *  (~one pump buffer of latency; fine for a visual playhead). */
  private pairsPlayed = 0

  // Resample carry (used only when the context refused 32 kHz): the last
  // source frame + the fractional read position past it.
  private tailL = 0
  private tailR = 0
  private frac = 0
  private scratch: Int16Array = new Int16Array(0)
  private srcL: Float32Array = new Float32Array(0)
  private srcR: Float32Array = new Float32Array(0)

  private async ensure(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SPC_SAMPLE_RATE })
      this.gain = this.ctx.createGain()
      this.gain.gain.value = this.volume
      this.gain.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (!this.spc) {
      this.spc = await SnesSpc.create({ wasmBinary: b64ToBytes(SNES_SPC_WASM_B64) })
      this.spc.setFilterEnabled(true)
    }
  }

  /** Load an SPC image and start pumping it (replaces whatever plays). */
  async playSpc(spcBytes: ArrayBuffer): Promise<void> {
    await this.ensure()
    this.stopSources()
    const spc = this.spc!
    spc.loadSpc(new Uint8Array(spcBytes))
    spc.clearEcho()
    spc.muteVoices(this.muteMask)
    this.pairsPlayed = 0
    this.frac = 0
    this.tailL = 0
    this.tailR = 0
    const ctx = this.ctx!
    const node = ctx.createScriptProcessor(PUMP_FRAMES, 0, 2)
    node.onaudioprocess = (e) => this.pump(e)
    node.connect(this.gain!)
    this.node = node
  }

  /** Decode + play a WAV one-shot (replaces whatever plays). Resolves with
   *  the source node so callers can watch `onended`. */
  async playWav(wavBytes: ArrayBuffer): Promise<AudioBufferSourceNode> {
    await this.ensure()
    this.stopSources()
    const ctx = this.ctx!
    const buffer = await ctx.decodeAudioData(wavBytes)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.gain!)
    this.wavSource = source
    source.start()
    return source
  }

  /** Stop all playback (the emulator instance is kept for reuse). */
  stop(): void {
    this.stopSources()
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.gain) this.gain.gain.value = v
  }

  /** Mute mask for the 8 DSP voices (bit n = voice n) — the Sequence tab's
   *  channel pills. Applied live and re-applied after every loadSpc (the
   *  DSP mute is per-emulator-run state). */
  muteVoices(mask: number): void {
    this.muteMask = mask & 0xff
    this.spc?.muteVoices(this.muteMask)
  }

  isWavSource(source: AudioBufferSourceNode): boolean {
    return this.wavSource === source
  }

  /** Current SPC song position in seconds, or null when no SPC is pumping. */
  getSpcPositionSeconds(): number | null {
    if (!this.node) return null
    return this.pairsPlayed / SPC_SAMPLE_RATE
  }

  private stopSources(): void {
    if (this.node) {
      this.node.onaudioprocess = null
      this.node.disconnect()
      this.node = null
    }
    if (this.wavSource) {
      try { this.wavSource.stop() } catch { /* already stopped */ }
      this.wavSource = null
    }
  }

  private pump(e: AudioProcessingEvent): void {
    const spc = this.spc
    const outL = e.outputBuffer.getChannelData(0)
    const outR = e.outputBuffer.getChannelData(1)
    if (!spc) {
      outL.fill(0)
      outR.fill(0)
      return
    }
    const frames = outL.length
    const ratio = SPC_SAMPLE_RATE / e.outputBuffer.sampleRate
    try {
      if (ratio === 1) {
        // Native-rate fast path.
        if (this.scratch.length < frames * 2) this.scratch = new Int16Array(frames * 2)
        const samples = spc.play(frames * 2, this.scratch)
        this.pairsPlayed += frames
        for (let i = 0; i < frames; i++) {
          outL[i] = samples[2 * i] / 32768
          outR[i] = samples[2 * i + 1] / 32768
        }
        return
      }
      // Linear-resample path: source stream = [tail, ...N new frames].
      const advance = this.frac + frames * ratio
      const consumed = Math.floor(advance)
      const srcNew = consumed + 1 // frame indices up to `consumed` must exist
      if (this.scratch.length < srcNew * 2) this.scratch = new Int16Array(srcNew * 2)
      if (this.srcL.length < srcNew + 1) {
        this.srcL = new Float32Array(srcNew + 1)
        this.srcR = new Float32Array(srcNew + 1)
      }
      const samples = spc.play(srcNew * 2, this.scratch)
      this.pairsPlayed += srcNew
      this.srcL[0] = this.tailL
      this.srcR[0] = this.tailR
      for (let i = 0; i < srcNew; i++) {
        this.srcL[i + 1] = samples[2 * i] / 32768
        this.srcR[i + 1] = samples[2 * i + 1] / 32768
      }
      for (let i = 0; i < frames; i++) {
        const p = this.frac + i * ratio
        const idx = Math.floor(p)
        const t = p - idx
        outL[i] = this.srcL[idx] + (this.srcL[idx + 1] - this.srcL[idx]) * t
        outR[i] = this.srcR[idx] + (this.srcR[idx + 1] - this.srcR[idx]) * t
      }
      this.frac = advance - consumed
      this.tailL = this.srcL[srcNew]
      this.tailR = this.srcR[srcNew]
    } catch {
      // A dead emulator (bad image) must not spam the audio thread.
      outL.fill(0)
      outR.fill(0)
      this.stopSources()
    }
  }
}
