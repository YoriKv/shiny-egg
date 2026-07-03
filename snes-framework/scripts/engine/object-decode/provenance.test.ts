// Unit test for the object-drag cell-highlight provenance recorder +
// reconstruction. Pure — no
// ROM: we drive `stampCell` / `writeBuf16` directly with controlled
// `currentObjectIndex` / `$1D` and assert the recorded classification and the
// offset→cell reconstruction.
//
// Run from repo root:
//   node snes-framework/scripts/engine/object-decode/provenance.test.ts

import { DecodeState } from './state.ts';
import { stampCell, writeBuf16 } from './handlers/_shared.ts';
import { resolveProvenanceCells, resolveObjectFootprints } from './provenance.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

// Offsets within screen 0 → page 1 (page*512 + row*32 + col*2):
//   FOOT  = 612 → row 3, col 2  → cell (2,3)
//   NEIGH = 640 → row 4, col 0  → cell (0,4)
//   SELF  = 900 → row 12, col 2 → cell (2,12)   (writeBuf16 to own $1D)
const FOOT = 612;
const NEIGH = 640;
const SELF = 900;
const TARGET = 5;

function armedState(): DecodeState {
  const s = new DecodeState();
  s.reset(new Uint8Array(0), []);
  s.screenPageMap[0] = 1; // screen 0 → LRU page 1
  s.provenanceTargets = new Set([TARGET]);
  s.provenanceCells = new Map();
  return s;
}

// ── Recording + classification ──────────────────────────────────────────────
{
  const s = armedState();

  // Target footprint at FOOT (current cell = FOOT).
  s.currentObjectIndex = TARGET;
  s.zp1D = FOOT;
  stampCell(s, 0x1234);

  // Target neighbour touch-up at NEIGH (current cell still FOOT, write elsewhere).
  s.zp1D = FOOT;
  writeBuf16(s, NEIGH, 0x5678);

  // Target stamps its OWN cell via writeBuf16 (the no_egg_grass shape):
  // off === $1D → must classify as footprint, NOT neighbour.
  s.zp1D = SELF;
  writeBuf16(s, SELF, 0x9abc);

  const m = s.provenanceCells!;
  assert(m.get(FOOT)?.neighbor === false && m.get(FOOT)?.buried === false, 'FOOT = footprint, not buried');
  assert(m.get(NEIGH)?.neighbor === true && m.get(NEIGH)?.buried === false, 'NEIGH = neighbour, not buried');
  assert(m.get(SELF)?.neighbor === false, 'writeBuf16 to own $1D classifies as footprint');

  // An EARLIER object (idx < target) writing a target cell is ignored.
  s.currentObjectIndex = 2;
  s.zp1D = 700;
  writeBuf16(s, FOOT, 0xdead);
  assert(m.get(FOOT)?.buried === false, 'earlier object does not bury a target cell');
  assert(!m.has(700), 'earlier object writing a fresh cell records nothing');

  // A LATER object (idx > target) overwriting a target cell flips it to buried.
  s.currentObjectIndex = 8;
  s.zp1D = 800;
  writeBuf16(s, FOOT, 0xbeef);
  assert(m.get(FOOT)?.buried === true, 'later object buries the target footprint cell');
  // A later object writing a NON-target cell records nothing.
  writeBuf16(s, 720, 0x0001);
  assert(!m.has(720), 'later object writing a non-target cell records nothing');
}

// ── Multi-target (multi-select drag): one decode records the whole group ─────
{
  const s = new DecodeState();
  s.reset(new Uint8Array(0), []);
  s.screenPageMap[0] = 1;
  s.provenanceTargets = new Set([2, 5]);
  s.provenanceCells = new Map();
  const m = s.provenanceCells;

  // Target 2 stamps A (its footprint); target 5 stamps B (its footprint).
  s.currentObjectIndex = 2; s.zp1D = FOOT;  stampCell(s, 0x1);
  s.currentObjectIndex = 5; s.zp1D = NEIGH; stampCell(s, 0x2);
  // A LATER target (5) re-stamps another target's cell (A): last-writer-wins, so
  // it stays a group footprint — NOT buried.
  s.zp1D = FOOT; stampCell(s, 0x3);
  // A later NON-target object (8) overdraws B → buried.
  s.currentObjectIndex = 8; s.zp1D = 700; writeBuf16(s, NEIGH, 0x4);

  assert(m.get(FOOT)?.buried === false && m.get(FOOT)?.neighbor === false,
    'multi: a cell re-stamped by another target stays group footprint');
  assert(m.get(NEIGH)?.buried === true,
    'multi: a target cell overdrawn by a non-target object is buried');
}

// ── Reconstruction (offset → absolute cell) ─────────────────────────────────
{
  const s = armedState();
  s.currentObjectIndex = TARGET;
  s.zp1D = FOOT;  stampCell(s, 0x1);
  s.zp1D = FOOT;  writeBuf16(s, NEIGH, 0x2);
  s.zp1D = SELF;  writeBuf16(s, SELF, 0x3);
  s.currentObjectIndex = 8;
  s.zp1D = 800;   writeBuf16(s, FOOT, 0x4); // bury FOOT

  const cells = resolveProvenanceCells(s);
  const at = (x: number, y: number) => cells.find((c) => c.x === x && c.y === y);
  assert(cells.length === 3, `3 cells reconstructed (got ${cells.length})`);
  assert(at(2, 3)?.buried === true && at(2, 3)?.neighbor === false, 'FOOT → (2,3) buried footprint');
  assert(at(0, 4)?.neighbor === true && at(0, 4)?.buried === false, 'NEIGH → (0,4) neighbour');
  assert(at(2, 12)?.neighbor === false, 'SELF → (2,12) footprint');
}

// ── Zero-cost path: no target armed → records nothing, no throw ─────────────
{
  const s = new DecodeState();
  s.reset(new Uint8Array(0), []);
  s.currentObjectIndex = 0;
  s.zp1D = FOOT;
  stampCell(s, 0x1234);     // must not throw
  writeBuf16(s, NEIGH, 0x5678);
  assert(s.provenanceCells === null, 'provenanceCells stays null when no target armed');
  assert(resolveProvenanceCells(s).length === 0, 'resolve returns [] with no recording');
}

// ── Drawn-tiles footprints (editor hit-testing): EVERY writer of a cell is
//    recorded — including one later overwritten — so a click there can cycle
//    through both the visible and the buried object. ─────────────────────────
{
  const s = new DecodeState();
  s.reset(new Uint8Array(0), []);
  s.screenPageMap[0] = 1;
  s.cellStampers = new Map();

  s.currentObjectIndex = 5; s.zp1D = FOOT; stampCell(s, 0x1);        // obj 5 → FOOT
  s.zp1D = FOOT; writeBuf16(s, NEIGH, 0x2);                          // obj 5 → NEIGH (touch-up)
  s.currentObjectIndex = 8; s.zp1D = 800; writeBuf16(s, FOOT, 0x3);  // obj 8 OVERWRITES FOOT
  s.currentObjectIndex = 3; s.zp1D = SELF; stampCell(s, 0x4);        // obj 3 → SELF

  const fp = resolveObjectFootprints(s, 9);
  const FOOT_CELL = 3 * 256 + 2;  // (2,3)
  const NEIGH_CELL = 4 * 256 + 0; // (0,4)
  const SELF_CELL = 12 * 256 + 2; // (2,12)
  assert(fp.length === 9, `footprints dense over objectCount (got ${fp.length})`);
  assert(fp[5]!.includes(FOOT_CELL) && fp[5]!.includes(NEIGH_CELL), 'obj 5 footprint = FOOT + NEIGH');
  assert(fp[8]!.includes(FOOT_CELL), 'obj 8 (overwriter) also owns FOOT — buried writers ARE recorded');
  assert(fp[3]!.includes(SELF_CELL), 'obj 3 footprint = SELF');
  assert(fp[0]!.length === 0 && fp[1]!.length === 0, 'objects that stamp nothing get an empty footprint');
}

// ── Zero-cost path: footprint collector unarmed → all-empty, no throw ────────
{
  const s = new DecodeState();
  s.reset(new Uint8Array(0), []);
  s.currentObjectIndex = 0;
  s.zp1D = FOOT;
  stampCell(s, 0x1234);
  assert(s.cellStampers === null, 'cellStampers stays null when the collector is unarmed');
  assert(resolveObjectFootprints(s, 3).every((a) => a.length === 0), 'resolve returns all-empty with no recording');
}

if (failures === 0) console.log('✓ all assertions pass');
process.exit(failures > 0 ? 1 : 0);
