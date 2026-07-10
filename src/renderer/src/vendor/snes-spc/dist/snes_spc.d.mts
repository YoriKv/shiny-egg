// Hand-maintained type declarations for the Emscripten module built by
// wasm/build.sh (dist/snes_spc.mjs). Keep in sync with the EXPORTS list
// in build.sh and with snes_spc/spc.h.

/** Byte offset into wasm linear memory (an emulated C pointer). */
export type Ptr = number;

/**
 * Error convention: functions typed `Ptr` as a return where an error is
 * possible return 0 (NULL) on success, or a pointer to a C string.
 * Decode with `UTF8ToString(ptr)`.
 */
export interface SpcModule {
    /**
     * Views over wasm memory. IMPORTANT: memory growth (-sALLOW_MEMORY_GROWTH)
     * replaces these — always read them off the module object right before
     * use; never cache them across calls to _malloc or exported functions.
     */
    HEAPU8: Uint8Array;
    HEAP16: Int16Array;

    /** Decodes a NUL-terminated C string in wasm memory. */
    UTF8ToString(ptr: Ptr): string;

    _malloc(size: number): Ptr;
    _free(ptr: Ptr): void;

    /* --- SNES_SPC: lifecycle --- */
    _spc_new(): Ptr;
    _spc_delete(spc: Ptr): void;

    /* --- SNES_SPC: emulator use --- */
    _spc_init_rom(spc: Ptr, rom64bytes: Ptr): void;
    _spc_set_output(spc: Ptr, out: Ptr, outSizeInSamples: number): void;
    _spc_sample_count(spc: Ptr): number;
    _spc_reset(spc: Ptr): void;
    _spc_soft_reset(spc: Ptr): void;
    _spc_read_port(spc: Ptr, time: number, port: number): number;
    _spc_write_port(spc: Ptr, time: number, port: number, data: number): void;
    _spc_end_frame(spc: Ptr, endTime: number): void;

    /* --- SNES_SPC: sound control --- */
    _spc_mute_voices(spc: Ptr, mask: number): void;
    _spc_disable_surround(spc: Ptr, disable: number): void;
    _spc_set_tempo(spc: Ptr, tempo: number): void;

    /* --- SNES_SPC: SPC music playback --- */
    _spc_load_spc(spc: Ptr, spcData: Ptr, size: number): Ptr;
    _spc_clear_echo(spc: Ptr): void;
    _spc_play(spc: Ptr, sampleCount: number, out: Ptr): Ptr;
    _spc_skip(spc: Ptr, sampleCount: number): Ptr;

    /* --- SNES_SPC: state save/load --- */
    _spc_init_header(spcFileOut: Ptr): void;
    _spc_save_spc(spc: Ptr, spcFileOut: Ptr): void;
    _spc_check_kon(spc: Ptr): number;
    /** Shim over spc_copy_state(): saves state, returns bytes written. */
    _spc_save_state(spc: Ptr, out: Ptr): number;
    /** Shim over spc_copy_state(): restores state, returns bytes read. */
    _spc_load_state(spc: Ptr, stateIn: Ptr): number;

    /* --- SPC_Filter --- */
    _spc_filter_new(): Ptr;
    _spc_filter_delete(filter: Ptr): void;
    _spc_filter_run(filter: Ptr, io: Ptr, sampleCount: number): void;
    _spc_filter_clear(filter: Ptr): void;
    _spc_filter_set_gain(filter: Ptr, gain: number): void;
    _spc_filter_set_bass(filter: Ptr, bass: number): void;
}

/** Standard Emscripten Module init options (subset commonly needed). */
export interface SpcModuleOptions {
    /** Override where the .wasm file is fetched from (bundler integration). */
    locateFile?(path: string, scriptDirectory: string): string;
    /** Supply the wasm binary directly instead of fetching it. */
    wasmBinary?: ArrayBuffer | Uint8Array;
    [key: string]: unknown;
}

export default function createSpcModule(
    options?: SpcModuleOptions,
): Promise<SpcModule>;
