// Shared emulator supervisor: the TCP-socket render harness protocol engine.
//
// Both supported emulators — BizHawk (src/main/bizhawk.ts) and Mesen
// (src/main/mesen.ts) — speak the SAME framed protocol over a localhost TCP
// socket. This base owns everything that is identical across them: the TCP
// server, the "<len> <body>" framing, the command queue / RDY-heartbeat pump,
// and every public method (loadLevel / readMem / writeMem / dumpVram / captureAt
// / …). Each subclass fills in only what genuinely differs — how to resolve its
// executable, the spawn command line, and any pre/post-launch host-config setup.
//
// Wire protocol (see bizhawk-harness/shinyegg.lua + mesen-harness/shinyegg.lua):
//   emulator -> editor: every message is "<len> " + N payload bytes. Each idle
//     frame the harness sends "RDY"; command replies are "OK …" / "ERR …" /
//     "PONG" / a known-length hex dump.
//   editor -> emulator: "<len> <body>" — the harness strips the prefix and
//     dispatches the bare command. The editor answers each RDY with either "NOP"
//     (nothing queued) or the next queued command; it then awaits that command's
//     single reply (which, for a multi-frame LOAD_LEVEL, arrives many frames
//     later — there is no editor-side reply timeout, matching the harness's own
//     blocking load).

import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { outputSfcName } from 'snes-framework/rom-versions'
import { readExtractionState } from 'snes-framework/state'
import { builtArtifactDir, frameworkWorkRoot } from '../framework-paths'
import { getCurrentProjectId } from '../projects'
import type { BizhawkWarp, TestInventory } from '../../shared/ipc-types'
import { hex } from 'snes-framework/hex'

// Test Level item presets → the NorSpr sprite IDs seeded onto Yoshi's egg
// trail. The trail caps at 6 items (eggs + keys share the slots; the cart's
// CODE_03BEB9 drops the oldest past 6), so a key takes one of the six. Green
// egg ($25) is the standard trailing egg the game's own FullEggSpawner uses;
// the carryable key is $27. The harness writes these into the between-level
// inventory snapshot the level loader restores on entry (see shinyegg.lua).
const NORSPR_GREEN_EGG = 0x25
const NORSPR_KEY = 0x27
function inventorySpriteIds(inv: TestInventory | undefined): number[] {
  if (!inv) return [] // undefined — empty-handed boot
  // Defensive clamp — the UI enforces eggs + keys ≤ 6, but a stale persisted
  // value (or a future caller) could exceed the trail's 6-slot capacity. Eggs
  // take priority; keys fill whatever slots remain.
  const eggs = Math.max(0, Math.min(6, Math.trunc(inv.eggs) || 0))
  const keys = Math.max(0, Math.min(6 - eggs, Math.trunc(inv.keys) || 0))
  return [...Array<number>(eggs).fill(NORSPR_GREEN_EGG), ...Array<number>(keys).fill(NORSPR_KEY)]
}

interface PendingCommand {
  command: string
  // If true, the next inbound framed message (that isn't an RDY heartbeat) is
  // this command's reply. If false, the command has no reply and resolves
  // immediately after dispatch.
  expectReply: boolean
  resolve: (data: Buffer) => void
  reject: (err: Error) => void
}

/** How a subclass wants its emulator spawned, once the base has resolved the
 *  port, cart, and harness-script paths. */
export interface EmulatorSpawnPlan {
  args: string[]
  cwd: string
  /** Extra environment variables, merged over `process.env`. Mesen uses this to
   *  hand the harness the editor's TCP port (BizHawk gets it via `--socket_port`
   *  instead). */
  env?: NodeJS.ProcessEnv
}

export abstract class EmulatorSupervisorBase {
  private server: Server | null = null
  private port = 0
  private client: Socket | null = null
  private child: ChildProcess | null = null
  private rxBuf: Buffer = Buffer.alloc(0)
  private queue: PendingCommand[] = []
  // The command we last dispatched and are awaiting a reply for. When set, the
  // next inbound framed message (that isn't an RDY) is the reply.
  private awaiting: PendingCommand | null = null
  private startPromise: Promise<void> | null = null

  // ── Subclass contract ──────────────────────────────────────────────────────

  /** Human-facing emulator name for error messages ("BizHawk" / "Mesen"). */
  protected abstract readonly label: string

  /** Resolve the emulator executable: the saved location (if it still exists),
   *  then any dev-only fallback, else null when it hasn't been located yet. */
  protected abstract resolveExe(): string | null

  /** Forget the saved exe path IF it's the one that just failed to launch, so
   *  the toolbar reverts to "Locate <emulator>" for re-pointing. */
  protected abstract forgetPathIfSaved(exe: string): void

  /** Absolute path to this emulator's Lua harness script. */
  protected abstract harnessScriptPath(): string

  /** Build the spawn command line once the base has the port, cart, and harness
   *  script path in hand. */
  protected abstract buildSpawnPlan(exe: string, port: number, cart: string, harness: string): EmulatorSpawnPlan

  /** Host-side setup before spawn (e.g. seed emulator config to enable the Lua
   *  socket). Default no-op. */
  protected async prepareLaunch(): Promise<void> {}

  /** Host-side teardown after the emulator stops (e.g. restore config touched by
   *  prepareLaunch). Default no-op. Must be safe to call when nothing was
   *  prepared. */
  protected onStopCleanup(): void {}

  /** child_process stdio mode. Default 'ignore'; a subclass can capture output. */
  protected spawnStdio(): StdioOptions {
    return 'ignore'
  }

  /** Message when the emulator process exits before the harness connects.
   *  Overridable so a backend can add a hint for its common cause (Mesen: a
   *  second instance forwarding its args to an already-open Mesen and exiting). */
  protected earlyExitMessage(code: number | null): string {
    return `${this.label} exited before connecting (exit code ${code})`
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  isRunning(): boolean {
    return this.child !== null && !this.child.killed && this.client !== null
  }

  async ensureRunning(): Promise<void> {
    if (this.isRunning()) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this.start().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  private async start(): Promise<void> {
    const exe = this.resolveExe()
    const harness = this.harnessScriptPath()

    // The emulator must boot the BUILT ROM (carries the editor debug-hook patch
    // from Custom/Asar_Patches_YI.asm). Extraction state tells us which ROM
    // version was built.
    const state = readExtractionState(frameworkWorkRoot())
    if (!state) {
      throw new Error('No extraction state — run Extract first.')
    }
    // Boot the active project's built ROM (falls back to the base build dir if
    // the project hasn't been built yet).
    const sfcName = outputSfcName(state.romVersion)
    const cart = join(builtArtifactDir(getCurrentProjectId(), sfcName), sfcName)

    if (!exe) {
      throw new Error(`${this.label} not located — click "Locate ${this.label}".`)
    }
    if (!existsSync(exe)) {
      // Vanished between resolve and spawn — forget it (if saved) so the toolbar
      // offers re-location rather than repeatedly failing on a dead path.
      this.forgetPathIfSaved(exe)
      throw new Error(`${this.label} not found at ${exe}`)
    }
    if (!existsSync(harness)) throw new Error(`Harness Lua not found at ${harness}`)
    if (!existsSync(cart)) {
      throw new Error(`Built ROM not found at ${cart} — run Build first.`)
    }

    // Bind a random localhost port, hand it to the emulator so its harness dials
    // in.
    await new Promise<void>((resolveListen, rejectListen) => {
      this.server = createServer((sock) => this.onConnection(sock))
      this.server.on('error', rejectListen)
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          resolveListen()
        } else {
          rejectListen(new Error('server.address() returned unexpected value'))
        }
      })
    })

    // Host-side pre-launch setup (Mesen: seed settings.json to enable the Lua
    // socket). If this throws, tear the half-bound server down before rethrowing.
    try {
      await this.prepareLaunch()
    } catch (err) {
      this.stop()
      throw err
    }

    const plan = this.buildSpawnPlan(exe, this.port, cart, harness)
    const child = spawn(exe, plan.args, {
      cwd: plan.cwd,
      stdio: this.spawnStdio(),
      detached: false,
      windowsHide: false,
      env: plan.env ? { ...process.env, ...plan.env } : process.env
    })
    this.child = child
    // Capture `child` in the closure: a stale OLD child can still emit 'exit'
    // AFTER stop() + start() has wired up a NEW child. Without this guard the
    // OLD process's exit would nuke the NEW server/port, breaking the NEW
    // emulator's connection.
    child.on('exit', (code) => {
      if (this.child !== child) return
      // eslint-disable-next-line no-console
      console.warn(`[${this.label}] emulator exited with code ${code}`)
      this.onStopCleanup()
      this.cleanup()
    })
    child.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`[${this.label}] spawn error:`, err)
      // A spawn error before the harness connects means this exe couldn't be
      // launched (bad path / not executable / wrong arch). If it's the user's
      // saved emulator, forget it so the toolbar reverts to "Locate <emulator>".
      // A post-connect error leaves the working path alone.
      if (!this.client) this.forgetPathIfSaved(exe)
    })

    // Wait for the harness Lua to dial in. Emulator + runtime + ROM load takes a
    // few seconds; give it generous slack. A spawn error or an early exit rejects
    // immediately; otherwise the timeout bounds a hung boot. On any failure, tear
    // the half-started process/server down so the next attempt starts clean.
    try {
      await this.waitForConnect(30_000, child)
    } catch (err) {
      this.stop()
      throw err
    }
  }

  private waitForConnect(timeoutMs: number, child: ChildProcess): Promise<void> {
    if (this.client) return Promise.resolve()
    return new Promise((resolveConn, rejectConn) => {
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.server?.off('connection', onConn)
        child.off('error', onErr)
        child.off('exit', onExit)
        fn()
      }
      const onConn = (): void => {
        if (this.client) finish(resolveConn)
      }
      const onErr = (err: Error): void =>
        finish(() => rejectConn(new Error(`Failed to launch ${this.label}: ${err.message}`)))
      const onExit = (code: number | null): void =>
        finish(() => rejectConn(new Error(this.earlyExitMessage(code))))
      const timer = setTimeout(
        () => finish(() => rejectConn(new Error(`${this.label} did not connect within ${timeoutMs}ms`))),
        timeoutMs
      )
      this.server!.on('connection', onConn)
      child.on('error', onErr)
      child.on('exit', onExit)
    })
  }

  private onConnection(socket: Socket): void {
    if (this.client) {
      // Reject duplicate connections — only one harness per emulator instance.
      socket.destroy()
      return
    }
    this.client = socket
    socket.setNoDelay(true)
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('close', () => {
      // Surfaced because a mid-session drop = the live link is dead until the
      // emulator is relaunched (the harness socket doesn't auto-reconnect). If
      // this fires on a screen transition, the harness loop died — see
      // shinyegg.lua's pcall guard.
      // eslint-disable-next-line no-console
      console.warn(`[${this.label}] harness socket closed - live link lost until relaunch`)
      this.client = null
      this.failPending(new Error(`${this.label} disconnected`))
    })
    socket.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[${this.label}] socket error:`, err.message)
    })
  }

  private onData(chunk: Buffer): void {
    this.rxBuf = this.rxBuf.length === 0 ? chunk : Buffer.concat([this.rxBuf, chunk])
    // Parse as many framed messages as possible from the accumulated buffer.
    while (this.rxBuf.length > 0) {
      const space = this.rxBuf.indexOf(0x20) // ' '
      if (space < 0) return // length prefix not yet complete
      const lenStr = this.rxBuf.subarray(0, space).toString('ascii')
      const len = parseInt(lenStr, 10)
      if (!Number.isFinite(len) || len < 0) {
        // eslint-disable-next-line no-console
        console.error(`[${this.label}] protocol error: bad length "${lenStr}"`)
        this.rxBuf = Buffer.alloc(0)
        return
      }
      const totalNeeded = space + 1 + len
      if (this.rxBuf.length < totalNeeded) return // body not yet complete
      const body = this.rxBuf.subarray(space + 1, totalNeeded)
      // Slice and advance. Copy the body because subarray shares memory and the
      // next concat could move things.
      const bodyCopy = Buffer.from(body)
      this.rxBuf = Buffer.from(this.rxBuf.subarray(totalNeeded))
      this.onFramedMessage(bodyCopy)
    }
  }

  private onFramedMessage(body: Buffer): void {
    // "RDY" is ALWAYS a heartbeat — no command reply is the literal 3 bytes
    // "RDY" (replies are "OK …"/"ERR …"/"PONG" or a known-length hex dump). So
    // we must check it BEFORE the awaiting branch: if a slow frame tripped the
    // harness's response timeout, the reply was lost and the next thing in is an
    // RDY — treating it as the awaited reply would resolve the caller with
    // garbage and desync the channel for good. Instead, fail the lost command
    // and resync.
    if (body.length === 3 && body.toString('ascii') === 'RDY') {
      if (this.awaiting) {
        const lost = this.awaiting
        this.awaiting = null
        lost.reject(new Error(`${this.label} reply lost (harness resynced)`))
      }
      this.pump()
      return
    }
    if (this.awaiting) {
      const cmd = this.awaiting
      this.awaiting = null
      cmd.resolve(body)
      // After the reply, the harness will tick again next frame with RDY.
      return
    }
    // eslint-disable-next-line no-console
    console.warn(`[${this.label}] unexpected unsolicited message:`, body.toString('utf8').slice(0, 60))
  }

  private pump(): void {
    if (!this.client) return
    const next = this.queue.shift()
    if (!next) {
      this.send('NOP')
      return
    }
    if (next.expectReply) this.awaiting = next
    this.send(next.command)
    if (!next.expectReply) next.resolve(Buffer.alloc(0))
  }

  // Send a command using the harness's required form: "<len> <body>".
  private send(cmd: string): void {
    if (!this.client) return
    const payload = `${cmd.length} ${cmd}`
    this.client.write(payload)
  }

  private enqueue(command: string, expectReply: boolean): Promise<Buffer> {
    return new Promise<Buffer>((res, rej) => {
      this.queue.push({ command, expectReply, resolve: res, reject: rej })
    })
  }

  private failPending(err: Error): void {
    if (this.awaiting) {
      this.awaiting.reject(err)
      this.awaiting = null
    }
    for (const p of this.queue) p.reject(err)
    this.queue.length = 0
  }

  private cleanup(): void {
    this.failPending(new Error(`${this.label} exited`))
    this.client?.destroy()
    this.client = null
    this.server?.close()
    this.server = null
    this.child = null
    this.port = 0
  }

  // ── Public command surface (shared across emulators) ────────────────────────

  async ping(): Promise<string> {
    await this.ensureRunning()
    const buf = await this.enqueue('PING', true)
    return buf.toString('utf8')
  }

  async info(): Promise<string> {
    await this.ensureRunning()
    const buf = await this.enqueue('INFO', true)
    return buf.toString('utf8')
  }

  async dumpVram(): Promise<Buffer> {
    await this.ensureRunning()
    const reply = await this.enqueue('DUMP_VRAM', true)
    return this.decodeHexReply(reply, 0x10000, 'dumpVram')
  }

  async dumpCgram(): Promise<Buffer> {
    await this.ensureRunning()
    const reply = await this.enqueue('DUMP_CGRAM', true)
    return this.decodeHexReply(reply, 0x0200, 'dumpCgram')
  }

  // Direct WRAM-stomp level load. The harness writes $7E:021A (level slot),
  // $7E:038C ($00 = world-map load type), and $7E:0118 ($0C = level loader),
  // then blocks until gm$0F is stable (load complete) or a safety timeout fires.
  // Returns "OK 0xXX frames=N boot=N warps=…" or "TIMEOUT 0xXX gm=0xYY …".
  //
  // `warps` (optional): after the world-map load completes, chain N sub-room
  // loads — for each entry, synthesize a 4-byte screen-exit record at $7F:7E00
  // and re-enter gm$0C with the warp-re-entry flag set. Used by Test Level to
  // reach sub-rooms + the Set-Spawn override (a single warp into the target at
  // the chosen cell, so the cart's entrance loader positions Yoshi AND builds
  // the destination region before control resumes).
  //
  // `inventory` (optional): Test Level egg/key counts ({ eggs, keys }, sum ≤ 6),
  // mapped to NorSpr sprite IDs (inventorySpriteIds) and appended as `INV …` so
  // the harness seeds Yoshi's egg trail before the (final) load. Empty-handed by
  // default.
  async loadLevel(
    translevelId: number,
    warps?: ReadonlyArray<BizhawkWarp>,
    inventory?: TestInventory
  ): Promise<string> {
    if (!Number.isInteger(translevelId) || translevelId < 0 || translevelId > 0xff) {
      throw new Error(`loadLevel: translevelId must be 0..255, got ${translevelId}`)
    }
    await this.ensureRunning()
    let cmd = `LOAD_LEVEL ${hex(translevelId)}`
    for (const [i, w] of (warps ?? []).entries()) {
      for (const k of ['destLevelRecordId', 'destX', 'destY', 'entranceType'] as const) {
        const v = w[k]
        if (!Number.isInteger(v) || v < 0 || v > 0xff) {
          throw new Error(`loadLevel: warps[${i}].${k} must be 0..255, got ${v}`)
        }
      }
      cmd += ` WARP ${hex(w.destLevelRecordId)} ${hex(w.destX)} ${hex(w.destY)} ${hex(w.entranceType)}`
    }
    const invIds = inventorySpriteIds(inventory)
    if (invIds.length > 0) cmd += ` INV ${invIds.map((id) => hex(id)).join(' ')}`
    const buf = await this.enqueue(cmd, true)
    return buf.toString('utf8')
  }

  // Generic memory-read primitive. `domain` is a portable domain name ("WRAM" /
  // "CARTRAM" / "VRAM" / "CGRAM" / "OAM" / "CARTROM"); the harness maps it to the
  // emulator's own memory-type. `addr` is the offset within that domain (NOT a
  // 24-bit SNES address); `len` is the byte count. Returns the raw bytes (reply
  // hex-decoded — the harness can't put raw binary on the socket).
  async readMem(domain: string, addr: number, len: number): Promise<Buffer> {
    if (!Number.isInteger(addr) || addr < 0) {
      throw new Error(`readMem: addr must be non-negative integer, got ${addr}`)
    }
    if (!Number.isInteger(len) || len <= 0 || len > 0x10000) {
      throw new Error(`readMem: len must be 1..65536, got ${len}`)
    }
    await this.ensureRunning()
    const addrHex = addr.toString(16)
    const lenHex = len.toString(16)
    const reply = await this.enqueue(`READ_MEM ${domain} ${addrHex} ${lenHex}`, true)
    return this.decodeHexReply(reply, len, `readMem ${domain} 0x${addrHex}`)
  }

  /** Decode a harness HEX reply (READ_MEM / DUMP_*) back to raw bytes. The
   *  harness hex-encodes every binary reply because the Lua socket layer
   *  UTF-8-mangles raw bytes >= 0x80 (see shinyegg.lua `toHex`). Throws on an
   *  "ERR …" reply or a decoded length that doesn't match what was requested. */
  private decodeHexReply(reply: Buffer, expectedLen: number, what: string): Buffer {
    const text = reply.toString('ascii')
    if (text.startsWith('ERR')) throw new Error(`${what}: ${text.slice(4).trim()}`)
    const out = Buffer.from(text, 'hex')
    if (out.length !== expectedLen) {
      throw new Error(`${what}: expected ${expectedLen} bytes, decoded ${out.length}`)
    }
    return out
  }

  // Generic memory-WRITE primitive — the editor's pathway to edit the RUNNING
  // game's memory without a rebuild (the write twin of `readMem`). `domain` /
  // `addr` are as in `readMem`; `bytes` are written sequentially from `addr`,
  // hex-encoded into the (text) command. Boots the emulator if not running, like
  // `readMem` — callers that must NOT boot (live-edit pushes) gate on
  // `isRunning()` first. Returns the harness reply ("OK <n>"). First consumer:
  // live palette edits (see the CGRAM-mirror write in ipc/render.ts).
  async writeMem(domain: string, addr: number, bytes: Uint8Array): Promise<string> {
    if (!Number.isInteger(addr) || addr < 0) {
      throw new Error(`writeMem: addr must be non-negative integer, got ${addr}`)
    }
    if (bytes.length > 0x10000) {
      throw new Error(`writeMem: byte count must be 0..65536, got ${bytes.length}`)
    }
    if (bytes.length === 0) return 'OK 0'
    await this.ensureRunning()
    const addrHex = addr.toString(16)
    let hexBytes = ''
    for (let i = 0; i < bytes.length; i++) hexBytes += bytes[i]!.toString(16).padStart(2, '0')
    const buf = await this.enqueue(`WRITE_MEM ${domain} ${addrHex} ${hexBytes}`, true)
    return buf.toString('utf8')
  }

  // Single-frame camera teleport + capture. Known-working approach: teleport
  // Yoshi to screen center, re-write camera each frame for a short settle so the
  // game's smoothing logic converges to our target, then screenshot. Reports
  // back actual WRAM values so we can verify.
  async captureAt(x: number, y: number, path: string): Promise<string> {
    await this.ensureRunning()
    const buf = await this.enqueue(`CAPTURE_AT ${x} ${y} ${path}`, true)
    return buf.toString('utf8')
  }

  stop(): void {
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        /* ignore */
      }
    }
    this.onStopCleanup()
    this.cleanup()
  }
}
