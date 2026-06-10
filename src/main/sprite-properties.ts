// Per-sprite-type computed read-only properties (Properties panel). A registry
// maps a sprite num → a provider that derives explanatory fields from the sprite
// + level context — for sprites whose behaviour isn't captured by the stored
// bytes. Add a provider to expose a new sprite type; the Properties panel renders
// whatever rows come back (empty ⇒ nothing shown).

import { hex0x } from 'snes-framework/hex'
import type { MessagePtrTableModel } from 'snes-framework/types'
import { loadAsmRegionResource } from './resources'
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

const PROVIDERS: Record<number, Provider> = {
  0x0ad: messageBox
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
