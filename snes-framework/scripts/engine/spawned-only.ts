// Derive the per-sprite `spawnedOnly` fact: a sprite that the game brings into
// existence ONLY by another sprite spawning it at runtime (projectiles, thrown
// children, boss sub-parts, cutscene/event actors), never by a placed sprite-
// stream record. Such sprites can't be hand-placed sensibly — their parent sets
// up per-slot fields the sprite's Init assumes — so the picker tags them with a
// "spawn-only" badge (see obj-metadata `spawnedOnly` + PickerPanel).
//
// DEFINITION (both conditions, AND):
//   1. SPAWNED — the id is passed as the literal `A` argument to one of the
//      CODE_spawn_sprite* entries (the parent-spawn path; the camera-window
//      stream walker that materialises PLACED sprites uses a different path,
//      CODE_check_new_sprites, so it never contributes here).
//   2. NEVER PLACED — the id has zero entries in the base-cart instance index
//      (no level's sprite stream contains it).
// Restricted to normal sprites (< 0x1BA); ids ≥ 0x1BA are special sprites on a
// separate spawn/gfx path and aren't picker-placeable the same way.
//
// CAVEAT (false-negative, by design): a spawn site that loads the id non-
// literally (from a table / computed) can't be resolved statically, so a child
// reached only that way is left UNFLAGGED rather than guessed. Those sites are
// returned in `computedSites` for review. Under-flagging is safe (the sprite
// just isn't hidden); over-flagging would wrongly hide a placeable sprite.
//
// This is the committed core behind tmp/gen-spawned-only.ts (which writes the
// metadata + cross-checks an independent count) and spawned-only.test.ts (which
// asserts the committed metadata still matches this derivation).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FRAMEWORK_ROOT } from './dev-cart.ts';
import { instanceIndexPath, buildInstanceIndex, type InstanceIndex } from '../instance-index.ts';

/** First special-sprite id — ids at/above use CODE_init_special_sprite. */
export const SPECIAL_SPRITE_BASE = 0x1ba;

export interface SpawnSite {
  file: string;
  line: number;
  routine: string;
  /** Literal sprite id at the call, or null when the id is computed/table-driven. */
  id: number | null;
}

export interface SpawnedOnlyResult {
  /** Sorted ids that are spawned ∧ never-placed ∧ < 0x1BA — the flagged set. */
  spawnedOnly: number[];
  /** Distinct literal ids passed to a spawn routine anywhere in the asm. */
  spawned: Set<number>;
  /** Sprite ids with ≥1 placement in the base-cart instance index. */
  placed: Set<number>;
  /** Spawn sites whose id couldn't be resolved statically (review for misses). */
  computedSites: SpawnSite[];
}

// id-bearing spawn entries — A holds the 16-bit sprite id at the call. All
// resolve into the shared spawn body (Bank03 CODE_spawn_sprite_init et al.).
const SPAWN_CALL =
  /\bJS[LR](?:\.[lwb])?\s+(CODE_spawn_sprite(?:_init(?:_with_Y)?|_active(?:_with_Y|_state)?)?)\b/;
const LDA_IMM = /^\s*LDA\.w\s+#\$([0-9A-Fa-f]{1,4})\b/;
// Opcodes that write/modify A between an id-load and the call ⇒ id is computed.
const A_CLOBBER = /^\s*(LDA|PLA|TXA|TYA|TDC|ADC|SBC|AND|ORA|EOR|ASL|LSR|ROL|ROR|INC|DEC)\b/;
const SCAN_BACK = 12; // lines to look back from a spawn call for the id-load

/** Scan one bank's lines for spawn sites, resolving each id from the nearest
 *  preceding `LDA.w #$imm` with no intervening A-clobber. */
function scanBank(file: string, lines: string[], out: SpawnSite[]): void {
  for (let i = 0; i < lines.length; i++) {
    const m = SPAWN_CALL.exec(lines[i]);
    if (!m) continue;
    let id: number | null = null;
    for (let j = i - 1; j >= 0 && j >= i - SCAN_BACK; j--) {
      const imm = LDA_IMM.exec(lines[j]);
      if (imm) {
        id = parseInt(imm[1], 16);
        break;
      }
      if (A_CLOBBER.test(lines[j])) break; // A overwritten by a non-immediate ⇒ computed
    }
    out.push({ file, line: i + 1, routine: m[1], id });
  }
}

/** Load the base-cart placed-sprite id set — the prebuilt instance index if
 *  present, else built in-memory (matches find-object's behaviour). */
function loadPlacedSprites(frameworkRoot: string): Set<number> {
  const p = instanceIndexPath(frameworkRoot);
  const index: InstanceIndex = fs.existsSync(p)
    ? (JSON.parse(fs.readFileSync(p, 'utf8')) as InstanceIndex)
    : buildInstanceIndex(frameworkRoot);
  return new Set(Object.keys(index.sprite).map((k) => parseInt(k, 16)));
}

export function deriveSpawnedOnly(frameworkRoot: string = FRAMEWORK_ROOT): SpawnedOnlyResult {
  const banksDir = path.join(frameworkRoot, 'yi', 'Banks');
  const sites: SpawnSite[] = [];
  for (const name of fs.readdirSync(banksDir).filter((n) => n.endsWith('.asm')).sort()) {
    scanBank(name, fs.readFileSync(path.join(banksDir, name), 'utf8').split('\n'), sites);
  }

  const spawned = new Set<number>();
  const computedSites: SpawnSite[] = [];
  for (const s of sites) {
    if (s.id == null) computedSites.push(s);
    else spawned.add(s.id);
  }

  const placed = loadPlacedSprites(frameworkRoot);
  const spawnedOnly = [...spawned]
    .filter((id) => id < SPECIAL_SPRITE_BASE && !placed.has(id))
    .sort((a, b) => a - b);

  return { spawnedOnly, spawned, placed, computedSites };
}
