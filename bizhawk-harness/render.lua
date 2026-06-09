-- Shiny Egg <-> BizHawk render harness.
--
-- Spawned by the editor (src/main/bizhawk.ts) with --socket_ip + --socket_port
-- pointing at a TCP server the editor runs. Each emulated frame, this script
-- pings the editor with "RDY"; the editor replies with one of:
--
--   NOP                 -- do nothing this frame
--   PING                -- reply PONG (heartbeat sanity check)
--   DUMP_VRAM           -- reply with 65536 bytes of VRAM
--   DUMP_CGRAM          -- reply with 512 bytes of CGRAM
--   INFO                -- reply with a short text summary (core name, etc.)
--
-- Wire format
-- -----------
-- BizHawk -> editor:  every message is "<len> " + N bytes of payload.
--                     BizHawk's comm.socketServerSend auto-prefixes outgoing
--                     messages with their byte length and a space — so we
--                     must NOT add our own prefix, or every send arrives as
--                     two framed messages on the Node side.
--
-- editor -> BizHawk:  must use BizHawk's required form "<len> <body>" — the
--                     comm runtime strips the prefix before handing the body
--                     to comm.socketServerResponse(). So we just receive
--                     bare command strings here.

local function log(msg)
  console.log("[shinyegg] " .. tostring(msg))
end

-- Cache the connection state. socketServerIsConnected does a real check, but
-- we want to avoid spamming if BizHawk hasn't connected yet.
local function isReady()
  return comm.socketServerIsConnected()
end

-- Send one logical message. BizHawk's comm.socketServerSend automatically
-- wraps each call in its own "<len> <body>" frame on the wire — adding our
-- own prefix would cause every send to arrive on the Node side as TWO
-- framed messages (the false length-prefix string, then the real body).
-- Works for both ASCII and binary payloads (Lua strings are length-tagged
-- so embedded NULs are safe; comm.socketServerSend forwards raw bytes).
local function sendFramed(body)
  comm.socketServerSend(body)
end

local handlers = {}

handlers.PING = function()
  sendFramed("PONG")
end

handlers.INFO = function()
  local core = emu.getsystemid() or "?"
  local game = gameinfo.getromname() or "?"
  local fr = emu.framecount()
  sendFramed(string.format("core=%s rom=%s frame=%d", core, game, fr))
end

-- All bulk-memory dump commands work the same way: pick a (domain, length),
-- read it as a binary string, send framed. We never marshal byte arrays to
-- avoid the per-element overhead of Lua-table <-> .NET bridging.
local function dumpDomain(domain, length)
  local ok, payload = pcall(memory.read_bytes_as_binary_string, 0, length, domain)
  if not ok then
    sendFramed("ERR " .. tostring(payload))
    return
  end
  if #payload ~= length then
    sendFramed("ERR domain " .. domain .. " returned " .. tostring(#payload) .. " bytes, expected " .. tostring(length))
    return
  end
  sendFramed(payload)
end

handlers.DUMP_VRAM  = function() dumpDomain("VRAM",  0x10000) end  -- 64 KB
handlers.DUMP_CGRAM = function() dumpDomain("CGRAM", 0x0200) end   -- 512 B
handlers.DUMP_OAM   = function() dumpDomain("OAM",   0x0220) end   -- 544 B

-- LOAD_LEVEL <id-hex> [WARP <dest> <x> <y> <ent>]
--   id-hex is 1-2 hex digits (00..FF) — the cart translevel ID.
--   Direct WRAM stomp method (ported from yi-shiny's
--   trace-harness/scenarios/load-level/trace.lua, Mesen → BizHawk):
--     $7E:021A = level ID                (CurrentLevelFromMapLo, u16)
--     $7E:038C = $00                     (r_level_load_type = "world-map entry")
--     $7E:0118 = $0C                     (CurrentGameMode = level loader)
--   The dispatcher then runs gm$0C → $0D → $0E → $0F (in-level main loop)
--   on its own. This call BLOCKS in a frameadvance loop until gm$0F has
--   been stable for LOAD_STABLE_TICKS frames (load chain complete) or
--   the LOAD_TIMEOUT_FRAMES safety cap is hit.
--
--   With WARP <dest> <x> <y> <ent> (all hex bytes): after the world-map
--   load completes, synthesize a screen-exit warp record at $7F:7E00 and
--   re-enter gm$0C with $038C=1, $038E=0. The cart's CODE_01B029 /
--   CODE_01B05A path picks up our synthetic record and warps Yoshi into
--   the sub-room. Used by Test Level when the user is editing a level
--   that's reachable only via a warp from a main world-map slot
--   (sub-rooms, fortress boss arenas, etc.). Test Level's "Set Spawn"
--   override also rides this path: a single warp into the target at the
--   chosen cell, so the cart's entrance loader seeds Yoshi's position AND
--   builds the destination region (tilemap + collision) before control
--   resumes — no post-load teleport, no scroll-in glitch.
--
--   No asm patches required — the cart is byte-identical to reference
--   and Lua does all the dispatcher manipulation.
local LOAD_GAMEMODE_ADDR  = 0x0118
local LOAD_WORLD_ADDR     = 0x0218
local LOAD_LEVEL_SLOT_ADDR = 0x021A
local LOAD_TYPE_ADDR      = 0x038C
local LOAD_SCREENEXIT_IDX_ADDR = 0x038E      -- $038E byte-offset into the screen-exit buffer
local LOAD_SCREENEXIT_BUFFER_OFF = 0x17E00   -- $7F:7E00 = WRAM offset $17E00
local LOAD_GM0C           = 0x0C
local LOAD_GM0F           = 0x0F
-- gm$07 = post-boot cutscene tick. Per the yi-shiny Mesen reference and
-- empirical BizHawk testing, this is the canonical safe injection point
-- — gm$0C from gm$07 cleanly transitions to the level loader. From
-- anywhere later (file-select, world map, mid-level, or some undocumented
-- substate where gm$0118 holds e.g. $50), gm$0C may crash the loader
-- because pre-conditions it expects from the boot chain aren't met.
local LOAD_READY_GM       = 0x07
local LOAD_BOOT_TIMEOUT   = 3600   -- emulated-frame cap for cold boot (≤60s even if
                                   -- throttled; ~seconds now that the load runs unlocked)
local LOAD_SETTLE_FRAMES  = 30     -- match Mesen scenario's TITLE_STABLE_TICKS
local LOAD_TIMEOUT_FRAMES = 600
local LOAD_STABLE_TICKS   = 4

-- Frame-advance loop that returns once gm hits $0F and stays there for
-- LOAD_STABLE_TICKS frames, or times out. Used after both the initial
-- world-map load and any subsequent warp re-entry.
local function waitForLevelLoaded(timeoutFrames)
  local frames = 0
  local gm0f_first = nil
  while frames < timeoutFrames do
    emu.frameadvance()
    frames = frames + 1
    local gm = memory.read_u8(LOAD_GAMEMODE_ADDR, "WRAM")
    if gm == LOAD_GM0F then
      if gm0f_first == nil then
        gm0f_first = frames
      elseif (frames - gm0f_first) >= LOAD_STABLE_TICKS then
        return true, frames
      end
    else
      gm0f_first = nil
    end
  end
  return false, frames
end

local function loadLevel(arg)
  -- Parse: "<id-hex>" optionally followed by N repetitions of
  -- "WARP <dest> <x> <y> <ent>". Each WARP chains a sub-room load
  -- after the prior one completes (the cart reloads via gm$0C's
  -- screen-exit path; cf. CODE_01B029 / CODE_01B05A).
  local tokens = {}
  for t in arg:gmatch("%S+") do tokens[#tokens + 1] = t end
  local id = tonumber(tokens[1], 16)
  if not id or id < 0 or id > 0xFF then
    sendFramed("ERR bad level id: " .. tostring(arg))
    return
  end
  local warps = {}
  local i = 2
  while tokens[i] do
    if tokens[i] ~= "WARP" then
      sendFramed("ERR unknown token at " .. i .. ": " .. tostring(tokens[i]))
      return
    end
    if not (tokens[i + 1] and tokens[i + 2] and tokens[i + 3] and tokens[i + 4]) then
      sendFramed("ERR WARP needs 4 hex bytes (dest x y ent)")
      return
    end
    local w = {
      dest = tonumber(tokens[i + 1], 16),
      x    = tonumber(tokens[i + 2], 16),
      y    = tonumber(tokens[i + 3], 16),
      ent  = tonumber(tokens[i + 4], 16),
    }
    if not (w.dest and w.x and w.y and w.ent) then
      sendFramed("ERR bad WARP args at token " .. (i + 1))
      return
    end
    warps[#warps + 1] = w
    i = i + 5
  end

  emu.limitframerate(false)

  -- Force the cart back through the boot chain so gm$0C runs from a
  -- clean post-init state. Injecting into an arbitrary mid-game gm
  -- (e.g. menu substate $50) causes the level loader to crash 40-70
  -- frames in. Mesen sidesteps this because its one-shot trace script
  -- always runs from a fresh boot.
  --
  -- Why not client.reboot_core(): BizHawk processes it asynchronously,
  -- and our subsequent gm read returns the pre-reboot stale value;
  -- we have no clean way to know when the reboot has actually taken
  -- effect. Forcing gm=$00 directly is synchronous — the next
  -- dispatcher tick reads our $00 and runs gm$00's
  -- PrepareNintendoPresents handler, which re-inits PPU/CGRAM/OAM/BG3
  -- and auto-advances through the boot chain to gm$07.
  memory.write_u8(LOAD_GAMEMODE_ADDR,     0x00, "WRAM")
  memory.write_u8(LOAD_GAMEMODE_ADDR + 1, 0x00, "WRAM")

  -- Walk through the boot chain to gm$07. The cart's first
  -- dispatcher tick (one frameadvance from here) reads our $00 and
  -- runs gm$00; subsequent handlers self-advance through $01..$06
  -- and land at $07 in ~270 game frames (~1s wall at unlocked rate).
  local current_gm = memory.read_u8(LOAD_GAMEMODE_ADDR, "WRAM")
  local boot_frames = 0
  while current_gm < LOAD_READY_GM and boot_frames < LOAD_BOOT_TIMEOUT do
    emu.frameadvance()
    boot_frames = boot_frames + 1
    current_gm = memory.read_u8(LOAD_GAMEMODE_ADDR, "WRAM")
  end
  if current_gm < LOAD_READY_GM then
    emu.limitframerate(true)
    log(string.format("loadLevel 0x%02X: TIMEOUT in boot wait gm=0x%02X", id, current_gm))
    sendFramed(string.format("TIMEOUT 0x%02X boot gm=0x%02X frames=%d",
                              id, current_gm, boot_frames))
    return
  end
  for _ = 1, LOAD_SETTLE_FRAMES do emu.frameadvance() end

  -- CurrentWorld is stored as (world_index * 2) per Bank17.asm:4905
  -- (ASL ; STA pattern). World index = floor(id / 12) for the standard
  -- 6-world × 12-slot layout. Without this the level loader pulls
  -- world 1's tilesets/palettes regardless of the level data, so
  -- e.g. loading 6-1 ($3C) renders as world-1 graphics with world-6
  -- object layout — looks like "a completely different level".
  local world_byte = math.floor(id / 12) * 2
  memory.write_u8(LOAD_WORLD_ADDR,          world_byte, "WRAM")
  memory.write_u8(LOAD_WORLD_ADDR + 1,      0x00,       "WRAM")
  memory.write_u8(LOAD_LEVEL_SLOT_ADDR,     id,         "WRAM")
  memory.write_u8(LOAD_LEVEL_SLOT_ADDR + 1, 0x00,       "WRAM")
  memory.write_u8(LOAD_TYPE_ADDR,           0x00,       "WRAM")
  memory.write_u8(LOAD_TYPE_ADDR + 1,       0x00,       "WRAM")
  memory.write_u8(LOAD_GAMEMODE_ADDR,       LOAD_GM0C,  "WRAM")

  local loaded, frames = waitForLevelLoaded(LOAD_TIMEOUT_FRAMES)
  if not loaded then
    emu.limitframerate(true)
    local gm = memory.read_u8(LOAD_GAMEMODE_ADDR, "WRAM")
    log(string.format("loadLevel 0x%02X: TIMEOUT gm=0x%02X frames=%d boot=%d",
                      id, gm, frames, boot_frames))
    sendFramed(string.format("TIMEOUT 0x%02X gm=0x%02X frames=%d boot=%d",
                              id, gm, frames, boot_frames))
    return
  end

  -- Sub-room warp chain: for each warp record, synthesize a 4-byte
  -- screen-exit record at $7F:7E00 + 0 (the cart's screen-exit buffer)
  -- and re-enter gm$0C with $038C=1 + $038E=0. The cart's CODE_01B029 /
  -- CODE_01B05A path reads our record and warps Yoshi to the destination.
  -- Each hop trashes offset 0..3 of the destination's buffer, which is
  -- safe: the cart re-populates the buffer during every gm$0C load, so
  -- our overwrite only affects the immediate next load.
  local warpFrameTotals = {}
  for hopIdx, w in ipairs(warps) do
    memory.write_u8(LOAD_SCREENEXIT_BUFFER_OFF + 0, w.dest, "WRAM")
    memory.write_u8(LOAD_SCREENEXIT_BUFFER_OFF + 1, w.x,    "WRAM")
    memory.write_u8(LOAD_SCREENEXIT_BUFFER_OFF + 2, w.y,    "WRAM")
    memory.write_u8(LOAD_SCREENEXIT_BUFFER_OFF + 3, w.ent,  "WRAM")
    memory.write_u8(LOAD_TYPE_ADDR,                 0x01,   "WRAM")
    memory.write_u8(LOAD_TYPE_ADDR + 1,             0x00,   "WRAM")
    memory.write_u8(LOAD_SCREENEXIT_IDX_ADDR,       0x00,   "WRAM")
    memory.write_u8(LOAD_SCREENEXIT_IDX_ADDR + 1,   0x00,   "WRAM")
    memory.write_u8(LOAD_GAMEMODE_ADDR,             LOAD_GM0C, "WRAM")
    emu.limitframerate(false)
    local warpOk, wFrames = waitForLevelLoaded(LOAD_TIMEOUT_FRAMES)
    warpFrameTotals[#warpFrameTotals + 1] = wFrames
    if not warpOk then
      emu.limitframerate(true)
      local gm = memory.read_u8(LOAD_GAMEMODE_ADDR, "WRAM")
      log(string.format("loadLevel 0x%02X: WARP TIMEOUT hop=%d gm=0x%02X frames=%d",
                        id, hopIdx, gm, wFrames))
      sendFramed(string.format("TIMEOUT 0x%02X warp hop=%d gm=0x%02X frames=%d",
                                id, hopIdx, gm, wFrames))
      return
    end
  end

  emu.limitframerate(true)
  local warpSummary = #warpFrameTotals == 0 and "0" or table.concat(warpFrameTotals, "+")
  log(string.format("loadLevel 0x%02X: OK frames=%d boot=%d warps=%s",
                    id, frames, boot_frames, warpSummary))
  sendFramed(string.format("OK 0x%02X frames=%d boot=%d warps=%s",
                            id, frames, boot_frames, warpSummary))
end

-- Turbo for the headless level-load settle. `client.speedmode` is the
-- documented fast-forward control (scripts use it to run frameadvance loops at
-- max speed); dropping the framerate limit + sound removes the other throttle
-- gates that otherwise pace emulation to ~60 fps. Each call is pcall-guarded so
-- a BizHawk build missing one API degrades to normal speed rather than erroring.
-- Restored after the load so the user is back at normal speed.
local function setLoadTurbo(on)
  pcall(client.speedmode, on and 6399 or 100)
  pcall(emu.limitframerate, not on)
  pcall(client.SetSoundOn, not on)
end

local function dispatch(cmd)
  if cmd == nil or cmd == "" or cmd == "NOP" then return end
  -- Two-token form: "<NAME> <arg>"
  local space = cmd:find(" ")
  if space then
    local name = cmd:sub(1, space - 1)
    local rest = cmd:sub(space + 1)
    if name == "LOAD_LEVEL" then
      -- Turbo the load: its frameadvance loops (boot wait ≤3600, settle, gm$0F
      -- wait ≤600, each warp hop ≤600) are otherwise paced by the emulator's
      -- throttle (~60 fps), so a few-hundred-frame settle costs seconds. pcall +
      -- restore in all cases so the emulator is back at normal speed even if the
      -- load errors. (loadLevel sends its own reply on every internal path.)
      setLoadTurbo(true)
      local ok, err = pcall(loadLevel, rest)
      setLoadTurbo(false)
      if not ok then sendFramed("ERR loadLevel " .. tostring(err)) end
      return
    end
    if name == "READ_MEM" then
      -- READ_MEM <domain> <hex-addr> <hex-len>
      --   domain: "WRAM" / "CARTRAM" / "VRAM" / "CGRAM" / "OAM" / etc.
      --   hex-addr / hex-len: hex strings (no 0x prefix); len is bytes.
      -- Replies with the raw binary bytes (framed by BizHawk's auto-prefix).
      -- Used by verification flows: load a level, then dump arbitrary
      -- memory regions to confirm what the cart loaded.
      local sp1 = rest:find(" ")
      if not sp1 then sendFramed("ERR read_mem needs 3 args") return end
      local sp2 = rest:find(" ", sp1 + 1)
      if not sp2 then sendFramed("ERR read_mem needs 3 args") return end
      local domain = rest:sub(1, sp1 - 1)
      local addr   = tonumber(rest:sub(sp1 + 1, sp2 - 1), 16)
      local len    = tonumber(rest:sub(sp2 + 1), 16)
      if not addr or not len then sendFramed("ERR read_mem bad args") return end
      local ok, payload = pcall(memory.read_bytes_as_binary_string, addr, len, domain)
      if not ok then sendFramed("ERR " .. tostring(payload)) return end
      sendFramed(payload)
      return
    end
    if name == "CAPTURE_AT" then
      -- "CAPTURE_AT <x-pixels> <y-pixels> <path>"
      -- Known-working camera control. Teleports Yoshi to the screen
      -- center (so the game's "camera follows Yoshi" logic targets our
      -- desired position), then re-writes both camera variables each
      -- frame for 30 frames to overcome the game's smoothing/lerp.
      --
      -- CARTRAM addresses (32 KB cart RAM at SNES $70:xxxx where YI's
      -- runtime state lives per |!SRAMBankBaseAddress for SuperFX):
      --   $0039/$003B = Layer1XPos/YPos (Lo half)
      --   $0094/$0096 = Layer1XPos/YPos (ExRAM half — SuperFX-side mirror)
      --   $008A/$008C = Player_SubX / Player_XPos
      --   $008E/$0090 = Player_SubY / Player_YPos
      local sp1 = rest:find(" ")
      local sp2 = rest:find(" ", sp1 + 1)
      if not sp1 or not sp2 then
        sendFramed("ERR capture_at needs 3 args")
        return
      end
      local x = tonumber(rest:sub(1, sp1 - 1), 10)
      local y = tonumber(rest:sub(sp1 + 1, sp2 - 1), 10)
      local path = rest:sub(sp2 + 1)
      if not x or not y then
        sendFramed("ERR capture_at bad coords")
        return
      end
      -- Run unlocked so frameadvance() is CPU-bound, not realtime-60fps.
      -- A 30-frame settle at 60 Hz = 500 ms wall time; unlocked it's
      -- a few ms total.
      emu.limitframerate(false)
      snes.setlayer_obj_1(false)
      snes.setlayer_obj_2(false)
      snes.setlayer_obj_3(false)
      snes.setlayer_obj_4(false)
      local savedCamX = memory.read_u16_le(0x0039, "CARTRAM")
      local savedCamY = memory.read_u16_le(0x003B, "CARTRAM")
      local savedSubX = memory.read_u16_le(0x008A, "CARTRAM")
      local savedYX   = memory.read_u16_le(0x008C, "CARTRAM")
      local savedSubY = memory.read_u16_le(0x008E, "CARTRAM")
      local savedYY   = memory.read_u16_le(0x0090, "CARTRAM")
      local savedEx94 = memory.read_u16_le(0x0094, "CARTRAM")
      local savedEx96 = memory.read_u16_le(0x0096, "CARTRAM")
      -- Settle loop: re-write BOTH camera AND Yoshi every frame. The
      -- game's camera-follow logic each frame computes desired_camera =
      -- yoshi - center_offset, then lerps current toward desired. If
      -- Yoshi drifts (e.g. gravity), desired moves and our written
      -- camera never matches → endless slow pan. Pinning Yoshi every
      -- frame keeps desired == our written camera == no lerp needed.
      --
      -- Early-exit: read $0094 after each frame; break when it matches
      -- our target on TWO consecutive frames (need two to confirm the
      -- game's logic settled, not just our overwrite). Cap at 60 frames
      -- as a safety net.
      local stableFrames = 0
      for _ = 1, 60 do
        memory.write_u16_le(0x008A, 0,       "CARTRAM")
        memory.write_u16_le(0x008C, x + 128, "CARTRAM")
        memory.write_u16_le(0x008E, 0,       "CARTRAM")
        memory.write_u16_le(0x0090, y + 112, "CARTRAM")
        memory.write_u16_le(0x0039, x, "CARTRAM")
        memory.write_u16_le(0x003B, y, "CARTRAM")
        memory.write_u16_le(0x0094, x, "CARTRAM")
        memory.write_u16_le(0x0096, y, "CARTRAM")
        emu.frameadvance()
        if memory.read_u16_le(0x0094, "CARTRAM") == x
           and memory.read_u16_le(0x0096, "CARTRAM") == y then
          stableFrames = stableFrames + 1
          if stableFrames >= 2 then break end
        else
          stableFrames = 0
        end
      end
      client.screenshot(path)
      local actualCamX = memory.read_u16_le(0x0039, "CARTRAM")
      local actualCamY = memory.read_u16_le(0x003B, "CARTRAM")
      local actualEx94 = memory.read_u16_le(0x0094, "CARTRAM")
      local actualYX  = memory.read_u16_le(0x008C, "CARTRAM")
      local actualYY  = memory.read_u16_le(0x0090, "CARTRAM")
      -- Restore.
      memory.write_u16_le(0x0039, savedCamX, "CARTRAM")
      memory.write_u16_le(0x003B, savedCamY, "CARTRAM")
      memory.write_u16_le(0x0094, savedEx94, "CARTRAM")
      memory.write_u16_le(0x0096, savedEx96, "CARTRAM")
      memory.write_u16_le(0x008A, savedSubX, "CARTRAM")
      memory.write_u16_le(0x008C, savedYX,   "CARTRAM")
      memory.write_u16_le(0x008E, savedSubY, "CARTRAM")
      memory.write_u16_le(0x0090, savedYY,   "CARTRAM")
      snes.setlayer_obj_1(true)
      snes.setlayer_obj_2(true)
      snes.setlayer_obj_3(true)
      snes.setlayer_obj_4(true)
      emu.limitframerate(true)
      sendFramed(string.format(
        "OK wrote=(%d,%d) cam39=(%d,%d) cam94=(%d,_) yoshi=(%d,%d) %s",
        x, y, actualCamX, actualCamY, actualEx94, actualYX, actualYY, path
      ))
      return
    end
  end
  local h = handlers[cmd]
  if h then
    h()
  else
    log("unknown command: " .. tostring(cmd))
    sendFramed("ERR unknown " .. tostring(cmd))
  end
end

local function tick()
  if not isReady() then return end
  sendFramed("RDY")
  local cmd = comm.socketServerResponse()
  dispatch(cmd)
end

-- Short timeout so a missed reply doesn't stall emulation forever.
comm.socketServerSetTimeout(2000)

log("harness loaded, awaiting socket")

-- Main loop. We don't use event.onframeend because BizHawk disallows
-- emu.frameadvance() (and several other emu/client APIs) inside event
-- callbacks. The while-true + frameadvance pattern lets dispatch handlers
-- call frameadvance freely — needed for CAPTURE_AT and the eventual
-- camera-sweep that walks BizHawk's camera across the whole level.
while true do
  tick()
  emu.frameadvance()
end
