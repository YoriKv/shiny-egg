-- Shiny Egg <-> Mesen render harness.
--
-- The Mesen sibling of bizhawk-harness/shinyegg.lua. It speaks the IDENTICAL
-- framed TCP protocol to the editor's Node supervisor (see
-- src/main/emulator/supervisor-base.ts), so the entire Node side is shared
-- across both emulators — only the transport + emulator API differ here.
--
-- Loaded by the editor as `Mesen <cart.sfc> shinyegg.lua …` (see src/main/mesen.ts):
-- Mesen auto-runs a command-line Lua script, so this executes in a normal,
-- playable window. It connects a LuaSocket client back to the editor's TCP
-- server (host/port handed to us via the SHINY_EGG_HOST/PORT env vars) and
-- drives the game each emulated frame from Mesen's `endFrame` event callback.
--
-- Three big differences from the BizHawk harness, all handled below:
--
--  1. Transport. BizHawk's `comm` socket dials in from `--socket_ip/--socket_port`
--     and auto-frames sends. Here we open a raw LuaSocket client and do the
--     "<len> <body>" framing ourselves — chosen to match BizHawk's wire format
--     byte-for-byte so the Node parser is unchanged.
--  2. Frame model. BizHawk lets the script own a `while true … emu.frameadvance()`
--     loop and block inside command handlers. Mesen drives the frame loop and
--     calls us once per frame via `endFrame`; we may NOT frameadvance. So every
--     multi-frame command (LOAD_LEVEL, CAPTURE_AT) is a per-frame state machine
--     (`op`), advanced one step per callback (the load-level machine is a port of
--     yi-shiny trace-harness/framework/load_level.lua).
--  3. Memory access. BizHawk domain names → Mesen `emu.memType`. YI runtime state
--     in CARTRAM ($70:xxxx) is read/written through the CPU bus (`snesMemory` at
--     $70_0000 + off) — the proven yi-shiny approach — not a relative saveRam
--     offset. WRAM/VRAM/CGRAM/OAM use their dedicated memTypes at a relative
--     offset (matching the BizHawk domain semantics).
--
-- Wire format (both directions): "<len> " + N payload bytes. Each idle frame we
-- send "RDY"; the editor answers with "NOP" or one command; a command's single
-- reply is "OK …" / "ERR …" / "PONG" / a hex dump. Binary replies are HEX
-- (2 ASCII chars/byte) because the socket layer mangles raw bytes >= 0x80.

-- Log lifecycle events + errors via displayMessage (an on-screen OSD toast AND,
-- under `--enablestdout`, stdout) so a failed connect is visible without opening
-- the Script log window; mirror to emu.log for the log window too. Only called on
-- lifecycle/error/load-complete events, never per-frame, so no OSD spam.
local function log(msg)
  pcall(emu.displayMessage, "ShinyEgg", tostring(msg))
  pcall(emu.log, "[shinyegg] " .. tostring(msg))
end

-- ── Transport ────────────────────────────────────────────────────────────────

local RECV_TIMEOUT = 2.0 -- seconds; the editor always answers an RDY promptly,
                         -- so this is only a stall backstop, never the norm.

local socketMod
do
  local ok, mod = pcall(require, "socket.core")
  if not ok then
    log("FATAL: LuaSocket unavailable — the launcher must pass "
      .. "--Debug.ScriptWindow.AllowIoOsAccess=true and AllowNetworkAccess=true. (" .. tostring(mod) .. ")")
    return
  end
  socketMod = mod
end

local host = os.getenv("SHINY_EGG_HOST") or "127.0.0.1"
local port = tonumber(os.getenv("SHINY_EGG_PORT") or "")
if not port then
  log("FATAL: SHINY_EGG_PORT not set — cannot connect back to the editor.")
  return
end

local client = socketMod.tcp()
if not client then
  log("FATAL: could not create TCP socket.")
  return
end
client:settimeout(RECV_TIMEOUT)
do
  -- The editor's server is already listening (bound before Mesen was spawned),
  -- so connect succeeds immediately; retry a few times just in case the script
  -- window opens a hair before the bind is visible.
  local connected = false
  for _ = 1, 20 do
    local ok, err = client:connect(host, port)
    if ok or err == "already connected" then connected = true; break end
    client:settimeout(RECV_TIMEOUT)
  end
  if not connected then
    log("FATAL: could not connect to editor at " .. host .. ":" .. port)
    return
  end
end
log("connected to editor at " .. host .. ":" .. port)

local linkAlive = true

-- Send one logical message, framed "<len> <body>", looping over partial sends
-- (a 128 KB VRAM hex dump won't fit one socket buffer).
local function send(body)
  local data = tostring(#body) .. " " .. body
  local i = 1
  while i <= #data do
    local sent, err, partial = client:send(data, i)
    if sent then
      i = sent + 1
    else
      if partial and partial > 0 then i = partial + 1 end
      if err == "closed" then
        linkAlive = false
        return false
      elseif err ~= "timeout" then
        return false
      end
    end
  end
  return true
end

-- Blocking read of exactly one framed message ("<len> <body>"). Returns the body
-- string, or nil on timeout/close (the editor always replies to an RDY, so a
-- timeout means a genuine stall — recoverable, we just retry next frame). Only
-- ever called when idle (never while a multi-frame `op` is running), so it can't
-- stall an in-flight level load.
local function recvFrame()
  client:settimeout(RECV_TIMEOUT)
  local lenstr = ""
  while true do
    local c, err = client:receive(1)
    if not c then
      if err == "closed" then linkAlive = false end
      return nil
    end
    if c == " " then break end
    lenstr = lenstr .. c
    if #lenstr > 12 then return nil end
  end
  local len = tonumber(lenstr)
  if not len then return nil end
  if len == 0 then return "" end
  local body = ""
  while #body < len do
    local chunk, err, partial = client:receive(len - #body)
    if chunk then
      body = body .. chunk
    else
      if partial and #partial > 0 then body = body .. partial end
      if err == "closed" then linkAlive = false; return nil end
      if err == "timeout" then return nil end
    end
  end
  return body
end

-- ── Memory access ────────────────────────────────────────────────────────────
-- Map the editor's portable BizHawk-domain names to Mesen memTypes. CARTRAM
-- ($70) is reached through the CPU/GSU bus (snesMemory at $70_0000+off); the rest
-- use their dedicated memType at a relative offset (== the BizHawk domain offset).

local DOMAIN = {
  WRAM = { mt = emu.memType.snesWorkRam, base = 0 },
  CARTRAM = { mt = emu.memType.snesMemory, base = 0x700000 },
  VRAM = { mt = emu.memType.snesVideoRam, base = 0 },
  CGRAM = { mt = emu.memType.snesCgRam, base = 0 },
  OAM = { mt = emu.memType.snesSpriteRam, base = 0 }
}

local function rd8(domain, addr)
  local d = DOMAIN[domain]
  if not d then error("bad domain " .. tostring(domain)) end
  return emu.read(d.base + addr, d.mt, false) & 0xFF
end

local function wr8(domain, addr, val)
  local d = DOMAIN[domain]
  if not d then error("bad domain " .. tostring(domain)) end
  emu.write(d.base + addr, val & 0xFF, d.mt)
end

local function rd16(domain, addr)
  return rd8(domain, addr) | (rd8(domain, addr + 1) << 8)
end

local function wr16(domain, addr, val)
  wr8(domain, addr, val & 0xFF)
  wr8(domain, addr + 1, (val >> 8) & 0xFF)
end

-- Read `len` bytes from a domain, hex-encoded (2 ASCII chars/byte — see header).
local function readMemHex(domain, addr, len)
  local d = DOMAIN[domain]
  if not d then return nil, "bad domain " .. tostring(domain) end
  local parts = {}
  for i = 0, len - 1 do
    parts[i + 1] = string.format("%02x", emu.read(d.base + addr + i, d.mt, false) & 0xFF)
  end
  return table.concat(parts)
end

-- ── Egg-trail inventory (Test Level item presets) ────────────────────────────
-- Same between-level snapshot the BizHawk harness seeds: $7E:5D98 count (items*2)
-- + $7E:5D9A six NorSpr sprite-ID words. The level loader restores it onto
-- Yoshi's back on entry, then zeroes it — so re-stamp before every gm$0C load.
local INV_COUNT_ADDR = 0x5D98
local INV_TABLE_ADDR = 0x5D9A
local INV_MAX_ITEMS = 6

local function writeEggSnapshot(ids)
  local n = math.min(#ids, INV_MAX_ITEMS)
  wr16("WRAM", INV_COUNT_ADDR, n * 2)
  for k = 0, INV_MAX_ITEMS - 1 do
    wr16("WRAM", INV_TABLE_ADDR + k * 2, (k < n) and ids[k + 1] or 0)
  end
end

-- ── Level-load constants (mirror bizhawk-harness/shinyegg.lua) ──────────────────
local GM_ADDR = 0x0118 -- CurrentGameMode
local WORLD_ADDR = 0x0218 -- CurrentWorld (world index * 2)
local SLOT_ADDR = 0x021A -- CurrentLevelFromMap (map-tile slot)
local TYPE_ADDR = 0x038C -- WarpToScreenFlag (0 = world-map entry, 1 = warp)
local EXIT_IDX_ADDR = 0x038E -- screen-exit buffer index
local EXIT_BUF_OFF = 0x17E00 -- $7F:7E00 screen-exit record buffer (WRAM offset)
local GM_READY = 0x07 -- post-boot title stall
local GM_OW_PREP = 0x20 -- prepare overworld
local GM_OW = 0x22 -- overworld active (defeat-theme SPC block resident)
local GM_LOAD = 0x0C -- level loader
local GM_PLAY = 0x0F -- in-level main loop

local BOOT_TIMEOUT = 3600
local SETTLE_FRAMES = 30
local OW_TIMEOUT = 600
local LOAD_TIMEOUT = 600
local STABLE_TICKS = 4

-- ── Multi-frame op machinery ──────────────────────────────────────────────────
-- Exactly one `op` runs at a time (the editor awaits each command's reply before
-- sending another). Each `op` is { step = fn }; `step` is called once per frame
-- and calls finishOp(reply) when done (which sends the framed reply the editor's
-- `awaiting` resolves).
local op = nil

local function finishOp(reply)
  op = nil
  send(reply)
  log(reply)
end

-- LOAD_LEVEL state machine — port of bizhawk-harness/shinyegg.lua's loadLevel +
-- yi-shiny load_level.lua, as per-frame phases:
--   reboot → settle → overworld → level → (warp)* → done
-- WHY the overworld detour: a level's death/defeat jingle lives in an SPC block
-- only the overworld's music set uploads; a straight gm$0C skips it and the SPC
-- driver hangs when the death song plays. Bouncing through gm$20→gm$22 first
-- loads it. (Full diagnosis: yi-shiny scenarios/spike-audio/PLAN.md.)
local function makeLoadOp(id, warps, invIds)
  return {
    phase = "reboot",
    frame = 0, -- frames spent in the current phase
    bootFrames = 0,
    levelFrames = 0,
    gm0fFirst = nil, -- first frame gm$0F was seen (for the stable-hold check)
    warpIdx = 0,
    warpTotals = {},
    step = function(self)
      local gm = rd8("WRAM", GM_ADDR)

      if self.phase == "reboot" then
        if self.frame == 0 then
          -- Force the boot chain from a clean post-init state. Injecting gm$0C
          -- into an arbitrary mid-game gm crashes the loader; gm$00 re-inits PPU/
          -- CGRAM/OAM and auto-advances to gm$07.
          wr8("WRAM", GM_ADDR, 0x00)
          wr8("WRAM", GM_ADDR + 1, 0x00)
          self.frame = 1
          return
        end
        self.bootFrames = self.bootFrames + 1
        if gm >= GM_READY then
          self.phase = "settle"; self.frame = 0; return
        end
        if self.bootFrames >= BOOT_TIMEOUT then
          finishOp(string.format("TIMEOUT 0x%02X boot gm=0x%02X frames=%d", id, gm, self.bootFrames))
        end
        return
      end

      if self.phase == "settle" then
        self.frame = self.frame + 1
        if self.frame >= SETTLE_FRAMES then
          -- Enter the world-1 overworld so its music set uploads the defeat block.
          wr8("WRAM", WORLD_ADDR, 0x00); wr8("WRAM", WORLD_ADDR + 1, 0x00)
          wr8("WRAM", SLOT_ADDR, id); wr8("WRAM", SLOT_ADDR + 1, 0x00)
          wr8("WRAM", TYPE_ADDR, 0x00); wr8("WRAM", TYPE_ADDR + 1, 0x00)
          wr8("WRAM", GM_ADDR, GM_OW_PREP)
          self.phase = "overworld"; self.frame = 0
        end
        return
      end

      if self.phase == "overworld" then
        self.frame = self.frame + 1
        if gm == GM_OW or self.frame >= OW_TIMEOUT then
          -- Seed + kick the real level load. CurrentWorld = (id/12)*2 so the
          -- loader pulls the level's own world tilesets/palettes.
          local worldByte = math.floor(id / 12) * 2
          wr8("WRAM", WORLD_ADDR, worldByte); wr8("WRAM", WORLD_ADDR + 1, 0x00)
          wr8("WRAM", SLOT_ADDR, id); wr8("WRAM", SLOT_ADDR + 1, 0x00)
          wr8("WRAM", TYPE_ADDR, 0x00); wr8("WRAM", TYPE_ADDR + 1, 0x00)
          writeEggSnapshot(invIds)
          wr8("WRAM", GM_ADDR, GM_LOAD)
          self.phase = "level"; self.frame = 0; self.gm0fFirst = nil
        end
        return
      end

      if self.phase == "level" or self.phase == "warp" then
        self.frame = self.frame + 1
        if gm == GM_PLAY then
          if self.gm0fFirst == nil then
            self.gm0fFirst = self.frame
          elseif (self.frame - self.gm0fFirst) >= STABLE_TICKS then
            if self.phase == "level" then
              self.levelFrames = self.frame
            else
              self.warpTotals[#self.warpTotals + 1] = self.frame
            end
            -- Advance to the next warp hop, or finish.
            self.warpIdx = self.warpIdx + 1
            local w = warps[self.warpIdx]
            if not w then
              local summary = (#self.warpTotals == 0) and "0" or table.concat(self.warpTotals, "+")
              finishOp(string.format("OK 0x%02X frames=%d boot=%d warps=%s",
                id, self.levelFrames, self.bootFrames, summary))
              return
            end
            -- Synthesize a screen-exit record + re-enter gm$0C (warp re-entry).
            wr8("WRAM", EXIT_BUF_OFF + 0, w.dest)
            wr8("WRAM", EXIT_BUF_OFF + 1, w.x)
            wr8("WRAM", EXIT_BUF_OFF + 2, w.y)
            wr8("WRAM", EXIT_BUF_OFF + 3, w.ent)
            wr8("WRAM", TYPE_ADDR, 0x01); wr8("WRAM", TYPE_ADDR + 1, 0x00)
            wr8("WRAM", EXIT_IDX_ADDR, 0x00); wr8("WRAM", EXIT_IDX_ADDR + 1, 0x00)
            writeEggSnapshot(invIds)
            wr8("WRAM", GM_ADDR, GM_LOAD)
            self.phase = "warp"; self.frame = 0; self.gm0fFirst = nil
            return
          end
        else
          self.gm0fFirst = nil
        end
        if self.frame >= LOAD_TIMEOUT then
          if self.phase == "level" then
            finishOp(string.format("TIMEOUT 0x%02X gm=0x%02X frames=%d boot=%d",
              id, gm, self.frame, self.bootFrames))
          else
            finishOp(string.format("TIMEOUT 0x%02X warp hop=%d gm=0x%02X frames=%d",
              id, self.warpIdx, gm, self.frame))
          end
        end
        return
      end
    end
  }
end

-- CAPTURE_AT state machine — port of the BizHawk CAPTURE_AT camera pin. Teleports
-- Yoshi to screen-center and re-pins camera + player each frame so the game's
-- smoothing converges to our target, then screenshots to `path`. (Mesen has no
-- Lua OBJ-layer toggle, so unlike BizHawk the shot includes sprites.)
local CAP_MAX_FRAMES = 60
local function makeCaptureOp(x, y, path)
  return {
    frame = 0,
    stable = 0,
    saved = {
      cam39 = rd16("CARTRAM", 0x0039), cam3B = rd16("CARTRAM", 0x003B),
      subX = rd16("CARTRAM", 0x008A), yX = rd16("CARTRAM", 0x008C),
      subY = rd16("CARTRAM", 0x008E), yY = rd16("CARTRAM", 0x0090),
      ex94 = rd16("CARTRAM", 0x0094), ex96 = rd16("CARTRAM", 0x0096)
    },
    step = function(self)
      -- Pin player (screen-centered on the target) + camera every frame.
      wr16("CARTRAM", 0x008A, 0); wr16("CARTRAM", 0x008C, x + 128)
      wr16("CARTRAM", 0x008E, 0); wr16("CARTRAM", 0x0090, y + 112)
      wr16("CARTRAM", 0x0039, x); wr16("CARTRAM", 0x003B, y)
      wr16("CARTRAM", 0x0094, x); wr16("CARTRAM", 0x0096, y)
      self.frame = self.frame + 1
      if rd16("CARTRAM", 0x0094) == x and rd16("CARTRAM", 0x0096) == y then
        self.stable = self.stable + 1
      else
        self.stable = 0
      end
      if self.stable >= 2 or self.frame >= CAP_MAX_FRAMES then
        local png = emu.takeScreenshot()
        local ok = false
        if png then
          local f = io.open(path, "wb")
          if f then f:write(png); f:close(); ok = true end
        end
        local actCam = rd16("CARTRAM", 0x0039)
        local actEx = rd16("CARTRAM", 0x0094)
        local actYX = rd16("CARTRAM", 0x008C)
        local actYY = rd16("CARTRAM", 0x0090)
        -- Restore what we clobbered.
        local s = self.saved
        wr16("CARTRAM", 0x0039, s.cam39); wr16("CARTRAM", 0x003B, s.cam3B)
        wr16("CARTRAM", 0x0094, s.ex94); wr16("CARTRAM", 0x0096, s.ex96)
        wr16("CARTRAM", 0x008A, s.subX); wr16("CARTRAM", 0x008C, s.yX)
        wr16("CARTRAM", 0x008E, s.subY); wr16("CARTRAM", 0x0090, s.yY)
        if ok then
          finishOp(string.format("OK wrote=(%d,%d) cam39=(%d) cam94=(%d) yoshi=(%d,%d) %s",
            x, y, actCam, actEx, actYX, actYY, path))
        else
          finishOp("ERR capture_at could not write screenshot to " .. tostring(path))
        end
      end
    end
  }
end

-- ── Command dispatch ─────────────────────────────────────────────────────────

local function parseLoadLevel(arg)
  local tokens = {}
  for t in arg:gmatch("%S+") do tokens[#tokens + 1] = t end
  local id = tonumber(tokens[1], 16)
  if not id or id < 0 or id > 0xFF then
    return nil, "bad level id: " .. tostring(arg)
  end
  local warps, invIds = {}, {}
  local i = 2
  while tokens[i] do
    if tokens[i] == "INV" then
      i = i + 1
      while tokens[i] do
        local sid = tonumber(tokens[i], 16)
        if not sid then return nil, "bad INV sprite id: " .. tostring(tokens[i]) end
        invIds[#invIds + 1] = sid
        i = i + 1
      end
      break
    end
    if tokens[i] ~= "WARP" then return nil, "unknown token: " .. tostring(tokens[i]) end
    local dest, x, y, ent = tonumber(tokens[i + 1] or "", 16), tonumber(tokens[i + 2] or "", 16),
      tonumber(tokens[i + 3] or "", 16), tonumber(tokens[i + 4] or "", 16)
    if not (dest and x and y and ent) then return nil, "WARP needs 4 hex bytes" end
    warps[#warps + 1] = { dest = dest, x = x, y = y, ent = ent }
    i = i + 5
  end
  return id, warps, invIds
end

local function dispatch(cmd)
  if cmd == nil or cmd == "" or cmd == "NOP" then return end

  local space = cmd:find(" ", 1, true)
  local name = space and cmd:sub(1, space - 1) or cmd
  local rest = space and cmd:sub(space + 1) or ""

  if name == "PING" then
    send("PONG")
  elseif name == "INFO" then
    local frame = 0
    pcall(function() frame = emu.getState().frameCount or 0 end)
    send(string.format("core=mesen frame=%d", frame))
  elseif name == "DUMP_VRAM" then
    local hexs, err = readMemHex("VRAM", 0, 0x10000)
    send(hexs or ("ERR " .. tostring(err)))
  elseif name == "DUMP_CGRAM" then
    local hexs, err = readMemHex("CGRAM", 0, 0x0200)
    send(hexs or ("ERR " .. tostring(err)))
  elseif name == "DUMP_OAM" then
    local hexs, err = readMemHex("OAM", 0, 0x0220)
    send(hexs or ("ERR " .. tostring(err)))
  elseif name == "READ_MEM" then
    -- READ_MEM <domain> <hex-addr> <hex-len>
    local dom, addrHex, lenHex = rest:match("^(%S+)%s+(%S+)%s+(%S+)$")
    local addr, len = tonumber(addrHex or "", 16), tonumber(lenHex or "", 16)
    if not (dom and addr and len) then
      send("ERR read_mem bad args")
    else
      local hexs, err = readMemHex(dom, addr, len)
      send(hexs or ("ERR " .. tostring(err)))
    end
  elseif name == "WRITE_MEM" then
    -- WRITE_MEM <domain> <hex-addr> <hex-bytes>
    local dom, addrHex, hexBytes = rest:match("^(%S+)%s+(%S+)%s+(%S*)$")
    local addr = tonumber(addrHex or "", 16)
    if not (dom and addr) or (#hexBytes % 2 ~= 0) then
      send("ERR write_mem bad args")
    else
      local ok, err = pcall(function()
        local n = #hexBytes // 2
        for k = 0, n - 1 do
          local byte = tonumber(hexBytes:sub(k * 2 + 1, k * 2 + 2), 16)
          if not byte then error("bad hex byte at index " .. k) end
          wr8(dom, addr + k, byte)
        end
        return n
      end)
      if ok then send(string.format("OK %d", #hexBytes // 2))
      else send("ERR write_mem " .. tostring(err)) end
    end
  elseif name == "LOAD_LEVEL" then
    local id, warps, invIds = parseLoadLevel(rest)
    if not id then
      send("ERR " .. tostring(warps)) -- `warps` holds the error message here
    else
      op = makeLoadOp(id, warps, invIds) -- reply sent when the machine completes
    end
  elseif name == "CAPTURE_AT" then
    -- CAPTURE_AT <x> <y> <path>
    local xs, ys, path = rest:match("^(%S+)%s+(%S+)%s+(.+)$")
    local x, y = tonumber(xs or "", 10), tonumber(ys or "", 10)
    if not (x and y and path) then
      send("ERR capture_at bad args")
    else
      op = makeCaptureOp(x, y, path) -- reply sent when the machine completes
    end
  else
    send("ERR unknown " .. tostring(name))
  end
end

-- ── Per-frame tick ────────────────────────────────────────────────────────────

local function tick()
  if not linkAlive then return end
  -- A multi-frame op (level load / capture) is in progress: advance it and send
  -- nothing else — the editor is awaiting its reply, not an RDY heartbeat.
  if op then
    op:step()
    return
  end
  -- Idle: heartbeat, then read the editor's answer (NOP or one command).
  if not send("RDY") then return end
  local cmd = recvFrame()
  if cmd then dispatch(cmd) end
end

-- Mesen forbids frameadvance in callbacks (it drives the loop); the endFrame
-- event is our once-per-frame tick. pcall so a transient error (a slow-frame
-- socket read, a bad command) logs and retries next frame instead of tearing the
-- link down — the self-healing the BizHawk harness gets from its loop's pcall.
emu.addEventCallback(function()
  local ok, err = pcall(tick)
  if not ok then log("tick error (recovering): " .. tostring(err)) end
end, emu.eventType.endFrame)

log("harness loaded, awaiting commands")
