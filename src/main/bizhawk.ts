// Managed BizHawk subprocess for the editor's render harness.
//
// Spawns EmuHawk.exe once, kept alive across requests. Communicates over a
// localhost TCP socket using the simple framed protocol implemented in
// snes-framework/bizhawk-harness/render.lua (see that file for wire format).
//
// Public surface: ensureRunning(), dumpVram(), dumpCgram(), ping(), info(),
// stop(). The supervisor owns the lifecycle — first call to any method boots
// BizHawk, subsequent calls reuse the running instance.
//
// Path policy: the user picks EmuHawk.exe via the "Locate BizHawk" button
// (persisted in settings as `bizhawkPath`). In dev, `../bizhawk/EmuHawk.exe`
// next to the project root is used automatically if present (devBizhawkPath) —
// the mirror of the dev reference-cart convenience — so neither the button nor a
// per-user save is needed during development.

import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { outputSfcName } from 'snes-framework/rom-versions'
import { readExtractionState } from 'snes-framework/state'
import { bizhawkExeName, builtArtifactDir, devBizhawkPath, frameworkWorkRoot } from './framework-paths'
import { getCurrentProjectId } from './projects'
import { getSettings } from './settings'
import type { BizhawkWarp, TestInventory } from '../shared/ipc-types'
import { hex } from 'snes-framework/hex'

// Test Level item presets → the NorSpr sprite IDs seeded onto Yoshi's egg
// trail. The trail caps at 6 items (eggs + keys share the slots; the cart's
// CODE_03BEB9 drops the oldest past 6), so a key takes one of the six. Green
// egg ($25) is the standard trailing egg the game's own FullEggSpawner uses;
// the carryable key is $27. The Lua harness writes these into the between-level
// inventory snapshot the level loader restores on entry (see render.lua).
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

/**
 * Resolve the EmuHawk.exe path: the saved location first (if it still exists),
 * then the dev-only `../bizhawk/EmuHawk.exe` fallback, else null when BizHawk
 * hasn't been located yet. The renderer reads this (via `bizhawk:getExe`) to
 * decide whether to show Launch / Test Level or the "Locate BizHawk" button.
 */
export function resolveBizhawkExe(): string | null {
  const saved = getSettings().bizhawkPath
  if (saved && existsSync(saved)) return saved
  return devBizhawkPath() // dev-only, existence-checked; null in packaged builds
}

// Harness Lua lives at the repo root in <repo>/bizhawk-harness/render.lua
// (kept out of snes-framework/ so that folder stays asm-only). In dev,
// __dirname after build is <repo>/out/main — walk up two. In packaged
// builds, it ships via electron-builder extraResources at
// <process.resourcesPath>/bizhawk-harness/render.lua.
function harnessLuaPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bizhawk-harness', 'render.lua')
  }
  return resolve(__dirname, '..', '..', 'bizhawk-harness', 'render.lua')
}

interface PendingCommand {
  command: string
  // If > 0, the response is a binary payload of this length; resolve gets
  // the Buffer. If 0, the command has no reply and resolves immediately
  // after dispatch.
  expectReply: boolean
  resolve: (data: Buffer) => void
  reject: (err: Error) => void
}

class BizHawkSupervisor {
  private server: Server | null = null
  private port = 0
  private client: Socket | null = null
  private child: ChildProcess | null = null
  private rxBuf: Buffer = Buffer.alloc(0)
  private queue: PendingCommand[] = []
  // The command we last dispatched and are awaiting a reply for. When set,
  // the next inbound framed message is the reply (not another RDY).
  private awaiting: PendingCommand | null = null
  private startPromise: Promise<void> | null = null

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
    const exe = resolveBizhawkExe()
    const lua = harnessLuaPath()

    // BizHawk must boot the BUILT ROM (which carries the editor debug-hook
    // patch from Custom/Asar_Patches_YI.asm). Extraction state tells us
    // which ROM version was built.
    const state = readExtractionState(frameworkWorkRoot())
    if (!state) {
      throw new Error('No extraction state — run Extract first.')
    }
    // Boot the active project's built ROM (falls back to the base build dir if
    // the project hasn't been built yet).
    const sfcName = outputSfcName(state.romVersion)
    const cart = join(builtArtifactDir(getCurrentProjectId(), sfcName), sfcName)

    if (!exe) {
      throw new Error(`BizHawk not located — click "Locate BizHawk" and select ${bizhawkExeName()}.`)
    }
    if (!existsSync(exe)) throw new Error(`BizHawk not found at ${exe}`)
    if (!existsSync(lua)) throw new Error(`Harness Lua not found at ${lua}`)
    if (!existsSync(cart)) {
      throw new Error(`Built ROM not found at ${cart} — run Build first.`)
    }

    // Bind a random localhost port, hand it to BizHawk so it dials in.
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

    const args = [
      `--socket_ip=127.0.0.1`,
      `--socket_port=${this.port}`,
      `--lua=${lua}`,
      cart
    ]
    // On Linux/macOS `exe` is BizHawk's EmuHawk.sh launcher (shebang script that
    // bootstraps the .NET runtime); direct spawn works as long as it's
    // executable, and the --socket_ip/--socket_port/--lua/<cart> args are
    // identical across platforms. Untested on this machine (no Linux BizHawk
    // install) — verify on a Linux box.
    const child = spawn(exe, args, {
      cwd: join(exe, '..'),
      stdio: 'ignore',
      detached: false,
      windowsHide: false
    })
    this.child = child
    // Capture `child` in the closure: a stale OLD child can still emit
    // 'exit' AFTER stop() + start() has wired up a NEW child. Without
    // this guard the OLD process's exit would nuke the NEW server/port,
    // breaking the NEW EmuHawk's connection.
    child.on('exit', (code) => {
      if (this.child !== child) return
      // eslint-disable-next-line no-console
      console.warn(`[bizhawk] EmuHawk exited with code ${code}`)
      this.cleanup()
    })
    child.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[bizhawk] spawn error:', err)
    })

    // Wait for the harness Lua to dial in. BizHawk + .NET + ROM load takes
    // a few seconds; give it generous slack.
    await this.waitForConnect(30_000)
  }

  private waitForConnect(timeoutMs: number): Promise<void> {
    if (this.client) return Promise.resolve()
    return new Promise((resolveConn, rejectConn) => {
      const timer = setTimeout(() => {
        rejectConn(new Error(`BizHawk did not connect within ${timeoutMs}ms`))
      }, timeoutMs)
      const onTick = (): void => {
        if (this.client) {
          clearTimeout(timer)
          this.server!.off('connection', onTick)
          resolveConn()
        }
      }
      this.server!.on('connection', onTick)
    })
  }

  private onConnection(socket: Socket): void {
    if (this.client) {
      // Reject duplicate connections — only one harness per BizHawk instance.
      socket.destroy()
      return
    }
    this.client = socket
    socket.setNoDelay(true)
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('close', () => {
      // Surfaced because a mid-session drop = the live link is dead until EmuHawk
      // is relaunched (BizHawk's comm socket doesn't auto-reconnect). If this fires
      // on a screen transition, the harness loop died — see render.lua's pcall guard.
      // eslint-disable-next-line no-console
      console.warn('[bizhawk] harness socket closed - live link lost until relaunch')
      this.client = null
      this.failPending(new Error('BizHawk disconnected'))
    })
    socket.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn('[bizhawk] socket error:', err.message)
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
        console.error(`[bizhawk] protocol error: bad length "${lenStr}"`)
        this.rxBuf = Buffer.alloc(0)
        return
      }
      const totalNeeded = space + 1 + len
      if (this.rxBuf.length < totalNeeded) return // body not yet complete
      const body = this.rxBuf.subarray(space + 1, totalNeeded)
      // Slice and advance. Copy the body because subarray shares memory and
      // the next concat could move things.
      const bodyCopy = Buffer.from(body)
      this.rxBuf = Buffer.from(this.rxBuf.subarray(totalNeeded))
      this.onFramedMessage(bodyCopy)
    }
  }

  private onFramedMessage(body: Buffer): void {
    // "RDY" is ALWAYS a heartbeat — no command reply is the literal 3 bytes "RDY"
    // (replies are "OK …"/"ERR …"/"PONG" or a known-length binary dump). So we
    // must check it BEFORE the awaiting branch: if a slow frame tripped the
    // harness's response timeout, the reply was lost and the next thing in is an
    // RDY — treating it as the awaited reply would resolve the caller with garbage
    // and desync the channel for good. Instead, fail the lost command and resync.
    if (body.length === 3 && body.toString('ascii') === 'RDY') {
      if (this.awaiting) {
        const lost = this.awaiting
        this.awaiting = null
        lost.reject(new Error('BizHawk reply lost (harness resynced)'))
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
    console.warn('[bizhawk] unexpected unsolicited message:', body.toString('utf8').slice(0, 60))
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

  // Send a command using BizHawk's required form: "<len> <body>".
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
    this.failPending(new Error('BizHawk exited'))
    this.client?.destroy()
    this.client = null
    this.server?.close()
    this.server = null
    this.child = null
    this.port = 0
  }

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

  // Direct WRAM-stomp level load
  // Lua writes $7E:021A (level slot), $7E:038C ($00 = world-map
  // load type), and $7E:0118 ($0C = level loader), then blocks on
  // emu.frameadvance() until gm$0F is stable (load complete) or a 600-frame
  // safety timeout fires. Returns "OK 0xXX frames=N boot=N warp=N\n<state-dump>"
  // or "TIMEOUT 0xXX gm=0xYY frames=N". No asm patches required — works on
  // the byte-identical-to-reference build.
  //
  // `warps` (optional): after the world-map load completes, chain N
  // sub-room loads — for each entry, synthesize a 4-byte screen-exit
  // record at $7F:7E00 and re-enter gm$0C with the warp-re-entry flag
  // set. The cart loads the destination level as if Yoshi had taken a
  // warp pipe / door from the prior level. Used by Test Level to reach
  // sub-rooms not directly addressable from the world map, including
  // deep sub-rooms reachable only by chaining multiple warps. Test Level's
  // "Set Spawn" override also rides this: a single warp into the target at
  // the chosen cell, so the cart's entrance loader positions Yoshi AND
  // builds the destination region before control resumes (no post-load
  // teleport — that would leave the region un-paged and Yoshi falling).
  //
  // `inventory` (optional): Test Level egg/key counts ({ eggs, keys }, sum ≤ 6).
  // The supervisor maps them to NorSpr sprite IDs (inventorySpriteIds) and
  // appends `INV <id>...` so the Lua harness seeds Yoshi's egg trail before the
  // (final) load via the cart's between-level inventory snapshot. Defaults to
  // empty-handed.
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

  // Generic memory-read primitive. `domain` is a BizHawk memory-domain
  // name ("WRAM", "CARTRAM", "VRAM", "CGRAM", "OAM", "CARTROM", ...);
  // `addr` is the offset within that domain (NOT a 24-bit SNES address);
  // `len` is the byte count. Returns the raw bytes (reply hex-decoded via
  // `decodeHexReply` — the harness can't put raw binary on the socket).
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

  /** Decode a harness HEX reply (READ_MEM / DUMP_*) back to raw bytes. The harness
   *  hex-encodes every binary reply because comm.socketServerSend UTF-8-mangles raw
   *  bytes >= 0x80 (see render.lua `toHex`). Throws on an "ERR …" reply or a decoded
   *  length that doesn't match what was requested. */
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
  // hex-encoded into the (text) command. Boots EmuHawk if not running, like
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

  // Single-frame camera teleport + capture. Known-working approach:
  // teleport Yoshi to screen center, re-write camera each frame for 30
  // frames so the game's smoothing logic converges to our target, then
  // screenshot. Reports back actual WRAM values so we can verify.
  async captureAt(x: number, y: number, path: string): Promise<string> {
    await this.ensureRunning()
    const buf = await this.enqueue(`CAPTURE_AT ${x} ${y} ${path}`, true)
    return buf.toString('utf8')
  }

  stop(): void {
    if (this.child) {
      try { this.child.kill() } catch { /* ignore */ }
    }
    this.cleanup()
  }
}

let supervisor: BizHawkSupervisor | null = null

export function getBizHawk(): BizHawkSupervisor {
  if (!supervisor) supervisor = new BizHawkSupervisor()
  return supervisor
}

export type { BizHawkSupervisor }
