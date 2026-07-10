/**
 * High-level TypeScript wrapper around the snes_spc wasm module.
 *
 * Owns all wasm-side memory: callers work with ordinary typed arrays and
 * exceptions; pointers, malloc/free, and error-string decoding are handled
 * here. See wasm/README.md for the full API reference and the raw C-level
 * surface in dist/snes_spc.d.mts.
 *
 * Usage:
 *   const spc = await SnesSpc.create();
 *   spc.loadSpc(new Uint8Array(await file.arrayBuffer()));
 *   const samples = spc.play(4096); // Int16Array, interleaved stereo, 32 kHz
 */

import createSpcModule, {
    type Ptr,
    type SpcModule,
    type SpcModuleOptions,
} from './dist/snes_spc.mjs';

/** Native output rate: stereo sample pairs per second. */
export const SPC_SAMPLE_RATE = 32000;
/** SPC-700 clocks per second; one stereo pair every 32 clocks. */
export const SPC_CLOCK_RATE = 1024000;
export const SPC_CLOCKS_PER_SAMPLE = 32;
/** Size of an exported .spc file in bytes. */
export const SPC_FILE_SIZE = 0x10200;
/** Minimum valid .spc file size accepted by loadSpc. */
export const SPC_MIN_FILE_SIZE = 0x10180;
/** Upper bound for a serialized emulator state. */
export const SPC_STATE_SIZE = 67 * 1024;
/** IPL ROM size for initRom. */
export const SPC_ROM_SIZE = 0x40;
export const SPC_PORT_COUNT = 4;
export const SPC_VOICE_COUNT = 8;

export interface SnesSpcCreateOptions extends SpcModuleOptions {
    /**
     * Reuse an already-instantiated wasm module. Lets many SnesSpc
     * instances share one module, and lets you instantiate the module
     * yourself (e.g. with a custom locateFile) before wrapping it.
     */
    module?: SpcModule;
}

export class SnesSpc {
    private mod: SpcModule;
    private spc: Ptr;
    private filter: Ptr;
    private buf: Ptr = 0;
    private bufSamples = 0;
    private filterOn = false;

    /** The underlying Emscripten module, for raw-API escape hatches. */
    get module(): SpcModule {
        return this.mod;
    }

    private constructor(mod: SpcModule) {
        this.mod = mod;
        this.spc = mod._spc_new();
        this.filter = mod._spc_filter_new();
        if (!this.spc || !this.filter) {
            throw new Error('snes_spc: out of memory');
        }
    }

    /** Instantiates the wasm module (unless one is supplied) and creates an emulator. */
    static async create(options: SnesSpcCreateOptions = {}): Promise<SnesSpc> {
        const { module, ...moduleOptions } = options;
        const mod = module ?? (await createSpcModule(moduleOptions));
        return new SnesSpc(mod);
    }

    /* ---------- SPC music playback ---------- */

    /** Loads a .spc music file. Throws with the library's message if invalid. */
    loadSpc(data: Uint8Array): void {
        this.assertAlive();
        const p = this.mod._malloc(data.length);
        try {
            this.mod.HEAPU8.set(data, p);
            this.throwIfError(this.mod._spc_load_spc(this.spc, p, data.length));
        } finally {
            this.mod._free(p);
        }
        this.mod._spc_filter_clear(this.filter);
    }

    /**
     * Clears the echo region of SPC RAM. Call right after loadSpc();
     * many rips carry garbage there that plays as a burst of noise.
     */
    clearEcho(): void {
        this.assertAlive();
        this.mod._spc_clear_echo(this.spc);
    }

    /**
     * Generates the next `sampleCount` samples (interleaved stereo at
     * 32 kHz, so 2 × pairs — must be even). Returns a fresh Int16Array,
     * or fills `out` if provided. Applies the SPC_Filter when enabled.
     */
    play(sampleCount: number, out?: Int16Array): Int16Array {
        this.assertAlive();
        this.assertEven(sampleCount);
        const p = this.scratch(sampleCount);
        this.throwIfError(this.mod._spc_play(this.spc, sampleCount, p));
        if (this.filterOn) {
            this.mod._spc_filter_run(this.filter, p, sampleCount);
        }
        const view = this.mod.HEAP16.subarray(p >> 1, (p >> 1) + sampleCount);
        if (out) {
            out.set(view.subarray(0, out.length));
            return out;
        }
        return view.slice();
    }

    /** Advances the song without generating audio. Much faster than play(). */
    skip(sampleCount: number): void {
        this.assertAlive();
        this.assertEven(sampleCount);
        this.throwIfError(this.mod._spc_skip(this.spc, sampleCount));
    }

    /* ---------- Sound control ---------- */

    /** Playback speed: 1.0 = normal, 0.5 = half speed. Range ~0.03–4. */
    setTempo(ratio: number): void {
        this.assertAlive();
        this.mod._spc_set_tempo(this.spc, Math.round(ratio * 0x100));
    }

    /** Mutes the 8 DSP voices whose bits are set in mask (bit 0 = voice 0). */
    muteVoices(mask: number): void {
        this.assertAlive();
        this.mod._spc_mute_voices(this.spc, mask);
    }

    /** True if new key-on events occurred since last call (silence trimming). */
    checkKon(): boolean {
        this.assertAlive();
        return this.mod._spc_check_kon(this.spc) !== 0;
    }

    /* ---------- Filter (authentic SNES sound) ---------- */

    /** Enables/disables the optional output filter applied inside play(). */
    setFilterEnabled(enabled: boolean): void {
        this.assertAlive();
        if (enabled && !this.filterOn) this.mod._spc_filter_clear(this.filter);
        this.filterOn = enabled;
    }

    /** Filter gain: 1.0 = unity. Output is clamped, so >1 is safe. */
    setFilterGain(gain: number): void {
        this.assertAlive();
        this.mod._spc_filter_set_gain(this.filter, Math.round(gain * 0x100));
    }

    /** Bass amount, logarithmic: 0 = none, 8 = normal, 31 = max. */
    setFilterBass(bass: number): void {
        this.assertAlive();
        this.mod._spc_filter_set_bass(this.filter, bass);
    }

    /* ---------- State save/load ---------- */

    /** Serializes exact emulator state (~65 KB). */
    saveState(): Uint8Array {
        this.assertAlive();
        const p = this.mod._malloc(SPC_STATE_SIZE);
        try {
            const written = this.mod._spc_save_state(this.spc, p);
            return this.mod.HEAPU8.slice(p, p + written);
        } finally {
            this.mod._free(p);
        }
    }

    /** Restores state produced by saveState(). */
    loadState(state: Uint8Array): void {
        this.assertAlive();
        const p = this.mod._malloc(state.length);
        try {
            this.mod.HEAPU8.set(state, p);
            this.mod._spc_load_state(this.spc, p);
        } finally {
            this.mod._free(p);
        }
    }

    /** Exports current state as a playable .spc file (with minimal header). */
    saveSpc(): Uint8Array {
        this.assertAlive();
        const p = this.mod._malloc(SPC_FILE_SIZE);
        try {
            this.mod._spc_init_header(p);
            this.mod._spc_save_spc(this.spc, p);
            return this.mod.HEAPU8.slice(p, p + SPC_FILE_SIZE);
        } finally {
            this.mod._free(p);
        }
    }

    /* ---------- Full-emulator use (SNES emulation, not needed for playback) ---------- */

    /** Power-on reset. (Playback: just call loadSpc again instead.) */
    reset(): void {
        this.assertAlive();
        this.mod._spc_reset(this.spc);
    }

    /** SNES reset-switch press. */
    softReset(): void {
        this.assertAlive();
        this.mod._spc_soft_reset(this.spc);
    }

    /** Installs the 64-byte IPL ROM (needed for full SNES emulation only). */
    initRom(rom: Uint8Array): void {
        this.assertAlive();
        if (rom.length !== SPC_ROM_SIZE) {
            throw new Error(`IPL ROM must be ${SPC_ROM_SIZE} bytes`);
        }
        const p = this.mod._malloc(SPC_ROM_SIZE);
        try {
            this.mod.HEAPU8.set(rom, p);
            this.mod._spc_init_rom(this.spc, p);
        } finally {
            this.mod._free(p);
        }
    }

    /** Reads CPU-visible port 0–3 at the given SPC clock time. */
    readPort(time: number, port: number): number {
        this.assertAlive();
        return this.mod._spc_read_port(this.spc, time, port);
    }

    /** Writes CPU-visible port 0–3 at the given SPC clock time. */
    writePort(time: number, port: number, data: number): void {
        this.assertAlive();
        this.mod._spc_write_port(this.spc, time, port, data);
    }

    /** Runs emulation to endTime (SPC clocks) and rebases time to 0. */
    endFrame(endTime: number): void {
        this.assertAlive();
        this.mod._spc_end_frame(this.spc, endTime);
    }

    /* ---------- Utilities ---------- */

    /**
     * Splits interleaved Int16 stereo into per-channel Float32 in [-1, 1] —
     * the shape Web Audio wants. Pass output arrays of length samples/2.
     */
    static deinterleave(
        samples: Int16Array,
        left: Float32Array,
        right: Float32Array,
    ): void {
        const pairs = samples.length >> 1;
        for (let i = 0; i < pairs; i++) {
            left[i] = samples[2 * i] / 32768;
            right[i] = samples[2 * i + 1] / 32768;
        }
    }

    /** Frees all wasm-side resources. The instance is unusable afterwards. */
    dispose(): void {
        if (!this.spc) return;
        if (this.buf) this.mod._free(this.buf);
        this.mod._spc_filter_delete(this.filter);
        this.mod._spc_delete(this.spc);
        this.buf = 0;
        this.spc = 0;
        this.filter = 0;
    }

    /* ---------- internals ---------- */

    private scratch(sampleCount: number): Ptr {
        if (this.bufSamples < sampleCount) {
            if (this.buf) this.mod._free(this.buf);
            this.buf = this.mod._malloc(sampleCount * 2);
            if (!this.buf) throw new Error('snes_spc: out of memory');
            this.bufSamples = sampleCount;
        }
        return this.buf;
    }

    private throwIfError(err: Ptr): void {
        if (err) throw new Error(`snes_spc: ${this.mod.UTF8ToString(err)}`);
    }

    private assertEven(n: number): void {
        if (n < 0 || n % 2 !== 0 || !Number.isInteger(n)) {
            throw new Error('sampleCount must be a non-negative even integer (stereo pairs)');
        }
    }

    private assertAlive(): void {
        if (!this.spc) throw new Error('SnesSpc instance has been disposed');
    }
}
