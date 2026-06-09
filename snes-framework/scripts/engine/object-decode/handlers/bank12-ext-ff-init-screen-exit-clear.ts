// Ext object $FF — CODE_init_screen_exit_clear ($12:9191, Bank12.asm:2855).
//
// Reached via the $00 ext-dispatch prefix in parser.ts → ext-init table at
// extID $FF. This is the EXTENDED-object $FF, entirely distinct from the
// std-stream $FF TERMINATOR (parser.ts only treats $FF as the terminator
// when it is the stream's leading $15 byte, never through the $00 ext
// prefix). So registering ext $FF here is correct and does NOT interfere
// with stream termination.
//
// ── Table-slot finding (AUDIT-VERIFIED) ───────────────────────
// The cart ext-init pointer table DATA_extended_object_init_ptrs (alias
// DATA_extended_object_init_ptrs) has exactly 255 entries — indices $00..$FE.
// Its $FB entry is CODE_extobj_FB_copy_screen_exit and its LAST entry ($FE) is
// CODE_extobj_FE_set_babymario_float_limit (both confirmed present in the closure
// dump; CODE_init_screen_exit_clear/init_screen_exit_clear does NOT appear in the ext-table
// region). There is NO index-$FF slot: at runtime ext $FF over-reads the end
// of the table, and no shipping level emits ext $FF, so this handler never
// fires in a real decode (the ext-$FF spec records 0 cells for exactly this
// reason). It is effectively DEAD CODE; we register it defensively and
// document it accurately rather than removing it.
//
// The spec.json's init_handler name "CODE_init_screen_exit_clear" resolves
// (sym aliases) to CODE_init_screen_exit_clear, which is the STANDARD-object $00 init,
// dispatched by the STD object table, NOT the ext table. We model that named
// routine's behaviour here because (a) it is the routine the spec names, and
// (b) the spec output is identical either way: 0 Map16 cells stamped,
// walker_setup=null, init_dp_delta=null.
//
// ── What CODE_init_screen_exit_clear does (VERIFIED from asm, Bank12.asm:2855) ─
//   LDY $1C : LDA $6CAA,y : AND #$3F    ; page = screenPageMap[screen]&$3F
//   BEQ rtl                             ;   page 0 / unallocated → return
//   PHA : TAX : STZ $0D4E,x             ; lruChain[page] = 0
//   TYX : LDA #$80 : STA $6CAA,x        ; screenPageMap[screen] = $80
//   PLA : TAX                           ; X = page
//   ; base = $7F8000 + (page<<8<<1) = $7F8000 + page*$200; zero 512 bytes
//   LDA #$0000 : { STA [$20],y ; STA [$24],y ; INY×2 } until Y wraps (256)
//   DEC $0D4D                           ; page/LRU counter--
//   RTL
// (The asm's own header comment: "Object $00 init … clears the 256-entry
//  screen-num-to-exit map ($7E:6CAA), then zeroes a full 512-byte screen-exit
//  destination block at $7F:8000+(screen_id*$200) and decrements live-exit
//  count $0D4D. Special 'delete screen exit' command, dispatched by the
//  standard-object table but doesn't drive the walker.")
// It DEALLOCATES the screen page for the screen at $1C: returns its 512-byte
// LevelDataBuffer block to zero and frees the page from the allocator pool.
// It is NOT a tile stamper and does NOT drive the walker.
//
// MODELED (real, shared decoder state that resolveScreenPage() populates):
//   screenPageMap ($6CAA), lruChain ($0D4E), the page counter ($0D4D =
//   state.lastLruPage), and the 512-byte LevelDataBuffer block for the
//   freed page. We replicate the dealloc + zero faithfully (matching the asm).
//
// DOCUMENTED-UNMODELED:
//   - The asm comment frames the 512-byte block as "screen-exit
//     destination" data. In OUR static decoder, parsed exits live in
//     DecodeState.exits (DecodedScreenExit[]), produced by a SEPARATE pass
//     (parseScreenExits in parser.ts) — not in the LevelDataBuffer page.
//     This routine does not touch state.exits, and nothing in the modeled
//     exit pipeline depends on this page-clear. No exit fabrication.
//   - Ext $FF is unreachable (no ext-table slot, see above), so this body
//     never executes in a real decode; it is kept faithful for correctness.
//
import type { DecodeState } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';

// Ports CODE_init_screen_exit_clear ($12:9191). Deallocates the screen page
// for the screen at $1C and zeroes its 512-byte LevelDataBuffer block.
// (Unreachable in practice — see header "Table-slot finding".)
function initScreenExitClear(state: DecodeState): void {
  // LDY $1C — screen index. Coords are on the 128-screen grid; the
  // allocator (fetch.ts resolveScreenPage) indexes screenPageMap by the
  // raw 0..$7F screen number, so mask the high (page-Y/visited) bits.
  const screen = state.zp1C & 0x7f;

  // LDA $6CAA,y : AND #$3F — page index (low 6 bits; $80 = unallocated).
  const page = state.screenPageMap[screen]! & 0x3f;

  // BEQ rtl — page 0 / unallocated → nothing to free.
  if (page === 0) return;

  // STZ $0D4E,x (x = page) — clear the LRU-chain entry for this page.
  state.lruChain[page] = 0;

  // STA #$80 → $6CAA,x (x = screen) — mark the screen unallocated.
  state.screenPageMap[screen] = 0x80;

  // Zero the freed page's 512-byte ($200) LevelDataBuffer block.
  // Cart absolute base = $7F8000 + (page<<8<<1) = $7F8000 + page*$200; our
  // levelDataBuffer is the $7F:8000 window, so the in-buffer offset is
  // (page*$200) & $7FFF.
  const base = (page * 0x200) & 0x7fff;
  for (let i = 0; i < 0x200; i++) {
    state.levelDataBuffer[base + i] = 0;
  }

  // DEC $0D4D — page/LRU counter (cart $0D4D = state.lastLruPage).
  state.lastLruPage = (state.lastLruPage - 1) & 0xff;
}

/** Register ext object $FF (CODE_init_screen_exit_clear). Unreachable (no
 *  ext-table $FF slot); the 0x100 mirror is automatic (getExtObjectHandler
 *  masks id & 0xff). */
export function installExtFfInitScreenExitClearHandlers(): void {
  registerExtObjectHandler(0xff, initScreenExitClear);
}
