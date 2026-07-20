// Per-sprite-type computed read-only properties (Properties panel). A registry
// maps a sprite num → a provider that derives explanatory fields from the sprite
// + level context — for sprites whose behaviour isn't captured by the stored
// bytes. Add a provider to expose a new sprite type; the Properties panel renders
// whatever rows come back (empty ⇒ nothing shown).

import { hex0x } from 'snes-framework/hex'
import type { MessagePtrTableModel } from 'snes-framework/types'
import { loadAsmRegionResource, loadLevelResource } from './resources'
import type { SpriteProperty, SpritePropertiesRequest } from '../shared/ipc-types'

type Provider = (ctx: SpritePropertiesRequest) => SpriteProperty[]

/**
 * Sprite 0x0AD MessageBox. The message it shows is NOT stored in level data — the
 * handler derives the message ID from the level + the block's placement (see
 * YI_NorSpr0AD_MessageBox_Main, Bank05.asm; ID calc at CODE_05DC05):
 *
 *   messageID = CurrentLevelFromMap * 4 + slot
 *   slot      = (pixelX bit 4) + 2 * (pixelY bit 4)
 *
 * `CurrentLevelFromMap` is the translevel (world-map slot). Stored sprite x/y are
 * 16-px cells, so the runtime "pixel bit 4" (`AND #$0010`) is just the cell's
 * LSB. The text is then `DATA_message_box_text_ptrs[messageID]` → a message body,
 * which we resolve through the same model the Message Pointers tab uses (its
 * options carry a first-line text preview).
 *
 * NOTE: the runtime `$001`+hasty → `$11C` override (throwing-eggs tap vs hold) is
 * intentionally NOT modeled — it keys off a global setting, not placement.
 */
function messageBox(ctx: SpritePropertiesRequest): SpriteProperty[] {
  const idTooltip =
    'Not stored in level data — the engine derives it: message ID = translevel × 4 + slot, ' +
    'where slot = (X pixel-bit 4) + 2 × (Y pixel-bit 4). Sprites sit on 16-px cells, so those ' +
    "bits are the X/Y cell parity. Move the block one cell in X or Y to point it at a different " +
    'message. (YI_NorSpr0AD_MessageBox_Main, Bank05.asm.)'
  const textTooltip =
    'First line of the message this ID points at, via DATA_message_box_text_ptrs → the message ' +
    'body. Edit the pointer table or the text in the Strings panel.'
  if (ctx.translevelId === null) {
    return [
      {
        label: 'Message',
        value: 'Open this level from the world map (it has no translevel slot) to resolve its message.',
        tooltip: idTooltip
      }
    ]
  }
  const slot = (ctx.x & 1) + 2 * (ctx.y & 1)
  const messageId = ctx.translevelId * 4 + slot
  const ptr = loadAsmRegionResource('message-box-text-ptrs') as MessagePtrTableModel
  const target = messageId >= 0 && messageId < ptr.slots.length ? ptr.slots[messageId] : ''
  const opt = target ? ptr.options.find((o) => o.id === target) : undefined
  const text = !target
    ? '(empty slot — no message)'
    : opt?.preview
      ? opt.preview
      : '(empty message)'
  return [
    {
      label: 'Message ID',
      value: `${hex0x(messageId)}  (${hex0x(ctx.translevelId)}×4 + ${slot})`,
      tooltip: idTooltip
    },
    { label: 'Message text', value: text, tooltip: textTooltip }
  ]
}

/**
 * Sprite 0x09E Chomp Rock. Grey vs brown is NOT stored in level data — the Init
 * (YI_NorSpr09E_ChompRock_Init, Bank0E.asm, $0EBE94) picks the variant from the
 * LEVEL the rock spawns in, and "brown" is just a palette-row + behavior-flag
 * rewrite ($7042,x / $7040,x — !EXRAM_YI_Level_NorSpr_OAMFlipPaletteFlags /
 * _BehaviorFlags):
 *
 *   - translevel 0x00 (1-1): brown iff the CURRENT room's "Item memory" header
 *     (header[14]) == 1. The base game uses the field as a room discriminator —
 *     1-1's cave sub-room (record 0x3A, item memory 1) gets the brown rock while
 *     the main room (item memory 0) gets a grey one.
 *   - translevel 0x28 (4-5 Chomp Rock Zone): the first rock to init turns brown
 *     and sets the never-resetting per-level flag $0E29; every Chomp Rock init
 *     after that self-despawns (JML CODE_despawn_sprite_stage_ID) — extra
 *     placements anywhere in 4-5 simply never appear.
 *   - everywhere else: always grey.
 */
function chompRock(ctx: SpritePropertiesRequest): SpriteProperty[] {
  const colorTooltip =
    'Not stored in level data — the Init (YI_NorSpr09E_ChompRock_Init, Bank0E.asm) picks the ' +
    'color from the level: brown in 1-1 rooms whose "Item memory" header field is 1 (the cave ' +
    'sub-room ships that way) and in 4-5 (Chomp Rock Zone); grey everywhere else. "Brown" is a ' +
    'palette-row + behavior-flag rewrite, not a different sprite id.'
  if (ctx.translevelId === 0x28) {
    return [
      { label: 'Color', value: 'Brown (4-5 Chomp Rock Zone)', tooltip: colorTooltip },
      {
        label: 'Spawn limit',
        value: 'Only the first Chomp Rock to spawn in 4-5 appears — the engine despawns every later one.',
        tooltip:
          'In translevel 0x28 the Init sets a per-level flag ($0E29) when the brown rock spawns, and ' +
          'any Chomp Rock initialised while the flag is set self-despawns instead ' +
          '(CODE_despawn_sprite_stage_ID). The flag never clears mid-level, so a second rock placed ' +
          'anywhere in 4-5 (sub-rooms included) never shows up.'
      }
    ]
  }
  if (ctx.translevelId === 0x00) {
    let itemMemory: number | null = null
    if (ctx.levelRecordId !== null) {
      try {
        itemMemory = loadLevelResource(ctx.levelRecordId).header[14] ?? null
      } catch {
        // header unavailable (unresolved record) — fall through to the unresolved row
      }
    }
    const coach =
      ' In 1-1 the "Item memory" header field doubles as the brown-rock switch for the room — ' +
      'set it to 1 (Header panel) to make this room\'s rocks brown. Header edits need a rebuild ' +
      'to show in-game.'
    if (itemMemory === null) {
      return [{ label: 'Color', value: 'Unresolved (room header unavailable)', tooltip: colorTooltip + coach }]
    }
    return [
      {
        label: 'Color',
        value: itemMemory === 1 ? 'Brown (room item memory = 1)' : 'Grey (room item memory ≠ 1)',
        tooltip: colorTooltip + coach
      }
    ]
  }
  if (ctx.translevelId === null) {
    return [
      {
        label: 'Color',
        value: 'Grey — unless played inside 1-1 or 4-5 (open the level from the world map to resolve).',
        tooltip: colorTooltip
      }
    ]
  }
  return [{ label: 'Color', value: 'Grey', tooltip: colorTooltip }]
}

const PROVIDERS: Record<number, Provider> = {
  0x0ad: messageBox,
  0x09e: chompRock
}

/** Compute the read-only properties for a selected sprite, or `[]` when the
 *  sprite type has no provider (or computing throws — e.g. an outdated overlay
 *  missing the message-pointer region). */
export function computeSpriteProperties(req: SpritePropertiesRequest): SpriteProperty[] {
  try {
    return PROVIDERS[req.num]?.(req) ?? []
  } catch {
    return []
  }
}
